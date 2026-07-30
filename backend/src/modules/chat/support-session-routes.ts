import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import type { Server } from 'socket.io';

export async function supportSessionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── Create Support Session ──────────────────────────────────────────────
  app.post('/api/v1/support-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { conversationId, selectedMessageIds, targetUserId, durationHours } = request.body as {
      conversationId: string;
      selectedMessageIds: string[];
      targetUserId: string;
      durationHours: number;
    };

    if (!conversationId || !targetUserId || !durationHours) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    if (![1, 5, 10, 24, 48].includes(durationHours)) {
      return reply.status(400).send({ error: 'Invalid duration' });
    }

    // Verify conversation belongs to org
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId: user.orgId },
    });
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Verify target user belongs to org
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, orgId: user.orgId },
    });
    if (!targetUser) {
      return reply.status(404).send({ error: 'Target user not found' });
    }

    // Verify message IDs belong to conversation (if any)
    if (selectedMessageIds && selectedMessageIds.length > 0) {
      const messagesCount = await prisma.message.count({
        where: {
          id: { in: selectedMessageIds },
          conversationId,
        },
      });
      if (messagesCount !== selectedMessageIds.length) {
        return reply.status(400).send({ error: 'Some messages are invalid or do not belong to this conversation' });
      }
    }

    try {
      const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

      // Close any existing active sessions for this conversation and user
      await prisma.supportSession.updateMany({
        where: {
          conversationId,
          sharedWithUserId: targetUserId,
          status: 'active'
        },
        data: { status: 'closed' }
      });

      const session = await prisma.supportSession.create({
        data: {
          orgId: user.orgId,
          conversationId,
          sharedByUserId: user.id,
          sharedWithUserId: targetUserId,
          status: 'active',
          expiresAt,
          allowedMessages: {
            create: (selectedMessageIds || []).map((msgId) => ({
              messageId: msgId,
            }))
          }
        },
        include: {
          sharedWithUser: { select: { id: true, fullName: true } }
        }
      });

      // Emit to technical user so they see it instantly
      const io = (app as any).io as Server;
      if (io) {
        io.to(`user:${targetUserId}`).emit('support_session:created', {
          sessionId: session.id,
          conversationId,
        });
      }

      return { success: true, session };
    } catch (err) {
      logger.error('[support-session] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create support session' });
    }
  });

  // ── Close Support Session Early ─────────────────────────────────────────
  app.put('/api/v1/support-sessions/:id/close', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const session = await prisma.supportSession.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Only creator or org admin can close
    if (session.sharedByUserId !== user.id && user.role !== 'admin' && user.role !== 'owner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await prisma.supportSession.update({
      where: { id },
      data: { status: 'closed' },
    });

    const io = (app as any).io as Server;
    if (io) {
      io.to(`user:${session.sharedWithUserId}`).emit('support_session:closed', {
        sessionId: id,
        conversationId: session.conversationId,
      });
      io.to(`user:${session.sharedByUserId}`).emit('support_session:closed', {
        sessionId: id,
        conversationId: session.conversationId,
      });
    }

    return { success: true };
  });
}
