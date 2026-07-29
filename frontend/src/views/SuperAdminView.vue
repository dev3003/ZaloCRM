<template>
  <div class="pa-6 max-width-1400 mx-auto">
    <!-- Super Admin Header -->
    <div class="d-flex align-center justify-space-between mb-6">
      <div>
        <div class="d-flex align-center ga-2">
          <v-chip color="error" size="small" variant="flat" class="font-weight-bold">
            <v-icon start size="14">mdi-shield-crown</v-icon>
            SUPER ADMIN SYSTEM
          </v-chip>
        </div>
        <h1 class="text-h4 font-weight-bold mt-2">Quản trị Hệ thống Omni360</h1>
        <p class="text-body-2 text-medium-emphasis">
          Quản lý toàn bộ Tổ chức, trạng thái Máy chủ Agent và Cấu hình Lưu trữ FTP dùng chung trên hệ thống.
        </p>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <v-tabs v-model="currentTab" color="primary" class="mb-6 border-b">
      <v-tab value="orgs" class="font-weight-bold">
        <v-icon start>mdi-domain</v-icon>
        Tổ chức & Trung tâm ({{ organizations.length }})
      </v-tab>
      <v-tab value="agents" class="font-weight-bold">
        <v-icon start>mdi-server-network</v-icon>
        Máy chủ Agent ({{ agents.length }})
      </v-tab>
      <v-tab value="ftp" class="font-weight-bold">
        <v-icon start>mdi-folder-network</v-icon>
        Cấu hình Lưu trữ FTP
      </v-tab>
    </v-tabs>

    <v-window v-model="currentTab">
      <!-- TAB 1: ORGANIZATIONS MANAGEMENT -->
      <v-window-item value="orgs">
        <v-card variant="outlined" class="rounded-xl bg-surface">
          <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
            <span class="text-h6 font-weight-bold">Danh sách Tổ chức / Trung tâm</span>
            <v-text-field
              v-model="orgSearch"
              prepend-inner-icon="mdi-magnify"
              label="Tìm kiếm theo tên tổ chức..."
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 320px;"
            />
          </v-card-title>

          <v-data-table
            :headers="orgHeaders"
            :items="filteredOrgs"
            :loading="loadingOrgs"
            hover
          >
            <template v-slot:item.name="{ item }">
              <div class="font-weight-bold color-primary">{{ item.name }}</div>
              <div class="text-caption text-grey">ID: {{ item.id }}</div>
            </template>

            <template v-slot:item.stats="{ item }">
              <div class="d-flex align-center ga-3">
                <v-chip size="x-small" color="primary" variant="tonal">
                  <v-icon start size="12">mdi-account-group</v-icon>
                  {{ item.stats.usersCount }} Users
                </v-chip>
                <v-chip size="x-small" color="info" variant="tonal">
                  <v-icon start size="12">mdi-chat</v-icon>
                  {{ item.stats.zaloAccountsCount }} Zalo
                </v-chip>
              </div>
            </template>

            <template v-slot:item.status="{ item }">
              <v-chip
                :color="item.status === 'active' ? 'success' : 'error'"
                size="small"
                class="font-weight-bold"
              >
                {{ item.status === 'active' ? 'Đang hoạt động' : 'Tạm khóa' }}
              </v-chip>
            </template>

            <template v-slot:item.createdAt="{ item }">
              {{ formatDate(item.createdAt) }}
            </template>

            <template v-slot:item.actions="{ item }">
              <v-btn
                v-if="item.status === 'active'"
                color="error"
                variant="tonal"
                size="small"
                prepend-icon="mdi-lock-outline"
                @click="openLockOrgDialog(item)"
              >
                Khóa Tổ chức
              </v-btn>
              <v-btn
                v-else
                color="success"
                variant="tonal"
                size="small"
                prepend-icon="mdi-lock-open-outline"
                @click="unlockOrg(item)"
              >
                Mở khóa
              </v-btn>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 2: AGENT SERVERS MANAGEMENT -->
      <v-window-item value="agents">
        <v-card variant="outlined" class="rounded-xl bg-surface">
          <v-card-title class="pa-4 border-b font-weight-bold text-h6">
            Danh sách Máy chủ Agent Toàn hệ thống
          </v-card-title>

          <v-data-table
            :headers="agentHeaders"
            :items="agents"
            :loading="loadingAgents"
            hover
          >
            <template v-slot:item.orgName="{ item }">
              <div class="font-weight-bold">{{ item.org?.name || 'N/A' }}</div>
            </template>

            <template v-slot:item.agentKey="{ item }">
              <code class="bg-grey-lighten-4 pa-1 rounded text-caption">{{ item.agentKey }}</code>
            </template>

            <template v-slot:item.fingerprint="{ item }">
              <span class="text-caption text-grey">
                {{ item.fingerprint || 'Chưa nhận diện' }}
              </span>
            </template>

            <template v-slot:item.updatedAt="{ item }">
              {{ formatDate(item.updatedAt) }}
            </template>

            <template v-slot:item.status="{ item }">
              <v-chip :color="item.status === 'active' ? 'success' : 'error'" size="small">
                {{ item.status === 'active' ? 'ONLINE / VALID' : 'REVOKED' }}
              </v-chip>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 3: FTP STORAGE MANAGEMENT -->
      <v-window-item value="ftp">
        <v-card variant="outlined" class="rounded-xl bg-surface pa-6">
          <div class="d-flex align-center justify-space-between mb-4">
            <div>
              <div class="text-h6 font-weight-bold">Cấu hình Lưu trữ FTP Tập trung</div>
              <div class="text-caption text-grey">Super Admin quản lý duy nhất các máy chủ lưu trữ file/media cho toàn bộ hệ thống.</div>
            </div>
            <v-btn color="primary" prepend-icon="mdi-plus" rounded="lg" @click="openFtpDialog()">
              Thêm Cấu hình FTP
            </v-btn>
          </div>

          <v-data-table
            :headers="ftpHeaders"
            :items="ftpConfigs"
            :loading="loadingFtp"
            hover
          >
            <template v-slot:item.isActive="{ item }">
              <v-chip :color="item.isActive ? 'success' : 'grey'" size="small" class="font-weight-bold">
                {{ item.isActive ? 'ĐANG SỬ DỤNG' : 'KHÔNG DÙNG' }}
              </v-chip>
            </template>

            <template v-slot:item.actions="{ item }">
              <div class="d-flex align-center ga-2">
                <v-btn icon="mdi-pencil" size="small" variant="text" color="primary" @click="openFtpDialog(item)" />
                <v-btn icon="mdi-connection" size="small" variant="text" color="info" @click="testFtp(item)" />
                <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="deleteFtp(item)" />
              </div>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- LOCK ORG DIALOG -->
    <v-dialog v-model="showLockDialog" max-width="440">
      <v-card class="pa-6 rounded-xl">
        <div class="d-flex align-center text-error mb-3">
          <v-icon color="error" class="mr-2" size="28">mdi-lock-alert</v-icon>
          <div class="text-h6 font-weight-bold">Xác nhận Khóa Tổ chức</div>
        </div>

        <p class="text-body-2 mb-4">
          Bạn có chắc chắn muốn KHÓA Tổ chức <strong>{{ selectedOrg?.name }}</strong> không?
          <br /><br />
          <span class="text-error font-weight-bold">Hậu quả:</span> Mọi nhân viên thuộc tổ chức sẽ bị đẩy out ngay lập tức và kết nối Máy chủ Agent sẽ bị tạm dừng.
        </p>

        <div class="d-flex align-center justify-end ga-2">
          <v-btn variant="text" @click="showLockDialog = false">Hủy</v-btn>
          <v-btn color="error" rounded="lg" class="font-weight-bold" :loading="locking" @click="confirmLockOrg">
            Xác nhận Khóa
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- FTP EDIT DIALOG -->
    <v-dialog v-model="showFtpDialog" max-width="500">
      <v-card class="pa-6 rounded-xl">
        <div class="text-h6 font-weight-bold mb-4">
          {{ editingFtpId ? 'Chỉnh sửa Cấu hình FTP' : 'Thêm Cấu hình FTP Mới' }}
        </div>

        <v-form @submit.prevent="saveFtpConfig">
          <v-text-field v-model="ftpForm.name" label="Tên gợi nhớ" variant="outlined" density="compact" class="mb-2" required />
          <v-text-field v-model="ftpForm.host" label="FTP Host (IP/Domain)" variant="outlined" density="compact" class="mb-2" required />
          <v-text-field v-model.number="ftpForm.port" label="Port" type="number" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="ftpForm.user" label="FTP Username" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="ftpForm.password" label="FTP Password" type="password" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="ftpForm.mediaUrl" label="Public Media URL (HTTP Prefix)" variant="outlined" density="compact" class="mb-4" />
          
          <v-switch v-model="ftpForm.isActive" label="Đặt làm Cấu hình Đang sử dụng" color="success" hide-details class="mb-4" />

          <div class="d-flex align-center justify-end ga-2">
            <v-btn variant="text" @click="showFtpDialog = false">Hủy</v-btn>
            <v-btn type="submit" color="primary" rounded="lg" class="font-weight-bold" :loading="savingFtp">
              Lưu Cấu hình
            </v-btn>
          </div>
        </v-form>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api';

