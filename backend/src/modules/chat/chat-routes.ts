/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { emitSecureMessage, syncGroupMembers, runZaloMethod } from './message-handler.js';
import { getSafeLinkPreview } from './link-preview-helper.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMessageToAgent } from '../agent/agent-socket.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '', unreadOnly = 'false', tag = '' } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (accountId) where.zaloAccountId = accountId;
    if (unreadOnly === 'true') where.unreadCount = { gt: 0 };
    if (search) {
      where.contact = {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }
    if (tag) {
      if (!where.contact) where.contact = {};
      where.contact.tags = { array_contains: tag };
    }

    // Members and Leaders can only see conversations from Zalo accounts they have access to
    if (user.role === 'member' || user.role === 'leader') {
      where.AND = [
        {
          OR: [
            // A. Normal Access Rules
            {
              AND: [
                // 1. Must have access to Zalo Account (via Team, Explicit, or Public)
                {
                  zaloAccount: {
                    OR: [
                      { access: { some: { userId: user.id } } },
                      { teams: { none: {} } },
                      ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
                    ]
                  }
                },
                // 2. Must have access to Conversation
                {
                  OR: [
                    // User chats
                    {
                      threadType: 'user',
                      OR: [
                        { contact: { assignedUserId: user.id } }, // a. My contact
                        { contact: { assignedUserId: null } },    // b. Unassigned contact
                        // c. If leader, can see all contacts assigned to their team
                        ...(user.role === 'leader' && user.teamId ? [{ contact: { assignedUser: { teamId: user.teamId } } }] : [])
                      ]
                    },
                    // Group chats
                    {
                      threadType: 'group',
                      OR: [
                        { members: { some: { contact: { assignedUserId: user.id } } } },
                        { members: { none: { contact: { assignedUserId: { not: null } } } } },
                        ...(user.role === 'leader' && user.teamId ? [{ members: { some: { contact: { assignedUser: { teamId: user.teamId } } } } }] : [])
                      ]
                    }
                  ]
                }
              ]
            },
            // B. Access via Support Session
            {
              supportSessions: {
                some: {
                  sharedWithUserId: user.id,
                  status: 'active'
                }
              }
            }
          ]
        }
      ];

      if (accountId) {
        where.AND.push({ zaloAccountId: accountId });
      }
    } else if (accountId) {
      where.zaloAccountId = accountId;
    }

    const [conversations, total, totalUnreadThreads] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true, assignedUserId: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
          supportSessions: {
            where: { status: 'active' },
            take: 1,
            select: { id: true, sharedByUserId: true, sharedWithUserId: true, expiresAt: true }
          }
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.conversation.count({ where }),
      prisma.conversation.count({
        where: {
          ...where,
          unreadCount: { gt: 0 }
        }
      }),
    ]);

    return { conversations, total, totalUnreadThreads, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
        supportSessions: {
          where: { status: 'active' },
          take: 1,
          select: { id: true, sharedByUserId: true, sharedWithUserId: true, expiresAt: true }
        }
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50', cursor } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const activeSession = await prisma.supportSession.findFirst({
      where: {
        conversationId: id,
        sharedWithUserId: user.id,
        status: 'active',
        orgId: user.orgId
      },
      select: { createdAt: true, allowedMessages: { select: { messageId: true } } }
    });

    const baseWhere: any = { conversationId: id };

    if (activeSession) {
      const allowedMsgIds = activeSession.allowedMessages.map(am => am.messageId);
      baseWhere.OR = [
        { sentAt: { gte: activeSession.createdAt } },
        { id: { in: allowedMsgIds } }
      ];
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: baseWhere,
        orderBy: { sentAt: 'desc' },
        take: parseInt(limit),
        ...(cursor
          ? { cursor: { id: cursor }, skip: 1 }
          : { skip: (parseInt(page) - 1) * parseInt(limit) }
        )
      }),
      prisma.message.count({ where: baseWhere }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content, contentType = 'text', mentions, quote, extraPayload } = request.body as { content: string; contentType?: string; mentions?: any[]; quote?: any; extraPayload?: any };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const messageId = randomUUID();

      // Check if this org uses Desktop Agent
      const activeAgent = await prisma.zaloDesktopAgent.findFirst({
        where: { orgId: user.orgId, status: 'active' }
      });

      if (contentType === 'sticker' && extraPayload) {
        if (activeAgent) {
          sendMessageToAgent(user.orgId, 'send-message', {
            action: 'sendSticker',
            messageId,
            accountId: conversation.zaloAccountId,
            threadId,
            threadType,
            sticker: {
              ...extraPayload,
              id: Number(extraPayload.id) || 0,
              cateId: Number(extraPayload.cateId) || 0,
              type: Number(extraPayload.type) || 1,
            },
            type: threadType,
          });
        } else {
          const instance = zaloPool.getInstance(conversation.zaloAccountId);
          if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

          const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
          if (!limits.allowed) {
            return reply.status(429).send({ error: limits.reason });
          }

          let stickerToSend = { ...extraPayload };
          if (stickerToSend.id && instance.api.getStickersDetail) {
            try {
              const details = await instance.api.getStickersDetail(Number(stickerToSend.id));
              if (details && details.length > 0) {
                const item = details[0]?.data || details[0];
                if (item && item.cateId !== undefined) stickerToSend.cateId = Number(item.cateId);
                if (item && item.type !== undefined) stickerToSend.type = Number(item.type);
              }
            } catch (e) {}
          }
          await instance.api.sendSticker(stickerToSend, threadId, threadType);
        }
      } else {
        if (activeAgent) {
          sendMessageToAgent(user.orgId, 'send-message', {
            messageId,
            accountId: conversation.zaloAccountId,
            threadId,
            threadType,
            content,
            mentions,
            quote,
            type: threadType,
          });
        } else {
          const instance = zaloPool.getInstance(conversation.zaloAccountId);
          if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

          const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
          if (!limits.allowed) {
            return reply.status(429).send({ error: limits.reason });
          }

          zaloRateLimiter.recordSend(conversation.zaloAccountId);
          const sendPayload: any = { msg: content };
          if (mentions && Array.isArray(mentions) && mentions.length > 0) {
            sendPayload.mentions = mentions;
          }
          if (quote) {
            sendPayload.quote = quote;
          }
          await instance.api.sendMessage(sendPayload, threadId, threadType);
        }
      }

      const message = await prisma.message.create({
        data: {
          id: messageId,
          conversationId: id,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content,
          contentType: contentType,
          sentAt: new Date(),
          repliedByUserId: user.id,
          quote: quote || undefined,
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      await emitSecureMessage(io, {
        message: message as any,
        conversationId: id,
        orgId: user.orgId,
        contactId: conversation.contactId
      });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.$transaction([
      prisma.message.updateMany({
        where: { conversationId: id, conversation: { orgId: user.orgId } },
        data: { isUnread: false }
      }),
      prisma.conversation.updateMany({
        where: { id, orgId: user.orgId },
        data: { unreadCount: 0 }
      })
    ]);

    return { success: true };
  });

  app.post('/api/v1/conversations/:id/mark-unread', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    // Mark last message as unread as fallback
    const lastMsg = await prisma.message.findFirst({
      where: { conversationId: id, senderType: 'contact' },
      orderBy: { sentAt: 'desc' },
      select: { id: true }
    });

    if (lastMsg) {
      await prisma.message.update({
        where: { id: lastMsg.id },
        data: { isUnread: true }
      });
    }

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 1 },
    });

    return { success: true };
  });

  // ── Mark individual message as unread ────────────────────────────────────
  app.post('/api/v1/messages/:id/mark-unread', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const message = await prisma.message.findFirst({
      where: { id, conversation: { orgId: user.orgId } },
      select: { conversationId: true }
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    await prisma.message.update({
      where: { id },
      data: { isUnread: true }
    });

    const unreadCount = await prisma.message.count({
      where: { conversationId: message.conversationId, isUnread: true }
    });

    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { unreadCount }
    });

    return { success: true, unreadCount };
  });

  // ── Mark individual message as read ──────────────────────────────────────
  app.post('/api/v1/messages/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const message = await prisma.message.findFirst({
      where: { id, conversation: { orgId: user.orgId } },
      select: { conversationId: true }
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    await prisma.message.update({
      where: { id },
      data: { isUnread: false }
    });

    const unreadCount = await prisma.message.count({
      where: { conversationId: message.conversationId, isUnread: true }
    });

    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { unreadCount }
    });

    return { success: true, unreadCount };
  });

  // ── Ensure direct conversation by zaloUid ────────────────────────────────
  app.post('/api/v1/conversations/ensure-direct', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { zaloUid, zaloAccountId } = request.body as { zaloUid: string, zaloAccountId: string };

    if (!zaloUid || !zaloAccountId) return reply.status(400).send({ error: 'zaloUid and zaloAccountId are required' });

    // 1. Check if conversation already exists
    let conversation = await prisma.conversation.findFirst({
      where: {
        orgId: user.orgId,
        zaloAccountId,
        threadType: 'user',
        contact: { zaloUid }
      },
      select: { id: true }
    });

    if (conversation) return conversation;

    // 2. If not, we might need to create a contact first
    let contact = await prisma.contact.findFirst({
      where: { orgId: user.orgId, zaloUid }
    });

    if (!contact) {
      // Create a skeleton contact from group member info
      contact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          zaloUid,
          fullName: `Zalo User ${zaloUid.slice(-4)}`, // Placeholder name
          status: 'new',
          source: 'zalo_group_member'
        }
      });
    }

    // 3. Create conversation
    conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        orgId: user.orgId,
        zaloAccountId,
        contactId: contact.id,
        threadType: 'user',
        externalThreadId: zaloUid,
        lastMessageAt: new Date(),
      }
    });

    return conversation;
  });

  // ── List members for a group conversation ──────────────────────────────
  app.get('/api/v1/conversations/:id/members', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, threadType: true, zaloAccountId: true, externalThreadId: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    if (conversation.threadType !== 'group') {
      return { members: [] };
    }

    // Fetch members from database
    let dbMembers = await prisma.groupMember.findMany({
      where: { conversationId: id },
      include: {
        contact: true
      }
    });

    // If no members or <= 2 members are stored yet, try a force sync
    if (dbMembers.length <= 2 && conversation.zaloAccountId && conversation.externalThreadId) {
      await syncGroupMembers(
        conversation.zaloAccountId,
        conversation.id,
        conversation.externalThreadId,
        user.orgId,
        true // force sync bypassing 1-hour throttle
      );

      // Re-fetch after syncing
      dbMembers = await prisma.groupMember.findMany({
        where: { conversationId: id },
        include: {
          contact: true
        }
      });
    } else if (conversation.zaloAccountId && conversation.externalThreadId) {
      // Otherwise, trigger a background refresh (throttled to 1 hour to prevent API overload)
      syncGroupMembers(
        conversation.zaloAccountId,
        conversation.id,
        conversation.externalThreadId,
        user.orgId,
        false // throttled
      ).catch(err => logger.error(`[chat-routes] Background syncGroupMembers failed:`, err));
    }

    const members = dbMembers.map(m => ({
      id: m.contact.id,
      uid: m.contact.zaloUid,
      userId: m.contact.zaloUid,
      fullName: m.contact.fullName,
      displayName: m.contact.fullName,
      avatar: m.contact.avatarUrl,
      avatarUrl: m.contact.avatarUrl,
      assignedUserId: m.contact.assignedUserId
    }));

    return { members };
  });

  app.post('/api/v1/conversations/:id/messages/:msgId/reaction', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, msgId } = request.params as { id: string, msgId: string };
    const { icon } = request.body as { icon: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const messageRecord = await prisma.message.findUnique({
      where: { id: msgId }
    });
    if (!messageRecord || !messageRecord.zaloMsgId) {
      return reply.status(400).send({ error: 'Cannot react to a message without Zalo ID' });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      // Map DB contentType back to Zalo's msgType
      let zaloMsgType = 1; // default to text
      switch (messageRecord.contentType) {
        case 'image': zaloMsgType = 2; break;
        case 'video': zaloMsgType = 3; break;
        case 'file': zaloMsgType = 6; break;
        case 'link': zaloMsgType = 5; break;
        case 'sticker': zaloMsgType = 7; break;
      }

      // Check if this org uses Desktop Agent
      const activeAgent = await prisma.zaloDesktopAgent.findFirst({
        where: { orgId: user.orgId, status: 'active' }
      });

      if (activeAgent) {
        logger.info(`[chat-routes] Sending reaction to agent for msgId ${msgId}, zaloMsgId: ${messageRecord.zaloMsgId}`);
        sendMessageToAgent(user.orgId, 'send-message', {
          action: 'react',
          messageId: randomUUID(),
          accountId: conversation.zaloAccountId,
          threadId,
          threadType,
          icon,
          msgId: messageRecord.zaloMsgId,
          cliMsgId: (messageRecord as any).cliMsgId || messageRecord.zaloMsgId,
          msgType: zaloMsgType
        });
      } else {
        const instance = zaloPool.getInstance(conversation.zaloAccountId);
        if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

        await instance.api.addReaction(icon as any, {
          data: {
            msgId: messageRecord.zaloMsgId,
            cliMsgId: (messageRecord as any).cliMsgId || messageRecord.zaloMsgId, // Fallback to zaloMsgId for old messages
            msgType: zaloMsgType
          },
          threadId,
          type: threadType,
        } as any);
      }

      await prisma.message.update({
        where: { id: msgId },
        data: { reaction: icon }
      });

      return { success: true };
    } catch (err) {
      logger.error('[chat] Send reaction error:', err);
      return reply.status(500).send({ error: 'Failed to send reaction' });
    }
  });

  // ── Undo (Recall) message ──────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages/:msgId/undo', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, msgId } = request.params as { id: string, msgId: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const messageRecord = await prisma.message.findUnique({
      where: { id: msgId }
    });
    if (!messageRecord || !messageRecord.zaloMsgId) {
      return reply.status(400).send({ error: 'Cannot undo a message without Zalo ID' });
    }

    if (messageRecord.repliedByUserId !== user.id) {
      return reply.status(403).send({ error: 'Only the sender can undo this message' });
    }

    // Limit undo to 24 hours (86400000 ms) like Zalo
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(messageRecord.sentAt).getTime() > ONE_DAY_MS) {
      return reply.status(403).send({ error: 'Cannot undo a message that was sent more than 24 hours ago' });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      // Check if this org uses Desktop Agent
      const activeAgent = await prisma.zaloDesktopAgent.findFirst({
        where: { orgId: user.orgId, status: 'active' }
      });

      const cliMsgId = (messageRecord as any).cliMsgId || messageRecord.zaloMsgId;

      if (activeAgent) {
        logger.info(`[chat-routes] Sending undo to agent for msgId ${msgId}, zaloMsgId: ${messageRecord.zaloMsgId}`);
        sendMessageToAgent(user.orgId, 'send-message', {
          action: 'undo',
          messageId: randomUUID(),
          accountId: conversation.zaloAccountId,
          threadId,
          threadType,
          msgId: messageRecord.zaloMsgId,
          cliMsgId: cliMsgId,
        });
      } else {
        const instance = zaloPool.getInstance(conversation.zaloAccountId);
        if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

        await instance.api.undo({
          msgId: messageRecord.zaloMsgId,
          cliMsgId: cliMsgId,
        }, threadId, threadType);
      }

      await prisma.message.update({
        where: { id: msgId },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      const io = (app as any).io as Server;
      if (io) {
        // Emit to all users in the org that have access (simple broadcast to org since it's a delete event)
        // Or we can use emitSecureMessage but that requires building the whole message object. 
        // We'll just emit 'chat:deleted' to the org rooms or user rooms.
        // Based on use-chat.ts, it listens for `chat:deleted` with `data: { msgId: string }` where msgId is zaloMsgId
        io.to(`org:${user.orgId}`).emit('chat:deleted', { msgId: messageRecord.zaloMsgId });
      }

      return { success: true };
    } catch (err) {
      logger.error('[chat] Undo message error:', err);
      return reply.status(500).send({ error: 'Failed to undo message' });
    }
  });

  // ── Get Safe Link Preview ──────────────────────────────────────────────────
  app.get('/api/v1/chat/link-preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as QueryParams;
    if (!url) {
      return reply.status(400).send({ error: 'URL query parameter is required' });
    }

    const result = await getSafeLinkPreview(url);
    if (!result) {
      return reply.status(400).send({ error: 'Failed to retrieve link preview or link not allowed' });
    }

    return result;
  });

}
