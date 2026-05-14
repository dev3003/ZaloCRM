<template>
  <v-dialog v-model="visible" max-width="450">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        icon
        size="small"
        variant="text"
        color="primary"
        title="Tìm và kết bạn qua số điện thoại"
      >
        <v-icon>mdi-account-search-outline</v-icon>
      </v-btn>
    </template>

    <v-card>
      <v-card-title class="pa-4 d-flex align-center">
        <v-icon class="mr-2">mdi-account-plus</v-icon>
        Tìm và kết bạn Zalo
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="visible = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-4">
        <v-select
          v-model="selectedAccountId"
          :items="accountOptions"
          item-title="text"
          item-value="value"
          label="Dùng tài khoản Zalo"
          density="compact"
          variant="outlined"
          class="mb-4"
          hide-details
        />

        <div class="d-flex ga-2 mb-4">
          <v-text-field
            v-model="phone"
            label="Nhập số điện thoại"
            placeholder="0912345678"
            density="compact"
            variant="outlined"
            hide-details
            @keyup.enter="searchUser"
          />
          <v-btn
            color="primary"
            :loading="searching"
            @click="searchUser"
            :disabled="!phone || !selectedAccountId"
          >
            Tìm
          </v-btn>
        </div>

        <!-- Search result -->
        <v-expand-transition>
          <div v-if="userResult" class="user-result-card pa-3 border rounded-lg bg-grey-lighten-4">
            <div class="d-flex align-center mb-3">
              <v-avatar size="56" class="mr-3 border">
                <v-img v-if="userResult.avatar" :src="userResult.avatar" />
                <v-icon v-else icon="mdi-account" />
              </v-avatar>
              <div>
                <div class="font-weight-bold">{{ userResult.display_name || userResult.zalo_name || 'Không có tên' }}</div>
                <div class="text-caption text-grey">UID: {{ userResult.uid }}</div>
              </div>
            </div>

            <v-textarea
              v-model="message"
              label="Lời nhắn kết bạn"
              rows="2"
              density="compact"
              variant="outlined"
              class="mb-3"
              hide-details
            />

            <v-btn
              color="success"
              block
              :loading="sending"
              @click="sendRequest"
              prepend-icon="mdi-plus"
            >
              Gửi lời mời kết bạn
            </v-btn>
          </div>
        </v-expand-transition>

        <v-alert
          v-if="error"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-3"
          closable
          @click:close="error = ''"
        >
          {{ error }}
        </v-alert>

        <v-alert
          v-if="success"
          type="success"
          density="compact"
          variant="tonal"
          class="mt-3"
        >
          {{ success }}
        </v-alert>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { zaloFriendsApi } from '@/api/zalo-friends';
import { api } from '@/api/index';

const props = defineProps<{
  initialAccountId?: string | null;
}>();

const visible = ref(false);
const phone = ref('');
const searching = ref(false);
const userResult = ref<any>(null);
const error = ref('');
const success = ref('');
const message = ref('Chào bạn, mình kết bạn nhé!');
const sending = ref(false);

const accountOptions = ref<{ text: string; value: string }[]>([]);
const selectedAccountId = ref<string | null>(null);

// Fetch Zalo accounts when dialog opens
watch(visible, async (val) => {
  if (val) {
    try {
      const res = await api.get('/zalo-accounts');
      const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
      accountOptions.value = accounts.map((a: any) => ({
        text: a.displayName || a.zaloUid || a.id,
        value: a.id,
      }));
      
      if (props.initialAccountId) {
        selectedAccountId.value = props.initialAccountId;
      } else if (accountOptions.value.length > 0) {
        selectedAccountId.value = accountOptions.value[0].value;
      }
    } catch {
      error.value = 'Không thể lấy danh sách tài khoản Zalo';
    }
  } else {
    // Reset state when closing
    phone.value = '';
    userResult.value = null;
    error.value = '';
    success.value = '';
  }
});

async function searchUser() {
  if (!phone.value || !selectedAccountId.value) return;
  
  searching.value = true;
  userResult.value = null;
  error.value = '';
  success.value = '';
  
  try {
    const res = await zaloFriendsApi.searchPhone(selectedAccountId.value, phone.value);
    userResult.value = res.data;
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Không tìm thấy người dùng này trên Zalo';
  } finally {
    searching.value = false;
  }
}

async function sendRequest() {
  if (!userResult.value?.uid || !selectedAccountId.value) return;
  
  sending.value = true;
  try {
    await zaloFriendsApi.sendRequest(selectedAccountId.value, userResult.value.uid, message.value);
    success.value = 'Đã gửi lời mời kết bạn thành công!';
    userResult.value = null;
    phone.value = '';
    setTimeout(() => { visible.value = false; }, 2000);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Gửi lời mời thất bại';
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.user-result-card {
  border: 1px solid rgba(0,0,0,0.1) !important;
}
</style>
