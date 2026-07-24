<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <!-- Editor Dialog -->
  <ODrawer
    data-test="query-editor-dialog"
    bleed
    v-model:open="isOpen"
    size="full"
    :show-close="false"
  >
    <template #header-left>
      <!-- Left: back + title + stream info -->
      <div class="flex items-center gap-2.5">
        <div
          data-test="add-alert-back-btn"
          class="flex size-5 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] opacity-60 transition-opacity hover:opacity-100"
          :title="t('common.goBack')"
          @click="closeDialog"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <span class="text-dialog-header-text block truncate text-lg font-semibold">{{
          t("alerts.addConditions")
        }}</span>

        <!-- Separator -->
        <div class="bg-separator h-4 w-px opacity-30" />

        <!-- Stream Type + Stream Name -->
        <div class="flex items-center gap-2">
          <div
            v-if="streamType"
            class="rounded-default inline-flex flex-row items-center gap-1.25 border border-[color-mix(in_srgb,var(--color-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)] px-2.5 py-0.75"
          >
            <span class="text-2xs text-text-label font-semibold">{{ t("alerts.streamType") }}</span>
            <span class="text-2xs text-text-label opacity-30">:</span>
            <span class="text-text-link text-xs font-bold">{{ streamType }}</span>
          </div>
          <span v-if="streamType && streamName" class="opacity-20 select-none">|</span>
          <div
            class="rounded-default inline-flex flex-row items-center gap-1.25 border border-[color-mix(in_srgb,var(--color-sql-accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-sql-accent)_10%,transparent)] px-2.5 py-0.75"
          >
            <span class="text-2xs text-text-label font-semibold">{{
              t("alerts.stream_name")
            }}</span>
            <span class="text-2xs text-text-label opacity-30">:</span>
            <span v-if="streamName" class="text-sql-accent text-xs font-bold">{{
              streamName
            }}</span>
            <span v-else class="text-sql-accent text-xs font-bold italic opacity-40">{{
              t("alerts.queryEditor.noStream")
            }}</span>
          </div>
        </div>
      </div>
    </template>
    <template #header-right>
      <!-- Right: AI -->
      <div class="flex items-center gap-3">
        <!-- AI button -->
        <OButton
          v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
          :ripple="false"
          @click="toggleAIChat"
          data-test="menu-link-ai-item"
          variant="ghost"
          size="icon-toolbar"
          class="group transition-[background,box-shadow] duration-300 ease-[ease] [background:var(--color-gradient-ai-subtle)]! hover:shadow-[0_0.25rem_0.75rem_0_rgba(139,92,246,0.35)] hover:[background:var(--color-gradient-ai)]!"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"
        >
          <img
            :src="getBtnLogo"
            class="transition-transform duration-[600ms] ease-[ease] group-hover:rotate-180"
            style="width: 18px; height: 18px"
          />
        </OButton>
      </div>
    </template>
    <div
      data-test="query-editor-dialog-card"
      class="bg-card-glass-bg flex h-[calc(100vh-3.5rem)] overflow-hidden"
    >
      <div class="flex h-full flex-1 overflow-hidden">
        <div class="flex h-full w-full flex-col">
          <!-- Main Content Grid: field browser | editors | output -->
          <div
            class="grid min-h-0 w-full flex-1 grid-cols-[20fr_45fr_35fr] gap-x-2 overflow-hidden px-2 py-2 pr-2"
          >
            <!-- Left Section (25%) — Field Browser -->
            <div
              class="rounded-default border-border-default bg-surface-base h-full overflow-hidden border p-2.5"
            >
              <SearchFieldList
                :fields="fieldListItems"
                :stream-name="streamName"
                :stream-type="streamType"
                :query="fieldListWhereClause"
                :time-stamp="fieldListTimeStamp"
                :hide-copy-value="true"
                @event-emitted="handleFieldListEvent"
              />
            </div>

            <!-- Input Section (40%) -->
            <div class="flex h-full min-h-0 w-full overflow-y-auto">
              <div ref="editorsColumnRef" class="flex min-h-full w-full flex-col gap-y-2">
                <!-- SQL/PromQL Editor Pane + Status Bar wrapper -->
                <div class="flex min-h-55 w-full flex-[3] flex-col overflow-visible">
                  <!-- Editor Pane (no overflow:hidden bottom clip issue for status bar) -->
                  <div
                    class="rounded-default border-border-default flex w-full flex-1 flex-col overflow-hidden rounded-b-none border border-b-0"
                  >
                    <!-- Pane Header -->
                    <div
                      class="bg-surface-subtle border-border-default flex min-h-12 shrink-0 items-center justify-between border-b px-3 py-2"
                    >
                      <div class="flex items-center gap-2">
                        <div class="rounded-default bg-theme-accent h-3.5 w-0.75 shrink-0" />
                        <span class="text-xs font-semibold">{{
                          localTab === "sql" ? t("alerts.sqlEditor") : t("alerts.promqlEditor")
                        }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <OSwitch
                          v-if="localTab !== 'promql'"
                          :model-value="!sqlEditorMaximized"
                          class="o2-toggle-button-xs"
                          @update:model-value="
                            (val) => (val ? restoreVrlEditor() : (sqlEditorMaximized = true))
                          "
                        >
                          <OTooltip
                            :delay="400"
                            :content="
                              sqlEditorMaximized
                                ? t('alerts.queryEditor.showVrlEditor')
                                : t('alerts.queryEditor.hideVrlEditor')
                            "
                          />
                        </OSwitch>
                        <OButton
                          data-test="alert-run-query-btn"
                          variant="primary"
                          size="sm"
                          class="rounded-default h-7 px-3! text-xs"
                          :disabled="
                            localTab == 'sql' ? localSqlQuery == '' : localPromqlQuery == ''
                          "
                          @click="localTab === 'sql' ? runSqlQuery() : runPromqlQuery()"
                        >
                          <span class="text-xs font-semibold">{{ t("alerts.runQuery") }}</span>
                        </OButton>
                      </div>
                    </div>

                    <!-- Unified Query Editor -->
                    <div class="relative min-h-0 flex-1">
                      <UnifiedQueryEditor
                        ref="queryEditorRef"
                        :languages="availableLanguages"
                        :default-language="localTab"
                        :query="localTab === 'sql' ? localSqlQuery : localPromqlQuery"
                        :disable-ai="!streamName"
                        :disable-ai-reason="t('search.selectStreamForAI')"
                        @update:query="handleQueryUpdate"
                        @language-change="handleLanguageChange"
                        @ask-ai="handleAskAI"
                        @run-query="handleRunQuery(localTab)"
                        @focus="onQueryEditorFocus"
                        @blur="onBlurQueryEditor"
                        editor-height="100%"
                        data-test-prefix="alert"
                        :keywords="autoCompleteKeywords"
                        :suggestions="autoCompleteSuggestions"
                      />
                      <div
                        v-if="
                          (localTab === 'sql' ? !localSqlQuery : !localPromqlQuery) &&
                          queryEditorPlaceholderFlag
                        "
                        class="pointer-events-none absolute top-0 right-0 bottom-0 left-0 z-1 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] select-none"
                      >
                        <span
                          class="text-text-placeholder overflow-hidden font-mono [line-height:1.3125rem] text-ellipsis whitespace-nowrap text-[var(--text-sm)]"
                          >{{ fullEditorPlaceholder }}</span
                        >
                      </div>
                    </div>
                  </div>

                  <!-- Status bar: outside overflow:hidden pane so border-bottom is never clipped -->
                  <div
                    class="text-compact relative h-5.5 shrink-0 cursor-default font-medium"
                    :class="[
                      sqlStatusBarClasses,
                      'border-border-default rounded-bl-default rounded-br-default border-r border-b border-l',
                    ]"
                  >
                    <div class="absolute inset-0 flex items-center gap-1.25 overflow-hidden px-2.5">
                      <template v-if="sqlStatusState === 'sql-status-bar--error'">
                        <OIcon name="error-outline" size="xs" class="shrink-0" />
                        <span
                          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                          >{{ localSqlQueryErrorMsg || sqlQueryErrorMsg }}</span
                        >
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--loading'">
                        <OSpinner size="xs" class="shrink-0" />
                        <span>{{ t("alerts.queryEditor.fetchingResults") }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--hint'">
                        <OIcon name="edit" size="xs" class="shrink-0 opacity-60" />
                        <span>{{ t("alerts.queryEditor.writeQueryHint") }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--idle'">
                        <OIcon name="play-arrow" size="xs" class="shrink-0 opacity-70" />
                        <span>{{ t("alerts.queryEditor.runQueryHint") }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--empty'">
                        <OIcon name="search-off" size="xs" class="shrink-0" />
                        <span>{{ t("alerts.queryEditor.noMatchingEvents") }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--success'">
                        <OIcon name="check-circle" size="xs" class="shrink-0" />
                        <span>{{ t("alerts.queryEditor.eventsFound", sqlResultCount) }}</span>
                      </template>
                    </div>
                    <OTooltip
                      v-if="sqlStatusState === 'sql-status-bar--error'"
                      side="top"
                      align="center"
                      :max-width="'520px'"
                      :content="localSqlQueryErrorMsg || sqlQueryErrorMsg"
                    />
                  </div>
                </div>

                <!-- VRL Editor Pane -->
                <div
                  v-if="localTab !== 'promql'"
                  class="rounded-default flex w-full flex-col overflow-hidden"
                  :class="[
                    'border-border-default border',
                    sqlEditorMaximized ? 'flex-none' : 'min-h-40 flex-[2]',
                  ]"
                >
                  <!-- Pane Header -->
                  <div
                    class="bg-surface-subtle border-border-default flex min-h-12 shrink-0 items-center justify-between border-b px-3 py-2"
                  >
                    <div class="flex items-center gap-2">
                      <div
                        class="rounded-default bg-section-accent-secondary h-3.5 w-0.75 shrink-0"
                      />
                      <span class="text-xs font-semibold">{{ t("alerts.vrlEditor") }}</span>
                    </div>
                    <div v-if="!sqlEditorMaximized" class="flex items-center gap-2">
                      <!-- Saved functions -->
                      <OSelect
                        v-model="selectedFunction"
                        :options="functionOptions"
                        data-test="alert-saved-vrl-function-select"
                        labelKey="name"
                        valueKey="name"
                        @update:modelValue="onFunctionSelect"
                        class="mini-select alert-v3-select w-35!"
                        clearable
                        @clear="onFunctionClear"
                        :placeholder="t('alerts.placeholders.savedFunctions')"
                      >
                        <template #empty>
                          <div class="text-muted-foreground px-3 py-2">
                            {{ t("search.noResult") }}
                          </div>
                        </template>
                      </OSelect>
                      <!-- Apply VRL -->
                      <OButton
                        data-test="alert-apply-vrl-btn"
                        variant="primary"
                        size="sm"
                        class="rounded-default h-7 px-3! text-xs"
                        :disabled="vrlFunctionContent == ''"
                        @click="runTestFunction"
                      >
                        <span class="text-xs font-semibold">{{ t("alerts.applyVRL") }}</span>
                      </OButton>
                    </div>
                  </div>

                  <!-- VRL Editor -->
                  <div
                    v-if="!sqlEditorMaximized && vrlContentMounted"
                    class="relative min-h-0 flex-1"
                  >
                    <unified-query-editor
                      data-test="scheduled-alert-vrl-function-editor"
                      data-test-prefix="alert-dialog-vrl"
                      ref="fnEditorRef"
                      :languages="['vrl']"
                      :default-language="'vrl'"
                      :query="vrlFunctionContent"
                      :hide-nl-toggle="false"
                      :disable-ai="false"
                      :disable-ai-reason="''"
                      :ai-placeholder="t('search.askAIFunctionPlaceholder')"
                      :ai-tooltip="t('search.enterFunctionPrompt')"
                      :debounce-time="300"
                      editor-height="100%"
                      class="h-full w-full"
                      @update:query="updateVrlFunction"
                      @focus="functionEditorPlaceholderFlag = false"
                      @blur="onBlurFunctionEditor"
                      @toggle-nlp-mode="handleAlertFunctionEditorToggleNlpMode"
                      @generation-start="handleAlertFunctionEditorGenerationStart"
                      @generation-end="handleAlertFunctionEditorGenerationEnd"
                      @generation-success="handleAlertFunctionEditorGenerationSuccess"
                    />
                    <div
                      v-if="!vrlFunctionContent && functionEditorPlaceholderFlag"
                      class="pointer-events-none absolute top-0 right-0 bottom-0 left-0 z-1 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] select-none"
                    >
                      <span
                        class="text-text-placeholder overflow-hidden font-mono [line-height:1.3125rem] text-ellipsis whitespace-nowrap text-[var(--text-sm)]"
                        >{{ vrlPlaceholder }}</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Output Section (35%) -->
            <div class="flex h-full min-h-0 flex-col gap-y-2 overflow-y-auto">
              <!-- Query Result Pane -->
              <div
                class="rounded-default border-border-default flex min-h-55 flex-1 flex-col overflow-hidden border"
              >
                <!-- Pane Header -->
                <div
                  class="bg-surface-subtle border-border-default flex min-h-12 shrink-0 items-center justify-between border-b px-3 py-2"
                >
                  <div class="flex items-center gap-2">
                    <div class="rounded-default bg-theme-accent h-3.5 w-0.75 shrink-0" />
                    <span class="text-xs font-semibold">{{
                      t("alerts.queryEditor.queryResult")
                    }}</span>
                    <span
                      v-if="multiTimeRange && multiTimeRange.length > 0"
                      class="text-3xs rounded-default bg-status-info-bg border-banner-info-border text-text-link border px-1.75 py-px font-bold tracking-[0.04em]"
                      >{{ t("alerts.queryEditor.resultsAcrossWindows") }}</span
                    >
                  </div>
                </div>

                <!-- Content -->
                <div class="min-h-0 flex-1 overflow-hidden">
                  <!-- Idle: not yet run -->
                  <div
                    v-if="!tempRunQuery && outputEvents == ''"
                    class="bg-card-glass-bg flex h-full w-full flex-col items-center justify-center"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="table-chart" class="size-12! opacity-[0.18]" />
                      <span class="text-xs opacity-[0.45]">{{
                        t("alerts.runQueryForOutput")
                      }}</span>
                    </div>
                  </div>
                  <!-- No results after run -->
                  <div
                    v-else-if="outputEvents == '' && !runQueryLoading"
                    class="bg-card-glass-bg flex h-full flex-col items-center justify-center"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="warning" size="xl" class="text-warning opacity-60" />
                    </div>
                  </div>
                  <!-- Loading -->
                  <div
                    v-else-if="runQueryLoading"
                    class="flex h-full flex-col items-center justify-center gap-2"
                  >
                    <OSpinner size="md" />
                    <span class="text-sm opacity-60">{{ t("search.fetchingResults") }}</span>
                  </div>
                  <!-- Results -->
                  <QueryEditor
                    v-else
                    class="h-full w-full overflow-y-auto"
                    data-test="sql-output-editor"
                    ref="outputEventsEditorRef"
                    editor-id="sql-output-editor"
                    language="json"
                    :read-only="true"
                    v-model:query="outputEvents"
                  />
                </div>
              </div>

              <!-- Combined Output Pane (SQL + VRL only) -->
              <div
                v-if="localTab !== 'promql'"
                class="rounded-default border-border-default flex min-h-50 flex-1 flex-col overflow-hidden border"
              >
                <!-- Pane Header -->
                <div
                  class="bg-surface-subtle border-border-default flex min-h-12 shrink-0 items-center justify-between border-b px-3 py-2"
                >
                  <div class="flex items-center gap-2">
                    <div
                      class="rounded-default bg-section-accent-secondary h-3.5 w-0.75 shrink-0"
                    />
                    <span class="text-xs font-semibold">{{
                      t("alerts.queryEditor.combinedOutput")
                    }}</span>
                    <span
                      class="text-3xs rounded-default bg-badge-purple-soft-bg border-badge-purple-ol-border text-badge-purple-ol-text border px-1.75 py-px font-bold tracking-[0.04em]"
                      >SQL + VRL</span
                    >
                  </div>
                  <!-- Running indicator -->
                  <div v-if="runFnQueryLoading" class="flex items-center gap-1">
                    <span
                      class="query-editor-run-dot bg-status-positive h-1.5 w-1.5 rounded-full"
                    />
                    <span class="text-3xs text-status-positive font-semibold">{{
                      t("alerts.queryEditor.running")
                    }}</span>
                  </div>
                </div>

                <!-- Content -->
                <div class="min-h-0 flex-1 overflow-hidden">
                  <!-- Idle -->
                  <div
                    v-if="!tempTestFunction && !runFnQueryLoading"
                    class="bg-card-glass-bg flex h-full w-full flex-col items-center justify-center"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="data-object" class="size-12! opacity-[0.18]" />
                      <span class="text-xs opacity-[0.45]">{{
                        t("alerts.applyVRLForOutput")
                      }}</span>
                    </div>
                  </div>
                  <!-- No results -->
                  <div
                    v-else-if="outputFnEvents == '' && !runFnQueryLoading && tempTestFunction"
                    class="bg-card-glass-bg flex h-full flex-col items-center justify-center"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="warning" size="xl" class="text-warning opacity-60" />
                    </div>
                  </div>
                  <!-- Loading -->
                  <div
                    v-else-if="runFnQueryLoading"
                    class="flex h-full flex-col items-center justify-center gap-2"
                  >
                    <OSpinner size="md" />
                    <span class="text-sm opacity-60">{{ t("search.fetchingResults") }}</span>
                  </div>
                  <!-- Results -->
                  <QueryEditor
                    v-else
                    class="h-full w-full"
                    data-test="vrl-function-test-events-output-editor"
                    ref="outputFnEventsEditorRef"
                    editor-id="test-function-events-output-editor"
                    language="json"
                    :read-only="true"
                    v-model:query="outputFnEvents"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- AI Chat Panel -->
      <div
        class="bg-surface-base ml-2 w-[24.5vw] max-w-full min-w-18.75"
        v-if="store.state.isAiChatEnabled"
      >
        <O2AIChat
          :header-height="48"
          :is-open="store.state.isAiChatEnabled"
          @close="store.state.isAiChatEnabled = false"
          class="h-[calc(100vh-3.5rem)]!"
        />
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, type PropType, onMounted, inject, type Ref } from "vue";
import { type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { debounce } from "lodash-es";
import { b64EncodeUnicode, getImageURL } from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import searchService from "@/services/search";
import { defineAsyncComponent } from "vue";
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
import UnifiedQueryEditor from "@/components/QueryEditor.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import config from "@/aws-exports";
import useQuery from "@/composables/useQuery";
import { getParser as getParserUtil, type SqlUtilsContext } from "@/utils/alerts/alertSqlUtils";
import useParser from "@/composables/useParser";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useVrlPlaceholder } from "@/composables/useVrlPlaceholder";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { applyFilterTerm, removeFieldCondition } from "@/utils/traces/filterUtils";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  tab: {
    type: String as PropType<"sql" | "promql">,
    default: "sql",
  },
  sqlQuery: {
    type: String,
    default: "",
  },
  promqlQuery: {
    type: String,
    default: "",
  },
  vrlFunction: {
    type: String,
    default: "",
  },
  streamName: {
    type: String,
    default: "",
  },
  streamType: {
    type: String,
    default: "logs",
  },
  columns: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  period: {
    type: Number,
    default: 10,
  },
  multiTimeRange: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  savedFunctions: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  sqlQueryErrorMsg: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "update:modelValue",
  "update:sqlQuery",
  "update:promqlQuery",
  "update:vrlFunction",
  "validate-sql",
]);

