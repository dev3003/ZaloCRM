<template>
  <div class="message-thread d-flex flex-column flex-grow-1" style="height: 100%;">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid var(--border-glow, rgba(0,242,255,0.1));">
        <v-avatar size="36" color="grey-lighten-2" class="mr-3">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" />
        </v-avatar>
        <div class="flex-grow-1">
          <div class="d-flex align-center">
            <div class="font-weight-medium">{{ conversation.contact?.fullName || 'Unknown' }}</div>
            <v-chip
              v-if="conversation.threadType === 'group'"
              size="x-small"
              variant="tonal"
              color="primary"
              class="ml-2 cursor-pointer"
              :loading="loadingMembers"
              @click="fetchAndShowMembers"
            >
              {{ groupMemberCount }} thành viên
            </v-chip>
          </div>
          <div class="text-caption text-grey">{{ conversation.zaloAccount?.displayName || 'Zalo' }}</div>
        </div>
        <v-btn size="small" variant="tonal" color="primary" class="mr-2" :loading="aiSuggestionLoading" @click="toggleAiPanel">
          Ask AI
        </v-btn>
        <v-btn
          :icon="showContactPanel ? 'mdi-account-details' : 'mdi-account-details-outline'"
          size="small" variant="text"
          :color="showContactPanel ? 'primary' : undefined"
          @click="$emit('toggle-contact-panel')"
        />
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-3 pr-8 chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <template v-for="(msg, index) in messages" :key="msg.id">
          <!-- Unread Divider -->
          <div v-if="isFirstUnread(msg, index)" class="unread-divider my-4 d-flex align-center" id="first-unread">
            <v-divider color="error" />
            <span class="mx-4 text-caption text-error font-weight-bold" style="white-space: nowrap;">Tin nhắn chưa đọc</span>
            <v-divider color="error" />
          </div>
          <div class="mb-4 d-flex align-end" :class="msg.senderType === 'self' ? 'flex-row-reverse' : 'flex-row'">
            <!-- Avatar -->
            <v-avatar v-if="msg.senderType !== 'self'" size="32" class="mb-1 mx-2" color="grey-lighten-3">
              <v-img :src="getSenderAvatar(msg)" />
            </v-avatar>
            <div v-else class="mx-2" style="width: 32px;"></div>

            <div style="max-width: min(75%, 600px);">
              <!-- Sender Name (Groups) -->
              <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 px-1 font-weight-medium text-grey">
                {{ msg.senderName || 'Người dùng Zalo' }}
              </div>
              
              <div 
                class="message-bubble pa-2 px-3" 
                :class="msg.senderType === 'self' ? 'message-self' : 'message-contact'" 
                style="word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap;"
              >
                <!-- Context Menu -->
                <v-menu activator="parent" context-menu transition="scale-transition">
                  <v-list density="compact" min-width="180">
                    <v-list-item v-if="!msg.isUnread" prepend-icon="mdi-email-mark-as-unread" @click="markAsUnread(msg)" color="primary">
                      <v-list-item-title>Đánh dấu là chưa đọc</v-list-item-title>
                    </v-list-item>
                    <v-list-item v-else prepend-icon="mdi-email-open" @click="markAsRead(msg)" color="success">
                      <v-list-item-title>Đánh dấu là đã đọc</v-list-item-title>
                    </v-list-item>
                    <v-list-item v-if="msg.content && !msg.content.startsWith('{')" prepend-icon="mdi-content-copy" @click="copyToClipboard(msg.content)">
                      <v-list-item-title>Sao chép văn bản</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <!-- Expired -->
                <div v-if="msg.fileStatus === 'expired' && msg.contentType !== 'text'" class="d-flex align-center pa-1 text-grey" style="opacity: 0.8;">
                  <v-icon size="18" class="mr-1">mdi-clock-alert-outline</v-icon>
                  <span class="text-caption font-italic">Dữ liệu đã hết hạn (60 ngày)</span>
                </div>
                <!-- Deleted -->
                <div v-else-if="msg.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
                  {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
                </div>
                <!-- Image -->
                <div v-else-if="getImageUrl(msg)">
                  <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="openImagePreview(getImageUrl(msg)!)" />
                  <div v-if="getMessageCaption(msg)" class="msg-caption mt-1 white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- File/PDF -->
                <div v-else-if="getFileInfo(msg)">
                  <div class="file-card">
                    <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
                    <div class="flex-grow-1">
                      <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                      <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                    </div>
                    <v-btn v-if="getFileInfo(msg)!.href" icon size="x-small" variant="text" @click="openFile(getFileInfo(msg)!.href)">
                      <v-icon size="16">mdi-download</v-icon>
                    </v-btn>
                  </div>
                  <div v-if="getMessageCaption(msg)" class="msg-caption mt-1 white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Sticker -->
                <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
                <!-- Video -->
                <div v-else-if="msg.contentType === 'video'">
                  <div class="video-container position-relative" @click="openVideoPreview(msg)">
                    <img v-if="getVideoThumb(msg)" :src="getVideoThumb(msg)!" class="chat-image" />
                    <div v-else class="chat-file-placeholder d-flex align-center justify-center bg-grey-lighten-3 rounded-lg" style="height: 150px; width: 250px;">
                      <v-icon size="48" color="grey">mdi-video</v-icon>
                    </div>
                    <div class="video-play-overlay">
                      <v-icon size="48" color="white">mdi-play-circle-outline</v-icon>
                    </div>
                    <div v-if="getVideoDuration(msg)" class="video-duration-tag">
                      {{ getVideoDuration(msg) }}
                    </div>
                  </div>
                  <div v-if="getMessageCaption(msg)" class="msg-caption mt-1 white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Voice -->
                <div v-else-if="msg.contentType === 'voice'">🎤 Tin nhắn thoại</div>
                <div v-else-if="msg.contentType === 'gif'">GIF</div>
                <!-- Reminder/Calendar -->
                <div v-else-if="isReminderMessage(msg)" class="reminder-card">
                  <div class="d-flex align-center mb-1">
                    <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
                    <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
                  </div>
                  <div class="text-body-2">{{ getReminderTitle(msg) }}</div>
                  <div v-if="getReminderTime(msg)" class="text-caption mt-1" style="opacity: 0.7;">
                    <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(msg) }}
                  </div>
                  <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="syncAppointment(msg)">
                    Đồng bộ lịch
                  </v-btn>
                </div>
                <!-- Default text -->
                <div v-else v-html="parseDisplayContent(msg.content)"></div>
                <!-- Timestamp -->
                <div class="text-caption mt-1 msg-time" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                  {{ formatMessageTime(msg.sentAt) }}
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Input Area (Zalo Style) -->
      <div class="chat-input-wrapper">
        <AiSuggestionPanel
          v-if="showAiPanel || aiSuggestionLoading"
          :suggestion="aiSuggestion"
          :loading="aiSuggestionLoading"
          :error="aiSuggestionError"
          @generate="$emit('ask-ai')"
          @apply="applySuggestion"
        />

        <!-- 1. Toolbar Row -->
        <div class="d-flex align-center px-2 py-1 chat-toolbar border-bottom">
          <v-btn icon="mdi-emoticon-happy-outline" variant="text" size="x-small" class="toolbar-btn mx-1" />
          <v-btn icon="mdi-image-outline" variant="text" size="x-small" class="toolbar-btn mx-1" @click="triggerFileInput('image')" />
          <v-btn icon="mdi-paperclip" variant="text" size="x-small" class="toolbar-btn mx-1" @click="triggerFileInput('file')" />
          <v-btn icon="mdi-account-card-outline" variant="text" size="x-small" class="toolbar-btn mx-1" />
          <v-btn icon="mdi-crop-free" variant="text" size="x-small" class="toolbar-btn mx-1 d-none d-sm-flex" />
          <v-btn icon="mdi-format-text" variant="text" size="x-small" class="toolbar-btn mx-1 d-none d-sm-flex" />
          <v-btn icon="mdi-lightning-bolt-outline" variant="text" size="x-small" class="toolbar-btn mx-1" />
          <v-btn icon="mdi-credit-card-outline" variant="text" size="x-small" class="toolbar-btn mx-1 d-none d-sm-flex" />
          <v-btn icon="mdi-dots-horizontal" variant="text" size="x-small" class="toolbar-btn mx-1" />
          
          <v-spacer />
          <v-progress-circular v-if="isUploading" indeterminate size="16" width="2" color="primary" class="mr-2" />
        </div>

        <!-- 2. Attachment Preview -->
        <div v-if="attachment" class="pa-2 attachment-preview rounded-lg mx-3 mt-2 d-flex align-center border">
          <v-icon :icon="getAttachmentIcon(attachment.type)" color="primary" class="mr-2" />
          <div class="flex-grow-1 text-truncate">
            <span class="text-caption font-weight-bold attachment-name">{{ attachment.name }}</span>
            <span class="text-caption attachment-size ml-2">{{ (attachment.size / 1024 / 1024).toFixed(2) }} MB</span>
          </div>
          <v-btn icon="mdi-close" size="x-small" variant="text" color="grey" @click="clearAttachment" />
        </div>

        <!-- 3. Textarea Row -->
        <div class="d-flex align-end px-3 py-2">
          <input type="file" ref="fileInput" class="d-none" @change="handleFileChange" />
          <v-textarea
            v-model="inputText"
            :placeholder="`Nhập @, tin nhắn tới ${conversation?.contact?.fullName || 'khách hàng'}`"
            variant="plain"
            density="compact"
            hide-details
            auto-grow
            rows="1"
            max-rows="8"
            rounded="0"
            @keydown.enter.exact.prevent="handleSend"
            class="flex-grow-1 chat-textarea"
            style="color: var(--v-theme-on-surface) !important;"
          />
          <div class="d-flex align-center mb-1">
            <v-btn icon="mdi-emoticon-outline" variant="text" size="small" class="mr-1 toolbar-btn" />
            <v-btn
              v-if="!inputText.trim() && !attachment"
              icon="mdi-thumb-up-outline"
              variant="text"
              size="small"
              class="toolbar-btn"
              color="amber-darken-2"
              @click="sendLike"
            />
            <v-btn
              v-else
              icon="mdi-send"
              variant="text"
              color="primary"
              size="small"
              :loading="sending"
              @click="handleSend"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Image preview dialog with Navigation -->
    <v-dialog v-model="showImagePreview" max-width="1000" content-class="elevation-0">
      <div class="image-preview-container d-flex align-center justify-center">
        <!-- Close button top-right -->
        <v-btn icon="mdi-close" position="absolute" style="top: 10px; right: 10px; z-index: 100;" variant="tonal" color="white" @click="closeImagePreview" />
        
        <!-- Prev Button -->
        <v-btn v-if="allImageUrls.length > 1" icon="mdi-chevron-left" class="nav-btn prev-btn" size="large" variant="text" color="white" @click.stop="prevImage" />
        
        <div class="text-center">
          <img :src="previewImageUrl" alt="Preview" class="preview-img" @click.stop />
          <div class="text-caption mt-2 text-white" style="opacity: 0.8;">
            Ảnh {{ currentImageIndex + 1 }} / {{ allImageUrls.length }}
          </div>
        </div>

        <!-- Next Button -->
        <v-btn v-if="allImageUrls.length > 1" icon="mdi-chevron-right" class="nav-btn next-btn" size="large" variant="text" color="white" @click.stop="nextImage" />
      </div>
    </v-dialog>

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>

    <!-- Group members dialog -->
    <v-dialog v-model="showMembersDialog" max-width="400">
      <v-card>
        <v-card-title class="d-flex align-center pa-4">
          <v-icon class="mr-2">mdi-account-group</v-icon>
          Thành viên nhóm
          <v-spacer />
          <v-btn icon size="small" variant="text" @click="showMembersDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-list class="pa-0" style="max-height: 400px; overflow-y: auto;">
          <v-progress-linear v-if="loadingMembers" indeterminate />
          <v-list-item v-for="m in groupMembers" :key="m.uid" class="cursor-pointer" @click="emit('select-member', m); showMembersDialog = false">
            <template #prepend>
              <v-avatar size="32" class="mr-2">
                <v-img :src="m.avatar || 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png'" />
              </v-avatar>
            </template>
            <v-list-item-title class="text-body-2 font-weight-medium">{{ m.displayName || m.zaloName || m.name || 'Unknown' }}</v-list-item-title>
            <v-list-item-subtitle class="text-caption">UID: {{ m.uid || m.userId || m.id }}</v-list-item-subtitle>
          </v-list-item>
          <v-list-item v-if="!loadingMembers && groupMembers.length === 0" class="text-center py-4">
            <span class="text-caption text-grey">Không thể tải danh sách thành viên</span>
          </v-list-item>
        </v-list>
      </v-card>
    </v-dialog>

    <!-- Video preview dialog -->
    <v-dialog v-model="showVideoPreview" max-width="900">
      <v-card theme="dark" class="rounded-lg">
        <v-card-title class="d-flex align-center pa-4">
          <v-icon class="mr-2">mdi-video</v-icon>
          <span class="text-truncate">{{ previewVideoName }}</span>
          <v-spacer />
          <v-btn icon size="small" variant="text" @click="showVideoPreview = false; previewVideoUrl = ''">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider />
        <div class="pa-0 bg-black d-flex align-center justify-center" style="min-height: 400px;">
          <video v-if="showVideoPreview" :src="previewVideoUrl" controls autoplay class="w-100" style="max-height: 70vh;"></video>
        </div>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="tonal" color="white" prepend-icon="mdi-download" @click="openFile(previewVideoUrl)">
            Tải về
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useChat } from '@/composables/use-chat';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSuggestionPanel from '@/components/ai/ai-suggestion-panel.vue';

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  aiSuggestion: string;
  aiSuggestionLoading: boolean;
  aiSuggestionError: string;
}>();

