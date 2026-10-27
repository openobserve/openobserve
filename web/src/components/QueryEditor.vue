<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Unified Query Editor Component
  Supports: SQL, PromQL, VRL, JavaScript
  Features: NL Mode (AI), Language Switching, Auto-detection
-->

<template>
  <div
    :class="
      inlineDoor
        ? 'relative grid w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto] outline-transparent'
        : 'relative flex w-full flex-col outline-transparent'
    "
    :style="rootStyle"
  >
    <template v-if="helper?.visible">
      <InlineHelperToolbar
        v-if="!inlineDoor && toolbarProps"
        v-bind="toolbarProps"
        v-on="toolbarEvents"
      />
      <div
        ref="helperSlot"
        :class="[
          'min-w-0 shrink-0',
          inlineDoor && 'col-span-2',
          inlineDoor && hasExpandButton && 'pe-10',
        ]"
      >
        <InlineQueryHelper
          ref="helperEl"
          v-model:open="helper.open"
          :host="helper.host"
          :prefill="helper.prefill"
          :entry-kind="helper.entryKind"
        />
      </div>
    </template>
    <!-- AI Input Bar (shown in NL Mode) - Positioned at top -->
    <!-- Height locked to 1.875rem = same as icon-toolbar expand button -->
    <div
      v-if="!assistantV2 && isAIMode"
      :data-test="`${dataTestPrefix}-ai-input-bar`"
      :class="[
        'border-b-card-glass-border bg-gradient-ai-faint z-10 flex h-9 shrink-0 items-center gap-2 border-b px-2',
        props.hasExpandButton && 'pe-10',
      ]"
    >
      <!-- Show streaming status with spinner + stop button -->
      <template v-if="isGenerating">
        <img :src="nlpIcon" :alt="t('search.aiIconAlt')" class="h-5 w-5 shrink-0" />
        <OSpinner variant="dots" size="xs" />
        <span class="flex-1 truncate text-sm">{{
          streamingText || aiStatusText || t("search.analyzingQuery")
        }}</span>
        <OButton
          variant="ghost-destructive"
          size="icon-circle-sm"
          icon-left="stop"
          :data-test="`${dataTestPrefix}-ai-stop-btn`"
          @click="cancelGeneration"
          class="text-status-error-text! shrink-0 transition-all! duration-200! hover:bg-[rgba(231,76,60,0.1)]"
        >
          <OTooltip :content="t('common.stopGenerating')" />
        </OButton>
      </template>
      <!-- Normal input when not generating -->
      <template v-else>
        <OInput
          v-model="aiInputText"
          :placeholder="props.aiPlaceholder || t('search.askAIPlaceholder')"
          :class="aiInputFieldClass"
          :data-test="`${dataTestPrefix}-ai-input-field`"
          @keydown.enter="handleAIInputEnter"
        >
          <template #icon-left>
            <img :src="nlpIcon" :alt="t('search.aiIconAlt')" class="h-5 w-5" />
          </template>
        </OInput>
        <!-- Send Button -->
        <OButton
          variant="ai-gradient"
          size="icon-xs-sq"
          icon-left="send"
          :disabled="!aiInputText.trim() || props.disableAi"
          :data-test="`${dataTestPrefix}-ai-send-btn`"
          @click="handleAIGenerate"
          class="text-text-inverse! disabled:bg-surface-subtle! bg-gradient-ai! enabled:hover:shadow-ai-accent/40! h-7! min-h-7! w-7! min-w-7! transition-all! duration-200! enabled:hover:-translate-y-px enabled:hover:shadow-md enabled:active:translate-y-0 disabled:opacity-40!"
        >
          <OTooltip
            v-if="props.disableAi && props.disableAiReason"
            :content="props.disableAiReason"
          />
          <OTooltip
            v-else-if="!aiInputText.trim()"
            :content="props.aiTooltip || t('search.enterPrompt')"
          />
        </OButton>
        <!-- Close Button -->
        <OButton
          variant="ghost-muted"
          size="icon-circle-sm"
          icon-left="close"
          :data-test="`${dataTestPrefix}-ai-close-btn`"
          @click="dismissAIMode"
          class="transition-colors! duration-200!"
        >
          <OTooltip :content="t('common.close')" />
        </OButton>
      </template>
    </div>

    <!-- Code Editor with relative positioning for floating button -->
    <div
      ref="editorArea"
      :class="
        growsWithHelper
          ? 'relative min-h-0 flex-none overflow-hidden'
          : 'relative min-h-0 flex-1 overflow-hidden'
      "
      :style="growsWithHelper ? { height: editorHeight } : undefined"
    >
      <AssistantDiffBlock
        v-if="helper?.pending"
        :key="helper.pending.id"
        :proposal="helper.pending"
        :reserve-end="hasExpandButton"
        class="absolute inset-0 z-10"
      />
      <div
        v-if="placeholder && !query && !editorFocused"
        class="query-editor-placeholder-overlay pointer-events-none absolute inset-0 z-1 flex items-start ps-[2.15rem] pe-2 pt-0.75 select-none"
        :data-test="`${dataTestPrefix}-placeholder`"
      >
        <span class="text-text-secondary min-w-0 truncate font-mono text-sm">{{
          placeholder
        }}</span>
      </div>
      <CodeQueryEditor
        :ref="(el) => (editorRef = el)"
        :key="currentLanguage"
        :editor-id="`${dataTestPrefix}-editor-${currentLanguage}`"
        :language="currentLanguage"
        :query="query"
        :nlp-mode="nlpMode"
        :read-only="readOnly"
        :release-wheel-to-page="releaseWheelToPage"
        :show-auto-complete="showAutoComplete"
        :keywords="keywords"
        :suggestions="suggestions"
        :field-value-resolver="fieldValueResolver ?? undefined"
        :debounce-time="debounceTime"
        :free-text-decorations="freeTextDecorations ?? null"
        :assistant-chord="helper?.onChord"
        :filter-mode="filterMode"
        :values-time-range="valuesTimeRange ?? null"
        @update:query="handleQueryUpdate"
        @user-edit="onUserEdit"
        @run-query="emit('run-query')"
        @focus="handleEditorFocus"
        @blur="handleEditorBlur"
        @nlpModeDetected="handleNlpModeDetected"
        @generation-start="handleGenerationStart"
        @generation-end="handleGenerationEnd"
        @generation-success="handleGenerationSuccess"
        class="h-full w-full"
      />

      <!-- Floating AI Icon (top-right corner of editor) - hidden when AI bar is open -->
      <OButton
        v-if="!assistantV2 && aiFeatureVisible && !hideNlToggle && !isAIMode"
        :data-test="`${dataTestPrefix}-ai-toggle-btn`"
        variant="ghost"
        size="icon-toolbar"
        :disabled="props.disableAi"
        @click="onAiToggleClick"
        class="group text-text-inverse! rounded-default bg-gradient-ai-subtle! hover:bg-gradient-ai! hover:shadow-ai-accent/35! absolute! top-0.75 z-100 h-7.5! min-h-7.5! w-7.5! min-w-7.5! [transition:background_0.3s_ease,box-shadow_0.3s_ease]! hover:shadow-md"
        :style="props.hasExpandButton ? { right: '2.375rem' } : { right: '0.25rem' }"
      >
        <img
          :src="nlpIcon"
          :alt="t('search.aiModeIconAlt')"
          class="h-4.5 w-4.5 transition-transform duration-[600ms] ease-[ease] group-hover:rotate-180 group-hover:brightness-0 group-hover:invert"
        />
        <span
          v-if="!aiAccess.allowed"
          aria-hidden="true"
          class="bg-surface-overlay border-surface-base absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border shadow-sm"
        >
          <OIcon name="lock" size="xs" class="text-warning-600 size-2.5!" />
        </span>
        <OTooltip
          v-if="aiAccess.allowed"
          :content="
            props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle')
          "
        />
      </OButton>
    </div>
    <InlineHelperToolbar
      v-if="inlineDoor && toolbarProps"
      v-bind="toolbarProps"
      inline
      :reserve-end="hasExpandButton"
      v-on="toolbarEvents"
    />
    <div
      v-if="helper?.visible"
      ref="hintSlot"
      :class="['min-w-0 shrink-0', inlineDoor && 'col-span-2']"
    >
      <InlineHelperHint
        :text="query ?? ''"
        :language="helper.host.language"
        :enabled="helper.usable && !helper.blocked && !helper.open"
        :edit-tick="helper.editTick"
        :focused="helper.focused"
        @ask="(sentence) => helper?.openFrom('hint', { text: sentence, mode: 'replace' })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { getImageURL, getUUIDv7 } from "@/utils/zincutils";
