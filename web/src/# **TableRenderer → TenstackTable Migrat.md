# **TableRenderer → TenstackTable Migration Plan**

## **Context**

Migrate `web/src/components/dashboards/panels/TableRenderer.vue` (Quasar q-table) to use `web/src/components/TenstackTable.vue` (TanStack Vue Table + virtualizer) as the rendering engine. Goal: replace the dashboard-specific table with the shared generic table component.

---

## **Feature Support Matrix**

| Feature                            | Status    | Notes                                                                                                                      |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Virtual scrolling                  | ✅ Done    | TenstackTable uses `@tanstack/vue-virtual`                                                                                 |
| Wrap cells (word-break)            | ✅ Done    | `wrap` prop maps directly                                                                                                  |
| Row click event                    | ✅ Done    | `click:dataRow` emit is equivalent to `row-click`                                                                         |
| Row class function                 | ✅ Done    | `rowClass` prop (function form) is already supported                                                                       |
| Client-side sorting                | ✅ Done    | TanStack `getSortedRowModel` handles it                                                                                    |
| Column resizing                    | ✅ Done    | `columnResizeMode = "onChange"`, `getCanResize()` + `getResizeHandler()` wired in `<th>`                                  |
| Value alignment                    | ✅ Done    | `meta.align = 'left' \| 'center' \| 'right'` applied on `<th>` and `<td>` via Tailwind classes                           |
| Sticky header                      | ✅ Done    | `<thead class="tw:sticky tw:top-0 tw:z-10">` — header is always pinned                                                    |
| Column reorder (drag)              | ✅ Done    | `enableColumnReorder` prop, VueDraggable wraps `<tr>` in header                                                           |
| Named cell slot                    | ✅ Done    | `meta.slot = true` → `<slot name="cell-{colId}">` — use this for charts in cells                                          |
| Server-side sort                   | ✅ Done    | `sortBy` / `sortOrder` / `sortFieldMap` props + `sort-change` emit                                                        |
| Loading / error states             | ✅ Done    | `loading`, `errMsg`, `functionErrorMsg` props                                                                              |
| Empty-state slot                   | ✅ Done    | `#empty` named slot                                                                                                        |
| Status color bar per row           | ✅ Done    | `enableStatusBar` prop, `getRowStatusColor` via `extractStatusFromLog`                                                     |
| Pagination                         | ❌ Missing | TenstackTable has no pagination; only virtual scroll                                                                       |
| Cell copy button (hover)           | ❌ Missing | TableRenderer shows copy-on-hover per cell; TenstackTable only has row-level copy                                          |
| JSON field inline render           | ❌ Missing | `JsonFieldRenderer` for per-cell JSON; TenstackTable only expands full row JSON                                            |
| Cell coloring — auto mode          | ❌ Missing | Stable palette per distinct value; no equivalent in TenstackTable                                                          |
| Cell coloring — value mapping      | ❌ Missing | `valueMapping` prop drives bg/text color; not present in TenstackTable                                                     |
| Sticky columns                     | ❌ Missing | `useStickyColumns` composable + `getStickyColumnStyle`; not wired in TenstackTable                                         |
| Pivot multi-level headers          | ❌ Missing | N-row `<thead>` with `colspan`/`rowspan`; no header grouping in TenstackTable                                              |
| Pivot cell merging                 | ❌ Missing | Consecutive duplicate row-field values hidden; no equivalent                                                               |
| Pivot sticky total row             | ❌ Missing | `bottom-row` slot renders grand-total row pinned at bottom                                                                 |
| Pivot sticky total columns         | ❌ Missing | Right-pinned `Total` columns with fixed width                                                                              |
| CSV export                         | ❌ Missing | `downloadTableAsCSV` exposed on tableRef; not in TenstackTable                                                             |
| JSON export                        | ❌ Missing | `downloadTableAsJSON` exposed on tableRef; not in TenstackTable                                                            |
| Custom footer slot                 | ❌ Missing | `#bottom` slot (e.g. PromQL legend filter); TenstackTable has no footer slot                                               |
| Sticky footer / total row          | ❌ Missing | `<tfoot>` pinned at `bottom: 0`; required for grand-total row and custom footer                                            |
| Print mode layout                  | ❌ Missing | `.no-position-absolute` class when `store.state.printMode`; not handled                                                    |
| Column format function             | ⚠️ Partial | TableRenderer calls `col.format(value, row)`; TenstackTable uses `renderValue()` but cell slots can achieve same result    |
| `hide-no-data`                     | ⚠️ Partial | TenstackTable has `#empty` slot but does not suppress the default "no data" overlay                                        |
| **Column filtering**               | ❌ Missing | No per-column filter input; need `getFilteredRowModel()` + filter UI in header                                             |
| **Chart in column cell**           | ❌ Missing | No built-in sparkline/bar/gauge; use `meta.slot` + `<slot name="cell-{id}">` as the hook                                  |
| **Cell-level click / drilldown**   | ❌ Missing | `click:dataRow` fires on the row; need a separate `click:cell` emit + `meta.clickable` flag per column                    |
| **Cell/row background formatting** | ❌ Missing | No conditional row color banding, color scales, or progress bars in cells                                                  |

