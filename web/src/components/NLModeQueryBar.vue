<template>
  <div class="nl-mode-query-bar tw:w-full">
    <!-- Compact Layout: Editor only (toggle/button provided by parent) -->
    <template v-if="layout === 'editor-only'">
      <CodeQueryEditor
        :ref="(el) => (editorRef = el)"
        :editor-id="`${dataTestPrefix}-editor`"
        :language="language"
        :query="query"
        :nlp-mode="nlpMode"
        :read-only="readOnly"
        :show-auto-complete="showAutoComplete"
        @update:query="handleQueryUpdate"
        @nlpModeDetected="handleNlpModeDetected"
        @generation-start="handleGenerationStart"
        @generation-end="handleGenerationEnd"
        @generation-success="handleGenerationSuccess"
      />
    </template>

    <!-- Full Layout: Toggle + Editor + Button -->
    <template v-else>
      <!-- NL Mode Toggle Bar -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
        <!-- NL Mode Toggle (always visible when AI enabled) -->
        <div
          v-if="store.state.zoConfig.ai_enabled"
          class="toolbar-toggle-container element-box-shadow"
        >
          <q-toggle
            :data-test="`${dataTestPrefix}-nlp-mode-toggle`"
            v-model="nlpMode"
            class="o2-toggle-button-xs"
            size="xs"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-xs-dark'
                : 'o2-toggle-button-xs-light'
            "
          />
          <img :src="nlpIcon" alt="NL Mode" class="toolbar-icon" />
          <q-tooltip>{{ t('nlMode.toggle') }}</q-tooltip>
        </div>

        <!-- Action Buttons (always present) -->
        <div class="tw:flex tw:gap-2 tw:ml-auto">
          <!-- Main Action Button: Run Query / Ask AI -->
          <q-btn
            :data-test="`${dataTestPrefix}-action-btn`"
            dense
            flat
            no-caps
            :title="isAIMode ? aiButtonTooltip : normalButtonTooltip"
            :class="buttonClasses"
            :color="isAIMode ? 'primary' : undefined"
            :loading="loading"
            :disable="disabled || (isAIMode && isGenerating)"
            @click="handleButtonClick"
          >
            <q-icon
              v-if="showIcon"
              :name="isAIMode ? 'auto_awesome' : 'search'"
              class="q-mr-xs"
            />
            {{ isAIMode ? aiButtonLabel : normalButtonLabel }}
          </q-btn>

          <!-- Dropdown (optional - for enterprise features) -->
          <template v-if="showDropdown">
            <q-separator class="tw:h-[29px] tw:w-[1px]" />
            <q-btn-dropdown
              flat
              dense
              class="tw:h-[29px] search-button-dropdown"
              :class="dropdownClasses"
            >
              <!-- Normal Mode: Refresh option -->
              <template v-if="!isAIMode">
                <q-btn
                  dense
                  flat
                  no-caps
                  :title="t('search.refreshCacheAndRunQuery')"
                  class="q-pa-sm tw:text-[12px]"
                  v-close-popup
                  @click="$emit('refresh')"
                  :disable="disabled"
                >
                  <q-icon name="refresh" class="q-mr-xs" />
                  {{ t('search.refreshCacheAndRunQuery') }}
                </q-btn>
              </template>

              <!-- AI Mode: Custom actions (slot) -->
              <template v-else>
                <slot name="dropdown-actions">
                  <q-list class="tw:min-w-[140px] tw:p-2">
                    <q-item-label class="tw:text-xs tw:text-gray-500 tw:text-center">
                      {{ t('nlMode.noAdditionalOptions') }}
                    </q-item-label>
                  </q-list>
                </slot>
              </template>
            </q-btn-dropdown>
          </template>
        </div>
      </div>

      <!-- Query Editor with AI Input Bar -->
      <div class="tw:w-full">
        <!-- AI Input Bar (shown in NL Mode) -->
        <div
          v-if="isAIMode"
          class="ai-input-bar tw:p-3"
        >
          <!-- Show streaming status with spinner -->
          <div v-if="isGenerating" class="ai-bar-streaming tw:flex tw:items-center tw:gap-2">
            <img :src="nlpIcon" alt="AI" class="tw:w-[20px] tw:h-[20px]" />
            <q-spinner-dots color="primary" size="1.2em" />
            <span class="tw:text-sm">{{ aiStatusText || t('search.analyzingQuery') }}</span>
          </div>
          <!-- Normal input when not generating -->
          <q-input
            v-else
            v-model="aiInputText"
            dense
            borderless
            :placeholder="t('search.askAIPlaceholder')"
            class="ai-input-field"
            :data-test="`${dataTestPrefix}-ai-input-field`"
            @keydown.enter="handleAIInputEnter"
          >
            <template v-slot:prepend>
              <img :src="nlpIcon" alt="AI" class="tw:w-[20px] tw:h-[20px]" />
            </template>
          </q-input>
        </div>

        <!-- Code Editor -->
        <CodeQueryEditor
          :ref="(el) => (editorRef = el)"
          :editor-id="`${dataTestPrefix}-editor`"
          :language="language"
          :query="query"
          :nlp-mode="nlpMode"
          :read-only="readOnly"
          :show-auto-complete="showAutoComplete"
          @update:query="handleQueryUpdate"
          @nlpModeDetected="handleNlpModeDetected"
          @generation-start="handleGenerationStart"
          @generation-end="handleGenerationEnd"
          @generation-success="handleGenerationSuccess"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import CodeQueryEditor from '@/components/CodeQueryEditor.vue';
