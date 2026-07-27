<template>
  <section
    class="flex min-h-full flex-col gap-3 overflow-auto px-5 pt-4 pb-6"
    data-test="quality-detail-panel"
  >
    <!-- Title row + type badge + version + description moved up into the
         ODrawer header (QualityPage) so the panel content starts straight
         from the KPI tiles without a duplicated identification block. -->

    <div
      class="rounded-default border-border-default bg-surface-base flex flex-wrap items-center justify-between gap-2 border px-3 py-2"
      data-test="quality-detail-scope-filter"
    >
      <div>
        <div class="text-2xs text-text-heading font-semibold">
          {{ t("onlineEvals.quality.scopes.filterLabel") }}
        </div>
        <div class="text-3xs text-text-secondary">
          {{ t("onlineEvals.quality.scopes.filterHint") }}
        </div>
      </div>
      <OToggleGroup
        :model-value="scope"
        type="single"
        :aria-label="t('onlineEvals.quality.scopes.filterLabel')"
        @update:model-value="emit('update:scope', $event as QualityScope)"
      >
        <OToggleGroupItem
          v-for="option in scopeOptions"
          :key="option.id"
          :value="option.id"
          size="sm"
          :data-test="`quality-detail-scope-${option.id}`"
        >
          <span>{{ t(`onlineEvals.quality.scopes.${option.id}`) }}</span>
          <span
            class="bg-surface-subtle text-3xs text-text-secondary ml-1 rounded-full px-1.5 py-0.5 leading-none [font-variant-numeric:tabular-nums]"
          >
            {{ compactCount(option.count) }}
          </span>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Hide the previous scope's values while a new scope is loading. This
         keeps the selected chip and the visible data from briefly disagreeing. -->
    <div
      v-if="isLoading"
      class="rounded-default border-border-default text-text-secondary flex flex-col items-center gap-2 border border-dashed px-3 py-7 text-center text-xs"
    >
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.detail.loading") }}</span>
    </div>

    <!-- No scores landed for this config in the window: show one focused
         empty state (same OEmptyState used across list pages) instead of a
         grid of dashed KPI cards + a chart placeholder. -->
    <div
      v-else-if="!hasScores && runs.length === 0 && !runsLoading"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <OEmptyState
        size="block"
        illustration="hourglass"
        :title="emptyTitle"
        :description="emptyDescription"
        data-test="quality-detail-empty"
      />
    </div>

    <template v-else>
      <div
        class="rounded-default border-border-default bg-surface-base flex flex-wrap items-center justify-between gap-2 border px-3 py-2.5"
        data-test="quality-detail-health-summary"
      >
        <div class="min-w-0">
          <div class="text-3xs text-text-secondary font-semibold tracking-wide uppercase">
            {{ t("onlineEvals.quality.detail.health.title") }}
          </div>
          <div class="text-2xs text-text-secondary mt-0.5 truncate" :title="healthSummary">
            {{ healthSummary }}
          </div>
        </div>
        <OTag
          type="qualityStatus"
          :value="healthStatus"
          :label="t(`onlineEvals.quality.overview.status.${healthStatus}`)"
        />
      </div>

      <template v-if="hasScores">
        <!-- KPI tiles reuse the exact card layout + text styles as the LLM
           Sessions detail page (.kpi-card) so the AI module stays visually
           consistent across pages. -->
        <div class="grid grid-cols-[repeat(auto-fit,minmax(11.25rem,1fr))] gap-2.5">
          <div
            v-for="kpi in kpis"
            :key="kpi.id"
            class="rounded-surface border-border-default bg-surface-base flex flex-col gap-1 border px-[0.875rem] pt-[0.625rem] pb-[0.625rem] transition-shadow duration-200 hover:shadow-sm"
            :data-test="`quality-detail-kpi-${kpi.id}`"
          >
            <div class="text-2xs text-text-secondary font-semibold">
              {{ kpiTitle(kpi) }}
            </div>
            <div class="flex items-baseline gap-[0.2rem]">
              <span class="text-text-heading text-2xl leading-none font-bold">
                {{ formatKpi(kpi) }}
              </span>
            </div>
          </div>
        </div>

        <section
          v-if="dataType === 'numeric'"
          class="card-container rounded-default border-border-default bg-surface-base border px-[0.875rem] py-3 pb-[0.875rem]"
        >
          <header class="mb-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("onlineEvals.quality.detail.trendTitle") }}
              <span class="text-2xs text-text-secondary font-normal">— {{ config.name }}</span>
            </h4>
          </header>
          <div class="h-[16.25rem]">
            <QualityTrendChart
              v-if="numericTrend.length > 0"
              :points="numericTrend"
              :threshold="numericThreshold"
              :y-min="numericRange?.min ?? null"
              :y-max="numericRange?.max ?? null"
              :legend-avg="t('onlineEvals.quality.detail.legendAvg')"
              :legend-p95="t('onlineEvals.quality.detail.legendP95')"
              :legend-threshold-fmt="t('onlineEvals.quality.detail.legendThreshold')"
            />
            <p
              v-else
              class="text-text-secondary m-0 flex h-full items-center justify-center text-xs"
            >
              {{ t("onlineEvals.quality.detail.noData") }}
            </p>
          </div>
        </section>

        <section
          v-if="dataType === 'numeric'"
          class="card-container rounded-default border-border-default bg-surface-base border px-[0.875rem] py-3 pb-[0.875rem]"
        >
          <header class="mb-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("onlineEvals.quality.detail.distributionTitle") }}
            </h4>
          </header>
          <div class="h-[13.75rem]">
            <QualityDistributionChart
              v-if="numericDistribution.length > 0"
              :buckets="numericDistribution"
              :threshold="numericThreshold"
              :legend-healthy="t('onlineEvals.quality.detail.legendHealthy')"
              :legend-unhealthy="t('onlineEvals.quality.detail.legendUnhealthy')"
            />
            <p
              v-else
              class="text-text-secondary m-0 flex h-full items-center justify-center text-xs"
            >
              {{ t("onlineEvals.quality.detail.noData") }}
            </p>
          </div>
        </section>

        <section
          v-if="dataType === 'boolean'"
          class="card-container rounded-default border-border-default bg-surface-base border px-[0.875rem] py-3 pb-[0.875rem]"
        >
          <header class="mb-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ booleanRateTitle }}
              <span class="text-2xs text-text-secondary font-normal">— {{ config.name }}</span>
            </h4>
          </header>
          <div class="h-[16.25rem]">
            <QualityBooleanTrendChart
              v-if="booleanTrendSeries.length > 0"
              :series="booleanTrendSeries"
              :points="booleanTrend"
              :legend-pass-rate="booleanRateLegend"
            />
            <p
              v-else
              class="text-text-secondary m-0 flex h-full items-center justify-center text-xs"
            >
              {{ t("onlineEvals.quality.detail.noData") }}
            </p>
          </div>
        </section>

        <section
          v-if="dataType === 'boolean'"
          class="card-container rounded-default border-border-default bg-surface-base border px-[0.875rem] py-3 pb-[0.875rem]"
        >
          <header class="mb-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("onlineEvals.quality.detail.trueFalseTitle") }}
            </h4>
          </header>
          <div class="h-[7.5rem]">
            <QualityBooleanBarsChart
              v-if="booleanCounts.trueCount + booleanCounts.falseCount > 0"
              :true-count="booleanCounts.trueCount"
              :false-count="booleanCounts.falseCount"
              :legend-true="
                t('onlineEvals.quality.detail.legendTrueCount', {
                  count: booleanCounts.trueCount,
                })
              "
              :legend-false="
                t('onlineEvals.quality.detail.legendFalseCount', {
                  count: booleanCounts.falseCount,
                })
              "
            />
            <p
              v-else
              class="text-text-secondary m-0 flex h-full items-center justify-center text-xs"
            >
              {{ t("onlineEvals.quality.detail.noData") }}
            </p>
          </div>
        </section>

        <section
          v-if="dataType === 'categorical'"
          class="card-container rounded-default border-border-default bg-surface-base border px-[0.875rem] py-3 pb-[0.875rem]"
        >
          <header class="mb-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("onlineEvals.quality.detail.categoryDistributionTitle") }}
            </h4>
          </header>
          <div class="h-[16.25rem]">
            <QualityCategoryBarsChart
              v-if="categoricalRows.length > 0"
              :rows="categoricalRows"
              :healthy-categories="healthyCategories"
            />
            <p
              v-else
              class="text-text-secondary m-0 flex h-full items-center justify-center text-xs"
            >
              {{ t("onlineEvals.quality.detail.noData") }}
            </p>
          </div>
        </section>
      </template>

      <QualityRunsTable
        :config="config"
        :rows="runs"
        :counts="runsCounts"
        :active-filter="runsFilter"
        :current-page="runsCurrentPage"
        :page-size="runsPageSize"
        :total-count="runsTotalCount"
        :is-loading="runsLoading"
        :error="runsError"
        @open-run="emit('open-run', $event)"
        @filter-change="emit('runs-filter-change', $event)"
        @pagination-change="emit('runs-pagination-change', $event)"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import type {
  BooleanAggRow,
  CategoricalAggRow,
  DetailKpi,
} from "../composables/useQualityConfigDetail";
import type {
  BooleanTrendPoint,
  BooleanTrendSeries,
  DistributionBucket,
  TrendPoint,
} from "../composables/useQualityDetailCharts";
import type { QualityScope, ScopeCounts } from "../utils/qualityScope";
import { healthyBooleanValue } from "../utils/qualitySummary";
import { thresholdForConfig } from "../utils/scoreThreshold";
import type {
  QualityRunCounts,
  QualityRunFilter,
  QualityRunRow,
  QualityRunsPagination,
} from "../composables/useQualityRuns";
import QualityTrendChart from "./QualityTrendChart.vue";
import QualityDistributionChart from "./QualityDistributionChart.vue";
import QualityBooleanTrendChart from "./QualityBooleanTrendChart.vue";
import QualityBooleanBarsChart from "./QualityBooleanBarsChart.vue";
import QualityCategoryBarsChart from "./QualityCategoryBarsChart.vue";
import QualityRunsTable from "./QualityRunsTable.vue";

