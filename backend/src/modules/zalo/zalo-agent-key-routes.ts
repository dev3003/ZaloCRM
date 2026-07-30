/**
 * Zalo Agent Key Management Routes — Tenant Admin endpoints
 * Manages the single dedicated Agent Server key and revocation/regeneration flow.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';

export async function zaloAgentKeyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/zalo-agent/my-agent — Get current org's dedicated Agent Server & Key
  app.get('/api/v1/zalo-agent/my-agent', { preHandler: authMiddleware }, async (request, reply) => {
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
  app.post('/api/v1/zalo-agent/regenerate-key', { preHandler: authMiddleware }, async (request, reply) => {
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
        hostname: null,
        macAddress: null,
        machineGuid: null,
        osVersion: null,
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

  // GET /api/v1/zalo-agent/download-installer — Public endpoint to download agent installer with key & url pre-filled
  app.get('/api/v1/zalo-agent/download-installer', async (request, reply) => {
    const { key } = request.query as { key?: string };
    if (!key) {
      return reply.status(400).send({ error: 'Thiếu Agent Key' });
    }

    // Verify key in DB
    const agent = await prisma.zaloDesktopAgent.findFirst({
      where: { agentKey: key, status: 'active' }
    });
    if (!agent) {
      return reply.status(404).send({ error: 'Agent Key không hợp lệ hoặc đã bị thu hồi' });
    }

    // Dynamically get server host from API_URL config
    const apiUrl = config.apiUrl || 'https://dev-test-sub.omni360.vn';
    const host = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    const downloadName = `Omni360_Agent_Setup__${host}__${key}.exe`;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const possiblePaths = [
      '/www/wwwroot/dev-test.omni360.frontend/downloads/Omni360AgentBase.exe',
      '/www/wwwroot/dev-test.omni360.frontend/public/downloads/Omni360AgentBase.exe',
      '/www/wwwroot/dev-test.omni360.frontend/dist/downloads/Omni360AgentBase.exe',
      path.join(__dirname, '../../../../frontend/dist/downloads/Omni360AgentBase.exe'),
      path.join(__dirname, '../../../../frontend/public/downloads/Omni360AgentBase.exe'),
      path.join(process.cwd(), '../frontend/dist/downloads/Omni360AgentBase.exe'),
      path.join(process.cwd(), '../frontend/public/downloads/Omni360AgentBase.exe'),
      path.join(process.cwd(), 'static/downloads/Omni360AgentBase.exe'),
      '/www/wwwroot/dev-test.omni360.backend/frontend/dist/downloads/Omni360AgentBase.exe',
      '/www/wwwroot/dev-test.omni360.backend/frontend/public/downloads/Omni360AgentBase.exe',
    ];

    let filePath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }

    if (!filePath) {
      logger.error(`Installer file not found. Tried paths: ${JSON.stringify(possiblePaths)}`);
      return reply.status(404).send({ error: 'Không tìm thấy file cài đặt gốc trên server' });
    }

    reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  });
}
