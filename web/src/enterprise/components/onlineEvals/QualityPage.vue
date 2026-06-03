<template>
  <div class="quality-page" data-test="quality-page">
    <div class="quality-page__scope-row">
      <span class="quality-page__scope-label">{{ t("onlineEvals.quality.scopeLabel") }}</span>
      <div class="quality-page__controls">
        <DateTimePickerDashboard
          ref="dateTimePickerRef"
          v-model="selectedDate"
          :auto-apply-dashboard="true"
          class="quality-page__date-picker"
          data-test="quality-time-range-picker"
        />
        <OSelect
          v-model="sourceStream"
          :options="sourceStreamOptions"
          size="md"
          class="quality-page__select"
          data-test="quality-source-stream-select"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isLoading || isConfigsLoading || isDetailLoading || isChartsLoading"
          :title="t('onlineEvals.quality.refresh')"
          data-test="quality-refresh-btn"
          @click="refreshAll"
        />
      </div>
    </div>

    <QualityKpiSkeleton
      v-if="!selectedConfig && showKpiSkeleton"
      :count="visibleKpis.length"
    />
    <section v-else-if="!selectedConfig" class="quality-page__kpis" aria-label="Tier 1 KPIs">
      <QualityKpiCard
        v-for="kpi in visibleKpis"
        :key="kpi.id"
        :kpi="kpi"
        :delta="deltaByKpi[kpi.id] ?? null"
      />
    </section>

    <div class="quality-page__tier2" :class="{ 'quality-page__tier2--split': !!selectedConfig }">
      <QualityScoreConfigsTable
        v-if="!selectedConfig"
        :rows="configRows"
        :is-loading="isConfigsLoading"
        @select="selectConfig"
        @refresh="refreshAll"
      />

      <QualityConfigSidebar
        v-else
        :rows="configRows"
        :selected-id="selectedConfigId"
        @select="selectConfig"
        @clear="clearSelection"
      />

      <QualityDetailPanel
        v-if="selectedConfig"
        :config="selectedConfig"
        :data-type="detailDataType"
        :kpis="detailKpis"
        :is-loading="isDetailLoading"
        :numeric-trend="numericTrend"
        :numeric-distribution="numericDistribution"
        :numeric-threshold="numericThreshold"
        :numeric-range="numericRange"
        :boolean-agg="booleanAgg"
        :boolean-trend="booleanTrend"
        :boolean-trend-series="booleanTrendSeries"
        :categorical-rows="categoricalRows"
        :split-by-scorer="splitByScorer"
        :split-by-source-type="splitBySourceType"
        @update:split-by-scorer="splitByScorer = $event"
        @update:split-by-source-type="splitBySourceType = $event"
        @back="clearSelection"
        @drill="onDrill"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import { useQualityData, type DateWindow } from "./composables/useQualityData";
import {
  useQualityScoreConfigs,
  type ScoreConfigRow,
} from "./composables/useQualityScoreConfigs";
import { useQualityConfigDetail } from "./composables/useQualityConfigDetail";
import { useQualityDetailCharts } from "./composables/useQualityDetailCharts";
import QualityKpiCard from "./quality/QualityKpiCard.vue";
import QualityKpiSkeleton from "./quality/QualityKpiSkeleton.vue";
import QualityScoreConfigsTable from "./quality/QualityScoreConfigsTable.vue";
import QualityConfigSidebar from "./quality/QualityConfigSidebar.vue";
import QualityDetailPanel from "./quality/QualityDetailPanel.vue";

const props = defineProps<{
  scoreConfigs: ScoreConfig[];
}>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

// Time-range picker state — mirrors LLM Insights / Metrics pattern.
// Persisted in localStorage so navigating away from Quality and coming back
// keeps the user's selection (same approach LLM Insights uses for stream).
const DATE_LS_KEY = "evaluations:quality:dateRange";

interface PersistedDate {
  valueType: "relative" | "absolute";
  startTime: number | null;
  endTime: number | null;
  relativeTimePeriod: string | null;
}

