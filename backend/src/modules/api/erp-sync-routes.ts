import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { ErpSyncService } from './erp-sync-service.js';

export async function erpSyncRoutes(app: FastifyInstance) {
  // 1. GET /api/v1/erp/mock-data — Mock ERP API for testing (Public)
  app.get('/api/v1/erp/mock-data', async () => {
    return [
      {
        customer_id: '11111',
        sale_id: '55555'
      }
    ];
  });

  // 2. Sync route - Supports both GET and POST for easy testing
  // Requires authentication
  app.route({
    method: ['GET', 'POST'],
    url: '/api/v1/erp/sync',
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      
      // Only owners and admins can trigger sync
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Không có quyền thực hiện thao tác này' });
      }

      try {
        const result = await ErpSyncService.syncAssignments(user.orgId);
        return { 
          message: 'Đồng bộ hoàn tất',
          ...result
        };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Đồng bộ thất bại' });
      }
    }
  });
}
