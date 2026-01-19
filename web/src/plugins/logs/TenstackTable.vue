<!-- Copyright 2023 OpenObserve Inc.

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
    class="container tw:rounded-none! tw:overflow-x-auto tw:relative table-container"
  >
    <table
      v-if="table"
      data-test="logs-search-result-logs-table"
      class="tw:w-full tw:table-auto logs-table"
      :style="{
        minWidth: '100%',
        ...columnSizeVars,
        minHeight: totalSize + 'px',
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
        style="max-height: 44px; height: 22px"
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
                  : table.getTotalSize() + 'px',
            minWidth: '100%',
            background: store.state.theme === 'dark' ? '#565656' : '#E0E0E0',
          }"
          tag="tr"
          @start="(event) => handleDragStart(event)"
          @end="() => handleDragEnd()"
          class="tw:flex items-center"
        >
          <th
            v-for="header in headerGroup.headers"
            :key="header.id"
            :id="header.id"
            class="tw:px-2 tw:relative table-head tw:text-ellipsis"
            :style="{ width: `calc(var(--header-${header?.id}-size) * 1px)` }"
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
                'text-left',
                header.column.getCanSort() ? 'cursor-pointer select-none' : '',
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

              <div
                :data-test="`log-add-data-from-column-${header.column.columnDef.header}`"
                class="tw:invisible tw:items-center tw:absolute tw:right-2 tw:top-0 tw:px-2 column-actions"
                :class="
                  store.state.theme === 'dark' ? 'field_overlay_dark' : ''
                "
                v-if="
                  (header.column.columnDef.meta as any).closable ||
                  (header.column.columnDef.meta as any).showWrap
                "
              >
                <q-icon
                  v-if="(header.column.columnDef.meta as any).closable"
                  :data-test="`logs-search-result-table-th-remove-${header.column.columnDef.header}-btn`"
                  name="cancel"
                  class="q-ma-none close-icon cursor-pointer"
                  :class="
                    store.state.theme === 'dark' ? 'text-white' : 'text-grey-7'
                  "
                  :title="t('common.close')"
                  size="18px"
                  @click="closeColumn(header.column.columnDef)"
                >
                </q-icon>
              </div>
            </div>
          </th>
        </vue-draggable>

        <tr v-if="loading" class="tw:w-full">
          <td
            :colspan="columnOrder.length"
            class="text-bold"
            :style="{
              background: store.state.theme === 'dark' ? '#565656' : '#E0E0E0',
              opacity: 0.7,
            }"
          >
            <div
              class="text-subtitle2 text-weight-bold tw:flex tw:items-center"
            >
              <q-spinner-hourglass size="20px" />
              {{ t("confirmDialog.loading") }}
            </div>
          </td>
        </tr>
        <tr v-if="!loading && errMsg != ''" class="tw:w-full">
          <td
            :colspan="columnOrder.length"
            class="text-bold"
            style="opacity: 0.7"
          >
            <div class="text-subtitle2 text-weight-bold bg-warning">
              <q-icon size="xs" name="warning" class="q-mr-xs" />
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
            class="text-bold"
            style="opacity: 0.6"
          >
            <div
              class="text-subtitle2 text-weight-bold q-pl-sm"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-yellow-600'
                  : 'tw:bg-amber-300'
              "
            >
              <q-btn
                :icon="isFunctionErrorOpen ? 'expand_more' : 'chevron_right'"
                dense
                size="xs"
                flat
                class="q-mr-xs"
                data-test="table-row-expand-menu"
                @click.capture.stop="expandFunctionError"
              ></q-btn
              ><b>
                <q-icon name="warning" size="15px"></q-icon>
                {{ t("search.functionErrorLabel") }}</b
              >
            </div>
          </td>
        </tr>
        <tr v-if="functionErrorMsg != '' && isFunctionErrorOpen">
          <td
            :colspan="columnOrder.length"
            style="opacity: 0.7"
            class="q-px-sm"
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
      <tbody
        data-test="logs-search-result-table-body"
        ref="tableBodyRef"
        class="tw:relative"
      >
        <template v-for="virtualRow in virtualRows" :key="virtualRow.id">
          <tr
            :data-test="`logs-search-result-detail-${
              (tableRows[virtualRow.index] as any)[
                store.state.zoConfig.timestamp_column || '_timestamp'
              ]
            }`"
            :style="{
              transform: `translateY(${virtualRow.start + (isFirefox ? baseOffset : 0)}px)`,
              minWidth: '100%',
            }"
            :data-index="virtualRow.index"
            :data-expanded="
              formattedRows?.[virtualRow.index]?.original?.isExpandedRow
            "
            :ref="(node: any) => node && rowVirtualizer.measureElement(node)"
            class="tw:absolute tw:flex tw:w-max tw:items-center tw:justify-start tw:border-b-[1px] tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)]"
            :class="[
              defaultColumns &&
              !wrap &&
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? 'tw:table-row'
                : 'tw:flex',
              (tableRows[virtualRow.index] as any)[
                store.state.zoConfig.timestamp_column
              ] === highlightTimestamp &&
              !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                ? store.state.theme === 'dark'
                  ? 'tw:bg-zinc-700'
                  : 'tw:bg-zinc-300'
                : '',
              'table-row-hover',
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
                class="tw:py-none tw:px-2 tw:items-center tw:justify-start tw:relative table-cell"
                :class="[...tableCellClass, { 'tw:pl-4': cellIndex === 0 }]"
                :style="{
                  width:
                    cell.column.columnDef.id !== 'source' ||
                    cell.column.columnDef.enableResizing
                      ? `calc(var(--col-${cell.column.columnDef.id}-size) * 1px)`
                      : wrap
                        ? width - 260 - 12 + 'px'
                        : 'auto',
                  height: wrap ? '100%' : '20px',
                }"
                @mouseover="handleCellMouseOver(cell)"
                @mouseleave="handleCellMouseLeave()"
              >
                <q-btn
                  v-if="cellIndex == 0"
                  :icon="
                    expandedRowIndices.has(virtualRow.index)
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  data-test="table-row-expand-menu"
                  @click.capture.stop="handleExpandRow(virtualRow.index)"
                ></q-btn>

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
                <O2AIContextAddBtn
                  v-if="
                    cell.column.columnDef.id ===
                    store.state.zoConfig.timestamp_column
                  "
                  class="tw:absolute tw:top-1/2 tw:transform tw:invisible tw:-translate-y-1/2 ai-btn"
                  @send-to-ai-chat="
                    sendToAiChat(JSON.stringify(cell.row.original), true)
                  "
                />
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
import { debounce } from "quasar";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

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

    if (props.columns?.length && tableRows.value?.length) {
      processHitsInChunks(
        tableRows.value,
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

    if (props.columns?.length && tableRows.value?.length) {
      processHitsInChunks(
        tableRows.value,
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
      props.wrap ? "tw:break-words" : "",
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

const baseOffset = isFirefox.value ? 20 : 0;

// Cache for expanded row heights
const expandedRowHeights = ref<{ [key: number]: number }>({});

const rowVirtualizerOptions = computed(() => {
  return {
    count: formattedRows.value.length,
    getScrollElement: () => parentRef.value,
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
            if (isExpandedRow || props.wrap) {
              const height = element.getBoundingClientRect().height;
              expandedRowHeights.value[index] = height;
              return height;
            }
            return 24; // Fixed height for collapsed rows
          }
        : undefined,
  };
});

const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());

const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

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

    // Clear cached height for collapsed row
    delete expandedRowHeights.value[index + 1];

    // Remove the expanded row from tableRows
    tableRows.value.splice(index + 1, 1);
    isCollapseOperation = true;

    // Update all expanded indices that come after this collapsed row
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

    // Insert the expanded row
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

const sendToAiChat = (value: any, isEntireRow: boolean = false) => {
  if (isEntireRow) {
    //here we will get the original value of the row
    //and we need to filter the row if props.columns have any filtered cols that user applied
    //the format of the props.columns is like this:
    //if user have not applied any filter then the props.columns will be like this:
    //it contains _timestamp column and source column
    //else we get _timestamp column and other filter columns so if user have applied any filter then we need to filter the row based on the filter columns
    const row = JSON.parse(value);
    //lets filter based on props.columns so lets ignore _timestamp column as it is always present and now we want to check if source is present we can directly send the row
    //otherwise we need to filter the row based on the columns that user have applied
    if (checkIfSourceColumnPresent(props.columns)) {
      emits("sendToAiChat", JSON.stringify(row));
    } else {
      //we need to filter the row based on the columns that user have applied
      const filteredRow = filterRowBasedOnColumns(row, props.columns);
      emits("sendToAiChat", JSON.stringify(filteredRow));
    }
  } else {
    emits("sendToAiChat", value);
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
</style>