import { useChatHistory } from "@/composables/useChatHistory";
import useAiChat from "@/composables/useAiChat";
import type { ChatMessage } from "@/ts/interfaces/chat";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { checkFeatureAccess, buildFeatureGateContext } from "@/utils/enterpriseFeatures";
import { isAssistantV2 } from "@/composables/assistant/flags";
import type { QueryEditorAssistant } from "@/composables/assistant/pure";
import { useQueryEditorHelper } from "@/components/ai-assistant/helper/useQueryEditorHelper";

const InlineHelperToolbar = defineAsyncComponent(
  () => import("@/components/ai-assistant/helper/InlineHelperToolbar.vue"),
);
const AssistantDiffBlock = defineAsyncComponent(
  () => import("@/components/ai-assistant/evidence/AssistantDiffBlock.vue"),
);
const InlineQueryHelper = defineAsyncComponent(
  () => import("@/components/ai-assistant/helper/InlineQueryHelper.vue"),
);
const InlineHelperHint = defineAsyncComponent(
  () => import("@/components/ai-assistant/helper/InlineHelperHint.vue"),
);

type Language = "sql" | "promql" | "vrl" | "javascript";

// A pending diff over a one-line editor is unreadable, so the host is asked for this much more.
const DIFF_ROOM_PX = 160;

