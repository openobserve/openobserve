# TableRenderer — Current Dashboard Table Features

> Documents every feature that is **currently working** in `TableRenderer.vue`.
> This is the source of truth for what needs to be replicated in TenstackTable during migration.

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `Object` | `{ rows: [], columns: {} }` | Table data including rows, columns, and pivot config |
| `wrapCells` | `boolean` | `false` | Enable word-wrap in cells |
| `valueMapping` | `Object` (Array) | `[]` | Value mapping config for cell background coloring |
| `showPagination` | `boolean` | `false` | Toggle between virtual scroll and paginated mode |
| `rowsPerPage` | `number` | `TABLE_ROWS_PER_PAGE_DEFAULT_VALUE` | Default rows per page when pagination is on |

### `data` Object Shape

```ts
data: {
  rows: any[]                    // Table data rows
  columns: ColumnDef[]           // Quasar column definitions
  pivotHeaderLevels?: Level[]    // Multi-level header config (pivot tables)
  pivotRowColumns?: ColumnDef[]  // Row-dimension columns (pivot tables)
  stickyTotalRow?: object        // Grand total row pinned at the bottom
  stickyRowTotals?: boolean      // Enables pivot-sticky-totals CSS class
  stickyColTotals?: boolean      // Enables sticky right-side total columns
}
```

### Column Definition Fields (in `data.columns`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Column id / field name |
| `label` | `string` | Header display text |
| `field` | `string \| Function` | Row field accessor |
| `align` | `'left' \| 'right' \| 'center'` | Cell and header alignment |
| `format` | `(value, row) => string` | Cell format function |
| `sort` | `(a, b, rowA, rowB) => number` | Custom sort comparator |
| `sticky` | `boolean` | Pin column to the left |
| `colorMode` | `'auto'` | Auto-color cells by distinct value |
| `showFieldAsJson` | `boolean` | Render cell value via `JsonFieldRenderer` |
| `_isRowField` | `boolean` | Marks a pivot row-dimension column |
| `_isTotalColumn` | `boolean` | Marks a sticky right-side total column |
| `_totalColRightIndex` | `number` | Right-offset index for stacking multiple total columns |

---

## Emits

| Event | Payload | Description |
|-------|---------|-------------|
| `row-click` | `(event, row, index)` | Fires when a non-expanded row is clicked |

---

## Slots

| Slot | Scope | Description |
|------|-------|-------------|
| `#bottom` | `{ setRowsPerPage, paginationOptions, totalRows, ...qTableScope }` | Custom footer content (e.g. PromQL legend filter). When not provided, renders default `TablePaginationControls` |

---

## Exposed Methods (`tableRef`)

| Method | Signature | Description |
|--------|-----------|-------------|
| `downloadTableAsCSV` | `(title?: string) => void` | Exports all visible rows + total row as a `.csv` file |
| `downloadTableAsJSON` | `(title?: string) => void` | Exports all visible rows + total row as a `.json` file |

---

## Features

### Virtual Scrolling

Quasar `q-table` with `:virtual-scroll="!showPagination"`. When pagination is off, only visible rows are rendered. Sticky header size is derived from `pivotHeaderLevels.length * PIVOT_TABLE_HEADER_ROW_HEIGHT` so multi-row pivot headers are accounted for during virtual scroll offset calculation.

### Sticky Header

All `<thead>` `<th>` elements have `position: sticky` applied via SCSS. Multi-level pivot headers stack correctly using `top: 28px` / `56px` / `84px` offsets for 2nd / 3rd / 4th header rows.

### Wrap Cells

`:wrap-cells="wrapCells"` passes directly to `q-table`. Also applies `wrap-enabled` CSS class for additional SCSS overrides.

### Row Click

`@row-click` on `q-table` re-emits as `row-click` to the parent.

### Cell Copy Button (Hover)

Every non-empty cell shows a `content_copy` icon button on hover. Button position depends on column alignment:
- **Right-aligned columns** (numeric): copy button appears on the **left** of the value.
- **Other columns**: copy button appears on the **right** of the value.

After copying, the icon changes to `check` for 3 seconds then resets. Empty / `null` / `"undefined"` cells do not show the button.

### JSON Field Inline Render

