<template>
  <section class="qsc-overview" data-test="quality-score-configs-overview">
    <header class="qsc-overview__head">
      <div class="qsc-overview__head-text">
        <h3 class="qsc-overview__title">{{ t("onlineEvals.quality.overview.title") }}</h3>
        <span class="qsc-overview__count">
          {{ t("onlineEvals.quality.overview.countSuffix", { n: filteredRows.length }) }}
        </span>
      </div>

      <OInput
        v-model="filter"
        :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
        size="sm"
        class="qsc-overview__filter"
        data-test="quality-overview-filter-input"
      >
        <template #icon-left>
          <OIcon name="search" size="xs" />
        </template>
      </OInput>
    </header>

    <div v-if="isLoading && rows.length === 0" class="qsc-overview__loading">
      <OSpinner size="sm" />
      <span>{{ t("onlineEvals.quality.overview.loading") }}</span>
    </div>

    <div v-else-if="rows.length === 0" class="qsc-overview__empty">
      <OIcon name="rule" size="lg" />
      <h4>{{ t("onlineEvals.quality.overview.emptyNoConfigsTitle") }}</h4>
      <p>{{ t("onlineEvals.quality.overview.emptyNoConfigsHint") }}</p>
    </div>

    <div v-else-if="allZeroScores && !isLoading" class="qsc-waiting" data-test="quality-overview-waiting">
      <div class="qsc-waiting__panel">
        <div class="qsc-waiting__icon-ring">
          <div class="qsc-waiting__icon-inner">
            <OIcon name="hourglass-top" size="lg" />
          </div>
          <span class="qsc-waiting__pulse qsc-waiting__pulse--a" />
          <span class="qsc-waiting__pulse qsc-waiting__pulse--b" />
        </div>

        <h4 class="qsc-waiting__title">
          {{ t("onlineEvals.quality.overview.emptyWaitingTitle") }}
        </h4>
        <p class="qsc-waiting__desc">
          {{ t("onlineEvals.quality.overview.emptyWaitingHint") }}
        </p>

        <div class="qsc-waiting__steps">
          <div class="qsc-waiting__step">
            <span class="qsc-waiting__step-num">1</span>
            <span>{{ t("onlineEvals.quality.overview.waitingStepJob") }}</span>
          </div>
          <div class="qsc-waiting__step">
            <span class="qsc-waiting__step-num">2</span>
            <span>{{ t("onlineEvals.quality.overview.waitingStepRange") }}</span>
          </div>
          <div class="qsc-waiting__step">
            <span class="qsc-waiting__step-num">3</span>
            <span>{{ t("onlineEvals.quality.overview.waitingStepRefresh") }}</span>
          </div>
        </div>

        <div class="qsc-waiting__actions">
          <OButton
            variant="primary"
            size="sm-action"
            icon-left="rocket-launch"
            data-test="quality-overview-waiting-jobs-cta"
            @click="goToJobs"
          >
            {{ t("onlineEvals.quality.overview.waitingPrimaryCta") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="refresh"
            data-test="quality-overview-waiting-refresh"
            @click="$emit('refresh')"
          >
            {{ t("onlineEvals.quality.overview.waitingRefreshCta") }}
          </OButton>
        </div>
      </div>
    </div>

    <div v-else class="qsc-overview__table-wrap">
      <OTable
        data-test="quality-overview-table"
        :data="filteredRows"
        :columns="columns"
        row-key="configId"
        :loading="isLoading"
        :row-class="rowClassOf"
        :footer-title="t('onlineEvals.quality.overview.title')"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100]"
        width="100%"
        class="tw:w-full tw:h-full"
        @row-click="(row: any) => $emit('select', row)"
      >
        <template #cell-status="{ row }">
          <span class="qsc-status" :class="`qsc-status--${row.status}`" :aria-label="row.status">
            <template v-if="row.status === 'unhealthy'">▲</template>
            <template v-else>●</template>
          </span>
        </template>

        <template #cell-name="{ row }">
          <div class="qsc-name">{{ row.name }}</div>
        </template>

        <template #cell-type="{ row }">
          <span class="qsc-type" :class="`qsc-type--${row.dataType}`">
            {{ shortType(row.dataType) }}
          </span>
        </template>

        <template #cell-totalScores="{ row }">
          <span class="qsc-mono">{{ formatCount(row.totalScores) }}</span>
        </template>

        <template #cell-coverage="{ row }">
          <span v-if="row.coveragePct != null" class="qsc-mono">{{ formatPct(row.coveragePct) }}</span>
          <span v-else class="qsc-muted">—</span>
        </template>

        <template #cell-unhealthy="{ row }">
          <span v-if="row.status === 'noData'" class="qsc-muted">—</span>
          <span v-else-if="!row.hasThreshold" class="qsc-no-threshold">
            {{ t("onlineEvals.quality.overview.noThreshold") }}
          </span>
          <div v-else class="qsc-unhealthy">
            <div class="qsc-bar">
              <div
                class="qsc-bar__fill"
                :style="{ width: `${Math.min(100, row.unhealthyPct ?? 0)}%` }"
              />
            </div>
            <span class="qsc-unhealthy__pct">{{ formatPct(row.unhealthyPct) }}</span>
            <span v-if="row.unhealthyCount != null" class="qsc-unhealthy__count">
              ({{ formatCount(row.unhealthyCount) }})
            </span>
          </div>
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
import OButton from "@/lib/core/Button/OButton.vue";
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

function goToJobs() {
  const query = { ...route.query, tab: "jobs" } as Record<string, any>;
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

const allZeroScores = computed(
  () => props.rows.length > 0 && props.rows.every((r) => r.totalScores === 0),
);

// De-emphasize configs that have no scores in the selected window. They
// stay visible (so users can spot a scorer they defined but never wired
// up) but visually recede beneath active rows.
function rowClassOf(row: ScoreConfigRow): string {
  return row.status === "noData" ? "qsc-row--no-data" : "";
}

const columns = computed(() => [
  {
    id: "status",
    header: "",
    accessorKey: "status",
    sortable: false,
    size: 40,
    meta: { align: "center" },
  },
  {
    id: "name",
    header: t("onlineEvals.quality.overview.columns.scoreConfig"),
    accessorKey: "name",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("onlineEvals.quality.overview.columns.type"),
    accessorKey: "dataType",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "totalScores",
    header: t("onlineEvals.quality.overview.columns.totalScores"),
    accessorKey: "totalScores",
    sortable: true,
    size: 120,
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
    id: "unhealthy",
    header: t("onlineEvals.quality.overview.columns.unhealthy"),
    accessorKey: "unhealthyPct",
    sortable: true,
    size: 200,
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
    size: 110,
    meta: { align: "left" },
  },
]);

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

.qsc-overview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.qsc-overview__head-text {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.qsc-overview__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary, currentColor);
}

.qsc-overview__count {
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.qsc-overview__filter {
  min-width: 220px;
  max-width: 320px;
}

.qsc-overview__loading,
.qsc-overview__empty {
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

.qsc-overview__empty h4 {
  margin: 6px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.qsc-overview__empty p {
  margin: 0;
  font-size: 12px;
  max-width: 460px;
}

/* — Waiting-for-scores empty state — */
.qsc-waiting {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 18px 16px 12px;
}

.qsc-waiting__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 22px 16px;
  max-width: 520px;
  width: 100%;
  border-radius: 8px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--o2-card-bg)) 0%,
    var(--o2-card-bg) 100%
  );
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  text-align: center;
}

