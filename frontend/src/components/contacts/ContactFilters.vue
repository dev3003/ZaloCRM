<template>
  <v-row dense class="mb-2 align-center">
    <!-- Search -->
    <v-col cols="12" sm="4">
      <v-text-field
        v-model="filters.search"
        prepend-inner-icon="mdi-magnify"
        label="Tìm kiếm tên / SĐT / email"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Zalo Account filter -->
    <v-col cols="12" sm="4">
      <v-select
        v-model="filters.zaloAccountId"
        :items="zaloAccounts"
        item-title="displayName"
        item-value="id"
        label="Tài khoản Zalo"
        clearable
        hide-details
        prepend-inner-icon="mdi-account-star"
        @update:model-value="emit('search')"
      >
        <template #item="{ props, item }">
          <v-list-item v-bind="props">
            <template #append>
              <v-icon size="12" :color="((item as any).raw?.status || (item as any).status) === 'connected' ? '#00E676' : '#FF5252'" icon="mdi-circle" style="opacity: 1 !important; filter: drop-shadow(0px 0px 2px rgba(0,0,0,0.2));" />
            </template>
          </v-list-item>
        </template>
        <template #selection="{ item }">
          <div class="d-flex align-center justify-space-between w-100 pr-2">
            <span class="text-truncate">{{ (item as any).title || (item as any).displayName }}</span>
            <v-icon size="12" :color="((item as any).raw?.status || (item as any).status) === 'connected' ? '#00E676' : '#FF5252'" icon="mdi-circle" style="opacity: 1 !important; filter: drop-shadow(0px 0px 2px rgba(0,0,0,0.2));" />
          </div>
        </template>
      </v-select>
    </v-col>

    <!-- Source filter -->
    <v-col cols="6" sm="4">
      <v-select
        v-model="filters.source"
        :items="sourceOptions"
        item-title="text"
        item-value="value"
        label="Nguồn"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Status filter -->
    <v-col cols="6" sm="4">
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        item-title="text"
        item-value="value"
        label="Trạng thái"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ContactFilters } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';
import { api } from '@/api/index';

defineProps<{ filters: ContactFilters }>();
const emit = defineEmits<{ search: [] }>();

const sourceOptions = SOURCE_OPTIONS;
const statusOptions = STATUS_OPTIONS;

const zaloAccounts = ref<any[]>([]);

async function fetchZaloAccounts() {
  try {
    const res = await api.get('/zalo-accounts');
    zaloAccounts.value = res.data;
  } catch (err) {
    console.error('Failed to fetch zalo accounts for filter:', err);
  }
}

onMounted(() => {
  fetchZaloAccounts();
});
</script>
