<template>
  <section class="flex flex-col gap-3 px-5 pt-4 pb-6 min-h-full overflow-auto" data-test="quality-detail-panel">
    <!-- Title row + type badge + version + description moved up into the
         ODrawer header (QualityPage) so the panel content starts straight
         from the KPI tiles without a duplicated identification block. -->

    <div v-if="isLoading && !hasScores" class="flex flex-col items-center gap-2 py-7 px-3 border border-dashed border-dialog-header-border rounded-default text-center text-text-secondary text-xs">
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.detail.loading") }}</span>
    </div>

    <!-- No scores landed for this config in the window: show one focused
         empty state (same OEmptyState used across list pages) instead of a
         grid of dashed KPI cards + a chart placeholder. -->
    <div v-else-if="!hasScores" class="flex-1 min-h-0 flex items-center justify-center">
      <OEmptyState
        size="block"
        illustration="hourglass"
        :title="t('onlineEvals.quality.detail.empty.title')"
        :description="t('onlineEvals.quality.detail.empty.description')"
        data-test="quality-detail-empty"
      />
    </div>

    <template v-else>
      <!-- KPI tiles reuse the exact card layout + text styles as the LLM
           Sessions detail page (.kpi-card) so the AI module stays visually
           consistent across pages. -->
      <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
        <div
          v-for="kpi in kpis"
          :key="kpi.id"
          class="rounded-default flex flex-col px-3.5 pt-2.5 pb-2.5 gap-1 bg-surface-base border border-border-default transition-shadow duration-200 hover:shadow-[0_0.0625rem_0.375rem_rgba(0,0,0,0.08)]"
          :data-test="`quality-detail-kpi-${kpi.id}`"
        >
          <div class="text-2xs font-semibold text-text-secondary">
            {{ kpiTitle(kpi) }}
          </div>
          <div class="flex items-baseline gap-[0.2rem]">
            <span class="text-2xl font-bold leading-none text-text-secondary">
              {{ formatKpi(kpi) }}
            </span>
          </div>
        </div>
      </div>

      <section v-if="dataType === 'numeric'" class="bg-card-glass-bg py-3 px-3.5 pb-3.5 border border-border-default rounded-default">
        <header class="mb-1.5">
          <h4 class="m-0 text-compact font-semibold text-text-heading">
            {{ t("onlineEvals.quality.detail.trendTitle") }}
            <span class="font-normal text-text-secondary text-2xs">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="h-65">
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
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-text-secondary">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'numeric'" class="bg-card-glass-bg py-3 px-3.5 pb-3.5 border border-border-default rounded-default">
        <header class="mb-1.5">
          <h4 class="m-0 text-compact font-semibold text-text-heading">{{ t("onlineEvals.quality.detail.distributionTitle") }}</h4>
        </header>
        <div class="h-55">
          <QualityDistributionChart
            v-if="numericDistribution.length > 0"
            :buckets="numericDistribution"
            :threshold="numericThreshold"
            :legend-healthy="t('onlineEvals.quality.detail.legendHealthy')"
            :legend-unhealthy="t('onlineEvals.quality.detail.legendUnhealthy')"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-text-secondary">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="bg-card-glass-bg py-3 px-3.5 pb-3.5 border border-border-default rounded-default">
        <header class="mb-1.5">
          <h4 class="m-0 text-compact font-semibold text-text-heading">
            {{ t("onlineEvals.quality.detail.passRateTitle") }}
            <span class="font-normal text-text-secondary text-2xs">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="h-65">
          <QualityBooleanTrendChart
            v-if="booleanTrendSeries.length > 0"
            :series="booleanTrendSeries"
            :points="booleanTrend"
            :legend-pass-rate="t('onlineEvals.quality.detail.legendHealthy')"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-text-secondary">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="bg-card-glass-bg py-3 px-3.5 pb-3.5 border border-border-default rounded-default">
        <header class="mb-1.5">
          <h4 class="m-0 text-compact font-semibold text-text-heading">{{ t("onlineEvals.quality.detail.trueFalseTitle") }}</h4>
        </header>
        <div class="h-30">
          <QualityBooleanBarsChart
            v-if="booleanCounts.trueCount + booleanCounts.falseCount > 0"
            :true-count="booleanCounts.trueCount"
            :false-count="booleanCounts.falseCount"
            :legend-true="`true (${booleanCounts.trueCount})`"
            :legend-false="`false (${booleanCounts.falseCount})`"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-text-secondary">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'categorical'" class="bg-card-glass-bg py-3 px-3.5 pb-3.5 border border-border-default rounded-default">
        <header class="mb-1.5">
          <h4 class="m-0 text-compact font-semibold text-text-heading">{{ t("onlineEvals.quality.detail.categoryDistributionTitle") }}</h4>
        </header>
        <div class="h-65">
          <QualityCategoryBarsChart
            v-if="categoricalRows.length > 0"
            :rows="categoricalRows"
            :healthy-categories="healthyCategories"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-text-secondary">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
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
import QualityTrendChart from "./QualityTrendChart.vue";
import QualityDistributionChart from "./QualityDistributionChart.vue";
import QualityBooleanTrendChart from "./QualityBooleanTrendChart.vue";
import QualityBooleanBarsChart from "./QualityBooleanBarsChart.vue";
import QualityCategoryBarsChart from "./QualityCategoryBarsChart.vue";

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
}>();

const emit = defineEmits<{
  (e: "back"): void;
}>();

const { t } = useI18n();

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const booleanCounts = computed(() => ({
  trueCount: toNumber(props.booleanAgg?.trues),
  falseCount: toNumber(props.booleanAgg?.falses),
}));

const healthyCategories = computed<string[]>(() => {
  const ht: any =
    (props.config as any).healthyThreshold ?? (props.config as any).healthy_threshold;
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
