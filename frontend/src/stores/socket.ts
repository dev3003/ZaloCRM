import { defineStore } from 'pinia';
import { ref } from 'vue';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from './auth';

export const useSocketStore = defineStore('socket', () => {
  const socket = ref<Socket | null>(null);
  const authStore = useAuthStore();

  function connect() {
    if (socket.value?.connected) return;

    const apiUrl = import.meta.env.VITE_API_URL || '';
    socket.value = io(apiUrl, {
      transports: ['websocket', 'polling'],
      auth: {
        token: authStore.token
      }
    });

    socket.value.on('connect', () => {
      console.log('[Socket] Connected to server');
    });

    socket.value.on('disconnect', () => {
      console.log('[Socket] Disconnected from server');
    });

    socket.value.on('force-logout', (data: { reason?: string }) => {
      alert(data.reason || 'Tài khoản của bạn đã được đăng nhập từ một thiết bị khác.');
      authStore.logout();
      window.location.href = '/login';
    });
  }

  function disconnect() {
    if (socket.value) {
      socket.value.disconnect();
      socket.value = null;
    }
  }

  return {
    socket,
    connect,
    disconnect
  };
});
