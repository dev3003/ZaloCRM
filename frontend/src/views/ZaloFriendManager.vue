<template>
  <v-container fluid class="pa-6">
    <div class="d-flex align-center mb-6 ga-4">
      <h1 class="text-h4 font-weight-bold">Quản lý kết bạn Zalo</h1>
      <v-spacer />
      <div style="width: 300px">
        <v-select
          v-model="selectedAccountId"
          :items="accountOptions"
          item-title="text"
          item-value="value"
          label="Tài khoản Zalo đang chọn"
          density="compact"
          variant="outlined"
          hide-details
        />
      </div>
    </div>

    <v-row>
      <v-col cols="12" md="8">
        <v-card class="rounded-xl overflow-hidden shadow-sm" elevation="0" border>
          <v-tabs v-model="tab" color="primary" align-tabs="start">
            <v-tab value="received" class="text-none">
              <v-icon start>mdi-account-arrow-left</v-icon>
              Lời mời đã nhận
              <v-badge
                v-if="receivedRequests.length > 0"
                :content="receivedRequests.length"
                color="error"
                inline
                class="ml-2"
              />
            </v-tab>
            <v-tab value="sent" class="text-none">
              <v-icon start>mdi-account-arrow-right</v-icon>
              Lời mời đã gửi
            </v-tab>
            <v-tab value="friends" class="text-none">
              <v-icon start>mdi-account-multiple</v-icon>
              Danh sách bạn bè
            </v-tab>
          </v-tabs>

          <v-divider />

          <v-window v-model="tab" class="pa-4">
            <!-- Received Requests -->
            <v-window-item value="received">
              <v-data-iterator
                :items="receivedRequests"
                :loading="loadingReceived"
                :items-per-page="-1"
                no-data-text="Không có lời mời kết bạn nào đang chờ"
              >
                <template #default="{ items }">
                  <v-row>
                    <v-col v-for="item in items" :key="item.raw.userId" cols="12" sm="6">
                      <v-card variant="outlined" class="rounded-lg pa-4 hover-card">
                        <div class="d-flex align-center mb-3">
                          <v-avatar size="64" class="mr-4 border shadow-sm">
                            <v-img :src="item.raw.avatar || '/default-avatar.png'" />
                          </v-avatar>
                          <div class="flex-grow-1 overflow-hidden">
                            <div class="text-subtitle-1 font-weight-bold text-truncate">
                              {{ item.raw.display_name || item.raw.zaloName || 'Người dùng Zalo' }}
                            </div>
                            <div class="text-caption text-grey">UID: {{ item.raw.userId }}</div>
                          </div>
                        </div>

                        <div v-if="item.raw.recommInfo?.message" class="pa-2 rounded text-body-2 mb-4 border-s-lg border-blue" style="background: rgba(59, 130, 246, 0.1);">
                          "{{ item.raw.recommInfo.message }}"
                        </div>

                        <div class="d-flex ga-2">
                          <v-btn
                            color="success"
                            variant="flat"
                            block
                            class="flex-1"
                            prepend-icon="mdi-check"
                            @click="acceptFriend(item.raw.userId)"
                            :loading="actionLoading === item.raw.userId"
                          >
                            Chấp nhận
                          </v-btn>
                          <v-btn
                            color="error"
                            variant="tonal"
                            icon="mdi-close"
                            size="small"
                            title="Từ chối"
                            @click="rejectFriend(item.raw.userId)"
                            :loading="actionLoading === item.raw.userId"
                          />
                        </div>
                      </v-card>
                    </v-col>
                  </v-row>
                </template>
                <template #loader>
                  <div class="d-flex justify-center pa-10">
                    <v-progress-circular indeterminate color="primary" />
                  </div>
                </template>
              </v-data-iterator>
            </v-window-item>

            <!-- Sent Requests -->
            <v-window-item value="sent">
              <v-data-iterator
                :items="sentRequests"
                :loading="loadingSent"
                :items-per-page="-1"
                no-data-text="Bạn chưa gửi lời mời kết bạn nào"
              >
                <template #default="{ items }">
                  <v-row>
                    <v-col v-for="item in items" :key="item.raw.userId" cols="12" sm="6">
                      <v-card variant="outlined" class="rounded-lg pa-4 hover-card">
                        <div class="d-flex align-center mb-3">
                          <v-avatar size="64" class="mr-4 border shadow-sm bg-grey-lighten-4">
                            <v-img :src="item.raw.avatar || '/default-avatar.png'" />
                          </v-avatar>
                          <div class="flex-grow-1 overflow-hidden">
                            <div class="text-subtitle-1 font-weight-bold text-truncate">
                              {{ item.raw.displayName || item.raw.zaloName || 'Người dùng Zalo' }}
                            </div>
                            <div class="text-caption text-grey">UID: {{ item.raw.userId }}</div>
                            <div v-if="item.raw.fReqInfo?.time" class="text-caption text-grey">
                              Gửi lúc: {{ formatDate(item.raw.fReqInfo.time) }}
                            </div>
                          </div>
                        </div>

                        <div v-if="item.raw.fReqInfo?.message" class="pa-2 rounded text-body-2 mb-4 italic" style="background: rgba(128, 128, 128, 0.1);">
                          "{{ item.raw.fReqInfo.message }}"
                        </div>

                        <v-btn
                          color="secondary"
                          variant="outlined"
                          block
                          prepend-icon="mdi-undo"
                          @click="undoFriend(item.raw.userId)"
                          :loading="actionLoading === item.raw.userId"
                        >
                          Thu hồi lời mời
                        </v-btn>
                      </v-card>
                    </v-col>
                  </v-row>
                </template>
                <template #loader>
                  <div class="d-flex justify-center pa-10">
                    <v-progress-circular indeterminate color="primary" />
                  </div>
                </template>
              </v-data-iterator>
            </v-window-item>

            <!-- Friend List -->
            <v-window-item value="friends">
              <div class="mb-4">
                <v-text-field
                  v-model="friendSearch"
                  placeholder="Tìm kiếm bạn bè..."
                  prepend-inner-icon="mdi-magnify"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                />
              </div>
              <v-data-iterator
                :items="filteredFriends"
                :loading="loadingFriends"
                :items-per-page="-1"
                no-data-text="Không tìm thấy bạn bè nào"
              >
                <template #default="{ items }">
                  <v-row>
                    <v-col v-for="item in items" :key="(item.raw as any).userId" cols="12" sm="6">
                      <v-card variant="outlined" class="rounded-lg pa-4 hover-card h-100">
                        <div class="d-flex align-center">
                          <v-avatar size="56" class="mr-4 border shadow-sm">
                            <v-img :src="(item.raw as any).avatar || '/default-avatar.png'" />
                          </v-avatar>
                          <div class="flex-grow-1 overflow-hidden">
                            <div class="text-subtitle-1 font-weight-bold text-truncate">
                              {{ (item.raw as any).displayName || (item.raw as any).zaloName || 'Bạn bè Zalo' }}
                            </div>
                            <div class="text-caption text-grey">UID: {{ (item.raw as any).userId }}</div>
                          </div>
                        </div>
                      </v-card>
                    </v-col>
                  </v-row>
                </template>
                <template #loader>
                  <div class="d-flex justify-center pa-10">
                    <v-progress-circular indeterminate color="primary" />
                  </div>
                </template>
              </v-data-iterator>
            </v-window-item>
          </v-window>
        </v-card>
      </v-col>

      <!-- Sidebar: Search -->
      <v-col cols="12" md="4">
        <v-card class="rounded-xl pa-4 shadow-sm" elevation="0" border>
          <div class="text-h6 font-weight-bold mb-4">Tìm và kết bạn mới</div>
          <p class="text-body-2 text-grey-darken-1 mb-4">
            Nhập số điện thoại Zalo để tìm và gửi lời mời kết bạn ngay lập tức.
          </p>

          <v-text-field
            v-model="searchPhone"
            label="Số điện thoại"
            placeholder="0912345678"
            prepend-inner-icon="mdi-phone"
            variant="outlined"
            density="comfortable"
            class="mb-4"
            @keyup.enter="performSearch"
          />

          <v-btn
            color="primary"
            block
            size="large"
            :loading="searching"
            @click="performSearch"
            :disabled="!searchPhone || !selectedAccountId"
          >
            Tìm kiếm
          </v-btn>

          <!-- Search Result -->
          <v-expand-transition>
            <div v-if="searchResult" class="mt-6 pa-4 border rounded-lg border-blue" style="background: rgba(59, 130, 246, 0.1);">
              <div class="d-flex align-center mb-4">
                <v-avatar size="56" class="mr-3 border bg-grey-lighten-4">
                  <v-img v-if="searchResult.avatar" :src="searchResult.avatar" />
                  <v-icon v-else icon="mdi-account" />
                </v-avatar>
                <div>
                  <div class="font-weight-bold">{{ searchResult.display_name || searchResult.zalo_name || 'Không có tên' }}</div>
                  <div class="text-caption text-grey">UID: {{ searchResult.uid }}</div>
                </div>
              </div>

              <v-textarea
                v-model="friendMessage"
                label="Lời nhắn kết bạn"
                rows="2"
                density="compact"
                variant="outlined"
                class="mb-4"
                hide-details
              />

              <v-btn
                color="success"
                block
                :loading="sendingRequest"
                @click="sendRequest"
                prepend-icon="mdi-plus"
              >
                Gửi lời mời kết bạn
              </v-btn>
            </div>
          </v-expand-transition>

          <v-alert
            v-if="searchError"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-4"
            closable
            @click:close="searchError = ''"
          >
            {{ searchError }}
          </v-alert>
        </v-card>
      </v-col>
    </v-row>

    <!-- Global snackbar for results -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000" location="bottom right">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api } from '@/api/index';
