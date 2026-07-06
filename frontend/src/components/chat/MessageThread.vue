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
          <div class="d-flex align-center flex-wrap gap-2">
            <div class="font-weight-medium">{{ conversation.contact?.fullName || 'Unknown' }}</div>
            <v-chip
              v-if="conversation.threadType === 'group'"
              size="x-small"
              variant="tonal"
              color="primary"
              class="cursor-pointer"
              :loading="loadingMembers"
              @click="fetchAndShowMembers"
            >
              {{ groupMemberCount }} thành viên
            </v-chip>
            <v-chip
              v-if="conversation.threadType === 'group'"
              size="x-small"
              variant="flat"
              prepend-icon="mdi-content-copy"
              class="cursor-pointer"
              style="background: rgba(144, 202, 249, 0.2); color: #1976D2; border: 1px dashed rgba(25, 118, 210, 0.5);"
              @click="copyToClipboard(conversation.id)"
            >
              Copy ID Nhóm (ERP)
            </v-chip>
            <!-- No-ID warning badge inline with name (only for non-group) -->
            <v-chip
              v-if="conversation.threadType !== 'group' && conversation.contact && !conversation.contact.adminCustomerId"
              size="x-small"
              variant="flat"
              prepend-icon="mdi-alert-circle"
              class="ml-2"
              style="background: rgba(255,152,0,0.18); color: #ffb74d; border: 1px solid rgba(255,152,0,0.4); font-weight: 600; letter-spacing: 0.01em;"
            >
              Chưa được gán id
            </v-chip>
          </div>
          <div class="text-caption text-grey">{{ conversation.zaloAccount?.displayName || 'Zalo' }}</div>
        </div>
        <v-btn size="small" variant="tonal" color="primary" class="mr-2" :loading="aiSuggestionLoading" @click="toggleAiPanel">
          Ask AI
        </v-btn>
        <v-btn
          v-if="conversation.threadType !== 'group'"
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
              <v-img 
                v-if="getSenderAvatar(msg)" 
                :src="getSenderAvatar(msg)"
                cover
                eager
              >
                <template #placeholder>
                  <div class="d-flex align-center justify-center fill-height bg-grey-lighten-3">
                    <v-progress-circular indeterminate size="16" width="2" color="primary" />
                  </div>
                </template>
                <template #error>
                  <div v-if="!loadingMembers" class="d-flex align-center justify-center fill-height bg-primary text-white text-caption font-weight-bold">
                    {{ getSenderInitials(msg) }}
                  </div>
                </template>
              </v-img>
              <div v-else-if="!loadingMembers && msg.senderUid" class="d-flex align-center justify-center fill-height bg-primary text-white text-caption font-weight-bold">
                {{ getSenderInitials(msg) }}
              </div>
            </v-avatar>
            <div v-else class="mx-2" style="width: 32px;"></div>

            <div style="max-width: min(75%, 600px);">
              <!-- Sender Name (Groups) -->
              <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 px-1 font-weight-medium text-grey">
                {{ msg.senderName || 'Người dùng Zalo' }}
              </div>
              
              <div 
                class="message-bubble pa-2 px-3 position-relative" 
                :class="msg.senderType === 'self' ? 'message-self' : 'message-contact'" 
                style="word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap;"
              >
                <!-- Context Menu -->
                <v-menu activator="parent" context-menu transition="scale-transition">
                  <v-list density="compact" min-width="180">
                    <v-list-item class="px-2 py-1">
                      <div class="d-flex justify-space-between align-center">
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, '/-heart')"><span class="text-h6">❤️</span></v-btn>
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, '/-strong')"><span class="text-h6">👍</span></v-btn>
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, ':>')"><span class="text-h6">😂</span></v-btn>
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, ':o')"><span class="text-h6">😮</span></v-btn>
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, ':-((')"><span class="text-h6">😢</span></v-btn>
                        <v-btn icon size="small" variant="text" @click="handleReaction(msg, ':-h')"><span class="text-h6">😡</span></v-btn>
                      </div>
                    </v-list-item>
                    <v-divider />
                    <v-list-item prepend-icon="mdi-reply" @click="startReply(msg)" color="info">
                      <v-list-item-title>Trả lời</v-list-item-title>
                    </v-list-item>
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
                <!-- Quote (Reply Preview) -->
                <div v-if="msg.quote" class="quote-block pa-2 mb-1 rounded bg-grey-lighten-3 border-left-primary" style="opacity: 0.9; cursor: pointer; border-left: 3px solid #1976D2; padding-left: 8px !important;">
                  <div class="text-caption font-weight-bold text-primary">{{ msg.quote.uidFrom === conversation?.zaloAccount?.zaloUid ? 'Bạn' : (msg.quote.senderName || 'Khách') }}</div>
                  <div class="text-caption text-truncate" style="color: #424242;">{{ getQuotePreview(msg.quote) }}</div>
                </div>
                <!-- Expired -->
                <div v-if="msg.fileStatus === 'expired' && msg.contentType !== 'text'" class="d-flex align-center pa-1 text-grey" style="opacity: 0.8;">
                  <v-icon size="18" class="mr-1">mdi-clock-alert-outline</v-icon>
                  <span class="text-caption font-italic">Dữ liệu đã hết hạn (60 ngày)</span>
                </div>
                <!-- Deleted -->
                <div v-else-if="msg.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
                  {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
                </div>
                <!-- Video (Unified Zalo Style) -->
                <div v-else-if="isMessageVideo(msg)" class="video-unified-bubble overflow-hidden rounded-lg">
                  <div class="video-preview-area position-relative" @click="openVideoPreview(msg)">
                    <v-img v-if="getVideoThumb(msg)" :src="getVideoThumb(msg)!" class="chat-video-thumb" cover />
                    <div v-else class="video-preview-fallback bg-black d-flex align-center justify-center">
                      <video :src="getVideoUrl(msg)!" preload="metadata" class="video-preview-frame"></video>
                    </div>
                    <div class="video-play-button">
                      <v-icon size="40" color="white">mdi-play</v-icon>
                    </div>
                    <div v-if="getVideoDuration(msg)" class="video-duration-badge">{{ getVideoDuration(msg) }}</div>
                  </div>
                  <div class="video-info-bar pa-2 d-flex align-center">
                    <v-icon size="24" color="primary" class="mr-2">mdi-play-box-outline</v-icon>
                    <div class="flex-grow-1 overflow-hidden">
                      <div class="text-caption font-weight-bold text-truncate">{{ getFileInfo(msg)?.name || 'Video' }}</div>
                      <div class="text-caption text-grey" style="font-size: 0.65rem;">{{ getFileInfo(msg)?.size || '0 MB' }} • Đã có trên máy</div>
                    </div>
                    <v-btn icon size="x-small" variant="text" class="ml-1" @click.stop="openFile(getVideoUrl(msg)!)">
                      <v-icon size="18">mdi-download</v-icon>
                    </v-btn>
                  </div>
                  <div v-if="getMessageCaption(msg)" class="pa-2 pt-0 msg-caption white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Image -->
                <div v-else-if="getImageUrl(msg)">
                  <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="openImagePreview(getImageUrl(msg)!)" />
                  <div v-if="getMessageCaption(msg)" class="msg-caption mt-1 white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Sticker -->
                <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
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
                <!-- Link Preview -->
                <div v-else-if="isLinkMessage(msg)">
                  <div v-if="getLinkTitle(msg)" class="mb-2" style="white-space: pre-wrap; word-break: break-word;">{{ getLinkTitle(msg) }}</div>
                  <div class="d-flex align-center rounded-lg cursor-pointer link-card" @click="openLink(getLinkHref(msg))">
                    <div v-if="getLinkThumb(msg)" style="width: 60px; height: 60px; flex-shrink: 0;" class="bg-grey-lighten-4">
                      <v-img :src="getLinkThumb(msg)" width="100%" height="100%" cover />
                    </div>
                    <div class="pa-2 overflow-hidden flex-grow-1" style="min-width: 0;">
                      <div class="text-body-2 font-weight-medium text-truncate">{{ getLinkMediaTitle(msg) }}</div>
                      <div class="text-caption text-primary text-truncate">{{ getLinkSrc(msg) }}</div>
                    </div>
                  </div>
                </div>
                <!-- Call Message (New) -->
                <div v-else-if="isCallMessage(msg)" class="call-bubble-container">
                  <div class="d-flex align-center mb-2">
                    <span class="text-body-1 font-weight-bold">{{ getCallTitle(msg) }}</span>
                  </div>
                  <div class="d-flex align-center call-info mb-3">
                    <v-icon :icon="getCallIcon(msg)" :color="getCallIconColor(msg)" size="20" class="mr-2" />
                    <span class="text-body-2">{{ getCallDuration(msg) }}</span>
                  </div>
                  <v-divider class="mb-2" style="opacity: 0.1;" />
                  <div class="text-center">
                    <v-btn variant="text" color="primary" class="text-none font-weight-bold" block @click="initiateCall(msg)">
                      Gọi lại
                    </v-btn>
                  </div>
                </div>
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
                <!-- JSON Action / Rich Message Fallback -->
                <div v-else-if="isJsonActionMessage(msg)" class="json-action-card">
                  <div class="d-flex align-start rounded-lg pa-3 border" style="background-color: var(--v-theme-surface-variant); opacity: 0.9;">
                    <v-icon size="24" :color="getJsonActionIconColor(msg)" class="mr-3 mt-1">{{ getJsonActionIcon(msg) }}</v-icon>
                    <div class="flex-grow-1 overflow-hidden">
                      <div class="text-body-2 font-weight-bold mb-1">{{ getJsonActionTitle(msg) }}</div>
                      <div class="text-caption" style="white-space: pre-wrap; word-break: break-word; opacity: 0.85;">{{ getJsonActionDesc(msg) }}</div>
                    </div>
                  </div>
                </div>
                <!-- Default text -->
                <div v-else v-html="parseDisplayContent(msg.content, groupMembers)"></div>
                <!-- Timestamp -->
                <div class="text-caption mt-1 msg-time" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                  {{ formatMessageTime(msg.sentAt) }}
                </div>
                <!-- Reaction Badge -->
                <div v-if="msg.reaction" class="reaction-badge position-absolute" style="bottom: -8px; right: -8px; background: white; border-radius: 50%; padding: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); font-size: 14px; line-height: 1; z-index: 2;">
                  {{ getReactionEmoji(msg.reaction) }}
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

        <div class="d-flex align-center px-2 py-1 chat-toolbar border-bottom position-relative">
          <v-btn icon="mdi-emoticon-happy-outline" variant="text" size="x-small" class="toolbar-btn mx-1" />
          <v-btn icon="mdi-image-outline" variant="text" size="x-small" class="toolbar-btn mx-1" @click="triggerFileInput('image')" />
          <v-btn icon="mdi-paperclip" variant="text" size="x-small" class="toolbar-btn mx-1" @click="triggerFileInput('file')" />
          
          <v-menu v-if="conversation?.threadType === 'group'" v-model="showTagMenu" :close-on-content-click="false" location="top" offset="5">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-at" variant="text" size="x-small" class="toolbar-btn mx-1" color="primary" />
            </template>
            <v-card min-width="250" max-width="300" max-height="350" class="overflow-y-auto">
              <v-list density="compact">
                <v-list-item @click="insertMention('All', '-1')" prepend-icon="mdi-account-group" class="text-primary font-weight-bold">
                  <v-list-item-title>Tag tất cả (@All)</v-list-item-title>
                </v-list-item>
                <v-divider />
                <v-list-item
                  v-for="member in groupMembers"
                  :key="member.userId || member.uid || member.id"
                  @click="insertMention(member.displayName || member.fullName || 'Thành viên', member.userId || member.uid || member.id)"
                >
                  <template #prepend>
                    <v-avatar size="24" class="mr-2">
                      <v-img :src="member.avatar || member.avatarUrl || 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png'" />
                    </v-avatar>
                  </template>
                  <v-list-item-title>{{ member.displayName || member.fullName || 'Thành viên' }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card>
          </v-menu>

          <v-spacer />
          <v-progress-circular v-if="isUploading" indeterminate size="16" width="2" color="primary" class="mr-2" />
        </div>

        <div v-if="attachment" class="pa-2 attachment-preview rounded-lg mx-3 mt-2 d-flex align-center border">
          <v-icon :icon="getAttachmentIcon(attachment.type)" color="primary" class="mr-2" />
          <div class="flex-grow-1 text-truncate">
            <span class="text-caption font-weight-bold">{{ attachment.name }}</span>
          </div>
          <v-btn icon="mdi-close" size="x-small" variant="text" color="grey" @click="clearAttachment" />
        </div>

        <div v-if="replyingToMessage" class="reply-preview pa-2 mx-3 mt-2 d-flex align-start border rounded-lg bg-grey-lighten-4">
          <v-icon size="20" color="info" class="mr-2 mt-1">mdi-reply</v-icon>
          <div class="flex-grow-1 overflow-hidden" style="border-left: 3px solid #1976D2; padding-left: 8px;">
            <div class="text-caption font-weight-bold text-primary">{{ replyingToMessage.senderName || 'Khách' }}</div>
            <div class="text-caption text-truncate">{{ getQuotePreview(replyingToMessage) }}</div>
          </div>
          <v-btn icon="mdi-close" size="x-small" variant="text" color="grey" @click="cancelReply" />
        </div>

        <div class="d-flex align-end px-3 py-2">
          <input type="file" ref="fileInput" class="d-none" @change="handleFileChange" />
          <v-textarea
            v-model="inputText"
            :placeholder="`Gửi tin nhắn là ${conversation?.zaloAccount?.displayName || 'Zalo'}`"
            variant="plain"
            density="compact"
            hide-details
            auto-grow
            rows="1"
            max-rows="8"
            @keydown.enter.exact.prevent="handleSend"
            @paste="handlePaste"
            class="flex-grow-1 chat-textarea"
          />
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
    </template>

    <!-- Dialogs -->
    <v-dialog v-model="showImagePreview" max-width="1000">
      <v-card theme="dark" class="bg-black">
        <div class="image-preview-container d-flex align-center justify-center position-relative" style="min-height: 400px; padding: 20px;">
          <v-btn icon="mdi-close" position="absolute" size="small" style="top: 10px; right: 10px; z-index: 100;" variant="tonal" color="white" @click="closeImagePreview" />
          
          <v-btn v-if="previewImageIndex > 0" icon="mdi-chevron-left" position="absolute" style="left: 10px; z-index: 100;" variant="tonal" color="white" @click="prevImage" />
          
          <img :src="previewImageUrl" alt="Preview" class="preview-img" style="max-height: 85vh; max-width: 100%; object-fit: contain;" />
          
          <v-btn v-if="previewImageIndex < imageMessages.length - 1" icon="mdi-chevron-right" position="absolute" style="right: 10px; z-index: 100;" variant="tonal" color="white" @click="nextImage" />
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showVideoPreview" max-width="900">
      <v-card theme="dark" class="rounded-lg">
        <v-card-title class="d-flex align-center pa-4">
          <span class="text-truncate">{{ previewVideoName }}</span>
          <v-spacer />
          <v-btn icon size="small" variant="text" @click="showVideoPreview = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <div class="pa-0 bg-black d-flex align-center justify-center" style="min-height: 400px;">
          <video v-if="showVideoPreview" :src="previewVideoUrl" controls autoplay class="w-100" style="max-height: 70vh;"></video>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showMembersDialog" max-width="400">
      <v-card class="rounded-lg">
        <v-card-title class="d-flex align-center pa-4 border-b">
          <span class="font-weight-bold">Thành viên nhóm ({{ groupMembers.length }})</span>
          <v-spacer />
          <v-btn icon size="small" variant="text" @click="showMembersDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text class="pa-0" style="max-height: 400px; overflow-y: auto;">
          <v-list v-if="groupMembers.length > 0">
            <v-list-item
              v-for="member in groupMembers"
              :key="member.userId || member.uid || member.id"
              :class="canChatWithMember(member) ? 'cursor-pointer' : ''"
              @click="canChatWithMember(member) ? openDirectChat(member) : null"
            >
              <template #prepend>
                <v-avatar size="36" color="grey-lighten-2" class="mr-3">
                  <v-img :src="member.avatar || member.avatarUrl || 'https://stc-zaloprofile.zdn.vn/pc/v1/images/avatar_default.png'" />
                </v-avatar>
              </template>
              <v-list-item-title class="font-weight-medium">
                {{ member.displayName || member.fullName || 'Thành viên' }}
              </v-list-item-title>
              <template #append v-if="canChatWithMember(member)">
                <v-btn size="small" variant="text" color="primary" icon="mdi-message-text" @click.stop="openDirectChat(member)" />
              </template>
            </v-list-item>
          </v-list>
          <div v-else-if="loadingMembers" class="pa-4 text-center">
            <v-progress-circular indeterminate color="primary"></v-progress-circular>
          </div>
          <div v-else class="pa-4 text-center text-grey">
            Không tìm thấy thông tin thành viên.
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
    
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue';
import { useChat } from '@/composables/use-chat';
import type { Message, Conversation } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSuggestionPanel from '@/components/ai/ai-suggestion-panel.vue';
import { useAuthStore } from '@/stores/auth';

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

const emit = defineEmits<{
  (e: 'toggle-contact-panel'): void
  (e: 'ask-ai'): void
  (e: 'mark-unread'): void
  (e: 'select-member', member: any): void
  (e: 'send', content: string, contentType: string, fileHash: string | undefined, mentions?: any[], quote?: any): void
  (e: 'send-attachment', file: File, caption: string): void
  (e: 'send-reaction', msgId: string, icon: string): void
}>();

const { markMessageUnread, markMessageRead } = useChat();

const authStore = useAuthStore();

function canChatWithMember(member: any): boolean {
  if (!authStore.user) return false;
  // Strictly allow direct chat only if the contact is assigned to the logged-in user
  return member.assignedUserId === authStore.user.id;
}

const showAiPanel = ref(false);
const inputText = ref('');
const attachment = ref<{ name: string; size: number; file: File; type: 'image' | 'video' | 'file' } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const syncSnack = ref({ show: false, text: '', color: 'success' });

// Previews
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) closeImagePreview(); } });
const showVideoPreview = ref(false);
const previewVideoUrl = ref('');
const previewVideoName = ref('');

