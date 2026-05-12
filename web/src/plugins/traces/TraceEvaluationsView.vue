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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <div class="eval-container">
    <!-- Loading state -->
    <div v-if="isLoading" class="eval-loading">
      <OSpinner size="xl" />
      <div class="eval-loading-text">{{ $t("traces.evaluations.loading") }}</div>
    </div>

    <!-- Empty state -->
    <div v-else-if="evalData.length === 0" class="eval-empty">
      <div class="eval-empty-icon">
        <q-icon name="assessment" />
      </div>
      <div class="eval-empty-title">{{ $t("traces.evaluations.noDataTitle") }}</div>
      <div class="eval-empty-subtitle">
        {{ $t("traces.evaluations.noDataSubtitle") }}
      </div>
    </div>

    <!-- Evaluation records -->
    <template v-else>
      <!-- Template Selector — page-level, above all records -->
      <div class="tw:flex tw:justify-end tw:items-center">
        <div class="tw:flex tw:items-center tw:gap-2">
          <span class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">{{ $t("traces.evaluations.templateLabel") }}</span>
          <q-select
            v-model="selectedTemplate"
            :options="availableTemplates"
            option-value="id"
            option-label="name"
            emit-value
            map-options
            dense
            outlined
            class="eval-template-dropdown"
            @update:model-value="onTemplateChange"
          >
            <template v-slot:prepend>
              <q-icon name="assignment" size="14px" color="primary" />
            </template>
          </q-select>
        </div>
      </div>

      <div v-for="(record, idx) in evalData" :key="idx" class="eval-record-v2">
        <!-- SECTION 1: Hero Metrics (Top Row) -->
        <div class="tw:flex tw:gap-3 tw:mb-4 eval-hero-row">
          <!-- 1. Quality Score Card -->
          <div
            class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:p-3"
          >
            <div class="tw:flex tw:justify-between tw:items-start">
              <div class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
                {{ $t("traces.evaluations.qualityScore") }}
              </div>
              <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center"
                   :class="getScoreClass(record.llm_evaluation_quality_score) === 'score-excellent' ? 'tw:bg-green-500/10' : (getScoreClass(record.llm_evaluation_quality_score) === 'score-good' ? 'tw:bg-amber-500/10' : 'tw:bg-red-500/10')">
                <q-icon name="insights"
                        :class="getScoreClass(record.llm_evaluation_quality_score) === 'score-excellent' ? 'tw:text-green-500' : (getScoreClass(record.llm_evaluation_quality_score) === 'score-good' ? 'tw:text-amber-500' : 'tw:text-red-500')"
                        class="eval-card-icon" />
              </div>
            </div>
            <div class="tw:text-3xl tw:font-bold tw:tracking-tight tw:leading-none tw:text-[var(--o2-text-primary)]">
              {{ formatScore(record.llm_evaluation_quality_score) }}
            </div>
          </div>

          <!-- 2. Verdict Card -->
          <div
            class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:p-3"
          >
            <div class="tw:flex tw:justify-between tw:items-start">
              <div class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
                {{ $t("traces.evaluations.verdict") }}
              </div>
              <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center"
                   :class="getVerdict(record) === 'PASS' ? 'tw:bg-green-500/10' : getVerdict(record) === 'FAIL' ? 'tw:bg-red-500/10' : 'tw:bg-gray-500/10'">
                <q-icon :name="getVerdict(record) === 'PASS' ? 'check_circle' : getVerdict(record) === 'FAIL' ? 'cancel' : 'help_outline'"
                        :class="getVerdict(record) === 'PASS' ? 'tw:text-green-500' : getVerdict(record) === 'FAIL' ? 'tw:text-red-500' : 'tw:text-gray-400'"
                        class="eval-card-icon" />
              </div>
            </div>
            <div class="tw:text-2xl tw:font-bold tw:tracking-tight tw:leading-none"
                 :class="getVerdict(record) === 'PASS' ? 'tw:text-green-500' : getVerdict(record) === 'FAIL' ? 'tw:text-red-500' : 'tw:text-[var(--o2-text-secondary)]'">
              {{ getVerdict(record) }}
            </div>
          </div>

          <!-- 3. Steps Card -->
          <div
            class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:p-3"
          >
            <div class="tw:flex tw:justify-between tw:items-start">
              <div class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
                {{ $t("traces.evaluations.traceSteps") }}
              </div>
              <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:bg-blue-500/10">
                <q-icon name="layers" class="tw:text-blue-500 eval-card-icon" />
              </div>
            </div>
            <div class="tw:text-3xl tw:font-bold tw:tracking-tight tw:leading-none tw:text-[var(--o2-text-primary)]">
              {{ record.total_steps || "0" }}
            </div>
          </div>

          <!-- 4. Tools Card -->
          <div
            class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:p-3"
          >
            <div class="tw:flex tw:justify-between tw:items-start">
              <div class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
                {{ $t("traces.evaluations.toolCalls") }}
              </div>
              <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:bg-purple-500/10">
                <q-icon name="build" class="tw:text-purple-500 eval-card-icon" />
              </div>
            </div>
            <div class="tw:text-3xl tw:font-bold tw:leading-none tw:text-[var(--o2-text-primary)]">
              {{ record.total_tool_calls || "0" }}
            </div>
          </div>

          <!-- 5. Completion Card -->
          <div
            class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:p-3"
          >
            <div class="tw:flex tw:justify-between tw:items-start">
              <div class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
                {{ $t("traces.evaluations.doneVia") }}
              </div>
              <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:bg-teal-500/10">
                <q-icon name="flag" class="tw:text-teal-500 eval-card-icon" />
              </div>
            </div>
            <div class="tw:text-lg tw:font-semibold tw:leading-tight tw:text-[var(--o2-text-primary)] tw:truncate" :title="record.completion_signal">
              {{ record.completion_signal || "N/A" }}
            </div>
          </div>
        </div>

        <!-- SECTION 2: Main Content (2:1 Ratio Layout) -->
        <div class="tw:flex tw:gap-4">
          <!-- PART 1: Primary Content (Analysis & reasoning) - 2/3 Width -->
          <div class="tw:flex tw:flex-col tw:gap-4 eval-main-col">
            <!-- 2.1A: Issues & Analysis Card -->
            <div class="el-border el-border-radius o2-incident-card-bg tw:p-4">
              <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
                <q-icon name="rule" color="primary" size="sm" />
                <div class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">{{ $t("traces.evaluations.issuesAnalysis") }}</div>
              </div>

              <!-- Template Evaluation Criteria (shown when a template with content is active) -->
              <div v-if="selectedTemplateData?.content" class="tw:mb-4">
                <q-expansion-item
                  icon="description"
                  :label="isTemplateMismatch(record) ? $t('traces.evaluations.criteriaDifferentTemplate') : $t('traces.evaluations.criteriaFromTemplate')"
                  header-class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)]"
                  dense
                >
                  <!-- Mismatch notice inside the criteria panel -->
                  <div
                    v-if="isTemplateMismatch(record)"
                    class="tw:mt-2 tw:mb-1 tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:text-amber-700 dark:tw:text-amber-400"
                  >
                    <q-icon name="warning" size="12px" />
                    <span>{{ $t("traces.evaluations.criteriaTemplateMismatchNote", { template: selectedTemplateData?.name, evaluated: evaluatedTemplateName(record) }) }}</span>
                  </div>
                  <div class="tw:mt-2 tw:p-3 tw:bg-[var(--o2-border-color)] tw:rounded-md tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:text-[var(--o2-text-primary)]">
                    {{ selectedTemplateData.content }}
                  </div>
                  <div class="tw:mt-1 tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:italic">
                    {{ $t("traces.evaluations.criteriaSyntaxNote") }}
                  </div>
                </q-expansion-item>
              </div>

              <!-- Critical Issues -->
              <div v-if="record.llm_evaluation_judge_critical_issues" class="tw:mb-4">
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <div
                    v-for="(issue, i) in parseCriticalIssues(record.llm_evaluation_judge_critical_issues)"
                    :key="i"
                    class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1.5 tw:rounded-md tw:bg-red-500/10 tw:text-red-600 tw:text-xs tw:font-medium tw:border tw:border-red-500/20"
                  >
                    <q-icon name="report_problem" size="xs" />
                    <span>{{ issue }}</span>
                  </div>
                </div>
              </div>

              <!-- Fix Suggestions Card (Phase 2) -->
              <div v-if="getFixSuggestions(record).length > 0" class="tw:mb-4">
                <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-2 text-primary">{{ $t("traces.evaluations.recommendedFixes") }}</div>
                <div class="tw:space-y-2">
                  <div v-for="(fix, i) in getFixSuggestions(record)" :key="i"
                       class="tw:flex tw:items-start tw:gap-2 tw:p-3 tw:bg-blue-500/5 tw:border tw:border-blue-500/20 tw:rounded-lg tw:border-dashed">
                    <q-icon name="lightbulb" color="primary" size="18px" class="tw:mt-1" />
                    <div class="tw:text-xs tw:text-[var(--o2-text-primary)] tw:flex-1 tw:leading-relaxed">
                      <strong>{{ $t("traces.evaluations.fixSuggestion") }}</strong> {{ fix }}
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="getWeakestDimension(record)" class="tw:mb-4">
                <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
                  <q-icon name="trending_down" color="negative" size="xs" />
                  <span class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">{{ $t("traces.evaluations.weakestDimension") }}</span>
                  <q-badge color="warning" text-color="dark" :label="formatDimLabel(getWeakestDimension(record)!.dimension)" />
                </div>
                <div v-if="getWeakestDimension(record)!.reasoning" class="tw:text-sm tw:bg-[var(--o2-border-color)] tw:p-3 tw:rounded-md tw:leading-relaxed">
                  {{ getWeakestDimension(record)!.reasoning }}
                </div>
              </div>
            </div>

            <!-- 2.1B: Score Reasoning Card -->
            <div class="el-border el-border-radius o2-incident-card-bg tw:p-4">
              <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
                <q-icon name="psychology" color="primary" size="sm" />
                <div class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">{{ $t("traces.evaluations.dimensionReasoning") }}</div>
              </div>
              <div class="tw:grid tw:grid-cols-2 tw:gap-3">
                <div
                  v-for="dim in getDimensionScores(record).filter(d => d.reasoning).slice().sort((a, b) => (isTemplateDimension(b.dimension) ? 1 : 0) - (isTemplateDimension(a.dimension) ? 1 : 0))"
                  :key="dim.dimension"
                  class="tw:p-3 tw:rounded-md tw:flex tw:flex-col tw:gap-1"
                  :class="isTemplateDimension(dim.dimension) ? 'dim-reasoning-template' : 'tw:bg-[var(--o2-border-color)]'"
                >
                  <div class="tw:flex tw:items-center tw:gap-1.5">
                    <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:tracking-wider">
                      {{ formatDimLabel(dim.dimension) }}
                    </div>
                    <!-- Pass/Fail inline -->
                    <q-badge
                      v-if="isTemplateDimension(dim.dimension)"
                      :color="getDimVerdict(dim.score) === 'PASS' ? 'positive' : 'negative'"
                      :label="getDimVerdict(dim.score)"
                      class="eval-badge-sm"
                    />
                  </div>
                  <div class="tw:text-xs tw:leading-relaxed tw:text-[var(--o2-text-primary)]">
                    {{ truncateContent(dim.reasoning, 200) }}
                  </div>
                </div>
                <div v-if="!getDimensionScores(record).some(d => d.reasoning)" class="tw:text-sm tw:italic tw:text-[var(--o2-text-secondary)]">
                  {{ $t("traces.evaluations.noDimensionReasoning") }}
                </div>
              </div>
            </div>

            <!-- 2.1C: Query & Response Card (Full Width in column) -->
            <div class="el-border el-border-radius o2-incident-card-bg tw:overflow-hidden">
              <div class="tw:px-4 tw:py-3 tw:border-b tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-border-color)]/30">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <q-icon name="code" color="primary" size="sm" />
                  <div class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">{{ $t("traces.evaluations.queryResponse") }}</div>
                </div>
              </div>

              <div class="tw:flex tw:flex-col tw:divide-y tw:divide-[var(--o2-border-color)]">
                <!-- System Prompt (Expandable) -->
                <q-expansion-item
                  v-if="parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).system"
                  icon="settings"
                  :label="$t('traces.evaluations.systemPrompt')"
                  header-class="tw:text-xs tw:font-medium"
                >
                  <div class="tw:p-4 tw:bg-[var(--o2-code-bg)]">
                    <LLMContentRenderer
                      :content="JSON.stringify([{ role: 'system', content: parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).system }])"
                      :contentType="'input'"
                      :viewMode="'formatted'"
                    />
                  </div>
                </q-expansion-item>

                <!-- User Messages -->
                <q-expansion-item
                  v-if="parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).user.length > 0"
                  icon="person"
                  :label="$t('traces.evaluations.userMessages')"
                  default-opened
                  header-class="tw:text-xs tw:font-medium"
                >
                  <div class="tw:p-4 tw:bg-[var(--o2-code-bg)]">
                    <LLMContentRenderer
                      :content="JSON.stringify(parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).user)"
                      :contentType="'input'"
                      :viewMode="'formatted'"
                    />
                  </div>
                </q-expansion-item>

                <!-- Assistant Response -->
                <q-expansion-item
                  v-if="record.gen_ai_output_messages"
                  icon="smart_toy"
                  :label="$t('traces.evaluations.assistantResponse')"
                  default-opened
                  header-class="tw:text-xs tw:font-medium"
                >
                  <div class="tw:p-4 tw:bg-[var(--o2-code-bg)]">
                    <LLMContentRenderer
                      :content="getHighlightedResponse(record)"
                      :contentType="'output'"
                      :viewMode="'json'"
                    />
                  </div>
                </q-expansion-item>
              </div>
            </div>
          </div>

          <!-- PART 2: Sidebar Content (Dimensions & Metadata) - 1/3 Width -->
          <div class="tw:flex tw:flex-col tw:gap-4 eval-sidebar-col">
            <!-- 2.2A: Dimensions Card -->
            <div class="el-border el-border-radius o2-incident-card-bg tw:p-4 tw:flex tw:flex-col tw:gap-4">
              <div class="tw:flex tw:items-center tw:justify-between">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <q-icon name="analytics" color="primary" size="sm" />
                  <div class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">{{ $t("traces.evaluations.dimensions") }}</div>
                </div>
                <!-- Threshold explainer shown only when template dimensions are present -->
                <div v-if="selectedTemplateData?.dimensions?.length" class="tw:flex tw:items-center tw:gap-1">
                  <span class="tw:text-[10px] tw:text-[var(--o2-text-secondary)]">{{ $t("traces.evaluations.passThreshold") }}</span>
                  <q-icon name="info_outline" size="12px" color="grey-6">
                    <q-tooltip class="tw:text-xs" max-width="220px">
                      {{ $t("traces.evaluations.passThresholdTooltip") }}
                    </q-tooltip>
                  </q-icon>
                </div>
              </div>

              <!-- Template aspects legend (shown when a template is active) -->
              <div v-if="selectedTemplateData?.dimensions?.length" class="tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:text-[var(--o2-text-secondary)]">
                <q-icon name="assignment" size="12px" color="primary" />
                <span>{{ $t("traces.evaluations.templateAspectsFrom", { template: selectedTemplateData.name }) }}</span>
              </div>

              <!-- Mismatch warning: selected template ≠ template used for evaluation -->
              <div
                v-if="isTemplateMismatch(record)"
                class="tw:flex tw:items-start tw:gap-2 tw:p-2 tw:rounded-md tw:bg-amber-500/10 tw:border tw:border-amber-500/25 tw:text-[10px] tw:text-amber-700 dark:tw:text-amber-400"
              >
                <q-icon name="warning" size="14px" class="tw:mt-px tw:shrink-0" />
                <span>{{ $t("traces.evaluations.templateMismatchWarning", { selected: selectedTemplateData?.name, evaluated: evaluatedTemplateName(record) }) }}</span>
              </div>

              <div class="tw:flex tw:flex-col tw:gap-4">
                <div
                  v-for="dim in getDimensionScores(record)"
                  :key="dim.dimension"
                  class="tw:flex tw:flex-col tw:gap-1.5"
                  :class="isTemplateDimension(dim.dimension) ? 'dim-template-highlight' : ''"
                >
                  <div class="tw:flex tw:justify-between tw:items-center">
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <q-icon :name="getDimIcon(dim.dimension)" :color="getDimColor(dim.dimension)" size="14px" />
                      <span class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-primary)]">{{ formatDimLabel(dim.dimension) }}</span>
                      <!-- Template aspect badge -->
                      <q-badge
                        v-if="isTemplateDimension(dim.dimension)"
                        color="primary"
                        outline
                        :label="$t('traces.evaluations.templateBadge')"
                        class="eval-badge-sm"
                      />
                    </div>
                    <div class="tw:flex tw:items-center tw:gap-1.5">
                      <!-- Pass/Fail verdict badge for template dimensions -->
                      <q-badge
                        v-if="isTemplateDimension(dim.dimension)"
                        :color="getDimVerdict(dim.score) === 'PASS' ? 'positive' : 'negative'"
                        :label="getDimVerdict(dim.score)"
                        class="eval-badge-sm"
                      />
                      <span class="tw:text-xs tw:font-bold tw:text-[var(--o2-text-primary)]">{{ formatScore(dim.score) }}</span>
                    </div>
                  </div>
                  <div class="tw:h-1.5 tw:w-full tw:bg-[var(--o2-border-color)] tw:rounded-full tw:overflow-hidden">
                    <div
                      class="tw:h-full tw:transition-all tw:duration-500"
                      :style="{
                        width: getBarWidth(dim.score),
                        backgroundColor: isTemplateDimension(dim.dimension)
                          ? (getDimVerdict(dim.score) === 'PASS' ? '#22c55e' : '#ef4444')
                          : getDimBarColor(dim.dimension)
                      }"
                    ></div>
                  </div>
                  <q-tooltip v-if="dim.reasoning" class="tw:text-xs" max-width="250px">
                    {{ dim.reasoning }}
                  </q-tooltip>
                </div>
              </div>
            </div>

            <!-- 2.2B: Metadata Details Card -->
            <div class="el-border el-border-radius o2-incident-card-bg tw:p-4">
              <div class="tw:flex tw:items-center tw:gap-2 tw:mb-4">
                <q-icon name="info" color="primary" size="sm" />
                <div class="tw:text-sm tw:font-semibold">{{ $t("traces.evaluations.technicalDetails") }}</div>
              </div>

              <div class="tw:flex tw:flex-col tw:gap-3">
                <div class="eval-meta-row">
                  <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase">{{ $t("traces.evaluations.judge") }}</div>
                  <div class="tw:text-xs tw:truncate">{{ getJudgeModel(record) }}</div>
                </div>
                <div class="eval-meta-row">
                  <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase">{{ $t("traces.evaluations.time") }}</div>
                  <div class="tw:text-xs">{{ formatTimestampDisplay(record._timestamp) }}</div>
                </div>
                <div class="eval-meta-row">
                  <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase">{{ $t("traces.evaluations.confidence") }}</div>
                  <div class="tw:text-xs">{{ formatScore(record.llm_evaluation_judge_confidence) }}</div>
                </div>
                <div class="eval-meta-row">
                  <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase">{{ $t("traces.evaluations.status") }}</div>
                  <div>
                    <q-badge
                      :color="record.exit_status === 'ok' ? 'positive' : 'negative'"
                      :label="record.exit_status?.toUpperCase() || 'UNKNOWN'"
                      size="sm"
                    />
                  </div>
                </div>
                <div v-if="record.is_multi_step" class="eval-meta-row">
                  <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase">{{ $t("traces.evaluations.type") }}</div>
                  <div class="tw:text-xs">{{ $t("traces.evaluations.multiStepAgent") }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, watch, onMounted } from "vue";
