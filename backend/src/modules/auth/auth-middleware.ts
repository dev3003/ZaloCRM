import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
    const user = request.user as { id: string; role?: string; orgId?: string; sessionId?: string };

    if (user) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          orgId: true,
          currentSessionId: true,
          isActive: true,
          org: { select: { status: true } }
        }
      });

      if (!dbUser || !dbUser.isActive) {
        return reply.status(401).send({ error: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.' });
      }

      // Check single session enforcement
      if (user.sessionId && dbUser.currentSessionId && dbUser.currentSessionId !== user.sessionId) {
        return reply.status(401).send({ error: 'Tài khoản đã được đăng nhập từ một thiết bị khác.' });
      }

      // Check organization suspended status for non-superadmin users
      if (dbUser.role !== 'superadmin' && dbUser.org && dbUser.org.status === 'suspended') {
        return reply.status(403).send({ error: 'Tài khoản Tổ chức của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên hệ thống.' });
      }
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function superAdminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authMiddleware(request, reply);
  if (reply.sent) return;

  const user = request.user as { id: string; role?: string };
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true }
  });

  if (!dbUser || dbUser.role !== 'superadmin') {
    return reply.status(403).send({ error: 'Quyền truy cập bị từ chối. Chỉ dành cho Super Admin.' });
  }
}
