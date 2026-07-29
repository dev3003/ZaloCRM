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
      <div class="pa-3 d-flex flex-wrap align-center" style="gap: 8px; border-bottom: 1px solid var(--border-glow, rgba(0,242,255,0.1)); min-height: 64px;">
        
        <div class="d-flex align-center flex-grow-1" style="min-width: 250px;">
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
          
          <v-btn
            v-if="conversation.threadType !== 'group'"
            :icon="showContactPanel ? 'mdi-account-details' : 'mdi-account-details-outline'"
            size="small" variant="text"
            :color="showContactPanel ? 'primary' : undefined"
            @click="$emit('toggle-contact-panel')"
          />
        </div>

        <div class="d-flex align-center flex-wrap" style="gap: 8px;">
          <v-btn size="small" variant="tonal" color="primary" :loading="aiSuggestionLoading" @click="toggleAiPanel">
            Ask AI
          </v-btn>
          
          <!-- Support Session Buttons -->
          <template v-if="activeSupportSession">
            <v-chip size="small" color="success" class="text-caption">Đang được hỗ trợ</v-chip>
            <v-btn
              v-if="isSessionCreator || authStore.user?.role === 'admin' || authStore.user?.role === 'owner'"
              size="small"
              variant="tonal"
              color="error"
              prepend-icon="mdi-account-cancel"
              :loading="cancelingSession"
              @click="cancelActiveSupportSession"
            >
              Hủy hỗ trợ
            </v-btn>
          </template>
          <template v-else>
            <v-btn
              size="small"
              variant="tonal"
              color="info"
              prepend-icon="mdi-account-hard-hat"
              @click="toggleSelectMode"
            >
              Nhờ hỗ trợ
            </v-btn>
          </template>
        </div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-3 chat-messages-area" @scroll="onScroll">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <template v-for="(msg, index) in messages" :key="msg.id">
          <!-- Unread Divider -->
          <div v-if="isFirstUnread(msg, index)" class="unread-divider my-4 d-flex align-center" id="first-unread">
            <v-divider color="error" />
            <span class="mx-4 text-caption text-error font-weight-bold" style="white-space: nowrap;">Tin nhắn chưa đọc</span>
            <v-divider color="error" />
          </div>
          <div class="mb-4 d-flex align-end position-relative" :class="msg.senderType === 'self' ? 'flex-row-reverse' : 'flex-row'">
            <!-- Selection Checkbox -->
            <div v-if="isSelectMode" class="d-flex align-center justify-center" style="width: 40px;">
              <v-checkbox-btn
                v-model="selectedMessageIds"
                :value="msg.id"
                color="info"
              ></v-checkbox-btn>
            </div>

            <!-- Avatar -->
            <v-avatar v-if="msg.senderType !== 'self'" size="32" class="mb-1 mx-2" color="grey-lighten-3">
              <v-img 
                v-if="getSenderAvatar(msg)" 
                :src="getSenderAvatar(msg)"
                referrerpolicy="no-referrer"
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

            <div style="max-width: min(75%, 600px);">
              <!-- Sender Name (Groups) -->
              <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1 px-1 font-weight-medium text-grey">
                {{ msg.senderName || 'Người dùng Zalo' }}
              </div>
              
              <v-menu v-model="menuStates[msg.id]" width="270" :close-on-content-click="true" scroll-strategy="close" transition="scale-transition" location="bottom end">
                <template v-slot:activator="{ props }">
                  <div 
                    class="message-bubble pa-2 px-3 position-relative cursor-pointer" 
                    :class="[
                      msg.senderType === 'self' ? 'message-self' : 'message-contact',
                      (msg.contentType === 'image' || msg.contentType === 'video' || msg.contentType === 'sticker') ? 'bubble-transparent' : ''
                    ]" 
                    style="word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap;"
                    v-bind="{ ...props, onClick: undefined }"
                    @contextmenu.prevent="openContextMenu(msg.id)"
                  >
                <!-- Menu Content moved below -->
                <!-- Quote (Reply Preview) -->
                <div v-if="msg.quote" class="quote-block pa-2 mb-2 mt-1 rounded" style="cursor: pointer; border-left: 4px solid #1976D2; min-width: 150px;">
                  <div class="text-caption font-weight-bold quote-sender">{{ msg.quote.senderName || 'Khách' }}</div>
                  <div class="text-caption text-truncate quote-content" style="max-width: 250px;">{{ getQuotePreview(msg.quote) }}</div>
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
                  <div class="video-preview-area position-relative" @click="!msg.isUploading && openVideoPreview(msg)" :style="msg.isUploading ? 'opacity: 0.6' : ''">
                    <v-img v-if="getVideoThumb(msg)" :src="getVideoThumb(msg)!" class="chat-video-thumb" cover />
                    <div v-else class="video-preview-fallback bg-black d-flex align-center justify-center">
                      <video :src="getVideoUrl(msg)!" preload="metadata" class="video-preview-frame"></video>
                    </div>
                    <div class="video-play-button" v-if="!msg.isUploading">
                      <v-icon size="40" color="white">mdi-play</v-icon>
                    </div>
                    <div v-if="getVideoDuration(msg) && !msg.isUploading" class="video-duration-badge">{{ getVideoDuration(msg) }}</div>
                    <div v-if="msg.isUploading" class="position-absolute d-flex align-center justify-center" style="top: 0; left: 0; right: 0; bottom: 0;">
                      <v-progress-circular indeterminate color="primary"></v-progress-circular>
                    </div>
                  </div>
                  <div class="video-info-bar pa-2 d-flex align-center">
                    <v-icon size="24" color="primary" class="mr-2">mdi-play-box-outline</v-icon>
                    <div class="flex-grow-1 overflow-hidden">
                      <div class="text-caption font-weight-bold text-truncate">{{ getFileInfo(msg)?.name || 'Video' }}</div>
                      <div class="text-caption text-grey" style="font-size: 0.65rem;">{{ getFileInfo(msg)?.size || '0 MB' }} • Đã có trên máy</div>
                    </div>
                    <v-btn v-if="getVideoUrl(msg) && !msg.isUploading" icon size="x-small" variant="text" class="ml-1" @click.stop="openFile(getVideoUrl(msg)!)">
                      <v-icon size="18">mdi-download</v-icon>
                    </v-btn>
                  </div>
                  <div v-if="getMessageCaption(msg)" class="pa-2 pt-0 msg-caption white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Image -->
                <div v-else-if="getImageUrl(msg)" class="position-relative">
                  <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="!msg.isUploading && openImagePreview(getImageUrl(msg)!)" :style="msg.isUploading ? 'opacity: 0.6' : ''" />
                  <div v-if="msg.isUploading" class="position-absolute d-flex align-center justify-center" style="top: 0; left: 0; right: 0; bottom: 0;">
                    <v-progress-circular indeterminate color="primary"></v-progress-circular>
                  </div>
                  <div v-if="getMessageCaption(msg)" class="msg-caption mt-1 white-space-pre-wrap">{{ getMessageCaption(msg) }}</div>
                </div>
                <!-- Sticker -->
                <div v-else-if="msg.contentType === 'sticker'" class="sticker-message">
                  <v-img v-if="getStickerUrl(msg)" :src="getStickerUrl(msg)!" width="120" height="120" contain>
                    <template v-slot:error>
                      <div class="d-flex align-center justify-center fill-height bg-grey-lighten-2 rounded pa-4">
                        <v-icon icon="mdi-sticker-emoji" size="x-large" color="grey-darken-1" />
                      </div>
                    </template>
                  </v-img>
                  <div v-else class="text-caption text-grey-darken-1" style="word-break: break-all; max-width: 250px;">
                    <v-icon icon="mdi-sticker-emoji" size="small" class="mr-1" /> RAW: {{ msg.content || 'Trống' }}
                  </div>
                </div>
                <!-- File/PDF -->
                <div v-else-if="getFileInfo(msg)">
                  <div class="file-card position-relative" :style="msg.isUploading ? 'opacity: 0.6' : ''">
                    <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
                    <div class="flex-grow-1">
                      <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                      <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                    </div>
                    <v-btn v-if="getFileInfo(msg)!.href && !msg.isUploading" icon size="x-small" variant="text" @click="openFile(getFileInfo(msg)!.href)">
                      <v-icon size="16">mdi-download</v-icon>
                    </v-btn>
                    <div v-if="msg.isUploading" class="position-absolute d-flex align-center justify-center" style="right: 10px; top: 50%; transform: translateY(-50%);">
                      <v-progress-circular indeterminate size="20" color="primary"></v-progress-circular>
                    </div>
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
                </template>
                <v-list density="compact" width="270">
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
                  <v-list-item v-if="msg.senderType === 'self' && !msg.isDeleted && canUndo(msg)" prepend-icon="mdi-delete-sweep" @click="$emit('undo-message', msg.id)" color="error">
                    <v-list-item-title>Thu hồi tin nhắn</v-list-item-title>
                  </v-list-item>
                  <v-list-item v-if="!msg.isUnread" prepend-icon="mdi-email-mark-as-unread" @click="markAsUnread(msg)" color="primary">
                    <v-list-item-title>Đánh dấu là chưa đọc</v-list-item-title>
                  </v-list-item>
                  <v-list-item v-else prepend-icon="mdi-email-open" @click="markAsRead(msg)" color="success">
                    <v-list-item-title>Đánh dấu là đã đọc</v-list-item-title>
                  </v-list-item>
                  <v-list-item v-if="msg.contentType === 'sticker'" prepend-icon="mdi-content-save" @click="saveSticker(msg)">
                    <v-list-item-title>Lưu sticker</v-list-item-title>
                  </v-list-item>
                  <v-list-item v-if="msg.content && !msg.content.startsWith('{')" prepend-icon="mdi-content-copy" @click="copyToClipboard(msg.content)">
                    <v-list-item-title>Sao chép văn bản</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
          </div>
        </template>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Input Area (Zalo Style) -->
      <div v-if="isSelectMode" class="chat-select-action-bar pa-3 bg-grey-lighten-4 border-top d-flex align-center justify-space-between">
        <div>
          <span class="font-weight-bold">Đã chọn {{ selectedMessageIds.length }} tin nhắn</span>
          <div class="text-caption text-grey">Vui lòng chọn các tin nhắn cần chia sẻ cho Kỹ thuật viên</div>
        </div>
        <div>
          <v-btn variant="text" color="grey-darken-1" class="mr-2" @click="cancelSelectMode">Hủy</v-btn>
          <v-btn color="primary" :disabled="selectedMessageIds.length === 0" @click="confirmSupportSession">Tiếp tục</v-btn>
        </div>
      </div>
      <div v-else class="chat-input-wrapper">
        <AiSuggestionPanel
          v-if="showAiPanel || aiSuggestionLoading"
          :suggestion="aiSuggestion"
          :loading="aiSuggestionLoading"
          :error="aiSuggestionError"
          @generate="$emit('ask-ai')"
          @apply="applySuggestion"
        />

        <div class="d-flex align-center px-2 py-1 chat-toolbar border-bottom position-relative">
          <v-btn icon="mdi-sticker-emoji" variant="text" size="x-small" class="toolbar-btn mx-1" id="sticker-btn" />
          
          <v-menu v-model="showStickerMenu" activator="#sticker-btn" :close-on-content-click="false" location="top" offset="5">
            <v-card width="360" max-width="calc(100vw - 16px)" height="300" class="d-flex flex-column rounded-lg">
              <v-tabs v-model="activeStickerTab" density="compact" color="primary" class="border-b" show-arrows>
                <v-tab v-for="pack in stickerPacks" :key="pack.cateId" :value="pack.cateId" class="text-caption font-weight-bold">{{ pack.name }}</v-tab>
              </v-tabs>
              <v-window v-model="activeStickerTab" class="flex-grow-1">
                <v-window-item v-for="pack in stickerPacks" :key="pack.cateId" :value="pack.cateId">
                  <div class="d-flex flex-wrap pa-2 overflow-y-auto" style="height: 252px;">
                    <v-hover v-for="st in pack.stickers" :key="st.id" v-slot="{ isHovering, props }">
                      <div v-bind="props" class="ma-1 pa-1 cursor-pointer rounded" :class="isHovering ? 'bg-grey-lighten-3' : ''" @click="handleSendSticker(st)">
                        <v-img :src="st.url" width="60" height="60" contain>
                          <template v-slot:error>
                            <div class="d-flex align-center justify-center fill-height bg-grey-lighten-2 rounded">
                              <v-icon icon="mdi-sticker-emoji" color="grey-darken-1" />
                            </div>
                          </template>
                        </v-img>
                      </div>
                    </v-hover>
                  </div>
                </v-window-item>
              </v-window>
            </v-card>
          </v-menu>

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

        <div v-if="replyingToMessage" class="reply-preview pa-2 mx-3 mt-2 d-flex align-start rounded-lg">
          <v-icon size="20" color="primary" class="mr-2 mt-1">mdi-reply</v-icon>
          <div class="flex-grow-1 overflow-hidden" style="border-left: 3px solid #1976D2; padding-left: 8px;">
            <div class="text-caption font-weight-bold reply-sender">{{ replyingToMessage.senderName || 'Khách' }}</div>
            <div class="text-caption text-truncate reply-text">{{ getQuotePreview(replyingToMessage) }}</div>
          </div>
          <v-btn icon="mdi-close" size="x-small" variant="text" color="grey" @click="cancelReply" />
        </div>

        <div class="d-flex align-end px-3 py-2">
          <input type="file" ref="fileInput" class="d-none" @change="handleFileChange" />
          <v-textarea
            v-model="inputText"
            :placeholder="`Gửi tin nhắn bằng nick zalo ${conversation?.zaloAccount?.displayName || 'Zalo'}`"
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
    <v-dialog v-model="showImagePreview" max-width="1100">
      <v-card theme="dark" class="bg-black rounded-xl overflow-hidden border-slate-700" elevation="24">
        <div class="image-preview-container d-flex align-center justify-center position-relative" style="min-height: 450px; padding: 24px; background-color: #090D16;">
          <v-btn
            icon="mdi-close"
            position="absolute"
            size="large"
            variant="flat"
            color="white"
            style="top: 16px; right: 16px; z-index: 200; background: rgba(0, 0, 0, 0.8) !important; border: 2px solid rgba(255, 255, 255, 0.5) !important; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.8);"
            @click="closeImagePreview"
          />
          
          <v-btn
            v-if="previewImageIndex > 0"
            icon="mdi-chevron-left"
            position="absolute"
            size="large"
            variant="flat"
            color="white"
            style="left: 16px; top: 50%; transform: translateY(-50%); z-index: 200; background: rgba(0, 0, 0, 0.8) !important; border: 2px solid rgba(255, 255, 255, 0.5) !important; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.8);"
            @click="prevImage"
          />
          
          <img :src="previewImageUrl" alt="Preview" class="preview-img rounded-lg" style="max-height: 85vh; max-width: 100%; object-fit: contain;" />
          
          <v-btn
            v-if="previewImageIndex < imageMessages.length - 1"
            icon="mdi-chevron-right"
            position="absolute"
            size="large"
            variant="flat"
            color="white"
            style="right: 16px; top: 50%; transform: translateY(-50%); z-index: 200; background: rgba(0, 0, 0, 0.8) !important; border: 2px solid rgba(255, 255, 255, 0.5) !important; backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.8);"
            @click="nextImage"
          />
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
  (e: 'send', content: string, contentType: string, fileHash: string | undefined, mentions?: any[], quote?: any, extraPayload?: any): void
  (e: 'send-attachment', file: File, caption: string): void
  (e: 'send-reaction', msgId: string, icon: string): void
  (e: 'undo-message', msgId: string): void
  (e: 'load-more'): void
  (e: 'create-support-session', selectedIds: string[]): void
}>();

