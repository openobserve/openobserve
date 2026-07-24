<template>
  <div
    class="quality-page flex flex-col gap-3.5 pt-3.5 pb-4 min-h-0 flex-1"
    data-test="quality-page"
  >
    <!-- Agent filter — right-aligned at the top of the content container so it
         sits with the KPIs + table it scopes (matches LLM Insights). -->
    <div class="flex items-center justify-end px-page-edge">
      <div class="w-[17rem] flex-shrink-0">
        <!-- While the agent list is loading we swap the select for a skeleton
             of the same height so the control reads as "loading" (and can't be
             opened on an empty list) instead of showing an empty dropdown. -->
        <OSkeleton type="text" v-if="agentsLoading" data-test="quality-agent-filter-skeleton" class="w-full h-8.5" />
        <OSelect
          v-else
          v-model="agentModel"
          :label="t('onlineEvals.quality.agentLabel')"
          label-position="inside"
          :placeholder="t('onlineEvals.quality.agentPlaceholder')"
          :options="agentOptions || []"
          labelKey="label"
          valueKey="value"
          class="rounded-default"
          data-test="quality-agent-filter"
        />
      </div>
    </div>

    <QualityKpiSkeleton
      v-if="showKpiSkeleton"
      :count="visibleKpis.length"
      class="px-page-edge"
    />
    <KpiCardRow v-else class="quality-page__kpis px-page-edge" :aria-label="t('onlineEvals.quality.kpisAriaLabel')">
      <QualityKpiCard
        v-for="kpi in visibleKpis"
        :key="kpi.id"
        :kpi="kpi"
        :delta="deltaByKpi[kpi.id] ?? null"
      />
    </KpiCardRow>

    <!-- Tier 2: the configs table is the persistent view; selecting a
         row opens the detail in a right-side ODrawer (70% width). The user
         keeps full context of the list behind the drawer. -->
    <div class="quality-page__tier2 grid gap-3 min-h-0 flex-1"
      style="grid-template-columns: minmax(0, 1fr)"
    >
      <QualityScoreConfigsTable
        :rows="configRows"
        :is-loading="isConfigsLoading || !!configsLoading || !!agentsLoading"
        @select="selectConfig"
        @refresh="refreshAll"
      />
    </div>

    <ODrawer
      bleed
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
        <OTag
          v-if="detailDataType === 'numeric' || detailDataType === 'categorical' || detailDataType === 'boolean'"
          type="evalDataType"
          :value="detailDataType"
          :label="shortType(detailDataType)"
          size="xs"
          data-test="quality-detail-type-badge"
        />
        <span
          v-if="selectedConfig?.version"
          class="qpd-version ml-1.5 text-2xs text-text-secondary [font-variant-numeric:tabular-nums]"
          data-test="quality-detail-version-badge"
          >{{ t("onlineEvals.versionPrefix") }}{{ selectedConfig.version }}</span
        >
      </template>

      <QualityDetailPanel
        v-if="selectedConfig"
        :config="selectedConfig"
        :data-type="detailDataType"
        :kpis="detailKpis"
        :has-scores="detailHasScores"
        :is-loading="isDetailLoading || isChartsLoading"
        :numeric-trend="numericTrend"
        :numeric-distribution="numericDistribution"
        :numeric-threshold="numericThreshold"
        :numeric-range="numericRange"
        :boolean-agg="booleanAgg"
        :boolean-trend="booleanTrend"
        :boolean-trend-series="booleanTrendSeries"
        :categorical-rows="categoricalRows"
        :scope="detailScope"
        :scope-counts="selectedConfigScopeCounts"
        :runs="qualityRuns"
        :runs-counts="runsCounts"
        :runs-filter="runsFilter"
        :runs-current-page="runsCurrentPage"
        :runs-page-size="runsPageSize"
        :runs-total-count="runsTotalCount"
        :runs-loading="isRunsLoading"
        :runs-error="runsError"
        @update:scope="detailScope = $event"
        @open-run="openEvaluationRun"
        @runs-filter-change="setRunsFilter"
        @runs-pagination-change="setRunsPagination"
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
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import {
  useQualityRuns,
  type QualityRunRow,
} from "./composables/useQualityRuns";
import QualityKpiCard from "./quality/QualityKpiCard.vue";
import QualityKpiSkeleton from "./quality/QualityKpiSkeleton.vue";
import QualityScoreConfigsTable from "./quality/QualityScoreConfigsTable.vue";
import QualityDetailPanel from "./quality/QualityDetailPanel.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { AgentFilterSelection } from "./utils/agentFilterSql";
import type { QualityScope, ScopeCounts } from "./utils/qualityScope";

