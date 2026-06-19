<template>
  <div class="quality-page" data-test="quality-page">
    <QualityKpiSkeleton
      v-if="showKpiSkeleton"
      :count="visibleKpis.length"
    />
    <section v-else class="quality-page__kpis" aria-label="Tier 1 KPIs">
      <QualityKpiCard
        v-for="kpi in visibleKpis"
        :key="kpi.id"
        :kpi="kpi"
        :delta="deltaByKpi[kpi.id] ?? null"
      />
    </section>

    <!-- Tier 2: the configs table is now the persistent view; selecting a
         row opens the detail in a right-side ODrawer (70% width) instead
         of replacing the whole page. The user keeps full context of the
         list behind the drawer. -->
    <div class="quality-page__tier2">
      <QualityScoreConfigsTable
        :rows="configRows"
        :is-loading="isConfigsLoading"
        @select="selectConfig"
        @refresh="refreshAll"
      />
    </div>

    <ODrawer
      v-model:open="detailDrawerOpen"
      side="right"
      :width="70"
      :title="selectedConfig?.name || ''"
      data-test="quality-config-detail-drawer"
    >
      <!-- Type badge + version pulled out of the inner panel header so
           the drawer chrome owns the entire identification block;
           the inner panel no longer renders its own title row. -->
      <template #header-right>
        <span
          class="qpd-type"
          :class="`qpd-type--${detailDataType}`"
          data-test="quality-detail-type-badge"
        >
          {{ shortType(detailDataType) }}
        </span>
        <span
          v-if="selectedConfig?.version"
          class="qpd-version"
          data-test="quality-detail-version-badge"
        >v{{ selectedConfig.version }}</span>
      </template>

      <QualityDetailPanel
        v-if="selectedConfig"
        :config="selectedConfig"
        :data-type="detailDataType"
        :kpis="detailKpis"
        :has-scores="detailHasScores"
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
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
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
import QualityDetailPanel from "./quality/QualityDetailPanel.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

const props = defineProps<{
  scoreConfigs: ScoreConfig[];
  // Date window is owned by OnlineEvals (so the picker + refresh button live
  // in the embedded AppPageHeader). Quality just consumes it as a reactive
  // input to its data loaders.
  dateWindow: DateWindow;
}>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const dateWindowRef = toRef(props, "dateWindow");

// `sourceStream` is intentionally not destructured — the composable keeps its
// internal default ("__all__"), which is correct now that the UI selector is
// hidden and we only have one score sink (`_llm_scores`).
const { isLoading, kpis, deltaByKpi, refresh } = useQualityData(dateWindowRef);

// Evaluation cost is intentionally hidden until the backend writes cost data.
// To restore it, remove this filter and re-add `kpis` to the v-for.
// Now that `gen_ai_usage_cost` on `_evaluator` is populated, the
// Evaluation Cost card is sourced live (see useQualityData) — no longer
// hidden. Keep the set in place so future placeholder KPIs can be
// hidden the same way without touching the render loop.
const HIDDEN_KPI_IDS = new Set<string>();
const visibleKpis = computed(() => kpis.value.filter((k) => !HIDDEN_KPI_IDS.has(k.id)));

const scoreConfigsRef = toRef(props, "scoreConfigs");
const {
  rows: configRows,
  isLoading: isConfigsLoading,
  refresh: refreshConfigs,
} = useQualityScoreConfigs(scoreConfigsRef, dateWindowRef);

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
  hasScores: detailHasScores,
  booleanAgg,
  categoricalRows,
  refresh: refreshDetail,
} = useQualityConfigDetail(selectedConfig, dateWindowRef);

const {
  isLoading: isChartsLoading,
  numericTrend,
  numericDistribution,
  booleanTrend,
  booleanTrendSeries,
  refresh: refreshCharts,
} = useQualityDetailCharts(selectedConfig, dateWindowRef, splitByScorer, splitBySourceType);

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
  await Promise.all([refresh(), refreshConfigs(), refreshDetail(), refreshCharts()]);
}

const isAnyLoading = computed(
  () =>
    isLoading.value ||
    isConfigsLoading.value ||
    isDetailLoading.value ||
    isChartsLoading.value,
);

// Surface refresh + an aggregated loading flag so OnlineEvals can drive the
// Refresh button it now renders in the embedded AppPageHeader actions slot.
defineExpose({ refreshAll, isAnyLoading });

/** Show the skeleton only on the *initial* load — i.e. when we're loading AND
 * no KPI values have been populated yet. Subsequent refreshes keep the rendered
 * cards visible (with their previous values + a subtle refresh spinner). */
const showKpiSkeleton = computed(
  () => isLoading.value && kpis.value.every((k) => k.value == null),
);

onMounted(() => {
  void refreshAll();
});

// No deep flag: the parent (OnlineEvals) always assigns a fresh
// `{startUs,endUs}` object via `qualityDateWindow.value = …`, so the ref's
// identity changes and the top-level watch already fires. Deep traversal
// would just walk two numeric leaves on every change for no benefit.
watch(dateWindowRef, () => {
  void refreshAll();
});

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

// ODrawer drives its `:open` via the presence of a selected config. Opening
// is owned by selectConfig() (from a row click); closing the drawer
// (backdrop click, Esc, header ×) routes through clearSelection so the
// `?config=` query param drops in sync.
const detailDrawerOpen = computed<boolean>({
  get: () => selectedConfigId.value != null,
  set: (open) => {
    if (!open) clearSelection();
  },
});

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
    from: String(props.dateWindow.startUs),
    to: String(props.dateWindow.endUs),
    query: encoded,
    type: "ai_chat_query",
  };

  router.push({ name: "logs", query: queryParams }).catch(() => {});
}

// Used by the drawer header's #header-right slot — same mapping the
// detail panel used for its in-panel badge so type/version chrome looks
// identical, just relocated into the drawer header.
function shortType(type: string): string {
  if (type === "numeric") return "Num";
  if (type === "categorical") return "Cat";
  if (type === "boolean") return "Bool";
  return "—";
}
</script>

<style lang="scss" scoped>
// Type + version chrome relocated from QualityDetailPanel's `qdp__head`
// into the drawer header (#header-right). Visuals are kept identical to
// the previous in-panel pill so the move feels purely structural.
.qpd-type {
  display: inline-flex;
  padding: 0 4px;
  border-radius: 2px;
  font: 700 8px/1.4 inherit;
  letter-spacing: 0.02em;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qpd-type--numeric {
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qpd-type--categorical {
  background: color-mix(in srgb, #9333ea 14%, transparent);
  color: #7c3aed;
}

.qpd-type--boolean {
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #15803d;
}

.qpd-version {
  margin-left: 6px;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}
</style>

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
