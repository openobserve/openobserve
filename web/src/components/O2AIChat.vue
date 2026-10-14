<template>
  <div
    ref="chatRoot"
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
                    <OTruncatedText
                      class="chat-title-text text-text-body block text-sm font-medium"
                    >
                      {{ displayedTitle || t("common.newChat") }}
                    </OTruncatedText>
                    <OIcon name="arrow-drop-down" size="md" class="flex-shrink-0" />
                  </div>
                </OButton>
              </template>
              <O2AIChatHistoryMenu
                v-model:search-term="historySearchTerm"
                :chats="filteredChatHistory"
                :share-enabled="chatPersistenceEnabled"
                @select="loadChat"
                @delete="requestDeleteChat"
                @share="shareHistoryChat"
                @clear-all="clearAllConversations"
              />
            </ODropdown>
          </div>

          <div class="chat-header-actions flex shrink-0 items-center gap-1">
            <OButton
              v-if="currentChatId"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('aiAssistant.editTitleTooltip')"
              @click.stop="openEditTitleDialog"
            >
              <OIcon name="edit" size="sm" />
              <OTooltip :content="t('aiAssistant.editTitleTooltip')" />
            </OButton>
            <OButton
              v-if="canShareCurrentChat"
              variant="ghost"
              size="icon-sm"
              data-test="o2-ai-chat-share-btn"
              :aria-label="t('aiChatShare.share')"
              @click.stop="shareCurrentChat"
            >
              <OIcon name="share" size="sm" />
              <OTooltip :content="t('aiChatShare.share')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              :aria-label="t('common.newChat')"
              @click="addNewChat"
            >
              <OIcon name="add" size="sm" />
              <OTooltip :content="t('common.newChat')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              data-test="ai-chat-expand-btn"
              :aria-label="store.state.isAiChatExpanded ? t('common.collapse') : t('common.expand')"
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
            <OButton
              variant="ghost"
              size="icon-sm"
              :aria-label="t('common.close')"
              @click="$emit('close')"
            >
              <OIcon name="close" size="sm" />
            </OButton>
          </div>
        </div>
      </div>

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

      <AiChatShareDialog
        v-if="shareTarget"
        v-model:open="showShareDialog"
        :session-id="shareTarget.sessionId"
        :chat-title="shareTarget.title"
        :history-unavailable="shareTarget.historyUnavailable"
      />

      <ConfirmDialog
        v-model="showDeleteChatConfirmDialog"
        :title="t('aiAssistant.deleteChat')"
        :message="deleteChatMessage"
        :ok-label="t('common.delete')"
        ok-variant="destructive"
        focus-cancel
        @update:ok="confirmDeleteChat"
        @update:cancel="showDeleteChatConfirmDialog = false"
      />

      <ConfirmDialog
        v-model="showClearAllConfirmDialog"
        :title="t('aiAssistant.clearAllConversationsTitle')"
        :message="t('aiAssistant.clearAllConversationsMessage')"
        @update:ok="confirmClearAllConversations"
        @update:cancel="showClearAllConfirmDialog = false"
      />

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
          <OBanner
            v-if="forkedFromShare"
            variant="info"
            icon="fork-right"
            dense
            :content="t('aiChatShare.forkedFromShareBanner', { title: displayedTitle })"
            data-test="o2-ai-chat-forked-banner"
          />
          <OBanner
            v-if="historyUnavailable"
            variant="warning"
            icon="error"
            dense
            inline-actions
            :content="t('aiAssistant.historyUnavailable')"
            data-test="o2-ai-chat-history-unavailable"
          >
            <template #actions>
              <OButton
                variant="outline"
                size="sm"
                data-test="o2-ai-chat-history-unavailable-retry"
                @click="reloadCurrentChat"
              >
                {{ t("common.retry") }}
              </OButton>
            </template>
          </OBanner>
          <div
            v-if="chatMessages.length === 0"
            class="welcome-section rounded-default mb-0 flex flex-1 items-center justify-center bg-transparent p-0"
          >
            <O2AIHomeWelcome v-if="centeredStart" @select-prompt="selectWelcomePrompt" />
            <div v-else class="flex h-full w-full flex-col items-center justify-center">
              <div class="flex flex-col items-center gap-2">
                <img :src="o2AiTitleLogo" />
                <div class="flex items-center gap-2">
                  <span class="text-sm font-[600]">{{
                    t("aiAssistant.welcome.taglineHighlight")
                  }}</span>
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
            @retry="retryGeneration(index)"
            @stop-turn="stopRunningTurn"
            @like="likeCodeBlock(index)"
            @dislike="dislikeCodeBlock(index)"
            @preview-image="openImagePreview"
          />
          <O2AIChatToolCallIndicator
            v-if="activeToolCall"
            :message="activeToolCall.message"
            :context="activeToolCall.context"
          />
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

        <div
          v-show="showScrollToBottom"
          class="scroll-to-bottom-container pointer-events-none absolute bottom-2.5 left-1/2 z-1000 -translate-x-1/2 [transition:all_0.3s_ease]"
        >
          <OButton
            variant="ghost"
            size="icon-sm"
            class="scroll-to-bottom-btn border-text-link! text-text-link! bg-surface-base! dark:border-ai-accent! dark:text-ai-accent! dark:bg-surface-base! hover:border-text-link! hover:text-text-link! hover:bg-surface-base! dark:hover:border-ai-accent! dark:hover:text-ai-accent! dark:hover:bg-surface-base! pointer-events-auto border-2! shadow-sm [backdrop-filter:blur(0.5rem)] transition-all duration-300 hover:scale-110 hover:shadow-md active:scale-100"
            :aria-label="t('aiAssistant.scrollToBottom')"
            @click="scrollToBottomSmooth"
          >
            <OIcon name="arrow-downward" size="sm" />
            <OTooltip side="top" align="center" :content="t('aiAssistant.scrollToBottom')" />
          </OButton>
        </div>
      </div>

      <div
        v-if="(isLoading || activeToolCall) && showScrollToBottom"
        class="fixed-analyzing-indicator rounded-default border-border-default mx-4 mb-2 flex items-center justify-center border px-4 py-3 shadow-sm [background:var(--color-chat-bubble-user)]"
      >
        <div
          v-if="activeToolCall"
          class="analyzing-content flex w-full max-w-225 items-center gap-3"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-theme-accent text-sm font-medium">{{
            activeToolCall.message
          }}</span>
        </div>
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
        <OBanner
          v-if="turnLimitError"
          variant="error-soft"
          icon="error"
          dense
          inline-actions
          class="mb-2"
          :content="t('aiAssistant.turnLimitReached')"
          data-test="o2-ai-chat-turn-limit"
        >
          <template #actions>
            <div class="flex items-center gap-2">
              <OButton
                variant="outline"
                size="sm"
                data-test="o2-ai-chat-turn-limit-retry"
                @click="sendMessage"
              >
                {{ t("common.retry") }}
              </OButton>
              <OButton
                variant="ghost"
                size="icon-sm"
                data-test="o2-ai-chat-turn-limit-dismiss"
                :aria-label="t('common.close')"
                @click="turnLimitError = false"
              >
                <OIcon name="close" size="sm" />
              </OButton>
            </div>
          </template>
        </OBanner>
        <O2AIConfirmDialog
          :visible="pendingConfirmation !== null"
          :confirmation="pendingConfirmation"
          @confirm="handleToolConfirm"
          @cancel="handleToolCancel"
          @always-confirm="handleToolAlwaysConfirm"
        />
        <O2AIPaidUsageConsent v-if="showPaidUsageConsent" />

        <input
          ref="imageInputRef"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          class="hidden"
          @change="handleImageSelect"
        />

        <O2AIChatInput
          v-if="!pendingConfirmation && !showPaidUsageConsent"
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
  onMounted,
  nextTick,
  watch,
  computed,
  onBeforeUnmount,
  onUnmounted,
} from "vue";
import { queryClient } from "@/composables/query/queryClient";
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
import O2AIPaidUsageConsent from "@/components/ai-assistant/chat/O2AIPaidUsageConsent.vue";
import { useChatConsentSurface } from "@/composables/usePaidOverageConsent";
import O2AIHomeWelcome from "@/components/ai-assistant/welcome/O2AIHomeWelcome.vue";
import O2AIChatHistoryMenu from "@/components/ai-assistant/chat/O2AIChatHistoryMenu.vue";
import O2AIChatInput from "@/components/ai-assistant/chat/O2AIChatInput.vue";
import O2AIChatMessage from "@/components/ai-assistant/chat/O2AIChatMessage.vue";
import O2AIChatToolCallIndicator from "@/components/ai-assistant/chat/O2AIChatToolCallIndicator.vue";
import AiChatShareDialog from "@/components/ai-assistant/share/AiChatShareDialog.vue";
import { canShareChat, isChatPersistenceEnabled } from "@/components/ai-assistant/share/chatShare";
import { activeShareCount } from "@/components/ai-assistant/share/useChatShareDialog";
import { useChatHistory } from "@/composables/useChatHistory";
import { recallChatSelection, rememberChatSelection } from "@/utils/chatSelection";
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { computeUserOrgKey } from "@/utils/userOrgKey";
import {
  createPreview,
  formatLogEntryContent,
  getLanguageDisplay,
  processHtmlBlock,
  processChatMessage,
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

const { submitFeedback, chatHistoryServer, cancelAiChat } = useAiChat();

// While another tab or a closed panel owns a running turn, the owner's open chat re-reads it at this pace.
const RUNNING_TURN_POLL_MS = 4000;
const RUNNING_TURN_POLL_LIMIT = 150;

// An overlay of this panel (or the page) owns Escape while it is open; the panel closes only once none is.
const OVERLAY_SELECTOR =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]';

