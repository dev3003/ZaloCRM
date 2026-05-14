import { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { storageService } from '../storage/storage-service.js';
import { MessageDispatcher } from './message-dispatcher.js';
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
    const tmpRoot = path.join(tmpdir(), 'zalocrm-tmp');
    await mkdir(tmpRoot, { recursive: true });
    const tmpPath = path.join(tmpRoot, `${randomUUID()}-${fileName}`);

    try {
      await writeFile(tmpPath, fileBuffer);

      // 1. Process and store file (Classification + Video Processing) for CRM storage
      const storageResult = await storageService.processUploadedFiles([{
        buffer: fileBuffer,
        originalname: fileName,
        mimetype: fileType
      }]);

      const attachment = storageResult[0];

      // 2. Dispatch to Zalo using LOCAL PATH for the library to upload
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

      return { success: true, attachment };
    } catch (error: any) {
      app.log.error(error);
      return reply.status(500).send({ error: error.message });
    } finally {
      // Clean up temporary file
      await unlink(tmpPath).catch(() => {});
    }
  });
}
