# Quasar List Components — Props & Emits Audit

> Scanned **74 Vue files** under `web/src/` that contain at least one of: `q-list`, `q-item`, `q-item-section`, `q-item-label`.  
> Total occurrences: `q-list` × 46 · `q-item` × 179 · `q-item-section` × 260 · `q-item-label` × 138.  
> Props prefixed with `:` are dynamically bound (`:prop="expr"`); without prefix they are static string / boolean attributes.

---

## Table of Contents

**No dedicated O2 list components — these map to contextual replacements:**

- [q-list](#q-list)
- [q-item](#q-item)
- [q-item-section](#q-item-section)
- [q-item-label](#q-item-label)
- [Summary — Usage Context Breakdown](#summary--usage-context-breakdown)
- [Gap Analysis — No New O2 Components Needed](#gap-analysis--no-new-o2-components-needed)
- [Known Edge Cases](#known-edge-cases)

---

## q-list

### Overview

`q-list` is a structural flex-column container for `q-item` rows. It provides optional dividers, padding, and borders. It has no semantic role of its own — it renders as a `<div>` with CSS classes.

**Total occurrences:** 46 across 26 files.

### Props

| Prop        | Count | Notes                                                       |
| ----------- | ----- | ----------------------------------------------------------- |
| `dense`     | 13    | Boolean — reduces vertical padding on child items           |
| `separator` | 12    | Boolean — renders a divider between items                   |
| `bordered`  | 10    | Boolean — adds an outer border around the list              |
| `style`     | 7     | Inline style (typically `min-width`, `max-height`, `width`) |
| `class`     | 6     | Custom CSS class (e.g. `compact-list`, `rounded-borders`)   |
| `data-test` | 4     | Static test attribute                                       |

### Emits / Events

| Event | Count | Notes                                                |
| ----- | ----- | ---------------------------------------------------- |
| —     | —     | No event listeners found on `q-list` in the codebase |

### Slots

| Slot       | Count | Notes                                                 |
| ---------- | ----- | ----------------------------------------------------- |
| `#default` | 46    | All `q-item` / `q-item-label header` children go here |

---

## q-item

### Overview

`q-item` is a list row component. It is used in three distinct contexts in this codebase:

1. **Inside `q-menu`** — clickable popup menu items (`clickable` + `@click` or `v-close-popup`)
2. **Inside `q-select` `#option` slot** — custom option rows (`v-bind="scope.itemProps"` or `v-bind="props.itemProps"`)
3. **Standalone display row** — non-interactive key-value / info rows (no `clickable`, no `v-bind="itemProps"`)

**Total occurrences:** 179 across 51 files.

### Props

| Prop                       | Count | Notes                                                              |
| -------------------------- | ----- | ------------------------------------------------------------------ |
| `clickable`                | 12    | Boolean — makes the item interactive (hover state, cursor pointer) |
| `v-bind="scope.itemProps"` | 11    | Inside `q-select` option slot — binds Quasar selection state       |
| `v-bind="itemProps"`       | 9     | Inside `q-select` option slot — alternate binding form             |
| `v-bind="props.itemProps"` | 1     | Inside `q-select` option slot — third binding form (same semantic) |
| `dense`                    | 13    | Boolean — reduces item height                                      |
| `tag="label"`              | 4     | Renders item as `<label>` (wraps a checkbox/toggle)                |
| `v-ripple`                 | 3     | Adds Quasar ripple effect on click                                 |
| `style`                    | 6     | Inline style (typically `padding: 0`)                              |
| `class`                    | 5     | Custom CSS class                                                   |
| `:disable`                 | 1     | Dynamic disabled state                                             |

### Emits / Events

| Event           | Count | Notes                                           |
| --------------- | ----- | ----------------------------------------------- |
| `@click`        | 10    | Click handler on clickable items                |
| `v-close-popup` | 4     | Directive — closes the parent `q-menu` on click |

### Slots

| Slot       | Count | Notes                              |
| ---------- | ----- | ---------------------------------- |
| `#default` | 179   | Contains `q-item-section` children |

---

## q-item-section

### Overview

`q-item-section` is a flex child inside `q-item`. It handles three layout roles: main content column (default), icon/avatar column (`avatar`), and trailing content column (`side`).

**Total occurrences:** 260 across 71 files.

### Props

| Prop     | Count | Notes                                                  |
| -------- | ----- | ------------------------------------------------------ |
| `side`   | 39    | Trailing column — right-aligns content, shrinks to fit |
| `avatar` | 28    | Icon/avatar column — fixed width, shrinks to fit       |
| `class`  | 20    | Custom CSS class for content styling                   |
| `dense`  | 10    | Boolean — reduces padding                              |
| `top`    | 5     | Aligns section content to the top of the item row      |
| `style`  | 4     | Inline style (padding overrides)                       |

### Emits / Events

| Event           | Count | Notes                                                             |
| --------------- | ----- | ----------------------------------------------------------------- |
| `@click.stop`   | 4     | Stops propagation while handling click on a section independently |
| `v-close-popup` | 4     | Directive — closes parent `q-menu` when section is clicked        |

### Slots

| Slot       | Count | Notes                                        |
| ---------- | ----- | -------------------------------------------- |
| `#default` | 260   | Contains `q-item-label` or arbitrary content |

---

## q-item-label

### Overview

`q-item-label` renders text content inside a `q-item-section`. The `caption` prop renders smaller muted secondary text. The `header` prop renders as a standalone section heading outside any `q-item` (above a group of items in a list).

**Total occurrences:** 138 across 48 files.

### Props

| Prop       | Count | Notes                                                                            |
| ---------- | ----- | -------------------------------------------------------------------------------- |
| `caption`  | 20    | Boolean — renders as smaller, muted secondary text below the main label          |
| `header`   | 17    | Boolean — renders as a section group heading (standalone, outside `q-item`)      |
| `class`    | 28    | Custom CSS class (e.g. `tw:flex tw:items-center tw:gap-2`, `text-weight-medium`) |
| `lines`    | 3     | Number — truncates text to N lines with ellipsis (`lines="1"`, `lines="2"`)      |
| `overline` | 0     | Boolean — eyebrow text (not found in codebase)                                   |

### Emits / Events

| Event | Count | Notes                                                      |
| ----- | ----- | ---------------------------------------------------------- |
| —     | —     | No event listeners found on `q-item-label` in the codebase |

### Slots

| Slot       | Count | Notes                                     |
| ---------- | ----- | ----------------------------------------- |
| `#default` | 138   | Text content or arbitrary inline elements |

---

## Summary — Usage Context Breakdown

### Context A — Inside `q-menu` (popup dropdown items)

`q-list` + `q-item[clickable]` + `q-item-section` + `q-item-label` pattern living inside a `<q-menu>` tag.

| Characteristic                | How to identify                                          |
| ----------------------------- | -------------------------------------------------------- |
| `q-item` has `clickable` prop | OR has `@click` / `v-close-popup`                        |
| Parent is `q-menu`            | Direct parent or ancestor within the same template block |

**Count:** ~12 `clickable` items, 4 `v-close-popup` items — approximately 15 files.

**Migration target:** `ODropdown` + `ODropdownItem` + `ODropdownGroup` + `ODropdownSeparator`.

---

### Context B — Inside `q-select` `#option` Slot

`q-item[v-bind="scope.itemProps"]` + `q-item-section` + `q-item-label` inside a `<template #option="scope">` or `<template v-slot:option="props">` slot of a `<q-select>`.

| Characteristic                                                       | How to identify                       |
| -------------------------------------------------------------------- | ------------------------------------- |
| `q-item` has `v-bind="scope.itemProps"` / `v-bind="props.itemProps"` | The itemProps binding is the giveaway |
| Direct parent is a `q-select` `#option` slot                         |                                       |

**Count:** 21 `itemProps` bindings across 16 files.

**Migration target:** Handled automatically by the `q-select → OSelect` migration. The `#option` slot API changes — see `quasar-list-components-migration.md`.

---

### Context C — Navigation Sidebar Links

`q-item` used as a styled navigation anchor inside a sidebar or navigation drawer. Relies heavily on `.q-item` CSS class selectors.

| Characteristic                                                 | How to identify |
| -------------------------------------------------------------- | --------------- |
| Inside `MainLayout.vue`, `MenuLink.vue`, or nav-drawer context |                 |
| Deep `.q-item` CSS class selectors in `<style>` block          |                 |

**Count:** 3 files.

**Migration target:** Native `<router-link>` + Tailwind CSS. `MenuLink.vue` requires a full rewrite — do not rush.

---

### Context D — Standalone Display Rows (non-interactive)

`q-item` without `clickable` / `@click` / `v-bind="itemProps"`, used to render read-only info rows (metadata panels, key-value pairs, diff views).

| Characteristic                                                    | How to identify |
| ----------------------------------------------------------------- | --------------- |
| `q-item` has no `clickable`, no `@click`, no `v-bind="itemProps"` |                 |
| Content is display-only                                           |                 |

**Count:** ~36 files.

**Migration target:** Native `<li>` / `<div>` with Tailwind flex classes. No new O2 component needed.

---

## Summary — Cross-Component Usage Counts

| Component        | Total occurrences |   Files affected    |
| ---------------- | :---------------: | :-----------------: |
| `q-list`         |        46         |         26          |
| `q-item`         |        179        |         51          |
| `q-item-section` |        260        |         71          |
| `q-item-label`   |        138        |         48          |
| **Total**        |      **623**      | **74 unique files** |

---

## Gap Analysis — No New O2 Components Needed

Unlike the form components migration, **no new O2 components need to be built** for this migration. All four Quasar list components map to existing O2 components or native HTML.

| Quasar                               | Context               | O2 / Native                                          | Status                          |
| ------------------------------------ | --------------------- | ---------------------------------------------------- | ------------------------------- |
| `q-list` (in `q-menu`)               | Dropdown popup        | **Delete** — not needed inside `ODropdown`           | ODropdown already built ✅      |
| `q-list` (in `q-select` `#option`)   | Select option slot    | **Delete** — OSelect handles container               | OSelect already built ✅        |
| `q-list` (standalone)                | Display list          | `<ul>` / `<div>` + Tailwind                          | Native — no build needed ✅     |
| `q-item` (clickable, in `q-menu`)    | Popup menu item       | **`ODropdownItem`**                                  | ODropdownItem already built ✅  |
| `q-item` (in `q-select` option slot) | Select option         | Handled by OSelect `#option` slot API                | OSelect already built ✅        |
| `q-item` (display row)               | Standalone display    | `<li>` + Tailwind                                    | Native — no build needed ✅     |
| `q-item` (nav link)                  | Navigation            | Native `<router-link>` + Tailwind                    | Native — no build needed ✅     |
| `q-item-section`                     | Any                   | Tailwind flex child (`<div>`)                        | Native — no build needed ✅     |
| `q-item-label` (default)             | Item text             | Plain text / `<span>`                                | Native — no build needed ✅     |
| `q-item-label caption`               | Secondary text        | `<span class="tw:text-xs tw:text-muted-foreground">` | Native — no build needed ✅     |
| `q-item-label header`                | Section group heading | **`ODropdownGroup` `:label` prop**                   | ODropdownGroup already built ✅ |

> **Conclusion:** The entire list-components migration is an in-file refactor. No component library PRs are required. Work proceeds file by file.

---

## Known Edge Cases

Verified via targeted grep scans after the initial audit. These are the only cases where a mechanical find-and-replace would be wrong.

### ✅ Non-issues (zero occurrences — safe to ignore)

| Pattern checked                             | Result                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `q-item :to` (router-link prop)             | 0 occurrences — `q-item` is never used as a nav link |
| `q-item exact` / `active-class` (nav props) | 0 occurrences — no navigation-style items            |
| `q-item-section thumbnail` variant          | 0 occurrences — not used anywhere                    |
| `q-item-label overline` variant             | 0 occurrences — not used anywhere                    |

---

### ⚠️ Edge Case 1 — `clickable` items with no `@click` on `q-item` itself

**3 instances.** These items are `clickable` (adds hover state / cursor) but the actual action handler lives on a **child `q-item-section`**, not on the `q-item`.

| File                             | Line  | Notes                                                                                                                 |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `src/components/Header.vue`      | L472  | `<q-item clickable>` — child `q-item-section` opens a nested `q-menu`; the parent item has no click action of its own |
| `src/plugins/logs/SearchBar.vue` | L1939 | `<q-item class="q-pa-xs saved-view-item" clickable>` — handler is on an inner section                                 |
| `src/plugins/logs/SearchBar.vue` | L2041 | Same as above                                                                                                         |

**What to do:** Before migrating these to `ODropdownItem`, inspect the child `q-item-section` for `@click.stop` or `v-close-popup`. The `@select` event on `ODropdownItem` replaces the combination of item + section click.

---

### ⚠️ Edge Case 2 — `q-virtual-scroll` wrapping `q-item` rows

**4 files** use both `q-virtual-scroll` and `q-item`. `ODropdown` has no built-in virtual scrolling. All 4 are **Context B** (inside `q-select #option` slot) — the virtual scroll is provided by `q-select` itself, not by list-component migration.

| File                                               | Context                            |
| -------------------------------------------------- | ---------------------------------- |
| `src/components/dashboards/addPanel/FieldList.vue` | `q-select` option slot (Context B) |
| `src/plugins/metrics/MetricList.vue`               | `q-select` option slot (Context B) |
| `src/plugins/traces/IndexList.vue`                 | `q-select` option slot (Context B) |
| `src/views/Dashboards/addPanel/AddCondition.vue`   | `q-select` option slot (Context B) |

**What to do:** These are blocked on the OSelect migration. Do not touch these files during Context A (dropdown) migration. When OSelect ships, its virtual-scroll behaviour will be provided by the new component — verify the API supports it before migrating.

---

### ⚠️ Edge Case 3 — File using both `q-btn-dropdown` and `q-item`

**1 file.** `q-btn-dropdown` renders its own inline dropdown that also contains `q-item` rows.

| File                               | Notes                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/logs/JsonPreview.vue` | Uses `q-btn-dropdown` whose popup body contains `q-item` + `q-item-section`. Must be migrated as a single unit — migrate `q-btn-dropdown` → `ODropdown` first, then migrate the `q-item` rows inside it to `ODropdownItem` in the same commit. |

**What to do:** Do not migrate the `q-item` rows in this file independently — they will lose their trigger context. Co-ordinate with the `q-btn-dropdown → ODropdown` migration pass.