const imageMessages = computed(() => props.messages.filter(m => getImageUrl(m) !== null));
const previewImageIndex = ref(-1);

// Group Members

const groupMembers = ref<any[]>([]);
const groupMemberCount = computed(() => groupMembers.value.length);
const loadingMembers = ref(false);
const showMembersDialog = ref(false);

async function fetchGroupMembers() {
  if (props.conversation?.threadType !== 'group') return;
  loadingMembers.value = true;
  try {
    const res = await api.get(`/conversations/${props.conversation.id}/members`);
    groupMembers.value = res.data?.members || [];
  } catch (err) {
    console.error('Failed to fetch group members:', err);
  } finally {
    loadingMembers.value = false;
  }
}

async function fetchAndShowMembers() { 
  showMembersDialog.value = true; 
  if (groupMembers.value.length === 0) {
    loadingMembers.value = true;
    await fetchGroupMembers();
    loadingMembers.value = false;
  }
}

watch(() => props.conversation?.id, (newId) => {
  groupMembers.value = [];
  if (newId && props.conversation?.threadType === 'group') {
    fetchGroupMembers();
  } else {
    loadingMembers.value = false;
  }
}, { immediate: true });

function openDirectChat(member: any) {
  if (!props.conversation?.zaloAccountId) return;
  showMembersDialog.value = false;
  emit('select-member', member);
}

