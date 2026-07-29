<template>
  <v-app theme="dark" class="super-admin-layout">
    <!-- Left Navigation Sidebar -->
    <v-navigation-drawer
      v-model="drawer"
      permanent
      width="280"
      color="#0F172A"
      class="super-sidebar border-e border-slate-800"
    >
      <!-- Sidebar Header / Logo -->
      <div class="pa-5 d-flex align-center ga-3 border-b border-slate-800">
        <div class="d-inline-flex align-center justify-center pa-2.5 rounded-xl glow-avatar">
          <v-icon color="#FCD34D" size="28">mdi-shield-crown</v-icon>
        </div>
        <div>
          <div class="font-weight-black text-white text-subtitle-1 tracking-wide">
            Omni360
          </div>
          <div class="d-flex align-center mt-0.5">
            <span class="badge-super-admin">SUPER ADMIN CENTER</span>
          </div>
        </div>
      </div>

      <!-- Navigation Section Header -->
      <div class="px-5 pt-5 pb-2 text-caption font-weight-black text-amber-accent-3 text-uppercase tracking-wider">
        DANH MỤC QUẢN TRỊ
      </div>

      <!-- Navigation Menu Items -->
      <v-list density="comfortable" class="px-3" nav color="transparent">
        <v-list-item
          v-for="item in menuItems"
          :key="item.tab"
          :value="item.tab"
          :active="activeTab === item.tab"
          @click="selectTab(item.tab)"
          class="rounded-lg mb-2 super-nav-item"
          :class="{ 'super-nav-item-active': activeTab === item.tab }"
        >
          <template v-slot:prepend>
            <v-icon :color="activeTab === item.tab ? '#FCD34D' : '#94A3B8'">{{ item.icon }}</v-icon>
          </template>
          <v-list-item-title class="font-weight-bold text-subtitle-2" :class="activeTab === item.tab ? 'text-amber-bright' : 'text-slate-200'">
            {{ item.title }}
          </v-list-item-title>
        </v-list-item>
      </v-list>

      <template v-slot:append>
        <!-- Bottom User Info & Logout -->
        <div class="pa-4 border-t border-slate-800 bg-slate-950">
          <div class="d-flex align-center ga-3 mb-3">
            <v-avatar color="#FCD34D" size="36" class="font-weight-black text-black">
              SA
            </v-avatar>
            <div class="overflow-hidden">
              <div class="text-caption font-weight-bold text-white text-truncate">
                {{ authStore.user?.email || 'superadmin@omni360.vn' }}
              </div>
              <div class="text-px-10 text-amber-accent-3 font-weight-bold">
                Quản trị viên Cao cấp
              </div>
            </div>
          </div>

          <v-btn
            block
            color="error"
            variant="flat"
            size="small"
            class="font-weight-bold rounded-lg text-white"
            @click="handleLogout"
          >
            <v-icon start size="16">mdi-logout-variant</v-icon>
            Đăng xuất Quản trị
          </v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Top App Bar -->
    <v-app-bar flat color="#1E293B" class="border-b border-slate-700 px-4" height="64">
      <div class="d-flex align-center ga-3">
        <v-icon color="#FCD34D" size="24">{{ currentItemIcon }}</v-icon>
        <h2 class="text-h6 font-weight-bold text-white mb-0">
          {{ currentItemTitle }}
        </h2>
      </div>

      <v-spacer />

      <!-- Status Indicator -->
      <div class="d-flex align-center ga-2 bg-slate-900 px-3 py-1.5 rounded-pill border border-slate-700">
        <span class="status-dot"></span>
        <span class="text-caption font-weight-bold text-slate-100">System Isolation: SECURE</span>
      </div>
    </v-app-bar>

    <!-- Main Content Area -->
    <v-main class="bg-slate-950 min-h-screen text-white">
      <v-container fluid class="pa-6 max-w-1600 mx-auto">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSocketStore } from '@/stores/socket';

const drawer = ref(true);
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const socketStore = useSocketStore();

const menuItems = [
  { title: 'Tổ chức & Trung tâm', tab: 'orgs', icon: 'mdi-domain' },
  { title: 'Máy chủ Agent', tab: 'agents', icon: 'mdi-server-network' },
  { title: 'Cấu hình Lưu trữ FTP', tab: 'ftp', icon: 'mdi-folder-network' },
];

const activeTab = computed(() => (route.query.tab as string) || 'orgs');

const currentItemTitle = computed(() => {
  const item = menuItems.find(i => i.tab === activeTab.value);
  return item ? item.title : 'Quản trị Hệ thống';
});

const currentItemIcon = computed(() => {
  const item = menuItems.find(i => i.tab === activeTab.value);
  return item ? item.icon : 'mdi-shield-crown';
});

function selectTab(tab: string) {
  router.replace({ query: { ...route.query, tab } });
}

function handleLogout() {
  socketStore.disconnect();
  authStore.logout();
  router.push('/super-admin/login');
}
</script>

<style scoped>
.super-admin-layout {
  background-color: #090D16 !important;
  color: #F8FAFC !important;
}

.bg-slate-950 {
  background-color: #090D16 !important;
}

.bg-slate-900 {
  background-color: #0F172A !important;
}

.bg-slate-800 {
  background-color: #1E293B !important;
}

.border-slate-800 {
  border-color: rgba(51, 65, 85, 0.8) !important;
}

.border-slate-700 {
  border-color: rgba(71, 85, 105, 0.8) !important;
}

.glow-avatar {
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(252, 211, 77, 0.5);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.3);
}

.badge-super-admin {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: #000;
  font-size: 10px;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 9999px;
  letter-spacing: 0.5px;
}

.super-nav-item {
  transition: all 0.2s ease-in-out;
  color: #CBD5E1 !important;
}

.super-nav-item:hover {
  background: rgba(30, 41, 59, 0.9) !important;
  color: #FCD34D !important;
}

.super-nav-item-active {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.35)) !important;
  border: 1px solid #FCD34D !important;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);
}

.text-amber-bright {
  color: #FCD34D !important;
}

.text-px-10 {
  font-size: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  background-color: #22C55E;
  border-radius: 50%;
  box-shadow: 0 0 8px #22C55E;
}

.max-w-1600 {
  max-width: 1600px;
}
</style>
