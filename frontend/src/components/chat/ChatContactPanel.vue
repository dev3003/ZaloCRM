<template>
  <div
    class="chat-contact-panel d-flex flex-column"
    style="width: 320px; border-left: 1px solid rgba(0,0,0,0.12); height: 100%; overflow-y: auto; flex-shrink: 0;"
  >
    <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid rgba(0,0,0,0.12);">
      <v-icon icon="mdi-account-details" class="mr-2" />
      <span class="font-weight-medium">Thông tin khách hàng</span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <div v-if="(props.contact?.adminCustomerId || props.contact?.crm_name) && !forceShowForm" class="pa-8 text-center d-flex flex-column align-center justify-center" style="height: 400px;">
      <v-avatar size="80" color="success" variant="tonal" class="mb-4 cursor-pointer" @click="forceShowForm = true">
        <v-icon size="48">mdi-database-check</v-icon>
        <v-tooltip activator="parent" location="bottom">Click để chỉnh sửa thông tin</v-tooltip>
      </v-avatar>
      <div class="text-h6 font-weight-bold mb-2">Đã liên kết Admin</div>
      <div class="text-body-2 text-grey mb-6">
        Thông tin khách hàng này đã được quản lý đồng bộ với hệ thống Admin.<br>
        <strong>ID Hệ Thống: {{ props.contact.adminCustomerId || props.contact.crm_name }}</strong>
      </div>
      <div class="d-flex flex-column ga-2 w-100">
        <v-btn color="primary" variant="flat" prepend-icon="mdi-pencil" block @click="forceShowForm = true">
          Sửa thông tin
        </v-btn>
      </div>
    </div>

    <div v-else class="pa-3">
      <!-- Back button if force showing linked contact -->
      <v-btn v-if="props.contact?.adminCustomerId || props.contact?.crm_name" variant="text" density="compact" prepend-icon="mdi-arrow-left" class="mb-2 text-none px-0" @click="forceShowForm = false">
        Quay lại giao diện liên kết
      </v-btn>
      <!-- Lead score + last activity display -->
      <div v-if="props.contact" class="d-flex align-center mb-3 ga-2">
        <v-chip
          :color="scoreColor(props.contact.leadScore)"
          size="small"
          variant="tonal"
          prepend-icon="mdi-star"
        >
          {{ props.contact.leadScore ?? 0 }} điểm
        </v-chip>
        <span v-if="props.contact.lastActivity" class="text-caption text-grey">
          {{ relativeTime(props.contact.lastActivity) }}
        </span>
      </div>

      <v-text-field v-model="form.fullName" label="Họ tên" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-model="form.phone" label="Số điện thoại" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-model="form.email" label="Email" type="email" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-model="form.adminCustomerId" label="ID Hệ thống Admin" density="compact" variant="outlined" class="mb-2" hide-details 
        placeholder="Nhập ID để liên kết hệ thống" prepend-inner-icon="mdi-link-variant" />

      <v-select v-model="form.source" label="Nguồn" :items="SOURCE_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-select v-model="form.status" label="Trạng thái" :items="STATUS_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-text-field v-model="form.firstContactDate" label="Ngày tiếp nhận" type="date"
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-text-field v-model="form.nextAppointmentDate" label="Hẹn nhắc lại" type="date"
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-combobox v-model="form.tags" label="Tags" multiple chips closable-chips
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-textarea v-model="form.notes" label="Ghi chú" rows="2" auto-grow
        density="compact" variant="outlined" class="mb-3" hide-details />

      <v-btn color="primary" block :loading="saving" @click="saveContact">Lưu thông tin</v-btn>

      <v-alert v-if="saveSuccess" type="success" density="compact" class="mt-2" closable @click:close="saveSuccess = false">
        Đã lưu thành công!
      </v-alert>
      <v-alert v-if="saveError" type="error" density="compact" class="mt-2" closable @click:close="saveError = false">
        Lưu thất bại, thử lại!
      </v-alert>

      <v-card v-if="props.accountId && !props.contact?.metadata?.isGroup && friendStatus?.is_friend !== 1" variant="outlined" class="mt-3 mb-3 border-dashed" :loading="loadingFriendStatus">
        <v-card-title class="text-subtitle-2 d-flex align-center py-2 px-3">
          <v-icon size="small" class="mr-2">mdi-account-plus</v-icon>
          Kết bạn Zalo
          <v-spacer />
          <v-chip v-if="friendStatus?.is_friend === 1" color="success" size="x-small" variant="flat">Đã là bạn</v-chip>
        </v-card-title>
        <v-card-text class="pa-3 pt-0">
          <div v-if="friendStatus?.is_friend === 0">
            <!-- Incoming request from customer (Họ đang yêu cầu mình) -->
            <div v-if="friendStatus?.is_requesting === 1" class="d-flex flex-column ga-2">
              <div class="text-caption text-orange mb-1">Khách hàng đã gửi lời mời kết bạn</div>
              <div class="d-flex ga-2">
                <v-btn color="success" size="small" variant="flat" block class="flex-1" @click="acceptFriendRequest">Chấp nhận</v-btn>
                <v-btn color="error" size="small" variant="outlined" class="px-2" @click="rejectFriendRequest">Từ chối</v-btn>
              </div>
            </div>
            
            <!-- Outgoing request sent by staff (Mình đã yêu cầu họ) -->
            <div v-else-if="friendStatus?.is_requested === 1" class="text-center">
              <v-chip color="orange" size="small" variant="tonal" block>Đã gửi lời mời (Chờ duyệt)</v-chip>
            </div>
            
            <!-- Not friends yet, no pending requests -->
            <div v-else>
              <v-btn color="secondary" size="small" variant="tonal" block prepend-icon="mdi-plus" @click="sendFriendRequest">
                Gửi lời mời kết bạn
              </v-btn>
            </div>
          </div>
          <div v-else-if="friendStatus?.is_friend === 1" class="text-caption text-grey text-center">
            Bạn và khách hàng đã kết bạn trên Zalo
          </div>
          <div v-else-if="!loadingFriendStatus" class="text-caption text-grey text-center">
            Không tìm thấy trạng thái Zalo
          </div>
        </v-card-text>
      </v-card>

      <!-- <AiSummaryCard :summary="aiSummary" :loading="aiSummaryLoading" @refresh="$emit('refresh-ai-summary')" /> -->

      <!-- <v-card variant="outlined" class="mb-3">
        <v-card-title class="d-flex align-center text-body-1">
          <v-icon class="mr-2">mdi-chart-bell-curve-cumulative</v-icon>
          Cảm xúc khách hàng
          <v-spacer />
          <v-btn size="small" variant="text" :loading="aiSentimentLoading" @click="$emit('refresh-ai-sentiment')">Làm mới</v-btn>
        </v-card-title>
        <v-card-text>
          <AiSentimentBadge :sentiment="aiSentiment" />
          <div v-if="aiSentiment?.reason" class="text-body-2 mt-2">{{ aiSentiment.reason }}</div>
        </v-card-text>
      </v-card> -->

      <ChatAppointments
        v-if="props.contactId"
        :contact-id="props.contactId"
        :appointments="contactAppointments"
        @refresh="reloadAppointments"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import type { AiSentiment } from '@/composables/use-chat';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  accountId?: string | null;
  aiSummary: string;
  aiSummaryLoading: boolean;
  aiSentiment: AiSentiment | null;
  aiSentimentLoading: boolean;
}>();

const emit = defineEmits<{ close: []; saved: [contact: Contact]; 'refresh-ai-summary': []; 'refresh-ai-sentiment': [] }>();

const forceShowForm = ref(false);

const {
  form, saving, saveSuccess, saveError,
  contactAppointments,
  friendStatus, loadingFriendStatus,
  saveContact, reloadAppointments,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  cleanup,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => props.accountId,
  (contact: Contact) => {
    emit('saved', contact);
    forceShowForm.value = false;
  },
);

watch(() => props.contactId, () => {
  forceShowForm.value = false;
});

onUnmounted(() => {
  cleanup();
});

function scoreColor(score: number) {
  if (score >= 70) return 'success';
  if (score >= 40) return 'orange';
  return 'error';
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${days} ngày trước`;
}
</script>
