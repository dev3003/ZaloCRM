/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/users — list all users in org
  app.get('/api/v1/users', async (request: FastifyRequest) => {
    const user = request.user!;
    const { teamId, all } = request.query as { teamId?: string; all?: string };

    const where: any = { orgId: user.orgId };

    // Filter for leaders/managers: only show users in their teams (unless all=true)
    if (['leader', 'manager'].includes(user.role) && all !== 'true') {
      where.team = {
        OR: [
          { leaderId: user.id },
          { managerId: user.id }
        ]
      };
    } else if (teamId) {
      where.teamId = teamId;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
        adminSaleId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  // POST /api/v1/users — create user
  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin', 'manager', 'leader'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { email, fullName, password, role = 'member', teamId, adminSaleId } = request.body as any;
    logger.info(`[user-create] Received body: ${JSON.stringify(request.body)}`);
    if (!email || !fullName || !password) {
      return reply.status(400).send({ error: 'Email, họ tên, mật khẩu là bắt buộc' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.status(400).send({ error: 'Email đã tồn tại' });

    const validRoles = ['admin', 'manager', 'leader', 'member'];
    if (!validRoles.includes(role)) {
      return reply.status(400).send({ error: 'Vai trò không hợp lệ' });
    }

    if (role === 'admin' && currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ Admin cao cấp (Owner) mới có thể tạo Manager' });
    }

    let finalTeamId = teamId || null;

    if (['leader', 'manager'].includes(currentUser.role)) {
      if (role !== 'member') {
        return reply.status(403).send({ error: 'Leader/Manager chỉ được phép tạo tài khoản với quyền nhân viên (member)' });
      }

      const managedTeams = await prisma.team.findMany({
        where: { orgId: currentUser.orgId, OR: [{ leaderId: currentUser.id }, { managerId: currentUser.id }] },
        select: { id: true }
      });
      const managedTeamIds = managedTeams.map(t => t.id);

      if (teamId) {
        if (!managedTeamIds.includes(teamId)) {
          return reply.status(403).send({ error: 'Bạn không có quyền gán nhân viên vào nhóm này' });
        }
      } else {
        if (managedTeamIds.length === 1) {
          finalTeamId = managedTeamIds[0];
        } else if (managedTeamIds.length > 1) {
          return reply.status(400).send({ error: 'Vui lòng chọn nhóm cho nhân viên vì bạn đang quản lý nhiều nhóm' });
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        orgId: currentUser.orgId,
        email,
        fullName,
        passwordHash,
        role,
        teamId: finalTeamId,
        adminSaleId: adminSaleId || null,
      },
      select: {
        id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true,
      },
    });

    logger.info(`User created: ${user.email} by ${currentUser.email}`);
    return user;
  });

  // PUT /api/v1/users/:id — update user info
  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    const targetUser = await prisma.user.findFirst({
      where: { id, orgId: currentUser.orgId }
    });
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });

    if (currentUser.id !== id && !['owner', 'admin'].includes(currentUser.role)) {
      if (!['leader', 'manager'].includes(currentUser.role)) {
        return reply.status(403).send({ error: 'Không có quyền' });
      }
      const managedTeams = await prisma.team.findMany({
        where: { orgId: currentUser.orgId, OR: [{ leaderId: currentUser.id }, { managerId: currentUser.id }] },
        select: { id: true }
      });
      const managedTeamIds = managedTeams.map(t => t.id);
      if (!targetUser.teamId || !managedTeamIds.includes(targetUser.teamId)) {
        return reply.status(403).send({ error: 'Chỉ được phép sửa thông tin nhân viên do bạn quản lý' });
      }
    }

    const { fullName, email, role, teamId, isActive, adminSaleId } = request.body as any;
    
    if (id === currentUser.id && role && role !== currentUser.role) {
      return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) {
      if (currentUser.role === 'owner') {
        updateData.role = role;
      } else if (currentUser.role === 'admin' && ['leader', 'member'].includes(role)) {
        updateData.role = role;
      } else if (['leader', 'manager'].includes(currentUser.role) && role !== targetUser.role) {
        return reply.status(403).send({ error: 'Bạn không có quyền thay đổi vai trò (role) của nhân viên' });
      }
    }
    
    let isTeamChanged = false;
    if (teamId !== undefined) {
      if (['leader', 'manager'].includes(currentUser.role)) {
        const managedTeams = await prisma.team.findMany({
          where: { orgId: currentUser.orgId, OR: [{ leaderId: currentUser.id }, { managerId: currentUser.id }] },
          select: { id: true }
        });
        const managedTeamIds = managedTeams.map(t => t.id);
        if (teamId && !managedTeamIds.includes(teamId)) {
          return reply.status(403).send({ error: 'Bạn không có quyền chuyển nhân viên sang nhóm bạn không quản lý' });
        }
      }
      updateData.teamId = teamId || null;
      if (targetUser.teamId !== updateData.teamId) {
        isTeamChanged = true;
      }
    }
    
    if (adminSaleId !== undefined) updateData.adminSaleId = adminSaleId || null;
    if (isActive !== undefined && ['owner', 'admin'].includes(currentUser.role)) updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: updateData,
      select: {
        id: true, email: true, fullName: true, role: true, isActive: true, teamId: true, adminSaleId: true,
      },
    });

    if (isTeamChanged) {
      await prisma.zaloAccountAccess.deleteMany({ where: { userId: id } });
      logger.info(`Revoked all Zalo access for user ${id} due to team change by ${currentUser.email}`);
    }

    return user;
  });

  // PUT /api/v1/users/:id/password — reset password (owner/admin only)
  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }
    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };
    if (!password || password.length < 6) return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id, orgId: currentUser.orgId }, data: { passwordHash } });
    return { success: true };
  });

  // DELETE /api/v1/users/:id — deactivate user
  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    const targetUser = await prisma.user.findFirst({ where: { id, orgId: currentUser.orgId } });
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });

    if (currentUser.role !== 'owner') {
      if (!['leader', 'manager'].includes(currentUser.role)) {
        return reply.status(403).send({ error: 'Chỉ owner hoặc trưởng nhóm quản lý mới có quyền xóa nhân viên' });
      }
      const managedTeams = await prisma.team.findMany({
        where: { orgId: currentUser.orgId, OR: [{ leaderId: currentUser.id }, { managerId: currentUser.id }] },
        select: { id: true }
      });
      const managedTeamIds = managedTeams.map(t => t.id);
      if (!targetUser.teamId || !managedTeamIds.includes(targetUser.teamId)) {
        return reply.status(403).send({ error: 'Chỉ được phép xóa nhân viên do bạn quản lý' });
      }
    }

    if (id === currentUser.id) return reply.status(400).send({ error: 'Không thể xóa chính mình' });

    await prisma.user.update({ where: { id, orgId: currentUser.orgId }, data: { isActive: false } });
    return { success: true };
  });
}
