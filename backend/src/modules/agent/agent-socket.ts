import { Server, Namespace, Socket } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage } from '../chat/message-handler.js';
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
        const contentType = detectContentType(payload.msgType || payload.data?.msgType, rawContent);

        // Save to DB and handle routing via existing robust logic
        const result = await handleIncomingMessage({
          accountId: payload.accountId,
          senderUid,
          senderName: payload.dName || payload.data?.dName || '',
          content: contentStr,
          contentType,
          msgId: String(payload.msgId || payload.data?.msgId || payload.messageId || ''),
          timestamp: parseInt(payload.ts || payload.data?.ts || String(Date.now())),
          isSelf: payload.isSelf || false,
          threadId,
          threadType: isGroup ? 'group' : 'user',
          groupName: undefined, // Let it fetch if needed
          attachments: payload.attachments || [],
        });

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

    socket.on('agent-reconnected', (data) => {
      logger.info(`Agent reconnected with ${data?.pendingCount || 0} pending items (org: ${orgId})`);
    });

    socket.on('disconnect', () => {
      logger.info(`Desktop Agent disconnected: ${socket.id} (org: ${orgId})`);
    });
  });
}

/**
 * Utility to emit messages securely to agents of a specific tenant
 */
export function sendMessageToAgent(orgId: string, payload: any) {
  if (!agentNamespace) {
    logger.warn('Agent namespace not initialized');
    return false;
  }
  
  // NEVER use agentNamespace.emit() directly.
  // ALWAYS use agentNamespace.to(`org:${orgId}`).emit() for Tenant Isolation.
  logger.info(`Routing message to Agent for org: ${orgId}`);
  agentNamespace.to(`org:${orgId}`).emit('send-message', payload);
  return true;
}
