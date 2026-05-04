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
    <TenstackTable
      ref="tableRef"
      :rows="sortedRows"
      :columns="data.columns || []"
      :sort-by="localSortBy"
      :sort-order="localSortOrder"
      @sort-change="handleSortChange"
      :use-virtual-scroll="false"
      :pivot-header-levels="data.pivotHeaderLevels || []"
      :sticky-total-row="data.stickyTotalRow || null"
      :sticky-row-totals="!!data.stickyRowTotals"
      :sticky-col-totals="!!data.stickyColTotals"
      :get-cell-style="cellStyleFn"
      :wrap="wrapCells"
      :show-pagination="showPagination"
      :rows-per-page="rowsPerPage"
      :enable-column-reorder="false"
      :enable-cell-copy="true"
      :enable-text-highlight="false"
      :enable-row-expand="false"
      :enable-status-bar="false"
      :enable-ai-context-button="false"
      data-test="dashboard-panel-table"
      @click:dataRow="(row: any, _idx: number, evt?: MouseEvent) => $emit('row-click', evt ?? null, row, _idx)"
    >
      <!-- Pagination footer: forward parent's #bottom slot or show default pagination controls -->
      <template #bottom="scope">
        <slot name="bottom" v-bind="scope">
          <!-- Default: dashboard pagination controls -->
          <div class="row items-center full-width" data-test="dashboard-table-pagination">
            <q-space />
            <TablePaginationControls
              :show-pagination="showPagination"
              :pagination="scope.pagination"
              :pagination-options="scope.paginationOptions"
              :total-rows="scope.totalRows"
              :pages-number="scope.pagesNumber"
              :is-first-page="scope.isFirstPage"
              :is-last-page="scope.isLastPage"
              @update:rows-per-page="scope.setRowsPerPage"
              @first-page="scope.firstPage()"
              @prev-page="scope.prevPage()"
              @next-page="scope.nextPage()"
              @last-page="scope.lastPage()"
            />
          </div>
        </slot>
      </template>
    </TenstackTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import TenstackTable from "@/components/TenstackTable.vue";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";
import { TABLE_ROWS_PER_PAGE_DEFAULT_VALUE } from "@/utils/dashboard/constants";
import { getColorForTable } from "@/utils/dashboard/colorPalette";
import { findFirstValidMappedValue } from "@/utils/dashboard/panelValidation";

