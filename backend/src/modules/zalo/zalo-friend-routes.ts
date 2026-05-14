import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export async function zaloFriendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /api/v1/zalo-accounts/:id/friends/request
  app.post<{ Params: { id: string }; Body: { friendId: string; message?: string } }>(
    '/api/v1/zalo-accounts/:id/friends/request',
    async (request, reply) => {
      const { id } = request.params;
      const { friendId, message = 'Chào bạn, mình kết bạn nhé!' } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        await instance.api.sendFriendRequest(message, friendId);
        return { success: true, message: 'Đã gửi lời mời kết bạn' };
      } catch (err) {
        logger.error(`[zalo-friend] sendFriendRequest error:`, err);
        return reply.status(500).send({ error: 'Gửi lời mời kết bạn thất bại' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/friends/accept
  app.post<{ Params: { id: string }; Body: { friendId: string } }>(
    '/api/v1/zalo-accounts/:id/friends/accept',
    async (request, reply) => {
      const { id } = request.params;
      const { friendId } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        await instance.api.acceptFriendRequest(friendId);
        return { success: true, message: 'Đã chấp nhận kết bạn' };
      } catch (err) {
        logger.error(`[zalo-friend] acceptFriendRequest error:`, err);
        return reply.status(500).send({ error: 'Chấp nhận kết bạn thất bại' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/friends/reject
  app.post<{ Params: { id: string }; Body: { friendId: string } }>(
    '/api/v1/zalo-accounts/:id/friends/reject',
    async (request, reply) => {
      const { id } = request.params;
      const { friendId } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        await instance.api.rejectFriendRequest(friendId);
        return { success: true, message: 'Đã từ chối kết bạn' };
      } catch (err) {
        logger.error(`[zalo-friend] rejectFriendRequest error:`, err);
        return reply.status(500).send({ error: 'Từ chối kết bạn thất bại' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/friends/undo
  app.post<{ Params: { id: string }; Body: { friendId: string } }>(
    '/api/v1/zalo-accounts/:id/friends/undo',
    async (request, reply) => {
      const { id } = request.params;
      const { friendId } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        await instance.api.undoFriendRequest(friendId);
        return { success: true, message: 'Đã thu hồi lời mời kết bạn' };
      } catch (err) {
        logger.error(`[zalo-friend] undoFriendRequest error:`, err);
        return reply.status(500).send({ error: 'Thu hồi lời mời thất bại' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/friends/requests/received
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/friends/requests/received',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const res = await instance.api.getFriendRecommendations();
        // Filter type 2: ReceivedFriendRequest
        const requests = (res.recommItems || [])
          .filter((item: any) => item.dataInfo?.recommType === 2)
          .map((item: any) => item.dataInfo);
        return requests;
      } catch (err) {
        logger.error(`[zalo-friend] getReceivedRequests error:`, err);
        return reply.status(500).send({ error: 'Không thể lấy danh sách lời mời đã nhận' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/friends/requests/sent
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/friends/requests/sent',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const res = await instance.api.getSentFriendRequest();
        // res is usually an object map where keys are uids
        const requests = res ? Object.values(res) : [];
        return requests;
      } catch (err) {
        logger.error(`[zalo-friend] getSentRequests error:`, err);
        // Return empty array instead of 500 to keep UI working
        return [];
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/friends/status/:friendId
  app.get<{ Params: { id: string; friendId: string } }>(
    '/api/v1/zalo-accounts/:id/friends/status/:friendId',
    async (request, reply) => {
      const { id, friendId } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const status = await instance.api.getFriendRequestStatus(friendId);
        logger.info(`[zalo-friend] Status for account ${id} and friend ${friendId}:`, status);
        return status;
      } catch (err) {
        logger.error(`[zalo-friend] getFriendRequestStatus error:`, err);
        return reply.status(500).send({ error: 'Không thể lấy trạng thái kết bạn' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/friends/search/:phone
  app.get<{ Params: { id: string; phone: string } }>(
    '/api/v1/zalo-accounts/:id/friends/search/:phone',
    async (request, reply) => {
      const { id, phone } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const result = await instance.api.findUser(phone);
        return result;
      } catch (err: any) {
        // Zalo often returns an error if phone is not found or invalid
        logger.warn(`[zalo-friend] findUser error for ${phone}:`, err.message || err);
        return reply.status(404).send({ error: 'Không tìm thấy người dùng Zalo với số điện thoại này' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/friends
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/friends',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const result = await instance.api.getAllFriends();
        // result is an object map where keys are uids
        const friends = Object.values(result || {});
        return friends;
      } catch (err) {
        logger.error(`[zalo-friend] getAllFriends error:`, err);
        return reply.status(500).send({ error: 'Không thể lấy danh sách bạn bè' });
      }
    }
  );
}
