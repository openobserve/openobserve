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
  <div class="table-wrapper">
    <q-table
      :key="store.state.printMode ? 'print' : 'normal'"
      :class="[
        'my-sticky-virtscroll-table',
        { 'no-position-absolute': store.state.printMode },
        { 'wrap-enabled': wrapCells },
        { 'pivot-sticky-totals': stickyRowTotals },
        { 'drilldown-active': hasDrilldown },
      ]"
      :virtual-scroll="!showPagination && !store.state.printMode"
      v-model:pagination="pagination"
      :rows-per-page-options="paginationOptions"
      :virtual-scroll-sticky-size-start="pivotHeaderLevels.length > 0 ? PIVOT_TABLE_HEADER_ROW_HEIGHT * pivotHeaderLevels.length : PIVOT_TABLE_DEFAULT_HEADER_HEIGHT"
      :virtual-scroll-sticky-size-end="stickyTotalRow ? PIVOT_TABLE_HEADER_ROW_HEIGHT : 0"
      dense
      :wrap-cells="wrapCells"
      :rows="data.rows || []"
      :columns="data.columns"
      row-key="id"
      ref="tableRef"
      data-test="dashboard-panel-table"
      :data-sticky-id="tableId"
      @row-click="(...args: any) => $emit('row-click', ...args)"
      hide-no-data
      :row-class="getRowClass"
    >
      <!-- N-level hierarchical headers for pivot tables -->
      <template v-slot:header="headerProps" v-if="pivotHeaderLevels.length > 0">
        <q-tr
          v-for="(level, levelIdx) in pivotHeaderLevels"
          :key="'hl_' + levelIdx"
        >
          <!-- Row field headers — only in first row, spanning all levels -->
          <q-th
            v-if="levelIdx === 0"
            v-for="col in pivotRowColumns"
            :key="'rh_' + col.name"
            :rowspan="pivotHeaderLevels.length"
            class="pivot-group-header cursor-pointer"
            :style="getStickyColumnStyle(col)"
            @click="headerProps.sort(col.name)"
          >
            {{ col.label }}
            <q-icon
              :name="pagination.descending ? 'arrow_downward' : 'arrow_upward'"
              size="12px"
              class="q-ml-xs pivot-sort-icon"
              :class="{ 'pivot-sort-active': pagination.sortBy === col.name }"
            />
          </q-th>
          <!-- Pivot/value group headers at this level -->
          <q-th
            v-for="(cell, cellIdx) in level.cells"
            :key="'c_' + levelIdx + '_' + cell.key"
            :colspan="cell.colspan"
            :rowspan="cell.rowspan || 1"
            :class="[
              level.isLeaf ? 'pivot-value-header' : 'pivot-group-header text-center',
              { 'pivot-section-border': cell.hasBorder },
              { 'pivot-total-col': stickyColTotals && cell._isTotalHeader },
              { 'cursor-pointer': cell._sortColumn }
            ]"
            :style="stickyColTotals && cell._isTotalHeader ? getStickyTotalHeaderForPivot(cell) : {}"
            @click="cell._sortColumn && headerProps.sort(cell._sortColumn)"
          >
            {{ cell.label }}
            <q-icon
              v-if="level.isLeaf && cell._sortColumn"
              :name="pagination.descending ? 'arrow_downward' : 'arrow_upward'"
              size="12px"
              class="q-ml-xs pivot-sort-icon"
              :class="{ 'pivot-sort-active': pagination.sortBy === cell._sortColumn }"
            />
          </q-th>
        </q-tr>
      </template>
      <template v-slot:body-cell="props">
        <q-td
          :props="props"
          :style="[
            getStyle(props),
            getStickyColumnStyle(props.col),
            getStickyTotalColumnStyle(props.col),
            isPivotMergeNoBorder(props.row, props.col) ? { 'border-bottom': '0 none' } : {},
          ]"
          :class="{
            'sticky-column': props.col.sticky,
            'pivot-total-col': stickyColTotals && props.col._isTotalColumn,
          }"
          :data-col-index="props.col.__colIndex"
          class="copy-cell-td"
        >
          <template v-if="!isPivotMergeHidden(props.row, props.col)">
            <div>
              <!-- Copy button on left for numeric/right-aligned columns -->
              <q-btn
                v-if="
                  props.col.align === 'right' && shouldShowCopyButton(props.value)
                "
                :icon="
                  isCellCopied(props.rowIndex, props.col.name)
                    ? 'check'
                    : 'content_copy'
                "
                dense
                size="xs"
                no-caps
                flat
                class="copy-btn q-mr-xs"
                @click.stop="
                  copyCellContent(props.value, props.rowIndex, props.col.name)
                "
              >
              </q-btn>
              <!-- Use JsonFieldRenderer if column is marked as JSON -->
              <JsonFieldRenderer
                v-if="props.col.showFieldAsJson"
                :value="props.value"
              />
              <!-- Otherwise show normal value -->
              <template v-else>
                {{
                  props.value === "undefined" || props.value === null
                    ? ""
                    : props.col.format
                      ? props.col.format(props.value, props.row)
                      : props.value
                }}
              </template>
              <!-- Copy button on right for non-numeric columns -->
              <q-btn
                v-if="
                  props.col.align !== 'right' && shouldShowCopyButton(props.value)
                "
                :icon="
                  isCellCopied(props.rowIndex, props.col.name)
                    ? 'check'
                    : 'content_copy'
                "
                dense
                size="xs"
                no-caps
                flat
                class="copy-btn q-ml-xs"
                @click.stop="
                  copyCellContent(props.value, props.rowIndex, props.col.name)
                "
              >
              </q-btn>
            </div>
          </template>
        </q-td>
      </template>

      <!-- Sticky total row rendered outside virtual scroll for sticky bottom -->
      <template v-slot:bottom-row="bottomRowProps" v-if="stickyTotalRow">
        <q-tr class="pivot-total-row pivot-sticky-total-row">
          <q-td
            v-for="col in bottomRowProps.cols"
            :key="'ft_' + col.name"
            :style="[
              getStickyTotalColumnStyle(col),
              getStickyColumnStyle(col),
            ]"
            :class="{
              'pivot-total-col': stickyColTotals && col._isTotalColumn,
              'sticky-column': col.sticky,
              'text-right': col.align === 'right',
              'text-left': col.align === 'left',
            }"
          >
            {{
              stickyTotalRow[col.field] === undefined || stickyTotalRow[col.field] === null
                ? ""
                : col.format
                  ? col.format(stickyTotalRow[col.field], stickyTotalRow)
                  : stickyTotalRow[col.field]
            }}
          </q-td>
        </q-tr>
      </template>

      <!-- Expose a bottom slot so callers (e.g., PromQL table) can provide footer content -->
      <!-- If no custom slot is provided, use default pagination layout -->
      <template v-slot:bottom="scope">
        <!-- Custom slot provided by parent (e.g., PromQLTableChart with legend filter) -->
        <slot
          v-if="$slots.bottom"
          name="bottom"
          v-bind="{
            ...scope,
            setRowsPerPage: (val: number) => (pagination.rowsPerPage = val),
            paginationOptions,
            totalRows: (data.rows || []).length,
          }"
        />
        <!-- Default pagination layout when no custom slot -->
        <!-- This matches the design in PromQLTableChart for consistency across all pages -->
        <div v-else class="row items-center full-width">
          <q-space />
          <TablePaginationControls
            :show-pagination="showPagination"
            :pagination="scope.pagination"
            :pagination-options="paginationOptions"
            :total-rows="(data.rows || []).length"
            :pages-number="scope.pagesNumber"
            :is-first-page="scope.isFirstPage"
            :is-last-page="scope.isLastPage"
            @update:rows-per-page="
              (val: number) => (pagination.rowsPerPage = val)
            "
            @first-page="scope.firstPage"
            @prev-page="scope.prevPage"
            @next-page="scope.nextPage"
            @last-page="scope.lastPage"
          />
        </div>
      </template>
    </q-table>
  </div>
