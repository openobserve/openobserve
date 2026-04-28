---
name: o2-component-usage
description: Use O2 internal component library components in the OpenObserve web application, AND migrate existing Quasar components (q-btn, q-btn-toggle, q-btn-group, q-btn-dropdown, q-tabs, etc.) to O2 equivalents. Use this skill when writing new views or features, deciding which O2 component to use for a UI element, or performing a systematic Quasar to O2 migration across the codebase.
---

# O2 Component Usage & Migration Skill

> **DRAFT** — The O2 component library is being built incrementally. This skill only lists components that have been built and confirmed. Do not invent or assume a component exists.

Use this skill when **using** or **composing** O2 components in views, layouts, or feature components, and when **migrating** existing Quasar usages to O2.

## Core Principle

**O2 components are the only correct way to render standard UI elements.** Never use a Quasar primitive (`q-btn`, `q-input`, `q-dialog`, etc.) when an O2 equivalent exists.

## Import Pattern

```ts
// Direct import by path — no index.ts per component
import OButton from "@/lib/core/Button/OButton.vue"
import type { ButtonProps } from "@/lib/core/Button/OButton.types"

import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue"

import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue"
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue"

import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue"
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue"
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue"
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue"

// Tab family — all four must be imported together
import OTabs from "@/lib/navigation/Tabs/OTabs.vue"
import OTab from "@/lib/navigation/Tabs/OTab.vue"
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue"
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue"
// For router-linked tabs:
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue"
```

All O2 components use the `O` prefix (e.g. `OButton`, `OTabs`, `OModal`).

## Available Components

> Only components listed here have been built. For anything not listed, see **"Component Not Available"** below.
> _Update this table every time a new component is built and merged._

| O2 Component         | Import path                                     | Replaces                          | Status |
| -------------------- | ----------------------------------------------- | --------------------------------- | ------ |
| `OButton`            | `@/lib/core/Button/OButton.vue`                 | `q-btn`                           | Built  |
| `OButtonGroup`       | `@/lib/core/Button/OButtonGroup.vue`            | `q-btn-group`                     | Built  |
| `OToggleGroup`       | `@/lib/core/ToggleGroup/OToggleGroup.vue`       | `q-btn-toggle`                    | Built  |
| `OToggleGroupItem`   | `@/lib/core/ToggleGroup/OToggleGroupItem.vue`   | individual toggle option          | Built  |
| `ODropdown`          | `@/lib/overlay/Dropdown/ODropdown.vue`          | `q-btn-dropdown` / `q-menu`       | Built  |
| `ODropdownItem`      | `@/lib/overlay/Dropdown/ODropdownItem.vue`      | `q-item` inside dropdown          | Built  |
| `ODropdownGroup`     | `@/lib/overlay/Dropdown/ODropdownGroup.vue`     | `q-item-section` group with label | Built  |
| `ODropdownSeparator` | `@/lib/overlay/Dropdown/ODropdownSeparator.vue` | `q-separator` inside dropdown     | Built  |
| `OSeparator`         | `@/lib/core/Separator/Separator.vue`            | `q-separator`                     | Built  |
| `OTabs`              | `@/lib/navigation/Tabs/OTabs.vue`               | `q-tabs`                          | Built  |
| `OTab`               | `@/lib/navigation/Tabs/OTab.vue`                | `q-tab`                           | Built  |
| `ORouteTab`          | `@/lib/navigation/Tabs/ORouteTab.vue`           | `q-route-tab`                     | Built  |
| `OTabPanels`         | `@/lib/navigation/Tabs/OTabPanels.vue`          | `q-tab-panels`                    | Built  |
| `OTabPanel`          | `@/lib/navigation/Tabs/OTabPanel.vue`           | `q-tab-panel`                     | Built  |

## Component Families

Some components are compound families — **always use all members together**. Never mix O2 and Quasar within the same family group.

### Tabs family

```vue
<OTabs v-model="activeTab" dense align="left">
  <OTab name="logs" label="Logs" />
  <OTab name="metrics" label="Metrics" />
</OTabs>
<OTabPanels v-model="activeTab">
  <OTabPanel name="logs">...</OTabPanel>
  <OTabPanel name="metrics">...</OTabPanel>
</OTabPanels>
```

**OTabs props**: `v-model`, `dense`, `align` (`"left"` | `"right"` | `"center"`), `orientation` (`"horizontal"` | `"vertical"`)
**OTab props**: `name` (required), `label`, `icon`, `disabled` — also accepts a default slot for custom content
**OTabPanels props**: `v-model`, `animated`, `keepAlive`
**OTabPanel props**: `name` (required)

