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
  <div class="w-full h-full flex flex-col overflow-y-auto bg-(--color-surface-base) p-4 gap-4">
    <!-- Loading state -->
    <div v-if="isLoading" class="flex flex-col items-center justify-center h-[60vh] gap-4 text-(--color-text-secondary)">
      <OSpinner size="xl" />
      <div>{{ $t("traces.evaluations.loading") }}</div>
    </div>

    <!-- Empty state -->
    <div v-else-if="evalData.length === 0" class="flex flex-col items-center justify-center h-[60vh] gap-4 text-(--color-text-secondary)">
      <div class="text-[64px] opacity-30">
        <OIcon name="assessment" size="sm" />
      </div>
      <div class="eval-empty-title">{{ $t("traces.evaluations.noDataTitle") }}</div>
      <div class="eval-empty-subtitle">
        {{ $t("traces.evaluations.noDataSubtitle") }}
      </div>
    </div>

    <!-- Evaluation records -->
    <template v-else>
      <!-- Template Selector — page-level, above all records -->
      <div class="flex justify-end items-center">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">{{ $t("traces.evaluations.templateLabel") }}</span>
          <OSelect
            v-model="selectedTemplate"
            :options="availableTemplates"
            valueKey="id"
            labelKey="name"
            class="w-[260px]"
            @update:model-value="onTemplateChange"
          >
            <template v-slot:prepend>
              <OIcon name="assignment" size="xs" />
            </template>
          </OSelect>
        </div>
      </div>

      <div v-for="(record, idx) in evalData" :key="idx" class="flex flex-col gap-4 w-full">
        <!-- SECTION 1: Hero Metrics (Top Row) -->
        <div class="flex gap-3 mb-4 h-[100px]">
          <!-- 1. Quality Score Card -->
          <div
            class="flex-1 flex flex-col justify-between border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-3"
          >
            <div class="flex justify-between items-start">
              <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                {{ $t("traces.evaluations.qualityScore") }}
              </div>
              <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                   :class="getScoreClass(record.llm_evaluation_quality_score) === 'score-excellent' ? 'bg-green-500/10' : (getScoreClass(record.llm_evaluation_quality_score) === 'score-good' ? 'bg-amber-500/10' : 'bg-red-500/10')">
                <OIcon name="insights" size="sm"
                        :class="getScoreClass(record.llm_evaluation_quality_score) === 'score-excellent' ? 'text-green-500' : (getScoreClass(record.llm_evaluation_quality_score) === 'score-good' ? 'text-amber-500' : 'text-red-500')"
                        class="text-[20px]" />
              </div>
            </div>
            <div class="text-3xl font-bold tracking-tight leading-none text-[var(--color-grey-600)]">
              {{ formatScore(record.llm_evaluation_quality_score) }}
            </div>
          </div>

          <!-- 2. Verdict Card -->
          <div
            class="flex-1 flex flex-col justify-between border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-3"
          >
            <div class="flex justify-between items-start">
              <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                {{ $t("traces.evaluations.verdict") }}
              </div>
              <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                   :class="getVerdict(record) === 'PASS' ? 'bg-green-500/10' : getVerdict(record) === 'FAIL' ? 'bg-red-500/10' : 'bg-gray-500/10'">
                <OIcon :name="getVerdict(record) === 'PASS' ? 'check-circle' : getVerdict(record) === 'FAIL' ? 'cancel' : 'help-outline'" size="sm"
                        :class="getVerdict(record) === 'PASS' ? 'text-green-500' : getVerdict(record) === 'FAIL' ? 'text-red-500' : 'text-gray-400'"
                        class="text-[20px]" />
              </div>
            </div>
            <div class="text-2xl font-bold tracking-tight leading-none"
                 :class="getVerdict(record) === 'PASS' ? 'text-green-500' : getVerdict(record) === 'FAIL' ? 'text-red-500' : 'text-[var(--color-text-secondary)]'">
              {{ getVerdict(record) }}
            </div>
          </div>

          <!-- 3. Steps Card -->
          <div
            class="flex-1 flex flex-col justify-between border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-3"
          >
            <div class="flex justify-between items-start">
              <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                {{ $t("traces.evaluations.traceSteps") }}
              </div>
              <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10">
                <OIcon name="layers" size="sm" class="text-blue-500 text-[20px]" />
              </div>
            </div>
            <div class="text-3xl font-bold tracking-tight leading-none text-[var(--color-grey-600)]">
              {{ record.total_steps || "0" }}
            </div>
          </div>

          <!-- 4. Tools Card -->
          <div
            class="flex-1 flex flex-col justify-between border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-3"
          >
            <div class="flex justify-between items-start">
              <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                {{ $t("traces.evaluations.toolCalls") }}
              </div>
              <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/10">
                <OIcon name="build" size="sm" class="text-purple-500 text-[20px]" />
              </div>
            </div>
            <div class="text-3xl font-bold leading-none text-[var(--color-grey-600)]">
              {{ record.total_tool_calls || "0" }}
            </div>
          </div>

          <!-- 5. Completion Card -->
          <div
            class="flex-1 flex flex-col justify-between border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-3"
          >
            <div class="flex justify-between items-start">
              <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                {{ $t("traces.evaluations.doneVia") }}
              </div>
              <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-500/10">
                <OIcon name="flag" size="sm" class="text-teal-500 text-[20px]" />
              </div>
            </div>
            <div class="text-lg font-semibold leading-tight text-[var(--color-grey-600)] truncate" :title="record.completion_signal">
              {{ record.completion_signal || "N/A" }}
            </div>
          </div>
        </div>

        <!-- SECTION 2: Main Content (2:1 Ratio Layout) -->
        <div class="flex gap-4">
          <!-- PART 1: Primary Content (Analysis & reasoning) - 2/3 Width -->
          <div class="flex flex-col gap-4 w-[66.67%]">
            <!-- 2.1A: Issues & Analysis Card -->
            <div class="border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-4">
              <div class="flex items-center gap-2 mb-3">
                <OIcon name="rule" size="sm" />
                <div class="text-sm font-semibold text-[var(--color-text-heading)]">{{ $t("traces.evaluations.issuesAnalysis") }}</div>
              </div>

              <!-- Template Evaluation Criteria (shown when a template with content is active) -->
              <div v-if="selectedTemplateData?.content" class="mb-4">
                <OCollapsible
                  icon="description"
                  :label="isTemplateMismatch(record) ? $t('traces.evaluations.criteriaDifferentTemplate') : $t('traces.evaluations.criteriaFromTemplate')"
                >
                  <!-- Mismatch notice inside the criteria panel -->
                  <div
                    v-if="isTemplateMismatch(record)"
                    class="mt-2 mb-1 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400"
                  >
                    <OIcon name="warning" size="xs" />
                    <span>{{ $t("traces.evaluations.criteriaTemplateMismatchNote", { template: selectedTemplateData?.name, evaluated: evaluatedTemplateName(record) }) }}</span>
                  </div>
                  <div class="mt-2 p-3 bg-[var(--color-border-default)] rounded-md text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-heading)]">
                    {{ selectedTemplateData.content }}
                  </div>
                  <div class="mt-1 text-[10px] text-[var(--color-text-secondary)] italic">
                    {{ $t("traces.evaluations.criteriaSyntaxNote") }}
                  </div>
                </OCollapsible>
              </div>

              <!-- Critical Issues -->
              <div v-if="record.llm_evaluation_judge_critical_issues" class="mb-4">
                <div class="flex flex-wrap gap-2">
                  <div
                    v-for="(issue, i) in parseCriticalIssues(record.llm_evaluation_judge_critical_issues)"
                    :key="i"
                    class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-500/10 text-red-600 text-xs font-medium border border-red-500/20"
                  >
                    <OIcon name="report-problem" size="xs" />
                    <span>{{ issue }}</span>
                  </div>
                </div>
              </div>

              <!-- Fix Suggestions Card (Phase 2) -->
              <div v-if="getFixSuggestions(record).length > 0" class="mb-4">
                <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase mb-2">{{ $t("traces.evaluations.recommendedFixes") }}</div>
                <div class="space-y-2">
                  <div v-for="(fix, i) in getFixSuggestions(record)" :key="i"
                       class="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg border-dashed">
                    <OIcon name="lightbulb" size="sm" class="mt-1" />
                    <div class="text-xs text-[var(--color-text-heading)] flex-1 leading-relaxed">
                      <strong>{{ $t("traces.evaluations.fixSuggestion") }}</strong> {{ fix }}
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="getWeakestDimension(record)" class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                  <OIcon name="trending-down" size="xs" />
                  <span class="text-xs font-medium text-[var(--color-text-secondary)]">{{ $t("traces.evaluations.weakestDimension") }}</span>
                  <OTag type="evalBadge" value="weakest">{{ formatDimLabel(getWeakestDimension(record)!.dimension) }}</OTag>
                </div>
                <div v-if="getWeakestDimension(record)!.reasoning" class="text-sm bg-[var(--color-border-default)] p-3 rounded-md leading-relaxed">
                  {{ getWeakestDimension(record)!.reasoning }}
                </div>
              </div>
            </div>

            <!-- 2.1B: Score Reasoning Card -->
            <div class="border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-4">
              <div class="flex items-center gap-2 mb-3">
                <OIcon name="psychology" size="sm" />
                <div class="text-sm font-semibold text-[var(--color-text-heading)]">{{ $t("traces.evaluations.dimensionReasoning") }}</div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div
                  v-for="dim in getDimensionScores(record).filter(d => d.reasoning).slice().sort((a, b) => (isTemplateDimension(b.dimension) ? 1 : 0) - (isTemplateDimension(a.dimension) ? 1 : 0))"
                  :key="dim.dimension"
                  class="p-3 rounded-md flex flex-col gap-1"
                  :class="isTemplateDimension(dim.dimension) ? 'bg-[rgba(25,118,210,0.05)] border border-[rgba(25,118,210,0.2)] dark:bg-[rgba(96,165,250,0.07)] dark:border-[rgba(96,165,250,0.25)]' : 'bg-[var(--color-border-default)]'"
                >
                  <div class="flex items-center gap-1.5">
                    <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {{ formatDimLabel(dim.dimension) }}
                    </div>
                    <!-- Pass/Fail inline -->
                    <OTag
                      v-if="isTemplateDimension(dim.dimension)"
                      type="evaluationVerdict"
                      :value="getDimVerdict(dim.score)"
                      class="text-[9px] py-px px-1"
                    />
                  </div>
                  <div class="text-xs leading-relaxed text-[var(--color-text-heading)]">
                    {{ truncateContent(dim.reasoning, 200) }}
                  </div>
                </div>
                <div v-if="!getDimensionScores(record).some(d => d.reasoning)" class="text-sm italic text-[var(--color-text-secondary)]">
                  {{ $t("traces.evaluations.noDimensionReasoning") }}
                </div>
              </div>
            </div>

            <!-- 2.1C: Query & Response Card (Full Width in column) -->
            <div class="border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] overflow-hidden">
              <div class="px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-border-default)]/30">
                <div class="flex items-center gap-2">
                  <OIcon name="code" size="sm" />
                  <div class="text-sm font-semibold text-[var(--color-text-heading)]">{{ $t("traces.evaluations.queryResponse") }}</div>
                </div>
              </div>

              <div class="flex flex-col divide-y divide-[var(--color-border-default)]">
                <!-- System Prompt (Expandable) -->
                <OCollapsible
                  v-if="parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).system"
                  icon="settings"
                  :label="$t('traces.evaluations.systemPrompt')"
                >
                  <div class="p-4 bg-[var(--color-code-bg)]">
                    <LLMContentRenderer
                      :content="JSON.stringify([{ role: 'system', content: parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).system }])"
                      :contentType="'input'"
                      :viewMode="'formatted'"
                    />
                  </div>
                </OCollapsible>

                <!-- User Messages -->
                <OCollapsible
                  v-if="parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).user.length > 0"
                  icon="person"
                  :model-value="true"
                  :label="$t('traces.evaluations.userMessages')"
                >
                  <div class="p-4 bg-[var(--color-code-bg)]">
                    <LLMContentRenderer
                      :content="JSON.stringify(parseMessages(record.gen_ai_input_messages, record.gen_ai_system_instructions).user)"
                      :contentType="'input'"
                      :viewMode="'formatted'"
                    />
                  </div>
                </OCollapsible>

                <!-- Assistant Response -->
                <OCollapsible
                  v-if="record.gen_ai_output_messages"
                  icon="smart-toy"
                  :model-value="true"
                  :label="$t('traces.evaluations.assistantResponse')"
                >
                  <div class="p-4 bg-[var(--color-code-bg)]">
                    <LLMContentRenderer
                      :content="getHighlightedResponse(record)"
                      :contentType="'output'"
                      :viewMode="'json'"
                    />
                  </div>
                </OCollapsible>
              </div>
            </div>
          </div>

          <!-- PART 2: Sidebar Content (Dimensions & Metadata) - 1/3 Width -->
          <div class="flex flex-col gap-4 w-[33.33%]">
            <!-- 2.2A: Dimensions Card -->
            <div class="border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-4 flex flex-col gap-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <OIcon name="analytics" size="sm" />
                  <div class="text-sm font-semibold text-[var(--color-text-heading)]">{{ $t("traces.evaluations.dimensions") }}</div>
                </div>
                <!-- Threshold explainer shown only when template dimensions are present -->
                <div v-if="selectedTemplateData?.dimensions?.length" class="flex items-center gap-1">
                  <span class="text-[10px] text-[var(--color-text-secondary)]">{{ $t("traces.evaluations.passThreshold") }}</span>
                  <OIcon name="info-outline" size="xs" />
                    <OTooltip :content="$t('traces.evaluations.passThresholdTooltip')" max-width="220px" />
                </div>
              </div>

              <!-- Template aspects legend (shown when a template is active) -->
              <div v-if="selectedTemplateData?.dimensions?.length" class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
                <OIcon name="assignment" size="xs" />
                <span>{{ $t("traces.evaluations.templateAspectsFrom", { template: selectedTemplateData.name }) }}</span>
              </div>

              <!-- Mismatch warning: selected template ≠ template used for evaluation -->
              <div
                v-if="isTemplateMismatch(record)"
                class="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-700 dark:text-amber-400"
              >
                <OIcon name="warning" size="xs" class="mt-px shrink-0" />
                <span>{{ $t("traces.evaluations.templateMismatchWarning", { selected: selectedTemplateData?.name, evaluated: evaluatedTemplateName(record) }) }}</span>
              </div>

              <div class="flex flex-col gap-4">
                <div
                  v-for="dim in getDimensionScores(record)"
                  :key="dim.dimension"
                  class="flex flex-col gap-1.5"
                  :class="isTemplateDimension(dim.dimension) ? 'p-[6px_8px] rounded-md border border-[rgba(25,118,210,0.2)] bg-[rgba(25,118,210,0.04)] dark:border-[rgba(96,165,250,0.25)] dark:bg-[rgba(96,165,250,0.06)]' : ''"
                >
                  <div class="flex justify-between items-center">
                    <div class="flex items-center gap-2">
                      <OIcon :name="getDimIcon(dim.dimension)" :class="getDimColorClass(dim.dimension)" size="sm" />
                      <span class="text-xs font-medium text-[var(--color-text-heading)]">{{ formatDimLabel(dim.dimension) }}</span>
                      <!-- Template aspect badge -->
                      <OTag
                        v-if="isTemplateDimension(dim.dimension)"
                        type="evalBadge"
                        value="template"
                        class="text-[9px] py-px px-1"
                      />
                    </div>
                    <div class="flex items-center gap-1.5">
                      <!-- Pass/Fail verdict badge for template dimensions -->
                      <OTag
                        v-if="isTemplateDimension(dim.dimension)"
                        type="evaluationVerdict"
                        :value="getDimVerdict(dim.score)"
                        class="text-[9px] py-px px-1"
                      />
                      <span class="text-xs font-bold text-[var(--color-text-heading)]">{{ formatScore(dim.score) }}</span>
                    </div>
                  </div>
                  <div class="h-1.5 w-full bg-[var(--color-border-default)] rounded-full overflow-hidden">
                    <div
                      class="h-full transition-all duration-500"
                      :style="{
                        width: getBarWidth(dim.score),
                        backgroundColor: isTemplateDimension(dim.dimension)
                          ? (getDimVerdict(dim.score) === 'PASS' ? '#22c55e' : '#ef4444')
                          : getDimBarColor(dim.dimension)
                      }"
                    ></div>
                  </div>
                  <OTooltip v-if="dim.reasoning" :content="dim.reasoning" max-width="250px" />
                </div>
              </div>
            </div>

            <!-- 2.2B: Metadata Details Card -->
            <div class="border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-base)] p-4">
              <div class="flex items-center gap-2 mb-4">
                <OIcon name="info" size="sm" />
                <div class="text-sm font-semibold">{{ $t("traces.evaluations.technicalDetails") }}</div>
              </div>

              <div class="flex flex-col gap-3">
                <div class="grid grid-cols-[80px_1fr] gap-1">
                  <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase">{{ $t("traces.evaluations.judge") }}</div>
                  <div class="text-xs truncate">{{ getJudgeModel(record) }}</div>
                </div>
                <div class="grid grid-cols-[80px_1fr] gap-1">
                  <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase">{{ $t("traces.evaluations.time") }}</div>
                  <div class="text-xs">{{ formatTimestampDisplay(record._timestamp) }}</div>
                </div>
                <div class="grid grid-cols-[80px_1fr] gap-1">
                  <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase">{{ $t("traces.evaluations.confidence") }}</div>
                  <div class="text-xs">{{ formatScore(record.llm_evaluation_judge_confidence) }}</div>
                </div>
                <div class="grid grid-cols-[80px_1fr] gap-1">
                  <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase">{{ $t("traces.evaluations.status") }}</div>
                  <div>
                    <OTag
                      type="evalStatus"
                      :value="record.exit_status"
                      :label="record.exit_status?.toUpperCase() || 'UNKNOWN'"
                    />
                  </div>
                </div>
                <div v-if="record.is_multi_step" class="grid grid-cols-[80px_1fr] gap-1">
                  <div class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase">{{ $t("traces.evaluations.type") }}</div>
                  <div class="text-xs">{{ $t("traces.evaluations.multiStepAgent") }}</div>
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
import { useI18n } from "vue-i18n";
import { getQualityScoreColor } from "@/utils/llmUtils";
import LLMContentRenderer from "./LLMContentRenderer.vue";
import { useStore } from "vuex";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";

