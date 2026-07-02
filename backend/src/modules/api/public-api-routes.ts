/**
 * public-api-routes.ts — External REST API authenticated via API key (X-Api-Key header).
 * Provides read/write access to contacts, conversations, appointments, and message sending.
 * All routes prefixed /api/public/ — no JWT required, orgId injected from API key lookup.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

// ── API key auth middleware ────────────────────────────────────────────────────

async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'] as string;
  if (!apiKey) return reply.status(401).send({ error: 'API key required' });

  const setting = await prisma.appSetting.findFirst({
    where: { settingKey: 'public_api_key', valuePlain: apiKey },
  });
  if (!setting) return reply.status(401).send({ error: 'Invalid API key' });

  (request as any).orgId = setting.orgId;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);

  // ── Contacts ─────────────────────────────────────────────────────────────

  app.get('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { search = '', status = '', limit = '20' } = request.query as Record<string, string>;

      const where: any = { orgId };
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const contacts = await prisma.contact.findMany({
        where,
        select: {
          id: true, fullName: true, phone: true, email: true,
          source: true, status: true, notes: true, tags: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(parseInt(limit) || 20, 100),
      });

      return { contacts };
    } catch (err) {
      logger.error('[public-api] GET /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  app.get('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };

      const contact = await prisma.contact.findFirst({
        where: { id, orgId },
        include: {
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 5 },
          _count: { select: { conversations: true } },
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });
      return contact;
    } catch (err) {
      logger.error('[public-api] GET /contacts/:id error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  app.post('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.fullName && !body?.phone) {
        return reply.status(400).send({ error: 'fullName or phone is required' });
      }

      const contact = await prisma.contact.create({
        data: {
          orgId,
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          source: body.source,
          status: body.status ?? 'new',
          notes: body.notes,
          tags: body.tags ?? [],
        },
      });

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[public-api] POST /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  app.put('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({
        where: { id },
        data: {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          source: body.source,
          status: body.status,
          notes: body.notes,
          tags: body.tags,
        },
      });

      return updated;
    } catch (err) {
      logger.error('[public-api] PUT /contacts/:id error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── Conversations ─────────────────────────────────────────────────────────

  app.get('/api/public/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { limit = '20' } = request.query as Record<string, string>;

      const conversations = await prisma.conversation.findMany({
        where: { orgId },
        select: {
          id: true, threadType: true, externalThreadId: true,
          lastMessageAt: true, unreadCount: true, isReplied: true,
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: Math.min(parseInt(limit) || 20, 100),
      });

      return { conversations };
    } catch (err) {
      logger.error('[public-api] GET /conversations error:', err);
      return reply.status(500).send({ error: 'Failed to fetch conversations' });
    }
  });

  app.get('/api/public/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const { limit = '50' } = request.query as Record<string, string>;

      const conv = await prisma.conversation.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      const messages = await prisma.message.findMany({
        where: { conversationId: id, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: Math.min(parseInt(limit) || 50, 200),
        select: {
          id: true, senderType: true, senderName: true,
          content: true, contentType: true, sentAt: true, attachments: true,
        },
      });

      return { messages };
    } catch (err) {
      logger.error('[public-api] GET /conversations/:id/messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch messages' });
    }
  });

  // ── Appointments ──────────────────────────────────────────────────────────

  app.get('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { from, to } = request.query as Record<string, string>;

      const where: any = { orgId };
      if (from || to) {
        where.appointmentDate = {};
        if (from) where.appointmentDate.gte = new Date(from);
        if (to) where.appointmentDate.lte = new Date(to);
      }

      const appointments = await prisma.appointment.findMany({
        where,
        include: { contact: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { appointmentDate: 'asc' },
        take: 100,
      });

      return { appointments };
    } catch (err) {
      logger.error('[public-api] GET /appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  app.post('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.contactId || !body?.appointmentDate) {
        return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
      }

      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, orgId }, select: { id: true } });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const appointment = await prisma.appointment.create({
        data: {
          orgId,
          contactId: body.contactId,
          appointmentDate: new Date(body.appointmentDate),
          appointmentTime: body.appointmentTime,
          type: body.type,
          notes: body.notes,
        },
      });

      return reply.status(201).send(appointment);
    } catch (err) {
      logger.error('[public-api] POST /appointments error:', err);
      return reply.status(500).send({ error: 'Failed to create appointment' });
    }
  });

  // ── Messages send ─────────────────────────────────────────────────────────

  app.post('/api/public/messages/send', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.zaloAccountId || !body?.threadId || !body?.content) {
        return reply.status(400).send({ error: 'zaloAccountId, threadId, and content are required' });
      }

      // Verify account belongs to org
      const account = await prisma.zaloAccount.findFirst({
        where: { id: body.zaloAccountId, orgId },
        select: { id: true, status: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
      if (account.status !== 'connected') {
        return reply.status(422).send({ error: 'Zalo account is not connected' });
      }

      // Dynamically import zaloPool to avoid circular deps
      const { zaloPool } = await import('../zalo/zalo-pool.js');
      const api = zaloPool.getApi(body.zaloAccountId);
      if (!api) return reply.status(422).send({ error: 'Zalo account not active in pool' });

      const threadType = body.threadType === 'group' ? 1 : 0;
      await api.sendMessage(body.content, body.threadId, threadType);

      return { success: true };
    } catch (err) {
      logger.error('[public-api] POST /messages/send error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── ERP Webhook ─────────────────────────────────────────────────────────

  app.post('/api/public/erp/sync-assign', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as {
        customer_phone?: string;
        customer_name?: string;
        admin_customer_id?: string;
        admin_sale_id?: string;
      };

      logger.info(`[ERP-WEBHOOK] Nhận tín hiệu đồng bộ từ ERP cho Org ${orgId}: ${JSON.stringify(body)}`);

      if (!body.admin_sale_id) {
        logger.warn(`[ERP-WEBHOOK] Thất bại: Thiếu thông tin admin_sale_id`);
        return reply.status(400).send({
          success: false,
          error: 'admin_sale_id là bắt buộc'
        });
      }

      if (!body.customer_phone && !body.admin_customer_id) {
        logger.warn(`[ERP-WEBHOOK] Thất bại: Cần ít nhất customer_phone hoặc admin_customer_id để định danh khách hàng`);
        return reply.status(400).send({
          success: false,
          error: 'customer_phone hoặc admin_customer_id là bắt buộc'
        });
      }

      // 1. Tìm Sale tương ứng trong hệ thống CRM
      const user = await prisma.user.findFirst({
        where: { orgId, adminSaleId: String(body.admin_sale_id) }
      });

      if (!user) {
        logger.warn(`[ERP-WEBHOOK] Thất bại: Không tìm thấy Sale nào có adminSaleId = "${body.admin_sale_id}"`);
        return reply.status(404).send({
          success: false,
          error: `Không tìm thấy Sale nào có mã adminSaleId = "${body.admin_sale_id}" trên CRM`
        });
      }

      // 2. Tìm Khách hàng hiện tại (Khớp theo số điện thoại hoặc mã ERP)
      let contact = await prisma.contact.findFirst({
        where: {
          orgId,
          OR: [
            body.customer_phone ? { phone: body.customer_phone } : null,
            body.admin_customer_id ? { adminCustomerId: body.admin_customer_id } : null
          ].filter(Boolean) as any
        }
      });

      let action = 'updated';

      if (contact) {
        // Cập nhật thông tin và gán Sale mới
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: {
            assignedUserId: user.id,
            adminCustomerId: body.admin_customer_id || contact.adminCustomerId,
            fullName: body.customer_name || contact.fullName,
            phone: body.customer_phone || contact.phone
          }
        });
        logger.info(`[ERP-WEBHOOK] Đã cập nhật Khách hàng "${contact.fullName}" (ID: ${contact.id}) sang cho Sale "${user.email}"`);
      } else {
        // Tạo mới Khách hàng và gán Sale luôn (Giải quyết việc CRM trắng dữ liệu)
        contact = await prisma.contact.create({
          data: {
            orgId,
            fullName: body.customer_name || 'Khách hàng ERP',
            phone: body.customer_phone || null,
            adminCustomerId: body.admin_customer_id || null,
            assignedUserId: user.id,
            status: 'new'
          }
        });
        action = 'created';
        logger.info(`[ERP-WEBHOOK] Đã tạo mới Khách hàng "${contact.fullName}" (ID: ${contact.id}) và gán cho Sale "${user.email}"`);
      }

      return {
        success: true,
        message: action === 'created' ? 'Đã tạo mới khách hàng và gán Sale thành công' : 'Đã cập nhật phân bổ Sale thành công',
        data: {
          contactId: contact.id,
          fullName: contact.fullName,
          phone: contact.phone,
          adminCustomerId: contact.adminCustomerId,
          assignedUser: {
            id: user.id,
            email: user.email,
            adminSaleId: user.adminSaleId
          },
          action
        }
      };
    } catch (err: any) {
      logger.error('[ERP-WEBHOOK] Lỗi xử lý webhook:', err);
      return reply.status(500).send({
        success: false,
        error: err.message || 'Lỗi xử lý đồng bộ phía CRM'
      });
    }
  });
}
