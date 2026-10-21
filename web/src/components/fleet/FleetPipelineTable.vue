<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    :frame="false"
    pagination="client"
    :page-size="5"
    :show-global-filter="false"
    :loading="loading"
    :error="error"
    :forbidden="forbidden"
    :row-class="(row: PipelineRow) => (row.id === selectedId ? 'bg-surface-tint-accent' : '')"
    data-test="fleet-pipeline-table"
    @row-click="(row: PipelineRow) => emit('select', row)"
  >
    <template #cell-fleet="{ row }">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="SEVERITY_DOT[row.severity]"
          :data-test="`fleet-pipeline-table-${row.id}-dot`"
        />
        <div class="flex min-w-0 flex-col">
          <OTruncatedText class="font-medium">{{ row.fleetName }}</OTruncatedText>
          <span class="text-text-secondary text-xs">{{ row.fleetMeta }}</span>
        </div>
      </div>
    </template>

    <template #cell-signal="{ row }">
      <OTag type="streamType" :value="row.signal" />
    </template>

    <template #cell-in="{ row }">
      <span class="tabular-nums" :class="row.inRate === null ? 'text-text-muted' : ''">{{
        rateText(row.inRate, row.signal)
      }}</span>
    </template>

    <template #cell-out="{ row }">
      <span class="tabular-nums" :class="row.outRate === null ? 'text-text-muted' : ''">{{
        rateText(row.outRate, row.signal)
      }}</span>
    </template>

    <template #cell-failed="{ row }">
      <span
        class="tabular-nums"
        :class="
          row.failedRatio === null || row.failedRatio === 0
            ? 'text-text-muted'
            : 'text-status-error-text'
        "
        :data-test="`fleet-pipeline-table-${row.id}-failed`"
        >{{ ratioText(row.failedRatio) }}</span
      >
    </template>

    <template #cell-queue="{ row }">
      <span
        class="tabular-nums"
        :class="
          row.queueRatio === null
            ? 'text-text-muted'
            : row.queueRatio >= QUEUE_WARNING
              ? 'text-status-warning-text'
              : ''
        "
        :data-test="`fleet-pipeline-table-${row.id}-queue`"
        >{{ ratioText(row.queueRatio) }}</span
      >
    </template>

    <template #empty>
      <div data-test="fleet-pipeline-table-empty">
        <OEmptyState
          size="block"
          preset="no-data"
          :filtered="filtered"
          @action="emit('clear-filters')"
        />
      </div>
    </template>

    <template #error>
      <div data-test="fleet-pipeline-table-error">
        <OEmptyState size="block" preset="load-error" @action="emit('retry')" />
      </div>
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { SEVERITY_DOT, percent, type PathSeverity } from "./flowIssues";
import { formatCount } from "./fleetFormat";
import type { Telemetry } from "./flowTypes";

export interface PipelineRow {
  id: string;
  fleet: string;
  fleetName: string;
  /** Version and collector count of the fleet. */
  fleetMeta: I18nText;
  name: string;
  signal: Telemetry;
  receivers: string;
  exporters: string;
  inRate: number | null;
  outRate: number | null;
  failedRatio: number | null;
  queueRatio: number | null;
  severity: PathSeverity;
}

defineProps<{
  rows: PipelineRow[];
  selectedId: string | null;
  filtered?: boolean;
  loading?: boolean;
  error?: string | null;
  forbidden?: boolean;
}>();
const emit = defineEmits<{
  select: [row: PipelineRow];
  retry: [];
  "clear-filters": [];
}>();

const QUEUE_WARNING = 0.8;
const DASH = raw("—");

const PER_SECOND: Record<Telemetry, I18nKey> = {
  logs: "fleet.flow.perSecond.logs",
  metrics: "fleet.flow.perSecond.metrics",
  traces: "fleet.flow.perSecond.traces",
};

const { t } = useI18nTyped();

const rateText = (rate: number | null, signal: Telemetry) =>
  rate === null ? DASH : t(PER_SECOND[signal], { value: raw(formatCount(rate)) });

const ratioText = (value: number | null) => (value === null ? DASH : percent(value));

const columns = computed<OTableColumnDef<PipelineRow>[]>(() => [
  { id: "fleet", header: t("fleet.pipelines.fleet"), accessorKey: "fleetName", size: 150 },
  { id: "name", header: t("fleet.pipelines.pipeline"), accessorKey: "name", size: 100 },
  { id: "receivers", header: t("fleet.pipelines.receivers"), accessorKey: "receivers", size: 130 },
  { id: "signal", header: t("fleet.pipelines.signal"), accessorKey: "signal", size: 100 },
  { id: "exporters", header: t("fleet.pipelines.exporters"), accessorKey: "exporters", size: 160 },
  { id: "in", header: t("fleet.pipelines.in"), accessorFn: (r) => r.inRate ?? -1, size: 110 },
  { id: "out", header: t("fleet.pipelines.out"), accessorFn: (r) => r.outRate ?? -1, size: 110 },
  {
    id: "failed",
    header: t("fleet.pipelines.failed"),
    accessorFn: (r) => r.failedRatio ?? -1,
    size: 80,
  },
  {
    id: "queue",
    header: t("fleet.pipelines.queue"),
    accessorFn: (r) => r.queueRatio ?? -1,
    size: 80,
  },
]);
</script>