const showAiPanel = ref(false);

function toggleAiPanel() {
  showAiPanel.value = !showAiPanel.value;
  if (showAiPanel.value && !props.aiSuggestion) {
    emit('ask-ai');
  }
}

const emit = defineEmits<{
  (e: 'toggle-contact-panel'): void
  (e: 'ask-ai'): void
  (e: 'mark-unread'): void
  (e: 'select-member', member: any): void
  (e: 'send', content: string, contentType: string, fileHash: string | undefined): void
  (e: 'send-attachment', file: File, caption: string): void
}>();

const attachment = ref<{ name: string; size: number; file: File; type: 'image' | 'video' | 'file' } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);

function getAttachmentIcon(type: string) {
  if (type === 'image') return 'mdi-image';
  if (type === 'video') return 'mdi-video';
  return 'mdi-file-document';
}

function triggerFileInput(type?: string) {
  if (fileInput.value) {
    if (type === 'image') {
      fileInput.value.accept = 'image/*,video/*';
    } else {
      fileInput.value.accept = '*/*';
    }
    fileInput.value.click();
  }
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;
  
  const file = target.files[0];
  if (file.size > 100 * 1024 * 1024 && file.type.startsWith('image/')) {
    syncSnack.value = { show: true, text: 'Ảnh quá lớn (tối đa 100MB)', color: 'error' };
    return;
  }
  if (file.size > 500 * 1024 * 1024 && file.type.startsWith('video/')) {
    syncSnack.value = { show: true, text: 'Video quá lớn (tối đa 500MB)', color: 'error' };
    return;
  }
  if (file.size > 1024 * 1024 * 1024) {
    syncSnack.value = { show: true, text: 'File quá lớn (tối đa 1GB)', color: 'error' };
    return;
  }

  let type: 'image' | 'video' | 'file' = 'file';
  if (file.type.startsWith('image/')) type = 'image';
  else if (file.type.startsWith('video/')) type = 'video';

  attachment.value = {
    name: file.name,
    size: file.size,
    file: file,
    type: type
  };
  
  target.value = '';
}

