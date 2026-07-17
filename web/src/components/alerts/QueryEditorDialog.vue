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
  <ODrawer data-test="query-editor-dialog"
    v-model:open="isOpen"
    size="full"
    :show-close="false"
  >
    <template #header-left>
        <!-- Left: back + title + stream info -->
        <div class="flex items-center gap-2.5">
          <div
            data-test="add-alert-back-btn"
            class="flex justify-center items-center cursor-pointer opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
            style="border: 1.5px solid currentColor; border-radius: 50%; width: 20px; height: 20px;"
            :title="t('common.goBack')"
            @click="closeDialog"
          >
            <OIcon name="arrow-back-ios-new" size="xs" />
          </div>
          <span class="text-lg font-semibold text-dialog-header-text truncate block">{{ t('alerts.addConditions') }}</span>

          <!-- Separator -->
          <div class="w-px h-4 opacity-30" :class="store.state.theme === 'dark' ? 'bg-gray-400' : 'bg-gray-500'" />

          <!-- Stream Type + Stream Name -->
          <div class="flex items-center gap-2">
            <div v-if="streamType" class="inline-flex flex-row items-center gap-[5px] py-[3px] px-[10px] rounded-md" :class="store.state.theme === 'dark' ? 'bg-[rgba(59,130,246,0.12)] border border-[rgba(59,130,246,0.3)]' : 'bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.25)]'">
              <span class="text-[11px] font-semibold" :class="store.state.theme === 'dark' ? 'text-[#94a3b8]' : 'text-[#64748b]'">{{ t("alerts.streamType") }}</span>
              <span class="text-[11px] opacity-30" :class="store.state.theme === 'dark' ? 'text-[#64748b]' : 'text-[#94a3b8]'">:</span>
              <span class="text-xs font-bold" :class="store.state.theme === 'dark' ? 'text-[#60a5fa]' : 'text-[#2563eb]'">{{ streamType }}</span>
            </div>
            <span v-if="streamType && streamName" class="opacity-20 select-none">|</span>
            <div class="inline-flex flex-row items-center gap-[5px] py-[3px] px-[10px] rounded-md" :class="store.state.theme === 'dark' ? 'bg-[rgba(139,92,246,0.12)] border border-[rgba(139,92,246,0.3)]' : 'bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.25)]'">
              <span class="text-[11px] font-semibold" :class="store.state.theme === 'dark' ? 'text-[#94a3b8]' : 'text-[#64748b]'">{{ t("alerts.stream_name") }}</span>
              <span class="text-[11px] opacity-30" :class="store.state.theme === 'dark' ? 'text-[#64748b]' : 'text-[#94a3b8]'">:</span>
              <span v-if="streamName" class="text-xs font-bold" :class="store.state.theme === 'dark' ? 'text-[#a78bfa]' : 'text-[#7c3aed]'">{{ streamName }}</span>
              <span v-else class="text-xs font-bold opacity-40 italic" :class="store.state.theme === 'dark' ? 'text-[#a78bfa]' : 'text-[#7c3aed]'">{{ t("alerts.queryEditor.noStream") }}</span>
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
            class="[background:linear-gradient(135deg,rgba(139,92,246,0.15)_0%,rgba(236,72,153,0.15)_100%)]! transition-[background,box-shadow] duration-300 ease-[ease] hover:[background:linear-gradient(135deg,#8B5CF6_0%,#EC4899_100%)]! hover:shadow-[0_0.25rem_0.75rem_0_rgba(139,92,246,0.35)] group"
            @mouseenter="isHovered = true"
            @mouseleave="isHovered = false"
          >
            <img :src="getBtnLogo" class="transition-transform duration-[600ms] ease-[ease] group-hover:rotate-180" style="width: 18px; height: 18px;" />
          </OButton>
        </div>
      </template>
    <div data-test="query-editor-dialog-card" class="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-(--o2-card-bg)">
      <div
        class="h-full flex overflow-hidden flex-1"
      >
        <div class="h-full w-full flex flex-col">
          <!-- Main Content Grid: field browser | editors | output -->
          <div class="grid flex-1 min-h-0 w-full grid-cols-[20fr_45fr_35fr] gap-x-2 px-2 pr-2 py-2 overflow-hidden">

            <!-- Left Section (25%) — Field Browser -->
            <div
              class="h-full rounded-lg overflow-hidden p-[10px]"
              :class="store.state.theme === 'dark' ? 'border border-[#2d3748] bg-[#1a1a1a]' : 'border border-[#e5e7eb] bg-white'"
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
            <div class="flex w-full h-full min-h-0 overflow-y-auto">
              <div ref="editorsColumnRef" class="flex w-full flex-col min-h-full gap-y-2">
                <!-- SQL/PromQL Editor Pane + Status Bar wrapper -->
                <div class="flex-[3] w-full flex flex-col overflow-visible" style="min-height: 220px;">
                  <!-- Editor Pane (no overflow:hidden bottom clip issue for status bar) -->
                  <div
                    class="flex-1 w-full flex flex-col overflow-hidden rounded-lg"
                    :class="store.state.theme === 'dark' ? 'border border-[#2d3748]' : 'border border-[#e5e7eb]'"
                    style="border-bottom: none; border-bottom-left-radius: 0; border-bottom-right-radius: 0;"
                  >
                    <!-- Pane Header -->
                    <div
                      class="flex items-center justify-between py-2 px-3 min-h-12 shrink-0"
                      :class="store.state.theme === 'dark' ? 'bg-white/[0.04] border-b border-[#2d3748]' : 'bg-[#f3f4f6] border-b border-[#e5e7eb]'"
                    >
                      <div class="flex items-center gap-2">
                        <div class="w-[3px] h-[14px] rounded-[2px] shrink-0 bg-(--q-primary)" />
                        <span class="text-xs font-semibold">{{ localTab === 'sql' ? t('alerts.sqlEditor') : t('alerts.promqlEditor') }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <OSwitch
                          v-if="localTab !== 'promql'"
                          :model-value="!sqlEditorMaximized"
                          class="o2-toggle-button-xs"
                          :class="store.state.theme === 'dark' ? 'o2-toggle-button-xs-dark' : 'o2-toggle-button-xs-light'"
                          @update:model-value="(val) => val ? restoreVrlEditor() : (sqlEditorMaximized = true)"
                        >
                          <OTooltip :delay="400" :content="sqlEditorMaximized ? t('alerts.queryEditor.showVrlEditor') : t('alerts.queryEditor.hideVrlEditor')" />
                        </OSwitch>
                        <OButton
                          data-test="alert-run-query-btn"
                          variant="primary"
                          size="sm"
                          class="h-[28px] text-xs rounded-md px-3!"
                          :disabled="localTab == 'sql' ? localSqlQuery == '' : localPromqlQuery == ''"
                          @click="localTab === 'sql' ? runSqlQuery() : runPromqlQuery()"
                        >
                          <span class="text-xs font-semibold">{{ t('alerts.runQuery') }}</span>
                        </OButton>
                      </div>
                    </div>

                    <!-- Unified Query Editor -->
                    <div class="flex-1 min-h-0 relative">
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
                        v-if="(localTab === 'sql' ? !localSqlQuery : !localPromqlQuery) && queryEditorPlaceholderFlag"
                        class="absolute top-0 left-0 right-0 bottom-0 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] pointer-events-none z-[1] select-none"
                      >
                        <span class="font-mono text-[var(--text-base)] [line-height:1.3125rem] text-[#a0aec0] whitespace-nowrap overflow-hidden text-ellipsis">{{ fullEditorPlaceholder }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Status bar: outside overflow:hidden pane so border-bottom is never clipped -->
                  <div
                    class="relative h-[22px] shrink-0 text-[13px] font-medium cursor-default"
                    :class="[
                      sqlStatusBarClasses,
                      store.state.theme === 'dark'
                        ? 'border-l border-r border-b border-[#2d3748] rounded-bl-lg rounded-br-lg'
                        : 'border-l border-r border-b border-[#e5e7eb] rounded-bl-lg rounded-br-lg'
                    ]"
                  >
                    <div class="absolute inset-0 flex items-center gap-[5px] px-[10px] overflow-hidden">
                      <template v-if="sqlStatusState === 'sql-status-bar--error'">
                        <OIcon name="error-outline" size="xs" style="flex-shrink:0;" />
                        <span class="whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-1">{{ localSqlQueryErrorMsg || sqlQueryErrorMsg }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--loading'">
                        <OSpinner size="xs" class="shrink-0" />
                        <span>{{ t('alerts.queryEditor.fetchingResults') }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--hint'">
                        <OIcon name="edit" size="xs" style="flex-shrink:0;opacity:0.6;" />
                        <span>{{ t('alerts.queryEditor.writeQueryHint') }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--idle'">
                        <OIcon name="play-arrow" size="xs" style="flex-shrink:0;opacity:0.7;" />
                        <span>{{ t('alerts.queryEditor.runQueryHint') }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--empty'">
                        <OIcon name="search-off" size="xs" style="flex-shrink:0;" />
                        <span>{{ t('alerts.queryEditor.noMatchingEvents') }}</span>
                      </template>
                      <template v-else-if="sqlStatusState === 'sql-status-bar--success'">
                        <OIcon name="check-circle" size="xs" style="flex-shrink:0;" />
                        <span>{{ t('alerts.queryEditor.eventsFound', sqlResultCount) }}</span>
                      </template>
                    </div>
                    <OTooltip
                      v-if="sqlStatusState === 'sql-status-bar--error'"
                      side="top" align="center"
                      :max-width="'520px'"
                      style="font-size:11px;white-space:pre-wrap;word-break:break-word;"
                      :content="localSqlQueryErrorMsg || sqlQueryErrorMsg"
                    />
                  </div>
                </div>

                <!-- VRL Editor Pane -->
                <div
                  v-if="localTab !== 'promql'"
                  class="w-full flex flex-col overflow-hidden rounded-lg"
                  :class="[
                    store.state.theme === 'dark' ? 'border border-[#2d3748]' : 'border border-[#e5e7eb]',
                    sqlEditorMaximized ? 'flex-none' : 'flex-[2]'
                  ]"
                  :style="sqlEditorMaximized ? '' : 'min-height: 160px;'"
                >
                  <!-- Pane Header -->
                  <div
                    class="flex items-center justify-between py-2 px-3 min-h-12 shrink-0"
                    :class="store.state.theme === 'dark' ? 'bg-white/[0.04] border-b border-[#2d3748]' : 'bg-[#f3f4f6] border-b border-[#e5e7eb]'"
                  >
                    <div class="flex items-center gap-2">
                      <div class="w-[3px] h-[14px] rounded-[2px] shrink-0 bg-(--q-secondary)" />
                      <span class="text-xs font-semibold">{{ t('alerts.vrlEditor') }}</span>
                    </div>
                    <div v-if="!sqlEditorMaximized" class="flex gap-2 items-center">
                      <!-- Saved functions -->
                      <OSelect
                        v-model="selectedFunction"
                        :options="functionOptions"
                        data-test="alert-saved-vrl-function-select"
                        labelKey="name"
                        valueKey="name"
                        @update:modelValue="onFunctionSelect"
                        class="mini-select alert-v3-select"
                        clearable
                        @clear="onFunctionClear"
                        style="width: 140px;"
                        :placeholder="t('alerts.placeholders.savedFunctions')"
                      >
                        <template #empty>
                          <div class="px-3 py-2 text-muted-foreground">
                            {{ t("search.noResult") }}
                          </div>
                        </template>
                      </OSelect>
                      <!-- Apply VRL -->
                      <OButton
                        data-test="alert-apply-vrl-btn"
                        variant="primary"
                        size="sm"
                        class="h-[28px] text-xs rounded-md px-3!"
                        :disabled="vrlFunctionContent == ''"
                        @click="runTestFunction"
                      >
                        <span class="text-xs font-semibold">{{ t('alerts.applyVRL') }}</span>
                      </OButton>
                    </div>
                  </div>

                  <!-- VRL Editor -->
                  <div v-if="!sqlEditorMaximized && vrlContentMounted" class="flex-1 min-h-0 relative">
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
                      class="w-full h-full"
                      :class="store.state.theme === 'dark' ? 'dark-mode-editor dark-mode' : 'light-mode-editor light-mode'"
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
                      class="absolute top-0 left-0 right-0 bottom-0 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] pointer-events-none z-[1] select-none"
                    >
                      <span class="font-mono text-[var(--text-base)] [line-height:1.3125rem] text-[#a0aec0] whitespace-nowrap overflow-hidden text-ellipsis">{{ vrlPlaceholder }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Output Section (35%) -->
            <div class="flex flex-col h-full min-h-0 gap-y-2 overflow-y-auto">

              <!-- Query Result Pane -->
              <div
                class="flex-1 flex flex-col overflow-hidden rounded-lg"
                :class="store.state.theme === 'dark' ? 'border border-[#2d3748]' : 'border border-[#e5e7eb]'"
                style="min-height: 220px;"
              >
                <!-- Pane Header -->
                <div
                  class="flex items-center justify-between py-2 px-3 min-h-12 shrink-0"
                  :class="store.state.theme === 'dark' ? 'bg-white/[0.04] border-b border-[#2d3748]' : 'bg-[#f3f4f6] border-b border-[#e5e7eb]'"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-[3px] h-[14px] rounded-[2px] shrink-0 bg-(--q-primary)" />
                    <span class="text-xs font-semibold">{{ t('alerts.queryEditor.queryResult') }}</span>
                    <span
                      v-if="multiTimeRange && multiTimeRange.length > 0"
                      class="text-[10px] font-bold py-px px-[7px] rounded tracking-[0.04em]"
                      :class="store.state.theme === 'dark' ? 'bg-blue-500/[0.12] border border-blue-500/30 text-[#60a5fa]' : 'bg-blue-500/[0.08] border border-blue-500/25 text-[#2563eb]'"
                    >{{ t('alerts.queryEditor.resultsAcrossWindows') }}</span>
                  </div>
                </div>

                <!-- Content -->
                <div class="flex-1 min-h-0 overflow-hidden">
                  <!-- Idle: not yet run -->
                  <div v-if="!tempRunQuery && outputEvents == ''" class="flex flex-col justify-center items-center h-full w-full bg-(--o2-card-bg)">
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="table-chart" class="opacity-[0.18]" style="width: 48px; height: 48px;" />
                      <span class="text-xs opacity-[0.45]">{{ t('alerts.runQueryForOutput') }}</span>
                    </div>
                  </div>
                  <!-- No results after run -->
                  <div v-else-if="outputEvents == '' && !runQueryLoading" class="flex flex-col justify-center items-center h-full bg-(--o2-card-bg)">
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="warning" size="xl" class="text-orange-400 opacity-60" />
                    </div>
                  </div>
                  <!-- Loading -->
                  <div v-else-if="runQueryLoading" class="flex flex-col justify-center items-center h-full gap-2">
                    <OSpinner size="md" />
                    <span class="text-sm opacity-60">{{ t('search.fetchingResults') }}</span>
                  </div>
                  <!-- Results -->
                  <QueryEditor
                    v-else
                    class="w-full h-full overflow-y-auto"
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
                class="flex-1 flex flex-col overflow-hidden rounded-lg"
                :class="store.state.theme === 'dark' ? 'border border-[#2d3748]' : 'border border-[#e5e7eb]'"
                style="min-height: 200px;"
              >
                <!-- Pane Header -->
                <div
                  class="flex items-center justify-between py-2 px-3 min-h-12 shrink-0"
                  :class="store.state.theme === 'dark' ? 'bg-white/[0.04] border-b border-[#2d3748]' : 'bg-[#f3f4f6] border-b border-[#e5e7eb]'"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-[3px] h-[14px] rounded-[2px] shrink-0 bg-(--q-secondary)" />
                    <span class="text-xs font-semibold">{{ t('alerts.queryEditor.combinedOutput') }}</span>
                    <span
                      class="text-[10px] font-bold py-px px-[7px] rounded tracking-[0.04em]"
                      :class="store.state.theme === 'dark' ? 'bg-violet-500/[0.15] border border-violet-500/30 text-[#a78bfa]' : 'bg-violet-500/[0.10] border border-violet-500/25 text-[#7c3aed]'"
                    >SQL + VRL</span>
                  </div>
                  <!-- Running indicator -->
                  <div v-if="runFnQueryLoading" class="flex items-center gap-1">
                    <span class="w-[6px] h-[6px] rounded-full bg-emerald-500 [animation:pulse_1.5s_ease-in-out_infinite]" />
                    <span class="text-[10px] font-semibold text-emerald-400">{{ t('alerts.queryEditor.running') }}</span>
                  </div>
                </div>

                <!-- Content -->
                <div class="flex-1 min-h-0 overflow-hidden">
                  <!-- Idle -->
                  <div v-if="!tempTestFunction && !runFnQueryLoading" class="flex flex-col justify-center items-center h-full w-full bg-(--o2-card-bg)">
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="data-object" class="opacity-[0.18]" style="width: 48px; height: 48px;" />
                      <span class="text-xs opacity-[0.45]">{{ t('alerts.applyVRLForOutput') }}</span>
                    </div>
                  </div>
                  <!-- No results -->
                  <div v-else-if="outputFnEvents == '' && !runFnQueryLoading && tempTestFunction" class="flex flex-col justify-center items-center h-full bg-(--o2-card-bg)">
                    <div class="flex flex-col items-center gap-2">
                      <OIcon name="warning" size="xl" class="text-orange-400 opacity-60" />
                    </div>
                  </div>
                  <!-- Loading -->
                  <div v-else-if="runFnQueryLoading" class="flex flex-col justify-center items-center h-full gap-2">
                    <OSpinner size="md" />
                    <span class="text-sm opacity-60">{{ t('search.fetchingResults') }}</span>
                  </div>
                  <!-- Results -->
                  <QueryEditor
                    v-else
                    class="w-full h-full"
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
        class="ml-2 w-[24.5vw] max-w-full min-w-[75px]"
        v-if="store.state.isAiChatEnabled"
        :class="store.state.theme == 'dark' ? 'bg-[#1f2937]' : 'bg-white'"
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
import {
  ref,
  computed,
  watch,
  type PropType,
  onMounted,
  inject,
  type Ref,
} from "vue";
import { type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
import { debounce } from "lodash-es";
import { b64EncodeUnicode, getImageURL } from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import searchService from "@/services/search";
import { defineAsyncComponent } from "vue";
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import UnifiedQueryEditor from "@/components/QueryEditor.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
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
    type: String,
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
const { buildQueryPayload } = useQuery();
const { sqlParser } = useParser();

// SQL Parser for validation
const parser: any = ref({});
const localSqlQueryErrorMsg = ref("");
// Suppresses the parent-prop sqlQueryErrorMsg while a fresh query is in flight
const suppressPropError = ref(false);

const sqlStatusState = computed(() => {
  const hasError = (localSqlQueryErrorMsg.value || (!suppressPropError.value && (props as any).sqlQueryErrorMsg)) && localTab.value === 'sql';
  if (hasError) return 'sql-status-bar--error';
  if (runQueryLoading.value) return 'sql-status-bar--loading';
  const currentQuery = localTab.value === 'sql' ? localSqlQuery.value : localPromqlQuery.value;
  if (!currentQuery) return 'sql-status-bar--hint';
  if (!tempRunQuery.value) return 'sql-status-bar--idle';
  if (outputEvents.value) return 'sql-status-bar--success';
  return 'sql-status-bar--empty';
});

const sqlStatusBarClasses = computed(() => {
  const isDark = store.state.theme === 'dark';
  const neutralBg = isDark ? 'bg-white/[0.04] text-[#9ca3af]' : 'bg-[#f3f4f6] text-[#6b7280]';
  const map: Record<string, string> = {
    'sql-status-bar--hint':    neutralBg,
    'sql-status-bar--idle':    neutralBg,
    'sql-status-bar--loading': 'bg-[rgba(139,92,246,0.06)] text-[#8b5cf6]',
    'sql-status-bar--error':   'bg-[rgba(239,68,68,0.08)] text-[#ef4444] cursor-pointer',
    'sql-status-bar--empty':   'bg-[rgba(245,158,11,0.06)] text-[#f59e0b]',
    'sql-status-bar--success': 'bg-[rgba(16,185,129,0.06)] text-[#10b981]',
  };
  return map[sqlStatusState.value] ?? '';
});

const sqlResultCount = computed(() => queryHitCount.value);

watch(() => (props as any).sqlQueryErrorMsg, () => {
  suppressPropError.value = false;
});

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
const localTab = ref(props.tab || 'sql');
const localSqlQuery = ref(props.sqlQuery);
const localPromqlQuery = ref(props.promqlQuery);
const vrlFunctionContent = ref(props.vrlFunction);
const isFullScreen = ref(false);
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
    name: typeof c === 'string' ? c : (c.value ?? c.label ?? ''),
    dataType: typeof c === 'string' ? '' : (c.type ?? ''),
  }))
);
const noStreamForPlaceholder = computed(() => !props.streamName);
const isSqlModeForPlaceholder = computed(() => localTab.value === 'sql');
const { placeholder: fullEditorPlaceholder } = useQueryPlaceholder(
  streamFieldsForPlaceholder,
  ref({}),
  isSqlModeForPlaceholder,
  noStreamForPlaceholder,
  { noStreamText: t('pipeline.queryEditorPlaceholder') },
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
watch(() => props.tab, (newVal) => {
  localTab.value = newVal || 'sql';
});

watch(() => props.sqlQuery, (newVal) => {
  localSqlQuery.value = newVal;
});

watch(() => props.promqlQuery, (newVal) => {
  localPromqlQuery.value = newVal;
});

// Clear local error message when SQL query changes
watch(() => localSqlQuery.value, () => {
  localSqlQueryErrorMsg.value = "";
});

watch(() => props.vrlFunction, (newVal) => {
  vrlFunctionContent.value = newVal;
});


watch(() => props.savedFunctions, (newVal) => {
  functionOptions.value = [...newVal];
});

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
  queryEditorPlaceholderFlag.value = localTab.value === 'sql' ? localSqlQuery.value === '' : localPromqlQuery.value === '';
  if (localTab.value === 'sql') {
    await _sqlOnBlur();
    emit("validate-sql");
  }
}, 10);

const onBlurFunctionEditor = () => {
  functionEditorPlaceholderFlag.value = vrlFunctionContent.value === '';
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
const handleAlertFunctionEditorGenerationSuccess = (payload: {
  type: string;
  message: string;
}) => {
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
    s: 1 * 1_000_000,           // seconds
    m: 60 * 1_000_000,          // minutes
    h: 60 * 60 * 1_000_000,     // hours
    d: 24 * 60 * 60 * 1_000_000,// days
    w: 7 * 24 * 60 * 60 * 1_000_000, // weeks
    M: 30 * 24 * 60 * 60 * 1_000_000 // month
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
    console.error('[QueryEditorDialog] ERROR in triggerQuery:', err);
    console.error('[QueryEditorDialog] Error details:', {
      message: err.message,
      response: err.response,
      stack: err.stack,
    });
    toast({
      variant: "error",
      message: err.response?.data?.message ?? t('search.errorFetchingResults'),
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
    console.error('[QueryEditorDialog] Error in runSqlQuery:', err);
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
      step: '0'
    });

    const result = res?.data?.data?.result;
    if (result?.length > 0) {
      outputEvents.value = JSON.stringify(result, null, 2);
      // Count total data points across all series so the status bar shows a meaningful number
      queryHitCount.value = result.reduce(
        (sum: number, series: any) => sum + (Array.isArray(series.values) ? series.values.length : 0),
        0,
      );
    }
  } catch (err: any) {
    runPromqlError.value = err.response?.data?.error ?? t('search.somethingWentWrong');
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

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef,
    sqlMode: computed(() => localTab.value === 'sql'),
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
        name: typeof c === 'string' ? c : (c.value ?? c.label ?? c),
        type: c.type ?? 'Utf8',
      }));
      updateFieldKeywords(fields);
    }
  },
  { immediate: true, deep: true }
);

