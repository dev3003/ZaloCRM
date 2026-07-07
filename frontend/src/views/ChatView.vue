<template>
  <MobileChatView v-if="isMobile" />
  <div v-else class="chat-container d-flex flex-column" style="height: calc(100vh - 64px);">
    <!-- Thông báo trạng thái ERP open-chat (loading / friend_requested / zalo_not_found / error) -->
    <v-progress-linear v-if="erpChatLoading" indeterminate color="primary" />
    <v-alert
      v-if="!erpChatLoading && erpChatMessage"
      :type="erpChatStatus === 'error' ? 'error' : erpChatStatus === 'zalo_not_found' ? 'warning' : 'success'"
      density="compact"
      closable
      class="mx-3 mt-2"
      @click:close="erpChatMessage = ''"
    >
      {{ erpChatMessage }}
    </v-alert>

    <div class="d-flex" style="flex: 1; overflow: hidden;">
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
        @filter-tag="onFilterTag"
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
      @send-reaction="(msgId, icon) => sendReaction(selectedConvId!, msgId, icon)"
      @ask-ai="generateAiSuggestion"
      @toggle-contact-panel="showContactPanel = !showContactPanel"
      @mark-unread="fetchConversations"
      @select-member="handleSelectMember"
      @send-attachment="sendAttachment"
      @load-more="handleLoadMore"
      :show-contact-panel="showContactPanel"
      style="flex: 1; min-width: 300px;"
    />

    <!-- Contact panel — resizable, only for 1-on-1 chats -->
    <div v-if="showContactPanel && selectedConv && selectedConv.threadType !== 'group'" class="chat-panel-right" :style="{ width: rightWidth + 'px' }">
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';
import MobileChatView from '@/views/MobileChatView.vue';
import { useMobile } from '@/composables/use-mobile';
import { api } from '@/api/index';

const { isMobile } = useMobile();
const route = useRoute();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter, tagFilter,
  aiSuggestion, aiSuggestionLoading, aiSuggestionError,
  aiSummary, aiSummaryLoading, aiSentiment, aiSentimentLoading,
  unreadOnly, totalUnreadThreads,
  fetchConversations, fetchAiConfig, selectConversation, selectConversationByZaloUid, sendMessage,
  sendAttachment, loadMoreMessages,
  generateAiSuggestion, generateAiSummary, generateAiSentiment,
  initSocket, destroySocket, sendReaction
} = useChat();

function handleLoadMore() {
  if (selectedConvId.value) {
    loadMoreMessages(selectedConvId.value);
  }
}

async function handleSelectMember(member: any) {
  if (!selectedConv.value?.zaloAccountId) return;
  const uid = member.uid || member.userId || member.id;
  await selectConversationByZaloUid(uid, selectedConv.value.zaloAccountId);
}

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

function onFilterTag(tag: string | null) {
  tagFilter.value = tag;
  fetchConversations();
}

const showContactPanel = ref(true);

// ── ERP Open-Chat: xử lý redirect từ ERP Admin ───────────────────────────────
const erpChatLoading = ref(false);
const erpChatMessage = ref('');
const erpChatStatus = ref<'idle' | 'loading' | 'found' | 'friend_requested' | 'zalo_not_found' | 'error'>('idle');

async function handleErpOpenChat(cid: string, phone: string, sid: string) {
  erpChatLoading.value = true;
  erpChatStatus.value = 'loading';
  erpChatMessage.value = 'Đang tìm kiếm khách hàng trên hệ thống...';

  try {
    const res = await api.post('/erp/open-chat', {
      cid,
      phone_encrypted: phone,
      sid
    });

    const data = res.data;

    if (data.status === 'found' && data.conversationId) {
      // Đã có cuộc chat → mở ngay
      erpChatStatus.value = 'found';
      erpChatMessage.value = '';
      await fetchConversations();
      await selectConversation(data.conversationId);
    } else if (data.status === 'friend_requested') {
      // Đã gửi kết bạn → tải lại danh sách, tìm contact
      erpChatStatus.value = 'friend_requested';
      erpChatMessage.value = '✅ Đã gửi lời mời kết bạn Zalo. Cuộc chat sẽ xuất hiện khi khách chấp nhận.';
      await fetchConversations();
    } else if (data.status === 'zalo_not_found') {
      erpChatStatus.value = 'zalo_not_found';
      erpChatMessage.value = `⚠️ ${data.message || 'Số điện thoại chưa đăng ký Zalo'}`;
    }
  } catch (err: any) {
    console.error('ERP Open Chat Error:', err);
    erpChatStatus.value = 'error';
    erpChatMessage.value = err.response?.data?.error || 'Lỗi kết nối đến máy chủ API. Vui lòng thử lại.';
  } finally {
    erpChatLoading.value = false;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

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

onMounted(async () => {
  if (!isMobile.value) {
    await fetchConversations();
    fetchAiConfig();
    initSocket();

    // Kiểm tra query params từ ERP Admin (luồng click icon Zalo)
    const cid = route.query.cid as string;
    const phone = route.query.phone as string;
    const sid = route.query.sid as string;
    if (cid && phone) {
      await handleErpOpenChat(cid, phone, sid || '');
    } else {
      // Đọc query `c` từ deep link CRM
      const convId = route.query.c as string;
      if (convId) {
        try {
          // Check if it exists in the fetched list
          const exists = conversations.value.find(c => c.id === convId);
          if (!exists) {
            // Push an empty placeholder so selectConversation doesn't fail locally
            conversations.value.push({ id: convId } as any);
          }
          await selectConversation(convId);
        } catch (err: any) {
          erpChatStatus.value = 'error';
          erpChatMessage.value = err.response?.data?.error || 'Bạn không có quyền xem cuộc trò chuyện này';
        }
      }
    }
  }
});

onUnmounted(() => {
  if (!isMobile.value) { destroySocket(); }
});

// Đồng bộ URL khi chọn hội thoại
import { useRouter } from 'vue-router';
const router = useRouter();

watch(selectedConvId, (newId) => {
  if (newId && route.query.c !== newId) {
    router.replace({ query: { ...route.query, c: newId } });
  }
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
