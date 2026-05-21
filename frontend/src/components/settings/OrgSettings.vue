<template>
  <div class="pa-4">
    <div class="text-h5 mb-4">Cài đặt Tổ chức</div>

    <v-card class="pa-4 mb-4" variant="outlined">
      <div class="text-subtitle-1 mb-2">Thông tin cơ bản</div>
      <div v-if="authStore.isAdmin">
        <v-text-field
          v-model="orgForm.name"
          label="Tên tổ chức"
          density="compact"
          variant="outlined"
          class="mb-2"
        ></v-text-field>
        
        <v-divider class="my-4"></v-divider>
        
        <div class="text-subtitle-1 mb-2">Cấu hình ERP (Sale Routing)</div>
        <p class="text-caption text-medium-emphasis mb-4">
          Nhập URL API từ hệ thống ERP của bạn để tự động gán khách hàng Zalo cho nhân viên Sale.
        </p>

        <v-text-field
          v-model="orgForm.erp_api_url"
          label="ERP API URL"
          placeholder="https://your-erp.com/api/assignments"
          density="compact"
          variant="outlined"
          class="mb-2"
        ></v-text-field>

        <v-text-field
          v-model="orgForm.erp_api_key"
          label="ERP API Key (Token bảo mật)"
          placeholder="Nhập mã bảo mật API"
          type="password"
          density="compact"
          variant="outlined"
          class="mb-4"
        ></v-text-field>

        <div class="d-flex align-center gap-2">
          <v-btn
            color="primary"
            :loading="saving"
            @click="saveOrg"
          >
            Lưu thông tin
          </v-btn>
          
          <v-btn
            color="secondary"
            variant="tonal"
            :loading="syncing"
            prepend-icon="mdi-sync"
            @click="handleSync"
          >
            Đồng bộ từ ERP
          </v-btn>
        </div>
      </div>
      <p v-else class="text-medium-emphasis text-body-2">Chỉ chủ sở hữu mới có thể chỉnh sửa thông tin tổ chức.</p>
    </v-card>

    <!-- Sync Result Snackbar -->
    <v-snackbar
      v-model="showSyncResult"
      :color="syncSuccess ? 'success' : 'error'"
      timeout="5000"
    >
      {{ syncMessage }}
      <template v-slot:actions>
        <v-btn variant="text" @click="showSyncResult = false">Đóng</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';

const authStore = useAuthStore();
const saving = ref(false);
const syncing = ref(false);

const orgForm = reactive({
  name: '',
  erp_api_url: '',
  erp_api_key: '',
});

const showSyncResult = ref(false);
const syncSuccess = ref(false);
const syncMessage = ref('');

onMounted(async () => {
  await fetchOrganization();
});

async function fetchOrganization() {
  try {
    const res = await api.get('/organization');
    if (res.data) {
      orgForm.name = res.data.name || '';
      // Map settings if they come back in the response
      const settings = res.data.settings || {};
      orgForm.erp_api_url = settings.erp_api_url || '';
      orgForm.erp_api_key = settings.erp_api_key || '';
    }
  } catch (err) {
    console.error('Failed to fetch organization:', err);
  }
}

async function saveOrg() {
  saving.value = true;
  try {
    await api.put('/organization', orgForm);
    await fetchOrganization();
  } catch (err) {
    console.error('Failed to save organization:', err);
  } finally {
    saving.value = false;
  }
}

async function handleSync() {
  if (!orgForm.erp_api_url) {
    syncMessage.value = 'Vui lòng nhập ERP API URL trước khi đồng bộ.';
    syncSuccess.value = false;
    showSyncResult.value = true;
    return;
  }

  syncing.value = true;
  try {
    const res = await api.post('/erp/sync');
    syncSuccess.value = true;
    syncMessage.value = `Đồng bộ thành công! Đã gán: ${res.data.success}, Thất bại: ${res.data.failed}`;
  } catch (err: any) {
    syncSuccess.value = false;
    syncMessage.value = `Lỗi đồng bộ: ${err.response?.data?.error || err.message}`;
  } finally {
    syncing.value = false;
    showSyncResult.value = true;
  }
}
</script>
