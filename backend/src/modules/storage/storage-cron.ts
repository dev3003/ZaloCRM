/**
 * storage-cron.ts — Định kỳ quét các tin nhắn có file chưa tải thành công.
 * Giúp đảm bảo tính toàn vẹn dữ liệu ngay cả khi gặp sự cố mạng tạm thời.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { storageService } from './storage-service.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Khởi tạo tác vụ quét bù.
 * Mặc định chạy mỗi 15 phút.
 */
export function startStorageCron() {
  // Chạy mỗi phút để đảm bảo trải nghiệm real-time
  cron.schedule('* * * * *', async () => {
    logger.info('[storage-cron] Quét tin nhắn để tải file về FTP...');
    
    try {
      // Tìm các tin nhắn có file chưa tải (mới nhận hoặc bị lỗi)
      const unfinishedMessages = await prisma.message.findMany({
        where: {
          contentType: { in: ['image', 'file', 'video', 'voice'] },
          OR: [
            { fileStatus: { in: ['pending', 'failed', 'none'] } },
            { fileStatus: null }
          ],
          // Chỉ quét các tin nhắn trong vòng 7 ngày qua để tránh quá tải
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        take: 50,
        orderBy: { createdAt: 'desc' }
      });

      if (unfinishedMessages.length === 0) {
        logger.debug('[storage-cron] No unfinished files found.');
        return;
      }

      logger.info(`[storage-cron] Found ${unfinishedMessages.length} messages to process.`);

      for (const msg of unfinishedMessages) {
        // Tải file trong một khối try-catch riêng để lỗi của 1 file không làm dừng cả quá trình
        try {
          await storageService.processMessageFiles(msg.id);
        } catch (err) {
          logger.error(`[storage-cron] Failed to process message ${msg.id}:`, err);
        }
      }
      
      logger.info('[storage-cron] Scavenger task completed.');
    } catch (error) {
      logger.error('[storage-cron] Critical error in scavenger task:', error);
    }
  });

  /**
   * TÁC VỤ DỌN DẸP FILE CŨ (60 NGÀY)
   * Chạy vào 3:00 AM mỗi ngày.
   */
  cron.schedule('0 3 * * *', async () => {
    logger.info('[storage-cron] 🧹 Bắt đầu quét và dọn dẹp file cũ (60 ngày)...');
    
    try {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      
      // Tìm các tin nhắn có file đã quá hạn và chưa được đánh dấu là expired
      const expiredMessages = await prisma.message.findMany({
        where: {
          contentType: { in: ['image', 'file', 'video', 'voice'] },
          sentAt: { lt: sixtyDaysAgo },
          fileStatus: 'success', // Chỉ xóa những file đã tải thành công và còn tồn tại
        },
        take: 100, // Mỗi lần dọn 100 file để tránh quá tải
        orderBy: { sentAt: 'asc' }
      });

      if (expiredMessages.length === 0) {
        logger.info('[storage-cron] Không tìm thấy file nào quá hạn 60 ngày.');
        return;
      }

      logger.info(`[storage-cron] Phát hiện ${expiredMessages.length} tin nhắn có file quá hạn. Đang tiến hành xóa...`);

      for (const msg of expiredMessages) {
        try {
          await storageService.deleteMessageFiles(msg.id);
        } catch (err) {
          logger.error(`[storage-cron] Lỗi khi dọn dẹp tin nhắn ${msg.id}:`, err);
        }
      }
      
      logger.info('[storage-cron] ✅ Hoàn tất chu kỳ dọn dẹp file cũ.');
    } catch (error) {
      logger.error('[storage-cron] Lỗi nghiêm trọng trong tác vụ dọn dẹp:', error);
    }
  });
}
