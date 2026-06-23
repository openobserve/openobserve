<template>
  <div class="jd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="jd" @click.stop data-test="eval-job-detail">
      <!-- ── Header ── -->
      <header class="jd__header">
        <div class="jd__header-text">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
            <span class="jd__eyebrow">{{ t("onlineEvals.job.detail.eyebrow") }}</span>
            <span
              v-if="row.name"
              :class="[
                'tw:font-semibold tw:px-2 tw:py-1 tw:rounded-md tw:inline-block',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50',
              ]"
            >
              {{ row.name }}
              <OTooltip
                v-if="row.name && row.name.length > 35"
                :content="row.name"
                side="top"
              />
            </span>
          </div>
          <div v-if="row.description" class="jd__sub-line">
            {{ row.description }}
          </div>
        </div>
        <button
          type="button"
          class="jd__close"
          :aria-label="t('onlineEvals.job.detail.close')"
          data-test="eval-job-detail-close-btn"
          @click="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <!-- ── KPI strip ── -->
      <section class="jd__kpis">
        <article class="jd-kpi">
          <span class="jd-kpi__title">{{ t("onlineEvals.job.detail.kpis.totalRuns") }}</span>
          <span class="jd-kpi__value">{{ formatCount(kpis.totalRuns) }}</span>
          <span class="jd-kpi__sub">{{ t("onlineEvals.job.detail.kpis.totalRunsSub") }}</span>
        </article>
        <article class="jd-kpi" :class="successRateTone">
          <span class="jd-kpi__title">{{ t("onlineEvals.job.detail.kpis.successRate") }}</span>
          <span class="jd-kpi__value">{{ formatPercent(kpis.successRate) }}</span>
          <span class="jd-kpi__sub">{{ t("onlineEvals.job.detail.kpis.successRateSub") }}</span>
        </article>
        <article class="jd-kpi">
          <span class="jd-kpi__title">{{ t("onlineEvals.job.detail.kpis.avgLatency") }}</span>
          <span class="jd-kpi__value">{{ formatLatency(kpis.avgLatencyMs) }}</span>
          <span class="jd-kpi__sub">{{ t("onlineEvals.job.detail.kpis.avgLatencySub") }}</span>
        </article>
        <article class="jd-kpi">
          <span class="jd-kpi__title">{{ t("onlineEvals.job.detail.kpis.scorers") }}</span>
          <span class="jd-kpi__value">{{ resolvedScorers.length }}</span>
          <span class="jd-kpi__sub">
            {{ resolvedScorers.length === 1
              ? t("onlineEvals.job.detail.kpis.scorersSubSingular")
              : t("onlineEvals.job.detail.kpis.scorersSubPlural") }}
          </span>
        </article>
      </section>

      <!-- ── Tab strip ── -->
      <nav class="jd__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="jd__tab"
          :class="{ 'jd__tab--active': activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :data-test="`eval-job-detail-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count != null" class="jd__tab-count">{{ tab.count }}</span>
        </button>
      </nav>

      <!-- ── Body ── -->
      <div class="jd__body">
        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <!-- Target -->
          <section class="jd-section">
            <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.targetSection") }}</h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.streamLabel") }}</dt>
              <dd class="jd-mono">{{ row.stream }}</dd>

              <dt>{{ t("onlineEvals.job.detail.streamTypeLabel") }}</dt>
              <dd class="jd-mono">{{ streamType }}</dd>

              <dt>{{ t("onlineEvals.job.detail.filterLabel") }}</dt>
              <dd>
                <pre
                  v-if="filterClauses.length > 0"
                  class="jd-filter"
                  data-test="eval-job-detail-filter"
                ><div
                    v-for="(clause, idx) in filterClauses"
                    :key="idx"
                    class="jd-filter__row"
                    :style="{ paddingLeft: `${clause.depth * 16}px` }"
                  ><span class="jd-filter__kw">{{ clause.keyword }}</span><span class="jd-filter__col">{{ clause.column }}</span><span class="jd-filter__op">{{ clause.operator }}</span><span
                      class="jd-filter__val"
                      :class="{ 'jd-filter__val--str': clause.valueIsString }"
                    >{{ clause.valueText }}</span></div></pre>
                <span v-else class="jd-muted">{{ t("onlineEvals.job.detail.filterEmpty") }}</span>
              </dd>
            </dl>
          </section>

          <!-- Scorers -->
          <section class="jd-section">
            <h4 class="jd-section__title">
              {{ t("onlineEvals.job.detail.scorersSection") }}
              <span class="jd-section__chip">{{ resolvedScorers.length }}</span>
            </h4>
            <div v-if="resolvedScorers.length === 0" class="jd-empty">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.scorersEmpty") }}</span>
            </div>
            <ul v-else class="jd-scorers">
              <li v-for="item in resolvedScorers" :key="item.id">
                <button
                  type="button"
                  class="jd-scorers__card"
                  :data-test="`eval-job-detail-scorer-item-${item.name}`"
                  :disabled="!findScorerById(item.id)"
                  @click="onScorerClick(item.id)"
                >
                  <span
                    class="jd-scorers__icon"
                    :class="`jd-scorers__icon--${item.scorerType}`"
                  >
                    <OIcon
                      :name="item.scorerType === 'remote' ? 'cloud' : 'smart-toy'"
                      size="sm"
                    />
                  </span>
                  <div class="jd-scorers__main">
                    <div class="jd-scorers__row">
                      <span class="jd-mono jd-scorers__name">{{ item.name }}</span>
                      <span
                        v-if="item.scorerTypeLabel"
                        class="jd-scorers__type"
                        :class="`jd-scorers__type--${item.scorerType}`"
                      >
                        {{ item.scorerTypeLabel }}
                      </span>
                      <span class="jd-scorers__version">v{{ item.version }}</span>
                    </div>
                    <div v-if="item.scoreConfigName" class="jd-scorers__produces">
                      <OIcon name="rule" size="xs" class="jd-scorers__produces-icon" />
                      <span class="jd-scorers__produces-prefix">
                        {{ t("onlineEvals.job.detail.producesPrefix") }}
                      </span>
                      <span class="jd-mono jd-scorers__produces-name">{{ item.scoreConfigName }}</span>
                      <template v-if="item.scoreConfigDataType">
                        <span class="jd-scorers__sep">·</span>
                        <span class="jd-mono jd-scorers__produces-type">
                          {{ item.scoreConfigDataType }}
                        </span>
                      </template>
                      <template v-if="item.scoreConfigRangeText">
                        <span class="jd-scorers__sep">·</span>
                        <span class="jd-mono jd-scorers__produces-range">
                          {{ item.scoreConfigRangeText }}
                        </span>
                      </template>
                    </div>
                  </div>
                  <span class="jd-scorers__cta">
                    <span class="jd-scorers__cta-label">
                      {{ t("onlineEvals.job.detail.viewScorerHint") }}
                    </span>
                    <OIcon name="chevron-right" size="sm" class="jd-scorers__chevron" />
                  </span>
                </button>
              </li>
            </ul>
          </section>


          <!-- Sampling -->
          <section class="jd-section">
            <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.samplingSection") }}</h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.samplingModeLabel") }}</dt>
              <dd>{{ samplingModeLabel }}</dd>

              <dt v-if="samplingValue != null">{{ t("onlineEvals.job.detail.samplingValueLabel") }}</dt>
              <dd v-if="samplingValue != null" class="jd-mono">{{ samplingValue }}</dd>
            </dl>
          </section>

          <!-- Metadata -->
          <section class="jd-section">
            <h4 class="jd-section__title">{{ t("onlineEvals.job.detail.metadataSection") }}</h4>
            <dl class="jd-kv">
              <dt>{{ t("onlineEvals.job.detail.versionLabel") }}</dt>
              <dd class="jd-mono">v{{ row.version }}</dd>
              <dt v-if="pipelineId">{{ t("onlineEvals.job.detail.pipelineLabel") }}</dt>
              <dd v-if="pipelineId" class="jd-mono">{{ pipelineId }}</dd>
              <dt v-if="createdAt">{{ t("onlineEvals.job.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="jd-mono">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.job.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="jd-mono">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <div class="jd__runs-toolbar">
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="jd__date-picker"
              data-test="eval-job-detail-runs-window"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoadingRuns"
              :title="t('onlineEvals.job.detail.refresh')"
              data-test="eval-job-detail-runs-refresh"
              @click="refreshRuns"
            />
          </div>

          <OTable
            data-test="eval-job-detail-runs-table"
            :data="runs"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 200]"
            width="100%"
            class="tw:w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="jd-mono jd-muted-text">{{ relativeTime(row.timestampMs) }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span class="jd-mono">{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-target="{ row }">
              <div class="jd-target-cell">
                <div v-if="row.targetSpanId" class="jd-target-cell__line">
                  <span class="jd-target-cell__label">{{ t("onlineEvals.job.detail.runs.spanLabel") }}</span>
                  <span class="jd-mono jd-target-cell__id" :title="row.targetSpanId">{{ row.targetSpanId }}</span>
                </div>
                <div v-if="row.targetTraceId" class="jd-target-cell__line">
                  <span class="jd-target-cell__label">{{ t("onlineEvals.job.detail.runs.traceLabel") }}</span>
                  <span class="jd-mono jd-target-cell__id" :title="row.targetTraceId">{{ row.targetTraceId }}</span>
                </div>
              </div>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span class="jd-mono">{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span class="jd-mono">{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
            </template>
            <template #cell-status="{ row }">
              <span class="jd-status-cell" :class="`jd-status-cell--${row.status}`">
                <span class="jd-status-cell__dot" />
                {{ row.status }}
              </span>
            </template>
          </OTable>
        </template>

        <!-- Failures -->
        <template v-else-if="activeTab === 'failures'">
          <div class="jd__runs-toolbar">
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="jd__date-picker"
              data-test="eval-job-detail-failures-window"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoadingRuns"
              :title="t('onlineEvals.job.detail.refresh')"
              data-test="eval-job-detail-failures-refresh"
              @click="refreshRuns"
            />
          </div>

          <!-- Failures-by-scorer rollup -->
          <section class="jd-section">
            <h4 class="jd-section__title">
              {{ t("onlineEvals.job.detail.failures.byScorerTitle") }}
              <span class="jd-section__chip">{{ failureRows.length }}</span>
            </h4>
            <div v-if="failureRows.length === 0" class="jd-empty">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.failures.byScorerEmpty") }}</span>
            </div>
            <OTable
              v-else
              data-test="eval-job-detail-failures-by-scorer-table"
              :data="failureRows"
              :columns="failureByScorerColumns"
              row-key="scorerId"
              :show-global-filter="false"
              :show-footer="false"
              :show-pagination="false"
              width="100%"
              class="tw:w-full"
            >
              <template #cell-scorerId="{ row }">
                <span class="jd-mono">{{ scorerNameFor(row.scorerId) }}</span>
              </template>
              <template #cell-failureRate="{ row }">
                <span class="jd-mono" :class="failTone(row.failureRate)">
                  {{ formatPercent(row.failureRate) }}
                </span>
              </template>
              <template #cell-failures="{ row }">
                <span class="jd-mono">
                  <strong>{{ row.failures }}</strong>
                  / {{ row.totalRuns }}
                </span>
              </template>
            </OTable>
          </section>

          <!-- Recent failures -->
          <section class="jd-section">
            <h4 class="jd-section__title">
              {{ t("onlineEvals.job.detail.failures.recentTitle") }}
              <span class="jd-section__chip">{{ failedRuns.length }}</span>
            </h4>
            <div v-if="failedRuns.length === 0 && !isLoadingRuns" class="jd-empty">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.failures.recentEmpty") }}</span>
            </div>
            <OTable
              v-else
              data-test="eval-job-detail-failures-table"
              :data="failedRuns"
              :columns="runColumns"
              row-key="id"
              :loading="isLoadingRuns"
              :show-global-filter="false"
              :show-footer="false"
              :page-size="20"
              :page-size-options="[20, 50, 100, 200]"
              width="100%"
              class="tw:w-full"
            >
              <template #cell-timestampMs="{ row }">
                <span class="jd-mono jd-muted-text">{{ relativeTime(row.timestampMs) }}</span>
              </template>
              <template #cell-scorerId="{ row }">
                <span class="jd-mono">{{ scorerNameFor(row.scorerId) }}</span>
              </template>
              <template #cell-target="{ row }">
                <div class="jd-target-cell">
                  <div v-if="row.targetSpanId" class="jd-target-cell__line">
                    <span class="jd-target-cell__label">{{ t("onlineEvals.job.detail.runs.spanLabel") }}</span>
                    <span class="jd-mono jd-target-cell__id" :title="row.targetSpanId">{{ row.targetSpanId }}</span>
                  </div>
                  <div v-if="row.targetTraceId" class="jd-target-cell__line">
                    <span class="jd-target-cell__label">{{ t("onlineEvals.job.detail.runs.traceLabel") }}</span>
                    <span class="jd-mono jd-target-cell__id" :title="row.targetTraceId">{{ row.targetTraceId }}</span>
                  </div>
                </div>
              </template>
              <template #cell-scoreDisplay="{ row }">
                <span class="jd-mono">{{ row.scoreDisplay }}</span>
              </template>
              <template #cell-latencyMs="{ row }">
                <span class="jd-mono">{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
              </template>
              <template #cell-status="{ row }">
                <span class="jd-status-cell" :class="`jd-status-cell--${row.status}`">
                  <span class="jd-status-cell__dot" />
                  {{ row.status }}
                </span>
              </template>
            </OTable>
          </section>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import type {
  EvalJob,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { normalizeJobFilterCondition } from "../utils/jobFilter";
import { useEvalJobRuns, type JobRunsWindow } from "../composables/useEvalJobRuns";

const props = defineProps<{
  row: EvalJob;
  scorers: Scorer[];
  scoreConfigs: ScoreConfig[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-scorer", row: Scorer): void;
}>();

const { t } = useI18n();
const store = useStore();

type TabId = "configuration" | "runs" | "failures";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const streamType = computed<string>(
  () => valueOf<string>(props.row, "streamType", "stream_type") ?? "traces",
);

const normalizedFilter = computed(() => {
  const raw = valueOf<any>(props.row, "filterCondition", "filter_condition");
  return normalizeJobFilterCondition(raw);
});

const filterCondition = computed(() => normalizedFilter.value);

interface FilterClause {
  keyword: "if" | "AND" | "OR";
  column: string;
  operator: string;
  valueText: string;
  valueIsString: boolean;
  depth: number;
}

const filterClauses = computed<FilterClause[]>(() => {
  const cond = filterCondition.value;
  if (!cond) return [];
  const out = flattenFilter(cond, 0);
  if (out.length === 0) return [];
  out[0].keyword = "if";
  return out;
});

function flattenFilter(node: any, depth: number): FilterClause[] {
  if (!node || typeof node !== "object") return [];

  if (node.filterType === "condition") {
    const formatted = formatConditionParts(node);
    if (!formatted) return [];
    return [{ ...formatted, keyword: "AND" as const, depth }];
  }

  if (node.filterType === "group" && Array.isArray(node.conditions)) {
    const op: "AND" | "OR" = node.logicalOperator === "OR" ? "OR" : "AND";
    const out: FilterClause[] = [];
    for (let i = 0; i < node.conditions.length; i += 1) {
      const child = flattenFilter(node.conditions[i], depth + (out.length > 0 ? 1 : 0));
      if (child.length === 0) continue;
      if (out.length > 0 && child.length > 0) {
        child[0].keyword = op;
      }
      out.push(...child);
    }
    return out;
  }

  return [];
}

function formatConditionParts(
  node: any,
): Pick<FilterClause, "column" | "operator" | "valueText" | "valueIsString"> | null {
  const column = String(node.column ?? "").trim();
  const operator = String(node.operator ?? "=").trim();
  if (!column) return null;

  const valuesList: string[] = Array.isArray(node.values) ? node.values.filter(Boolean) : [];
  const rawValue = node.value;
  const opUpper = operator.toUpperCase();

  if (opUpper === "IN" || opUpper === "NOT IN") {
    const items = valuesList.length > 0 ? valuesList : rawValue ? [String(rawValue)] : [];
    if (items.length === 0) {
      return { column, operator, valueText: "(…)", valueIsString: false };
    }
    return {
      column,
      operator,
      valueText: `(${items.map(formatValue).join(", ")})`,
      valueIsString: false,
    };
  }

  if (rawValue == null || rawValue === "") {
    return { column, operator, valueText: `""`, valueIsString: true };
  }
  const valueText = formatValue(String(rawValue));
  return {
    column,
    operator,
    valueText,
    valueIsString: !/^-?\d+(\.\d+)?$/.test(String(rawValue)),
  };
}

function formatValue(v: string): string {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

const statusLabel = computed(() =>
  t(`onlineEvals.jobStatus.${props.row.status}`, props.row.status),
);

const samplingMode = computed(
  () => valueOf<string>(props.row, "samplingMode", "sampling_mode") ?? "all",
);

const samplingValue = computed(
  () => valueOf<any>(props.row, "samplingValue", "sampling_value"),
);

const samplingModeLabel = computed(() => {
  if (samplingMode.value === "rate") return t("onlineEvals.job.detail.samplingRate");
  if (samplingMode.value === "count") return t("onlineEvals.job.detail.samplingCount");
  return t("onlineEvals.job.detail.samplingAll");
});

interface ResolvedScorer {
  id: string;
  name: string;
  version: number;
  scoreConfigName: string;
  scoreConfigDataType: string;
  scoreConfigRangeText: string;
  scorerType: "llm_judge" | "remote" | "unknown";
  scorerTypeLabel: string;
}

function describeScoreConfig(cfg: ScoreConfig | null): {
  dataType: string;
  rangeText: string;
} {
  if (!cfg) return { dataType: "", rangeText: "" };
  const dataType = String(
    valueOf<string>(cfg, "dataType", "data_type") ?? "",
  );
  if (dataType === "numeric") {
    const range: any =
      valueOf<any>(cfg, "numericRange", "numeric_range") ?? {};
    if (range && range.min != null && range.max != null) {
      return { dataType, rangeText: `${range.min}–${range.max}` };
    }
    return { dataType, rangeText: "" };
  }
  if (dataType === "categorical") {
    const cats: string[] = Array.isArray((cfg as any).categories)
      ? (cfg as any).categories
      : [];
    const text =
      cats.length > 0
        ? cats.length <= 3
          ? cats.join(" · ")
          : `${cats.slice(0, 3).join(" · ")} +${cats.length - 3}`
        : "";
    return { dataType, rangeText: text };
  }
  if (dataType === "boolean") {
    return { dataType, rangeText: "true / false" };
  }
  return { dataType, rangeText: "" };
}

const resolvedScorers = computed<ResolvedScorer[]>(() => {
  if (!Array.isArray(props.row.scorers)) return [];
  return props.row.scorers.map((ref): ResolvedScorer => {
    const refId = typeof ref === "string" ? ref : ref?.id ?? "";
    const refVersion = typeof ref === "object" ? ref?.version ?? null : null;
    const found = props.scorers.find((s) => entityId(s) === refId);
    if (!found) {
      return {
        id: refId,
        name: refId || t("onlineEvals.job.detail.scorerUnknown"),
        version: refVersion ?? 0,
        scoreConfigName: "",
        scoreConfigDataType: "",
        scoreConfigRangeText: "",
        scorerType: "unknown",
        scorerTypeLabel: "",
      };
    }
    const cfgId = valueOf<string>(
      found,
      "producesScoreConfigId",
      "produces_score_config_id",
    );
    const cfg = cfgId
      ? props.scoreConfigs.find((c) => entityId(c) === cfgId) ?? null
      : null;
    const cfgMeta = describeScoreConfig(cfg);
    const rawType =
      valueOf<string>(found, "scorerType", "scorer_type") ?? "llm_judge";
    const scorerType: ResolvedScorer["scorerType"] =
      rawType === "remote" ? "remote" : "llm_judge";
    return {
      // Use the resolved scorer's stable entity_id so downstream lookups
      // (findScorerById, onScorerClick) consistently match against
      // `entityId(s)`. Using the raw `found.id` here breaks when entity_id
      // differs from id (the common case for versioned rows).
      id: entityId(found),
      name: found.name,
      version: refVersion ?? found.version,
      scoreConfigName: cfg?.name ?? "",
      scoreConfigDataType: cfgMeta.dataType,
      scoreConfigRangeText: cfgMeta.rangeText,
      scorerType,
      scorerTypeLabel:
        scorerType === "remote"
          ? t("onlineEvals.job.detail.scorerTypeRemote")
          : t("onlineEvals.job.detail.scorerTypeLlmJudge"),
    };
  });
});

// `_evaluator.attributes_scorer_id` stores the per-version row `id`, not
// `entity_id`. Match on `s.id` so the lookup actually resolves.
function scorerNameFor(refId: string): string {
  if (!refId) return t("onlineEvals.job.detail.runs.scorerUnknown");
  const found = props.scorers.find((s) => String(s.id) === refId);
  return found?.name ?? refId;
}

function findScorerById(refId: string): Scorer | null {
  return props.scorers.find((s) => String(s.id) === refId) ?? null;
}

function onScorerClick(refId: string) {
  const scorer = findScorerById(refId);
  if (scorer) emit("view-scorer", scorer);
}

const pipelineId = computed<string>(
  () => valueOf<string>(props.row, "pipelineId", "pipeline_id") ?? "",
);

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

// — Tabs — no badge counts on Runs / Failures (the KPI strip already shows
// these numbers at the top of every tab in eval job list).
const tabs = computed(() => [
  {
    id: "configuration" as TabId,
    label: t("onlineEvals.job.detail.tabs.configuration"),
    count: null as number | null,
  },
  {
    id: "runs" as TabId,
    label: t("onlineEvals.job.detail.tabs.runs"),
    count: null as number | null,
  },
  {
    id: "failures" as TabId,
    label: t("onlineEvals.job.detail.tabs.failures"),
    count: null as number | null,
  },
]);

// — Runs / Failures window — backed by DateTimePickerDashboard.
const dateTimePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const selectedDate = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
});

const dateWindow = ref<JobRunsWindow>({
  startUs: (Date.now() - 24 * 60 * 60 * 1000) * 1000,
  endUs: Date.now() * 1000,
});

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

// The DateTimePicker emits `update:modelValue` on apply; sync the resolved
// window on every change so the queries refire.
watch(selectedDate, () => syncDateWindow(), { deep: true });

const tableEnabled = computed(
  () => activeTab.value === "runs" || activeTab.value === "failures",
);
const jobIdRef = computed(() => String(props.row.id ?? ""));

const {
  kpis,
  runs,
  failuresByScorer,
  isLoading: isLoadingRuns,
  refresh: refreshRunsData,
} = useEvalJobRuns(jobIdRef, dateWindow, tableEnabled);

async function refreshRuns() {
  syncDateWindow();
  await refreshRunsData();
}

const failedRuns = computed(() =>
  runs.value.filter((r) => r.status === "error" || r.status === "timeout"),
);

const failureRows = computed(() => failuresByScorer.value.filter((r) => r.failures > 0));

// — KPI tone —
const successRateTone = computed(() => {
  const r = kpis.value.successRate;
  if (r == null) return "";
  if (r >= 95) return "jd-kpi--good";
  if (r >= 80) return "jd-kpi--warn";
  return "jd-kpi--bad";
});

function failTone(rate: number): string {
  if (rate >= 20) return "jd-status-cell--bad";
  if (rate >= 5) return "jd-status-cell--warn";
  return "";
}

// — OTable column definitions —
const runColumns = computed(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.job.detail.runs.col.time"),
    accessorKey: "timestampMs",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "scorerId",
    header: t("onlineEvals.job.detail.runs.col.scorer"),
    accessorKey: "scorerId",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "target",
    header: t("onlineEvals.job.detail.runs.col.target"),
    sortable: false,
    size: 360,
    meta: { align: "left" },
  },
  {
    id: "scoreDisplay",
    header: t("onlineEvals.job.detail.runs.col.score"),
    accessorKey: "scoreDisplay",
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "latencyMs",
    header: t("onlineEvals.job.detail.runs.col.latency"),
    accessorKey: "latencyMs",
    sortable: true,
    size: 110,
    meta: { align: "right" },
  },
  {
    id: "status",
    header: t("onlineEvals.job.detail.runs.col.status"),
    accessorKey: "status",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
]);

const failureByScorerColumns = computed(() => [
  {
    id: "scorerId",
    header: t("onlineEvals.job.detail.failures.col.scorer"),
    accessorKey: "scorerId",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "failureRate",
    header: t("onlineEvals.job.detail.failures.col.failureRate"),
    accessorKey: "failureRate",
    sortable: true,
    size: 130,
    meta: { align: "right" },
  },
  {
    id: "failures",
    header: t("onlineEvals.job.detail.failures.col.count"),
    accessorKey: "failures",
    sortable: true,
    size: 140,
    meta: { align: "right" },
  },
]);

// — Helpers —
function formatTimestamp(microsOrMs: number): string {
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatPercent(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0 || !Number.isFinite(diff)) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
</script>

<style lang="scss" scoped>
.jd-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1010;
  display: flex;
  justify-content: flex-end;
  animation: jd-fade 0.18s ease-out;
}

@keyframes jd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.jd {
  width: 1100px;
  max-width: 96vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: jd-slide 0.22s ease-out;
}

@keyframes jd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* — Header — */
.jd__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.jd__header-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.jd__eyebrow {
  font: 600 11px/1.4 var(--o2-font);
  letter-spacing: 0.02em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.jd__title {
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.005em;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jd__title-version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.jd__status-pill {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  text-transform: capitalize;
}

.jd__status-pill--active {
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 14%, transparent);
  color: var(--o2-status-success-text, #2e7d32);
}

.jd__status-pill--paused {
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #b45309;
}

.jd__status-pill--degraded {
  background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 14%, transparent);
  color: var(--o2-status-error-text, #c62828);
}

.jd__status-pill--archived {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.7;
}

.jd__sub-line {
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd__close {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

/* — KPI strip — */
.jd__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 20px;
  background: color-mix(in srgb, var(--color-text-secondary) 4%, var(--color-card-bg));
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  flex-shrink: 0;
}

.jd-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.jd-kpi--good { background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 4%, var(--color-card-bg)); }
.jd-kpi--warn { background: color-mix(in srgb, #f59e0b 5%, var(--color-card-bg)); }
.jd-kpi--bad  { background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 4%, var(--color-card-bg)); }

.jd-kpi__title {
  font: 600 11px/1.4 var(--o2-font);
  letter-spacing: 0.01em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-kpi__value {
  font: 700 22px/1.1 var(--o2-font);
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary, currentColor);
}

.jd-kpi--good .jd-kpi__value { color: var(--o2-status-success-text, #2e7d32); }
.jd-kpi--warn .jd-kpi__value { color: #b45309; }
.jd-kpi--bad  .jd-kpi__value { color: var(--o2-status-error-text, #c62828); }

.jd-kpi__sub {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Tab strip — */
.jd__tabs {
  display: flex;
  gap: 18px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.jd__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font: 600 13px var(--o2-font);
  margin-bottom: -1px;
}

.jd__tab:hover { color: var(--color-text-primary, currentColor); }

.jd__tab--active {
  color: var(--color-primary-600, #3F7994);
  border-bottom-color: var(--color-primary-600, #3F7994);
}

.jd__tab-count {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  min-width: 18px;
  height: 16px;
  border-radius: 999px;
  font: 600 10px/1 var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  justify-content: center;
}

.jd__tab--active .jd__tab-count {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
  color: var(--color-primary-600, #3F7994);
}

/* — Body — */
.jd__body {
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  background: var(--color-card-bg);
}

/* — Configuration sections — */
.jd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.jd-section__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 3px;
  font: 600 10px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-kv {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 6px 14px;
  margin: 0;
}

.jd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
  word-break: break-word;
}

.jd-mono {
  font-variant-numeric: tabular-nums;
}

.jd-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.jd-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-filter {
  margin: 0;
  padding: 12px 14px;
  background: color-mix(in srgb, #6b76e3 6%, var(--color-card-bg));
  border: 1px solid color-mix(in srgb, #6b76e3 22%, transparent);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.85;
  color: var(--color-text-primary, currentColor);
  max-height: 240px;
  overflow: auto;
  white-space: pre;
}

.jd-filter__row {
  display: block;
  white-space: pre;
}

.jd-filter__kw {
  display: inline-block;
  width: 38px;
  margin-right: 8px;
  color: #7c3aed;
  font-weight: 700;
}

.jd-filter__col {
  color: #1d4ed8;
  margin-right: 6px;
}

.jd-filter__op {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-right: 6px;
}

.jd-filter__val {
  color: var(--color-text-primary, currentColor);
}

.jd-filter__val--str {
  color: #b25400;
}

.jd-scorers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.jd-scorers__card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--color-card-bg);
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s,
    transform 0.15s;
}

.jd-scorers__card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 45%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
  box-shadow: 0 1px 3px color-mix(in srgb, var(--color-primary-600, #3F7994) 12%, transparent);
  transform: translateY(-1px);
}

.jd-scorers__card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.jd-scorers__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.jd-scorers__icon--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.jd-scorers__icon--unknown {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.jd-scorers__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.jd-scorers__name {
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text-primary, currentColor);
}

.jd-scorers__type {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 10px/1.5 var(--o2-font);
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.jd-scorers__type--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.jd-scorers__version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.jd-scorers__produces {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  flex-wrap: wrap;
}

.jd-scorers__produces-icon {
  flex-shrink: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.7;
}

.jd-scorers__produces-prefix {
  font-weight: 500;
}

.jd-scorers__produces-name {
  color: var(--color-text-primary, currentColor);
  font-weight: 700;
}

.jd-scorers__produces-type,
.jd-scorers__produces-range {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-scorers__sep {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.5;
}

.jd-scorers__cta {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font: 600 11px var(--o2-font);
}

.jd-scorers__cta-label {
  opacity: 0;
  transition: opacity 0.15s;
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta {
  color: var(--color-primary-600, #3F7994);
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta-label {
  opacity: 1;
}

.jd-scorers__chevron {
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s, transform 0.15s;
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__chevron {
  opacity: 1;
  transform: translateX(2px);
}


/* — Runs / Failures tabs — */
.jd__runs-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.jd__date-picker {
  flex: 0 0 auto;
}

.jd__runs-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd__runs-meta strong {
  color: var(--color-text-primary, currentColor);
  font-variant-numeric: tabular-nums;
}

.jd-muted-text {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-target-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.jd-target-cell__line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  min-width: 0;
}

.jd-target-cell__label {
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-target-cell__id {
  font-size: 11.5px;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.jd-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-status-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-secondary, var(--o2-text-secondary));
}

.jd-status-cell--success { color: var(--o2-status-success-text, #2e7d32); }
.jd-status-cell--success .jd-status-cell__dot { background: var(--o2-status-success-text, #2e7d32); }

.jd-status-cell--error,
.jd-status-cell--timeout { color: var(--o2-status-error-text, #c62828); }
.jd-status-cell--error .jd-status-cell__dot,
.jd-status-cell--timeout .jd-status-cell__dot { background: var(--o2-status-error-text, #c62828); }

.jd-status-cell--skipped .jd-status-cell__dot {
  background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}

.jd-status-cell--warn { color: #b45309; }
.jd-status-cell--bad { color: var(--o2-status-error-text, #c62828); }
</style>
