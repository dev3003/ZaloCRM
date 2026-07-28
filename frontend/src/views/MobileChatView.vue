<template>
  <div class="mobile-chat" style="height: 100%;">
    <!-- Conversation list (shown when no conversation selected) -->
    <div v-if="!selectedConvId" style="height: 100%;">
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
    </div>

    <!-- Message thread (shown when conversation selected) -->
    <div v-else style="height: 100%; display: flex; flex-direction: column;">
      <!-- Back button bar -->
      <div class="d-flex align-center pa-2" style="flex-shrink: 0;">
        <v-btn icon variant="text" size="small" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
        <span v-if="selectedConv" class="text-body-2 font-weight-medium ml-1">
          {{ selectedConv.contact?.fullName || 'Chat' }}
        </span>
      </div>

      <MessageThread
        :conversation="selectedConv"
        :messages="allMessages"
        :loading="loadingMsgs"
        :sending="sendingMsg"
        :show-contact-panel="showContactPanel"
        :ai-suggestion="(null as any)"
        :ai-suggestion-loading="false"
        :ai-suggestion-error="(null as any)"
        @send="handleSend"
        @send-attachment="sendAttachment"
        @send-reaction="(msgId, icon) => sendReaction(selectedConvId!, msgId, icon)"
        @toggle-contact-panel="showContactPanel = true"
        style="flex: 1; min-height: 0;"
      />
    </div>

    <!-- Contact Panel Dialog for Mobile -->
    <v-dialog v-model="showContactPanel" fullscreen transition="dialog-bottom-transition">
      <v-card class="d-flex flex-column bg-surface" style="height: 100vh;">
        <div class="flex-grow-1 overflow-y-auto pa-0">
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
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';
import { useOfflineQueue } from '@/composables/use-offline-queue';

const showContactPanel = ref(false);

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter, tagFilter,
  unreadOnly, totalUnreadThreads,
  aiSummary, aiSummaryLoading, aiSentiment, aiSentimentLoading,
  fetchConversations, selectConversation, sendMessage, sendMessageTo,
  sendAttachment, sendReaction,
  generateAiSummary, generateAiSentiment,
  initSocket, destroySocket,
} = useChat();

const { pendingMessages, enqueue, flush } = useOfflineQueue();

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

function onFilterTag(tag: string | null) {
  tagFilter.value = tag;
  fetchConversations();
}

function goBack() {
  selectedConvId.value = null;
}

// Merge real messages with pending offline messages
const allMessages = computed(() => {
  const pending = pendingMessages.value
    .filter(p => p.conversationId === selectedConvId.value)
    .map(p => ({
      id: p.id,
      content: p.content,
      contentType: 'text',
      senderType: 'self',
      senderName: null,
      sentAt: p.createdAt,
      isDeleted: false,
      zaloMsgId: null,
      _pending: true,
      isUnread: false,
    }));
  return [...messages.value, ...pending];
});

async function handleSend(content: string, contentType: string = 'text', fileHash: string | undefined, mentions?: any[], quote?: any) {
  if (!selectedConvId.value) return;
  if (!navigator.onLine) {
    enqueue(selectedConvId.value, content); // Mentions/Quotes might be lost if offline, but text goes through
    return;
  }
  await sendMessage(content, contentType, fileHash, mentions, quote);
}

// Flush queue when coming back online
function onOnline() {
  flush(sendMessageTo);
}

onMounted(() => {
  fetchConversations();
  initSocket();
  window.addEventListener('online', onOnline);
});

onUnmounted(() => {
  destroySocket();
  window.removeEventListener('online', onOnline);
  clearTimeout(searchTimeout);
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
    selectedConv.value.contact = updatedContact;
    selectedConv.value.contactId = updatedContact.id;
    
    const idx = conversations.value.findIndex(c => c.id === selectedConv.value?.id);
    if (idx !== -1) {
      conversations.value[idx].contact = updatedContact;
      conversations.value[idx].contactId = updatedContact.id;
    }
  }
}
</script>
