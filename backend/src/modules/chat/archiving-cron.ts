import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import axios from 'axios';

// Archive messages older than 3 months (approx 90 days)
const ARCHIVE_THRESHOLD_DAYS = 90;

export function initArchivingCron() {
  // Run at 02:00 AM every day
  cron.schedule('0 2 * * *', async () => {
    logger.info('[ArchivingCron] Starting daily message archiving job...');
    await runArchivingJob();
  });
}

export async function runArchivingJob() {
  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - ARCHIVE_THRESHOLD_DAYS);

    // 1. Get all organizations
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });

    for (const org of orgs) {
      try {
        await archiveOrgMessages(org, thresholdDate);
      } catch (err) {
        logger.error(`[ArchivingCron] Failed to archive for org ${org.id}:`, err);
      }
    }
  } catch (err) {
    logger.error('[ArchivingCron] Fatal error in archiving job:', err);
  }
}

async function archiveOrgMessages(org: { id: string, name: string }, thresholdDate: Date) {
  // Find distinct conversations in this org that have messages older than threshold
  const oldMessages = await prisma.message.findMany({
    where: {
      conversation: { orgId: org.id },
      sentAt: { lt: thresholdDate }
    },
    orderBy: { sentAt: 'asc' },
    select: {
      id: true,
      conversationId: true,
      zaloMsgId: true,
      cliMsgId: true,
      senderType: true,
      senderUid: true,
      senderName: true,
      content: true,
      contentType: true,
      attachments: true,
      isDeleted: true,
      deletedAt: true,
      sentAt: true,
      repliedByUserId: true,
      createdAt: true,
      fileStatus: true,
      isUnread: true,
      album_index: true,
      album_key: true,
      album_total: true,
      quote: true,
      reaction: true,
    }
  });

  if (oldMessages.length === 0) return;

  // Group messages by conversationId
  const messagesByConv: Record<string, typeof oldMessages> = {};
  for (const msg of oldMessages) {
    if (!messagesByConv[msg.conversationId]) {
      messagesByConv[msg.conversationId] = [];
    }
    messagesByConv[msg.conversationId].push(msg);
  }

  let totalArchived = 0;

  // Archive and delete batch by batch (conversation by conversation)
  for (const [conversationId, msgs] of Object.entries(messagesByConv)) {
    // 1. Save to ArchivedMessage
    const startDate = msgs[0].sentAt;
    const endDate = msgs[msgs.length - 1].sentAt;

    await prisma.archivedMessage.create({
      data: {
        orgId: org.id,
        conversationId,
        startDate,
        endDate,
        messageCount: msgs.length,
        data: msgs as any, // JSON serialization
      }
    });

    // 2. Delete from Message
    const msgIds = msgs.map(m => m.id);
    await prisma.message.deleteMany({
      where: { id: { in: msgIds } }
    });

    totalArchived += msgs.length;
  }

  logger.info(`[ArchivingCron] Archived ${totalArchived} messages for Org ${org.name}`);

  // Send notification to webhook if configured
  await notifyAdmin(org.id, org.name, totalArchived);
}

async function notifyAdmin(orgId: string, orgName: string, count: number) {
  try {
    const setting = await prisma.appSetting.findFirst({
      where: { orgId, settingKey: 'CRON_LOG_WEBHOOK_URL' }
    });

    if (!setting || !setting.valuePlain) return;

    const webhookUrl = setting.valuePlain;
    const message = `🔔 *Hệ thống Zalo CRM*\n\nĐã nén và dọn dẹp thành công *${count}* tin nhắn cũ (hơn ${ARCHIVE_THRESHOLD_DAYS} ngày) cho trung tâm *${orgName}*.\nBảng dữ liệu đã được tối ưu tốc độ.`;

    // Try sending as Telegram format first
    if (webhookUrl.includes('api.telegram.org')) {
      const chatIdSetting = await prisma.appSetting.findFirst({
        where: { orgId, settingKey: 'CRON_LOG_TELEGRAM_CHAT_ID' }
      });
      if (chatIdSetting?.valuePlain) {
        await axios.post(webhookUrl, {
          chat_id: chatIdSetting.valuePlain,
          text: message,
          parse_mode: 'Markdown'
        });
        return;
      }
    }

    // Generic webhook (e.g. Zalo OA webhook, Discord, etc)
    await axios.post(webhookUrl, { message });

  } catch (err) {
    logger.error(`[ArchivingCron] Failed to send webhook notification for org ${orgId}:`, err);
  }
}
