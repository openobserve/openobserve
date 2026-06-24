<template>
  <section class="qsc-overview" data-test="quality-score-configs-overview">
    <div v-if="isLoading && rows.length === 0" class="qsc-overview__loading">
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.overview.loading") }}</span>
    </div>

    <div
      v-else-if="rows.length === 0"
      class="tw:flex-1 tw:min-h-0 tw:flex tw:items-center tw:justify-center"
      data-test="quality-overview-empty"
    >
      <OEmptyState
        size="hero"
        preset="no-score-configs"
        @action="onEmptyAction"
      />
    </div>

    <!-- The previous "waiting for scores" empty card (allZeroScores) is
         intentionally gone: as long as at least one score config exists,
         we render the table so the user sees the configured shapes. Each
         row already handles the no-data case (status === 'noData' → "—")
         so a fresh setup reads as "configs are here, scores will fill in"
         rather than a blank screen. -->

    <div v-else class="qsc-overview__table-wrap">
      <OTable
        data-test="quality-overview-table"
        :data="filteredRows"
        :columns="columns"
        row-key="configId"
        :loading="isLoading"
        :footer-title="t('onlineEvals.quality.overview.title')"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="quality-score-configs"
        width="100%"
        class="tw:w-full tw:h-full"
        @row-click="(row: any) => $emit('select', row)"
      >
        <!-- Filter moved into the table toolbar so OTable's column chooser
             ("Manage columns") renders next to it, matching the eval lists. -->
        <template #toolbar>
          <OInput
            v-model="filter"
            :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
            size="sm"
            class="tw:flex-1 tw:min-w-0"
            data-test="quality-overview-filter-input"
          >
            <template #icon-left>
              <OIcon name="search" size="xs" />
            </template>
          </OInput>
        </template>

        <template #cell-status="{ row }">
          <span class="qsc-status" :class="`qsc-status--${row.status}`" :aria-label="row.status">●</span>
        </template>

        <template #cell-name="{ row }">
          <div
            class="qsc-name"
            :class="{ 'qsc-name--no-data': row.status === 'noData' }"
          >
            {{ row.name }}
          </div>
        </template>

        <template #cell-type="{ row }">
          <OBadge
            v-if="shortType(row.dataType) !== '—'"
            :variant="dataTypeBadgeVariant(row.dataType)"
            size="sm"
          >
            {{ row.dataType }}
          </OBadge>
          <span v-else class="qsc-muted">—</span>
        </template>

        <template #cell-totalScores="{ row }">
          <span class="qsc-mono">{{ formatCount(row.totalScores) }}</span>
        </template>

        <template #cell-coverage="{ row }">
          <span v-if="row.coveragePct != null" class="qsc-mono">{{ formatPct(row.coveragePct) }}</span>
          <span v-else class="qsc-muted">—</span>
        </template>

        <template #cell-trend="{ row }">
          <svg
            v-if="row.trendSparkline.length > 0"
            class="qsc-spark"
            :class="`qsc-spark--${row.status}`"
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
          <span v-else class="qsc-muted">—</span>
        </template>

        <template #cell-updated="{ row }">
          <span v-if="row.lastUpdatedMs" class="qsc-updated">
            {{ relativeTime(row.lastUpdatedMs) }}
          </span>
          <span v-else class="qsc-muted">—</span>
        </template>
      </OTable>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { useRoute, useRouter } from "vue-router";
import type { ScoreConfigRow } from "../composables/useQualityScoreConfigs";

const props = defineProps<{
  rows: ScoreConfigRow[];
  isLoading: boolean;
}>();

defineEmits<{
  (e: "select", row: ScoreConfigRow): void;
  (e: "refresh"): void;
}>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const filter = ref("");

// The "Create score config" CTA in the empty state can't be handled inline
// (the create dialog lives in the Score Configs tab's OnlineEvals shell).
// We hop tabs + set `action=add` so OnlineEvals's URL→state machine opens
// the create form on landing.
function onEmptyAction(id?: string) {
  if (id !== "create") return;
  const query: Record<string, any> = {
    ...route.query,
    tab: "scoreConfigs",
    action: "add",
  };
  delete query.config;
  router.push({ name: route.name as string, query }).catch(() => {});
}

