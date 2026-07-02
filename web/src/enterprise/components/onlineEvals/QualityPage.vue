<template>
  <div class="quality-page" data-test="quality-page">
    <!-- Agent filter — right-aligned at the top of the content container so it
         sits with the KPIs + table it scopes (matches LLM Insights). -->
    <div class="tw:flex tw:items-center tw:justify-end tw:px-4">
      <div class="tw:w-[14rem] tw:flex-shrink-0">
        <!-- While the agent list is loading we swap the select for a skeleton
             of the same height so the control reads as "loading" (and can't be
             opened on an empty list) instead of showing an empty dropdown. -->
        <SkeletonBox
          v-if="agentsLoading"
          width="100%"
          height="2.125rem"
          rounded
          data-test="quality-agent-filter-skeleton"
        />
        <OSelect
          v-else
          v-model="agentModel"
          label="Agent"
          label-position="inside"
          :options="agentOptions || []"
          labelKey="label"
          valueKey="value"
          class="tw:rounded"
          data-test="quality-agent-filter"
        />
      </div>
    </div>

    <QualityKpiSkeleton
      v-if="showKpiSkeleton"
      :count="visibleKpis.length"
      class="tw:px-4"
    />
    <section v-else class="quality-page__kpis tw:px-4" aria-label="Tier 1 KPIs">
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
        :is-loading="isConfigsLoading || !!configsLoading || !!agentsLoading"
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
          >v{{ selectedConfig.version }}</span
        >
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
        @back="clearSelection"
      />
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import type { AgentFilterSelection } from "./utils/agentFilterSql";

const props = defineProps<{
  scoreConfigs: ScoreConfig[];
  // Date window is owned by OnlineEvals (so the picker + refresh button live
  // in the embedded AppPageHeader). Quality just consumes it as a reactive
  // input to its data loaders.
  dateWindow: DateWindow;
  agentFilter?: AgentFilterSelection | null;
  // Agent filter dropdown — state stays in OnlineEvals (it owns the agent
  // list + derives `agentFilter`); QualityPage just renders the control and
  // emits the selected key back via v-model.
  agentKey?: string;
  agentOptions?: { label: string; value: string }[];
  // True while OnlineEvals is still fetching the score-configs list. Until that
  // resolves `scoreConfigs` is empty, so the table would otherwise flash "No
  // Data" before its own skeleton kicks in. OR-ing this into the table's
  // loading flag keeps the skeleton up from the very first paint.
  configsLoading?: boolean;
  // True during the agent-list fetch (first phase of the parent's reload).
  // Drives the agent-dropdown skeleton plus the KPI/table skeletons so the
  // whole page reads as "loading" from the start of a reload, not just once
  // the data queries begin.
  agentsLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:agentKey", value: string): void;
  // Fired once after mount so the parent can run the agents-first reload. The
  // parent owns every reload trigger (mount / refresh / date / agent) — this
  // page no longer self-loads on mount or on prop changes.
  (e: "ready"): void;
}>();

const agentModel = computed<string>({
  get: () => props.agentKey ?? "",
  set: (value) => emit("update:agentKey", value),
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const dateWindowRef = toRef(props, "dateWindow");
const agentFilterRef = toRef(props, "agentFilter");

const { isLoading, kpis, deltaByKpi, refresh } = useQualityData(
  dateWindowRef,
  agentFilterRef,
);

// Evaluation cost is intentionally hidden until the backend writes cost data.
// To restore it, remove this filter and re-add `kpis` to the v-for.
// Now that `gen_ai_usage_cost` on `_evaluator` is populated, the
// Evaluation Cost card is sourced live (see useQualityData) — no longer
// hidden. Keep the set in place so future placeholder KPIs can be
// hidden the same way without touching the render loop.
const HIDDEN_KPI_IDS = new Set<string>();
const visibleKpis = computed(() =>
  kpis.value.filter((k) => !HIDDEN_KPI_IDS.has(k.id)),
);

const scoreConfigsRef = toRef(props, "scoreConfigs");
const {
  rows: configRows,
  isLoading: isConfigsLoading,
  refresh: refreshConfigs,
} = useQualityScoreConfigs(scoreConfigsRef, dateWindowRef, agentFilterRef);

const selectedConfigId = ref<string | null>(routeConfigId());

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
} = useQualityConfigDetail(selectedConfig, dateWindowRef, agentFilterRef);

const {
  isLoading: isChartsLoading,
  numericTrend,
  numericDistribution,
  booleanTrend,
  booleanTrendSeries,
  refresh: refreshCharts,
} = useQualityDetailCharts(selectedConfig, dateWindowRef, agentFilterRef);

const numericThreshold = computed(() => {
  const cfg = selectedConfig.value;
  if (!cfg) return null;
  const ht: any =
    (cfg as any).healthyThreshold ?? (cfg as any).healthy_threshold;
  if (!ht || ht.value == null || !ht.direction) return null;
  return {
    value: Number(ht.value),
    direction: ht.direction === "gte" ? "gte" : "lte",
  } as const;
});

const numericRange = computed(() => {
  const cfg = selectedConfig.value;
  if (!cfg) return null;
  const r: any = (cfg as any).numericRange ?? (cfg as any).numeric_range;
  if (!r || r.min == null || r.max == null) return null;
  return { min: Number(r.min), max: Number(r.max) };
});

async function refreshAll() {
  await Promise.all([
    refresh(),
    refreshConfigs(),
    refreshDetail(),
    refreshCharts(),
  ]);
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

/** Show the KPI skeleton whenever the KPI queries are running — on the initial
 * load AND on every refresh — matching the rest of the app (e.g. LLM Insights),
 * so a refresh gives clear feedback instead of leaving the cards frozen. Also
 * shown during the agent-list fetch (the phase before the KPI query starts) so
 * the page reads as loading from the very start of a reload. */
const showKpiSkeleton = computed(() => isLoading.value || !!props.agentsLoading);

// The parent (OnlineEvals) owns every reload trigger — mount, refresh button,
// date-time change, and agent change — and calls `refreshAll()` / `refreshConfigs()`
// via the exposed handle. This page only signals readiness; it does NOT watch
// `dateWindow`/`agentFilter` (doing so re-introduced the duplicate fetches that
// fired once from here and again from the parent's reload).
onMounted(() => {
  emit("ready");
});

// The score-configs list arrives asynchronously from the parent's `loadAll()`,
// often AFTER the initial reload has run against an empty list. Re-run just the
// table aggregate when it lands so the rows populate.
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
  const query: Record<string, any> = {
    ...route.query,
    config: selectedConfigId.value,
  };
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
  // Horizontal padding lives on the individual children (agent filter + KPIs)
  // rather than the container, so the score-configs table can sit full-bleed
  // against the content edges. No bottom padding: the table is the flex:1 child
  // and must reach the bottom edge, otherwise the bottom padding shows as dead
  // space under the table's pagination bar.
  padding: 14px 0 0;
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