// --- Handlers ---
const showTagMenu = ref(false);
const replyingToMessage = ref<Message | null>(null);

function startReply(msg: Message) {
  replyingToMessage.value = msg;
  // Focus the input if possible
  const textarea = document.querySelector('.chat-textarea textarea') as HTMLTextAreaElement;
  if (textarea) textarea.focus();
}

function cancelReply() {
  replyingToMessage.value = null;
}

function handleReaction(msg: Message, icon: string) {
  emit('send-reaction', msg.id, icon);
}

const reactionEmojis: Record<string, string> = {
  '/-heart': '❤️',
  '/-strong': '👍',
  ':>': '😂',
  ':o': '😮',
  ':-((': '😢',
  ':-h': '😡',
};
function getReactionEmoji(iconCode: string) {
  return reactionEmojis[iconCode] || '❤️';
}

function insertMention(name: string, _uid: string) {
  inputText.value += `@${name} `;
  showTagMenu.value = false;
  // Focus the input if possible
  const textarea = document.querySelector('.chat-textarea textarea') as HTMLTextAreaElement;
  if (textarea) textarea.focus();
}

function parseMentions(text: string): any[] {
  if (props.conversation?.threadType !== 'group' || !groupMembers.value) return [];
  const mentions: any[] = [];
  
  // Find @All or @Cả nhóm
  const allRegex = /@(All|Cả nhóm|cả nhóm)/gi;
  let match;
  while ((match = allRegex.exec(text)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, uid: "-1" });
  }

  // Find specific members
  for (const member of groupMembers.value) {
    const name = member.displayName || member.fullName;
    if (!name) continue;
    const uid = member.userId || member.uid || member.id;
    if (!uid) continue;
    
    const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const memberRegex = new RegExp(`@${escapedName}`, 'gi');
    let mMatch;
    while ((mMatch = memberRegex.exec(text)) !== null) {
      mentions.push({ pos: mMatch.index, len: mMatch[0].length, uid: String(uid) });
    }
  }
  
  return mentions;
}