function clearAttachment() {
  attachment.value = null;
}

function handleSend() {
  if (attachment.value) {
    emit('send-attachment', attachment.value.file, inputText.value);
  } else {
    if (!inputText.value.trim()) return;
    emit('send', inputText.value, 'text', undefined);
  }
  
  inputText.value = '';
  attachment.value = null;
}

function sendLike() {
  emit('send', '👍', 'text', undefined);
}

const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const { markMessageUnread, markMessageRead } = useChat();
const previewImageUrl = ref('');
const allImageUrls = computed(() => {
  return props.messages
    .map(m => getImageUrl(m))
    .filter(url => !!url) as string[];
});
const currentImageIndex = ref(-1);

const showImagePreview = computed({
  get: () => !!previewImageUrl.value,
  set: (v) => { if (!v) closeImagePreview(); }
});
const syncSnack = ref({ show: false, text: '', color: 'success' });

const groupMembers = ref<any[]>([]);
const groupMemberCount = ref(0);
const loadingMembers = ref(false);
const showMembersDialog = ref(false);

async function fetchAndShowMembers() {
  if (!props.conversation || props.conversation.threadType !== 'group') return;
  
  showMembersDialog.value = true;
  if (groupMembers.value.length > 0) return;

  await fetchGroupMembers();
}


