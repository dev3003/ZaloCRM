import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export async function zaloGroupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts/:id/groups
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/groups',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const result = await instance.api.getAllGroups();
        // result usually contains gridVerMap with groupIds as keys
        const groupIds = Object.keys(result?.gridVerMap || {});
        
        if (groupIds.length === 0) return [];

        // Fetch detailed info for each group to get names and avatars
        const detailedGroups = await Promise.all(
          groupIds.map(async (groupId) => {
            try {
              const res = await instance.api.getGroupInfo(groupId);
              const info = res?.gridInfoMap?.[groupId];
              
              return {
                groupId,
                name: info?.name || info?.groupName || 'Nhóm không tên',
                avatar: info?.avatar || info?.groupAvatar,
                totalMember: info?.totalMember || info?.numMember || 0,
                ...info
              };
            } catch (e) {
              return { groupId, name: 'Lỗi tải thông tin', totalMember: 0 };
            }
          })
        );

        return detailedGroups;
      } catch (err) {
        logger.error(`[zalo-group] getAllGroups error:`, err);
        return reply.status(500).send({ error: 'Không thể lấy danh sách nhóm' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/groups/create
  app.post<{ Params: { id: string }; Body: { name: string; members: string[] } }>(
    '/api/v1/zalo-accounts/:id/groups/create',
    async (request, reply) => {
      const { id } = request.params;
      const { name, members } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const result = await instance.api.createGroup({ name, members });
        return result;
      } catch (err) {
        logger.error(`[zalo-group] createGroup error:`, err);
        return reply.status(500).send({ error: 'Tạo nhóm thất bại' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/groups/:groupId/add-members
  app.post<{ Params: { id: string; groupId: string }; Body: { members: string[] } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/add-members',
    async (request, reply) => {
      const { id, groupId } = request.params;
      const { members } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const result = await instance.api.addUserToGroup(members, groupId);
        return result;
      } catch (err) {
        logger.error(`[zalo-group] addUserToGroup error:`, err);
        return reply.status(500).send({ error: 'Thêm thành viên thất bại' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/groups/:groupId/name
  app.post<{ Params: { id: string; groupId: string }; Body: { name: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/name',
    async (request, reply) => {
      const { id, groupId } = request.params;
      const { name } = request.body;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        logger.info(`[zalo-group] Renaming group ${groupId} to ${name}`);
        await instance.api.changeGroupName(name, groupId);
        return { success: true };
      } catch (err: any) {
        logger.error(`[zalo-group] changeGroupName error for group ${groupId}:`, err.message || err);
        return reply.status(500).send({ error: 'Đổi tên nhóm thất bại: ' + (err.message || '') });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/groups/:groupId/leave
  app.post<{ Params: { id: string; groupId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/leave',
    async (request, reply) => {
      const { id, groupId } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        await instance.api.leaveGroup(groupId);
        return { success: true };
      } catch (err) {
        logger.error(`[zalo-group] leaveGroup error:`, err);
        return reply.status(500).send({ error: 'Rời nhóm thất bại' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/groups/:groupId/members
  app.get<{ Params: { id: string; groupId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/members',
    async (request, reply) => {
      const { id, groupId } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa được kết nối' });

      try {
        const cleanGroupId = String(groupId).trim();
        const bigId = /^\d+$/.test(cleanGroupId) ? BigInt(cleanGroupId) : cleanGroupId;
        
        // Try all possible ways to get members with both string and BigInt IDs
        const [membersInfoRes, membersRes, groupInfoRes] = await Promise.all([
          instance.api.getGroupMembersInfo(bigId).catch(() => ({})),
          instance.api.getGroupMembers ? instance.api.getGroupMembers(bigId).catch(() => ([])) : Promise.resolve([]),
          instance.api.getGroupInfo(bigId).catch(() => ({}))
        ]);

        const gridInfoMap = groupInfoRes?.gridInfoMap || {};
        const info = gridInfoMap[cleanGroupId] || gridInfoMap[String(bigId)] || Object.values(gridInfoMap)[0] || {};
        
        let totalCount = info?.totalMember || info?.numMember || 0;
        let membersArray: any[] = [];
        
        // Helper to find any array of strings in an object (potential UID list)
        const findUidArray = (obj: any): string[] => {
          if (!obj || typeof obj !== 'object') return [];
          for (const key in obj) {
            if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'string') {
              return obj[key];
            }
          }
          return [];
        };

        // 1. Process profiles
        const rawProfiles = membersInfoRes?.profiles || membersInfoRes?.changed_profiles || membersInfoRes?.profile_map || (typeof membersInfoRes === 'object' && !Array.isArray(membersInfoRes) ? membersInfoRes : null);
        if (rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles)) {
          membersArray = Object.entries(rawProfiles).map(([uid, profile]: [string, any]) => ({
            uid: uid.replace(/_0$/, ''), 
            ...profile,
          }));
        }

        // 2. Aggregate UIDs from all possible fields
        const discoveredUids = new Set<string>();
        
        // From membersRes
        if (Array.isArray(membersRes)) {
          membersRes.forEach(u => discoveredUids.add(String(u).replace(/_0$/, '')));
        } else if (membersRes?.members) {
          membersRes.members.forEach((u: any) => discoveredUids.add(String(u).replace(/_0$/, '')));
        }

        // From info object (deep scan)
        const listFromInfo = findUidArray(info);
        listFromInfo.forEach(u => discoveredUids.add(String(u).replace(/_0$/, '')));
        
        // Specific fields fallback
        const memList = info?.memList || info?.mem_list || info?.memberList || info?.members || [];
        memList.forEach((u: any) => discoveredUids.add(String(typeof u === 'string' ? u : (u.uid || u.userId || u.id)).replace(/_0$/, '')));

        // 3. Merge discovered UIDs into membersArray
        discoveredUids.forEach(uid => {
          if (!membersArray.find(m => String(m.uid) === uid)) {
            membersArray.push({ uid, displayName: `Thành viên ${uid}` });
          }
        });

        // 4. Resolve real names and avatars for members (limit to first 50 for performance)
        const membersToResolve = membersArray.filter(m => !m.zaloName && (!m.displayName || m.displayName.startsWith('Thành viên')));
        if (membersToResolve.length > 0) {
          await Promise.all(membersToResolve.slice(0, 50).map(async (m) => {
            try {
              const res = await instance.api.getUserInfo(m.uid);
              const profiles = res?.changed_profiles || res?.profiles || res?.profile_map || {};
              const profile = profiles[m.uid] || profiles[`${m.uid}_0`] || Object.values(profiles)[0];
              if (profile) {
                m.displayName = profile.zaloName || profile.zalo_name || profile.displayName || profile.dName || profile.name || m.displayName;
                m.avatar = profile.avatar || profile.avatar_url || m.avatar;
              }
            } catch (e) {
              // Ignore resolution errors for individual members
            }
          }));
        }

        if (!totalCount || totalCount === 0) {
          totalCount = membersArray.length;
        }

        return {
          members: membersArray,
          totalCount: totalCount,
          debug: { cleanGroupId, membersFound: membersArray.length, resolvedCount: membersToResolve.length }
        };
      } catch (err) {
        logger.error(`[zalo-group] getGroupMembers error:`, err);
        return reply.status(500).send({ error: 'Không thể lấy danh sách thành viên' });
      }
    }
  );
}