function handleSend() {
  let quote = undefined;
  if (replyingToMessage.value) {
    const repMsg = replyingToMessage.value;
    quote = {
      content: getQuotePreview(repMsg),
      msgType: repMsg.contentType === 'image' ? 'chat.photo' : 'chat.text',
      uidFrom: repMsg.senderUid || '',
      senderName: repMsg.senderName || 'Khách',
      msgId: repMsg.id,
      cliMsgId: Date.now().toString(),
      ts: new Date(repMsg.sentAt).getTime().toString(),
      ttl: 0
    };
  }

  if (attachment.value) {
    emit('send-attachment', attachment.value.file, inputText.value);
  } else if (inputText.value.trim()) {
    const text = inputText.value;
    const mentions = parseMentions(text);
    emit('send', text, 'text', undefined, mentions, quote);
  }
  inputText.value = ''; 
  attachment.value = null;
  replyingToMessage.value = null;
}

function sendLike() { emit('send', '👍', 'text', undefined); }

function triggerFileInput(type: string) {
  if (fileInput.value) {
    fileInput.value.accept = type === 'image' ? 'image/*,video/*' : '*/*';
    fileInput.value.click();
  }
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;
  const file = target.files[0];
  attachment.value = { name: file.name, size: file.size, file: file, type: file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'file') };
  target.value = '';
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      if (file) {
        const timestamp = new Date().getTime();
        attachment.value = { 
          name: `Screenshot_${timestamp}.png`, 
          size: file.size, 
          file: file, 
          type: 'image' 
        };
        e.preventDefault();
        break;
      }
    }
  }
}

