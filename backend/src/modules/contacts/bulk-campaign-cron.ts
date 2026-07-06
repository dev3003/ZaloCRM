import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';

let isRunning = false;

async function processBulkCampaigns() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // 1. Find all pending campaigns that should start now, and mark them as running
    await prisma.bulkCampaign.updateMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now }
      },
      data: { status: 'running' }
    });

    // 2. Fetch all pending tasks for running campaigns
    // We only want to process a maximum of 1 task per Zalo account per minute.
    const pendingTasks = await prisma.bulkCampaignTask.findMany({
      where: {
        status: 'pending',
        campaign: { status: 'running' }
      },
      include: {
        campaign: true,
        contact: true
      },
      orderBy: { createdAt: 'asc' }
    });

    if (pendingTasks.length === 0) {
      // Check if any running campaigns have 0 pending tasks, mark them as completed
      const runningCampaigns = await prisma.bulkCampaign.findMany({
        where: { status: 'running' },
        include: {
          _count: {
            select: { tasks: { where: { status: 'pending' } } }
          }
        }
      });
      for (const campaign of runningCampaigns) {
        if (campaign._count.tasks === 0) {
          await prisma.bulkCampaign.update({
            where: { id: campaign.id },
            data: { status: 'completed' }
          });
          logger.info(`[bulk-campaign] Campaign ${campaign.id} completed.`);
        }
      }
      isRunning = false;
      return;
    }

    // Group tasks by zaloAccountId
    const tasksByAccount: Record<string, typeof pendingTasks> = {};
    for (const task of pendingTasks) {
      if (!tasksByAccount[task.zaloAccountId]) {
        tasksByAccount[task.zaloAccountId] = [];
      }
      tasksByAccount[task.zaloAccountId].push(task);
    }

    // Process exactly 1 task per account
    for (const [zaloAccountId, tasks] of Object.entries(tasksByAccount)) {
      const task = tasks[0]; // Take the first one in the queue
      const { campaign, contact } = task;

      try {
        // Parse message content (replace {name} with contact's full name)
        let finalMessage = campaign.messageContent;
        if (contact.fullName) {
          finalMessage = finalMessage.replace(/{name}/g, contact.fullName);
        } else {
          finalMessage = finalMessage.replace(/{name}/g, 'bạn');
        }

        const zaloUid = contact.zaloUid;
        let phone = contact.phone;
        if (phone && phone.startsWith('0')) {
          phone = '84' + phone.slice(1);
        }

        // We must have either a zaloUid or a phone number to send a message
        if (!zaloUid && !phone) {
          throw new Error('Contact does not have Zalo UID or phone number');
        }

        const api = zaloPool.getApi(zaloAccountId);
        if (!api) {
          throw new Error('Zalo account is not connected');
        }

        // Try sending message via Zalo API
        await api.sendMessage(
          { msg: finalMessage },
          zaloUid || phone,
          0 // 0 means User thread
        );

        // Mark task as sent
        await prisma.bulkCampaignTask.update({
          where: { id: task.id },
          data: {
            status: 'sent',
            sentAt: new Date()
          }
        });
        
        logger.info(`[bulk-campaign] Task ${task.id} sent successfully (Account: ${zaloAccountId})`);

      } catch (err: any) {
        logger.error(`[bulk-campaign] Task ${task.id} failed:`, err);
        await prisma.bulkCampaignTask.update({
          where: { id: task.id },
          data: {
            status: 'failed',
            errorMessage: err.message || 'Unknown error'
          }
        });
      }
    }

  } catch (err) {
    logger.error('[bulk-campaign] Error processing campaigns:', err);
  } finally {
    isRunning = false;
  }
}

export function startBulkCampaignCron() {
  // Run every minute
  cron.schedule('* * * * *', () => {
    processBulkCampaigns();
  });
  logger.info('[bulk-campaign] Cron job initialized (1 run/minute)');
}
