# Quasar `q-menu` → O2 `ODropdown` Migration Guide

> Covers: `q-menu`  
> Source data from: `web/.claude/agents/quasar-menu-audit.md` (~36 instances across 23 files)

---

## Status Overview

| Quasar Component | O2 Replacement                                                          | O2 Location                     | Template Usages | CSS References | O2 Status |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------- | --------------- | -------------- | --------- |
| `q-menu`         | `ODropdown` + `ODropdownItem` + `ODropdownGroup` + `ODropdownSeparator` | `web/src/lib/overlay/Dropdown/` | ~36             | ~14 files      | ✅ Built  |

> All O2 Dropdown components live in `web/src/lib/overlay/Dropdown/`.

---

## The Critical Structural Change

Before any prop mapping, understand the structural difference — every migration requires a template restructure.

### Quasar — implicit trigger (menu is a child of the trigger)

```vue
<q-btn label="Actions">
  <q-menu anchor="bottom left" self="top left">
    <q-list>
      <q-item clickable v-close-popup @click="doSomething">
        <q-item-section>Action</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
</q-btn>
```

### O2 — explicit `#trigger` slot (trigger and content are separated)

```vue
<ODropdown side="bottom" align="start">
  <template #trigger>
    <OButton>Actions</OButton>
  </template>
  <ODropdownItem @select="doSomething">Action</ODropdownItem>
</ODropdown>
```

**Key rule:** Extract the parent element (the Quasar trigger) into `<template #trigger>`. The content of `<q-menu>` becomes the default slot.

---

## `q-menu` → `ODropdown` Prop Mapping

### Position: `anchor` + `self` → `side` + `align`

Quasar uses two opposing position strings to describe the attachment point. ODropdown uses `side` (which face to open on) and `align` (alignment along the perpendicular axis).

| Quasar `anchor`                   | Quasar `self`           | ODropdown `side`   | ODropdown `align` |
| --------------------------------- | ----------------------- | ------------------ | ----------------- |
| `bottom left`                     | `top left`              | `bottom`           | `start`           |
| `bottom start`                    | `top start`             | `bottom`           | `start`           |
| `bottom middle`                   | `top middle`            | `bottom`           | `center`          |
| `bottom right`                    | `top right`             | `bottom`           | `end`             |
| `bottom end`                      | `top end`               | `bottom`           | `end`             |
| `top left`                        | `bottom left`           | `top`              | `start`           |
| `top middle`                      | `bottom middle`         | `top`              | `center`          |
| `top right`                       | `bottom right`          | `top`              | `end`             |
| `center right`                    | `center left`           | `right`            | `center`          |
| `center left`                     | `center right`          | `left`             | `center`          |
| `top end` / `top start` (unusual) | `top start` / `top end` | `right`            | `start`           |
| (no anchor/self)                  | (no anchor/self)        | `bottom` (default) | `start` (default) |

> **Defaults**: ODropdown defaults to `side="bottom" align="start"` and `sideOffset=4`. If the Quasar usage has no `anchor`/`self` props (e.g. `<q-menu>` with no positioning), the defaults apply and no props need to be set.

### All Props

| Quasar prop                           | ODropdown prop                 | Action                                                                                                                                                    |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor` + `self`                     | `side` + `align`               | Convert using the table above                                                                                                                             |
| `v-model`                             | `v-model:open`                 | Rename — `v-model` → `v-model:open`                                                                                                                       |
| `:offset="[x, y]"`                    | `:side-offset="y"`             | Only the **side-axis** scalar is supported. The cross-axis (`x`) has no equivalent — remove it if it's zero, or apply a CSS margin to the content wrapper |
| `fit`                                 | —                              | **Drop** — use `class="tw:min-w-[var(--radix-dropdown-menu-trigger-width)]"` on the content wrapper div if you need trigger-width matching                |
| `content-style="..."`                 | class/style on content `<div>` | Move inline styles to a wrapper `<div>` inside the default slot                                                                                           |
| `content-class="..."`                 | class on content `<div>`       | Move class to a wrapper `<div>` inside the default slot                                                                                                   |
| `class` / `:class`                    | —                              | **Drop from `<ODropdown>` itself** — add the class to a wrapper `<div>` inside the default slot                                                           |
| `id`                                  | —                              | **Drop** — not needed after migration                                                                                                                     |
| `no-route-dismiss`                    | —                              | **Drop** — ODropdown is router-agnostic                                                                                                                   |
| `transition-show` / `transition-hide` | —                              | **Drop** — ODropdown has its own built-in animation via Tailwind `data-[state]` attributes                                                                |
| `modal`                               | `modal`                        | Direct — rare; used when the dropdown should block background interaction                                                                                 |

### Events

| Quasar event   | ODropdown event | Action                                                              |
| -------------- | --------------- | ------------------------------------------------------------------- |
| `@show`        | `@update:open`  | Adapt: `@update:open="(v) => v && yourHandler()"`                   |
| `@hide`        | `@update:open`  | Adapt: `@update:open="(v) => !v && yourHandler()"`                  |
| `@before-show` | —               | **Drop** — no equivalent; use `@update:open` + `nextTick` if needed |
| `@before-hide` | —               | **Drop** — no equivalent                                            |

---

## Item Migration: `q-item` → `ODropdownItem`

| Quasar pattern                                         | O2 equivalent                                  | Notes                                          |
| ------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| `<q-item clickable v-close-popup @click="fn">`         | `<ODropdownItem @select="fn">`                 | `@select` auto-closes; `v-close-popup` is gone |
| `<q-item-section>Label</q-item-section>`               | Default slot of `ODropdownItem`                | Just put text inside `<ODropdownItem>`         |
| `<q-item-section avatar><q-icon ...></q-item-section>` | `<template #icon-left><q-icon ...></template>` | Use the `#icon-left` slot                      |
| `<q-item-section side>...</q-item-section>`            | `<template #icon-right>...</template>`         | Use the `#icon-right` slot                     |
| `<q-item :disable="condition">`                        | `<ODropdownItem :disabled="condition">`        | Rename `disable` → `disabled`                  |
| Destructive action (`delete`, `remove`)                | `<ODropdownItem variant="destructive">`        | Set `variant="destructive"` for red styling    |
| `<q-separator />` between items                        | `<ODropdownSeparator />`                       | Direct replacement                             |
| `<q-item-label header>Group Label</q-item-label>`      | `<ODropdownGroup label="Group Label">`         | Wrap items in ODropdownGroup                   |

