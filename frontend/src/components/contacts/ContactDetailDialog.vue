<template>
  <v-dialog v-model="show" max-width="680" persistent scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ isNew ? 'Thêm khách hàng' : 'Chi tiết khách hàng' }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-row dense>
          <!-- Full name -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.fullName"
              label="Họ và tên"
              :rules="[required]"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-account-outline"
              color="primary"
            />
          </v-col>

          <!-- Phone -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.phone"
              label="Số điện thoại"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-phone-outline"
            />
          </v-col>

          <!-- Email -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.email"
              label="Email"
              type="email"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-email-outline"
            />
          </v-col>

          <!-- Source -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.source"
              :items="SOURCE_OPTIONS"
              item-title="text"
              item-value="value"
              label="Nguồn khách hàng"
              clearable
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-source-branch"
            />
          </v-col>

          <!-- Status -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.status"
              :items="STATUS_OPTIONS"
              item-title="text"
              item-value="value"
              label="Trạng thái"
              clearable
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-list-status"
            />
          </v-col>

          <!-- Next appointment date -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.nextAppointmentDate"
              label="Ngày hẹn tiếp theo"
              type="date"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-calendar-clock"
            />
          </v-col>
          
          <!-- Assigned user -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.assignedUserId"
              :items="selectableUsers"
              item-title="fullName"
              item-value="id"
              label="Người phụ trách"
              :disabled="!authStore.isAdmin"
              :clearable="authStore.isAdmin"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-account-tie-outline"
              :hint="!authStore.isAdmin ? 'Cố định: Bạn là người phụ trách' : 'Chọn nhân viên phụ trách'"
              persistent-hint
            />
          </v-col>

          <!-- First contact date -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.firstContactDate"
              label="Ngày tiếp nhận"
              type="date"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-calendar-import"
            />
          </v-col>

          <!-- Tags -->
          <v-col cols="12" sm="6">
            <v-combobox
              v-model="form.tags"
              :items="[]"
              label="Tags / Nhãn khách hàng"
              multiple
              chips
              closable-chips
              clearable
              hide-details
              variant="outlined"
              prepend-inner-icon="mdi-tag-multiple-outline"
              color="cyan"
            >
              <template #chip="{ props, item }">
                <v-chip
                  v-bind="props"
                  color="cyan"
                  variant="flat"
                  size="small"
                  class="font-weight-medium"
                >
                  {{ (item as any).raw }}
                </v-chip>
              </template>
            </v-combobox>
          </v-col>

          <!-- Admin System ID -->
          <v-col cols="12">
            <v-text-field
              v-model="form.adminCustomerId"
              label="ID Hệ thống Admin"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-link-variant"
              placeholder="Nhập ID khách hàng từ trang quản trị"
              hint="Dùng để liên kết dữ liệu với hệ thống Admin"
              persistent-hint
            />
          </v-col>

          <!-- Notes -->
          <v-col cols="12">
            <v-textarea
              v-model="form.notes"
              label="Ghi chú thêm"
              rows="3"
              auto-grow
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-note-text-outline"
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn
          v-if="!isNew"
          color="error"
          variant="text"
          :loading="deleting"
          @click="onDelete"
        >
          Xoá
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Success Notification -->
  <v-snackbar v-model="showSnackbar" color="success" timeout="3000" location="top">
    {{ snackbarText }}
    <template #actions>
      <v-btn variant="text" @click="showSnackbar = false">Đóng</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import type { Contact } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, STATUS_OPTIONS, useContacts } from '@/composables/use-contacts';
import { useUsers } from '@/composables/use-users';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  modelValue: boolean;
  contact: Contact | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [contact: Contact];
  deleted: [id: string];
}>();

const { saving, deleting, createContact, updateContact, deleteContact } = useContacts();
const { users, fetchUsers } = useUsers();
const authStore = useAuthStore();
const showSnackbar = ref(false);
const snackbarText = ref('');

const selectableUsers = computed(() => {
  if (authStore.isAdmin) return users.value;
  return authStore.user ? [authStore.user] : [];
});

onMounted(() => {
  if (authStore.isAdmin) {
    fetchUsers();
  }
});

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isNew = computed(() => !props.contact?.id);

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  nextAppointmentDate: string;
  firstContactDate: string;
  notes: string;
  tags: string[];
  assignedUserId: string | null;
  adminCustomerId: string;
}

const form = ref<FormState>(emptyForm());

function emptyForm(): FormState {
  return {
    fullName: '',
    phone: '',
    email: '',
    source: '',
    status: '',
    nextAppointmentDate: '',
    firstContactDate: '',
    notes: '',
    tags: [],
    assignedUserId: authStore.user?.id || null,
    adminCustomerId: '',
  };
}

watch(() => props.contact, (c) => {
  if (c) {
    form.value = {
      fullName: c.fullName ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      source: c.source ?? '',
      status: c.status ?? '',
      nextAppointmentDate: c.nextAppointment
        ? new Date(c.nextAppointment).toISOString().split('T')[0]
        : '',
      firstContactDate: c.firstContactDate
        ? new Date(c.firstContactDate).toISOString().split('T')[0]
        : '',
      notes: c.notes ?? '',
      tags: c.tags ?? [],
      assignedUserId: c.assignedUserId ?? null,
      adminCustomerId: c.adminCustomerId || c.crm_name || '',
    };
  } else {
    form.value = emptyForm();
  }
}, { immediate: true, deep: true });

function required(v: string) {
  return !!v || 'Bắt buộc';
}

async function onSave() {
  const payload: Partial<Contact> = {
    fullName: form.value.fullName || null,
    phone: form.value.phone || null,
    email: form.value.email || null,
    source: form.value.source || null,
    status: form.value.status || null,
    nextAppointment: form.value.nextAppointmentDate
      ? new Date(form.value.nextAppointmentDate + 'T00:00:00').toISOString()
      : null,
    firstContactDate: form.value.firstContactDate
      ? new Date(form.value.firstContactDate + 'T00:00:00').toISOString()
      : null,
    notes: form.value.notes || null,
    tags: form.value.tags,
    assignedUserId: form.value.assignedUserId || null,
    adminCustomerId: form.value.adminCustomerId || null,
  };

  let result: Contact | null;
  if (isNew.value) {
    result = await createContact(payload);
  } else {
    result = await updateContact(props.contact!.id, payload);
  }
  if (result) {
    snackbarText.value = isNew.value ? 'Thêm khách hàng thành công!' : 'Cập nhật khách hàng thành công!';
    showSnackbar.value = true;
    emit('saved', result);
    // Delay closing to let user see the snackbar if desired, 
    // or close immediately as the snackbar can persist.
    setTimeout(() => {
      close();
    }, 500);
  }
}

async function onDelete() {
  if (!props.contact?.id) return;
  const ok = await deleteContact(props.contact.id);
  if (ok) {
    emit('deleted', props.contact.id);
    close();
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
