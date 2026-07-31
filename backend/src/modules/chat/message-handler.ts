/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { storageService } from '../storage/storage-service.js';
import { emitWebhook } from '../api/webhook-service.js';
import { runAutomationRules } from '../automation/automation-service.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { sendRpcToAgent } from '../agent/agent-socket.js';

export async function runZaloMethod(userOrgId: string, accountId: string, method: string, args: any[] = []) {
  const activeAgent = await prisma.zaloDesktopAgent.findFirst({
    where: { orgId: userOrgId, status: 'active' }
  });

  const safeArgs = args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg);

  if (activeAgent) {
    return sendRpcToAgent(userOrgId, method, { accountId, args: safeArgs });
  } else {
    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) throw new Error('Zalo not connected');
    return (instance.api as any)[method](...args);
  }
}

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  cliMsgId?: string;
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  groupName?: string;       // group name if group message
  attachments?: any[];
  quote?: any;
}

export interface HandleMessageResult {
  message: {
    id: string;
    conversationId: string;
    zaloMsgId: string | null;
    senderType: string;
    senderUid: string | null;
    senderName: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
    isDeleted: boolean;
    deletedAt: Date | null;
    sentAt: Date;
    repliedByUserId: string | null;
    createdAt: Date;
  };
  conversationId: string;
  orgId: string;
  contactId: string | null;
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: msg.accountId },
      select: { orgId: true, ownerUserId: true },
    });
    if (!account) return null;

    const contactId = await upsertContact(msg, account.orgId);

    // Update lastActivity for lead scoring freshness
    if (contactId) {
      prisma.contact.update({
        where: { id: contactId },
        data: { lastActivity: new Date() },
      }).catch(() => {});
    }

    const conversation = await findOrCreateConversation(msg, account.orgId, contactId);
    const sentAt = new Date(msg.timestamp);

    // DEDUPLICATION: Check if this Zalo message ID already exists
    if (msg.msgId) {
      const existingMsg = await prisma.message.findFirst({
        where: { conversationId: conversation.id, zaloMsgId: msg.msgId }
      });
      if (existingMsg) {
        logger.debug(`[message-handler] Skipping duplicate message ${msg.msgId}`);
        return null; 
      }
    }

    // SELF-MESSAGE UPDATE: If it's a self message, check for a recent manual message to attach the zaloMsgId
    if (msg.isSelf) {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      const recentManualMsg = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          senderType: 'self',
          zaloMsgId: null,
          sentAt: { gte: thirtySecondsAgo }
        },
        orderBy: { sentAt: 'asc' } // Oldest first to match in order
      });

      if (recentManualMsg) {
        const updated = await prisma.message.update({
          where: { id: recentManualMsg.id },
          data: { zaloMsgId: msg.msgId || null, cliMsgId: msg.cliMsgId || null }
        });
        logger.info(`[message-handler] Attached zaloMsgId ${msg.msgId} to recent manual message`);
        return {
          message: updated as any,
          conversationId: conversation.id,
          orgId: account.orgId,
          contactId
        };
      }
    }

    const isFile = msg.contentType !== 'text';
    const message = await prisma.message.create({
      data: {
        id: randomUUID(),
        conversationId: conversation.id,
        zaloMsgId: msg.msgId || null,
        cliMsgId: msg.cliMsgId || null,
        senderType: msg.isSelf ? 'self' : 'contact',
        senderUid: msg.senderUid,
        senderName: msg.senderName || null,
        content: msg.content || '',
        contentType: msg.contentType || 'text',
        attachments: msg.attachments ?? [],
        quote: msg.quote ?? null,
        sentAt,
        fileStatus: isFile ? 'pending' : 'none',
        isUnread: msg.isSelf ? false : true,
      },
    });

    // FIRE-AND-FORGET: Process attachments in background
    if (isFile) {
      storageService.processMessageFiles(message.id).catch((err) => {
        logger.error(`[chat] Background storage trigger failed for ${message.id}:`, err);
      });
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf);

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {});
    }

    // Emit webhook for message event (fire-and-forget)
    emitWebhook(account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: msg.senderUid,
      content: msg.content,
      contentType: msg.contentType,
      sentAt: message.sentAt,
    });

    if (!msg.isSelf) {
      const org = await prisma.organization.findUnique({
        where: { id: account.orgId },
        select: { id: true, name: true },
      });
      const contact = contactId
        ? await prisma.contact.findUnique({
            where: { id: contactId },
            select: { id: true, fullName: true, phone: true, status: true, source: true, assignedUserId: true },
          })
        : null;
      const conversationDetails = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        select: { id: true, unreadCount: true, externalThreadId: true, threadType: true, zaloAccountId: true },
      });

      void runAutomationRules({
        trigger: 'message_received',
        orgId: account.orgId,
        org,
        contact,
        conversation: conversationDetails
          ? {
              id: conversationDetails.id,
              unreadCount: conversationDetails.unreadCount,
              threadId: conversationDetails.externalThreadId,
              threadType: conversationDetails.threadType,
              zaloAccountId: conversationDetails.zaloAccountId,
            }
          : null,
        message: { id: message.id, content: message.content, contentType: message.contentType, senderType: message.senderType },
      });
    }

    // GROUP MEMBER SYNC: If it's a group message, ensure members are synced for permission routing
    if (msg.threadType === 'group') {
      syncGroupMembers(msg.accountId, conversation.id, msg.threadId, account.orgId).catch(err => {
        logger.error(`[message-handler] Failed to sync group members for ${msg.threadId}:`, err);
      });
    }

    return {
      message,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    };
  } catch (err) {
    logger.error('[message-handler] handleIncomingMessage error:', err);
    return null;
  }
}

