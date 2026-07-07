<template>
  <v-container fluid class="pa-6">
    <div class="d-flex align-center mb-6 ga-4">
      <h1 class="text-h4 font-weight-bold">Chiến dịch Gửi hàng loạt</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
        Tạo chiến dịch
      </v-btn>
    </div>

    <!-- Danh sách chiến dịch -->
    <v-card class="rounded-xl overflow-hidden shadow-sm" elevation="0" border>
      <v-data-table-server
        :headers="headers"
        :items="campaigns"
        :loading="loading"
        v-model:page="pagination.page"
        v-model:items-per-page="pagination.limit"
        :items-length="total"
        item-value="id"
        hover
        @click:row="onRowClick"
        @update:options="fetchCampaigns"
      >
        <template #item.status="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small" variant="tonal">
            {{ getStatusText(item.status) }}
          </v-chip>
        </template>
        <template #item.scheduledAt="{ item }">
          {{ new Date(item.scheduledAt).toLocaleString('vi-VN') }}
        </template>
        <template #item.progress="{ item }">
          {{ item._count?.tasks || 0 }} tin nhắn
        </template>
        <template #item.actions="{ item }">
          <div class="d-flex justify-end gap-2">
            <v-btn
              v-if="(item as any).status === 'pending'"
              icon="mdi-pencil"
              variant="text"
              size="small"
              color="primary"
              @click.stop="openEditDialog(item)"
            />
            <v-btn
              icon="mdi-delete"
              variant="text"
              size="small"
              color="error"
              @click.stop="deleteCampaign(item)"
            />
          </div>
        </template>
      </v-data-table-server>
    </v-card>

    <!-- Dialog Tạo/Sửa chiến dịch -->
    <v-dialog v-model="showCreateDialog" max-width="700">
      <v-card class="rounded-xl">
        <v-toolbar color="primary" :title="editMode ? 'Sửa chiến dịch' : 'Tạo chiến dịch mới'" />
        <v-card-text class="pt-6">
          <v-form v-model="isValid" @submit.prevent="createCampaign">
            <v-text-field
              v-model="newCampaign.name"
              label="Tên chiến dịch"
              :rules="[v => !!v || 'Vui lòng nhập tên chiến dịch']"
              variant="outlined"
              class="mb-4"
            />

            <v-select
              v-model="newCampaign.teamId"
              :items="teams"
              item-title="name"
              item-value="id"
              label="Chọn Nhóm (Team)"
              :rules="[v => !!v || 'Vui lòng chọn nhóm']"
              variant="outlined"
              class="mb-4"
              :disabled="editMode"
            />

            <v-combobox
              v-model="newCampaign.tags"
              :items="availableTags"
              label="Chọn Tags khách hàng"
              multiple
              chips
              clearable
              variant="outlined"
              :rules="[v => v.length > 0 || 'Vui lòng chọn ít nhất 1 tag']"
              class="mb-4"
              placeholder="Chọn tag có sẵn hoặc gõ Enter để thêm"
              :disabled="editMode"
            />

            <v-textarea
              v-model="newCampaign.messageContent"
              label="Nội dung tin nhắn"
              :rules="[v => !!v || 'Vui lòng nhập nội dung']"
              variant="outlined"
              class="mb-4"
              rows="4"
              hint="Bạn có thể dùng {name} để thay bằng tên khách hàng"
              persistent-hint
            />

            <v-text-field
              v-model="newCampaign.scheduledAt"
              label="Thời gian bắt đầu gửi"
              type="datetime-local"
              :rules="[v => !!v || 'Vui lòng chọn thời gian']"
              variant="outlined"
            />
          </v-form>
        </v-card-text>
        <v-card-actions class="px-6 pb-6">
          <v-spacer />
          <v-btn variant="text" @click="showCreateDialog = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="saving"
            :disabled="!isValid"
            @click="createCampaign"
          >
            Lưu chiến dịch
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog Chi tiết chiến dịch -->
    <v-dialog v-model="showDetailDialog" max-width="900">
      <v-card class="rounded-xl" v-if="selectedCampaign">
        <v-toolbar color="surface">
          <v-toolbar-title class="font-weight-bold">{{ selectedCampaign.name }}</v-toolbar-title>
          <v-spacer />
          <v-chip :color="getStatusColor(selectedCampaign.status)" class="mr-4">
            {{ getStatusText(selectedCampaign.status) }}
          </v-chip>
          
          <v-btn
            v-if="['running', 'pending'].includes(selectedCampaign.status)"
            color="warning"
            variant="flat"
            size="small"
            class="mr-2"
            @click="updateStatus('paused')"
            :loading="updatingStatus"
          >
            Tạm dừng
          </v-btn>
          <v-btn
            v-if="selectedCampaign.status === 'paused'"
            color="success"
            variant="flat"
            size="small"
            class="mr-2"
            @click="updateStatus('running')"
            :loading="updatingStatus"
          >
            Tiếp tục
          </v-btn>
          <v-btn
            v-if="['running', 'pending', 'paused'].includes(selectedCampaign.status)"
            color="error"
            variant="flat"
            size="small"
            class="mr-2"
            @click="updateStatus('cancelled')"
            :loading="updatingStatus"
          >
            Hủy
          </v-btn>
          
          <v-btn icon="mdi-close" variant="text" @click="showDetailDialog = false" />
        </v-toolbar>
        
        <v-card-text class="pt-4">
          <v-row class="mb-4">
            <v-col cols="12" md="6">
              <div class="text-body-2 text-grey">Nhóm</div>
              <div class="font-weight-medium">{{ selectedCampaign.team?.name }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-body-2 text-grey">Thời gian hẹn</div>
              <div class="font-weight-medium">{{ new Date(selectedCampaign.scheduledAt).toLocaleString('vi-VN') }}</div>
            </v-col>
            <v-col cols="12">
              <div class="text-body-2 text-grey">Nội dung</div>
              <div class="font-weight-medium bg-grey-lighten-4 pa-3 rounded mt-1" style="white-space: pre-wrap;">{{ selectedCampaign.messageContent }}</div>
            </v-col>
          </v-row>

          <h3 class="text-subtitle-1 font-weight-bold mb-2">Danh sách khách hàng ({{ selectedCampaign.tasks?.length || 0 }})</h3>
          <v-data-table
            :headers="taskHeaders"
            :items="selectedCampaign.tasks || []"
            :items-per-page="10"
            density="compact"
          >
            <template #item.status="{ item }">
              <v-chip :color="getTaskStatusColor((item as any).status)" size="x-small">
                {{ (item as any).status }}
              </v-chip>
            </template>
            <template #item.sentAt="{ item }">
              {{ (item as any).sentAt ? new Date((item as any).sentAt).toLocaleString('vi-VN') : '—' }}
            </template>
          </v-data-table>
        </v-card-text>
      </v-card>
    </v-dialog>
    <!-- Dialog Xác nhận xóa -->
    <v-dialog v-model="showDeleteDialog" max-width="400">
      <v-card class="rounded-xl">
        <v-card-title class="text-h6 font-weight-bold pt-4 px-6">
          Xác nhận xóa
        </v-card-title>
        <v-card-text class="px-6 pb-2">
          Bạn có chắc chắn muốn xóa chiến dịch <span class="font-weight-bold">"{{ campaignToDelete?.name }}"</span> không?
          <div class="text-caption text-error mt-2">
            * Toàn bộ lịch sử gửi tin của chiến dịch này cũng sẽ bị xóa vĩnh viễn.
          </div>
        </v-card-text>
        <v-card-actions class="px-6 pb-4">
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="showDeleteDialog = false">Hủy bỏ</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="confirmDelete">Xóa chiến dịch</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { api } from '@/api/index';

const campaigns = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const pagination = ref({ page: 1, limit: 20 });

const availableTags = computed(() => {
  if (!newCampaign.value.teamId) return [];
  const team = teams.value.find(t => t.id === newCampaign.value.teamId);
  return team?.tags || [];
});

const headers = [
  { title: 'Tên chiến dịch', key: 'name', sortable: false },
  { title: 'Nhóm', key: 'team.name', sortable: false },
  { title: 'Người tạo', key: 'creator.fullName', sortable: false },
  { title: 'Hẹn giờ', key: 'scheduledAt', sortable: false },
  { title: 'Số lượng', key: 'progress', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Thao tác', key: 'actions', sortable: false, align: 'end' as const },
];

const taskHeaders = [
  { title: 'Khách hàng', key: 'contact.fullName', sortable: false },
  { title: 'SĐT', key: 'contact.phone', sortable: false },
  { title: 'Gửi qua Zalo', key: 'zaloAccount.displayName', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Thời gian gửi', key: 'sentAt', sortable: false },
  { title: 'Lỗi (nếu có)', key: 'errorMessage', sortable: false },
];

// Create/Edit Dialog
const showCreateDialog = ref(false);
const isValid = ref(false);
const saving = ref(false);
const teams = ref<any[]>([]);
const editMode = ref(false);
const editingId = ref<string | null>(null);

const newCampaign = ref({
  name: '',
  teamId: '',
  tags: [] as string[],
  messageContent: '',
  scheduledAt: '',
});

// Delete Dialog
const showDeleteDialog = ref(false);
const campaignToDelete = ref<any>(null);
const deleting = ref(false);

function showToast(title: string, message: string, color: string = 'success') {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { title, message, color, icon: color === 'success' ? 'mdi-check-circle' : 'mdi-alert-circle' }
  }));
}