interface QueryChangeOrigin {
  /** false when the editor was written to (setValue), rather than typed in. */
  fromUser: boolean;
}

interface Props {
  // Language configuration
  languages?: Language[]; // Available languages (default: ['sql'])
  defaultLanguage?: Language; // Initial language

  // Query props
  query: string;
  readOnly?: boolean;
  showAutoComplete?: boolean;
  releaseWheelToPage?: boolean; // default true: let the page scroll when editor has nothing left to scroll

  // Editor autocomplete (forwarded to CodeQueryEditor)
  keywords?: any[]; // Autocomplete keywords for Monaco
  suggestions?: any[]; // Autocomplete suggestions for Monaco
  fieldValueResolver?: ((field: string) => Promise<string[]>) | null; // Field-value lookup awaited by the completion provider
  debounceTime?: number; // Debounce time for query updates (ms)
  freeTextDecorations?: { ranges: { start: number; end: number }[]; hover: I18nText } | null;
  filterMode?: boolean; // The query is a bare WHERE fragment (Logs without SQL mode)
  valuesTimeRange?: { startTime: number; endTime: number } | null; // Range field values are looked up in (microseconds)

  // NL Mode (optional external control)
  nlpMode?: boolean; // External NLP mode control (undefined = internal control)

  // UI customization
  editorHeight?: string;
  hideNlToggle?: boolean; // Hide floating AI icon (for pages that don't want AI)
  disableAi?: boolean; // Disable AI send (e.g. no stream selected)
  disableAiReason?: I18nText; // Tooltip reason when AI is disabled
  aiPlaceholder?: I18nText; // Custom placeholder for AI input (default: 'search.askAIPlaceholder')
  aiTooltip?: I18nText; // Custom tooltip for AI send button (default: 'search.enterPrompt')
  hasExpandButton?: boolean; // Reserve right padding so AI bar close btn doesn't overlap the expand btn

  // Testing
  dataTestPrefix?: string;

  /** The host's side of the Ask AI helper; without it the editor shows no AI control. */
  assistant?: QueryEditorAssistant | null;
  /** `off` for editors that must never offer the helper. */
  helper?: "on" | "off";
  /** Drawn inside the editor area, under any helper row, while the editor is empty and unfocused. */
  placeholder?: string;
  /** `inline` puts the door beside the editor and reports the rows it adds through `helper-space`. */
  helperLayout?: "row" | "inline";
}

const props = withDefaults(defineProps<Props>(), {
  languages: () => ["sql"],
  defaultLanguage: "sql",
  readOnly: false,
  showAutoComplete: true,
  releaseWheelToPage: true,
  keywords: () => [],
  suggestions: () => [],
  debounceTime: 500,
  nlpMode: undefined,
  editorHeight: "12.5rem",
  hideNlToggle: false,
  disableAi: false,
  disableAiReason: raw(""),
  hasExpandButton: false,
  dataTestPrefix: "query-editor",
  assistant: null,
  helper: "on",
  placeholder: undefined,
});

