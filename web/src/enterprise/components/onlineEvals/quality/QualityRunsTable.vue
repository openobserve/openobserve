<template>
  <section
    class="rounded-default border-border-default bg-surface-base overflow-hidden border"
    data-test="quality-runs-section"
  >
    <header
      class="border-border-default flex flex-wrap items-start justify-between gap-3 border-b px-3.5 py-3"
    >
      <div class="min-w-0">
        <h4 class="text-compact text-text-heading m-0 font-semibold">
          {{ t("onlineEvals.quality.runs.title") }}
        </h4>
        <p class="text-2xs text-text-secondary m-0 mt-0.5 max-w-[48rem] leading-relaxed">
          {{ t("onlineEvals.quality.runs.hint") }}
        </p>
      </div>

      <OToggleGroup
        :model-value="activeFilter"
        type="single"
        :aria-label="t('onlineEvals.quality.runs.filterLabel')"
        data-test="quality-runs-filter"
        @update:model-value="emit('filter-change', $event as QualityRunFilter)"
      >
        <OToggleGroupItem
          v-for="option in filterOptions"
          :key="option.id"
          :value="option.id"
          size="sm"
          :disabled="option.disabled"
          :data-test="`quality-runs-filter-${option.id}`"
        >
          <span>{{ option.label }}</span>
          <span
            class="bg-surface-subtle text-3xs text-text-secondary ml-1 rounded-full px-1.5 py-0.5 leading-none [font-variant-numeric:tabular-nums]"
          >
            {{ option.count }}
          </span>
        </OToggleGroupItem>
      </OToggleGroup>
    </header>

    <div
      v-if="!hasThreshold"
      class="border-border-default bg-surface-subtle text-2xs text-text-secondary flex items-center gap-2 border-b px-3.5 py-2"
      data-test="quality-runs-no-threshold"
    >
      <OIcon name="info" size="xs" class="shrink-0" />
      <span>{{ t("onlineEvals.quality.runs.noThresholdHint") }}</span>
    </div>

    <div
      v-if="error"
      class="border-border-default bg-status-error-bg text-2xs text-status-error-text flex items-center gap-2 border-b px-3.5 py-2"
      data-test="quality-runs-query-error"
    >
      <OIcon name="error" size="xs" class="shrink-0" />
      <span>{{ t("onlineEvals.quality.runs.queryError") }}</span>
    </div>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      pagination="server"
      sorting="none"
      :loading="isLoading"
      :fill-height="false"
      :frame="false"
      :show-global-filter="false"
      :page-size="pageSize"
      :current-page="currentPage"
      :total-count="totalCount"
      :page-size-options="[10, 20, 50]"
      :footer-title="t('onlineEvals.quality.runs.footerTitle')"
      :empty-message="emptyMessage"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="quality-config-scores-v1"
      :row-class="runRowClass"
      :get-row-status-color="runStatusColor"
      data-test="quality-runs-table"
      @row-click="openRun"
      @pagination-change="emit('pagination-change', $event)"
    >
      <template #cell-timestampMs="{ row }">
        <span
          class="text-2xs text-text-secondary whitespace-nowrap [font-variant-numeric:tabular-nums]"
          >{{ formatTimestamp(row.timestampMs) }}</span
        >
      </template>

      <template #cell-resultDisplay="{ row }">
        <div class="flex flex-col items-start gap-0.5 leading-tight">
          <span
            class="font-semibold [font-variant-numeric:tabular-nums]"
            :class="row.isUnhealthy ? 'text-status-error-text' : 'text-text-heading'"
          >
            {{ row.resultDisplay }}
          </span>
          <span
            v-if="row.health !== 'unclassified'"
            class="text-3xs"
            :class="row.isUnhealthy ? 'text-status-error-text' : 'text-status-success-text'"
          >
            {{ t(`onlineEvals.quality.runs.health.${row.health}`) }}
          </span>
        </div>
      </template>

      <template #cell-reasoning="{ row }">
        <span
          class="text-2xs text-text-secondary block max-w-full truncate"
          :title="reasoningFor(row)"
        >
          {{ reasoningFor(row) }}
        </span>
      </template>

      <template #cell-targetId="{ row }">
        <div class="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
          <span class="text-3xs text-text-tertiary font-medium tracking-wide uppercase">
            {{ scopeLabel(row.targetScope) }}
          </span>
          <span
            class="text-3xs text-text-heading max-w-full truncate font-mono"
            :title="targetIdentity(row)"
          >
            {{ shortId(targetIdentity(row)) }}
          </span>
        </div>
      </template>

      <template #cell-agentName="{ row }">
        <div class="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
          <span class="text-2xs text-text-heading max-w-full truncate" :title="agentLabel(row)">
            {{ agentLabel(row) }}
          </span>
          <span
            v-if="row.agentName && row.agentId"
            class="text-3xs text-text-tertiary max-w-full truncate font-mono"
            :title="row.agentId"
          >
            {{ shortId(row.agentId) }}
          </span>
          <OAgentBadges
            :env="row.agentEnv"
            :version="row.agentVersion"
            data-test="quality-runs-agent-badges"
          />
        </div>
      </template>
    </OTable>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OAgentBadges from "@/components/shared/OAgentBadges.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import type {
  QualityRunCounts,
  QualityRunFilter,
  QualityRunRow,
  QualityRunsPagination,
} from "../composables/useQualityRuns";
import { thresholdForConfig } from "../utils/scoreThreshold";