---

## **How to Add Each Missing / Partial Feature**

---

### **Pagination**

Add a `showPagination` + `rowsPerPage` prop pair and a `TablePaginationControls` slot rendered below the `<table>`. Keep virtual scroll enabled when pagination is off; swap to full render (pass all rows) when on. Manage a local `page` / `rowsPerPage` ref and slice `rows` accordingly before passing to the virtualizer. Re-use the existing `TablePaginationControls` component from `addPanel/TablePaginationControls.vue`.

---

### **Cell copy button (hover)**

Add a `enableCellCopy` boolean prop (default false) and a `copiedCells` Map ref inside TenstackTable. Render a `<q-btn icon="content_copy">` inside the `<td>` with CSS `opacity:0` + `hover:opacity:1` on the cell. Position the button left or right depending on `col.meta.align === 'right'` to match TableRenderer behaviour. Auto-clear the copied state via `setTimeout` after 3 s, same as TableRenderer.

---

### **JSON field inline render**

Add a `showFieldAsJson` flag to the column `meta` object and import `JsonFieldRenderer`. Inside the default cell render path, check `cell.column.columnDef.meta?.showFieldAsJson` before calling `renderValue()`. If true, render `<JsonFieldRenderer :value="cell.getValue()" />` instead. No changes needed to the column definition API outside of the `meta` field.

---

### **Cell coloring — auto mode**

Add `colorMode: 'auto'` to column `meta` and import `getColorForTable` from the colour palette util. Attach a per-column `Map<string, string>` cache (e.g. `col.meta.__autoColorMap`) on first access to keep colour assignments stable across rows. Apply `background-color` and computed `color` (light/dark luminance check) via the `td` `:style` binding in the cell loop. Extract `isDarkColor` as a shared util to avoid duplication.

---

### **Cell coloring — value mapping**

Accept `valueMapping` as a prop and import `findFirstValidMappedValue` from `panelValidation`. In the cell `<td>` `:style` binding, call the helper with the raw cell value and the prop; apply the returned colour exactly as TableRenderer does. Check for valid hex before applying (same `/^#[A-Fa-f0-9]{6}$/` guard). Only run the lookup when `colorMode` is not `'auto'` (auto takes priority).

---

### **Cell / row background formatting** *(new)*

Extends both coloring features with additional formatting modes set on `col.meta.cellFormat`:

- **`colorScale`** — map numeric value to a gradient between two hex stops (`meta.colorScaleMin`, `meta.colorScaleMax`). Interpolate linearly; apply as `background-color`.
- **`rowBand`** — alternate row background using `meta.evenColor` / `meta.oddColor` (stripe pattern independent of cell value).
- **`progressBar`** — overlay a `<div>` behind the cell text sized to `(value / meta.progressMax) * 100%`. Useful for ratio columns.
- **`fontColor`** — apply only `color` (no background). Useful for status text coloring without disrupting row stripes.