const { markMessageUnread, markMessageRead } = useChat();

const authStore = useAuthStore();

function canUndo(msg: Message): boolean {
  if (!msg.sentAt) return false;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return Date.now() - new Date(msg.sentAt).getTime() <= ONE_DAY_MS;
}

function canChatWithMember(member: any): boolean {
  if (!authStore.user) return false;
  // Strictly allow direct chat only if the contact is assigned to the logged-in user
  return member.assignedUserId === authStore.user.id;
}

const showAiPanel = ref(false);
const inputText = ref('');
const menuStates = ref<Record<string, boolean>>({});

function openContextMenu(msgId: string) {
  Object.keys(menuStates.value).forEach(id => {
    menuStates.value[id] = false;
  });
  menuStates.value[msgId] = true;
}

// --- Support Session Select Mode ---
const isSelectMode = ref(false);
const selectedMessageIds = ref<string[]>([]);
const cancelingSession = ref(false);

const activeSupportSession = computed(() => {
  if (props.conversation && (props.conversation as any).supportSessions && (props.conversation as any).supportSessions.length > 0) {
    return (props.conversation as any).supportSessions[0];
  }
  return null;
});

const isSessionCreator = computed(() => {
  return activeSupportSession.value?.sharedByUserId === authStore.user?.id;
});

