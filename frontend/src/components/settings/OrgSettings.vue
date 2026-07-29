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
          :type="showErpApiKey ? 'text' : 'password'"
          :append-inner-icon="showErpApiKey ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append-inner="showErpApiKey = !showErpApiKey"
          density="compact"
          variant="outlined"
          class="mb-2"
        ></v-text-field>

        <v-divider class="my-4"></v-divider>

        <div class="text-subtitle-1 mb-1">Tích hợp Click-to-Chat từ ERP</div>
        <p class="text-caption text-medium-emphasis mb-3">
          Key giải mã AES-128-CBC (16 ký tự) — phải giống hệt key mã hóa bên hệ thống ERP Admin.
          Dùng để giải mã số điện thoại khi Sale click icon Zalo từ ERP sang CRM.
        </p>
        <v-text-field
          v-model="orgForm.erp_decrypt_key"
          label="ERP Decrypt Key (AES-128-CBC)"
          placeholder="Nhập 16 ký tự key — giống với bên ERP"
          :type="showErpDecryptKey ? 'text' : 'password'"
          :append-inner-icon="showErpDecryptKey ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append-inner="showErpDecryptKey = !showErpDecryptKey"
          density="compact"
          variant="outlined"
          class="mb-4"
          :hint="orgForm.erp_decrypt_key ? `Độ dài hiện tại: ${orgForm.erp_decrypt_key.length} ký tự (cần đúng 16)` : ''"
          persistent-hint
          :error="orgForm.erp_decrypt_key.length > 0 && orgForm.erp_decrypt_key.length !== 16"
          :error-messages="orgForm.erp_decrypt_key.length > 0 && orgForm.erp_decrypt_key.length !== 16 ? 'Key phải đúng 16 ký tự cho AES-128-CBC' : ''"
        ></v-text-field>

        <v-divider class="my-4"></v-divider>

        <div class="text-subtitle-1 mb-1">Cấu hình nhận thông báo bảo trì (Archiving Log)</div>
        <p class="text-caption text-medium-emphasis mb-3">
          Nhập URL Webhook (Zalo/Discord) hoặc Token Telegram để nhận báo cáo dọn dẹp dữ liệu lúc 2h sáng.
        </p>
        <v-text-field
          v-model="cronForm.webhookUrl"
          label="Webhook URL (hoặc Telegram API URL)"
          placeholder="https://api.telegram.org/bot<token>/sendMessage"
          density="compact"
          variant="outlined"
          class="mb-2"
        ></v-text-field>

        <v-text-field
          v-if="cronForm.webhookUrl.includes('api.telegram.org')"
          v-model="cronForm.telegramChatId"
          label="Telegram Chat ID"
          placeholder="Ví dụ: -100123456789"
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
            color="info"
            variant="outlined"
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
const showErpApiKey = ref(false);
const showErpDecryptKey = ref(false);

const orgForm = reactive({
  name: '',
  erp_api_url: '',
  erp_api_key: '',
  erp_decrypt_key: '',
});

const cronForm = reactive({
  webhookUrl: '',
  telegramChatId: '',
});

const showSyncResult = ref(false);
const syncSuccess = ref(false);
const syncMessage = ref('');

onMounted(async () => {
  await fetchOrganization();
  await fetchCronSettings();
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
      orgForm.erp_decrypt_key = settings.erp_decrypt_key || '';
    }
  } catch (err) {
    console.error('Failed to fetch organization:', err);
  }
}

async function fetchCronSettings() {
  try {
    const res = await api.get('/settings/cron-log');
    cronForm.webhookUrl = res.data.webhookUrl || '';
    cronForm.telegramChatId = res.data.telegramChatId || '';
  } catch (err) {
    console.error('Failed to fetch cron settings:', err);
  }
}

async function saveOrg() {
  saving.value = true;
  try {
    await api.put('/organization', orgForm);
    await api.put('/settings/cron-log', cronForm);
    await fetchOrganization();
    
    // Hiện thông báo lưu thành công
    syncSuccess.value = true;
    syncMessage.value = 'Đã lưu thông tin cài đặt thành công!';
    showSyncResult.value = true;
  } catch (err) {
    console.error('Failed to save organization:', err);
    // Hiện thông báo lỗi
    syncSuccess.value = false;
    syncMessage.value = 'Lưu thất bại! Vui lòng thử lại sau.';
    showSyncResult.value = true;
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
