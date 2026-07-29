<template>
  <div class="super-admin-view">
    <!-- Active Tab Window Container -->
    <v-window v-model="currentTab" class="w-100">
      <!-- TAB 1: ORGANIZATIONS MANAGEMENT -->
      <v-window-item value="orgs">
        <v-card theme="dark" class="rounded-xl border-slate-700 super-card" elevation="6">
          <v-card-title class="d-flex flex-wrap align-center justify-space-between pa-5 border-b-slate bg-slate-900">
            <div>
              <div class="text-h6 font-weight-black text-white d-flex align-center ga-2">
                <v-icon color="#FCD34D" size="24">mdi-domain</v-icon>
                Danh sách Tổ chức & Trung tâm
              </div>
              <div class="text-caption text-slate-300 mt-1">
                Quản lý phân quyền, thống kê tài nguyên và trạng thái hoạt động của toàn bộ khách hàng tổ chức.
              </div>
            </div>

            <v-text-field
              v-model="orgSearch"
              prepend-inner-icon="mdi-magnify"
              placeholder="Tìm kiếm theo tên tổ chức..."
              variant="outlined"
              density="compact"
              hide-details
              class="search-input mt-2 mt-sm-0"
              style="min-width: 280px;"
            />
          </v-card-title>

          <v-data-table
            :headers="orgHeaders"
            :items="filteredOrgs"
            :loading="loadingOrgs"
            hover
            class="super-table"
          >
            <template v-slot:item.name="{ item }">
              <div class="font-weight-black text-amber-bright text-subtitle-2">{{ item.name }}</div>
              <div class="text-caption text-slate-400 font-mono">ID: {{ item.id }}</div>
            </template>

            <template v-slot:item.stats="{ item }">
              <div class="d-flex align-center ga-2 flex-wrap">
                <v-chip size="small" color="blue-lighten-2" variant="flat" class="font-weight-bold">
                  <v-icon start size="14">mdi-account-group</v-icon>
                  {{ item.stats.usersCount }} Users
                </v-chip>
                <v-chip size="small" color="cyan-lighten-2" variant="flat" class="font-weight-bold">
                  <v-icon start size="14">mdi-chat</v-icon>
                  {{ item.stats.zaloAccountsCount }} Zalo
                </v-chip>
                <v-chip size="small" color="purple-lighten-2" variant="flat" class="font-weight-bold">
                  <v-icon start size="14">mdi-book-open-outline</v-icon>
                  {{ item.stats.contactsCount }} Contacts
                </v-chip>
              </div>
            </template>

            <template v-slot:item.status="{ item }">
              <v-chip
                :color="item.status === 'active' ? 'success' : 'error'"
                size="small"
                class="font-weight-black text-white"
                variant="flat"
              >
                <v-icon start size="14">{{ item.status === 'active' ? 'mdi-check-circle' : 'mdi-alert-circle' }}</v-icon>
                {{ item.status === 'active' ? 'Đang hoạt động' : 'Đã tạm khóa' }}
              </v-chip>
            </template>

            <template v-slot:item.createdAt="{ item }">
              <span class="text-slate-200 text-body-2 font-weight-medium">{{ formatDate(item.createdAt) }}</span>
            </template>

            <template v-slot:item.actions="{ item }">
              <v-btn
                v-if="item.status === 'active'"
                color="error"
                variant="flat"
                size="small"
                prepend-icon="mdi-lock-outline"
                class="font-weight-bold rounded-lg text-white"
                @click="openLockOrgDialog(item)"
              >
                Khóa Tổ chức
              </v-btn>
              <v-btn
                v-else
                color="success"
                variant="flat"
                size="small"
                prepend-icon="mdi-lock-open-outline"
                class="font-weight-bold rounded-lg text-white"
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
        <v-card theme="dark" class="rounded-xl border-slate-700 super-card" elevation="6">
          <v-card-title class="pa-5 border-b-slate font-weight-black text-h6 text-white d-flex align-center ga-2 bg-slate-900">
            <v-icon color="#38BDF8" size="24">mdi-server-network</v-icon>
            Danh sách Máy chủ Agent Toàn hệ thống
          </v-card-title>

          <v-data-table
            :headers="agentHeaders"
            :items="agents"
            :loading="loadingAgents"
            hover
            class="super-table"
          >
            <template v-slot:item.orgName="{ item }">
              <div class="font-weight-black text-amber-bright text-subtitle-2">{{ item.org?.name || 'N/A' }}</div>
            </template>

            <template v-slot:item.agentKey="{ item }">
              <code class="bg-slate-950 text-amber-accent-2 px-2 py-1 rounded text-caption border border-slate-700 font-mono">
                {{ item.agentKey }}
              </code>
            </template>

            <template v-slot:item.fingerprint="{ item }">
              <span class="text-caption text-slate-300 font-mono">
                {{ item.fingerprint || 'Chưa nhận diện máy chủ' }}
              </span>
            </template>

            <template v-slot:item.updatedAt="{ item }">
              <span class="text-slate-200 text-body-2 font-weight-medium">{{ formatDate(item.updatedAt) }}</span>
            </template>

            <template v-slot:item.status="{ item }">
              <v-chip :color="item.status === 'active' ? 'success' : 'error'" size="small" variant="flat" class="font-weight-black text-white">
                {{ item.status === 'active' ? 'ONLINE / VALID' : 'REVOKED' }}
              </v-chip>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <!-- TAB 3: FTP STORAGE MANAGEMENT -->
      <v-window-item value="ftp">
        <v-card theme="dark" class="rounded-xl border-slate-700 super-card pa-6" elevation="6">
          <div class="d-flex flex-wrap align-center justify-space-between mb-6 ga-4 border-b-slate pb-4">
            <div>
              <div class="text-h6 font-weight-black text-white d-flex align-center ga-2">
                <v-icon color="#4ADE80" size="24">mdi-folder-network</v-icon>
                Cấu hình Lưu trữ FTP Tập trung
              </div>
              <div class="text-caption text-slate-300 mt-1">
                Super Admin quản lý duy nhất các máy chủ lưu trữ file & media cho toàn bộ hệ thống Omni360.
              </div>
            </div>
            <v-btn color="amber-accent-4" prepend-icon="mdi-plus" rounded="lg" class="font-weight-black text-black" @click="openFtpDialog()">
              Thêm Cấu hình FTP
            </v-btn>
          </div>

          <v-data-table
            :headers="ftpHeaders"
            :items="ftpConfigs"
            :loading="loadingFtp"
            hover
            class="super-table"
          >
            <template v-slot:item.name="{ item }">
              <span class="font-weight-black text-white text-subtitle-2">{{ item.name }}</span>
            </template>

            <template v-slot:item.host="{ item }">
              <span class="text-amber-accent-2 font-mono text-body-2 font-weight-bold">{{ item.host }}</span>
            </template>

            <template v-slot:item.port="{ item }">
              <span class="text-slate-300 font-mono text-body-2">{{ item.port || 21 }}</span>
            </template>

            <template v-slot:item.isActive="{ item }">
              <v-chip :color="item.isActive ? 'success' : 'grey-darken-1'" size="small" variant="flat" class="font-weight-black text-white">
                {{ item.isActive ? 'ĐANG SỬ DỤNG' : 'KHÔNG DÙNG' }}
              </v-chip>
            </template>

            <template v-slot:item.actions="{ item }">
              <div class="d-flex align-center ga-2">
                <v-btn
                  size="small"
                  variant="tonal"
                  color="cyan-accent-2"
                  prepend-icon="mdi-connection"
                  class="font-weight-bold"
                  @click="testFtp(item)"
                >
                  Test Kết nối
                </v-btn>
                <v-btn icon="mdi-pencil" size="small" variant="tonal" color="amber-accent-3" @click="openFtpDialog(item)" />
                <v-btn icon="mdi-delete" size="small" variant="tonal" color="error" @click="deleteFtp(item)" />
              </div>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- LOCK ORG DIALOG -->
    <v-dialog v-model="showLockDialog" max-width="480">
      <v-card theme="dark" class="pa-6 rounded-xl bg-slate-900 border-slate-700 text-white">
        <div class="d-flex align-center text-error mb-3 ga-2">
          <v-icon color="error" size="28">mdi-lock-alert</v-icon>
          <div class="text-h6 font-weight-black">Xác nhận Khóa Tổ chức</div>
        </div>

        <p class="text-body-2 text-slate-200 mb-4">
          Bạn có chắc chắn muốn KHÓA Tổ chức <strong class="text-amber-bright">{{ selectedOrg?.name }}</strong> không?
          <br /><br />
          <span class="text-error font-weight-bold">Hậu quả:</span> Mọi nhân viên thuộc tổ chức sẽ bị đẩy out ngay lập tức và kết nối Máy chủ Agent sẽ bị tạm dừng.
        </p>

        <div class="d-flex align-center justify-end ga-2">
          <v-btn type="button" variant="text" color="slate-300" @click="showLockDialog = false">Hủy</v-btn>
          <v-btn type="button" color="error" variant="flat" rounded="lg" class="font-weight-bold text-white" :loading="locking" @click="confirmLockOrg">
            Xác nhận Khóa
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- FTP EDIT DIALOG -->
    <v-dialog v-model="showFtpDialog" max-width="540">
      <v-card theme="dark" class="pa-6 rounded-xl bg-slate-900 border-slate-700 text-white">
        <div class="text-h6 font-weight-black mb-4 text-amber-bright d-flex align-center ga-2">
          <v-icon color="#FCD34D">mdi-folder-network</v-icon>
          {{ editingFtpId ? 'Chỉnh sửa Cấu hình FTP' : 'Thêm Cấu hình FTP Mới' }}
        </div>

        <v-form @submit.prevent="saveFtpConfig">
          <v-text-field v-model="ftpForm.name" label="Tên gợi nhớ" variant="outlined" density="compact" class="mb-3" required />
          <v-text-field v-model="ftpForm.host" label="FTP Host (IP/Domain)" variant="outlined" density="compact" class="mb-3" required />
          <v-text-field v-model.number="ftpForm.port" label="Port" type="number" variant="outlined" density="compact" class="mb-3" />
          <v-text-field v-model="ftpForm.user" label="FTP Username" variant="outlined" density="compact" class="mb-3" />
          <v-text-field v-model="ftpForm.password" label="FTP Password" type="password" variant="outlined" density="compact" class="mb-4" />
          
          <v-switch v-model="ftpForm.isActive" label="Đặt làm Cấu hình Đang sử dụng" color="success" hide-details class="mb-5" />

          <div class="d-flex align-center justify-space-between ga-2 border-t-slate pt-4">
            <v-btn
              type="button"
              color="cyan-accent-2"
              variant="tonal"
              rounded="lg"
              class="font-weight-bold"
              :loading="testingFtp"
              @click="testFtpConnectionDirect"
            >
              <v-icon start>mdi-connection</v-icon>
              Kiểm tra kết nối
            </v-btn>

            <div class="d-flex align-center ga-2">
              <v-btn type="button" variant="text" color="slate-300" @click="showFtpDialog = false">Hủy</v-btn>
              <v-btn type="submit" color="amber-accent-4" variant="flat" rounded="lg" class="font-weight-black text-black" :loading="savingFtp">
                Lưu Cấu hình
              </v-btn>
            </div>
          </div>
        </v-form>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api';

