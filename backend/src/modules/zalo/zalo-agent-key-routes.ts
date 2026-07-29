/**
 * Zalo Agent Key Management Routes — Tenant Admin endpoints
 * Manages the single dedicated Agent Server key and revocation/regeneration flow.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export async function zaloAgentKeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-agent/my-agent — Get current org's dedicated Agent Server & Key
  app.get('/api/v1/zalo-agent/my-agent', async (request, reply) => {
    const user = request.user as { id: string; orgId: string };
    if (!user.orgId) {
      return reply.status(400).send({ error: 'Không tìm thấy thông tin Tổ chức' });
    }

    let agent = await prisma.zaloDesktopAgent.findUnique({
      where: { orgId: user.orgId },
      include: { org: { select: { name: true, status: true } } }
    });

    // Auto-create single dedicated Agent if not exists yet
    if (!agent) {
      const agentKey = 'zk_live_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
      const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
      agent = await prisma.zaloDesktopAgent.create({
        data: {
          orgId: user.orgId,
          agentKey,
          name: `Máy chủ Agent ${org?.name || ''}`,
          status: 'active',
        },
        include: { org: { select: { name: true, status: true } } }
      });
      logger.info(`Auto-created dedicated agent for org ${user.orgId}`);
    }

    return agent;
  });

  // POST /api/v1/zalo-agent/regenerate-key — Regenerate Agent Key & Disconnect old Agent
  app.post('/api/v1/zalo-agent/regenerate-key', async (request, reply) => {
    const user = request.user as { id: string; role: string; orgId: string };
    if (!user.orgId) {
      return reply.status(400).send({ error: 'Không tìm thấy thông tin Tổ chức' });
    }

    // Only owner or admin can regenerate agent key
    if (!['owner', 'admin', 'superadmin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Chỉ Quản trị viên mới có quyền Cấp lại Key Máy chủ Agent.' });
    }

    const newAgentKey = 'zk_live_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);

    // Update database record (resets fingerprint so new hardware can connect)
    const updatedAgent = await prisma.zaloDesktopAgent.upsert({
      where: { orgId: user.orgId },
      update: {
        agentKey: newAgentKey,
        fingerprint: null,
        status: 'active'
      },
      create: {
        orgId: user.orgId,
        agentKey: newAgentKey,
        name: 'Dedicated Agent Server',
        status: 'active'
      }
    });

    // Force disconnect current socket connection for this org if active
    if (app.io) {
      logger.info(`Disconnecting old agent socket for org ${user.orgId} due to key regeneration`);
      app.io.to(`org:${user.orgId}`).emit('agent-key-revoked', {
        reason: 'Key Máy chủ Agent đã được cấp mới bởi Quản trị viên.'
      });
      app.io.in(`org:${user.orgId}`).disconnectSockets(true);
    }

    logger.info(`Agent Key regenerated for org ${user.orgId} -> ${newAgentKey}`);

    return {
      success: true,
      agent: updatedAgent,
      newAgentKey,
      installerDownloadUrl: `/api/v1/zalo-agent/download-installer?key=${newAgentKey}`
    };
  });
}
