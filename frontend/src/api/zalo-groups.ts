import { api } from './index';

export const zaloGroupsApi = {
  getGroups: (accountId: string) => 
    api.get(`/zalo-accounts/${accountId}/groups`),
  
  createGroup: (accountId: string, payload: { name: string; members: string[] }) =>
    api.post(`/zalo-accounts/${accountId}/groups/create`, payload),
  
  addMembers: (accountId: string, groupId: string, members: string[]) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/add-members`, { members }),
  
  renameGroup: (accountId: string, groupId: string, name: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/name`, { name }),
  
  leaveGroup: (accountId: string, groupId: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/leave`),
    
  getMembers: (accountId: string, groupId: string) =>
    api.get(`/zalo-accounts/${accountId}/groups/${groupId}/members`),
};
