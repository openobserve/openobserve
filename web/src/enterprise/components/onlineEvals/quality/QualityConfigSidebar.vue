<template>
  <aside class="flex flex-col gap-2.5 p-3 pb-4 bg-(--color-surface-base) border border-dialog-header-border rounded-md min-h-0 max-h-[calc(100vh-var(--navbar-height)-200px)] overflow-hidden" data-test="quality-config-sidebar">
    <header class="flex items-baseline gap-2">
      <span class="text-[11px] font-semibold text-text-secondary">{{ t("onlineEvals.quality.overview.title") }}</span>
      <span class="text-[11px] text-text-secondary bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] px-1.5 py-px rounded-[4px] [font-variant-numeric:tabular-nums]">{{ filteredRows.length }}</span>
    </header>

    <OInput
      v-model="filter"
      :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
      size="sm"
      class="w-full"
      data-test="quality-sidebar-filter"
    >
      <template #icon-left>
        <OIcon name="search" size="xs" />
      </template>
    </OInput>

    <button
      type="button"
      class="qcs__all inline-flex items-center gap-1 bg-transparent border-0 py-[2px] px-0 text-xs text-(--color-primary-600,#3F7994) cursor-pointer w-max hover:underline"
      data-test="quality-sidebar-all-configs"
      @click="$emit('clear')"
    >
      <OIcon name="chevron-left" size="xs" />
      {{ t("onlineEvals.quality.sidebar.allConfigs") }}
    </button>

    <div class="flex-1 min-h-0 overflow-auto flex flex-col gap-1">
      <button
        v-for="row in filteredRows"
        :key="row.configId"
        type="button"
        class="qcs-item flex gap-2 py-[10px] px-[10px] pb-2 bg-transparent border border-transparent rounded-md text-left cursor-pointer w-full [font:inherit] text-inherit transition-[background,border-color] duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-text-primary)_5%,transparent)]"
        :class="String(row.config.id) === selectedId ? ['qcs-item--selected', 'bg-[color-mix(in_srgb,var(--color-primary-600)_14%,transparent)]', 'border-[color-mix(in_srgb,var(--color-primary-600)_45%,transparent)]', 'relative'] : []"
        :data-test="`quality-sidebar-item-${row.name}`"
        @click="$emit('select', row)"
      >
        <OTag type="qualityStatus" :value="row.status" label="" :aria-label="row.status" />

        <div class="qcs-item__main flex-1 min-w-0 flex flex-col gap-1">
          <div class="flex items-center gap-[6px]">
            <span class="qcs-item__name flex-1 min-w-0 font-semibold text-[13px] text-(--color-text-primary) truncate font-mono">{{ row.name }}</span>
            <span class="qcs-item__type shrink-0 px-1 rounded-[2px] font-bold text-[4px] leading-[1.4] tracking-[0.02em]" :class="{ 'bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] text-[#4f5bcf]': row.dataType === 'numeric', 'bg-[color-mix(in_srgb,#9333ea_14%,transparent)] text-[#7c3aed]': row.dataType === 'categorical', 'bg-[color-mix(in_srgb,#16a34a_14%,transparent)] text-[#15803d]': row.dataType === 'boolean' }">
              {{ shortType(row.dataType) }}
            </span>
          </div>

          <div class="flex items-center gap-[6px] [font-variant-numeric:tabular-nums]">
            <div v-if="row.hasThreshold" class="qcs-item__bar flex-1 h-1 bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] rounded-full overflow-hidden">
              <div
                class="qcs-item__bar-fill h-full"
                :class="{ 'bg-[var(--color-status-warning-text)]': row.status === 'unhealthy' || row.status === 'warn', 'bg-[var(--color-status-success-text)]': row.status === 'healthy', 'bg-[color-mix(in_srgb,var(--color-text-secondary)_30%,transparent)]': row.status === 'noThreshold' }"
                :style="{ width: `${Math.min(100, row.unhealthyPct ?? 0)}%` }"
              />
            </div>
            <span v-if="row.hasThreshold" class="qcs-item__pct shrink-0 text-[11px] font-semibold text-(--color-warning-700)">{{ formatPct(row.unhealthyPct) }}</span>
            <span v-else class="qcs-item__pct--muted shrink-0 text-[11px] font-semibold text-(--color-text-secondary)">—</span>
            <span class="shrink-0 text-[11px] text-(--color-text-secondary)">{{ formatCount(row.totalScores) }}</span>
          </div>

          <svg
            v-if="row.trendSparkline.length > 0"
            class="qcs-item__spark w-full h-5"
            :class="{ 'text-[var(--color-status-warning-text)]': row.status === 'unhealthy' || row.status === 'warn', 'text-[var(--color-status-success-text)]': row.status === 'healthy', 'text-[color-mix(in_srgb,var(--color-text-secondary)_50%,transparent)]': row.status === 'noThreshold' }"
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

      <div v-if="filteredRows.length === 0" class="py-5 px-2 text-center text-xs text-text-secondary">
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
import OTag from "@/lib/core/Badge/OTag.vue";
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