async function cancelActiveSupportSession() {
  if (!activeSupportSession.value) return;
  if (!confirm('Bạn có chắc chắn muốn kết thúc phiên hỗ trợ này?')) return;
  
  cancelingSession.value = true;
  try {
    await api.put(`/support-sessions/${activeSupportSession.value.id}/close`);
    // Optimistically remove from local state
    if (props.conversation && (props.conversation as any).supportSessions) {
      (props.conversation as any).supportSessions = [];
    }
  } catch (err: any) {
    alert(err.response?.data?.error || 'Lỗi khi hủy phiên hỗ trợ');
  } finally {
    cancelingSession.value = false;
  }
}

function toggleSelectMode() {
  isSelectMode.value = !isSelectMode.value;
  if (!isSelectMode.value) {
    selectedMessageIds.value = [];
  }
}

function cancelSelectMode() {
  isSelectMode.value = false;
  selectedMessageIds.value = [];
}

function confirmSupportSession() {
  if (selectedMessageIds.value.length > 0) {
    emit('create-support-session', selectedMessageIds.value);
  }
}

defineExpose({ cancelSelectMode });

// Watch conversation change to reset select mode
watch(() => props.conversation?.id, () => {
  cancelSelectMode();
});
// ------------------------------------

const messagesContainer = ref<HTMLElement | null>(null);

