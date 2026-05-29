<!-- Unified Query Editor Component
  Supports: SQL, PromQL, VRL, JavaScript
  Features: NL Mode (AI), Language Switching, Auto-detection
-->

<template>
  <div
    class="query-editor tw:w-full tw:relative"
    :class="{
      'query-editor--fullscreen': fullscreenState,
      'query-editor--bordered': bordered !== false,
    }"
    :style="rootStyle"
    :data-test="`${dataTestPrefix}-root`"
  >
    <!-- Editor body: either split (query + function) or single editor -->
    <div class="query-editor__body tw:relative tw:flex-1 tw:min-h-0 tw:flex">
      <!-- ───────── Split: query + function pane ───────── -->
      <template v-if="enableFunctionPane && functionPaneOpenState">
        <OSplitter
          v-model="splitterState"
          :limits="splitterLimits"
          :horizontal="false"
          :separator-style="{ width: '0.0625rem', background: 'var(--o2-border)', cursor: 'col-resize' }"
          class="query-editor__splitter tw:flex-1 tw:h-full"
        >
          <template #before>
            <div class="query-editor__pane">
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
                  @focus="() => { queryEditorFocused.value = true; emit('focus') }"
                  @blur="() => { queryEditorFocused.value = false; emit('blur') }"
                  @nlpModeDetected="handleNlpModeDetected"
                  @generation-start="handleGenerationStart"
                  @generation-end="handleGenerationEnd"
                  @generation-success="handleGenerationSuccess"
                  class="monaco-editor tw:w-full tw:h-full"
                />
                <span
                  v-if="showQueryPlaceholder"
                  class="query-editor__placeholder"
                  :data-test="`${dataTestPrefix}-placeholder`"
                  aria-hidden="true"
                >
                  {{ queryPlaceholderText }}<span class="query-editor__caret" />
                </span>
                <!-- Legacy floating AI icon (only when footer is hidden) -->
                <OButton
                  v-if="
                    !showBottomBarState &&
                    aiEnabledInEnv &&
                    !hideNlToggle &&
                    !isAIMode
                  "
                  :data-test="`${dataTestPrefix}-ai-toggle-btn`"
                  variant="ghost"
                  size="icon-toolbar"
                  :disabled="props.disableAi"
                  @click="nlpMode = true"
                  class="ai-floating-button"
                >
                  <img :src="nlpIcon" alt="AI Mode" class="tw:w-[18px] tw:h-[18px] ai-icon" />
                  <OTooltip :content="props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle')" />
                </OButton>
              </div>
              <QueryEditorFooter
                compact
                v-if="showBottomBarState"
                :data-test="`${dataTestPrefix}-footer`"
              >
                <template #left>
                  <OToggleGroup
                    type="single"
                    :model-value="currentMode"
                    :disabled="modeDisabled"
                    :data-test="`${dataTestPrefix}-mode-toggle`"
                    @update:model-value="(v: any) => v && (currentMode = String(v))"
                  >
                    <OToggleGroupItem
                      v-for="opt in modeOptions"
                      :key="opt.value"
                      :value="opt.value"
                      size="xs"
                      :disabled="modeDisabled"
                      :tooltip="modeDisabled && modeDisabledReason ? modeDisabledReason : undefined"
                      :data-test="`${dataTestPrefix}-mode-${opt.value}`"
                    >
                      <template v-if="opt.icon" #icon-left>
                        <OIcon :name="opt.icon" size="xs" />
                      </template>
                      {{ opt.label }}
                    </OToggleGroupItem>
                  </OToggleGroup>

                  <span
                    v-if="validation"
                    class="query-editor__validation"
                    :class="{ 'query-editor__validation--error': !validation.valid }"
                    :data-test="`${dataTestPrefix}-validation`"
                  >
                    <span class="query-editor__validation-dot" />
                    {{ validation.message || (validation.valid ? t('search.validSql') : t('search.invalidSql')) }}
                  </span>

                  <slot name="footer-left" />
                </template>

                <template #right>
                  <slot name="footer-right" />

                  <OButton
                    v-if="showFooterAi && aiEnabledInEnv && !hideNlToggle"
                    :data-test="`${dataTestPrefix}-footer-ai-btn`"
                    variant="ai-gradient"
                    size="icon-chip"
                    :disabled="props.disableAi"
                    @click="onMainAiClick"
                  >
                    <img :src="nlpIcon" alt="AI" class="tw:w-[12px] tw:h-[12px] query-editor__ai-icon-invert" />
                    <OTooltip :content="props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle')" />
                  </OButton>

                  <OButton
                    v-if="showFullscreen"
                    :data-test="`${dataTestPrefix}-footer-fullscreen-btn`"
                    variant="ghost"
                    size="icon-chip"
                    :icon-left="fullscreenState ? 'fullscreen-exit' : 'fullscreen'"
                    @click="toggleFullscreen"
                  >
                    <OTooltip :content="fullscreenState ? t('search.collapse') : t('search.expand')" />
                  </OButton>

                  <OButton
                    v-if="showFooterToggle"
                    :data-test="`${dataTestPrefix}-footer-hide-btn`"
                    variant="ghost"
                    size="icon-chip"
                    icon-left="expand-more"
                    @click="hideBottomBar"
                  >
                    <OTooltip :content="t('common.hide')" />
                  </OButton>
                </template>
              </QueryEditorFooter>
            </div>
          </template>

          <template #after>
            <div class="query-editor__pane">
              <div class="editor-container tw:relative tw:flex-1 tw:min-h-0">
                <CodeQueryEditor
                  :ref="(el) => (fnEditorRef = el)"
                  :editor-id="`${functionDataTestPrefix}-editor`"
                  :language="functionLanguage"
                  :query="functionQuery"
                  :nlp-mode="fnNlpMode"
                  :read-only="functionReadOnly"
                  :show-auto-complete="showAutoComplete"
                  :debounce-time="debounceTime"
                  @update:query="onFunctionQueryUpdate"
                  @run-query="emit('run-query')"
                  @focus="() => { fnEditorFocused.value = true; emit('function-focus') }"
                  @blur="() => { fnEditorFocused.value = false; emit('function-blur') }"
                  @keydown="(e: KeyboardEvent) => emit('function-keydown', e)"
                  class="monaco-editor tw:w-full tw:h-full"
                />
                <span
                  v-if="showFunctionPlaceholder"
                  class="query-editor__placeholder"
                  :data-test="`${functionDataTestPrefix}-placeholder`"
                  aria-hidden="true"
                >
                  {{ functionPlaceholderText }}<span class="query-editor__caret" />
                </span>
              </div>
              <QueryEditorFooter
                compact
                v-if="showBottomBarState"
                class="query-editor__fn-zone"
                :data-test="`${functionDataTestPrefix}-footer`"
              >
                <template #left>
                  <!-- Built-in O2 dropdown picker -->
                  <ODropdown
                    v-if="!$slots['function-footer-left']"
                    side="top"
                    align="start"
                  >
                    <template #trigger>
                      <OButton
                        variant="outline"
                        size="chip"
                        icon-right="expand-more"
                        :disabled="functionReadOnly || functionOptions.length === 0"
                        :data-test="`${functionDataTestPrefix}-picker-btn`"
                        class="query-editor__fx-trigger"
                      >
                        <span class="query-editor__fx-pill">
                          <span class="query-editor__fx-mark" aria-hidden="true">fx</span>
                          <span class="query-editor__fx-name">
                            {{ selectedFunction || functionPlaceholder || t('search.selectFunction') }}
                          </span>
                        </span>
                      </OButton>
                    </template>
                    <ODropdownItem
                      v-for="opt in functionOptions"
                      :key="opt.value"
                      :data-test="`${functionDataTestPrefix}-picker-item-${opt.value}`"
                      @select="onSelectFunction(opt)"
                    >
                      {{ opt.label }}
                    </ODropdownItem>
                  </ODropdown>
                  <slot name="function-footer-left" />
                </template>

                <template #right>
                  <slot name="function-footer-right" />

                  <OButton
                    v-if="showFooterAi && aiEnabledInEnv"
                    :data-test="`${functionDataTestPrefix}-ai-btn`"
                    variant="ai-gradient"
                    size="icon-chip"
                    :disabled="functionDisableAi"
                    @click="onFunctionAiClick"
                  >
                    <img :src="nlpIcon" alt="AI" class="tw:w-[12px] tw:h-[12px] query-editor__ai-icon-invert" />
                    <OTooltip :content="functionDisableAi && functionDisableAiReason ? functionDisableAiReason : t('nlMode.toggle')" />
                  </OButton>

                  <OButton
                    :data-test="`${functionDataTestPrefix}-save-btn`"
                    variant="outline"
                    size="chip"
                    icon-left="save"
                    :disabled="functionSaveDisabled"
                    @click="onFunctionSave"
                  >
                    <span class="tw:inline-flex tw:items-center tw:gap-1">
                      <span
                        v-if="functionDirty"
                        class="query-editor__dirty-dot"
                        aria-hidden="true"
                      />
                      {{ t('common.save') }}
                    </span>
                  </OButton>

                  <OButton
                    :data-test="`${functionDataTestPrefix}-close-btn`"
                    variant="ghost"
                    size="icon-chip"
                    icon-left="close"
                    @click="closeFunctionPane"
                  >
                    <OTooltip :content="t('search.hideFunctionEditor')" />
                  </OButton>
                </template>
              </QueryEditorFooter>
            </div>
          </template>
        </OSplitter>
      </template>

      <!-- ───────── Single editor (no function pane open) ───────── -->
      <template v-else>
        <div class="query-editor__pane tw:flex-1 tw:min-w-0">
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
              @focus="() => { queryEditorFocused = true; emit('focus') }"
              @blur="() => { queryEditorFocused = false; emit('blur') }"
              @nlpModeDetected="handleNlpModeDetected"
              @generation-start="handleGenerationStart"
              @generation-end="handleGenerationEnd"
              @generation-success="handleGenerationSuccess"
              class="monaco-editor tw:w-full tw:h-full"
            />
            <span
              v-if="showQueryPlaceholder"
              class="query-editor__placeholder"
              :data-test="`${dataTestPrefix}-placeholder`"
              aria-hidden="true"
            >
              {{ queryPlaceholderText }}<span class="query-editor__caret" />
            </span>
            <!-- Legacy floating AI icon (only when no footer to host it) -->
            <OButton
              v-if="
                !showBottomBarState &&
                aiEnabledInEnv &&
                !hideNlToggle &&
                !isAIMode
              "
              :data-test="`${dataTestPrefix}-ai-toggle-btn`"
              variant="ghost"
              size="icon-toolbar"
              :disabled="props.disableAi"
              @click="nlpMode = true"
              class="ai-floating-button"
            >
              <img :src="nlpIcon" alt="AI Mode" class="tw:w-[18px] tw:h-[18px] ai-icon" />
              <OTooltip :content="props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle')" />
            </OButton>
          </div>
          <QueryEditorFooter
            compact
            v-if="showBottomBarState"
            :data-test="`${dataTestPrefix}-footer`"
          >
            <template #left>
              <OToggleGroup
                type="single"
                :model-value="currentMode"
                :disabled="modeDisabled"
                :data-test="`${dataTestPrefix}-mode-toggle`"
                @update:model-value="(v: any) => v && (currentMode = String(v))"
              >
                <OToggleGroupItem
                  v-for="opt in modeOptions"
                  :key="opt.value"
                  :value="opt.value"
                  size="xs"
                  :disabled="modeDisabled"
                  :tooltip="modeDisabled && modeDisabledReason ? modeDisabledReason : undefined"
                  :data-test="`${dataTestPrefix}-mode-${opt.value}`"
                >
                  <template v-if="opt.icon" #icon-left>
                    <OIcon :name="opt.icon" size="xs" />
                  </template>
                  {{ opt.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <span
                v-if="validation"
                class="query-editor__validation"
                :class="{ 'query-editor__validation--error': !validation.valid }"
                :data-test="`${dataTestPrefix}-validation`"
              >
                <span class="query-editor__validation-dot" />
                {{ validation.message || (validation.valid ? t('search.validSql') : t('search.invalidSql')) }}
              </span>

              <slot name="footer-left" />
            </template>

            <template #right>
              <slot name="footer-right" />

              <OButton
                v-if="showFooterAi && aiEnabledInEnv && !hideNlToggle"
                :data-test="`${dataTestPrefix}-footer-ai-btn`"
                variant="ai-gradient"
                size="icon-chip"
                :disabled="props.disableAi"
                @click="onMainAiClick"
              >
                <img :src="nlpIcon" alt="AI" class="tw:w-[12px] tw:h-[12px] query-editor__ai-icon-invert" />
                <OTooltip :content="props.disableAi && props.disableAiReason ? props.disableAiReason : t('nlMode.toggle')" />
              </OButton>

              <OButton
                v-if="showFullscreen"
                :data-test="`${dataTestPrefix}-footer-fullscreen-btn`"
                variant="ghost"
                size="icon-chip"
                :icon-left="fullscreenState ? 'fullscreen-exit' : 'fullscreen'"
                @click="toggleFullscreen"
              >
                <OTooltip :content="fullscreenState ? t('search.collapse') : t('search.expand')" />
              </OButton>

              <OButton
                v-if="showFooterToggle"
                :data-test="`${dataTestPrefix}-footer-hide-btn`"
                variant="ghost"
                size="icon-chip"
                icon-left="expand-more"
                @click="hideBottomBar"
              >
                <OTooltip :content="t('common.hide')" />
              </OButton>
            </template>
          </QueryEditorFooter>

          <!-- Reveal pill when footer is hidden -->
          <OButton
            v-if="!showBottomBarState && (validation || enableFunctionPane || showFooterAi)"
            variant="ghost"
            size="icon-chip"
            icon-left="expand-less"
            class="query-editor__reveal-footer"
            :data-test="`${dataTestPrefix}-footer-reveal-btn`"
            @click="revealBottomBar"
          >
            <OTooltip :content="t('common.show')" />
          </OButton>
        </div>

        <!-- Vertical fx · ADD FUNCTION rail -->
        <AddFunctionRail
          v-if="enableFunctionPane && !functionPaneOpenState"
          :label="railLabel"
          :tooltip="railTooltip"
          :data-test="`${dataTestPrefix}-add-function-rail`"
          @open="openFunctionPane"
        />
      </template>
    </div>

    <!-- Inline AI strip (docked inside editor card, below the body) -->
    <div
      v-if="isAIMode"
      class="query-editor__ai-strip"
      :data-test="`${dataTestPrefix}-ai-strip`"
    >
      <div v-if="isGenerating" class="query-editor__ai-streaming">
        <img :src="nlpIcon" alt="AI" class="tw:w-[16px] tw:h-[16px]" />
        <OSpinner variant="dots" size="xs" />
        <span class="tw:flex-1 tw:text-xs">
          {{ streamingText || aiStatusText || t('search.analyzingQuery') }}
        </span>
        <OButton
          variant="ghost-destructive"
          size="icon-xs"
          icon-left="stop"
          :data-test="`${dataTestPrefix}-ai-stop-btn`"
          @click="cancelGeneration"
        >
          <OTooltip :content="t('common.stopGenerating')" />
        </OButton>
      </div>
      <div v-else class="query-editor__ai-row">
        <!-- Target toggle: Query | Function -->
        <OToggleGroup
          v-if="enableFunctionPane"
          type="single"
          :model-value="aiTarget"
          class="query-editor__ai-target"
          :data-test="`${dataTestPrefix}-ai-target`"
          @update:model-value="(v: any) => v && (aiTarget = v as ('query' | 'function'))"
        >
          <OToggleGroupItem value="query" size="xs">
            {{ t('common.query') }}
          </OToggleGroupItem>
          <OToggleGroupItem value="function" size="xs" :disabled="!functionPaneOpenState">
            {{ functionLabel || 'fx' }}
          </OToggleGroupItem>
        </OToggleGroup>

        <OInput
          v-model="aiInputText"
          :placeholder="props.aiPlaceholder || t('search.askAIPlaceholder')"
          :class="aiInputFieldClass"
          :data-test="`${dataTestPrefix}-ai-input-field`"
          @keydown.enter="handleAIInputEnter"
        >
          <template #icon-left>
            <img :src="nlpIcon" alt="AI" class="tw:w-[16px] tw:h-[16px]" />
          </template>
        </OInput>

        <!-- Output language badge -->
        <span class="query-editor__ai-badge" aria-hidden="true">
          {{ aiTarget === 'function' ? functionLanguage.toUpperCase() : currentLanguage.toUpperCase() }}
        </span>

        <OButton
          variant="ai-gradient"
          size="xs"
          icon-left="send"
          :disabled="!aiInputText.trim() || (aiTarget === 'function' ? functionDisableAi : props.disableAi)"
          :data-test="`${dataTestPrefix}-ai-send-btn`"
          @click="handleAIGenerate"
        >
          {{ t('search.generate') }}
        </OButton>

        <OButton
          variant="ghost-muted"
          size="icon-xs"
          icon-left="close"
          :data-test="`${dataTestPrefix}-ai-close-btn`"
          @click="dismissAIMode"
        >
          <OTooltip :content="t('common.close')" />
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import CodeQueryEditor from '@/components/CodeQueryEditor.vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OIcon from '@/lib/core/Icon/OIcon.vue';
import OSplitter from '@/lib/core/Splitter/OSplitter.vue';
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
import QueryEditorFooter from '@/components/queryEditor/QueryEditorFooter.vue';
import AddFunctionRail from '@/components/queryEditor/AddFunctionRail.vue';
import { getImageURL, getUUIDv7 } from '@/utils/zincutils';
import { useChatHistory } from '@/composables/useChatHistory';
import type { ChatMessage } from '@/ts/interfaces/chat';
import config from '@/aws-exports';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

type Language = 'sql' | 'promql' | 'vrl' | 'javascript';
type QueryMode = 'filter' | 'sql';
interface ModeOption { value: string; label: string; icon?: string }
interface Validation { valid: boolean; message?: string }

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

  // ───── New: in-editor bottom bar ─────
  showBottomBar?: boolean;                    // render the new editor footer
  mode?: QueryMode | string;                  // current segmented mode (filter/sql/…)
  modeOptions?: ModeOption[];                 // override default Filter/SQL options
  modeDisabled?: boolean;                     // disable the mode toggle
  modeDisabledReason?: string;                // tooltip when mode toggle is disabled
  validation?: Validation;                    // Valid SQL / error
  showFullscreen?: boolean;                   // fullscreen button in footer
  isFullscreen?: boolean;                     // controlled fullscreen state
  showFooterAi?: boolean;                     // AI sparkle in footer (replaces floating btn)
  showFooterToggle?: boolean;                 // chevron to collapse footer

  // ───── New: function pane ─────
  enableFunctionPane?: boolean;               // shows the splitter + rail
  functionPaneOpen?: boolean;                 // controlled open state
  functionQuery?: string;                     // function/VRL code (two-way)
  functionLanguage?: Language;                // default 'vrl'
  functionLabel?: string;                     // label in fn footer (default "FX FUNCTION")
  functionDirty?: boolean;                    // dot on Save
  functionSaveDisabled?: boolean;
  functionDisableAi?: boolean;
  functionDisableAiReason?: string;
  functionReadOnly?: boolean;
  functionDataTestPrefix?: string;
  // built-in function picker (ODropdown) — used when slot override isn't provided
  functionOptions?: Array<{ label: string; value: string }>;
  selectedFunction?: string;
  functionPlaceholder?: string;
  minLines?: number;                          // editor min height in line count (default 2)
  maxLines?: number;                          // editor max height in line count (default 12)
  bordered?: boolean;                         // outer rounded border around the editor (default true)
  splitterModel?: number;                     // persistable splitter position
  splitterLimits?: [number, number];
  railLabel?: string;                         // text in the vertical rail
  railTooltip?: string;
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
  showBottomBar: false,
  modeOptions: () => [
    { value: 'filter', label: 'Filter', icon: 'filter-list' },
    { value: 'sql', label: 'SQL', icon: 'database' },
  ],
  modeDisabled: false,
  showFullscreen: true,
  showFooterAi: true,
  showFooterToggle: true,
  enableFunctionPane: false,
  functionPaneOpen: false,
  functionQuery: '',
  functionLanguage: 'vrl',
  functionLabel: 'FX FUNCTION',
  functionDirty: false,
  functionSaveDisabled: false,
  functionDisableAi: false,
  functionDisableAiReason: '',
  functionReadOnly: false,
  functionDataTestPrefix: 'query-editor-fn',
  splitterModel: 60,
  splitterLimits: () => [20, 80] as [number, number],
  railLabel: 'ADD FUNCTION',
  functionOptions: () => [],
  selectedFunction: '',
  minLines: 2,
  maxLines: 12,
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
  // new
  'update:mode': [value: string];
  'update:showBottomBar': [value: boolean];
  'update:functionPaneOpen': [value: boolean];
  'update:functionQuery': [value: string];
  'update:isFullscreen': [value: boolean];
  'update:splitterModel': [value: number];
  'save-function': [];
  'toggle-fullscreen': [value: boolean];
  'function-focus': [];
  'function-blur': [];
  'function-keydown': [event: KeyboardEvent];
  'update:selectedFunction': [value: string];
  'select-function': [option: { label: string; value: string }];
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
const { saveToHistory } = useChatHistory(
  () => store.state.userInfo.email ?? '',
  () => store.state.selectedOrganization.identifier ?? '',
);
const currentChatId = ref<number | null>(null);
const chatMessages = ref<ChatMessage[]>([]);

const nlpIcon = computed(() => {
  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon_gradient.svg');
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

// Computed: Root container style - sets overall height + line-count CSS vars
const rootStyle = computed(() => {
  const base: Record<string, string> = {
    ['--query-editor-min-lines' as any]: String(props.minLines ?? 2),
    ['--query-editor-max-lines' as any]: String(props.maxLines ?? 12),
  };
  // editorHeight: '100%' → let parent decide; otherwise use the supplied size.
  if (props.editorHeight === '100%') {
    return { ...base, height: '100%' };
  }
  return { ...base, height: props.editorHeight };
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

  // Route to either the main editor or the function editor based on aiTarget.
  const target =
    aiTarget.value === 'function' ? fnEditorRef.value : editorRef.value;
  const targetLanguage =
    aiTarget.value === 'function' ? props.functionLanguage : currentLanguage.value;

  const currentQuery = target?.getValue
    ? target.getValue()
    : aiTarget.value === 'function'
      ? props.functionQuery
      : props.query;

  // Check if user wants to execute the query instead of generating a new one
  if (currentQuery && currentQuery.trim() && isExecutionIntent(userInput)) {
    aiInputText.value = ''; // Clear input
    emit('run-query');
    return;
  }

  // Build the prompt based on whether there's an existing query
  let naturalLanguage = '';
  if (currentQuery && currentQuery.trim()) {
    naturalLanguage = `Modify this ${String(targetLanguage).toUpperCase()} query to ${userInput}:\n\n${currentQuery}`;
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
  if (target && typeof target.handleGenerateSQL === 'function') {
    try {
      aiStatusText.value = t('search.generatingQuery');
      await target.handleGenerateSQL(
        naturalLanguage,
        currentAbortController.value.signal,
        currentSessionId.value,
      );

      // Track assistant response in chat history
      const generatedQuery = target.getValue?.() || '';
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
  emit(
    'ask-ai',
    naturalLanguage,
    (aiTarget.value === 'function' ? props.functionLanguage : currentLanguage.value) as Language,
  );
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

// ───── Footer / function-pane state ─────

// Mode toggle (Filter / SQL): internal fallback when `mode` prop is omitted
const internalMode = ref<string>(props.mode ?? 'filter');
const currentMode = computed({
  get: () => (props.mode !== undefined ? props.mode : internalMode.value),
  set: (val: string) => {
    if (props.mode !== undefined) {
      emit('update:mode', val);
    } else {
      internalMode.value = val;
    }
  },
});

// Function pane open/close (controlled or self-managed)
const internalFunctionPaneOpen = ref<boolean>(!!props.functionPaneOpen);
const functionPaneOpenState = computed({
  get: () => (props.functionPaneOpen !== undefined ? props.functionPaneOpen : internalFunctionPaneOpen.value),
  set: (val: boolean) => {
    if (props.functionPaneOpen !== undefined) {
      emit('update:functionPaneOpen', val);
    } else {
      internalFunctionPaneOpen.value = val;
    }
  },
});

// Fullscreen (controlled or self-managed)
const internalFullscreen = ref<boolean>(!!props.isFullscreen);
const fullscreenState = computed({
  get: () => (props.isFullscreen !== undefined ? props.isFullscreen : internalFullscreen.value),
  set: (val: boolean) => {
    if (props.isFullscreen !== undefined) {
      emit('update:isFullscreen', val);
    } else {
      internalFullscreen.value = val;
    }
    emit('toggle-fullscreen', val);
  },
});

// Splitter (controlled or self-managed)
const internalSplitter = ref<number>(props.splitterModel);
const splitterState = computed({
  get: () => (props.splitterModel !== undefined ? props.splitterModel : internalSplitter.value),
  set: (val: number) => {
    internalSplitter.value = val;
    emit('update:splitterModel', val);
  },
});

// Show/hide footer — supports both controlled (v-model:show-bottom-bar)
// and uncontrolled usage. Internal override wins until the parent supplies a new prop value.
const showBottomBarOverride = ref<boolean | undefined>(undefined);
watch(() => props.showBottomBar, () => {
  showBottomBarOverride.value = undefined;
});
const showBottomBarState = computed({
  get: () =>
    showBottomBarOverride.value !== undefined
      ? showBottomBarOverride.value
      : props.showBottomBar,
  set: (val: boolean) => {
    showBottomBarOverride.value = val;
    emit('update:showBottomBar', val);
  },
});

// VRL function-pane NLP mode (self-managed; no external control surface yet)
const fnNlpMode = ref(false);
const fnEditorRef = ref<any>(null);

// Focus tracking — hide placeholder while editor is active
const queryEditorFocused = ref(false);
const fnEditorFocused = ref(false);

// AI target: which pane the inline AI strip generates for
const aiTarget = ref<'query' | 'function'>('query');

const openFunctionPane = () => {
  functionPaneOpenState.value = true;
};
const closeFunctionPane = () => {
  functionPaneOpenState.value = false;
};
const toggleFullscreen = () => {
  fullscreenState.value = !fullscreenState.value;
};
const hideBottomBar = () => {
  showBottomBarState.value = false;
};
const revealBottomBar = () => {
  showBottomBarState.value = true;
};

const onMainAiClick = () => {
  if (props.disableAi) return;
  aiTarget.value = 'query';
  nlpMode.value = true;
};
const onFunctionAiClick = () => {
  if (props.functionDisableAi) return;
  aiTarget.value = 'function';
  fnNlpMode.value = true;
  // Keep the shared AI strip visible regardless of which pane triggered it.
  nlpMode.value = true;
};

const onFunctionQueryUpdate = (val: string) => {
  emit('update:functionQuery', val);
};
const onFunctionSave = () => {
  if (props.functionSaveDisabled) return;
  emit('save-function');
};

const onSelectFunction = (opt: { label: string; value: string }) => {
  emit('update:selectedFunction', opt.value);
  emit('select-function', opt);
};

const aiEnabledInEnv = computed(
  () => config.isEnterprise === 'true' && store.state.zoConfig.ai_enabled,
);

// Watch for language prop changes
watch(() => props.defaultLanguage, (newLang) => {
  if (newLang && newLang !== currentLanguage.value) {
    currentLanguage.value = newLang;
  }
});

// ───── Typewriter placeholder ─────
// Floating placeholder rendered over Monaco when the editor is empty.
// Cycles through the three modes a user can author in.
const queryPlaceholderText = ref('');
const functionPlaceholderText = ref('');
const queryPlaceholderPhrases = ['Write SQL query', 'Write filter criteria', 'Write VRL function'];
const functionPlaceholderPhrases = ['Write VRL function'];

const showQueryPlaceholder = computed(
  () => !queryEditorFocused && (!props.query || !props.query.trim()),
);
const showFunctionPlaceholder = computed(
  () => !fnEditorFocused && functionPaneOpenState.value && (!props.functionQuery || !props.functionQuery.trim()),
);

const createTypewriter = (
  phrases: string[],
  target: { value: string },
  isActive: () => boolean,
) => {
  let phraseIdx = 0;
  let charIdx = 0;
  let mode: 'typing' | 'pausing' | 'deleting' = 'typing';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    if (!isActive()) {
      target.value = '';
      timer = setTimeout(tick, 400);
      return;
    }
    const current = phrases[phraseIdx];
    if (mode === 'typing') {
      charIdx++;
      target.value = current.slice(0, charIdx);
      if (charIdx >= current.length) {
        mode = 'pausing';
        timer = setTimeout(() => {
          mode = phrases.length > 1 ? 'deleting' : 'typing';
          tick();
        }, 1800);
        return;
      }
      timer = setTimeout(tick, 70);
    } else if (mode === 'deleting') {
      charIdx--;
      target.value = current.slice(0, charIdx);
      if (charIdx <= 0) {
        phraseIdx = (phraseIdx + 1) % phrases.length;
        mode = 'typing';
      }
      timer = setTimeout(tick, 35);
    }
  };

  return {
    start: () => {
      if (timer) return;
      tick();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};

const queryTypewriter = createTypewriter(
  queryPlaceholderPhrases,
  queryPlaceholderText,
  () => showQueryPlaceholder.value,
);
const functionTypewriter = createTypewriter(
  functionPlaceholderPhrases,
  functionPlaceholderText,
  () => showFunctionPlaceholder.value,
);

onMounted(() => {
  queryTypewriter.start();
  functionTypewriter.start();
});
onBeforeUnmount(() => {
  queryTypewriter.stop();
  functionTypewriter.stop();
});

// Keep internal mirrors in sync with controlled props
watch(() => props.functionPaneOpen, (v) => {
  if (v !== undefined) internalFunctionPaneOpen.value = v;
});
watch(() => props.isFullscreen, (v) => {
  if (v !== undefined) internalFullscreen.value = v;
});
watch(() => props.splitterModel, (v) => {
  if (v !== undefined) internalSplitter.value = v;
});
watch(() => props.mode, (v) => {
  if (v !== undefined) internalMode.value = v;
});

// Watch for query changes and update editor if needed
watch(() => props.query, (newQuery) => {
  // Only update if editor exists and query is different
  if (!editorRef.value?.getValue) return;

  const currentValue = editorRef.value.getValue();

  // Compare trimmed values to avoid cursor jumps from whitespace differences
  // This prevents setValue calls when user is typing trailing spaces
  if (currentValue?.trim() === newQuery?.trim()) {
    return;
  }

  if (editorRef.value.setValue) {
    editorRef.value.setValue(newQuery);
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

  // ── new exposes ──
  openFunctionPane,
  closeFunctionPane,
  toggleFullscreen,
  hideBottomBar,
  revealBottomBar,
  getFunctionEditor: () => fnEditorRef.value,
  getFunctionValue: () => fnEditorRef.value?.getValue?.() ?? '',
  setFunctionValue: (value: string) => {
    if (fnEditorRef.value?.setValue) {
      fnEditorRef.value.setValue(value);
    }
  },
});
</script>

<style scoped>
.query-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  outline-color: transparent; /* Remove focus outline from root container */
  border: 0.0625rem solid var(--o2-border);
  border-radius: 0.375rem;
  overflow: hidden;
  background: var(--o2-card-bg-solid);
}

/* Editor container - clips Monaco but keeps floating button visible */
.editor-container {
  overflow: hidden;
}

/* Floating typewriter placeholder shown when the editor is empty. */
.query-editor__placeholder {
  position: absolute;
  top: 0.5rem;
  left: 4rem; /* clear Monaco's gutter (line numbers + glyph margin) */
  pointer-events: none;
  user-select: none;
  font-family: var(--font-mono, monospace);
  font-size: 0.8125rem;
  line-height: 1.375rem;
  color: var(--o2-text-placeholder, var(--o2-text-muted));
  white-space: nowrap;
  z-index: 1;
}

.query-editor__caret {
  display: inline-block;
  width: 0.0625rem;
  height: 0.875rem;
  margin-left: 0.125rem;
  vertical-align: middle;
  background: currentColor;
  animation: query-editor-caret-blink 1s steps(1) infinite;
}

@keyframes query-editor-caret-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}

/* Floating AI Button (top-right corner) - matches MainLayout ai-hover-btn */
.ai-floating-button {
  position: absolute;
  top: 0.1875rem;
  right: 1.375rem;
  z-index: 100;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%) !important;
  color: white !important;
  transition: background 0.3s ease, box-shadow 0.3s ease !important;
  width: 30px !important;
  height: 30px !important;
  min-width: 30px !important;
  min-height: 30px !important;
  border-radius: 6px;
}

.ai-floating-button:hover {
  background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%) !important;
  box-shadow: 0 0.25rem 0.75rem 0 rgba(139, 92, 246, 0.35) !important;
}

.ai-floating-button:hover .ai-icon {
  filter: brightness(0) invert(1);
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
  background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%) !important;
  color: white !important;
  transition: all 0.2s ease !important;
  min-width: 28px !important;
  min-height: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.ai-send-button:hover:not([disabled]) {
  transform: translateY(-1px);
  box-shadow: 0 0.25rem 0.75rem 0 rgba(139, 92, 246, 0.4) !important;
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
  transition: color 0.2s ease !important;
}

/* AI Input Bar Styling */
.ai-input-bar {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(236, 72, 153, 0.05) 100%);
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

/* ───── Layout: body, panes, splitter ───── */
.query-editor--bordered {
  border: 0.0625rem solid var(--o2-border);
  border-radius: 0.375rem;
  overflow: hidden;
  background: var(--o2-card-bg-solid);
}

.query-editor__body {
  width: 100%;
  /* Floor based on minLines var so SearchBar can shrink with empty queries. */
  min-height: calc(var(--query-editor-min-lines, 2) * 1.375rem + 2rem);
}

.query-editor__pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.query-editor__pane .editor-container {
  min-height: calc(var(--query-editor-min-lines, 2) * 1.375rem);
  max-height: calc(var(--query-editor-max-lines, 12) * 1.375rem);
}

.query-editor__splitter {
  width: 100%;
}

/* Validation badge */
.query-editor__validation {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--text-xs);
  color: var(--o2-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 18rem;
}
.query-editor__validation-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: var(--o2-status-success, #16a34a);
  flex-shrink: 0;
}
.query-editor__validation--error {
  color: var(--o2-status-error, #ef4444);
}
.query-editor__validation--error .query-editor__validation-dot {
  background: var(--o2-status-error, #ef4444);
}

/* Function-side zone (faint iris tint) */
.query-editor__fn-zone {
  background: color-mix(in srgb, var(--o2-primary-color) 5%, var(--o2-section-header-bg));
}

/* fx <name> ▾ pill content inside the picker trigger */
.query-editor__fx-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.query-editor__fx-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  font-style: italic;
  font-weight: var(--font-semibold);
  font-size: var(--text-2xs, 0.625rem);
  letter-spacing: 0.02em;
  color: var(--o2-primary-color);
  background: color-mix(in srgb, var(--o2-primary-color) 14%, transparent);
  border-radius: 0.25rem;
}
.query-editor__fx-name {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--o2-text-body);
}

/* Bordered trigger that matches OSelect dropdown chrome */
.query-editor__fx-trigger {
  background: var(--o2-card-bg-solid) !important;
  border-color: var(--o2-border) !important;
}

.query-editor__dirty-dot {
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 9999px;
  background: var(--o2-status-warning, #f59e0b);
  display: inline-block;
  flex-shrink: 0;
}

/* AI icons rendered as <img> turn white on the gradient AI button. */
.query-editor__ai-icon-invert {
  filter: brightness(0) invert(1);
}

/* ───── Inline AI strip (docked at bottom of editor card) ───── */
.query-editor__ai-strip {
  border-top: 0.0625rem solid var(--o2-border);
  background: color-mix(in srgb, var(--o2-primary-color) 6%, transparent);
  padding: 0.375rem 0.5rem;
}
.query-editor__ai-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
}
.query-editor__ai-streaming {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  font-size: var(--text-xs);
  color: var(--o2-text-body);
}
.query-editor__ai-target {
  flex-shrink: 0;
}
.query-editor__ai-badge {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-2xs, 0.625rem);
  font-weight: var(--font-semibold);
  letter-spacing: 0.05em;
  padding: 0.125rem 0.375rem;
  border-radius: 0.1875rem;
  border: 0.0625rem solid var(--o2-border);
  color: var(--o2-text-code);
  background: var(--o2-card-bg-solid);
}

.query-editor__reveal-footer {
  position: absolute;
  right: 0.5rem;
  bottom: 0.25rem;
  z-index: 5;
}

.query-editor--fullscreen {
  position: fixed !important;
  inset: 4rem 1rem 1rem 1rem;
  z-index: 50;
  background: var(--o2-card-bg-solid);
  border: 0.0625rem solid var(--o2-border);
  border-radius: 0.375rem;
  box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.25);
}
</style>