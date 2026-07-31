import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { ErpSyncService } from './erp-sync-service.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import crypto from 'node:crypto';
import { sendRpcToAgent } from '../agent/agent-socket.js';

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

async function runZaloMethod(userOrgId: string, accountId: string, method: string, args: any[] = []) {
  const activeAgent = await prisma.zaloDesktopAgent.findFirst({
    where: { orgId: userOrgId, status: 'active' }
  });

  const safeArgs = args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg);

  if (activeAgent) {
    return sendRpcToAgent(userOrgId, method, { accountId, args: safeArgs });
  } else {
    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) throw new Error('Tài khoản Zalo chưa được kết nối');
    return (instance.api as any)[method](...args);
  }
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
          where: { orgId: user.orgId, status: 'connected', isFriendRequestLocked: false },
          select: { id: true, displayName: true },
        });

        if (!zaloAccounts.length) {
          return reply.status(422).send({ error: 'Không có tài khoản Zalo nào đang kết nối' });
        }

        // Đếm số bạn bè của từng account, chọn cái ít nhất
        const accountsWithCount = await Promise.all(
          zaloAccounts.map(async (acc) => {
            try {
              const friends = await runZaloMethod(user.orgId, acc.id, 'getAllFriends', []);
              return { acc, count: Object.keys(friends || {}).length };
            } catch {
              return { acc, count: Infinity };
            }
          })
        );
        const bestAccount = accountsWithCount.sort((a, b) => a.count - b.count)[0];
        const selectedAccountId = bestAccount && bestAccount.count !== Infinity ? bestAccount.acc.id : zaloAccounts[0].id;

        // 6. Tìm user Zalo theo số điện thoại
        let zaloUser: any = null;
        try {
          zaloUser = await runZaloMethod(user.orgId, selectedAccountId, 'findUser', [phone]);
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
          await runZaloMethod(user.orgId, selectedAccountId, 'sendFriendRequest', ['Xin chào! Tôi muốn kết nối với bạn.', zaloUser.uid]);
          logger.info(`[ERP-OPEN-CHAT] Đã gửi kết bạn tới Zalo UID ${zaloUser.uid} qua account ${selectedAccountId}`);
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
        // Thay vì gửi luôn, đưa vào hàng đợi (GroupMessageQueue)
        const queueItem = await prisma.groupMessageQueue.create({
          data: {
            orgId,
            groupId,
            message,
            status: 'pending'
          }
        });

        logger.info(`[ERP-GROUP-MESSAGE] Đã đưa tin nhắn vào hàng đợi: ${queueItem.id}`);

        return {
          status: 'success',
          message: 'Gửi tin nhắn nhóm thành công (đã đưa vào hàng đợi)',
          queueId: queueItem.id
        };

      } catch (err: any) {
        logger.error('[ERP-GROUP-MESSAGE] Lỗi khi đưa vào hàng đợi:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi hệ thống' });
      }
    },
  });

  app.get('/api/v1/erp/test-zalo-send', async (request, reply) => {
    const { uid, accountId } = request.query as any;
    if (!uid || !accountId) return { error: 'Missing uid or accountId' };
    
    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) return { error: 'Account not connected' };
    
    try {
      const response = await instance.api.sendMessage('Test message from API route', uid, 0);
      return { success: true, response };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  app.get('/api/v1/erp/check-contact', async (request, reply) => {
    const { phone } = request.query as any;
    const contact = await prisma.contact.findFirst({
      where: { phone: { contains: phone } },
      include: { conversations: true }
    });
    
    const contactByName = await prisma.contact.findFirst({
      where: { fullName: { contains: 'Ngô Hoàng' } },
      include: { conversations: true }
    });

    return { 
      byPhone: contact ? {
        id: contact.id,
        zaloUid: contact.zaloUid,
        conversations: contact.conversations.map(c => c.externalThreadId)
      } : null,
      byName: contactByName ? {
        id: contactByName.id,
        zaloUid: contactByName.zaloUid,
        conversations: contactByName.conversations.map(c => c.externalThreadId)
      } : null
    };
  });

  // 5. POST /api/v1/erp/notifications - Queue notifications from ERP
  app.post('/api/v1/erp/notifications', {
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
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

      const { campaignName, webhookUrl, customers } = request.body as {
        campaignName?: string;
        webhookUrl?: string;
        customers: { phone: string; message: string }[];
      };

      if (!customers || !Array.isArray(customers) || customers.length === 0) {
        return reply.status(400).send({ error: 'Danh sách customers trống hoặc không hợp lệ' });
      }

      try {
        // Find connected Zalo Accounts for round-robin
        const accounts = await prisma.zaloAccount.findMany({
          where: { orgId, status: 'connected' },
          select: { id: true }
        });

        if (accounts.length === 0) {
          return reply.status(422).send({ error: 'Không có tài khoản Zalo nào đang kết nối để gửi thông báo' });
        }

        // We need a team to create a bulk campaign. Pick the first team of the org.
        const team = await prisma.team.findFirst({ where: { orgId } });
        if (!team) {
          return reply.status(422).send({ error: 'Hệ thống chưa có nhóm (team) nào được tạo.' });
        }

        // Pick the first user as creator
        const user = await prisma.user.findFirst({ where: { orgId } });
        
        // Create the campaign
        const campaign = await prisma.bulkCampaign.create({
          data: {
            orgId,
            name: campaignName || `ERP Notification ${new Date().toISOString()}`,
            teamId: team.id,
            messageContent: 'ERP Notification',
            scheduledAt: new Date(),
            status: 'pending',
            createdBy: user?.id || '',
            webhookUrl: webhookUrl || null,
          }
        });

        // Create tasks
        const tasks = await Promise.all(customers.map(async (customer, index) => {
          let phone = customer.phone;
          // Find or create a temporary contact
          let contact = await prisma.contact.findFirst({
            where: { orgId, phone }
          });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                orgId,
                fullName: 'Khách ERP',
                phone,
                assignedUserId: user?.id,
              }
            });
          }

          return prisma.bulkCampaignTask.create({
            data: {
              campaignId: campaign.id,
              contactId: contact.id,
              zaloAccountId: accounts[index % accounts.length].id,
              status: 'pending',
              messageContent: customer.message
            }
          });
        }));

        logger.info(`[ERP-NOTIFICATIONS] Created job ${campaign.id} with ${tasks.length} tasks via round-robin across ${accounts.length} accounts.`);

        return {
          status: 'success',
          jobId: campaign.id,
          message: `Đã xếp hàng gửi thông báo cho ${tasks.length} khách hàng.`,
          webhookUrl
        };

      } catch (err: any) {
        logger.error('[ERP-NOTIFICATIONS] Lỗi:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi tạo job thông báo' });
      }
    }
  });

  // 6. GET /api/v1/erp/notifications/:id/status
  app.get('/api/v1/erp/notifications/:id/status', {
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = request.headers['x-api-key'] as string;
      if (!apiKey) {
        return reply.status(401).send({ error: 'Thiếu X-Api-Key trong Header' });
      }
      
      const { id } = request.params as { id: string };

      const setting = await prisma.appSetting.findFirst({
        where: { settingKey: 'public_api_key', valuePlain: apiKey },
      });
      if (!setting) return reply.status(401).send({ error: 'X-Api-Key không hợp lệ' });

      try {
        const campaign = await prisma.bulkCampaign.findFirst({
          where: { id, orgId: setting.orgId },
          include: {
            tasks: {
              include: { contact: true }
            }
          }
        });

        if (!campaign) {
          return reply.status(404).send({ error: 'Không tìm thấy job' });
        }

        const total = campaign.tasks.length;
        const sent = campaign.tasks.filter(t => t.status === 'sent').length;
        const failed = campaign.tasks.filter(t => t.status === 'failed').length;
        const pending = campaign.tasks.filter(t => t.status === 'pending').length;

        const failedTasks = campaign.tasks
          .filter(t => t.status === 'failed')
          .map(t => ({
            phone: t.contact.phone,
            zaloUid: t.contact.zaloUid,
            errorMessage: t.errorMessage
          }));

        return {
          jobId: campaign.id,
          status: campaign.status,
          total,
          sent,
          failed,
          pending,
          failedTasks
        };
      } catch (err: any) {
        logger.error('[ERP-NOTIFICATIONS-STATUS] Lỗi:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi kiểm tra trạng thái' });
      }
    }
  });
}
