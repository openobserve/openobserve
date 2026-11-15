# Core — Controls & Table

Authoring reference for O2's core control components (Button, Navbar, RefreshButton, Splitter, ToggleGroup) and the OTable data-grid family. Every prop/variant/size/emit/slot below is transcribed from the actual `.types.ts` and `<script setup>` source — nothing invented.

## Table of Contents

- [OButton](#obutton)
- [OButtonGroup](#obuttongroup)
- [OSplitButton](#osplitbutton)
- [OCopyButton](#ocopybutton)
- [ONavbar](#onavbar)
- [ONavGroup](#onavgroup)
- [ORefreshButton](#orefreshbutton)
- [OSplitter](#osplitter)
- [OToggleGroup](#otogglegroup)
- [OToggleGroupItem](#otogglegroupitem)
- [OFormToggleGroup](#oformtogglegroup)
- [OTable](#otable)
- [OTable cell renderers](#otable-cell-renderers)
- [Cut cell text — the shared tooltip](#cut-cell-text--the-shared-tooltip)

---

### OButton

**Import:** `@/lib/core/Button/OButton.vue`
**Use when:** Any clickable action — form submit, toolbar action, icon button, confirmation, CTA. The look is baked into the variant and size; there are no style-override props, and `local/o2-button-api` (ESLint, error in `lint:ci`) rejects any value not listed here.
**Don't use for:** A mode or view choice — that is [OToggleGroup](#otogglegroup) (guideline F6). Copying a value — that is [OCopyButton](#ocopybutton). Refresh — that is [ORefreshButton](#orefreshbutton). One action plus its variants — [OSplitButton](#osplitbutton).
**Key props:**

- `variant` (default `"secondary"`, so a forgotten prop never makes a primary) — seven, chosen by job (B2):

  | Variant        | Job                                                                                    |
  | -------------- | -------------------------------------------------------------------------------------- |
  | `primary`      | The one main action of a region: page header, dialog/drawer footer, form (B1)          |
  | `secondary`    | Surface fill on the control edge (`--color-control-border`, hover lifts it); `pressed` takes the accent fill and the selected edge. Alternatives, Cancel, toolbar actions beside a field |
  | `ghost`        | Borderless, secondary ink that lifts to heading ink on hover. Quiet actions in toolbars, rows and panel headers; most icon-only buttons |
  | `accent-ghost` | An inline next step that reads as a link-like action ("View logs")                     |
  | `danger`       | Solid red, **only** the confirm button inside a confirmation dialog (B2)               |
  | `danger-ghost` | Red text: Delete in bulk bars and footers; a row's Delete lives last in its ⋯ menu (B7) |
  | `link`         | Inside running text; no control height or padding                                      |

- `size` (default `"md"`, or the enclosing `OButtonGroup`'s `size`) — `xs` 24 · `sm` 28 · `md` 32 · `lg` 36, from the `--spacing-control-*` tokens (S1). Give the button the same size as the field beside it (S2); `lg` is for sign-in and the empty-state CTA only. Never set a height class on a button.
- `icon` / `iconEnd` (`IconName`) — leading glyph; trailing chevron for a menu or ↗ for an external link. An icon goes on a text button only when it adds meaning the word lacks, and the create button never has "+" (B4). Slots `#icon` / `#icon-end` replace them.
- `iconOnly` (boolean) — square button. Universal actions only (refresh, close, more, copy, expand, settings, columns, row edit/delete); it needs a name (B5): pass `label` (becomes the aria-label **and** the built-in tooltip, with `shortcut`) or an `aria-label` plus a child `OTooltip`
- `label` (`I18nText`) — the visible text when there is no default slot; the name and tooltip with `iconOnly`. Labels are verb + noun (B3)
- `count` (number) — pill after the label (e.g. Filters 2)
- `pressed` (boolean) — a toggle button: sets `aria-pressed` and the selected tint; leave it unset on a plain button
- `loading` (boolean) — keeps the width, shows a spinner after 300 ms, ignores clicks, stays focusable (B10)
- `disabled` (boolean) + `disabledReason` (`I18nText`) — with a reason the button stays focusable (`aria-disabled`), the reason is its tooltip and description. Disable with a reason an action that will become available; hide one the user can never perform (B9)
- `stale` (boolean) — warn dot: the result is older than the inputs (a Run/Apply waiting to be pressed)
- `href` (anchor) / `to` (router link) — a button that navigates
- `shortcut` (registry id) — keys appear in the tooltip, not on the button (B6)
- `type` (`"button"` | `"submit"` | `"reset"`, default `"button"`) · `block` (full width) · `as` (`"button"` | `"div"`, the div hosts an embedded switch that cannot nest inside a native button)
  **Slots:** `default` (label), `icon`, `icon-end`
  **Emits:** `click` (`MouseEvent`) — suppressed while `disabled` or `loading`
  **Example:**

```vue
<OButton variant="primary" type="submit" :loading="saving" @click="save">
  {{ t("alerts.saveAlert") }}
</OButton>

<OButton
  variant="danger-ghost"
  icon-only
  size="xs"
  icon="delete"
  :label="t('alerts.deleteAlert')"
  @click="remove"
/>

<OButton
  variant="secondary"
  icon="pause"
  :disabled="!selected.length"
  :disabled-reason="t('alerts.selectToPause')"
  @click="pause"
>
  {{ t("alerts.pause") }}
</OButton>
```

More than three actions in a header or toolbar: the extras go into ⋯ More, frequent first, destructive last; never shrink or wrap the row (B8). Overflow is always ⋯ (B11).

**Family:** OButtonGroup, OSplitButton, OCopyButton, ORefreshButton

---

### OButtonGroup

**Import:** `@/lib/core/Button/OButtonGroup.vue`
**Use when:** Attaching 2–4 actions of equal weight that belong together: zoom −/Fit/+, previous/next.
**Don't use for:** A single button. A mode or view, where one option stays "on" — that is [OToggleGroup](#otogglegroup) (F6). One default action plus its variants — [OSplitButton](#osplitbutton).
**Key props:**

- `size` (`"xs"` | `"sm"` | `"md"` | `"lg"`) — every child without its own `size` takes it, so the group has one height (S1, S2)
- Always horizontal and divided; no radius, orientation or alignment props. The group never clips overflow (a clip hides a child's focus outline) and lifts the focused child with `z-1`
  **Slots:** `default` (OButton children, usually all `secondary` or all `ghost`)
  **Emits:** none
  **Example:**

```vue
<OButtonGroup size="sm">
  <OButton variant="secondary" icon-only icon="chevron-left" :label="t('common.previous')" />
  <OButton variant="secondary" icon-only icon="chevron-right" :label="t('common.next')" />
</OButtonGroup>
```

**Family:** OButton, OSplitButton

---

### OSplitButton

**Import:** `@/lib/core/Button/OSplitButton.vue`
**Use when:** One action is the default and a menu holds its variants: Run query ▾, Export ▾, Refresh ▾ (B6). At most one split per toolbar; overflow goes to ⋯ More (B8).
**Don't use for:** A mode (OToggleGroup) or equal-weight actions (OButtonGroup).
**Key props:**

- `label` (`I18nText`, required) · `icon` (`IconName`) — the default action
- `variant` (`"primary"` | `"secondary"`, default `"secondary"`) · `size` (`"sm"` | `"md"`, default `"md"`) — both halves share them
- `menuLabel` (`I18nText`, default "More options") — aria-label of the menu half
- `loading` · `disabled` · `stale` (warn dot on the action half while results are older than the query) · `shortcut`
  **Slots:** `menu` (ODropdownItem children)
  **Emits:** `click` (`MouseEvent`) — from the action half only
  **Example:**

```vue
<OSplitButton
  variant="primary"
  icon="play-arrow"
  :label="t('search.runQuery')"
  :loading="running"
  :stale="queryChanged"
  shortcut="logsRunQuery"
  @click="run"
>
  <template #menu>
    <ODropdownItem @select="runAndSave">{{ t("search.runAndSaveView") }}</ODropdownItem>
  </template>
</OSplitButton>
```

**Family:** OButton, OButtonGroup

---

### OCopyButton

**Import:** `@/lib/core/CopyButton/OCopyButton.vue`
**Use when:** **Every copy action.** Beside a machine value people paste elsewhere (IDs, tokens, URLs, queries, commands, T4), inside the value it copies. Never hand-build a copy button from OButton + `copyToClipboard`, and never use the copy glyph for Duplicate or Clone.
**Behaviour:** copies through the shared clipboard helper (works without HTTPS clipboard access), swaps its glyph to a check for 1.5 s and announces "Copied" to screen readers. It raises **no toast**, because the result is visible in place (K1). On failure it says "Copy blocked · press Ctrl C" and emits `failed`. Its click never reaches a clickable row.
**Key props:**

- `value` (`string | () => string`, required) — what lands on the clipboard; a function is read at click time
- `label` (`I18nText`, default "Copy") — names the value ("Copy trace ID"); the aria-label and tooltip
- `size` (`"xs"` | `"sm"` | `"md"`, default `"sm"`) — xs inside a field or row, sm in a panel header, md in a toolbar (S2)
- `showLabel` (boolean) — a text button ("Copy command") instead of icon-only, for code blocks and dialogs
- `variant` (`"ghost"` | `"secondary"`, default `"ghost"`) — secondary only in toolbars
  **Emits:** `copied` (value) · `failed` (value) — analytics hooks
  **Example:**

```vue
<OCopyButton size="xs" :value="span.trace_id" :label="t('traces.copyTraceId')" />
<OCopyButton show-label variant="secondary" :value="installCommand" />
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
<ONavGroup
  group-key="data"
  title="Data"
  icon="database"
  :children="dataSubnav"
  :parent-item="dataItem"
/>
```

**Family:** ONavbar (parent)

---

### ORefreshButton

**Import:** `@/lib/core/RefreshButton/ORefreshButton.vue`
**Use when:** Refreshing any list, explorer or panel. One control, last in the toolbar (F1, F9): a `secondary` button with ↻ and the data age ("2m ago", absolute time in the tooltip), plus an optional auto-refresh menu segment.
**Don't use for:** Retry after an error — that is a text button in the error state (K5). Never `primary`, never beside the create action in the page header (H3). No OButton with a refresh icon and its own "checked just now" text.
**Key props:**

- `lastRunAt` (`number | null`, default `null`) — epoch ms of the last completed read; drives the data age (hidden below 1024 px)
- `loading` (boolean) — swaps ↻ for a spinner and the age for "Refreshing"; the rows stay (K4); clicks are ignored, focus stays
- `failedAt` (`number | null`) — a failed refresh: warn dot and "Failed", the button reads Retry, the full sentence is its tooltip and description
- `autoRefresh` (`"off"` | `"10s"` | `"30s"` | `"1m"` | `"5m"` | `"15m"`) — shows the auto-refresh menu; bind with `v-model:auto-refresh`; omit to hide the menu. While on, the label reads "Auto · 30 s"
- `size` (`"sm"` | `"md"`, default `"md"`) — md in a toolbar beside the time range (S2), sm in a panel header
- `disabled` · `shortcut` (registry id, shown in the tooltip) · `dataTest` (keeps a page's selector) · `tooltip` (replaces the last-refreshed time for data with its own as-of time) · `timeZone`
  **Slots:** none
  **Emits:** `click` (`MouseEvent`) — suppressed while `loading` or `disabled` · `update:autoRefresh`
  **Example:**

```vue
<ORefreshButton
  v-model:auto-refresh="autoRefresh"
  :last-run-at="lastQueryTs"
  :loading="isFetching"
  :failed-at="refreshFailedAt"
  shortcut="alertsRefresh"
  data-test="alert-list-refresh-btn"
  @click="runQuery"
/>
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
**Use when:** A segmented control that switches a view or an object type — 2–4 options ("Alerts | Anomalies", Table | Chart) (S5, F6). Built on reka-ui `ToggleGroupRoot`.
**Don't use for:** Narrowing a list by state ("Firing", "Paused") — that is a filter select, a KPI tile or a chip (F6). Peer pages — that is `OTabs` (N2). A binary on/off setting — use a switch/checkbox. Joined action buttons — use [OButtonGroup](#obuttongroup). Form-bound toggles — use [OFormToggleGroup](#oformtogglegroup).
**Key props:**

- `size` (`"sm"` 28 | `"md"` 32 default) — set on the GROUP, never on an item; the tray is `h-control-*`, `rounded-default`, on the surface with the 1 px control edge (`--color-control-border`, the same as every input and secondary button in the row) and 1 px padding, so segments one token down fit; they use `text-compact` at weight 500 (S1, S2). Inside a field (`OInput` provides it, e.g. `OSearchInput`'s scope) the tray drops its edge for a `bg-surface-subtle` tray with 2 px padding. Never an `h-*` class on the group or an item (`local/o2-control-height`).
- `type` (`"single"` | `"multiple"`, default `"single"`) — in `single` mode empty/null selections are ignored so one item always stays active
- `modelValue` (`AcceptableValue | AcceptableValue[]`) — active value(s); `v-model`
- `variant` (`"default"` | `"primary"`, default `"default"`) — use `primary` when the bar sits on a primary-colored surface (e.g. dashboard query bar)
- `orientation` (`"horizontal"` | `"vertical"`, default `"horizontal"`)
- `disabled` (boolean, default `false`) — disables all items
- `label` (string) — text label beside the bar; for rich content use the `label` slot
- `labelPosition` (`"left"` | `"right"` | `"top"`, default `"left"`)
- `mobileDropdown` (boolean, default `false`) — below md a single-select horizontal group renders as a dropdown whose trigger shows the active item. Use it on every toolbar view switch so it doesn't claim its own phone row (R1). A strip that narrows by state is a filter select instead (F6). Data-tests: trigger `<group data-test>-dropdown-btn`, items `<item data-test>-item`. `AppTabs` forwards it. See [responsive § Toolbars](responsive.md#toolbars-one-row-filters-become-a-dropdown).
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
**Use when:** Each option inside an [OToggleGroup](#otogglegroup) / [OFormToggleGroup](#oformtogglegroup). The active segment (`data-state=on`) is the selected accent fill (`--color-toggle-item-active-bg`) with accent ink, and no ring or shadow.
**Don't use for:** Anything outside a ToggleGroup — it relies on reka-ui `ToggleGroupItem` context.
**Key props:**

- `value` (`AcceptableValue`, required) — unique option value
- `disabled` (boolean, default `false`) — disables only this item (wrapper keeps `cursor-not-allowed` + tooltip visible)
- `tooltip` (`I18nText`) — hover tooltip (OTooltip); an icon-only segment uses it as its `aria-label` too (B5)
- `count` (number) — tabular count after the label ("Logs 12")
- There is no item `size`: the item takes its group's size, and `local/o2-controls-api` rejects a `size` on an item.
- `iconLeft` (string) / `iconRight` (string) — OIcon registry names; `icon-left`/`icon-right` slots take precedence
  **Slots:** `default` (label), `icon-left`, `icon-right`
  **Emits:** none (selection is handled by the parent ToggleGroupRoot)
  **Example:**

```vue
<OToggleGroup v-model="view" size="sm">
  <OToggleGroupItem value="json" icon-left="code" :tooltip="t('logs.rawJson')">{{
    t("logs.json")
  }}</OToggleGroupItem>
</OToggleGroup>
```

**Family:** OToggleGroup (parent)

---

### OFormToggleGroup

**Import:** `@/lib/core/ToggleGroup/OFormToggleGroup.vue`
**Use when:** A segmented toggle bar bound to an OForm field. It is the OForm* wrapper around OToggleGroup — auto-binds the active value to a TanStack field by `name` (model-value ← field state, change → `handleChange` + `handleBlur`) and renders field errors below the bar.
**Don't use for:** Toggles outside an `<OForm>` (warns in DEV) — use plain [OToggleGroup](#otogglegroup) with your own `v-model`.
**Key props:** accepts everything OToggleGroup accepts **except** `modelValue` (auto-bound), plus:

- `name` (string, required) — field name; must match a key in the parent OForm's `defaultValues`
- `size`, `type`, `variant`, `orientation`, `disabled`, `label`, `labelPosition` — passed through to OToggleGroup (same defaults; `size` is the group's sm 28 / md 32)
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

- **Pagination** (`pagination`: `"client"` | `"server"` | `"none"`, default `"client"`) — records page, event streams (logs, spans) scroll with `"none"` (D5)
  - `pageSize` (number, default `20`, the same everywhere), `pageSizeOptions` (number[], default `[20, 50, 100]`, no "All")
  - A `pageSize` outside `pageSizeOptions` is listed in the select too, so it never renders blank; still, prefer the default `20`.
  - `currentPage` (number, 1-based) — `v-model:currentPage` for server mode
  - `totalCount` (number) — required for server-side pagination; `totalCountExact: false` makes the range read "of many" and drops Last page
  - `keepPageOnDataChange` (boolean, default false) — don't reset page when `data` changes

- **Sorting** (`sorting`: `"client"` | `"server"` | `"none"`, default `"client"`)
  - `sortBy` (string), `sortOrder` (`"asc"` | `"desc"`) — server-side `v-model` pair
  - `sortFieldMap` (`Record<string,string>`) — TanStack column id → backend field name

- **Filtering** (`filterMode`: `"client"` | `"server"`, default `"client"`)
  - `globalFilter` (string) — the text the rows are filtered by. OTable draws **no search box**: put an `OSearchInput width="list"` in `#toolbar` and bind it here (F1, F2). `"server"` leaves the text to the caller's fetch.

- **Selection** (`selection`: `"none"` | `"single"` | `"multiple"`, default `"none"`)
  - `selectedIds` (string[]) `v-model:selectedIds`
  - `isRowSelectable` (`(row) => boolean`) — disable a row's checkbox

- **Expansion / tree** (`expansion`: `"none"` | `"single"` | `"multiple"` | `"tree"`, default `"none"`)
  - `expandedIds` (string[]) `v-model:expandedIds`
  - `getRowExpansionEnabled` (`(row) => boolean`), `expandOnRowClick` (boolean | `(row)=>boolean`)
  - `getSubRows` (`(row) => TData[]`)
  - `tree` (boolean) — inline-chevron tree mode; `getChildren` (default `row.children`), `getRowWarning` (renders `#tree-warning` row), `treeColumnId` (which column hosts the chevron)

- **Columns / persistence** — there is no row-number column (D2): `showIndex` is gone and `local/o2-table-api` rejects a column with `id: "#"`
  - `enableColumnResize`, `enableColumnReorder`, `enableColumnPin` (all default `false`)
  - `columnVisibility` (`Record<string,boolean>`) — initial visibility
  - `persistColumns` (boolean, default `false`) — persist widths + visibility to localStorage (needs `tableId`)

- **Display / layout**
  - `loading` (default false), `streaming` (default false — pulsing incremental indicator), `error` (`string|null`), `emptyMessage`
    - A refetch (`loading` true again after a settled, non-empty answer) keeps the last rows on screen; if it runs past 150 ms they dim, go inert and the bottom bar pulses. A first load, or the load after an error or an empty answer, shows the skeleton.
    - `loadingResetKey` — bind the folder, tab or entity the rows belong to; changing it drops the kept rows, so a switch shows the skeleton instead of the previous context's rows.
    - `skeletonOnRefetch` — skeleton on every load, for tables whose old rows mislead once the query changes (log search results).
  - `density` (`"default"` | `"compact"`, default `"default"`) — rows 36 / 28 px, header 32 / 28 px, 12 px cell padding (L7, D1). One density per view; there is no `dense`, `compact` or `rowHeight`, and no user density setting exists yet. A page whose rows are taller or shorter (a two-line cell, the logs viewer's own row CSS) keeps its look: virtual scroll reads its estimate off a rendered row.
  - One frame (D8): `frame`, `bordered`, `toolbarBordered`, `paginationBordered` and `width` are gone; rows always carry dividers, the toolbar and footer always carry theirs, and the table fills its container. `striped` (default false)
  - The header is 12 px medium secondary text on the body's surface, no coloured band (D1); an actions column's header is labelled for screen readers only, and is an opaque pinned cell with the same left edge as its cells, so a column scrolled under it never shows its label above the row icons (D7).
  - `stickyHeader` (default `true`), `showHeader` (default `true`), `wrap` (default false), `horizontalScroll` (natural-width cells + horizontal scroll; pair with `wrap=false`)
  - `cellOverflowTooltip` (default `true`) — the shared full-text tooltip on cut body cells; pass `false` for a table whose reveal is Wrap / row expansion (logs, correlated logs). See [Cut cell text](#cut-cell-text--the-shared-tooltip)
  - `fillHeight` (default `true` — set false to shrink to content), `virtualScroll` (default false; the row estimate is the density's height, then a measured row), `maxHeight`
    - Empty state: fill-height tables let the empty state fill the available
      space; non-fill-height tables reserve a `min-h-75` floor so the empty
      state has presence. In a height-constrained card, keep `fillHeight`
      (default) so the empty state never forces a scrollbar.
  - **Row state (C3)** — `rowState: (row) => "exception" | "warn" | "paused" | "recent" | null`. `exception` draws the error rail and the error wash, `warn` the warning rail only, `paused` recedes (panel fill, secondary text), `recent` a soft info tint; a healthy row returns `null` and stays clean. Selection and the active row paint over the fill. A page that draws its own rail (`rowRailTone`, `getRowStyle`, `getRowStatusColor`) keeps it, and the state adds only its fill. `rowTone` is gone: `"muted"` is `rowState` `"paused"`. The calm-signal rules (rail for the state column, wash only for failed and paused) are unchanged — see [calm-signal](calm-signal.md).
  - **Row actions (B7)** — `rowActions: OTableRowAction[]` (at most two) and `rowMenu: OTableRowMenuItem[]`; full shapes under "Row actions" below. OTable appends a right-pinned actions column: xs ghost icon buttons shown on row hover and focus (always on touch, `pointer-coarse`), then ⋯ with the menu, destructive items last and red. Below md the inline actions fold into ⋯. Selectors: `o2-table-row-action-<id>`, `o2-table-row-menu`, `o2-table-row-menu-<id>`, or each item's `dataTest`. A hand-built `#cell-actions` still works; new lists use these props.
  - Row styling: `rowClass`, `rowRailTone`, `getRowStyle`, `getRowStatusColor` (4px left status bar for event severity), `getCellStyle`, `enableCellCopy`
  - **Cells (C4, D3, D4)** — a default-rendered empty value (null, undefined, blank) reads "—" in tertiary text; a column of plain numbers (no `align`, no `cell`, no slot) right-aligns with tabular figures, header included; `meta.identifier: true` renders a long id in mono, cut in the middle so its tail stays readable. A column `meta.format` keeps the say over its own blanks.
  - Highlight: `highlightText`, `highlightFields`

**`OTableColumnDef` shape:**

```ts
interface OTableColumnDef<TData = any> {
  id: string; // unique id (also default accessorKey)
  header: string | Component; // header text or render component
  accessorKey?: string; // key in the row object
  accessorFn?: (row: TData) => any; // custom accessor
  cell?: string | Component; // custom cell renderer
  size?: number;
  minSize?: number;
  maxSize?: number; // width hints (px → rem)
  sortable?: boolean;
  filterable?: boolean;
  resizable?: boolean;
  pinnable?: boolean;
  pinned?: "left" | "right" | false;
  hideable?: boolean;
  isAction?: boolean; // action col = compact, no data
  footer?: string | Component;
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  meta?: {
    align?: "left" | "center" | "right";
    headerClass?: string;
    cellClass?: string;
    isName?: boolean; // primary name column (weight 500)
    format?: (value: any, row: any) => any;
    cellOverflowTooltip?: boolean; // false = this column never shows the cut-cell tooltip (secret columns)
    actionCount?: number; // buttons a hand-written actions cell draws; OTable sets it on its own column
    link?: (row: any) => RouteLocationRaw | (() => void) | undefined; // name cell opens the item
    [key: string]: any;
  };
}
```

**Row actions (`rowActions` + `rowMenu`, B7).** OTable appends its own pinned
actions column, sized from the declared lists (inline count plus one for ⋯), the
same while loading and loaded; a page declares no "actions" column for it.

```ts
type OTableRowValue<T, TData> = T | ((row: TData) => T);
type OTableRowDataTest<TData> = string | ((row: TData, index: number) => string);

interface OTableRowAction<TData = any> {
  // at most two; xs ghost icon buttons, shown on row hover and focus
  id: string;
  icon: OTableRowValue<IconName, TData>;
  label: OTableRowValue<I18nText, TData>; // aria-label and tooltip
  onClick: (row: TData) => void;
  hidden?: (row: TData) => boolean;
  disabled?: (row: TData) => boolean;
  disabledReason?: (row: TData) => I18nText | undefined; // tooltip while disabled (B9)
  shortcut?: OTableRowValue<string, TData>; // data-row-action it answers; defaults to id
  loading?: (row: TData) => boolean | { label?: I18nText; dataTest?: string }; // spinner replaces the button
  badge?: (row: TData) => boolean | { label?: I18nText; dataTest?: string }; // dot on the button
  dataTest?: OTableRowDataTest<TData>; // default o2-table-row-action-<id>
}

interface OTableRowMenuItem<TData = any> {
  // the ⋯ menu; destructive items last, after a separator, in red
  id: string;
  label: OTableRowValue<I18nText, TData>;
  icon?: OTableRowValue<IconName, TData>;
  onSelect: (row: TData) => void;
  hidden?: (row: TData) => boolean;
  disabled?: (row: TData) => boolean;
  disabledReason?: (row: TData) => I18nText | undefined;
  destructive?: boolean;
  shortcut?: OTableRowValue<string, TData>;
  badge?: (row: TData, placement: "menu" | "more") => boolean | { label?: I18nText; dataTest?: string };
  dataTest?: OTableRowDataTest<TData>; // default o2-table-row-menu-<id>
}
```

- Two inline actions at most, chosen by frequency; delete and anything else
  destructive go in `rowMenu` with `destructive: true` and confirm. Below md the
  inline actions fold into ⋯ (their data-test gains `-menu`).
- **A two-state action is one entry** (Enable/Disable, Block/Unblock): `label`,
  `icon` and `shortcut` read the row. Inline buttons have no tone.
- **Shortcuts.** Each inline button carries `data-row-action="<shortcut>"`; a menu
  item keeps a hidden in-row proxy, so the row shortcuts reach it too.
- **`loading(row)`** swaps the button for a spinner (data-test `<dataTest>-spinner`
  unless the mark names one). **`badge`** draws a dot on the button, or on the
  menu item and (`"more"`) on ⋯; its `label` names the marked part. A row with a
  dot or a spinner shows its actions without hover. Use it for a kept unsaved copy.
- **Table props.** `row-menu-data-test` (string or `(row, index) => string`)
  names the ⋯ trigger (default `o2-table-row-menu`); a page that had
  `<x>-row-more-actions` passes it. `#row-actions="{ row, index }"` replaces the
  actions cell on the rows `:row-actions-slot="(row) => boolean"` names (every row
  without the prop), for example a "managed" tag on system rows.
- **Overflow.** The actions column stays pinned. When the columns cannot fit even
  at their `minSize` the table scrolls sideways under it, so nothing is out of
  reach. The scrollbar and the table's minimum width share one threshold, which
  counts an `autoWidth` filler at its `minSize`.

**Name link (`meta.link`).** The column renders `ONameLinkCell`
(`@/lib/core/Table/cells`): a `RouterLink` for a route, a button for a callback,
plain text when `link` returns `undefined`. Its data-test is
`<table data-test>-name-link`. A page that keeps a custom `#cell-name` slot puts
`<ONameLinkCell :to="…">{{ row.name }}</ONameLinkCell>` inside it.

**Server mode — check the backend BEFORE you write the column.** In
`sorting="server"` the table does not sort anything: it emits the column **id** as
the `sort` field and the backend does the work. OpenObserve's list endpoints match
that field against a fixed list and **fall through to a default on anything else**
(`stream_comparator`'s `_ => a.name.cmp(&b.name)` is typical) — no 400, no console
error, just rows quietly ordered by something else. Symptom: the header shows its
arrow, the rows re-order, and the order is wrong.

- Open the handler and read its sort match/allow-list. A column gets
  `sortable: true` **only if a key exists for it**; otherwise `sortable: false`
  plus a one-line comment naming the missing key. Never leave a control that
  silently lies.
- Name the column `id` after the backend key (`doc_time_max`, not `lastIngested`)
  so the mapping is obvious, or map it explicitly via `sortFieldMap`.
- **Derived columns can't be rescued client-side.** Under server pagination you
  hold one page of N rows, so sorting a computed ratio locally would just reorder
  that page. Either add the sort key to the backend or ship the column unsorted.
- Same reasoning for `filterMode="server"` and any `keyword`/facet param: if the
  endpoint ignores it, the UI shows an unfiltered list as if it were filtered.
- **The dev UI usually talks to a REMOTE backend**, not your working tree —
  `web/.env`'s `VITE_OPENOBSERVE_ENDPOINT` points at a shared dev deployment. A
  Rust change in your branch is not live there, so "the API ignores my new
  param" is expected until it deploys. Confirm which is which before debugging the
  frontend: check the request in DevTools (the param IS being sent), then check
  whether the endpoint you're hitting is local.

**Column hygiene** — mistakes that keep recurring:

- **No row-number column (D2).** Its numbers stop matching the rows the moment
  the table is sorted or filtered, and the first column is the entity's name.
  There is no `showIndex`, and `local/o2-table-api` rejects a column `id: "#"` and
  a `#cell-#` slot.
- **Hide conditional columns by id, not by position** — `columns.splice(2, 1)`
  silently removes the wrong column as soon as someone inserts one above it. Use
  `columns.filter((c) => c.id !== "region")`.
- **Size a column for its header plus the sort chevron.** The shared `COL.*`
  presets fit typical _values_, not long labels — `COL.sizeBytes` truncates
  "Compressed Size" to "Compressed Si…". Set an explicit `size` (+ `minSize` floor)
  when the header is longer than the numbers under it.
- **`persistColumns` persists widths as well as visibility**, keyed by `tableId`
  in localStorage. Once a user drags a column, later changes to that column's
  default `size` never reach them — test width changes in a fresh profile, and
  point users at the column menu's reset action.
- **One number per numeric cell.** Two values in one right-aligned cell means
  neither owns the column's edge and both look indented at random; give the second
  value its own column.

**Main emits:**

- Pagination: `update:currentPage`, `update:pageSize`, `pagination-change`
- Sorting: `update:sortBy`, `update:sortOrder`, `sort-change`
- Filter: `update:globalFilter`, `filter-change`
- Selection: `update:selectedIds`, `selection-change` (emits selected rows)
- Expansion: `update:expandedIds`
- Row: `row-click`, `row-dblclick`, `row-auxclick` (middle button), `row-mouseenter`, `row-mouseleave`, `cell-click`
- Columns: `column-order-change`, `column-visibility-change`, `update:columnSizes`
- Virtual scroll: `scroll`, `scroll-end`

**Always supply `#error` when `error` can be set.** Without the slot, OTable falls back to a solid red banner carrying the raw server string — a different failure look on every page. Use `<template #error="{ message }"><OEmptyState kind="error" :title="t('common.errorLoadingData')" :text="raw(message)" @action="onRefresh()" /></template>`, with Retry wired to the page's own refresh handler.

**Main slots:** `cell` (scoped `{ row, column, value, table }`), `top`, `toolbar` (inside the frame, above header), `toolbar-trailing`, `header-actions`, `selection-actions` (bulk-action buttons for the footer), `footer-note` (a footer line the pager cannot say), `pagination-bar` (a caller-drawn pager, scoped with pagination state/actions), `loading`, `loading-banner`, `empty`, `error` (`{ message }`), `expansion` (`{ row }`), `tree-warning` (`{ row }`)

#### Footer

**A footer is never hand-built.** Every paginated `OTable` draws the same 44 px
bar (D5, S8): the one pager, `OPagination` ("1–20 of 143", the page-size select
and previous / next, all at sm 28; first and last only past ten pages), on the end
edge, and on the start edge the first of these that applies — otherwise nothing:

1. **Rows selected** → the bar turns into the selection bar (D6): a selected
   tint, "3 selected", the `#selection-actions` buttons, then Clear. The range
   keeps the total, so the count never repeats it. Without a pager
   (`pagination="none"`) the bar still appears for a selection.
2. **`#footer-note` provided** → the note, in the bar's small secondary text, in
   the width left of the pager.

**No pager under an empty table (D5):** while the table shows its empty, denied
or error state and the total is 0, there is no bar at all. Neither start-side part
renders while the table is loading, and a `#pagination-bar` replaces the whole
bar. There is **no total label** — `footerTitle`, `#bottom` and
`customPaginationBar` are gone. The bar is `data-toast-avoid`, so toasts keep
clear of it.

- **`#selection-actions`** takes the bulk-action buttons and nothing else: no
  wrapper, no `v-if` on the selection length, no margin / height / padding
  classes. Every button is `size="sm"`, a destructive action comes last, and no
  label carries a count — the bar already prints it, once.
- **`#footer-note`** is for what the pager cannot say: a cap or truncation,
  partial data, "filtered x of y", a second figure, a conclusion. A line that only
  restates the row total is not a note — delete it. Put the `v-if` on the
  `<template>` so the note exists only in the states where it says more, and give
  it one root element; a root with `max-md:hidden` leaves no empty row on a phone.
- **`#pagination-bar`** (scope: `currentPage`, `pageSize`, `totalPages`,
  `totalRows`, `isFirstPage`, `isLastPage`, `setPageSize`, `goToPage`, `firstPage`,
  `prevPage`, `nextPage`, `lastPage`) replaces the built-in bar with a band the
  caller draws, and still renders with `pagination="none"`: a totals row
  (billing usage) or a dashboard panel's footer, which renders `OPagination` from
  the scope. A list page never needs it, and it never holds a hand-built pager.

The slot content adds no padding, height or typography: the bar owns all three.
Below md the count and actions take a full row above the pager and a note takes
its own row. `local/o2-table-api` (ESLint, error in `lint:ci`) rejects every
removed prop (`show-index`, `show-global-filter`, `frame`, `bordered`,
`toolbar-bordered`, `pagination-bordered`, `width`, `dense`, `compact`,
`row-height`, `row-tone`, `show-footer`), a density other than default or
compact, more than two literal `row-actions`, a `#` column and any pager other
than `OPagination`. `OTable.callSites.spec.ts` also scans every SFC (vue-tsc skips
`// @ts-nocheck` files) for the removed footer API and for a `#footer-note` on a
table without a pager.

#### OPagination — the one pager

**Import:** `@/lib/navigation/Pagination/OPagination.vue`. OTable's footer renders
it; use it directly only for a list that is not an `OTable` (a drawer's event list,
the logs and traces explorers' result headers, the field list).

- `page` (`v-model:page`, 1-based) · `pageSize` (`v-model:page-size`) · `pageSizes`
  (number[], default none — the select only renders with choices; no "All")
- `total` (rows) → "1–20 of 143"; `totalExact: false` → "1–20 of many" and no Last
  page; without `total`, `pageCount` → "Page 4 of 31"
- `loading` — paging is busy or locked: buttons stay focusable but ignore input
  (tooltip `disabledReason`, default "Loading"), an open size menu closes
- `#range` slot replaces the range (a skeleton, or nothing where the page states it)
- Parts are `<root data-test>-range | -size | -first | -prev | -next | -last`, or
  `testIds` to keep existing selectors. Every control is sm 28 (S8); first and last
  appear only past ten pages. Never build a pager from buttons and a select.

**Exposed (template ref):** `table` (TanStack instance), `toggleAllRows`, `clearSelection`, `resetColumnSizes`, `resetColumnOrder`, `resetPersistedColumns`, `scrollToTop`, `getRows`

**Example:**

```vue
<script setup lang="ts">
import { ref } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { OTimeCell, OUserCell } from "@/lib/core/Table/cells";
import type {
  OTableColumnDef,
  OTableRowAction,
  OTableRowMenuItem,
} from "@/lib/core/Table/OTable.types";

const rows = ref([/* ... */]);
const selectedIds = ref<string[]>([]);
const search = ref("");

const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    sortable: true,
    meta: { isName: true },
  },
  { id: "owner", header: "Owner", accessorKey: "owner", cell: OUserCell },
  {
    id: "createdAt",
    header: "Created",
    accessorKey: "created_at",
    cell: OTimeCell,
    size: 200,
  },
];

const rowActions: OTableRowAction<Row>[] = [
  { id: "edit", icon: "edit", label: t("common.edit"), onClick: edit },
];
const rowMenu: OTableRowMenuItem<Row>[] = [
  { id: "duplicate", label: t("common.duplicate"), onSelect: duplicate },
  { id: "delete", label: t("common.delete"), destructive: true, onSelect: confirmDelete },
];
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    selection="multiple"
    v-model:selected-ids="selectedIds"
    :global-filter="search"
    :row-state="(row) => (row.failed ? 'exception' : row.paused ? 'paused' : null)"
    :row-actions="rowActions"
    :row-menu="rowMenu"
    @row-click="openRow"
  >
    <template #toolbar>
      <OSearchInput v-model="search" width="list" data-test="things-search" />
    </template>

    <!-- The footer turns into "N selected · these buttons · Clear" while rows are selected. -->
    <template #selection-actions>
      <OButton variant="secondary" size="sm" icon="download" @click="exportSelected">
        {{ t("common.export") }}
      </OButton>
      <OButton variant="danger-ghost" size="sm" icon="delete" @click="deleteSelected">
        {{ t("common.delete") }}
      </OButton>
    </template>
  </OTable>
</template>
```

**Column widths and headers that read.**

- **Size the column the reader came for.** Unsized columns share the leftover
  evenly, so a statement column got ~175px of a 1,180px table and truncated every
  query while When / Took / Status sat half empty. Give the primary column an
  explicit `size` (Top queries 520, Deadlocks 560, Slowest calls 480) with a
  one-line comment saying why.
- **A header names its column, nothing more.** Qualifiers ("(est.)", "(lifetime)")
  are what the ellipsis eats first; put the explanation in `meta.headerTooltip`.
  The tooltip anchors to the whole header cell, so it costs no width and no icon.
- **An empty table has no pager (D5).** OTable drops the footer itself while it
  shows its empty state, so "All clear" is never followed by "0 of 0".

**Family:** cell renderers (below); `OTable.types.ts` exports `OTableColumnDef`, the mode/param types, and `COL`/`TABLE_*` size constants. `sub-components/` is internal.

---

### OTable cell renderers

Prebuilt cell components — pass as a column's `cell`. Import individually or from the barrel `@/lib/core/Table/cells`.

- **OTimeCell** (`@/lib/core/Table/cells/OTimeCell.vue`) — the one timestamp renderer: relative ("2m ago") by default, `mode="absolute"` / `"date"` for full datetime; `unit` interprets numeric values (`auto`/`iso`/`s`/`ms`/`us`/`ns`); muted `empty-label` for zero/empty.
- **OUserCell** (`@/lib/core/Table/cells/OUserCell.vue`) — person/owner/created-by column; renders email or explicit `name` as cut plain text (full identity on hover when cut), dash when empty.
- **ONumberCell** (`@/lib/core/Table/cells/ONumberCell.vue`) — consistent numeric rendering (tabular-nums); `format` = `number`/`compact`/`bytesFromMB`/`durationSec`/`durationMs`/`durationUs`/`durationNs`/`percent`. Pair the column with `meta.align: "right"`.
- **OCodeCell** (`@/lib/core/Table/cells/OCodeCell.vue`) — monospace identifiers / SQL / tokens, cut with "…" (full value on hover only when cut) and optional hover copy button (`copy`, default true). **`:tooltip="false"` for secrets** (tokens, credentials) — it also keeps the table's own tooltip off that cell.
- **ODataBarCell** (`@/lib/core/Table/cells/ODataBarCell.vue`) — value with a proportional background bar (width = value/`max`, caller supplies the column max and pre-formatted `display`); `variant` `default`/`warning`/`danger` for threshold columns. ⚠️ **Client-paginated tables only:** the caller can only compute `max` over the rows it holds, so on a server-paginated table the bar means "biggest on this page" — the scale shifts as you page and the same row draws a different bar. There, drop the bars and let sortable numbers rank the rows.

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
      <OButton variant="ghost" icon-only size="xs" icon="edit" :label="t('common.edit')" @click="edit(row)" />
      <OButton variant="danger-ghost" icon-only size="xs" icon="delete" :label="t('common.delete')" @click="remove(row)" />
    </div>
  </template>
</OTable>
```

**Important:** Access row data directly (`row.enabled`, `row.status`, `row.id`), not via `row.original`. The `row` object _is_ the data record with all properties accessible.

### Cut cell text — the shared tooltip

`OTable` shows **one shared tooltip per table**: when the mouse rests 0.7 s on a body cell whose text is cut with "…", it shows the full text. Cells that fit show nothing. It is measured only on hover, so cells carry no per-cell cost. **Plain cell text and simple `#cell-*` slots need nothing** — don't add `truncate`, a `title` or an `OTooltip` for this.

**Switch it off where it must not show:**

| Case | Do this |
|---|---|
| A column holds secrets (token, API key, webhook / signed URL, credential) | column `meta: { cellOverflowTooltip: false }` |
| The whole table has its own reveal — a Wrap toggle or row expansion (logs, correlated logs, span events) | `<OTable :cell-overflow-tooltip="false">` |
| One element inside a slot must stay silent | `<OTruncatedText :tooltip="false">` / `<OCodeCell :tooltip="false">` — they mark the element so the table skips it |

A plain `<span class="truncate">` in a cell is **not** an opt-out — the table still shows its full text on hover.

**It steps aside on its own** when the cut element (or a parent/child in the cell) already has its own tooltip that will show — an `OTruncatedText`, an `OTooltip`, a native `title` — so there are never two bubbles. It opens on the side away from a `#cell-hover-actions` toolbar.

**Cells with several parts** (a row of tags, label pairs, a value plus a delta badge): the shared tooltip reads the cell's raw text, which has no separators — three tags `Trace 0` `Annotation 0` `Manual 1` read as `trace0annotation0manual1`. Give such a cell its own tooltip text:

```vue
<!-- a list of tags: one tooltip with commas -->
<template #cell-tags="{ row }">
  <OTruncatedText
    as="div"
    class="flex flex-nowrap items-center gap-1"
    :tooltip="raw(row.tags.join(', '))"
  >
    <OTag v-for="tag in row.tags" :key="tag" class="shrink-0">{{ tag }}</OTag>
  </OTruncatedText>
</template>

<!-- one long text + a small badge: cut the text only, keep the badge visible -->
<template #cell-name="{ row }">
  <div class="flex min-w-0 items-center">
    <OTruncatedText>{{ row.name }}</OTruncatedText>
    <OTag v-if="row.isPng" type="reportTag" value="png" class="ms-1 shrink-0" />
  </div>
</template>
```

Tables that never cut (`wrap`, or `horizontal-scroll` with content-sized columns) never show it, so they need no opt-out.
