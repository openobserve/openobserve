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
      props.scrollEl
        ? 'relative'
        : 'o2-scroll-container table-container relative overflow-auto overflow-x-auto rounded-none!',
    ]"
    class="text-text-body"
  >
    <!-- Top progress bar: keeps rows visible while a new result set streams in
      (e.g. streaming_aggs replacing values). Same component dashboard panels
      use; driven by backend streaming progress. The full skeleton below is
      shown only on first load (no rows yet). -->
    <LoadingProgress :loading="loading" :loadingProgressPercentage="loadingProgressPercentage" />
    <!-- Row/cell actions live in a right-click context menu rather than a hover
      overlay: the overlay had to cover the cell text to be reachable, and it
      could only ever be offered on the handful of columns wide enough to host
      it. The menu is anchored to the pointer, so every cell can offer actions. -->
    <OContextMenu v-if="table" @update:open="onContextMenuOpenChange">
      <template #trigger>
        <table
          data-test="logs-search-result-logs-table"
          class="logs-table w-full table-auto"
          @contextmenu.capture="handleTableContextMenu"
          :style="{
            minWidth: '100%',
            ...columnSizeVars,
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
            class="sticky top-0 z-10 max-h-11"
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <VueDraggable
              v-model="columnOrder"
              :element="'table'"
              :animation="200"
              :sort="!isResizingHeader || !defaultColumns"
              handle=".table-head"
              :class="[
                { 'cursor-move': table.getState().columnOrder.length > 1 },
                // Header-row chrome via centralized token utilities (same tokens
                // OTable uses): background band + full-width underline on the row.
                'bg-table-header-bg border-table-header-border border-b',
              ]"
              :style="{
                width:
                  defaultColumns && wrap
                    ? width - 12 + 'px'
                    : defaultColumns
                      ? tableRowSize + 'px'
                      : '100%',
                minWidth: '100%',
              }"
              tag="tr"
              @start="(event) => handleDragStart(event)"
              @end="() => handleDragEnd()"
              class="flex h-8 items-center"
            >
              <th
                v-for="(header, headerIndex) in headerGroup.headers"
                :key="header.id"
                :id="header.id"
                class="table-head relative px-2 text-ellipsis"
                :style="
                  !defaultColumns && headerIndex === headerGroup.headers.length - 1
                    ? {
                        flex: '1 1 auto',
                        minWidth: `calc(var(--header-${header?.id}-size) * 1px)`,
                        width: 'auto',
                        overflow: 'hidden',
                      }
                    : {
                        width: `calc(var(--header-${header?.id}-size) * 1px)`,
                        minWidth: `calc(var(--header-${header?.id}-size) * 1px)`,
                        flexShrink: '0',
                      }
                "
                :data-test="`log-search-result-table-th-${header.id}`"
              >
                <!-- Column separator / resize handle. The separator LINE renders on
                 EVERY column (even non-resizable ones like timestamp/source, which
                 set enableResizing:false) so the vertical dividers are continuous.
                 The drag interactivity + hover accent only apply when the column
                 is resizable. Matches the OTable spec: short 1px --color-border. -->
                <div
                  @dblclick="header.column.getCanResize() && header.column.resetSize()"
                  @mousedown.self.prevent.stop="
                    header.column.getCanResize() && header.getResizeHandler()?.($event)
                  "
                  @touchstart.self.prevent.stop="
                    header.column.getCanResize() && header.getResizeHandler()?.($event)
                  "
                  :class="[
                    'group/resizer absolute top-0 right-0 z-10 flex h-full touch-none items-center justify-end select-none',
                    header.column.getCanResize() ? 'resizer w-1.25 cursor-col-resize' : 'w-2',
                  ]"
                >
                  <div
                    :class="[
                      'rounded-full transition-all duration-150',
                      header.column.getIsResizing()
                        ? 'bg-table-resize-handle h-full w-0.5'
                        : 'bg-border-default h-4 w-px group-hover/resizer:h-full group-hover/resizer:w-0.5 group-hover/resizer:bg-[var(--color-table-resize-handle)]',
                    ]"
                  />
                </div>

                <div
                  v-if="!header.isPlaceholder"
                  :class="[
                    'text-left',
                    header.column.getCanSort() ? 'cursor-pointer select-none' : '',
                  ]"
                  @click="getSortingHandler($event, header.column.getToggleSortingHandler())"
                  class="text-table-header-text overflow-hidden text-xs font-medium text-ellipsis"
                >
                  <FlexRender
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                  />
                </div>

                <div
                  v-if="
                    !header.isPlaceholder &&
                    ((header.column.columnDef.meta as any).closable ||
                      (header.column.columnDef.meta as any).showWrap)
                  "
                  :data-test="`log-add-data-from-column-${header.column.columnDef.header}`"
                  class="bg-table-header-bg column-actions invisible absolute top-0 right-2 flex h-full items-center pl-3"
                >
                  <OIcon
                    v-if="(header.column.columnDef.meta as any).closable"
                    :data-test="`logs-search-result-table-th-remove-${header.column.columnDef.header}-btn`"
                    name="close"
                    class="close-icon text-icon-color hover:text-text-heading cursor-pointer transition-colors"
                    :title="t('common.close')"
                    size="xs"
                    @click.stop="closeColumn(header.column.columnDef)"
                  />
                </div>
              </th>
            </VueDraggable>

            <tr v-if="!loading && errMsg != ''" class="w-full">
              <td :colspan="columnOrder.length" class="font-bold opacity-70">
                <div class="bg-warning text-sm font-bold font-medium">
                  <OIcon size="xs" name="warning" class="mr-1" />
                  {{ errMsg }}
                </div>
              </td>
            </tr>
            <tr data-test="log-search-result-function-error" v-if="functionErrorMsg != ''">
              <td :colspan="columnOrder.length" class="font-bold opacity-60">
                <div class="bg-status-warning-bg pl-2 text-sm font-bold font-medium">
                  <OButton
                    variant="ghost"
                    size="icon-xs"
                    class="log-row-expand-btn mr-1"
                    data-test="table-row-expand-menu"
                    @click.capture.stop="expandFunctionError"
                    ><OIcon
                      :name="isFunctionErrorOpen ? 'expand-more' : 'chevron-right'"
                      size="sm" /></OButton
                  ><b>
                    <OIcon name="warning" size="sm" />
                    {{ t("search.functionErrorLabel") }}</b
                  >
                </div>
              </td>
            </tr>
            <tr v-if="functionErrorMsg != '' && isFunctionErrorOpen">
              <td :colspan="columnOrder.length" class="bg-status-warning-bg px-2 opacity-70">
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
            :aria-label="t('logs.tenstackTable.loadingLogs')"
          >
            <!-- Rows use flex to match the real virtual rows exactly -->
            <tr
              v-for="r in SKEL_ROW_COUNT"
              :key="`skel-${r}`"
              class="logs-skel-row bg-log-table-row-bg border-log-table-row-border flex h-[1.8125rem] w-full items-center border-b opacity-0"
              :style="{ animationDelay: `${(r - 1) * 40}ms` }"
            >
              <!-- No columns loaded yet (first page load) — full-width shimmer bar -->
              <td v-if="!headers?.length" class="w-full overflow-hidden px-4">
                <span
                  class="logs-skel-pill rounded-default inline-block h-3"
                  :style="{ width: `${skelCellWidth(r - 1, 0)}%` }"
                  aria-hidden="true"
                />
              </td>
              <!-- Columns available — per-column aligned shimmer pills -->
              <template v-else>
                <td
                  v-for="(header, c) in headers"
                  :key="header.id"
                  class="overflow-hidden px-2"
                  :class="c === 0 ? 'pl-4' : ''"
                  :style="skelTdStyle(header, c)"
                >
                  <span
                    class="logs-skel-pill rounded-default inline-block h-3"
                    :style="{
                      width: c === 0 ? `${SKEL_TIMESTAMP_PX}px` : `${skelCellWidth(r - 1, c)}%`,
                    }"
                    aria-hidden="true"
                  />
                </td>
              </template>
            </tr>
          </tbody>

          <!-- height reserves the full virtual-scroll height (rows are
           position:absolute and add none of their own). The `.logs-table`
           element/thead/tbody are forced to `display: block` in component.css
           so `position: relative` (containing block for the absolute rows),
           `height`, and the sticky header all behave identically in Firefox —
           Firefox does not honor these on native table-row-group boxes. -->
          <tbody
            data-test="logs-search-result-table-body"
            ref="tableBodyRef"
            class="relative"
            :style="{ height: totalSize + 'px' }"
          >
            <template v-for="virtualRow in virtualRows" :key="formattedRows[virtualRow.index]?.id">
              <tr
                :data-test="`logs-search-result-detail-${
                  (tableRows[virtualRow.index] as any)[
                    store.state.zoConfig.timestamp_column || '_timestamp'
                  ]
                }`"
                :style="{
                  transform: `translateY(${virtualRow.start}px)`,
                  minWidth: '100%',
                  width:
                    !defaultColumns &&
                    !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                      ? '100%'
                      : undefined,
                }"
                :data-index="virtualRow.index"
                :data-expanded="formattedRows?.[virtualRow.index]?.original?.isExpandedRow"
                :tabindex="
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow ? 0 : undefined
                "
                :ref="(node: any) => node && rowVirtualizer.measureElement(node)"
                :class="[
                  'absolute flex w-max items-center justify-start border-b',
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                    ? 'cursor-pointer'
                    : 'cursor-default',
                  defaultColumns &&
                  !wrap &&
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                    ? 'table-row'
                    : 'flex break-all',
                  (tableRows[virtualRow.index] as any)[store.state.zoConfig.timestamp_column] ===
                    highlightTimestamp &&
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                    ? 'bg-table-row-selected-bg'
                    : !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                      ? 'log-row-base bg-log-table-row-bg'
                      : '',
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow
                    ? 'table-row-hover table-row-focus border-b-log-table-row-border! transition-[background-color,box-shadow] duration-120 [transition-timing-function:ease-in-out] focus-visible:outline-none'
                    : '',
                ]"
                @click="
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow &&
                  handleDataRowClick(tableRows[virtualRow.index], virtualRow.index)
                "
                @keydown="
                  !(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow &&
                  handleRowKeydown($event, tableRows[virtualRow.index], virtualRow.index)
                "
              >
                <!-- Status color line for entire row -->
                <div
                  v-if="!(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow"
                  class="absolute inset-y-0 left-0 z-10 w-1"
                  data-test="log-table-row-status-color"
                  :data-test-status-level="getRowStatusLevel(tableRows[virtualRow.index])"
                  :style="{
                    backgroundColor: getRowStatusColor(tableRows[virtualRow.index]),
                  }"
                />
                <td
                  v-if="(formattedRows[virtualRow.index]?.original as any)?.isExpandedRow"
                  :colspan="columnOrder.length"
                  :data-test="`log-search-result-expanded-row-${virtualRow.index}`"
                  class="relative w-full"
                >
                  <JsonPreview
                    :value="tableRows[virtualRow.index - 1] as any"
                    show-copy-button
                    class="py-1.5"
                    mode="expanded"
                    :index="calculateActualIndex(virtualRow.index - 1)"
                    :highlight-query="highlightQuery"
                    :hide-view-related="hideViewRelatedButton"
                    :hide-search-term-actions="hideSearchTermActions"
                    @copy="copyLogToClipboard"
                    @add-field-to-table="addFieldToTable"
                    @add-search-term="addSearchTerm"
                    @view-trace="viewTrace(formattedRows[virtualRow.index - 1]?.original)"
                    @show-correlation="
                      showCorrelation(formattedRows[virtualRow.index - 1]?.original)
                    "
                    :streamName="jsonpreviewStreamName"
                    @send-to-ai-chat="sendToAiChat"
                  />
                </td>
                <template v-else>
                  <td
                    v-for="(cell, cellIndex) in formattedRows[virtualRow.index].getVisibleCells()"
                    :key="cell.id"
                    :data-test="
                      'log-table-column-' + virtualRow.index + '-' + cell.column.columnDef.id
                    "
                    class="py-none relative flex table-cell items-center justify-start px-2"
                    :class="[...tableCellClass, { 'pl-4': cellIndex === 0 }]"
                    :style="
                      !defaultColumns &&
                      cellIndex === formattedRows[virtualRow.index].getVisibleCells().length - 1
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
                    @contextmenu="handleCellContextMenu(cell)"
                  >
                    <OButton
                      v-if="cellIndex == 0"
                      variant="ghost"
                      size="icon-xs"
                      class="log-row-expand-btn mr-1"
                      data-test="table-row-expand-menu"
                      @click.capture.stop="handleExpandRow(virtualRow.index)"
                      ><OIcon
                        :name="
                          expandedRowIndices.has(virtualRow.index) ? 'expand-more' : 'chevron-right'
                        "
                        size="sm"
                    /></OButton>

                    <span
                      v-if="
                        processedResultsMap[
                          `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                        ]
                      "
                      :key="`${cell.column.id}_${calculateActualIndex(virtualRow.index)}`"
                      v-html="
                        processedResultsMap[
                          `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                        ]
                      "
                    />
                    <span v-else>
                      {{ cell.renderValue() }}
                    </span>
                  </td>
                </template>
              </tr>
            </template>
          </tbody>
        </table>
      </template>

      <!-- Actions apply to the cell that was right-clicked. `contextCell` is
        recorded by the td's own @contextmenu, which fires before reka-ui opens
        the menu, so the content is always in sync with the pointer. -->
      <template v-if="contextCell">
        <OContextMenuLabel data-test="log-context-menu-field">
          {{ contextCell.columnId }}
        </OContextMenuLabel>
        <OContextMenuSeparator />

        <OContextMenuItem
          icon-left="content-copy"
          data-test="log-context-menu-copy-value"
          @select="copyLogToClipboard(contextCell.value)"
        >
          {{ t("logs.cellActions.copy") }}
        </OContextMenuItem>

        <template v-if="contextCellIsStreamField && !hideSearchTermActions">
          <OContextMenuItem
            data-test="log-context-menu-include-term"
            @select="
              addSearchTerm(contextCell.columnId, toSearchTermValue(contextCell.value), 'include')
            "
          >
            <!-- size="sm" matches the registry icons on the other items so the
              labels line up; the glyph itself is inset because it fills its
              viewBox edge-to-edge, unlike Material Symbols. -->
            <template #icon-left>
              <OIcon name="" size="sm">
                <EqualIcon class="size-3" />
              </OIcon>
            </template>
            {{ t("logs.cellActions.includeTerm") }}
          </OContextMenuItem>

          <OContextMenuItem
            data-test="log-context-menu-exclude-term"
            @select="
              addSearchTerm(contextCell.columnId, toSearchTermValue(contextCell.value), 'exclude')
            "
          >
            <template #icon-left>
              <OIcon name="" size="sm">
                <NotEqualIcon class="size-3" />
              </OIcon>
            </template>
            {{ t("logs.cellActions.excludeTerm") }}
          </OContextMenuItem>
        </template>

        <template v-if="aiEnabled">
          <OContextMenuSeparator />
          <OContextMenuItem
            icon-left="auto-awesome"
            data-test="log-context-menu-ai-value"
            @select="sendToAiChat(JSON.stringify(contextCell.value))"
          >
            {{ t("logs.cellActions.sendValueToAi") }}
          </OContextMenuItem>
          <OContextMenuItem
            icon-left="auto-awesome"
            data-test="log-context-menu-ai-row"
            @select="sendToAiChat(JSON.stringify(contextCell.row), true)"
          >
            {{ t("logs.cellActions.sendRowToAi") }}
          </OContextMenuItem>
        </template>
      </template>
    </OContextMenu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, ComputedRef } from "vue";
import type { PropType } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  FlexRender,
  type ColumnDef,
  type SortingState,
  type TableOptionsWithReactiveData,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/vue-table";
import JsonPreview from "./JsonPreview.vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import { debounce } from "lodash-es";
import config from "@/aws-exports";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OContextMenu from "@/lib/overlay/ContextMenu/OContextMenu.vue";
import OContextMenuItem from "@/lib/overlay/ContextMenu/OContextMenuItem.vue";
import OContextMenuLabel from "@/lib/overlay/ContextMenu/OContextMenuLabel.vue";
import OContextMenuSeparator from "@/lib/overlay/ContextMenu/OContextMenuSeparator.vue";
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
    // Receives field-name strings (see SearchResult selectedStreamFullTextSearchKeys).
    type: Array as PropType<string[]>,
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
useTextHighlighter();
const { processedResults, processHitsInChunks } = useLogsHighlighter();

// Typed view of the highlighter cache for indexed template lookups.
const processedResultsMap = computed<Record<string, string>>(() => processedResults.value);

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

// The cell the user last right-clicked — drives the context menu's contents.
// Held as plain values (not the TanStack cell) so the menu keeps rendering
// correctly even if the virtualizer recycles the row underneath it.
interface ContextCell {
  columnId: string;
  value: unknown;
  row: Record<string, unknown>;
}

const contextCell = ref<ContextCell | null>(null);

const contextCellIsStreamField = computed(() => {
  const columnId = contextCell.value?.columnId;
  if (!columnId) return false;
  return (
    props.selectedStreamFields?.find((field) => field.name === columnId)?.isSchemaField ?? false
  );
});

// Mirrors O2AIContextAddBtn's own gate — the AI actions only exist on
// enterprise builds with AI turned on in the backend config.
const aiEnabled = computed(
  () => config.isEnterprise === "true" && !!store.state.zoConfig.ai_enabled,
);

const highlightQuery = computed(() => {
  return props.highlightQuery;
});

const getRowStatusColor = (rowData: any) => {
  const statusInfo = extractStatusFromLog(rowData);
  return statusInfo.color;
};

// Detected severity/level for the row, exposed as a data attribute on the status
// color bar. This keeps the severity machine-readable regardless of which column
// is displayed (e.g. the FTS "body" column instead of the raw "source" JSON).
const getRowStatusLevel = (rowData: any) => {
  return extractStatusFromLog(rowData).level;
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
  // aggregationFns et al. are injected by TanStack's feature models at runtime;
  // its option type marks them required, so assert the reactive-data shape.
} as TableOptionsWithReactiveData<Record<string, unknown>>);

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
      hasDefaultSourceColumn.value && !props.wrap ? "table-cell" : "block",
      !props.wrap ? "overflow-hidden text-ellipsis whitespace-nowrap" : "",
      props.wrap ? "break-all" : "",
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

const headers = computed<any[]>(() => headerGroups.value.headers);

// Skeleton loading helpers — mirrors OTable shimmer pattern
const SKEL_ROW_COUNT = 30;
const SKEL_BASE_WIDTHS = [55, 70, 60, 45, 65, 50, 75, 40, 58, 68, 48, 62];
const SKEL_JITTER = [0, 6, -4, 3, -2, 5, -3, 2, -5, 4, -1, 6];
// Timestamp column: pill sized to "2026-06-02 12:09:00.349" (23 chars × 7.2 px/char in monospace 12 px)
const SKEL_TIMESTAMP_PX = Math.round("2026-06-02 12:09:00.349".length * 7.2);
const skelCellWidth = (r: number, c: number): number => {
  const base = SKEL_BASE_WIDTHS[c % SKEL_BASE_WIDTHS.length] ?? 60;
  const jit = SKEL_JITTER[(r + c) % SKEL_JITTER.length] ?? 0;
  return Math.max(25, Math.min(85, base + jit));
};
// Mirror the exact width/flex logic from real cells so the skeleton columns align perfectly.
// Source column: width:'auto' in real rows → flex:1 here to fill remaining row space.
// All other columns: fixed width from the CSS variable (same as real rows).
const skelTdStyle = (header: any, c: number): Record<string, string> => {
  const colId = header.column.id;
  const isStretchSource = colId === "source" && !header.column.getCanResize();
  if (isStretchSource) return { flex: "1 1 0", minWidth: "0" };
  const w = `calc(var(--col-${colId}-size) * 1px)`;
  if (!props.defaultColumns && c === headers.value.length - 1) {
    return { flex: "1 1 auto", minWidth: w, width: "auto", overflow: "hidden" };
  }
  return { width: w, minWidth: w, flexShrink: "0" };
};

watch(
  () => headers.value,
  (newVal) => {
    isResizingHeader.value = newVal.some((header: any) => header.column.getIsResizing());
  },
  {
    deep: true,
  },
);

const parentRef = ref<HTMLElement | null>(null);

const isFirefox = computed(() => {
  return typeof document !== "undefined" && CSS.supports("-moz-appearance", "none");
});

// Cache for expanded row heights
const expandedRowHeights = ref<{ [key: number]: number }>({});

const rowVirtualizerOptions = computed(() => {
  return {
    count: formattedRows.value.length,
    getScrollElement: () => (props.scrollEl as HTMLElement | null) ?? parentRef.value,
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
            const isExpandedRow = formattedRows.value[index]?.original?.isExpandedRow;
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
const addSearchTerm = (field: string, field_value: string | number | boolean, action: string) => {
  emits("addSearchTerm", field, field_value, action);
};

/**
 * A log row is arbitrary JSON, so a right-clicked cell holds an unknown value,
 * while the filter builder downstream (getFilterExpressionByFieldType) takes a
 * primitive and interpolates it into the query expression.
 *
 * Primitives pass through untouched — the builder needs the real type to emit
 * the unquoted form for int64/float64/boolean schema fields. null/undefined
 * collapse to the "null" sentinel the builder already special-cases into
 * `is null` / `is not null`. Objects and arrays are serialised, so a nested
 * value reaches the query as its JSON rather than "[object Object]".
 */
const toSearchTermValue = (value: unknown): string | number | boolean => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value);
};
const addFieldToTable = (value: string) => {
  emits("addFieldToTable", value);
};

const closeColumn = (data: any) => {
  emits("closeColumn", data);
};

const handleDragStart = (event: any) => {
  if (columnOrder.value[event.oldIndex] === store.state.zoConfig.timestamp_column) {
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
      const expandedElement = document.querySelector(`[data-index="${index + 1}"]`);
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

const handleRowKeydown = (event: KeyboardEvent, row: any, index: number) => {
  // Only handle keys originating from the row itself, not focusable inner elements.
  if (event.target !== event.currentTarget) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleDataRowClick(row, index);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    let sibling =
      event.key === "ArrowDown"
        ? (event.currentTarget as HTMLElement).nextElementSibling
        : (event.currentTarget as HTMLElement).previousElementSibling;
    while (sibling && !sibling.matches("tr[tabindex]")) {
      sibling =
        event.key === "ArrowDown" ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    if (sibling instanceof HTMLElement) sibling.focus();
  }
};

const expandFunctionError = () => {
  isFunctionErrorOpen.value = !isFunctionErrorOpen.value;
};
// Capture-phase gate on the whole table, so it runs before the per-cell handler
// below. Only data cells offer actions — right-clicking a header or the
// expanded JSON row would otherwise open an empty menu. reka-ui checks
// `defaultPrevented` before opening, so preventing here suppresses it.
const DATA_CELL_SELECTOR = "td[data-test^='log-table-column-']";

const handleTableContextMenu = (event: MouseEvent) => {
  contextCell.value = null;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest?.(DATA_CELL_SELECTOR)) {
    event.preventDefault();
  }
};

// Records which cell the right-click landed on. Runs on the td, so it fires
// before OContextMenu's own handler on the table (which defers a tick) — by the
// time the menu renders, `contextCell` already describes the clicked cell.
const handleCellContextMenu = (cell: { column: { id: string }; row: { original: unknown } }) => {
  const row = (cell.row.original ?? {}) as Record<string, unknown>;
  contextCell.value = {
    columnId: cell.column.id,
    value: row[cell.column.id],
    row,
  };
};

// Drop the reference once the menu closes so a recycled virtual row can't be
// held alive by a stale row object.
const onContextMenuOpenChange = (open: boolean) => {
  if (!open) contextCell.value = null;
};

const viewTrace = (row: any) => {
  emits("view-trace", row);
};

const showCorrelation = (row: any) => {
  emits("show-correlation", row);
};

const sendToAiChat = (value: any, isEntireRow: boolean = false, append: boolean = true) => {
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
  const columnsToFilter = columns.filter((column: any) => column.id !== "source");
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
<style scoped>
/* keep(lib-override:monaco) does not apply here; the keepers below are:
   keep(complex-state) — .table-row-hover/.table-row-focus drive the virtualized
   row background+inset marker off :hover/:focus-visible on rows that the
   virtualizer positions absolutely; expressing them as utilities would mean
   editing every recycled row node.
   keep(keyframes) — the skeleton shimmer/entrance animations are referenced only
   from CSS in this block, so Vue's scoped @keyframes renaming stays consistent. */

/* Compact expand/collapse button for log rows — matches the original dense xs flat button */
.log-row-expand-btn {
  height: 1.25rem !important;
  width: 1.25rem !important;
  min-height: 1.25rem !important;
  min-width: 1.25rem !important;
  padding: 0 !important;
  vertical-align: middle !important;
}

/* svg is rendered inside OButton's own template, so it needs :deep() */
.log-row-expand-btn :deep(svg) {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

.table-row-hover:hover,
.table-row-focus:focus-visible {
  background-color: var(--color-log-table-row-hover) !important;
  box-shadow: inset 0.1875rem 0 0 var(--color-accent) !important;
}

/* This "table" lays out entirely with flexbox + explicit column widths — it does
   not use native table column layout. Rendering table/thead/tbody as block boxes
   makes position:relative (the containing block for the position:absolute
   virtual rows), height, and position:sticky on the header behave identically
   across browsers; Firefox does not honor these on native table-row-group
   boxes, which left the results table collapsed with no visible rows. */
.logs-table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--text-xs) !important;
}

.logs-table,
.logs-table > thead,
.logs-table > tbody {
  display: block;
}

.logs-table thead {
  font-family: var(--font-sans);
  font-size: var(--text-sm) !important;
}

.logs-table th {
  text-align: left;
}

/* !important is load-bearing: it outranks the `invisible` utility the actions
   carry by default. */
.logs-table th:hover .column-actions {
  visibility: visible !important;
}

.logs-table td {
  font-family: var(--font-mono);
}

/* ── Loading skeleton ───────────────────────────────────────────── */
.logs-skel-row {
  animation: logs-skel-row-in 320ms ease-out forwards;
}

/* Token-backed shimmer: --color-skeleton-* already flip with the theme. */
.logs-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-skeleton-base) 0%,
    var(--color-skeleton-highlight) 50%,
    var(--color-skeleton-base) 100%
  );
  background-size: 200% 100%;
  animation: logs-skel-shimmer 1.5s ease-in-out infinite;
}

@keyframes logs-skel-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes logs-skel-row-in {
  from {
    opacity: 0;
    transform: translateY(0.125rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .logs-skel-row {
    opacity: 1;
    animation: none;
  }
  .logs-skel-pill {
    animation: none;
  }
}
</style>
