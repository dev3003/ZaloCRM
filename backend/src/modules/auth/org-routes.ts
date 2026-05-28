/**
 * Organization settings routes — get and update current org info.
 * GET is accessible to all authenticated users; PUT requires owner role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireRole } from './role-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/organization — get current org info
  app.get('/api/v1/organization', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      });
      if (!org) return reply.status(404).send({ error: 'Organization not found' });

      // Fetch ERP API Settings
      const erpApiUrl = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_api_url' } },
        select: { valuePlain: true }
      });
      const erpApiKey = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_api_key' } },
        select: { valuePlain: true }
      });
      const erpDecryptKey = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_decrypt_key' } },
        select: { valuePlain: true }
      });

      return { 
        ...org, 
        settings: {
          erp_api_url: erpApiUrl?.valuePlain || '',
          erp_api_key: erpApiKey?.valuePlain || '',
          erp_decrypt_key: erpDecryptKey?.valuePlain || ''
        }
      };
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch organization' });
    }
  });

  // PUT /api/v1/organization — update org name (owner only)
  app.put(
    '/api/v1/organization',
    { preHandler: requireRole('owner') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { name, erp_api_url, erp_api_key, erp_decrypt_key } = request.body as { name: string, erp_api_url?: string, erp_api_key?: string, erp_decrypt_key?: string };
      if (!name?.trim()) return reply.status(400).send({ error: 'Tên tổ chức là bắt buộc' });

      try {
        const updateData: any = { name: name.trim() };
        
        await prisma.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: user.orgId },
            data: updateData,
          });

          if (erp_api_url !== undefined) {
            await tx.appSetting.upsert({
              where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_api_url' } },
              update: { valuePlain: erp_api_url.trim() },
              create: { 
                orgId: user.orgId, 
                settingKey: 'erp_api_url', 
                valuePlain: erp_api_url.trim() 
              }
            });
          }
          if (erp_api_key !== undefined) {
            await tx.appSetting.upsert({
              where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_api_key' } },
              update: { valuePlain: erp_api_key.trim() },
              create: { 
                orgId: user.orgId, 
                settingKey: 'erp_api_key', 
                valuePlain: erp_api_key.trim() 
              }
            });
          }
          if (erp_decrypt_key !== undefined) {
            await tx.appSetting.upsert({
              where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'erp_decrypt_key' } },
              update: { valuePlain: erp_decrypt_key.trim() },
              create: { 
                orgId: user.orgId, 
                settingKey: 'erp_decrypt_key', 
                valuePlain: erp_decrypt_key.trim() 
              }
            });
          }
        });

        logger.info(`Organization settings updated by ${user.email}`);
        return { success: true };
      } catch (err) {
        logger.error('[org] Update error:', err);
        return reply.status(500).send({ error: 'Failed to update organization settings' });
      }
    },
  );
}
