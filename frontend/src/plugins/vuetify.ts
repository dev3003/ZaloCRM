import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'light',
    themes: {
      dark: {
        dark: true,
        colors: {
          background: '#0F172A',
          surface: '#1E293B',
          'surface-variant': '#334155',
          'surface-light': '#1e293b',
          primary: '#3B82F6',
          secondary: '#E0F2FE',
          accent: '#38BDF8',
          error: '#F87171',
          warning: '#FB923C',
          success: '#34D399',
          info: '#3B82F6',
          'on-background': '#F8FAFC',
          'on-surface': '#F8FAFC',
          'on-primary': '#FFFFFF',
        },
      },
      light: {
        dark: false,
        colors: {
          background: '#F0F2F5',
          surface: '#FFFFFF',
          'surface-variant': '#E4E6EB',
          primary: '#0068FF', // Zalo Blue
          secondary: '#E7F3FF',
          accent: '#00B4D8',
          error: '#EF4B4C',
          warning: '#FF9500',
          success: '#4CD964',
          info: '#007AFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'xl' },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VSelect: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VAutocomplete: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VTextarea: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VCard: { rounded: 'xl', variant: 'flat' },
    VChip: { rounded: 'lg', size: 'small' },
    VDialog: { maxWidth: 600 },
  },
});