---

## `v-close-popup` Directive

`v-close-popup` is a Quasar-specific directive that walks up the DOM and closes the nearest `q-menu` parent.

**Migration rule:**

- On `q-item` elements → remove `v-close-popup`; the `@select` event on `ODropdownItem` closes the dropdown automatically.
- On non-item elements inside the menu content (e.g. `<div v-close-popup>`) → use `v-model:open` to control the menu programmatically and set the open state to `false` in the click handler.

---

## Pattern-by-Pattern Examples

---

### Pattern 1 — Simple Action List

The most common pattern: a button opens a list of clickable actions.

```vue
<!-- BEFORE (Quasar) -->
<OButton variant="ghost" size="icon-circle-sm">
  <q-icon name="more_vert" />
  <q-menu>
    <q-list>
      <q-item clickable v-close-popup @click="onEdit(row)">
        <q-item-section>Edit</q-item-section>
      </q-item>
      <q-separator />
      <q-item clickable v-close-popup @click="onDelete(row)">
        <q-item-section>Delete</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
</OButton>

<!-- AFTER (O2) -->
<ODropdown>
  <template #trigger>
    <OButton variant="ghost" size="icon-circle-sm">
      <q-icon name="more_vert" />
    </OButton>
  </template>
  <ODropdownItem @select="onEdit(row)">Edit</ODropdownItem>
  <ODropdownSeparator />
  <ODropdownItem variant="destructive" @select="onDelete(row)">Delete</ODropdownItem>
</ODropdown>
```

**Import**:

```ts
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue"
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue"
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue"
```

---

### Pattern 2 — Action List with Icons

```vue
<!-- BEFORE (Quasar) -->
<q-menu anchor="bottom left" self="top left">
  <q-list>
    <q-item clickable v-close-popup @click="exportCsv">
      <q-item-section avatar>
        <q-icon name="download" size="16px" />
      </q-item-section>
      <q-item-section>Export CSV</q-item-section>
    </q-item>
  </q-list>
</q-menu>

<!-- AFTER (O2) -->
<ODropdown side="bottom" align="start">
  <template #trigger>...</template>
  <ODropdownItem @select="exportCsv">
    <template #icon-left><q-icon name="download" size="16px" /></template>
    Export CSV
  </ODropdownItem>
</ODropdown>
```

---

### Pattern 3 — Themed Content Panel (SyntaxGuide pattern)

Used in `SyntaxGuide.vue` files — the menu contains a non-interactive documentation panel toggled by a button.

```vue
<!-- BEFORE (Quasar) -->
<OButton variant="outline" size="icon-sm">
  <HelpCircle :size="14" />
  <q-menu
    data-test="syntax-guide-menu"
    class="syntax-guide-menu"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <q-card flat>
      <q-card-section class="syntax-guide-title">...</q-card-section>
      <q-separator />
      <q-card-section class="q-pt-none">...</q-card-section>
    </q-card>
  </q-menu>
</OButton>

<!-- AFTER (O2) -->
<ODropdown side="bottom" align="start">
  <template #trigger>
    <OButton variant="outline" size="icon-sm">
      <HelpCircle :size="14" />
    </OButton>
  </template>
  <!-- Move classes from <q-menu> to a wrapper div inside the default slot -->
  <div
    data-test="syntax-guide-menu"
    class="syntax-guide-menu tw:p-0"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <div class="syntax-guide-title">...</div>
    <div class="tw:border-t tw:my-1 tw:border-dropdown-separator" />
    <div>...</div>
  </div>
</ODropdown>
```

