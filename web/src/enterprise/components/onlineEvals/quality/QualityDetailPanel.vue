<template>
  <section class="qdp" data-test="quality-detail-panel">
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
      <div class="qdp__kpis">
        <div
          v-for="kpi in kpis"
          :key="kpi.id"
          class="kpi-card tw:rounded-lg tw:flex tw:flex-col tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.25rem]"
          :data-test="`quality-detail-kpi-${kpi.id}`"
        >
          <div class="kpi-label tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-muted)]">
            {{ kpiTitle(kpi) }}
          </div>
          <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
            <span class="tw:text-[1.4rem] tw:font-bold tw:leading-none tw:text-[var(--o2-text-primary)]">
              {{ formatKpi(kpi) }}
            </span>
          </div>
        </div>
      </div>

      <section v-if="dataType === 'numeric'" class="qdp-chart card-container">
        <header class="qdp-chart__head">
          <h4 class="qdp-chart__title">
            {{ t("onlineEvals.quality.detail.trendTitle") }}
            <span class="qdp-chart__subtitle">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="qdp-chart__body qdp-chart__body--lg">
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
          <p v-else class="qdp-chart__empty">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'numeric'" class="qdp-chart card-container">
        <header class="qdp-chart__head">
          <h4 class="qdp-chart__title">{{ t("onlineEvals.quality.detail.distributionTitle") }}</h4>
        </header>
        <div class="qdp-chart__body">
          <QualityDistributionChart
            v-if="numericDistribution.length > 0"
            :buckets="numericDistribution"
            :threshold="numericThreshold"
            :legend-healthy="t('onlineEvals.quality.detail.legendHealthy')"
            :legend-unhealthy="t('onlineEvals.quality.detail.legendUnhealthy')"
          />
          <p v-else class="qdp-chart__empty">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="qdp-chart card-container">
        <header class="qdp-chart__head">
          <h4 class="qdp-chart__title">
            {{ t("onlineEvals.quality.detail.passRateTitle") }}
            <span class="qdp-chart__subtitle">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="qdp-chart__body qdp-chart__body--lg">
          <QualityBooleanTrendChart
            v-if="booleanTrendSeries.length > 0"
            :series="booleanTrendSeries"
            :points="booleanTrend"
            :legend-pass-rate="t('onlineEvals.quality.detail.legendHealthy')"
          />
          <p v-else class="qdp-chart__empty">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="qdp-chart card-container">
        <header class="qdp-chart__head">
          <h4 class="qdp-chart__title">{{ t("onlineEvals.quality.detail.trueFalseTitle") }}</h4>
        </header>
        <div class="qdp-chart__body qdp-chart__body--sm">
          <QualityBooleanBarsChart
            v-if="booleanCounts.trueCount + booleanCounts.falseCount > 0"
            :true-count="booleanCounts.trueCount"
            :false-count="booleanCounts.falseCount"
            :legend-true="`true (${booleanCounts.trueCount})`"
            :legend-false="`false (${booleanCounts.falseCount})`"
          />
          <p v-else class="qdp-chart__empty">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'categorical'" class="qdp-chart card-container">
        <header class="qdp-chart__head">
          <h4 class="qdp-chart__title">{{ t("onlineEvals.quality.detail.categoryDistributionTitle") }}</h4>
        </header>
        <div class="qdp-chart__body qdp-chart__body--lg">
          <QualityCategoryBarsChart
            v-if="categoricalRows.length > 0"
            :rows="categoricalRows"
            :healthy-categories="healthyCategories"
          />
          <p v-else class="qdp-chart__empty">{{ t("onlineEvals.quality.detail.noData") }}</p>
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

<style lang="scss" scoped>
.qdp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  // The panel now renders inside an ODrawer body whose own padding is
  // intentionally minimal, so the content sat flush against the drawer
  // edges. Add comfortable horizontal + vertical padding so titles,
  // KPI cards, and charts breathe inside the panel.
  padding: 16px 20px 24px;
  // Fill the drawer body's full height (it's a flex-1 block, not a flex
  // container) so the empty state's `flex: 1` has room to expand and center
  // vertically. Populated panels just scroll past it as before.
  min-height: 100%;
  overflow: auto;
}

.qdp__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 12px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  text-align: center;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}

.qdp__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qdp__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

// Mirrors the LLM Sessions detail page card chrome (border/bg/hover) so the
// AI module's KPI tiles look identical across pages.
.kpi-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  transition: box-shadow 0.2s ease;
}

.kpi-card:hover {
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
}

.qdp-chart {
  padding: 12px 14px 14px;
  background: var(--o2-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.qdp-chart__head {
  margin-bottom: 6px;
}

.qdp-chart__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.qdp-chart__subtitle {
  font-weight: 400;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 11px;
}

.qdp-chart__body {
  height: 220px;
}

.qdp-chart__body--lg {
  height: 260px;
}

.qdp-chart__body--sm {
  height: 120px;
}

.qdp-chart__empty {
  margin: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
