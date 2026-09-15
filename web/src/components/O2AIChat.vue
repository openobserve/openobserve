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
import {
  defineComponent,
  ref,
  reactive,
  onMounted,
  nextTick,
  watch,
  computed,
  onUnmounted,
  type Ref,
} from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRouter, useRoute } from "vue-router";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import "highlight.js/styles/github.css";
import "highlight.js/styles/github-dark.css";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import useAiChat from "@/composables/useAiChat";
import { getImageURL, getUUIDv7 } from "@/utils/zincutils";
import { ChatMessage, ContentBlock, NavigationAction } from "@/ts/interfaces/chat";

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
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
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
import { extractFrames, extractTailFrames } from "@/components/O2AIChat.framing";
import {
  reduce,
  type ReducerCtx,
  type StreamEffect,
  type StreamPhase,
  type StreamState,
} from "@/components/O2AIChat.reducer";
import {
  buildNavigationRoute,
  generateNavigationFromToolResult as generateNavigation,
  navigationPageName,
} from "@/components/O2AIChat.navigation";
import {
  chatErrorMessage,
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

const { fetchAiChat, submitFeedback } = useAiChat();
const { emit: emitDashboardEvent } = useAiDashboardEvents();

// Module scope, not setup(): O2AIChat mounts in both HomeView and MainLayout, and a stream handed off between them must share this state.
const backgroundStreams = new Set<AbortController>();
const MAX_BACKGROUND_STREAMS = 3;

// loadChat swaps chatMessages.value back to the live msgs so processStream's isActive() identity check writes to the UI again.
const backgroundStreamMap = new Map<
  string,
  {
    msgs: ChatMessage[];
    controller: AbortController;
    chatId: number | null;
  }
>();

// Module scope: processStream resets isLoading only on the instance that started it, so a re-attached instance watches this to clear its spinner.
const sessionStreamingState = reactive<Record<string, boolean>>({});

// Detached streams outlive their component; call only when the turn loses authorization (org switch, logout), never on navigation.
const abortBackgroundStreams = () => {
  for (const controller of backgroundStreams) controller.abort();
  backgroundStreams.clear();
  backgroundStreamMap.clear();
  for (const key of Object.keys(sessionStreamingState)) {
    delete sessionStreamingState[key];
  }
};

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
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<any>(null);
    const currentStreamingMessage = ref("");
    const currentTextSegment = ref("");
    const currentChatId = ref<number | null>(null);
    const currentSessionId = ref<string | null>(null);
    const lastTraceId = ref<string | null>(null); // OTEL trace_id from last workflow for feedback correlation
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
    const saveHistoryLoading = ref(false);
    const {
      shouldAutoScroll,
      showScrollToBottom,
      getScrollThreshold,
      checkIfShouldAutoScroll,
      scrollToBottom,
      scrollToBottomSmooth,
      scrollToLoadingIndicator,
    } = useChatScroll(messagesContainer);

    const pendingConfirmation = ref<{
      tool: string;
      args: Record<string, any>;
      message: I18nText;
      navAction?: NavigationAction;
    } | null>(null);

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

    const activeToolCall = ref<{
      tool: string;
      message: I18nText;
      context: Record<string, any>;
      call_id?: string;
    } | null>(null);

    const currentAbortController = ref<AbortController | null>(null);

    // Throttle save during streaming to prevent data loss on page reload
    const lastStreamingSaveTime = ref<number>(0);
    const STREAMING_SAVE_INTERVAL = 3000;

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
    } = useChatImages(
      chatInput,
      inputMessage,
      () => focusInput(),
      t,
    );

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

    const cancelCurrentRequest = async () => {
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;

        toast({
          message: t("toastMessages.components.responseGenerationStopped"),
          variant: "info",
        });

        isLoading.value = false;
        activeToolCall.value = null;
        stopAnalyzingRotation();

        displayedStreamingContent.value = currentTextSegment.value;
        if (typewriterAnimationId.value) {
          cancelAnimationFrame(typewriterAnimationId.value);
          typewriterAnimationId.value = null;
        }

        if (chatMessages.value.length > 0) {
          const lastMessage = chatMessages.value[chatMessages.value.length - 1];
          if (lastMessage.role === "assistant") {
            if (!lastMessage.content) {
              chatMessages.value.pop();
            } else if (currentStreamingMessage.value) {
              if (lastMessage.contentBlocks) {
                const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                if (lastBlock && lastBlock.type === "text") {
                  lastBlock.text = currentTextSegment.value;
                }
              }
              lastMessage.content = raw(
                lastMessage.content + "\n\n_[" + t("aiAssistant.responseStoppedByUser") + "]_",
              );
            }
          }
        }

        currentStreamingMessage.value = "";
        currentTextSegment.value = "";
        displayedStreamingContent.value = "";

        await saveToHistory();

        await scrollToBottom();
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

    const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let messageComplete = false;

      // Captured array: isActive() is identity against it, so a detached stream keeps writing its own array after a session switch.
      const msgs = chatMessages.value;
      let ctxSessionId = currentSessionId.value;
      let ctxChatId = currentChatId.value;
      let ctxTitle: string | undefined = aiGeneratedTitle.value || undefined;

      // Local streaming accumulators (synced to refs only when active)
      let streamingMsg = currentStreamingMessage.value;
      let textSegment = currentTextSegment.value;

      const isActive = () => chatMessages.value === msgs;

      const syncStreamingRefs = () => {
        if (isActive()) {
          currentStreamingMessage.value = streamingMsg;
          currentTextSegment.value = textSegment;
        }
      };

      const saveCtx = async () => {
        if (msgs.length === 0) return;
        if (!ctxSessionId) {
          ctxSessionId = getUUIDv7();
          if (isActive()) currentSessionId.value = ctxSessionId;
        }
        const title = isActive() ? aiGeneratedTitle.value || undefined : ctxTitle;
        const chatId = isActive() ? currentChatId.value : ctxChatId;
        const resultId = await dbSaveToHistory(msgs, ctxSessionId, title, chatId);
        if (!chatId && resultId) {
          if (isActive()) {
            currentChatId.value = resultId;
            // Persist the actual value (ON by default) so an explicit user disable is honored.
            autoNavigationPreferences.value.set(resultId, pendingAutoNavigation.value);
            saveAutoNavigationPreferences();
          } else {
            ctxChatId = resultId;
          }
        }
      };

      let lastSaveTime = lastStreamingSaveTime.value;
      const throttledSaveCtx = async (force = false) => {
        const now = Date.now();
        if (force || now - lastSaveTime >= STREAMING_SAVE_INTERVAL) {
          lastSaveTime = now;
          if (isActive()) lastStreamingSaveTime.value = now;
          await saveCtx();
        }
      };

      const postConfirmation = async (approved: boolean) => {
        try {
          const orgId = store.state.selectedOrganization.identifier;
          const res = await fetch(
            `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${ctxSessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ approved }),
            },
          );
          // A silent failure leaves the agent paused with nobody left to answer it.
          if (!res.ok) {
            console.error(
              approved
                ? `Auto-approval not registered (HTTP ${res.status}) for session ${ctxSessionId}`
                : `Auto-deny not registered (HTTP ${res.status}) for background stream ${ctxSessionId}`,
            );
          }
        } catch (error) {
          console.error(
            approved
              ? "Error auto-confirming navigation:"
              : "Error auto-denying confirmation for background stream:",
            error,
          );
        }
      };

      const seedState = (): StreamState => ({
        messages: msgs,
        activeToolCall: activeToolCall.value,
        textSegment,
        streamingMsg,
        title: ctxTitle,
        lastTraceId: lastTraceId.value,
        ownerUnavailable: streamOwnerUnavailable.value,
        pendingConfirmation: pendingConfirmation.value,
        messageComplete,
        halted: false,
      });

      // A detached stream must not write a ref the original would have left untouched.
      const setIfChanged = <T,>(target: Ref<T>, value: T) => {
        if (target.value !== value) target.value = value;
      };

      const commitState = (state: StreamState) => {
        textSegment = state.textSegment;
        streamingMsg = state.streamingMsg;
        ctxTitle = state.title;
        messageComplete = state.messageComplete;
        setIfChanged(activeToolCall, state.activeToolCall);
        setIfChanged(lastTraceId, state.lastTraceId);
        setIfChanged(streamOwnerUnavailable, state.ownerUnavailable);
        setIfChanged(pendingConfirmation, state.pendingConfirmation);
      };

      const buildCtx = (phase: StreamPhase): ReducerCtx => ({
        isActive: isActive(),
        autoNavigationEnabled: isAutoNavigationEnabled.value,
        phase,
        t,
        generateNavigation: generateNavigationFromToolResult,
      });

      const runEffects = async (effects: StreamEffect[]) => {
        for (const effect of effects) {
          switch (effect.kind) {
            case "scroll":
              if (!effect.whenActive || isActive()) await scrollToBottom();
              break;
            case "save":
              await saveCtx();
              break;
            case "throttledSave":
              await throttledSaveCtx(effect.force);
              break;
            case "navigate":
              await handleNavigationAction(effect.action);
              break;
            case "confirmPost":
              await postConfirmation(effect.approved);
              break;
            case "dashboardEvent":
              emitDashboardEvent(effect.payload);
              break;
            case "animateTitle":
              aiGeneratedTitle.value = effect.title;
              animateTitle(effect.title);
              break;
            case "syncSegments":
              syncStreamingRefs();
              break;
            case "animateText":
              if (!typewriterAnimationId.value) animateStreamingText();
              break;
            case "finalizeText":
              if (typewriterAnimationId.value) {
                cancelAnimationFrame(typewriterAnimationId.value);
                typewriterAnimationId.value = null;
              }
              displayedStreamingContent.value = "";
              syncStreamingRefs();
              break;
          }
        }
      };

      const applyEvent = async (data: any, phase: StreamPhase) => {
        const state = seedState();
        const effects = reduce(state, data, buildCtx(phase));
        commitState(state);
        await runEffects(effects);
        return state.halted;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const { events, rest } = extractFrames(buffer);
          buffer = rest;

          for (const jsonStr of events) {
            try {
              const data = JSON.parse(jsonStr);

              if (await applyEvent(data, "stream")) return;
            } catch (jsonError) {
              console.debug("JSON parse error:", jsonError, "for line:", jsonStr);
              continue;
            }
          }
        }

        for (const jsonStr of extractTailFrames(buffer)) {
          try {
            const data = JSON.parse(jsonStr);

            if (await applyEvent(data, "tailFlush")) return;
          } catch (e) {
            console.debug("Error processing remaining buffer:", e);
            continue;
          }
        }

        if (messageComplete) {
          if (isActive()) {
            displayedStreamingContent.value = textSegment;
            if (typewriterAnimationId.value) {
              cancelAnimationFrame(typewriterAnimationId.value);
              typewriterAnimationId.value = null;
            }
          }
          const lastMessage = msgs[msgs.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
            const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === "text") {
              lastBlock.text = textSegment;
            }
          }
          await saveCtx();
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // User cancel is expected; a detached stream still needs its final save.
          if (!isActive() && msgs.length > 0 && ctxSessionId) {
            await dbSaveToHistory(msgs, ctxSessionId, ctxTitle, ctxChatId);
          }
          return;
        } else {
          console.error("Error reading stream:", error);
        }
      }
    };

    const saveToHistory = async () => {
      saveHistoryLoading.value = true;
      if (chatMessages.value.length === 0) {
        saveHistoryLoading.value = false;
        return;
      }

      try {
        if (!currentSessionId.value) {
          currentSessionId.value = getUUIDv7();
        }

        const title = aiGeneratedTitle.value || undefined;

        const chatId = await dbSaveToHistory(
          chatMessages.value,
          currentSessionId.value,
          title,
          currentChatId.value,
        );

        if (!currentChatId.value && chatId) {
          currentChatId.value = chatId;

          // Persist the actual value (ON by default) so an explicit user disable is honored.
          autoNavigationPreferences.value.set(chatId, pendingAutoNavigation.value);
          saveAutoNavigationPreferences();
        }
      } catch (error) {
        console.error("Error saving chat history:", error);
      } finally {
        saveHistoryLoading.value = false;
      }
    };

    /** Detach the stream so it keeps writing its captured array in the background and saves via saveCtx() when done. */
    const detachCurrentStream = () => {
      if (!currentAbortController.value) return;

      if (backgroundStreams.size >= MAX_BACKGROUND_STREAMS) {
        const oldest = backgroundStreams.values().next().value;
        if (oldest) {
          oldest.abort();
          backgroundStreams.delete(oldest);
        }
      }
      const detachedController = currentAbortController.value;
      backgroundStreams.add(detachedController);
      currentAbortController.value = null;

      // loadChat re-attaches by swapping chatMessages.value to this live array.
      if (currentSessionId.value) {
        backgroundStreamMap.set(currentSessionId.value, {
          msgs: chatMessages.value,
          controller: detachedController,
          chatId: currentChatId.value,
        });
      }

      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }
      currentStreamingMessage.value = "";
      currentTextSegment.value = "";
      displayedStreamingContent.value = "";
    };

    // Logout must kill the foreground turn too; MainLayout.signout() sends a window event because its Options API half can't reach setup scope.
    const abortAllStreams = () => {
      abortBackgroundStreams();
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;
      }
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

    const resolveConfirmationBlock = (approved: boolean) => {
      for (const msg of chatMessages.value) {
        if (msg.contentBlocks) {
          for (const block of msg.contentBlocks) {
            if (block.pendingConfirmation) {
              block.pendingConfirmation = false;
              if (!approved) {
                block.success = false;
                block.resultMessage = t("aiAssistant.aiChat.actionCancelledByUser");
              }
              return;
            }
          }
        }
      }
    };

    // Set by processStream when the owning replica is gone; the stream already returned 200, so sendMessage reads it after it ends.
    const streamOwnerUnavailable = ref(false);

    // Shown after a restore: only the dialogue came back, not tool results, files or permission decisions.
    const RESTORED_NOTICE =
      "This conversation was interrupted and has been restored. Earlier messages are preserved, but any files, queries or other actions from before the interruption were not carried over.";

    // Keyed on the explicit server code, never a generic failure: restoring abandons the current session.
    const isSessionOwnerUnavailable = (errorBody: unknown): boolean => {
      // `unknown`, not `any` — narrow before reading, or a non-object body throws.
      if (typeof errorBody !== "object" || errorBody === null) return false;
      const body = errorBody as { code?: unknown; detail?: { code?: unknown } };
      const code = body.detail?.code ?? body.code;
      return code === "session_owner_unavailable";
    };

    const appendErrorBlock = (message: string, recoverable = false) => {
      const block: ContentBlock = { type: "error", message: raw(message), recoverable };
      const msgs = chatMessages.value;
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        if (!last.contentBlocks) last.contentBlocks = [];
        last.contentBlocks.push(block);
      } else {
        msgs.push({ role: "assistant", content: raw(""), contentBlocks: [block] });
      }
    };

    /** POST a confirmation answer and report whether it landed, so a 404 from a replica without the pending confirmation isn't silent. */
    const sendConfirmation = async (sessionId: string, approved: boolean): Promise<boolean> => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const res = await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${sessionId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved }),
          },
        );

        if (!res.ok) {
          console.error(
            `Confirmation not registered (HTTP ${res.status}) for session ${sessionId}`,
          );
          appendErrorBlock(
            approved
              ? "Your approval could not be delivered — the assistant may have already cancelled this action. Please check the result before retrying."
              : "Your response could not be delivered — the assistant may have already cancelled this action.",
          );
          return false;
        }
        return true;
      } catch (error) {
        console.error("Error sending confirmation:", error);
        appendErrorBlock(
          "Your response could not be delivered. Please check your connection and try again.",
        );
        return false;
      }
    };

    const handleToolConfirm = async () => {
      resolveConfirmationBlock(true);

      if (pendingConfirmation.value?.tool === "navigation_action") {
        const navAction = pendingConfirmation.value?.navAction;
        if (navAction) {
          await handleNavigationAction(navAction);
        }
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      await sendConfirmation(currentSessionId.value, true);
      pendingConfirmation.value = null;
    };

    const handleToolCancel = async () => {
      resolveConfirmationBlock(false);

      if (pendingConfirmation.value?.tool === "navigation_action") {
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      await sendConfirmation(currentSessionId.value, false);
      pendingConfirmation.value = null;
    };

    const handleToolAlwaysConfirm = async () => {
      isAutoNavigationEnabled.value = true;

      resolveConfirmationBlock(true);

      if (pendingConfirmation.value?.tool === "navigation_action") {
        const navAction = pendingConfirmation.value?.navAction;
        if (navAction) {
          await handleNavigationAction(navAction);
        }
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      await sendConfirmation(currentSessionId.value, true);
      pendingConfirmation.value = null;
    };

    const generateNavigationFromToolResult = (
      toolName: string,
      callArgs: any,
      responseBody: any,
    ): NavigationAction | null => generateNavigation(toolName, callArgs, responseBody, t);

    const handleNavigationAction = async (action: NavigationAction) => {
      // Detach before navigating so the route change can't abort the in-flight turn and its queued tool calls.
      detachCurrentStream();

      const pageName = navigationPageName(action);

      const target = buildNavigationRoute(
        action,
        store.state.selectedOrganization.identifier,
      );
      if (target) {
        await router.push({ path: target.path, query: target.query });
      }

      // Use setTimeout to add message AFTER navigation fully completes and settles
      setTimeout(async () => {
        try {
          const successMessage = t("aiAssistant.navigatedTo", { page: pageName });
          let lastMessage = chatMessages.value[chatMessages.value.length - 1];

          if (!lastMessage || lastMessage.role !== "assistant") {
            chatMessages.value.push({
              role: "assistant",
              content: raw(successMessage),
              contentBlocks: [{ type: "text", text: successMessage }],
            });
          } else {
            if (lastMessage.content) {
              lastMessage.content = raw(lastMessage.content + "\n\n" + successMessage);
            } else {
              lastMessage.content = raw(successMessage);
            }
            if (!lastMessage.contentBlocks) {
              lastMessage.contentBlocks = [];
            }
            lastMessage.contentBlocks.push({
              type: "text",
              text: successMessage,
            });
          }

          await saveToHistory();
          await scrollToBottom();
        } catch (error) {
          console.error("Error adding navigation success message:", error);
        }
      }, 500);
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
          // Re-attach to a live background stream: assigning its array makes processStream's isActive() identity true again.
          const bgCtx = chat.sessionId ? backgroundStreamMap.get(chat.sessionId) : null;

          if (bgCtx) {
            chatMessages.value = bgCtx.msgs;
            currentChatId.value = bgCtx.chatId || chatId;
            currentSessionId.value = chat.sessionId || null;

            currentAbortController.value = bgCtx.controller;
            backgroundStreams.delete(bgCtx.controller);
            backgroundStreamMap.delete(chat.sessionId!);

            isLoading.value = true;
            startAnalyzingRotation();

            // Prime the typewriter with text streamed before re-attach; processStream only syncs on the next chunk, so the backlog would stay invisible.
            const lastMsg = chatMessages.value[chatMessages.value.length - 1];
            if (lastMsg?.role === "assistant" && lastMsg.contentBlocks?.length) {
              const lastBlock = lastMsg.contentBlocks[lastMsg.contentBlocks.length - 1];
              if (lastBlock?.type === "text" && lastBlock.text) {
                currentStreamingMessage.value = lastMsg.content || lastBlock.text;
                currentTextSegment.value = lastBlock.text;
                displayedStreamingContent.value = lastBlock.text;
              }
            }
          } else {
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

      isLoading.value = true;
      currentStreamingMessage.value = "";
      currentTextSegment.value = "";
      resetTypewriterState();
      startAnalyzingRotation();

      // Mint the session id before the try so every exit path's cleanup clears the SAME id, or a re-attached instance spins forever.
      if (!currentSessionId.value) {
        currentSessionId.value = getUUIDv7();
      }
      const streamSessionId = currentSessionId.value;

      sessionStreamingState[streamSessionId] = true;

      currentAbortController.value = new AbortController();

      // At most one restore attempt per turn; the notice shows only once the replacement request succeeds.
      let hasReseeded = false;
      let reseedNotice = false;

      // Clear any flag left by a turn that threw or aborted early; a stale `true` abandons a healthy session.
      streamOwnerUnavailable.value = false;

      try {
        // Don't add empty assistant message here - wait for actual content
        await scrollToLoadingIndicator();

        let response: any;
        try {
          response = await fetchAiChat(
            chatMessages.value,
            "",
            store.state.selectedOrganization.identifier,
            currentAbortController.value.signal,
            undefined, // explicitContext
            currentSessionId.value,
            hasImages ? messagesToSend : undefined,
          );
        } catch (error) {
          console.error("Error fetching AI chat:", error);
          return;
        }

        if (response && response.cancelled) {
          return;
        }

        if (!response.ok) {
          let errorBody = null;
          try {
            errorBody = await response.json();
          } catch (_) {
            // body may not be JSON
          }

          // Session gone but transcript remains: resend under a fresh session for the server to seed; this code only, once only.
          if (isSessionOwnerUnavailable(errorBody) && !hasReseeded) {
            hasReseeded = true;
            console.warn(
              `Session ${currentSessionId.value} is no longer available; restoring the conversation in a new session.`,
            );

            // A NEW id, since the old one would be refused again; streamSessionId stays pinned to the original for cleanup.
            currentSessionId.value = getUUIDv7();
            reseedNotice = true;

            response = await fetchAiChat(
              chatMessages.value,
              "",
              store.state.selectedOrganization.identifier,
              currentAbortController.value?.signal,
              undefined,
              currentSessionId.value,
              hasImages ? messagesToSend : undefined,
            );
          }
        }

        // Re-check: the reseed above may have produced a fresh response.
        if (!response.ok) {
          let errorBody = null;
          try {
            errorBody = await response.json();
          } catch (_) {
            // body may not be JSON
          }
          const err: any = new Error(
            errorBody?.message ||
              t("aiAssistant.aiChat.serverErrorStatus", { status: response.status }),
          );
          err.status = response.status;
          err.errorBody = errorBody;
          throw err;
        }

        // Announce before content arrives; silence hides that earlier tool results and file state were lost.
        if (reseedNotice) {
          reseedNotice = false;
          appendErrorBlock(RESTORED_NOTICE, true);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();

        const streamController = currentAbortController.value;
        const streamMsgs = chatMessages.value;

        await processStream(reader);

        // A streaming 409 arrives as an SSE event inside a 200; restore only while this turn is on screen, or it clobbers another chat's session.
        const stillOnScreen = chatMessages.value === streamMsgs;
        if (streamOwnerUnavailable.value && !hasReseeded && stillOnScreen) {
          streamOwnerUnavailable.value = false;
          hasReseeded = true;

          if (streamController) backgroundStreams.delete(streamController);
          if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

          // The streaming registry must follow the new id, or a re-attaching instance never sees this stream finish.
          const restoredSessionId = getUUIDv7();
          currentSessionId.value = restoredSessionId;
          sessionStreamingState[restoredSessionId] = true;

          const retry: any = await fetchAiChat(
            chatMessages.value,
            "",
            store.state.selectedOrganization.identifier,
            currentAbortController.value?.signal,
            undefined,
            currentSessionId.value,
            hasImages ? messagesToSend : undefined,
          );

          if (retry && !retry.cancelled && retry.ok && retry.body) {
            // Announced only once the replacement is accepted, or the claim can turn out false.
            appendErrorBlock(RESTORED_NOTICE, true);
            await processStream(retry.body.getReader());
          } else if (!(retry && retry.cancelled)) {
            // Retry failed and hasReseeded blocks another attempt, so explain instead of ending silently; a cancel stays silent.
            appendErrorBlock(
              "This conversation was interrupted and could not be restored. Please try sending your message again.",
            );
          }

          // Clear the restored turn's entry either way, or a re-attaching instance spins forever.
          sessionStreamingState[restoredSessionId] = false;
          backgroundStreamMap.delete(restoredSessionId);
        }
        streamOwnerUnavailable.value = false;

        if (streamController) backgroundStreams.delete(streamController);
        if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

        // Only update UI/store if stream was NOT detached (session is still the same)
        const wasDetached = chatMessages.value !== streamMsgs;
        if (!wasDetached) {
          store.dispatch("setCurrentChatTimestamp", currentChatId.value);
          store.dispatch("setChatUpdated", true);
        }
      } catch (error: any) {
        if (
          chatMessages.value.length > 0 &&
          chatMessages.value[chatMessages.value.length - 1].role === "assistant" &&
          !chatMessages.value[chatMessages.value.length - 1].content
        ) {
          chatMessages.value.pop();
        }
        const errorMessage = chatErrorMessage(error, t);
        chatMessages.value.push({
          role: "assistant",
          content: raw(errorMessage),
        });
        await saveToHistory();
      }

      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();

      // Clear by the id captured before the request, not currentSessionId, which may belong to another chat by an early failure.
      sessionStreamingState[streamSessionId] = false;

      currentAbortController.value = null;

      await scrollToBottom();
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

    watch(
      () => (currentSessionId.value ? sessionStreamingState[currentSessionId.value] : undefined),
      (isStreaming) => {
        // React to false, not true->false: a mid-stream re-attach never saw `true`, so it would skip cleanup and spin forever.
        if (isStreaming === false && isLoading.value) {
          isLoading.value = false;
          activeToolCall.value = null;
          stopAnalyzingRotation();
          // The owning instance's processStream already wrote the final text, so only clear this instance's typewriter UI.
          resetTypewriterState();
          // Publish the finished turn so a later mount reads it, not a mid-stream snapshot.
          store.dispatch("setCurrentChatTimestamp", currentChatId.value);
          nextTick(() => scrollToBottom());
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
      if (streamingRenderFlushTimer) {
        clearTimeout(streamingRenderFlushTimer);
        streamingRenderFlushTimer = null;
      }
      pendingStreamingRenderContent = null;

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

    // Throttle the reactive write: each one re-parses and re-highlights the whole markdown, which is O(n^2) at typewriter tick rate.
    const STREAMING_RENDER_INTERVAL = 80;
    let lastStreamingRenderTime = 0;
    let pendingStreamingRenderContent: string | null = null;
    let streamingRenderFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushStreamingRenderNow = (content: string) => {
      lastStreamingRenderTime = Date.now();
      pendingStreamingRenderContent = null;
      if (streamingRenderFlushTimer) {
        clearTimeout(streamingRenderFlushTimer);
        streamingRenderFlushTimer = null;
      }

      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
        const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === "text") {
          // Additive-only: the typewriter reveals a prefix of text already written here, so a lagging or reset reveal must never shorten it.
          if ((content?.length || 0) >= (lastBlock.text?.length || 0)) {
            lastBlock.text = content;
          }
        }
      }
    };

    watch(displayedStreamingContent, (newContent) => {
      if (!isLoading.value) return;
      // An empty displayedStreamingContent means a new segment starts, not that previous content should be cleared.
      if (!newContent) return;

      const now = Date.now();
      if (now - lastStreamingRenderTime >= STREAMING_RENDER_INTERVAL) {
        flushStreamingRenderNow(newContent);
        return;
      }

      // Trailing edge: the latest content must land even if ticks keep arriving faster than the interval.
      pendingStreamingRenderContent = newContent;
      if (!streamingRenderFlushTimer) {
        const delay = STREAMING_RENDER_INTERVAL - (now - lastStreamingRenderTime);
        streamingRenderFlushTimer = setTimeout(() => {
          streamingRenderFlushTimer = null;
          if (pendingStreamingRenderContent !== null) {
            flushStreamingRenderNow(pendingStreamingRenderContent);
          }
        }, delay);
      }
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
