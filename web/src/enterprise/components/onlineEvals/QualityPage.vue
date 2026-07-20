<template>
  <div
    class="quality-page flex flex-col gap-[14px] p-[14px_16px_18px] min-h-0 flex-1"
    data-test="quality-page"
  >
    <!-- Agent filter — right-aligned at the top of the content container so it
         sits with the KPIs + table it scopes (matches LLM Insights). -->
    <div class="flex items-center justify-end px-4">
      <div class="w-[17rem] flex-shrink-0">
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
          :placeholder="t('onlineEvals.quality.agentPlaceholder')"
          :options="agentOptions || []"
          labelKey="label"
          valueKey="value"
          class="rounded"
          data-test="quality-agent-filter"
        />
      </div>
    </div>

    <QualityKpiSkeleton
      v-if="showKpiSkeleton"
      :count="visibleKpis.length"
      class="px-4"
    />
    <section v-else class="quality-page__kpis grid gap-[10px] px-4" aria-label="Tier 1 KPIs"
      style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))"
    >
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
          class="qpd-type inline-flex py-0 px-1 rounded-[2px] font-bold text-[13px] leading-[1.4] tracking-[0.02em]"
          :class="{
            'bg-[color-mix(in_srgb,var(--color-indigo-500)_14%,transparent)] text-[var(--color-indigo-700)]': detailDataType === 'numeric',
            'bg-[color-mix(in_srgb,var(--color-purple-600)_14%,transparent)] text-[var(--color-purple-700)]': detailDataType === 'categorical',
            'bg-[color-mix(in_srgb,var(--color-success-600)_14%,transparent)] text-[var(--color-success-700)]': detailDataType === 'boolean',
          }"
          data-test="quality-detail-type-badge"
        >
          {{ shortType(detailDataType) }}
        </span>
        <span
          v-if="selectedConfig?.version"
          class="qpd-version ml-[6px] text-[11px] text-(--color-text-secondary) [font-variant-numeric:tabular-nums]"
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