const route = useRoute();

const currentTab = computed(() => {
  return (route.query.tab as string) || 'orgs';
});

// Orgs State
const organizations = ref<any[]>([]);
const loadingOrgs = ref(true);
const orgSearch = ref('');
const showLockDialog = ref(false);
const selectedOrg = ref<any>(null);
const locking = ref(false);

const orgHeaders = [
  { title: 'Tên Tổ Chức', key: 'name', sortable: true },
  { title: 'Thống kê Tài nguyên', key: 'stats', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Ngày khởi tạo', key: 'createdAt', sortable: true },
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
    showToast('Lỗi', 'Không thể tải danh sách Tổ chức', 'error', 'mdi-alert-circle');
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
    showToast('Đã khóa', `Đã khóa tài khoản tổ chức ${selectedOrg.value.name}`, 'success', 'mdi-check-circle');
  } catch (error) {
    showToast('Lỗi', 'Không thể khóa tổ chức', 'error', 'mdi-alert-circle');
  } finally {
    locking.value = false;
  }
}

async function unlockOrg(org: any) {
  try {
    await api.put(`/super-admin/organizations/${org.id}/status`, { status: 'active' });
    fetchOrganizations();
    showToast('Đã mở khóa', `Đã mở khóa cho tổ chức ${org.name}`, 'success', 'mdi-check-circle');
  } catch {
    showToast('Lỗi', 'Không thể mở khóa tổ chức', 'error', 'mdi-alert-circle');
  }
}