import { getQualityScoreColor } from "@/utils/llmUtils";
import LLMContentRenderer from "./LLMContentRenderer.vue";
import { useStore } from "vuex";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "TraceEvaluationsView",
  components: {
    LLMContentRenderer,
    OSpinner,
  },
  props: {
    evalData: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const store = useStore();
    const getBarWidth = (value: any): string => {
      if (value == null) return "0%";
      const num = parseFloat(value as any);
      // If value is already in percentage range (> 1), use as is
      // Otherwise multiply by 100
      const percentage = num > 1 ? num : num * 100;
      return `${Math.min(percentage, 100)}%`;
    };

    const formatScore = (score: number | null | undefined): string => {
      if (score == null) return "N/A";
      const num = parseFloat(score as any);
      // If already in percentage range, use as is
      const percentage = num > 1 ? num : num * 100;
      return `${Math.min(percentage, 100).toFixed(0)}%`;
    };

    const getScoreClass = (score: number | null | undefined): string => {
      if (score == null) return "score-neutral";
      const s = parseFloat(score as any);
      if (s >= 0.7) return "score-excellent";
      if (s >= 0.4) return "score-good";
      return "score-poor";
    };

    const formatTimestampDisplay = (timestamp: number | string): string => {
      if (!timestamp) return "N/A";
      try {
        const ts =
          typeof timestamp === "string" ? parseInt(timestamp) : timestamp;
        const date = new Date(ts / 1000);
        return date.toLocaleString();
      } catch {
        return "N/A";
      }
    };

    // Normalise a flat span attribute (old schema) or a scores[] entry (new schema).
    // Returns an array of { dimension, score (0.0-1.0), reasoning } objects.
    type DimScore = { dimension: string; score: number; reasoning: string };

    const LEGACY_DIM_FIELDS: Record<string, string> = {
      llm_evaluation_judge_relevance: "relevance",
      llm_evaluation_judge_groundedness: "groundedness",
      llm_evaluation_judge_conciseness: "conciseness",
      llm_evaluation_judge_instruction_following: "instruction_following",
      llm_evaluation_judge_accuracy: "accuracy",
      llm_evaluation_judge_trajectory_efficiency: "trajectory_efficiency",
    };

    const getDimensionScores = (record: any): DimScore[] => {
      const dimsMap = new Map<string, DimScore>();

      // 1. New Braintrust-style: llm_evaluation_judge_scores is a JSON string or array
      const rawScores = record.llm_evaluation_judge_scores;
      if (rawScores) {
        try {
          const parsed = typeof rawScores === "string" ? JSON.parse(rawScores) : rawScores;
          if (Array.isArray(parsed)) {
            parsed.forEach((s: any) => {
              const dim = s.dimension ?? "unknown";
              dimsMap.set(dim, {
                dimension: dim,
                score: parseFloat(s.score) ?? 0,
                reasoning: s.reasoning ?? "",
              });
            });
          }
        } catch { /* ignore */ }
      }

      // 2. Scan for "evaluators" pattern: llm_evaluation_evaluators_{dim}_score
      Object.keys(record).forEach(key => {
        // Handle llm_evaluation_evaluators_{dim}_score
        if (key.startsWith("llm_evaluation_evaluators_") && key.endsWith("_score")) {
          const dim = key.replace("llm_evaluation_evaluators_", "").replace("_score", "");
          // Skip if it's the main judge aggregate (we handled it or will handle it separately)
          if (dim === "llm_judge") return;

          const score = parseFloat(record[key]);
          const reasoning = record[`llm_evaluation_evaluators_${dim}_reasoning`] || 
                           record[`llm_evaluation_evaluators_${dim}_metadata`]?.reasoning || "";
          
          if (!dimsMap.has(dim)) {
            dimsMap.set(dim, { dimension: dim, score, reasoning });
          }
        }
        
        // Handle other llm_evaluation_{dim}_score patterns
        if (key.startsWith("llm_evaluation_") && key.endsWith("_score") && 
            !key.includes("quality_score") && !key.includes("judge_scores") && !key.includes("evaluators")) {
          const dim = key.replace("llm_evaluation_", "").replace("_score", "");
          const score = parseFloat(record[key]);
          const reasoning = record[`llm_evaluation_${dim}_reasoning`] || "";
          
          if (!dimsMap.has(dim)) {
            dimsMap.set(dim, { dimension: dim, score, reasoning });
          }
        }
      });

      // 3. Overall Judge as a dimension if available
      if (record.llm_evaluation_evaluators_llm_judge_score != null && !dimsMap.has("llm_judge")) {
        dimsMap.set("llm_judge", {
          dimension: "llm_judge",
          score: parseFloat(record.llm_evaluation_evaluators_llm_judge_score),
          reasoning: record.llm_evaluation_evaluators_llm_judge_reasoning || ""
        });
      }

      // 4. Legacy flat fields
      for (const [field, dim] of Object.entries(LEGACY_DIM_FIELDS)) {
        if (record[field] != null && !dimsMap.has(dim)) {
          const raw = parseFloat(record[field]);
          dimsMap.set(dim, { 
            dimension: dim, 
            score: raw > 1 ? raw / 100 : raw, 
            reasoning: "" 
          });
        }
      }

      return Array.from(dimsMap.values());
    };

    const getVerdict = (record: any): string => {
      if (record.llm_evaluation_judge_verdict) return record.llm_evaluation_judge_verdict;
      
      // Try to extract from llm_judge_metadata
      const metaStr = record.llm_evaluation_evaluators_llm_judge_metadata;
      if (metaStr) {
        try {
          const meta = typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr;
          if (meta.verdict) return meta.verdict;
        } catch { /* ignore */ }
      }
      
      return "N/A";
    };

    const getJudgeModel = (record: any): string => {
      if (record.llm_evaluation_judge_model) return record.llm_evaluation_judge_model;
      
      const metaStr = record.llm_evaluation_evaluators_llm_judge_metadata;
      if (metaStr) {
        try {
          const meta = typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr;
          if (meta.model) return meta.model;
        } catch { /* ignore */ }
      }
      
      return "LLM Judge";
    };

    const getWeakestDimension = (record: any): DimScore | null => {
      const dims = getDimensionScores(record);
      if (!dims.length) return null;
      return dims.reduce((min, d) => d.score < min.score ? d : min, dims[0]);
    };

    const hasDimensionScores = (record: any): boolean => getDimensionScores(record).length > 0;

    // Dimension label / icon / colour helpers
    const DIM_LABELS: Record<string, string> = {
      relevance: "Relevance",
      groundedness: "Groundedness",
      conciseness: "Conciseness",
      instruction_following: "Instructions",
      accuracy: "Accuracy",
      trajectory_efficiency: "Efficiency",
      completeness: "Completeness",
      safety: "Safety",
      slop_filter: "Slop Filter",
      technical_question_retrieval: "Retrieval",
      tool_effectiveness: "Tool Usage",
      llm_judge: "Overall Judge",
      numeric_grounding: "Numeric Grounding",
    };
    const DIM_ICONS: Record<string, string> = {
      relevance: "done_all",
      groundedness: "verified",
      conciseness: "summarize",
      instruction_following: "rule",
      accuracy: "check_circle",
      trajectory_efficiency: "flash_on",
      completeness: "task_alt",
      safety: "security",
      slop_filter: "filter_alt",
      technical_question_retrieval: "find_in_page",
      tool_effectiveness: "build_circle",
      llm_judge: "gavel",
      numeric_grounding: "numbers",
    };
    const DIM_COLORS: Record<string, string> = {
      relevance: "primary",
      groundedness: "positive",
      conciseness: "deep-purple",
      instruction_following: "orange",
      accuracy: "negative",
      trajectory_efficiency: "info",
      completeness: "teal",
      safety: "red",
      slop_filter: "grey-7",
      technical_question_retrieval: "blue-grey",
      tool_effectiveness: "indigo",
      llm_judge: "brown",
      numeric_grounding: "cyan",
    };
    const DIM_BAR_COLORS: Record<string, string> = {
      relevance: "#2196F3",
      groundedness: "#4CAF50",
      conciseness: "#9C27B0",
      instruction_following: "#FF9800",
      accuracy: "#F44336",
      trajectory_efficiency: "#00BCD4",
      completeness: "#009688",
      safety: "#F44336",
      slop_filter: "#616161",
      technical_question_retrieval: "#607D8B",
      tool_effectiveness: "#3F51B5",
      llm_judge: "#795548",
      numeric_grounding: "#00BCD4",
    };
    const DIM_COLOR_CYCLE = ["#7C3AED","#0891B2","#D97706","#059669","#DC2626","#2563EB"];

    const formatDimLabel = (dim: string): string =>
      DIM_LABELS[dim] ?? dim.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const getDimIcon = (dim: string): string => DIM_ICONS[dim] ?? "star_rate";
    const getDimColor = (dim: string): string => DIM_COLORS[dim] ?? "grey";
    const getDimBarColor = (dim: string): string => DIM_BAR_COLORS[dim] ?? DIM_COLOR_CYCLE[Math.abs(dim.charCodeAt(0)) % DIM_COLOR_CYCLE.length];

    const parseCriticalIssues = (value: string | any[]): string[] => {
      try {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [value];
        }
        return [];
      } catch {
        // Fallback: check llm_judge_metadata for critical_issues
        return [];
      }
    };

    const getFixSuggestions = (record: any): string[] => {
      const suggestions: string[] = [];
      
      // 1. Try llm_evaluation_evaluators_llm_judge_metadata
      const metaStr = record.llm_evaluation_evaluators_llm_judge_metadata;
      if (metaStr) {
        try {
          const meta = typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr;
          if (Array.isArray(meta.improvement_suggestions) && meta.improvement_suggestions.length > 0) {
            suggestions.push(...meta.improvement_suggestions);
          } else if (meta.fix_recommendation) {
            suggestions.push(meta.fix_recommendation);
          }
        } catch { /* ignore */ }
      }

      // 2. Fallback to generic reasoning if score is very low
      if (suggestions.length === 0) {
        const weakest = getWeakestDimension(record);
        if (weakest && weakest.score < 0.3 && weakest.reasoning) {
          suggestions.push(`Focus on improving ${formatDimLabel(weakest.dimension)}: ${weakest.reasoning}`);
        }
      }

      return suggestions;
    };

    const getHighlightedResponse = (record: any): string => {
      let content = record.gen_ai_output_messages || "N/A";
      if (content === "N/A") return content;

      // 1. Try to get ungrounded numbers from metadata
      const ungrounded: string[] = [];
      const numericMetaStr = record.llm_evaluation_evaluators_numeric_grounding_metadata;
      if (numericMetaStr) {
        try {
          const meta = typeof numericMetaStr === "string" ? JSON.parse(numericMetaStr) : numericMetaStr;
          if (Array.isArray(meta.ungrounded)) {
            ungrounded.push(...meta.ungrounded);
          }
        } catch { /* ignore */ }
      }

      if (ungrounded.length === 0) return content;

      // 2. Highlight ungrounded numbers with a special class
      // We wrap them in a span that we'll style to be prominent
      ungrounded.forEach(val => {
        // Simple string replacement for now, could be improved with regex
        const regex = new RegExp(`\\b${val}\\b`, 'g');
        content = content.replace(regex, `<span class="ungrounded-highlight" title="Ungrounded value detected">${val}</span>`);
      });

      return content;
    };

    const truncateContent = (content: any, maxLength: number = 250): string => {
      if (!content) return "N/A";
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else {
        try {
          text = JSON.stringify(content, null, 2);
        } catch {
          text = String(content);
        }
      }
      return text.length > maxLength
        ? text.substring(0, maxLength) + "..."
        : text;
    };

    const parseInputForMessages = (input: any): any[] => {
      try {
        // If it's already an array, return it
        if (Array.isArray(input)) {
          return input;
        }
        // If it's a string, try to parse as JSON
        if (typeof input === "string") {
          const parsed = JSON.parse(input);
          if (Array.isArray(parsed)) {
            return parsed;
          }
          // If parsed is an object with a "messages" field, use that
          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.messages)
          ) {
            return parsed.messages;
          }
        }
        return [];
      } catch {
        return [];
      }
    };

    const getRoleColor = (role: string): string => {
      const colors: Record<string, string> = {
        user: "rgba(25, 118, 210, 0.1)",
        assistant: "rgba(76, 175, 80, 0.1)",
        system: "rgba(255, 152, 0, 0.1)",
        tool: "rgba(156, 39, 176, 0.1)",
      };
      return colors[role] || "rgba(158, 158, 158, 0.1)";
    };

    const parseMessages = (
      input: any,
      systemInstructions: any,
    ): { system: string | null; user: any[] } => {
      try {
        let messages = [];
        let system = null;

        // Check gen_ai_system_instructions first (OTEL spec: separate attribute)
        if (systemInstructions) {
          let parsedSystem;
          try {
            if (typeof systemInstructions === "string") {
              parsedSystem = JSON.parse(systemInstructions);
            } else {
              parsedSystem = systemInstructions;
            }
            if (Array.isArray(parsedSystem)) {
              // OTEL system instructions format: [{"type": "text", "content": "..."}]
              system = parsedSystem
                .filter((p: any) => p.type === "text" && p.content)
                .map((p: any) => p.content)
                .join("\n") || null;
            }
          } catch {
            system = typeof systemInstructions === "string"
              ? systemInstructions
              : null;
          }
        }

        // Parse input into array for user/assistant messages
        if (Array.isArray(input)) {
          messages = input;
        } else if (typeof input === "string") {
          const parsed = JSON.parse(input);
          if (Array.isArray(parsed)) {
            messages = parsed;
          } else if (parsed?.messages && Array.isArray(parsed.messages)) {
            messages = parsed.messages;
            system = parsed.system_instruction || null;
          } else {
            // If it's just a JSON object (not array), treat the whole thing as content
            // but check for system_instruction first
            if (parsed?.config?.system_instruction) {
               return {
                 system: parsed.config.system_instruction,
                 user: [{ role: "user", content: "Original Input Full JSON: " + JSON.stringify(parsed, null, 2) }]
               };
            }
            return {
              system:
                typeof input === "string"
                  ? input
                  : JSON.stringify(parsed, null, 2),
              user: [],
            };
          }
        } else {
          // If input is not a string or array, stringify it
          return { system: JSON.stringify(input, null, 2), user: [] };
        }

        // If no messages found, treat entire input as system/content
        if (messages.length === 0) {
          return {
            system:
              typeof input === "string"
                ? input
                : JSON.stringify(input, null, 2),
            user: [],
          };
        }

        // Separate system and user messages
        const userMessages = messages.filter(
          (msg: any) => msg.role !== "system" && msg.role !== undefined,
        );
        const systemMsg = messages.find((msg: any) => msg.role === "system");
        system = systemMsg?.content || null;

        return { system, user: userMessages };
      } catch {
        return { system: JSON.stringify(input, null, 2), user: [] };
      }
    };

    const transformInputForRenderer = (input: any): string => {
      try {
        // If it's already an array of messages, stringify it for LLMContentRenderer
        if (Array.isArray(input)) {
          return JSON.stringify(input);
        }
        // If it's a string, try to parse and re-stringify to ensure valid JSON
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            // If it's already an array, stringify it
            if (Array.isArray(parsed)) {
              return JSON.stringify(parsed);
            }
            // If it's an object with a messages field, use that
            if (
              parsed &&
              typeof parsed === "object" &&
              Array.isArray(parsed.messages)
            ) {
              return JSON.stringify(parsed.messages);
            }
            // Otherwise return the original string
            return input;
          } catch {
            // If parsing fails, return as is
            return input;
          }
        }
        // For other types, stringify
        return JSON.stringify(input);
      } catch {
        return String(input);
      }
    };

    // Template selector reactive data
    const selectedTemplate = ref<string | null>(null);
    const selectedTemplateData = ref<any | null>(null);
    const availableTemplates = ref<any[]>([]);
    const isLoadingTemplates = ref(false);

    // Load available templates for the org
    const loadTemplates = async (orgId: string) => {
      try {
        isLoadingTemplates.value = true;
        const { evalTemplateService } =
          await import("@/services/eval-template.service");
        const templates = await evalTemplateService.listTemplates(orgId);
        availableTemplates.value = templates;

        // Auto-select based on llm_evaluation_template_id from the eval record
        const templateIdFromRecord = props.evalData?.[0]?.llm_evaluation_template_id;
        if (templateIdFromRecord) {
          const matched = templates.find((t: any) => t.id === templateIdFromRecord);
          if (matched) {
            selectedTemplate.value = matched.id;
            selectedTemplateData.value = matched;
            return;
          }
        }
        // Fallback: first template
        if (templates.length > 0 && !selectedTemplate.value) {
          selectedTemplate.value = templates[0].id;
          selectedTemplateData.value = templates[0];
        }
      } catch (error) {
        console.error("Failed to load evaluation templates:", error);
        availableTemplates.value = [];
      } finally {
        isLoadingTemplates.value = false;
      }
    };

    // Self-trigger when evalData arrives (handles async component mount timing)
    const triggerLoad = (data: any[]) => {
      if (data.length > 0) {
        const orgId = store.state.selectedOrganization?.identifier;
        if (orgId) loadTemplates(orgId);
      }
    };

    onMounted(() => triggerLoad(props.evalData));
    watch(() => props.evalData, triggerLoad);

    // Handle template selection change
    const onTemplateChange = (newTemplate: string | null) => {
      if (newTemplate) {
        const matched = availableTemplates.value.find((t: any) => t.id === newTemplate);
        selectedTemplateData.value = matched || null;
      } else {
        selectedTemplateData.value = null;
      }
    };

    // Returns true if this dimension was explicitly listed in the selected eval template
    const isTemplateDimension = (dim: string): boolean => {
      if (!selectedTemplateData.value?.dimensions?.length) return false;
      return selectedTemplateData.value.dimensions.includes(dim);
    };

    // Returns PASS/FAIL for a dimension score (threshold: 0.5)
    const getDimVerdict = (score: number): "PASS" | "FAIL" =>
      score >= 0.5 ? "PASS" : "FAIL";

    // Returns true if the currently selected template differs from the one
    // that was actually used to evaluate this record.
    const isTemplateMismatch = (record: any): boolean => {
      if (!selectedTemplate.value) return false;
      const usedId = record.llm_evaluation_template_id;
      if (!usedId) return false; // unknown — no warning
      return selectedTemplate.value !== usedId;
    };

    // Name of the template that was actually used to evaluate this record.
    const evaluatedTemplateName = (record: any): string => {
      const usedId = record.llm_evaluation_template_id;
      if (!usedId) return "unknown";
      const matched = availableTemplates.value.find((t: any) => t.id === usedId);
      return matched?.name ?? usedId;
    };

    return {
      formatScore,
      getBarWidth,
      getScoreClass,
      formatTimestampDisplay,
      hasDimensionScores,
      getDimensionScores,
      getWeakestDimension,
      formatDimLabel,
      getDimIcon,
      getDimColor,
      getDimBarColor,
      parseCriticalIssues,
      truncateContent,
      parseInputForMessages,
      transformInputForRenderer,
      parseMessages,
      getJudgeModel,
      getVerdict,
      getFixSuggestions,
      getHighlightedResponse,
      selectedTemplate,
      selectedTemplateData,
      availableTemplates,
      isLoadingTemplates,
      loadTemplates,
      onTemplateChange,
      isTemplateDimension,
      getDimVerdict,
      isTemplateMismatch,
      evaluatedTemplateName,
    };
  },
});
</script>

