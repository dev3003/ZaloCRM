import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { useSocketStore } from '@/stores/socket';
import type { Contact } from '@/composables/use-contacts';

interface ZaloAccount {
  id: string;
  displayName: string | null;
  zaloUid?: string | null;
}

export interface AiSentiment {
  label: 'positive' | 'neutral' | 'negative';
  confidence: number;
  reason: string;
}

export interface AiConfig {
  provider: string;
  model: string;
  maxDaily: number;
  enabled: boolean;
  hasAnthropicKey?: boolean;
  hasGeminiKey?: boolean;
}

interface ConversationMessage {
  content: string | null;
  contentType: string;
  senderType: string;
  sentAt: string;
  isDeleted: boolean;
}

export interface Conversation {
  id: string;
  zaloAccountId: string;
  contactId: string | null;
  threadType: 'user' | 'group';
  contact: Contact | null;
  zaloAccount: ZaloAccount | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  messages?: ConversationMessage[];
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
  senderUid?: string | null;
  isUnread: boolean;
  fileStatus?: string;
  quote?: any;
  reaction?: string | null;
  tempUrl?: string;
  tempFile?: File;
  isUploading?: boolean;
}

export function useChat() {
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const hasMoreMessages = ref(true);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const loadingMoreMsgs = ref(false);
  const sendingMsg = ref(false);
  const searchQuery = ref('');
  const accountFilter = ref<string | null>(null);
  const tagFilter = ref<string | null>(null);
  const unreadOnly = ref(false);
  const totalUnreadThreads = ref(0);

  const socketStore = useSocketStore();

  const aiSuggestion = ref('');
  const aiSuggestionLoading = ref(false);
  const aiSuggestionError = ref('');
  const aiSummary = ref('');
  const aiSummaryLoading = ref(false);
  const aiSentiment = ref<AiSentiment | null>(null);
  const aiSentimentLoading = ref(false);
  const aiUsage = ref({ usedToday: 0, maxDaily: 500, remaining: 500, enabled: true });
  const aiConfig = ref<AiConfig>({ provider: 'anthropic', model: 'claude-sonnet-4-6', maxDaily: 500, enabled: true });

  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value) || null,
  );

  function clearAiState() {
    aiSuggestion.value = '';
    aiSuggestionError.value = '';
    aiSummary.value = '';
    aiSentiment.value = null;
  }

  async function fetchConversations() {
    loadingConvs.value = true;
    try {
      const res = await api.get('/conversations', {
        params: { 
          limit: 100, 
          search: searchQuery.value, 
          accountId: accountFilter.value || undefined,
          tag: tagFilter.value || undefined,
          unreadOnly: unreadOnly.value ? 'true' : 'false'
        },
      });
      conversations.value = res.data.conversations;
      totalUnreadThreads.value = res.data.totalUnreadThreads || 0;
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      loadingConvs.value = false;
    }
  }

  async function fetchMessages(convId: string) {
    loadingMsgs.value = true;
    hasMoreMessages.value = true;
    try {
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit: 50 },
      });
      messages.value = res.data.messages;
      hasMoreMessages.value = res.data.messages.length >= 50;
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      throw err;
    } finally {
      loadingMsgs.value = false;
    }
  }

  async function loadMoreMessages(convId: string) {
    if (!hasMoreMessages.value || loadingMoreMsgs.value || messages.value.length === 0) return;
    
    loadingMoreMsgs.value = true;
    try {
      const oldestMessage = messages.value[0]; // messages are usually sorted oldest to newest in the UI
      const cursor = oldestMessage.id;
      
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit: 50, cursor },
      });
      
      const olderMessages = res.data.messages;
      if (olderMessages.length > 0) {
        // Prepend older messages
        messages.value = [...olderMessages, ...messages.value];
      }
      hasMoreMessages.value = olderMessages.length >= 50;
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      loadingMoreMsgs.value = false;
    }
  }

  async function fetchAiConfig() {
    try {
      const res = await api.get('/ai/config');
      aiConfig.value = {
        provider: res.data.provider,
        model: res.data.model,
        maxDaily: res.data.maxDaily,
        enabled: res.data.enabled,
        hasAnthropicKey: res.data.hasAnthropicKey,
        hasGeminiKey: res.data.hasGeminiKey,
      };
    } catch (err) {
      console.error('Failed to fetch AI config:', err);
    }
  }

  async function saveAiConfig(payload: AiConfig) {
    const res = await api.put('/ai/config', payload);
    aiConfig.value = {
      provider: res.data.provider,
      model: res.data.model,
      maxDaily: res.data.maxDaily,
      enabled: res.data.enabled,
      hasAnthropicKey: aiConfig.value.hasAnthropicKey,
      hasGeminiKey: aiConfig.value.hasGeminiKey,
    };
  }

  async function fetchAiUsage() {
    try {
      const res = await api.get('/ai/usage');
      aiUsage.value = res.data;
    } catch (err) {
      console.error('Failed to fetch AI usage:', err);
    }
  }

  async function generateAiSuggestion() {
    if (!selectedConvId.value) return;
    aiSuggestionLoading.value = true;
    aiSuggestionError.value = '';
    try {
      const res = await api.post('/ai/suggest', { conversationId: selectedConvId.value });
      aiSuggestion.value = res.data.content || '';
      await fetchAiUsage();
    } catch (err: any) {
      aiSuggestionError.value = err.response?.data?.error || 'Không thể tạo gợi ý AI';
    } finally {
      aiSuggestionLoading.value = false;
    }
  }

  async function generateAiSummary() {
    if (!selectedConvId.value) return;
    aiSummaryLoading.value = true;
    try {
      const res = await api.post(`/ai/summarize/${selectedConvId.value}`);
      aiSummary.value = res.data.content || '';
      await fetchAiUsage();
    } catch (err) {
      console.error('Failed to summarize conversation:', err);
    } finally {
      aiSummaryLoading.value = false;
    }
  }

  async function generateAiSentiment() {
    if (!selectedConvId.value) return;
    aiSentimentLoading.value = true;
    try {
      const res = await api.post(`/ai/sentiment/${selectedConvId.value}`);
      aiSentiment.value = res.data;
      await fetchAiUsage();
    } catch (err) {
      console.error('Failed to analyze sentiment:', err);
    } finally {
      aiSentimentLoading.value = false;
    }
  }

  async function selectConversation(convId: string) {
    if (selectedConvId.value === convId) return;
    clearAiState();
    selectedConvId.value = convId;
    messages.value = [];
    try {
      await fetchMessages(convId);
    } catch (err) {
      throw err;
    }

    try {
      const convDetail = await api.get(`/conversations/${convId}`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv && convDetail.data.contact) {
        conv.contact = convDetail.data.contact;
      }
    } catch {
      // Non-critical
    }
    try {
      const conv = conversations.value.find(c => c.id === convId);
      const wasUnread = conv && conv.unreadCount > 0;

      await api.post(`/conversations/${convId}/mark-read`);
      
      if (conv) conv.unreadCount = 0;
      if (wasUnread && totalUnreadThreads.value > 0) {
        totalUnreadThreads.value--;
      }
    } catch {
      // Ignore mark-read errors
    }
    await Promise.allSettled([generateAiSummary(), generateAiSentiment(), fetchAiUsage()]);
  }

  async function selectConversationByZaloUid(zaloUid: string, zaloAccountId: string) {
    // 1. Check if already in current list
    let conv = conversations.value.find(c => 
      c.threadType === 'user' && 
      c.contact?.zaloUid === zaloUid && 
      c.zaloAccountId === zaloAccountId
    );

    if (conv) {
      await selectConversation(conv.id);
      return;
    }

    // 2. If not, ensure it exists via API
    try {
      const res = await api.post('/conversations/ensure-direct', { zaloUid, zaloAccountId });
      if (res.data?.id) {
        // Refresh list to show the new conversation
        await fetchConversations();
        await selectConversation(res.data.id);
      }
    } catch (err) {
      console.error('Failed to ensure direct conversation:', err);
    }
  }

  async function sendMessage(content: string, contentType: string = 'text', _fileHash?: string, mentions?: any[], quote?: any, extraPayload?: any) {
    if (!selectedConvId.value || !content.trim()) return;
    await sendMessageTo(selectedConvId.value, content, contentType, mentions, quote, extraPayload);
  }

  async function sendMessageTo(conversationId: string, content: string, contentType: string = 'text', mentions?: any[], quote?: any, extraPayload?: any) {
    if (!content.trim()) return;
    sendingMsg.value = true;
    try {
      const payload: any = { content, contentType };
      if (mentions && mentions.length > 0) {
        payload.mentions = mentions;
      }
      if (quote) {
        payload.quote = quote;
      }
      if (extraPayload) {
        payload.extraPayload = extraPayload;
      }
      const res = await api.post(`/conversations/${conversationId}/messages`, payload);
      if (conversationId === selectedConvId.value) {
        if (!messages.value.find(m => m.id === res.data.id)) {
          messages.value.push(res.data);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  async function sendAttachment(file: File, caption?: string) {
    if (!selectedConvId.value) return;
    sendingMsg.value = true;
    
    const objectUrl = URL.createObjectURL(file);
    const tempId = 'temp-' + Date.now();
    const contentType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'file');
    
    const tempMsg: Message = {
      id: tempId,
      content: caption || '',
      contentType: contentType,
      senderType: 'self',
      senderName: 'Bạn',
      sentAt: new Date().toISOString(),
      isDeleted: false,
      zaloMsgId: null,
      isUnread: false,
      tempUrl: objectUrl,
      tempFile: file,
      isUploading: true
    };
    
    messages.value.push(tempMsg);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (caption) formData.append('caption', caption);

      const res = await api.post(`/conversations/${selectedConvId.value}/attachments`, formData);

      // No need to manually push to messages.value as socket will emit it
      // or we can push a optimistic update if desired
      return res.data;
    } catch (err) {
      console.error('Failed to send attachment:', err);
      throw err;
    } finally {
      URL.revokeObjectURL(objectUrl);
      messages.value = messages.value.filter(m => m.id !== tempId);
      sendingMsg.value = false;
    }
  }

  async function sendReaction(conversationId: string, msgId: string, icon: string) {
    // Optimistic UI update
    const msg = messages.value.find(m => m.id === msgId);
    if (msg) msg.reaction = icon;

    try {
      await api.post(`/conversations/${conversationId}/messages/${msgId}/reaction`, { icon });
    } catch (err) {
      console.error('Failed to send reaction:', err);
      // Revert if failed (optional, let's keep it simple for now)
    }
  }

  async function undoMessage(conversationId: string, msgId: string) {
    // Optimistic UI update
    const msg = messages.value.find(m => m.id === msgId);
    if (msg) msg.isDeleted = true;

    try {
      await api.post(`/conversations/${conversationId}/messages/${msgId}/undo`);
    } catch (err) {
      console.error('Failed to undo message:', err);
      if (msg) msg.isDeleted = false; // revert
      throw err;
    }
  }

  async function markMessageUnread(msgId: string) {
    try {
      const res = await api.post(`/messages/${msgId}/mark-unread`);
      const msg = messages.value.find(m => m.id === msgId);
      if (msg) msg.isUnread = true;
      if (selectedConv.value) {
        // If it was previously read (unreadCount 0), total unread threads increases
        if (selectedConv.value.unreadCount === 0) {
          totalUnreadThreads.value++;
        }
        selectedConv.value.unreadCount = res.data.unreadCount;
      }
    } catch (err) {
      console.error('Failed to mark message unread:', err);
    }
  }

  async function markMessageRead(msgId: string) {
    try {
      const res = await api.post(`/messages/${msgId}/mark-read`);
      const msg = messages.value.find(m => m.id === msgId);
      if (msg) msg.isUnread = false;
      if (selectedConv.value) {
        const oldUnreadCount = selectedConv.value.unreadCount;
        selectedConv.value.unreadCount = res.data.unreadCount;
        // If it becomes read (unreadCount 0) and was unread before, total unread threads decreases
        if (oldUnreadCount > 0 && res.data.unreadCount === 0 && totalUnreadThreads.value > 0) {
          totalUnreadThreads.value--;
        }
      }
    } catch (err) {
      console.error('Failed to mark message read:', err);
    }
  }

  function initSocket() {
    const socket = socketStore.socket;
    if (!socket) {
      socketStore.connect();
      return;
    }

    socket.on('chat:message', (data: { message: Message; conversationId: string }) => {
      if (data.conversationId === selectedConvId.value) {
        const existingIdx = messages.value.findIndex(m => m.id === data.message.id);
        if (existingIdx !== -1) {
          messages.value[existingIdx] = data.message;
        } else {
          messages.value.push(data.message);
        }
      }
      fetchConversations();
    });

    socket.on('chat:deleted', (data: { msgId: string }) => {
      const msg = messages.value.find(m => m.zaloMsgId === data.msgId);
      if (msg) msg.isDeleted = true;
    });

    socket.on('chat:reaction', (data: { msgId: string, icon: string }) => {
      const msg = messages.value.find(m => m.id === data.msgId);
      if (msg) msg.reaction = data.icon;
    });

    socket.on('conversation:updated', () => {
      fetchConversations();
    });

    socket.on('conversation:contact-updated', (data: { zaloUid?: string; fullName?: string }) => {
      fetchConversations();
      if (selectedConv.value?.contact && data.zaloUid && selectedConv.value.contact.zaloUid === data.zaloUid && data.fullName) {
        selectedConv.value.contact.fullName = data.fullName;
      }
    });
  }

  function destroySocket() {
    const socket = socketStore.socket;
    if (socket) {
      socket.off('chat:message');
      socket.off('chat:deleted');
      socket.off('chat:reaction');
      socket.off('conversation:updated');
      socket.off('conversation:contact-updated');
    }
  }

  return {
    conversations,
    selectedConvId,
    selectedConv,
    messages,
    hasMoreMessages,
    loadingConvs,
    loadingMsgs,
    loadingMoreMsgs,
    sendingMsg,
    searchQuery,
    accountFilter,
    tagFilter,
    unreadOnly,
    totalUnreadThreads,
    aiSuggestion,
    aiSuggestionLoading,
    aiSuggestionError,
    aiSummary,
    aiSummaryLoading,
    aiSentiment,
    aiSentimentLoading,
    aiUsage,
    aiConfig,
    fetchConversations,
    fetchMessages,
    loadMoreMessages,
    fetchAiConfig,
    saveAiConfig,
    fetchAiUsage,
    selectConversation,
    selectConversationByZaloUid,
    sendMessage,
    sendMessageTo,
    generateAiSuggestion,
    generateAiSummary,
    generateAiSentiment,
    clearAiState,
    undoMessage,
    markMessageUnread,
    markMessageRead,
    sendAttachment,
    sendReaction,
    initSocket,
    destroySocket,
  };
}
