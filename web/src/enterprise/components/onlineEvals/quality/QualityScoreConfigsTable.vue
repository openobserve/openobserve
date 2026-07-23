<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2.5" data-test="quality-score-configs-overview">
    <!-- The previous "waiting for scores" empty card (allZeroScores) is
         intentionally gone: as long as at least one score config exists,
         we render the table so the user sees the configured shapes. Each
         row already handles the no-data case (status === 'noData' → "—")
         so a fresh setup reads as "configs are here, scores will fill in"
         rather than a blank screen. -->

    <div class="flex min-h-0 flex-1 flex-col">
      <OTable
        data-test="quality-overview-table"
        :data="filteredRows"
        :columns="columns"
        row-key="configId"
        :loading="isLoading"
        :footer-title="t('onlineEvals.quality.overview.title')"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        :column-visibility="defaultColumnVisibility"
        table-id="quality-score-configs-v2"
        width="100%"
        class="w-full h-full"
        @row-click="(row: any) => $emit('select', row)"
      >
        <!-- Filter moved into the table toolbar so OTable's column chooser
             ("Manage columns") renders next to it, matching the eval lists. -->
        <template #toolbar>
          <OSearchInput
            v-model="filter"
            :placeholder="t('onlineEvals.quality.overview.searchPlaceholder')"
            size="sm"
            class="flex-1 min-w-0"
            data-test="quality-overview-filter-input"
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="isLoading"
            data-test="quality-overview-refresh-btn"
            @click="emit('refresh')"
          >
            <OTooltip
              side="bottom"
              :content="t('common.refresh')"
              shortcut-id="qualityOverviewRefresh"
            />
          </OButton>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8" data-test="quality-overview-empty">
            <OEmptyState
              size="hero"
              preset="no-score-configs"
              :filtered="Boolean(filter.trim())"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #cell-status="{ row }">
          <div
            class="flex min-w-0 flex-col items-start gap-0.5 leading-tight"
            data-test="quality-overview-health"
          >
            <OTag
              type="qualityStatus"
              :value="row.status"
              :label="t(`onlineEvals.quality.overview.status.${row.status}`)"
              :aria-label="t(`onlineEvals.quality.overview.status.${row.status}`)"
            />
            <span
              class="max-w-full truncate text-3xs text-text-secondary"
              :title="healthSummary(row)"
            >
              {{ healthSummary(row) }}
            </span>
          </div>
        </template>

        <template #cell-name="{ row }">
          <div class="font-semibold text-text-heading">
            {{ row.name }}
          </div>
        </template>

        <template #cell-type="{ row }">
          <OTag v-if="row.dataType !== 'unknown'" type="evalDataType" :value="row.dataType" />
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-totalScores="{ row }">
          <span class="[font-variant-numeric:tabular-nums]">{{
            formatCount(row.totalScores)
          }}</span>
        </template>

        <template #cell-quality="{ row }">
          <div
            v-if="row.qualityValue != null"
            class="flex flex-col leading-tight"
            data-test="quality-overview-quality"
          >
            <span class="font-semibold [font-variant-numeric:tabular-nums]">
              {{ formatQuality(row) }}
            </span>
            <span
              v-if="row.qualityLabel"
              class="mt-0.5 whitespace-normal text-3xs font-normal leading-tight text-text-secondary"
            >
              {{ row.qualityLabel }}
            </span>
          </div>
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-scopeMix="{ row }">
          <div
            v-if="scopeItems(row).length > 0"
            class="flex flex-wrap gap-1"
            data-test="quality-overview-scope-mix"
          >
            <span
              v-for="scope in scopeItems(row)"
              :key="scope.id"
              class="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-base px-1.5 py-0.5 text-3xs leading-none text-text-secondary [font-variant-numeric:tabular-nums]"
              :data-test="`quality-overview-scope-${scope.id}`"
            >
              <span>{{ t(`onlineEvals.quality.scopes.${scope.id}`) }}</span>
              <span class="font-semibold text-text-heading">{{ formatCount(scope.count) }}</span>
            </span>
          </div>
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-volumeTrend="{ row }">
          <svg
            v-if="row.trendSparkline.length > 0"
            class="w-full h-5"
            :class="sparkClass(row.status)"
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
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-updated="{ row }">
          <span
            v-if="row.lastUpdatedMs"
            class="text-2xs text-text-secondary [font-variant-numeric:tabular-nums]"
          >
            {{ relativeTime(row.lastUpdatedMs) }}
          </span>
          <span v-else class="text-text-secondary">—</span>
        </template>
      </OTable>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { useRoute, useRouter } from "vue-router";
import type { ScoreConfigRow } from "../composables/useQualityScoreConfigs";

const props = defineProps<{
  rows: ScoreConfigRow[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
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
  if (id === "clear-filters") {
    filter.value = "";
    return;
  }
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

function sparkClass(status: string): string {
  if (status === "unhealthy" || status === "warn") return "text-status-warning-text";
  if (status === "healthy") return "text-status-success-text";
  if (status === "noData") return "text-text-secondary opacity-[0.55]";
  return "text-text-secondary";
}

const defaultColumnVisibility = {
  status: true,
  name: true,
  type: true,
  quality: true,
  totalScores: true,
  scopeMix: true,
  volumeTrend: true,
  updated: true,
};

const columns = computed(() =>
  [
    {
      id: "status",
      header: t("onlineEvals.quality.overview.columns.health"),
      accessorFn: (row: ScoreConfigRow) => row.statusPriority,
      sortable: true,
      size: 190,
      meta: { align: "left" },
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
      id: "quality",
      header: t("onlineEvals.quality.overview.columns.quality"),
      accessorKey: "qualityValue",
      sortable: true,
      size: 170,
      meta: { align: "right" },
    },
    {
      id: "totalScores",
      header: t("onlineEvals.quality.overview.columns.totalScores"),
      accessorKey: "totalScores",
      sortable: true,
      size: COL.count,
      meta: { align: "right" },
    },
    {
      id: "scopeMix",
      header: t("onlineEvals.quality.overview.columns.scopeMix"),
      sortable: false,
      size: 240,
      meta: { align: "left" },
    },
    {
      id: "volumeTrend",
      header: t("onlineEvals.quality.overview.columns.volumeTrend"),
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
  })),
);

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatQuality(row: ScoreConfigRow): string {
  const value = row.qualityValue;
  if (value == null) return "—";
  if (row.qualityFormat === "text" || typeof value === "string") {
    return String(value);
  }
  if (row.qualityFormat === "percent") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function healthSummary(row: ScoreConfigRow): string {
  if (row.status === "noData") {
    return t("onlineEvals.quality.overview.health.noDataHint");
  }
  if (!row.hasThreshold) {
    return t("onlineEvals.quality.overview.health.noThresholdHint");
  }
  return t("onlineEvals.quality.overview.health.thresholdSummary", {
    percent: (row.unhealthyPercent ?? 0).toFixed(1),
    threshold: row.thresholdLabel,
  });
}

function scopeItems(row: ScoreConfigRow) {
  return (["span", "trace", "session"] as const)
    .map((id) => ({ id, count: row.scopeCounts[id] }))
    .filter((scope) => scope.count > 0);
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
  if (diff < 0) return t("refreshButton.justNow");
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("refreshButton.secondsAgo", { sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("refreshButton.minutesAgo", { min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("refreshButton.hoursAgo", { h: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return t("onlineEvals.quality.overview.relativeTime.daysAgo", { day });
  }
  const mo = Math.floor(day / 30);
  return t("onlineEvals.quality.overview.relativeTime.monthsAgo", {
    month: mo,
  });
}
</script>