const { t } = useI18n();
const store = useStore();
const { isDark } = useTheme();
const { buildQueryPayload } = useQuery();
const { sqlParser } = useParser();

// SQL Parser for validation
const parser: any = ref({});
const localSqlQueryErrorMsg = ref("");
// Suppresses the parent-prop sqlQueryErrorMsg while a fresh query is in flight
const suppressPropError = ref(false);

const sqlStatusState = computed(() => {
  const hasError =
    (localSqlQueryErrorMsg.value ||
      (!suppressPropError.value && (props as any).sqlQueryErrorMsg)) &&
    localTab.value === "sql";
  if (hasError) return "sql-status-bar--error";
  if (runQueryLoading.value) return "sql-status-bar--loading";
  const currentQuery = localTab.value === "sql" ? localSqlQuery.value : localPromqlQuery.value;
  if (!currentQuery) return "sql-status-bar--hint";
  if (!tempRunQuery.value) return "sql-status-bar--idle";
  if (outputEvents.value) return "sql-status-bar--success";
  return "sql-status-bar--empty";
});

const sqlStatusBarClasses = computed(() => {
  const neutralBg = "bg-surface-subtle text-text-secondary";
  const map: Record<string, string> = {
    "sql-status-bar--hint": neutralBg,
    "sql-status-bar--idle": neutralBg,
    "sql-status-bar--loading":
      "bg-[color-mix(in_srgb,var(--color-sql-accent)_6%,transparent)] text-sql-accent",
    "sql-status-bar--error": "bg-status-error-bg text-status-error-text cursor-pointer",
    "sql-status-bar--empty": "bg-status-warning-bg text-status-warning-text",
    "sql-status-bar--success": "bg-status-success-bg text-status-positive",
  };
  return map[sqlStatusState.value] ?? "";
});

