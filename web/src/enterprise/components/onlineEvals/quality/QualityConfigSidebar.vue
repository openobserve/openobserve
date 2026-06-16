<template>
  <aside class="tw:flex tw:flex-col tw:gap-2.5 tw:p-3 tw:pb-4 tw:bg-(--o2-card-bg) tw:border tw:border-dialog-header-border tw:rounded-md tw:min-h-0 tw:max-h-[calc(100vh-var(--navbar-height)-200px)] tw:overflow-hidden" data-test="quality-config-sidebar">
    <header class="tw:flex tw:items-baseline tw:gap-2">
      <span class="tw:text-[11px] tw:font-semibold tw:text-text-secondary">{{ t("onlineEvals.quality.overview.title") }}</span>
      <span class="tw:text-[11px] tw:text-text-secondary tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:px-1.5 tw:py-px tw:rounded-[4px] tw:[font-variant-numeric:tabular-nums]">{{ filteredRows.length }}</span>
    </header>

    <OInput
      v-model="filter"
      :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
      size="sm"
      class="tw:w-full"
      data-test="quality-sidebar-filter"
    >
      <template #icon-left>
        <OIcon name="search" size="xs" />
      </template>
    </OInput>

    <button
      type="button"
      class="qcs__all tw:inline-flex tw:items-center tw:gap-1 tw:bg-transparent tw:border-0 tw:py-[2px] tw:px-0 tw:text-xs tw:text-(--color-primary-600,#3F7994) tw:cursor-pointer tw:w-max tw:hover:underline"
      data-test="quality-sidebar-all-configs"
      @click="$emit('clear')"
    >
      <OIcon name="chevron-left" size="xs" />
      {{ t("onlineEvals.quality.sidebar.allConfigs") }}
    </button>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-auto tw:flex tw:flex-col tw:gap-1">
      <button
        v-for="row in filteredRows"
        :key="row.configId"
        type="button"
        class="qcs-item tw:flex tw:gap-2 tw:py-[10px] tw:px-[10px] tw:pb-2 tw:bg-transparent tw:border tw:border-transparent tw:rounded-md tw:text-left tw:cursor-pointer tw:w-full tw:[font:inherit] tw:text-inherit tw:transition-[background,border-color] tw:duration-[120ms] tw:hover:bg-[color-mix(in_srgb,var(--color-text-primary)_5%,transparent)]"
        :class="String(row.config.id) === selectedId ? ['qcs-item--selected', 'tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_14%,transparent)]', 'tw:border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_45%,transparent)]', 'tw:relative'] : []"
        :data-test="`quality-sidebar-item-${row.name}`"
        @click="$emit('select', row)"
      >
        <span class="qcs-item__status tw:shrink-0 tw:basis-[14px] tw:inline-flex tw:items-start tw:pt-[2px] tw:text-[13px] tw:leading-none" :class="{ 'tw:text-[var(--o2-status-warning-text,#b25400)]': row.status === 'unhealthy', 'tw:text-[var(--o2-status-warning-text,#b25400)] tw:opacity-75': row.status === 'warn', 'tw:text-[var(--o2-status-success-text,#2e7d32)]': row.status === 'healthy', 'tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]': row.status === 'noThreshold' }">
          <template v-if="row.status === 'unhealthy'">▲</template>
          <template v-else>●</template>
        </span>

        <div class="qcs-item__main tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
          <div class="tw:flex tw:items-center tw:gap-[6px]">
            <span class="qcs-item__name tw:flex-1 tw:min-w-0 tw:font-semibold tw:text-[13px] tw:text-(--color-text-primary,currentColor) tw:truncate tw:font-mono">{{ row.name }}</span>
            <span class="qcs-item__type tw:shrink-0 tw:px-1 tw:rounded-[2px] tw:font-bold tw:text-[4px] tw:leading-[1.4] tw:tracking-[0.02em]" :class="{ 'tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]': row.dataType === 'numeric', 'tw:bg-[color-mix(in_srgb,#9333ea_14%,transparent)] tw:text-[#7c3aed]': row.dataType === 'categorical', 'tw:bg-[color-mix(in_srgb,#16a34a_14%,transparent)] tw:text-[#15803d]': row.dataType === 'boolean' }">
              {{ shortType(row.dataType) }}
            </span>
          </div>

          <div class="tw:flex tw:items-center tw:gap-[6px] tw:[font-variant-numeric:tabular-nums]">
            <div v-if="row.hasThreshold" class="qcs-item__bar tw:flex-1 tw:h-1 tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:rounded-full tw:overflow-hidden">
              <div
                class="qcs-item__bar-fill tw:h-full"
                :class="{ 'tw:bg-[var(--o2-status-warning-text,#b25400)]': row.status === 'unhealthy' || row.status === 'warn', 'tw:bg-[var(--o2-status-success-text,#2e7d32)]': row.status === 'healthy', 'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_30%,transparent)]': row.status === 'noThreshold' }"
                :style="{ width: `${Math.min(100, row.unhealthyPct ?? 0)}%` }"
              />
            </div>
            <span v-if="row.hasThreshold" class="qcs-item__pct tw:shrink-0 tw:text-[11px] tw:font-semibold tw:text-(--o2-status-warning-text,#b25400)">{{ formatPct(row.unhealthyPct) }}</span>
            <span v-else class="qcs-item__pct--muted tw:shrink-0 tw:text-[11px] tw:font-semibold tw:text-(--color-text-secondary,var(--o2-text-secondary))">—</span>
            <span class="tw:shrink-0 tw:text-[11px] tw:text-(--color-text-secondary,var(--o2-text-secondary))">{{ formatCount(row.totalScores) }}</span>
          </div>

          <svg
            v-if="row.trendSparkline.length > 0"
            class="qcs-item__spark tw:w-full tw:h-5"
            :class="{ 'tw:text-[var(--o2-status-warning-text,#b25400)]': row.status === 'unhealthy' || row.status === 'warn', 'tw:text-[var(--o2-status-success-text,#2e7d32)]': row.status === 'healthy', 'tw:text-[color-mix(in_srgb,var(--color-text-secondary)_50%,transparent)]': row.status === 'noThreshold' }"
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              :points="sparkPoints(row.trendSparkline)"
            />
          </svg>
        </div>
      </button>

      <div v-if="filteredRows.length === 0" class="tw:py-5 tw:px-2 tw:text-center tw:text-xs tw:text-text-secondary">
        {{ t("onlineEvals.quality.sidebar.empty") }}
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { ScoreConfigRow } from "../composables/useQualityScoreConfigs";

