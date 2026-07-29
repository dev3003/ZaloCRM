<template>
  <v-app class="super-admin-root">
    <!-- Dedicated Super Admin Header Bar -->
    <v-app-bar flat color="#0F172A" class="border-b border-amber-accent-4 px-2" height="64">
      <div class="d-flex align-center ga-3 pl-2">
        <div class="d-inline-flex align-center justify-center pa-2 rounded-lg glow-brand">
          <v-icon color="#FCD34D" size="26">mdi-shield-crown</v-icon>
        </div>
        <div>
          <div class="font-weight-black text-white text-subtitle-1 tracking-wide d-flex align-center ga-2">
            Omni360 <span class="bg-amber-accent-4 text-black text-caption font-weight-black px-2 py-0-5 rounded-pill">CONTROL CENTER</span>
          </div>
          <div class="text-caption text-grey-lighten-1">Cổng Quản trị Hệ thống Tập trung & Hạ tầng</div>
        </div>
      </div>

      <v-spacer />

      <!-- Status Badges -->
      <div class="d-none d-md-flex align-center ga-3 mr-4">
        <v-chip color="amber-accent-3" size="small" variant="tonal" class="font-weight-bold">
          <v-icon start size="14">mdi-server-network</v-icon>
          Multi-Tenant Isolation: SECURE
        </v-chip>
      </div>

      <!-- Super Admin Profile & Logout -->
      <div class="d-flex align-center ga-3 pr-2">
        <v-chip color="amber-accent-3" variant="outlined" class="font-weight-bold text-caption">
          <v-icon start size="14">mdi-shield-account</v-icon>
          {{ authStore.user?.email || 'superadmin@omni360.vn' }}
        </v-chip>

        <v-btn
          color="error"
          variant="flat"
          size="small"
          class="font-weight-black rounded-lg text-caption"
          @click="handleLogout"
        >
          <v-icon start size="16">mdi-logout-variant</v-icon>
          ĐĂNG XUẤT
        </v-btn>
      </div>
    </v-app-bar>

    <!-- Main Content Container -->
    <v-main class="bg-slate-900 min-h-screen">
      <v-container fluid class="pa-6 max-w-1600 mx-auto">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSocketStore } from '@/stores/socket';

const router = useRouter();
const authStore = useAuthStore();
const socketStore = useSocketStore();

function handleLogout() {
  socketStore.disconnect();
  authStore.logout();
  router.push('/super-admin/login');
}
</script>

<style scoped>
.super-admin-root {
  background-color: #0B0F19 !important;
  color: #F8FAFC !important;
}

.bg-slate-900 {
  background-color: #0B0F19 !important;
}

.glow-brand {
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(252, 211, 77, 0.4);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.3);
}

.border-amber-accent-4 {
  border-bottom: 1px solid rgba(252, 211, 77, 0.25) !important;
}

.max-w-1600 {
  max-width: 1600px;
}
</style>
