<template>
  <v-card class="pa-8" style="backdrop-filter: blur(20px);" elevation="0">
    <div class="text-center mb-8">
      <img
        src="/logo.png"
        alt="Omni360 Logo"
        style="height: 120px; width: auto; object-fit: contain; margin: 0 auto 1.5rem auto; display: block;"
      />
      <h1 class="text-h5 font-weight-bold">Omni<span style="color: #3B82F6;">360</span></h1>
    </div>

    <v-form @submit.prevent="handleLogin">
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        prepend-inner-icon="mdi-email-outline"
        required
        class="mb-3"
      />
      <v-text-field
        v-model="password"
        label="Mật khẩu"
        :type="showPassword ? 'text' : 'password'"
        prepend-inner-icon="mdi-lock-outline"
        :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
        @click:append-inner="showPassword = !showPassword"
        required
        class="mb-5"
      />
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="xl">
        <v-icon start>mdi-login</v-icon>
        Đăng nhập
      </v-btn>

      <div class="text-center mt-6">
        <div class="text-body-2 text-grey">Chưa có tài khoản Tổ chức / Trung tâm?</div>
        <v-btn variant="text" color="primary" class="font-weight-bold mt-1" @click="showRegisterDialog = true">
          <v-icon start>mdi-domain-plus</v-icon>
          Đăng ký Tổ chức mới
        </v-btn>
      </div>

      <div class="text-center mt-4 pt-4 border-t">
        <router-link to="/super-admin/login" class="text-caption text-grey text-decoration-none font-weight-medium">
          <v-icon size="14" class="mr-1" color="amber-darken-2">mdi-shield-crown</v-icon>
          Cổng Đăng nhập Super Admin
        </router-link>
      </div>
    </v-form>

    <v-alert v-if="error" type="error" class="mt-4" density="compact" closable variant="tonal">
      {{ error }}
    </v-alert>

    <!-- Dialog Đăng ký Tổ chức / Trung tâm mới -->
    <v-dialog v-model="showRegisterDialog" max-width="500" class="rounded-xl">
      <v-card class="pa-6 rounded-xl">
        <div class="d-flex align-center justify-space-between mb-4">
          <div class="text-h6 font-weight-bold color-primary">
            <v-icon color="primary" class="mr-2">mdi-domain-plus</v-icon>
            Đăng ký Tổ chức / Trung tâm
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showRegisterDialog = false" />
        </div>

        <v-alert type="info" variant="tonal" class="mb-4 text-caption" density="compact">
          Hệ thống sẽ tự động khởi tạo 1 Máy chủ Agent duy nhất kèm Agent Key riêng biệt cho Tổ chức của bạn sau khi đăng ký.
        </v-alert>

        <v-form @submit.prevent="handleRegister">
          <v-text-field
            v-model="regOrgName"
            label="Tên Tổ chức / Công ty / Trung tâm"
            prepend-inner-icon="mdi-domain"
            placeholder="Ví dụ: Công ty TNHH Omni360"
            variant="outlined"
            density="compact"
            required
            class="mb-2"
          />

          <v-text-field
            v-model="regFullName"
            label="Họ và tên Quản trị viên"
            prepend-inner-icon="mdi-account-outline"
            placeholder="Ví dụ: Nguyễn Văn A"
            variant="outlined"
            density="compact"
            required
            class="mb-2"
          />

          <v-text-field
            v-model="regEmail"
            label="Email đăng nhập"
            type="email"
            prepend-inner-icon="mdi-email-outline"
            placeholder="admin@omni360.vn"
            variant="outlined"
            density="compact"
            required
            class="mb-2"
          />

          <v-text-field
            v-model="regPassword"
            label="Mật khẩu"
            :type="showRegPassword ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-outline"
            :append-inner-icon="showRegPassword ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append-inner="showRegPassword = !showRegPassword"
            variant="outlined"
            density="compact"
            required
            class="mb-2"
          />

          <v-text-field
            v-model="regConfirmPassword"
            label="Xác nhận mật khẩu"
            :type="showRegPassword ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-check-outline"
            variant="outlined"
            density="compact"
            required
            class="mb-4"
          />

          <v-alert v-if="regError" type="error" density="compact" variant="tonal" class="mb-4" closable @click:close="regError = ''">
            {{ regError }}
          </v-alert>

          <v-btn type="submit" color="primary" block size="large" :loading="regLoading" rounded="xl">
            <v-icon start>mdi-check-circle-outline</v-icon>
            Đăng ký & Khởi tạo ngay
          </v-btn>
        </v-form>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');
const router = useRouter();
const authStore = useAuthStore();

// Registration reactive state
const showRegisterDialog = ref(false);
const regOrgName = ref('');
const regFullName = ref('');
const regEmail = ref('');
const regPassword = ref('');
const regConfirmPassword = ref('');
const showRegPassword = ref(false);
const regLoading = ref(false);
const regError = ref('');

onMounted(async () => {
  try {
    const needs = await authStore.checkSetup();
    if (needs) router.replace('/setup');
  } catch {}
});

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(email.value, password.value);
    // Khôi phục URL trước đó nếu được redirect từ luồng ERP → CRM
    const redirectUrl = sessionStorage.getItem('redirect_after_login');
    if (redirectUrl) {
      sessionStorage.removeItem('redirect_after_login');
      router.push(redirectUrl);
    } else {
      router.push('/');
    }
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Đăng nhập thất bại';
  } finally {
    loading.value = false;
  }
}

async function handleRegister() {
  if (regPassword.value !== regConfirmPassword.value) {
    regError.value = 'Mật khẩu xác nhận không trùng khớp';
    return;
  }
  regLoading.value = true;
  regError.value = '';

  try {
    const res = await api.post('/auth/register-organization', {
      orgName: regOrgName.value,
      fullName: regFullName.value,
      email: regEmail.value,
      password: regPassword.value,
    });

    if (res.data?.token) {
      localStorage.setItem('token', res.data.token);
      authStore.token = res.data.token;
      await authStore.fetchProfile();
      showRegisterDialog.value = false;
      router.push('/desktop-agent');
    }
  } catch (err: any) {
    regError.value = err.response?.data?.error || 'Đăng ký thất bại, vui lòng thử lại.';
  } finally {
    regLoading.value = false;
  }
}
</script>