### ToggleGroup family (replaces `q-btn-toggle`)

```vue
<!-- q-btn-toggle BEFORE -->
<q-btn-toggle
  v-model="period"
  :options="[
    { label: '1h', value: '1h' },
    { label: '1d', value: '1d' },
  ]"
  toggle-color="primary"
/>

<!-- OToggleGroup AFTER -->
<OToggleGroup v-model="period" type="single">
  <OToggleGroupItem value="1h">1h</OToggleGroupItem>
  <OToggleGroupItem value="1d">1d</OToggleGroupItem>
</OToggleGroup>
```

- `v-model` maps directly (same string/array value)
- `type="single"` for one active at a time (default q-btn-toggle behavior); `type="multiple"` for multi-select
- Each option in `:options` array becomes an `<OToggleGroupItem :value="...">{{ label }}</OToggleGroupItem>`
- If `q-btn-toggle` had a scoped `#option` slot, render that content as child of `OToggleGroupItem`
- `orientation` prop: `"horizontal"` (default) | `"vertical"`
- Drop `toggle-color`, `color`, `text-color`, `spread` — styling via tokens only

### ButtonGroup family (replaces `q-btn-group`)

```vue
<!-- q-btn-group BEFORE -->
<q-btn-group flat>
  <q-btn label="A" />
  <q-btn label="B" />
</q-btn-group>

<!-- OButtonGroup AFTER -->
<OButtonGroup>
  <OButton>A</OButton>
  <OButton>B</OButton>
</OButtonGroup>
```

- Drop `flat`, `rounded`, `push`, `spread`, `glossy` — design is baked in
- Children must be `OButton` (not `q-btn`)

### Dropdown family (replaces `q-btn-dropdown` / `q-menu`)

```vue
<!-- q-btn-dropdown BEFORE -->
<q-btn-dropdown label="Actions">
  <q-list>
    <q-item clickable v-close-popup @click="doA">
      <q-item-section>Action A</q-item-section>
    </q-item>
  </q-list>
</q-btn-dropdown>

<!-- ODropdown AFTER -->
<ODropdown>
  <template #trigger>
    <OButton>Actions</OButton>
  </template>
  <ODropdownItem @select="doA">Action A</ODropdownItem>
</ODropdown>
```

- `#trigger` slot receives the trigger element — use `OButton` or any element
- Default slot is the menu content — use `ODropdownItem`, `ODropdownGroup`, `ODropdownSeparator`
- `ODropdownItem` emits `@select` instead of `@click` + `v-close-popup`
- `ODropdownGroup` has a `label` prop for section headings
- `align` prop on `ODropdown`: `"start"` | `"center"` | `"end"` (default `"start"`)

## Component Not Available?

If the component you need is not in the table above:

1. **Do NOT use a Quasar fallback** (`q-btn`, `q-input`, etc.)
2. **Do NOT use a raw HTML element** without design tokens
3. **Use the `o2-component-create` skill** to build the component first
4. Once built, add it to the Available Components table above and then use it

## Usage Rules

1. **No UI decision overrides** — O2 components have baked-in design. Do not try to override border radius, color, or shape through props that don't exist.
2. **Pass only documented props** — check `OComponentName.types.ts` for accepted props.
3. **Use slots as documented** — check the component file for slot names.
4. **Never mix old and new within a family** — do not use `OTabs` with `q-tab-panel`, or `OToggleGroup` with `q-btn`.

## Dark Mode

All O2 components automatically support dark mode via design tokens. You do not need to add any dark-mode conditionals or class overrides when using O2 components.

---

---

# Quasar to O2 Migration Workflow

Use this section when **migrating existing Quasar component usages** to O2 across the codebase.

## Golden Rule

> **Migrate all files for one Quasar component completely before moving to the next. Then ask for user verification once.**

Never partially migrate a component family. Never migrate multiple Quasar components in parallel.

---

## Step 1 — Audit: Find All Usages

For each Quasar component to migrate, count all usages:

```
grep_search for "<q-btn-toggle" across web/src/ (isRegexp: false)
grep_search for "<q-btn-group" across web/src/ (isRegexp: false)
grep_search for "<q-btn-dropdown" across web/src/ (isRegexp: false)
grep_search for "<q-btn" across web/src/ (isRegexp: false)
```

Record: file path, number of usages per file, total count.

---

## Step 2 — Create or Update the Migration Tracker

The tracker lives at `quasar-button-migration.md` (root of the repo, outside `web/`).

**Tracker format:**

