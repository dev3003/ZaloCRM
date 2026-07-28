import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import cron from 'node-cron';

// Chạy mỗi 1 phút
export function startGroupMessageCron() {
  cron.schedule('* * * * *', async () => {
    let currentQueueId: string | null = null;
    try {
      // 1. Tìm 1 tin nhắn cũ nhất đang pending
      const queueItem = await prisma.groupMessageQueue.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' }
      });

      if (!queueItem) return; // Không có tin nhắn nào cần gửi
      currentQueueId = queueItem.id;

      // Đổi trạng thái sang processing để tránh cron sau lấy trùng
      await prisma.groupMessageQueue.update({
        where: { id: queueItem.id },
        data: { status: 'processing' }
      });

      const { orgId, groupId, message } = queueItem;

      // 2. Tìm Conversation nhóm tương ứng với groupId
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: groupId,
          orgId: orgId,
          threadType: 'group',
        },
      });

      if (!conversation || !conversation.externalThreadId) {
        await prisma.groupMessageQueue.update({
          where: { id: queueItem.id },
          data: { status: 'failed', error: 'Không tìm thấy nhóm (groupId không hợp lệ hoặc không phải là group)' }
        });
        return;
      }

      // 3. Tìm danh sách tài khoản Zalo đang nằm trong nhóm
      const allGroupConversations = await prisma.conversation.findMany({
        where: {
          orgId: orgId,
          externalThreadId: conversation.externalThreadId,
          threadType: 'group',
        },
        orderBy: { createdAt: 'asc' }, // Tham gia đầu tiên -> tạo sớm nhất
      });

      if (allGroupConversations.length === 0) {
        await prisma.groupMessageQueue.update({
          where: { id: queueItem.id },
          data: { status: 'failed', error: 'Không có tài khoản Zalo nào của hệ thống nằm trong nhóm này' }
        });
        return;
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
        logger.warn(`[ERP-GROUP-MESSAGE-CRON] Có ${allGroupConversations.length} tài khoản Zalo trong nhóm nhưng không có cái nào đang online`);
        await prisma.groupMessageQueue.update({
          where: { id: queueItem.id },
          data: { status: 'failed', error: 'Không có tài khoản Zalo nào trong nhóm đang kết nối để gửi tin' }
        });
        return;
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

      // 4. Gửi tin nhắn qua Zalo Account tìm được
      logger.info(`[ERP-GROUP-MESSAGE-CRON] Gửi tin tới nhóm ${conversation.externalThreadId} qua account ${bestAccountConv.zaloAccountId}`);
      
      const response = await bestInstance.api.sendMessage(
        cleanMessage,
        conversation.externalThreadId,
        1
      );

      if (response && response.error) {
         throw new Error(response.error.message || 'Lỗi từ Zalo API');
      }

      // Thành công
      await prisma.groupMessageQueue.update({
        where: { id: queueItem.id },
        data: { status: 'success' }
      });

    } catch (err: any) {
      logger.error('[ERP-GROUP-MESSAGE-CRON] Lỗi:', err);
      if (currentQueueId) {
        await prisma.groupMessageQueue.update({
          where: { id: currentQueueId },
          data: { status: 'failed', error: err.message || 'Lỗi không xác định' }
        });
      }
    }
  });
}
