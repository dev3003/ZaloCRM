/**
 * Super Admin Routes
 * Accessible ONLY by users with role === 'superadmin'.
 */
import type { FastifyInstance } from 'fastify';
import net from 'node:net';
import { superAdminMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

function testFtpPort(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function superAdminRoutes(app: FastifyInstance): Promise<void> {
  // Apply Super Admin authentication guard to all routes in this plugin
  app.addHook('preHandler', superAdminMiddleware);

  // GET /api/v1/super-admin/organizations — List all organizations with metrics
  app.get('/api/v1/super-admin/organizations', async () => {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            zaloAccounts: true,
            contacts: true,
            conversations: true,
          }
        },
        zaloDesktopAgent: {
          select: {
            id: true,
            agentKey: true,
            fingerprint: true,
            name: true,
            status: true,
            updatedAt: true,
          }
        }
      }
    });

    return orgs.map(org => {
      const desktopAgent = org.zaloDesktopAgent as any;
      return {
        id: org.id,
        name: org.name,
        status: org.status,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
        stats: {
          usersCount: org._count.users,
          zaloAccountsCount: org._count.zaloAccounts,
          contactsCount: org._count.contacts,
          conversationsCount: org._count.conversations,
        },
        agent: desktopAgent ? {
          id: desktopAgent.id,
          name: desktopAgent.name,
          agentKey: desktopAgent.agentKey,
          fingerprint: desktopAgent.fingerprint,
          status: desktopAgent.status,
          lastActiveAt: desktopAgent.updatedAt,
        } : null
      };
    });
  });

  // PUT /api/v1/super-admin/organizations/:id/status — Lock / Unlock organization
  app.put<{
    Params: { id: string };
    Body: { status: string };
  }>('/api/v1/super-admin/organizations/:id/status', async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;

    if (!['active', 'suspended'].includes(status)) {
      return reply.status(400).send({ error: 'Trạng thái không hợp lệ' });
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: { status }
    });

    logger.info(`SuperAdmin updated org ${id} status to ${status}`);
    return updated;
  });

  // GET /api/v1/super-admin/agents — List all agent servers
  app.get('/api/v1/super-admin/agents', async () => {
    const agents = await prisma.zaloDesktopAgent.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        org: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });
    return agents;
  });

  // GET /api/v1/super-admin/storage-configs — List FTP storage configs
  app.get('/api/v1/super-admin/storage-configs', async () => {
    const configs = await prisma.storageConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return configs;
  });

  // POST /api/v1/super-admin/storage-configs — Create or update FTP Storage config
  app.post<{
    Body: {
      id?: string;
      name: string;
      type?: string;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      mediaUrl?: string;
      isActive?: boolean;
    };
  }>('/api/v1/super-admin/storage-configs', async (request, reply) => {
    const { id, name, type = 'ftp', host, port = 21, user, password, mediaUrl, isActive = false } = request.body;

    if (!name) {
      return reply.status(400).send({ error: 'Vui lòng nhập tên cấu hình FTP' });
    }

    // If setting isActive to true, deactivate other configs
    if (isActive) {
      await prisma.storageConfig.updateMany({
        data: { isActive: false }
      });
    }

    if (id) {
      const updated = await prisma.storageConfig.update({
        where: { id },
        data: { name, type, host, port, user, password, mediaUrl, isActive }
      });
      return updated;
    } else {
      const created = await prisma.storageConfig.create({
        data: { name, type, host, port, user, password, mediaUrl, isActive }
      });
      return created;
    }
  });

  // DELETE /api/v1/super-admin/storage-configs/:id — Delete FTP storage config
  app.delete<{ Params: { id: string } }>('/api/v1/super-admin/storage-configs/:id', async (request, reply) => {
    const { id } = request.params;
    await prisma.storageConfig.delete({ where: { id } });
    return { success: true };
  });

  // POST /api/v1/super-admin/storage-configs/test — Test FTP connection directly
  app.post<{
    Body: { host?: string; port?: number };
  }>('/api/v1/super-admin/storage-configs/test', async (request, reply) => {
    const { host, port = 21 } = request.body;
    if (!host) {
      return reply.status(400).send({ error: 'Vui lòng nhập FTP Host' });
    }

    const connected = await testFtpPort(host, Number(port) || 21);
    if (connected) {
      return { success: true, message: `Kết nối thành công tới FTP máy chủ ${host}:${port}` };
    } else {
      return reply.status(400).send({ error: `Không thể kết nối tới FTP máy chủ ${host}:${port}` });
    }
  });

  // POST /api/v1/super-admin/storage-configs/:id/test — Test FTP connection by config ID
  app.post<{ Params: { id: string } }>('/api/v1/super-admin/storage-configs/:id/test', async (request, reply) => {
    const { id } = request.params;
    const config = await prisma.storageConfig.findUnique({ where: { id } });
    if (!config) {
      return reply.status(404).send({ error: 'Không tìm thấy cấu hình FTP' });
    }
    
    const host = config.host || '';
    const port = config.port || 21;

    if (!host) {
      return reply.status(400).send({ error: 'Cấu hình FTP chưa khai báo Host' });
    }

    const connected = await testFtpPort(host, Number(port) || 21);
    if (connected) {
      return { success: true, message: `Kết nối FTP tới máy chủ ${host}:${port} thành công` };
    } else {
      return reply.status(400).send({ error: `Không thể kết nối tới FTP máy chủ ${host}:${port}` });
    }
  });
}