const props = defineProps<{
  config: ScoreConfig;
  dataType: "numeric" | "boolean" | "categorical" | "unknown";
  kpis: DetailKpi[];
  hasScores: boolean;
  isLoading: boolean;
  numericTrend: TrendPoint[];
  numericDistribution: DistributionBucket[];
  numericThreshold: { value: number; direction: "gte" | "lte" } | null;
  numericRange: { min: number; max: number } | null;
  booleanAgg: BooleanAggRow | null;
  booleanTrend: BooleanTrendPoint[];
  booleanTrendSeries: BooleanTrendSeries[];
  categoricalRows: CategoricalAggRow[];
  scope: QualityScope;
  scopeCounts: ScopeCounts;
  runs: QualityRunRow[];
  runsCounts: QualityRunCounts;
  runsFilter: QualityRunFilter;
  runsCurrentPage: number;
  runsPageSize: number;
  runsTotalCount: number;
  runsLoading: boolean;
  runsError: string | null;
}>();

// NOTE: the binding is required — the template calls emit() directly for
// update:scope, open-run, runs-filter-change and runs-pagination-change.
// main's lint pass (#13174) dropped `const emit =` here; on this branch the
// OToggleGroup scope filter uses it, so removing it silently stops the panel
// emitting.
const emit = defineEmits<{
  (e: "back"): void;
  (e: "update:scope", value: QualityScope): void;
  (e: "open-run", value: QualityRunRow): void;
  (e: "runs-filter-change", value: QualityRunFilter): void;
  (e: "runs-pagination-change", value: QualityRunsPagination): void;
}>();