const sqlResultCount = computed(() => queryHitCount.value);

watch(
  () => (props as any).sqlQueryErrorMsg,
  () => {
    suppressPropError.value = false;
  },
);

// Initialize SQL parser on mount
onMounted(async () => {
  parser.value = await sqlParser();
});

// Get parser function to validate SQL queries (checks for SELECT * and reserved words)
const getParser = (sqlQuery: string) => {
  const sqlUtilsContext: SqlUtilsContext = {
    parser: parser.value,
    sqlQueryErrorMsg: localSqlQueryErrorMsg,
  };
  return getParserUtil(sqlQuery, sqlUtilsContext);
};

// Dialog state
const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const closeDialog = () => {
  isOpen.value = false;
};

// Local state
// Default to SQL tab if no tab is provided, otherwise use the provided tab
const localTab = ref<"sql" | "promql">(props.tab || "sql");
const localSqlQuery = ref(props.sqlQuery);
const localPromqlQuery = ref(props.promqlQuery);
const vrlFunctionContent = ref(props.vrlFunction);
const sqlEditorMaximized = ref(false);
// Controls whether the VRL Monaco editor is mounted. Kept false briefly when
// restoring from maximized so Monaco mounts AFTER the flex container has
// already reached its final size (no automaticLayout animation).
const vrlContentMounted = ref(true);
const isHovered = ref(false);

