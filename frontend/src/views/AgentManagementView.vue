<template>
  <div class="pa-4 max-width-1200 mx-auto">
    <div class="d-flex align-center justify-space-between mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold mb-1">Máy chủ Agent Zalo</h1>
        <p class="text-body-1 text-medium-emphasis">
          Quản lý Máy chủ Agent duy nhất chạy hạ tầng kết nối Zalo của Tổ chức.
        </p>
      </div>
      <v-btn color="warning" size="large" prepend-icon="mdi-key-change" rounded="lg" class="font-weight-bold" @click="openRegenerateDialogStep1">
        Cấp lại Key Mới
      </v-btn>
    </div>

    <!-- Alert for 1 Server rule -->
    <v-alert
      type="info"
      variant="tonal"
      class="mb-6 rounded-lg"
      icon="mdi-shield-check-outline"
    >
      <span class="font-weight-medium">Quy tắc bảo mật Multi-Tenant:</span> Mỗi Tổ chức sở hữu <strong>1 Máy chủ Agent duy nhất</strong>. Tất cả tài khoản Zalo của nhân viên thuộc Tổ chức đều vận hành thông qua Máy chủ Agent này.
    </v-alert>

    <!-- Main Agent Status Card -->
    <v-card v-if="agent" variant="outlined" class="pa-6 rounded-xl border elevation-1 mb-6 bg-surface">
      <div class="d-flex align-center justify-space-between mb-4">
        <div class="d-flex align-center">
          <v-avatar color="primary-lighten-5" size="48" class="mr-4">
            <v-icon color="primary" size="28">mdi-server-network</v-icon>
          </v-avatar>
          <div>
            <div class="text-h6 font-weight-bold">{{ agent.name }}</div>
            <div class="text-caption text-grey">Khởi tạo ngày: {{ formatDate(agent.createdAt) }}</div>
          </div>
        </div>

        <v-chip
          :color="agent.status === 'active' ? 'success' : 'error'"
          size="medium"
          class="font-weight-bold text-uppercase"
        >
          <v-icon start size="16">{{ agent.status === 'active' ? 'mdi-check-circle' : 'mdi-alert-circle' }}</v-icon>
          {{ agent.status === 'active' ? 'Đang Hoạt Động' : 'Đã Tạm Khóa' }}
        </v-chip>
      </div>

      <v-divider class="mb-4" />

      <v-row>
        <v-col cols="12" md="7">
          <div class="text-caption font-weight-bold text-grey-darken-1 mb-1">AGENT KEY HIỆN TẠI (BẢO MẬT)</div>
          <div class="d-flex align-center bg-grey-lighten-4 pa-3 rounded-lg border">
            <code class="text-subtitle-2 font-weight-bold color-primary flex-grow-1 text-truncate">{{ agent.agentKey }}</code>
            <v-btn icon="mdi-content-copy" size="small" variant="text" color="primary" @click="copyToClipboard(agent.agentKey)" />
          </div>
        </v-col>

        <v-col cols="12" md="5">
          <div class="text-caption font-weight-bold text-grey-darken-1 mb-1">VÂN TAY PHẦN CỨNG (FINGERPRINT)</div>
          <div class="d-flex align-center bg-grey-lighten-4 pa-3 rounded-lg border">
            <span class="text-caption font-weight-bold text-medium-emphasis text-truncate">
              {{ agent.fingerprint || 'Chưa liên kết thiết bị (Sẵn sàng cài đặt)' }}
            </span>
          </div>
        </v-col>
      </v-row>

      <div class="d-flex align-center justify-end mt-6">
        <v-btn
          color="primary"
          variant="flat"
          size="large"
          prepend-icon="mdi-download"
          rounded="lg"
          class="font-weight-bold"
          @click="downloadInstaller(agent.agentKey)"
        >
          Tải Bộ Cài Đè Máy Chủ Agent (.exe)
        </v-btn>
      </div>
    </v-card>

    <!-- 2-STEP REGENERATE KEY MODAL -->

    <!-- STEP 1: WARNING & CONFIRMATION -->
    <v-dialog v-model="showRegenerateStep1" max-width="540" persistent>
      <v-card class="pa-6 rounded-xl">
        <div class="d-flex align-center text-error mb-3">
          <v-icon size="32" color="error" class="mr-2">mdi-alert-rhombus-outline</v-icon>
          <div class="text-h6 font-weight-bold">Xác nhận Cấp lại Agent Key</div>
        </div>

        <v-alert type="warning" variant="tonal" class="mb-4 text-caption rounded-lg">
          <strong>CẢNH BÁO TẠM DỪNG KẾT NỐI:</strong> Hành động này sẽ <strong>HỦY BỎ KEY CŨ</strong> ngay lập tức. Máy chủ Agent tại văn phòng của bạn sẽ tạm thời ngắt kết nối cho đến khi bạn tải và chạy bộ cài đặt mới.
        </v-alert>

        <p class="text-body-2 text-medium-emphasis mb-4">
          Vui lòng xác nhận rằng bạn chuẩn bị sẵn sàng tải file cài đặt mới <code>.exe</code> về và chạy <strong>cài đè trực tiếp</strong> trên máy tính Agent tại văn phòng.
        </p>

        <v-checkbox
          v-model="understandRisk"
          label="Tôi đã hiểu rủi ro và muốn cấp Key mới"
          color="error"
          density="compact"
          class="mb-2"
        />

        <div class="d-flex align-center justify-end ga-2 pt-2">
          <v-btn variant="text" @click="showRegenerateStep1 = false">Hủy bỏ</v-btn>
          <v-btn
            color="error"
            size="large"
            rounded="lg"
            class="font-weight-bold"
            :disabled="!understandRisk"
            :loading="regenerating"
            @click="executeRegenerateKey"
          >
            🔥 Đồng ý Cấp Key Mới
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- STEP 2: SUCCESS & DOWNLOAD BUNDLE -->
    <v-dialog v-model="showRegenerateStep2" max-width="600" persistent>
      <v-card class="pa-6 rounded-xl text-center">
        <v-icon size="64" color="success" class="mb-2">mdi-check-circle-outline</v-icon>
        <div class="text-h5 font-weight-bold color-success mb-1">Cấp Key Mới Thành Công!</div>
        <p class="text-caption text-grey mb-6">Key cũ đã bị hủy. Máy chủ Agent của bạn cần được cập nhật Key mới.</p>

        <div class="text-caption font-weight-bold text-left text-grey-darken-1 mb-1">KEY MỚI CỦA BẠN:</div>
        <div class="d-flex align-center bg-grey-lighten-4 pa-4 rounded-xl mb-4 border">
          <code class="text-subtitle-1 font-weight-bold color-primary text-truncate flex-grow-1">{{ newlyGeneratedKey }}</code>
          <v-btn icon="mdi-content-copy" color="primary" variant="tonal" size="small" class="ml-2" @click="copyToClipboard(newlyGeneratedKey)" />
        </div>

        <v-alert type="info" variant="tonal" class="text-left text-caption mb-6 rounded-lg">
          <strong>HƯỚNG DẪN KÍCH HOẠT:</strong><br />
          1. Bấm nút <strong>[ Tải Bộ Cài Đè Agent (.exe) ]</strong> bên dưới.<br />
          2. Mở file <code>.exe</code> trên máy tính Agent tại văn phòng để <strong>chạy cài đè trực tiếp</strong> (không cần gỡ bản cũ).<br />
          3. Phần mềm sẽ tự động cập nhật Key mới và khôi phục kết nối sau 5 - 10 giây.
        </v-alert>

        <v-btn
          color="primary"
          size="x-large"
          block
          rounded="xl"
          prepend-icon="mdi-download"
          class="font-weight-bold mb-4 elevation-2"
          @click="downloadInstaller(newlyGeneratedKey)"
        >
          📥 TẢI BỘ CÀI ĐÈ MÁY CHỦ AGENT (.EXE)
        </v-btn>

        <v-btn variant="text" color="grey" @click="showRegenerateStep2 = false">
          Hoàn tất & Đóng
        </v-btn>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';