async function fetchGroupMembers() {
  const conv = props.conversation;
  if (!conv || conv.threadType !== 'group' || !conv.zaloAccount?.id || !conv.contact?.zaloUid) return;

  loadingMembers.value = true;
  try {
    const res = await api.get(`/zalo-accounts/${conv.zaloAccount.id}/groups/${conv.contact.zaloUid}/members`);
    groupMembers.value = res.data?.members || [];
    groupMemberCount.value = res.data?.totalCount || groupMembers.value.length;
  } catch (err) {
    console.error('Failed to fetch group members:', err);
    groupMembers.value = [];
    groupMemberCount.value = 0;
  } finally {
    loadingMembers.value = false;
  }
}

watch(() => props.conversation?.id, () => {
  groupMembers.value = [];
  groupMemberCount.value = 0;
  if (props.conversation?.threadType === 'group') {
    fetchGroupMembers();
  }
}, { immediate: true });

function openImagePreview(url: string) {
  previewImageUrl.value = url;
  currentImageIndex.value = allImageUrls.value.indexOf(url);
  window.addEventListener('keydown', handleKeydown);
}

function closeImagePreview() {
  previewImageUrl.value = '';
  currentImageIndex.value = -1;
  window.removeEventListener('keydown', handleKeydown);
}

function nextImage() {
  if (currentImageIndex.value < allImageUrls.value.length - 1) {
    currentImageIndex.value++;
    previewImageUrl.value = allImageUrls.value[currentImageIndex.value];
  }
}

