/**
 * Zalo access middleware — checks if user has sufficient permission on a Zalo account.
 * Permission hierarchy: admin > chat > read.
 * Owner/admin roles bypass the check (they have access to all accounts in their org).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

type Permission = 'read' | 'chat' | 'admin';

const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

// Factory: returns a preHandler that checks the user has at least minPermission on the Zalo account
export function requireZaloAccess(minPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    // Owner/admin bypass — full access to all accounts in their org
    if (['owner', 'admin'].includes(user.role)) return;

    const params = request.params as Record<string, string>;
    let zaloAccountId = params.zaloAccountId || params.id;

    logger.info(`[requireZaloAccess] Access check: path=${request.url} method=${request.method} minPermission=${minPermission} userId=${user.id} role=${user.role} orgId=${user.orgId}`);

    // Support Session bypass - if user has an active session for this conversation, grant access
    if (params.id && !params.zaloAccountId) {
      const activeSession = await prisma.supportSession.findFirst({
        where: {
          conversationId: params.id,
          sharedWithUserId: user.id,
          status: 'active',
          orgId: user.orgId
        }
      });
      logger.info(`[requireZaloAccess] Support session check for conversationId=${params.id} sharedWithUserId=${user.id}: found=${!!activeSession}`);
      if (activeSession) {
        logger.info(`[requireZaloAccess] Access GRANTED via active Support Session for userId=${user.id} conversationId=${params.id}`);
        return; // Granted via Support Session
      }
    }

    // If accessing via conversation, look up the Zalo account from the conversation
    if (params.id && !params.zaloAccountId) {
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: params.id, orgId: user.orgId },
          select: { zaloAccountId: true },
        });
        if (conv) zaloAccountId = conv.zaloAccountId;
      } catch {
        return reply.status(500).send({ error: 'Internal error checking access' });
      }
    }

    if (!zaloAccountId) return reply.status(404).send({ error: 'Not found' });

    try {
      const accountInfo = await prisma.zaloAccount.findFirst({
        where: { id: zaloAccountId, orgId: user.orgId },
        include: {
          access: { where: { userId: user.id } },
          teams: true
        }
      });

      if (!accountInfo) {
        logger.warn(`[requireZaloAccess] Access DENIED: Zalo Account not found for zaloAccountId=${zaloAccountId}`);
        return reply.status(404).send({ error: 'Zalo Account not found' });
      }

      const explicitAccess = accountInfo.access[0];
      const isPublicAccount = accountInfo.teams.length === 0;
      const isTeamAccount = !!user.teamId && accountInfo.teams.some(t => t.teamId === user.teamId);

      // LỚP KHÓA 1: Kiểm tra quyền với Zalo Account (Phải thuộc team, hoặc public, hoặc được gán trực tiếp)
      if (!explicitAccess && !isPublicAccount && !isTeamAccount) {
        logger.warn(`[requireZaloAccess] Access DENIED: No Zalo account access for userId=${user.id} role=${user.role} zaloAccountId=${zaloAccountId}`);
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }

      // Xác định permission level
      let accountPermissionLevel = 0;
      if (explicitAccess) {
        accountPermissionLevel = hierarchy[explicitAccess.permission as Permission] || 0;
      } else {
        // Nếu vào được qua Team hoặc Public, mặc định cho quyền 'chat' để có thể nhắn tin
        accountPermissionLevel = hierarchy['chat'];
      }

      if (accountPermissionLevel < hierarchy[minPermission]) {
        logger.warn(`[requireZaloAccess] Access DENIED: Insufficient permission level: accountPermission=${accountPermissionLevel} minPermissionNeeded=${hierarchy[minPermission]} userId=${user.id} role=${user.role}`);
        return reply.status(403).send({ error: 'Không đủ quyền thực hiện thao tác này' });
      }

      // LỚP KHÓA 2: Kiểm tra quyền với Khách hàng (Conversation)
      if (params.id && !params.zaloAccountId) {
        const conversation = await prisma.conversation.findFirst({
          where: { id: params.id, orgId: user.orgId },
          include: { contact: true }
        });

        if (!conversation) {
          logger.warn(`[requireZaloAccess] Access DENIED: Conversation not found for conversationId=${params.id}`);
          return reply.status(404).send({ error: 'Không tìm thấy cuộc hội thoại' });
        }

        // Leader bypass: Trưởng nhóm được xem tất cả khách hàng nếu hội thoại nằm trên Zalo Account của nhóm họ
        if (user.role === 'leader' && (isTeamAccount || isPublicAccount)) {
          logger.info(`[requireZaloAccess] Access GRANTED to Leader for conversationId=${params.id}`);
          return; // Cấp quyền luôn cho Leader
        }

        // Member: Phải phụ trách khách hàng này
        let hasAccess = false;

        if (conversation.threadType === 'user') {
          // Direct chat: Access if assigned OR unassigned
          if (!conversation.contact?.assignedUserId || conversation.contact.assignedUserId === user.id) {
            hasAccess = true;
          }
        } else if (conversation.threadType === 'group') {
          // Group chat
          const assignedMembers = await prisma.groupMember.count({
            where: {
              conversationId: conversation.id,
              contact: { assignedUserId: { not: null } }
            }
          });
          const myAssignedMembers = await prisma.groupMember.count({
            where: {
              conversationId: conversation.id,
              contact: { assignedUserId: user.id }
            }
          });

          if (assignedMembers === 0 || myAssignedMembers > 0) {
            hasAccess = true;
          }
        }

        if (!hasAccess) {
          logger.warn(`[requireZaloAccess] Access DENIED: Member not assigned to contact for conversationId=${params.id} contactId=${conversation.contactId} assignedUserId=${conversation.contact?.assignedUserId} userId=${user.id}`);
          return reply.status(403).send({ error: 'Bạn không phụ trách khách hàng này' });
        }
      }

      return; // All locks passed!
    } catch (err) {
      logger.error('[zalo-access] Middleware error:', err);
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