All modes check `meta.colorMode` first; `'auto'` always wins. The `td` `:style` binding is the single integration point — no new template blocks needed for the first three modes. Progress bar requires wrapping cell content in a `position: relative` div so the bar div can be `position: absolute` behind it.

---

### **Sticky columns**

Import the `useStickyColumns` composable and call it with `props` and `store` inside `<script setup>`. Bind `getStickyColumnStyle(col)` to each `<th>` and `<td>` `:style` alongside existing width styles. Pass `data-sticky-id` on the root `<div>` using `tableId` from the composable. Ensure sticky columns also apply to any total-column cells once pivot support is added.

---

### **Column filtering** *(new)*

Add a `enableColumnFilter` boolean prop (default `false`). When enabled:

1. Import `getFilteredRowModel` from `@tanstack/vue-table` and add it to `useVueTable`.
2. Render a filter row inside `<thead>` below the header row: one `<th>` per column containing a small `<input>` or `<q-select>` (driven by `col.meta.filterType: 'text' | 'select' | 'number-range'`).
3. Wire input values to `table.getColumn(id)?.setFilterValue(val)` on each `input` event.
4. Default filter function is `includesString` (TanStack built-in). Override per column via `col.meta.filterFn: 'equals' | 'between' | CustomFilterFn`.
5. Add a `clearFilters()` helper and expose it so parents can reset filters from outside.
6. Filter state can optionally be v-modelled out via an `update:columnFilters` emit if the parent needs to persist it.

The filter row should be styled consistently with the header row and respect `meta.align` for input alignment. Hide the filter cell (render `<th />` empty) for columns that have `meta.filterable = false`.

---

### **Chart in column cell** *(new)*

The existing `meta.slot = true` + named slot `cell-{colId}` mechanism is the primary hook — callers can already render any component in that slot. To add **built-in inline charts** without requiring the caller to implement a custom slot:

1. Add `meta.inlineChart: { type: 'sparkline' | 'bar' | 'progress', data?: number[], max?: number, color?: string }` to the column definition API.
2. In the default cell render path (the `v-else` block after the slot check), test `cell.column.columnDef.meta?.inlineChart` before falling through to `renderValue()`.
3. Render the appropriate chart component:
   - **`sparkline`** — `<MiniSparkline :data="meta.inlineChart.data ?? [cell.getValue()]" />` (create a lightweight SVG polyline component with ~30 lines of SVG).
   - **`bar`** — a simple `<div>` bar proportional to `(value / meta.inlineChart.max) * 100%`. Can double as a progress bar.
   - **`progress`** — same as bar but always full-width with a filled portion.
4. Chart color inherits from `meta.inlineChart.color` or falls back to `--o2-primary-color`.
5. Cell text label can be shown alongside the chart if `meta.inlineChart.showLabel = true`.

For complex charts (e.g. ECharts mini line), callers should continue using the named cell slot.

---

### **Sticky footer / total row** *(new)*

Add a `stickyFooter` boolean prop and a `footerRow` object prop (raw row data). Render a `<tfoot>` element after `</tbody>` with `position: sticky; bottom: 0; z-index: 10`. Cells in the footer row use the same width CSS variables as body cells (`--col-{id}-size`). Apply `getStickyColumnStyle` and `getStickyTotalColumnStyle` for sticky-column compatibility. Also add a `#footer` named slot inside the `<tfoot>` for callers that need arbitrary footer content (e.g. aggregate labels, pagination). If both `footerRow` and `#footer` slot are provided, `footerRow` renders first and the slot appends below.

---

### **Custom footer slot**

Add a named `#bottom` slot rendered below `</table>` (outside the virtualizer div) so callers can inject pagination controls, legend filters, etc. Mirror the slot-binding API from TableRenderer: pass `setRowsPerPage`, `paginationOptions`, `totalRows` if pagination props are added. If no `#bottom` content is provided, render `<TablePaginationControls>` (once pagination prop support is in). This unblocks PromQL table usage without requiring a wrapper component.

---

### **Cell-level click / drilldown** *(new)*

`click:dataRow` fires when the user clicks anywhere on a non-expanded row. Cell-level drilldown needs finer granularity:

