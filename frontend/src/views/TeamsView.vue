<template>
  <v-container fluid>
    <div class="d-flex align-center mb-6">
      <h1 class="text-h4">
        <v-icon class="mr-2" style="color: #00F2FF;">mdi-account-group-outline</v-icon>
        Quản lý Đội nhóm
      </h1>
    </div>

    <v-card variant="flat" class="pa-4 border">
      <TeamManagement />
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import TeamManagement from '@/components/settings/TeamManagement.vue';
</script>

<style scoped>
.border {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
</style>