// Upsert contact — handles both user and group conversations
async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId;
    let groupContact = await prisma.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    });

    if (!groupContact) {
      groupContact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      // Emit webhook for new contact created
      emitWebhook(orgId, 'contact.created', { contactId: groupContact.id, fullName: groupContact.fullName });
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await prisma.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      });
    }
    return groupContact.id;
  }

  // User messages: determine the correct UID for the contact
  const contactUid = msg.isSelf ? msg.threadId : msg.senderUid;
  const contactName = msg.isSelf ? `Zalo User ${contactUid.slice(-4)}` : (msg.senderName || 'Unknown');

  if (!contactUid) return null;

  let contact = await prisma.contact.findFirst({
    where: { zaloUid: contactUid, orgId },
    select: { id: true, fullName: true, avatarUrl: true },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: contactUid,
        fullName: contactName,
      },
      select: { id: true, fullName: true, avatarUrl: true },
    });
    // Emit webhook for new contact created
    emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
    
    // Fetch profile in background to get avatar
    runZaloMethod(orgId, msg.accountId, 'getUserInfo', [contactUid]).then(async (res) => {
      const profiles = res?.changed_profiles || res?.profiles || res?.profile_map || {};
      const singleProfile = profiles[contactUid] || profiles[`${contactUid}_0`] || Object.values(profiles)[0];
      if (singleProfile && singleProfile.avatar) {
        await prisma.contact.update({
          where: { id: contact!.id },
          data: { 
            avatarUrl: singleProfile.avatar,
            fullName: singleProfile.zaloName || singleProfile.displayName || singleProfile.name || contactName
          }
        });
      }
    }).catch(() => {});
  } else {
    // If contact exists but has no avatar, fetch it in background
    if (!contact.avatarUrl) {
      runZaloMethod(orgId, msg.accountId, 'getUserInfo', [contactUid]).then(async (res) => {
        const profiles = res?.changed_profiles || res?.profiles || res?.profile_map || {};
        const singleProfile = profiles[contactUid] || profiles[`${contactUid}_0`] || Object.values(profiles)[0];
        if (singleProfile && singleProfile.avatar) {
          await prisma.contact.update({
            where: { id: contact!.id },
            data: { 
              avatarUrl: singleProfile.avatar,
              fullName: singleProfile.zaloName || singleProfile.displayName || singleProfile.name || contact!.fullName
            }
          });
        }
      }).catch(() => {});
    }

    if (!msg.isSelf && msg.senderName && contact.fullName !== msg.senderName) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { fullName: msg.senderName },
      });
    }
  }

  return contact.id;
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  const existing = await prisma.conversation.findFirst({
    where: { zaloAccountId: msg.accountId, externalThreadId },
    select: { id: true, contactId: true },
  });

  if (existing) {
    if (existing.contactId === null && contactId !== null) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { contactId }
      });
    }
    return existing;
  }

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloAccountId: msg.accountId,
      contactId: contactId,
      threadType: msg.threadType,
      externalThreadId,
      lastMessageAt: new Date(msg.timestamp),
      unreadCount: msg.isSelf ? 0 : 1,
      isReplied: msg.isSelf,
    },
    select: { id: true },
  });
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  const unreadCount = await prisma.message.count({
    where: { conversationId, isUnread: true }
  });

  const updateData: any = { 
    lastMessageAt: sentAt,
    unreadCount,
    isReplied: isSelf,
  };

  await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string): Promise<void> {
  try {
    await prisma.message.updateMany({
      where: { zaloMsgId: String(zaloMsgId) },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    logger.info(`[message-handler] Undo message ${zaloMsgId} for account ${accountId}`);
  } catch (err) {
    logger.error('[message-handler] handleMessageUndo error:', err);
  }
}

/**
 * Syncs members of a group conversation to the database for permission routing.
 * Throttled to once per hour per conversation.
 */
export async function syncGroupMembers(accountId: string, conversationId: string, externalGroupId: string, orgId: string, force = false) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastMemberSyncAt: true }
    });

    const dbMemberCount = await prisma.groupMember.count({
      where: { conversationId }
    });

    // Only sync if never synced or last sync was > 1 hour ago
    // Exception: If we only have 2 or fewer members in the database for this group,
    // it was likely a failed/partial sync, so we bypass the throttle.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (!force && dbMemberCount > 2 && conversation?.lastMemberSyncAt && conversation.lastMemberSyncAt > oneHourAgo) {
      return;
    }

    logger.info(`[message-handler] Syncing members for group ${externalGroupId}`);
    
    const cleanGroupId = String(externalGroupId).trim();
    const bigId = /^\d+$/.test(cleanGroupId) ? BigInt(cleanGroupId) : cleanGroupId;
    
    // Fetch group info containing member list
    const groupInfoRes = await runZaloMethod(orgId, accountId, 'getGroupInfo', [bigId]).catch(() => ({}));

    const gridInfoMap = groupInfoRes?.gridInfoMap || {};
    const info = gridInfoMap[cleanGroupId] || gridInfoMap[String(bigId)] || Object.values(gridInfoMap)[0] || {};
    
    // Update group name and avatar if we found it
    if (info.name) {
      const groupContact = await prisma.contact.findFirst({
        where: { zaloUid: externalGroupId, orgId }
      });
      if (groupContact && (groupContact.fullName === 'Nhóm' || groupContact.fullName?.startsWith('Nhóm '))) {
        await prisma.contact.update({
          where: { id: groupContact.id },
          data: { 
            fullName: info.name,
            avatarUrl: info.avatar || info.avt || info.fullAvt || groupContact.avatarUrl
          }
        });
      }
    }

    const discoveredUids = new Set<string>();
    const discoveredProfiles: Record<string, { fullName?: string; avatarUrl?: string }> = {};

    // 1. Process memberIds / memberList / members / memList
    const memberIds = info?.memberIds || info?.member_ids || info?.memberList || info?.members || info?.memList || info?.mem_list || [];
    if (Array.isArray(memberIds)) {
      memberIds.forEach((u: any) => {
        const uid = String(typeof u === 'string' ? u : (u.uid || u.userId || u.id || u.zaloUid));
        if (uid && uid !== 'undefined') {
          discoveredUids.add(uid.replace(/_0$/, ''));
        }
      });
    }

    // 2. Process currentMems profiles (contains id, dName, avatar, etc.)
    const currentMems = info?.currentMems || info?.current_mems || info?.mems || [];
    if (Array.isArray(currentMems)) {
      currentMems.forEach((m: any) => {
        if (!m || typeof m !== 'object') return;
        const uid = String(m.id || m.uid || m.userId || m.zaloUid || '').replace(/_0$/, '');
        if (uid && uid !== 'undefined') {
          discoveredUids.add(uid);
          const fullName = m.dName || m.zaloName || m.displayName || m.name || m.fullName || null;
          const avatarUrl = m.avatar || m.avatar_25 || m.avatarUrl || m.avt || null;
          if (fullName || avatarUrl) {
            discoveredProfiles[uid] = {
              ...(discoveredProfiles[uid] || {}),
              ...(fullName ? { fullName } : {}),
              ...(avatarUrl ? { avatarUrl } : {})
            };
          }
        }
      });
    }

    // 3. Process memVerList / mem_ver_list
    const memVerList = info?.memVerList || info?.mem_ver_list || [];
    if (Array.isArray(memVerList)) {
      memVerList.forEach((u: any) => {
        const uid = String(typeof u === 'string' ? u : (u.uid || u.userId || u.id || u.zaloUid));
        if (uid && uid !== 'undefined') {
          discoveredUids.add(uid.replace(/_0$/, ''));
        }
      });
    }

    // Helper to find any array of strings in an object (potential UID list), skipping admin lists
    const findUidArrays = (obj: any): string[] => {
      if (!obj || typeof obj !== 'object') return [];
      const results: string[] = [];
      for (const key in obj) {
        if (key === 'adminIds' || key === 'admin_ids' || key === 'admins') continue;
        if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'string') {
          results.push(...obj[key]);
        }
      }
      return results;
    };
    const listFromInfo = findUidArrays(info);
    listFromInfo.forEach(u => {
      const uid = String(u).replace(/_0$/, '');
      if (uid && uid !== 'undefined' && /^\d+$/.test(uid)) {
        discoveredUids.add(uid);
      }
    });

    // Filter out the group ID itself from member UIDs
    const uids = Array.from(discoveredUids).filter(uid => uid !== externalGroupId && uid !== cleanGroupId);
    logger.info(`[message-handler] Discovered ${uids.length} unique member UIDs for group ${externalGroupId}`);

    if (uids.length === 0) return;

    // Batch fetch profiles to avoid rate limit throttling and massive delays
    let allProfiles: Record<string, any> = {};
    try {
      logger.info(`[message-handler] Batch fetching profiles for ${uids.length} members in group ${externalGroupId}`);
      
      // Try getGroupMembersInfo first
      const res = await runZaloMethod(orgId, accountId, 'getGroupMembersInfo', [uids]);
      allProfiles = res?.profiles || res?.changed_profiles || res?.profile_map || {};

      // If empty, fall back to getUserInfo
      if (Object.keys(allProfiles).length === 0) {
        logger.info(`[message-handler] getGroupMembersInfo returned empty, falling back to getUserInfo for group ${externalGroupId}`);
        const resUser = await runZaloMethod(orgId, accountId, 'getUserInfo', [uids]);
        allProfiles = resUser?.profiles || resUser?.changed_profiles || resUser?.profile_map || {};
      }
    } catch (err) {
      logger.error(`[message-handler] Batch profile resolution failed for group ${externalGroupId}:`, err);
    }

    const currentContactIds: string[] = [];

    for (const uid of uids) {
      // 1. Ensure contact exists for this member
      let contact = await prisma.contact.findFirst({
        where: { orgId, zaloUid: uid }
      });

      const profile = allProfiles[uid] || allProfiles[`${uid}_0`];
      const localProfile = discoveredProfiles[uid];

      let avatarUrl = profile?.avatar || localProfile?.avatarUrl || null;
      let fullName = profile?.zaloName || profile?.dName || profile?.displayName || profile?.name || localProfile?.fullName || null;

      fullName = fullName || `Zalo User ${uid.slice(-4)}`;

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            id: randomUUID(),
            orgId,
            zaloUid: uid,
            fullName,
            avatarUrl: avatarUrl
          }
        });
      } else {
        const isDefaultAvatar = (url: string | null | undefined) => {
          return !url || url.includes('avatar_default.png') || url.includes('stc-zaloprofile');
        };

        const hasPlaceholderName = contact.fullName?.startsWith('Zalo User');
        const hasRealName = fullName && !fullName.startsWith('Zalo User');

        const needsUpdate = (isDefaultAvatar(contact.avatarUrl) && !isDefaultAvatar(avatarUrl)) ||
                            (hasPlaceholderName && hasRealName);

        if (needsUpdate) {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              avatarUrl: isDefaultAvatar(contact.avatarUrl) ? (avatarUrl || contact.avatarUrl) : contact.avatarUrl,
              fullName: hasPlaceholderName ? (fullName || contact.fullName) : contact.fullName
            }
          });
        }
      }

      // 2. Link member to group
      await prisma.groupMember.upsert({
        where: { conversationId_contactId: { conversationId, contactId: contact.id } },
        create: { conversationId, contactId: contact.id },
        update: {}
      });

      currentContactIds.push(contact.id);
    }

    // 3. Clean up: Delete any group members that are no longer in the group
    if (currentContactIds.length > 0) {
      await prisma.groupMember.deleteMany({
        where: {
          conversationId,
          contactId: { notIn: currentContactIds }
        }
      });
    }

    // Update sync timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMemberSyncAt: new Date() }
    });

    logger.info(`[message-handler] Synced ${uids.length} members for group ${externalGroupId}`);
  } catch (err) {
    logger.error(`[message-handler] syncGroupMembers error for group ${externalGroupId}:`, err);
  }
}

