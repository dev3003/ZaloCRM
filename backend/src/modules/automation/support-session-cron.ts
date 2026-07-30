import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js'; // To access io, or pass io directly

export function startSupportSessionCron(io: any) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const expiredSessions = await prisma.supportSession.findMany({
        where: {
          status: 'active',
          expiresAt: { lte: new Date() }
        }
      });

      if (expiredSessions.length === 0) return;

      const expiredIds = expiredSessions.map(s => s.id);

      await prisma.supportSession.updateMany({
        where: { id: { in: expiredIds } },
        data: { status: 'expired' }
      });

      // Notify clients
      if (io) {
        for (const session of expiredSessions) {
          io.to(`user:${session.sharedWithUserId}`).emit('support_session:expired', {
            sessionId: session.id,
            conversationId: session.conversationId
          });
          io.to(`user:${session.sharedByUserId}`).emit('support_session:expired', {
            sessionId: session.id,
            conversationId: session.conversationId
          });
        }
      }

      logger.info(`[support-session-cron] Expired ${expiredSessions.length} sessions`);
    } catch (err) {
      logger.error('[support-session-cron] Error running cron:', err);
    }
  });
}