const emit = defineEmits<{
  "update:query": [query: string, origin?: QueryChangeOrigin];
  "user-edit": [];
  "language-change": [language: Language];
  "ask-ai": [naturalLanguage: string, language: Language];
  "run-query": [];
  focus: [];
  blur: [];
  "update:nlpMode": [enabled: boolean];
  "nlp-detected": [isDetected: boolean];
  "generation-start": [];
  "generation-end": [];
  "generation-success": [payload: { type: string; message: string }];
  "helper-space": [px: number];
}>();

const store = useStore();
const { t } = useI18nTyped();
const { isDark } = useTheme();

// Language state
const currentLanguage = ref<Language>(props.defaultLanguage);

// NL Mode state (supports external control via nlpMode prop, or internal control)
const internalNlpMode = ref(false);
const nlpMode = computed({
  get: () => (props.nlpMode !== undefined ? props.nlpMode : internalNlpMode.value),
  set: (val: boolean) => {
    if (props.nlpMode !== undefined) {
      emit("update:nlpMode", val);
    } else {
      internalNlpMode.value = val;
    }
  },
});
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
const onAiToggleClick = () => {
  if (!aiAccess.value.allowed) {
    openUpgradeDialog();
    return;
  }
  nlpMode.value = true;
};
const isNaturalLanguageDetected = ref(false);
const isGenerating = ref(false);
const editorRef = ref<any>(null);
const editorArea = ref<HTMLElement | null>(null);
const helperEl = ref<{ focusPrompt(): void } | null>(null);
const helperSlot = ref<HTMLElement | null>(null);
const hintSlot = ref<HTMLElement | null>(null);
const editorFocused = ref(false);

// Read once: the flag never changes in a running app, so the legacy bar and the helper never both mount.
const assistantV2 = isAssistantV2();
// Built for any editor whose host passes an adapter; `helper="off"` and read-only hide it reactively.
const helper =
  assistantV2 && props.assistant
    ? reactive(
        useQueryEditorHelper({
          assistant: () => props.assistant,
          enabled: () => props.helper !== "off" && !props.readOnly,
          query: () => props.query,
          language: () => (currentLanguage.value === "javascript" ? "js" : currentLanguage.value),
          editor: () =>
            editorRef.value
              ? {
                  getValue: () => editorRef.value?.getValue?.(),
                  replaceValue: (text: string) => editorRef.value?.replaceValue?.(text),
                  focus: () => editorRef.value?.editorObj?.focus?.(),
                }
              : null,
          area: () => editorArea.value,
          write: (text) => emit("update:query", text),
          focusPrompt: () => helperEl.value?.focusPrompt(),
        }),
      )
    : null;
const inlineDoor = computed(() => !!helper?.visible && props.helperLayout === "inline");
const toolbarProps = computed(() =>
  helper
    ? {
        hostId: helper.host.id,
        label: helper.label,
        dockOpen: helper.dockOpen,
        blocked: helper.blocked,
        status: helper.status,
      }
    : null,
);
const toolbarEvents = {
  open: () => helper?.openFrom("editor_button"),
  revert: (target: "assistant" | "original") => helper?.proposal?.revert(target),
  "ask-again": (prompt: string) =>
    helper?.openFrom("editor_button", { text: prompt, mode: "edit" }),
};
const growsWithHelper = computed(() => !!helper?.visible && props.editorHeight !== "100%");
let spaceObserver: ResizeObserver | null = null;
let reportedSpace = 0;

watch(
  [helperSlot, hintSlot, inlineDoor],
  ([row, hint, inline]) => {
    spaceObserver?.disconnect();
    spaceObserver = null;
    if (inline && typeof ResizeObserver !== "undefined") {
      spaceObserver = new ResizeObserver(reportHelperSpace);
      if (row) spaceObserver.observe(row);
      if (hint) spaceObserver.observe(hint);
    }
    reportHelperSpace();
  },
  { flush: "post" },
);
watch(() => !!helper?.pending, reportHelperSpace, { flush: "post" });
onBeforeUnmount(() => {
  spaceObserver?.disconnect();
  if (reportedSpace) emit("helper-space", 0);
});

