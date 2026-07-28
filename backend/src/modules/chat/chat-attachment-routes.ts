import { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { storageService } from '../storage/storage-service.js';
import { MessageDispatcher } from './message-dispatcher.js';
import { sendMessageToAgent } from '../agent/agent-socket.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function chatAttachmentRoutes(app: FastifyInstance) {
  app.post('/conversations/:id/attachments', async (req, reply) => {
    const { id: conversationId } = req.params as { id: string };
    const parts = req.parts();
    
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileType = '';
    let caption = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        fileName = part.filename;
        fileType = part.mimetype;
      } else {
        // Handle fields like 'caption'
        if (part.fieldname === 'caption') {
          caption = (part as any).value;
        }
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { zaloAccount: true, contact: true }
    });

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // CREATE TEMPORARY FILE ON SERVER
    // Thay vì dùng thư mục /tmp hệ thống dễ bị lỗi quyền (EACCES), ta dùng thư mục temp trong dự án
    const tmpRoot = path.join(process.cwd(), 'temp', 'omni360-tmp');
    await mkdir(tmpRoot, { recursive: true });
    const tmpPath = path.join(tmpRoot, `${randomUUID()}-${fileName}`);

    try {
      await writeFile(tmpPath, fileBuffer);

      // 1. Process and store file (Classification + Video Processing) for CRM storage
      const storageResult = await storageService.processUploadedFiles(conversation.orgId, [{
        buffer: fileBuffer,
        originalname: fileName,
        mimetype: fileType
      }]);

      const attachment = storageResult[0];

      // Check if this org uses Desktop Agent
      const activeAgent = await prisma.zaloDesktopAgent.findFirst({
        where: { orgId: conversation.orgId, status: 'active' }
      });

      const messageId = randomUUID();

      if (activeAgent) {
        // Desktop Agent Mode: Send the URL and file metadata to the Agent
        // The Agent will download it locally and send it.
        sendMessageToAgent(conversation.orgId, 'send-message', {
          action: 'sendFile',
          messageId: messageId,
          accountId: conversation.zaloAccountId,
          threadId: conversation.externalThreadId || conversation.contact?.zaloUid || '',
          threadType: conversation.threadType === 'group' ? 1 : 0,
          url: attachment.url,
          filename: fileName,
          caption: caption,
          type: conversation.threadType === 'group' ? 1 : 0,
        });
      } else {
        // Zalo Cloud Mode: Dispatch to Zalo using LOCAL PATH for the library to upload
        await MessageDispatcher.dispatch({
          conversationId: conversation.id,
          zaloAccountId: conversation.zaloAccountId,
          externalConversationId: conversation.externalThreadId || conversation.contact?.zaloUid || '',
          threadType: conversation.threadType === 'group' ? 1 : 0,
          contentType: attachment.type as any,
          content: caption || '',
          localPath: tmpPath, // Pass local path to dispatcher
          payload: {
            name: fileName,
            size: fileBuffer.length,
            type: attachment.type,
            url: attachment.url,
            thumb: attachment.thumb,
            duration: attachment.duration,
            width: attachment.width,
            height: attachment.height,
            caption: caption
          }
        });
      }

      const isMedia = attachment.type === 'image' || attachment.type === 'video';
      const finalCaption = isMedia ? caption : undefined;

      const message = await prisma.message.create({
        data: {
          id: messageId,
          conversationId: conversation.id,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: JSON.stringify({
            name: fileName,
            size: fileBuffer.length,
            type: attachment.type,
            url: attachment.url,
            thumb: attachment.thumb,
            duration: attachment.duration,
            width: attachment.width,
            height: attachment.height,
            caption: finalCaption
          }),
          contentType: attachment.type as string,
          sentAt: new Date(),
          fileStatus: 'success',
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io;
      if (io) {
        const { emitSecureMessage } = await import('./message-handler.js');
        await emitSecureMessage(io, {
          message: message as any,
          conversationId: conversation.id,
          orgId: conversation.orgId,
          contactId: conversation.contactId
        });
      }

      return { success: true, attachment, message };
    } catch (error: any) {
      app.log.error(error);
      return reply.status(500).send({ 
        error: error.message,
        stack: error.stack || 'No stack trace',
        name: error.name || 'Error'
      });
    } finally {
      // Clean up temporary file
      await unlink(tmpPath).catch(() => {});
    }
  });
}