export default defineComponent({
  name: "TableRenderer",
  components: { TenstackTable, TablePaginationControls },
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
      type: Array,
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
  },
  emits: ["row-click"],
  setup(props) {
    const tableRef = ref<any>(null);

    /** Returns true when the hex colour is dark (needs white text). */
    const isDashboardColor = (hex: string): boolean => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result) return false;
      const r = parseInt(result[1], 16);
      const g = parseInt(result[2], 16);
      const b = parseInt(result[3], 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
    };

    /**
     * Computes the inline style for a given TanStack cell.
     * Handles auto-color mode (stable palette per distinct value) and
     * value-mapping color overrides.
     */
    // Component-level cache: colKey → (value → hex). Avoids mutating prop-derived col objects.
    const autoColorCache = new Map<string, Map<string, string>>();

    const cellStyleFn = computed(() => (cell: any): string => {
      const col = (cell.column.columnDef.meta as any)?._col;
      const value = cell.getValue();

      // 1) Auto color mode — stable palette per distinct string value.
      if (col?.colorMode === "auto") {
        const palette = getColorForTable;
        const key = String(value);
        const colKey = col.field ?? col.name;
        if (!autoColorCache.has(colKey)) autoColorCache.set(colKey, new Map<string, string>());
        const map = autoColorCache.get(colKey)!;
        if (!map.has(key)) map.set(key, palette[map.size % palette.length]);
        const hex = map.get(key) as string;
        return `background-color: ${hex}; color: ${isDashboardColor(hex) ? "#ffffff" : "#000000"}`;
      }

      // 2) Value-mapping color.
      const found = findFirstValidMappedValue(value, props.valueMapping, "color");
      if (found?.color) {
        const hex = found.color;
        if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(hex)) return "";
        return `background-color: ${hex}; color: ${isDashboardColor(hex) ? "#ffffff" : "#000000"}`;
      }

      return "";
    });

    // ── Dashboard sort state (parent-managed, passed into TenstackTable) ──────
    const localSortBy = ref<string>("");
    const localSortOrder = ref<"asc" | "desc">("asc");

    const sortedRows = computed(() => {
      const rows = (props.data.rows as any[]) || [];
      if (!localSortBy.value) return rows;
      const col = (props.data.columns as any[])?.find(
        // sort-change now emits col.field (unique data key) as the id, so match on field.
        // Fall back to name comparison for any legacy or non-field column definitions.
        (c: any) => (c.field ?? c.name) === localSortBy.value,
      );
      // col.field is the actual row data key; localSortBy is the column field id emitted by sort-change
      const dataKey = col?.field ?? localSortBy.value;
      return [...rows].sort((a: any, b: any) => {
        const va = typeof dataKey === "function" ? dataKey(a) : a[dataKey];
        const vb = typeof dataKey === "function" ? dataKey(b) : b[dataKey];
        let result: number;
        if (col?.sort) {
          result = col.sort(va, vb, a, b);
        } else if (typeof va === "number" && typeof vb === "number") {
          result = va - vb;
        } else {
          result = String(va ?? "").localeCompare(String(vb ?? ""));
        }
        return localSortOrder.value === "desc" ? -result : result;
      });
    });

    const handleSortChange = (by: string, order: "asc" | "desc") => {
      localSortBy.value = by;
      localSortOrder.value = order;
    };

    // Reset sort when columns change (e.g. dashboard re-query with different fields)
    watch(
      () => props.data.columns,
      () => {
        localSortBy.value = "";
        localSortOrder.value = "desc";
      },
    );

    const downloadTableAsCSV = (title?: string) => {
      const rows = tableRef.value?.getRows() ?? [];
      if (!rows.length) return;
      const cols: any[] = props.data?.columns || [];
      const headers = cols.map((c: any) => c.label ?? c.name);
      const lines = [
        headers.join(","),
        ...rows.map((row: any) =>
          cols
            .map((c: any) => {
              const val = row[c.field ?? c.name];
              return `"${String(val ?? "").replace(/"/g, '""')}"`;
            })
            .join(","),
        ),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "table"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const downloadTableAsJSON = (title?: string) => {
      const rows = tableRef.value?.getRows() ?? [];
      const content = JSON.stringify(
        { columns: props.data?.columns, rows },
        null,
        2,
      );
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "table"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return {
      tableRef,
      cellStyleFn,
      sortedRows,
      localSortBy,
      localSortOrder,
      handleSortChange,
      downloadTableAsCSV,
      downloadTableAsJSON,
    };
  },
});
</script>

<style lang="scss" scoped>
.table-wrapper {
  height: 100%;
  width: 100%;
  position: relative;
}

// Remove border-radius from the shared .container class (logs uses rounded corners)
:deep(.container) {
  border-radius: 0;
}

// Dashboard table cells should not use the monospace font from tenstack-table.scss
// (that scss is shared with logs, which intentionally uses monospace for log data)
:deep(td) {
  font-family: "Nunito Sans", sans-serif;
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

// Sticky total column visual separator — inset shadow on left edge
:deep(.pivot-total-col) {
  box-shadow: inset 4px 0 6px -2px rgba(0, 0, 0, 0.15) !important;
}

// Middle sticky: both left-sticky and right-sticky — outward right + inset left
:deep(.sticky-column.pivot-total-col) {
  box-shadow: 4px 0 8px rgba(0, 0, 0, 0.15), inset 4px 0 6px -2px rgba(0, 0, 0, 0.15) !important;
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

    // Let the scroll container expand to show all rows.
    :deep(.table-container) {
      overflow: visible !important;
      height: auto !important;
    }

    // Pin the footer to the bottom of .table-wrapper (the nearest
    // position:relative ancestor) so it is always visible at the
    // bottom of the panel, regardless of how many rows the table has.
    :deep([data-test="dashboard-table-pagination"]) {
      position: absolute !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      background-color: #fff !important;
      z-index: 1 !important;
    }
  }

  .body--dark .my-sticky-virtscroll-table {
    :deep([data-test="dashboard-table-pagination"]) {
      background-color: #1a1a2e !important;
    }
  }
}
</style>
