<template>
  <section class="tw:flex tw:flex-col tw:gap-[10px] tw:min-h-0 tw:flex-1" data-test="quality-score-configs-overview">
    <div v-if="isLoading && rows.length === 0" class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-8 tw:px-3 tw:border tw:border-dashed tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:rounded-md tw:text-center tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
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

    <div v-else class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col">
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
          <span class="tw:inline-flex tw:text-base tw:leading-none" :class="statusClass(row.status)" :aria-label="row.status">●</span>
        </template>

        <template #cell-name="{ row }">
          <div class="tw:font-semibold tw:text-[var(--color-text-primary,currentColor)]">{{ row.name }}</div>
        </template>

        <template #cell-type="{ row }">
          <OBadge
            v-if="shortType(row.dataType) !== '—'"
            :variant="dataTypeBadgeVariant(row.dataType)"
            size="sm"
          >
            {{ row.dataType }}
          </OBadge>
          <span v-else class="tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">—</span>
        </template>

        <template #cell-totalScores="{ row }">
          <span class="tw:[font-variant-numeric:tabular-nums]">{{ formatCount(row.totalScores) }}</span>
        </template>

        <template #cell-coverage="{ row }">
          <span v-if="row.coveragePct != null" class="tw:[font-variant-numeric:tabular-nums]">{{ formatPct(row.coveragePct) }}</span>
          <span v-else class="tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">—</span>
        </template>

        <template #cell-trend="{ row }">
          <svg
            v-if="row.trendSparkline.length > 0"
            class="tw:w-full tw:h-5"
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
          <span v-else class="tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">—</span>
        </template>

        <template #cell-updated="{ row }">
          <span v-if="row.lastUpdatedMs" class="tw:text-[11px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:[font-variant-numeric:tabular-nums]">
            {{ relativeTime(row.lastUpdatedMs) }}
          </span>
          <span v-else class="tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">—</span>
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

// De-emphasize configs that have no scores in the selected window. They
// stay visible (so users can spot a scorer they defined but never wired
// up) but visually recede beneath active rows.
function statusClass(status: string): string {
  if (status === 'unhealthy') return 'tw:text-[var(--o2-status-warning-text,#b25400)]';
  if (status === 'warn') return 'tw:text-[var(--o2-status-warning-text,#b25400)] tw:opacity-[0.7]';
  if (status === 'healthy') return 'tw:text-[var(--o2-status-success-text,#2e7d32)]';
  if (status === 'noData') return 'tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:opacity-[0.55]';
  return 'tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]';
}

function sparkClass(status: string): string {
  if (status === 'unhealthy' || status === 'warn') return 'tw:text-[var(--o2-status-warning-text,#b25400)]';
  if (status === 'healthy') return 'tw:text-[var(--o2-status-success-text,#2e7d32)]';
  if (status === 'noData') return 'tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:opacity-[0.55]';
  return 'tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]';
}

function rowClassOf(row: ScoreConfigRow): string {
  return row.status === "noData" ? "tw:opacity-[0.6] tw:hover:opacity-[0.85]" : "";
}

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
    meta: { align: "right" },
  },
  {
    id: "coverage",
    header: t("onlineEvals.quality.overview.columns.coverage"),
    accessorKey: "coveragePct",
    sortable: true,
    size: 110,
    meta: { align: "right" },
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
