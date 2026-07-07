import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function bulkCampaignRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/campaigns — list campaigns ───────────────────────────────
  app.get(
    '/api/v1/campaigns',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { page = '1', limit = '20' } = request.query as any;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const where = { orgId: user.orgId };

        const [campaigns, total] = await Promise.all([
          prisma.bulkCampaign.findMany({
            where,
            include: {
              team: { select: { id: true, name: true } },
              creator: { select: { id: true, fullName: true } },
              _count: { select: { tasks: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
          }),
          prisma.bulkCampaign.count({ where }),
        ]);

        return { campaigns, total, page: pageNum, limit: limitNum };
      } catch (err) {
        logger.error('[campaigns] List error:', err);
        return reply.status(500).send({ error: 'Failed to fetch campaigns' });
      }
    }
  );

  // ── GET /api/v1/campaigns/:id — campaign details ─────────────────────────
  app.get(
    '/api/v1/campaigns/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };

        const campaign = await prisma.bulkCampaign.findFirst({
          where: { id, orgId: user.orgId },
          include: {
            team: { select: { id: true, name: true } },
            creator: { select: { id: true, fullName: true } },
            tasks: {
              include: {
                contact: { select: { id: true, fullName: true, phone: true } },
                zaloAccount: { select: { id: true, displayName: true, phone: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });
        return campaign;
      } catch (err) {
        logger.error('[campaigns] Detail error:', err);
        return reply.status(500).send({ error: 'Failed to fetch campaign details' });
      }
    }
  );

  // ── POST /api/v1/campaigns — create new campaign ─────────────────────────
  app.post(
    '/api/v1/campaigns',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const body = request.body as any;
        const { name, teamId, tags, messageContent, scheduledAt } = body;

        if (!name || !teamId || !tags || !Array.isArray(tags) || tags.length === 0 || !messageContent || !scheduledAt) {
          return reply.status(400).send({ error: 'Invalid input. Please provide name, teamId, tags, messageContent, and scheduledAt.' });
        }

        // Verify team belongs to org
        const team = await prisma.team.findFirst({ where: { id: teamId, orgId: user.orgId } });
        if (!team) return reply.status(404).send({ error: 'Team not found' });

        // 1. Find all contacts with the requested tags
        const contacts = await prisma.contact.findMany({
          where: {
            orgId: user.orgId,
            tags: { array_contains: tags }, // Note: Postgres JSON array matching logic might require specific syntax, but Prisma handles array_contains for JSON arrays if configured, or we can fetch and filter if it's complex. Let's assume array_contains works. Wait, Prisma Json filter array_contains works.
          },
          include: {
            assignedUser: { select: { id: true, teamId: true } },
            conversations: {
              select: { zaloAccountId: true },
              orderBy: { lastMessageAt: 'desc' }
            }
          }
        });

        if (contacts.length === 0) {
          return reply.status(400).send({ error: 'Không tìm thấy khách hàng nào có tag này' });
        }

        // 2. Fetch Zalo Accounts that belong to the selected Team
        const teamZaloAccounts = await prisma.zaloAccountTeam.findMany({
          where: { teamId },
          select: { zaloAccount: { select: { id: true, ownerUserId: true, status: true } } }
        });
        const activeZaloAccounts = teamZaloAccounts
          .filter(tza => tza.zaloAccount.status === 'connected')
          .map(tza => tza.zaloAccount);

        if (activeZaloAccounts.length === 0) {
          return reply.status(400).send({ error: 'Nhóm này không có Zalo Account nào đang online' });
        }

        // Create campaign
        const campaign = await prisma.bulkCampaign.create({
          data: {
            orgId: user.orgId,
            name,
            teamId,
            tags,
            messageContent,
            scheduledAt: new Date(scheduledAt),
            createdBy: user.id,
            status: 'pending',
          }
        });

        // 3. Smart routing: assign each contact to a Zalo Account
        const tasksToCreate = [];

        for (const contact of contacts) {
          let selectedZaloAccountId: string | null = null;

          // Priority 1: Zalo account of the assigned user (if it's in the team's active accounts)
          if (contact.assignedUserId) {
            const assignedZaloAccount = activeZaloAccounts.find(za => za.ownerUserId === contact.assignedUserId);
            if (assignedZaloAccount) {
              selectedZaloAccountId = assignedZaloAccount.id;
            }
          }

          // Priority 2: A Zalo account that already had a conversation with this contact
          if (!selectedZaloAccountId && contact.conversations.length > 0) {
            for (const conv of contact.conversations) {
              const prevAcc = activeZaloAccounts.find(za => za.id === conv.zaloAccountId);
              if (prevAcc) {
                selectedZaloAccountId = prevAcc.id;
                break;
              }
            }
          }

          // Priority 3: Fallback to the first available Zalo account in the team
          if (!selectedZaloAccountId) {
            selectedZaloAccountId = activeZaloAccounts[0].id;
          }

          tasksToCreate.push({
            campaignId: campaign.id,
            contactId: contact.id,
            zaloAccountId: selectedZaloAccountId,
            status: 'pending'
          });
        }

        if (tasksToCreate.length > 0) {
          await prisma.bulkCampaignTask.createMany({
            data: tasksToCreate
          });
        }

        return reply.status(201).send({ campaign, taskCount: tasksToCreate.length });
      } catch (err) {
        logger.error('[campaigns] Create error:', err);
        return reply.status(500).send({ error: 'Failed to create campaign' });
      }
    }
  );

  // ── PUT /api/v1/campaigns/:id/status — Pause/Resume/Cancel ───────────────
  app.put(
    '/api/v1/campaigns/:id/status',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        const { status } = request.body as { status: string };

        if (!['running', 'paused', 'cancelled'].includes(status)) {
          return reply.status(400).send({ error: 'Invalid status' });
        }

        const existing = await prisma.bulkCampaign.findFirst({ where: { id, orgId: user.orgId } });
        if (!existing) return reply.status(404).send({ error: 'Campaign not found' });

        if (existing.status === 'completed' || existing.status === 'cancelled') {
          return reply.status(400).send({ error: 'Cannot change status of completed/cancelled campaign' });
        }

        const updated = await prisma.bulkCampaign.update({
          where: { id },
          data: { status }
        });

        // If cancelled, mark all pending tasks as failed/cancelled
        if (status === 'cancelled') {
          await prisma.bulkCampaignTask.updateMany({
            where: { campaignId: id, status: 'pending' },
            data: { status: 'failed', errorMessage: 'Campaign cancelled by user' }
          });
        }

        return updated;
      } catch (err) {
        logger.error('[campaigns] Update status error:', err);
        return reply.status(500).send({ error: 'Failed to update campaign status' });
      }
    }
  );

  // ── PUT /api/v1/campaigns/:id — Edit campaign ────────────────────────────
  app.put(
    '/api/v1/campaigns/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        const body = request.body as any;
        const { name, messageContent, scheduledAt } = body;

        const existing = await prisma.bulkCampaign.findFirst({ where: { id, orgId: user.orgId } });
        if (!existing) return reply.status(404).send({ error: 'Campaign not found' });

        if (existing.status !== 'pending') {
          return reply.status(400).send({ error: 'Chỉ có thể sửa chiến dịch khi đang ở trạng thái Chờ (pending).' });
        }

        const dataToUpdate: any = {};
        if (name) dataToUpdate.name = name;
        if (messageContent) dataToUpdate.messageContent = messageContent;
        if (scheduledAt) dataToUpdate.scheduledAt = new Date(scheduledAt);

        const updated = await prisma.bulkCampaign.update({
          where: { id },
          data: dataToUpdate
        });

        return updated;
      } catch (err) {
        logger.error('[campaigns] Edit error:', err);
        return reply.status(500).send({ error: 'Failed to edit campaign' });
      }
    }
  );

  // ── DELETE /api/v1/campaigns/:id — Delete campaign ───────────────────────
  app.delete(
    '/api/v1/campaigns/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };

        const existing = await prisma.bulkCampaign.findFirst({ where: { id, orgId: user.orgId } });
        if (!existing) return reply.status(404).send({ error: 'Campaign not found' });

        await prisma.bulkCampaign.delete({ where: { id } });

        return reply.status(204).send();
      } catch (err) {
        logger.error('[campaigns] Delete error:', err);
        return reply.status(500).send({ error: 'Failed to delete campaign' });
      }
    }
  );
}
