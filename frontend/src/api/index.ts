import axios from 'axios';
import { router } from '@/router/index';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '') + '/api/v1',
  timeout: 30000,
});

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const msg = error.response?.data?.error;
      localStorage.removeItem('token');
      const currentPath = router.currentRoute.value.path;
      if (currentPath !== '/login' && currentPath !== '/setup' && currentPath !== '/super-admin/login') {
        if (msg && typeof msg === 'string' && msg.includes('thiết bị khác')) {
          alert(msg);
        }
        if (currentPath.startsWith('/super-admin')) {
          router.replace('/super-admin/login');
        } else {
          router.replace('/login');
        }
      }
    }
    return Promise.reject(error);
  },
);

export { api };
