import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { sendRpcToAgent } from '../agent/agent-socket.js';
import axios from 'axios';

let isRunning = false;

async function sendWebhook(url: string, payload: any) {
  try {
    await axios.post(url, payload, { timeout: 5000 });
  } catch (err: any) {
    logger.warn(`[bulk-campaign] Failed to send webhook to ${url}: ${err.message}`);
  }
}

async function runZaloMethod(orgId: string, accountId: string, method: string, args: any[] = []) {
  const activeAgent = await prisma.zaloDesktopAgent.findFirst({
    where: { orgId, status: 'active' }
  });

  const safeArgs = args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg);

  if (activeAgent) {
    return sendRpcToAgent(orgId, method, { accountId, args: safeArgs });
  } else {
    const api = zaloPool.getApi(accountId);
    if (!api) {
      throw new Error('Zalo account is not connected');
    }
    return api[method](...args);
  }
}

async function processBulkCampaigns() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // 1. Check if there is any currently running campaign
    const runningCampaigns = await prisma.bulkCampaign.findMany({
      where: { status: 'running' },
      include: {
        _count: { select: { tasks: { where: { status: 'pending' } } } }
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

    // Refresh running campaigns list
    const activeCampaign = await prisma.bulkCampaign.findFirst({
      where: { status: 'running' }
    });

    // If no running campaign, pick the oldest pending one and start it
    if (!activeCampaign) {
      const nextCampaign = await prisma.bulkCampaign.findFirst({
        where: { status: 'pending', scheduledAt: { lte: now } },
        orderBy: { createdAt: 'asc' }
      });

      if (nextCampaign) {
        await prisma.bulkCampaign.update({
          where: { id: nextCampaign.id },
          data: { status: 'running' }
        });
        logger.info(`[bulk-campaign] Started campaign ${nextCampaign.id}`);
      } else {
        // Nothing to run
        isRunning = false;
        return;
      }
    }

    // 2. Fetch all pending tasks for the currently running campaigns
    const pendingTasks = await prisma.bulkCampaignTask.findMany({
      where: {
        status: 'pending',
        campaign: { status: 'running' }
      },
      include: {
        campaign: true,
        contact: true,
        zaloAccount: true, // Need isFriendRequestLocked
      },
      orderBy: { createdAt: 'asc' }
    });

    if (pendingTasks.length === 0) {
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
      const { campaign, contact, zaloAccount } = task;

      try {
        let finalMessage = task.messageContent || campaign.messageContent;
        if (contact.fullName) {
          finalMessage = finalMessage.replace(/{name}/g, contact.fullName);
        } else {
          finalMessage = finalMessage.replace(/{name}/g, 'bạn');
        }

        // 1. Find User by Phone if targetUid is missing
        let targetUid = contact.zaloUid;
        if (!targetUid) {
          let phone = contact.phone;
          if (!phone) {
            throw new Error('Contact does not have a phone number');
          }
          if (phone.startsWith('0')) {
            phone = '84' + phone.slice(1);
          }

          const findUserRes = await runZaloMethod(campaign.orgId, zaloAccountId, 'findUser', [phone]);
          if (findUserRes && findUserRes.error) {
            throw new Error(findUserRes.error.message || 'Không tìm thấy tài khoản Zalo với số điện thoại này');
          }
          if (findUserRes && findUserRes.data && findUserRes.data.uid) {
            targetUid = findUserRes.data.uid;
            // Update contact with zaloUid for future
            await prisma.contact.update({
              where: { id: contact.id },
              data: { zaloUid: targetUid }
            });
          } else {
            throw new Error('Không tìm thấy tài khoản Zalo với số điện thoại này');
          }
        }

        // 2. Send Friend Request if allowed
        if (!zaloAccount.isFriendRequestLocked) {
          try {
            await runZaloMethod(campaign.orgId, zaloAccountId, 'sendFriendRequest', ['Xin chào, tôi muốn kết bạn với bạn.', targetUid]);
            logger.info(`[bulk-campaign] Sent friend request to ${contact.phone || targetUid}`);
          } catch (frErr: any) {
            logger.warn(`[bulk-campaign] Failed to send friend request to ${contact.phone || targetUid}: ${frErr.message}`);
          }
        }

        // 3. Send Message
        const response = await runZaloMethod(campaign.orgId, zaloAccountId, 'sendMessage', [
          finalMessage.trim(),
          targetUid!.trim(),
          0 // 0 means User thread
        ]);

        if (response && response.error) {
          throw new Error(response.error.message || 'Lỗi từ Zalo API');
        }

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
        const errorMessage = err.message || 'Unknown error';
        
        await prisma.bulkCampaignTask.update({
          where: { id: task.id },
          data: {
            status: 'failed',
            errorMessage
          }
        });

        // Fire webhook if configured
        if (campaign.webhookUrl) {
          await sendWebhook(campaign.webhookUrl, {
            jobId: campaign.id,
            phone: contact.phone || contact.zaloUid,
            status: 'failed',
            error: errorMessage,
            taskId: task.id
          });
        }
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
