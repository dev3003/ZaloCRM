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
      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId, userId: user.id },
      });

      // If no explicit access to the Zalo account, check assignment or common access
      if (!access) {
        if (params.id) {
          const conversation = await prisma.conversation.findFirst({
            where: { id: params.id, orgId: user.orgId },
            include: { contact: true }
          });

          if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc hội thoại' });

          let hasAccess = false;

          if (conversation.threadType === 'user') {
            // Direct chat: Access if assigned OR unassigned
            if (!conversation.contact?.assignedUserId || conversation.contact.assignedUserId === user.id) {
              hasAccess = true;
            }
          } else if (conversation.threadType === 'group') {
            // Group chat: Access if any member is assigned to me OR no members are assigned to anyone (common group)
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

          if (hasAccess) {
            if (minPermission === 'admin') {
              return reply.status(403).send({ error: 'Cần quyền Admin để thực hiện thao tác này' });
            }
            return; // Access granted
          }
        }
        
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }

      const userLevel = hierarchy[access.permission as Permission] ?? 0;
      if (userLevel < hierarchy[minPermission]) {
        return reply.status(403).send({ error: 'Không đủ quyền' });
      }
    } catch (err) {
      logger.error('[zalo-access] Middleware error:', err);
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
