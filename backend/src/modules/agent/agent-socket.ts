import { Server, Namespace, Socket } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, emitSecureMessage } from '../chat/message-handler.js';
import { detectContentType } from '../zalo/zalo-message-helpers.js';

let agentNamespace: Namespace | null = null;

export function setupAgentSocket(io: Server) {
  agentNamespace = io.of('/desktop-agent');

  // Middleware: Authenticate Desktop Agent via agentKey
  agentNamespace.use(async (socket: Socket, next) => {
    const { agentKey, fingerprint } = socket.handshake.auth || {};

    if (!agentKey) {
      return next(new Error('Authentication error: Missing agentKey'));
    }

    try {
      const agent = await prisma.zaloDesktopAgent.findUnique({
        where: { agentKey }
      });

      if (!agent || agent.status !== 'active') {
        return next(new Error('Authentication error: Invalid or inactive agentKey'));
      }

      // Store context securely in socket.data
      socket.data.orgId = agent.orgId;
      socket.data.agentId = agent.id;

      next();
    } catch (err) {
      logger.error('Agent socket authentication failed:', err);
      next(new Error('Authentication error: Server exception'));
    }
  });

  agentNamespace.on('connection', (socket: Socket) => {
    const orgId = socket.data.orgId;

    // Join tenant isolation room
    socket.join(`org:${orgId}`);
    logger.info(`Desktop Agent connected: ${socket.id} (org: ${orgId})`);

    // Handle incoming messages from Desktop Agent
    socket.on('message-received', async (payload, callback) => {
      try {
        if (!payload || !payload.accountId || !payload.content) {
          throw new Error('Invalid payload');
        }

        // STRICT ISOLATION CHECK: Validate the zalo account belongs to this org
        const account = await prisma.zaloAccount.findFirst({
          where: { id: payload.accountId, orgId }
        });

        if (!account) {
          throw new Error('Account not found or access denied');
        }

        const isGroup = payload.type === 1 || payload.threadType === 'group';
        const senderUid = String(payload.uidFrom || payload.data?.uidFrom || '');
        const receiverUid = String(payload.idTo || payload.uidTo || payload.data?.idTo || payload.data?.uidTo || '');

        let threadId = payload.threadId;
        if (!threadId) {
          if (isGroup) {
            threadId = payload.groupId || payload.data?.groupId || '';
          } else {
            threadId = payload.isSelf ? receiverUid : senderUid;
          }
        }
        threadId = String(threadId || '');

        const rawContent = payload.content || payload.data?.content;
        const contentStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
        const msgTypeStr = String(payload.zaloMsgType || payload.msgType || payload.data?.msgType || '');
        let contentType = detectContentType(msgTypeStr, rawContent);

        // Fallback detection based on Zalo's numeric types if needed, or by inspecting attachments
        if (contentType === 'text') {
          if (payload.zaloMsgType === 2) contentType = 'image';
          else if (payload.zaloMsgType === 3) contentType = 'video';
          else if (payload.zaloMsgType === 4 || payload.zaloMsgType === 6) contentType = 'file';
          else if (payload.zaloMsgType === 5) contentType = 'link';
          else if (payload.zaloMsgType === 7) contentType = 'sticker';
          else if (payload.attachments && payload.attachments.length > 0) contentType = 'file';
        }

        // Save to DB and handle routing via existing robust logic
        const result = await handleIncomingMessage({
          accountId: payload.accountId,
          senderUid,
          senderName: payload.dName || payload.data?.dName || '',
          content: contentStr,
          contentType,
          msgId: String(payload.msgId || payload.data?.msgId || ''),
          cliMsgId: String(payload.cliMsgId || payload.data?.cliMsgId || ''),
          timestamp: parseInt(payload.ts || payload.data?.ts || String(Date.now())),
          isSelf: payload.isSelf || false,
          threadId,
          threadType: isGroup ? 'group' : 'user',
          groupName: undefined, // Let it fetch if needed
          attachments: payload.attachments || [],
        });

        if (result) {
          emitSecureMessage(io, result).catch(e => logger.error(`[agent-socket] emitSecureMessage failed: ${e}`));
        }

        if (typeof callback === 'function') {
          callback({ ok: true, result });
        }
      } catch (err: any) {
        logger.error(`Error handling agent message: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ ok: false, error: err.message });
        }
      }
    });

    socket.on('reaction-received', async (data) => {
      try {
        const message = await prisma.message.findFirst({
          where: { zaloMsgId: data.msgId }
        });
        
        if (message) {
          await prisma.message.update({
            where: { id: message.id },
            data: { reaction: data.icon }
          });
          
          const conversation = await prisma.conversation.findUnique({
            where: { id: message.conversationId }
          });
          
          if (conversation) {
            io.to(`org:${orgId}`).emit('chat:reaction', {
              conversationId: conversation.id,
              msgId: message.id,
              icon: data.icon
            });
          }
        }
      } catch (err) {
        logger.error(`Error handling reaction from agent: ${err}`);
      }
    });

    socket.on('agent-reconnected', (data) => {
      logger.info(`Agent reconnected with ${data?.pendingCount || 0} pending items (org: ${orgId})`);
    });

    socket.on('qr-image', (data) => {
      io.to(`account:${data.accountId}`).emit('zalo:qr', { accountId: data.accountId, qrImage: data.qrBase64 });
    });

    socket.on('qr-expired', (data) => {
      io.to(`account:${data.accountId}`).emit('zalo:qr-expired', { accountId: data.accountId });
    });

    socket.on('zalo-connected', async (data) => {
      logger.info(`Agent reported Zalo connected for account ${data.accountId}`);
      try {
        await prisma.zaloAccount.update({
          where: { id: data.accountId },
          data: {
            status: 'connected',
            lastConnectedAt: new Date(),
            ...(data.zaloUid ? { zaloUid: data.zaloUid } : {})
          }
        });
        io.to(`account:${data.accountId}`).emit('zalo:connected', { accountId: data.accountId, zaloUid: data.zaloUid });
      } catch (err) {
        logger.error(`Failed to update DB on zalo-connected: ${err}`);
      }
    });

    socket.on('zalo-disconnected', async (data) => {
      logger.warn(`Agent reported Zalo disconnected for account ${data.accountId}, reason: ${data.reason}`);
      try {
        await prisma.zaloAccount.update({
          where: { id: data.accountId },
          data: { status: 'disconnected' }
        });
        io.to(`account:${data.accountId}`).emit('zalo:error', { accountId: data.accountId, error: data.reason });
      } catch (err) {
        logger.error(`Failed to update DB on zalo-disconnected: ${err}`);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Desktop Agent disconnected: ${socket.id} (org: ${orgId})`);
    });
  });
}

/**
 * Utility to emit messages securely to agents of a specific tenant
 */
export function sendMessageToAgent(orgId: string, eventName: string, payload: any) {
  if (!agentNamespace) {
    logger.warn('Agent namespace not initialized');
    return false;
  }

  // ALWAYS use agentNamespace.to(`org:${orgId}`).emit() for Tenant Isolation.
  logger.info(`Routing event '${eventName}' to Agent for org: ${orgId}`);
  agentNamespace.to(`org:${orgId}`).emit(eventName, payload);
  return true;
}

/**
 * Send an RPC request to the Desktop Agent and wait for the response.
 */
export async function sendRpcToAgent(orgId: string, action: string, payload: any, timeoutMs = 20000): Promise<any> {
  if (!agentNamespace) {
    throw new Error('Agent namespace not initialized');
  }

  logger.info(`[RPC] Sending action '${action}' to Agent for org: ${orgId}`);
  try {
    const responses = await agentNamespace.to(`org:${orgId}`).timeout(timeoutMs).emitWithAck('rpc-request', {
      action: action,
      ...payload
    });

    if (!responses || responses.length === 0) {
      throw new Error('Agent offline or did not respond in time');
    }

    const response = responses[0];
    if (response.error) {
      throw new Error(response.error);
    }

    return response.data;
  } catch (err) {
    logger.error(`[RPC] Error for action '${action}':`, err);
    throw err;
  }
}

