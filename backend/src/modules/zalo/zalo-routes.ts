import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { requireRole } from '../auth/role-middleware.js';
import { sendMessageToAgent } from '../agent/agent-socket.js';

/**
 * Zalo account management routes.
 */
async function zaloRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts — list accounts with live status from pool
  app.get('/api/v1/zalo-accounts', async (request) => {
    const user = request.user!;
    const where: any = { orgId: user.orgId };

    // Role-based visibility
    if (user.role === 'member') {
      where.OR = [
        { access: { some: { userId: user.id } } },
        { teams: { none: {} } },
        ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
      ];
    } else if (['leader', 'manager'].includes(user.role)) {
      where.OR = [
        { owner: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
        { access: { some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } } },
        { teams: { none: {} } },
        { teams: { some: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } }
      ];
    }

    const accounts = await prisma.zaloAccount.findMany({
      where,
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        isFriendRequestLocked: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
        teams: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const activeAgent = await prisma.zaloDesktopAgent.findFirst({
      where: { orgId: user.orgId, status: 'active' }
    });

    return accounts.map((a) => {
      let liveStatus = zaloPool.getStatus(a.id);
      if (activeAgent && liveStatus === 'disconnected') {
        liveStatus = a.status;
      }
      return {
        ...a,
        liveStatus,
      };
    });
  });

  // POST /api/v1/zalo-accounts — create a new account record
  app.post<{ Body: { displayName?: string, teamIds?: string[] } }>(
    '/api/v1/zalo-accounts',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { displayName, teamIds } = (request.body as any) ?? {};

      const account = await prisma.zaloAccount.create({
        data: {
          orgId: user.orgId,
          ownerUserId: user.id,
          displayName: displayName ?? null,
          status: 'qr_pending',
          teams: teamIds && teamIds.length > 0 ? {
            create: teamIds.map((teamId: string) => ({ teamId }))
          } : undefined
        },
      });

      return reply.status(201).send(account);
    },
  );

  // PATCH /api/v1/zalo-accounts/:id — update an account
  app.patch<{ Body: { displayName?: string, teamIds?: string[] } }>(
    '/api/v1/zalo-accounts/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const { displayName, teamIds, isFriendRequestLocked } = (request.body as any) ?? {};

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      // If teamIds is provided, we delete existing and recreate
      if (teamIds !== undefined) {
        await prisma.zaloAccountTeam.deleteMany({ where: { zaloAccountId: id } });
      }

      const updated = await prisma.zaloAccount.update({
        where: { id },
        data: {
          displayName: displayName !== undefined ? displayName : undefined,
          isFriendRequestLocked: isFriendRequestLocked !== undefined ? isFriendRequestLocked : undefined,
          teams: teamIds !== undefined ? {
            create: teamIds.map((teamId: string) => ({ teamId }))
          } : undefined
        }
      });

      return reply.send(updated);
    }
  );

  // POST /api/v1/zalo-accounts/:id/login
  app.post('/api/v1/zalo-accounts/:id/login', { preHandler: requireRole('owner', 'admin', 'manager', 'leader') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
      include: { teams: true }
    });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    if (['leader', 'manager'].includes(user.role)) {
      const managedTeams = await prisma.team.findMany({
        where: { orgId: user.orgId, OR: [{ leaderId: user.id }, { managerId: user.id }] },
        select: { id: true }
      });
      const managedTeamIds = managedTeams.map(t => t.id);
      const isManagedAccount = account.teams.some(t => managedTeamIds.includes(t.teamId));
      if (!isManagedAccount && account.teams.length > 0) {
        return reply.status(403).send({ error: 'Không có quyền trên Zalo này' });
      }
    }

    sendMessageToAgent(user.orgId, 'trigger-qr-login', { accountId: id });
    return { message: 'QR login initiated' };
  });

  // POST /api/v1/zalo-accounts/:id/reconnect
  app.post('/api/v1/zalo-accounts/:id/reconnect', { preHandler: requireRole('owner', 'admin', 'manager', 'leader') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
      include: { teams: true }
    });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    if (['leader', 'manager'].includes(user.role)) {
      const managedTeams = await prisma.team.findMany({
        where: { orgId: user.orgId, OR: [{ leaderId: user.id }, { managerId: user.id }] },
        select: { id: true }
      });
      const managedTeamIds = managedTeams.map(t => t.id);
      const isManagedAccount = account.teams.some(t => managedTeamIds.includes(t.teamId));
      if (!isManagedAccount && account.teams.length > 0) {
        return reply.status(403).send({ error: 'Không có quyền trên Zalo này' });
      }
    }

    const session = account.sessionData as any;
    if (!session?.imei) return reply.status(400).send({ error: 'No saved session' });

    sendMessageToAgent(user.orgId, 'reconnect-account', { accountId: id });
    return { message: 'Reconnect initiated' };
  });

  // DELETE /api/v1/zalo-accounts/:id
  app.delete('/api/v1/zalo-accounts/:id', { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    sendMessageToAgent(user.orgId, 'disconnect-account', { accountId: id });
    await prisma.zaloAccount.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/v1/zalo-accounts/:id/status
  app.get('/api/v1/zalo-accounts/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const where: any = { id, orgId: user.orgId };
    if (user.role === 'member') {
      where.access = { some: { userId: user.id } };
    } else if (['leader', 'manager'].includes(user.role)) {
      where.OR = [
        { owner: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
        { access: { some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } } }
      ];
    }

    // Query the actual DB status instead of relying on the local zaloPool
    const account = await prisma.zaloAccount.findFirst({
      where,
      select: { id: true, status: true },
    });
    if (!account) return reply.status(403).send({ error: 'Access denied' });

    return { accountId: id, liveStatus: account.status };
  });
}

export { zaloRoutes };