<style scoped lang="scss">
.eval-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--o2-surface);
  padding: 16px;
  gap: 16px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 3px;
  }
}

body.body--dark .eval-container::-webkit-scrollbar-thumb {
  background: #475569;
}

// Reasoning card for template dimensions
// Light: O2 primary blue (25, 118, 210). Dark: softer blue-400 (96, 165, 250).
.dim-reasoning-template {
  background: rgba(25, 118, 210, 0.05);
  border: 1px solid rgba(25, 118, 210, 0.2);
}

body.body--dark .dim-reasoning-template {
  background: rgba(96, 165, 250, 0.07);
  border-color: rgba(96, 165, 250, 0.25);
}

// Template dimension highlight
.dim-template-highlight {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(25, 118, 210, 0.2);
  background: rgba(25, 118, 210, 0.04);
}

body.body--dark .dim-template-highlight {
  border-color: rgba(96, 165, 250, 0.25);
  background: rgba(96, 165, 250, 0.06);
}

// Modern Template Selector
.eval-template-dropdown {
  width: 260px;
  :deep(.q-field__control) {
    height: 36px;
    border-radius: 6px;
  }
}

// Loading & Empty States
.eval-loading,
.eval-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
  color: var(--o2-text-secondary);
}

.eval-empty-icon {
  font-size: 64px;
  opacity: 0.3;
}