import { getImageURL } from '@/utils/zincutils';

interface Props {
  // Query props
  language: 'sql' | 'promql' | 'vrl' | 'javascript';
  query: string;
  readOnly?: boolean;
  showAutoComplete?: boolean;

  // Context-aware button labels (ONLY thing that changes per page)
  normalButtonLabel?: string;     // "Run Query", "Test Query", "Apply Query", "Validate VRL"
  aiButtonLabel?: string;        // Always "Ask AI" (default)
  normalButtonTooltip?: string;
  aiButtonTooltip?: string;

  // State
  loading?: boolean;
  disabled?: boolean;

  // UI customization
  layout?: 'full' | 'editor-only';  // full: toggle + editor + button, editor-only: just editor
  showIcon?: boolean;
  showDropdown?: boolean;
  borderRadius?: 'normal' | 'enterprise';
  height?: string;

  // Testing
  dataTestPrefix?: string;
}

const props = withDefaults(defineProps<Props>(), {
  readOnly: false,
  showAutoComplete: true,
  normalButtonLabel: 'Run Query',
  aiButtonLabel: 'Ask AI',
  normalButtonTooltip: 'Execute action',
  aiButtonTooltip: 'Generate query from natural language using AI',
  layout: 'full',
  showIcon: true,
  showDropdown: false,
  borderRadius: 'normal',
  height: '30px',
  dataTestPrefix: 'nl-mode',
});

const emit = defineEmits<{
  'update:query': [query: string];
  'run-query': [];               // Normal mode action
  'ask-ai': [naturalLanguage: string];  // AI mode action
  refresh: [];                   // Refresh cache action
}>();

const store = useStore();
const { t } = useI18n();

const nlpMode = ref(false);
const isNaturalLanguageDetected = ref(false);
const isGenerating = ref(false);
const editorRef = ref<any>(null);

// AI Input Bar state
const aiInputText = ref('');
const aiStatusText = ref('');

const nlpIcon = computed(() => {
  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon.svg');
});

// Computed: Is in AI mode?
const isAIMode = computed(() => nlpMode.value || isNaturalLanguageDetected.value);

// Computed: Button classes
const buttonClasses = computed(() => {
  const classes = [
    'q-pa-none',
    `tw:h-[${props.height}]`,
    'element-box-shadow',
  ];

  if (isAIMode.value) {
    classes.push('o2-ai-generate-button');
  } else {
    classes.push('o2-run-query-button', 'o2-color-primary');
  }

  if (props.borderRadius === 'enterprise') {
    classes.push('search-button-enterprise-border-radius');
  } else {
    classes.push('search-button-normal-border-radius');
  }

  return classes;
});

// Computed: Dropdown classes
const dropdownClasses = computed(() => {
  const classes = [];

  if (isAIMode.value) {
    classes.push('o2-ai-dropdown-button');
  } else {
    classes.push('o2-color-primary');
  }

  if (props.borderRadius === 'enterprise') {
    classes.push('search-button-dropdown-enterprise-border-radius');
  } else {
    classes.push('search-button-normal-border-radius');
  }

  return classes;
});

// Handle query update from editor
const handleQueryUpdate = (newQuery: string) => {
  emit('update:query', newQuery);
};

