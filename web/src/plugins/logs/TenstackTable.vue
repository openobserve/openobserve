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
    ref="parentRef"
    :class="[
      'container tw:rounded-none! tw:overflow-x-auto tw:relative',
      !props.scrollEl ? 'table-container' : '',
    ]"
    style="color: var(--o2-log-table-text)"
  >
    <!-- Top progress bar: keeps rows visible while a new result set streams in
      (e.g. streaming_aggs replacing values). Same component dashboard panels
      use; driven by backend streaming progress. The full skeleton below is
      shown only on first load (no rows yet). -->
    <LoadingProgress
      :loading="loading"
      :loadingProgressPercentage="loadingProgressPercentage"
    />
    <table
      v-if="table"
      data-test="logs-search-result-logs-table"
      class="tw:w-full tw:table-auto logs-table"
      :style="{
        minWidth: '100%',
        ...columnSizeVars,
        minHeight: isFirefox ? undefined : totalSize + 'px',
        width: !defaultColumns
          ? table.getCenterTotalSize() + 'px'
          : wrap
            ? width
              ? width - 12 + 'px'
              : '100%'
            : '100%',
      }"
    >
      <thead
        class="tw:sticky tw:top-0 tw:z-10"
        style="max-height: 44px"
        v-for="headerGroup in table.getHeaderGroups()"
        :key="headerGroup.id"
      >
        <vue-draggable
          v-model="columnOrder"
          :element="'table'"
          :animation="200"
          :sort="!isResizingHeader || !defaultColumns"
          handle=".table-head"
          :class="{
            'tw:cursor-move': table.getState().columnOrder.length > 1,
          }"
          :style="{
            width:
              defaultColumns && wrap
                ? width - 12 + 'px'
                : defaultColumns
                  ? tableRowSize + 'px'
                  : '100%',
            minWidth: '100%',
            background: 'var(--o2-log-table-header-bg)',
          }"
          tag="tr"
          @start="(event) => handleDragStart(event)"
          @end="() => handleDragEnd()"
          class="tw:flex tw:items-center"
        >
          <th
            v-for="(header, headerIndex) in headerGroup.headers"
            :key="header.id"
            :id="header.id"
            class="tw:px-2 tw:relative table-head tw:text-ellipsis"
            :style="
              !defaultColumns && headerIndex === headerGroup.headers.length - 1
                ? { flex: '1 1 auto', minWidth: `calc(var(--header-${header?.id}-size) * 1px)`, width: 'auto', overflow: 'hidden' }
                : { width: `calc(var(--header-${header?.id}-size) * 1px)`, minWidth: `calc(var(--header-${header?.id}-size) * 1px)`, flexShrink: '0' }
            "
            :data-test="`log-search-result-table-th-${header.id}`"
          >
            <div
              v-if="header.column.getCanResize()"
              @dblclick="header.column.resetSize()"
              @mousedown.self.prevent.stop="header.getResizeHandler()?.($event)"
              @touchstart.self.prevent.stop="
                header.getResizeHandler()?.($event)
              "
              :class="[
                'resizer',
                'tw:bg-[var(--o2-border-color)]',
                header.column.getIsResizing() ? 'isResizing' : '',
              ]"
              :style="{}"
              class="tw:right-0"
            />

            <div
              v-if="!header.isPlaceholder"
              :class="[
                'tw:text-left',
                header.column.getCanSort() ? 'tw:cursor-pointer select-none' : '',
              ]"
              @click="
                getSortingHandler(
                  $event,
                  header.column.getToggleSortingHandler(),
                )
              "
              class="tw:overflow-hidden tw:text-ellipsis"
            >
              <FlexRender
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </div>

            <div
              v-if="
                !header.isPlaceholder &&
                (
                  (header.column.columnDef.meta as any).closable ||
                  (header.column.columnDef.meta as any).showWrap
                )
              "
              :data-test="`log-add-data-from-column-${header.column.columnDef.header}`"
              class="tw:invisible tw:flex tw:items-center tw:absolute tw:right-2 tw:top-0 tw:px-2 column-actions"
            >
              <OIcon
                v-if="(header.column.columnDef.meta as any).closable"
                :data-test="`logs-search-result-table-th-remove-${header.column.columnDef.header}-btn`"
                name="close"
                class="tw:m-0 tw:mt-[0.125rem]! close-icon tw:cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-white' : 'tw:text-gray-700'
                "
                :title="t('common.close')"
                size="sm"
                @click.stop="closeColumn(header.column.columnDef)"
              />
            </div>
          </th>
        </vue-draggable>


        <tr v-if="!loading && errMsg != ''" class="tw:w-full">
          <td
            :colspan="columnOrder.length"
            class="tw:font-bold"
            style="opacity: 0.7"
          >
            <div class="tw:text-sm tw:font-medium text-weight-bold tw:bg-amber-500">
              <OIcon size="xs"