const { t } = useI18n();

const threshold = computed(() => thresholdForConfig(props.config));
const unhealthyKpi = computed(() => props.kpis.find((kpi) => kpi.id === "unhealthy"));
const healthStatus = computed<"healthy" | "unhealthy" | "noThreshold" | "noData">(() => {
  if (threshold.value.unhealthyExpr == null) return "noThreshold";
  if (!props.hasScores) return "noData";
  const unhealthy = unhealthyKpi.value?.value;
  return typeof unhealthy === "number" && unhealthy > 0 ? "unhealthy" : "healthy";
});

const healthSummary = computed(() => {
  if (threshold.value.unhealthyExpr == null) {
    return t("onlineEvals.quality.detail.health.noThreshold");
  }
  const unhealthy = unhealthyKpi.value?.value;
  if (typeof unhealthy !== "number") {
    return t("onlineEvals.quality.detail.health.thresholdOnly", {
      threshold: threshold.value.label,
    });
  }
  return t("onlineEvals.quality.detail.health.summary", {
    percent: unhealthy.toFixed(1),
    threshold: threshold.value.label,
  });
});

const scopeOptions = computed(() => [
  {
    id: "all" as const,
    count: props.scopeCounts.span + props.scopeCounts.trace + props.scopeCounts.session,
  },
  { id: "span" as const, count: props.scopeCounts.span },
  { id: "trace" as const, count: props.scopeCounts.trace },
  { id: "session" as const, count: props.scopeCounts.session },
]);