import type { Server } from 'socket.io';

export async function emitSecureMessage(io: Server | null, result: HandleMessageResult) {
  if (!io) return;
  try {
    const { message, conversationId, orgId, contactId } = result;

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;

    const account = await prisma.zaloAccount.findUnique({
      where: { id: conversation.zaloAccountId },
      include: { teams: true, access: true }
    });

    if (!account) return;

    const contact = contactId ? await prisma.contact.findUnique({
      where: { id: contactId },
      include: { assignedUser: true }
    }) : null;

    const orgUsers = await prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, role: true, teamId: true }
    });

    const accountTeams = account.teams.map((t: any) => t.teamId);
    const accountExplicitUsers = account.access.map((a: any) => a.userId);
    const isAccountPublic = accountTeams.length === 0;

    const activeSessions = await prisma.supportSession.findMany({
      where: { conversationId, status: 'active' },
      select: { sharedWithUserId: true }
    });
    const sessionUserIds = activeSessions.map((s: any) => s.sharedWithUserId);

    const targetUserIds = orgUsers.filter((u: any) => {
      if (u.role === 'admin' || u.role === 'owner') return true;
      if (sessionUserIds.includes(u.id)) return true; // Bypass for active support sessions

      // 1. Zalo Account Access
      const hasAccountAccess = isAccountPublic || accountExplicitUsers.includes(u.id) || (u.teamId && accountTeams.includes(u.teamId));
      if (!hasAccountAccess) return false;

      // 2. Conversation Access
      if (!contact || contact.assignedUserId === null) return true; // Unassigned
      if (contact.assignedUserId === u.id) return true; // Assigned to me
      if (u.role === 'leader' && u.teamId === contact.assignedUser?.teamId) return true; // Leader can see their team's contacts
      
      return false;
    });

    for (const u of targetUserIds) {
      io.to(`user:${u.id}`).emit('chat:message', {
        accountId: account.id,
        message,
        conversationId,
      });
    }
  } catch (err) {
    logger.error('[message-handler] emitSecureMessage error:', err);
  }
}