function prevImage() {
  if (currentImageIndex.value > 0) {
    currentImageIndex.value--;
    previewImageUrl.value = allImageUrls.value[currentImageIndex.value];
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') nextImage();
  if (e.key === 'ArrowLeft') prevImage();
  if (e.key === 'Escape') closeImagePreview();
}

async function markAsUnread(msg: Message) {
  try {
    await markMessageUnread(msg.id);
    syncSnack.value = { show: true, text: 'Đã đánh dấu là chưa đọc', color: 'info' };
    emit('mark-unread');
  } catch (err) {
    console.error('Failed to mark as unread:', err);
  }
}

async function markAsRead(msg: Message) {
  try {
    await markMessageRead(msg.id);
  } catch (err) {
    console.error('Failed to mark as read:', err);
  }
}

function isFirstUnread(msg: Message, index: number) {
  if (!msg.isUnread) return false;
  if (index === 0) return true;
  return !props.messages[index - 1].isUnread;
}

const autoScrollDone = ref(false);

async function scrollToFirstUnread() {
  if (!messagesContainer.value || autoScrollDone.value) return;
  
  await nextTick();
  const divider = messagesContainer.value.querySelector('#first-unread');
  if (divider) {
    divider.scrollIntoView({ behavior: 'smooth', block: 'center' });
    autoScrollDone.value = true;
  } else if (props.messages.length > 0) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    autoScrollDone.value = true;
  }
}

watch(() => props.conversation?.id, () => {
  autoScrollDone.value = false;
  groupMembers.value = [];
  groupMemberCount.value = 0;
  if (props.conversation?.threadType === 'group') {
    fetchGroupMembers();
  }
  setTimeout(scrollToFirstUnread, 300);
}, { immediate: true });

watch(() => props.messages.length, () => {
  if (!autoScrollDone.value) {
    setTimeout(scrollToFirstUnread, 100);
  }
});

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  syncSnack.value = { show: true, text: 'Đã sao chép vào bộ nhớ tạm', color: 'success' };
}

