<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type {
  OTableColumnDef,
  OTablePaginationParams,
  OTableSortParams,
} from "@/lib/core/Table/OTable.types";
import type { NormalizedEvent } from "@/utils/security/ocsf";
import type { NavTable } from "@/utils/security/recordNav";
import {
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  type SeverityTone,
} from "@/utils/security/severity";

export type EventRow = NormalizedEvent & { _key: string; _tone: SeverityTone };

defineProps<{
  rows: EventRow[];
  columns: OTableColumnDef<EventRow>[];
  loading: boolean;
  error: string;
  page: number;
  pageSize: number;
  pageSizes: number[];
  total: number;
  totalExact: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  sqlMode: boolean;
  /** Computed SQL results: plain cells, no severity rail, nothing to open. */
  resultTable?: boolean;
  canShowTimeline: boolean;
  rowClass: (row: EventRow) => string;
  pivotFor: (row: EventRow, columnId: string) => { field: string; value: string } | null;
  emptyHint: I18nText;
  filtered: boolean;
  widerPeriod: string | null;
}>();
const emit = defineEmits<{
  "row-click": [row: EventRow];
  "pagination-change": [params: OTablePaginationParams];
  "sort-change": [params: OTableSortParams];
  refresh: [];
  "add-filter": [field: string, value: string, op: string];
  "empty-action": [id?: string];
}>();
const showRaw = defineModel<boolean>("showRaw", { required: true });
const showTimeline = defineModel<boolean>("showTimeline", { required: true });
const { t } = useI18nTyped();

const inner = ref<{ table?: NavTable<EventRow> } | null>(null);
// The page walks the table as displayed for the drawer's prev/next.
defineExpose({
  get table() {
    return inner.value?.table;
  },
});

function fmtTs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<template>
  <OTable
    ref="inner"
    :key="resultTable ? 'result' : showRaw ? 'raw' : 'normalized'"
    :data="rows"
    :columns="columns"
    row-key="_key"
    :loading="loading"
    :error="error || null"
    pagination="server"
    :current-page="page"
    :page-size="pageSize"
    :page-size-options="pageSizes"
    :total-count="total"
    :total-count-exact="totalExact"
    sorting="server"
    :sort-by="sortBy"
    :sort-order="sortOrder"
    :sort-disabled="sqlMode"
    :sort-disabled-reason="t('siem.events.sortSqlMode')"
    :show-global-filter="false"
    :persist-columns="!showRaw && !resultTable"
    :table-id="showRaw || resultTable ? undefined : 'security-events-normalized'"
    :enable-column-resize="true"
    :row-class="rowClass"
    :get-row-status-color="resultTable ? undefined : (r: EventRow) => severityRailColor(r._tone)"
    class="min-h-0 flex-1"
    data-test="security-events-table"
    @row-click="!resultTable && emit('row-click', $event)"
    @pagination-change="emit('pagination-change', $event)"
    @sort-change="emit('sort-change', $event)"
  >
    <template #toolbar>
      <div class="flex w-full items-center gap-3">
        <div class="flex-1" />
        <OButton
          v-if="canShowTimeline"
          variant="ghost"
          size="xs"
          :icon-left="showTimeline ? 'expand-less' : 'expand-more'"
          data-test="security-events-toggle-timeline"
          @click="showTimeline = !showTimeline"
        >
          {{ showTimeline ? t("siem.events.hideTimeline") : t("siem.events.showTimeline") }}
        </OButton>
        <OToggleGroup
          v-if="!resultTable"
          :model-value="showRaw ? 'raw' : 'normalized'"
          data-test="security-events-view"
          @update:model-value="(v: unknown) => (showRaw = v === 'raw')"
        >
          <OToggleGroupItem
            data-test="security-events-view-normalized"
            value="normalized"
            size="xs"
            :tooltip="t('siem.events.normalizedHint')"
          >
            {{ t("siem.events.normalized") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="raw" size="xs" data-test="security-events-view-raw">{{
            t("siem.events.raw")
          }}</OToggleGroupItem>
        </OToggleGroup>
      </div>
    </template>

    <template #cell-time="{ row }">
      <span class="text-text-secondary font-mono text-xs whitespace-nowrap">{{
        fmtTs(row.time)
      }}</span>
    </template>
    <template #cell-severityId="{ row }">
      <OTag
        type="severity"
        :value="severityTagValue(row._tone)"
        :label="t(toneLabelKey(row._tone))"
        size="xs"
      />
    </template>
    <template #cell-className="{ row }">
      <span class="text-text-heading truncate font-medium">{{ row.className || "—" }}</span>
    </template>
    <template #cell-statusId="{ row }">
      <OTag
        v-if="row.statusId === 1 || row.statusId === 2"
        :variant="row.statusId === 2 ? 'error-soft' : 'success-soft'"
        size="xs"
        >{{ t(`siem.outcome.${row.statusId === 2 ? "failure" : "success"}`) }}</OTag
      >
      <span v-else class="text-text-secondary">—</span>
    </template>
    <template #cell-srcIp="{ row }">
      <span class="truncate font-mono text-xs">{{ row.srcIp || "—" }}</span>
    </template>
    <template #cell-dstIp="{ row }">
      <span class="truncate font-mono text-xs">{{ row.dstIp || "—" }}</span>
    </template>

    <!-- Every value is a pivot: include or exclude it without leaving the row -->
    <template #cell-hover-actions="{ row, column, active }">
      <div
        v-if="active && pivotFor(row, column.id)"
        class="bg-surface-base border-border-default rounded-default flex items-center border"
      >
        <OButton
          :data-test="`security-events-pivot-include-${column.id}`"
          variant="ghost"
          size="icon-xs"
          icon-left="add-circle-outline"
          @click.stop="
            emit(
              'add-filter',
              pivotFor(row, column.id)!.field,
              pivotFor(row, column.id)!.value,
              '=',
            )
          "
        >
          <OTooltip :content="t('siem.pivot.include')" />
        </OButton>
        <OButton
          :data-test="`security-events-pivot-exclude-${column.id}`"
          variant="ghost"
          size="icon-xs"
          icon-left="block"
          @click.stop="
            emit(
              'add-filter',
              pivotFor(row, column.id)!.field,
              pivotFor(row, column.id)!.value,
              '!=',
            )
          "
        >
          <OTooltip :content="t('siem.pivot.exclude')" />
        </OButton>
      </div>
    </template>

    <template #toolbar-trailing>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="security-events-refresh"
        @click="emit('refresh')"
      >
        <OTooltip side="bottom" :content="t('siem.events.refresh')" />
      </OButton>
    </template>

    <template #empty>
      <OEmptyState
        v-if="!loading"
        size="block"
        icon="search-off"
        :title="t('siem.events.noEvents')"
        :description="emptyHint"
        :filtered="filtered"
        :action-label="
          widerPeriod ? t('siem.events.searchWider', { period: widerPeriod }) : undefined
        "
        action-icon="history"
        data-test="security-events-empty"
        @action="emit('empty-action', $event)"
      />
    </template>
  </OTable>
</template>