function loadPersistedDate(): PersistedDate {
  const defaults: PersistedDate = {
    valueType: "relative",
    startTime: null,
    endTime: null,
    relativeTimePeriod: "7d",
  };
  try {
    const raw = localStorage.getItem(DATE_LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      valueType: parsed.valueType === "absolute" ? "absolute" : "relative",
      startTime: typeof parsed.startTime === "number" ? parsed.startTime : null,
      endTime: typeof parsed.endTime === "number" ? parsed.endTime : null,
      relativeTimePeriod:
        typeof parsed.relativeTimePeriod === "string" ? parsed.relativeTimePeriod : "7d",
    };
  } catch {
    return defaults;
  }
}

const dateTimePickerRef = ref<{ getConsumableDateTime: () => { startTime: number; endTime: number } } | null>(null);
const selectedDate = ref<any>(loadPersistedDate());
const dateWindow = ref<DateWindow>({
  startUs: (Date.now() - 7 * 24 * 60 * 60 * 1000) * 1000,
  endUs: Date.now() * 1000,
});

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  // DateTime.getConsumableDateTime returns startTime/endTime in microseconds.
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

const { sourceStream, isLoading, kpis, deltaByKpi, refresh } = useQualityData(dateWindow);

// Evaluation cost is intentionally hidden until the backend writes cost data.
// To restore it, remove this filter and re-add `kpis` to the v-for.
const HIDDEN_KPI_IDS = new Set(["evaluationCost"]);
const visibleKpis = computed(() => kpis.value.filter((k) => !HIDDEN_KPI_IDS.has(k.id)));

const scoreConfigsRef = toRef(props, "scoreConfigs");
const {
  rows: configRows,
  isLoading: isConfigsLoading,
  refresh: refreshConfigs,
} = useQualityScoreConfigs(scoreConfigsRef, dateWindow);

const selectedConfigId = ref<string | null>(routeConfigId());
const splitByScorer = ref(false);
const splitBySourceType = ref(false);

const selectedConfig = computed<ScoreConfig | null>(() => {
  const id = selectedConfigId.value;
  if (!id) return null;
  return props.scoreConfigs.find((c) => String(c.id) === id) ?? null;
});

const {
  isLoading: isDetailLoading,
  dataType: detailDataType,
  kpis: detailKpis,
  booleanAgg,
  categoricalRows,
  refresh: refreshDetail,
} = useQualityConfigDetail(selectedConfig, dateWindow);

const {
  isLoading: isChartsLoading,
  numericTrend,
  numericDistribution,
  booleanTrend,
  booleanTrendSeries,
  refresh: refreshCharts,
} = useQualityDetailCharts(selectedConfig, dateWindow, splitByScorer, splitBySourceType);

const numericThreshold = computed(() => {
  const cfg = selectedConfig.value;
  if (!cfg) return null;
  const ht: any = (cfg as any).healthyThreshold ?? (cfg as any).healthy_threshold;
  if (!ht || ht.value == null || !ht.direction) return null;
  return { value: Number(ht.value), direction: ht.direction === "gte" ? "gte" : "lte" } as const;
});

const numericRange = computed(() => {
  const cfg = selectedConfig.value;
  if (!cfg) return null;
  const r: any = (cfg as any).numericRange ?? (cfg as any).numeric_range;
  if (!r || r.min == null || r.max == null) return null;
  return { min: Number(r.min), max: Number(r.max) };
});

async function refreshAll() {
  syncDateWindow();
  await Promise.all([refresh(), refreshConfigs(), refreshDetail(), refreshCharts()]);
}

/** Show the skeleton only on the *initial* load — i.e. when we're loading AND
 * no KPI values have been populated yet. Subsequent refreshes keep the rendered
 * cards visible (with their previous values + a subtle refresh spinner). */
const showKpiSkeleton = computed(
  () => isLoading.value && kpis.value.every((k) => k.value == null),
);

onMounted(() => {
  void refreshAll();
});