function openCreateDialog() {
  editMode.value = false;
  editingId.value = null;
  newCampaign.value = {
    name: '',
    teamId: '',
    tags: [] as string[],
    messageContent: '',
    scheduledAt: '',
  };
  showCreateDialog.value = true;
}

function openEditDialog(item: any) {
  editMode.value = true;
  editingId.value = item.id;
  
  // Convert local ISO string to local datetime format for input type="datetime-local"
  let formattedDate = '';
  if (item.scheduledAt) {
    const d = new Date(item.scheduledAt);
    formattedDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  newCampaign.value = {
    name: item.name,
    teamId: item.teamId,
    tags: item.tags || [],
    messageContent: item.messageContent,
    scheduledAt: formattedDate,
  };
  showCreateDialog.value = true;
}

function deleteCampaign(item: any) {
  campaignToDelete.value = item;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  if (!campaignToDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/campaigns/${campaignToDelete.value.id}`);
    showToast('Thành công', 'Đã xóa chiến dịch');
    showDeleteDialog.value = false;
    fetchCampaigns();
  } catch (err: any) {
    console.error(err);
    showToast('Lỗi', err.response?.data?.error || err.message, 'error');
  } finally {
    deleting.value = false;
  }
}

// Detail Dialog
const showDetailDialog = ref(false);
const selectedCampaign = ref<any>(null);
const updatingStatus = ref(false);

function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return 'info';
    case 'running': return 'primary';
    case 'paused': return 'warning';
    case 'completed': return 'success';
    case 'cancelled': return 'error';
    default: return 'grey';
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'pending': return 'Đang chờ';
    case 'running': return 'Đang chạy';
    case 'paused': return 'Tạm dừng';
    case 'completed': return 'Hoàn thành';
    case 'cancelled': return 'Đã hủy';
    default: return status;
  }
}

function getTaskStatusColor(status: string) {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'error';
  return 'grey';
}

async function fetchCampaigns() {
  loading.value = true;
  try {
    const res = await api.get('/campaigns', {
      params: {
        page: pagination.value.page,
        limit: pagination.value.limit,
      }
    });
    campaigns.value = res.data.campaigns;
    total.value = res.data.total;
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function fetchTeams() {
  try {
    const res = await api.get('/teams');
    teams.value = res.data.teams || res.data;
  } catch (err) {
    console.error(err);
  }
}

async function createCampaign() {
  if (!isValid.value) return;
  saving.value = true;
  try {
    const payload = {
      ...newCampaign.value,
      scheduledAt: new Date(newCampaign.value.scheduledAt).toISOString(),
    };

    if (editMode.value && editingId.value) {
      await api.put(`/campaigns/${editingId.value}`, payload);
      showToast('Thành công', 'Cập nhật chiến dịch thành công!');
    } else {
      await api.post('/campaigns', payload);
      showToast('Thành công', 'Tạo chiến dịch thành công!');
    }
    
    showCreateDialog.value = false;
    // Reset form
    editMode.value = false;
    editingId.value = null;
    newCampaign.value = {
      name: '',
      teamId: '',
      tags: [],
      messageContent: '',
      scheduledAt: '',
    };
    fetchCampaigns();
  } catch (err: any) {
    console.error(err);
    showToast('Lỗi', err.response?.data?.error || err.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function onRowClick(_event: any, { item }: any) {
  try {
    const res = await api.get(`/campaigns/${item.id}`);
    selectedCampaign.value = res.data;
    showDetailDialog.value = true;
  } catch (err) {
    console.error(err);
  }
}

async function updateStatus(newStatus: string) {
  if (!selectedCampaign.value) return;
  if (!confirm(`Bạn có chắc muốn chuyển chiến dịch sang trạng thái: ${newStatus}?`)) return;
  
  updatingStatus.value = true;
  try {
    await api.put(`/campaigns/${selectedCampaign.value.id}/status`, { status: newStatus });
    // Refresh detail
    const res = await api.get(`/campaigns/${selectedCampaign.value.id}`);
    selectedCampaign.value = res.data;
    // Refresh list
    fetchCampaigns();
  } catch (err: any) {
    console.error(err);
    showToast('Lỗi', err.response?.data?.error || err.message, 'error');
  } finally {
    updatingStatus.value = false;
  }
}

let refreshTimer: any;

onMounted(() => {
  fetchCampaigns();
  fetchTeams();
  refreshTimer = setInterval(() => {
    // Chỉ auto-refresh nếu không đang focus vào form hay dropdown để tránh giật lag (hoặc có thể cứ refresh bảng ngầm)
    // data-table-server sẽ làm loading quay quay, ta có thể tắt spinner khi auto-refresh bằng cách không bật loading.
    // Tạm thời đơn giản nhất là fetchCampaigns();
    api.get('/campaigns', {
      params: {
        page: pagination.value.page,
        limit: pagination.value.limit,
      }
    }).then(res => {
      campaigns.value = res.data.campaigns;
      total.value = res.data.total;
    });
  }, 5000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>
