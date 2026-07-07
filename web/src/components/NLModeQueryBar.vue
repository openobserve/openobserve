<template>
  <div class="w-full flex flex-col gap-2">
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
      <div class="flex items-center gap-2 mb-2">
        <!-- NL Mode Toggle (always visible when AI enabled and enterprise) -->
        <div
          v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
          class="flex items-center gap-2 py-1 px-2 rounded element-box-shadow"
          style="background-color: var(--q-dark-page)"
        >
          <OSwitch
            :data-test="`${dataTestPrefix}-nlp-mode-toggle`"
            v-model="nlpMode"
          />
          <img :src="nlpIcon" alt="NL Mode" class="w-5 h-5" />
          <OTooltip :content="t('nlMode.toggle')" side="top" />
        </div>

        <!-- Action Buttons (always present) -->
        <div class="flex gap-2 ml-auto">
          <!-- Main Action Button: Run Query / Ask AI -->
          <OButton
            :data-test="`${dataTestPrefix}-action-btn`"
            :variant="isAIMode ? 'ghost-primary' : 'ghost'"
            size="sm"
            :title="isAIMode ? aiButtonTooltip : normalButtonTooltip"
            :class="buttonClasses"
            :loading="loading"
            :disabled="disabled || (isAIMode && isGenerating)"
            @click="handleButtonClick"
          >
            <OIcon
              v-if="showIcon"
              :name="isAIMode ? 'auto-awesome' : 'search'" size="sm"
              class="mr-1"
            />
            {{ isAIMode ? aiButtonLabel : normalButtonLabel }}
          </OButton>

          <!-- Dropdown (optional - for enterprise features) -->
          <template v-if="showDropdown">
            <OSeparator class="h-7.25 w-px" />
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  class="h-7.25 search-button-dropdown"
                  :class="dropdownClasses"
                >
                  <OIcon name="arrow-drop-down" size="sm" />
                </OButton>
              </template>
              <!-- Normal Mode: Refresh option -->
              <template v-if="!isAIMode">
                <ODropdownItem
                  :disabled="disabled"
                  @select="$emit('refresh')"
                >
                  <template #icon-left>
                    <OIcon name="refresh" size="sm" />
                  </template>
                  {{ t('search.refreshCacheAndRunQuery') }}
                </ODropdownItem>
              </template>
              <!-- AI Mode: Custom actions (slot) -->
              <template v-else>
                <slot name="dropdown-actions">
                  <div class="min-w-35 p-2 text-xs text-center text-dropdown-item-text">
                    {{ t('nlMode.noAdditionalOptions') }}
                  </div>
                </slot>
              </template>
            </ODropdown>
          </template>
        </div>
      </div>

      <!-- Query Editor with AI Input Bar -->
      <div class="w-full">
        <!-- AI Input Bar (shown in NL Mode) -->
        <div
          v-if="isAIMode"
          class="p-3 bg-[linear-gradient(135deg,rgba(139,92,246,0.05)_0%,rgba(236,72,153,0.05)_100%)] border-b border-(--o2-border-color)"
        >
          <!-- Show streaming status with spinner -->
          <div v-if="isGenerating" class="ai-bar-streaming flex items-center gap-2 bg-white rounded-lg py-2 px-3 text-(--q-primary)">
            <img :src="nlpIcon" alt="AI" class="w-5 h-5" />
            <OSpinner variant="dots" size="xs" />
            <span class="text-sm text-[#666]">{{ aiStatusText || t('search.analyzingQuery') }}</span>
          </div>
          <!-- Normal input when not generating -->
          <OInput
            v-else
            v-model="aiInputText"
            :placeholder="t('search.askAIPlaceholder')"
            class="ai-input-field"
            :data-test="`${dataTestPrefix}-ai-input-field`"
            @keydown.enter="handleAIInputEnter"
          >
            <template v-slot:icon-left>
              <img :src="nlpIcon" alt="AI" class="w-5 h-5" />
            </template>
          </OInput>
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
import OButton from '@/lib/core/Button/OButton.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
import { getImageURL } from '@/utils/zincutils';
import config from '@/aws-exports';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

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
    : getImageURL('images/common/ai_icon_gradient.svg');
});

// Computed: Is in AI mode?
const isAIMode = computed(() => nlpMode.value || isNaturalLanguageDetected.value);

// Computed: Button classes
const buttonClasses = computed(() => {
  const classes = [
    'p-0',
    `h-[${props.height}]`,
    'element-box-shadow',
  ];

  if (isAIMode.value) {
    classes.push('bg-[linear-gradient(135deg,#8B5CF6_0%,#EC4899_100%)]! text-white! border-none! text-[0.6875rem]! font-semibold! leading-[1rem]! transition-all! duration-300! ease-[ease]! shadow-[0_0.25rem_0.9375rem_0_rgba(139,92,246,0.3)]! px-3! w-[92px]! hover:shadow-[0_0.375rem_1.25rem_0_rgba(139,92,246,0.5)]! hover:-translate-y-px active:translate-y-0');
  } else {
    classes.push('w-[92px]!', 'o2-color-primary');
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
    aiInputText.value = ''; // Clear input
    emit('run-query'); // Trigger query execution
    return;
  }

  // Call the CodeQueryEditor's handleGenerateSQL method directly
  if (editorRef.value && typeof editorRef.value.handleGenerateSQL === 'function') {
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