// AI Input Bar state
const aiInputText = ref("");
const streamingText = ref(""); // Real-time streaming response from chat_stream
const aiStatusText = ref("");

// Session tracking & cancellation (matches O2 AI Chat patterns)
const currentSessionId = ref<string | null>(null);
const currentAbortController = ref<AbortController | null>(null);

// Chat history tracking (shared IndexedDB with O2AIChat)
const { saveToHistory } = useChatHistory(
  () => store.state.userInfo.email ?? "",
  () => store.state.selectedOrganization.identifier ?? "",
  t,
  useAiChat().chatHistoryServer(),
);
const currentChatId = ref<number | null>(null);
const chatMessages = ref<ChatMessage[]>([]);

const nlpIcon = computed(() => {
  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});

// Computed: AI input field class based on theme
const aiInputFieldClass = computed(() => "h-7! flex-1 my-px");

// AI features require an enterprise/cloud build with ai_enabled; an
// already-entitled org that's turned ai_enabled off (an admin preference,
// not an upsell target) still never sees the bar. A NOT-entitled build shows
// the toggle locked instead, regardless of ai_enabled — that flag has no
// real meaning on a build that can't reach the feature anyway.
const aiAccess = computed(() =>
  checkFeatureAccess("aiAssistant", buildFeatureGateContext(store.state.zoConfig)),
);
const aiFeatureVisible = computed(
  () => !aiAccess.value.allowed || Boolean(store.state.zoConfig.ai_enabled),
);
const aiFeatureEnabled = computed(() => aiFeatureVisible.value && aiAccess.value.allowed);

// Computed: Is in AI mode?
// When externally controlled (nlpMode prop passed), only show AI bar when nlpMode is explicitly ON.
// The parent decides when the AI bar appears (e.g., after generation success).
// When internally controlled, auto-detection also triggers AI mode.
const isAIMode = computed(() => {
  if (props.nlpMode !== undefined) {
    // External control: only nlpMode matters for showing the AI bar
    return nlpMode.value;
  }
  // Internal control: explicit toggle, or auto-detected NL only where AI is available
  return nlpMode.value || (aiFeatureEnabled.value && isNaturalLanguageDetected.value);
});

// Computed: Root container style - sets overall height
const rootStyle = computed(() => {
  // The helper row and hint add to the host; the editor keeps its own height.
  if (growsWithHelper.value) return {};
  if (props.editorHeight === "100%") {
    return { height: "100%" };
  }
  return { height: props.editorHeight };
});

// The rows the helper adds above and below the editor, which an inline host must make room for.
function reportHelperSpace(): void {
  const px = inlineDoor.value
    ? (helperSlot.value?.offsetHeight ?? 0) +
      (hintSlot.value?.offsetHeight ?? 0) +
      (helper?.pending ? DIFF_ROOM_PX : 0)
    : 0;
  if (px === reportedSpace) return;
  reportedSpace = px;
  emit("helper-space", px);
}

// Handle query update from editor
const handleQueryUpdate = (newQuery: string, _event?: unknown, origin?: QueryChangeOrigin) => {
  emit("update:query", newQuery, origin);
};

const handleEditorFocus = () => {
  editorFocused.value = true;
  if (helper) helper.focused = true;
  emit("focus");
};

const handleEditorBlur = () => {
  editorFocused.value = false;
  if (helper) helper.focused = false;
  emit("blur");
};

const onUserEdit = () => {
  helper?.onUserEdit();
  emit("user-edit");
};

// Handle auto-detection from editor
const handleNlpModeDetected = (isNL: boolean) => {
  isNaturalLanguageDetected.value = isNL;
  emit("nlp-detected", isNL);
};

// Handle AI input field Enter key - delegate to handleAIGenerate
const handleAIInputEnter = async () => {
  await handleAIGenerate();
};

// Detect if user wants to execute the query instead of generating a new one
const isExecutionIntent = (input: string): boolean => {
  const normalized = input.toLowerCase().trim();
  const executionKeywords = [
    "run",
    "run query",
    "execute",
    "execute query",
    "search",
    "go",
    "submit",
    "apply",
    "show results",
    "get results",
    "fetch",
    "run it",
    "execute it",
    "do it",
    "run this",
    "execute this",
  ];
  return executionKeywords.includes(normalized);
};

