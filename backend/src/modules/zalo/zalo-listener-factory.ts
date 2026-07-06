/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, handleMessageUndo, emitSecureMessage } from '../chat/message-handler.js';
import { detectContentType, updateContactAvatar } from './zalo-message-helpers.js';

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar from API with a per-pool in-memory cache
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar };
  }

  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const entry: UserInfoCacheEntry = {
        zaloName:
          profile.zaloName ||
          profile.zalo_name ||
          profile.displayName ||
          profile.display_name ||
          '',
        avatar: profile.avatar || '',
        phone: profile.phoneNumber || '',
        cachedAt: Date.now(),
      };
      cache.set(uid, entry);
      return { zaloName: entry.zaloName, avatar: entry.avatar };
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }
  return { zaloName: '', avatar: '' };
}

// Fetch group display name from the zca-js API
async function resolveGroupName(api: any, groupId: string): Promise<string> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    return info?.name || '';
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return '';
  }
}

export interface ListenerContext {
  accountId: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose at the end.
 */
export function attachZaloListener(ctx: ListenerContext): void {
  const { accountId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
  });

  listener.on('message', async (message: any) => {
    try {
      // ThreadType in zca-js: 0 = User, 1 = Group
      const isGroup = message.type === 1;
      const senderUid = String(message.data?.uidFrom || '');
      const receiverUid = String(message.data?.idTo || message.data?.uidTo || '');

      let threadId = message.threadId;
      if (!threadId) {
        if (isGroup) {
          threadId = message.data?.groupId || '';
        } else {
          threadId = message.isSelf ? receiverUid : senderUid;
        }
      }
      threadId = String(threadId || '');

      // Resolve display name — prefer zaloName from API over dName
      let senderName: string = message.data?.dName || '';
      if (!message.isSelf && senderUid && api.getUserInfo) {
        const userInfo = await resolveZaloName(api, senderUid, userInfoCache);
        if (userInfo.zaloName) senderName = userInfo.zaloName;
        if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar);
      }

      // Resolve group name for group threads
      let groupName: string | undefined;
      if (isGroup && message.threadId) {
        groupName = await resolveGroupName(api, message.threadId);
      }

      const rawContent = message.data?.content;
      const content =
        typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
      const contentType = detectContentType(message.data?.msgType, rawContent);

      let formattedQuote = undefined;
      if (message.data?.quote) {
        const q = message.data.quote;
        formattedQuote = {
          uidFrom: q.ownerId || '',
          senderName: q.fromD || '',
          content: q.msg || q.attach || 'Đính kèm',
          cliMsgId: String(q.cliMsgId || ''),
          msgId: String(q.globalMsgId || ''),
          ts: String(q.ts || ''),
        };
      }

      const result = await handleIncomingMessage({
        accountId,
        senderUid,
        senderName,
        content,
        contentType,
        msgId: String(message.data?.msgId || ''),
        cliMsgId: String(message.data?.cliMsgId || message.cliMsgId || ''),
        timestamp: parseInt(message.data?.ts || String(Date.now())),
        isSelf: message.isSelf || false,
        threadId,
        threadType: isGroup ? 'group' : 'user',
        groupName,
        attachments: [],
        quote: formattedQuote,
      });

      if (result) {
        // Emit securely via the helper in message-handler to only authorized users
        await emitSecureMessage(io, result);
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  listener.on('reaction', async (reactionObj: any) => {
    try {
      const data = reactionObj.data;
      const rMsg = data.content?.rMsg?.[0];
      if (!rMsg || !rMsg.gMsgID) return;

      const gMsgID = String(rMsg.gMsgID);
      const icon = data.content.rIcon;

      const message = await prisma.message.findFirst({
        where: { zaloMsgId: gMsgID }
      });

      if (message) {
        await prisma.message.update({
          where: { id: message.id },
          data: { reaction: icon }
        });

        // Broadcast to clients via io
        if (io) {
          const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId } });
          if (conversation) {
            const targetUsers = await prisma.user.findMany({
              where: { orgId: conversation.orgId, isActive: true },
              select: { id: true }
            });
            for (const u of targetUsers) {
              io.to(`user:${u.id}`).emit('chat:reaction', {
                msgId: message.id,
                icon
              });
            }
          }
        }
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Reaction handler error:`, err);
    }
  });

  listener.on('undo', async (data: any) => {
    const msgId = data.data?.msgId || data.msgId;
    if (msgId) {
      await handleMessageUndo(accountId, String(msgId));
      io?.emit('chat:deleted', { accountId, msgId: String(msgId) });
    }
  });

  listener.on('friend_event', async (data: any) => {
    try {
      logger.info(`[zalo:${accountId}] Friend event detected - Type: ${data.type}`, data);
      
      // We use emit to broadcast to all connected clients
      if (io) {
        io.emit('zalo:friend-event', {
          accountId,
          type: data.type,
          fromUid: data.data?.fromUid || data.data,
          data: data.data,
          isSelf: data.isSelf || false
        });
        logger.info(`[zalo:${accountId}] Emitted friend event to socket`);
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Friend event error:`, err);
    }
  });

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    io?.emit('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
}
