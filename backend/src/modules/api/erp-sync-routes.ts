import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { ErpSyncService } from './erp-sync-service.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import crypto from 'node:crypto';

/**
 * Giải mã số điện thoại AES-128-CBC từ ERP Admin
 * Key và IV do 2 bên thống nhất (lưu trong AppSetting: erp_decrypt_key)
 */
function decryptPhone(encrypted: string, key: string): string {
  const keyBuf = Buffer.from(key.substring(0, 16), 'utf8');
  const iv = Buffer.from(key.substring(0, 16), 'utf8');
  // URL-decode nếu cần, sau đó Base64 decode
  const encryptedBuf = Buffer.from(decodeURIComponent(encrypted), 'base64');
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, iv);
  return decipher.update(encryptedBuf).toString('utf8') + decipher.final('utf8');
}

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
  // 3. POST /api/v1/erp/open-chat — Mở chat từ ERP Admin (click icon Zalo)
  // Nhận cid (adminCustomerId), phone_encrypted, sid (adminSaleId)
  // Tìm/tạo contact, kết bạn Zalo nếu cần, trả về conversationId hoặc contactId
  app.post('/api/v1/erp/open-chat', {
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { cid, phone_encrypted, sid } = request.body as {
        cid: string;
        phone_encrypted: string;
        sid?: string;
      };

      if (!cid || !phone_encrypted) {
        return reply.status(400).send({ error: 'cid và phone_encrypted là bắt buộc' });
      }

      try {
        // 1. Lấy key giải mã từ AppSetting
        const keySetting = await prisma.appSetting.findFirst({
          where: { orgId: user.orgId, settingKey: 'erp_decrypt_key' },
        });
        if (!keySetting?.valuePlain) {
          return reply.status(400).send({ error: 'Chưa cấu hình erp_decrypt_key trong Settings' });
        }
        const decryptKey = keySetting.valuePlain;

        // 2. Giải mã số điện thoại
        let phone = '';
        try {
          phone = decryptPhone(phone_encrypted, decryptKey);
        } catch (decErr) {
          logger.error('[ERP-OPEN-CHAT] Giải mã SĐT thất bại:', decErr);
          return reply.status(400).send({ error: 'Không thể giải mã số điện thoại. Kiểm tra lại key và dữ liệu mã hóa.' });
        }

        logger.info(`[ERP-OPEN-CHAT] cid=${cid}, phone=${phone}, sid=${sid}`);

        // 3. Tìm contact theo adminCustomerId hoặc số điện thoại
        let contact = await prisma.contact.findFirst({
          where: {
            orgId: user.orgId,
            OR: [
              { adminCustomerId: cid },
              phone ? { phone } : undefined,
            ].filter(Boolean) as any,
          },
          include: {
            conversations: {
              where: { orgId: user.orgId },
              orderBy: { lastMessageAt: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        });

        // 4. Nếu contact đã có conversation Zalo → trả về ngay
        if (contact?.conversations?.length) {
          logger.info(`[ERP-OPEN-CHAT] Đã có conversation: ${contact.conversations[0].id}`);
          return {
            status: 'found',
            conversationId: contact.conversations[0].id,
            contactId: contact.id,
          };
        }

        // 5. Chưa có conversation → tìm Zalo account ít bạn nhất để kết bạn
        const zaloAccounts = await prisma.zaloAccount.findMany({
          where: { orgId: user.orgId, status: 'connected' },
          select: { id: true, displayName: true },
        });

        if (!zaloAccounts.length) {
          return reply.status(422).send({ error: 'Không có tài khoản Zalo nào đang kết nối' });
        }

        // Đếm số bạn bè của từng account, chọn cái ít nhất
        const accountsWithCount = await Promise.all(
          zaloAccounts.map(async (acc) => {
            try {
              const instance = zaloPool.getInstance(acc.id);
              const friends = await instance?.api?.getAllFriends();
              return { acc, count: Object.keys(friends || {}).length };
            } catch {
              return { acc, count: Infinity };
            }
          })
        );
        const bestAccount = accountsWithCount.sort((a, b) => a.count - b.count)[0];
        const bestInstance = zaloPool.getInstance(bestAccount.acc.id);

        if (!bestInstance?.api) {
          return reply.status(422).send({ error: 'Tài khoản Zalo không khả dụng' });
        }

        // 6. Tìm user Zalo theo số điện thoại
        let zaloUser: any = null;
        try {
          zaloUser = await bestInstance.api.findUser(phone);
        } catch (findErr) {
          logger.warn(`[ERP-OPEN-CHAT] Không tìm thấy Zalo cho SĐT ${phone}:`, findErr);
        }

        if (!zaloUser?.uid) {
          // Không tìm thấy Zalo → vẫn tạo/cập nhật contact nhưng báo không có Zalo
          let isSaleMissing = false;
          if (!contact) {
            // Tìm sale để gán
            let assignedUserId: string | undefined;
            if (sid) {
              const saleUser = await prisma.user.findFirst({ where: { orgId: user.orgId, adminSaleId: sid } });
              assignedUserId = saleUser?.id;
              if (!assignedUserId) isSaleMissing = true;
            }
            contact = await prisma.contact.create({
              data: {
                orgId: user.orgId,
                fullName: 'Khách ERP',
                phone,
                adminCustomerId: cid,
                assignedUserId: assignedUserId || user.id,
                status: 'new',
              },
              include: { conversations: { take: 1, select: { id: true } } },
            });
          }
          return {
            status: 'zalo_not_found',
            contactId: contact.id,
            message: `Số điện thoại ${phone} chưa đăng ký Zalo` + (isSaleMissing ? '. id sale không tồn tại, vui lòng liên hệ admin để gán lại sale vào khách hàng này' : ''),
          };
        }

        // 7. Gửi lời mời kết bạn
        try {
          await bestInstance.api.sendFriendRequest('Xin chào! Tôi muốn kết nối với bạn.', zaloUser.uid);
          logger.info(`[ERP-OPEN-CHAT] Đã gửi kết bạn tới Zalo UID ${zaloUser.uid} qua account ${bestAccount.acc.id}`);
        } catch (friendErr) {
          logger.warn(`[ERP-OPEN-CHAT] Gửi kết bạn thất bại (có thể đã là bạn):`, friendErr);
        }

        // 8. Tìm sale để gán
        let assignedUserId: string | undefined;
        let isSaleMissing = false;
        if (sid) {
          const saleUser = await prisma.user.findFirst({ where: { orgId: user.orgId, adminSaleId: sid } });
          assignedUserId = saleUser?.id;
          if (!assignedUserId) {
            logger.warn(`[ERP-OPEN-CHAT] Không tìm thấy sale với adminSaleId=${sid}`);
            isSaleMissing = true;
          }
        }

        // 9. Kiểm tra xem Zalo UID này đã tồn tại trong CRM chưa
        let existingByZaloUid: any = null;
        if (zaloUser?.uid) {
          existingByZaloUid = await prisma.contact.findFirst({
            where: { orgId: user.orgId, zaloUid: zaloUser.uid },
            include: {
              conversations: {
                where: { orgId: user.orgId },
                orderBy: { lastMessageAt: 'desc' },
                take: 1,
                select: { id: true },
              },
            },
          });
        }

        // Ưu tiên contact tìm được theo Phone/CID (bước 3), nếu không có thì lấy theo Zalo UID
        contact = contact || existingByZaloUid;

        if (contact) {
          // Cập nhật lại Contact có sẵn
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              adminCustomerId: cid,
              phone: phone || contact.phone,
              // Cập nhật tên thật từ Zalo nếu đang là Khách ERP
              fullName: (contact.fullName === 'Khách ERP' || !contact.fullName) && (zaloUser?.displayName || zaloUser?.zaloName) ? (zaloUser.displayName || zaloUser.zaloName) : contact.fullName,
              avatarUrl: zaloUser?.avatar || zaloUser?.avatarUrl || contact.avatarUrl,
              zaloUid: zaloUser?.uid || contact.zaloUid,
              ...(assignedUserId ? { assignedUserId } : {}),
            },
            include: { conversations: { take: 1, select: { id: true } } },
          });
        } else {
          // Hoàn toàn mới -> Tạo mới Contact và lưu Zalo UID ngay lập tức!
          contact = await prisma.contact.create({
            data: {
              orgId: user.orgId,
              fullName: zaloUser?.displayName || zaloUser?.zaloName || 'Khách ERP',
              avatarUrl: zaloUser?.avatar || zaloUser?.avatarUrl,
              phone,
              zaloUid: zaloUser?.uid, // <-- FIX QUAN TRỌNG: LƯU ZALO UID
              adminCustomerId: cid,
              assignedUserId: assignedUserId || user.id,
              status: 'new',
            },
            include: { conversations: { take: 1, select: { id: true } } },
          });
        }

        // 10. Đảm bảo tạo sẵn một Conversation liên kết đúng vào Contact này
        if (zaloUser?.uid && contact) {
          const conv = await prisma.conversation.upsert({
            where: {
              zaloAccountId_externalThreadId: {
                zaloAccountId: bestAccount.acc.id,
                externalThreadId: zaloUser.uid
              }
            },
            update: {
              contactId: contact.id // Đảm bảo Conversation luôn trỏ về Contact hợp nhất này
            },
            create: {
              orgId: user.orgId,
              zaloAccountId: bestAccount.acc.id,
              contactId: contact.id,
              threadType: 'user',
              externalThreadId: zaloUser.uid,
              isReplied: true,
              lastMessageAt: new Date(),
            }
          });
          contact.conversations = [conv];
        }

        logger.info(`[ERP-OPEN-CHAT] Đã xử lý xong contact ${contact.id}, gán sale ${assignedUserId}`);

        return {
          status: 'friend_requested',
          contactId: contact.id,
          zaloUid: zaloUser.uid,
          zaloAccountId: bestAccount.acc.id,
          message: isSaleMissing 
            ? 'Đã gửi lời mời kết bạn. id sale không tồn tại, vui lòng liên hệ admin để gán lại sale vào khách hàng này'
            : 'Đã gửi lời mời kết bạn. Cuộc chat sẽ xuất hiện khi khách chấp nhận.',
        };
      } catch (err: any) {
        logger.error('[ERP-OPEN-CHAT] Lỗi:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi xử lý open-chat' });
      }
    },
  });

  // 4. POST /api/v1/erp/send-group-message - Gửi tin nhắn nhóm từ ERP
  app.post('/api/v1/erp/send-group-message', {
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      // BẢO MẬT: Dùng X-Api-Key thay vì Bearer Token để an toàn cho giao tiếp server-to-server
      const apiKey = request.headers['x-api-key'] as string;
      if (!apiKey) {
        return reply.status(401).send({ error: 'Thiếu X-Api-Key trong Header' });
      }

      const setting = await prisma.appSetting.findFirst({
        where: { settingKey: 'public_api_key', valuePlain: apiKey },
      });
      
      if (!setting) {
        return reply.status(401).send({ error: 'X-Api-Key không hợp lệ' });
      }

      const orgId = setting.orgId;

      const { groupId, message } = request.body as {
        groupId: string;
        message: string;
      };

      if (!groupId || !message) {
        return reply.status(400).send({ error: 'groupId và message là bắt buộc' });
      }

      try {
        // 1. Tìm Conversation nhóm tương ứng với groupId
        const conversation = await prisma.conversation.findFirst({
          where: {
            id: groupId,
            orgId: orgId,
            threadType: 'group',
          },
        });

        if (!conversation || !conversation.externalThreadId) {
          return reply.status(404).send({ error: 'Không tìm thấy nhóm (groupId không hợp lệ hoặc không phải là group)' });
        }

        // 2. Tìm danh sách tài khoản Zalo đang nằm trong nhóm
        // Trong hệ thống, mỗi tài khoản Zalo sẽ có 1 Conversation group tương ứng.
        // Yêu cầu: lấy số zalo tham gia nhóm đầu tiên để gửi (tức là tạo sớm nhất)
        const allGroupConversations = await prisma.conversation.findMany({
          where: {
            orgId: orgId,
            externalThreadId: conversation.externalThreadId,
            threadType: 'group',
          },
          orderBy: { createdAt: 'asc' }, // Tham gia đầu tiên -> tạo sớm nhất
        });

        if (allGroupConversations.length === 0) {
           return reply.status(404).send({ error: 'Không có tài khoản Zalo nào của hệ thống nằm trong nhóm này' });
        }

        let bestAccountConv = null;
        let bestInstance = null;

        // Thử tìm tài khoản online đầu tiên theo thứ tự tham gia
        for (const conv of allGroupConversations) {
          const instance = zaloPool.getInstance(conv.zaloAccountId);
          if (instance?.api) {
            bestAccountConv = conv;
            bestInstance = instance;
            break;
          }
        }

        if (!bestInstance || !bestAccountConv) {
          logger.warn(`[ERP-GROUP-MESSAGE] Có ${allGroupConversations.length} tài khoản Zalo trong nhóm nhưng không có cái nào đang online`);
          return reply.status(422).send({ error: 'Không có tài khoản Zalo nào trong nhóm đang kết nối để gửi tin' });
        }

        // Xử lý làm sạch nội dung tin nhắn (Xóa thẻ HTML từ ERP)
        let cleanMessage = message || '';
        // 1. Chuyển </p> và <br> thành dấu xuống dòng
        cleanMessage = cleanMessage.replace(/<\/p>/gi, '\n');
        cleanMessage = cleanMessage.replace(/<br\s*[\/]?>/gi, '\n');
        // 2. Xóa toàn bộ các thẻ HTML còn lại (như <strong>, <p>, <em>...)
        cleanMessage = cleanMessage.replace(/<[^>]*>?/gm, '');
        // 3. Giải mã các ký tự HTML cơ bản
        cleanMessage = cleanMessage.replace(/&nbsp;/g, ' ');
        cleanMessage = cleanMessage.replace(/&amp;/g, '&');
        cleanMessage = cleanMessage.replace(/&lt;/g, '<');
        cleanMessage = cleanMessage.replace(/&gt;/g, '>');
        // 4. Xóa các dòng trống dư thừa (gom nhiều dòng trống liên tiếp thành tối đa 2 dòng)
        cleanMessage = cleanMessage.replace(/\n\s*\n/g, '\n\n').trim();

        // 3. Gửi tin nhắn qua Zalo Account tìm được
        logger.info(`[ERP-GROUP-MESSAGE] Gửi tin tới nhóm ${conversation.externalThreadId} qua account ${bestAccountConv.zaloAccountId}`);
        
        // Theo thư viện zalo, type cho group là 1 (nhưng sendMessage tự nhận biết externalThreadId)
        // Tuy nhiên zca-js/zalo-js cũ dùng quote param, hoặc type: 1
        // Tham khảo các API khác trong codebase để gửi group.
        const response = await bestInstance.api.sendMessage(
          cleanMessage,
          conversation.externalThreadId,
          1 // 1 is for group message in zca-js/zalo-js usually
        );

        if (response && response.error) {
           throw new Error(response.error.message || 'Lỗi từ Zalo API');
        }

        // NOTE: Không cần lưu tin nhắn vào CSDL ở đây nữa, 
        // vì zalo-listener-factory.ts sẽ tự động bắt sự kiện 'message' (isSelf=true) 
        // và lưu vào CSDL + update lastMessageAt cho Conversation.

        return {
          status: 'success',
          message: 'Gửi tin nhắn nhóm thành công',
          conversationId: bestAccountConv.id,
          zaloAccountId: bestAccountConv.zaloAccountId,
        };

      } catch (err: any) {
        logger.error('[ERP-GROUP-MESSAGE] Lỗi:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi gửi tin nhắn nhóm' });
      }
    },
  });
}
