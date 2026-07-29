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
    <OTable
      ref="tableRef"
      :key="paginationMode"
      :data="sortedRows"
      :columns="otableColumns"
      sorting="server"
      :sort-by="localSortBy"
      :sort-order="localSortOrder || undefined"
      @sort-change="onOTableSortChange"
      :pivot-header-levels="data.pivotHeaderLevels || []"
      :pivot-row-columns="pivotRowColumns"
      :sticky-total-row="data.stickyTotalRow || null"
      :sticky-row-totals="!!data.stickyRowTotals"
      :sticky-col-totals="!!data.stickyColTotals"
      :get-cell-style="cellStyleFn"
      :wrap="wrapCells"
      :pagination="showPagination ? 'client' : 'none'"
      :page-size="effectivePageSize"
      :custom-pagination-bar="showPagination"
      :horizontal-scroll="isPivot"
      :row-height="22"
      :default-columns="false"
      :show-global-filter="false"
      :enable-column-filter="enableFiltering"
      :enable-column-reorder="false"
      :enable-cell-copy="true"
      :class="{ 'wrap-enabled': wrapCells }"
      data-test="dashboard-panel-table"
      @row-click="
        (row: any, evt: MouseEvent) => $emit('row-click', evt ?? null, row, sortedRows.indexOf(row))
      "
    >
      <!-- JSON field inline renderer — the "Render Data as JSON / Array" field
           option. Registered as a per-column cell slot so the flagged column
           renders the raw accessor value as formatted JSON instead of the
           default text cell (the pre-OTable table did the same with a v-if on
           the cell). -->
      <template
        v-for="col in jsonFieldColumns"
        :key="`json-cell-${col.id}`"
        #[`cell-${col.id}`]="{ value }"
      >
        <JsonFieldRenderer :value="value" />
      </template>

      <!-- PanelSchemaRenderer excludes `table` panels from its own OEmptyState,
           so mirror the chart panels' "No Data" treatment here. -->
      <template #empty>
        <OEmptyState
          size="inline"
          icon="bar-chart"
          :title="t('panel.noData')"
          :backdrop="false"
          data-test="no-data"
        />
      </template>

      <!-- Pagination footer: forward parent's #bottom slot or show default pagination controls -->
      <template #bottom="scope">
        <slot name="bottom" v-bind="scope">
          <!-- This #bottom IS the pager (the built-in bar is suppressed via
               :custom-pagination-bar), so it carries its own separator + padding.
               With pagination off it still renders — TablePaginationControls then
               shows the row count alone, so it drops the bar chrome. -->
          <div
            class="flex w-full items-center"
            :class="
              showPagination ? 'border-border-default min-h-10 border-t px-3 py-1' : 'pr-2'
            "
            data-test="dashboard-table-pagination"
          >
            <div class="flex-1" />
            <TablePaginationControls
              :show-pagination="showPagination"
              :pagination="{ page: scope.currentPage, rowsPerPage: scope.pageSize }"
              :total-rows="scope.totalRows"
              :pages-number="scope.totalPages"
              :is-first-page="scope.isFirstPage"
              :is-last-page="scope.isLastPage"
              @update:rows-per-page="scope.setPageSize"
              @first-page="scope.firstPage()"
              @prev-page="scope.prevPage()"
              @next-page="scope.nextPage()"
              @last-page="scope.lastPage()"
            />
          </div>
        </slot>
      </template>
    </OTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";
import JsonFieldRenderer from "@/components/dashboards/panels/JsonFieldRenderer.vue";
import { TABLE_ROWS_PER_PAGE_DEFAULT_VALUE } from "@/utils/dashboard/constants";
import { getColorForTable } from "@/utils/dashboard/colorPalette";
import { isColorDark } from "@/utils/dashboard/chartColorUtils";
import { buildValueMappingCache, lookupValueMappingFull } from "@/utils/dashboard/tableConfigUtils";
import { useStore } from "vuex";

