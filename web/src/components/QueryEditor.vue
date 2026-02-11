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
      <!-- Show streaming status with spinner -->
      <div v-if="isGenerating" class="ai-bar-streaming tw:flex tw:items-center tw:gap-2">
        <img :src="nlpIcon" alt="AI" class="tw:w-[20px] tw:h-[20px]" />
        <q-spinner-dots color="primary" size="1.2em" />
        <span class="tw:text-sm tw:flex-1">{{ streamingText || aiStatusText || 'Analyzing query...' }}</span>
      </div>
      <!-- Normal input when not generating -->
      <div v-else class="tw:flex tw:items-center tw:gap-2">
        <q-input
          v-model="aiInputText"
          dense
          borderless
          :placeholder="t('search.askAIPlaceholder')"
          class="ai-input-field tw:flex-1"
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
          :disable="!aiInputText.trim()"
          :data-test="`${dataTestPrefix}-ai-send-btn`"
          @click="handleAIGenerate"
          class="ai-send-button"
        >
          <q-tooltip v-if="!aiInputText.trim()">
            {{ t('search.enterPrompt') || 'Enter a prompt to generate query' }}
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
          <q-tooltip>{{ t('common.close') || 'Close' }}</q-tooltip>
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
        @update:query="handleQueryUpdate"
        @nlpModeDetected="handleNlpModeDetected"
        @generation-start="handleGenerationStart"
        @generation-end="handleGenerationEnd"
        @generation-success="handleGenerationSuccess"
        class="monaco-editor tw:w-full tw:h-full"
      />

      <!-- Floating AI Icon (top-right corner of editor) - hidden when AI bar is open -->
      <q-btn
        v-if="store.state.zoConfig.ai_enabled && !hideNlToggle && !isAIMode"
        :data-test="`${dataTestPrefix}-ai-toggle-btn`"
        round
        unelevated
        size="sm"
        @click="nlpMode = true"
        class="ai-floating-button"
      >
        <img :src="nlpIcon" alt="AI Mode" class="tw:w-[18px] tw:h-[18px]" />
        <q-tooltip>{{ t('nlMode.enable') }}</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import CodeQueryEditor from '@/components/CodeQueryEditor.vue';
import { getImageURL } from '@/utils/zincutils';

type Language = 'sql' | 'promql' | 'vrl' | 'javascript';

interface Props {
  // Language configuration
  languages?: Language[];        // Available languages (default: ['sql'])
  defaultLanguage?: Language;    // Initial language

  // Query props
  query: string;
  readOnly?: boolean;
  showAutoComplete?: boolean;

  // UI customization
  editorHeight?: string;
  hideNlToggle?: boolean;       // Hide floating AI icon (for pages that don't want AI)

  // Testing
  dataTestPrefix?: string;
}

const props = withDefaults(defineProps<Props>(), {
  languages: () => ['sql'],
  defaultLanguage: 'sql',
  readOnly: false,
  showAutoComplete: true,
  editorHeight: '200px',
  hideNlToggle: false,
  dataTestPrefix: 'query-editor',
});

const emit = defineEmits<{
  'update:query': [query: string];
  'language-change': [language: Language];
  'ask-ai': [naturalLanguage: string, language: Language];
}>();

const store = useStore();
const { t } = useI18n();

// Language state
const currentLanguage = ref<Language>(props.defaultLanguage);

// NL Mode state
const nlpMode = ref(false);
const isNaturalLanguageDetected = ref(false);
const isGenerating = ref(false);
const editorRef = ref<any>(null);

// AI Input Bar state
const aiInputText = ref('');
const streamingText = ref(''); // Real-time streaming response from chat_stream
const aiStatusText = ref('');

const nlpIcon = computed(() => {
  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon.svg');
});

// Computed: Is in AI mode?
const isAIMode = computed(() => nlpMode.value || isNaturalLanguageDetected.value);

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
};