function clearAttachment() { attachment.value = null; }

function getAttachmentIcon(type: string) { return type === 'image' ? 'mdi-image' : (type === 'video' ? 'mdi-video' : 'mdi-file-document'); }

function parseCallParams(msg: Message): any {
  if (!msg.content) return null;
  try {
    const p = JSON.parse(msg.content);
    let params: any = {};
    if (typeof p.params === 'string') {
      try { params = JSON.parse(p.params); } catch(e){}
    } else if (p.params) {
      params = p.params;
    }
    return { p, params };
  } catch {
    return null;
  }
}

function isCallMessage(msg: Message): boolean {
  if (!msg.content) return false;
  if (msg.content.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const title = p.title || '';
      const desc = p.description || '';
      return title.includes('Cuộc gọi') || desc.includes('Cuộc gọi') || p.action === 'oa.call' || p.action === 'recommened.calltime' || p.type === 'call' || title === 'sendBubbleMessage';
    } catch { return false; }
  }
  return msg.content.includes('Cuộc gọi');
}

function getCallTitle(msg: Message): string {
  const parsed = parseCallParams(msg);
  if (parsed) {
    const { p, params } = parsed;
    if (params && params.isCaller !== undefined) {
      const duration = params.duration || 0;
      if (params.isCaller === 0) {
         if (duration === 0) return 'Cuộc gọi nhỡ';
         return 'Cuộc gọi thoại đến';
      } else {
         if (duration === 0) return 'Cuộc gọi thoại đi (Không thành công)';
         return 'Cuộc gọi thoại đi';
      }
    }
    if (p.title && p.title !== 'sendBubbleMessage') return p.title;
    if (p.description) return p.description;
  }
  return 'Cuộc gọi';
}

function getCallIcon(msg: Message): string {
  const title = getCallTitle(msg).toLowerCase();
  if (title.includes('nhỡ') || title.includes('không thành công')) return 'mdi-phone-missed';
  return title.includes('đến') ? 'mdi-phone-incoming' : 'mdi-phone-outgoing';
}

function getCallIconColor(msg: Message): string {
  const title = getCallTitle(msg).toLowerCase();
  if (title.includes('nhỡ') || title.includes('không thành công')) return 'error';
  return title.includes('đến') ? 'success' : 'primary';
}

function getCallDuration(msg: Message): string {
  const parsed = parseCallParams(msg);
  if (parsed) {
    const { p, params } = parsed;
    const duration = params.duration ?? p.duration;
    
    if (duration !== undefined) {
      const sec = duration > 100000 ? Math.round(duration / 1000) : duration;
      return `${Math.floor(sec / 60)} phút ${sec % 60} giây`;
    }
    const match = (p.description || '').match(/\d+ phút \d+ giây/);
    return match ? match[0] : '0 phút 0 giây';
  }
  return '0 phút 0 giây';
}