// DOM refs
const fnEditorRef = ref<any>(null);
const editorsColumnRef = ref<HTMLElement | null>(null);

const restoreVrlEditor = () => {
  // Step 1: grow the VRL pane (sqlEditorMaximized = false triggers CSS)
  //         but keep the Monaco editor unmounted
  vrlContentMounted.value = false;
  sqlEditorMaximized.value = false;
  // Step 2: after two animation frames the browser has finished laying out
  //         the flex container — mount Monaco into the correctly-sized slot
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      vrlContentMounted.value = true;
    });
  });
};

// Editor state
const queryEditorPlaceholderFlag = ref(true);
const functionEditorPlaceholderFlag = ref(true);
const { placeholder: vrlPlaceholder } = useVrlPlaceholder();

// ─── Typewriter placeholder for the full query editor ────────────────
const streamFieldsForPlaceholder = computed(() =>
  (props.columns as any[]).map((c: any) => ({
    name: typeof c === "string" ? c : (c.value ?? c.label ?? ""),
    dataType: typeof c === "string" ? "" : (c.type ?? ""),
  })),
);
const noStreamForPlaceholder = computed(() => !props.streamName);
const isSqlModeForPlaceholder = computed(() => localTab.value === "sql");
const { placeholder: fullEditorPlaceholder } = useQueryPlaceholder(
  streamFieldsForPlaceholder,
  ref({}),
  isSqlModeForPlaceholder,
  noStreamForPlaceholder,
  { noStreamText: t("pipeline.queryEditorPlaceholder") },
);

