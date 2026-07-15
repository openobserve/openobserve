# Overlay & Navigation

O2 overlay primitives (Dialog, Drawer, Dropdown, Popover, Tooltip) and navigation primitives (Pagination, Stepper, Tabs). The overlay primitives are headless-first wrappers over reka-ui; the navigation primitives (Pagination, Stepper) are custom implementations (Tabs uses only reka-ui's `Primitive`). All carry design-system tokens — pick by intent, not by looks.

## Table of contents

- [Overlay decision guide](#overlay-decision-guide)
- Overlay
  - [ODialog](#odialog)
  - [ODrawer](#odrawer)
  - [ODropdown](#odropdown) · [ODropdownItem](#odropdownitem) · [ODropdownGroup](#odropdowngroup) · [ODropdownSeparator](#odropdownseparator)
  - [OPopover](#opopover)
  - [OTooltip](#otooltip)
- Navigation
  - [OPagination](#opagination)
  - [OStepper](#ostepper) · [OStep](#ostep)
  - [OTabs](#otabs) · [OTab](#otab) · [ORouteTab](#oroutetab) · [OTabPanels](#otabpanels) · [OTabPanel](#otabpanel)

---

## Overlay decision guide

| If you need… | Use | Not |
|---|---|---|
| A hover/focus hint describing an element (no interaction inside) | **OTooltip** | Popover — a tooltip is dismissable-free and passive |
| A menu of **actions** (Edit, Duplicate, Delete) triggered by a button | **ODropdown** + items | Popover — dropdown gives menu semantics (arrow-key nav, typeahead, `role="menu"`) |
| **Freeform** floating content (filter form, color picker, mini info card) | **OPopover** | Dropdown — popover keeps normal Tab order and frees arrow keys for the content |
| A focused **modal task** centred on screen (create/edit form, confirm) | **ODialog** | Drawer — dialog is for short, self-contained tasks |
| A **side panel** task (details inspector, long form, contextual editor) | **ODrawer** | Dialog — drawer slides from an edge and can stay `seamless` (page still usable) |

Rule of thumb: **Tooltip = hint, Dropdown = action menu, Popover = anything freeform, Dialog/Drawer = modal task.** Dialog and Drawer share the exact same surface, header/footer, built-in footer buttons, and `formId` auto-loading — choose by placement (center vs edge), not capability.

---

## Overlay

### ODialog
**Import:** `@/lib/overlay/Dialog/ODialog.vue`
**Use when:** A user must complete a short, self-contained task without leaving the page — create/edit forms, confirmations, focused settings.
**Don't use for:** Long or contextual side-panel work (use **ODrawer**); a menu of actions (use **ODropdown**); a passive hint (use **OTooltip**).
**Key props:**
- `open` (boolean — controlled, use `v-model:open`)
- `size` (`"xs"|"sm"|"md"|"lg"|"xl"|"full"` — default `"md"`; xs=320px, sm=480px, md=640px, lg=800px, xl=1024px, full=screen)
- `width` (number 1–100 → `vw`; overrides `size` width entirely)
- `maxHeight` (number 1–100 → `vh`; default 90vh)
- `persistent` (boolean — default `false`; blocks Escape/overlay-click close)
- `title` (string — ignored when `#header` slot used), `subTitle` (string)
- `showClose` (boolean — default `true`; only when not `persistent`)
- `formId` (string — makes the primary button `type="submit"` for that form id; enables Enter-to-submit AND auto-loading spinner when a nested OForm is submitting)
- Built-in footer buttons: `primaryButtonLabel` / `secondaryButtonLabel` / `neutralButtonLabel` (omit a label to hide that button; neutral sits left, secondary+primary right)
- Variants: `primaryButtonVariant` (default `"primary"`), `secondaryButtonVariant` (default `"outline"`), `neutralButtonVariant` (default `"ghost"`)
- Per-button `…ButtonDisabled` / `…ButtonLoading` (any loading auto-disables all)

**Slots:** `trigger`, `header` (full override — ignores `title`/sub-slots), `header-left`, `header-right`, `default` (body), `footer` (override — replaces built-in buttons)
**Emits:** `update:open` (boolean), `click:primary`, `click:secondary`, `click:neutral` (`click:primary` does NOT fire when `formId` is set — the form's submit handles it)
**Example:** form-in-dialog using built-in footer + `formId`

```vue
<ODialog
  v-model:open="isOpen"
  title="Create stream"
  size="md"
  form-id="create-stream-form"
  primary-button-label="Create"
  neutral-button-label="Cancel"
  @click:neutral="isOpen = false"
>
  <OForm id="create-stream-form" @submit="handleSubmit">
    <OInput v-model="name" label="Stream name" />
    <OSelect v-model="type" :options="typeOptions" label="Type" />
  </OForm>
</ODialog>
```

**Family:** ODrawer (same surface, edge-anchored).

---

### ODrawer
**Import:** `@/lib/overlay/Drawer/ODrawer.vue`
**Use when:** A contextual or longer task belongs in a panel sliding from a viewport edge — details inspectors, long forms, side editors. Can stay `seamless` so the page underneath remains interactive.
**Don't use for:** A short centred task or confirmation (use **ODialog**); a compact action menu (use **ODropdown**).
**Key props:** (superset of ODialog — same header/footer/formId/built-in buttons) plus:
- `side` (`"right"|"left"` — default `"right"`)
- `size` (`"sm"|"md"|"lg"|"xl"|"full"` — default `"md"`; sm=360px, md=480px, lg=640px, xl=800px, full=100vw)
- `width` (number 1–100 → `vw`, or `%` when `portalTarget` set; overrides `size`)
- `seamless` (boolean — default `false`; hides the backdrop so the page stays interactive)
- `lazy` (boolean — default `true`; body slot mounts on open and is destroyed on close — set `false` to preserve child state across open/close)
- `portalTarget` (string selector | HTMLElement | null — scope the drawer to a container with `position:absolute`; the target needs `position:relative; overflow:hidden`)
- Shared with ODialog: `open`, `persistent`, `title`, `subTitle`, `showClose`, `formId`, all `…ButtonLabel`/`…ButtonVariant`/`…ButtonDisabled`/`…ButtonLoading`

**Slots:** `trigger`, `header`, `header-left`, `header-right`, `default`, `footer` (identical to ODialog)
**Emits:** `update:open` (boolean), `click:primary`, `click:secondary`, `click:neutral`
**Example:** form-in-drawer with `formId` + auto-loading

```vue
<ODrawer
  v-model:open="showEdit"
  side="right"
  size="lg"
  title="Edit alert"
  form-id="edit-alert-form"
  primary-button-label="Save"
  secondary-button-label="Cancel"
  @click:secondary="showEdit = false"
>
  <OForm id="edit-alert-form" @submit="save">
    <OInput v-model="alert.name" label="Name" />
    <OTextarea v-model="alert.query" label="Query" />
  </OForm>
</ODrawer>
```

**Family:** ODialog (same surface, centred).

---

### ODropdown
**Import:** `@/lib/overlay/Dropdown/ODropdown.vue`
**Use when:** A trigger (icon button, "•••", "Actions") opens a menu of discrete actions. Gives full menu semantics — arrow-key navigation, typeahead, `role="menu"`.
**Don't use for:** Freeform content like forms or pickers (use **OPopover**); a persistent tab strip (use **OTabs**).
**Key props:** `open` (boolean, `v-model:open`) · `modal` (boolean — default `false`) · `side` (`"top"|"right"|"bottom"|"left"` — default `"bottom"`) · `align` (`"start"|"center"|"end"` — default `"start"`) · `sideOffset` (number — default `4`) · `contentClass` (string) · `persistent` (`boolean | number` — default `false`; `true`=never close on outside click, `N`=require N outside clicks, useful for nested OSelect: `:persistent="2"`)
**Slots:** `trigger` (as-child), `default` (ODropdownItem / ODropdownGroup / ODropdownSeparator children)
**Emits:** `update:open` (boolean)
**Example:**

```vue
<ODropdown>
  <template #trigger>
    <OButton variant="ghost" icon="more-vertical" aria-label="Actions" />
  </template>
  <ODropdownItem icon-left="pencil" @select="edit">Edit</ODropdownItem>
  <ODropdownItem icon-left="copy" shortcut="⌘D" @select="duplicate">Duplicate</ODropdownItem>
  <ODropdownSeparator />
  <ODropdownItem variant="destructive" icon-left="trash" @select="remove">Delete</ODropdownItem>
</ODropdown>
```

**Family:** ODropdownItem, ODropdownGroup, ODropdownSeparator (ship together).

---

### ODropdownItem
**Import:** `@/lib/overlay/Dropdown/ODropdownItem.vue`
**Use when:** A single selectable action row inside an ODropdown.
**Don't use for:** A section heading (use **ODropdownGroup**'s `label`); a visual divider (use **ODropdownSeparator**).
**Key props:** `variant` (`"default"|"destructive"` — destructive for Delete/Remove) · `disabled` (boolean) · `textValue` (string — typeahead override) · `iconLeft` (IconName) · `shortcut` (`string | string[]` — keycap hint, e.g. `"⌘I"` or `["⌘","I"]`) · `shortcutId` (string — resolves keys from the shortcut registry; prefer over `shortcut`)
**Slots:** `icon-left`, `default` (label), `icon-right`
**Emits:** `select` (Event)
**Example:**

```vue
<ODropdownItem icon-left="download" shortcut-id="export.csv" @select="exportCsv">
  Export CSV
</ODropdownItem>
```

**Family:** ODropdown, ODropdownGroup, ODropdownSeparator.

---

### ODropdownGroup
**Import:** `@/lib/overlay/Dropdown/ODropdownGroup.vue`
**Use when:** Grouping related items under an optional label inside an ODropdown.
**Don't use for:** A plain divider without a heading (use **ODropdownSeparator**).
**Key props:** `label` (string — optional visible group label)
**Slots:** `default` (items), `label-action` (right-aligned action beside the label)
**Emits:** none
**Example:**

```vue
<ODropdownGroup label="Export">
  <ODropdownItem icon-left="file-json" @select="exportJson">JSON</ODropdownItem>
  <ODropdownItem icon-left="file-text" @select="exportCsv">CSV</ODropdownItem>
</ODropdownGroup>
```

**Family:** ODropdown, ODropdownItem, ODropdownSeparator.

---

### ODropdownSeparator
**Import:** `@/lib/overlay/Dropdown/ODropdownSeparator.vue`
**Use when:** A thin visual divider between groups of dropdown items.
**Don't use for:** A labelled section (use **ODropdownGroup**).
**Key props:** none
**Slots:** none (purely visual)
**Emits:** none
**Example:**

```vue
<ODropdownSeparator />
```

**Family:** ODropdown, ODropdownItem, ODropdownGroup.

---

### OPopover
**Import:** `@/lib/overlay/Popover/OPopover.vue`
**Use when:** Floating content that isn't a list of actions — filter forms, pickers, info cards, mini editors. Keeps normal Tab order; arrow keys belong to the content. Non-modal by default. Descendant overlays (OSelect / OCombobox / nested dropdowns) opened inside won't dismiss it.
**Don't use for:** A menu of actions (use **ODropdown** for menu semantics); a passive text hint (use **OTooltip**); a large modal task (use **ODialog**/**ODrawer**).
**Key props:** `open` (boolean, `v-model:open`) · `modal` (boolean — default `false`; traps focus + blocks outside pointer events) · `side` (`"top"|"right"|"bottom"|"left"` — default `"bottom"`) · `align` (`"start"|"center"|"end"` — default `"start"`) · `sideOffset` (number — default `4`) · `hideWhenDetached` (boolean — default `true`; hide when trigger scrolls out of view) · `ariaLabel` (string) · `zIndex` (number — default `6000`) · `contentClass` (string)
**Slots:** `trigger` (as-child), `default` (content)
**Emits:** `update:open` (boolean)
**Example:**

```vue
<OPopover align="end">
  <template #trigger>
    <OButton variant="outline" icon="filter">Filters</OButton>
  </template>
  <div class="flex flex-col gap-2 p-3">
    <OSelect v-model="status" :options="statusOptions" label="Status" />
    <OInput v-model="search" label="Contains" />
  </div>
</OPopover>
```

**Family:** ODropdown (menu sibling — shares overlay coordination).

---

### OTooltip
**Import:** `@/lib/overlay/Tooltip/OTooltip.vue`
**Use when:** A passive hover/focus hint describing an element — icon-button labels, truncated text, disabled-state explanations. Two modes: **wrapper** (default slot wraps the trigger) or **child** (no default slot — attaches to its parent element like `q-tooltip`).
**Don't use for:** Anything the user interacts with inside the bubble (use **OPopover**); an action menu (use **ODropdown**).
**Key props:** `content` (string — plain-text shorthand for `#content`) · `side` (`"top"|"right"|"bottom"|"left"` — default `"top"`) · `align` (`"start"|"center"|"end"` — default `"center"`) · `sideOffset` (number — default `4`) · `alignOffset` (number — default `0`) · `delay` (number ms — default `700`) · `maxWidth` (string — default `"320px"`) · `disabled` (boolean) · `open` (boolean — controlled) · `contentClass` (string) · `shortcut` (`string | string[]`) · `shortcutId` (string — prefer over `shortcut`)
**Slots:** `default` (trigger — single focusable element; omit for child mode), `content` (rich content, overrides `content` prop)
**Emits:** none
**Example:**

```vue
<!-- wrapper mode -->
<OTooltip content="Refresh results" shortcut-id="query.run">
  <OButton variant="ghost" icon="refresh-cw" aria-label="Refresh" />
</OTooltip>

<!-- child mode: attaches to the parent element, no default slot -->
<button>
  Save
  <OTooltip content="Saves without closing" />
</button>
```

**Family:** standalone.

---

## Navigation

### OPagination
**Import:** `@/lib/navigation/Pagination/OPagination.vue`
**Use when:** Navigating a paged list/table — a centred window of page-number buttons with prev/next.
**Don't use for:** Switching between content sections (use **OTabs**); a linear multi-step flow (use **OStepper**).
**Key props:** `modelValue` (number — 1-based active page, `v-model`) · `max` (number — total pages) · `disable` (boolean) · `maxPages` (number — max page buttons shown at once, window centred on current page; default `5`)
**Slots:** none
**Emits:** `update:modelValue` (number)
**Example:**

```vue
<OPagination v-model="page" :max="totalPages" :max-pages="7" />
```

**Family:** standalone.

---

### OStepper
**Import:** `@/lib/navigation/Stepper/OStepper.vue`
**Use when:** A guided linear flow across multiple steps — a wizard, or (with `expanded`) a progress checklist/timeline. Root container owns the active-step state and only the active step's panel shows by default.
**Don't use for:** Peer content sections switched in any order (use **OTabs**); paging a list (use **OPagination**).
**Key props:** `modelValue` (number — active step, required, `v-model`) · `orientation` (`"horizontal"|"vertical"` — default `"horizontal"`) · `animated` (boolean — default `true`) · `navigable` (boolean — default `false`; allow clicking completed headers to go back) · `expanded` (boolean — default `false`; render ALL step panels at once as a checklist/timeline)
**Slots:** `default` (OStep children)
**Emits:** `update:modelValue` (number), `change` (number)
**Example:**

```vue
<OStepper v-model="currentStep" navigable>
  <OStep :name="1" title="Source" :done="currentStep > 1">
    <SourcePicker />
  </OStep>
  <OStep :name="2" title="Transform" :done="currentStep > 2">
    <TransformConfig />
  </OStep>
  <OStep :name="3" title="Review">
    <ReviewSummary />
  </OStep>
</OStepper>
```

**Family:** OStep (required children).

---

### OStep
**Import:** `@/lib/navigation/Stepper/OStep.vue`
**Use when:** One step within an OStepper — registers itself and renders its content when active.
**Don't use for:** Standalone use — must be a child of OStepper.
**Key props:** `name` (number — unique, matched against OStepper `v-model`, required) · `title` (string, required) · `icon` (IconName | Lucide Component | null — replaced by a checkmark when `done`) · `done` (boolean — default `false`; typically `:done="currentStep > N"`) · `navigable` (boolean — per-step override; inherits OStepper when undefined) · `description` (string — subtitle under the title) · `error` (boolean — default `false`; error state on the indicator)
**Slots:** `default` (step content, shown only when active), `title-suffix` (inline content next to the title — vertical orientation only)
**Emits:** none
**Example:**

```vue
<OStep :name="2" title="Transform" description="Optional" :done="step > 2" :error="hasError">
  <TransformConfig />
</OStep>
```

**Family:** OStepper (required parent).

---

### OTabs
**Import:** `@/lib/navigation/Tabs/OTabs.vue`
**Use when:** The tab-bar container for switching between peer content sections. Owns the active-tab state; pair with OTabPanels/OTabPanel for the content area.
**Don't use for:** A linear wizard (use **OStepper**); route-per-tab navigation without a shared panel area — use **ORouteTab** children instead of OTab.
**Key props:** `modelValue` (`string | number` — active tab, required, `v-model`) · `orientation` (`"horizontal"|"vertical"` — default `"horizontal"`) · `align` (`"left"|"center"|"right"|"justify"` — default `"left"`) · `dense` (boolean — compact ~32px height) · `bordered` (boolean — default `false`; bottom border) · `reorderable` (boolean — default `false`; drag-to-reorder — OTabs only reports the intended move, the parent owns the order)
**Slots:** `default` (OTab / ORouteTab children)
**Emits:** `update:modelValue` (`string|number`), `change` (`string|number`), `reorder` (`{ from, to, before }` — parent applies the move)
**Example:** see OTabPanel below for the full OTabs + OTab + OTabPanels + OTabPanel pattern.
**Family:** OTab, ORouteTab, OTabPanels, OTabPanel.

---

### OTab
**Import:** `@/lib/navigation/Tabs/OTab.vue`
**Use when:** A single **content-switching** tab trigger inside OTabs — clicking it just changes the active tab (via OTabs' `v-model`), no routing.
**Don't use for:** A tab that should navigate to a route (use **ORouteTab**).
**Key props:** `name` (`string | number` — unique, must match the OTabPanel `name`, required) · `label` (string) · `icon` (string — Material icon name) · `disable` (boolean) · `tooltip` (string — hover hint, useful to explain a disabled tab)
**Slots:** `default` (custom trigger content — replaces default icon+label; used for badges/close icons), `icon` (custom icon area — overrides `icon` prop)
**Emits:** none (activation flows through the OTabs context)
**Example:**

```vue
<OTab name="logs" label="Logs" icon="list" />
```

**Family:** OTabs, ORouteTab, OTabPanels, OTabPanel.

---

### ORouteTab
**Import:** `@/lib/navigation/Tabs/ORouteTab.vue`
**Use when:** A tab that is **route-driven** — clicking navigates via Vue Router (`to`), and the active tab auto-syncs when the route matches `name`. Use for URL-addressable sections (deep links, back-button support).
**Don't use for:** In-place content switching with no URL change (use **OTab**).
**Key props:** `name` (`string | number` — must match OTabs `v-model`; also matched against `route.name`, required) · `label` (string) · `icon` (string — Material icon) · `to` (RouteLocationRaw — pushed on click) · `disable` (boolean — default `false`)
**Slots:** `default` (custom tab content — badges, icons)
**Emits:** none (navigates internally via `router.push`)
**Example:**

```vue
<OTabs v-model="activeTab">
  <ORouteTab name="alerts" label="Alerts" :to="{ name: 'alerts' }" />
  <ORouteTab name="destinations" label="Destinations" :to="{ name: 'destinations' }" />
</OTabs>
```

**Family:** OTabs, OTab, OTabPanels, OTabPanel.

---

### OTabPanels
**Import:** `@/lib/navigation/Tabs/OTabPanels.vue`
**Use when:** The container that shows the correct OTabPanel for the active tab. Keep its `modelValue` in sync with OTabs' `v-model`.
**Don't use for:** The tab strip itself (use **OTabs**).
**Key props:** `modelValue` (`string | number` — active tab, keep synced with OTabs) · `animated` (boolean — CSS slide transition between panels) · `keepAlive` (boolean — keep all panel DOM alive when switching, avoids remounting) · `grow` (boolean — default `false`; adds `flex-1` to fill a flex parent) · `scroll` (`"none"|"auto"|"y"` — default `"none"`)
**Slots:** `default` (OTabPanel children)
**Emits:** `update:modelValue` (`string|number`)
**Example:** see OTabPanel below.
**Family:** OTabs, OTab, ORouteTab, OTabPanel.

---

### OTabPanel
**Import:** `@/lib/navigation/Tabs/OTabPanel.vue`
**Use when:** The content area for one tab, shown when its `name` matches the active tab.
**Don't use for:** Standalone use — must be a child of OTabPanels.
**Key props:** `name` (`string | number` — must match the OTab `name`, required) · `padding` (`"none"|"sm"|"md"` — default `"none"`) · `layout` (`"block"|"flex-col"|"flex-row"` — default `"block"`) · `stretch` (boolean — default `false`; panel root fills 100% parent height)
**Slots:** `default` (panel content)
**Emits:** none
**Example:** full OTabs + OTab + OTabPanels + OTabPanel pattern

```vue
<script setup lang="ts">
import { ref } from 'vue'
const activeTab = ref('logs')
</script>

<template>
  <OTabs v-model="activeTab" bordered>
    <OTab name="logs" label="Logs" icon="list" />
    <OTab name="metrics" label="Metrics" icon="activity" />
  </OTabs>

  <OTabPanels v-model="activeTab" keep-alive grow>
    <OTabPanel name="logs" padding="md">
      <LogsView />
    </OTabPanel>
    <OTabPanel name="metrics" padding="md" layout="flex-col">
      <MetricsView />
    </OTabPanel>
  </OTabPanels>
</template>
```

**Family:** OTabs, OTab, ORouteTab, OTabPanels.
