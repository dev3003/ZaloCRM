<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="500">
    <v-card class="rounded-lg">
      <v-card-title class="d-flex align-center bg-primary text-white pa-4">
        <v-icon icon="mdi-account-hard-hat" class="mr-2" />
        Chia sẻ - Hỗ trợ
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-4">
        <div class="mb-4">
          <div class="text-subtitle-2 mb-1 font-weight-bold">Tin nhắn đã chọn:</div>
          <v-chip color="info" variant="flat" size="small">{{ selectedMessageCount }} tin nhắn</v-chip>
          <div class="text-caption text-grey mt-1">Nhân viên hỗ trợ sẽ chỉ thấy các tin nhắn này và các tin nhắn mới phát sinh sau khi được cấp quyền.</div>
        </div>

        <div class="mb-4">
          <div class="text-subtitle-2 mb-2 font-weight-bold">Chọn nhân viên hỗ trợ:</div>
          <v-autocomplete
            v-model="targetUserId"
            :items="filteredUsers"
            item-title="fullName"
            item-value="id"
            placeholder="Tìm kiếm nhân viên hỗ trợ..."
            variant="outlined"
            density="comfortable"
            :loading="loadingUsers"
            clearable
          >
            <template #item="{ props, item }">
              <v-list-item v-bind="props" :subtitle="(item as any).raw?.email || (item as any).email">
                <template #prepend>
                  <v-avatar color="primary" size="32" class="mr-3">
                    <span class="text-white text-caption">{{ ((item as any).raw?.fullName || (item as any).fullName || '').charAt(0).toUpperCase() }}</span>
                  </v-avatar>
                </template>
              </v-list-item>
            </template>
          </v-autocomplete>
        </div>

        <div>
          <div class="text-subtitle-2 mb-2 font-weight-bold">Thời gian cho phép truy cập:</div>
          <v-select
            v-model="durationHours"
            :items="durationOptions"
            item-title="label"
            item-value="value"
            variant="outlined"
            density="comfortable"
            hide-details
          />
          <div class="text-caption text-error mt-2">
            <v-icon icon="mdi-information-outline" size="small" /> Hệ thống sẽ tự động thu hồi quyền của nhân viên hỗ trợ sau thời gian này.
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 bg-grey-lighten-4">
        <v-spacer />
        <v-btn variant="text" color="grey-darken-1" @click="$emit('update:modelValue', false)">
          Hủy bỏ
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="!targetUserId"
          @click="handleSubmit"
        >
          Xác nhận Chia sẻ
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUsers } from '@/composables/use-users';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
  selectedMessageIds: string[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const authStore = useAuthStore();
const { users, loading: loadingUsers, fetchUsers } = useUsers();

const targetUserId = ref<string | null>(null);
const durationHours = ref<number>(5);
const submitting = ref(false);

const durationOptions = [
  { label: '15 Phút', value: 0.25 },
  { label: '30 Phút', value: 0.5 },
  { label: '1 Giờ', value: 1 },
  { label: '5 Giờ', value: 5 },
  { label: '10 Giờ', value: 10 },
  { label: '24 Giờ', value: 24 },
  { label: '48 Giờ', value: 48 },
];

const selectedMessageCount = computed(() => props.selectedMessageIds.length);

// Filter out the current user, so they don't share with themselves
const filteredUsers = computed(() => {
  return users.value.filter(u => u.id !== authStore.user?.id && u.isActive);
});

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    fetchUsers({ all: 'true' });
    targetUserId.value = null;
    durationHours.value = 5; // default 5h
  }
});

async function handleSubmit() {
  if (!targetUserId.value || !props.conversationId) return;

  submitting.value = true;
  try {
    await api.post('/support-sessions', {
      conversationId: props.conversationId,
      selectedMessageIds: props.selectedMessageIds,
      targetUserId: targetUserId.value,
      durationHours: durationHours.value
    });
    emit('success');
    emit('update:modelValue', false);
  } catch (err) {
    console.error('Failed to create support session:', err);
    alert('Có lỗi xảy ra khi tạo phiên hỗ trợ. Vui lòng thử lại.');
  } finally {
    submitting.value = false;
  }
}
</script>
