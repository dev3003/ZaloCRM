<template>
  <v-app :class="{ 'liquid-bg': isDark }">
    <!-- Top bar — glass effect -->
    <v-app-bar density="comfortable" flat class="border-bottom" :color="isDark ? undefined : 'white'">
      <v-app-bar-nav-icon @click="drawer = !drawer" />

      <!-- AI Core Orb + Title -->
      <div class="d-flex align-center flex-shrink-0" style="gap: 12px;">
        <img
          src="/logo.png"
          alt="ZaloCRM Logo"
          style="height: 50px; width: auto; object-fit: contain;"
        />
        <div class="text-h6 d-flex align-center text-no-wrap">
          <span class="font-weight-bold">Zalo</span><span style="color: #3B82F6;">CRM</span>
        </div>
      </div>

      <v-spacer />


      <!-- Status indicator -->
      <div
        class="d-flex align-center mr-4 px-3 py-1 rounded-pill"
        style="background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.2);"
      >
        <span class="status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #4CAF50; display: inline-block; margin-right: 8px;"></span>
        <span class="text-caption font-weight-bold" style="color: #4CAF50; letter-spacing: 1px;">ONLINE</span>
      </div>

      <span class="text-body-2 mr-3" v-if="authStore.user">{{ authStore.user.fullName }}</span>
      <NotificationBell />
      <v-btn icon variant="text" @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon variant="text" @click="logout">
        <v-icon>mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar navigation -->
    <v-navigation-drawer v-model="drawer" :rail="rail" permanent @click="rail = false" :color="isDark ? undefined : 'white'">
      <v-list density="compact" nav class="mt-2">
        <v-list-item
          v-for="item in filteredMenuItems"
          :key="item.path"
          :to="item.path"
          :prepend-icon="item.icon"
          :title="item.title"
          :value="item.path"
          rounded="xl"
          class="mb-1 mx-2"
        />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-chevron-left"
            title="Thu gọn"
            @click.stop="rail = !rail"
            rounded="xl"
            class="mx-2"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>

    <!-- Global Snackbar for notifications -->
    <v-snackbar
      v-model="toast.visible"
      :color="toast.color"
      :timeout="toast.timeout"
      location="top right"
    >
      <div class="d-flex align-center">
        <v-icon class="mr-2">{{ toast.icon }}</v-icon>
        <div>
          <div class="font-weight-bold">{{ toast.title }}</div>
          <div class="text-caption">{{ toast.message }}</div>
        </div>
      </div>
      <template #actions>
        <v-btn variant="text" @click="toast.visible = false">Đóng</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useSocketStore } from '@/stores/socket';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';

const theme = useTheme();
const authStore = useAuthStore();
const socketStore = useSocketStore();
const router = useRouter();

const drawer = ref(true);
const rail = ref(false);
const isDark = ref(localStorage.getItem('theme') !== 'light');

const toast = ref({
  visible: false,
  title: '',
  message: '',
  color: 'info',
  icon: 'mdi-information',
  timeout: 5000
});

function showToast(title: string, message: string, color = 'info', icon = 'mdi-information') {
  toast.value = { visible: true, title, message, color, icon, timeout: 5000 };
}

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  
  // Connect socket on app mount
  socketStore.connect();

  // Listen for global toast events (e.g. from Socket)
  window.addEventListener('app:toast', (e: any) => {
    const { title, message, color, icon } = e.detail;
    showToast(title, message, color, icon);
  });

  // Listen for friend events via Socket globally
  if (socketStore.socket) {
    socketStore.socket.on('zalo:friend-event', (data: any) => {
      console.log('[GlobalSocket] Received zalo:friend-event:', data);
      
      // Dispatch a DOM event so other components (like FriendManager) can react
      window.dispatchEvent(new CustomEvent('zalo:friend-event', { detail: data }));

      if (data.isSelf) return;

      // Show toast notification
      if (data.type === 2 || String(data.type) === '2') {
        showToast(
          'Lời mời kết bạn mới',
          `Bạn có lời mời mới từ Zalo UID: ${data.fromUid || 'khách hàng'}`,
          'primary',
          'mdi-account-plus'
        );
      } else if (data.type === 0 || String(data.type) === '0') {
        showToast(
          'Đã kết bạn',
          `Khách hàng đã chấp nhận lời mời hoặc đã trở thành bạn bè`,
          'success',
          'mdi-account-check'
        );
      }
    });
  }
});

const menuItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/', roles: ['all'] },
  { title: 'Tin nhắn', icon: 'mdi-message-text-outline', path: '/chat', roles: ['all'] },
  { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts', roles: ['all'] },
  { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts', roles: ['all'] },
  { title: 'Bạn bè Zalo', icon: 'mdi-account-multiple-plus-outline', path: '/zalo-friends', roles: ['all'] },
  { title: 'Nhóm Zalo', icon: 'mdi-account-group-outline', path: '/zalo-groups', roles: ['all'] },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments', roles: ['all'] },
  { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports', roles: ['all'] },
  { title: 'Phân tích', icon: 'mdi-chart-timeline-variant-shimmer', path: '/analytics', roles: ['all'] },
  { title: 'Đội nhóm & Nhân sự', icon: 'mdi-account-group-outline', path: '/teams', roles: ['owner', 'admin', 'leader', 'manager'] },
  { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings', roles: ['admin', 'owner', 'manager'] },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings', roles: ['admin', 'owner'] },
  { title: 'Tích hợp', icon: 'mdi-connection', path: '/integrations', roles: ['admin', 'owner'] },
  { title: 'Automation', icon: 'mdi-robot-outline', path: '/automation', roles: ['admin', 'owner'] },
];

const filteredMenuItems = computed(() => {
  return menuItems.filter(item => {
    if (item.roles.includes('all')) return true;
    const userRole = authStore.user?.role || '';
    return item.roles.includes(userRole);
  });
});

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.border-bottom {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08) !important;
}
.liquid-bg {
  background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
}
</style>
