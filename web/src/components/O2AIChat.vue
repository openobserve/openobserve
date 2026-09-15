<template>
  <div
    class="chat-container rounded-surface text-text-body bg-card-glass-solid shadow-hover-shadow flex h-full w-full flex-col overflow-hidden shadow-md"
    :class="[{ 'chat-open': isOpen }]"
  >
    <div v-if="isOpen" class="chat-content-wrapper flex h-full flex-col bg-transparent">
      <div
        class="chat-header border-separator bg-surface-base z-2 flex shrink-0 items-end justify-between border-b px-3 pt-0 pb-1"
        :style="{ height: headerHeight ? headerHeight + 'px' : '' }"
      >
        <div class="chat-title flex w-full items-center justify-between font-bold">
          <div class="flex min-w-0 items-center gap-2">
            <div class="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full">
              <img :src="o2AiTitleLogo" class="h-full w-full object-cover" />
            </div>

            <ODropdown @update:open="(v) => v && loadHistory()">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="sm"
                  class="chat-title-dropdown rounded-default hover:bg-interactive-hover-bg flex h-8 min-h-8 max-w-40 min-w-0 items-center overflow-hidden px-3 py-1.5 transition-colors duration-200"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="chat-title-text text-text-body block min-w-0 truncate text-sm font-medium"
                    >
                      {{ displayedTitle || t("common.newChat") }}
                      <OTooltip
                        v-if="displayedTitle && displayedTitle.length > 25"
                        :sideOffset="8"
                        side="bottom"
                        align="center"
                        :content="raw(displayedTitle)"
                      />
                    </span>
                    <OIcon name="arrow-drop-down" size="md" class="flex-shrink-0" />
                  </div>
                </OButton>
              </template>
              <O2AIChatHistoryMenu
                v-model:search-term="historySearchTerm"
                :chats="filteredChatHistory"
                @select="loadChat"
                @delete="deleteChat"
                @clear-all="clearAllConversations"
              />
            </ODropdown>
          </div>

          <div class="chat-header-actions flex shrink-0 items-center gap-1">
            <!-- Edit title button -->
            <OButton
              v-if="currentChatId"
              variant="ghost"
              size="icon-sm"
              @click.stop="openEditTitleDialog"
            >
              <OIcon name="edit" size="sm" />
              <OTooltip :content="t('aiAssistant.editTitleTooltip')" />
            </OButton>
            <OButton variant="ghost" size="icon-sm" @click="addNewChat">
              <OIcon name="add" size="sm" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              data-test="ai-chat-expand-btn"
              @click="toggleExpand"
            >
              <OIcon
                :name="store.state.isAiChatExpanded ? 'close-fullscreen' : 'open-in-full'"
                size="sm"
              />
              <OTooltip
                :content="
                  t('common.collapseExpandShortcut', {
                    action: store.state.isAiChatExpanded
                      ? t('common.collapse')
                      : t('common.expand'),
                    shortcut: isMac ? '⌘' : 'Ctrl+',
                  })
                "
              />
            </OButton>
            <OButton variant="ghost" size="icon-sm" @click="$emit('close')">
              <OIcon name="close" size="sm" />
            </OButton>
          </div>
        </div>
      </div>

      <!-- History Panel -->
      <ODrawer
        data-test="o2-ai-chat-history-drawer"
        bleed
        v-model:open="showHistory"
        size="sm"
        :title="t('aiAssistant.chatHistory')"
      >
        <ul class="divide-border flex flex-col divide-y">
          <li
            v-for="chat in chatHistory"
            :key="chat.id"
            :data-test="`o2-ai-chat-history-item-${chat.id}`"
            class="hover:bg-muted/50 flex cursor-pointer flex-col px-3 py-2"
            @click="loadChat(chat.id)"
          >
            <span class="text-sm">{{ chat.title }}</span>
            <span class="text-muted-foreground block text-xs">
              {{ new Date(chat.timestamp).toLocaleString() }}
            </span>
            <span class="text-muted-foreground block text-xs">
              {{ t("aiAssistant.modelLabel") }} {{ chat.model }}
            </span>
          </li>
        </ul>
      </ODrawer>

      <!-- Edit Title Dialog -->
      <ODialog
        data-test="o2-ai-chat-edit-title-dialog"
        v-model:open="showEditTitleDialog"
        size="sm"
        :title="t('aiAssistant.editChatTitle')"
        :secondary-button-label="t('common.cancel')"
        :primary-button-label="t('common.save')"
        @click:secondary="showEditTitleDialog = false"
        @click:primary="saveEditedTitle"
      >
        <OInput
          v-model="editingTitle"
          autofocus
          @keyup.enter="saveEditedTitle"
          :placeholder="t('aiAssistant.enterChatTitle')"
        />
      </ODialog>

      <!-- Delete Chat Confirmation Dialog -->
      <ConfirmDialog
        v-model="showDeleteChatConfirmDialog"
        :title="t('aiAssistant.deleteChat')"
        :message="t('aiAssistant.deleteChatConfirmMessage')"
        @update:ok="confirmDeleteChat"
        @update:cancel="showDeleteChatConfirmDialog = false"
      />

      <!-- Clear All Conversations Confirmation Dialog -->
      <ConfirmDialog
        v-model="showClearAllConfirmDialog"
        :title="t('aiAssistant.clearAllConversationsTitle')"
        :message="t('aiAssistant.clearAllConversationsMessage')"
        @update:ok="confirmClearAllConversations"
        @update:cancel="showClearAllConfirmDialog = false"
      />

      <!-- Image Preview Dialog -->
      <ODialog
        data-test="o2-ai-chat-image-preview-dialog"
        v-model:open="showImagePreview"
        @update:open="(v) => !v && closeImagePreview()"
        size="lg"
        :title="raw(previewImage?.filename)"
      >
        <div class="flex justify-center">
          <img
            v-if="previewImage"
            :src="'data:' + previewImage.mimeType + ';base64,' + previewImage.data"
            :alt="previewImage.filename"
            class="max-h-[80vh] max-w-full object-contain"
          />
        </div>
      </ODialog>

      <div
        class="chat-content relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
      >
        <div
          class="messages-container mx-auto flex min-h-0 w-full max-w-225 flex-1 flex-col gap-4 overflow-y-auto bg-transparent p-2"
          ref="messagesContainer"
          @scroll="checkIfShouldAutoScroll"
        >
          <div
            v-if="chatMessages.length === 0"
            class="welcome-section rounded-default mb-0 flex flex-1 items-center justify-center bg-transparent p-0"
          >
            <!-- Home tab: rich V2 welcome -->
            <O2AIHomeWelcome v-if="centeredStart" @select-prompt="selectWelcomePrompt" />
            <!-- Sidepanel: minimal logo + title -->
            <div v-else class="flex h-full w-full flex-col items-center justify-center">
              <div class="flex flex-col items-center gap-2">
                <img :src="o2AiTitleLogo" />
                <div class="flex items-center gap-2">
                  <span class="text-sm font-[600]">{{
                    t("aiAssistant.welcome.taglineHighlight")
                  }}</span>
                  <!-- Same shared Beta tag as the Workflows screens. -->
                  <BetaBadge />
                </div>
              </div>
            </div>
          </div>
          <O2AIChatMessage
            v-for="(message, index) in processedMessages"
            :key="index"
            :message="message"
            :index="index"
            :is-loading="isLoading"
            :current-analyzing-message="currentAnalyzingMessage"
            :expanded-tool-calls="expandedToolCalls"
            :expanded-log-entries="expandedLogEntries"
            @toggle-tool-call="(blockIndex: number) => toggleToolCallExpanded(index, blockIndex)"
            @toggle-log-entry="(blockIndex: number) => toggleLogEntryExpanded(index, blockIndex)"
            @navigate="handleNavigationAction"
            @retry="retryGeneration"
            @like="likeCodeBlock(index)"
            @dislike="dislikeCodeBlock(index)"
            @preview-image="openImagePreview"
          />
          <!-- Tool call indicator - shows outside message box -->
          <O2AIChatToolCallIndicator
            v-if="activeToolCall"
            :message="activeToolCall.message"
            :context="activeToolCall.context"
          />
          <!-- Standalone loading indicator - only shown when loading with no tool calls -->
          <div
            v-if="isLoading && !activeToolCall"
            class="tool-call-indicator rounded-default border-border-default my-2 flex items-center border px-4 py-3 [background:var(--color-chat-bubble-user)]"
          >
            <div class="tool-call-content flex w-full items-center gap-3">
              <OSpinner variant="dots" size="xs" />
              <span class="tool-call-message text-text-secondary text-sm font-semibold">{{
                currentAnalyzingMessage
              }}</span>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button -->
        <div
          v-show="showScrollToBottom"
          class="scroll-to-bottom-container pointer-events-none absolute bottom-2.5 left-1/2 z-1000 -translate-x-1/2 [transition:all_0.3s_ease]"
        >
          <OButton
            variant="ghost"
            size="icon-sm"
            class="scroll-to-bottom-btn border-text-link! text-text-link! bg-surface-base! dark:border-ai-accent! dark:text-ai-accent! dark:bg-surface-base! hover:border-text-link! hover:text-text-link! hover:bg-surface-base! dark:hover:border-ai-accent! dark:hover:text-ai-accent! dark:hover:bg-surface-base! pointer-events-auto border-2! shadow-sm [backdrop-filter:blur(0.5rem)] transition-all duration-300 hover:scale-110 hover:shadow-md active:scale-100"
            @click="scrollToBottomSmooth"
          >
            <OIcon name="arrow-downward" size="sm" />
            <OTooltip side="top" align="center" :content="t('aiAssistant.scrollToBottom')" />
          </OButton>
        </div>
      </div>

      <!-- Fixed loading indicator above input - only shown when scrolled up -->
      <div
        v-if="(isLoading || activeToolCall) && showScrollToBottom"
        class="fixed-analyzing-indicator rounded-default border-border-default mx-4 mb-2 flex items-center justify-center border px-4 py-3 shadow-sm [background:var(--color-chat-bubble-user)]"
      >
        <!-- Show tool call if active -->
        <div
          v-if="activeToolCall"
          class="analyzing-content flex w-full max-w-225 items-center gap-3"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-theme-accent text-sm font-medium">{{
            activeToolCall.message
          }}</span>
        </div>
        <!-- Show analyzing message if loading but no active tool call -->
        <div
          v-else-if="isLoading"
          class="analyzing-content flex w-full max-w-225 items-center gap-3"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-theme-accent text-sm font-medium">{{
            currentAnalyzingMessage
          }}</span>
        </div>
      </div>

      <div class="chat-input-container relative mx-auto my-2 w-full max-w-225 shrink-0 px-2">
        <!-- Confirmation dialog -->
        <O2AIConfirmDialog
          :visible="pendingConfirmation !== null"
          :confirmation="pendingConfirmation"
          @confirm="handleToolConfirm"
          @cancel="handleToolCancel"
          @always-confirm="handleToolAlwaysConfirm"
        />

        <!-- Hidden file input for image upload -->
        <input
          ref="imageInputRef"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          class="hidden"
          @change="handleImageSelect"
        />

        <O2AIChatInput
          v-if="!pendingConfirmation"
          v-model="inputMessage"
          v-model:auto-navigation="isAutoNavigationEnabled"
          :pending-images="pendingImages"
          :placeholder="raw(inputPlaceholder)"
          :is-loading="isLoading"
          :theme="store.state.theme"
          :references="contextReferences"
          @dragover="handleDragOver"
          @drop="handleDrop"
          @paste="handlePaste"
          @input-ref="(instance: any) => (chatInput = instance)"
          @keydown="handleKeyDown"
          @update:references="handleReferencesUpdate"
          @send="sendMessage"
          @cancel="cancelCurrentRequest"
          @trigger-image-upload="triggerImageUpload"
          @remove-image="removeImage"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, watch, computed, onUnmounted } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter, useRoute } from "vue-router";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import "highlight.js/styles/github.css";