---

### Pattern 4 — Controlled Open State (`v-model`)

When the menu needs to be opened/closed programmatically (e.g. download menu in SearchBar).

```vue
<!-- BEFORE (Quasar) -->
<OButton @click="showDownloadMenu = true">
  Download
  <q-menu
    v-model="showDownloadMenu"
    anchor="top end"
    self="top start"
    :offset="[0, 0]"
  >
    <div style="width: 200px">...</div>
  </q-menu>
</OButton>

<!-- AFTER (O2) -->
<ODropdown v-model:open="showDownloadMenu" side="right" align="start">
  <template #trigger>
    <OButton @click="showDownloadMenu = true">Download</OButton>
  </template>
  <div style="width: 200px">...</div>
</ODropdown>
```

> **Note**: With ODropdown, clicking the `#trigger` element automatically toggles the dropdown — you typically do **not** need a separate `@click` handler to set the open state. The `v-model:open` binding keeps your reactive variable in sync.

---

### Pattern 5 — Event-Driven (Load Data on Open)

When the menu fires `@show` to fetch data before rendering.

```vue
<!-- BEFORE (Quasar) -->
<q-menu class="q-pa-md" @show="loadFilterItem(column)">
  <StreamFieldSelect v-model="column" />
</q-menu>

<!-- AFTER (O2) -->
<ODropdown @update:open="(v) => v && loadFilterItem(column)">
  <template #trigger>...</template>
  <div class="tw:p-3">
    <StreamFieldSelect v-model="column" />
  </div>
</ODropdown>
```

---

### Pattern 6 — Complex Content (AutoRefreshInterval, Header Org Selector)

When the menu contains a full form, table, or rich widget. Content goes directly in the default slot; use a sized `<div>` wrapper for dimensions.

```vue
<!-- BEFORE (Quasar) -->
<OButton>
  ...
  <q-menu content-style="z-index: 10001">
    <div class="row" style="width: 300px">
      <OButton v-close-popup="true" @click="selectInterval(item)">...</OButton>
    </div>
  </q-menu>
</OButton>

<!-- AFTER (O2) -->
<ODropdown>
  <template #trigger>
    <OButton>...</OButton>
  </template>
  <!-- Remove content-style z-index — ODropdown already uses z-[6000] -->
  <!-- Replace v-close-popup with manual close via v-model:open -->
  <div class="row tw:w-[300px]">
    <OButton @click="selectInterval(item); menuOpen = false">...</OButton>
  </div>
</ODropdown>
```

> **z-index note**: ODropdown's content already uses `z-[6000]` which is above Quasar's header/drawer layers. The `content-style="z-index: 10001"` prop can be dropped.

---

## CSS `.q-menu` Reference Migration

Files that target `.q-menu` in their `<style>` block must be updated. Since ODropdown renders its content via `DropdownMenuContent` (without a `.q-menu` class), the selectors will no longer match.

**Migration approach:**

1. Add a custom class to a wrapper `<div>` inside the default slot.
2. Change the CSS selector from `.q-menu` to the new custom class.

```vue
<!-- BEFORE -->
<q-menu>
  <div class="field-list-menu">...</div>
</q-menu>

<style>
.q-menu {
  max-height: 400px;
}
</style>

<!-- AFTER -->
<ODropdown>
  <template #trigger>...</template>
  <div class="field-list-dropdown-content">...</div>
</ODropdown>

<style>
.field-list-dropdown-content {
  max-height: 400px;
}
</style>
```

---

## Not Supported / Unsupported Patterns

| Pattern                               | Notes                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nested sub-menus**                  | ODropdown uses Reka UI `DropdownMenuRoot`, which supports sub-menus via `DropdownMenuSub` — but this is not yet exposed in the O2 component. The `Header.vue` language selector (nested menu inside user profile) needs a custom workaround: use a separate `ODialog`/`ODrawer` or a two-level flat list |
| **`fit` prop** (match trigger width)  | Not yet built into ODropdown. Workaround: `class="tw:min-w-[var(--radix-popper-available-width)]"` on the content wrapper — Reka sets this CSS variable via the portal                                                                                                                                   |
| **Cross-axis offset**                 | `:offset="[x, y]"` — only `y` (side axis) maps to `:side-offset`. The `x` (cross axis) is not supported. If the cross-axis offset is zero, it's a no-op. Otherwise, apply a CSS `margin-inline-start` or `margin-inline-end` on the content                                                              |
| **`no-route-dismiss`**                | Not needed — ODropdown uses a pointer-down-outside listener, not a route watcher                                                                                                                                                                                                                         |
| **`context-menu` / `touch-position`** | Not observed in the codebase but these Quasar props are not supported in ODropdown                                                                                                                                                                                                                       |

---

## Import Reference

```ts
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue"
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue"
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue"
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue"
```
