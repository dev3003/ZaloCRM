<template>
  <v-app :class="{ 'liquid-bg': isDark }">
    <!-- Sidebar navigation -->
    <v-navigation-drawer v-model="drawer" :rail="rail" permanent @click="rail = false" :color="isDark ? undefined : 'white'">
      
      <!-- Top Bar: Logo + Controls -->
      <div class="pa-2 d-flex" :class="rail ? 'flex-column align-center gap-2' : 'align-center justify-space-between w-100'" style="min-height: 64px;">
        <!-- Logo -->
        <img
          src="/logo.png"
          alt="Omni360 Logo"
          style="height: 36px; width: 36px; object-fit: contain; flex-shrink: 0;"
          class="cursor-pointer"
          @click="rail = !rail"
          title="Thu gọn/Mở rộng menu"
        />

        <!-- User Profile -->
        <v-btn icon variant="text" size="small" v-if="authStore.user">
          <v-icon size="24">mdi-account-circle-outline</v-icon>
          <v-tooltip activator="parent" :location="rail ? 'right' : 'bottom'" color="grey-darken-4">
            <span class="text-white font-weight-medium">{{ authStore.user.fullName }}</span>
          </v-tooltip>
        </v-btn>

        <NotificationBell />
        
        <!-- Theme Toggle -->
        <v-btn icon size="small" variant="text" @click.stop="toggleTheme">
          <v-icon size="20">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
        </v-btn>
        
        <!-- Logout -->
        <v-btn icon size="small" variant="text" @click.stop="logout" color="error">
          <v-icon size="20">mdi-logout</v-icon>
        </v-btn>
      </div>
      <v-divider></v-divider>

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
        <v-divider></v-divider>
        <v-list density="compact" nav>
          <v-list-item
            :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
            :title="rail ? '' : 'Thu gọn'"
            @click.stop="rail = !rail"
            rounded="xl"
            class="mx-2"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid :class="{ 'pa-0': $route.path === '/chat' || $route.path.startsWith('/chat/') }" style="height: 100%;">
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
  { title: 'Cấu hình & cài đặt', icon: 'mdi-account-cog-outline', path: '/settings', roles: ['admin', 'owner', 'manager'] },
  { title: 'Máy chủ Agent', icon: 'mdi-server-network', path: '/desktop-agent', roles: ['owner'] },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings', roles: ['admin', 'owner'] },
  { title: 'Tích hợp', icon: 'mdi-connection', path: '/integrations', roles: ['admin', 'owner'] },
  { title: 'Chiến dịch Zalo', icon: 'mdi-bullhorn-outline', path: '/campaigns', roles: ['admin', 'owner'] },
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