// Handle AI generation (send button click)
const handleAIGenerate = async () => {
  const userInput = aiInputText.value.trim();

  if (!userInput || isGenerating.value) return;

  const currentQuery = editorRef.value?.getValue ? editorRef.value.getValue() : props.query;

  // Check if user wants to execute the query instead of generating a new one
  if (currentQuery && currentQuery.trim() && isExecutionIntent(userInput)) {
    aiInputText.value = ""; // Clear input
    emit("run-query"); // Trigger query execution
    return;
  }

  // Build the prompt based on whether there's an existing query
  let naturalLanguage = "";
  if (currentQuery && currentQuery.trim()) {
    // Model input, not screen copy — deliberately English.
    naturalLanguage = raw(
      `Modify this ${currentLanguage.value.toUpperCase()} query to ${userInput}:\n\n${currentQuery}`,
    );
  } else {
    naturalLanguage = userInput;
  }

  // Ensure session ID exists (persists across requests in same AI bar session)
  if (!currentSessionId.value) {
    currentSessionId.value = getUUIDv7();
  }

  // Create AbortController for this request (enables cancel)
  currentAbortController.value = new AbortController();

  // Track user message for chat history
  chatMessages.value.push({ role: "user", content: raw(userInput) });

  // Call the CodeQueryEditor's handleGenerateSQL method with abort + session
  if (editorRef.value && typeof editorRef.value.handleGenerateSQL === "function") {
    try {
      aiStatusText.value = t("search.generatingQuery");
      await editorRef.value.handleGenerateSQL(
        naturalLanguage,
        currentAbortController.value.signal,
        currentSessionId.value,
      );

      // Track assistant response in chat history. A refused request (no AI credits, consent
      // declined) left the editor unchanged, so its notice is the answer instead.
      const generatedQuery = editorRef.value.refusalNotice || editorRef.value.getValue?.() || "";
      chatMessages.value.push({ role: "assistant", content: generatedQuery });

      // Save to IndexedDB (shared with O2AIChat history)
      const savedId = await saveToHistory(
        chatMessages.value,
        currentSessionId.value!,
        undefined,
        currentChatId.value,
      );
      if (savedId) currentChatId.value = savedId;
    } catch (error) {
      const isAbort = (error as Error)?.name === "AbortError";

      if (!isAbort) {
        console.error("[QueryEditor] Query generation failed:", error);
      }

      // Save stopped/failed query to chat history so user can see it
      const statusMsg = isAbort
        ? t("search.queryGenerationStopped")
        : t("search.queryGenerationFailed");
      chatMessages.value.push({ role: "assistant", content: statusMsg });

      const savedId = await saveToHistory(
        chatMessages.value,
        currentSessionId.value!,
        undefined,
        currentChatId.value,
      );
      if (savedId) currentChatId.value = savedId;

      aiStatusText.value = "";
    }
  }

  // Clean up abort controller after completion
  currentAbortController.value = null;

  // Emit event for parent components
  emit("ask-ai", naturalLanguage, currentLanguage.value);
};

// Cancel in-flight AI request
const cancelGeneration = () => {
  if (currentAbortController.value) {
    currentAbortController.value.abort();
    currentAbortController.value = null;
  }
  isGenerating.value = false;
  aiStatusText.value = "";
  streamingText.value = "";
};

// Dismiss AI mode (close button) - also cancels and resets session
const dismissAIMode = () => {
  cancelGeneration();
  nlpMode.value = false;
  isNaturalLanguageDetected.value = false;
  aiInputText.value = "";
  currentSessionId.value = null;
  currentChatId.value = null;
  chatMessages.value = [];
};

// Handle generation lifecycle events
const handleGenerationStart = () => {
  isGenerating.value = true;
  emit("generation-start");
};

const handleGenerationEnd = () => {
  isGenerating.value = false;
  emit("generation-end");
};