// Field selection
const selectedFunction = ref<any>(null);
const functionOptions = ref<any[]>(props.savedFunctions);

// Output state
const outputEvents = ref("");
const outputFnEvents = ref("");
const queryHitCount = ref(0);
// Expand output sections by default so users can see query results immediately
const expandSqlOutput = ref(true);
const expandCombinedOutput = ref(true);
const runQueryLoading = ref(false);
const runFnQueryLoading = ref(false);
const tempRunQuery = ref(false);
const tempTestFunction = ref(false);
const runPromqlError = ref("");

// Watch props
watch(
  () => props.tab,
  (newVal) => {
    localTab.value = newVal || "sql";
  },
);

watch(
  () => props.sqlQuery,
  (newVal) => {
    localSqlQuery.value = newVal;
  },
);

watch(
  () => props.promqlQuery,
  (newVal) => {
    localPromqlQuery.value = newVal;
  },
);

// Clear local error message when SQL query changes
watch(
  () => localSqlQuery.value,
  () => {
    localSqlQueryErrorMsg.value = "";
  },
);

watch(
  () => props.vrlFunction,
  (newVal) => {
    vrlFunctionContent.value = newVal;
  },
);

watch(
  () => props.savedFunctions,
  (newVal) => {
    functionOptions.value = [...newVal];
  },
);