// Handle AI input field Enter key - delegate to handleAIGenerate
const handleAIInputEnter = async () => {
  await handleAIGenerate();
};

// Handle AI generation (send button click)
const handleAIGenerate = async () => {
  const userInput = aiInputText.value.trim();

  if (!userInput) {
    console.warn('[QueryEditor] No input provided for AI generation');
    return;
  }

  const currentQuery = editorRef.value?.getValue ? editorRef.value.getValue() : props.query;

  // Build the prompt based on whether there's an existing query
  let naturalLanguage = '';
  if (currentQuery && currentQuery.trim()) {
    naturalLanguage = `Modify this ${currentLanguage.value.toUpperCase()} query to ${userInput}:\n\n${currentQuery}`;
    console.log('[QueryEditor] Modifying existing query with user instruction');
  } else {
    // No existing query, treat as new query generation
    naturalLanguage = userInput;
    console.log('[QueryEditor] Generating new query from user input');
  }

  // Call the CodeQueryEditor's handleGenerateSQL method directly
  if (editorRef.value && typeof editorRef.value.handleGenerateSQL === 'function') {
    console.log('[QueryEditor] Generating query from natural language:', naturalLanguage);
    try {
      aiStatusText.value = 'Generating query...';
      await editorRef.value.handleGenerateSQL(naturalLanguage);
      // Success is handled by handleGenerationSuccess event
    } catch (error) {
      console.error('[QueryEditor] Query generation failed:', error);
      aiStatusText.value = '';
    }
  } else {
    console.error('[QueryEditor] Editor ref not found or handleGenerateSQL not available');
  }

  // Emit event for parent components
  emit('ask-ai', naturalLanguage, currentLanguage.value);
};

// Dismiss AI mode (close button)
const dismissAIMode = () => {
  nlpMode.value = false;
  isNaturalLanguageDetected.value = false;
  aiInputText.value = '';
  aiStatusText.value = '';
  streamingText.value = '';
};

// Handle generation lifecycle events
const handleGenerationStart = () => {
  isGenerating.value = true;
};

const handleGenerationEnd = () => {
  isGenerating.value = false;
};

const handleGenerationSuccess = ({ type, message }: any) => {
  console.log('[QueryEditor] Generation success:', { type, message });

  // Show success message in AI status
  aiStatusText.value = '✓ Query generated successfully!';

  // Clear AI input text after successful generation
  setTimeout(() => {
    aiInputText.value = '';
    aiStatusText.value = '';
  }, 2000);

  // After successful generation, turn off NLP mode
  if (type === 'sql' || type === 'promql' || type === 'vrl' || type === 'javascript') {
    nlpMode.value = false;
    isNaturalLanguageDetected.value = false;
  }
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

  // Streaming response (for AI status display)
  streamingResponse: computed(() => editorRef.value?.streamingResponse),
});
</script>

<style scoped>
.query-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Editor container - clips Monaco but keeps floating button visible */
.editor-container {
  overflow: hidden;
}

/* Floating AI Button (top-right corner) */
.ai-floating-button {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 100;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white !important;
  box-shadow: 0 2px 8px 0 rgba(102, 126, 234, 0.4) !important;
  transition: all 0.3s ease !important;
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  min-height: 32px !important;
}

.ai-floating-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px 0 rgba(102, 126, 234, 0.6) !important;
}

.ai-floating-button.ai-floating-active {
  background: linear-gradient(135deg, #764ba2 0%, #667eea 100%) !important;
  box-shadow: 0 2px 12px 0 rgba(118, 75, 162, 0.6) !important;
}

.ai-floating-button:active {
  transform: translateY(0);
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

/* Dark mode styling */
.q-dark .ai-input-field :deep(.q-field__control) {
  background: var(--q-dark);
}

.q-dark .ai-bar-streaming {
  background: var(--q-dark);
}

.q-dark .ai-bar-streaming span {
  color: #ccc;
}
</style>