When `col.showFieldAsJson = true`, the cell renders `<JsonFieldRenderer :value="props.value" />` instead of plain text. This handles structured JSON values with syntax highlighting and expand/collapse.

### Cell Format Function

When `col.format` is defined, the cell renders `col.format(value, row)` instead of the raw value. The same format function is used in CSV export.

### Cell Background Coloring — Auto Mode

When `col.colorMode === 'auto'`:
- A stable color is assigned per distinct string value using `getColorForTable` palette.
- The color mapping is cached on the column object (`col.__autoColorMap_{field}`) so colors remain stable across re-renders.
- Text color is auto-computed (white for dark backgrounds, black for light) using luminance.

### Cell Background Coloring — Value Mapping

When `valueMapping` prop has entries:
- `findFirstValidMappedValue(value, valueMapping, 'color')` finds the first matching rule.
- The returned hex color is applied as `background-color`.
- Invalid hex values are silently ignored (validated via `/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/`).
- Text color auto-adjusts for dark/light background (same luminance check as auto mode).

> Auto color mode takes priority over value mapping.

### Sticky Columns (Left-Pinned)

`useStickyColumns` composable provides `getStickyColumnStyle(col)` and `tableId`. Applied to both header `<th>` and body `<td>` elements. Columns with `col.sticky = true` get `position: sticky` with a computed left offset. `data-sticky-id` is set on the root element using `tableId`.

### Pagination

When `showPagination = true`:
- Virtual scroll is disabled (`q-table` renders all rows).
- `TablePaginationControls` is shown in the `#bottom` slot with first / prev / next / last page buttons.
- Available page-size options: `[10, 20, 50, 100, 250, 500, 1000, configuredRows, 0]` (0 = all).
- Resetting `showPagination` or `rowsPerPage` resets to page 1.

### Custom Footer Slot (`#bottom`)

The `#bottom` slot is exposed with extended scope:

```ts
{
  setRowsPerPage: (val: number) => void
  paginationOptions: number[]
  totalRows: number
  // ...all Quasar q-table scope props
}
```

Used by `PromQLTableChart` to inject a legend/filter row below the table.

### CSV Export

`downloadTableAsCSV(title?)` collects `filteredSortedRows` from `q-table` + `stickyTotalRow` if present. Each cell is formatted with `col.format` and wrapped in `wrapCsvValue`. Exported via Quasar `exportFile`. Shows a success/error notification.

### JSON Export

`downloadTableAsJSON(title?)` exports the same row set as `{ columns, rows }` JSON. Uses `exportFile` and the same notification pattern.

---

## Pivot Table Features

All pivot features are driven by fields in `data`. No extra props needed beyond the standard ones.

### Multi-Level Headers

When `data.pivotHeaderLevels` has entries, the default `q-table` header is replaced with N `<tr>` rows — one per level. Each row renders:
- **Row-field headers** (`_isRowField = true`): rendered only in the first `<tr>`, with `rowspan = pivotHeaderLevels.length`. Clicking triggers sort.
- **Group / value headers**: rendered with correct `colspan` / `rowspan` from the level config. Leaf-level headers show a sort arrow if `cell._sortColumn` is set.

### Pivot Cell Merging

`pivotMergeMap` computes consecutive groups per row-field column (hierarchically). For groups of 2+ rows:
- **First row**: value is shown normally.
- **Subsequent rows**: `isPivotMergeHidden` returns `true` → cell content is not rendered.
- **All except last in group**: `isPivotMergeNoBorder` returns `true` → `border-bottom: 0 none` removes the separator line, making it visually one tall cell.

The merge map re-computes when the sort state changes so merging always matches the current display order.

### Sticky Total Row (Grand Total at Bottom)

When `data.stickyTotalRow` is present, a `<q-tr class="pivot-sticky-total-row">` is rendered in the `bottom-row` slot. It sits at the bottom of the scrollable area (CSS `position: sticky; bottom: 0`). Each cell applies `getStickyTotalColumnStyle` and `getStickyColumnStyle` and respects `col.format`.

### Sticky Total Columns (Right-Pinned)

When `data.stickyColTotals = true`, columns with `_isTotalColumn = true` get `position: sticky; right: Npx` via `getStickyTotalColumnStyle`. Multiple total columns stack using `_totalColRightIndex * PIVOT_TABLE_TOTAL_COLUMN_WIDTH`. The same style applies to both header cells and body cells.