// Agents State
const agents = ref<any[]>([]);
const loadingAgents = ref(true);
const agentHeaders = [
  { title: 'Thuộc Tổ Chức', key: 'orgName', sortable: true },
  { title: 'Agent Key', key: 'agentKey', sortable: false },
  { title: 'Fingerprint Máy chủ', key: 'fingerprint', sortable: false },
  { title: 'Cập nhật lần cuối', key: 'updatedAt', sortable: true },
  { title: 'Trạng thái', key: 'status', sortable: true },
];

async function fetchAgents() {
  loadingAgents.value = true;
  try {
    const res = await api.get('/super-admin/agents');
    agents.value = res.data;
  } catch {
    showToast('Lỗi', 'Không thể tải danh sách Agent', 'error', 'mdi-alert-circle');
  } finally {
    loadingAgents.value = false;
  }
}

// FTP State
const ftpConfigs = ref<any[]>([]);
const loadingFtp = ref(true);
const showFtpDialog = ref(false);
const savingFtp = ref(false);
const testingFtp = ref(false);
const editingFtpId = ref<string | null>(null);

const ftpForm = ref({
  name: '',
  host: '',
  port: 21,
  user: '',
  password: '',
  isActive: false
});

const ftpHeaders = [
  { title: 'Tên cấu hình', key: 'name', sortable: true },
  { title: 'Host / IP', key: 'host', sortable: true },
  { title: 'Port', key: 'port', sortable: false },
  { title: 'Trạng thái', key: 'isActive', sortable: true },
  { title: 'Thao tác', key: 'actions', sortable: false, align: 'end' as const }
];

