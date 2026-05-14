import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';

export interface DispatchMessage {
  conversationId: string;
  zaloAccountId: string;
  externalConversationId: string;
  threadType: 0 | 1; // 0=User, 1=Group
  contentType: 'text' | 'image' | 'video' | 'file';
  content: string;
  localPath?: string; // Optional local path for media uploads
  payload?: any;
}

export class MessageDispatcher {
  static async dispatch(msg: DispatchMessage) {
    const instance = zaloPool.getInstance(msg.zaloAccountId);
    if (!instance?.api) {
      logger.error(`[dispatcher] Error: Zalo account ${msg.zaloAccountId} not connected.`);
      throw new Error('Zalo account not connected');
    }

    try {
      if (msg.contentType === 'text') {
        await instance.api.sendMessage({ msg: msg.content }, msg.externalConversationId, msg.threadType);
      } else {
        // Use attachments array with local path for media (matches original ZaloCRM logic)
        const mediaPath = msg.localPath;
        if (!mediaPath) {
          logger.error(`[dispatcher] Error: Media upload requested but no localPath provided for ${msg.contentType}`);
          throw new Error('localPath is required for media dispatch');
        }

        logger.info(`[dispatcher] Dispatching ${msg.contentType} via local path: ${mediaPath}`);
        
        // zca-js expects an attachments array of local paths for media in sendMessage
        await instance.api.sendMessage(
          { 
            msg: msg.content || '', 
            attachments: [mediaPath] 
          }, 
          msg.externalConversationId, 
          msg.threadType
        );
      }

      // Persist to DB
      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: msg.conversationId,
          senderType: 'self',
          senderUid: instance.zaloUid || '', 
          senderName: 'Staff',
          content: msg.contentType === 'text' ? msg.content : JSON.stringify(msg.payload || { url: msg.content }),
          contentType: msg.contentType,
          sentAt: new Date(),
          fileStatus: msg.contentType === 'text' ? 'none' : 'success',
        },
      });

      await prisma.conversation.update({
        where: { id: msg.conversationId },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      return message;
    } catch (error) {
      logger.error('[dispatcher] Dispatch error:', error);
      throw error;
    }
  }
}