export default defineComponent({
  name: "TableRenderer",
  components: {
    OTable,
    OEmptyState,
    TablePaginationControls,
    JsonFieldRenderer,
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
    const { t } = useI18n();
    const tableRef = ref<any>(null);

    // "Records per page" is `v-model.number`, so clearing it yields "" — a
    // non-number that would silently disable OTable's page-size watch.
    const effectivePageSize = computed(() => {
      const n = Number(props.rowsPerPage);
      return Number.isFinite(n) && n > 0 ? n : TABLE_ROWS_PER_PAGE_DEFAULT_VALUE;
    });

    // Pivots carry many value/group columns and must scroll horizontally rather
    // than compress to fit; regular tables keep the fit-to-container layout.
    const isPivot = computed(() => ((props.data?.pivotHeaderLevels?.length as number) ?? 0) > 0);

    // The client pagination row model is attached once at table creation, so
    // re-key the table on the pagination mode: without it, a table first mounted
    // with pagination off never starts slicing when it is toggled on.
    const paginationMode = computed(() => (props.showPagination ? "client" : "none"));

    const tableColumns = computed(() => (props.data?.columns as any[]) || []);

    // Map the column config → OTableColumnDef. The original fields stay at the
    // top level (CSV export reads them there) and are mirrored into `meta` for
    // the cell/tfoot/merge engine; `_col` carries the whole config for cellStyleFn.
    const otableColumns = computed(() =>
      (tableColumns.value as any[]).map((col: any) => ({
        ...col,
        // Key on `field`, not `name`: `name` is the display label, so two columns
        // sharing a label would collide to the same column id.
        id: col.field ?? col.name,
        header: col.header ?? col.label ?? col.name ?? col.field,
        accessorKey: col.field ?? col.name,
        filterable: props.enableFiltering && !col._isRowField && !col._isTotalColumn,
        meta: {
          ...(col.meta ?? {}),
          _col: col,
          format: col.format,
          align: col.align,
          _isRowField: col._isRowField,
          _isTotalColumn: col._isTotalColumn,
          _totalColRightIndex: col._totalColRightIndex,
        },
      })),
    );

    // Row-field columns drive the pivot header row-field cells + body cell-merge.
    const pivotRowColumns = computed(() =>
      (tableColumns.value as any[]).filter((c: any) => c._isRowField),
    );

    // Columns the user flagged with "Render Data as JSON / Array"
    // (convertTableData stamps `showFieldAsJson` from the field option). Each
    // gets a `#cell-<id>` slot bound to JsonFieldRenderer.
    const jsonFieldColumns = computed(() =>
      (otableColumns.value as any[]).filter((c: any) => c.showFieldAsJson),
    );

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

    // Look up the original column config by its OTable column id. The key MUST
    // be built with the same `field ?? name` expression `otableColumns` uses for
    // `id`: on SQL panels `name` is the display label while `field` is the data
    // key, so keying on `name` missed every renamed column — silently dropping
    // its mono font, auto-colour, value-mapping and conditional-colour styles.
    const colById = computed(() => {
      const m = new Map<string, any>();
      for (const c of (tableColumns.value as any[]) || []) {
        m.set(c.field ?? c.name, c);
      }
      return m;
    });

    // Colour engine, in precedence order: auto-color palette → value-mapping →
    // conditional rules → column override.
    const cellStyleFn = computed(
      () =>
        (params: { columnId: string; row: any; value: any }): Record<string, any> => {
          const col = colById.value.get(params.columnId);
          const value = params.value;

          // Number / timestamp columns render monospace so digits align. Merged
          // into every branch below so it composes with the colour rules.
          const base: Record<string, any> = col?.mono ? { fontFamily: "var(--font-mono)" } : {};

          // 1) Auto color mode — stable palette per distinct string value.
          if (col?.colorMode === "auto") {
            const palette = getColorForTable(store.state.theme);
            const key = String(value);
            const colKey = col.field ?? col.name;
            if (!autoColorCache.has(colKey)) autoColorCache.set(colKey, new Map<string, string>());
            const map = autoColorCache.get(colKey)!;
            if (!map.has(key)) map.set(key, palette[map.size % palette.length]);
            const hex = map.get(key) as string;
            return {
              ...base,
              backgroundColor: hex,
              color: isColorDark(hex) ? "#ffffff" : "#000000",
            };
          }

          // 2) Value-mapping color (valid hex only; else fall through).
          const found = lookupValueMappingFull(value, valueMappingCache.value, "color");
          if (found?.color && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(found.color)) {
            const hex = found.color;
            return {
              ...base,
              backgroundColor: hex,
              color: isColorDark(hex) ? "#ffffff" : "#000000",
            };
          }

          // 3) Conditional styling rules — last matching rule wins.
          const conditionalRules = col?.conditionalRules as any[] | undefined;
          if (conditionalRules?.length) {
            const numVal = parseFloat(String(value));
            if (!isNaN(numVal)) {
              let matched: any = null;
              for (const rule of conditionalRules) {
                if (evalCondition(numVal, rule.operator, rule.threshold)) matched = rule;
              }
              if (matched) {
                const style: Record<string, any> = { ...base };
                if (matched.bgColor) style.backgroundColor = matched.bgColor;
                if (matched.textColor) style.color = matched.textColor;
                if (Object.keys(style).length > Object.keys(base).length) return style;
              }
            }
          }

          // 4) Column-level text / background color override.
          if (col?.bgColor || col?.textColor) {
            const style: Record<string, any> = { ...base };
            if (col.bgColor) style.backgroundColor = col.bgColor;
            if (col.textColor) style.color = col.textColor;
            return style;
          }

          return base;
        },
    );

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

    // Adapt the 3-state server-sort payload (clear = empty column) to local state.
    const onOTableSortChange = (params: { column: string; order: "asc" | "desc" }) =>
      handleSortChange(params.column ?? "", params.order ?? "asc");

    return {
      t,
      tableRef,
      tableColumns,
      otableColumns,
      pivotRowColumns,
      jsonFieldColumns,
      cellStyleFn,
      effectivePageSize,
      isPivot,
      paginationMode,
      sortedRows,
      localSortBy,
      localSortOrder,
      handleSortChange,
      onOTableSortChange,
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

/* Column dividers matching the resize-handle dividers other tables show. Resize
   is disabled here, so they're drawn statically as a header-only ::after. */
.table-wrapper :deep(thead th) {
  position: relative;
}
.table-wrapper :deep(thead th:not(:last-child))::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  height: 1rem;
  width: 1px;
  background: var(--color-border-default);
}
/* The row-field header spans every level (rowspan), so a short centered stub
   would float on the group→value boundary — draw it full-height instead. */
.table-wrapper :deep(thead th.o2-pivot-rowfield-th)::after {
  top: 0;
  bottom: 0;
  height: auto;
  transform: none;
}

/* Pivot table styles */
.table-wrapper :deep(.pivot-total-row) {
  font-weight: bold;
  background-color: var(--color-table-row-striped-bg);
}

.table-wrapper :deep(.pivot-group-header) {
  font-weight: 600;
  /* 1px so this matches the value→data separator weight; heavier lines on both
     sides of a short value row read as a double line. */
  border-bottom: 1px solid var(--color-table-row-divider);
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
}
</style>
