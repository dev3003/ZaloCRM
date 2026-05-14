<template>
  <MobileChatView v-if="isMobile" />
  <div v-else class="chat-container d-flex" style="height: calc(100vh - 64px);">
    <!-- Conversation list — resizable -->
    <div class="chat-panel-left" :style="{ width: leftWidth + 'px' }">
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        v-model:search="searchQuery"
        v-model:unread-only="unreadOnly"
        :unread-count="totalUnreadThreads"
        @select="selectConversation"
        @filter-account="onFilterAccount"
      />
      <!-- Resize handle -->
      <div class="resize-handle" @mousedown="startResize('left', $event)" />
    </div>

    <!-- Message thread — flexible center -->
    <MessageThread
      :conversation="selectedConv"
      :messages="messages"
      :loading="loadingMsgs"
      :sending="sendingMsg"
      :ai-suggestion="aiSuggestion"
      :ai-suggestion-loading="aiSuggestionLoading"
      :ai-suggestion-error="aiSuggestionError"
      @send="sendMessage"
      @ask-ai="generateAiSuggestion"
      @toggle-contact-panel="showContactPanel = !showContactPanel"
      @mark-unread="fetchConversations"
      @select-member="handleSelectMember"
      @send-attachment="sendAttachment"
      :show-contact-panel="showContactPanel"
      style="flex: 1; min-width: 300px;"
    />

    <!-- Contact panel — resizable -->
    <div v-if="showContactPanel && selectedConv" class="chat-panel-right" :style="{ width: rightWidth + 'px' }">
      <div class="resize-handle resize-handle-left" @mousedown="startResize('right', $event)" />
      <ChatContactPanel
        :contact-id="selectedConv?.contactId || null"
        :contact="selectedConv?.contact || null"
        :account-id="selectedConv?.zaloAccountId"
        :ai-summary="aiSummary"
        :ai-summary-loading="aiSummaryLoading"
        :ai-sentiment="aiSentiment"
        :ai-sentiment-loading="aiSentimentLoading"
        @refresh-ai-summary="generateAiSummary"
        @refresh-ai-sentiment="generateAiSentiment"
        @close="showContactPanel = false"
        @saved="onContactSaved"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';
import MobileChatView from '@/views/MobileChatView.vue';
import { useMobile } from '@/composables/use-mobile';

const { isMobile } = useMobile();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter,
  aiSuggestion, aiSuggestionLoading, aiSuggestionError,
  aiSummary, aiSummaryLoading, aiSentiment, aiSentimentLoading,
  unreadOnly, totalUnreadThreads,
  fetchConversations, fetchAiConfig, selectConversation, selectConversationByZaloUid, sendMessage,
  sendAttachment,
  generateAiSuggestion, generateAiSummary, generateAiSentiment,
  initSocket, destroySocket,
} = useChat();

async function handleSelectMember(member: any) {
  if (!selectedConv.value?.zaloAccountId) return;
  const uid = member.uid || member.userId || member.id;
  await selectConversationByZaloUid(uid, selectedConv.value.zaloAccountId);
}

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

const showContactPanel = ref(true);

// Resizable panel widths (restored from localStorage)
const leftWidth = ref(parseInt(localStorage.getItem('chat-left-width') || '320'));
const rightWidth = ref(parseInt(localStorage.getItem('chat-right-width') || '320'));

let resizing: 'left' | 'right' | null = null;
let startX = 0;
let startWidth = 0;

function startResize(panel: 'left' | 'right', e: MouseEvent) {
  resizing = panel;
  startX = e.clientX;
  startWidth = panel === 'left' ? leftWidth.value : rightWidth.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onResize(e: MouseEvent) {
  if (!resizing) return;
  const diff = e.clientX - startX;
  if (resizing === 'left') {
    leftWidth.value = Math.max(200, Math.min(500, startWidth + diff));
  } else {
    rightWidth.value = Math.max(250, Math.min(500, startWidth - diff));
  }
}

function stopResize() {
  if (resizing) {
    localStorage.setItem('chat-left-width', String(leftWidth.value));
    localStorage.setItem('chat-right-width', String(rightWidth.value));
  }
  resizing = null;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onMounted(() => {
  if (!isMobile.value) { fetchConversations(); fetchAiConfig(); initSocket(); }
});
onUnmounted(() => {
  if (!isMobile.value) { destroySocket(); }
});

let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});

watch(unreadOnly, () => {
  fetchConversations();
});

function onContactSaved(updatedContact: any) {
  if (selectedConv.value) {
    // Cập nhật thông tin khách hàng ngay lập tức mà không cần load lại trang
    selectedConv.value.contact = updatedContact;
    selectedConv.value.contactId = updatedContact.id;
    
    // Cập nhật vào danh sách hội thoại bên trái để đồng bộ tên/ảnh nếu có thay đổi
    const idx = conversations.value.findIndex(c => c.id === selectedConv.value?.id);
    if (idx !== -1) {
      conversations.value[idx].contact = updatedContact;
      conversations.value[idx].contactId = updatedContact.id;
    }
  }
}
</script>

<style scoped>
.chat-container {
  height: calc(100vh - 64px);
  width: 100%;
  overflow: hidden;
  position: relative;
}

.chat-panel-left {
  position: relative;
  flex-shrink: 0;
  min-width: 200px;
  max-width: 500px;
}

.chat-panel-right {
  position: relative;
  flex-shrink: 0;
  min-width: 250px;
  max-width: 500px;
}

/* Resize handle — thin vertical line on the edge */
.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.2s;
}

.resize-handle:hover,
.resize-handle:active {
  background: rgba(0, 242, 255, 0.3);
}

.resize-handle-left {
  right: auto;
  left: -2px;
}
</style>
