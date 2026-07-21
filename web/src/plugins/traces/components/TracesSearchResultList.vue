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
  <div
    class="traces-search-result-list h-auto! flex flex-col bg-card-glass-solid"
  >
    <!-- ════════════════════ Empty State ════════════════════ -->
    <TracesNoEventsState
      v-if="noResults"
      :ai-enabled="aiEnabled"
      :stream-doc-time-range="streamDocTimeRange"
      :query-window-us="queryWindowUs"
      data-test="traces-search-result-not-found-text"
      @remove-filter="emit('remove-filter')"
      @jump-to-stream-data="(from, to) => emit('jump-to-stream-data', from, to)"
      @ask-ai="emit('ask-ai')"
    />

    <!-- ════════════════════ Traces List Section ════════════════════ -->
    <div
      v-else
      v-show="hasResults || loading"
      data-test="traces-table-wrapper"
      class="flex flex-col h-auto! traces-table-container"
    >
      <!-- Table scroll area: no overflow here — parent handles unified scroll -->
      <div
        data-test="traces-search-result-list"
        class="w-full h-auto! relative"
      >
        <OTable
          class="h-auto!"
          :columns="searchObj.data.resultGrid.columns"
          :data="hits"
          :loading="loading"
          :row-class="traceRowClass"
          sorting="server"
          :sort-by="props.sortBy"
          :sort-order="props.sortOrder"
          :sort-field-map="sortFieldMap"
          :row-height="28"
          virtual-scroll
          :fill-height="false"
          :scroll-el="scrollEl"
          :scroll-margin="0"
          :enable-column-reorder="true"
          :default-columns="false"
          :show-global-filter="false"
          pagination="none"
          @row-click="(row: any) => emit('row-click', row)"
          @sort-change="onSortChange"
          @column-order-change="onColumnReorder"
          @close-column="onCloseColumn"
        >
          <!-- Per-cell hover actions (G13). `column` is the OTableColumnDef, so
               `column.meta` (not `column.columnDef.meta`) holds disableCellAction. -->
          <template #cell-hover-actions="{ row, column, active }">
            <CellActions
              v-if="
                showCellActions &&
                active &&
                !column.meta?.disableCellAction
              "
              :column="column"
              :row="row"
              :selected-stream-fields="
                searchObj.data.stream.selectedStreamFields
              "
              :hide-search-term-actions="false"
              :hide-ai="true"
              @copy="copyToClipboard(column.id, row[column.id])"
              @add-search-term="
                (field, value, action) =>
                  addSearchTerm(field, value, action, row)
              "
              @send-to-ai-chat="sendToAiChat"
            />
          </template>

          <template
            #[`cell-${store.state.zoConfig.timestamp_column}`]="{ value }"
          >
            <TraceTimestampCell :value="value" />
          </template>

          <template #cell-service_name="{ row }">
            <TraceServiceCell :item="row" />
          </template>

          <template #cell-operation_name="{ row }">
            <span
              class="text-xs truncate text-text-body"
              data-test="trace-row-operation-name"
            >
              {{ row.operation_name }}
              <OTooltip :content="row.operation_name" side="bottom" align="center" />
            </span>
          </template>

          <template #cell-duration="{ row }">
            <span class="text-xs text-text-body font-mono" data-test="trace-row-duration">
              {{ formatTimeWithSuffix(row.duration) || "0us" }}
            </span>
          </template>

          <template #cell-spans="{ row }">
            <span class="text-xs text-text-body font-mono" data-test="trace-row-spans">
              {{ row.spans }}
            </span>
          </template>

          <template #cell-status_code="{ row }">
            <SpanStatusCodeBadge :code="row.http_status_code" />
          </template>

          <template #cell-span_status="{ row }">
            <SpanStatusPill :status="row.span_status" />
          </template>

          <template #cell-status="{ row }">
            <TraceStatusCell :item="row" />
          </template>
          <template #cell-input_tokens="{ row }">
            <span class="text-xs text-text-body font-mono" data-test="trace-row-input-tokens">
              {{
                isLLMTrace(row)
                  ? formatTokens(extractLLMData(row)?.usage?.input ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-output_tokens="{ row }">
            <span class="text-xs text-text-body font-mono" data-test="trace-row-output-tokens">
              {{
                isLLMTrace(row)
                  ? formatTokens(extractLLMData(row)?.usage?.output ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-cost="{ row }">
            <span class="text-xs text-text-body font-mono" data-test="trace-row-cost">
              {{
                isLLMTrace(row)
                  ? `$${formatCost(extractLLMData(row)?.cost?.total ?? 0)}`
                  : "-"
              }}
            </span>
          </template>

          <template #cell-service_latency="{ row }">
            <TraceLatencyCell :item="row" />
          </template>

          <template #empty><div /></template>
        </OTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { copyToClipboard as qCopyToClipboard } from "@/utils/clipboard";
import OTable from "@/lib/core/Table/OTable.vue";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "@/composables/useTraces";
import { useTracesTableColumns } from "@/plugins/traces/composables/useTracesTableColumns";
import TraceTimestampCell from "./TraceTimestampCell.vue";
import TraceServiceCell from "./TraceServiceCell.vue";
import TraceLatencyCell from "./TraceLatencyCell.vue";
import TraceStatusCell from "./TraceStatusCell.vue";
import SpanStatusPill from "./SpanStatusPill.vue";
import SpanStatusCodeBadge from "./SpanStatusCodeBadge.vue";
import {
  isLLMTrace,
  extractLLMData,
  formatCost,
  formatTokens,
} from "../../../utils/llmUtils";
import {
  formatTimeWithSuffix,
} from "../../../utils/zincutils";
import { useStore } from "vuex";
import type { TraceSearchMode } from "@/ts/interfaces/traces/trace.types";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import TracesNoEventsState from "@/plugins/traces/TracesNoEventsState.vue";

interface Props {
  hits: any[];
  loading: boolean;
  /** Whether a search has been executed. Controls idle vs empty state. Default: true */
  searchPerformed?: boolean;
  /** Show the "TRACES X Traces Found" section header. Default: true */
  showHeader?: boolean;
  /** Server-side total record count (distinct trace_ids from count query). */
  total?: number;
  /** Current page number (1-indexed). */
  currentPage?: number;
  /** Rows displayed per page. */
  rowsPerPage?: number;
  /** Whether to show the pagination controls. */
  showPagination?: boolean;
  /** Error trace count from the count query. */
  errorCount?: number;
  /** Active sort field (backend field name, e.g. "zo_sql_timestamp") */
  sortBy?: string;
  /** Active sort direction */
  sortOrder?: "asc" | "desc";
  /** Current search mode */
  searchMode?: TraceSearchMode;
  /** Whether to show CellActions overlay on table cells. Default: true */
  showCellActions?: boolean;
  /** Whether the AI copilot is enabled — gates the "Ask AI" empty-state button. */
  aiEnabled?: boolean;
  /** Authoritative stream doc time range (µs) for the empty-state jump card. */
  streamDocTimeRange?: { min: number; max: number };
  /** Resolved query window (µs) for empty-state overlap detection. */
  queryWindowUs?: { start: number; end: number };
  /** Parent scroll container that owns vertical scroll (unified with the RED
   *  metrics charts above). Delegated to the table's virtualizer so the table
   *  doesn't create a second, nested scrollbar. */
  scrollEl?: HTMLElement | null;
}

const store = useStore();

const props = withDefaults(defineProps<Props>(), {
  searchPerformed: true,
  showHeader: true,
  total: undefined,
  currentPage: 1,
  rowsPerPage: 25,
  showPagination: false,
  errorCount: undefined,
  sortBy: undefined,
  sortOrder: undefined,
  searchMode: "traces",
  showCellActions: true,
  aiEnabled: false,
  streamDocTimeRange: undefined,
  queryWindowUs: undefined,
  scrollEl: null,
});

const emit = defineEmits<{
  "row-click": [row: any];
  "page-change": [page: number];
  "rows-per-page-change": [rowsPerPage: number];
  "sort-change": [sortBy: string, sortOrder: "asc" | "desc"];
  copy: [value: any];
  "send-to-ai-chat": [value: string];
  "remove-filter": [];
  "jump-to-stream-data": [fromUs: number, toUs: number];
  "ask-ai": [];
}>();

const copyToClipboard = (field: string, value: any) =>
  qCopyToClipboard(
    field === "span_kind"
      ? (SPAN_KIND_MAP[String(value)] ?? String(value))
      : String(value),
  );

const addSearchTerm = (
  field: string,
  fieldValue: string | number | boolean,
  action: string,
  row?: Record<string, any>,
) => {
  const operator = action === "include" ? "=" : "!=";
  if (fieldValue === null || fieldValue === "" || fieldValue === "null") {
    const isOp = action === "include" ? "is" : "is not";
    searchObj.data.stream.addToFilter = `${field} ${isOp} null`;
  } else {
    // For nanosecond timestamp fields, use the exact string shadow value to avoid
    // the ~52-unit rounding that JSON.parse introduces for 19-digit integers.
    const exactNsValue =
      field === "start_time"
        ? row?._start_time_ns
        : field === "end_time"
          ? row?._end_time_ns
          : undefined;
    const displayValue =
      exactNsValue !== undefined
        ? String(exactNsValue)
        : field === "span_kind"
          ? (SPAN_KIND_MAP[String(fieldValue)] ?? String(fieldValue))
          : String(fieldValue);
    searchObj.data.stream.addToFilter = `${field} ${operator} '${displayValue.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
};

const sendToAiChat = (value: string) => emit("send-to-ai-chat", value);

/**
 * OTable server sort emits `{ column, order }` and cycles asc → desc → cleared
 * (3-state). The parent consumes `(field, order)` where `field` is the backend
 * field (already mapped via `sortFieldMap`). On the "cleared" tick (empty
 * column) we fall back to the default trace sort so the query never receives an
 * empty sort field.
 */
const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  if (!params.column) {
    emit("sort-change", "start_time", "desc");
  } else {
    emit("sort-change", params.column, params.order);
  }
};


const { searchObj, updatedLocalLogFilterField } = useTraces();
const { buildColumns } = useTracesTableColumns();

const timestampCol = computed(
  () => store.state.zoConfig.timestamp_column || "_timestamp",
);

const sortFieldMap = computed<Record<string, string>>(() => ({
  [timestampCol.value]: "start_time",
  duration: "duration",
}));

onMounted(() => {
  if (!searchObj.data.resultGrid.columns.length) {
    searchObj.data.resultGrid.columns = buildColumns(
      false,
      "traces",
      DEFAULT_TRACE_COLUMNS.traces,
    );
  }
});

// const rebuildColumns = () => {
//   buildColumns(
//     hasLlmTraces.value,
//     props.searchMode ?? "traces",
//     searchObj.data.stream.selectedFields,
//   );
// };

// // Rebuild columns whenever any of the inputs change.
// watch(
//   [
//     hasLlmTraces,
//     () => props.searchMode,
//     () => searchObj.data.stream.selectedFields,
//   ],
//   rebuildColumns,
//   { immediate: true, deep: false },
// );

/**
 * Fired by TenstackTable when the user drags columns to a new order.
 * LLM columns are injected dynamically by the composable and are not stored
 * in selectedFields, so we strip them before persisting.
 */
const onColumnReorder = (newOrder: string[]) => {
  const mode = props.searchMode ?? "traces";
  searchObj.data.stream.selectedFields = newOrder.filter(
    (id) => id !== store.state.zoConfig.timestamp_column,
  );
  // useTraces only persists per traces/spans; other modes have no column state.
  updatedLocalLogFilterField(mode as "traces" | "spans");
};

const onCloseColumn = (columnDef: any) => {
  const mode = props.searchMode ?? "traces";
  const fieldIdx = searchObj.data.stream.selectedFields.indexOf(columnDef.id);
  if (fieldIdx !== -1) {
    searchObj.data.stream.selectedFields.splice(fieldIdx, 1);
    updatedLocalLogFilterField(mode as "traces" | "spans");
  }
  searchObj.data.resultGrid.columns = searchObj.data.resultGrid.columns.filter(
    (c: { id: string }) => c.id !== columnDef.id,
  );

  // If the closed column was the active sort column, reset to default
  if (columnDef.id === props.sortBy) {
    emit("sort-change", "start_time", "desc");
  }
};

const traceRowClass = (row: any) => {
  if (props.searchMode === "spans") {
    return row.span_status === "ERROR" ? "oz-table__row--error" : "";
  }
  return (row.errors ?? 0) > 0 ? "oz-table__row--error" : "";
};

const noResults = computed(
  () => props.searchPerformed && !props.loading && props.hits.length === 0,
);

const hasResults = computed(
  () => props.searchPerformed && props.hits.length > 0,
);

</script>

<style scoped>
/* keep(complex-state): :deep override to square off the child table's corners */
.traces-table-container :deep(.table-container) {
  border-radius: 0 !important;
}

/* keep(generated-content): the error-row left border. `traceRowClass` puts
   `oz-table__row--error` on OTable-rendered <tr>s; the rule that styled it lived
   in the now-deleted legacy table, so it is re-homed here (mirrors
   PlayerTracesTab's `trace-row--error`). Reaches OTable's <td>, hence :deep. */
.traces-table-container :deep(.oz-table__row--error td:first-child) {
  box-shadow: inset 0.125rem 0 0 0 var(--color-status-error-text);
}
</style>