async function fetchFtpConfigs() {
  loadingFtp.value = true;
  try {
    const res = await api.get('/super-admin/storage-configs');
    ftpConfigs.value = res.data;
  } catch {
    showToast('Lỗi', 'Không thể tải cấu hình FTP', 'error', 'mdi-alert-circle');
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
    ftpForm.value = { name: '', host: '', port: 21, user: '', password: '', isActive: false };
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
    showToast('Thành công', 'Đã lưu cấu hình FTP', 'success', 'mdi-check-circle');
  } catch {
    showToast('Lỗi', 'Không thể lưu cấu hình FTP', 'error', 'mdi-alert-circle');
  } finally {
    savingFtp.value = false;
  }
}

async function deleteFtp(item: any) {
  if (!confirm(`Bạn có chắc muốn xóa cấu hình FTP ${item.name}?`)) return;
  try {
    await api.delete(`/super-admin/storage-configs/${item.id}`);
    fetchFtpConfigs();
    showToast('Thành công', 'Đã xóa cấu hình FTP', 'success', 'mdi-check-circle');
  } catch {
    showToast('Lỗi', 'Không thể xóa cấu hình FTP', 'error', 'mdi-alert-circle');
  }
}

async function testFtp(item: any) {
  try {
    const res = await api.post(`/super-admin/storage-configs/${item.id}/test`);
    showToast('Thành công', res.data.message || 'Kết nối FTP tới máy chủ thành công!', 'success', 'mdi-check-circle');
  } catch (error: any) {
    const msg = error.response?.data?.error || 'Kết nối FTP thất bại';
    showToast('Lỗi', msg, 'error', 'mdi-alert-circle');
  }
}

async function testFtpConnectionDirect() {
  if (!ftpForm.value.host) {
    showToast('Cảnh báo', 'Vui lòng nhập FTP Host trước khi kiểm tra', 'warning', 'mdi-alert');
    return;
  }
  testingFtp.value = true;
  try {
    const res = await api.post('/super-admin/storage-configs/test', {
      host: ftpForm.value.host,
      port: ftpForm.value.port
    });
    showToast('Thành công', res.data.message || 'Kết nối FTP tới máy chủ thành công!', 'success', 'mdi-check-circle');
  } catch (error: any) {
    const msg = error.response?.data?.error || 'Không thể kết nối tới máy chủ FTP';
    showToast('Thất bại', msg, 'error', 'mdi-alert-circle');
  } finally {
    testingFtp.value = false;
  }
}

// Helpers
function formatDate(dateStr?: string) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString('vi-VN');
}

function showToast(title: string, message: string, color = 'info', icon = 'mdi-information') {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { title, message, color, icon }
  }));
}

onMounted(() => {
  fetchOrganizations();
  fetchAgents();
  fetchFtpConfigs();
});
</script>

<style scoped>
.super-admin-view {
  width: 100%;
}

.super-card {
  background-color: #1E293B !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(148, 163, 184, 0.3) !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
}

.border-b-slate {
  border-bottom: 1px solid rgba(148, 163, 184, 0.3) !important;
}

.border-t-slate {
  border-top: 1px solid rgba(148, 163, 184, 0.3) !important;
}

.border-slate-700 {
  border-color: rgba(148, 163, 184, 0.3) !important;
}

.text-amber-bright {
  color: #FCD34D !important;
}

.search-input :deep(.v-field) {
  background-color: #0F172A !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(148, 163, 184, 0.4) !important;
  border-radius: 12px;
}

.search-input :deep(input) {
  color: #FFFFFF !important;
}

.search-input :deep(input::placeholder) {
  color: #94A3B8 !important;
  opacity: 1;
}

.super-table :deep(table) {
  background-color: #1E293B !important;
  color: #FFFFFF !important;
}

.super-table :deep(th) {
  background-color: #0F172A !important;
  color: #F8FAFC !important;
  font-weight: 800 !important;
  text-transform: uppercase;
  font-size: 12px !important;
  letter-spacing: 0.5px;
  border-bottom: 2px solid rgba(148, 163, 184, 0.3) !important;
}

.super-table :deep(td) {
  color: #F1F5F9 !important;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15) !important;
  font-size: 14px !important;
}

.super-table :deep(.v-data-table-footer) {
  background-color: #0F172A !important;
  color: #F8FAFC !important;
}

.super-table :deep(.v-data-table-footer__select),
.super-table :deep(.v-data-table-footer__info) {
  color: #F8FAFC !important;
}

.bg-slate-900 {
  background-color: #0F172A !important;
}

.bg-slate-950 {
  background-color: #090D16 !important;
}
</style>