const props = defineProps<{
  config: ScoreConfig;
  rows: QualityRunRow[];
  counts: QualityRunCounts;
  activeFilter: QualityRunFilter;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (event: "open-run", row: QualityRunRow): void;
  (event: "filter-change", filter: QualityRunFilter): void;
  (event: "pagination-change", pagination: QualityRunsPagination): void;
}>();

const { t } = useI18n();

const hasThreshold = computed(() => thresholdForConfig(props.config).unhealthyExpr != null);

const filterOptions = computed(() => [
  {
    id: "all" as const,
    label: t("onlineEvals.quality.runs.filters.all"),
    count: props.counts.all,
    disabled: false,
  },
  {
    id: "unhealthy" as const,
    label: t("onlineEvals.quality.runs.filters.unhealthy"),
    count: props.counts.unhealthy ?? 0,
    disabled: !hasThreshold.value,
  },
]);

const emptyMessage = computed(() =>
  props.activeFilter === "unhealthy"
    ? t("onlineEvals.quality.runs.emptyUnhealthy")
    : t("onlineEvals.quality.runs.empty"),
);

const columns = computed(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.quality.runs.columns.time"),
    accessorKey: "timestampMs",
    sortable: false,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "resultDisplay",
    header: t("onlineEvals.quality.runs.columns.result"),
    accessorKey: "resultDisplay",
    sortable: false,
    size: 135,
    meta: { align: "left" },
  },
  {
    id: "reasoning",
    header: t("onlineEvals.quality.runs.columns.reasoning"),
    accessorKey: "reasoning",
    sortable: false,
    hideable: true,
    size: 380,
    meta: { align: "left", flex: true },
  },
  {
    id: "targetId",
    header: t("onlineEvals.quality.runs.columns.target"),
    accessorKey: "targetId",
    sortable: false,
    hideable: true,
    size: 190,
    meta: { align: "left" },
  },
  {
    id: "agentName",
    header: t("onlineEvals.quality.runs.columns.agent"),
    accessorKey: "agentName",
    sortable: false,
    hideable: true,
    size: 180,
    meta: { align: "left" },
  },
]);

function runRowClass(row: QualityRunRow): string {
  return [
    canOpen(row) ? "cursor-pointer" : "",
    row.isUnhealthy
      ? "[background:linear-gradient(90deg,color-mix(in_srgb,var(--color-status-error-bg)_85%,transparent)_0%,transparent_82%)] [&>td]:bg-transparent"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function runStatusColor(row: QualityRunRow): string | undefined {
  return row.isUnhealthy ? "var(--color-status-error-text)" : undefined;
}

function canOpen(row: QualityRunRow): boolean {
  return Boolean(row.evaluatorTraceId);
}

function openRun(row: QualityRunRow) {
  if (canOpen(row)) emit("open-run", row);
}

function formatTimestamp(timestampMs: number): string {
  if (!timestampMs) return "—";
  return new Date(timestampMs).toLocaleString();
}

function reasoningFor(row: QualityRunRow): string {
  return row.reasoning || t("onlineEvals.quality.runs.noReasoning");
}

function agentLabel(row: QualityRunRow): string {
  return row.agentName || row.agentId || t("onlineEvals.quality.runs.unknownAgent");
}

function scopeLabel(scope: QualityRunRow["targetScope"]): string {
  if (scope === "unknown") return t("onlineEvals.quality.runs.unknownScope");
  return t(`onlineEvals.quality.scopes.${scope}`);
}

function targetIdentity(row: QualityRunRow): string {
  if (row.targetScope === "span") return row.targetSpanId || row.targetId;
  if (row.targetScope === "trace") return row.targetTraceId || row.targetId;
  if (row.targetScope === "session") return row.targetSessionId || row.targetId;
  return row.targetId;
}

function shortId(value: string): string {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
</script>