const props = defineProps<{
  scoreConfigs: ScoreConfig[];
  // Date window is owned by OnlineEvals (so the picker + refresh button live
  // in the embedded OPageHeader). Quality just consumes it as a reactive
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

// Placeholder KPIs can be hidden here without touching the render loop — add
// their ids to this set to filter them out of the v-for.
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
const detailScope = ref<QualityScope>("all");

const selectedConfig = computed<ScoreConfig | null>(() => {
  const id = selectedConfigId.value;
  if (!id) return null;
  return props.scoreConfigs.find((c) => String(c.id) === id) ?? null;
});

const EMPTY_SCOPE_COUNTS: ScopeCounts = { span: 0, trace: 0, session: 0 };
const selectedConfigScopeCounts = computed<ScopeCounts>(() => {
  const id = selectedConfigId.value;
  if (!id) return EMPTY_SCOPE_COUNTS;
  return (
    configRows.value.find(
      (row) => String(row.config.id) === id || String(row.configId) === id,
    )?.scopeCounts ?? EMPTY_SCOPE_COUNTS
  );
});

const {
  isLoading: isDetailLoading,
  dataType: detailDataType,
  kpis: detailKpis,
  hasScores: detailHasScores,
  booleanAgg,
  categoricalRows,
  refresh: refreshDetail,
} = useQualityConfigDetail(
  selectedConfig,
  dateWindowRef,
  agentFilterRef,
  detailScope,
);

const {
  isLoading: isChartsLoading,
  numericTrend,
  numericDistribution,
  booleanTrend,
  booleanTrendSeries,
  refresh: refreshCharts,
} = useQualityDetailCharts(
  selectedConfig,
  dateWindowRef,
  agentFilterRef,
  detailScope,
);

const {
  runs: qualityRuns,
  counts: runsCounts,
  activeFilter: runsFilter,
  currentPage: runsCurrentPage,
  pageSize: runsPageSize,
  totalCount: runsTotalCount,
  isLoading: isRunsLoading,
  error: runsError,
  refresh: refreshRuns,
  setFilter: setRunsFilter,
  setPagination: setRunsPagination,
  resolveEvaluatorSpanId,
} = useQualityRuns(selectedConfig, dateWindowRef, agentFilterRef, detailScope);

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
    refreshRuns(),
  ]);
}

const isAnyLoading = computed(
  () =>
    isLoading.value ||
    isConfigsLoading.value ||
    isDetailLoading.value ||
    isChartsLoading.value ||
    isRunsLoading.value,
);

// Surface refresh + an aggregated loading flag so OnlineEvals can drive the
// Refresh button it now renders in the embedded OPageHeader actions slot.
defineExpose({ refreshAll, isAnyLoading });

/** Show the KPI skeleton whenever the KPI queries are running — on the initial
 * load AND on every refresh — matching the rest of the app (e.g. LLM Insights),
 * so a refresh gives clear feedback instead of leaving the cards frozen. Also
 * shown during the agent-list fetch (the phase before the KPI query starts) so
 * the page reads as loading from the very start of a reload. */
const showKpiSkeleton = computed(
  () => isLoading.value || !!props.agentsLoading,
);

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
    if (id !== selectedConfigId.value) {
      detailScope.value = "all";
      selectedConfigId.value = id;
    }
  },
);

function selectConfig(row: ScoreConfigRow) {
  // Reset before changing the config so its composable watcher never runs a
  // request for the new config with the previous config's narrow scope.
  detailScope.value = "all";
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

async function openEvaluationRun(run: QualityRunRow) {
  if (!run.evaluatorTraceId) return;
  const evaluatorSpanId = await resolveEvaluatorSpanId(run);
  const timestampUs = run.timestampMs > 0 ? run.timestampMs * 1000 : 0;
  const query: Record<string, any> = {
    stream: "_evaluator",
    trace_id: run.evaluatorTraceId,
    from: timestampUs
      ? Math.max(0, timestampUs - 60_000_000)
      : props.dateWindow.startUs,
    to: timestampUs ? timestampUs + 3_600_000_000 : props.dateWindow.endUs,
    org_identifier: route.query.org_identifier,
  };
  if (evaluatorSpanId) query.span_id = evaluatorSpanId;
  router
    .push({
      name: "traceDetails",
      query,
    })
    .catch(() => {});
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
  if (type === "numeric")
    return t("onlineEvals.quality.dataTypes.numericShort");
  if (type === "categorical")
    return t("onlineEvals.quality.dataTypes.categoricalShort");
  if (type === "boolean")
    return t("onlineEvals.quality.dataTypes.booleanShort");
  return "—";
}
</script>
