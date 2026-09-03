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
      :horizontal-scroll="true"
      :row-height="22"
      :virtual-scroll="virtualizeRows"
      :window-row-model="virtualizeRows"
      :default-columns="false"
      :show-global-filter="false"
      :enable-column-filter="enableFiltering"
      :enable-column-format="enableColumnFormat"
      @format-column="onFormatColumn"
      :enable-column-reorder="false"
      :enable-cell-copy="false"
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

      <template
        v-for="col in linkFieldColumns"
        :key="`link-cell-${col.id}`"
        #[`cell-${col.id}`]="{ value, column, row }"
      >
        <a
          v-if="getHttpUrl(value)"
          :href="getHttpUrl(value) || undefined"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-link hover:text-text-link-hover hover:underline"
          @click.stop
        >
          {{ formatCellValue(value, column, row) }}
        </a>
        <span v-else>{{ formatCellValue(value, column, row) }}</span>
      </template>

      <template #cell-hover-actions="{ row, column, value }">
        <OButton
          v-if="isCopyableCellValue(value)"
          variant="ghost"
          size="icon-xs-circle"
          :data-test="`dashboard-table-cell-copy-${column.id}`"
          :data-copied="copiedCellKey === cellKey(column, row) ? 'true' : undefined"
          @click.stop="copyCellValue(value, column, row)"
        >
          <OIcon
            :name="copiedCellKey === cellKey(column, row) ? 'check' : 'content-copy'"
            size="xs"
          />
          <OTooltip :content="t('common.copy')" />
        </OButton>
        <OButton
          v-if="isCellDrillable(column.id)"
          variant="ghost"
          size="icon-xs-circle"
          :data-test="`dashboard-table-cell-drilldown-${column.id}`"
          @click.stop="onCellDrilldown({ columnId: column.id, row, value })"
        >
          <OIcon name="search" size="xs" />
          <OTooltip :content="t('dashboard.tableCellDrilldownTooltip')" />
        </OButton>
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
            :class="showPagination ? 'border-border-default min-h-10 border-t px-3 py-1' : 'pr-2'"
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
import { defineComponent, ref, computed, watch, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";
import JsonFieldRenderer from "@/components/dashboards/panels/JsonFieldRenderer.vue";
import { TABLE_ROWS_PER_PAGE_DEFAULT_VALUE } from "@/utils/dashboard/constants";
import { getColorForTable } from "@/utils/dashboard/colorPalette";
import { isColorDark } from "@/utils/dashboard/chartColorUtils";
import { buildValueMappingCache, lookupValueMappingFull } from "@/utils/dashboard/tableConfigUtils";
import { copyToClipboard } from "@/utils/clipboard";
import { useStore } from "vuex";

export default defineComponent({
  name: "TableRenderer",
  components: {
    OTable,
    OEmptyState,
    OButton,
    OIcon,
    OTooltip,
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
    /** Show the per-column "format this column" icon (add/edit panel only). */
    enableColumnFormat: {
      required: false,
      type: Boolean,
      default: false,
    },
    /** Column ids drillable → Logs (group-by fields); empty hides the button. */
    drilldownColumns: {
      required: false,
      type: Array as PropType<string[]>,
      default: () => [],
    },
    /** SELECT * / dynamic-columns tables: every cell is drillable. */
    drilldownAllColumns: {
      required: false,
      type: Boolean,
      default: false,
    },
  },
  emits: ["row-click", "format-column", "explore-cell"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18nTyped();
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

    // Virtualize only the case the pre-migration table virtualized — its gate was
    // `!useVirtualScroll && !showPagination && !wrap`:
    //  • pivot     — aggregated/small, and the fake-rowspan row merge must see
    //                every row.
    //  • paginated — only `pageSize` rows are in the DOM anyway, so there is
    //                nothing to virtualize.
    //  • wrapped   — wrapped rows vary from ~29px to ~81px, and the resulting
    //                total-height jumps show up as flicker while scrolling.
    //                Rendering every row is acceptable at dashboard sizes.
    // Flat, unpaginated, unwrapped tables (e.g. Logs Visualize `SELECT *`, ~2000
    // rows) are the case that must virtualize or the main thread stalls.
    const virtualizeRows = computed(
      () => !isPivot.value && !props.showPagination && !props.wrapCells,
    );

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
          // Without a width OTable falls back to TanStack's flat 150px; autoWidth
          // sizes each column to its content. Pivot fixes its own widths.
          ...(isPivot.value ? {} : { autoWidth: true }),
          _col: col,
          format: col.format,
          align: col.align,
          _isRowField: col._isRowField,
          _isTotalColumn: col._isTotalColumn,
          _totalColRightIndex: col._totalColRightIndex,
          formattable: props.enableColumnFormat && !col._isRowField && !col._isTotalColumn,
        },
      })),
    );

    // Row-field columns drive the pivot header row-field cells, body cell-merge
    // and left-pinning. Filtered from otableColumns (not the raw configs) so
    // each entry carries the `id` that useTableCore pins by — a raw config has
    // only name/field, and an id-less entry silently disables the pinning.
    const pivotRowColumns = computed(() =>
      (otableColumns.value as any[]).filter((c: any) => c._isRowField),
    );

    // Columns the user flagged with "Render Data as JSON / Array"
    // (convertTableData stamps `showFieldAsJson` from the field option). Each
    // gets a `#cell-<id>` slot bound to JsonFieldRenderer.
    const jsonFieldColumns = computed(() =>
      (otableColumns.value as any[]).filter((c: any) => c.showFieldAsJson),
    );

    // Only absolute http(s) URLs are links. This both avoids turning arbitrary
    // text into a link and prevents unsafe protocols such as javascript:.
    const getHttpUrl = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const url = value.trim();
      if (!/^https?:\/\//i.test(url)) return null;
      try {
        const protocol = new URL(url).protocol;
        return protocol === "http:" || protocol === "https:" ? url : null;
      } catch {
        return null;
      }
    };

    // A column gets a cell slot only when at least one response value is a URL.
    // The slot still renders any mixed non-URL values as regular formatted text.
    const linkFieldColumns = computed(() => {
      const rows = (props.data?.rows as any[]) || [];
      return (otableColumns.value as any[]).filter((col: any) => {
        if (col.showFieldAsJson) return false;
        const field = col.field ?? col.name;
        return rows.some((row: any) => getHttpUrl(row?.[field]) !== null);
      });
    });

    const formatCellValue = (value: any, column: any, row: any): any => {
      const format = column?.meta?.format as ((value: any, row: any) => any) | undefined;
      return format ? format(value, row) : value;
    };

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
    const drilldownColumnSet = computed(() => new Set(props.drilldownColumns));
    const isCellDrillable = (columnId: string) =>
      props.drilldownAllColumns || drilldownColumnSet.value.has(columnId);

    // Dedicated drilldown event (the search icon), independent of row-click, so it fires even when
    // a panel drilldown config would otherwise own plain cell clicks.
    const onCellDrilldown = (params: { columnId: string; row: any; value: any }) => {
      if (!isCellDrillable(params.columnId)) return;
      emit("explore-cell", params, sortedRows.value.indexOf(params.row));
    };

    const isCopyableCellValue = (value: any) =>
      value !== null && value !== undefined && String(value).trim() !== "";

    const copiedCellKey = ref<string | null>(null);
    let copiedTimer: ReturnType<typeof setTimeout> | null = null;
    const cellKey = (column: any, row: any) => `${column?.id}#${sortedRows.value.indexOf(row)}`;

    const copyCellValue = async (value: any, column: any, row: any) => {
      const text = String(formatCellValue(value, column, row) ?? "");
      const ok = await copyToClipboard(text, t, { silent: true });
      if (!ok) return;
      copiedCellKey.value = cellKey(column, row);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedCellKey.value = null;
      }, 2000);
    };

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

          // 2) Value-mapping colors — `color` is the background, `textColor` the text.
          const found = lookupValueMappingFull(value, valueMappingCache.value);
          if (found) {
            const isHex = (c: any) =>
              typeof c === "string" && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(c);
            const bg = isHex(found.color) ? found.color : "";
            const txt = isHex(found.textColor)
              ? found.textColor
              : bg
                ? isColorDark(bg)
                  ? "#ffffff"
                  : "#000000"
                : "";
            if (bg || txt) {
              const style: Record<string, any> = { ...base };
              if (bg) style.backgroundColor = bg;
              if (txt) style.color = txt;
              return style;
            }
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
      // Strip the internal per-query marker (`__q`) so it never leaks into exports.
      const rows = (tableRef.value?.getRows() ?? []).map((row: any) => {
        const copy = { ...row };
        delete copy.__q;
        return copy;
      });
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

    const onFormatColumn = (columnId: string) => {
      const col = colById.value.get(columnId);
      emit("format-column", col?.alias ?? columnId);
    };

    return {
      t,
      tableRef,
      tableColumns,
      otableColumns,
      pivotRowColumns,
      jsonFieldColumns,
      linkFieldColumns,
      getHttpUrl,
      formatCellValue,
      cellStyleFn,
      effectivePageSize,
      isPivot,
      virtualizeRows,
      paginationMode,
      sortedRows,
      localSortBy,
      localSortOrder,
      handleSortChange,
      onOTableSortChange,
      onFormatColumn,
      onCellDrilldown,
      isCellDrillable,
      isCopyableCellValue,
      copyCellValue,
      copiedCellKey,
      cellKey,
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: the column divider is a 1-device-pixel rule and must not scale with text or it smears at fractional zoom */
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: the pivot group-header rule is a 1-device-pixel border and must not scale with text or it smears at fractional zoom */
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
  box-shadow: var(--shadow-pivot-edge-geom) var(--color-actions-column-shadow) !important;
}

.table-wrapper :deep(.sticky-column.pivot-total-col) {
  box-shadow:
    var(--shadow-pivot-cast-geom) var(--color-actions-column-shadow),
    var(--shadow-pivot-edge-geom) var(--color-actions-column-shadow) !important;
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
