/**
 * contact-routes.ts — REST API for CRM contact management.
 * Supports list, detail, create, update, delete, pipeline view, and tag updates.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { mergeContacts } from './merge-service.js';
import { runContactIntelligence } from './contact-intelligence.js';
import { runAutomationRules } from '../automation/automation-service.js';

type QueryParams = Record<string, string>;

async function validateAdminCustomerId(orgId: string, targetAssignedUserId: string | null | undefined, adminCustomerIdRaw: string, excludeContactId?: string): Promise<string | null> {
  const adminCustomerId = adminCustomerIdRaw?.trim();
  if (!adminCustomerId) return null;

  // 1. Check duplicate in Zalo CRM
  const duplicateWhere: any = {
    orgId,
    adminCustomerId
  };
  if (excludeContactId) {
    duplicateWhere.id = { not: excludeContactId };
  }

  const duplicate = await prisma.contact.findFirst({
    where: duplicateWhere,
    select: { id: true }
  });

  if (duplicate) {
    return 'ID này đã tồn tại trong hệ thống crm zalo';
  }

  if (!targetAssignedUserId) {
    return 'Không thể kiểm tra ERP vì khách hàng chưa được phân bổ cho Sale nào';
  }

  // 2. Call ERP Admin API to check permission
  const assignedUser = await prisma.user.findUnique({
    where: { id: targetAssignedUserId },
    select: { adminSaleId: true, role: true, fullName: true }
  });

  if (!assignedUser?.adminSaleId) {
    if (assignedUser?.role === 'admin' || assignedUser?.role === 'owner') {
      return `Bạn đang thao tác với quyền Admin nhưng chưa chọn Sale phụ trách (hoặc tài khoản Admin chưa có mã adminSaleId). Hệ thống ERP bắt buộc phải có thông tin Sale để đối chiếu ID này.`;
    }
    return `Tài khoản Sale (${assignedUser?.fullName || 'Không xác định'}) chưa được cấu hình adminSaleId để kiểm tra hệ thống ERP`;
  }

  // Fetch dynamic ERP settings from AppSetting
  const erpUrlSetting = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: 'erp_api_url' } }
  });
  const erpKeySetting = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: 'erp_api_key' } }
  });

  const erpUrl = erpUrlSetting?.valuePlain;
  const erpKey = erpKeySetting?.valuePlain;

  if (!erpUrl || !erpKey) {
    return 'Hệ thống chưa được cấu hình kết nối ERP. Vui lòng báo Admin vào Cài đặt Tổ chức để thiết lập API URL và API Key.';
  }

  const formData = new FormData();
  formData.append('task', 'checkCustomerPermission');
  formData.append('admin_sale_id', assignedUser.adminSaleId);
  formData.append('admin_customer_id', adminCustomerId);

  try {
    const erpRes = await fetch(erpUrl, {
      method: 'POST',
      headers: {
        'X-Api-Key': erpKey
      },
      body: formData as any
    });

    let erpData: any;
    try {
      erpData = await erpRes.json();
    } catch (e) {
      // ignore
    }

    if (!erpRes.ok) {
      return erpData?.message || `Lỗi từ hệ thống ERP (HTTP ${erpRes.status})`;
    }

    if (erpData?.data?.has_permission === false || !erpData?.data?.has_permission) {
      if (erpData?.message && erpData.message.toLowerCase() !== 'success') {
        return erpData.message;
      }
      return 'Khách hàng không tồn tại trên ERP hoặc bạn không có quyền chăm sóc khách hàng này';
    }
  } catch (err) {
    logger.error('[contacts] ERP check error:', err);
    return 'Lỗi khi kiểm tra dữ liệu ERP';
  }

  return null;
}


export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts — list with filters and pagination ───────────────
  app.get('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        search = '',
        source = '',
        status = '',
        assignedUserId = '',
        zaloAccountId = '',
        tag = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId, mergedInto: null };
      if (source) where.source = source;
      if (status) where.status = status;
      if (assignedUserId) where.assignedUserId = assignedUserId;
      if (zaloAccountId) {
        where.conversations = {
          some: { zaloAccountId }
        };
      }
      if (tag) {
        where.tags = { array_contains: tag };
      }

      // Role-based visibility for members and leaders
      if (user.role === 'member') {
        where.AND = [
          {
            OR: [
              { assignedUserId: user.id },
              { assignedUserId: null },
              { assignedUser: { teamId: { not: user.teamId } } }
            ]
          },
          {
            OR: [
              { assignedUserId: user.id },
              {
                conversations: {
                  some: {
                    zaloAccount: {
                      OR: [
                        { access: { some: { userId: user.id } } },
                        { teams: { none: {} } },
                        ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
                      ]
                    }
                  }
                }
              }
            ]
          }
        ];
      } else if (['leader', 'manager'].includes(user.role)) {
        const leaderCond = {
          OR: [
            { assignedUserId: user.id },
            { assignedUser: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
            {
              conversations: {
                some: {
                  zaloAccount: {
                    access: {
                      some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } }
                    }
                  }
                }
              }
            }
          ]
        };
        if (where.OR) {
          where.AND = [{ OR: where.OR }, leaderCond];
          delete where.OR;
        } else {
          where.OR = leaderCond.OR;
        }
      }

      if (search) {
        const searchCond = {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        };

        // If we already have an OR for member visibility, we must AND it with the search
        if (where.OR) {
          const visibilityCond = { OR: where.OR };
          delete where.OR;
          where.AND = [visibilityCond, searchCond];
        } else {
          where.OR = searchCond.OR;
        }
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
            conversations: {
              select: {
                zaloAccount: {
                  select: { id: true, displayName: true, phone: true }
                }
              }
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.contact.count({ where }),
      ]);

      return { contacts, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  // ── GET /api/v1/contacts/pipeline — kanban grouped by generic status ──────
  app.get('/api/v1/contacts/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const orgId = user.orgId;

      const where: any = { orgId, status: { not: null }, mergedInto: null };

      // Role-based visibility for members and leaders
      if (user.role === 'member') {
        where.AND = [
          {
            OR: [
              { assignedUserId: user.id },
              { assignedUserId: null },
              { assignedUser: { teamId: { not: user.teamId } } }
            ]
          },
          {
            OR: [
              { assignedUserId: user.id },
              {
                conversations: {
                  some: {
                    zaloAccount: {
                      OR: [
                        { access: { some: { userId: user.id } } },
                        { teams: { none: {} } },
                        ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
                      ]
                    }
                  }
                }
              }
            ]
          }
        ];
      } else if (['leader', 'manager'].includes(user.role)) {
        where.OR = [
          { assignedUser: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
          {
            conversations: {
              some: {
                zaloAccount: {
                  access: { some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } }
                }
              }
            }
          }
        ];
      }

      const pipeline = await prisma.contact.groupBy({
        by: ['status'],
        where,
        _count: true,
      });

      // Fetch contacts per status for kanban cards (limit 20 per column)
      const statuses = pipeline.map((g) => g.status ?? 'unknown');
      const contactsByStatus: Record<string, any[]> = {};

      await Promise.all(
        statuses.map(async (st) => {
          const where: any = { orgId, status: st ?? null, mergedInto: null };
          if (user.role === 'member') {
            where.AND = [
              {
                OR: [
                  { assignedUserId: user.id },
                  { assignedUserId: null },
                  { assignedUser: { teamId: { not: user.teamId } } }
                ]
              },
              {
                OR: [
                  { assignedUserId: user.id },
                  {
                    conversations: {
                      some: {
                        zaloAccount: {
                          OR: [
                            { access: { some: { userId: user.id } } },
                            { teams: { none: {} } },
                            ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            ];
          } else if (['leader', 'manager'].includes(user.role)) {
            where.OR = [
              { assignedUserId: user.id },
              { assignedUser: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
              {
                conversations: {
                  some: {
                    zaloAccount: {
                      access: {
                        some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } }
                      }
                    }
                  }
                }
              }
            ];
          }

          const contacts = await prisma.contact.findMany({
            where,
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              avatarUrl: true,
              status: true,
              nextAppointment: true,
              assignedUser: { select: { id: true, fullName: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          });
          contactsByStatus[st ?? 'unknown'] = contacts;
        }),
      );

      const result = pipeline.map((g) => ({
        status: g.status ?? 'unknown',
        count: g._count,
        contacts: contactsByStatus[g.status ?? 'unknown'] ?? [],
      }));

      return { pipeline: result };
    } catch (err) {
      logger.error('[contacts] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline' });
    }
  });

  // ── GET /api/v1/contacts/:id — detail with appointments + conversation count
  app.get('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const where: any = { id, orgId: user.orgId };
      if (user.role === 'member') {
        where.AND = [
          {
            OR: [
              { assignedUserId: user.id },
              { assignedUserId: null },
              { assignedUser: { teamId: { not: user.teamId } } }
            ]
          },
          {
            OR: [
              { assignedUserId: user.id },
              {
                conversations: {
                  some: {
                    zaloAccount: {
                      OR: [
                        { access: { some: { userId: user.id } } },
                        { teams: { none: {} } },
                        ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : [])
                      ]
                    }
                  }
                }
              }
            ]
          }
        ];
      } else if (['leader', 'manager'].includes(user.role)) {
        where.OR = [
          { assignedUser: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
          {
            conversations: {
              some: {
                zaloAccount: {
                  access: { some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } }
                }
              }
            }
          }
        ];
      }

      const contact = await prisma.contact.findFirst({
        where,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });
      return contact;
    } catch (err) {
      logger.error('[contacts] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  // ── POST /api/v1/contacts — create new contact ────────────────────────────
  app.post('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      let assignedUserId = body.assignedUserId;
      // Default to current user if member/leader and no assignedUserId provided
      if (!assignedUserId && ['member', 'leader'].includes(user.role)) {
        assignedUserId = user.id;
      }

      if (body.adminCustomerId) {
        const validationError = await validateAdminCustomerId(user.orgId, assignedUserId || user.id, body.adminCustomerId);
        if (validationError) {
          return reply.status(400).send({ error: validationError });
        }
      }

      const contact = await prisma.contact.create({
        data: {
          orgId: user.orgId,
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          zaloUid: body.zaloUid,
          avatarUrl: body.avatarUrl,
          source: body.source,
          sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
          status: body.status ?? 'new',
          nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
          assignedUserId,
          notes: body.notes,
          tags: body.tags ?? [],
          metadata: body.metadata ?? {},
          adminCustomerId: body.adminCustomerId ? body.adminCustomerId.trim() : null,
        },
      });

      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
      });
      void runAutomationRules({
        trigger: 'contact_created',
        orgId: user.orgId,
        org,
        contact: {
          id: contact.id,
          fullName: contact.fullName,
          phone: contact.phone,
          status: contact.status,
          source: contact.source,
          assignedUserId: contact.assignedUserId,
        },
      });

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[contacts] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  // POST /api/v1/contacts/:id — update CRM fields ─────────────────────────
  app.post('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      // If it's a POST to :id, it's an update. If we want to support both POST/PUT, 
      // we can check if body is empty or similar, but here we just convert it.

      const where: any = { id, orgId: user.orgId };
      if (user.role === 'member') {
        where.OR = [
          { assignedUserId: user.id },
          { assignedUserId: null },   // contact chưa được gán cho ai
          {
            conversations: {
              some: {
                zaloAccount: {
                  access: {
                    some: { userId: user.id }
                  }
                }
              }
            }
          }
        ];
      } else if (['leader', 'manager'].includes(user.role)) {
        where.OR = [
          { assignedUser: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } },
          { assignedUserId: null },
          {
            conversations: {
              some: {
                zaloAccount: {
                  access: { some: { user: { team: { OR: [{ leaderId: user.id }, { managerId: user.id }] } } } }
                }
              }
            }
          }
        ];
      }

      const existing = await prisma.contact.findFirst({
        where,
        select: { id: true, status: true, fullName: true, phone: true, source: true, assignedUserId: true, adminCustomerId: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Không tìm thấy khách hàng hoặc bạn không có quyền chỉnh sửa.' });

      const updateData: any = {
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        avatarUrl: body.avatarUrl,
        source: body.source,
        sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
        status: body.status,
        nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
        notes: body.notes,
        tags: body.tags,
        metadata: body.metadata,
      };

      // Handle assignedUser via relation if assignedUserId is provided
      if (body.assignedUserId !== undefined) {
        if (body.assignedUserId) {
          updateData.assignedUser = { connect: { id: body.assignedUserId } };
        } else {
          updateData.assignedUser = { disconnect: true };
        }
      }

      // Validate & save adminCustomerId
      if (body.adminCustomerId !== undefined) {
        const currentId = existing.adminCustomerId || null;

        // Non-admin users cannot change an already-set ID
        if (currentId && user.role !== 'owner' && user.role !== 'admin') {
          return reply.status(403).send({
            error: 'Bạn không có quyền thay đổi ID khách hàng đã được gán. Vui lòng liên hệ Admin.',
          });
        }

        if (body.adminCustomerId && body.adminCustomerId !== currentId) {
          let targetAssignedUserId = existing.assignedUserId;
          if (body.assignedUserId !== undefined) {
            targetAssignedUserId = body.assignedUserId;
          }
          if (!targetAssignedUserId) {
            targetAssignedUserId = user.id;
          }
          const validationError = await validateAdminCustomerId(user.orgId, targetAssignedUserId, body.adminCustomerId, existing.id);
          if (validationError) {
            return reply.status(400).send({ error: validationError });
          }

          // Auto-assign the contact to the current user if it was unassigned
          // and they successfully validated the ERP ID using their permission
          if (targetAssignedUserId === user.id && !existing.assignedUserId && body.assignedUserId === undefined) {
            updateData.assignedUser = { connect: { id: user.id } };
          }
        }

        updateData.adminCustomerId = body.adminCustomerId ? body.adminCustomerId.trim() : null;
      }

      if (body.firstContactDate !== undefined) {
        updateData.firstContactDate = body.firstContactDate ? new Date(body.firstContactDate) : null;
      }

      const updated = await prisma.contact.update({
        where: { id },
        data: updateData,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      if (existing.status !== updated.status) {
        const org = await prisma.organization.findUnique({
          where: { id: user.orgId },
          select: { id: true, name: true },
        });
        void runAutomationRules({
          trigger: 'status_changed',
          orgId: user.orgId,
          org,
          contact: {
            id: updated.id,
            fullName: updated.fullName,
            phone: updated.phone,
            status: updated.status,
            source: updated.source,
            assignedUserId: updated.assignedUserId,
          },
        });
      }

      return updated;
    } catch (err: any) {
      logger.error('[contacts] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update contact', details: err.message, stack: err.stack });
    }
  });

  // POST /api/v1/contacts/:id/tags — update tags only ─────────────────────
  app.post('/api/v1/contacts/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { tags } = request.body as { tags: string[] };

      if (!Array.isArray(tags)) return reply.status(400).send({ error: 'tags must be an array' });

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({ where: { id }, data: { tags } });
      return updated;
    } catch (err) {
      logger.error('[contacts] Update tags error:', err);
      return reply.status(500).send({ error: 'Failed to update tags' });
    }
  });

  // ── DELETE /api/v1/contacts/:id ───────────────────────────────────────────
  app.delete(
    '/api/v1/contacts/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };

        const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
        if (!existing) return reply.status(404).send({ error: 'Contact not found' });

        await prisma.contact.delete({ where: { id } });
        return { success: true };
      } catch (err) {
        logger.error('[contacts] Delete error:', err);
        return reply.status(500).send({ error: 'Failed to delete contact' });
      }
    });

  // ── GET /api/v1/contacts/duplicates — list unresolved duplicate groups ────
  app.get('/api/v1/contacts/duplicates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { page = '1', limit = '20', resolved = 'false' } = request.query as QueryParams;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const where = { orgId: user.orgId, resolved: resolved === 'true' };

      const [groups, total] = await Promise.all([
        prisma.duplicateGroup.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.duplicateGroup.count({ where }),
      ]);

      // Expand contact data for each group
      const expanded = await Promise.all(
        groups.map(async (group) => {
          const contacts = await prisma.contact.findMany({
            where: { id: { in: group.contactIds } },
            select: {
              id: true, fullName: true, phone: true, email: true,
              zaloUid: true, avatarUrl: true, source: true, status: true,
              tags: true, createdAt: true, leadScore: true, lastActivity: true,
            },
          });
          return { ...group, contacts };
        }),
      );

      return { groups: expanded, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] Duplicates list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch duplicate groups' });
    }
  });

  // ── POST /api/v1/contacts/duplicates/:groupId/merge — merge a group ──────
  app.post(
    '/api/v1/contacts/duplicates/:groupId/merge',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { groupId } = request.params as { groupId: string };
        const { primaryContactId } = request.body as { primaryContactId: string };

        if (!primaryContactId) return reply.status(400).send({ error: 'primaryContactId is required' });

        const group = await prisma.duplicateGroup.findFirst({
          where: { id: groupId, orgId: user.orgId, resolved: false },
        });
        if (!group) return reply.status(404).send({ error: 'Duplicate group not found' });

        const secondaryIds = group.contactIds.filter((id) => id !== primaryContactId);
        if (secondaryIds.length === 0) return reply.status(400).send({ error: 'Primary must be in the group' });

        const merged = await mergeContacts(user.orgId, user.id, primaryContactId, secondaryIds);

        // Resolve the group
        await prisma.duplicateGroup.update({ where: { id: groupId }, data: { resolved: true } });

        return merged;
      } catch (err: any) {
        logger.error('[contacts] Merge error:', err);
        return reply.status(400).send({ error: err.message || 'Failed to merge contacts' });
      }
    });

  // ── POST /api/v1/contacts/intelligence/recompute — manual trigger ────────
  app.post(
    '/api/v1/contacts/intelligence/recompute',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Fire and forget — return 202 immediately
        runContactIntelligence().catch((err) => {
          logger.error('[contacts] Recompute error:', err);
        });
        return reply.status(202).send({ message: 'Intelligence recompute started' });
      } catch (err) {
        logger.error('[contacts] Recompute trigger error:', err);
        return reply.status(500).send({ error: 'Failed to start recompute' });
      }
    });
}