const emptyDescription = computed(() => {
  if (props.scope === "all") {
    return t("onlineEvals.quality.detail.empty.description");
  }
  return t("onlineEvals.quality.detail.empty.descriptionScoped", {
    scope: t(`onlineEvals.quality.scopes.${props.scope}`),
  });
});

const emptyTitle = computed(() => {
  if (props.scope === "all") {
    return t("onlineEvals.quality.detail.empty.title");
  }
  return t("onlineEvals.quality.detail.empty.titleScoped", {
    scope: t(`onlineEvals.quality.scopes.${props.scope}`),
  });
});

const booleanRateHasThreshold = computed(() => healthyBooleanValue(props.config) != null);

const booleanRateTitle = computed(() =>
  t(
    booleanRateHasThreshold.value
      ? "onlineEvals.quality.detail.healthyRateTitle"
      : "onlineEvals.quality.detail.trueRateTitle",
  ),
);

const booleanRateLegend = computed(() =>
  t(
    booleanRateHasThreshold.value
      ? "onlineEvals.quality.detail.legendHealthyRate"
      : "onlineEvals.quality.detail.legendTrueRate",
  ),
);

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function compactCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

const booleanCounts = computed(() => ({
  trueCount: toNumber(props.booleanAgg?.trues),
  falseCount: toNumber(props.booleanAgg?.falses),
}));

const healthyCategories = computed<string[]>(() => {
  const ht: any = (props.config as any).healthyThreshold ?? (props.config as any).healthy_threshold;
  return ht?.healthy_categories || ht?.healthyCategories || [];
});

function kpiTitle(kpi: DetailKpi): string {
  const key = kpi.titleKey ?? kpi.id;
  return t(`onlineEvals.quality.detail.kpis.${key}`);
}

function formatKpi(kpi: DetailKpi): string {
  if (kpi.value == null) return "—";
  if (typeof kpi.value === "string") return kpi.value;
  if (kpi.format === "percent") return `${kpi.value.toFixed(1)}%`;
  if (kpi.format === "number") return kpi.value.toFixed(2);
  if (kpi.format === "count") {
    const v = kpi.value;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  }
  return String(kpi.value);
}
</script>
