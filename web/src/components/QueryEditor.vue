<!-- Unified Query Editor Component
  Supports: SQL, PromQL, VRL, JavaScript
  Features: NL Mode (AI), Language Switching, Auto-detection
-->

<template>
  <div class="query-editor tw:w-full tw:relative" :style="rootStyle">
    <!-- AI Input Bar (shown in NL Mode) - Positioned at top -->
    <div
      v-if="isAIMode"
      class="ai-input-bar tw:p-2 tw:flex-shrink-0 tw:z-10"
    >
      <!-- Show streaming status with spinner + stop button -->
      <div v-if="isGenerating" :class="aiBarStreamingClass">
        <img :src="nlpIcon" alt="AI" class="tw:w-[20px] tw:h-[20px]" />
        <q-spinner-dots color="primary" size="1.2em" />
        <span class="tw:text-sm tw:flex-1">{{ streamingText || aiStatusText || t('search.analyzingQuery') }}</span>
        <q-btn
          round
          flat
          dense
          icon="stop"
          size="sm"
          :data-test="`${dataTestPrefix}-ai-stop-btn`"
          @click="cancelGeneration"
          class="ai-stop-button"
        >
          <q-tooltip>{{ t('common.stopGenerating') }}</q-tooltip>
        </q-btn>
      </div>
      <!-- Normal input when not generating -->
      <div v-else class="tw:flex tw:items-center tw:gap-2">
        <q-input
          v-model="aiInputText"
          dense
          borderless
          :placeholder="props.aiPlaceholder || t('search.askAIPlaceholder')"
          :class="aiInputFieldClass"
          :data-test="`${dataTestPrefix}-ai-input-field`"
          @keydown.enter="handleAIInputEnter"
        >
          <template v-slot:prepend>
            <img :src="nlpIcon" alt="AI" class="tw:w-[20px] tw:h-[20px]" />
          </template>
        </q-input>
        <!-- Send Button -->
        <q-btn
          round
          flat
          dense
          icon="send"
          color="primary"
          :disable="!aiInputText.trim() || props.disableAi"
          :data-test="`${dataTestPrefix}-ai-send-btn`"
          @click="handleAIGenerate"
          class="ai-send-button"
        >
          <q-tooltip v-if="props.disableAi && props.disableAiReason">
            {{ props.disableAiReason }}
          </q-tooltip>
          <q-tooltip v-else-if="!aiInputText.trim()">
            {{ props.aiTooltip || t("search.enterPrompt") }}
          </q-tooltip>
        </q-btn>
        <!-- Close Button -->
        <q-btn
          round
          flat
          dense
          icon="close"
          size="sm"
          :data-test="`${dataTestPrefix}-ai-close-btn`"
          @click="dismissAIMode"
          class="ai-close-button"
        >
          <q-tooltip>{{ t('common.close') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Code Editor with relative positioning for floating button -->
    <div class="editor-container tw:relative tw:flex-1 tw:min-h-0">
      <CodeQueryEditor
        :ref="(el) => (editorRef = el)"
        :editor-id="`${dataTestPrefix}-editor-${currentLanguage}`"
        :language="currentLanguage"
        :query="query"
        :nlp-mode="nlpMode"
        :read-only="readOnly"
        :show-auto-complete="showAutoComplete"
        :keywords="keywords"
        :suggestions="suggestions"
        :debounce-time="debounceTime"
        @update:query="handleQueryUpdate"
        @run-query="emit('run-query')"
        @focus="emit('focus')"
        @blur="emit('blur')"
        @nlpModeDetected="handleNlpModeDetected"
        @generation-start="handleGenerationStart"
        @generation-end="handleGenerationEnd"
        @generation-success="handleGenerationSuccess"
        class="monaco-editor tw:w-full tw:h-full"
      />

      <!-- Floating AI Icon (top-right corner of editor) - hidden when AI bar is open -->
      <q-btn
        v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled && !hideNlToggle && !isAIMode"
        :data-test="`${dataTestPrefix}-ai-toggle-btn`"
        round
        unelevated
        size="sm"
        :disable="props.disableAi"
        @click="nlpMode = true"
        class="ai-floating-button"
      >
        <img :src="nlpIcon" alt="AI Mode" class="tw:w-[18px] tw:h-[18px] ai-icon" />
        <q-tooltip>{{ props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle') }}</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import CodeQueryEditor from '@/components/CodeQueryEditor.vue';
import { getImageURL, getUUIDv7 } from '@/utils/zincutils';
import { useChatHistory } from '@/composables/useChatHistory';
import type { ChatMessage } from '@/types/chat';
import config from '@/aws-exports';

type Language = 'sql' | 'promql' | 'vrl' | 'javascript';

interface Props {
  // Language configuration
  languages?: Language[];        // Available languages (default: ['sql'])
  defaultLanguage?: Language;    // Initial language

  // Query props
  query: string;
  readOnly?: boolean;
  showAutoComplete?: boolean;

  // Editor autocomplete (forwarded to CodeQueryEditor)
  keywords?: any[];              // Autocomplete keywords for Monaco
  suggestions?: any[];           // Autocomplete suggestions for Monaco
  debounceTime?: number;         // Debounce time for query updates (ms)

  // NL Mode (optional external control)
  nlpMode?: boolean;            // External NLP mode control (undefined = internal control)

  // UI customization
  editorHeight?: string;
  hideNlToggle?: boolean;       // Hide floating AI icon (for pages that don't want AI)
  disableAi?: boolean;          // Disable AI send (e.g. no stream selected)
  disableAiReason?: string;     // Tooltip reason when AI is disabled
  aiPlaceholder?: string;       // Custom placeholder for AI input (default: 'search.askAIPlaceholder')
  aiTooltip?: string;           // Custom tooltip for AI send button (default: 'search.enterPrompt')

  // Testing
  dataTestPrefix?: string;
}

const props = withDefaults(defineProps<Props>(), {
  languages: () => ['sql'],
  defaultLanguage: 'sql',
  readOnly: false,
  showAutoComplete: true,
  keywords: () => [],
  suggestions: () => [],
  debounceTime: 500,
  nlpMode: undefined,
  editorHeight: '200px',
  hideNlToggle: false,
  disableAi: false,
  disableAiReason: '',
  dataTestPrefix: 'query-editor',
});

const emit = defineEmits<{
  'update:query': [query: string];
  'language-change': [language: Language];
  'ask-ai': [naturalLanguage: string, language: Language];
  'run-query': [];
  'focus': [];
  'blur': [];
  'update:nlpMode': [enabled: boolean];
  'nlp-detected': [isDetected: boolean];
  'generation-start': [];
  'generation-end': [];
  'generation-success': [payload: { type: string; message: string }];
}>();

const store = useStore();
const { t } = useI18n();

// Language state
const currentLanguage = ref<Language>(props.defaultLanguage);

// NL Mode state (supports external control via nlpMode prop, or internal control)
const internalNlpMode = ref(false);
const nlpMode = computed({
  get: () => props.nlpMode !== undefined ? props.nlpMode : internalNlpMode.value,
  set: (val: boolean) => {
    if (props.nlpMode !== undefined) {
      emit('update:nlpMode', val);
    } else {
      internalNlpMode.value = val;
    }
  }
});
const isNaturalLanguageDetected = ref(false);
const isGenerating = ref(false);
const editorRef = ref<any>(null);

// AI Input Bar state
const aiInputText = ref('');
const streamingText = ref(''); // Real-time streaming response from chat_stream
const aiStatusText = ref('');

// Session tracking & cancellation (matches O2 AI Chat patterns)
const currentSessionId = ref<string | null>(null);
const currentAbortController = ref<AbortController | null>(null);

// Chat history tracking (shared IndexedDB with O2AIChat)
const { saveToHistory } = useChatHistory();
const currentChatId = ref<number | null>(null);
const chatMessages = ref<ChatMessage[]>([]);

const nlpIcon = computed(() => {
  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon.svg');
});

// Computed: AI input field class based on theme
const aiInputFieldClass = computed(() => {
  return store.state.theme === 'dark'
    ? 'ai-input-field ai-input-field--dark tw:flex-1'
    : 'ai-input-field tw:flex-1';
});

// Computed: AI streaming bar class based on theme
const aiBarStreamingClass = computed(() => {
  return store.state.theme === 'dark'
    ? 'ai-bar-streaming ai-bar-streaming--dark tw:flex tw:items-center tw:gap-2'
    : 'ai-bar-streaming tw:flex tw:items-center tw:gap-2';
});

// Computed: Is in AI mode?
// When externally controlled (nlpMode prop passed), only show AI bar when nlpMode is explicitly ON.
// The parent decides when the AI bar appears (e.g., after generation success).
// When internally controlled, auto-detection also triggers AI mode.
const isAIMode = computed(() => {
  if (props.nlpMode !== undefined) {
    // External control: only nlpMode matters for showing the AI bar
    return nlpMode.value;
  }
  // Internal control: nlpMode OR auto-detected NL
  return nlpMode.value || isNaturalLanguageDetected.value;
});

// Computed: Root container style - sets overall height
const rootStyle = computed(() => {
  if (props.editorHeight === '100%') {
    return { height: '100%' };
  }
  // For fixed/calc heights, apply to the root so it sizes correctly in any parent
  return { height: props.editorHeight };
});

// Handle query update from editor
const handleQueryUpdate = (newQuery: string) => {
  emit('update:query', newQuery);
};

// Handle auto-detection from editor
const handleNlpModeDetected = (isNL: boolean) => {
  isNaturalLanguageDetected.value = isNL;
  emit('nlp-detected', isNL);
};

// Handle AI input field Enter key - delegate to handleAIGenerate
const handleAIInputEnter = async () => {
  await handleAIGenerate();
};

// Detect if user wants to execute the query instead of generating a new one
const isExecutionIntent = (input: string): boolean => {
  const normalized = input.toLowerCase().trim();
  const executionKeywords = [
    'run', 'run query', 'execute', 'execute query', 'search', 'go',
    'submit', 'apply', 'show results', 'get results', 'fetch',
    'run it', 'execute it', 'do it', 'run this', 'execute this'
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
    console.log('[QueryEditor] Execution intent detected, running query instead of generating');
    aiInputText.value = ''; // Clear input
    emit('run-query'); // Trigger query execution
    return;
  }

  // Build the prompt based on whether there's an existing query
  let naturalLanguage = '';
  if (currentQuery && currentQuery.trim()) {
    naturalLanguage = `Modify this ${currentLanguage.value.toUpperCase()} query to ${userInput}:\n\n${currentQuery}`;
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
  chatMessages.value.push({ role: 'user', content: userInput });

  // Call the CodeQueryEditor's handleGenerateSQL method with abort + session
  if (editorRef.value && typeof editorRef.value.handleGenerateSQL === 'function') {
    try {
      aiStatusText.value = t('search.generatingQuery');
      await editorRef.value.handleGenerateSQL(
        naturalLanguage,
        currentAbortController.value.signal,
        currentSessionId.value,
      );

      // Track assistant response in chat history
      const generatedQuery = editorRef.value.getValue?.() || '';
      chatMessages.value.push({ role: 'assistant', content: generatedQuery });

      // Save to IndexedDB (shared with O2AIChat history)
      const savedId = await saveToHistory(
        chatMessages.value,
        currentSessionId.value!,
        undefined,
        currentChatId.value,
      );
      if (savedId) currentChatId.value = savedId;
    } catch (error) {
      const isAbort = (error as Error)?.name === 'AbortError';

      if (!isAbort) {
        console.error('[QueryEditor] Query generation failed:', error);
      }

      // Save stopped/failed query to chat history so user can see it
      const statusMsg = isAbort
        ? t('search.queryGenerationStopped')
        : t('search.queryGenerationFailed');
      chatMessages.value.push({ role: 'assistant', content: statusMsg });

      const savedId = await saveToHistory(
        chatMessages.value,
        currentSessionId.value!,
        undefined,
        currentChatId.value,
      );
      if (savedId) currentChatId.value = savedId;

      aiStatusText.value = '';
    }
  }

  // Clean up abort controller after completion
  currentAbortController.value = null;

  // Emit event for parent components
  emit('ask-ai', naturalLanguage, currentLanguage.value);
};

// Cancel in-flight AI request
const cancelGeneration = () => {
  if (currentAbortController.value) {
    currentAbortController.value.abort();
    currentAbortController.value = null;
  }
  isGenerating.value = false;
  aiStatusText.value = '';
  streamingText.value = '';
};

// Dismiss AI mode (close button) - also cancels and resets session
const dismissAIMode = () => {
  cancelGeneration();
  nlpMode.value = false;
  isNaturalLanguageDetected.value = false;
  aiInputText.value = '';
  currentSessionId.value = null;
  currentChatId.value = null;
  chatMessages.value = [];
};

// Handle generation lifecycle events
const handleGenerationStart = () => {
  isGenerating.value = true;
  emit('generation-start');
};

const handleGenerationEnd = () => {
  isGenerating.value = false;
  emit('generation-end');
};

const handleGenerationSuccess = ({ type, message }: any) => {
  console.log('[QueryEditor] Generation success:', { type, message });

  // Show success message in AI status
  aiStatusText.value = '✓ ' + t('search.queryGeneratedSuccess');

  // Clear AI input text after successful generation
  setTimeout(() => {
    aiInputText.value = '';
    aiStatusText.value = '';
  }, 2000);

  // After successful generation: only auto-turn-off NLP mode when internally controlled.
  // When externally controlled (nlpMode prop is passed), let the parent decide.
  if (type === 'sql' || type === 'promql' || type === 'vrl' || type === 'javascript') {
    if (props.nlpMode === undefined) {
      // Internal control: turn off NLP mode after generation
      nlpMode.value = false;
    }
    isNaturalLanguageDetected.value = false;
  }

  emit('generation-success', { type, message });
};

// Watch for language prop changes
watch(() => props.defaultLanguage, (newLang) => {
  if (newLang && newLang !== currentLanguage.value) {
    currentLanguage.value = newLang;
  }
});

// Watch for query changes and update editor if needed
watch(() => props.query, (newQuery) => {
  // Only update if editor exists and query is different
  if (editorRef.value && editorRef.value.getValue && editorRef.value.getValue() !== newQuery) {
    console.log('[QueryEditor] External query changed, updating editor:', newQuery);
    if (editorRef.value.setValue) {
      editorRef.value.setValue(newQuery);
    }
  }
});

// Watch for streaming response from CodeQueryEditor
watch(
  () => editorRef.value?.streamingResponse,
  (newStreamingResponse) => {
    if (newStreamingResponse && isAIMode.value) {
      streamingText.value = newStreamingResponse;
    }
  }
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
  getValue: () => {
    return editorRef.value?.getValue();
  },
  setValue: (value: string) => {
    if (editorRef.value?.setValue) {
      editorRef.value.setValue(value);
    }
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

  // State (for parent components that need to read generation status)
  isGenerating: computed(() => isGenerating.value),

  // Streaming response (for AI status display)
  streamingResponse: computed(() => editorRef.value?.streamingResponse),
});
</script>

<style scoped>
.query-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  outline-color: transparent; /* Remove focus outline from root container */  
}

/* Editor container - clips Monaco but keeps floating button visible */
.editor-container {
  overflow: hidden;
}

/* Floating AI Button (top-right corner) - matches MainLayout ai-hover-btn */
.ai-floating-button {
  position: absolute;
  top: 3px;
  right: 8px;
  z-index: 100;
  background: transparent !important;
  color: white !important;
  transition: background 0.3s ease !important;
  width: 30px !important;
  height: 30px !important;
  min-width: 30px !important;
  min-height: 30px !important;
}

.ai-floating-button:hover {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  box-shadow: 0 2px 5px 0 rgba(102, 126, 234, 0.4) !important;
}

/* AI icon rotation on hover - matches MainLayout ai-icon */
.ai-floating-button .ai-icon {
  transition: transform 0.6s ease;
}

.ai-floating-button:hover .ai-icon {
  transform: rotate(180deg);
}

/* AI Send Button (arrow icon inside input bar) */
.ai-send-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white !important;
  transition: all 0.2s ease !important;
  min-width: 28px !important;
  min-height: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.ai-send-button:hover:not([disabled]) {
  transform: translateY(-1px);
  box-shadow: 0 0.25rem 0.75rem 0 rgba(102, 126, 234, 0.4) !important;
}

.ai-send-button:active:not([disabled]) {
  transform: translateY(0);
}

.ai-send-button[disabled] {
  opacity: 0.4 !important;
  background: #ccc !important;
}

/* AI Stop Button (shown during generation) */
.ai-stop-button {
  color: #e74c3c !important;
  transition: all 0.2s ease !important;
}

.ai-stop-button:hover {
  background: rgba(231, 76, 60, 0.1) !important;
}

/* AI Close Button */
.ai-close-button {
  color: #999 !important;
  transition: color 0.2s ease !important;
}

.ai-close-button:hover {
  color: #333 !important;
}

.q-dark .ai-close-button:hover {
  color: #fff !important;
}

/* AI Input Bar Styling */
.ai-input-bar {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
  border-bottom: 1px solid var(--o2-border-color);
}

.ai-input-field :deep(.q-field__control) {
  background: white;
  border-radius: 6px;
  padding: 2px 8px;
  min-height: 32px;
}

/* Remove focus border */
.ai-input-field :deep(.q-field__control::before),
.ai-input-field :deep(.q-field__control::after) {
  border: none !important;
}

.ai-input-field :deep(.q-field__prepend) {
  padding-right: 8px;
}

/* Streaming status display */
.ai-bar-streaming {
  background: white;
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--q-primary);
}

.ai-bar-streaming span {
  color: #666;
}

/* Dark mode styling - using store.state.theme */
.ai-input-field--dark :deep(.q-field__control) {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.ai-input-field--dark :deep(.q-field__native),
.ai-input-field--dark :deep(input) {
  color: #fff !important;
}

.ai-input-field--dark :deep(.q-field__native::placeholder),
.ai-input-field--dark :deep(input::placeholder) {
  color: rgba(255, 255, 255, 0.5) !important;
}

/* Dark mode streaming bar - using store.state.theme */
.ai-bar-streaming--dark {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.ai-bar-streaming--dark span {
  color: #ccc;
}
</style>