// Update handlers
const updateSqlQuery = (value: string) => {
  localSqlQuery.value = value;
  emit("update:sqlQuery", value);
};

const updatePromqlQuery = (value: string) => {
  localPromqlQuery.value = value;
  emit("update:promqlQuery", value);
};

const updateVrlFunction = (value: string) => {
  vrlFunctionContent.value = value;
  emit("update:vrlFunction", value);
};

const onBlurQueryEditor = debounce(async () => {
  queryEditorPlaceholderFlag.value =
    localTab.value === "sql" ? localSqlQuery.value === "" : localPromqlQuery.value === "";
  if (localTab.value === "sql") {
    await _sqlOnBlur();
    emit("validate-sql");
  }
}, 10);

const onBlurFunctionEditor = () => {
  functionEditorPlaceholderFlag.value = vrlFunctionContent.value === "";
};

/**
 * Handle NLP mode toggle from AI icon in alert function editor
 */
const handleAlertFunctionEditorToggleNlpMode = () => {
  // UnifiedQueryEditor manages its own NLP mode state internally
};

/**
 * Handle generation start event from alert function editor
 */
const handleAlertFunctionEditorGenerationStart = () => {
  // Can add loading indicators here if needed
};

/**
 * Handle generation end event from alert function editor
 */
const handleAlertFunctionEditorGenerationEnd = () => {
  // Can remove loading indicators here if needed
};

/**
 * Handle successful generation from alert function editor
 */
const handleAlertFunctionEditorGenerationSuccess = () => {
  // Function code is already updated via @update:query handler
};

// Column and function selection.
// OSelect emits the resolved `valueKey` (the function name), not the option
// object — look the function up before reading its body.
const onFunctionSelect = (name: any) => {
  const func = props.savedFunctions.find((f: any) => f.name === name);
  if (func) {
    updateVrlFunction(func.function || func.body || "");
  }
};

const onFunctionClear = () => {
  vrlFunctionContent.value = "";
  updateVrlFunction("");
  selectedFunction.value = null;
};

// Build multi-window query - includes all multi-windows automatically
const buildMultiWindowQuery = (sql: string, periodInMicroseconds: number) => {
  const queryToSend: any[] = [];

  // Guard: If multiTimeRange is null, undefined, or empty, return empty array
  if (!props.multiTimeRange || props.multiTimeRange.length === 0) {
    return queryToSend;
  }

  const regex = /^(\d+)([smhdwM])$/;

  const unitToMicroseconds: Record<string, number> = {
    s: 1 * 1_000_000, // seconds
    m: 60 * 1_000_000, // minutes
    h: 60 * 60 * 1_000_000, // hours
    d: 24 * 60 * 60 * 1_000_000, // days
    w: 7 * 24 * 60 * 60 * 1_000_000, // weeks
    M: 30 * 24 * 60 * 60 * 1_000_000, // month
  };

  const now = Date.now() * 1000; // Current time in microseconds because we are using microseconds of unix timestamp

  // Include all multi-windows (no selection needed)
  props.multiTimeRange.forEach((date: any) => {
    const individualQuery: any = {};
    const match = date.offSet.match(regex);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const offsetMicroseconds = value * unitToMicroseconds[unit];

      const endTime = now;
      const startTime = endTime - offsetMicroseconds;
      individualQuery.start_time = startTime - periodInMicroseconds;
      individualQuery.end_time = startTime;
      individualQuery.sql = sql;
      queryToSend.push(individualQuery);
    } else {
      console.warn("Invalid format:", date);
    }
  });

  return queryToSend;
};

// Query execution
const triggerQuery = async (fn = false) => {
  try {
    const queryReq = buildQueryPayload({
      sqlMode: true,
      streamName: props.streamName,
    });
    queryReq.query.sql = localSqlQuery.value;
    queryReq.query.size = 10;

    const periodInMicroseconds = props.period * 60 * 1000000;
    const endTime = new Date().getTime() * 1000; // ← Use 1000 to get microseconds
    const startTime = endTime - periodInMicroseconds;

    queryReq.query.query_fn = fn ? b64EncodeUnicode(vrlFunctionContent.value) : null;
    queryReq.query.sql_mode = true;

    const multiWindowQueries = buildMultiWindowQuery(queryReq.query.sql, periodInMicroseconds);

    if (multiWindowQueries.length > 0) {
      // Multi-window: combine primary window + extra windows → _search_multi
      queryReq.query.per_query_response = true;
      const queryToSend = [
        {
          start_time: startTime,
          end_time: endTime,
          sql: queryReq.query.sql,
        },
        ...multiWindowQueries,
      ];
      queryReq.query.sql = queryToSend;
    } else {
      // No multi-window: use normal _search API
      queryReq.query.start_time = startTime;
      queryReq.query.end_time = endTime;
    }

    delete queryReq.aggs;

    const res = await searchService.search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: queryReq,
      page_type: props.streamType,
      validate: true,
    });

    if (res.data.hits.length > 0) {
      if (fn) {
        outputFnEvents.value = JSON.stringify(res.data.hits, null, 2);
      } else {
        outputEvents.value = JSON.stringify(res.data.hits, null, 2);
        queryHitCount.value = res.data.total ?? res.data.hits.flat().length;
      }
    }
  } catch (err: any) {
    console.error("[QueryEditorDialog] ERROR in triggerQuery:", err);
    console.error("[QueryEditorDialog] Error details:", {
      message: err.message,
      response: err.response,
      stack: err.stack,
    });
    toast({
      variant: "error",
      message: err.response?.data?.message ?? t("search.errorFetchingResults"),
      timeout: 1500,
    });
  }
};

