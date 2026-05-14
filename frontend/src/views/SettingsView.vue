<template>
  <div>
    <h1 class="text-h4 mb-4">
      <v-icon class="mr-2" style="color: #00F2FF;">mdi-cog-outline</v-icon>
      Cài đặt
    </h1>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="users">Nhân viên</v-tab>
      <v-tab value="teams">Đội nhóm</v-tab>
      <v-tab value="org">Tổ chức</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Tab 1: User management -->
      <v-window-item value="users">
        <div class="d-flex align-center mb-4">
          <v-btn v-if="authStore.canManageOrganization" color="primary" prepend-icon="mdi-plus" @click="openCreate">
            Thêm nhân sự
          </v-btn>
        </div>

        <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>

        <v-card>
          <v-data-table :headers="headers" :items="users" :loading="loading" no-data-text="Chưa có nhân viên nào">
            <template #item.role="{ item }">
              <v-chip :color="roleColor(item.role)" size="small" variant="flat">{{ roleLabel(item.role) }}</v-chip>
            </template>
            <template #item.isActive="{ item }">
              <v-chip :color="item.isActive ? 'success' : 'default'" size="small" variant="flat">
                {{ item.isActive ? 'Hoạt động' : 'Vô hiệu' }}
              </v-chip>
            </template>
            <template #item.team="{ item }">
              <span v-if="item.team" class="text-body-2">{{ item.team.name }}</span>
              <span v-else class="text-body-2 text-medium-emphasis italic">Chưa gán nhóm</span>
            </template>
            <template #item.actions="{ item }">
              <v-btn v-if="authStore.canManageOrganization" icon size="small" title="Chỉnh sửa" @click="openEdit(item)">
                <v-icon>mdi-pencil</v-icon>
              </v-btn>
              <v-btn v-if="authStore.canManageOrganization" icon size="small" title="Đặt lại mật khẩu" @click="openPassword(item)">
                <v-icon>mdi-lock-reset</v-icon>
              </v-btn>
              <v-btn v-if="authStore.isOwner && item.id !== authStore.user?.id" icon size="small" color="error" title="Vô hiệu hóa" @click="confirmDelete(item)">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
          </v-data-table>
        </v-card>

        <!-- Create dialog -->
        <v-dialog v-model="showCreate" max-width="440">
          <v-card>
            <v-card-title>Thêm nhân sự</v-card-title>
            <v-card-text>
              <v-text-field v-model="form.fullName" label="Họ tên *" class="mb-2" />
              <v-text-field v-model="form.email" label="Email *" type="email" class="mb-2" />
              <v-text-field v-model="form.password" label="Mật khẩu *" type="password" class="mb-2" />
              <v-select v-model="form.role" :items="roleOptions" item-title="label" item-value="value" label="Vai trò" />
              <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn @click="showCreate = false">Hủy</v-btn>
              <v-btn color="primary" :loading="saving" @click="handleCreate">Tạo</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Edit dialog -->
        <v-dialog v-model="showEdit" max-width="440">
          <v-card>
            <v-card-title>Chỉnh sửa nhân viên</v-card-title>
            <v-card-text>
              <v-text-field v-model="form.fullName" label="Họ tên" class="mb-2" />
              <v-text-field v-model="form.email" label="Email" type="email" class="mb-2" />
              <v-select v-if="authStore.isOwner" v-model="form.role" :items="roleOptions" item-title="label" item-value="value" label="Vai trò" />
              <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn @click="showEdit = false">Hủy</v-btn>
              <v-btn color="primary" :loading="saving" @click="handleUpdate">Lưu</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Reset password dialog -->
        <v-dialog v-model="showPassword" max-width="400">
          <v-card>
            <v-card-title>Đặt lại mật khẩu</v-card-title>
            <v-card-text>
              <v-text-field v-model="newPassword" label="Mật khẩu mới *" type="password" />
              <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn @click="showPassword = false">Hủy</v-btn>
              <v-btn color="primary" :loading="saving" @click="handlePassword">Đặt lại</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Delete confirm dialog -->
        <v-dialog v-model="showDelete" max-width="400">
          <v-card>
            <v-card-title>Xác nhận vô hiệu hóa</v-card-title>
            <v-card-text>Bạn có chắc muốn vô hiệu hóa nhân viên "{{ selectedUser?.fullName }}"?</v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn @click="showDelete = false">Hủy</v-btn>
              <v-btn color="error" :loading="saving" @click="handleDelete">Vô hiệu hóa</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>
      </v-window-item>

      <!-- Tab 2: Team management -->
      <v-window-item value="teams">
        <TeamManagement ref="teamMgmt" />
      </v-window-item>

      <!-- Tab 3: Organization settings -->
      <v-window-item value="org">
        <OrgSettings />
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useUsers, type OrgUser } from '@/composables/use-users';
import { useAuthStore } from '@/stores/auth';
import TeamManagement from '@/components/settings/TeamManagement.vue';
import OrgSettings from '@/components/settings/OrgSettings.vue';