.qsc-waiting__icon-ring {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.qsc-waiting__icon-inner {
  position: relative;
  z-index: 2;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 16%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.qsc-waiting__pulse {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--color-primary-600, #3F7994) 30%, transparent);
  opacity: 0;
  animation: qsc-pulse 2.6s ease-out infinite;
}

.qsc-waiting__pulse--b {
  animation-delay: 1.3s;
}

@keyframes qsc-pulse {
  0%   { transform: scale(0.7); opacity: 0.6; }
  70%  { transform: scale(1.2); opacity: 0; }
  100% { transform: scale(1.2); opacity: 0; }
}

.qsc-waiting__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: var(--color-text-primary, currentColor);
}

.qsc-waiting__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  max-width: 420px;
}

.qsc-waiting__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 440px;
  margin: 6px 0 2px;
}

.qsc-waiting__step {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
  border-radius: 5px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  text-align: left;
}

.qsc-waiting__step-num {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
  color: var(--color-primary-600, #3F7994);
  font-size: 9px;
  font-weight: 700;
  margin-top: 1px;
}

.qsc-waiting__actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  flex-wrap: wrap;
  justify-content: center;
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

.qsc-type {
  display: inline-flex;
  align-items: center;
  padding: 0 3px;
  border-radius: 2px;
  font-family: inherit;
  font-weight: 700;
  font-size: 9px;
  line-height: 14px;
  letter-spacing: 0.02em;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qsc-type--numeric {
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.qsc-type--categorical {
  background: color-mix(in srgb, #9333ea 14%, transparent);
  color: #7c3aed;
}

.qsc-type--boolean {
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #15803d;
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

/* Dim no-data rows so active scorers stand out. `:deep` because OTable
 * renders the <tr> outside this component's scope. */
:deep(tr.qsc-row--no-data) {
  opacity: 0.6;
}
:deep(tr.qsc-row--no-data:hover) {
  opacity: 0.85;
}
</style>