import { zaloFriendsApi } from '@/api/zalo-friends';

const tab = ref('received');
const accountOptions = ref<{ text: string; value: string }[]>([]);
const selectedAccountId = ref<string | null>(null);

const receivedRequests = ref<any[]>([]);
const loadingReceived = ref(false);

const sentRequests = ref<any[]>([]);
const loadingSent = ref(false);

const actionLoading = ref<string | null>(null);
const snackbar = ref({ show: false, text: '', color: 'success' });
 
const friends = ref<any[]>([]);
const loadingFriends = ref(false);
const friendSearch = ref('');

const filteredFriends = computed(() => {
  if (!friendSearch.value) return friends.value;
  const s = friendSearch.value.toLowerCase();
  return friends.value.filter(f => 
    (f.displayName || f.zaloName || '').toLowerCase().includes(s) || 
    f.userId.includes(s)
  );
});

// Search part
const searchPhone = ref('');
const searching = ref(false);
const searchResult = ref<any>(null);
const searchError = ref('');
const friendMessage = ref('Chào bạn, mình kết bạn nhé!');
const sendingRequest = ref(false);

onMounted(async () => {
  await fetchAccounts();
  window.addEventListener('zalo:friend-event', handleFriendEvent);
});

onUnmounted(() => {
  window.removeEventListener('zalo:friend-event', handleFriendEvent);
});