const currentTab = ref('orgs');

// Orgs State
const organizations = ref<any[]>([]);
const loadingOrgs = ref(true);
const orgSearch = ref('');
const showLockDialog = ref(false);
const selectedOrg = ref<any>(null);
const locking = ref(false);

const orgHeaders = [
  { title: 'Tên Tổ Chức', key: 'name', sortable: true },
  { title: 'Thống kê', key: 'stats', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Ngày tạo', key: 'createdAt', sortable: true },
  { title: 'Thao tác', key: 'actions', sortable: false, align: 'end' as const }
];

const filteredOrgs = computed(() => {
  if (!orgSearch.value) return organizations.value;
  return organizations.value.filter(o => o.name.toLowerCase().includes(orgSearch.value.toLowerCase()));
});

async function fetchOrganizations() {
  loadingOrgs.value = true;
  try {
    const res = await api.get('/super-admin/organizations');
    organizations.value = res.data;
  } catch (error) {
    showToast('Lỗi', 'Không thể tải danh sách Tổ chức', 'error');
  } finally {
    loadingOrgs.value = false;
  }
}

function openLockOrgDialog(org: any) {
  selectedOrg.value = org;
  showLockDialog.value = true;
}

async function confirmLockOrg() {
  if (!selectedOrg.value) return;
  locking.value = true;
  try {
    await api.put(`/super-admin/organizations/${selectedOrg.value.id}/status`, { status: 'suspended' });
    showLockDialog.value = false;
    fetchOrganizations();
    showToast('Đã khóa', `Đã khóa tài khoản tổ chức ${selectedOrg.value.name}`, 'success');
  } catch (error) {
    showToast('Lỗi', 'Không thể khóa tổ chức', 'error');
  } finally {
    locking.value = false;
  }
}

async function unlockOrg(org: any) {
  try {
    await api.put(`/super-admin/organizations/${org.id}/status`, { status: 'active' });
    fetchOrganizations();
    showToast('Thành công', `Đã mở khóa tổ chức ${org.name}`, 'success');
  } catch (error) {
    showToast('Lỗi', 'Không thể mở khóa', 'error');
  }
}

// Agents State
const agents = ref<any[]>([]);
const loadingAgents = ref(true);

const agentHeaders = [
  { title: 'Tổ chức sở hữu', key: 'orgName', sortable: true },
  { title: 'Agent Key', key: 'agentKey', sortable: false },
  { title: 'Vân tay phần cứng', key: 'fingerprint', sortable: false },
  { title: 'Lần cuối Ping', key: 'updatedAt', sortable: true },
  { title: 'Trạng thái', key: 'status', sortable: true }
];

async function fetchAgents() {
  loadingAgents.value = true;
  try {
    const res = await api.get('/super-admin/agents');
    agents.value = res.data;
  } catch {
    showToast('Lỗi', 'Không thể tải danh sách Agent', 'error');
  } finally {
    loadingAgents.value = false;
  }
}

// FTP State
const ftpConfigs = ref<any[]>([]);
const loadingFtp = ref(true);
const showFtpDialog = ref(false);
const editingFtpId = ref<string | null>(null);
const savingFtp = ref(false);

const ftpForm = ref({
  name: '',
  host: '',
  port: 21,
  user: '',
  password: '',
  mediaUrl: '',
  isActive: false
});

const ftpHeaders = [
  { title: 'Tên cấu hình', key: 'name', sortable: true },
  { title: 'Host / IP', key: 'host', sortable: true },
  { title: 'Port', key: 'port', sortable: false },
  { title: 'Media URL', key: 'mediaUrl', sortable: false },
  { title: 'Trạng thái', key: 'isActive', sortable: true },
  { title: 'Thao tác', key: 'actions', sortable: false, align: 'end' as const }
];

async function fetchFtpConfigs() {
  loadingFtp.value = true;
  try {
    const res = await api.get('/super-admin/storage-configs');
    ftpConfigs.value = res.data;
  } catch {
    showToast('Lỗi', 'Không thể tải cấu hình FTP', 'error');
  } finally {
    loadingFtp.value = false;
  }
}

function openFtpDialog(item?: any) {
  if (item) {
    editingFtpId.value = item.id;
    ftpForm.value = { ...item };
  } else {
    editingFtpId.value = null;
    ftpForm.value = { name: '', host: '', port: 21, user: '', password: '', mediaUrl: '', isActive: false };
  }
  showFtpDialog.value = true;
}

async function saveFtpConfig() {
  savingFtp.value = true;
  try {
    await api.post('/super-admin/storage-configs', {
      id: editingFtpId.value || undefined,
      ...ftpForm.value
    });
    showFtpDialog.value = false;
    fetchFtpConfigs();
    showToast('Thành công', 'Đã lưu cấu hình FTP', 'success');
  } catch {
    showToast('Lỗi', 'Không thể lưu cấu hình FTP', 'error');
  } finally {
    savingFtp.value = false;
  }
}

async function deleteFtp(item: any) {
  if (!confirm(`Bạn có chắc muốn xóa cấu hình FTP ${item.name}?`)) return;
  try {
    await api.delete(`/super-admin/storage-configs/${item.id}`);
    fetchFtpConfigs();
    showToast('Thành công', 'Đã xóa cấu hình FTP', 'success');
  } catch {
    showToast('Lỗi', 'Không thể xóa cấu hình FTP', 'error');
  }
}

async function testFtp(item: any) {
  try {
    await api.post(`/super-admin/storage-configs/${item.id}/test`);
    showToast('Thành công', 'Kết nối FTP tới máy chủ thành công!', 'success');
  } catch {
    showToast('Lỗi', 'Kết nối FTP thất bại', 'error');
  }
}

// Helpers
function formatDate(dateStr?: string) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString('vi-VN');
}

function showToast(title: string, message: string, color: string) {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { title, message, color }
  }));
}

onMounted(() => {
  fetchOrganizations();
  fetchAgents();
  fetchFtpConfigs();
});
</script>

<style scoped>
.max-width-1400 {
  max-width: 1400px;
}
.border-b {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}
</style>
