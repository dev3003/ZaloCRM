<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6 mb-0">Cấu hình Lưu trữ (FTP)</h2>
      <v-spacer></v-spacer>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Thêm FTP Mới</v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-card>
      <v-data-table :headers="headers" :items="configs" :loading="loading" no-data-text="Chưa có cấu hình FTP nào">
        <template #item.isActive="{ item }">
          <v-switch
            v-model="item.isActive"
            color="success"
            hide-details
            density="compact"
            @change="toggleActive(item)"
          ></v-switch>
        </template>
        <template #item.actions="{ item }">
          <v-btn icon size="small" title="Chỉnh sửa" @click="openEdit(item)">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon size="small" color="error" title="Xóa" @click="confirmDelete(item)" :disabled="item.isActive">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="showDialog" max-width="500">
      <v-card>
        <v-card-title>{{ isEditing ? 'Sửa FTP' : 'Thêm FTP Mới' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="Tên gợi nhớ (VD: FTP 1)" required class="mb-2" />
          <v-text-field v-model="form.host" label="Host (VD: ftp.domain.com)" required class="mb-2" />
          <v-text-field v-model="form.port" label="Port (Mặc định: 21)" type="number" class="mb-2" />
          <v-text-field v-model="form.user" label="Username" required class="mb-2" />
          <v-text-field 
            v-model="form.password" 
            label="Password" 
            :type="showPasswordInput ? 'text' : 'password'" 
            :append-inner-icon="showPasswordInput ? 'mdi-eye-off' : 'mdi-eye'" 
            @click:append-inner="showPasswordInput = !showPasswordInput" 
            class="mb-2" 
          />
          
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-4">{{ dialogError }}</v-alert>
          <v-alert v-if="testSuccess" type="success" density="compact" class="mt-4">{{ testSuccess }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn color="info" variant="text" :loading="testing" @click="testConnection" prepend-icon="mdi-connection">Test Kết nối</v-btn>
          <v-spacer />
          <v-btn @click="showDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleSave">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirm -->
    <v-dialog v-model="showDelete" max-width="400">
      <v-card>
        <v-card-title>Xác nhận xóa</v-card-title>
        <v-card-text>Bạn có chắc chắn muốn xóa cấu hình "{{ selectedItem?.name }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDelete = false">Hủy</v-btn>
          <v-btn color="error" :loading="saving" @click="handleDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';

const configs = ref<any[]>([]);
const loading = ref(false);
const error = ref('');

const showDialog = ref(false);
const isEditing = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const testing = ref(false);
const dialogError = ref('');
const testSuccess = ref('');
const showPasswordInput = ref(false);
const selectedItem = ref<any>(null);

const form = ref({
  id: '',
  name: '',
  host: '',
  port: 21,
  user: '',
  password: ''
});

const headers = [
  { title: 'Trạng thái', key: 'isActive', sortable: false, width: '100px' },
  { title: 'Tên', key: 'name' },
  { title: 'Host', key: 'host' },
  { title: 'User', key: 'user' },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

async function fetchConfigs() {
  loading.value = true;
  try {
    const res = await api.get('/storage-configs');
    configs.value = res.data;
  } catch (err: any) {
    error.value = 'Lỗi tải danh sách cấu hình: ' + err.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  isEditing.value = false;
  form.value = { id: '', name: '', host: '', port: 21, user: '', password: '' };
  dialogError.value = '';
  testSuccess.value = '';
  showPasswordInput.value = false;
  showDialog.value = true;
}

function openEdit(item: any) {
  isEditing.value = true;
  form.value = { ...item };
  dialogError.value = '';
  testSuccess.value = '';
  showPasswordInput.value = false;
  showDialog.value = true;
}

function confirmDelete(item: any) {
  selectedItem.value = item;
  showDelete.value = true;
}

async function testConnection() {
  testing.value = true;
  dialogError.value = '';
  testSuccess.value = '';
  try {
    const res = await api.post('/storage-configs/test', form.value);
    const data = res.data;
    if (data.success) {
      testSuccess.value = 'Kết nối thành công!';
    } else {
      dialogError.value = data.error || 'Lỗi kết nối';
    }
  } catch (err: any) {
    dialogError.value = 'Lỗi kết nối: ' + err.message;
  } finally {
    testing.value = false;
  }
}

async function handleSave() {
  if (!form.value.name || !form.value.host || !form.value.user) {
    dialogError.value = 'Vui lòng nhập đầy đủ Tên, Host và User';
    return;
  }
  
  saving.value = true;
  dialogError.value = '';
  try {
    if (isEditing.value) {
      await api.put(`/storage-configs/${form.value.id}`, form.value);
    } else {
      await api.post('/storage-configs', form.value);
    }
    showDialog.value = false;
    await fetchConfigs();
  } catch (err: any) {
    dialogError.value = 'Lỗi lưu cấu hình: ' + err.message;
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  saving.value = true;
  try {
    await api.delete(`/storage-configs/${selectedItem.value.id}`);
    showDelete.value = false;
    await fetchConfigs();
  } catch (err: any) {
    error.value = 'Lỗi xóa cấu hình: ' + err.message;
  } finally {
    saving.value = false;
  }
}

async function toggleActive(item: any) {
  if (!item.isActive) {
    item.isActive = false;
    return; // Đang từ bật chuyển sang tắt -> Không cho phép tắt không, phải bật 1 cái khác
  }
  
  try {
    await api.put(`/storage-configs/${item.id}/activate`);
    await fetchConfigs();
  } catch (err: any) {
    error.value = 'Lỗi kích hoạt cấu hình: ' + err.message;
    await fetchConfigs(); // revert
  }
}

onMounted(() => {
  fetchConfigs();
});
</script>
