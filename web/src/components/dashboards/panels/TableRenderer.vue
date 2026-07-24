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
  <div class="table-wrapper relative h-full w-full" data-test="dashboard-table-renderer-wrapper">
    <TenstackTable
      ref="tableRef"
      :rows="sortedRows"
      :columns="tableColumns"
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
      :enable-column-filter="enableFiltering"
      data-test="dashboard-panel-table"
      @click:dataRow="
        (row: any, _idx: number, evt?: MouseEvent) => $emit('row-click', evt ?? null, row, _idx)
      "
    >
      <!-- Pagination footer: forward parent's #bottom slot or show default pagination controls -->
      <template #bottom="scope">
        <slot name="bottom" v-bind="scope">
          <!-- Default: dashboard pagination controls -->
          <div class="flex w-full items-center pr-2" data-test="dashboard-table-pagination">
            <div class="flex-1" />
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
import { isColorDark } from "@/utils/dashboard/chartColorUtils";
import { buildValueMappingCache, lookupValueMappingFull } from "@/utils/dashboard/tableConfigUtils";
import { useStore } from "vuex";

export default defineComponent({
  name: "TableRenderer",
  components: {
    TenstackTable,
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
    enableFiltering: {
      required: false,
      type: Boolean,
      default: false,
    },
  },
  emits: ["row-click"],
  setup(props) {
    const store = useStore();
    const tableRef = ref<any>(null);

    const tableColumns = computed(() => (props.data?.columns as any[]) || []);

    /**
     * Computes the inline style for a given TanStack cell.
     * Handles auto-color mode (stable palette per distinct value) and
     * value-mapping color overrides.
     */
    // Component-level cache: colKey → (value → hex). Avoids mutating prop-derived col objects.
    const autoColorCache = new Map<string, Map<string, string>>();

    // Value-mapping lookup cache, rebuilt only when the mappings change.
    const valueMappingCache = computed(() => buildValueMappingCache(props.valueMapping));

    const evalCondition = (val: number, op: string, threshold: number): boolean => {
      switch (op) {
        case "<":
          return val < threshold;
        case ">":
          return val > threshold;
        case "<=":
          return val <= threshold;
        case ">=":
          return val >= threshold;
        case "=":
        case "==":
          return val === threshold;
        case "!=":
          return val !== threshold;
        default:
          return false;
      }
    };

    const cellStyleFn = computed(() => (cell: any): string => {
      const col = (cell.column.columnDef.meta as any)?._col;
      const value = cell.getValue();

      // 1) Auto color mode — stable palette per distinct string value.
      if (col?.colorMode === "auto") {
        const palette = getColorForTable(store.state.theme);
        const key = String(value);
        const colKey = col.field ?? col.name;
        if (!autoColorCache.has(colKey)) autoColorCache.set(colKey, new Map<string, string>());
        const map = autoColorCache.get(colKey)!;
        if (!map.has(key)) map.set(key, palette[map.size % palette.length]);
        const hex = map.get(key) as string;
        return `background-color: ${hex}; color: ${isColorDark(hex) ? "#ffffff" : "#000000"}`;
      }

      // 2) Value-mapping color (valid hex only; else fall through).
      const found = lookupValueMappingFull(value, valueMappingCache.value, "color");
      if (found?.color && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(found.color)) {
        const hex = found.color;
        return `background-color: ${hex}; color: ${isColorDark(hex) ? "#ffffff" : "#000000"}`;
      }

      // 3) Conditional styling rules — last matching rule wins, so later rules
      // override earlier ones (e.g. >1000 takes precedence over >400 for 2301).
      const conditionalRules = col?.conditionalRules as any[] | undefined;
      if (conditionalRules?.length) {
        const numVal = parseFloat(String(value));
        if (!isNaN(numVal)) {
          let matched: any = null;
          for (const rule of conditionalRules) {
            if (evalCondition(numVal, rule.operator, rule.threshold)) matched = rule;
          }
          if (matched) {
            const parts: string[] = [];
            if (matched.bgColor) parts.push(`background-color: ${matched.bgColor}`);
            if (matched.textColor) parts.push(`color: ${matched.textColor}`);
            if (parts.length) return parts.join("; ");
          }
        }
      }

      // 4) Column-level text / background color override.
      if (col?.bgColor || col?.textColor) {
        const parts: string[] = [];
        if (col.bgColor) parts.push(`background-color: ${col.bgColor}`);
        if (col.textColor) parts.push(`color: ${col.textColor}`);
        return parts.join("; ");
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

    const getTableCsvString = (): string => {
      const rows = tableRef.value?.getRows() ?? [];
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
      return lines.join("\n");
    };

    const downloadTableAsCSV = (title?: string) => {
      const csv = getTableCsvString();
      if (!csv) return;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "table"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const downloadTableAsJSON = (title?: string) => {
      const rows = tableRef.value?.getRows() ?? [];
      const content = JSON.stringify({ columns: props.data?.columns, rows }, null, 2);
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
      tableColumns,
      cellStyleFn,
      sortedRows,
      localSortBy,
      localSortOrder,
      handleSortChange,
      getTableCsvString,
      downloadTableAsCSV,
      downloadTableAsJSON,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:tenstack-table): overrides for TenstackTable / OScrollContainer
   child DOM (pivot cells, td/th, scroll container) and print-layout fixes that
   utilities can't target. All selectors are scoped under this component's
   .table-wrapper root; child-rendered nodes are reached via :deep(). */

/* Remove border-radius from the shared scroll container (logs keeps its corner radius) */
.table-wrapper :deep(.o2-scroll-container) {
  border-radius: 0;
}

/* Dashboard table cells should not use the monospace font from tenstack-table.scss */
.table-wrapper :deep(td) {
  font-family: var(--font-sans);
}

/* Pivot table styles */
.table-wrapper :deep(.pivot-total-row) {
  font-weight: bold;
  background-color: var(--color-table-row-striped-bg);
}

.table-wrapper :deep(.pivot-group-header) {
  font-weight: 600;
  border-bottom: 0.125rem solid var(--color-table-row-divider);
}

.table-wrapper :deep(.pivot-section-border) {
  border-left: 0.125rem solid var(--color-table-row-divider) !important;
}

.table-wrapper :deep(.pivot-value-header) {
  font-weight: 500;
  font-size: 0.85em;
}

/* Sticky total row */
.table-wrapper :deep(.pivot-sticky-total-row) {
  font-weight: bold;
}

.table-wrapper :deep(.pivot-sticky-total-row td) {
  border-top: 0.125rem solid var(--color-table-row-divider);
}

/* Pivot header sort icons */
.table-wrapper :deep(.pivot-sort-icon) {
  opacity: 0;
  transition: opacity 0.2s;
}

.table-wrapper :deep(th:hover .pivot-sort-icon) {
  opacity: 0.4;
}

.table-wrapper :deep(.pivot-sort-active) {
  opacity: 1 !important;
}

/* Sticky total column visual separator */
.table-wrapper :deep(.pivot-total-col) {
  box-shadow: inset 0.25rem 0 0.375rem -0.125rem var(--color-actions-column-shadow) !important;
}

.table-wrapper :deep(.sticky-column.pivot-total-col) {
  box-shadow:
    0.25rem 0 0.5rem var(--color-actions-column-shadow),
    inset 0.25rem 0 0.375rem -0.125rem var(--color-actions-column-shadow) !important;
}

@media print {
  .table-wrapper {
    position: relative !important;
    height: 100% !important;
    max-height: none !important;
    overflow: hidden !important;
  }

  .table-wrapper :deep(.my-sticky-virtscroll-table) {
    height: auto !important;
    overflow: visible !important;
  }

  .table-wrapper :deep(.my-sticky-virtscroll-table thead tr th) {
    position: static !important;
    top: auto !important;
  }

  .table-wrapper :deep(.my-sticky-virtscroll-table .table-container) {
    overflow: visible !important;
    height: auto !important;
  }

  .table-wrapper :deep(.my-sticky-virtscroll-table [data-test="dashboard-table-pagination"]) {
    position: absolute !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    background-color: var(--color-surface-base) !important;
    z-index: 1 !important;
  }
}
</style>