In multi-level pivot headers, `getStickyTotalHeaderForPivot` handles the header cell variant with correct `width` derived from `cell.colspan`.

### Print Mode Layout

When `store.state.printMode` is `true`, the `no-position-absolute` CSS class is added to `q-table`. This switches the table container from `position: absolute` to prevent rows from overflowing printed pages.

---

## Related Files

| File | Role |
|------|------|
| [TableRenderer.vue](TableRenderer.vue) | This component |
| [JsonFieldRenderer.vue](JsonFieldRenderer.vue) | JSON cell inline renderer |
| [TablePaginationControls.vue](../addPanel/TablePaginationControls.vue) | Pagination UI component |
| [composables/useStickyColumns.ts](../../../composables/useStickyColumns.ts) | Sticky column style computation |
| [utils/dashboard/colorPalette.ts](../../../utils/dashboard/colorPalette.ts) | `getColorForTable` palette |
| [utils/dashboard/panelValidation.ts](../../../utils/dashboard/panelValidation.ts) | `findFirstValidMappedValue` |
| [utils/dashboard/constants.ts](../../../utils/dashboard/constants.ts) | Pivot height/width constants |
| [utils/dashboard/convertPivotTableData.ts](../../../utils/dashboard/convertPivotTableData.ts) | Builds `pivotHeaderLevels` from raw data |

---

## Migration Guide: TableRenderer → TenstackTable

Status legend: **✅ Ready** = already works in TenstackTable today. **🔧 Add** = needs code added to TenstackTable first.

---

### Props mapping

| TableRenderer prop | TenstackTable equivalent | Status | Notes |
|--------------------|--------------------------|--------|-------|
| `data.rows` | `rows` | ✅ Ready | Direct rename |
| `data.columns` | `columns` (as `ColumnDef[]`) | ✅ Ready | Column shape changes — see column mapping below |
| `wrapCells` | `wrap` | ✅ Ready | Rename only |
| `valueMapping` | `valueMapping` (new prop) | 🔧 Add | Needs prop + `getStyle` logic ported to TenstackTable |
| `showPagination` | `showPagination` (new prop) | 🔧 Add | Needs pagination state + `TablePaginationControls` wired in |
| `rowsPerPage` | `rowsPerPage` (new prop) | 🔧 Add | Paired with `showPagination` |

---

### Column definition mapping

Quasar column fields → TanStack `ColumnDef` with `meta`:

| TableRenderer `col.*` | TenstackTable `columnDef.*` | Notes |
|-----------------------|-----------------------------|-------|
| `col.name` | `columnDef.id` | Used as the column key |
| `col.label` | `columnDef.header` | Header display text |
| `col.field` (string) | `columnDef.accessorKey` | Direct field accessor |
| `col.field` (function) | `columnDef.accessorFn` | Function accessor |
| `col.align` | `columnDef.meta.align` | `'left' \| 'center' \| 'right'` — already supported |
| `col.format` | `columnDef.meta.format` | 🔧 Add: needs `renderValue()` wrapped with `meta.format(value, row)` in cell render path |
| `col.sort` | `columnDef.sortingFn` | Pass the same comparator function |
| `col.sticky` | `columnDef.meta.sticky` | 🔧 Add: needs `useStickyColumns` wired into TenstackTable |
| `col.colorMode = 'auto'` | `columnDef.meta.colorMode = 'auto'` | 🔧 Add: needs `getColorForTable` + color cache in `<td>` `:style` |
| `col.showFieldAsJson` | `columnDef.meta.showFieldAsJson` | 🔧 Add: needs `JsonFieldRenderer` check in cell render path |
| `col._isRowField` | `columnDef.meta._isRowField` | 🔧 Add: needed for pivot merge map |
| `col._isTotalColumn` | `columnDef.meta._isTotalColumn` | 🔧 Add: needed for sticky total columns |
| `col._totalColRightIndex` | `columnDef.meta._totalColRightIndex` | 🔧 Add: paired with `_isTotalColumn` |

---

### Emits mapping