import "highlight.js/styles/github-dark.css";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import useAiChat from "@/composables/useAiChat";
import { getImageURL } from "@/utils/zincutils";
import { ChatMessage } from "@/ts/interfaces/chat";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { ReferenceChip } from "@/components/RichTextInput.vue";
import O2AIConfirmDialog from "@/components/O2AIConfirmDialog.vue";
import O2AIHomeWelcome from "@/components/ai-assistant/welcome/O2AIHomeWelcome.vue";
import O2AIChatHistoryMenu from "@/components/ai-assistant/chat/O2AIChatHistoryMenu.vue";
import O2AIChatInput from "@/components/ai-assistant/chat/O2AIChatInput.vue";
import O2AIChatMessage from "@/components/ai-assistant/chat/O2AIChatMessage.vue";
import O2AIChatToolCallIndicator from "@/components/ai-assistant/chat/O2AIChatToolCallIndicator.vue";
import { useChatHistory } from "@/composables/useChatHistory";
import { useChatImages } from "@/composables/useChatImages";
import { useChatHistoryList } from "@/composables/useChatHistoryList";
import { usePromptHistory } from "@/composables/usePromptHistory";
import { useAutoNavigationPreferences } from "@/composables/useAutoNavigationPreferences";
import { useChatScroll } from "@/composables/useChatScroll";
import { useTypewriter } from "@/composables/useTypewriter";
import { abortBackgroundStreams, useChatStream } from "@/composables/useChatStream";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import OButton from "@/lib/core/Button/OButton.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import {
  createPreview,
  formatLogEntryContent,
  getLanguageDisplay,
  parseLogEntries,
  processHtmlBlock,
  processMessageContent,
  processTextBlock,
  renderMarkdown,
} from "@/components/O2AIChat.content";
import {
  formatContextKey,
  formatContextValue,
  getToolCallDisplayData,
  hasToolCallDetails,
  truncateQuery,
} from "@/components/O2AIChat.toolcall";

