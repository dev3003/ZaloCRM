<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold mb-1">Máy chủ Agent</h1>
        <p class="text-body-1 text-medium-emphasis">
          Quản lý các thiết bị máy chủ đang kết nối Zalo Agent. Chỉ có quản trị viên mới được phép thao tác tại đây.
        </p>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
        Cấp phát Key Mới
      </v-btn>
    </div>

    <!-- Alert for 1 Server rule -->
    <v-alert
      type="info"
      variant="tonal"
      class="mb-6"
      icon="mdi-information"
    >
      <span class="font-weight-medium">Lưu ý hệ thống:</span> Mỗi công ty/tổ chức chỉ nên duy trì <strong>1 Máy chủ Agent duy nhất</strong> đang hoạt động (Active) để tránh xung đột tin nhắn Zalo. Nếu có máy mới, vui lòng thu hồi (Revoke) máy cũ.
    </v-alert>

    <v-card variant="outlined" class="mb-6 border-radius-lg bg-surface">
      <v-data-table
        :headers="headers"
        :items="agents"
        :loading="loading"
        hover
        class="bg-transparent"
      >
        <template v-slot:item.agentKey="{ item }">
          <div class="d-flex align-center">
            <code class="bg-grey-lighten-4 pa-1 rounded">{{ item.agentKey }}</code>
            <v-btn
              icon="mdi-content-copy"
              size="x-small"
              variant="text"
              class="ml-2"
              @click="copyToClipboard(item.agentKey)"
              v-if="!item.agentKey.includes('***')"
            ></v-btn>
          </div>
        </template>

        <template v-slot:item.status="{ item }">
          <v-chip
            :color="item.status === 'active' ? 'success' : 'error'"
            size="small"
            class="font-weight-medium text-uppercase"
          >
            {{ item.status === 'active' ? 'Đang Hoạt Động' : 'Đã Thu Hồi' }}
          </v-chip>
        </template>

        <template v-slot:item.createdAt="{ item }">
          {{ formatDate(item.createdAt) }}
        </template>

        <template v-slot:item.actions="{ item }">
          <v-btn
            color="primary"
            variant="tonal"
            size="small"
            class="mr-2"
            prepend-icon="mdi-download"
            @click="downloadSoftware(item)"
            v-if="item.status === 'active'"
          >
            Tải phần mềm
          </v-btn>
          
          <v-btn
            color="error"
            variant="text"
            size="small"
            prepend-icon="mdi-block-helper"
            @click="confirmRevoke(item)"
            v-if="item.status === 'active'"
          >
            Thu hồi
          </v-btn>
        </template>

        <template v-slot:no-data>
          <div class="pa-8 text-center text-medium-emphasis">
            <v-icon size="64" color="grey-lighten-2" class="mb-4">mdi-server-network-off</v-icon>
            <div class="text-h6">Chưa có Máy chủ Agent nào</div>
            <p class="mt-2">Bấm "Cấp phát Key Mới" để tạo kết nối cho máy chủ của công ty bạn.</p>
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create Dialog -->
    <v-dialog v-model="createDialog" max-width="500">
      <v-card>
        <v-card-title class="text-h6 pa-4 border-bottom">Cấp phát Agent Key Mới</v-card-title>
        <v-card-text class="pa-4">
          <v-text-field
            v-model="newAgentName"
            label="Tên máy chủ (Ví dụ: Server Hà Nội)"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="mb-4"
          ></v-text-field>
          <p class="text-caption text-medium-emphasis">
            Hệ thống sẽ tạo ra một khóa bảo mật 32-byte ngẫu nhiên. Sau khi tạo, bạn hãy copy mã khóa này và không chia sẻ cho người ngoài.
          </p>
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="createDialog = false">Hủy</v-btn>
          <v-btn color="primary" @click="createAgent" :loading="creating" :disabled="!newAgentName">
            Tạo Khóa
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Revoke Confirm Dialog -->
    <v-dialog v-model="revokeDialog" max-width="400">
      <v-card>
        <v-card-title class="text-h6 pa-4 text-error border-bottom">Thu hồi thiết bị</v-card-title>
        <v-card-text class="pa-4">
          Bạn có chắc chắn muốn thu hồi máy chủ <strong>{{ selectedAgent?.name }}</strong> không?
          <div class="mt-2 text-error text-caption">
            Cảnh báo: Hành động này sẽ lập tức cắt đứt mọi kết nối của máy chủ này tới Zalo và CRM. Thiết bị sẽ bị vô hiệu hóa vĩnh viễn và không thể khôi phục.
          </div>
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="revokeDialog = false">Hủy</v-btn>
          <v-btn color="error" @click="revokeAgent" :loading="revoking">
            Xác nhận Thu hồi
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Key Result Dialog -->
    <v-dialog v-model="keyResultDialog" max-width="600" persistent>
      <v-card>
        <v-card-title class="text-h6 pa-4 bg-success text-white">Tạo Khóa Thành Công!</v-card-title>
        <v-card-text class="pa-6 text-center">
          <v-icon size="64" color="success" class="mb-4">mdi-shield-check</v-icon>
          <div class="text-h6 mb-2">Đây là Agent Key duy nhất của bạn:</div>
          <div class="d-flex align-center bg-grey-lighten-4 pa-4 rounded-lg mb-4 border">
            <code class="text-subtitle-1 text-break w-100">{{ newlyCreatedKey }}</code>
          </div>
          <v-btn color="primary" size="large" prepend-icon="mdi-content-copy" @click="copyToClipboard(newlyCreatedKey)" class="mb-4">
            Copy Mã Khóa Này
          </v-btn>
          <v-alert type="warning" variant="tonal" class="text-left text-caption">
            <strong>Cảnh báo:</strong> Mã này chỉ hiển thị ĐẦY ĐỦ duy nhất 1 lần. Hãy tải phần mềm bên dưới để hệ thống tự động gán mã này vào file cài đặt (Zero-Config), hoặc copy thủ công vào form cấu hình của phần mềm.
          </v-alert>
        </v-card-text>
        <v-card-actions class="pa-4 border-top bg-grey-lighten-5">
          <v-spacer></v-spacer>
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-download"
            @click="downloadNewlyCreated"
          >
            Tải phần mềm tự động kết nối
          </v-btn>
          <v-btn variant="text" @click="keyResultDialog = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';