function handleFriendEvent(e: any) {
  const data = e.detail;
  // If the event belongs to the currently selected account, refresh lists
  if (data.accountId === selectedAccountId.value) {
    console.log('[FriendManager] Real-time refresh due to event:', data.type);
    refreshLists();
  }
}

async function fetchAccounts() {
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
    accountOptions.value = accounts.map((a: any) => ({
      text: a.displayName || a.zaloUid || a.id,
      value: a.id,
    }));
    if (accountOptions.value.length > 0) {
      selectedAccountId.value = accountOptions.value[0].value;
    }
  } catch {
    showSnackbar('Không thể lấy danh sách tài khoản Zalo', 'error');
  }
}

watch(selectedAccountId, (val) => {
  if (val) {
    refreshLists();
  }
});

function refreshLists() {
  fetchReceived();
  fetchSent();
  fetchFriends();
}

async function fetchReceived() {
  if (!selectedAccountId.value) return;
  loadingReceived.value = true;
  receivedRequests.value = []; // Clear old data
  try {
    const res = await zaloFriendsApi.getReceivedRequests(selectedAccountId.value);
    receivedRequests.value = res.data || [];
    console.log(`[FriendManager] Received requests for ${selectedAccountId.value}:`, receivedRequests.value.length);
  } catch (err) {
    console.error('fetchReceived error:', err);
  } finally {
    loadingReceived.value = false;
  }
}