</template>

<script lang="ts">
import useNotifications from "@/composables/useNotifications";
import { useStickyColumns } from "@/composables/useStickyColumns";
import { exportFile, copyToClipboard, useQuasar } from "quasar";
import { defineComponent, ref, watch, computed } from "vue";
import { findFirstValidMappedValue } from "@/utils/dashboard/panelValidation";
import { useStore } from "vuex";
import { getColorForTable } from "@/utils/dashboard/colorPalette";
import JsonFieldRenderer from "./JsonFieldRenderer.vue";
import {
  TABLE_ROWS_PER_PAGE_DEFAULT_VALUE,
  PIVOT_TABLE_HEADER_ROW_HEIGHT,
  PIVOT_TABLE_DEFAULT_HEADER_HEIGHT,
  PIVOT_TABLE_TOTAL_COLUMN_WIDTH,
  PIVOT_TABLE_ROW_KEY_SEPARATOR,
} from "@/utils/dashboard/constants";
import TablePaginationControls from "../addPanel/TablePaginationControls.vue";

export default defineComponent({
  name: "TableRenderer",
  components: {
    JsonFieldRenderer,
    TablePaginationControls,
  },
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ rows: [], columns: {} }),
    },
    wrapCells: {
      required: false,
      type: Boolean,
      default: false,
    },
    valueMapping: {
      required: false,
      type: Object,
      default: () => [],
    },
    showPagination: {
      required: false,
      type: Boolean,
      default: false,
    },
    rowsPerPage: {
      required: false,
      type: Number,
      default: TABLE_ROWS_PER_PAGE_DEFAULT_VALUE,
    },
    hasDrilldown: {
      required: false,
      type: Boolean,
      default: false,
    },
  },
  emits: ["row-click"],
  setup(props: any) {
    const tableRef: any = ref(null);
    const store = useStore();
    const $q = useQuasar();
    const copiedCells = ref(new Map<string, boolean>());

    const { showErrorNotification, showPositiveNotification } =
      useNotifications();

    // Use sticky columns composable
    const { getStickyColumnStyle, tableId } = useStickyColumns(props, store);

    // Pivot table header levels (from convertPivotTableData)
    const pivotHeaderLevels = computed(() => {
      return props.data?.pivotHeaderLevels || [];
    });

    const pivotRowColumns = computed(() => {
      return props.data?.columns?.filter((c: any) => c._isRowField) || [];
    });

    // Reactive row merge map for pivot tables.
    // Uses string keys (x-field values) instead of object references because
    // Vue 3 reactive proxies break Map identity lookups.
    //
    // Algorithm: identify consecutive groups per column (hierarchically).
    // The first row of each group shows the value; subsequent rows hide it.
    // Bottom borders are removed within a group so it looks like one tall cell.
    const pivotMergeMap = computed(() => {
      const map = new Map<
        string,
        Record<string, { hideContent: boolean; hideBorder: boolean }>
      >();

      const rowCols = pivotRowColumns.value;
      if (rowCols.length === 0) return map;

      let rows = (props.data?.rows || []).filter(
        (r: any) => !r.__isTotalRow,
      );
      if (rows.length === 0) return map;

      const getRowKey = (row: any) =>
        rowCols.map((c: any) => String(row[c.name] ?? "")).join(PIVOT_TABLE_ROW_KEY_SEPARATOR);

      // Re-sort to match q-table's display order
      const sortBy = pagination.value.sortBy;
      const descending = pagination.value.descending;

      if (sortBy) {
        const col = props.data?.columns?.find(
          (c: any) => c.name === sortBy,
        );
        rows = [...rows].sort((a: any, b: any) => {
          const va = a[sortBy];
          const vb = b[sortBy];
          let result: number;
          if (col?.sort) {
            result = col.sort(va, vb, a, b);
          } else if (typeof va === "number" && typeof vb === "number") {
            result = va - vb;
          } else {
            result = String(va ?? "").localeCompare(String(vb ?? ""));
          }
          return descending ? -result : result;
        });
      }

      // For each row-field column, find consecutive groups.
      // A group = consecutive rows with same value in this column AND all
      // parent (left-side) columns.
      // First row shows the value, all others hide it.
      for (let colIdx = 0; colIdx < rowCols.length; colIdx++) {
        const col = rowCols[colIdx];
        let groupStart = 0;

        for (let i = 0; i <= rows.length; i++) {
          let sameGroup = i < rows.length;
          if (sameGroup) {
            for (let p = 0; p <= colIdx; p++) {
              if (
                rows[i][rowCols[p].name] !==
                rows[groupStart][rowCols[p].name]
              ) {
                sameGroup = false;
                break;
              }
            }
          }

          // End of a group — process it
          if (!sameGroup) {
            const size = i - groupStart;

            if (size > 1) {
              for (let r = groupStart; r < i; r++) {
                const key = getRowKey(rows[r]);
                if (!map.has(key)) map.set(key, {});
                map.get(key)![col.name] = {
                  hideContent: r !== groupStart, // first row shows value
                  hideBorder: r < i - 1, // all except last in group
                };
              }
            }

            groupStart = i;
          }
        }
      }

      return map;
    });

    const pivotRowKey = (row: any) =>
      pivotRowColumns.value
        .map((c: any) => String(row[c.name] ?? ""))
        .join(PIVOT_TABLE_ROW_KEY_SEPARATOR);

    const isPivotMergeHidden = (row: any, col: any): boolean => {
      if (!col._isRowField) return false;
      const info = pivotMergeMap.value.get(pivotRowKey(row));
      return info?.[col.name]?.hideContent === true;
    };

    const isPivotMergeNoBorder = (row: any, col: any): boolean => {
      if (!col._isRowField) return false;
      const info = pivotMergeMap.value.get(pivotRowKey(row));
      return info?.[col.name]?.hideBorder === true;
    };

    // Sticky totals support (separate controls for row and column)
    const stickyRowTotals = computed(() => {
      return !!props.data?.stickyRowTotals;
    });

    const stickyColTotals = computed(() => {
      return !!props.data?.stickyColTotals;
    });

    const stickyTotalRow = computed(() => {
      return props.data?.stickyTotalRow || null;
    });

    const getStickyTotalColumnStyle = (col: any) => {
      if (!stickyColTotals.value || !col?._isTotalColumn) return {};
      const rightOffset = (col._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
      return {
        position: "sticky",
        right: `${rightOffset}px`,
        "z-index": 2,
        "width": `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
        "min-width": `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
        "max-width": `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
        "background-color": store.state.theme === "dark" ? "#1a1a1a" : "#fff",
        "box-shadow": "-2px 0 4px rgba(0, 0, 0, 0.1)",
        "white-space": "normal",
        "word-break": "break-word",
      };
    };

    // Style for Total header cells in multi-row pivot headers.
    // Level-0 "Total" cell spans all sub-columns → right: 0.
    // Y-label level cells have individual _totalColRightIndex offsets.
    const getStickyTotalHeaderForPivot = (cell: any) => {
      if (!stickyColTotals.value) return {};
      const rightOffset = (cell._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
      const width = cell.colspan ? cell.colspan * PIVOT_TABLE_TOTAL_COLUMN_WIDTH : PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
      return {
        position: "sticky",
        right: `${rightOffset}px`,
        "z-index": 3,
        "width": `${width}px`,
        "min-width": `${width}px`,
        "max-width": `${width}px`,
        "background-color": store.state.theme === "dark" ? "#1a1a1a" : "#fff",
        "box-shadow": "-2px 0 4px rgba(0, 0, 0, 0.1)",
        "white-space": "normal",
        "word-break": "break-word",
      };
    };

    const getRowClass = (row: any) => {
      return row?.__isTotalRow ? "pivot-total-row" : "";
    };

    function wrapCsvValue(val: any, formatFn?: any, row?: any) {
      let formatted = formatFn !== void 0 ? formatFn(val, row) : val;

      formatted =
        formatted === void 0 || formatted === null ? "" : String(formatted);

      formatted = formatted.split('"').join('""');
      /**
       * Excel accepts \n and \r in strings, but some other CSV parsers do not
       * Uncomment the next two lines to escape new lines
       */
      // .split('\n').join('\\n')
      // .split('\r').join('\\r')

      return `"${formatted}"`;
    }

    const downloadTableAsCSV = (title?: any) => {
      // naive encoding to csv format
      const allRows = [
        ...(tableRef?.value?.filteredSortedRows || []),
        ...(stickyTotalRow.value ? [stickyTotalRow.value] : []),
      ];
      const content = [
        props?.data?.columns?.map((col: any) => wrapCsvValue(col.label)),
      ]
        .concat(
          allRows?.map((row: any) =>
            props?.data?.columns
              ?.map((col: any) =>
                wrapCsvValue(
                  typeof col.field === "function"
                    ? col.field(row)
                    : row[col.field === void 0 ? col.name : col.field],
                  col.format,
                  row,
                ),
              )
              .join(","),
          ),
        )
        .join("\r\n");

      const status = exportFile(
        (title ?? "table-export") + ".csv",
        content,
        "text/csv",
      );

      if (status === true) {
        showPositiveNotification("Table downloaded as a CSV file", {
          timeout: 2000,
        });
      } else {
        showErrorNotification("Browser denied file download...");
      }
    };

    const downloadTableAsJSON = (title?: string) => {
      try {
        // Create JSON structure with columns and rows (include sticky total row if present)
        const allRows = [
          ...(tableRef?.value?.filteredSortedRows || []),
          ...(stickyTotalRow.value ? [stickyTotalRow.value] : []),
        ];
        const jsonContent = {
          columns: props?.data?.columns,
          rows: allRows,
        };

        const content = JSON.stringify(jsonContent, null, 2);

        const status = exportFile(
          (title ?? "table-export") + ".json",
          content,
          "application/json",
        );

        if (status === true) {
          showPositiveNotification("Table downloaded as a JSON file", {
            timeout: 2000,
          });
        } else {
          showErrorNotification("Browser denied file download...");
        }
      } catch (error) {
        console.error("Error downloading JSON:", error);
        showErrorNotification("Failed to download data as JSON");
      }
    };

    const getStyle = (rowData: any) => {
      const value = rowData?.row[rowData?.col?.field] ?? rowData?.value;

      // 1) Priority: override config auto color
      if (rowData?.col?.colorMode === "auto") {
        const palette = getColorForTable;
        const key = String(value);
        // cache on column to keep stable mapping across rows
        const cacheKey = `__autoColorMap_${rowData?.col?.field}`;
        // init cache map on column object
        if (!rowData.col[cacheKey])
          rowData.col[cacheKey] = new Map<string, string>();
        const map: Map<string, string> = rowData.col[cacheKey];

        if (!map.has(key)) {
          const idx = map.size % palette.length;
          map.set(key, palette[idx]);
        }
        const hex = map.get(key) as string;
        const isDark = isDarkColor(hex);
        return `background-color: ${hex}; color: ${
          isDark ? "#ffffff" : "#000000"
        }`;
      }

      // 2) Fallback: explicit value-mapping color
      const foundValue = findFirstValidMappedValue(
        value,
        props?.valueMapping,
        "color",
      );

      if (foundValue && foundValue?.color) {
        const hex = foundValue.color;

        // Check if hex is valid
        const isValidHex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(hex);
        if (!isValidHex) {
          return "";
        }

        const isDark = isDarkColor(hex);
        return `background-color: ${hex}; color: ${
          isDark ? "#ffffff" : "#000000"
        }`;
      }
      return "";
    };

    const isDarkColor = (hex: any) => {
      const result: any = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result) return false;
      const r = parseInt(result[1], 16);
      const g = parseInt(result[2], 16);
      const b = parseInt(result[3], 16);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance < 0.5;
    };

    const isCellCopied = (rowIndex: number, colName: string) => {
      return copiedCells.value.has(`${rowIndex}_${colName}`);
    };

    const shouldShowCopyButton = (value: any) => {
      if (value === null || value === undefined) return false;
      if (value === "undefined") return false;
      const stringValue = String(value).trim();
      return stringValue !== "";
    };

    const copyCellContent = (value: any, rowIndex: number, colName: string) => {
      if (value === null || value === undefined) return;

      const textToCopy = String(value);
      copyToClipboard(textToCopy)
        .then(() => {
          // Set copied state
          const key = `${rowIndex}_${colName}`;
          copiedCells.value.set(key, true);

          // Reset after 3 seconds
          setTimeout(() => {
            copiedCells.value.delete(key);
          }, 3000);
        })
        .catch(() => {});
    };

    // Pagination logic
    // Dynamic available rows options
    const paginationOptions = computed(() => {
      if (!props.showPagination) {
        return [0];
      }

      const defaultOptions = [10, 20, 50, 100, 250, 500, 1000];
      const configuredRows = props.rowsPerPage || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE;

      const options = new Set(defaultOptions);
      if (configuredRows > 0) {
        options.add(configuredRows);
      }

      const sorted = Array.from(options).sort((a, b) => a - b);
      sorted.push(0);
      return sorted;
    });

    const pagination = ref<{
      rowsPerPage: number;
      page: number;
      sortBy?: string;
      descending?: boolean;
    }>({
      rowsPerPage: props.showPagination ? props.rowsPerPage || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE : 0,
      page: 1,
    });

    watch(
      () => [props.showPagination, props.rowsPerPage],
      ([newShowPagination, newRowsPerPage]) => {
        // Force reset pagination when toggle or config changes
        pagination.value = {
          ...pagination.value,
          rowsPerPage: newShowPagination ? newRowsPerPage || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE : 0,
          page: 1, // Reset to first page
        };
      },
    );

    return {
      pagination,
      paginationOptions,
      downloadTableAsCSV,
      downloadTableAsJSON,
      tableRef,
      getStyle,
      getStickyColumnStyle,
      getStickyTotalColumnStyle,
      getStickyTotalHeaderForPivot,
      store,
      copyCellContent,
      isCellCopied,
      shouldShowCopyButton,
      pivotHeaderLevels,
      pivotRowColumns,
      isPivotMergeHidden,
      isPivotMergeNoBorder,
      PIVOT_TABLE_HEADER_ROW_HEIGHT,
      PIVOT_TABLE_DEFAULT_HEADER_HEIGHT,
      getRowClass,
      stickyRowTotals,
      stickyColTotals,
      stickyTotalRow,
      tableId,
    };
  },
});
</script>

<style lang="scss" scoped>
.my-sticky-virtscroll-table {
  /* height or max-height is important */
  height: calc(100% - 1px);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: auto;

  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr th) {
    /* bg color is important for th; just specify one */
    background-color: #fff;
  }

  :deep(thead tr th) {
    will-change: auto !important;
    position: sticky;
    z-index: 1;
  }

  :deep(thead tr:first-child th) {
    top: 0;
  }

  /* Second header row (for 2+ row headers in pivot or loading indicator) */
  :deep(thead tr:nth-child(2) th) {
    top: 28px;
  }

  /* Third header row (for 3-level pivot: 2 pivot levels + Y labels) */
  :deep(thead tr:nth-child(3) th) {
    top: 56px;
  }

  /* Fourth header row (for 4-level pivot: 3 pivot levels + Y labels) */
  :deep(thead tr:nth-child(4) th) {
    top: 84px;
  }

  :deep(.q-virtual-scroll) {
    will-change: auto !important;
  }
}

.no-position-absolute {
  position: static !important;
}

.my-sticky-virtscroll-table.q-dark {
  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr th) {
    /* bg color is important for th; just specify one */
    background-color: $dark-page !important;
  }
}

.wrap-enabled {
  :deep(.q-td) {
    word-break: break-word;
    overflow-wrap: break-word;
    white-space: normal !important;
  }
}

.copy-cell-td {
  .copy-btn {
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
  }

  &:hover .copy-btn {
    opacity: 1;
  }
}

.table-wrapper {
  height: 100%;
  width: 100%;
  position: relative;
}

// Pivot table styles
:deep(.pivot-total-row) {
  font-weight: bold;
  background-color: rgba(0, 0, 0, 0.03);
}

.body--dark :deep(.pivot-total-row) {
  background-color: rgba(255, 255, 255, 0.05);
}

:deep(.pivot-group-header) {
  font-weight: 600;
  border-bottom: 2px solid rgba(0, 0, 0, 0.12);
}

:deep(.pivot-section-border) {
  border-left: 2px solid rgba(0, 0, 0, 0.12) !important;
}

:deep(.pivot-value-header) {
  font-weight: 500;
  font-size: 0.85em;
}

// Sticky total row (bottom-row slot)
:deep(.pivot-sticky-total-row) {
  font-weight: bold;

  td {
    border-top: 2px solid rgba(0, 0, 0, 0.12);
  }
}

// Pivot header sort icons
:deep(.pivot-sort-icon) {
  opacity: 0;
  transition: opacity 0.2s;
}

:deep(th:hover .pivot-sort-icon) {
  opacity: 0.4;
}

:deep(.pivot-sort-active) {
  opacity: 1 !important;
}

// Sticky total column visual separator
:deep(.pivot-total-col) {
  border-left: 2px solid rgba(0, 0, 0, 0.12) !important;
}

@media print {
  // .table-wrapper is the containing block (position:relative).
  // It clips the expanded table at the panel height; the footer is
  // pinned to its bottom edge via absolute positioning (see below).
  .table-wrapper {
    position: relative !important;
    height: 100% !important;
    max-height: none !important;
    overflow: hidden !important;
  }

  .my-sticky-virtscroll-table {
    // Expand to natural content height so all rows are rendered from the top.
    height: auto !important;
    overflow: visible !important;

    // Remove sticky — no scroll container in print, sticky causes quirks.
    :deep(thead tr th) {
      position: static !important;
      top: auto !important;
    }

    // Let Quasar's scroll wrapper expand to content height.
    :deep(.q-table__middle) {
      overflow: visible !important;
      height: auto !important;
    }

    // Pin the footer to the bottom of .table-wrapper (the nearest
    // position:relative ancestor) so it is always visible at the
    // bottom of the panel, regardless of how many rows the table has.
    :deep(.q-table__bottom) {
      position: absolute !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      background-color: #fff !important;
      z-index: 1 !important;
    }
  }

  .body--dark .my-sticky-virtscroll-table {
    :deep(.q-table__bottom) {
      background-color: #1a1a2e !important;
    }
  }
}

// Drilldown visual cues: pointer cursor and hover highlight on data rows
.drilldown-active {
  :deep(.q-table tbody tr:not(.pivot-total-row)) {
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }
  }
}

.body--dark .drilldown-active {
  :deep(.q-table tbody tr:not(.pivot-total-row)) {
    &:hover {
      background-color: rgba(255, 255, 255, 0.07);
    }
  }
}
</style>