const { users, loading, error, fetchUsers, createUser, updateUser, resetPassword, deleteUser } = useUsers();
const authStore = useAuthStore();

const tab = ref('users');
const showCreate = ref(false);
const showEdit = ref(false);
const showPassword = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const dialogError = ref('');
const newPassword = ref('');
const selectedUser = ref<OrgUser | null>(null);
const teamMgmt = ref<any>(null);

const form = ref({ fullName: '', email: '', password: '', role: 'member' });

const roleOptions = computed(() => {
  const options = [{ label: 'Nhân viên', value: 'member' }, { label: 'Trưởng nhóm (Leader)', value: 'leader' }];
  if (authStore.canManageOrganization) {
    options.push({ label: 'Quản lý (Manager)', value: 'manager' });
  }
  if (authStore.isOwner) {
    options.push({ label: 'Quản trị viên (Admin)', value: 'admin' });
  }
  return options;
});

const headers = [
  { title: 'Họ tên', key: 'fullName', sortable: true },
  { title: 'Email', key: 'email' },
  { title: 'Vai trò', key: 'role', sortable: true },
  { title: 'Đội nhóm', key: 'team', sortable: true },
  { title: 'Trạng thái', key: 'isActive', sortable: true },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

function roleColor(role: string) {
  if (role === 'owner') return 'deep-purple-accent-4';
  if (role === 'admin') return 'indigo-accent-3';
  if (role === 'manager') return 'blue-darken-1';
  if (role === 'leader') return 'cyan-darken-1';
  return 'blue-grey-lighten-2';
}

function roleLabel(role: string) {
  if (role === 'owner') return 'Chủ sở hữu';
  if (role === 'admin') return 'Quản trị viên (Admin)';
  if (role === 'manager') return 'Quản lý (Manager)';
  if (role === 'leader') return 'Trưởng nhóm (Leader)';
  return 'Nhân viên';
}

function openCreate() {
  form.value = { fullName: '', email: '', password: '', role: 'member' };
  dialogError.value = '';
  showCreate.value = true;
}

function openEdit(user: OrgUser) {
  selectedUser.value = user;
  form.value = { fullName: user.fullName, email: user.email, password: '', role: user.role };
  dialogError.value = '';
  showEdit.value = true;
}

function openPassword(user: OrgUser) {
  selectedUser.value = user;
  newPassword.value = '';
  dialogError.value = '';
  showPassword.value = true;
}

function confirmDelete(user: OrgUser) {
  selectedUser.value = user;
  showDelete.value = true;
}

async function handleCreate() {
  saving.value = true;
  dialogError.value = '';
  const res = await createUser(form.value);
  saving.value = false;
  if (res.ok) { 
    showCreate.value = false;
    if (teamMgmt.value) teamMgmt.value.refresh();
  } else { dialogError.value = res.error || ''; }
}

async function handleUpdate() {
  if (!selectedUser.value) return;
  saving.value = true;
  dialogError.value = '';
  const res = await updateUser(selectedUser.value.id, { fullName: form.value.fullName, email: form.value.email, role: form.value.role });
  saving.value = false;
  if (res.ok) { 
    showEdit.value = false;
    if (teamMgmt.value) teamMgmt.value.refresh();
  } else { dialogError.value = res.error || ''; }
}

async function handlePassword() {
  if (!selectedUser.value) return;
  saving.value = true;
  dialogError.value = '';
  const res = await resetPassword(selectedUser.value.id, newPassword.value);
  saving.value = false;
  if (res.ok) { showPassword.value = false; } else { dialogError.value = res.error || ''; }
}

async function handleDelete() {
  if (!selectedUser.value) return;
  saving.value = true;
  const res = await deleteUser(selectedUser.value.id);
  saving.value = false;
  if (res.ok) { 
    showDelete.value = false;
    if (teamMgmt.value) teamMgmt.value.refresh();
  }
}

onMounted(fetchUsers);
</script>
