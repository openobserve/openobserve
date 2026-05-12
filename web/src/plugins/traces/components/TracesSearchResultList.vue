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
    class="traces-search-result-list tw:h-auto! tw:flex tw:flex-col tw:bg-[var(--o2-card-bg-solid)]"
  >
    <!-- ════════════════════ Empty State ════════════════════ -->
    <div
      v-if="noResults"
      class="text-center tw:mx-[10%] tw:my-[2.5rem] tw:text-[1.25rem]"
    >
      <q-icon name="info" color="primary" size="md" />
      {{ t("traces.noTracesFoundAdjust") }}
    </div>

    <!-- ════════════════════ Traces List Section ════════════════════ -->
    <div
      v-else
      v-show="hasResults || loading"
      data-test="traces-table-wrapper"
      class="column tw:h-auto! traces-table-container"
    >
      <!-- Table scroll area: no overflow here — parent handles unified scroll -->
      <div
        data-test="traces-search-result-list"
        class="tw:w-full tw:h-auto! tw:overflow-x-auto tw:relative"
      >
        <TenstackTable
          class="tw:h-auto!"
          :columns="searchObj.data.resultGrid.columns"
          :rows="hits"
          :loading="loading"
          :row-class="traceRowClass"
          :sort-by="props.sortBy"
          :sort-order="props.sortOrder"
          :sort-field-map="sortFieldMap"
          :row-height="28"
          :enable-column-reorder="true"
          :enable-row-expand="false"
          :enable-text-highlight="false"
          :enable-status-bar="false"
          :default-columns="false"
          @click:data-row="(row: any) => emit('row-click', row)"
          @sort-change="(by, order) => emit('sort-change', by, order)"
          @update:columnOrder="onColumnReorder"
          @closeColumn="onCloseColumn"
        >
          <template #cell-actions="{ row, column, active }">
            <CellActions
              v-if="
                showCellActions &&
                active &&
                !column.columnDef.meta.disableCellAction
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

          <!-- Loading banner: shown above rows while a new page is fetching -->
          <template #loading-banner>
            <div
              data-test="traces-table-loading-banner-row"
              class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
            >
              <OSpinner size="xs" class="tw:mx-[0.25rem]" />
              <span
                class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
                >{{ t("traces.fetchingTraces") }}</span
              >
            </div>
          </template>

          <!-- Loading row: shown when no rows exist yet (first fetch) -->
          <template #loading>
            <div
              data-test="traces-table-loading-row"
              class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
            >
              <OSpinner size="xs" class="tw:mr-[0.25rem]" />
              <span
                class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
                >{{ t("traces.fetchingTraces") }}</span
              >
            </div>
          </template>

          <template
            #[`cell-${store.state.zoConfig.timestamp_column}`]="{ cell }"
          >
            <TraceTimestampCell :value="cell.getValue()" />
          </template>

          <template #cell-service_name="{ item }">
            <TraceServiceCell :item="item" />
          </template>

          <template #cell-operation_name="{ item }">
            <span
              class="text-caption ellipsis tw:text-[var(--o2-text-1)]!"
              data-test="trace-row-operation-name"
            >
              {{ item.operation_name }}
              <q-tooltip anchor="bottom middle" self="top middle">
                {{ item.operation_name }}
              </q-tooltip>
            </span>
          </template>

          <template #cell-duration="{ item }">
            <span class="text-caption" data-test="trace-row-duration">
              {{ formatTimeWithSuffix(item.duration) || "0us" }}
            </span>
          </template>

          <template #cell-spans="{ item }">
            {{ item.spans }}
          </template>

          <template #cell-status_code="{ item }">
            <SpanStatusCodeBadge :code="item.http_status_code" />
          </template>

          <template #cell-span_status="{ item }">
            <SpanStatusPill :status="item.span_status" />
          </template>

          <template #cell-status="{ item }">
            <TraceStatusCell :item="item" />
          </template>
          <template #cell-input_tokens="{ item }">
            <span class="text-caption" data-test="trace-row-input-tokens">
              {{
                isLLMTrace(item)
                  ? formatTokens(extractLLMData(item)?.usage?.input ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-output_tokens="{ item }">
            <span class="text-caption" data-test="trace-row-output-tokens">
              {{
                isLLMTrace(item)
                  ? formatTokens(extractLLMData(item)?.usage?.output ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-cost="{ item }">
            <span class="text-caption" data-test="trace-row-cost">
              {{
                isLLMTrace(item)
                  ? `$${formatCost(extractLLMData(item)?.cost?.total ?? 0)}`
                  : "-"
              }}
            </span>
          </template>

          <template #cell-service_latency="{ item }">
            <TraceLatencyCell :item="item" />
          </template>

          <template #empty />
        </TenstackTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard as qCopyToClipboard } from "quasar";
import TenstackTable from "@/components/TenstackTable.vue";
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
  formatLargeNumber,
} from "../../../utils/zincutils";
import { useStore } from "vuex";
import type { TraceSearchMode } from "@/ts/interfaces/traces/trace.types";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

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
}

const { t } = useI18n();
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
});

const emit = defineEmits<{
  "row-click": [row: any];
  "page-change": [page: number];
  "rows-per-page-change": [rowsPerPage: number];
  "sort-change": [sortBy: string, sortOrder: "asc" | "desc"];
  copy: [value: any];
  "send-to-ai-chat": [value: string];
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

const rowsPerPageOptions = [10, 25, 50, 100];

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
  updatedLocalLogFilterField(mode);
};

const onCloseColumn = (columnDef: any) => {
  const mode = props.searchMode ?? "traces";
  const fieldIdx = searchObj.data.stream.selectedFields.indexOf(columnDef.id);
  if (fieldIdx !== -1) {
    searchObj.data.stream.selectedFields.splice(fieldIdx, 1);
    updatedLocalLogFilterField(mode);
  }
  const colIdx = searchObj.data.resultGrid.columns.findIndex(
    (c: any) => c.id === columnDef.id,
  );
  searchObj.data.resultGrid.columns = searchObj.data.resultGrid.columns.filter(
    (c) => c.id !== columnDef.id,
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

const totalPages = computed(() =>
  props.total && props.rowsPerPage
    ? Math.max(1, Math.ceil(props.total / props.rowsPerPage))
    : 1,
);
</script>

<style lang="scss" scoped>
@import "@/styles/pagination.scss";

:deep(.traces-table-container) {
  .table-container {
    border-radius: 0 !important;
  }
}
</style>