function initiateCall(_msg: Message) { syncSnack.value = { show: true, text: 'Tính năng gọi lại đang được phát triển', color: 'info' }; }

function isReminderMessage(msg: Message): boolean { try { return JSON.parse(msg.content!).action === 'msginfo.actionlist'; } catch { return false; } }
function getReminderTitle(msg: Message): string { try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; } }
function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) { if (h.type === 'time') return h.text; }
  } catch {} return null;
}

async function syncAppointment(msg: Message) {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) { if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; } }
    if (!appointmentDate) return;
    await api.post('/appointments', { contactId: props.conversation?.contact?.id, appointmentDate, appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), type: 'tai_kham', notes: `[Zalo] ${p.title || ''}` });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn!', color: 'success' };
  } catch { syncSnack.value = { show: true, text: 'Đồng bộ thất bại', color: 'error' }; }
}

function getSenderAvatar(msg: Message): string { 
  if (!props.conversation) return '';
  if (props.conversation.threadType === 'user') {
    return props.conversation.contact?.avatarUrl || '';
  }
  if (!msg.senderUid) return '';
  const member = groupMembers.value.find(m => {
    const mId = m.userId || m.uid || m.id;
    return mId && String(mId) === String(msg.senderUid);
  });
  return member?.avatar || member?.avatarUrl || '';
}

function getSenderInitials(msg: Message): string {
  const name = msg.senderName || 'Zalo User';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] || '';
    const last = parts[parts.length - 1]?.[0] || '';
    return (first + last).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function parseDisplayContent(c: string | null, _membersDeps?: any[]): string {
  if (!c) return '';
  
  // Escape HTML first to prevent XSS
  let text = c
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  // Auto-linkify URLs
  const urlRegex = /(https?:\/\/[^\s<]+)/gi;
  text = text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link" @click.stop>$1</a>');

  // Auto-linkify Emails
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
  text = text.replace(emailRegex, '<a href="mailto:$1" class="chat-link" @click.stop>$1</a>');

  // Handle newlines
  text = text.replace(/\n/g, '<br>');

  // Check if we are in a group conversation and have members
  const namesToTag = new Set<string>(['all', 'All', 'Cả nhóm', 'cả nhóm']);
  
  if (groupMembers.value && groupMembers.value.length > 0) {
    groupMembers.value.forEach(m => {
      const name = m.displayName || m.fullName;
      if (name && name.trim()) {
        namesToTag.add(name.trim());
      }
    });
  }

  // Sort names by length descending to match longer names first (e.g. '@Đức Hostingviet' matches before '@Đức')
  const sortedNames = Array.from(namesToTag).sort((a, b) => b.length - a.length);

  // Replace each name match
  for (const name of sortedNames) {
    const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (!escapedName.trim()) continue;
    // Universally supported regex that will never cause SyntaxError
    const regex = new RegExp('@' + escapedName, 'gi');
    text = text.replace(regex, (match) => {
      return `<span class="mention-tag">${match}</span>`;
    });
  }

  return text;
}
function isMessageVideo(msg: Message) { 
  if (msg.contentType === 'video') return true;
  if (msg.contentType === 'file' || msg.content?.includes('"type":"file"')) {
    try {
      const p = JSON.parse(msg.content!);
      const name = (p.name || p.title || '').toLowerCase();
      if (name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.avi') || name.endsWith('.mkv') || name.endsWith('.webm')) {
        return true;
      }
    } catch {}
  }
  return false;
}
function getVideoUrl(msg: Message) { try { const p = JSON.parse(msg.content!); return p.href || p.url || ''; } catch { return ''; } }
function getVideoThumb(msg: Message) { try { return JSON.parse(msg.content!).thumb; } catch { return null; } }
function getVideoDuration(_msg: Message) { return ''; }
function getImageUrl(msg: Message) { 
  if (msg.contentType === 'image') {
    try { const p = JSON.parse(msg.content!); return p.href || p.url || p.qrCodeUrl || ''; } catch { return msg.content; }
  }
  return null;
}
function getFileInfo(msg: Message) { 
  if (msg.contentType !== 'file' && msg.contentType !== 'video' && !msg.content?.includes('"type":"file"') && !msg.content?.includes('"type":"video"')) return null; 
  try { 
    const p = JSON.parse(msg.content!);
    let sizeStr = p.size || '0 MB';
    if (typeof p.size === 'number') {
      sizeStr = (p.size / (1024 * 1024)).toFixed(2) + ' MB';
    }
    return { name: p.name || p.title, size: sizeStr, href: p.href || p.url }; 
  } catch { return null; } 
}
function getMessageCaption(msg: Message) { try { const p = JSON.parse(msg.content!); return p.description || p.caption || null; } catch { return null; } }

function getQuotePreview(quote: any): string {
  if (!quote || !quote.content) return 'Đính kèm';
  if (quote.content.startsWith('{')) {
    try {
      const p = JSON.parse(quote.content);
      return p.name || p.title || p.description || 'Đính kèm';
    } catch {
      return quote.content;
    }
  }
  return quote.content;
}