name="warning"
class="tw:mr-1" />
              {{ errMsg }}
            </div>
          </td>
        </tr>
        <tr
          data-test="log-search-result-function-error"
          v-if="functionErrorMsg != ''"
        >
          <td
            :colspan="columnOrder.length"
            class="tw:font-bold"
            style="opacity: 0.6"
          >
            <div
              class="tw:text-sm tw:font-medium text-weight-bold tw:pl-2"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-yellow-600'
                  : 'tw:bg-amber-300'
              "
            >
              <OButton
                variant="ghost"
                size="icon-xs"
                class="tw:mr-1 log-row-expand-btn"
                data-test="table-row-expand-menu"
                @click.capture.stop="expandFunctionError"
                ><OIcon :name="isFunctionErrorOpen ? 'expand-more' : 'chevron-right'" size="sm" /></OButton
              ><b>
                <OIcon name="warning" size="sm" />
                {{ t("search.functionErrorLabel") }}</b
              >
            </div>
          </td>
        </tr>
        <tr v-if="functionErrorMsg != '' && isFunctionErrorOpen">
          <td
            :colspan="columnOrder.length"
            style="opacity: 0.7"
            class="tw:px-2"
            :class="
              store.state.theme === 'dark'
                ? 'tw:bg-yellow-600'
                : 'tw:bg-amber-300'
            "
          >
            <pre>{{ functionErrorMsg }}</pre>
          </td>
        </tr>
      </thead>

      <!-- Skeleton loading body — shown ONLY on first load (no rows yet).
        Once rows exist they stay visible while the top progress bar signals an
        in-progress refresh (e.g. streaming_aggs replacing values). -->
      <tbody
        v-if="loading && tableRows.length === 0"
        data-test="logs-table-skeleton-body"
        aria-busy="true"
        aria-label="Loading logs"
      >
        <!-- Rows use tw:flex to match the real virtual rows exactly -->
        <tr
          v-for="r in SKEL_ROW_COUNT"
          :key="`skel-${r}`"
          class="logs-skel-row tw:flex tw:items-center tw:w-full"
          :style="{ animationDelay: `${(r - 1) * 40}ms` }"
        >
          <!-- No columns loaded yet (first page load) — full-width shimmer bar -->
          <td v-if="!headers?.length" class="tw:w-full tw:px-4 tw:overflow-hidden">
            <span
              class="logs-skel-pill tw:inline-block tw:h-3 tw:rounded-md"
              :style="{ width: `${skelCellWidth(r - 1, 0)}%` }"
              aria-hidden="true"
            />
          </td>
          <!-- Columns available — per-column aligned shimmer pills -->
          <template v-else>
            <td
              v-for="(header, c) in headers"
              :key="header.id"
              class="tw:px-2 tw:overflow-hidden"
              :class="c === 0 ? 'tw:pl-4' : ''"
              :style="skelTdStyle(header, c)"
            >
              <span
                class="logs-skel-pill tw:inline-block tw:h-3 tw:rounded-md"
                :style="{ width: c === 0 ? `${SKEL_TIMESTAMP_PX}px` : `${skelCellWidth(r - 1, c)}%` }"
                aria-hidden="true"
              />
            </td>
          </template>
        </tr>
      </tbody>

      <tbody
        data-test="logs-search-result-table-body"
        ref="tableBodyRef"
        class="tw:relative"
        :style="isFirefox ? { minHeight: totalSize + 'px' } : {}"
      >
        <template v-for="virtualRow in virtualRows" :key="virtualRow.id">
          <tr
            :data-test="`logs-search-result-detail-${
              (tableRows[virtualRow.index] as any)[
                store.state.zoConfig.timestamp_column || '_timestamp'
              ]
            }`"
            :style="{
              transform: `translateY(${virtualRow.start}px)`,
              minWidth: '100%',
              width: (!defaultColumns && !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow) ? '100%' : undefined,
            }"
            :data-index="virtualRow.index"
            :data-expanded="
              formattedRows?.[virtualRow.index]?.original?.isExpandedRow
            "
            :ref="(node: any) => node && rowVirtualizer.measureElement(node)"
            :class="[
              'tw:absolute tw:flex tw:w-max tw:items-center tw:justify-start tw:border-b-[1px]',
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? 'tw:cursor-pointer'
                : 'tw:cursor-default',
              defaultColumns &&
              !wrap &&
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? 'tw:table-row'
                : 'tw:flex tw:break-all',
              (tableRows[virtualRow.index] as any)[
                store.state.zoConfig.timestamp_column
              ] === highlightTimestamp &&
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? store.state.theme === 'dark'
                  ? 'tw:bg-zinc-700'
                  : 'tw:bg-zinc-300'
                : !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                  ? 'log-row-base'
                  : '',
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? 'table-row-hover'
                : '',
            ]"
            @click="
              !(formattedRows[virtualRow.index]?.original as any)
                ?.isExpandedRow &&
              handleDataRowClick(tableRows[virtualRow.index], virtualRow.index)
            "
          >
            <!-- Status color line for entire row -->
            <div
              v-if="
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
              "
              class="tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 tw:z-10"
              :style="{
                backgroundColor: getRowStatusColor(tableRows[virtualRow.index]),
              }"
            />
            <td
              v-if="
                (formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
              "
              :colspan="columnOrder.length"
              :data-test="`log-search-result-expanded-row-${virtualRow.index}`"
              class="tw:w-full tw:relative"
            >
              <json-preview
                :value="tableRows[virtualRow.index - 1] as any"
                show-copy-button
                class="tw:py-[0.375rem]"
                mode="expanded"
                :index="calculateActualIndex(virtualRow.index - 1)"
                :highlight-query="highlightQuery"
                :hide-view-related="hideViewRelatedButton"
                :hide-search-term-actions="hideSearchTermActions"
                @copy="copyLogToClipboard"
                @add-field-to-table="addFieldToTable"
                @add-search-term="addSearchTerm"
                @view-trace="
                  viewTrace(formattedRows[virtualRow.index - 1]?.original)
                "
                @show-correlation="
                  showCorrelation(formattedRows[virtualRow.index - 1]?.original)
                "
                :streamName="jsonpreviewStreamName"
                @send-to-ai-chat="sendToAiChat"
              />
            </td>
            <template v-else>
              <td
                v-for="(cell, cellIndex) in formattedRows[
                  virtualRow.index
                ].getVisibleCells()"
                :key="cell.id"
                :data-test="
                  'log-table-column-' +
                  virtualRow.index +
                  '-' +
                  cell.column.columnDef.id
                "
                class="tw:py-none tw:px-2 tw:flex tw:items-center tw:justify-start tw:relative table-cell"
                :class="[...tableCellClass, { 'tw:pl-4': cellIndex === 0 }]"
                :style="
                  !defaultColumns && cellIndex === formattedRows[virtualRow.index].getVisibleCells().length - 1
                    ? {
                        flex: '1 1 auto',
                        minWidth: `calc(var(--col-${cell.column.columnDef.id}-size) * 1px)`,
                        width: 'auto',
                        overflow: 'hidden',
                        height: wrap ? '100%' : '20px',
                      }
                    : {
                        width:
                          cell.column.columnDef.id !== 'source' ||
                          cell.column.columnDef.enableResizing
                            ? `calc(var(--col-${cell.column.columnDef.id}-size) * 1px)`
                            : wrap
                              ? width - 260 - 12 + 'px'
                              : 'auto',
                        minWidth:
                          cell.column.columnDef.id !== 'source' ||
                          cell.column.columnDef.enableResizing
                            ? `calc(var(--col-${cell.column.columnDef.id}-size) * 1px)`
                            : undefined,
                        flexShrink: '0',
                        height: wrap ? '100%' : '20px',
                      }
                "
                @mouseover="handleCellMouseOver(cell)"
                @mouseleave="handleCellMouseLeave()"
              >
                <OButton
                  v-if="cellIndex == 0"
                  variant="ghost"
                  size="icon-xs"
                  class="tw:mr-1 log-row-expand-btn"
                  data-test="table-row-expand-menu"
                  @click.capture.stop="handleExpandRow(virtualRow.index)"
                  ><OIcon
                    :name="
                      expandedRowIndices.has(virtualRow.index)
                        ? 'expand-more'
                        : 'chevron-right'
                    "
                    size="sm"
                /></OButton>

                <template
                  v-if="activeCellActionId === `${cell.id}_${cell.column.id}`"
                >
                  <cell-actions
                    v-if="
                      (cell.column.columnDef.meta as any)?.closable &&
                      (cell.row.original as any)[cell.column.id]
                    "
                    :column="cell.column"
                    :row="cell.row.original as any"
                    :selectedStreamFields="selectedStreamFields"
                    :hide-search-term-actions="hideSearchTermActions"
                    @copy="copyLogToClipboard"
                    @add-search-term="addSearchTerm"
                    @add-field-to-table="addFieldToTable"
                    @send-to-ai-chat="sendToAiChat"
                  />
                </template>
                <span
                  v-if="
                    processedResults[
                      `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                    ]
                  "
                  :key="`${cell.column.id}_${calculateActualIndex(virtualRow.index)}`"
                  :class="store.state.theme === 'dark' ? 'dark' : ''"
                  v-html="
                    processedResults[
                      `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                    ]
                  "
                />
                <span v-else>
                  {{ cell.renderValue() }}
                </span>
                <div
                  v-if="cell.column.columnDef.id === store.state.zoConfig.timestamp_column"
                  class="tw:absolute tw:right-0 tw:top-1/2 tw:-translate-y-1/2 tw:invisible"
                >
                  <O2AIContextAddBtn
                    class="tw:right-0 ai-btn"
                    @send-to-ai-chat="sendToAiChat(JSON.stringify(cell.row.original), true)"
                    :size="'2px'"
                  />
                </div>
              </td>
            </template>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ComputedRef,
} from "vue";
import type { PropType } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  FlexRender,
  type ColumnDef,
  type SortingState,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/vue-table";
import JsonPreview from "./JsonPreview.vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import { debounce } from "lodash-es";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";

interface StreamField {
  name: string;
  isSchemaField: boolean;
}

const props = defineProps({
  rows: {
    type: Array,
    required: true,
  },
  columns: {
    type: Array,
    required: true,
  },
  wrap: {
    type: Boolean,
    default: false,
  },
  width: {
    type: Number,
    default: 56,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingProgressPercentage: {
    type: Number,
    default: 0,
  },
  errMsg: {
    type: String,
    default: "",
  },
  functionErrorMsg: {
    type: String,
    default: "",
  },
  expandedRows: {
    type: Array,
    default: () => [],
  },
  highlightTimestamp: {
    type: Number,
    default: -1,
  },
  defaultColumns: {
    type: Boolean,
    default: () => true,
  },
  jsonpreviewStreamName: {
    type: String,
    default: "",
    required: false,
  },
  highlightQuery: {
    type: String,
    default: "",
    required: false,
  },
  selectedStreamFtsKeys: {
    type: Array as PropType<StreamField[]>,
    default: () => [],
  },
  selectedStreamFields: {
    type: Array as PropType<StreamField[]>,
    default: () => [],
  },
  hideSearchTermActions: {
    type: Boolean,
    default: false,
  },
  hideViewRelatedButton: {
    type: Boolean,
    default: false,
  },
  scrollEl: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  /** Pixels of content above the virtual list within the shared scroll container (e.g. histogram height). */
  scrollMargin: {
    type: Number,
    default: 0,
  },
});

const { t } = useI18n();

const emits = defineEmits([
  "copy",
  "addSearchTerm",
  "addFieldToTable",
  "closeColumn",
  "click:dataRow",
  "update:columnSizes",
  "update:columnOrder",
  "expandRow",
  "view-trace",
  "sendToAiChat",
  "show-correlation",
]);

const sorting = ref<SortingState>([]);

const store = useStore();
const { isFTSColumn } = useTextHighlighter();
const { processedResults, processHitsInChunks } = useLogsHighlighter();

const getSortingHandler = (e: Event, fn: any) => {
  return fn(e);
};

const setSorting = (sortingUpdater: any) => {
  const newSortVal = sortingUpdater(sorting.value);

  sorting.value = newSortVal;
};

const tableBodyRef = ref<any>(null);

const columnResizeMode = "onChange";

const tableRowSize = ref(0);

const columnOrder = ref<any>([]);

const tableRows = ref([...props.rows]);

const selectedStreamFtsKeys: ComputedRef<string[] | []> = computed(() => {
  return props.selectedStreamFtsKeys || [];
});

const isFunctionErrorOpen = ref(false);

const activeCellActionId = ref("");

const highlightQuery = computed(() => {
  return props.highlightQuery;
});

const getRowStatusColor = (rowData: any) => {
  const statusInfo = extractStatusFromLog(rowData);
  return statusInfo.color;
};

watch(
  () => props.columns,
  async (newVal) => {
    columnOrder.value = newVal.map((column: any) => column.id);

    await nextTick();

    if (props.columns?.length && props.rows?.length) {
      processHitsInChunks(
        props.rows,
        props.columns,
        true,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value,
      );
    }

    if (props.defaultColumns) updateTableWidth();
  },
  {
    deep: true,
    immediate: true,
  },
);

watch(
  () => props.rows,
  async (newVal) => {
    if (newVal) tableRows.value = [...newVal];

    await nextTick();

    if (props.columns?.length && props.rows?.length) {
      processHitsInChunks(
        props.rows,
        props.columns,
        false,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value,
      );
    }

    expandedRowIndices.value.clear();
    // Clear height cache when rows change
    expandedRowHeights.value = {};
    // Clear actual index cache when rows change
    actualIndexCache.value.clear();
    setExpandedRows();

    await nextTick();
    if (props.defaultColumns) updateTableWidth();
  },
  {
    deep: true,
  },
);

// watch(
//   () => props.highlightQuery,
//   async (newVal, oldVal) => {
//     // Only re-process if highlightQuery actually changed and we have data
//     if (newVal !== oldVal && props.columns?.length && tableRows.value?.length) {
//       await nextTick();

//       processHitsInChunks(
//         tableRows.value,
//         props.columns,
//         true, // Clear cache to re-process with new highlight query
//         props.highlightQuery,
//         100,
//         selectedStreamFtsKeys.value,
//       );
//     }
//   },
// );

watch(
  () => columnOrder.value,
  () => {
    emits("update:columnOrder", columnOrder.value, props.columns);
  },
  {
    immediate: true,
  },
);

let table: any = useVueTable({
  get data() {
    return tableRows.value || [];
  },
  get columns() {
    return props.columns as ColumnDef<unknown, any>[];
  },
  state: {
    get sorting() {
      return sorting.value;
    },
    get columnOrder() {
      return columnOrder.value;
    },
  },
  onSortingChange: setSorting,
  enableSorting: false,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  defaultColumn: {
    minSize: 60,
    maxSize: 800,
  },
  columnResizeMode,
  enableColumnResizing: true,
});

const columnSizeVars = computed(() => {
  const headers = table?.getFlatHeaders();
  const colSizes: { [key: string]: number } = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    colSizes[`--header-${header.id}-size`] = header.getSize();
    colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
  }
  return colSizes;
});

watch(columnSizeVars, (newColSizes) => {
  debouncedUpdate(newColSizes);
});

onMounted(() => {
  setExpandedRows();
});

onBeforeUnmount(() => {
  tableRows.value.length = 0;
  tableRows.value = [];
  tableBodyRef.value = null;
  parentRef.value = null;
  table = null;
});

const hasDefaultSourceColumn = computed(
  () => props.defaultColumns && columnOrder.value.includes("source"),
);

const tableCellClass = ref<string[]>([]);

watch(
  () => [hasDefaultSourceColumn.value, props.wrap],
  () => {
    tableCellClass.value = [
      hasDefaultSourceColumn.value && !props.wrap
        ? "tw:table-cell"
        : "tw:block",
      !props.wrap
        ? "tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
        : "",
      props.wrap ? "tw:break-all" : "",
    ];
  },
  {
    immediate: true,
    deep: true,
  },
);

const updateTableWidth = async () => {
  tableRowSize.value = tableBodyRef?.value?.children[0]?.scrollWidth;

  setTimeout(() => {
    let max = 0;
    let width = max;
    for (let i = 0; i < tableRows.value.length; i++) {
      width = tableBodyRef?.value?.children[i]?.scrollWidth;
      if (width > max) max = width;
    }
    tableRowSize.value = max;
  }, 0);
};

const debouncedUpdate = debounce((newColSizes) => {
  emits("update:columnSizes", newColSizes);
}, 500);

const formattedRows = computed(() => {
  return table?.getRowModel().rows;
});

const isResizingHeader = ref(false);

const headerGroups = computed(() => table?.getHeaderGroups()[0]);

const headers = computed(() => headerGroups.value.headers);

// Skeleton loading helpers — mirrors OTable shimmer pattern
const SKEL_ROW_COUNT = 30;
const SKEL_BASE_WIDTHS = [55, 70, 60, 45, 65, 50, 75, 40, 58, 68, 48, 62];
const SKEL_JITTER     = [0, 6, -4, 3, -2, 5, -3, 2, -5, 4, -1, 6];
// Timestamp column: pill sized to "2026-06-02 12:09:00.349" (23 chars × 7.2 px/char in monospace 12 px)
const SKEL_TIMESTAMP_PX = Math.round("2026-06-02 12:09:00.349".length * 7.2);
const skelCellWidth = (r: number, c: number): number => {
  const base = SKEL_BASE_WIDTHS[c % SKEL_BASE_WIDTHS.length] ?? 60;
  const jit  = SKEL_JITTER[(r + c) % SKEL_JITTER.length] ?? 0;
  return Math.max(25, Math.min(85, base + jit));
};
// Mirror the exact width/flex logic from real cells so the skeleton columns align perfectly.
// Source column: width:'auto' in real rows → flex:1 here to fill remaining row space.
// All other columns: fixed width from the CSS variable (same as real rows).
const skelTdStyle = (header: any, c: number): Record<string, string> => {
  const colId = header.column.id;
  const isStretchSource = colId === 'source' && !header.column.getCanResize();
  if (isStretchSource) return { flex: '1 1 0', minWidth: '0' };
  const w = `calc(var(--col-${colId}-size) * 1px)`;
  if (!props.defaultColumns && c === headers.value.length - 1) {
    return { flex: '1 1 auto', minWidth: w, width: 'auto', overflow: 'hidden' };
  }
  return { width: w, minWidth: w, flexShrink: '0' };
};

watch(
  () => headers.value,
  (newVal) => {
    isResizingHeader.value = newVal.some((header: any) =>
      header.column.getIsResizing(),
    );
  },
  {
    deep: true,
  },
);

const parentRef = ref<HTMLElement | null>(null);

const isFirefox = computed(() => {
  return (
    typeof document !== "undefined" && CSS.supports("-moz-appearance", "none")
  );
});

// Cache for expanded row heights
const expandedRowHeights = ref<{ [key: number]: number }>({});

const rowVirtualizerOptions = computed(() => {
  return {
    count: formattedRows.value.length,
    getScrollElement: () =>
      (props.scrollEl as HTMLElement | null) ?? parentRef.value,
    scrollMargin: props.scrollMargin,
    estimateSize: (index: number) => {
      // Check if this is an expanded row (odd indices after expansion)
      const isExpandedRow = formattedRows.value[index]?.original?.isExpandedRow;
      return isExpandedRow
        ? expandedRowHeights.value[index] || 300 // Default expanded height
        : 24; // Fixed collapsed height
    },
    overscan: 100,
    measureElement:
      typeof window !== "undefined" && !isFirefox.value
        ? (element: any) => {
            const index = parseInt(element.dataset.index);
            // Only measure expanded rows (check if it's actually an expanded row)
            const isExpandedRow =
              formattedRows.value[index]?.original?.isExpandedRow;
            if (isExpandedRow) {
              const height = element.getBoundingClientRect().height;
              expandedRowHeights.value[index] = height;
              return height;
            }
            // Return actual measured height so the virtualizer positions rows
            // with the correct stride — prevents both overlap and gap artifacts.
            return element.getBoundingClientRect().height;
          }
        : undefined,
  };
});

const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());

// +22 adds bottom padding so the last virtual row isn't clipped by the container
const totalSize = computed(() => rowVirtualizer.value.getTotalSize() + 30);

const setExpandedRows = () => {
  props.expandedRows.forEach((index: any) => {
    const virtualIndex = calculateVirtualIndex(index);
    if (index < props.rows.length) {
      expandRow(virtualIndex as number);
    }
  });
  // Clear the actual index cache since expanded rows are changing
  actualIndexCache.value.clear();
};

const copyLogToClipboard = (value: any, copyAsJson: boolean = true) => {
  emits("copy", value, copyAsJson);
};
const addSearchTerm = (
  field: string,
  field_value: string | number | boolean,
  action: string,
) => {
  emits("addSearchTerm", field, field_value, action);
};
const addFieldToTable = (value: string) => {
  emits("addFieldToTable", value);
};

const closeColumn = (data: any) => {
  emits("closeColumn", data);
};

const handleDragStart = (event: any) => {
  if (
    columnOrder.value[event.oldIndex] === store.state.zoConfig.timestamp_column
  ) {
    isResizingHeader.value = true;
  } else {
    isResizingHeader.value = false;
  }
};

const handleDragEnd = async () => {
  if (
    columnOrder.value.includes(store.state.zoConfig.timestamp_column) &&
    columnOrder.value[0] !== store.state.zoConfig.timestamp_column
  ) {
    const newColumnOrder = columnOrder.value.filter(
      (column: any) => column !== store.state.zoConfig.timestamp_column,
    );
    newColumnOrder.unshift(store.state.zoConfig.timestamp_column);
    columnOrder.value = [...newColumnOrder];
  }
};

const expandedRowIndices = ref<Set<number>>(new Set());

const handleExpandRow = (index: number) => {
  // Calculate actual index BEFORE expanding (using current state)
  const actualIndex = calculateActualIndex(index);

  // Emit the event with the calculated actual index
  emits("expandRow", actualIndex);

  // Now expand the row (this modifies expandedRowIndices)
  expandRow(index);

  // Clear the actual index cache since expanded rows have changed
  actualIndexCache.value.clear();
};

const expandRow = async (index: number) => {
  let isCollapseOperation = false;

  if (expandedRowIndices.value.has(index)) {
    // COLLAPSE OPERATION
    expandedRowIndices.value.delete(index);

    // Clear cached height for collapsed "row"
    delete expandedRowHeights.value[index + 1];

    // Remove the expanded row from tableRows
    tableRows.value.splice(index + 1, 1);
    isCollapseOperation = true;

    // Update all expanded indices that come after this collapsed "row"
    const updatedIndices = new Set<number>();
    expandedRowIndices.value.forEach((i) => {
      updatedIndices.add(i > index ? i - 1 : i);
    });
    expandedRowIndices.value = updatedIndices;
  } else {
    // EXPAND OPERATION
    // First, update all expanded indices that come at or after this position
    const updatedIndices = new Set<number>();
    expandedRowIndices.value.forEach((i) => {
      updatedIndices.add(i >= index ? i + 1 : i);
    });

    // Add the new expanded index
    updatedIndices.add(index);
    expandedRowIndices.value = updatedIndices;

    // Insert the expanded "row"
    tableRows.value.splice(index + 1, 0, {
      isExpandedRow: true,
      ...(props.rows[index] as {}),
    });
  }

  tableRows.value = [...tableRows.value];

  await nextTick();

  if (isCollapseOperation) {
    expandedRowIndices.value.forEach((expandedIndex) => {
      if (expandedIndex !== -1) {
        formattedRows.value[expandedIndex].toggleExpanded();
      }
    });
  } else {
    // For expand operation, measure height after DOM update
    await nextTick();

    // Force the virtualizer to recalculate all sizes
    if (rowVirtualizer.value) {
      // Find the actual expanded row element
      const expandedElement = document.querySelector(
        `[data-index="${index + 1}"]`,
      );
      if (expandedElement && rowVirtualizer.value.measureElement) {
        rowVirtualizer.value.measureElement(expandedElement);
      }

      // Trigger a full recalculation
      // rowVirtualizer.value.measure();
    }
  }
};

// Cache for calculated actual indices - maps virtual index to actual index
// Cache is cleared whenever expandedRowIndices changes (expand/collapse operations)
const actualIndexCache = ref<Map<number, number>>(new Map());

/**
 * Converts a virtual index (including expanded rows) to an actual index (in original data).
 * Uses caching to avoid redundant calculations, especially during render and hover events.
 *
 * @param virtualIndex - Index in the displayed table (includes expanded rows)
 * @returns Actual index in the original data array (without expanded rows)
 */
const calculateActualIndex = (virtualIndex: number): number => {
  // Check cache first for O(1) lookup
  if (actualIndexCache.value.has(virtualIndex)) {
    return actualIndexCache.value.get(virtualIndex)!;
  }

  // Calculate actual index from virtual index
  // For each expanded row before this virtual index, subtract 1
  let actualIndex = virtualIndex;
  expandedRowIndices.value.forEach((expandedIndex) => {
    if (expandedIndex !== -1 && expandedIndex < virtualIndex) {
      actualIndex -= 1;
    }
  });

  // Store in cache for future lookups
  actualIndexCache.value.set(virtualIndex, actualIndex);
  return actualIndex;
};

const calculateVirtualIndex = (index: number): number => {
  let virtualIndex = index;
  expandedRowIndices.value.forEach((expandedIndex) => {
    if (expandedIndex !== -1 && expandedIndex < virtualIndex) {
      virtualIndex += 1;
    }
  });
  return virtualIndex;
};

const handleDataRowClick = (row: any, index: number) => {
  const actualIndex = calculateActualIndex(index);

  if (actualIndex !== -1) {
    emits("click:dataRow", row, actualIndex);
  }
};

const expandFunctionError = () => {
  isFunctionErrorOpen.value = !isFunctionErrorOpen.value;
};
// Specific function that updates the active cell action ID
const updateActiveCell = (cell?: { id: string; column: { id: string } }) => {
  if (!cell) {
    activeCellActionId.value = "";
  } else {
    activeCellActionId.value = `${cell.id}_${cell.column.id}`;
  }
};

// Debounced version of the function
const debounceCellAction = debounce(updateActiveCell, 250);

// Event handlers for mouse over and mouse leave
const handleCellMouseOver = (cell: { id: string; column: { id: string } }) => {
  debounceCellAction(cell);
};

const handleCellMouseLeave = () => {
  activeCellActionId.value = "";
};

const viewTrace = (row: any) => {
  emits("view-trace", row);
};

const showCorrelation = (row: any) => {
  emits("show-correlation", row);
};

const sendToAiChat = (
  value: any,
  isEntireRow: boolean = false,
  append: boolean = true,
) => {
  if (isEntireRow) {
    //here we will get the original value of the "row"
    //and we need to filter the row if props.columns have any filtered cols that user applied
    //the format of the props.columns is like this:
    //if user have not applied any filter then the props.columns will be like this:
    //it contains _timestamp column and source column
    //else we get _timestamp column and other filter columns so if user have applied any filter then we need to filter the row based on the filter columns
    const row = JSON.parse(value);
    //lets filter based on props.columns so lets ignore _timestamp column as it is always present and now we want to check if source is present we can directly send the "row"
    //otherwise we need to filter the row based on the columns that user have applied
    if (checkIfSourceColumnPresent(props.columns)) {
      emits("sendToAiChat", JSON.stringify(row), append);
    } else {
      //we need to filter the row based on the columns that user have applied
      const filteredRow = filterRowBasedOnColumns(row, props.columns);
      emits("sendToAiChat", JSON.stringify(filteredRow), append);
    }
  } else {
    emits("sendToAiChat", value, append);
  }
};

const checkIfSourceColumnPresent = (columns: any) => {
  //we need to check if source column is present in the columns
  //if present then we need to return true else false
  return columns.some((column: any) => column.id === "source");
};

const filterRowBasedOnColumns = (row: any, columns: any) => {
  //we need to filter the row based on the columns that user have applied
  //here we need to filter row not columns based on the columns that user have applied
  const columnsToFilter = columns.filter(
    (column: any) => column.id !== "source",
  );
  return columnsToFilter.reduce((acc: any, column: any) => {
    acc[column.id] = row[column.id];
    return acc;
  }, {});
};

defineExpose({
  parentRef,
  virtualRows,
  sendToAiChat,
  store,
  selectedStreamFtsKeys,
  processedResults,
});
</script>
<style>
@import "@/assets/styles/log-highlighting.css";
</style>
<style scoped lang="scss">
@import "@/styles/logs/tenstack-table.scss";

// Compact expand/collapse button for log rows — matches original q-btn dense size="xs" flat
.log-row-expand-btn {
  height: 1.25rem !important;
  width: 1.25rem !important;
  min-height: 1.25rem !important;
  min-width: 1.25rem !important;
  padding: 0 !important;
  vertical-align: middle !important;
}

:deep(.log-row-expand-btn svg) {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

// Log table row surface colour — uniform background, separator via border-bottom only
.log-row-base {
  background-color: var(--o2-log-table-row-bg);
}

.table-row-hover {
  transition: background-color 0.12s ease-in-out, box-shadow 0.12s ease-in-out;
  border-bottom-color: var(--o2-log-table-row-border) !important;

  &:hover {
    background-color: var(--o2-log-table-row-hover) !important;
    box-shadow: inset 3px 0 0 var(--o2-primary-color) !important;
  }
}

// Fix: OButton base class (tw:relative) overrides tw:absolute passed via props.
// Use top:0 + translate:-50% 0 to anchor the button flush with the row top,
// and height:100% to fill the td height (= row height minus 1px border).
// Overriding the CSS `translate` property (not `transform`) is required because
// Tailwind v4 sets tw:-translate-y-1/2 via the CSS `translate` shorthand property.
:deep(.ai-btn) {
  position: absolute !important;
  top: 50% !important;
  right: 0.875rem !important;
  translate: -50% -50% !important;
  height: 0.875rem !important;
  min-height: 0 !important;
  width: 0.900rem !important;
  min-width: 0 !important;
  border-radius: 0.25rem !important;
}

:deep(.ai-btn img.ai-icon) {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

// Suppress the hover box-shadow — it visually bleeds outside the row boundary
:deep(.ai-btn:hover) {
  box-shadow: none !important;
}

// ── Loading skeleton ─────────────────────────────────────────────
.logs-skel-row {
  opacity: 0;
  animation: logs-skel-row-in 320ms ease-out forwards;
  border-bottom: 1px solid var(--o2-log-table-row-border);
  height: 29px;
  background-color: var(--o2-log-table-row-bg);
}

.logs-skel-pill {
  // Light mode — matches histogram-skeleton --hsk-bar (grey-100 #f5f5f5)
  background: linear-gradient(
    90deg,
    var(--color-grey-100)       0%,
    rgba(255, 255, 255, 0.65)   50%,
    var(--color-grey-100)       100%
  );
  background-size: 200% 100%;
  animation: logs-skel-shimmer 1.5s ease-in-out infinite;

  // Dark mode — matches histogram-skeleton dark --hsk-bar (grey-600 #525252)
  .body--dark & {
    background: linear-gradient(
      90deg,
      var(--color-grey-600)       0%,
      rgba(255, 255, 255, 0.03)   50%,
      var(--color-grey-600)       100%
    );
  }
}

@keyframes logs-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes logs-skel-row-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .logs-skel-row  { opacity: 1; animation: none; }
  .logs-skel-pill { animation: none; }
}
</style>