async function fetchSent() {
  if (!selectedAccountId.value) return;
  loadingSent.value = true;
  sentRequests.value = []; // Clear old data
  try {
    const res = await zaloFriendsApi.getSentRequests(selectedAccountId.value);
    sentRequests.value = res.data || [];
    console.log(`[FriendManager] Sent requests for ${selectedAccountId.value}:`, sentRequests.value.length);
  } catch (err) {
    console.error('fetchSent error:', err);
  } finally {
    loadingSent.value = false;
  }
}

async function fetchFriends() {
  if (!selectedAccountId.value) return;
  loadingFriends.value = true;
  try {
    const res = await zaloFriendsApi.getFriends(selectedAccountId.value);
    friends.value = res.data || [];
    console.log(`[FriendManager] Friends list for ${selectedAccountId.value}:`, friends.value.length);
  } catch (err) {
    console.error('fetchFriends error:', err);
  } finally {
    loadingFriends.value = false;
  }
}

async function acceptFriend(uid: string) {
  if (!selectedAccountId.value) return;
  actionLoading.value = uid;
  try {
    await zaloFriendsApi.acceptRequest(selectedAccountId.value, uid);
    showSnackbar('Đã chấp nhận kết bạn thành công', 'success');
    fetchReceived();
  } catch (err: any) {
    showSnackbar(err.response?.data?.error || 'Chấp nhận thất bại', 'error');
  } finally {
    actionLoading.value = null;
  }
}

async function rejectFriend(uid: string) {
  if (!selectedAccountId.value) return;
  actionLoading.value = uid;
  try {
    await zaloFriendsApi.rejectRequest(selectedAccountId.value, uid);
    showSnackbar('Đã từ chối lời mời kết bạn', 'success');
    fetchReceived();
  } catch (err: any) {
    showSnackbar(err.response?.data?.error || 'Từ chối thất bại', 'error');
  } finally {
    actionLoading.value = null;
  }
}

async function undoFriend(uid: string) {
  if (!selectedAccountId.value) return;
  actionLoading.value = uid;
  try {
    await zaloFriendsApi.undoRequest(selectedAccountId.value, uid);
    showSnackbar('Đã thu hồi lời mời kết bạn', 'success');
    fetchSent();
  } catch (err: any) {
    showSnackbar(err.response?.data?.error || 'Thu hồi thất bại', 'error');
  } finally {
    actionLoading.value = null;
  }
}

async function performSearch() {
  if (!searchPhone.value || !selectedAccountId.value) return;
  searching.value = true;
  searchResult.value = null;
  searchError.value = '';
  try {
    const res = await zaloFriendsApi.searchPhone(selectedAccountId.value, searchPhone.value);
    searchResult.value = res.data;
  } catch (err: any) {
    searchError.value = err.response?.data?.error || 'Không tìm thấy người dùng này';
  } finally {
    searching.value = false;
  }
}

async function sendRequest() {
  if (!searchResult.value?.uid || !selectedAccountId.value) return;
  sendingRequest.value = true;
  try {
    await zaloFriendsApi.sendRequest(selectedAccountId.value, searchResult.value.uid, friendMessage.value);
    showSnackbar('Đã gửi lời mời kết bạn thành công', 'success');
    searchResult.value = null;
    searchPhone.value = '';
    fetchSent();
  } catch (err: any) {
    showSnackbar(err.response?.data?.error || 'Gửi lời mời thất bại', 'error');
  } finally {
    sendingRequest.value = false;
  }
}

function showSnackbar(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

function formatDate(ts: number) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('vi-VN');
}
</script>

<style scoped>
.hover-card {
  transition: all 0.3s ease;
  border: 1px solid rgba(0,0,0,0.1) !important;
}
.hover-card:hover {
  transform: translateY(-4px);
  border-color: #3B82F6 !important;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08) !important;
}
.shadow-sm {
  box-shadow: 0 2px 12px rgba(0,0,0,0.05) !important;
}
.italic {
  font-style: italic;
}
</style>