| TableRenderer emit | TenstackTable emit | Status | Notes |
|--------------------|--------------------|--------|-------|
| `row-click(event, row, index)` | `click:dataRow(row, index)` | ✅ Ready | Rename + slight payload difference; `event` is not passed |

---

### Slots mapping

| TableRenderer slot | TenstackTable slot | Status | Notes |
|--------------------|--------------------|--------|-------|
| `#bottom` (footer / pagination) | `#bottom` (new slot) | 🔧 Add | Render below `</table>`; pass `setRowsPerPage`, `paginationOptions`, `totalRows` in scope |

---

### Exposed methods mapping

| TableRenderer method | TenstackTable equivalent | Status | Notes |
|----------------------|--------------------------|--------|-------|
| `downloadTableAsCSV(title?)` | `downloadCsv(title?)` | 🔧 Add | Port using `tableRows` as source; expose via `defineExpose` |
| `downloadTableAsJSON(title?)` | `downloadJson(title?)` | 🔧 Add | Port using `tableRows` as source; expose via `defineExpose` |

---

### Feature-by-feature conversion

#### Virtual Scrolling ✅ Ready
No changes needed. TenstackTable uses `@tanstack/vue-virtual` which replaces Quasar's built-in virtual scroll. Pass `rows` and `columns` — virtualizer handles the rest.

---

#### Sticky Header ✅ Ready
Already pinned via `tw:sticky tw:top-0 tw:z-10` on `<thead>`. No action needed.

---

#### Wrap Cells ✅ Ready
```diff
- <TableRenderer :wrapCells="config.wrap_table_cells" ... />
+ <TenstackTable :wrap="config.wrap_table_cells" ... />
```

---

#### Row Click ✅ Ready
```diff
- @row-click="(evt, row) => handleRowClick(row)"
+ @click:dataRow="(row) => handleRowClick(row)"
```

---

#### Cell Format Function 🔧 Add
In TenstackTable's cell render path, before falling back to `renderValue()`, check `meta.format`:

```ts
// inside <td> render (TenstackTable.vue)
const value = cell.getValue()
const formatted = cell.column.columnDef.meta?.format
  ? cell.column.columnDef.meta.format(value, cell.row.original)
  : value
```

Column definition stays the same — just move `format` under `meta`:
```ts
// Before (Quasar)
{ name: 'latency', format: (val) => val + 'ms' }

// After (TanStack)
{ id: 'latency', accessorKey: 'latency', meta: { format: (val) => val + 'ms' } }
```

---

#### Cell Copy Button (Hover) 🔧 Add
Add `enableCellCopy` boolean prop (default `false`) and a `copiedCells` Map ref to TenstackTable. Inside each `<td>`, render:

```html
<q-btn
  v-if="enableCellCopy && shouldShowCopyButton(cell.getValue())"
  :icon="isCellCopied(rowIndex, cell.column.id) ? 'check' : 'content_copy'"
  dense size="xs" flat
  :class="meta.align === 'right' ? 'tw:mr-1 tw:order-first' : 'tw:ml-1'"
  @click.stop="copyCellContent(cell.getValue(), rowIndex, cell.column.id)"
/>
```

`copyCellContent` and `isCellCopied` are direct ports from TableRenderer with the same 3 s auto-clear logic.

---

#### JSON Field Inline Render 🔧 Add
Import `JsonFieldRenderer` into TenstackTable. In the default cell render path:

```html
<JsonFieldRenderer
  v-if="cell.column.columnDef.meta?.showFieldAsJson"
  :value="cell.getValue()"
/>
<template v-else>
  {{ formattedCellValue(cell) }}
</template>
```

Column definition:
```ts
// Before (Quasar)
{ name: 'payload', showFieldAsJson: true }

// After (TanStack)
{ id: 'payload', accessorKey: 'payload', meta: { showFieldAsJson: true } }
```

---

#### Cell Background Coloring — Auto Mode 🔧 Add
Import `getColorForTable` from `utils/dashboard/colorPalette`. In the `<td>` `:style` binding:

```ts
function getCellStyle(cell) {
  const col = cell.column.columnDef
  if (col.meta?.colorMode === 'auto') {
    const key = String(cell.getValue())
    const cacheKey = `__autoColorMap_${col.id}`
    if (!col.meta[cacheKey]) col.meta[cacheKey] = new Map()
    const map = col.meta[cacheKey]
    if (!map.has(key)) map.set(key, getColorForTable[map.size % getColorForTable.length])
    const hex = map.get(key)
    return { backgroundColor: hex, color: isDarkColor(hex) ? '#fff' : '#000' }
  }
  return {}
}
```

Column definition stays the same — move `colorMode` under `meta`.

---

#### Cell Background Coloring — Value Mapping 🔧 Add
Add `valueMapping` prop to TenstackTable. In the same `getCellStyle` function (runs after auto-mode check):

```ts
const found = findFirstValidMappedValue(cell.getValue(), props.valueMapping, 'color')
if (found?.color && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/i.test(found.color)) {
  return { backgroundColor: found.color, color: isDarkColor(found.color) ? '#fff' : '#000' }
}
```

Caller change:
```diff
- <TableRenderer :valueMapping="panel.config.mappings" ... />
+ <TenstackTable :valueMapping="panel.config.mappings" ... />
```

---

#### Sticky Columns (Left-Pinned) 🔧 Add
Import and call `useStickyColumns` inside TenstackTable's `<script setup>`:

```ts
const { getStickyColumnStyle, tableId } = useStickyColumns(props, store)
```

Bind on each `<th>` and `<td>`:
```html
<th :style="{ ...widthStyle, ...getStickyColumnStyle(header.column.columnDef) }">
<td :style="{ ...widthStyle, ...getStickyColumnStyle(cell.column.columnDef) }">
```

Set `data-sticky-id` on the root `<div>`:
```html
<div :data-sticky-id="tableId" ...>
```

Column definition:
```ts
// Before (Quasar)
{ name: 'timestamp', sticky: true }

// After (TanStack)
{ id: 'timestamp', accessorKey: 'timestamp', meta: { sticky: true } }
```

---

#### Pagination 🔧 Add
Add `showPagination` and `rowsPerPage` props. When `showPagination` is `true`:
- Pass all rows to the virtualizer (skip slicing) OR slice `tableRows` to `[page * size, (page+1) * size]`.
- Render `<TablePaginationControls>` below `</table>` (or inside the `#bottom` slot).
- Manage `page` and `rowsPerPage` as local refs; reset to page 1 when props change.

```diff
- <TableRenderer :showPagination="true" :rowsPerPage="50" ... />
+ <TenstackTable :showPagination="true" :rowsPerPage="50" ... />
```

---

#### Custom Footer Slot (`#bottom`) 🔧 Add
Add a named `#bottom` slot rendered below `</table>` (outside the virtualizer div):

```html
<slot
  name="bottom"
  :setRowsPerPage="(val) => (localRowsPerPage = val)"
  :paginationOptions="paginationOptions"
  :totalRows="tableRows.length"
/>
```

Caller change:
```diff
- <TableRenderer>
-   <template #bottom="{ setRowsPerPage, totalRows }"> ... </template>
- </TableRenderer>
+ <TenstackTable>
+   <template #bottom="{ setRowsPerPage, totalRows }"> ... </template>
+ </TenstackTable>
```

---

#### CSV Export 🔧 Add
Add `downloadCsv` to TenstackTable and expose it:

```ts
const downloadCsv = (title?: string) => {
  const allRows = [...tableRows.value, ...(props.stickyTotalRow ? [props.stickyTotalRow] : [])]
  const content = [
    props.columns.map((col: any) => wrapCsvValue(col.header ?? col.id)),
    ...allRows.map((row) =>
      props.columns.map((col: any) => {
        const val = row[col.accessorKey ?? col.id]
        return wrapCsvValue(col.meta?.format ? col.meta.format(val, row) : val)
      }).join(',')
    ),
  ].join('\r\n')
  exportFile((title ?? 'table-export') + '.csv', content, 'text/csv')
}
defineExpose({ downloadCsv })
```

Caller:
```diff
- tableRef.value.downloadTableAsCSV('my-export')
+ tableRef.value.downloadCsv('my-export')
```

---

#### JSON Export 🔧 Add
Same pattern as CSV:

