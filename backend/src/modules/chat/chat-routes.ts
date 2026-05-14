/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '', unreadOnly = 'false' } = request.query as QueryParams;

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

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      const accountIds = accessibleAccounts.map((a) => a.zaloAccountId);
      where.zaloAccountId = accountId ? { equals: accountId } : { in: accountIds };
    }

    const [conversations, total, totalUnreadThreads] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.conversation.count({ where }),
      prisma.conversation.count({ 
        where: { 
          orgId: user.orgId, 
          unreadCount: { gt: 0 },
          ...(where.zaloAccountId ? { zaloAccountId: where.zaloAccountId } : {})
        } 
      }),
    ]);

    return { conversations, total, totalUnreadThreads, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      await instance.api.sendMessage({ msg: content }, threadId, threadType);

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content,
          contentType: 'text',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

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
}
