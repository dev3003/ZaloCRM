<template>
  <div class="zalo-group-manager">
    <div class="d-flex align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Quản lý nhóm Zalo</h1>
      <v-spacer />
      <v-select
        v-model="selectedAccountId"
        :items="zaloAccounts"
        item-title="displayName"
        item-value="id"
        label="Tài khoản Zalo đang chọn"
        hide-details
        density="comfortable"
        variant="solo-filled"
        class="account-selector"
        prepend-inner-icon="mdi-account-circle"
      ></v-select>
    </div>

    <v-row v-if="selectedAccountId">
      <v-col cols="12" md="8">
        <v-card class="rounded-xl shadow-sm overflow-hidden" border>
          <v-toolbar color="transparent" flat class="px-2">
            <v-tabs v-model="activeTab" color="primary">
              <v-tab value="all" class="text-none">
                <v-icon start>mdi-account-group</v-icon>
                Nhóm của tôi ({{ groups.length }})
              </v-tab>
            </v-tabs>
            <v-spacer />
            <v-btn
              color="primary"
              prepend-icon="mdi-plus"
              variant="flat"
              class="rounded-lg text-none"
              @click="openCreateGroupDialog"
            >
              Tạo nhóm mới
            </v-btn>
          </v-toolbar>

          <v-divider />

          <v-window v-model="activeTab">
            <v-window-item value="all">
              <div class="group-list-container">
                <v-data-table
                  :headers="headers"
                  :items="groups"
                  :loading="loadingGroups"
                  hover
                  class="bg-transparent custom-table"
                  :items-per-page="10"
                >
                  <template #no-data>
                    <div class="pa-12 text-center">
                      <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-account-group-outline</v-icon>
                      <div class="text-h6 text-grey">Không tìm thấy nhóm nào</div>
                      <v-btn color="primary" variant="text" @click="fetchGroups" class="mt-2">Thử tải lại</v-btn>
                    </div>
                  </template>

                  <template #item.name="{ item }">
                    <div v-if="item" class="d-flex align-center py-3">
                      <v-avatar size="48" class="mr-4 border shadow-sm bg-grey-lighten-4 rounded-lg">
                        <v-img :src="item.avatar || item.raw?.avatar || '/default-group.png'" />
                      </v-avatar>
                      <div>
                        <div class="text-subtitle-1 font-weight-bold mb-n1">{{ item.name || item.raw?.name || 'Nhóm không tên' }}</div>
                        <div class="text-caption text-grey">ID: {{ item.groupId || item.raw?.groupId }}</div>
                      </div>
                    </div>
                  </template>

                  <template #item.totalMember="{ item }">
                    <v-chip v-if="item" size="small" variant="tonal" color="primary" class="font-weight-medium">
                      {{ item.totalMember || item.raw?.totalMember || 0 }} thành viên
                    </v-chip>
                  </template>

                  <template #item.actions="{ item }">
                    <v-menu v-if="item" location="bottom end" transition="slide-y-transition">
                      <template #activator="{ props }">
                        <v-btn icon="mdi-dots-vertical" variant="text" v-bind="props" size="small" color="grey-darken-1"></v-btn>
                      </template>
                      <v-list density="compact" class="pa-1 rounded-lg border shadow-lg" width="180">
                        <v-list-item
                          prepend-icon="mdi-pencil-outline"
                          title="Đổi tên nhóm"
                          @click="openRenameDialog(item.raw || item)"
                          class="rounded-md"
                        />
                        <v-list-item
                          prepend-icon="mdi-account-plus-outline"
                          title="Thêm thành viên"
                          @click="openAddMemberDialog(item.raw || item)"
                          class="rounded-md"
                        />
                        <v-divider class="my-1" />
                        <v-list-item
                          prepend-icon="mdi-logout"
                          title="Rời nhóm"
                          color="error"
                          @click="confirmLeaveGroup(item.raw || item)"
                          class="rounded-md"
                        />
                      </v-list>
                    </v-menu>
                  </template>
                </v-data-table>
              </div>
            </v-window-item>
          </v-window>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <div class="sticky-top">
          <v-card class="rounded-xl pa-5 bg-surface-variant-light" border flat>
            <div class="d-flex align-center mb-4">
              <v-icon color="primary" class="mr-2">mdi-information-outline</v-icon>
              <h3 class="text-h6 font-weight-bold">Thông tin nhóm</h3>
            </div>
            <p class="text-body-2 text-grey-darken-1 mb-6 leading-relaxed">
              Quản lý các nhóm Zalo giúp bạn chăm sóc khách hàng theo từng phân khúc hoặc dự án hiệu quả hơn. Bạn có thể thay đổi tên, thêm người hoặc rời nhóm ngay tại đây.
            </p>
            <v-alert
              type="info"
              variant="tonal"
              border="start"
              class="mb-6 rounded-lg"
              density="comfortable"
            >
              Mọi thay đổi trên CRM sẽ được đồng bộ tức thì với ứng dụng Zalo của bạn.
            </v-alert>
            <div class="text-center pa-4 rounded-xl border mb-2 bg-surface">
              <v-img
                src="https://cdn-icons-png.flaticon.com/512/3211/3211116.png"
                max-height="120"
                class="mx-auto mb-4"
              />
              <div class="text-caption font-weight-medium opacity-70">Đồng bộ hóa dữ liệu thời gian thực</div>
            </div>
          </v-card>
        </div>
      </v-col>
    </v-row>

    <div v-else class="text-center pa-12 mt-12">
      <v-icon size="100" color="grey-lighten-2">mdi-account-switch-outline</v-icon>
      <div class="text-h5 text-grey-darken-1 mt-4">Vui lòng chọn một tài khoản Zalo để bắt đầu</div>
    </div>

    <!-- Create Group Dialog -->
    <v-dialog v-model="createDialog.visible" max-width="500">
      <v-card class="rounded-xl pa-2">
        <v-card-title class="d-flex align-center">
          <v-icon start color="primary">mdi-plus-circle</v-icon>
          Tạo nhóm Zalo mới
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="createDialog.name"
            label="Tên nhóm"
            placeholder="Ví dụ: Nhóm khách hàng VIP"
            variant="outlined"
            class="mb-4"
          />
          <div class="font-weight-bold mb-2">Chọn thành viên ({{ createDialog.selectedMembers.length }})</div>
          <v-text-field
            v-model="createDialog.search"
            prepend-inner-icon="mdi-magnify"
            placeholder="Tìm kiếm bạn bè..."
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
          />
          <v-list
            height="300"
            class="border rounded-lg overflow-y-auto"
          >
            <v-list-item
              v-for="friend in filteredFriends"
              :key="friend.userId"
              :value="friend.userId"
              @click="toggleMemberSelection(friend.userId)"
            >
              <template #prepend>
                <v-checkbox-btn :model-value="createDialog.selectedMembers.includes(friend.userId)" />
              </template>
              <v-list-item-title class="d-flex align-center">
                <v-avatar size="32" class="mr-2 border">
                  <v-img :src="friend.avatar || '/default-avatar.png'" />
                </v-avatar>
                {{ friend.displayName || friend.zaloName }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="createDialog.visible = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="px-6 rounded-lg"
            :loading="createDialog.loading"
            :disabled="!createDialog.name || createDialog.selectedMembers.length < 2"
            @click="createGroup"
          >
            Tạo nhóm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Rename Group Dialog -->
    <v-dialog v-model="renameDialog.visible" max-width="400">
      <v-card class="rounded-xl pa-2">
        <v-card-title>Đổi tên nhóm</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renameDialog.newName"
            label="Tên nhóm mới"
            variant="outlined"
            autofocus
            @keyup.enter="renameGroup"
          />
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="renameDialog.visible = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="px-6 rounded-lg"
            :loading="renameDialog.loading"
            @click="renameGroup"
          >
            Lưu thay đổi
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Add Member Dialog -->
    <v-dialog v-model="addMemberDialog.visible" max-width="500">
      <v-card class="rounded-xl pa-2">
        <v-card-title>Thêm thành viên vào nhóm</v-card-title>
        <v-card-text>
          <div class="mb-4">Nhóm: <span class="font-weight-bold">{{ addMemberDialog.groupName }}</span></div>
          <v-text-field
            v-model="addMemberDialog.search"
            prepend-inner-icon="mdi-magnify"
            placeholder="Tìm bạn bè để thêm..."
            variant="outlined"
            density="compact"
            class="mb-2"
          />
          <v-list height="300" class="border rounded-lg overflow-y-auto">
            <v-list-item
              v-for="friend in filteredFriendsForAdd"
              :key="friend.userId"
              @click="toggleAddMemberSelection(friend.userId)"
            >
              <template #prepend>
                <v-checkbox-btn :model-value="addMemberDialog.selectedMembers.includes(friend.userId)" />
              </template>
              <v-list-item-title class="d-flex align-center">
                <v-avatar size="32" class="mr-2 border">
                  <v-img :src="friend.avatar || '/default-avatar.png'" />
                </v-avatar>
                {{ friend.displayName || friend.zaloName }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="addMemberDialog.visible = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="px-6 rounded-lg"
            :loading="addMemberDialog.loading"
            :disabled="addMemberDialog.selectedMembers.length === 0"
            @click="addMembers"
          >
            Thêm vào nhóm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar Notifications -->
    <v-snackbar v-model="snackbar.visible" :color="snackbar.color" timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { api } from '@/api/index';
import { zaloGroupsApi } from '@/api/zalo-groups';

const zaloAccounts = ref<any[]>([]);
const selectedAccountId = ref<string | null>(null);
const groups = ref<any[]>([]);
const friends = ref<any[]>([]);
const loadingGroups = ref(false);
const activeTab = ref('all');

const headers = [
  { title: 'Tên nhóm', key: 'name', align: 'start' as const },
  { title: 'Thành viên', key: 'totalMember', align: 'center' as const },
  { title: 'Thao tác', key: 'actions', align: 'end' as const, sortable: false },
];

const snackbar = ref({ visible: false, text: '', color: 'success' });
const createDialog = ref({
  visible: false,
  loading: false,
  name: '',
  search: '',
  selectedMembers: [] as string[]
});
const renameDialog = ref({
  visible: false,
  loading: false,
  groupId: '',
  newName: ''
});
const addMemberDialog = ref({
  visible: false,
  loading: false,
  groupId: '',
  groupName: '',
  search: '',
  selectedMembers: [] as string[]
});

onMounted(async () => {
  await fetchAccounts();
  window.addEventListener('zalo:friend-event', handleFriendEvent);
});

onUnmounted(() => {
  window.removeEventListener('zalo:friend-event', handleFriendEvent);
});

function handleFriendEvent(e: any) {
  const data = e.detail;
  // If it's a group related event, we might want to refresh
  if (data.accountId === selectedAccountId.value) {
    fetchGroups();
  }
}

watch(selectedAccountId, (val) => {
  if (val) {
    fetchGroups();
    fetchFriends();
  }
});

async function fetchAccounts() {
  try {
    const res = await api.get('/zalo-accounts');
    zaloAccounts.value = res.data;
    if (zaloAccounts.value.length > 0 && !selectedAccountId.value) {
      selectedAccountId.value = zaloAccounts.value[0].id;
    }
  } catch (err) {
    console.error('fetchAccounts error:', err);
  }
}

async function fetchGroups() {
  if (!selectedAccountId.value) return;
  loadingGroups.value = true;
  try {
    const res = await zaloGroupsApi.getGroups(selectedAccountId.value);
    // Backend now returns a detailed array
    groups.value = Array.isArray(res.data) ? res.data : [];
    console.log('[GroupManager] Groups fetched:', groups.value.length);
  } catch (err) {
    console.error('fetchGroups error:', err);
  } finally {
    loadingGroups.value = false;
  }
}

async function fetchFriends() {
  if (!selectedAccountId.value) return;
  try {
    const res = await api.get(`/zalo-accounts/${selectedAccountId.value}/friends`);
    friends.value = res.data || [];
    console.log('[GroupManager] Friends fetched:', friends.value.length);
  } catch (err) {
    console.error('fetchFriends error:', err);
  }
}

const filteredFriends = computed(() => {
  if (!createDialog.value.search) return friends.value;
  const s = createDialog.value.search.toLowerCase();
  return friends.value.filter(f => 
    (f.displayName || f.zaloName || '').toLowerCase().includes(s)
  );
});

const filteredFriendsForAdd = computed(() => {
  if (!addMemberDialog.value.search) return friends.value;
  const s = addMemberDialog.value.search.toLowerCase();
  return friends.value.filter(f => 
    (f.displayName || f.zaloName || '').toLowerCase().includes(s)
  );
});

function openCreateGroupDialog() {
  createDialog.value = {
    visible: true,
    loading: false,
    name: '',
    search: '',
    selectedMembers: []
  };
}

function toggleMemberSelection(userId: string) {
  const idx = createDialog.value.selectedMembers.indexOf(userId);
  if (idx > -1) createDialog.value.selectedMembers.splice(idx, 1);
  else createDialog.value.selectedMembers.push(userId);
}

async function createGroup() {
  if (!selectedAccountId.value) return;
  createDialog.value.loading = true;
  try {
    await zaloGroupsApi.createGroup(selectedAccountId.value, {
      name: createDialog.value.name,
      members: createDialog.value.selectedMembers
    });
    showSnackbar('Đã tạo nhóm thành công', 'success');
    createDialog.value.visible = false;
    // Wait 1.5s for Zalo to process the new group before refreshing
    setTimeout(() => {
      fetchGroups();
    }, 1500);
  } catch (err) {
    showSnackbar('Tạo nhóm thất bại', 'error');
  } finally {
    createDialog.value.loading = false;
  }
}

function openRenameDialog(group: any) {
  const gid = group.groupId || group.raw?.groupId;
  const gname = group.name || group.raw?.name;
  renameDialog.value = {
    visible: true,
    loading: false,
    groupId: gid,
    newName: gname
  };
}

async function renameGroup() {
  if (!selectedAccountId.value || !renameDialog.value.newName) return;
  renameDialog.value.loading = true;
  try {
    await zaloGroupsApi.renameGroup(selectedAccountId.value, renameDialog.value.groupId, renameDialog.value.newName);
    showSnackbar('Đã đổi tên nhóm thành công', 'success');
    renameDialog.value.visible = false;
    fetchGroups();
  } catch (err) {
    showSnackbar('Đổi tên nhóm thất bại', 'error');
  } finally {
    renameDialog.value.loading = false;
  }
}

function openAddMemberDialog(group: any) {
  const gid = group.groupId || group.raw?.groupId;
  const gname = group.name || group.raw?.name;
  addMemberDialog.value = {
    visible: true,
    loading: false,
    groupId: gid,
    groupName: gname,
    search: '',
    selectedMembers: []
  };
}

function toggleAddMemberSelection(userId: string) {
  const idx = addMemberDialog.value.selectedMembers.indexOf(userId);
  if (idx > -1) addMemberDialog.value.selectedMembers.splice(idx, 1);
  else addMemberDialog.value.selectedMembers.push(userId);
}

async function addMembers() {
  if (!selectedAccountId.value) return;
  addMemberDialog.value.loading = true;
  try {
    await zaloGroupsApi.addMembers(
      selectedAccountId.value, 
      addMemberDialog.value.groupId, 
      addMemberDialog.value.selectedMembers
    );
    showSnackbar('Đã thêm thành viên vào nhóm', 'success');
    addMemberDialog.value.visible = false;
    fetchGroups();
  } catch (err) {
    showSnackbar('Thêm thành viên thất bại', 'error');
  } finally {
    addMemberDialog.value.loading = false;
  }
}

async function confirmLeaveGroup(group: any) {
  if (confirm(`Bạn có chắc muốn rời nhóm "${group.name}"?`)) {
    try {
      await zaloGroupsApi.leaveGroup(selectedAccountId.value!, group.groupId);
      showSnackbar('Đã rời khỏi nhóm', 'info');
      fetchGroups();
    } catch (err) {
      showSnackbar('Rời nhóm thất bại', 'error');
    }
  }
}

function showSnackbar(text: string, color = 'success') {
  snackbar.value = { visible: true, text, color };
}
</script>

<style scoped>
.sticky-top {
  position: sticky;
  top: 24px;
}
.group-list-container {
  max-height: calc(100vh - 250px);
  overflow-y: auto;
}
.custom-table :deep(thead) {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgb(var(--v-theme-surface)) !important;
  color: rgb(var(--v-theme-on-surface)) !important;
}
.custom-table :deep(th) {
  background: rgb(var(--v-theme-surface)) !important;
}
.zalo-group-manager {
  max-width: 1300px;
  margin: 0 auto;
}
.account-selector {
  max-width: 350px;
}
.shadow-sm {
  box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05) !important;
}
</style>
