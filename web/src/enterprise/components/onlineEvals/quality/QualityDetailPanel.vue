<template>
  <section class="flex flex-col gap-3 px-5 pt-4 pb-6 min-h-full overflow-auto" data-test="quality-detail-panel">
    <!-- Title row + type badge + version + description moved up into the
         ODrawer header (QualityPage) so the panel content starts straight
         from the KPI tiles without a duplicated identification block. -->

    <div v-if="isLoading && !hasScores" class="qdp__loading">
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.detail.loading") }}</span>
    </div>

    <!-- No scores landed for this config in the window: show one focused
         empty state (same OEmptyState used across list pages) instead of a
         grid of dashed KPI cards + a chart placeholder. -->
    <div v-else-if="!hasScores" class="qdp__empty">
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
          class="kpi-card rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-(--color-surface-base) border border-(--color-border-default) transition-shadow duration-200"
          :data-test="`quality-detail-kpi-${kpi.id}`"
        >
          <div class="text-[0.7rem] font-semibold text-[var(--color-text-secondary)]">
            {{ kpiTitle(kpi) }}
          </div>
          <div class="flex items-baseline gap-[0.2rem]">
            <span class="text-[1.4rem] font-bold leading-none text-[var(--color-grey-600)]">
              {{ formatKpi(kpi) }}
            </span>
          </div>
        </div>
      </div>

      <section v-if="dataType === 'numeric'" class="card-container py-3 px-[14px] pb-[14px] bg-(--color-surface-base) border border-(--color-border-default) rounded-md">
        <header class="mb-[6px]">
          <h4 class="m-0 text-[13px] font-semibold text-(--color-text-primary)">
            {{ t("onlineEvals.quality.detail.trendTitle") }}
            <span class="font-normal text-(--color-text-secondary) text-[11px]">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="h-[260px]">
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
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-(--color-text-secondary)">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'numeric'" class="card-container py-3 px-[14px] pb-[14px] bg-(--color-surface-base) border border-(--color-border-default) rounded-md">
        <header class="mb-[6px]">
          <h4 class="m-0 text-[13px] font-semibold text-(--color-text-primary)">{{ t("onlineEvals.quality.detail.distributionTitle") }}</h4>
        </header>
        <div class="h-[220px]">
          <QualityDistributionChart
            v-if="numericDistribution.length > 0"
            :buckets="numericDistribution"
            :threshold="numericThreshold"
            :legend-healthy="t('onlineEvals.quality.detail.legendHealthy')"
            :legend-unhealthy="t('onlineEvals.quality.detail.legendUnhealthy')"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-(--color-text-secondary)">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="card-container py-3 px-[14px] pb-[14px] bg-(--color-surface-base) border border-(--color-border-default) rounded-md">
        <header class="mb-[6px]">
          <h4 class="m-0 text-[13px] font-semibold text-(--color-text-primary)">
            {{ t("onlineEvals.quality.detail.passRateTitle") }}
            <span class="font-normal text-(--color-text-secondary) text-[11px]">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="h-[260px]">
          <QualityBooleanTrendChart
            v-if="booleanTrendSeries.length > 0"
            :series="booleanTrendSeries"
            :points="booleanTrend"
            :legend-pass-rate="t('onlineEvals.quality.detail.legendHealthy')"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-(--color-text-secondary)">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="card-container py-3 px-[14px] pb-[14px] bg-(--color-surface-base) border border-(--color-border-default) rounded-md">
        <header class="mb-[6px]">
          <h4 class="m-0 text-[13px] font-semibold text-(--color-text-primary)">{{ t("onlineEvals.quality.detail.trueFalseTitle") }}</h4>
        </header>
        <div class="h-[120px]">
          <QualityBooleanBarsChart
            v-if="booleanCounts.trueCount + booleanCounts.falseCount > 0"
            :true-count="booleanCounts.trueCount"
            :false-count="booleanCounts.falseCount"
            :legend-true="`true (${booleanCounts.trueCount})`"
            :legend-false="`false (${booleanCounts.falseCount})`"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-(--color-text-secondary)">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'categorical'" class="card-container py-3 px-[14px] pb-[14px] bg-(--color-surface-base) border border-(--color-border-default) rounded-md">
        <header class="mb-[6px]">
          <h4 class="m-0 text-[13px] font-semibold text-(--color-text-primary)">{{ t("onlineEvals.quality.detail.categoryDistributionTitle") }}</h4>
        </header>
        <div class="h-[260px]">
          <QualityCategoryBarsChart
            v-if="categoricalRows.length > 0"
            :rows="categoricalRows"
            :healthy-categories="healthyCategories"
          />
          <p v-else class="m-0 h-full flex items-center justify-center text-xs text-(--color-text-secondary)">{{ t("onlineEvals.quality.detail.noData") }}</p>
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

<style>
/* ::before pseudo-element for KPI accent bar — cannot inline */

.qdp__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 12px;
  border: 1px dashed var(--color-dialog-header-border);
  border-radius: 6px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.qdp__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Hover shadow on KPI tiles — pseudo-class cannot be inlined. Mirrors the
 * LLM Sessions detail page card chrome so the AI module's KPI tiles look
 * identical across pages. */
.kpi-card:hover {
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
}
</style>