export default defineComponent({
  name: "TraceEvaluationsView",
  components: {
    LLMContentRenderer,
    OSpinner,
    OSelect,
    OTooltip,
    OIcon,
    OTag,
    OCollapsible,
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
    const { t } = useI18n();
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
      accuracy: "check-circle",
      trajectory_efficiency: "flash_on",
      completeness: "task_alt",
      safety: "security",
      slop_filter: "filter_alt",
      technical_question_retrieval: "find_in_page",
      tool_effectiveness: "build_circle",
      llm_judge: "gavel",
      numeric_grounding: "numbers",
    };
    const DIM_COLOR_CLASSES: Record<string, string> = {
      relevance: "text-[var(--color-primary-600)]",
      groundedness: "text-[var(--color-success-600)]",
      conciseness: "text-purple-700",
      instruction_following: "text-orange-500",
      accuracy: "text-[var(--color-error-600)]",
      trajectory_efficiency: "text-cyan-500",
      completeness: "text-teal-500",
      safety: "text-red-500",
      slop_filter: "text-gray-600",
      technical_question_retrieval: "text-slate-500",
      tool_effectiveness: "text-indigo-500",
      llm_judge: "text-amber-700",
      numeric_grounding: "text-cyan-500",
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
    const getDimIcon = (dim: string): string => DIM_ICONS[dim] ?? "star-rate";
    const getDimColorClass = (dim: string): string => DIM_COLOR_CLASSES[dim] ?? "text-gray-500";
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
          suggestions.push(t('traces.traceEvaluationsView.focusOnImproving', { dimension: formatDimLabel(weakest.dimension), reasoning: weakest.reasoning }));
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
        content = content.replace(regex, `<span class="ungrounded-highlight" title="${t('traces.traceEvaluationsView.ungroundedValueDetected')}">${val}</span>`);
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
                 user: [{ role: "user", content: t('traces.traceEvaluationsView.originalInputFullJson') + JSON.stringify(parsed, null, 2) }]
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
      if (!usedId) return t('traces.traceEvaluationsView.unknown');
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
      getDimColorClass,
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

<style>
/* Ungrounded highlighting */
.ungrounded-highlight {
  background-color: rgba(239, 68, 68, 0.15);
  border-bottom: 2px dashed #ef4444;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: bold;
  cursor: help;
  color: #ef4444;
}

body.body--dark .ungrounded-highlight {
  background-color: rgba(239, 68, 68, 0.25);
}

/* Mobile responsiveness */
@media (max-width: 1024px) {
  .flex.mb-4.h-28 {
    flex-wrap: wrap;
    height: auto !important;
  }

  .flex.mb-4.h-28 .flex-1 {
    min-width: calc(33.33% - 8px);
    height: 112px;
  }

  .flex.gap-4 {
    flex-direction: column;
  }

  .flex.gap-4 .flex-col {
    width: 100% !important;
  }
}

@media (max-width: 640px) {
  .flex.mb-4 .flex-1 {
    min-width: calc(50% - 8px);
  }
}
</style>