const filteredRows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return props.rows;
  return props.rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
});

const columns = computed(() => [
  {
    id: "status",
    header: "",
    accessorKey: "status",
    sortable: false,
    size: 40,
    // Fixed-width status dot — no resize grip (OTable reads `resizable`).
    resizable: false,
    meta: { align: "center" },
  },
  {
    id: "name",
    header: t("onlineEvals.quality.overview.columns.scoreConfig"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    // `flex` (not `autoWidth`): fills leftover width AND stays resizable.
    meta: { align: "left", flex: true },
  },
  {
    id: "type",
    header: t("onlineEvals.quality.overview.columns.type"),
    accessorKey: "dataType",
    sortable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "totalScores",
    header: t("onlineEvals.quality.overview.columns.totalScores"),
    accessorKey: "totalScores",
    sortable: true,
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "coverage",
    header: t("onlineEvals.quality.overview.columns.coverage"),
    accessorKey: "coveragePct",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "trend",
    header: t("onlineEvals.quality.overview.columns.trend"),
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "updated",
    header: t("onlineEvals.quality.overview.columns.updated"),
    accessorKey: "lastUpdatedMs",
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
].map((c: any) => ({
  ...c,
  // Offer every column except the name and the leading status dot in the
  // "Manage columns" chooser.
  hideable: c.id !== "name" && c.id !== "status",
})));

function shortType(type: ScoreConfigRow["dataType"]): string {
  if (type === "numeric") return "Num";
  if (type === "categorical") return "Cat";
  if (type === "boolean") return "Bool";
  return "—";
}

// Map a score-config data type to a neutral design-system OBadge soft variant
// (numeric → blue, categorical → purple, boolean → teal). Data types are just
// labels, so use neutral palette colors rather than semantic variants.
function dataTypeBadgeVariant(type: ScoreConfigRow["dataType"]) {
  if (type === "categorical") return "purple-soft" as const;
  if (type === "boolean") return "teal-soft" as const;
  return "blue-soft" as const; // numeric
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
  return `${n.toFixed(1)}%`;
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

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}
</script>

<style lang="scss" scoped>
.qsc-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}

.qsc-overview__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 12px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  text-align: center;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qsc-overview__table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.qsc-status {
  display: inline-flex;
  font-size: 16px;
  line-height: 1;
}

.qsc-status--unhealthy { color: var(--o2-status-warning-text, #b25400); }
.qsc-status--warn { color: var(--o2-status-warning-text, #b25400); opacity: 0.7; }
.qsc-status--healthy { color: var(--o2-status-success-text, #2e7d32); }
.qsc-status--noThreshold { color: var(--color-text-secondary, var(--o2-text-secondary)); }
.qsc-status--noData { color: var(--color-text-secondary, var(--o2-text-secondary)); opacity: 0.55; }

.qsc-name {
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

/* De-emphasize the name of configs that have no scores in the selected
 * window. The row stays at full opacity (so counts/coverage stay readable);
 * only the name recedes to flag the inactive scorer. */
.qsc-name--no-data {
  opacity: 0.55;
}

.qsc-mono {
  font-variant-numeric: tabular-nums;
}

.qsc-no-threshold {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.qsc-unhealthy {
  display: flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.qsc-bar {
  flex: 0 0 80px;
  height: 6px;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  border-radius: 999px;
  overflow: hidden;
}

.qsc-bar__fill {
  height: 100%;
  background: var(--o2-status-warning-text, #b25400);
}

.qsc-unhealthy__pct {
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.qsc-unhealthy__count {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qsc-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qsc-updated {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.qsc-spark {
  width: 100%;
  height: 20px;
  color: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}

.qsc-spark--unhealthy { color: var(--o2-status-warning-text, #b25400); }
.qsc-spark--healthy { color: var(--o2-status-success-text, #2e7d32); }
.qsc-spark--warn { color: var(--o2-status-warning-text, #b25400); }
.qsc-spark--noThreshold { color: var(--color-text-secondary, var(--o2-text-secondary)); }
.qsc-spark--noData { color: var(--color-text-secondary, var(--o2-text-secondary)); opacity: 0.55; }
</style>
