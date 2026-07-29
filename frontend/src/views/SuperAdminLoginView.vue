<template>
  <div class="super-admin-wrapper py-6">
    <v-card class="pa-6 pa-sm-8 super-admin-card rounded-xl" variant="flat">
      <div class="text-center mb-6">
        <div class="d-inline-flex align-center justify-center pa-4 rounded-circle glow-avatar mb-3">
          <v-icon size="42" color="#FCD34D">mdi-shield-crown</v-icon>
        </div>
        
        <div class="d-flex align-center justify-center mb-2">
          <v-chip color="amber-accent-3" size="x-small" variant="flat" class="font-weight-black tracking-wider text-black">
            SYSTEM CONTROL CENTER
          </v-chip>
        </div>

        <h1 class="text-h5 font-weight-black mt-2 text-title-bright">
          Super Admin Login
        </h1>
        <p class="text-caption mt-1 text-subtitle-bright">
          Cổng Quản trị Hệ thống Tập trung Omni360
        </p>
      </div>

      <v-alert
        v-if="errorMessage"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4 rounded-lg text-caption font-weight-medium"
        closable
        @click:close="errorMessage = ''"
      >
        {{ errorMessage }}
      </v-alert>

      <v-form @submit.prevent="handleSuperAdminLogin">
        <div class="mb-4">
          <label class="text-caption font-weight-bold mb-1 d-block text-label-bright">EMAIL QUẢN TRỊ VIÊN</label>
          <v-text-field
            v-model="email"
            placeholder="superadmin@omni360.vn"
            prepend-inner-icon="mdi-shield-account-outline"
            variant="outlined"
            density="comfortable"
            class="super-input"
            hide-details="auto"
            required
          />
        </div>

        <div class="mb-6">
          <label class="text-caption font-weight-bold mb-1 d-block text-label-bright">MẬT KHẨU BẢO MẬT</label>
          <v-text-field
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••••••"
            prepend-inner-icon="mdi-lock-shield-outline"
            :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showPassword = !showPassword"
            variant="outlined"
            density="comfortable"
            class="super-input"
            hide-details="auto"
            required
          />
        </div>

        <v-btn
          type="submit"
          block
          size="large"
          class="font-weight-black rounded-lg glow-btn"
          :loading="loading"
        >
          <v-icon start size="20">mdi-shield-key-outline</v-icon>
          ĐĂNG NHẬP SUPER ADMIN
        </v-btn>
      </v-form>

      <v-divider class="my-6 border-white-10" />

      <div class="text-center">
        <router-link to="/login" class="text-caption text-decoration-none font-weight-medium text-back-link">
          <v-icon size="14" class="mr-1">mdi-arrow-left</v-icon>
          Quay lại Đăng nhập Khách hàng / Tổ chức
        </router-link>
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const router = useRouter();
const authStore = useAuthStore();

const email = ref('superadmin@omni360.vn');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const errorMessage = ref('');

async function handleSuperAdminLogin() {
  if (!email.value || !password.value) {
    errorMessage.value = 'Vui lòng nhập Email và Mật khẩu Quản trị';
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const res = await api.post('/auth/super-admin/login', {
      email: email.value,
      password: password.value,
    });

    if (res.data?.token) {
      localStorage.setItem('token', res.data.token);
      authStore.token = res.data.token;
      await authStore.fetchProfile();

      if (authStore.user?.role !== 'superadmin') {
        errorMessage.value = 'Tài khoản không phải Super Admin!';
        authStore.logout();
        return;
      }

      router.push('/super-admin');
    }
  } catch (err: any) {
    errorMessage.value = err.response?.data?.error || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.super-admin-wrapper {
  width: 100%;
}

.super-admin-card {
  background: rgba(15, 23, 42, 0.95) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(252, 211, 77, 0.4) !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 35px rgba(245, 158, 11, 0.25) !important;
  color: #FFFFFF !important;
}

.text-title-bright {
  color: #FFFFFF !important;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.text-subtitle-bright {
  color: #CBD5E1 !important;
}

.text-label-bright {
  color: #F8FAFC !important;
  letter-spacing: 0.5px;
}

.glow-avatar {
  background: rgba(30, 41, 59, 0.9);
  border: 2px solid rgba(252, 211, 77, 0.5);
  box-shadow: 0 0 25px rgba(245, 158, 11, 0.4);
}

.super-input :deep(input) {
  color: #FFFFFF !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.super-input :deep(.v-field) {
  background-color: rgba(30, 41, 59, 0.8) !important;
  border-radius: 8px !important;
}

.super-input :deep(.v-field__outline) {
  color: rgba(252, 211, 77, 0.5) !important;
}

.super-input :deep(.v-icon) {
  color: #FCD34D !important;
  opacity: 0.9;
}

.glow-btn {
  background: linear-gradient(135deg, #F59E0B 0%, #FCD34D 100%) !important;
  color: #0F172A !important;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.5) !important;
  transition: all 0.3s ease;
  height: 48px;
}

.glow-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 30px rgba(245, 158, 11, 0.7) !important;
}

.border-white-10 {
  border-color: rgba(255, 255, 255, 0.15) !important;
}

.text-back-link {
  color: #94A3B8 !important;
  transition: color 0.2s ease;
}

.text-back-link:hover {
  color: #FCD34D !important;
}

.tracking-wider {
  letter-spacing: 1.5px;
}
</style>
