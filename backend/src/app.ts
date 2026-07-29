import 'dotenv/config';
/**
 * Main application entry point.
 * Bootstraps Fastify server with all plugins, Socket.IO, and route handlers.
 * The process never exits — all errors are caught and logged.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { supportSessionRoutes } from './modules/chat/support-session-routes.js';
import { chatAttachmentRoutes } from './modules/chat/chat-attachment-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { bulkCampaignRoutes } from './modules/contacts/bulk-campaign-routes.js';
import { startBulkCampaignCron } from './modules/contacts/bulk-campaign-cron.js';
import { startGroupMessageCron } from './modules/contacts/group-message-cron.js';
import { startAppointmentReminder } from './modules/contacts/appointment-reminder.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { zaloFriendRoutes } from './modules/zalo/zalo-friend-routes.js';
import { zaloGroupRoutes } from './modules/zalo/zalo-group-routes.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { registerZaloSocketHandlers } from './modules/zalo/zalo-socket.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { startZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { erpSyncRoutes } from './modules/api/erp-sync-routes.js';
import storageConfigRoutes from './modules/api/storage-config-routes.js';
import { mediaProxyRoutes } from './modules/api/media-proxy-routes.js';
import { agentRoutes } from './modules/agent/agent-routes.js';
import { setupAgentSocket } from './modules/agent/agent-socket.js';

import { analyticsRoutes } from './modules/analytics/analytics-routes.js';
import { savedReportRoutes } from './modules/analytics/saved-report-routes.js';
import { integrationRoutes } from './modules/integrations/integration-routes.js';
import { automationRoutes } from './modules/automation/automation-routes.js';
import { templateRoutes } from './modules/automation/template-routes.js';
import { aiRoutes } from './modules/ai/ai-routes.js';
import { startStorageCron } from './modules/storage/storage-cron.js';
import { initArchivingCron } from './modules/chat/archiving-cron.js';
import { startSupportSessionCron } from './modules/automation/support-session-cron.js';
import { superAdminRoutes } from './modules/super-admin/super-admin-routes.js';
import { zaloAgentKeyRoutes } from './modules/zalo/zalo-agent-key-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const app = Fastify({ logger: false });

  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: config.isProduction ? config.appUrl : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    // Skip rate limiting for static assets — only limit API routes
    allowList: (request: { url: string }) => !request.url.startsWith('/api/'),
  });

  // Handle multipart uploads for attachments (500MB limit)
  const { default: fastifyMultipart } = await import('@fastify/multipart');
  await app.register(fastifyMultipart, {
    limits: { fileSize: 500 * 1024 * 1024 },
    attachFieldsToBody: false
  });

  // Serve compiled frontend assets in production
  if (config.isProduction) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, '../static'),
      prefix: '/',
    });
  }

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  const io = new Server(app.server, {
    cors: {
      origin: config.isProduction ? config.appUrl : '*',
      credentials: true,
    },
  });

  // Attach io to app so route handlers can emit events
  app.decorate('io', io);

  // Pass io to zalo pool for real-time event emission
  zaloPool.setIO(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = app.jwt.verify(token);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    logger.info(`Socket connected: ${socket.id} (User: ${user.id})`);

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  // Register Zalo Socket.IO event handlers
  registerZaloSocketHandlers(io);
  setupAgentSocket(io);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(supportSessionRoutes);
  await app.register(chatAttachmentRoutes, { prefix: '/api/v1' });
  await app.register(contactRoutes);
  await app.register(contactSubResourceRoutes);
  await app.register(appointmentRoutes);
  await app.register(bulkCampaignRoutes);
  await app.register(dashboardRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  await app.register(teamRoutes);
  await app.register(orgRoutes);
  await app.register(zaloAccessRoutes);
  await app.register(zaloSyncRoutes);
  await app.register(zaloFriendRoutes);
  await app.register(zaloGroupRoutes);
  await app.register(notificationRoutes);
  await app.register(publicApiRoutes);
  await app.register(webhookSettingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(savedReportRoutes);
  await app.register(integrationRoutes);
  await app.register(automationRoutes);
  await app.register(templateRoutes);
  await app.register(aiRoutes);
  await app.register(erpSyncRoutes);
  await app.register(storageConfigRoutes);
  await app.register(mediaProxyRoutes);
  await app.register(agentRoutes);
  await app.register(superAdminRoutes);
  await app.register(zaloAgentKeyRoutes);

  // Liveness/readiness probe — also checks DB connectivity
  app.get('/health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', db: 'disconnected', timestamp: new Date().toISOString() };
    }
  });

  // API version banner
  app.get('/api/v1/status', async () => {
    return { version: '1.0.0', name: 'Zalo CRM' };
  });

  // Root route - Welcome message
  app.get('/', async () => {
    return {
      message: 'Zalo CRM API is running',
      status: 'online',
      version: '1.0.0',
      frontend_url: config.appUrl
    };
  });

  // SPA fallback — serve index.html for non-API routes in production
  if (config.isProduction) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error('Request error:', error.message);
    reply.status(error.statusCode ?? 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

async function ensureSuperAdminExists() {
  try {
    const email = 'superadmin@omni360.vn';
    const password = 'SuperAdmin@360';
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({
      where: { email }
    });

    if (!existing) {
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: 'Super Admin Omni360',
          role: 'superadmin',
          isActive: true,
        }
      });
      logger.info(`[SUPERADMIN] Auto-seeded Super Admin account (${email})`);
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: 'superadmin',
          passwordHash,
          isActive: true,
        }
      });
      logger.info(`[SUPERADMIN] Reset & ensured Super Admin account credentials (${email})`);
    }
  } catch (err: any) {
    logger.error('[SUPERADMIN] Auto-seed check failed:', err.message || err);
  }
}

  // ── Start ─────────────────────────────────────────────────────────────────

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Zalo CRM running on http://${config.host}:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    await ensureSuperAdminExists();
    startAppointmentReminder(io);
    startZaloHealthCheck();
    startBulkCampaignCron();
    startGroupMessageCron();
    startStorageCron();
    initArchivingCron();
    startSupportSessionCron(io);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Reconnect Zalo accounts that have saved sessions
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull } },
      select: { id: true, sessionData: true },
    });
    logger.info(`Attempting reconnect for ${accounts.length} Zalo account(s)`);
    for (const account of accounts) {
      const session = account.sessionData as {
        cookie: any;
        imei: string;
        userAgent: string;
      } | null;
      if (session?.imei) {
        zaloPool.reconnect(account.id, session).catch((err) => {
          logger.warn(`Auto-reconnect failed for account ${account.id}:`, err);
        });
      }
    }
  } catch (err) {
    logger.error('Failed to load accounts for reconnect:', err);
  }
}

// Keep process alive — log but never crash on unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

bootstrap();