function applySuggestion() { 
  if (!props.aiSuggestion) return; 
  inputText.value = props.aiSuggestion;
  showAiPanel.value = false;
}
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function openFile(url: string) { window.open(url, '_blank'); }

function getMessageCaption(msg: Message): string | null {
  if (!msg.content || !msg.content.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    return p.description || p.title || p.caption || null;
  } catch { return null; }
}

function getImageUrl(msg: Message): string | null {
  if (msg.fileStatus === 'expired') return null;
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (msg.fileStatus === 'expired') return null;
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    
    // Case 1: Simple CRM format { href, name, size, mime }
    if (p.href && p.name) {
      const bytes = parseInt(p.size || '0');
      const sizeStr = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.name, size: sizeStr, href: p.href };
    }

    // Case 2: Zalo native format
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1 || p.type === 'file') {
      const bytes = parseInt(params?.fileSize || p.size || '0');
      const sizeStr = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { 
        name: p.title || p.name || `file.${params?.fileExt || 'bin'}`, 
        size: sizeStr, 
        href: p.href || '' 
      };
    }
  } catch {}
  return null;
}

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (content.startsWith('{')) {
    try {
      const p = JSON.parse(content);
      if (p.title && p.href) return `🔗 ${p.title}`;
      if (p.title) return p.title;
      if (p.href) return `🔗 ${p.description || p.href}`;
      return content;
    } catch { return content; }
  }
  
  // Highlight mentions (Zalo style) - support names with spaces
  // Improved regex: match @ followed by a name (up to 4 words to avoid capturing sentences)
  return content.replace(/@([\wÀ-ỹ0-9_\-\.]{1,}(?:\s[\wÀ-ỹ0-9_\-\.]{1,}){0,3})/g, (match) => {
    return `<span class="mention-tag">${match}</span>`;
  });
}

const showVideoPreview = ref(false);
const previewVideoUrl = ref('');
const previewVideoName = ref('');

function openVideoPreview(msg: Message) {
  if (!msg.content) return;
  try {
    const p = JSON.parse(msg.content);
    previewVideoUrl.value = p.href || p.url || '';
    previewVideoName.value = p.name || p.title || 'Video';
    showVideoPreview.value = true;
  } catch {}
}

function getVideoThumb(msg: Message): string | null {
  if (msg.contentType !== 'video' || !msg.content) return null;
  try {
    const p = JSON.parse(msg.content);
    return p.thumb || null;
  } catch { return null; }
}

function getVideoDuration(msg: Message): string | null {
  if (msg.contentType !== 'video' || !msg.content) return null;
  try {
    const p = JSON.parse(msg.content);
    if (!p.duration) return null;
    const sec = Math.round(p.duration / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  } catch { return null; }
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
  return null;
}

async function syncAppointment(msg: Message) {
  if (!props.conversation?.contact?.id) { syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' }; return; }
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; }
    }
    if (!appointmentDate) { syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' }; return; }
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate,
      appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      type: 'tai_kham',
      notes: `[Zalo] ${p.title || ''}`,
    });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
  } catch (err: any) {
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
  }
}

function getSenderAvatar(msg: Message) {
  if (!props.conversation) return 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png';
  
  if (props.conversation.threadType === 'user') {
    return props.conversation.contact?.avatarUrl || 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png';
  }
  
  const member = groupMembers.value.find(m => (m.uid || m.userId || m.id) === (msg as any).senderUid);
  return member?.avatar || 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png';
}

watch(() => props.messages.length, async () => { 
  await nextTick(); 
  if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; 
});

watch(() => props.aiSuggestionLoading, (loading) => {
  if (loading) showAiPanel.value = true;
});

watch(() => props.aiSuggestion, (val) => {
  if (val) showAiPanel.value = true;
});
</script>

<style scoped>
/* CHAT AREA BACKGROUND */
.v-theme--light .chat-messages-area {
  background-color: #F4F5F7 !important;
}
.v-theme--dark .chat-messages-area {
  background-color: #121212 !important;
}

.message-bubble { 
  font-size: 14px;
  line-height: 1.5;
  position: relative;
  max-width: 100%;
  transition: all 0.2s ease;
  font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
}