const runSqlQuery = async () => {
  runPromqlError.value = "";
  localSqlQueryErrorMsg.value = "";
  suppressPropError.value = true;
  queryHitCount.value = 0;

  // Validate SQL query before running (checks for SELECT * and reserved words)
  const parserResult = getParser(localSqlQuery.value);

  if (!parserResult) {
    // Parser validation failed - don't run the query
    // Error message is already set by getParser via sqlQueryErrorMsg
    return;
  }

  tempRunQuery.value = true;
  expandSqlOutput.value = true;
  try {
    runQueryLoading.value = true;
    await triggerQuery();
  } catch (err) {
    console.error("[QueryEditorDialog] Error in runSqlQuery:", err);
  } finally {
    runQueryLoading.value = false;
    suppressPropError.value = false;
  }
};

const runTestFunction = async () => {
  runPromqlError.value = "";
  tempTestFunction.value = true;
  expandCombinedOutput.value = true;
  runFnQueryLoading.value = true;
  try {
    await triggerQuery(true);
    runFnQueryLoading.value = false;
  } catch (err) {
    runFnQueryLoading.value = false;
  }
};

const triggerPromqlQuery = async () => {
  const queryReq = buildQueryPayload({
    sqlMode: true,
    streamName: props.streamName,
  });

  const periodInMicroseconds = props.period * 60 * 1000000;
  const endTime = new Date().getTime() * 1000;
  const startTime = endTime - periodInMicroseconds;

  outputEvents.value = "";
  queryReq.query = localPromqlQuery.value;

  try {
    const res = await searchService.metrics_query_range({
      org_identifier: store.state.selectedOrganization.identifier,
      query: queryReq.query,
      start_time: startTime,
      end_time: endTime,
      step: "0",
    });

    const result = res?.data?.data?.result;
    if (result?.length > 0) {
      outputEvents.value = JSON.stringify(result, null, 2);
      // Count total data points across all series so the status bar shows a meaningful number
      queryHitCount.value = result.reduce(
        (sum: number, series: any) =>
          sum + (Array.isArray(series.values) ? series.values.length : 0),
        0,
      );
    }
  } catch (err: any) {
    runPromqlError.value = err.response?.data?.error ?? t("search.somethingWentWrong");
  }
};

const runPromqlQuery = async () => {
  runPromqlError.value = "";
  queryHitCount.value = 0;
  tempRunQuery.value = true;
  expandSqlOutput.value = true;
  runQueryLoading.value = true;
  try {
    await triggerPromqlQuery();
    runQueryLoading.value = false;
  } catch (err) {
    runQueryLoading.value = false;
  }
};

// Unified Query Editor ref
const queryEditorRef = ref<any>(null);

// Server SQL-validation squiggle ranges, provided by AddAlert.vue.
const alertSqlErrorRanges = inject<Ref<SqlErrorRange[]>>(
  "alertSqlErrorRanges",
  ref<SqlErrorRange[]>([]),
);

const {
  onFocus: _sqlOnFocus,
  onBlur: _sqlOnBlur,
  onQueryChange: _sqlOnQueryChange,
} = useSqlEditorDiagnostics({
  queryEditorRef,
  sqlMode: computed(() => localTab.value === "sql"),
  query: computed(() => localSqlQuery.value ?? ""),
  streamName: computed(() => props.streamName),
  externalErrors: alertSqlErrorRanges,
});

const onQueryEditorFocus = () => {
  queryEditorPlaceholderFlag.value = false;
  _sqlOnFocus();
};

// ── Autocomplete ──────────────────────────────────────────────────────────
const {
  autoCompleteData,
  autoCompleteKeywords,
  autoCompleteSuggestions,
  getSuggestions,
  updateFieldKeywords,
} = useSqlSuggestions();

// Rebuild field keywords whenever columns prop changes
watch(
  () => props.columns,
  (cols) => {
    if (cols?.length) {
      const fields = (cols as any[]).map((c: any) => ({
        name: typeof c === "string" ? c : (c.value ?? c.label ?? c),
        type: c.type ?? "Utf8",
      }));
      updateFieldKeywords(fields);
    }
  },
  { immediate: true, deep: true },
);