function onScroll() {
  if (messagesContainer.value && messagesContainer.value.scrollTop <= 50) {
    emit('load-more');
  }
}

const attachment = ref<{ name: string; size: number; file: File; type: 'image' | 'video' | 'file' } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);
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
const showStickerMenu = ref(false);
const replyingToMessage = ref<Message | null>(null);

// Sticker Picker Data (Mock popular Zalo stickers)
const activeStickerTab = ref('1');
const stickerPacks = ref([
  {
    id: 'pack1',
    cateId: '1',
    name: 'Mặc định',
    stickers: [
      { id: '1', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/1.gif' },
      { id: '2', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/2.gif' },
      { id: '3', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/3.gif' },
      { id: '4', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/4.gif' },
      { id: '15', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/15.gif' },
      { id: '25', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/25.gif' },
      { id: '28', cateId: '1', type: 1, url: 'https://stc-chat.zdn.vn/images/stickers/default/28.gif' }
    ]
  },
  {
    id: 'pack2',
    cateId: '2',
    name: 'Hài hước',
    stickers: [
      { id: '23230', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23230&size=130' },
      { id: '23231', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23231&size=130' },
      { id: '23233', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23233&size=130' },
      { id: '23237', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23237&size=130' },
      { id: '23238', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23238&size=130' },
      { id: '23239', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23239&size=130' },
      { id: '23241', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23241&size=130' },
      { id: '23242', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23242&size=130' },
      { id: '23243', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23243&size=130' },
      { id: '23244', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23244&size=130' },
      { id: '23245', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23245&size=130' },
      { id: '23247', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23247&size=130' },
      { id: '23248', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23248&size=130' },
      { id: '23249', cateId: '2', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23249&size=130' }
    ]
  },
  {
    id: 'pack3',
    cateId: '3',
    name: 'Thú vị',
    stickers: [
      { id: '17196', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=17196&size=130' },
      { id: '17199', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=17199&size=130' },
      { id: '17206', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=17206&size=130' },
      { id: '17208', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=17208&size=130' },
      { id: '18646', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=18646&size=130' },
      { id: '18648', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=18648&size=130' },
      { id: '18651', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=18651&size=130' },
      { id: '18657', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=18657&size=130' },
      { id: '18658', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=18658&size=130' },
      { id: '19779', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=19779&size=130' },
      { id: '19782', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=19782&size=130' },
      { id: '23046', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=23046&size=130' },
      { id: '31806', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=31806&size=130' },
      { id: '33347', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=33347&size=130' },
      { id: '42430', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=42430&size=130' },
      { id: '46975', cateId: '3', type: 1, url: 'https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=46975&size=130' }
    ]
  },
  {
    id: 'pack_collected',
    cateId: 'collected',
    name: 'Đã lưu',
    stickers: (() => {
      try { 
        let saved = JSON.parse(localStorage.getItem('crm_collected_stickers') || '[]'); 
        saved = saved.filter((s: any) => 
          !s.url.includes('dicebear.com') && 
          !s.url.includes('eid=43519') &&
          s.id && !String(s.id).startsWith('c_') && String(s.id) !== '0' &&
          s.cateId && String(s.cateId) !== '0'
        );
        localStorage.setItem('crm_collected_stickers', JSON.stringify(saved));
        return saved;
      } catch { return []; }
    })()
  }
]);

function handleSendSticker(st: any) {
  const payload = {
    id: st.id,
    cateId: st.cateId,
    type: st.type,
    url: st.url
  };
  emit('send', JSON.stringify(payload), 'sticker', undefined, undefined, undefined, payload);
  showStickerMenu.value = false;
}

function saveSticker(msg: Message) {
  try {
    let payload;
    if (typeof msg.content === 'string' && msg.content.startsWith('{')) {
      payload = JSON.parse(msg.content);
    } else {
      syncSnack.value = { show: true, text: 'Không thể nhận dạng sticker này', color: 'error' };
      return;
    }
    
    const stickerObj = {
      id: payload.id || payload.stickerId || payload.sticker_id,
      cateId: payload.cateId || payload.categoryId || payload.cate_id || payload.groupId,
      type: payload.type || 1,
      url: payload.url || ((msg as any).attachments && (msg as any).attachments[0]?.url)
    };
    
    if (!stickerObj.url || !stickerObj.id || !stickerObj.cateId || String(stickerObj.cateId) === '0' || String(stickerObj.id) === '0') {
      syncSnack.value = { show: true, text: 'Không tìm thấy dữ liệu ảnh sticker hợp lệ', color: 'error' };
      return;
    }

    let saved = JSON.parse(localStorage.getItem('crm_collected_stickers') || '[]');
    if (!saved.find((s: any) => s.id === stickerObj.id)) {
      saved.push(stickerObj);
      localStorage.setItem('crm_collected_stickers', JSON.stringify(saved));
      
      const pack = stickerPacks.value.find(p => p.cateId === 'collected');
      if (pack) {
        pack.stickers = saved;
      }
      syncSnack.value = { show: true, text: 'Đã lưu sticker thành công!', color: 'success' };
    } else {
      syncSnack.value = { show: true, text: 'Sticker này đã được lưu trước đó.', color: 'info' };
    }
  } catch (err) {
    console.error('Failed to save sticker:', err);
    syncSnack.value = { show: true, text: 'Lỗi khi lưu sticker', color: 'error' };
  }
}

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
  if (replyingToMessage.value && (replyingToMessage.value as any).zaloMsgId) {
    const repMsg = replyingToMessage.value;
    quote = {
      content: getQuotePreview(repMsg),
      msgType: repMsg.contentType === 'image' ? 'chat.photo' : 'chat.text',
      uidFrom: repMsg.senderUid || '',
      senderName: repMsg.senderName || 'Khách',
      msgId: (repMsg as any).zaloMsgId,
      cliMsgId: (repMsg as any).zaloMsgId,
      ownerId: repMsg.senderUid || ''
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
  if (msg.contentType === 'video' || msg.contentType === 'chat.video') return true;
  if (msg.contentType === 'file' || msg.contentType === 'chat.file' || msg.content?.includes('"type":"file"') || msg.content?.includes('"msgType":"chat.file"')) {
    try {
      const p = JSON.parse(msg.content!);
      const name = (p.name || p.title || p.fileName || '').toLowerCase();
      if (name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.avi') || name.endsWith('.mkv') || name.endsWith('.webm')) {
        return true;
      }
    } catch {}
  }
  return false;
}
function getVideoUrl(msg: Message) { 
  if (msg.tempUrl) return msg.tempUrl;
  try { const p = JSON.parse(msg.content!); return p.href || p.url || ''; } catch { return ''; } 
}
function getVideoThumb(msg: Message) { 
  if (msg.tempUrl) return null;
  try { return JSON.parse(msg.content!).thumb; } catch { return null; } 
}
function getVideoDuration(_msg: Message) { return ''; }
function getStickerUrl(msg: Message) {
  if (msg.contentType !== 'sticker') return null;
  if (!msg.content && !(msg as any).attachments) return null;
  try {
    let p: any = {};
    if (msg.content) {
      try { p = JSON.parse(msg.content); } catch (e) {}
    }
    
    // Recursive search for sticker URL
    const findUrl = (obj: any): string | null => {
      if (!obj || typeof obj !== 'object') return null;
      if (typeof obj.stickerUrl === 'string' && obj.stickerUrl.startsWith('http')) return obj.stickerUrl;
      if (typeof obj.href === 'string' && obj.href.includes('api/emoticon')) return obj.href;
      if (typeof obj.url === 'string' && obj.url.includes('api/emoticon')) return obj.url;
      if (typeof obj.stickerSpriteUrl === 'string' && obj.stickerSpriteUrl.startsWith('http')) return obj.stickerSpriteUrl;
      if (typeof obj.stickerWebpUrl === 'string' && obj.stickerWebpUrl.startsWith('http')) return obj.stickerWebpUrl;
      
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const found = findUrl(obj[key]);
          if (found) return found;
        }
      }
      return null;
    };
    
    const explicitUrl = findUrl(p) || p.stickerUrl || p.href || p.url || p.stickerSpriteUrl || null;
    if (explicitUrl) return explicitUrl;

    // Fallback: If Zalo only sends {id, catId, type}, construct the URL dynamically
    const eid = p.id || p.stickerId;
    if (eid !== undefined) {
      // Small IDs (usually catId 0 or 1) correspond to Zalo's default animated gifs
      const catId = p.catId !== undefined ? p.catId : p.cateId;
      if ((catId === 0 || catId === 1) && Number(eid) < 200) {
        return `https://stc-chat.zdn.vn/images/stickers/default/${eid}.gif`;
      }
      return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${eid}&size=130`;
    }

    // Try msg.attachments as ultimate fallback
    if ((msg as any).attachments && Array.isArray((msg as any).attachments) && (msg as any).attachments.length > 0) {
      const attachUrl = (msg as any).attachments[0].url;
      if (attachUrl) return attachUrl;
    }
    
    return null;
  } catch (err) {
    if (msg.content && msg.content.startsWith('http')) return msg.content;
    return null;
  }
}
function getImageUrl(msg: Message) { 
  if (msg.tempUrl) return msg.tempUrl;

  const isImgType = msg.contentType === 'image' || msg.contentType === 'photo' || msg.contentType === 'chat.photo';
  if (isImgType) {
    if (!msg.content) return null;
    try { 
      const p = JSON.parse(msg.content); 
      return p.href || p.url || p.hd || p.thumb || p.qrCodeUrl || (msg.content.startsWith('http') ? msg.content : null); 
    } catch { 
      return msg.content.startsWith('http') ? msg.content : null; 
    }
  }

  // Robust fallback for Zalo JSON structure
  if (msg.content && msg.content.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const url = p.href || p.url || p.hd || p.thumb;
      if (url && typeof url === 'string' && (url.startsWith('http') || url.startsWith('/api/v1/media'))) {
        const lowerUrl = url.toLowerCase();
        const lowerName = (p.name || p.title || p.fileName || '').toLowerCase();
        const msgType = (p.msgType || p.type || '').toLowerCase();
        const isImgExt = lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg') || lowerUrl.includes('.png') || lowerUrl.includes('.webp') || lowerUrl.includes('.gif') ||
                         lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp') || lowerName.endsWith('.gif');
        const isImgMsgType = msgType === 'image' || msgType === 'photo' || msgType.includes('photo') || msgType.includes('image');
        if (isImgExt || isImgMsgType || p.hd || p.thumb) {
          return url;
        }
      }
    } catch {}
  }
  return null;
}
function getFileInfo(msg: Message) { 
  if (msg.tempFile) {
    let sizeStr: number | string = msg.tempFile.size || 0;
    if (typeof sizeStr === 'number') {
      sizeStr = (sizeStr / (1024 * 1024)).toFixed(2) + ' MB';
    }
    return { name: msg.tempFile.name, size: sizeStr, href: '' }; 
  }

  if (!msg.content) return null;

  const isFileContentType = msg.contentType === 'file' || msg.contentType === 'chat.file' || msg.contentType === 'document';

  if (isFileContentType || msg.content.includes('"type":"file"') || msg.content.includes('"msgType":"chat.file"')) {
    try { 
      const p = JSON.parse(msg.content);
      let sizeStr = p.size || '0 MB';
      if (typeof p.size === 'number') {
        sizeStr = (p.size / (1024 * 1024)).toFixed(2) + ' MB';
      }
      return { name: p.name || p.title || 'Tập tin', size: sizeStr, href: p.href || p.url || '' }; 
    } catch { 
      return { name: 'Tập tin', size: '', href: msg.content.startsWith('http') ? msg.content : '' }; 
    } 
  }

  // Fallback for Zalo JSON file attachments
  if (msg.content.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const url = p.href || p.url;
      if (url && typeof url === 'string' && (url.startsWith('http') || url.startsWith('/api/v1/media'))) {
        const msgType = (p.msgType || p.type || '').toLowerCase();
        if (p.name || p.title || p.size || msgType === 'file' || msgType.includes('file') || msgType.includes('doc')) {
          let sizeStr = p.size || '0 MB';
          if (typeof p.size === 'number') {
            sizeStr = (p.size / (1024 * 1024)).toFixed(2) + ' MB';
          }
          return { name: p.name || p.title || 'Tập tin', size: sizeStr, href: url };
        }
      }
    } catch {}
  }
  return null;
}
function getMessageCaption(msg: Message) { 
  if (!msg.content) return null;
  try { 
    const p = JSON.parse(msg.content); 
    return p.description || p.caption || p.title || null; 
  } catch { 
    // If it's not JSON, the content itself is the caption
    return msg.content; 
  } 
}

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
    if (p.action === 'zinstant.bankcard') return 'Mã QR thanh toán';
    if (p.action === 'show.profile' || p.action === 'action.open.sendsticker') return p.title || 'Thông báo hệ thống Zalo';
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

// Automatically collect new stickers from incoming/outgoing messages
watch(() => props.messages, (msgs) => {
  if (!msgs || msgs.length === 0) return;
  const collectedPack = stickerPacks.value.find(p => p.id === 'pack_collected');
  if (!collectedPack) return;

  let changed = false;
  msgs.forEach(msg => {
    if (msg.contentType === 'sticker') {
      const url = getStickerUrl(msg);
      if (url) {
        // blocklist to prevent re-collecting unwanted stickers
        if (url.includes('dicebear.com') || url.includes('eid=43519')) return;

        // check if this URL is already in ANY pack
        let exists = false;
        stickerPacks.value.forEach(pack => {
          if (pack.stickers.some((s: any) => s.url === url)) exists = true;
        });
        if (!exists) {
          try {
            let payload: any = {};
            if (typeof msg.content === 'string' && msg.content.startsWith('{')) {
              payload = JSON.parse(msg.content);
            }
            const realId = payload.id || payload.stickerId;
            if (realId && String(realId) !== '0') {
              collectedPack.stickers.unshift({ 
                id: realId, 
                cateId: payload.cateId || payload.categoryId || payload.cate_id || payload.groupId || '0', 
                type: payload.type || 1, 
                url 
              });
              changed = true;
            }
          } catch(e) {}
        }
      }
    }
  });

  if (changed) {
    if (collectedPack.stickers.length > 50) {
      collectedPack.stickers = collectedPack.stickers.slice(0, 50);
    }
    localStorage.setItem('crm_collected_stickers', JSON.stringify(collectedPack.stickers));
  }
}, { deep: true, immediate: true });

</script>

<style scoped>
.chat-messages-area { background-color: #F4F5F7; }
.v-theme--dark .chat-messages-area { background-color: #121212; }
.message-bubble { font-size: 14px; line-height: 1.5; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.message-self { background-color: #C7E9FF; color: #000 !important; }
.message-contact { background-color: #FFF; color: #000 !important; }
.v-theme--dark .message-self { background-color: #005B96; color: #FFF !important; }
.v-theme--dark .message-contact { background-color: #2C2C2C; color: #E0E0E0 !important; }

.bubble-transparent { background: transparent !important; box-shadow: none !important; padding: 4px !important; }

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

/* Quote Block Inside Bubbles */
.quote-block {
  background: rgba(0, 0, 0, 0.05);
}
.quote-sender {
  color: #1976D2 !important;
}
.quote-content {
  color: #424242 !important;
}

/* Light mode self message quote block */
.message-self .quote-block {
  background: rgba(0, 0, 0, 0.08);
}
.message-self .quote-sender {
  color: #0d47a1 !important;
}
.message-self .quote-content {
  color: #212121 !important;
}

/* Dark mode quote block */
.v-theme--dark .quote-block {
  background: rgba(0, 0, 0, 0.3);
}
.v-theme--dark .quote-sender {
  color: #64B5F6 !important;
}
.v-theme--dark .quote-content {
  color: #E0E0E0 !important;
}
.v-theme--dark .message-self .quote-block {
  background: rgba(255, 255, 255, 0.2);
}
.v-theme--dark .message-self .quote-sender {
  color: #FFFFFF !important;
}
.v-theme--dark .message-self .quote-content {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Reply Preview Bar at Bottom of Chat */
.reply-preview {
  background: #F0F4F8;
  border: 1px solid #CBD5E1;
}
.reply-sender {
  color: #1976D2 !important;
}
.reply-text {
  color: #334155 !important;
}

.v-theme--dark .reply-preview {
  background: #1E293B;
  border: 1px solid #334155;
}
.v-theme--dark .reply-sender {
  color: #64B5F6 !important;
}
.v-theme--dark .reply-text {
  color: #F1F5F9 !important;
}
</style>
