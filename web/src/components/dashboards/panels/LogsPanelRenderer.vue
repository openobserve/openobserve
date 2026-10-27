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
  <div class="flex h-full min-h-0 w-full flex-col" data-test="dashboard-logs-panel">
    <OTable
      class="logs-panel-table min-h-0 w-full flex-1"
      :columns="columns"
      :data="sourceRows"
      :wrap="wrap"
      :cell-overflow-tooltip="false"
      :row-key="rowKey"
      :row-height="20"
      virtual-scroll
      measure-expanded-rows
      :default-columns="false"
      :show-global-filter="false"
      :frame="false"
      pagination="none"
      sorting="none"
      :pinned-first-column="timeColumnId"
      :enable-column-resize="true"
      :get-row-status-color="rowStatusColor"
      expansion="multiple"
      :expanded-ids="expandedIds"
      data-test="dashboard-logs-panel-table"
      @update:expanded-ids="(ids: string[]) => (expandedIds = ids)"
      @row-click="toggleRow"
    >
      <!-- Empty slot opts out of OTable's default banner, as the logs table does. -->
      <template #loading-banner />

      <template v-for="col in columns" :key="col.id" #[`cell-${col.id}`]="{ row, value }">
        <span
          v-if="cellHtml(col.id, row)"
          class="log-cell-html"
          :data-test="`dashboard-logs-panel-cell-${col.id}`"
          v-html="cellHtml(col.id, row)"
        />
        <span v-else :data-test="`dashboard-logs-panel-cell-${col.id}`">{{ value }}</span>
      </template>

      <template #expansion="{ row }">
        <JsonPreview
          v-if="prettify"
          :value="row"
          mode="expanded"
          class="px-2 py-1.5"
          hide-view-related
          hide-view-trace
          hide-search-term-actions
          hide-field-options
          hide-add-field-to-table
          data-test="dashboard-logs-panel-json"
          @copy="copyRow"
        />
        <OCodeBlock
          v-else
          class="px-2 py-1.5"
          lang="json"
          wrap
          :code="JSON.stringify(row)"
          data-test="dashboard-logs-panel-json"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import JsonPreview from "@/plugins/logs/JsonPreview.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
import { severityIndicatorColor } from "@/utils/logs/statusParser";
import { byString } from "@/utils/json";
import { copyToClipboard } from "@/utils/clipboard";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  toEpochMillis,
  type LogsPanelFields,
  type LogsPanelRow,
} from "@/utils/dashboard/convertLogsPanelData";

const props = defineProps<{
  data: { rows?: LogsPanelRow[]; fields?: LogsPanelFields } | null | undefined;
  config?: Record<string, any> | null;
}>();

const { t } = useI18nTyped();
const store = useStore();

// Same width the logs table gives its timestamp column.
const TIMESTAMP_COLUMN_SIZE = 236;
// Same format the logs table shows its timestamps in.
const TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss.SSS";

const rows = computed<LogsPanelRow[]>(() => props.data?.rows ?? []);
const fields = computed<LogsPanelFields>(
  () => props.data?.fields ?? { time: null, level: null, message: null },
);
const showTime = computed(() => props.config?.logs_show_time !== false);
const wrap = computed(() => props.config?.logs_wrap === true);
const prettify = computed(() => props.config?.logs_prettify_json !== false);

// The table shows the rows exactly as the query returned them, in the panel's order.
const sourceRows = computed(() => rows.value.map((row) => row.source));
const rowsBySource = computed(() => {
  const map = new Map<unknown, { index: number; row: LogsPanelRow }>();
  rows.value.forEach((row, index) => map.set(row.source, { index, row }));
  return map;
});
const rowKey = (row: any): string => String(rowsBySource.value.get(row)?.index ?? -1);

const timeColumnId = computed(() =>
  showTime.value && fields.value.time ? fields.value.time : undefined,
);

const columns = computed<OTableColumnDef<any>[]>(() => {
  const timezone = store.state.timezone;
  const out: any[] = [];
  const timeField = timeColumnId.value;
  if (timeField) {
    const format = (row: any) => {
      const millis = toEpochMillis(row?.[timeField]);
      return millis === null ? "" : timestampToTimezoneDate(millis, timezone, TIMESTAMP_FORMAT);
    };
    out.push({
      name: timeField,
      id: timeField,
      accessorFn: format,
      prop: format,
      label: t("search.timestampWithTimezone", { timezone }),
      header: t("search.timestampWithTimezone", { timezone }),
      align: "left",
      enableResizing: false,
      meta: { closable: false, showWrap: false, wrapContent: false },
      size: TIMESTAMP_COLUMN_SIZE,
    });
  }
  const messageField = fields.value.message;
  if (messageField) {
    out.push({
      name: messageField,
      id: messageField,
      accessorFn: (row: any) => byString(row, messageField),
      header: raw(messageField),
      enableResizing: true,
      meta: { closable: false, showWrap: true, wrapContent: false, autoWidth: true },
    });
  } else {
    out.push({
      name: "source",
      id: "source",
      accessorFn: (row: any) => JSON.stringify(row),
      cell: (info: any) => info.getValue(),
      header: raw("source"),
      resizable: false,
      meta: { closable: false, showWrap: false, wrapContent: false, autoWidth: true },
    });
  }
  return out;
});

// The logs table's colourised cells: same highlighter, keyed by column and row position.
const { processedResults, processHitsInChunks } = useLogsHighlighter(t);
const cellHtml = (columnId: string, row: any): string | null => {
  const index = rowsBySource.value.get(row)?.index;
  if (index === undefined) return null;
  return (processedResults.value as Record<string, string>)[`${columnId}_${index}`] ?? null;
};
const reprocess = (clearCache: boolean) =>
  processHitsInChunks(sourceRows.value, columns.value as any[], clearCache, "", 100, []);
watch(columns, () => reprocess(true), { immediate: true });
watch(sourceRows, () => reprocess(true));

// The logs table's severity rail, read from the panel's level field.
const rowStatusColor = (row: any): string =>
  severityIndicatorColor({
    level: rowsBySource.value.get(row)?.row.level ?? "unknown",
    source: "field",
    field: fields.value.level,
    notFetched: false,
  });

const expandedIds = ref<string[]>([]);
// Keys are row positions, so an open row would point at a different line after a reload.
watch(rows, () => {
  if (expandedIds.value.length) expandedIds.value = [];
});

const copyRow = (value: unknown) =>
  copyToClipboard(typeof value === "string" ? value : JSON.stringify(value, null, 2), t);

// The panel has no details drawer, so a row click opens the row's JSON in place.
const toggleRow = (row: any) => {
  const key = rowKey(row);
  expandedIds.value = expandedIds.value.includes(key)
    ? expandedIds.value.filter((id) => id !== key)
    : [...expandedIds.value, key];
};
</script>

<style scoped>
/* keep(lib-override:logs-cell-font): the logs table's monospace cell font, copied from the logs page's scoped style; only data cells, so the expanded JSON keeps its own typography. */
.logs-panel-table :deep(td[data-test^="o2-table-cell-"]) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.125rem;
}

/* keep(lib-override:logs-row-height): the logs table's compact expand button, so the default button does not set a taller floor under every row. */
.logs-panel-table :deep([data-test^="o2-table-expand-"]) {
  height: 1.25rem !important;
  width: 1rem !important;
  min-height: 0 !important;
}
.logs-panel-table :deep([data-test^="o2-table-expand-"] svg) {
  width: 0.875rem !important;
  height: 0.875rem !important;
}
</style>