1. Add `click:cell` emit with payload `{ row, column, value, event }`.
2. In the `<td>` `@click` handler (currently absent), call `emits('click:cell', { row: cell.row.original, column: cell.column.columnDef, value: cell.getValue(), event: $event })` **only** when `cell.column.columnDef.meta?.clickable === true`. Cells without the flag do not emit — this prevents every cell from emitting on a normal row click.
3. Add `meta.clickable: boolean` to the column definition API.
4. The cell `@click` handler must call `$event.stopPropagation()` so the row-level `click:dataRow` does **not** fire simultaneously when a clickable cell is clicked. The caller decides which to use.
5. Apply a `tw:cursor-pointer` class to `<td>` when `meta.clickable` is set so users see a pointer cursor on drilldown cells.
6. For dashboard drilldown, the panel passes a `meta.drilldownConfig` object; the parent handles `click:cell` to open a new panel or navigate.

---

### **Print mode layout**

Check `store.state.printMode` and conditionally add `position: static` to the root container. This prevents `position: absolute` rows from overflowing printed pages. Can be a simple `:class` or `:style` binding on the top `<div>` — no new prop needed. Mirror the `.no-position-absolute` rule from TableRenderer's SCSS.

---

### **CSV export**

Add a `downloadCsv` method and expose it via `defineExpose` so the parent can call it (mirrors TableRenderer's `downloadTableAsCSV`). Collect all rows from `tableRows` (including `stickyTotalRow` if present), map each row through column `format` functions, and join with `wrapCsvValue` helpers. Use Quasar's `exportFile` and `useNotifications` — already available project-wide. Accept an optional `title` argument for the filename.

---

### **JSON export**

Port `downloadTableAsJSON` identically, using `tableRows` as the source and `defineExpose` for the parent API. Include `stickyTotalRow` in the exported rows array when present. Re-use same `exportFile` + notification pattern. Keep it as a separate exposed method to allow callers to trigger CSV and JSON independently.

---

### **Pivot multi-level headers**

Add a `pivotHeaderLevels` array and `pivotRowColumns` array derived from `props.data` (mirrors TableRenderer). Replace the single `<thead v-for="headerGroup">` with a conditional: when `pivotHeaderLevels.length > 0` render N `<tr>` rows with manual `colspan`/`rowspan` logic; otherwise fall back to TanStack's header groups. Accept `_sortColumn` and `_isTotalHeader` flags on header cells and wire click handlers to the TanStack sort state. Use the same CSS class names (`pivot-group-header`, `pivot-value-header`) to reuse existing styles.

---

### **Pivot cell merging**

Compute a `pivotMergeMap` (port directly from TableRenderer) that encodes `{hideContent, hideBorder}` per row-key × column. In the `<td>` loop, call `isPivotMergeHidden(row, col)` to skip rendering cell content; call `isPivotMergeNoBorder` to remove `border-bottom`. The merge map must mirror the current sort order; listen to `sorting` state changes and recompute accordingly. Keep logic in a composable or extracted function to avoid bloating the component template.

---

### **Pivot sticky total row**

Add a `stickyTotalRow` computed from `props.data?.stickyTotalRow`. Render a separate `<tfoot>` or an absolutely-positioned `<tr>` below the virtualizer container styled with `position: sticky; bottom: 0`. Cells in the total row must apply `getStickyTotalColumnStyle` and `getStickyColumnStyle` like TableRenderer's `bottom-row` slot does. Mark the row with `pivot-sticky-total-row` class and import the existing SCSS styles.

---

### **Pivot sticky total columns**

Accept `_isTotalColumn`, `_totalColRightIndex` flags on column definitions (already used by TableRenderer). Port `getStickyTotalColumnStyle` to TenstackTable and call it in the `<td>` `:style` alongside width styles. Apply `getStickyTotalHeaderForPivot` in the header cell styles when `_isTotalHeader` is set. Add `pivot-total-col` class for the left-border visual separator, matching existing SCSS.

---

### **Column format function (complete)**

TanStack column definitions support `cell: (info) => info.getValue()` or a render function. When a column has `meta.format`, wrap `renderValue()` with `col.meta.format(value, row)` in the fallback render path. This closes the gap; column slots already handle custom rendering for more complex cases. No prop-level changes needed — purely a `meta` convention.

---

## **Column `meta` API Reference**

All features below are configured via `columnDef.meta`. None require new top-level props unless stated.

| `meta` key            | Type                                                                       | Feature                          | Notes                                                                       |
| --------------------- | -------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `align`               | `'left' \| 'center' \| 'right'`                                            | Value alignment                  | **Already implemented** — applies to `<th>` + `<td>`                       |
| `slot`                | `boolean`                                                                  | Custom cell render               | **Already implemented** — delegates to `<slot name="cell-{colId}">`        |
| `headerClass`         | `string`                                                                   | Header CSS class                 | **Already implemented**                                                     |
| `cellClass`           | `string`                                                                   | Cell CSS class                   | **Already implemented**                                                     |
| `sortable`            | `boolean`                                                                  | Server-side sort                 | **Already implemented**                                                     |
| `closable`            | `boolean`                                                                  | Column close button              | **Already implemented**                                                     |
| `format`              | `(value, row) => string`                                                   | Cell format function             | Partial — wrap `renderValue()` with this                                    |
| `showFieldAsJson`     | `boolean`                                                                  | JSON inline render               | Add `JsonFieldRenderer` check in cell render path                           |
| `colorMode`           | `'auto' \| 'valueMapping'`                                                 | Cell background color            | Auto = stable palette; valueMapping = uses `valueMapping` prop              |
| `cellFormat`          | `'colorScale' \| 'rowBand' \| 'progressBar' \| 'fontColor'`               | Extended cell formatting         | See "Cell/row background formatting" section                                |
| `colorScaleMin`       | `string` (hex)                                                             | Color scale start                | Used with `cellFormat: 'colorScale'`                                        |
| `colorScaleMax`       | `string` (hex)                                                             | Color scale end                  | Used with `cellFormat: 'colorScale'`                                        |
| `progressMax`         | `number`                                                                   | Progress bar max value           | Used with `cellFormat: 'progressBar'`                                       |
| `inlineChart`         | `{ type, data?, max?, color?, showLabel? }`                                | Built-in mini chart              | `type: 'sparkline' \| 'bar' \| 'progress'`                                 |
| `filterable`          | `boolean`                                                                  | Show filter input in header      | Default `true` when `enableColumnFilter` prop is on                         |
| `filterType`          | `'text' \| 'select' \| 'number-range'`                                    | Filter UI control                | Default `'text'`                                                             |
| `filterFn`            | `'includesString' \| 'equals' \| 'between' \| CustomFilterFn`             | TanStack filter function         | Default `'includesString'`                                                   |
| `clickable`           | `boolean`                                                                  | Emit `click:cell` on this column | Stops propagation so `click:dataRow` doesn't fire                           |
| `drilldownConfig`     | `object`                                                                   | Dashboard drilldown payload      | Passed in `click:cell` event; consumed by parent                            |
| `sticky`              | `boolean`                                                                  | Left-sticky column               | Requires `useStickyColumns` wired in                                        |
| `_isRowField`         | `boolean`                                                                  | Pivot row-dimension column       | Used for merge map + row header render                                       |
| `_isTotalColumn`      | `boolean`                                                                  | Pivot sticky-right total column  | Triggers `getStickyTotalColumnStyle`                                        |
| `_totalColRightIndex` | `number`                                                                   | Right-offset index for total col | Used to stack multiple total columns                                         |
| `_isTotalHeader`      | `boolean`                                                                  | Total column in pivot header     | Triggers `getStickyTotalHeaderForPivot`                                     |
| `_sortColumn`         | `string`                                                                   | Sort field for pivot header cell | Click wires to TanStack sort state                                           |

---

## **Emit API Reference**

| Emit                  | Payload                                          | Triggered by                                       |
| --------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `click:dataRow`       | `(row, index)`                                   | Row click (existing)                               |
| `click:cell`          | `{ row, column, value, event }`                  | Cell click when `meta.clickable = true` *(new)*    |
| `sort-change`         | `(field: string, order: 'asc' \| 'desc')`        | Server-side sort header click (existing)           |
| `update:columnSizes`  | `Record<string, number>`                         | Column resize (existing)                           |
| `update:columnOrder`  | `string[]`                                       | Column drag reorder (existing)                     |
| `update:columnFilters`| `ColumnFiltersState`                             | Column filter change *(new, optional v-model)*     |
| `closeColumn`         | `ColumnDef`                                      | Close icon click (existing)                        |
| `expandRow`           | `(index, row)`                                   | Expand chevron click (existing)                    |

---

## **Critical Files**

- [TenstackTable.vue](components/TenstackTable.vue) — main file to extend
- [TableRenderer.vue](components/dashboards/panels/TableRenderer.vue) — source of truth for feature parity
- [useStickyColumns.ts](composables/useStickyColumns.ts) — to import into TenstackTable
- [colorPalette.ts](utils/dashboard/colorPalette.ts) — `getColorForTable`
- [panelValidation.ts](utils/dashboard/panelValidation.ts) — `findFirstValidMappedValue`
- [constants.ts](utils/dashboard/constants.ts) — pivot constants (heights, widths, separators)
- [TablePaginationControls.vue](components/dashboards/addPanel/TablePaginationControls.vue) — pagination UI
- [JsonFieldRenderer.vue](components/dashboards/panels/JsonFieldRenderer.vue) — JSON cell rendering

---

## **Implementation Priority**

Suggested order for migration work, roughly from most-used to least:

1. **Column filtering** — high value for dashboard consumers; self-contained TanStack feature
2. **Cell/row background formatting** (value mapping + auto color) — required for existing dashboards to work visually
3. **Column format function** (close the partial gap) — unblocks all column-level formatting
4. **Cell copy button** — UX parity, low effort
5. **Chart in column cell** (built-in inline chart) — new feature; sparkline via SVG; bar/progress via div
6. **Cell-level click / drilldown** — new feature; isolated to `<td>` click + meta flag
7. **Sticky footer / total row** — needed for aggregate rows; pairs with pivot total row
8. **CSV / JSON export** — `defineExpose` additions; low risk
9. **Custom footer slot** — unblocks PromQL table migration
10. **Sticky columns** — import composable; low-effort wiring
11. **Print mode layout** — one `:style` binding
12. **Pivot multi-level headers** — complex; port algorithm from TableRenderer
13. **Pivot cell merging** — depends on pivot headers; port `pivotMergeMap` logic
14. **Pivot sticky total row / columns** — depends on pivot headers
15. **Pagination** — add last; toggle between virtual scroll and paginated render

---

## **Verification Checklist**

1. Render an existing dashboard panel with `type: table` — basic rows/columns display correctly.
2. Enable `meta.align: 'right'` on a numeric column — header and cells right-align.
3. Drag a column header — column reorders without visual glitch.
4. Resize a column — adjacent columns adjust; width CSS vars update.
5. Enable `enableColumnFilter` — filter inputs appear; typing filters rows live.
6. Set `meta.colorMode: 'auto'` on a column — each distinct value gets a stable background colour across re-renders.
7. Apply `valueMapping` with colour config — cells highlight correctly; invalid hex is silently ignored.
8. Set `meta.cellFormat: 'progressBar'` — filled bar overlays behind cell text proportional to value.
9. Set `meta.inlineChart: { type: 'sparkline' }` on a column — mini SVG line renders in cell.
10. Set `meta.clickable: true` on a column — clicking that cell emits `click:cell`; row `click:dataRow` does NOT fire.
11. Set `meta.slot: true` and provide `<template #cell-myCol>` — custom component renders; default path skipped.
12. Enable a pivot table config — multi-level headers render with correct colspan/rowspan, cell merging collapses consecutive duplicate values, totals row is sticky at bottom.
13. Trigger CSV/JSON download — files contain all rows including the total row.
14. Toggle print mode in Vuex — table switches to static positioning.
15. Resize browser to narrow — sticky columns stay pinned; sticky header/footer stays pinned on scroll.