// JSON Action Messages
function isJsonActionMessage(msg: Message): boolean {
  if (isLinkMessage(msg) || isMessageVideo(msg) || getFileInfo(msg) || getImageUrl(msg) || isCallMessage(msg) || isReminderMessage(msg)) return false;
  if (!msg.content || !msg.content.startsWith('{')) return false;
  try {
    const p = JSON.parse(msg.content);
    return typeof p === 'object' && p !== null && Object.keys(p).length > 0;
  } catch {
    return false;
  }
}
function getJsonActionTitle(msg: Message): string {
  try {
    const p = JSON.parse(msg.content!);
    let inner = p;
    if (typeof p.description === 'string' && p.description.startsWith('{')) {
      try { inner = JSON.parse(p.description); } catch {}
    }
    
    if (p.action === 'share.contact' || p.vcard || p.gUid || p.qrCodeUrl || inner.gUid || inner.vcard || inner.qrCodeUrl) return 'Danh thiếp: ' + (p.title || inner.title || p.name || 'Người dùng Zalo');
    if (p.action === 'zinstant.bankcard') return 'Mã QR / Thông tin thanh toán';
    if (p.action === 'show.profile' || p.action === 'action.open.sendsticker') return 'Thông báo hệ thống Zalo';
    return p.title || p.action || p.name || 'Định dạng đặc biệt';
  } catch { return 'Thông báo'; }
}
function getJsonActionDesc(msg: Message): string {
  try {
    const p = JSON.parse(msg.content!);
    let inner = p;
    if (typeof p.description === 'string' && p.description.startsWith('{')) {
      try { inner = JSON.parse(p.description); } catch {}
    }

    if (p.action === 'share.contact' || p.vcard || p.gUid || p.qrCodeUrl || inner.gUid || inner.vcard || inner.qrCodeUrl) return 'Vui lòng mở ứng dụng Zalo để xem chi tiết và lưu danh thiếp này.';
    if (p.action === 'zinstant.bankcard') return 'Khách hàng vừa gửi thông tin tài khoản ngân hàng hoặc mã QR thanh toán.\n(Vui lòng mở ứng dụng Zalo trên điện thoại hoặc PC để xem chi tiết thẻ/mã).';
    if (p.description && typeof p.description === 'string' && !p.description.startsWith('{')) return p.description;
    return '[Định dạng nâng cao] Vui lòng xem chi tiết trên ứng dụng Zalo gốc.';
  } catch { return ''; }
}
function getJsonActionIcon(msg: Message): string {
  try {
    const p = JSON.parse(msg.content!);
    let inner = p;
    if (typeof p.description === 'string' && p.description.startsWith('{')) {
      try { inner = JSON.parse(p.description); } catch {}
    }

    if (p.action === 'share.contact' || p.vcard || p.gUid || p.qrCodeUrl || inner.gUid || inner.vcard || inner.qrCodeUrl) return 'mdi-card-account-details-outline';
    if (p.action === 'zinstant.bankcard') return 'mdi-qrcode-scan';
    if (p.action === 'show.profile' || p.action === 'action.open.sendsticker') return 'mdi-account-plus';
    return 'mdi-bell-outline';
  } catch { return 'mdi-bell-outline'; }
}
function getJsonActionIconColor(msg: Message): string {
  try {
    const p = JSON.parse(msg.content!);
    let inner = p;
    if (typeof p.description === 'string' && p.description.startsWith('{')) {
      try { inner = JSON.parse(p.description); } catch {}
    }

    if (p.action === 'share.contact' || p.vcard || p.gUid || p.qrCodeUrl || inner.gUid || inner.vcard || inner.qrCodeUrl) return 'indigo';
    if (p.action === 'zinstant.bankcard') return 'success';
    if (p.action === 'show.profile' || p.action === 'action.open.sendsticker') return 'info';
    return 'primary';
  } catch { return 'primary'; }
}

// Link Previews
function isLinkMessage(msg: Message): boolean {
  if (!msg.content) return false;
  if (msg.content.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      return p.action === 'recommened.link' || p.type === 'link';
    } catch { return false; }
  }
  return false;
}

function parseLinkParams(msg: Message): any {
  if (!msg.content) return null;
  try {
    const p = JSON.parse(msg.content);
    let params: any = {};
    if (typeof p.params === 'string') {
      try { params = JSON.parse(p.params); } catch(e){}
    } else if (p.params) {
      params = p.params;
    }
    return { p, params };
  } catch {
    return null;
  }
}

function getLinkTitle(msg: Message): string {
  const parsed = parseLinkParams(msg);
  if (!parsed) return '';
  return parsed.p.title || '';
}

function getLinkHref(msg: Message): string {
  const parsed = parseLinkParams(msg);
  if (!parsed) return '';
  
  let href = parsed.p.href || '';
  // Nếu href bị ghi đè bởi link media của CRM, ưu tiên dùng src hoặc title
  if (!href || href.includes('media-crm-zalo')) {
    const fallbackUrl = parsed.params.src || parsed.p.title || '';
    if (fallbackUrl) href = fallbackUrl;
  }
  
  if (href && !href.startsWith('http')) {
    return 'https://' + href;
  }
  return href;
}

function getLinkThumb(msg: Message): string {
  const parsed = parseLinkParams(msg);
  if (!parsed) return '';
  return parsed.p.thumb || '';
}

function getLinkMediaTitle(msg: Message): string {
  const parsed = parseLinkParams(msg);
  if (!parsed) return '';
  return parsed.params.mediaTitle || parsed.p.title || 'Liên kết';
}