// Handle auto-detection from editor
const handleNlpModeDetected = (isNL: boolean) => {
  isNaturalLanguageDetected.value = isNL;
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

// Handle AI input field Enter key
const handleAIInputEnter = async () => {
  if (!aiInputText.value.trim()) {
    return;
  }

  const naturalLanguage = aiInputText.value.trim();
  const currentQuery = editorRef.value?.getValue ? editorRef.value.getValue() : props.query;

  // Check if user wants to execute the query instead of generating a new one
  if (currentQuery && currentQuery.trim() && isExecutionIntent(naturalLanguage)) {
    console.log('[NLModeQueryBar] Execution intent detected, running query instead of generating');
    aiInputText.value = ''; // Clear input
    emit('run-query'); // Trigger query execution
    return;
  }

  // Call the CodeQueryEditor's handleGenerateSQL method directly
  if (editorRef.value && typeof editorRef.value.handleGenerateSQL === 'function') {
    console.log('[NLModeQueryBar] Generating query from natural language:', naturalLanguage);
    try {
      aiStatusText.value = t('search.generatingQuery');
      await editorRef.value.handleGenerateSQL(naturalLanguage);
      // Success is handled by handleGenerationSuccess event
    } catch (error) {
      console.error('[NLModeQueryBar] Query generation failed:', error);
      aiStatusText.value = '';
    }
  } else {
    console.error('[NLModeQueryBar] Editor ref not found or handleGenerateSQL not available');
  }

  // Still emit event for parent components that may need to react
  emit('ask-ai', naturalLanguage);
};

// Handle button click
const handleButtonClick = async () => {
  if (isAIMode.value) {
    // Ask AI mode - generate query using streaming API
    // Use AI input text if available, otherwise use query from editor
    const naturalLanguage = aiInputText.value.trim() || props.query;

    if (!naturalLanguage) {
      console.warn('[NLModeQueryBar] No input provided for AI generation');
      return;
    }

    const currentQuery = editorRef.value?.getValue ? editorRef.value.getValue() : props.query;

    // Check if user wants to execute the query instead of generating a new one
    if (currentQuery && currentQuery.trim() && isExecutionIntent(naturalLanguage)) {
      console.log('[NLModeQueryBar] Execution intent detected, running query instead of generating');
      aiInputText.value = ''; // Clear input
      emit('run-query'); // Trigger query execution
      return;
    }

    // Turn on NLP mode if not already on
    if (!nlpMode.value) {
      nlpMode.value = true;
    }

    // Call the CodeQueryEditor's handleGenerateSQL method directly
    if (editorRef.value && typeof editorRef.value.handleGenerateSQL === 'function') {
      console.log('[NLModeQueryBar] Generating query from natural language:', naturalLanguage);
      try {
        aiStatusText.value = t('search.generatingQuery');
        await editorRef.value.handleGenerateSQL(naturalLanguage);
        // Success is handled by handleGenerationSuccess event
      } catch (error) {
        console.error('[NLModeQueryBar] Query generation failed:', error);
        aiStatusText.value = '';
      }
    } else {
      console.error('[NLModeQueryBar] Editor ref not found or handleGenerateSQL not available');
    }

    // Still emit event for parent components that may need to react
    emit('ask-ai', naturalLanguage);
  } else {
    // Normal mode - run query
    emit('run-query');
  }
};

// Handle generation lifecycle events
const handleGenerationStart = () => {
  isGenerating.value = true;
};

const handleGenerationEnd = () => {
  isGenerating.value = false;
};

const handleGenerationSuccess = ({ type, message }: any) => {
  console.log('[NLModeQueryBar] Generation success:', { type, message });

  // Show success message in AI status
  aiStatusText.value = '✓ ' + t('search.queryGeneratedSuccess');

  // Clear AI input text after successful generation
  setTimeout(() => {
    aiInputText.value = '';
    aiStatusText.value = '';
  }, 2000);

  // After successful generation, turn off NLP mode
  if (type === 'sql' || type === 'promql' || type === 'vrl') {
    nlpMode.value = false;
    isNaturalLanguageDetected.value = false;
  }
};

// Expose methods for parent components
defineExpose({
  generateQuery: async () => {
    if (editorRef.value?.handleGenerateSQL) {
      await editorRef.value.handleGenerateSQL();
    }
  },
  getValue: () => {
    return editorRef.value?.getValue();
  },
  setValue: (value: string) => {
    if (editorRef.value?.setValue) {
      editorRef.value.setValue(value);
    }
  },
  toggleNlpMode: (enabled: boolean) => {
    nlpMode.value = enabled;
  },
});
</script>

<style scoped>
.nl-mode-query-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toolbar-toggle-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  background-color: var(--q-dark-page);
}

.toolbar-icon {
  width: 20px;
  height: 20px;
}

/* AI Generate Button Styling (matches O2 AI Assistant - purple gradient) */
.o2-ai-generate-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white !important;
  border: none !important;
  font-size: 0.6875rem !important; /* 11px */
  font-weight: 600 !important;
  line-height: 1rem !important; /* 16px */
  transition: all 0.3s ease !important;
  box-shadow: 0 0.25rem 0.9375rem 0 rgba(102, 126, 234, 0.3) !important; /* 0 4px 15px */
  padding: 0 0.75rem !important; /* 0 12px */
  width: 92px !important; /* Fixed width to prevent layout shift */
}

.o2-ai-generate-button:hover {
  box-shadow: 0 0.375rem 1.25rem 0 rgba(102, 126, 234, 0.5) !important; /* 0 6px 20px */
  transform: translateY(-1px);
}

.o2-ai-generate-button:active {
  transform: translateY(0);
}

/* Run Query Button - Fixed width to match AI button and prevent layout shift */
.o2-run-query-button {
  width: 92px !important; /* Same as AI button */
}

/* AI Input Bar Styling (matches logs page) */
.ai-input-bar {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
  border-bottom: 1px solid var(--o2-border-color);
}

.ai-input-field :deep(.q-field__control) {
  background: white;
  border-radius: 8px;
  padding: 4px 8px;
}

/* Remove focus border */
.ai-input-field :deep(.q-field__control::before),
.ai-input-field :deep(.q-field__control::after) {
  border: none !important;
}

.ai-input-field :deep(.q-field__prepend) {
  padding-right: 8px;
}

/* Streaming status display (matches O2 AI assistant style) */
.ai-bar-streaming {
  background: white;
  border-radius: 8px;
  padding: 8px 12px;
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
