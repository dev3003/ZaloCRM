import { api } from './index';

export const zaloFriendsApi = {
  sendRequest(accountId: string, friendId: string, message?: string) {
    return api.post(`/zalo-accounts/${accountId}/friends/request`, { friendId, message });
  },
  acceptRequest(accountId: string, friendId: string) {
    return api.post(`/zalo-accounts/${accountId}/friends/accept`, { friendId });
  },
  rejectRequest(accountId: string, friendId: string) {
    return api.post(`/zalo-accounts/${accountId}/friends/reject`, { friendId });
  },
  getStatus(accountId: string, friendId: string) {
    return api.get(`/zalo-accounts/${accountId}/friends/status/${friendId}`);
  },
  searchPhone(accountId: string, phone: string) {
    return api.get(`/zalo-accounts/${accountId}/friends/search/${phone}`);
  },
  getReceivedRequests(accountId: string) {
    return api.get(`/zalo-accounts/${accountId}/friends/requests/received`);
  },
  getSentRequests(accountId: string) {
    return api.get(`/zalo-accounts/${accountId}/friends/requests/sent`);
  },
  undoRequest(accountId: string, friendId: string) {
    return api.post(`/zalo-accounts/${accountId}/friends/undo`, { friendId });
  },
  getFriends(accountId: string) {
    return api.get(`/zalo-accounts/${accountId}/friends`);
  }
};
