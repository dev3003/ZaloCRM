/**
 * Zalo account access control routes — manage per-user permissions on Zalo accounts.
 * Permission levels: read (view messages), chat (send messages), admin (manage account).
 * All write operations require owner/admin role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

const VALID_PERMISSIONS = ['read', 'chat', 'admin'] as const;
type Permission = (typeof VALID_PERMISSIONS)[number];

export async function zaloAccessRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts/:id/access — list users with access to this account
  app.get('/api/v1/zalo-accounts/:id/access', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

    const accessList = await prisma.zaloAccountAccess.findMany({
      where: { zaloAccountId: id },
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return { access: accessList };
  });

  // POST /api/v1/zalo-accounts/:id/access — grant access { userId, permission }
  app.post(
    '/api/v1/zalo-accounts/:id/access',
    { preHandler: requireRole('owner', 'admin', 'manager', 'leader') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { userId, permission = 'read' } = request.body as { userId: string; permission?: string };

      if (!userId) return reply.status(400).send({ error: 'userId là bắt buộc' });
      if (!VALID_PERMISSIONS.includes(permission as Permission)) {
        return reply.status(400).send({ error: 'permission phải là read, chat hoặc admin' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const targetUser = await prisma.user.findFirst({ where: { id: userId, orgId: user.orgId } });
      if (!targetUser) return reply.status(404).send({ error: 'User not found in org' });

      if (['leader', 'manager'].includes(user.role)) {
        if (permission === 'admin') {
          return reply.status(403).send({ error: 'Leader/Manager không được phép cấp quyền admin Zalo' });
        }
        
        const isManagedAccount = await prisma.zaloAccountTeam.findFirst({
          where: {
            zaloAccountId: id,
            team: { OR: [{ leaderId: user.id }, { managerId: user.id }] }
          }
        });
        if (!isManagedAccount) {
          return reply.status(403).send({ error: 'Chỉ được phép phân quyền cho số Zalo thuộc nhóm bạn quản lý' });
        }

        const managedTeams = await prisma.team.findMany({
          where: { orgId: user.orgId, OR: [{ leaderId: user.id }, { managerId: user.id }] },
          select: { id: true }
        });
        const managedTeamIds = managedTeams.map(t => t.id);
        if (!targetUser.teamId || !managedTeamIds.includes(targetUser.teamId)) {
          return reply.status(403).send({ error: 'Chỉ được cấp quyền Zalo cho nhân sự do bạn quản lý' });
        }
      }

      try {
        const access = await prisma.zaloAccountAccess.create({
          data: { id: randomUUID(), zaloAccountId: id, userId, permission },
          include: { user: { select: { id: true, fullName: true, email: true } } },
        });
        logger.info(`Zalo access granted: ${targetUser.email} → account ${id} (${permission}) by ${user.email}`);
        return reply.status(201).send(access);
      } catch {
        // Unique constraint violation — access already exists
        return reply.status(409).send({ error: 'User đã có quyền truy cập tài khoản này' });
      }
    },
  );

  // POST /api/v1/zalo-accounts/:id/access/:accessId — update permission
  app.post(
    '/api/v1/zalo-accounts/:id/access/:accessId',
    { preHandler: requireRole('owner', 'admin', 'manager', 'leader') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, accessId } = request.params as { id: string; accessId: string };
      const { permission } = request.body as { permission: string };

      if (!VALID_PERMISSIONS.includes(permission as Permission)) {
        return reply.status(400).send({ error: 'permission phải là read, chat hoặc admin' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      if (['leader', 'manager'].includes(user.role)) {
        if (permission === 'admin') {
          return reply.status(403).send({ error: 'Leader/Manager không được phép cấp quyền admin Zalo' });
        }
        
        const isManagedAccount = await prisma.zaloAccountTeam.findFirst({
          where: {
            zaloAccountId: id,
            team: { OR: [{ leaderId: user.id }, { managerId: user.id }] }
          }
        });
        if (!isManagedAccount) {
          return reply.status(403).send({ error: 'Chỉ được phép phân quyền cho số Zalo thuộc nhóm bạn quản lý' });
        }
        // Also check if the user being updated is their subordinate
        const existingAccess = await prisma.zaloAccountAccess.findFirst({ where: { id: accessId } });
        if (existingAccess) {
          const targetUser = await prisma.user.findFirst({ where: { id: existingAccess.userId } });
          const managedTeams = await prisma.team.findMany({
            where: { orgId: user.orgId, OR: [{ leaderId: user.id }, { managerId: user.id }] },
            select: { id: true }
          });
          const managedTeamIds = managedTeams.map(t => t.id);
          if (targetUser && (!targetUser.teamId || !managedTeamIds.includes(targetUser.teamId))) {
            return reply.status(403).send({ error: 'Chỉ được sửa quyền Zalo của nhân sự do bạn quản lý' });
          }
        }
      }

      try {
        const access = await prisma.zaloAccountAccess.update({
          where: { id: accessId, zaloAccountId: id },
          data: { permission },
          include: { user: { select: { id: true, fullName: true, email: true } } },
        });
        logger.info(`Zalo access updated: accessId ${accessId} → ${permission} by ${user.email}`);
        return access;
      } catch {
        return reply.status(404).send({ error: 'Access record not found' });
      }
    },
  );

  // DELETE /api/v1/zalo-accounts/:id/access/:accessId — revoke access
  app.delete(
    '/api/v1/zalo-accounts/:id/access/:accessId',
    { preHandler: requireRole('owner', 'admin', 'manager', 'leader') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, accessId } = request.params as { id: string; accessId: string };

      const account = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      if (['leader', 'manager'].includes(user.role)) {
        const isManagedAccount = await prisma.zaloAccountTeam.findFirst({
          where: {
            zaloAccountId: id,
            team: { OR: [{ leaderId: user.id }, { managerId: user.id }] }
          }
        });
        if (!isManagedAccount) {
          return reply.status(403).send({ error: 'Chỉ được phép xóa quyền Zalo thuộc nhóm bạn quản lý' });
        }
        const existingAccess = await prisma.zaloAccountAccess.findFirst({ where: { id: accessId } });
        if (existingAccess) {
          const targetUser = await prisma.user.findFirst({ where: { id: existingAccess.userId } });
          const managedTeams = await prisma.team.findMany({
            where: { orgId: user.orgId, OR: [{ leaderId: user.id }, { managerId: user.id }] },
            select: { id: true }
          });
          const managedTeamIds = managedTeams.map(t => t.id);
          if (targetUser && (!targetUser.teamId || !managedTeamIds.includes(targetUser.teamId))) {
            return reply.status(403).send({ error: 'Chỉ được xóa quyền Zalo của nhân sự do bạn quản lý' });
          }
        }
      }

      try {
        await prisma.zaloAccountAccess.delete({ where: { id: accessId, zaloAccountId: id } });
        logger.info(`Zalo access revoked: accessId ${accessId} by ${user.email}`);
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'Access record not found' });
      }
    },
  );
}