interface Agent {
  id: string;
  orgId: string;
  name: string;
  agentKey: string;
  fingerprint?: string | null;
  status: string;
  createdAt: string;
}

const agent = ref<Agent | null>(null);
const loading = ref(true);

const showRegenerateStep1 = ref(false);
const understandRisk = ref(false);
const regenerating = ref(false);

const showRegenerateStep2 = ref(false);
const newlyGeneratedKey = ref('');

async function fetchMyAgent() {
  loading.value = true;
  try {
    const res = await api.get('/zalo-agent/my-agent');
    agent.value = res.data;
  } catch (error) {
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Lỗi', message: 'Không thể tải thông tin Máy chủ Agent', color: 'error' }
    }));
  } finally {
    loading.value = false;
  }
}

function openRegenerateDialogStep1() {
  understandRisk.value = false;
  showRegenerateStep1.value = true;
}

async function executeRegenerateKey() {
  if (!understandRisk.value) return;
  regenerating.value = true;
  try {
    const res = await api.post('/zalo-agent/regenerate-key');
    showRegenerateStep1.value = false;
    newlyGeneratedKey.value = res.data.newAgentKey;
    showRegenerateStep2.value = true;
    fetchMyAgent();

    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Thành công', message: 'Đã cấp mới Agent Key và ngắt kết nối máy chủ cũ.', color: 'success' }
    }));
  } catch (error: any) {
    const msg = error.response?.data?.error || 'Không thể cấp lại Agent Key';
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { title: 'Lỗi', message: msg, color: 'error' }
    }));
  } finally {
    regenerating.value = false;
  }
}

function downloadInstaller(key: string) {
  const downloadName = `Omni360_Agent_Setup.exe`;
  const link = document.createElement('a');
  link.href = `/api/v1/zalo-agent/download-installer?key=${encodeURIComponent(key)}`;
  link.setAttribute('download', downloadName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: {
      title: 'Đang tải xuống bộ cài đè...',
      message: `Đang tải file cài đè. Hãy chạy file này trực tiếp trên máy tính Agent.`,
      color: 'success',
      icon: 'mdi-download'
    }
  }));
}

function formatDate(dateString?: string) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('vi-VN');
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { title: 'Đã sao chép', message: 'Đã lưu Key vào khay nhớ tạm', color: 'success' }
  }));
}

onMounted(() => {
  fetchMyAgent();
});
</script>

<style scoped>
.max-width-1200 {
  max-width: 1200px;
}
</style>
