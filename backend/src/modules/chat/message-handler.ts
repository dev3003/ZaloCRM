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

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  groupName?: string;       // group name if group message
  attachments?: any[];
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
          ...(msg.contentType === 'text' 
            ? { contentType: 'text', content: msg.content } 
            : { contentType: { not: 'text' } }
          ),
          sentAt: { gte: thirtySecondsAgo }
        },
        orderBy: { sentAt: 'asc' } // Oldest first to match in order
      });

      if (recentManualMsg) {
        const updated = await prisma.message.update({
          where: { id: recentManualMsg.id },
          data: { zaloMsgId: msg.msgId || null }
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
        senderType: msg.isSelf ? 'self' : 'contact',
        senderUid: msg.senderUid,
        senderName: msg.senderName || null,
        content: msg.content || '',
        contentType: msg.contentType || 'text',
        attachments: msg.attachments ?? [],
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

  // User messages: self messages don't create a contact
  if (msg.isSelf) return null;

  let contact = await prisma.contact.findFirst({
    where: { zaloUid: msg.senderUid, orgId },
    select: { id: true, fullName: true },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: msg.senderUid,
        fullName: msg.senderName || 'Unknown',
      },
      select: { id: true, fullName: true },
    });
    // Emit webhook for new contact created
    emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
  } else if (msg.senderName && contact.fullName !== msg.senderName) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { fullName: msg.senderName },
    });
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
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloAccountId: msg.accountId,
      contactId: msg.threadType === 'user' ? contactId : contactId,
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

    // Only sync if never synced or last sync was > 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (!force && conversation?.lastMemberSyncAt && conversation.lastMemberSyncAt > oneHourAgo) {
      return;
    }

    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) return;

    logger.info(`[message-handler] Syncing members for group ${externalGroupId}`);
    
    const cleanGroupId = String(externalGroupId).trim();
    const bigId = /^\d+$/.test(cleanGroupId) ? BigInt(cleanGroupId) : cleanGroupId;
    
    // Try all possible ways to get members to bypass various library response schemas
    const [membersInfoRes, membersRes, groupInfoRes] = await Promise.all([
      instance.api.getGroupMembersInfo(bigId).catch(() => ({})),
      instance.api.getGroupMembers ? instance.api.getGroupMembers(bigId).catch(() => ([])) : Promise.resolve([]),
      instance.api.getGroupInfo(bigId).catch(() => ({}))
    ]);

    const gridInfoMap = groupInfoRes?.gridInfoMap || {};
    const info = gridInfoMap[cleanGroupId] || gridInfoMap[String(bigId)] || Object.values(gridInfoMap)[0] || {};
    
    const discoveredUids = new Set<string>();

    // 1. Process getGroupMembersInfo profiles
    const rawProfiles = membersInfoRes?.profiles || membersInfoRes?.changed_profiles || membersInfoRes?.profile_map || (typeof membersInfoRes === 'object' && !Array.isArray(membersInfoRes) ? membersInfoRes : null);
    if (rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles)) {
      Object.keys(rawProfiles).forEach(uid => discoveredUids.add(uid.replace(/_0$/, '')));
    }

    // 2. Process getGroupMembers response
    if (Array.isArray(membersRes)) {
      membersRes.forEach(u => discoveredUids.add(String(u).replace(/_0$/, '')));
    } else if (membersRes?.members) {
      membersRes.members.forEach((u: any) => discoveredUids.add(String(u).replace(/_0$/, '')));
    }

    // 3. Process memList from getGroupInfo
    const memList = info?.memList || info?.mem_list || info?.memberList || info?.members || [];
    memList.forEach((u: any) => {
      const uid = String(typeof u === 'string' ? u : (u.uid || u.userId || u.id));
      discoveredUids.add(uid.replace(/_0$/, ''));
    });

    // Helper to find any array of strings in an object (potential UID list)
    const findUidArray = (obj: any): string[] => {
      if (!obj || typeof obj !== 'object') return [];
      for (const key in obj) {
        if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'string') {
          return obj[key];
        }
      }
      return [];
    };
    const listFromInfo = findUidArray(info);
    listFromInfo.forEach(u => discoveredUids.add(String(u).replace(/_0$/, '')));

    const uids = Array.from(discoveredUids);
    logger.info(`[message-handler] Discovered ${uids.length} unique UIDs for group ${externalGroupId}`);

    if (uids.length === 0) return;

    for (const uid of uids) {
      // 1. Ensure contact exists for this member
      let contact = await prisma.contact.findFirst({
        where: { orgId, zaloUid: uid }
      });

      const profile = rawProfiles ? (rawProfiles[uid] || rawProfiles[`${uid}_0`]) : null;
      let avatarUrl = profile?.avatar || null;
      let fullName = profile?.zaloName || profile?.dName || null;

      // If profile is missing avatar or name, we query getUserInfo to resolve it!
      if (!avatarUrl || !fullName) {
        try {
          const res = await instance.api.getUserInfo(uid);
          const profiles = res?.changed_profiles || res?.profiles || res?.profile_map || {};
          const singleProfile = profiles[uid] || profiles[`${uid}_0`] || Object.values(profiles)[0];
          if (singleProfile) {
            avatarUrl = avatarUrl || singleProfile.avatar || singleProfile.avatar_url || null;
            fullName = fullName || singleProfile.zaloName || singleProfile.zalo_name || singleProfile.displayName || singleProfile.dName || singleProfile.name || null;
          }
        } catch (e) {
          // Ignore resolution errors for individual members
        }
      }

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
        update: {} // No update needed for now
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