// Types
interface Agent {
  id: string;
  name: string;
  agentKey: string;
  status: string;
  createdAt: string;
}

// State
const agents = ref<Agent[]>([]);
const loading = ref(true);

const createDialog = ref(false);
const newAgentName = ref('');
const creating = ref(false);

const keyResultDialog = ref(false);
const newlyCreatedKey = ref('');
const newlyCreatedAgent = ref<Agent | null>(null);

const revokeDialog = ref(false);
const selectedAgent = ref<Agent | null>(null);
const revoking = ref(false);

// Table configuration
const headers = [
  { title: 'Tên Máy Chủ', key: 'name', sortable: true },
  { title: 'Agent Key (Bảo mật)', key: 'agentKey', sortable: false },
  { title: 'Ngày tạo', key: 'createdAt', sortable: true },
  { title: 'Trạng thái', key: 'status', sortable: true },
  { title: 'Thao tác', key: 'actions', sortable: false, align: 'end' as const }
];

// Fetch data
async function fetchAgents() {
  loading.value = true;
  try {
    const res = await api.get('/agents');
    agents.value = res.data;
  } catch (error) {
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Lỗi', message: 'Không thể tải danh sách Agent', color: 'error' }
    }));
  } finally {
    loading.value = false;
  }
}

// Actions
function openCreateDialog() {
  newAgentName.value = 'Main Server';
  createDialog.value = true;
}

async function createAgent() {
  if (!newAgentName.value) return;
  creating.value = true;
  try {
    const res = await api.post('/agents', { name: newAgentName.value });
    
    // Success
    createDialog.value = false;
    newlyCreatedKey.value = res.data.agentKey;
    newlyCreatedAgent.value = res.data;
    keyResultDialog.value = true;
    
    // Refresh list
    fetchAgents();
    
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Thành công', message: 'Tạo Agent Key mới thành công', color: 'success' }
    }));
  } catch (error: any) {
    const msg = error.response?.data?.error || 'Không thể tạo Agent Key';
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Lỗi', message: msg, color: 'error' }
    }));
  } finally {
    creating.value = false;
  }
}

function confirmRevoke(agent: Agent) {
  selectedAgent.value = agent;
  revokeDialog.value = true;
}

async function revokeAgent() {
  if (!selectedAgent.value) return;
  revoking.value = true;
  try {
    await api.post(`/agents/${selectedAgent.value.id}/revoke`);
    
    revokeDialog.value = false;
    fetchAgents();
    
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Đã thu hồi', message: 'Đã thu hồi quyền kết nối của máy chủ này.', color: 'success' }
    }));
  } catch (error: any) {
    const msg = error.response?.data?.error || 'Không thể thu hồi';
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Lỗi', message: msg, color: 'error' }
    }));
  } finally {
    revoking.value = false;
  }
}

function downloadSoftware(agent: Agent) {
  // Thực hiện tải file cài đặt (Zero-Config Download)
  const key = agent.agentKey.replace(/[^a-zA-Z0-9]/g, '');
  const downloadName = `Omni360AgentSetup_${key}.exe`;
  
  // Tạo thẻ a ẩn để kích hoạt trình duyệt tải file
  const link = document.createElement('a');
  link.href = '/downloads/Omni360AgentBase.exe';
  link.setAttribute('download', downloadName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { 
      title: 'Đang tải xuống...', 
      message: `Đang tải ${downloadName}. Hãy mang file này sang máy chủ để cài đặt.`, 
      color: 'success',
      icon: 'mdi-download'
    }
  }));
}

function downloadNewlyCreated() {
  if (newlyCreatedAgent.value) {
    downloadSoftware(newlyCreatedAgent.value);
  }
}

// Utils
function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('vi-VN');
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { title: 'Đã Copy', message: 'Đã copy mã vào khay nhớ tạm', color: 'success' }
  }));
}

onMounted(() => {
  fetchAgents();
});
</script>

<style scoped>
.border-radius-lg {
  border-radius: 12px;
}
.border-bottom {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}
.border-top {
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}
</style>