const handleGenerationSuccess = ({ type, message }: any) => {
  // Show success message in AI status
  aiStatusText.value = "✓ " + t("search.queryGeneratedSuccess");

  // Clear AI input text after successful generation
  setTimeout(() => {
    aiInputText.value = "";
    aiStatusText.value = "";
  }, 2000);

  // After successful generation: only auto-turn-off NLP mode when internally controlled.
  // When externally controlled (nlpMode prop is passed), let the parent decide.
  if (type === "sql" || type === "promql" || type === "vrl" || type === "javascript") {
    if (props.nlpMode === undefined) {
      // Internal control: turn off NLP mode after generation
      nlpMode.value = false;
    }
    isNaturalLanguageDetected.value = false;
  }

  emit("generation-success", { type, message });
};

// Watch for language prop changes
watch(
  () => props.defaultLanguage,
  (newLang) => {
    if (newLang && newLang !== currentLanguage.value) {
      currentLanguage.value = newLang;
    }
  },
);

// Watch for query changes and update editor if needed
watch(
  () => props.query,
  (newQuery) => {
    // Only update if editor exists and query is different
    if (!editorRef.value?.getValue) return;

    const currentValue = editorRef.value.getValue();
    // Coerce to string so a null/undefined query (e.g. switching PromQL → SQL)
    // doesn't reach Monaco's setValue, which throws "Illegal argument"
    const nextValue = newQuery ?? "";

    // Compare trimmed values to avoid cursor jumps from whitespace differences
    // This prevents setValue calls when user is typing trailing spaces
    if (currentValue?.trim() === nextValue.trim()) {
      return;
    }

    if (editorRef.value.setValue) {
      editorRef.value.setValue(nextValue);
    }
  },
);

// Watch for streaming response from CodeQueryEditor
watch(
  () => editorRef.value?.streamingResponse,
  (newStreamingResponse) => {
    if (newStreamingResponse && isAIMode.value) {
      streamingText.value = newStreamingResponse;
    }
  },
);

// Expose methods for parent components
defineExpose({
  // AI generation
  generateQuery: async () => {
    if (editorRef.value?.handleGenerateSQL) {
      await editorRef.value.handleGenerateSQL();
    }
  },
  handleGenerateSQL: async (naturalLanguage?: string) => {
    if (editorRef.value?.handleGenerateSQL) {
      await editorRef.value.handleGenerateSQL(naturalLanguage);
    }
  },

  // Editor state
  focus: () => editorRef.value?.editorObj?.focus(),
  getValue: () => {
    return editorRef.value?.getValue();
  },
  setValue: (value: string) => {
    if (editorRef.value?.setValue) {
      editorRef.value.setValue(value);
    }
  },
  replaceValue: (value: string) => {
    if (editorRef.value?.replaceValue) editorRef.value.replaceValue(value);
    else if (editorRef.value?.setValue) editorRef.value.setValue(value);
  },

  // Cursor and autocomplete (for dashboards)
  getCursorIndex: () => {
    return editorRef.value?.getCursorIndex ? editorRef.value.getCursorIndex() : 0;
  },
  triggerAutoComplete: async (value?: string) => {
    if (editorRef.value?.triggerAutoComplete) {
      await editorRef.value.triggerAutoComplete(value);
    }
  },
  disableSuggestionPopup: () => {
    if (editorRef.value?.disableSuggestionPopup) {
      editorRef.value.disableSuggestionPopup();
    }
  },

  // NL Mode control
  toggleNlpMode: (enabled: boolean) => {
    nlpMode.value = enabled;
  },

  // Language control
  getCurrentLanguage: () => currentLanguage.value,
  setLanguage: (lang: Language) => {
    currentLanguage.value = lang;
  },

  // Layout
  resetEditorLayout: () => {
    if (editorRef.value?.resetEditorLayout) {
      editorRef.value.resetEditorLayout();
    }
  },

  // Error diagnostics
  addErrorDiagnostics: (ranges: any[]) => {
    if (editorRef.value?.addErrorDiagnostics) {
      editorRef.value.addErrorDiagnostics(ranges);
    }
  },
  clearErrorDiagnostics: () => {
    if (editorRef.value?.addErrorDiagnostics) {
      editorRef.value.addErrorDiagnostics([]);
    }
  },

  // State (for parent components that need to read generation status)
  isGenerating: computed(() => isGenerating.value),

  // Streaming response (for AI status display)
  streamingResponse: computed(() => editorRef.value?.streamingResponse),
});
</script>