const overlayOpenOutside = (root: HTMLElement | null): boolean =>
  Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
    (overlay) => !root || !overlay.contains(root),
  );

export default defineComponent({
  name: "O2AIChat",
  components: {
    AiChatShareDialog,
    OButton,
    BetaBadge,
    ConfirmDialog,
    O2AIConfirmDialog,
    O2AIPaidUsageConsent,
    O2AIHomeWelcome,
    O2AIChatHistoryMenu,
    O2AIChatInput,
    O2AIChatMessage,
    O2AIChatToolCallIndicator,
    ODropdown,
    ODrawer,
    ODialog,
    OSpinner,
    OBanner,
    OIcon,
    OTooltip,
    OTruncatedText,
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
    const { showInChat: showPaidUsageConsent } = useChatConsentSurface(() => props.isOpen);
    const currentTextSegment = ref("");
    const currentChatId = ref<number | null>(null);
    const forkedFromShare = ref<string | null>(null);
    const historyUnavailable = ref(false);
    const turnLimitError = ref(false);
    const chatRoot = ref<HTMLElement | null>(null);
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
      discardLocalChat: dbDiscardLocalChat,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
    } = useChatHistory(
      () => store.state.userInfo.email ?? "",
      () => store.state.selectedOrganization.identifier ?? "",
      t,
      chatHistoryServer(),
    );

    const userEmail = () => store.state.userInfo.email ?? "";
    const orgIdentifier = () => store.state.selectedOrganization?.identifier ?? "";
    // Local prompt history and auto-navigation are keyed by this hash, the same scope as chat history.
    const userOrgKey = ref<string | null>(null);
    watch(
      () => `${userEmail()}:${orgIdentifier()}`,
      async (scope) => {
        userOrgKey.value = null;
        const key = await computeUserOrgKey(userEmail(), orgIdentifier());
        // A slower hash from the previous user or org must not overwrite the current one.
        if (scope === `${userEmail()}:${orgIdentifier()}`) userOrgKey.value = key;
      },
      { immediate: true },
    );

    // A reload reopens the chat this tab had open; written only once the user+org key is known, so it never erases it first.
    watch([currentChatId, userOrgKey], ([chatId, key], [, oldKey]) => {
      if (!key) return;
      if (key === oldKey) {
        rememberChatSelection(key, chatId);
        return;
      }
      const remembered = recallChatSelection(key);
      if (
        remembered !== null &&
        currentChatId.value === null &&
        store.state.currentChatTimestamp == null
      ) {
        store.dispatch("setCurrentChatTimestamp", remembered);
        store.dispatch("setChatUpdated", true);
      }
    });

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
      saveAutoNavigationPreferences,
    } = useAutoNavigationPreferences(currentChatId, userOrgKey);

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

    const { historyIndex, isOnFirstLine, navigateHistory, addToHistory } = usePromptHistory(
      inputMessage,
      userOrgKey,
    );

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
          if (overlayOpenOutside(chatRoot.value)) return;
          if (store.state.isAiChatEnabled) {
            store.dispatch("setIsAiChatEnabled", false);
            store.dispatch("setIsAiChatExpanded", false);
            window.dispatchEvent(new Event("resize"));
          }
        },
      },
    ]);

    // Bumped by every load and by a new chat, so a slower earlier load cannot overwrite a newer selection.
    let loadSeq = 0;

    const addNewChat = () => {
      loadSeq += 1;
      detachCurrentStream();
      historyUnavailable.value = false;
      turnLimitError.value = false;

      chatMessages.value = [];
      currentChatId.value = null;
      currentSessionId.value = null; // Will be generated on first save
      lastTraceId.value = null;
      forkedFromShare.value = null;
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

        const seq = ++loadSeq;
        detachCurrentStream();

        const chat = await dbLoadChat(chatId);
        if (seq !== loadSeq) return;

        if (chat) {
          if (!tryReattach(chat, chatId)) {
            chatMessages.value = toChatMessages(chat.messages);
            currentChatId.value = chatId;
            currentSessionId.value = chat.sessionId || null;
          }

          showHistory.value = false;
          shouldAutoScroll.value = true;
          forkedFromShare.value = chat.forkedFromShare ?? null;
          historyUnavailable.value = !!chat.historyUnavailable;
          turnLimitError.value = false;

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

    const toChatMessages = (messages: ChatMessage[]): ChatMessage[] =>
      messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.contentBlocks ? { contentBlocks: msg.contentBlocks } : {}),
        ...(msg.images ? { images: msg.images } : {}),
        ...(msg.feedback ? { feedback: msg.feedback } : {}),
      }));

    const reloadCurrentChat = () => {
      if (currentChatId.value !== null) loadChat(currentChatId.value);
    };

    const hasRunningTurn = computed(() =>
      chatMessages.value.some((msg) =>
        msg.contentBlocks?.some(
          (block) => block.type === "status" && block.turnStatus === "running",
        ),
      ),
    );

    // Re-reads the open chat in place, without the scroll and title resets of a full load.
    const refreshRunningChat = async () => {
      const chatId = currentChatId.value;
      if (chatId === null || isLoading.value) return;
      const seq = loadSeq;
      const chat = await dbLoadChat(chatId);
      if (seq !== loadSeq || currentChatId.value !== chatId || isLoading.value || !chat) return;
      chatMessages.value = toChatMessages(chat.messages);
      historyUnavailable.value = !!chat.historyUnavailable;
    };

    let runningPollTimer: ReturnType<typeof setTimeout> | null = null;
    let runningPolls = 0;
    const stopRunningPoll = () => {
      if (runningPollTimer) clearTimeout(runningPollTimer);
      runningPollTimer = null;
    };
    const scheduleRunningPoll = () => {
      stopRunningPoll();
      if (!hasRunningTurn.value || isLoading.value || runningPolls >= RUNNING_TURN_POLL_LIMIT) {
        return;
      }
      runningPollTimer = setTimeout(async () => {
        runningPolls += 1;
        await refreshRunningChat();
        scheduleRunningPoll();
      }, RUNNING_TURN_POLL_MS);
    };
    watch([hasRunningTurn, isLoading, currentChatId], () => {
      runningPolls = 0;
      scheduleRunningPoll();
    });

    // The turn runs on the server, so Stop goes there; the marker swaps once the server records the stop.
    const stopRunningTurn = async () => {
      const sessionId = currentSessionId.value;
      if (!sessionId || !chatPersistenceEnabled.value) return;
      try {
        await cancelAiChat(store.state.selectedOrganization.identifier, sessionId);
      } catch (error) {
        console.debug("AI chat cancel request failed", error);
      }
      await refreshRunningChat();
      runningPolls = 0;
      scheduleRunningPoll();
    };

    // The server refused the turn before storing anything, so the chat goes back to how it was and the prompt to the composer.
    const undoRefusedTurn = async (
      prompt: string,
      images: typeof pendingImages.value,
      wasEmpty: boolean,
    ) => {
      const last = chatMessages.value[chatMessages.value.length - 1];
      if (last?.role === "user") chatMessages.value.pop();
      inputMessage.value = prompt;
      if (chatInput.value && typeof chatInput.value.setContent === "function") {
        chatInput.value.setContent(prompt);
      }
      pendingImages.value = images;
      turnLimitError.value = true;
      if (wasEmpty && currentChatId.value !== null) {
        const chatId = currentChatId.value;
        currentChatId.value = null;
        currentSessionId.value = null;
        store.dispatch("setCurrentChatTimestamp", null);
        // A refused first turn never created the chat on the server, so a server delete would only 404.
        await dbDiscardLocalChat(chatId);
      } else {
        await saveToHistory();
      }
    };

    const sendMessage = async () => {
      const hasText = inputMessage.value.trim().length > 0;
      const hasImages = pendingImages.value.length > 0;
      if ((!hasText && !hasImages) || isLoading.value) return;
      turnLimitError.value = false;

      let backendMessage = inputMessage.value;
      if (chatInput.value && typeof chatInput.value.getMessageForBackend === "function") {
        backendMessage = chatInput.value.getMessageForBackend();
      }

      const userMessage = inputMessage.value;
      const messagesToSend = [...pendingImages.value];
      const wasEmpty = chatMessages.value.length === 0;

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

      const turnMessages = chatMessages.value;
      const outcome = await runTurn(hasImages, messagesToSend);
      if (outcome === "turnLimit" && chatMessages.value === turnMessages) {
        await undoRefusedTurn(userMessage, messagesToSend, wasEmpty);
      }
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

    // RichTextInput ignores modelValue while focused, so a recalled prompt must be pushed in.
    const recallHistory = (direction: "up" | "down") => {
      const before = inputMessage.value;
      navigateHistory(direction);
      // setContent rewrites textContent, so it must not run when nothing was recalled: it would flatten the chips.
      if (inputMessage.value === before) return;
      // The recalled text replaced the chips in the composer, so their references must not linger.
      contextReferences.value = [];
      if (chatInput.value && typeof chatInput.value.setContent === "function") {
        chatInput.value.setContent(inputMessage.value);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === "Backspace") {
        handleImageReferenceBackspace(e);
      } else if (e.key === "ArrowUp") {
        if (isOnFirstLine(e.target as HTMLElement)) {
          e.preventDefault();
          recallHistory("up");
        }
      } else if (e.key === "ArrowDown" && historyIndex.value > -1) {
        e.preventDefault();
        recallHistory("down");
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

      window.addEventListener("o2:abort-ai-streams", abortAllStreams);
    });

    // Dialogs teleport out of this panel, so they are closed before it goes rather than left open without an owner.
    onBeforeUnmount(() => {
      showShareDialog.value = false;
      showEditTitleDialog.value = false;
      showDeleteChatConfirmDialog.value = false;
      showClearAllConfirmDialog.value = false;
      showImagePreview.value = false;
      stopRunningPoll();
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

    const processedMessages = computed(() => chatMessages.value.map(processChatMessage));

    const showShareDialog = ref(false);
    const shareTarget = ref<{
      sessionId: string;
      title: string;
      historyUnavailable?: boolean;
    } | null>(null);
    const chatPersistenceEnabled = computed(() => isChatPersistenceEnabled(store.state.zoConfig));
    const canShareCurrentChat = computed(() =>
      canShareChat({
        persistenceEnabled: chatPersistenceEnabled.value,
        sessionId: currentSessionId.value,
        hasMessages: chatMessages.value.length > 0,
        isStreaming: isLoading.value,
      }),
    );

    const openShareDialog = (
      sessionId: string | null | undefined,
      title: string,
      unavailable = false,
    ) => {
      if (!sessionId) return;
      shareTarget.value = { sessionId, title, historyUnavailable: unavailable };
      showShareDialog.value = true;
    };

    const shareCurrentChat = () =>
      openShareDialog(currentSessionId.value, displayedTitle.value, historyUnavailable.value);

    const deleteLinkCount = ref(0);
    const deleteChatMessage = computed(() =>
      deleteLinkCount.value > 0
        ? t(
            "aiAssistant.deleteChatWithLinksMessage",
            { count: deleteLinkCount.value },
            deleteLinkCount.value,
          )
        : t("aiAssistant.deleteChatConfirmMessage"),
    );

    // The confirmation opens at once; the link count fills in when the share list answers.
    const requestDeleteChat = async (chatId: number) => {
      deleteLinkCount.value = 0;
      deleteChat(chatId);
      const chat = chatHistory.value.find((c) => c.id === chatId);
      if (!chatPersistenceEnabled.value || !chat?.serverBacked) return;
      const count = await activeShareCount(
        queryClient,
        store.state.selectedOrganization?.identifier ?? "",
        chat.sessionId,
      );
      if (chatToDelete.value === chatId) deleteLinkCount.value = count;
    };

    // Only the open chat's history state is known here; another chat's is found the way opening it would.
    const shareHistoryChat = async (chatId: number) => {
      const chat = chatHistory.value.find((c) => c.id === chatId);
      if (!chat?.sessionId) return;
      if (chatId === currentChatId.value) {
        openShareDialog(chat.sessionId, chat.title, historyUnavailable.value);
        return;
      }
      openShareDialog(chat.sessionId, chat.title);
      const loaded = await dbLoadChat(chatId);
      const target = shareTarget.value;
      if (target?.sessionId === chat.sessionId && loaded?.historyUnavailable) {
        shareTarget.value = { ...target, historyUnavailable: true };
      }
    };

    const retryGeneration = async (target: ChatMessage | number) => {
      const messageIndex =
        typeof target === "number"
          ? target
          : chatMessages.value.indexOf(target) >= 0
            ? chatMessages.value.indexOf(target)
            : chatMessages.value.findIndex((m) => m.content === target?.content);
      if (chatMessages.value[messageIndex]?.role !== "assistant") return;

      for (let userIndex = messageIndex - 1; userIndex >= 0; userIndex--) {
        if (chatMessages.value[userIndex].role === "user") {
          inputMessage.value = chatMessages.value[userIndex].content;
          await sendMessage();
          return;
        }
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
      showPaidUsageConsent,
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
      showShareDialog,
      canShareCurrentChat,
      shareTarget,
      chatPersistenceEnabled,
      shareCurrentChat,
      requestDeleteChat,
      deleteChatMessage,
      historyUnavailable,
      turnLimitError,
      chatRoot,
      reloadCurrentChat,
      stopRunningTurn,
      shareHistoryChat,
      forkedFromShare,
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
