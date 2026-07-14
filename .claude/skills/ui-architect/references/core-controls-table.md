# Core — Controls & Table

Authoring reference for O2's core control components (Button, Navbar, RefreshButton, Splitter, ToggleGroup) and the OTable data-grid family. Every prop/variant/size/emit/slot below is transcribed from the actual `.types.ts` and `<script setup>` source — nothing invented.

## Table of Contents

- [OButton](#obutton)
- [OButtonGroup](#obuttongroup)
- [ONavbar](#onavbar)
- [ONavGroup](#onavgroup)
- [ORefreshButton](#orefreshbutton)
- [OSplitter](#osplitter)
- [OToggleGroup](#otogglegroup)
- [OToggleGroupItem](#otogglegroupitem)
- [OFormToggleGroup](#oformtogglegroup)
- [OTable](#otable)
- [OTable cell renderers](#otable-cell-renderers)

---

### OButton
**Import:** `@/lib/core/Button/OButton.vue`
**Use when:** Any clickable action — form submit, toolbar action, icon button, destructive confirm, CTA. Design is baked into each variant/size; there are no style-override props.
**Don't use for:** Navigation between routes — use a router-link/`MenuLink` styled tile. For a segmented on/off choice, use [OToggleGroup](#otogglegroup). For a set of buttons joined into one control, wrap in [OButtonGroup](#obuttongroup).
**Key props:**
- `variant` (default `"primary"`) — one of: `primary`, `secondary`, `outline`, `ghost`, `ghost-primary`, `ghost-muted`, `ghost-subtle`, `ghost-destructive`, `ghost-success`, `ghost-warning`, `ghost-neutral`, `outline-destructive`, `sidebar-toggle`, `panel-collapse`, `sidebar-button`, `destructive`, `ai-gradient`, `on-dark-primary`, `on-dark-ghost`, `warning`, `preview-slack`, `preview-teams`, `preview-email`, `preview-action`, `webinar-dismiss`, `pricing-chip`, `outline-primary`
- `size` (default `"md"`) — one of: `xs`, `chip`, `sm`, `sm-action`, `md`, `lg`, `icon`, `icon-xs`, `icon-xs-circle`, `icon-xs-sq`, `icon-chip`, `icon-sm`, `icon-md`, `icon-lg`, `icon-circle`, `icon-circle-sm`, `icon-toolbar`, `icon-panel`, `sidebar-button`, `sm-toolbar`, `chip-12`
- `iconLeft` (`IconName`) — renders an OIcon before the label; `#icon-left` slot takes precedence if present
- `iconRight` (`IconName`) — renders an OIcon after the label; `#icon-right` slot takes precedence if present
- `loading` (boolean, default `false`) — shows a centered spinner overlay, keeps dimensions, disables interaction
- `disabled` (boolean, default `false`) — disables interaction (loading also disables)
- `active` (boolean, default `false`) — forces primary/selected appearance regardless of variant
- `block` (boolean, default `false`) — full-width flex button
- `type` (`"button"` | `"submit"` | `"reset"`, default `"button"`) — only meaningful when `as="button"`
- `as` / `asChild` (`PrimitiveProps` from reka-ui) — render as a different element/child
**Slots:** `default` (label), `icon-left`, `icon-right`
**Emits:** `click` (`MouseEvent`) — suppressed while `disabled` or `loading`
**Example:**
```vue
<OButton variant="primary" size="md" type="submit" :loading="saving" @click="save">
  Save
</OButton>

<OButton variant="ghost-destructive" size="icon-sm" icon-left="delete" @click="remove" />
```
**Family:** OButtonGroup (joins multiple OButtons into one segmented control)

---

### OButtonGroup
**Import:** `@/lib/core/Button/OButtonGroup.vue`
**Use when:** Joining 2+ OButtons into a single control with shared corners and dividers (e.g. a split action, segmented toolbar cluster).
**Don't use for:** A single button (use [OButton](#obutton) directly). A mutually-exclusive selector where one option stays "on" — use [OToggleGroup](#otogglegroup) instead.
**Key props:**
- `orientation` (`"horizontal"` | `"vertical"`, default `"horizontal"`)
- `align` (`"stretch"` | `"center"` | `"start"` | `"end"`, default `"stretch"`) — cross-axis alignment of children
- `radius` (`"sm"` | `"md"` | `"lg"`, default `"md"`) — must match the inner buttons' radius; use `"sm"` when children use `size="chip"` or `size="icon-chip"`
**Slots:** `default` (one or more OButton children)
**Emits:** none
**Example:**
```vue
<OButtonGroup radius="md">
  <OButton variant="outline" size="sm">Day</OButton>
  <OButton variant="outline" size="sm">Week</OButton>
  <OButton variant="outline" size="sm">Month</OButton>
</OButtonGroup>
```
**Family:** OButton

---

### ONavbar
**Import:** `@/lib/core/Navbar/ONavbar.vue`
**Use when:** Rendering the app's left sidebar rail. It reshapes a flat `linksList` into rail entries (plain links, link+flyout groups, pure flyout groups) via `groupNavLinks`, with ArrowUp/ArrowDown/Tab keyboard navigation.
**Don't use for:** In-page tab strips or section navs — this is specifically the global left rail. Sub-page flyout rows are rendered by its child [ONavGroup](#onavgroup).
**Key props:**
- `linksList` (`NavItem[]`, required) — flat list of nav items (`{ title, icon, link, name, exact?, display?, hide?, badge? }`)
- `miniMode` (boolean, default `false`) — passes `mini` down to each MenuLink
- `visible` (boolean, default `true`) — toggles `v-show` on the `<nav>`
**Slots:** none (`default?: never`)
**Emits:** `menu-hover` (`routePath: string`) — fired on tile mouseenter
**Example:**
```vue
<ONavbar :links-list="navLinks" :mini-mode="collapsed" @menu-hover="prefetch" />
```
**Family:** ONavGroup (renders the hover flyout tiles inside the rail); `navGroups.ts` supplies `groupNavLinks` + `GATE_PREDICATES`

---

### ONavGroup
**Import:** `@/lib/core/Navbar/ONavGroup.vue`
**Use when:** Internally by [ONavbar](#onavbar) to render a rail tile that reveals a hover flyout of sub-pages. Two modes: link+subnav (`parentItem` set — tile navigates AND reveals children on hover) or pure group (no `parentItem` — click pins the flyout). Only one flyout is open at a time (module-scoped coordinator).
**Don't use for:** Direct use in feature code — it is an ONavbar building block. Standalone dropdown menus should use the overlay dropdown components.
**Key props:**
- `groupKey` (string, required) — unique key; drives the single-open coordinator
- `title` (string, required) / `icon` (string, required)
- `children` (`SubnavChild[]`, required) — flyout rows; filtered by `router.hasRoute` and per-item `gate` predicates
- `parentItem` (`{ link; title; icon; name }`, optional) — when set, the tile navigates here and the flyout is hover-only
**Slots:** none (renders MenuLink tile + teleported flyout internally)
**Emits:** none declared (forwards `mouseenter` from ONavbar's binding)
**Example:**
```vue
<!-- Emitted by ONavbar; not typically hand-authored -->
<ONavGroup group-key="data" title="Data" icon="database"
  :children="dataSubnav" :parent-item="dataItem" />
```
**Family:** ONavbar (parent)

---

### ORefreshButton
**Import:** `@/lib/core/RefreshButton/ORefreshButton.vue`
**Use when:** A manual "refresh now" control that also shows a staleness dot (green <30s, amber 30s–5min, red >5min) and a live relative-time label ("2m ago") of the last query run.
**Don't use for:** A plain icon action with no staleness indicator — use [OButton](#obutton) with `size="icon"`. Auto-refresh interval selection is a separate control.
**Key props:**
- `lastRunAt` (`number | null`, default `null`) — Unix ms timestamp of the last completed query; drives the dot color and relative label
- `loading` (boolean, default `false`) — spins the icon, disables the button, forces the idle dot
- `disabled` (boolean, default `false`) — disables independently of loading
**Slots:** none
**Emits:** `click` (`MouseEvent`) — suppressed while `loading` or `disabled`
**Example:**
```vue
<ORefreshButton :last-run-at="lastQueryTs" :loading="isFetching" @click="runQuery" />
```
**Family:** standalone (wraps OButton internally)

---

### OSplitter
**Import:** `@/lib/core/Splitter/OSplitter.vue`
**Use when:** Two resizable panes with a draggable separator (keyboard-accessible: Arrow keys step, Home/End jump to limits). Content goes in the `before` and `after` slots; the split position is `v-model`-bound.
**Don't use for:** Static two-column layouts that don't resize (use flex/grid). Note the value unit is configurable via `unit` (`'%'` default or `'px'`), despite the project's general no-`px` rule — this is a measurement value, not a style.
**Key props:**
- `modelValue` (number, required) — split position in `unit`; `v-model`
- `horizontal` (boolean, default `false`) — `false` = vertical split (side-by-side, col-resize); `true` = horizontal split (stacked, row-resize)
- `unit` (`"px"` | `"%"`, default `"%"`) — unit of `modelValue` and `limits`
- `limits` (`[number, number]`, default `[0, 0]`) — min/max; when `[0,0]` falls back to `[0,100]` for `%` or `[0,1000]` for `px`
- `disable` (boolean, default `false`) — locks the separator (dims it, ignores drag/keys)
- `separator` (boolean, default `true`) — set `false` to hide the separator element
- `separatorClass` (string) / `separatorStyle` (`StyleValue`) — extra class/style on the separator
- `beforeClass` (string) — extra class on the before pane
**Slots:** `before`, `after`, `separator` (custom separator content)
**Emits:** `update:modelValue` (`value: number`)
**Example:**
```vue
<OSplitter v-model="splitPos" :limits="[20, 80]" class="h-full">
  <template #before><QueryList /></template>
  <template #after><ResultPane /></template>
</OSplitter>
```
**Family:** standalone (uses the `useResizer` composable)

---

### OToggleGroup
**Import:** `@/lib/core/ToggleGroup/OToggleGroup.vue`
**Use when:** A segmented control — a horizontal (or vertical) bar of mutually-exclusive (`type="single"`) or multi-select (`type="multiple"`) pills sharing one track. Ideal for view switches (Logs/Table), density toggles, mode pickers. Built on reka-ui `ToggleGroupRoot`.
**Don't use for:** A binary on/off setting — use a switch/checkbox. Joined action buttons that each fire a command — use [OButtonGroup](#obuttongroup). Form-bound toggles — use [OFormToggleGroup](#oformtogglegroup).
**Key props:**
- `type` (`"single"` | `"multiple"`, default `"single"`) — in `single` mode empty/null selections are ignored so one item always stays active
- `modelValue` (`AcceptableValue | AcceptableValue[]`) — active value(s); `v-model`
- `variant` (`"default"` | `"primary"`, default `"default"`) — use `primary` when the bar sits on a primary-colored surface (e.g. dashboard query bar)
- `orientation` (`"horizontal"` | `"vertical"`, default `"horizontal"`)
- `disabled` (boolean, default `false`) — disables all items
- `label` (string) — text label beside the bar; for rich content use the `label` slot
- `labelPosition` (`"left"` | `"right"` | `"top"`, default `"left"`)
**Slots:** `default` (OToggleGroupItem children), `label` (overrides the `label` prop)
**Emits:** `update:modelValue` (`AcceptableValue | AcceptableValue[]`)
**Example:**
```vue
<OToggleGroup v-model="view" label="View">
  <OToggleGroupItem value="logs" icon-left="list">Logs</OToggleGroupItem>
  <OToggleGroupItem value="table" icon-left="table">Table</OToggleGroupItem>
</OToggleGroup>
```
**Family:** OToggleGroupItem (children), OFormToggleGroup (form-bound wrapper)

---

### OToggleGroupItem
**Import:** `@/lib/core/ToggleGroup/OToggleGroupItem.vue`
**Use when:** Each option inside an [OToggleGroup](#otogglegroup) / [OFormToggleGroup](#oformtogglegroup). Active state shows a white chip with shadow (`data-state=on`).
**Don't use for:** Anything outside a ToggleGroup — it relies on reka-ui `ToggleGroupItem` context.
**Key props:**
- `value` (`AcceptableValue`, required) — unique option value
- `size` (`"md"` | `"sm"` | `"xs"`, default `"md"`) — `md` full toolbar, `sm` small toolbar, `xs` compact inline
- `disabled` (boolean, default `false`) — disables only this item (wrapper keeps `cursor-not-allowed` + tooltip visible)
- `tooltip` (string) — hover tooltip (OTooltip); useful to explain a disabled item
- `iconLeft` (string) / `iconRight` (string) — OIcon registry names; `icon-left`/`icon-right` slots take precedence
**Slots:** `default` (label), `icon-left`, `icon-right`
**Emits:** none (selection is handled by the parent ToggleGroupRoot)
**Example:**
```vue
<OToggleGroupItem value="json" size="sm" icon-left="code" tooltip="Raw JSON">JSON</OToggleGroupItem>
```
**Family:** OToggleGroup (parent)

---

### OFormToggleGroup
**Import:** `@/lib/core/ToggleGroup/OFormToggleGroup.vue`
**Use when:** A segmented toggle bar bound to an OForm field. It is the OForm* wrapper around OToggleGroup — auto-binds the active value to a TanStack field by `name` (model-value ← field state, change → `handleChange` + `handleBlur`) and renders field errors below the bar.
**Don't use for:** Toggles outside an `<OForm>` (warns in DEV) — use plain [OToggleGroup](#otogglegroup) with your own `v-model`.
**Key props:** accepts everything OToggleGroup accepts **except** `modelValue` (auto-bound), plus:
- `name` (string, required) — field name; must match a key in the parent OForm's `defaultValues`
- `type`, `variant`, `orientation`, `disabled`, `label`, `labelPosition` — passed through to OToggleGroup (same defaults)
**Slots:** `default` (OToggleGroupItem children), `label`
**Emits:** none (changes are pushed into the form field, not emitted)
**Example:**
```vue
<OForm :default-values="{ severity: 'warn' }">
  <OFormToggleGroup name="severity" label="Severity">
    <OToggleGroupItem value="info">Info</OToggleGroupItem>
    <OToggleGroupItem value="warn">Warn</OToggleGroupItem>
    <OToggleGroupItem value="error">Error</OToggleGroupItem>
  </OFormToggleGroup>
</OForm>
```
**Family:** OToggleGroup, OToggleGroupItem

---

### OTable
**Import:** `@/lib/core/Table/OTable.vue`
**Use when:** Any tabular data grid — CRUD listings, log/trace tables, dashboards. Built on TanStack `@tanstack/vue-table`. Supports client or server pagination/sorting/filtering, selection, row expansion, tree mode, virtual scroll, column resize/reorder/pin/persistence, and prebuilt cell renderers.
**Don't use for:** A simple static key/value list or definition list (use plain markup). The `sub-components/` folder (OTableHeader, OTableBodyRow, etc.) is **internal** — never import those directly; drive everything through OTable props/slots.

**Key props (grouped by concern):**

- **Data**
  - `data` (`TData[]`, required) — row array
  - `columns` (`OTableColumnDef<TData>[]`, required) — column defs (shape below)
  - `rowKey` (string, default `"id"`) — unique row identifier field
  - `tableId` (string) — instance id; required for `persistColumns`

- **Pagination** (`pagination`: `"client"` | `"server"` | `"none"`, default `"client"`)
  - `pageSize` (number, default `20`), `pageSizeOptions` (number[], default `[20, 50, 100, 250, 500]`)
  - `currentPage` (number, 1-based) — `v-model:currentPage` for server mode
  - `totalCount` (number) — required for server-side pagination
  - `keepPageOnDataChange` (boolean, default false) — don't reset page when `data` changes

- **Sorting** (`sorting`: `"client"` | `"server"` | `"none"`, default `"client"`)
  - `sortBy` (string), `sortOrder` (`"asc"` | `"desc"`) — server-side `v-model` pair
  - `sortFieldMap` (`Record<string,string>`) — TanStack column id → backend field name

- **Filtering** (`filterMode`: `"client"` | `"server"`, default `"client"`)
  - `globalFilter` (string) `v-model`, `globalFilterPlaceholder` (default `"Search..."`)
  - `showGlobalFilter` (boolean, default `true`) — built-in search bar
  - `footerTitle` (string) — bold "N footerTitle" count label in the footer

- **Selection** (`selection`: `"none"` | `"single"` | `"multiple"`, default `"none"`)
  - `selectedIds` (string[]) `v-model:selectedIds`
  - `isRowSelectable` (`(row) => boolean`) — disable a row's checkbox

- **Expansion / tree** (`expansion`: `"none"` | `"single"` | `"multiple"` | `"tree"`, default `"none"`)
  - `expandedIds` (string[]) `v-model:expandedIds`
  - `getRowExpansionEnabled` (`(row) => boolean`), `expandOnRowClick` (boolean | `(row)=>boolean`)
  - `getSubRows` (`(row) => TData[]`)
  - `tree` (boolean) — inline-chevron tree mode; `getChildren` (default `row.children`), `getRowWarning` (renders `#tree-warning` row), `treeColumnId` (which column hosts the chevron)

- **Columns / persistence**
  - `showIndex` (boolean) — auto-inject a fixed-width `#` index column
  - `enableColumnResize`, `enableColumnReorder`, `enableColumnPin` (all default `false`)
  - `columnVisibility` (`Record<string,boolean>`) — initial visibility
  - `persistColumns` (boolean, default `false`) — persist widths + visibility to localStorage (needs `tableId`)

- **Display / layout**
  - `loading` (default false), `streaming` (default false — pulsing incremental indicator), `error` (`string|null`), `emptyMessage`
  - `dense` (default `true`), `bordered` (default `true`), `frame` (default `false` — outer frame border), `striped` (default false)
  - `stickyHeader` (default `true`), `showHeader` (default `true`), `wrap` (default false), `horizontalScroll` (natural-width cells + horizontal scroll; pair with `wrap=false`)
  - `fillHeight` (default `true` — set false to shrink to content), `virtualScroll` (default false, `virtualScrollItemSize` default `48`), `maxHeight`, `width`
  - Row styling: `rowClass`, `getRowStyle`, `getRowStatusColor` (4px left status bar), `getCellStyle`, `enableCellCopy`
  - Highlight: `highlightText`, `highlightFields`

**`OTableColumnDef` shape:**
```ts
interface OTableColumnDef<TData = any> {
  id: string;                          // unique id (also default accessorKey)
  header: string | Component;          // header text or render component
  accessorKey?: string;                // key in the row object
  accessorFn?: (row: TData) => any;    // custom accessor
  cell?: string | Component;           // custom cell renderer
  size?: number; minSize?: number; maxSize?: number;  // width hints (px → rem)
  sortable?: boolean; filterable?: boolean; resizable?: boolean;
  pinnable?: boolean; pinned?: "left" | "right" | false;
  hideable?: boolean; isAction?: boolean;   // action col = compact, no data
  footer?: string | Component;
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  meta?: {
    align?: "left" | "center" | "right";
    headerClass?: string; cellClass?: string;
    isName?: boolean;                  // primary name column (weight 500)
    format?: (value: any, row: any) => any;
    [key: string]: any;
  };
}
```

**Main emits:**
- Pagination: `update:currentPage`, `update:pageSize`, `pagination-change`
- Sorting: `update:sortBy`, `update:sortOrder`, `sort-change`
- Filter: `update:globalFilter`, `filter-change`
- Selection: `update:selectedIds`, `selection-change` (emits selected rows)
- Expansion: `update:expandedIds`
- Row: `row-click`, `row-dblclick`, `row-mouseenter`, `row-mouseleave`, `cell-click`
- Columns: `column-order-change`, `column-visibility-change`, `update:columnSizes`
- Virtual scroll: `scroll`, `scroll-end`

**Main slots:** `cell` (scoped `{ row, column, value, table }`), `top`, `toolbar` (inside the frame, above header), `toolbar-trailing`, `header-actions`, `bottom` (scoped with pagination state/actions), `loading`, `loading-banner`, `empty`, `error` (`{ message }`), `expansion` (`{ row }`), `tree-warning` (`{ row }`)

**Exposed (template ref):** `table` (TanStack instance), `toggleAllRows`, `clearSelection`, `resetColumnSizes`, `resetColumnOrder`, `resetPersistedColumns`, `scrollToTop`, `getRows`

**Example:**
```vue
<script setup lang="ts">
import { ref } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { OTimeCell, OUserCell } from "@/lib/core/Table/cells";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

const rows = ref([/* ... */]);
const selectedIds = ref<string[]>([]);

const columns: OTableColumnDef[] = [
  { id: "name", header: "Name", accessorKey: "name", sortable: true, meta: { isName: true } },
  { id: "owner", header: "Owner", accessorKey: "owner", cell: OUserCell },
  { id: "createdAt", header: "Created", accessorKey: "created_at", cell: OTimeCell, size: 200 },
  { id: "actions", header: "", isAction: true, hideable: false },
];
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    selection="multiple"
    v-model:selected-ids="selectedIds"
    :page-size="50"
    footer-title="Dashboards"
    @row-click="openRow"
  >
    <template #cell="{ column, row, value }">
      <template v-if="column.id === 'actions'">
        <OButton variant="ghost" size="icon-sm" icon-left="edit" @click.stop="edit(row.original)" />
      </template>
    </template>
  </OTable>
</template>
```
**Family:** cell renderers (below); `OTable.types.ts` exports `OTableColumnDef`, the mode/param types, and `COL`/`TABLE_*` size constants. `sub-components/` is internal.

---

### OTable cell renderers

Prebuilt cell components — pass as a column's `cell`. Import individually or from the barrel `@/lib/core/Table/cells`.

- **OTimeCell** (`@/lib/core/Table/cells/OTimeCell.vue`) — the one timestamp renderer: relative ("2m ago") by default, `mode="absolute"` / `"date"` for full datetime; `unit` interprets numeric values (`auto`/`iso`/`s`/`ms`/`us`/`ns`); muted `empty-label` for zero/empty.
- **OUserCell** (`@/lib/core/Table/cells/OUserCell.vue`) — person/owner/created-by column; renders email or explicit `name` as truncated plain text, dash when empty.
- **ONumberCell** (`@/lib/core/Table/cells/ONumberCell.vue`) — consistent numeric rendering (tabular-nums); `format` = `number`/`compact`/`bytesFromMB`/`durationSec`/`durationMs`/`durationUs`/`durationNs`/`percent`. Pair the column with `meta.align: "right"`.
- **OCodeCell** (`@/lib/core/Table/cells/OCodeCell.vue`) — monospace identifiers / SQL / tokens, truncated with title tooltip and optional hover copy button (`copy`, default true).
- **ODataBarCell** (`@/lib/core/Table/cells/ODataBarCell.vue`) — value with a proportional background bar (width = value/`max`, caller supplies the column max and pre-formatted `display`); `variant` `default`/`warning`/`danger` for threshold columns.

Also exported from the barrel: `statusVariant`, `humanizeStatus` helpers (+ `StatusTone`, `StatusVariantResult` types) for status badge styling.

### Custom cell templates

For renders not covered by prebuilt cells, use a slot template `#cell-{id}`:

```vue
<OTable :columns="columns" :data="rows">
  <!-- Slot receives { row } — row is the full data record -->
  <template #cell-enabled="{ row }">
    <OSwitch
      :model-value="row.enabled"
      @update:model-value="toggleEnabled(row, $event)"
    />
  </template>

  <template #cell-status="{ row }">
    <OBadge :variant="getStatusVariant(row.status)">
      {{ row.status }}
    </OBadge>
  </template>

  <template #cell-actions="{ row }">
    <div class="flex gap-1">
      <OButton variant="ghost" size="sm" icon-left="edit" @click="edit(row)" />
      <OButton variant="ghost" size="sm" icon-left="delete" @click="remove(row)" />
    </div>
  </template>
</OTable>
```

**Important:** Access row data directly (`row.enabled`, `row.status`, `row.id`), not via `row.original`. The `row` object *is* the data record with all properties accessible.