watch(
  selectedDate,
  (next) => {
    try {
      localStorage.setItem(DATE_LS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
    syncDateWindow();
    void refreshAll();
  },
  { deep: true },
);

watch(scoreConfigsRef, () => {
  void refreshConfigs();
});

// URL ↔ selection
function routeConfigId(): string | null {
  const v = route.query.config;
  return typeof v === "string" && v.length > 0 ? v : null;
}

watch(
  () => route.query.config,
  () => {
    const id = routeConfigId();
    if (id !== selectedConfigId.value) selectedConfigId.value = id;
  },
);

function selectConfig(row: ScoreConfigRow) {
  selectedConfigId.value = String(row.config.id);
  const query: Record<string, any> = { ...route.query, config: selectedConfigId.value };
  router.push({ name: route.name as string, query }).catch(() => {});
}

function clearSelection() {
  selectedConfigId.value = null;
  const query: Record<string, any> = { ...route.query };
  delete query.config;
  router.replace({ name: route.name as string, query }).catch(() => {});
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** Build the unhealthy SQL fragment that matches the config's `healthy_threshold`. */
function unhealthySqlFor(config: ScoreConfig): string | null {
  const ht: any = (config as any).healthyThreshold ?? (config as any).healthy_threshold;
  const type = (config as any).dataType ?? (config as any).data_type;
  if (!ht) return null;
  if (type === "numeric") {
    if (ht.value == null || !ht.direction) return null;
    const op = ht.direction === "gte" ? "<" : ">";
    return `value_numeric ${op} ${Number(ht.value)}`;
  }
  if (type === "categorical") {
    const list: string[] = ht.healthy_categories || ht.healthyCategories || [];
    if (!Array.isArray(list) || list.length === 0) return null;
    const inList = list.map((c) => `'${escapeSqlString(String(c))}'`).join(", ");
    return `value_categorical NOT IN (${inList})`;
  }
  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    if (healthy == null) return null;
    const expected = healthy === true || healthy === "true";
    return `value_boolean = ${!expected}`;
  }
  return null;
}

const orgIdForDrill = computed<string>(
  () => store.state.selectedOrganization?.identifier ?? "default",
);

function onDrill(kpiId: string) {
  const cfg = selectedConfig.value;
  if (!cfg) return;

  const configId = escapeSqlString(String(cfg.id));
  const baseWhere = `CAST(score_config_id AS VARCHAR) = '${configId}'`;
  const unhealthyExpr = unhealthySqlFor(cfg);

  let whereClause = baseWhere;
  if (kpiId === "unhealthy" && unhealthyExpr) {
    whereClause = `${baseWhere} AND (${unhealthyExpr})`;
  } else if (kpiId === "healthy" && unhealthyExpr) {
    whereClause = `${baseWhere} AND NOT (${unhealthyExpr})`;
  }

  const sql = `SELECT * FROM "_llm_scores" WHERE ${whereClause}`;
  // Same encoder the rest of the app uses (see O2AIChat.vue).
  const encoded = btoa(unescape(encodeURIComponent(sql)));

  // Pass the absolute window as `from`/`to` (microseconds) so the Logs page
  // reproduces exactly the same Quality window the user was looking at.
  const queryParams: Record<string, string> = {
    org_identifier: orgIdForDrill.value,
    stream: "_llm_scores",
    stream_type: "logs",
    sql_mode: "true",
    quick_mode: "false",
    show_histogram: "true",
    refresh: "0",
    from: String(dateWindow.value.startUs),
    to: String(dateWindow.value.endUs),
    query: encoded,
    type: "ai_chat_query",
  };

  router.push({ name: "logs", query: queryParams }).catch(() => {});
}

const sourceStreamOptions = computed(() => [
  { value: "__all__", label: t("onlineEvals.quality.sourceStream.all") },
]);
</script>

<style lang="scss" scoped>
.quality-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px 18px;
  min-height: 0;
  flex: 1;
}

.quality-page__scope-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.quality-page__scope-label {
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
  flex: 1 1 auto;
  min-width: 0;
}

.quality-page__controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.quality-page__select {
  width: 180px;
  flex: 0 0 180px;
}

.quality-page__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.quality-page__tier2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.quality-page__tier2--split {
  grid-template-columns: 300px minmax(0, 1fr);
}

@media (max-width: 1280px) {
  .quality-page__tier2--split {
    grid-template-columns: 260px minmax(0, 1fr);
  }
}

@media (max-width: 960px) {
  .quality-page__tier2--split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
