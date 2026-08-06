<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">Tài khoản Zalo</h1>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="showAddDialog = true">Thêm Zalo</v-btn>
    </div>

    <v-card>
      <v-data-table :headers="headers" :items="accounts" :loading="loading" no-data-text="Chưa có tài khoản Zalo nào">
        <template #item.teams="{ item }">
          <v-chip v-if="!item.teams?.length" size="small" color="grey" variant="flat">Tất cả (Public)</v-chip>
          <div v-else class="d-flex flex-wrap gap-1">
            <v-chip v-for="t in item.teams" :key="t.team.id" size="small" color="primary" variant="flat">{{ t.team.name }}</v-chip>
          </div>
        </template>
        <template #item.status="{ item }">
          <v-chip :color="statusColor(item.liveStatus || item.status)" size="small" variant="flat">
            {{ statusText(item.liveStatus || item.status) }}
          </v-chip>
        </template>
        <template #item.isFriendRequestLocked="{ item }">
          <div class="d-flex justify-center">
            <v-switch
              v-if="authStore.isAdmin"
              v-model="item.isFriendRequestLocked"
              color="error"
              hide-details
              density="compact"
              @change="toggleLockStatus(item)"
            ></v-switch>
            <v-icon v-else-if="item.isFriendRequestLocked" color="error" title="Đã khóa gửi kết bạn">mdi-lock</v-icon>
            <v-icon v-else color="success" title="Đang mở gửi kết bạn">mdi-lock-open-variant</v-icon>
          </div>
        </template>
        <template #item.actions="{ item }">
          <v-btn v-if="authStore.isAdmin" icon size="small" color="blue" title="Sửa" @click="openEdit(item)">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isLeader" icon size="small" color="cyan" title="Phân quyền truy cập" @click="openAccess(item)">
            <v-icon>mdi-shield-account</v-icon>
          </v-btn>
          <v-btn icon size="small" color="success" @click="syncContacts(item.id)" title="Đồng bộ danh bạ Zalo" :loading="syncing === item.id">
            <v-icon>mdi-account-sync</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isLeader && item.liveStatus !== 'connected'" icon size="small" color="primary" @click="loginAccount(item.id)" title="Đăng nhập QR">
            <v-icon>mdi-qrcode</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isLeader && item.liveStatus === 'disconnected' && item.sessionData" icon size="small" color="info" @click="reconnectAccount(item.id)" title="Kết nối lại">
            <v-icon>mdi-refresh</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isAdmin" icon size="small" color="error" @click="confirmDelete(item)" title="Xóa">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Add/Edit account dialog -->
    <v-dialog v-model="showAddDialog" max-width="500">
      <v-card>
        <v-card-title>{{ editTarget ? 'Chỉnh sửa tài khoản Zalo' : 'Thêm tài khoản Zalo' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="newAccountName" label="Tên hiển thị (VD: Zalo Sale Hương)" />
          <v-select
            v-model="selectedTeams"
            :items="teams"
            item-title="name"
            item-value="id"
            label="Gán cho nhóm (để trống: tất cả đều thấy)"
            multiple
            chips
            clearable
          />
          <v-switch
            v-model="isFriendRequestLocked"
            color="error"
            label="Khóa gửi kết bạn (Chỉ nhận lời mời)"
            hide-details
            class="mt-2"
          ></v-switch>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showAddDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="adding" @click="handleAddAccount">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- QR Code dialog -->
    <v-dialog v-model="showQRDialog" max-width="400" persistent>
      <v-card class="text-center pa-4">
        <v-card-title>Quét QR để đăng nhập Zalo</v-card-title>
        <v-card-text>
          <div v-if="qrImage" class="mb-4">
            <img :src="'data:image/png;base64,' + qrImage" alt="QR Code" style="max-width: 280px;" />
          </div>
          <div v-else-if="qrScanned" class="mb-4">
            <v-icon icon="mdi-check-circle" size="64" color="success" />
            <p class="text-h6 mt-2">Đã quét! Xác nhận trên điện thoại...</p>
            <p v-if="scannedName" class="text-body-2">{{ scannedName }}</p>
          </div>
          <div v-else class="mb-4">
            <v-progress-circular indeterminate color="primary" size="64" />
            <p class="mt-2">Đang tạo QR code...</p>
          </div>
          <v-alert v-if="qrError" type="error" density="compact" class="mt-2">{{ qrError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="cancelQR">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400">
      <v-card>
        <v-card-title>Xác nhận xóa</v-card-title>
        <v-card-text>Bạn có chắc muốn xóa tài khoản "{{ deleteTarget?.displayName || deleteTarget?.id }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDeleteDialog = false">Hủy</v-btn>
          <v-btn color="error" :loading="deleting" @click="handleDeleteAccount">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Access control dialog -->
    <ZaloAccessDialog
      v-model="showAccessDialog"
      :account-id="accessTarget?.id ?? ''"
      :account-name="accessTarget?.displayName ?? accessTarget?.id ?? ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useZaloAccounts, type ZaloAccount } from '@/composables/use-zalo-accounts';
import { useTeams } from '@/composables/use-teams';
import { useAuthStore } from '@/stores/auth';
import ZaloAccessDialog from '@/components/settings/ZaloAccessDialog.vue';
import { api } from '@/api/index';

const {
  accounts, loading, adding, deleting,
  showQRDialog, qrImage, qrScanned, scannedName, qrError,
  statusColor, statusText,
  fetchAccounts, addAccount, updateAccount, loginAccount, reconnectAccount, deleteAccount,
  cancelQR, setupSocket,
} = useZaloAccounts();

const { teams, fetchTeams } = useTeams();

const authStore = useAuthStore();

const showAddDialog = ref(false);
const syncing = ref<string | null>(null);
const showDeleteDialog = ref(false);
const showAccessDialog = ref(false);
const newAccountName = ref('');
const selectedTeams = ref<string[]>([]);
const isFriendRequestLocked = ref(false);
const deleteTarget = ref<ZaloAccount | null>(null);
const accessTarget = ref<ZaloAccount | null>(null);
const editTarget = ref<ZaloAccount | null>(null);

const headers = [
  { title: 'Tên', key: 'displayName', sortable: true },
  { title: 'Nhóm quản lý', key: 'teams' },
  { title: 'Zalo UID', key: 'zaloUid' },
  { title: 'SĐT', key: 'phone' },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Khóa kết bạn', key: 'isFriendRequestLocked', sortable: false, align: 'center' as const },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

async function syncContacts(accountId: string) {
  syncing.value = accountId;
  try {
    const res = await api.post(`/zalo-accounts/${accountId}/sync-contacts`);
    alert(`Đồng bộ thành công: ${res.data.created} mới, ${res.data.updated} cập nhật`);
  } catch (err: any) {
    alert('Đồng bộ thất bại: ' + (err.response?.data?.error || err.message));
  } finally {
    syncing.value = null;
  }
}

function openEdit(account: ZaloAccount) {
  editTarget.value = account;
  newAccountName.value = account.displayName || '';
  selectedTeams.value = account.teams?.map(t => t.team.id) || [];
  isFriendRequestLocked.value = !!account.isFriendRequestLocked;
  showAddDialog.value = true;
}

async function handleAddAccount() {
  let ok = false;
  if (editTarget.value) {
    ok = await updateAccount(editTarget.value.id, { 
      displayName: newAccountName.value, 
      teamIds: selectedTeams.value,
      isFriendRequestLocked: isFriendRequestLocked.value
    });
  } else {
    ok = await addAccount(newAccountName.value, selectedTeams.value, isFriendRequestLocked.value);
  }
  
  if (ok) {
    showAddDialog.value = false;
    newAccountName.value = '';
    selectedTeams.value = [];
    isFriendRequestLocked.value = false;
    editTarget.value = null;
  }
}

function confirmDelete(account: ZaloAccount) {
  deleteTarget.value = account;
  showDeleteDialog.value = true;
}

function openAccess(account: ZaloAccount) {
  accessTarget.value = account;
  showAccessDialog.value = true;
}

async function handleDeleteAccount() {
  if (!deleteTarget.value) return;
  const ok = await deleteAccount(deleteTarget.value);
  if (ok) {
    showDeleteDialog.value = false;
    deleteTarget.value = null;
  }
}

async function toggleLockStatus(account: ZaloAccount) {
  try {
    const ok = await updateAccount(account.id, { isFriendRequestLocked: account.isFriendRequestLocked });
    if (!ok) {
      account.isFriendRequestLocked = !account.isFriendRequestLocked; // revert
    }
  } catch (err) {
    account.isFriendRequestLocked = !account.isFriendRequestLocked; // revert
  }
}

onMounted(() => {
  fetchTeams();
  fetchAccounts();
  setupSocket();
});
</script>