// Transform columns (value/label pairs) → FieldList items ({ name })
// Extract WHERE clause from SQL so FieldList can use it to filter field values.
// FieldList.buildSql() expects a raw WHERE clause string (not a full SQL query).
const fieldListWhereClause = computed(() => {
  const sql = localSqlQuery.value?.trim();
  if (!sql) return "";
  const match = sql.match(
    /\bWHERE\b([\s\S]+?)(?:\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i,
  );
  return match ? match[1].trim() : "";
});

const fieldListItems = computed(() =>
  (props.columns as any[]).map((c: any) => ({
    name: typeof c === "string" ? c : (c.value ?? c.label ?? c),
    showValues: true,
  })),
);

const fieldListTimeStamp = computed(() => {
  const endTime = new Date().getTime() * 1000;
  const startTime = endTime - props.period * 60 * 1000000;
  return { startTime, endTime };
});

const rebuildSqlWithWhere = (newWhere: string): string => {
  const sql = localSqlQuery.value?.trim() || "";
  if (!sql) return newWhere ? `SELECT * FROM "${props.streamName}" WHERE ${newWhere}` : "";

  // Split off any trailing GROUP BY / HAVING / ORDER BY / LIMIT
  const trailingMatch = sql.match(/(\s+(?:GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b[\s\S]*)$/i);
  const trailing = trailingMatch ? trailingMatch[1] : "";
  const sqlBeforeTrailing = trailing ? sql.slice(0, sql.length - trailing.length) : sql;

  // Now strip any existing WHERE clause from sqlBeforeTrailing
  const whereIdx = sqlBeforeTrailing.search(/\bWHERE\b/i);
  const beforeWhere =
    whereIdx >= 0 ? sqlBeforeTrailing.slice(0, whereIdx).trimEnd() : sqlBeforeTrailing;

  return newWhere ? `${beforeWhere} WHERE ${newWhere}${trailing}` : `${beforeWhere}${trailing}`;
};

const handleFieldListEvent = (event: string, value: any) => {
  let newSql: string | null = null;
  if (event === "add-field") {
    const newWhere = applyFilterTerm(value, fieldListWhereClause.value);
    newSql = rebuildSqlWithWhere(newWhere);
  } else if (event === "remove-field") {
    const newWhere = removeFieldCondition(fieldListWhereClause.value, value);
    newSql = rebuildSqlWithWhere(newWhere);
  }
  if (newSql !== null) {
    localSqlQuery.value = newSql;
    // Force the editor to update even if it has focus
    queryEditorRef.value?.setValue?.(newSql);
    emit("update:sqlQuery", newSql);
  }
};

// Determine available languages based on stream type
const availableLanguages = computed<("sql" | "promql")[]>(() => {
  // For metrics streams, only PromQL is available
  if (props.streamType === "metrics") {
    return ["promql"];
  }
  // For logs streams, only SQL is available
  if (props.streamType === "logs") {
    return ["sql"];
  }
  // For other stream types, allow both SQL and PromQL
  return ["sql", "promql"];
});

// Unified Query Editor handlers
const handleQueryUpdate = (newQuery: string) => {
  _sqlOnQueryChange();
  if (localTab.value === "sql") {
    updateSqlQuery(newQuery);
  } else {
    updatePromqlQuery(newQuery);
  }
  // Feed autocomplete context and trigger suggestions
  autoCompleteData.value.query = newQuery;
  autoCompleteData.value.position.cursorIndex = queryEditorRef.value?.getCursorIndex?.() ?? 0;
  autoCompleteData.value.org = store.state.selectedOrganization.identifier;
  autoCompleteData.value.streamType = props.streamType;
  autoCompleteData.value.streamName = props.streamName;
  autoCompleteData.value.popup.open = queryEditorRef.value?.triggerAutoComplete;
  getSuggestions();
};

const handleLanguageChange = (language: "sql" | "promql" | "vrl" | "javascript") => {
  // Alert editor only offers sql/promql
  const newLanguage = language as "sql" | "promql";
  localTab.value = newLanguage;

  // Explicitly sync the editor with the correct query after language change
  // This ensures the editor shows the right query for the selected language
  setTimeout(() => {
    if (queryEditorRef.value && queryEditorRef.value.setValue) {
      const currentQuery = newLanguage === "sql" ? localSqlQuery.value : localPromqlQuery.value;
      queryEditorRef.value.setValue(currentQuery);
    }
  }, 50); // Small delay to ensure editor has switched language
};

const handleRunQuery = (language: "sql" | "promql") => {
  if (language === "sql") {
    runSqlQuery();
  } else {
    runPromqlQuery();
  }
};

const handleAskAI = async () => {
  // The unified component handles AI generation internally
  // This event is just for parent components that may need to react
};

// AI Chat
const toggleAIChat = () => {
  const isEnabled = !store.state.isAiChatEnabled;
  store.dispatch("setIsAiChatEnabled", isEnabled);
};

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL("images/common/ai_icon_dark.svg");
  }

  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});
</script>

<style scoped>
/* keep(keyframes): the "Running" status dot is used only by this dialog. The
   `animation` is declared here, not as a template `[animation:…]` utility, so
   Vue's scoped compiler renames the keyframe and this reference together. */
.query-editor-run-dot {
  animation: dot-pulse 1.5s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