function getLinkSrc(msg: Message): string {
  const parsed = parseLinkParams(msg);
  if (!parsed) return '';
  return parsed.params.src || parsed.p.href || '';
}

function openLink(href: string) {
  if (href) window.open(href, '_blank');
}

function openImagePreview(url: string) { 
  previewImageUrl.value = url; 
  previewImageIndex.value = imageMessages.value.findIndex(m => getImageUrl(m) === url);
}
function closeImagePreview() { 
  previewImageUrl.value = ''; 
  previewImageIndex.value = -1;
}

function nextImage() {
  if (previewImageIndex.value >= 0 && previewImageIndex.value < imageMessages.value.length - 1) {
    previewImageIndex.value++;
    previewImageUrl.value = getImageUrl(imageMessages.value[previewImageIndex.value])!;
  }
}

function prevImage() {
  if (previewImageIndex.value > 0) {
    previewImageIndex.value--;
    previewImageUrl.value = getImageUrl(imageMessages.value[previewImageIndex.value])!;
  }
}

function openVideoPreview(msg: Message) { previewVideoUrl.value = getVideoUrl(msg); previewVideoName.value = 'Video'; showVideoPreview.value = true; }
function openFile(url: string) { window.open(url, '_blank'); }

async function markAsUnread(msg: Message) { await markMessageUnread(msg.id); syncSnack.value = { show: true, text: 'Đã đánh dấu chưa đọc', color: 'info' }; emit('mark-unread'); }
async function markAsRead(msg: Message) { await markMessageRead(msg.id); }
function isFirstUnread(msg: Message, index: number) { if (!msg.isUnread) return false; return index === 0 || !props.messages[index - 1].isUnread; }

function copyToClipboard(text: string) { navigator.clipboard.writeText(text); syncSnack.value = { show: true, text: 'Đã sao chép', color: 'success' }; }
function toggleAiPanel() { showAiPanel.value = !showAiPanel.value; if (showAiPanel.value) emit('ask-ai'); }
function applySuggestion() { inputText.value = props.aiSuggestion; showAiPanel.value = false; }

watch(() => props.messages.length, async () => { await nextTick(); if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; });
</script>

<style scoped>
.chat-messages-area { background-color: #F4F5F7; }
.v-theme--dark .chat-messages-area { background-color: #121212; }
.message-bubble { font-size: 14px; line-height: 1.5; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.message-self { background-color: #C7E9FF; color: #000 !important; }
.message-contact { background-color: #FFF; color: #000 !important; }
.v-theme--dark .message-self { background-color: #005B96; color: #FFF !important; }
.v-theme--dark .message-contact { background-color: #2C2C2C; color: #E0E0E0 !important; }

.call-bubble-container { min-width: 210px; background: #2C2C2C !important; border-radius: 10px; padding: 12px; color: #FFF !important; }
.v-theme--light .call-bubble-container { background: #F0F2F5 !important; color: #000 !important; border: 1px solid rgba(0,0,0,0.05); }
.call-info { opacity: 0.8; margin: 4px 0; }

.chat-input-wrapper { background: var(--v-theme-surface); border-top: 1px solid rgba(0,0,0,0.1); }
.chat-textarea :deep(.v-field) { border-radius: 0 !important; box-shadow: none !important; background: transparent !important; }
.chat-textarea :deep(.v-field--focused) { border-color: transparent !important; box-shadow: none !important; }
.chat-textarea :deep(.v-field__outline) { display: none !important; }

.chat-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  cursor: pointer;
  object-fit: cover;
}

.link-card {
  background: #FFF;
  border: 1px solid rgba(0,0,0,0.1);
  overflow: hidden;
}
.v-theme--dark .link-card {
  background: #2C2C2C;
  border: 1px solid rgba(255,255,255,0.1);
  overflow: hidden;
}

/* Video Bubble Styling */
.video-unified-bubble {
  width: 280px;
  border: 1px solid rgba(0,0,0,0.08);
  background-color: #FAFAFA;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.v-theme--dark .video-unified-bubble {
  background-color: #1E1E1E;
  border-color: rgba(255,255,255,0.08);
}
.video-preview-area {
  height: 160px;
  width: 100%;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.chat-video-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.video-preview-fallback {
  width: 100%;
  height: 100%;
  background-color: #000;
}
.video-preview-frame {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.video-play-button {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.2s;
  z-index: 2;
}
.video-preview-area:hover .video-play-button {
  background: rgba(0, 0, 0, 0.7);
  transform: translate(-50%, -50%) scale(1.08);
}
.video-duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #FFF;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  z-index: 2;
}
.video-info-bar {
  border-top: 1px solid rgba(0,0,0,0.05);
  background: #FFF;
}
.v-theme--dark .video-info-bar {
  border-top: 1px solid rgba(255,255,255,0.05);
  background: #252525;
}

/* Mention Tag Highlights */
:deep(.mention-tag) {
  color: #0068FF !important;
  font-weight: 600;
  display: inline-block;
}
.v-theme--dark :deep(.mention-tag) {
  color: #39a0ff !important;
}

/* Auto-link highlights */
:deep(.chat-link) {
  color: #0068FF;
  text-decoration: none;
}
:deep(.chat-link:hover) {
  text-decoration: underline;
}
.v-theme--dark :deep(.chat-link) {
  color: #39a0ff;
}
</style>