/* LIGHT MODE BUBBLES - FORCED COLORS */
.v-theme--light .message-self {
  background-color: #C7E9FF !important; /* Vivid Zalo Blue */
  color: #000000 !important;
  border-radius: 8px 0 8px 8px !important;
  border: 1px solid rgba(0, 145, 255, 0.1) !important;
}

.v-theme--light .message-contact {
  background-color: #FFFFFF !important; /* Pure White */
  color: #000000 !important;
  border-radius: 0 8px 8px 8px !important;
  border: 1px solid rgba(0,0,0,0.05) !important;
}

/* DARK MODE BUBBLES - FORCED COLORS */
.v-theme--dark .message-self {
  background-color: #005B96 !important;
  color: #FFFFFF !important;
  border-radius: 8px 0 8px 8px !important;
}

.v-theme--dark .message-contact {
  background-color: #2C2C2C !important;
  color: #E0E0E0 !important;
  border-radius: 0 8px 8px 8px !important;
}

.msg-time {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
}

.v-theme--light .msg-time-self { color: #000; }
.v-theme--dark .msg-time-self { color: #FFF; }

.cursor-pointer { cursor: pointer; }
.reminder-card { padding: 8px 12px; border-left: 3px solid #FFB74D; border-radius: 8px; background: rgba(255, 183, 77, 0.08); }

.file-card { 
  display: flex; 
  align-items: center; 
  padding: 10px 12px; 
  border-radius: 8px; 
  margin-bottom: 4px;
}

.v-theme--light .file-card { background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(0, 0, 0, 0.05); }
.v-theme--dark .file-card { background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.1); }

.chat-image { max-width: 100%; max-height: 320px; border-radius: 8px; cursor: pointer; transition: transform 0.2s; display: block; }
.chat-image:hover { transform: scale(1.02); }

/* Mention Tag Styling (Zalo Style) */
:deep(.mention-tag) {
  color: #0068FF;
  font-weight: 600;
  cursor: pointer;
}
.v-theme--dark :deep(.mention-tag) {
  color: #4DA3FF;
}

.image-preview-container {
  position: relative;
  min-height: 400px;
}
.preview-img {
  max-width: 100%;
  max-height: 85vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.video-container {
  cursor: pointer;
  max-width: 300px;
  overflow: hidden;
  border-radius: 12px;
}
.video-play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.3);
  border-radius: 50%;
  padding: 4px;
}
.video-duration-tag {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0,0,0,0.6);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
}

/* Zalo Styled Input Area */
.chat-input-wrapper {
  background: var(--v-theme-surface);
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
}
.chat-toolbar {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}
.toolbar-btn {
  color: var(--v-theme-on-surface) !important;
  opacity: 0.7;
}
.chat-textarea {
  font-size: 0.95rem;
  line-height: 1.4;
}
.chat-textarea :deep(.v-field__input) {
  color: #000000 !important;
}
.v-theme--dark .chat-textarea :deep(.v-field__input) {
  color: #FFFFFF !important;
}

.msg-caption {
  font-size: 14px;
  line-height: 1.4;
}

.v-theme--light .msg-caption {
  color: #333333 !important;
}

.v-theme--dark .msg-caption {
  color: #E0E0E0 !important;
}

.chat-textarea :deep(.v-field__outline),
.chat-textarea :deep(.v-field__overlay),
.chat-textarea :deep(.v-field__background),
.chat-textarea :deep(.v-field--focused .v-field__outline) {
  display: none !important;
}

.chat-textarea :deep(.v-field) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* Attachment Preview Styling */
.attachment-preview {
  background-color: #F8F9FA !important;
  border: 1px solid rgba(0,0,0,0.1) !important;
}
.v-theme--dark .attachment-preview {
  background-color: #2C2C2C !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
}
.attachment-name {
  color: #333333 !important;
}
.v-theme--dark .attachment-name {
  color: #E0E0E0 !important;
}
.attachment-size {
  color: #666666 !important;
}
.v-theme--dark .attachment-size {
  color: #AAAAAA !important;
}

/* Ensure the input area itself is transparent and no shadow */
.chat-textarea :deep(.v-field__field) {
  background: transparent !important;
}
</style>
