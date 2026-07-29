import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
    const user = request.user as { id: string; sessionId?: string };

    if (user && user.sessionId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { currentSessionId: true, isActive: true }
      });
      if (!dbUser || !dbUser.isActive || (dbUser.currentSessionId && dbUser.currentSessionId !== user.sessionId)) {
        return reply.status(401).send({ error: 'Tài khoản đã đăng nhập từ một thiết bị khác.' });
      }
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