```markdown
# Quasar [Family] Migration Tracker

**Status legend:** `pending` | `in-progress` | `done` | `verified`

**Migration process:** Migrate all files for one component completely, then ask for verification once. Only move to the next component after the current one is verified.

## Summary

| Quasar Component | O2 Replacement                      | Total Usages | Files | Status  |
| ---------------- | ----------------------------------- | ------------ | ----- | ------- |
| `q-btn-toggle`   | `OToggleGroup` + `OToggleGroupItem` | 10           | 6     | done    |
| `q-btn-group`    | `OButtonGroup`                      | 10           | 9     | pending |

## 1. `q-btn-toggle` -> `OToggleGroup` + `OToggleGroupItem`

| File                                       | Usages | Status |
| ------------------------------------------ | ------ | ------ |
| `src/components/alerts/steps/Advanced.vue` | 1      | done   |
```

After completing all files for a component: update its Summary row to `done`. After user confirms: update to `verified`.

---

## Step 3 — Read Each File Before Editing

For every file in the current component's list:

1. `read_file` the full component
2. Identify every `q-*` usage, all its props, all its slots, all its event handlers
3. Map each prop/event/slot to the O2 equivalent (see **Prop Mapping Tables** below)
4. Note any complex patterns: dynamic `:options`, scoped slots, `v-close-popup`, `v-if`/`v-for`

---

## Step 4 — Replace

Replace in batches using `multi_replace_string_in_file`:

1. **Detect script style first**: check if the file uses `<script setup lang="ts">` or `export default defineComponent({...})`
2. Update imports: remove Quasar (if explicit), add O2 imports
3. **If Options API** (`defineComponent`): register the components in `components: {}` — this is MANDATORY or Vue silently ignores the import and renders nothing
4. Replace each template usage with O2 equivalent
5. Keep all business logic, `v-model`, `v-if`, `v-for`, `@click` handlers intact — only replace the component tags and props

**`components:` registration for Options API (CRITICAL):**

```ts
// If components: {} already exists — add to it:
components: { ExistingComponent, OToggleGroup, OToggleGroupItem },

// If components: {} does not exist — add it after name: "..."
export default defineComponent({
  name: "MyComponent",
  components: { OToggleGroup, OToggleGroupItem },  // ← ADD THIS
  setup() { ... }
})
```

> **`<script setup>` files do NOT need `components: {}` — imported components are auto-registered.**
> **Options API files ALWAYS need `components: {}` — forgetting it means the component silently does nothing in the browser.**

**Per-file checklist:**

- [ ] Detected script style (`<script setup>` vs `defineComponent`)
- [ ] Old `<q-*>` tag removed
- [ ] O2 component imported
- [ ] **If Options API: O2 components registered in `components: {}`** ← NEVER skip this
- [ ] All used props mapped (see tables below)
- [ ] All slots mapped
- [ ] All event handlers mapped
- [ ] `v-close-popup` removed (not needed with O2 Dropdown)
- [ ] No Quasar-only props left (`toggle-color`, `flat`, `push`, `spread`, etc.)

---

## Step 5 — Update Tracker After Each File

After replacing a file, update its row in `quasar-button-migration.md` from `pending` to `done`.

---

## Step 6 — Ask for Verification

After all files for one Quasar component are done:

1. Update the Summary row from `in-progress` to `done`
2. Report: "Migrated `q-[component]` across N files. Please verify in the browser before I continue with the next component."
3. **Wait for user confirmation** before starting the next Quasar component

After user confirms: update the row to `verified`, then proceed to the next component.

---

## Prop Mapping Tables

### `q-btn` -> `OButton`

| Quasar prop / behavior         | O2 equivalent                                       | Notes                                 |
| ------------------------------ | --------------------------------------------------- | ------------------------------------- |
| `label="Save"`                 | `<OButton>Save</OButton>`                           | Use default slot, not a prop          |
| `icon="add"`                   | `<template #prefix><OIcon name="add" /></template>` | OIcon when available; else inline SVG |
| `color="primary"`              | (drop it)                                           | Variant controls color via tokens     |
| `flat` / `outline`             | `variant="ghost"` / `variant="outline"`             | Map to closest OButton variant        |
| `dense`                        | `size="sm"`                                         |                                       |
| `round` / `rounded`            | (drop it)                                           | Design is baked in                    |
| `disable`                      | `disabled`                                          |                                       |
| `loading`                      | `loading`                                           | Direct prop                           |
| `type="submit"`                | `type="submit"`                                     | Direct prop                           |
| `@click="handler"`             | `@click="handler"`                                  | Unchanged                             |
| `no-caps`                      | (drop it)                                           | Casing controlled by tokens           |
| `unelevated`, `push`, `glossy` | (drop it)                                           | Not applicable                        |