const props = defineProps<{
  rows: ScoreConfigRow[];
  selectedId: string | null;
}>();

defineEmits<{
  (e: "select", row: ScoreConfigRow): void;
  (e: "clear"): void;
}>();

const { t } = useI18n();
const filter = ref("");

const filteredRows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return props.rows;
  return props.rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
});

function shortType(type: ScoreConfigRow["dataType"]): string {
  if (type === "numeric") return "Num";
  if (type === "categorical") return "Cat";
  if (type === "boolean") return "Bool";
  return "—";
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatPct(n: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "0%";
  if (n < 0.1) return "<0.1%";
  return `${n.toFixed(0)}%`;
}

function sparkPoints(series: number[]): string {
  if (!series || series.length === 0) return "";
  const points = series.length === 1 ? [series[0], series[0]] : series;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points
    .map((value, idx) => {
      const x = (idx / (points.length - 1)) * 100;
      const y = 18 - ((value - min) / range) * 14;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
</script>

<style>
/* .qcs-item selected state — pseudo-element and hover cannot be expressed inline */
.qcs-item--selected:hover {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
}

.qcs-item--selected::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-primary-600, #3F7994);
}

/* descendant selector: selected item overrides name color */
.qcs-item--selected .qcs-item__name {
  color: var(--color-primary-600, #3F7994);
}
</style>