```ts
const downloadJson = (title?: string) => {
  const allRows = [...tableRows.value, ...(props.stickyTotalRow ? [props.stickyTotalRow] : [])]
  exportFile((title ?? 'table-export') + '.json', JSON.stringify({ columns: props.columns, rows: allRows }, null, 2), 'application/json')
}
defineExpose({ downloadCsv, downloadJson })
```

---

#### Print Mode Layout 🔧 Add
One binding on the root `<div>`:

```html
<div
  :style="store.state.printMode ? { position: 'static' } : {}"
  ...
>
```

No new prop needed — reads directly from Vuex `store.state.printMode`, same as TableRenderer.

---

#### Pivot: Multi-Level Headers 🔧 Add
Replace TenstackTable's single `v-for="headerGroup in table.getHeaderGroups()"` with a conditional:

```html
<!-- Pivot headers -->
<template v-if="pivotHeaderLevels.length > 0">
  <tr v-for="(level, idx) in pivotHeaderLevels" :key="idx">
    <th v-if="idx === 0" v-for="col in pivotRowColumns" :rowspan="pivotHeaderLevels.length"
        @click="handlePivotRowHeaderSort(col)">
      {{ col.label }}
    </th>
    <th v-for="cell in level.cells" :colspan="cell.colspan" :rowspan="cell.rowspan || 1"
        :style="stickyColTotals && cell._isTotalHeader ? getStickyTotalHeaderForPivot(cell) : {}"
        @click="cell._sortColumn && handlePivotSort(cell._sortColumn)">
      {{ cell.label }}
    </th>
  </tr>
</template>
<!-- Normal TanStack headers -->
<template v-else>
  <vue-draggable ...> ... </vue-draggable>
</template>
```

`pivotHeaderLevels` and `pivotRowColumns` come from the `data` prop (same shape as TableRenderer).

---

#### Pivot: Cell Merging 🔧 Add
Port `pivotMergeMap`, `isPivotMergeHidden`, and `isPivotMergeNoBorder` from TableRenderer verbatim into a composable or directly into TenstackTable's `<script setup>`. Wire into the cell render:

```html
<td
  v-if="!isPivotMergeHidden(cell.row.original, cell.column.columnDef)"
  :style="isPivotMergeNoBorder(cell.row.original, cell.column.columnDef) ? { borderBottom: '0 none' } : {}"
>
```

---

#### Pivot: Sticky Total Row 🔧 Add
Add a `stickyTotalRow` computed from `props.data?.stickyTotalRow`. Render below the virtualizer `<tbody>`:

```html
<tfoot v-if="stickyTotalRow" style="position: sticky; bottom: 0; z-index: 10">
  <tr class="pivot-sticky-total-row">
    <td v-for="col in props.columns"
        :style="[getStickyTotalColumnStyle(col), getStickyColumnStyle(col)]">
      {{ col.meta?.format ? col.meta.format(stickyTotalRow[col.id], stickyTotalRow) : stickyTotalRow[col.id] }}
    </td>
  </tr>
</tfoot>
```

---

#### Pivot: Sticky Total Columns 🔧 Add
Port `getStickyTotalColumnStyle` and `getStickyTotalHeaderForPivot` from TableRenderer into TenstackTable (or a shared composable). Bind to every `<th>` and `<td>`:

```html
<td :style="{ ...widthStyle, ...getStickyColumnStyle(col), ...getStickyTotalColumnStyle(col) }">
```

Column definitions keep the same `_isTotalColumn` and `_totalColRightIndex` fields — move them under `meta`.

---

### Checklist for the caller (e.g. `DashboardPanelTable.vue`)

When switching from `<TableRenderer>` to `<TenstackTable>`, update the parent:

- [ ] Convert `data.columns` (Quasar shape) → `ColumnDef[]` (TanStack shape) using the column mapping table above
- [ ] Rename `wrapCells` → `wrap`
- [ ] Rename `@row-click` → `@click:dataRow`
- [ ] Pass `valueMapping` prop once it is added to TenstackTable
- [ ] Switch footer slot name `#bottom` once the slot is added
- [ ] Update `tableRef` method calls: `downloadTableAsCSV` → `downloadCsv`, `downloadTableAsJSON` → `downloadJson`
- [ ] Pass `data.pivotHeaderLevels`, `data.stickyTotalRow`, `data.stickyColTotals` as props once pivot support is added
