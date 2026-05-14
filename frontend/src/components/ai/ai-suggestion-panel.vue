<template>
  <v-card variant="flat" class="mb-3 ai-suggestion-card">
    <v-card-title class="d-flex align-center text-body-2 py-2 px-3">
      <v-icon color="primary" class="mr-2" size="small">mdi-robot-outline</v-icon>
      <span class="font-weight-bold color-primary">Gợi ý AI</span>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="primary" :loading="loading" @click="$emit('generate')">Làm mới</v-btn>
    </v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <v-alert v-if="error" type="error" density="compact" variant="tonal" class="mb-2">{{ error }}</v-alert>
      <div v-if="suggestion" class="text-body-2 mb-3 suggestion-text">{{ suggestion }}</div>
      <div v-else class="text-body-2 text-grey mb-3 font-italic">Đang đợi yêu cầu tạo gợi ý...</div>
      <div class="d-flex justify-end">
        <v-btn color="primary" size="small" variant="flat" :disabled="!suggestion" @click="$emit('apply')">Sử dụng gợi ý này</v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
defineProps<{ suggestion: string; loading: boolean; error: string }>();
defineEmits<{ generate: []; apply: [] }>();
</script>
<style scoped>
.ai-suggestion-card {
  background-color: #f0f7ff !important;
  border: 1px solid #cce4ff !important;
}
.suggestion-text {
  white-space: pre-wrap;
  color: #1a1a1a;
  line-height: 1.5;
}
.color-primary {
  color: #0068FF;
}
</style>