.eval-record-v2 {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

// Hero metrics row — fixed height for uniform cards
.eval-hero-row {
  height: 100px;
}

// 2:1 layout columns
.eval-main-col {
  width: 66.67%;
}

.eval-sidebar-col {
  width: 33.33%;
}

// Metadata grid row: label column 80px, value takes rest
.eval-meta-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 4px;
}

// Small badge used for pass/fail and template labels
.eval-badge-sm {
  font-size: 9px;
  padding: 1px 4px;
}

// Card icon size
.eval-card-icon {
  font-size: 20px;
}

.score-excellent { color: #10b981; }
.score-good { color: #f59e0b; }
.score-poor { color: #ef4444; }

// Component-specific overrides
.o2-incident-card-bg {
  background-color: var(--o2-card-bg);
}

.el-border {
  border: 1px solid var(--o2-border);
}

.el-border-radius {
  border-radius: 8px;
}

// LLM Content Renderer Tweaks
:deep(.llm-content-renderer) {
  background: transparent !important;
  .plain-text-content {
    background: transparent !important;
    padding: 0 !important;
    font-size: 13px;
  }
}

// Expansion Item Tweaks
:deep(.q-expansion-item__container) {
  .q-item {
    min-height: 40px;
    padding: 8px 16px;
    &:hover {
      background: var(--o2-surface);
    }
  }
}

// Ungrounded highlighting
:deep(.ungrounded-highlight) {
  background-color: rgba(239, 68, 68, 0.15);
  border-bottom: 2px dashed #ef4444;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: bold;
  cursor: help;
  color: #ef4444;
}

body.body--dark :deep(.ungrounded-highlight) {
  background-color: rgba(239, 68, 68, 0.25);
}

// Typography Polish
.line-height-relaxed {
  line-height: 1.625 !important;
}

// Mobile responsiveness
@media (max-width: 1024px) {
  .tw\:flex.tw\:mb-4.tw\:h-28 {
    flex-wrap: wrap;
    height: auto !important;
    .tw\:flex-1 {
      min-width: calc(33.33% - 8px);
      height: 112px;
    }
  }
  
  .tw\:flex.tw\:gap-4 {
    flex-direction: column;
    .tw\:flex-col {
      width: 100% !important;
    }
  }
}

@media (max-width: 640px) {
  .tw\:flex.tw\:mb-4 .tw\:flex-1 {
    min-width: calc(50% - 8px);
  }
}

</style>
