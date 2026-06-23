<template>
  <aside class="qcs" data-test="quality-config-sidebar">
    <header class="qcs__head">
      <span class="qcs__title">{{ t("onlineEvals.quality.overview.title") }}</span>
      <span class="qcs__count">{{ filteredRows.length }}</span>
    </header>

    <OInput
      v-model="filter"
      :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
      size="sm"
      class="qcs__filter"
      data-test="quality-sidebar-filter"
    >
      <template #icon-left>
        <OIcon name="search" size="xs" />
      </template>
    </OInput>

    <button
      type="button"
      class="qcs__all"
      data-test="quality-sidebar-all-configs"
      @click="$emit('clear')"
    >
      <OIcon name="chevron-left" size="xs" />
      {{ t("onlineEvals.quality.sidebar.allConfigs") }}
    </button>

    <div class="qcs__list">
      <button
        v-for="row in filteredRows"
        :key="row.configId"
        type="button"
        class="qcs-item"
        :class="{ 'qcs-item--selected': String(row.config.id) === selectedId }"
        :data-test="`quality-sidebar-item-${row.name}`"
        @click="$emit('select', row)"
      >
        <span class="qcs-item__status" :class="`qcs-item__status--${row.status}`">
          <template v-if="row.status === 'unhealthy'">▲</template>
          <template v-else>●</template>
        </span>

        <div class="qcs-item__main">
          <div class="qcs-item__row">
            <span class="qcs-item__name">{{ row.name }}</span>
            <span class="qcs-item__type" :class="`qcs-item__type--${row.dataType}`">
              {{ shortType(row.dataType) }}
            </span>
          </div>

          <div class="qcs-item__row qcs-item__row--meta">
            <div v-if="row.hasThreshold" class="qcs-item__bar">
              <div
                class="qcs-item__bar-fill"
                :class="`qcs-item__bar-fill--${row.status}`"
                :style="{ width: `${Math.min(100, row.unhealthyPct ?? 0)}%` }"
              />
            </div>
            <span v-if="row.hasThreshold" class="qcs-item__pct">{{ formatPct(row.unhealthyPct) }}</span>
            <span v-else class="qcs-item__pct qcs-item__pct--muted">—</span>
            <span class="qcs-item__count">{{ formatCount(row.totalScores) }}</span>
          </div>

          <svg
            v-if="row.trendSparkline.length > 0"
            class="qcs-item__spark"
            :class="`qcs-item__spark--${row.status}`"
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

      <div v-if="filteredRows.length === 0" class="qcs__empty">
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

<style lang="scss" scoped>
.qcs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 12px 16px;
  background: var(--o2-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  min-height: 0;
  max-height: calc(100vh - var(--navbar-height) - 200px);
  overflow: hidden;
}

.qcs__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.qcs__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qcs__count {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}

.qcs__filter {
  width: 100%;
}

.qcs__all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  padding: 2px 0;
  font-size: 12px;
  color: var(--color-primary-600, #3F7994);
  cursor: pointer;
  width: max-content;
}

.qcs__all:hover { text-decoration: underline; }

.qcs__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.qcs-item {
  display: flex;
  gap: 8px;
  padding: 10px 10px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  width: 100%;
  font: inherit;
  color: inherit;
  transition: background 0.12s, border-color 0.12s;
}

.qcs-item:hover {
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
}

.qcs-item--selected {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 14%, transparent);
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 45%, transparent);
  position: relative;
}

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

.qcs-item--selected .qcs-item__name {
  color: var(--color-primary-600, #3F7994);
}

.qcs-item__status {
  flex: 0 0 14px;
  display: inline-flex;
  align-items: flex-start;
  padding-top: 2px;
  font-size: 13px;
  line-height: 1;
}

.qcs-item__status--unhealthy { color: var(--o2-status-warning-text, #b25400); }
.qcs-item__status--warn { color: var(--o2-status-warning-text, #b25400); opacity: 0.75; }
.qcs-item__status--healthy { color: var(--o2-status-success-text, #2e7d32); }
.qcs-item__status--noThreshold { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.qcs-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.qcs-item__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qcs-item__row--meta {
  font-variant-numeric: tabular-nums;
}

.qcs-item__name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qcs-item__type {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 2px;
  font: 700 4px/1.4 inherit;
  letter-spacing: 0.02em;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qcs-item__type--numeric {
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qcs-item__type--categorical {
  background: color-mix(in srgb, #9333ea 14%, transparent);
  color: #7c3aed;
}

.qcs-item__type--boolean {
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #15803d;
}

.qcs-item__bar {
  flex: 1;
  height: 4px;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  border-radius: 999px;
  overflow: hidden;
}

.qcs-item__bar-fill {
  height: 100%;
}

.qcs-item__bar-fill--unhealthy { background: var(--o2-status-warning-text, #b25400); }
.qcs-item__bar-fill--healthy { background: var(--o2-status-success-text, #2e7d32); }
.qcs-item__bar-fill--warn { background: var(--o2-status-warning-text, #b25400); }
.qcs-item__bar-fill--noThreshold { background: color-mix(in srgb, var(--color-text-secondary) 30%, transparent); }

.qcs-item__pct {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--o2-status-warning-text, #b25400);
}

.qcs-item__pct--muted { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.qcs-item__count {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qcs-item__spark {
  width: 100%;
  height: 20px;
  color: color-mix(in srgb, var(--color-text-secondary) 50%, transparent);
}

.qcs-item__spark--unhealthy { color: var(--o2-status-warning-text, #b25400); }
.qcs-item__spark--healthy { color: var(--o2-status-success-text, #2e7d32); }
.qcs-item__spark--warn { color: var(--o2-status-warning-text, #b25400); }

.qcs__empty {
  padding: 20px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