### `q-btn-toggle` -> `OToggleGroup` + `OToggleGroupItem`

| Quasar prop / behavior                | O2 equivalent                                                                           | Notes                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| `v-model="val"`                       | `v-model="val"` on `OToggleGroup`                                                       | Direct                                |
| `:options="[{label, value}, ...]"`    | One `<OToggleGroupItem :value="...">` each                                              | Expand array to explicit children     |
| `toggle-color`, `color`, `text-color` | (drop it)                                                                               | Tokens control styling                |
| `spread`                              | (drop it)                                                                               |                                       |
| `#option` scoped slot                 | Child content of each `OToggleGroupItem`                                                | Move slot content inside the item tag |
| `dense`                               | (drop it)                                                                               | Design is baked in                    |
| dynamic `:options` with `v-for`       | `<OToggleGroupItem v-for="o in opts" :value="o.value">{{ o.label }}</OToggleGroupItem>` |                                       |

### `q-btn-group` -> `OButtonGroup`

| Quasar prop / behavior | O2 equivalent | Notes                                                              |
| ---------------------- | ------------- | ------------------------------------------------------------------ |
| `flat`                 | (drop it)     | Design is baked in                                                 |
| `rounded`              | (drop it)     |                                                                    |
| `push`                 | (drop it)     |                                                                    |
| `spread`               | (drop it)     |                                                                    |
| default slot           | default slot  | Move children unchanged, but replace `q-btn` with `OButton` inside |

### `q-btn-dropdown` -> `ODropdown`

| Quasar prop / behavior                    | O2 equivalent                                              | Notes                                  |
| ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `label="Actions"`                         | `<template #trigger><OButton>Actions</OButton></template>` | Trigger becomes a named slot           |
| `icon="..."`                              | Icon inside `#trigger` OButton                             |                                        |
| `color`, `flat`, `outline`                | OButton variant inside `#trigger`                          | Style the trigger OButton              |
| default slot (menu content)               | default slot of `ODropdown`                                | Move content directly                  |
| `<q-item clickable v-close-popup @click>` | `<ODropdownItem @select="fn">`                             | `v-close-popup` removed; use `@select` |
| `<q-item-section>Label</q-item-section>`  | `<ODropdownItem>Label</ODropdownItem>`                     | Flatten — no section wrapper needed    |
| `<q-separator />`                         | `<ODropdownSeparator />`                                   |                                        |
| `split`                                   | Not supported — flatten to trigger + separate dropdown     | Redesign the trigger                   |
| `disable`                                 | `disabled` on trigger OButton                              |                                        |

---

## Migration Order (Button Family)

Migrate in this order — smallest surface area first:

1. `q-btn-toggle` -> `OToggleGroup` + `OToggleGroupItem` (10 usages, 6 files) — **done**
2. `q-btn-group` -> `OButtonGroup` (10 usages, 9 files)
3. `q-btn-dropdown` -> `ODropdown` family (46 usages, 17 files)
4. `q-btn` -> `OButton` (146 usages, 55 files)

Current tracker: `quasar-button-migration.md` (repo root)

---

## Common Pitfalls

| Pitfall                                                   | Fix                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Options API file: not registering in `components: {}`** | Vue silently ignores the import — component renders as unknown element. Always add to `components: {}` for `defineComponent` files. |
| Leaving `v-close-popup` on items                          | Remove it — ODropdownItem closes automatically on `@select`                                                                         |
| Using `q-btn` inside `OButtonGroup`                       | Replace with `OButton` — never mix                                                                                                  |
| Passing `toggle-color` to `OToggleGroup`                  | Drop it — styling via tokens only                                                                                                   |
| Forgetting to import O2 component                         | Always add import in `<script setup>` alongside the replacement                                                                     |
| Mixing O2 and Quasar within the same family               | Full family replacement in one commit per file                                                                                      |
| Dynamic `:options` on `q-btn-toggle`                      | Use `v-for` on `OToggleGroupItem` instead                                                                                           |

---

## References

| When                                                        | File                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Full catalog of built components (updated as library grows) | [references/component-catalog.md](references/component-catalog.md) |
| Build a new O2 component                                    | `.agents/skills/o2-component-create/SKILL.md`                      |
| Audit component usage in codebase                           | `web/scripts/component-audit.mjs`                                  |
| Active migration tracker                                    | `quasar-button-migration.md` (repo root)                           |