const { submitFeedback } = useAiChat();

export default defineComponent({
  name: "O2AIChat",
  components: {
    OButton,
    BetaBadge,
    ConfirmDialog,
    O2AIConfirmDialog,
    O2AIHomeWelcome,
    O2AIChatHistoryMenu,
    O2AIChatInput,
    O2AIChatMessage,
    O2AIChatToolCallIndicator,
    ODropdown,
    ODrawer,
    ODialog,
    OSpinner,
    OIcon,
    OTooltip,
    OInput,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    headerHeight: {
      type: Number,
      default: 0,
    },
    aiChatInputContext: {
      type: String,
      default: "",
    },
    appendMode: {
      type: Boolean,
      default: true,
    },
    aiChatPayload: {
      type: Object as () => {
        text: string;
        autoSend: boolean;
        id: number;
      } | null,
      default: null,
    },
    centeredStart: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const router = useRouter();
    const route = useRoute();
    const inputMessage = ref(props.aiChatInputContext ? props.aiChatInputContext : "");
    const chatMessages = ref<ChatMessage[]>([]);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<any>(null);
    const currentTextSegment = ref("");
    const currentChatId = ref<number | null>(null);
    const store = useStore();
    const { isDark } = useTheme();
    const { t } = useI18nTyped();
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const chatUpdated = computed(() => store.state.chatUpdated);

    const typewriterPrompts = computed(() => [
      t("aiAssistant.placeholderRotation.one"),
      t("aiAssistant.placeholderRotation.two"),
      t("aiAssistant.placeholderRotation.three"),
    ]);
    const typewriterEnabled = computed(
      () => !!props.centeredStart && chatMessages.value.length === 0,
    );
    const { placeholder: typewriterPlaceholder } = useTypewriterPlaceholder(typewriterPrompts, {
      enabled: typewriterEnabled,
      typeSpeedMs: 85,
      eraseSpeedMs: 45,
      holdMs: 2800,
      initialDelayMs: 500,
    });
    const inputPlaceholder = computed(() =>
      props.centeredStart && chatMessages.value.length === 0
        ? typewriterPlaceholder.value || t("common.writeYourPrompt")
        : t("common.writeYourPrompt"),
    );

    const {
      saveToHistory: dbSaveToHistory,
      loadHistory: dbLoadHistory,
      loadChat: dbLoadChat,
      deleteChatById: dbDeleteChatById,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
    } = useChatHistory(
      () => store.state.userInfo.email ?? "",
      () => store.state.selectedOrganization.identifier ?? "",
      t,
    );

    const currentChatTimestamp = ref<string | null>(null);
    const {
      shouldAutoScroll,
      showScrollToBottom,
      getScrollThreshold,
      checkIfShouldAutoScroll,
      scrollToBottom,
      scrollToBottomSmooth,
      scrollToLoadingIndicator,
    } = useChatScroll(messagesContainer);

    const {
      autoNavigationPreferences,
      pendingAutoNavigation,
      isAutoNavigationEnabled,
      loadAutoNavigationPreferences,
      saveAutoNavigationPreferences,
    } = useAutoNavigationPreferences(currentChatId);

    const {
      currentAnalyzingMessage,
      startAnalyzingRotation,
      stopAnalyzingRotation,
      aiGeneratedTitle,
      displayedTitle,
      isTypingTitle,
      animateTitle,
      resetTitleState,
      clearTitleInterval,
      displayedStreamingContent,
      typewriterAnimationId,
      resetTypewriterState,
      animateStreamingText,
    } = useTypewriter(currentTextSegment, t);

    const {
      showHistory,
      chatHistory,
      historySearchTerm,
      filteredChatHistory,
      loadHistory,
      openHistory,
      showEditTitleDialog,
      editingTitle,
      openEditTitleDialog,
      saveEditedTitle,
      showDeleteChatConfirmDialog,
      chatToDelete,
      deleteChat,
      confirmDeleteChat,
      showClearAllConfirmDialog,
      clearAllConversations,
      confirmClearAllConversations,
    } = useChatHistoryList({
      loadHistoryFromDb: dbLoadHistory,
      deleteChatById: dbDeleteChatById,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
      currentChatId,
      displayedTitle,
      aiGeneratedTitle,
      addNewChat: () => addNewChat(),
    });

    const expandedToolCalls = ref<Set<string>>(new Set());

    const expandedLogEntries = ref<Set<string>>(new Set());

    const {
      isLoading,
      currentSessionId,
      lastTraceId,
      saveHistoryLoading,
      pendingConfirmation,
      activeToolCall,
      currentAbortController,
      streamOwnerUnavailable,
      cancelCurrentRequest,
      saveToHistory,
      detachCurrentStream,
      abortAllStreams,
      handleToolConfirm,
      handleToolCancel,
      handleToolAlwaysConfirm,
      handleNavigationAction,
      sendConfirmation,
      isSessionOwnerUnavailable,
      appendErrorBlock,
      runTurn,
      tryReattach,
      disposeRenderFlush,
    } = useChatStream({
      chatMessages,
      currentChatId,
      currentTextSegment,
      dbSaveToHistory,
      store,
      router,
      t,
      scrollToBottom,
      scrollToLoadingIndicator,
      autoNavigationPreferences,
      pendingAutoNavigation,
      isAutoNavigationEnabled,
      saveAutoNavigationPreferences,
      startAnalyzingRotation,
      stopAnalyzingRotation,
      aiGeneratedTitle,
      animateTitle,
      displayedStreamingContent,
      typewriterAnimationId,
      resetTypewriterState,
      animateStreamingText,
    });

    const {
      pendingImages,
      imageInputRef,
      showImagePreview,
      previewImage,
      triggerImageUpload,
      handleImageSelect,
      removeImage,
      clearPendingImages,
      handleDragOver,
      handleDrop,
      handlePaste,
      handleImageReferenceBackspace,
      openImagePreview,
      closeImagePreview,
    } = useChatImages(chatInput, inputMessage, () => focusInput(), t);

    const contextReferences = ref<ReferenceChip[]>([]);

    const componentReady = ref(false);
    const pendingChips = ref<ReferenceChip[]>([]);

    // Set in onUnmounted so the chatUpdated watch can't re-attach a just-detached stream to this dying instance.
    const isUnmounting = ref(false);

    const { historyIndex, isOnFirstLine, navigateHistory, loadQueryHistory, addToHistory } =
      usePromptHistory(inputMessage);

    const capabilities = [
      "1. Create a SQL query for me",
      "2. Convert this SPL query to SQL",
      "3. What is happening on this log line",
      "4. Write a VRL function to parse these log lines",
      "5. What are golden signals for observability",
      "6. How to monitor kubernetes cluster",
      "7. How to monitor docker containers",
      "8. How to monitor aws services",
      "9. How to monitor azure services",
      "10. How to monitor google cloud services",
    ];

    const formatMessage = (content: string) => {
      try {
        return renderMarkdown(content);
      } catch (e) {
        console.error("Error formatting message:", e);
        return content;
      }
    };

    const processPendingChips = () => {
      if (pendingChips.value.length > 0) {
        nextTick(() => {
          if (chatInput.value && typeof chatInput.value.insertChip === "function") {
            focusInput();

            // Check DOM directly for existing chips instead of relying on reactive state
            const inputElement = chatInput.value.$el || chatInput.value;
            const editableDiv =
              inputElement?.querySelector(".rich-text-input") ||
              inputElement?.querySelector("[contenteditable]");
            const hasExistingChips = editableDiv?.querySelector(".reference-chip") !== null;
            const hasExistingText = editableDiv?.textContent?.trim().length > 0;

            if (!props.appendMode && !hasExistingChips && !hasExistingText) {
              if (chatInput.value && typeof chatInput.value.clear === "function") {
                chatInput.value.clear();
              }
              inputMessage.value = "";
            }

            pendingChips.value.forEach((chip) => {
              chatInput.value.insertChip(chip);
            });
            pendingChips.value = [];
          }
        });
      }
    };

    watch(
      () => props.aiChatInputContext,
      (newAiChatInputContext: string) => {
        if (newAiChatInputContext) {
          const contextChip: ReferenceChip = {
            id: `context-${Date.now()}`,
            // Not translated: this filename is spliced into the prompt's `--- Log Entry ---` delimiter, which must stay stable across locales.
            filename: raw("Log Entry"),
            preview: createPreview(newAiChatInputContext, 10),
            fullContent: newAiChatInputContext,
            charCount: newAiChatInputContext.length,
            type: "context",
          };

          pendingChips.value.push(contextChip);

          if (
            componentReady.value &&
            chatInput.value &&
            typeof chatInput.value.insertChip === "function"
          ) {
            // Use a small delay to ensure input is focused and ready
            nextTick(() => {
              setTimeout(() => {
                processPendingChips();
              }, 50);
            });
          }
          // Not ready yet: queued chips are processed when componentReady becomes true.
        }
      },
    );

    // Atomic payload watcher — text + autoSend arrive together, no timing race
    watch(
      () => props.aiChatPayload,
      (payload) => {
        if (!payload?.text) return;
        if (payload.autoSend) {
          inputMessage.value = payload.text;
          nextTick(() => {
            setTimeout(() => {
              sendMessage();
            }, 50);
          });
        }
      },
    );

    const fetchInitialMessage = async () => {
      isLoading.value = true;
      try {
        chatMessages.value = [];
      } catch (error) {
        chatMessages.value = [
          {
            role: "assistant",
            content: t("aiAssistant.backendConnectionError"),
          },
        ];
        console.error("Error fetching initial message:", error);
      }
      isLoading.value = false;
      stopAnalyzingRotation();
      scrollToBottom();
    };

    const toggleExpand = () => {
      if (!store.state.isAiChatEnabled) {
        store.dispatch("setIsAiChatEnabled", true);
        store.dispatch("setIsAiChatExpanded", false);
      } else if (!store.state.isAiChatExpanded) {
        store.dispatch("setIsAiChatExpanded", true);
      } else {
        store.dispatch("setIsAiChatExpanded", false);
      }
      window.dispatchEvent(new Event("resize"));
    };

    useShortcuts([
      {
        id: "aiChatClose",
        key: "escape",
        description: t("shortcuts.actions.aiChatClose"),
        // Escape must close the chat even while typing a message in its input.
        allowInInput: true,
        handler: () => {
          if (store.state.isAiChatEnabled) {
            store.dispatch("setIsAiChatEnabled", false);
            store.dispatch("setIsAiChatExpanded", false);
            window.dispatchEvent(new Event("resize"));
          }
        },
      },
    ]);

    const addNewChat = () => {
      detachCurrentStream();

      chatMessages.value = [];
      currentChatId.value = null;
      currentSessionId.value = null; // Will be generated on first save
      lastTraceId.value = null;
      showHistory.value = false;
      currentChatTimestamp.value = null;
      shouldAutoScroll.value = true;
      resetTitleState();
      resetTypewriterState();
      pendingAutoNavigation.value = true;
      showScrollToBottom.value = false;
      store.dispatch("setCurrentChatTimestamp", null);
      store.dispatch("setChatUpdated", true);
    };

    const loadChat = async (chatId: number) => {
      try {
        if (chatId == null) {
          addNewChat();
          return;
        }

        detachCurrentStream();

        const chat = await dbLoadChat(chatId);

        if (chat) {
          if (!tryReattach(chat, chatId)) {
            const formattedMessages = chat.messages.map((msg: any) => ({
              role: msg.role,
              content: msg.content,
              ...(msg.contentBlocks ? { contentBlocks: msg.contentBlocks } : {}),
              ...(msg.images ? { images: msg.images } : {}),
              ...(msg.feedback ? { feedback: msg.feedback } : {}),
            }));

            chatMessages.value = formattedMessages;
            currentChatId.value = chatId;
            currentSessionId.value = chat.sessionId || null;
          }

          showHistory.value = false;
          shouldAutoScroll.value = true;

          displayedTitle.value = chat.title || "";
          aiGeneratedTitle.value = chat.title || null;
          isTypingTitle.value = false;

          if (chatId !== store.state.currentChatTimestamp) {
            store.dispatch("setCurrentChatTimestamp", chatId);
            store.dispatch("setChatUpdated", true);
          }

          await nextTick();
          scrollToBottom();
        }
      } catch (error) {
        console.error("Error loading chat:", error);
      }
    };

    const sendMessage = async () => {
      const hasText = inputMessage.value.trim().length > 0;
      const hasImages = pendingImages.value.length > 0;
      if ((!hasText && !hasImages) || isLoading.value) return;

      let backendMessage = inputMessage.value;
      if (chatInput.value && typeof chatInput.value.getMessageForBackend === "function") {
        backendMessage = chatInput.value.getMessageForBackend();
      }

      const userMessage = inputMessage.value;
      const messagesToSend = [...pendingImages.value]; // Capture images before clearing

      // Add to query history before clearing input
      if (hasText) {
        addToHistory(userMessage);
      }

      chatMessages.value.push({
        role: "user",
        content: raw(backendMessage),
        ...(hasImages && { images: messagesToSend }),
      });
      inputMessage.value = "";
      contextReferences.value = [];
      if (chatInput.value && typeof chatInput.value.clear === "function") {
        chatInput.value.clear();
      }
      clearPendingImages();
      shouldAutoScroll.value = true;
      await scrollToBottom();
      await saveToHistory();

      await runTurn(hasImages, messagesToSend);
    };

    const selectCapability = (capability: string) => {
      inputMessage.value = capability.replace(/^\d+\.\s/, "");
    };

    const selectWelcomePrompt = (prompt: string) => {
      inputMessage.value = prompt;
      nextTick(() => {
        chatInput.value?.focus?.();
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === "Backspace") {
        handleImageReferenceBackspace(e);
      } else if (e.key === "ArrowUp") {
        const target = e.target as HTMLElement;
        const textarea = target.tagName === "TEXTAREA" ? (target as HTMLTextAreaElement) : null;
        if (textarea && isOnFirstLine(textarea)) {
          e.preventDefault();
          navigateHistory("up");
        }
      } else if (e.key === "ArrowDown" && historyIndex.value > -1) {
        e.preventDefault();
        navigateHistory("down");
      }
    };

    const focusInput = () => {
      if (chatInput.value) {
        if (typeof chatInput.value.focusInput === "function") {
          chatInput.value.focusInput();
        } else {
          chatInput.value.focus();
        }
      }
    };

    const handleReferencesUpdate = (refs: ReferenceChip[]) => {
      contextReferences.value = refs;
    };

    watch(
      () => props.isOpen,
      (newValue) => {
        if (newValue) {
          if (chatMessages.value.length === 0) {
            fetchInitialMessage();
          }
          loadHistory();

          // Slight delay so RichTextInput is fully mounted before pending chips are processed.
          nextTick(() => {
            setTimeout(() => {
              componentReady.value = true;
              processPendingChips();
              focusInput();
            }, 100);
          });
        }
      },
    );

    watch(
      () => store.state.isAiChatExpanded,
      (isExpanded) => {
        if (isExpanded) {
          nextTick(() => {
            setTimeout(() => {
              focusInput();
            }, 150);
          });
        }
      },
    );

    // Reset on org switch so users never see cross-org chat history.
    watch(
      () => store.state.selectedOrganization?.identifier,
      (newOrgId, oldOrgId) => {
        if (newOrgId && newOrgId !== oldOrgId) {
          // A turn started under the old org must not keep streaming and writing history after the switch.
          abortBackgroundStreams();
          addNewChat();
          if (props.isOpen) {
            loadHistory();
          }
        }
      },
    );

    onMounted(() => {
      if (props.isOpen) {
        fetchInitialMessage();
        loadHistory();
        loadChat(store.state.currentChatTimestamp);

        // Slight delay so RichTextInput is fully mounted before pending chips are processed.
        nextTick(() => {
          setTimeout(() => {
            componentReady.value = true;
            processPendingChips();
            focusInput();
          }, 100);
        });
      }

      loadQueryHistory();

      loadAutoNavigationPreferences();

      window.addEventListener("o2:abort-ai-streams", abortAllStreams);
    });

    onUnmounted(() => {
      window.removeEventListener("o2:abort-ai-streams", abortAllStreams);
      // Mark unmounting FIRST so the chatUpdated watch fired by the dispatch below can't re-attach the detached stream here.
      isUnmounting.value = true;

      // Detach, not abort: most mount sites sit behind a v-if, so ordinary navigation unmounts this instance mid-answer.
      const wasStreaming = !!currentAbortController.value;
      detachCurrentStream();
      // detachCurrentStream early-returns without a controller, so clear the rotation interval directly.
      stopAnalyzingRotation();

      // Leaving Home mid-stream opens the sidebar so its instance can re-attach; skip on Home, where it would show beside the AI tab.
      if (
        wasStreaming &&
        props.centeredStart &&
        route.name !== "home" &&
        !store.state.isAiChatEnabled
      ) {
        store.dispatch("setIsAiChatEnabled", true);
      }

      // Background streams are intentionally NOT aborted: surviving unmount is why they were detached.

      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }

      clearTitleInterval();

      // The stream outlives this instance, so a pending render flush would write into dead chatMessages and pin the closure.
      disposeRenderFlush();

      // Only publish the handoff: loadChat() here would re-attach the stream to this dying instance and steal it from the survivor.
      store.dispatch("setCurrentChatTimestamp", currentChatId.value);
      store.dispatch("setChatUpdated", true);
    });
    watch(chatUpdated, (newChatUpdated: boolean) => {
      // A dying instance must not react to its own handoff pulse, or it steals its detached stream back from the survivor.
      if (isUnmounting.value) return;
      if (newChatUpdated && store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if (newChatUpdated && !store.state.currentChatTimestamp) {
        addNewChat();
      }
      store.dispatch("setChatUpdated", false);
    });

    const processedMessages = computed(() => {
      return chatMessages.value.map((message) => {
        if (message.role === "user") {
          const orderedBlocks = parseLogEntries(message.content);

          const combinedContentBlocks =
            orderedBlocks.length > 0
              ? [...orderedBlocks, ...(message.contentBlocks || [])]
              : message.contentBlocks || [];

          return {
            ...message,
            blocks: orderedBlocks.length > 0 ? [] : processMessageContent(message.content),
            contentBlocks: combinedContentBlocks,
          };
        }

        return {
          ...message,
          blocks: processMessageContent(message.content),
          contentBlocks: message.contentBlocks || [],
        };
      });
    });

    const retryGeneration = async (message: any) => {
      if (!message || message.role !== "assistant") return;

      const messageIndex = chatMessages.value.findIndex((m) => m.content === message.content);
      if (messageIndex === -1) return;

      let userMessageIndex = messageIndex - 1;
      while (userMessageIndex >= 0) {
        if (chatMessages.value[userMessageIndex].role === "user") {
          inputMessage.value = chatMessages.value[userMessageIndex].content;
          await sendMessage();
          break;
        }
        userMessageIndex--;
      }
    };

    const formatTime = (timestamp: string) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    const toggleToolCallExpanded = (messageIndex: number, blockIndex: number) => {
      const key = `${messageIndex}-${blockIndex}`;
      if (expandedToolCalls.value.has(key)) {
        expandedToolCalls.value.delete(key);
      } else {
        expandedToolCalls.value.add(key);
      }
    };

    const isToolCallExpanded = (messageIndex: number, blockIndex: number) => {
      return expandedToolCalls.value.has(`${messageIndex}-${blockIndex}`);
    };

    const toggleLogEntryExpanded = (messageIndex: number, blockIndex: number) => {
      const key = `${messageIndex}-${blockIndex}`;
      if (expandedLogEntries.value.has(key)) {
        expandedLogEntries.value.delete(key);
      } else {
        expandedLogEntries.value.add(key);
      }
    };

    const isLogEntryExpanded = (messageIndex: number, blockIndex: number) => {
      return expandedLogEntries.value.has(`${messageIndex}-${blockIndex}`);
    };

    const likeCodeBlock = async (messageIndex: number) => {
      const message = chatMessages.value[messageIndex];
      if (!message || message.feedback === "thumbs_up") return;
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      // Each user+assistant pair = 1 query turn, so queryIndex = floor(index / 2)
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        "thumbs_up",
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        message.feedback = "thumbs_up";
        await saveToHistory();
        toast({
          variant: "success",
          message: t("toastMessages.components.thanksForYourFeedback"),
        });
      }
    };

    const dislikeCodeBlock = async (messageIndex: number) => {
      const message = chatMessages.value[messageIndex];
      if (!message || message.feedback === "thumbs_down") return;
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        "thumbs_down",
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        message.feedback = "thumbs_down";
        await saveToHistory();
        toast({
          variant: "success",
          message: t("toastMessages.components.thanksForYourFeedback"),
        });
      }
    };
    const o2AiTitleLogo = computed(() => {
      return isDark.value
        ? getImageURL("images/common/o2_ai_logo_dark.svg")
        : getImageURL("images/common/o2_ai_logo.svg");
    });

    return {
      raw,
      inputMessage,
      chatMessages,
      isLoading,
      currentAnalyzingMessage,
      sendMessage,
      handleKeyDown,
      focusInput,
      messagesContainer,
      chatInput,
      formatMessage,
      capabilities,
      selectCapability,
      selectWelcomePrompt,
      inputPlaceholder,
      showHistory,
      chatHistory,
      currentChatId,
      addNewChat,
      toggleExpand,
      openHistory,
      loadChat,
      showEditTitleDialog,
      editingTitle,
      openEditTitleDialog,
      saveEditedTitle,
      deleteChat,
      confirmDeleteChat,
      showDeleteChatConfirmDialog,
      chatToDelete,
      clearAllConversations,
      showClearAllConfirmDialog,
      confirmClearAllConversations,
      pendingConfirmation,
      handleToolConfirm,
      handleToolCancel,
      handleToolAlwaysConfirm,
      handleNavigationAction,
      sendConfirmation,
      isSessionOwnerUnavailable,
      appendErrorBlock,
      streamOwnerUnavailable,
      currentSessionId,
      isAutoNavigationEnabled,
      processedMessages,
      processTextBlock,
      copyToClipboard,
      retryGeneration,
      getLanguageDisplay,
      processHtmlBlock,
      formatTime,
      loadHistory,
      store,
      isMac,
      likeCodeBlock,
      dislikeCodeBlock,
      currentChatTimestamp,
      o2AiTitleLogo,
      saveHistoryLoading,
      historySearchTerm,
      filteredChatHistory,
      shouldAutoScroll,
      checkIfShouldAutoScroll,
      getScrollThreshold,
      scrollToLoadingIndicator,
      scrollToBottomSmooth,
      showScrollToBottom,
      cancelCurrentRequest,
      currentAbortController,
      activeToolCall,
      truncateQuery,
      formatContextKey,
      expandedToolCalls,
      toggleToolCallExpanded,
      isToolCallExpanded,
      hasToolCallDetails,
      getToolCallDisplayData,
      formatContextValue,
      expandedLogEntries,
      toggleLogEntryExpanded,
      isLogEntryExpanded,
      formatLogEntryContent,
      aiGeneratedTitle,
      displayedTitle,
      isTypingTitle,
      pendingImages,
      imageInputRef,
      triggerImageUpload,
      handleImageSelect,
      removeImage,
      handleDragOver,
      handleDrop,
      handlePaste,
      showImagePreview,
      previewImage,
      openImagePreview,
      closeImagePreview,
      contextReferences,
      handleReferencesUpdate,
      t,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): @keyframes and its consuming `animation:` must share a block; the scoped compiler renames both together. */

/* Deliberate copy in O2AIChatToolCallIndicator.vue: the standalone loading box here shares this class. */
.tool-call-indicator {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fixed-analyzing-indicator {
  animation: fadeInSlide 0.3s ease;
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.scroll-to-bottom-btn {
  animation: fadeInUp 0.3s ease;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(0.625rem) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