// Transform columns (value/label pairs) → FieldList items ({ name })
// Extract WHERE clause from SQL so FieldList can use it to filter field values.
// FieldList.buildSql() expects a raw WHERE clause string (not a full SQL query).
const fieldListWhereClause = computed(() => {
  const sql = localSqlQuery.value?.trim();
  if (!sql) return "";
  const match = sql.match(/\bWHERE\b([\s\S]+?)(?:\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i);
  return match ? match[1].trim() : "";
});

const fieldListItems = computed(() =>
  (props.columns as any[]).map((c: any) => ({
    name: typeof c === "string" ? c : (c.value ?? c.label ?? c),
    showValues: true,
  }))
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
  const beforeWhere = whereIdx >= 0 ? sqlBeforeTrailing.slice(0, whereIdx).trimEnd() : sqlBeforeTrailing;

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
const availableLanguages = computed(() => {
  // For metrics streams, only PromQL is available
  if (props.streamType === 'metrics') {
    return ['promql'];
  }
  // For logs streams, only SQL is available
  if (props.streamType === 'logs') {
    return ['sql'];
  }
  // For other stream types, allow both SQL and PromQL
  return ['sql', 'promql'];
});

// Unified Query Editor handlers
const handleQueryUpdate = (newQuery: string) => {
  _sqlOnQueryChange();
  if (localTab.value === 'sql') {
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

const handleLanguageChange = (newLanguage: 'sql' | 'promql') => {
  localTab.value = newLanguage;

  // Explicitly sync the editor with the correct query after language change
  // This ensures the editor shows the right query for the selected language
  setTimeout(() => {
    if (queryEditorRef.value && queryEditorRef.value.setValue) {
      const currentQuery = newLanguage === 'sql' ? localSqlQuery.value : localPromqlQuery.value;
      queryEditorRef.value.setValue(currentQuery);
    }
  }, 50); // Small delay to ensure editor has switched language
};

const handleRunQuery = (language: 'sql' | 'promql') => {
  if (language === 'sql') {
    runSqlQuery();
  } else {
    runPromqlQuery();
  }
};

const handleAskAI = async (_naturalLanguage: string, _language: string) => {
  // The unified component handles AI generation internally
  // This event is just for parent components that may need to react
};

// AI Chat
const toggleAIChat = () => {
  const isEnabled = !store.state.isAiChatEnabled;
  store.dispatch("setIsAiChatEnabled", isEnabled);
};

const getBtnO2Logo = computed(() => {
  return getImageURL('images/common/ai_icon_blue.svg');
});

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL('images/common/ai_icon_dark.svg')
  }

  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon_gradient.svg')
})
</script>

<style>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
</style>
