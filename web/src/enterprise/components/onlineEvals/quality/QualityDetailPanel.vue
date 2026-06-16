<template>
  <section class="tw:flex tw:flex-col tw:gap-3 tw:px-5 tw:pt-4 tw:pb-6 tw:min-h-0 tw:overflow-auto" data-test="quality-detail-panel">
    <!-- Title row + type badge + version + description moved up into the
         ODrawer header (QualityPage) so the panel content starts straight
         from the KPI tiles without a duplicated identification block. -->

    <div v-if="kpis.length === 0 && isLoading" class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-[28px] tw:px-3 tw:border tw:border-dashed tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md tw:text-center tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:text-xs">
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.detail.loading") }}</span>
    </div>

    <div v-else-if="kpis.length === 0" class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-[28px] tw:px-3 tw:border tw:border-dashed tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md tw:text-center tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:text-xs">
      <OIcon name="info" size="lg" />
      <p>{{ t("onlineEvals.quality.detail.noData") }}</p>
    </div>

    <template v-else>
      <div class="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] tw:gap-2.5">
        <article
          v-for="kpi in kpis"
          :key="kpi.id"
          class="qdp-kpi card-container tw:flex tw:flex-col tw:gap-[6px] tw:py-[10px] tw:px-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md tw:relative"
          :class="`qdp-kpi--${kpi.id}`"
          :data-test="`quality-detail-kpi-${kpi.id}`"
        >
          <header class="tw:flex tw:items-center tw:justify-between tw:gap-[6px]">
            <span class="tw:text-xs tw:font-semibold tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ kpiTitle(kpi) }}</span>
            <button
              type="button"
              class="qdp-kpi__drill tw:border-0 tw:bg-transparent tw:py-0 tw:px-1 tw:rounded tw:cursor-pointer tw:font-semibold tw:text-sm tw:text-(--color-text-secondary,var(--o2-text-secondary))"
              :aria-label="t('onlineEvals.quality.detail.drillTitle')"
              :title="t('onlineEvals.quality.detail.drillTitle')"
              data-test="quality-detail-drill"
              @click="$emit('drill', kpi.id)"
            >
              →
            </button>
          </header>
          <div class="tw:flex tw:items-baseline tw:justify-between tw:gap-2">
            <span class="qdp-kpi__big tw:text-[26px] tw:font-bold tw:tracking-[-0.01em] tw:[font-variant-numeric:tabular-nums] tw:font-mono">{{ formatKpi(kpi) }}</span>
            <span v-if="kpi.context" class="tw:text-[11px] tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:text-right">{{ kpi.context }}</span>
          </div>
        </article>
      </div>

      <div class="tw:flex tw:justify-end tw:gap-3.5 tw:text-xs tw:text-text-secondary">
        <label class="qdp__split tw:inline-flex tw:items-center tw:gap-[6px] tw:py-1 tw:px-[10px] tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded tw:cursor-pointer tw:bg-(--o2-card-bg)">
          <input
            v-model="splitByScorer"
            type="checkbox"
            data-test="quality-detail-split-scorer"
          />
          <span>{{ t("onlineEvals.quality.detail.splitByScorer") }}</span>
        </label>
        <label class="qdp__split tw:inline-flex tw:items-center tw:gap-[6px] tw:py-1 tw:px-[10px] tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded tw:cursor-pointer tw:bg-(--o2-card-bg)">
          <input
            v-model="splitBySourceType"
            type="checkbox"
            data-test="quality-detail-split-source-type"
          />
          <span>{{ t("onlineEvals.quality.detail.splitBySourceType") }}</span>
        </label>
      </div>

      <section v-if="dataType === 'numeric'" class="card-container tw:py-3 tw:px-[14px] tw:pb-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
        <header class="tw:mb-[6px]">
          <h4 class="tw:m-0 tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary,currentColor)">
            {{ t("onlineEvals.quality.detail.trendTitle") }}
            <span class="tw:font-normal tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:text-[11px]">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="tw:h-[260px]">
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
          <p v-else class="tw:m-0 tw:h-full tw:flex tw:items-center tw:justify-center tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'numeric'" class="card-container tw:py-3 tw:px-[14px] tw:pb-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
        <header class="tw:mb-[6px]">
          <h4 class="tw:m-0 tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.quality.detail.distributionTitle") }}</h4>
        </header>
        <div class="tw:h-[220px]">
          <QualityDistributionChart
            v-if="numericDistribution.length > 0"
            :buckets="numericDistribution"
            :threshold="numericThreshold"
            :legend-healthy="t('onlineEvals.quality.detail.legendHealthy')"
            :legend-unhealthy="t('onlineEvals.quality.detail.legendUnhealthy')"
          />
          <p v-else class="tw:m-0 tw:h-full tw:flex tw:items-center tw:justify-center tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="card-container tw:py-3 tw:px-[14px] tw:pb-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
        <header class="tw:mb-[6px]">
          <h4 class="tw:m-0 tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary,currentColor)">
            {{ t("onlineEvals.quality.detail.passRateTitle") }}
            <span class="tw:font-normal tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:text-[11px]">— {{ config.name }}</span>
          </h4>
        </header>
        <div class="tw:h-[260px]">
          <QualityBooleanTrendChart
            v-if="booleanTrendSeries.length > 0"
            :series="booleanTrendSeries"
            :points="booleanTrend"
            :legend-pass-rate="t('onlineEvals.quality.detail.legendHealthy')"
          />
          <p v-else class="tw:m-0 tw:h-full tw:flex tw:items-center tw:justify-center tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'boolean'" class="card-container tw:py-3 tw:px-[14px] tw:pb-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
        <header class="tw:mb-[6px]">
          <h4 class="tw:m-0 tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.quality.detail.trueFalseTitle") }}</h4>
        </header>
        <div class="tw:h-[120px]">
          <QualityBooleanBarsChart
            v-if="booleanCounts.trueCount + booleanCounts.falseCount > 0"
            :true-count="booleanCounts.trueCount"
            :false-count="booleanCounts.falseCount"
            :legend-true="`true (${booleanCounts.trueCount})`"
            :legend-false="`false (${booleanCounts.falseCount})`"
          />
          <p v-else class="tw:m-0 tw:h-full tw:flex tw:items-center tw:justify-center tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>

      <section v-if="dataType === 'categorical'" class="card-container tw:py-3 tw:px-[14px] tw:pb-[14px] tw:bg-(--o2-card-bg) tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
        <header class="tw:mb-[6px]">
          <h4 class="tw:m-0 tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.quality.detail.categoryDistributionTitle") }}</h4>
        </header>
        <div class="tw:h-[260px]">
          <QualityCategoryBarsChart
            v-if="categoricalRows.length > 0"
            :rows="categoricalRows"
            :healthy-categories="healthyCategories"
          />
          <p v-else class="tw:m-0 tw:h-full tw:flex tw:items-center tw:justify-center tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ t("onlineEvals.quality.detail.noData") }}</p>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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
  isLoading: boolean;
  numericTrend: TrendPoint[];
  numericDistribution: DistributionBucket[];
  numericThreshold: { value: number; direction: "gte" | "lte" } | null;
  numericRange: { min: number; max: number } | null;
  booleanAgg: BooleanAggRow | null;
  booleanTrend: BooleanTrendPoint[];
  booleanTrendSeries: BooleanTrendSeries[];
  categoricalRows: CategoricalAggRow[];
  splitByScorer: boolean;
  splitBySourceType: boolean;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "drill", kpiId: string): void;
  (e: "update:splitByScorer", value: boolean): void;
  (e: "update:splitBySourceType", value: boolean): void;
}>();

const { t } = useI18n();

const splitByScorer = computed({
  get: () => props.splitByScorer,
  set: (v: boolean) => emit("update:splitByScorer", v),
});
const splitBySourceType = computed({
  get: () => props.splitBySourceType,
  set: (v: boolean) => emit("update:splitBySourceType", v),
});

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
.qdp-kpi::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: transparent;
}

.qdp-kpi--unhealthy::before { background: var(--o2-status-warning-text, #b25400); }
.qdp-kpi--healthy::before { background: var(--o2-status-success-text, #2e7d32); }
.qdp-kpi--avg::before,
.qdp-kpi--p50::before,
.qdp-kpi--p95::before { background: var(--color-primary-600, #3F7994); }

/* Hover state on drill button — pseudo-class with custom color-mix */
.qdp-kpi__drill:hover {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 12%, transparent);
  color: var(--color-primary-600, #3F7994);
}

/* Descendant selector — unhealthy KPI colors the big value */
.qdp-kpi--unhealthy .qdp-kpi__big { color: var(--o2-status-warning-text, #b25400); }

/* Descendant selector — split label input margin reset */
.qdp__split input { margin: 0; }
</style>
