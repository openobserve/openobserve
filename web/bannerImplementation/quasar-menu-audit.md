# Quasar `q-menu` — Props & Emits Audit

> Scanned **Vue files** under `web/src/`.  
> Total: **37 `<q-menu>` instances** across **24 files** (template usage only).  
> An additional **13 files** carry `.q-menu` CSS selectors that must also be updated (excluding 3 internal guards in `lib/overlay/Dialog`, `Drawer`, `Dropdown`).  
> Counts represent occurrences across the entire codebase.

---

## Table of Contents

- [q-menu](#q-menu)
- [CSS `.q-menu` References](#css-q-menu-references)
- [Content Patterns](#content-patterns)
- [Structural Difference (Critical)](#structural-difference-critical)
- [Gap Analysis](#gap-analysis)

---

## q-menu

### Props

| Prop               | Count | Notes                                                                                                                                    |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor`           | 13    | Static position string — describes the point on the **trigger** to attach (e.g. `"bottom left"`, `"top middle"`, `"center right"`)       |
| `self`             | 13    | Static position string — describes the point on the **menu** aligned to `anchor` (e.g. `"top left"`, `"bottom middle"`, `"center left"`) |
| `class`            | ~8    | Static CSS class on the menu panel                                                                                                       |
| `:class`           | ~4    | Dynamic class, almost always theme-dependent: `store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'`                               |
| `v-model`          | ~5    | Two-way binding controlling open state (e.g. `v-model="showDownloadMenu"`, `v-model="showAddMenu"`)                                      |
| `fit`              | 2     | Boolean — match the width of the trigger element (Header.vue help + profile menus)                                                       |
| `transition-show`  | 2     | Entry animation token (e.g. `"jump-down"`) — Header.vue only                                                                             |
| `transition-hide`  | 2     | Exit animation token (e.g. `"jump-up"`) — Header.vue only                                                                                |
| `:offset`          | 2     | `[x, y]` pixel offset array (e.g. `[0, 0]`, `[8, 0]`)                                                                                    |
| `auto-close`       | 1     | Boolean — Quasar's built-in "close on any child click" — Header.vue language sub-menu                                                    |
| `content-style`    | 1     | Inline style on the popup panel (e.g. `"z-index: 10001"`) — AutoRefreshInterval.vue                                                      |
| `no-route-dismiss` | 3     | Boolean — prevent menu from closing on route change — `DateTimePicker.vue`, `DateTime.vue`, `CustomDateTimePicker.vue` |
| `data-test`        | 1     | Test attribute (SyntaxGuide.vue traces)                                                                                                  |
| `id`               | 1     | DOM `id` attribute (DateTimePicker.vue `id="date-time-menu"`)                                                                            |

### Emits / Events (on `<q-menu>` itself)

| Event          | Count | Notes                                                                                                   |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `@show`        | ~2    | Fires after the menu finishes entering — used to trigger data fetching (AddCondition.vue, DateTime.vue) |
| `@before-show` | ~1    | Fires before the menu begins to open                                                                    |
| `@before-hide` | ~1    | Fires before the menu begins to close                                                                   |
| `@hide`        | ~1    | Fires after the menu finishes closing                                                                   |

### Directives Used Inside `q-menu` Content

| Directive              | Count | Notes                                                                         |
| ---------------------- | ----- | ----------------------------------------------------------------------------- |
| `v-close-popup`        | ~44   | On `<q-item>`, `<div>`, or buttons inside the menu — causes the menu to close. Count covers all 24 files that contain a `<q-menu>` |
| `v-close-popup="true"` | (subset of above) | Explicit boolean form, same effect                                            |

---

## CSS `.q-menu` References

These files target Quasar's auto-applied `.q-menu` class in their `<style>` block or inline JS strings. They must be updated to use the ODropdown content wrapper selector (add a custom class to `DropdownMenuContent` or wrap content in a scoped element).

Some of these files **also** contain `<q-menu>` in their template — listed here for the CSS-side migration only. Internal `.q-menu` guards inside `lib/overlay/Dialog/ODialog.vue`, `lib/overlay/Drawer/ODrawer.vue`, and `lib/overlay/Dropdown/ODropdown.vue` are intentional cross-portal interop and are **not** part of this migration.

| File                                                                          | Notes                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/plugins/traces/TraceDetails.vue`                                         | 4 rules: active, dark-active, focused, dark-focused state overrides                |
| `src/plugins/traces/IndexList.vue`                                            | 1 rule                                                                             |
| `src/plugins/metrics/MetricList.vue`                                          | 2 rules                                                                            |
| `src/components/dashboards/addPanel/FieldList.vue`                            | 1 rule (CSS-only — no `<q-menu>` template usage)                                   |
| `src/components/dashboards/addPanel/DashboardQueryBuilder.vue`                | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue`          | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue`            | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue`         | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/promql/components/OperationsList.vue`                         | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/promql/components/LabelFilterEditor.vue`                      | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/iam/users/UpdateRole.vue`                                     | 1 rule (CSS-only — overrides a popup created by a parent's `q-select` / `q-menu`)  |
| `src/views/Dashboards/addPanel/AddCondition.vue`                              | 1 rule (also has template `<q-menu>`)                                              |
| `src/components/alerts/IncidentDetailDrawer.vue`                              | Inline JS selector `.q-dialog, .q-menu` — used as a "popup is open" check          |

---

## Content Patterns

The internal content of `<q-menu>` falls into five distinct patterns, each requiring a different migration approach:

### Pattern 1 — Simple Action List

`q-list` + `q-item[clickable]` rows, each with a single label and `@click` handler.  
Files: `Group.vue`, `PipelinesList.vue`, `FolderList.vue`, `DashboardQueryBuilder.vue` fields, `DashboardSankeyChartBuilder.vue`, `DashboardMapsQueryBuilder.vue`, `DashboardGeoMapsQueryBuilder.vue`, `ServiceIdentitySetup.vue`.

```html
<!-- Quasar -->
<q-menu>
  <q-list>
    <q-item clickable v-close-popup @click="doA">
      <q-item-section>Label A</q-item-section>
    </q-item>
    <q-item clickable v-close-popup @click="doB">
      <q-item-section>Label B</q-item-section>
    </q-item>
  </q-list>
</q-menu>

<!-- O2 -->
<ODropdown>
  <template #trigger>...</template>
  <ODropdownItem @select="doA">Label A</ODropdownItem>
  <ODropdownItem @select="doB">Label B</ODropdownItem>
</ODropdown>
```

### Pattern 2 — Themed Content Panel (SyntaxGuide)

`q-card` with long-form documentation content. Menu is toggled by a button; no item selection.  
Files: `src/plugins/logs/SyntaxGuide.vue`, `src/plugins/metrics/SyntaxGuideMetrics.vue`, `src/plugins/metrics/MetricLegends.vue`, `src/plugins/traces/SyntaxGuide.vue`.

```html
<!-- Quasar -->
<q-menu :class="...theme...">
  <q-card flat>
    <q-card-section>...</q-card-section>
  </q-card>
</q-menu>

<!-- O2 — arbitrary content in default slot -->
<ODropdown v-model:open="open">
  <template #trigger>...</template>
  <div class="tw:p-3 tw:w-[420px] ..." :class="...theme...">
    <!-- card content -->
  </div>
</ODropdown>
```

### Pattern 3 — Complex Controlled Content

Large tables, search inputs, or form widgets rendered inside the popup. Requires `v-model` for programmatic control.  
Files: `Header.vue` (org selector), `AutoRefreshInterval.vue`, `SearchBar.vue` (download + saved views), `DateTimePicker.vue`, `DateTime.vue`, `CustomDateTimePicker.vue`.

```html
<!-- Quasar -->
<q-menu v-model="showMenu" anchor="..." self="..." content-style="...">
  <div style="width: 300px">...</div>
</q-menu>

<!-- O2 — controlled via v-model:open -->
<ODropdown v-model:open="showMenu" side="..." align="...">
  <template #trigger>...</template>
  <div style="width: 300px">...</div>
</ODropdown>
```

### Pattern 4 — Event-Driven Filter/Form

Menu fires `@show` to load data on open. The popup contains a form or filter UI.  
Files: `AddCondition.vue`, `DashboardQueryBuilder.vue` (field config menus).

```html
<!-- Quasar -->
<q-menu class="q-pa-md" @show="loadData">
  <StreamFieldSelect ... />
</q-menu>

<!-- O2 — use @update:open to fire side effects -->
<ODropdown @update:open="(v) => v && loadData()">
  <template #trigger>...</template>
  <div class="tw:p-3">
    <StreamFieldSelect ... />
  </div>
</ODropdown>
```

### Pattern 5 — Nested Sub-menu (Header Language Selector)

A `q-item` inside a `q-menu` itself triggers a nested `q-menu`.  
File: `Header.vue` (language selector inside the user profile menu).

> **⚠ ODropdown does not natively support nested sub-menus.** Reka UI's `DropdownMenuSub` family is not yet exposed. This pattern requires custom handling using a second `ODropdown` or a separate side-panel approach.

---

## Structural Difference (Critical)

This is the single most important difference to understand before migrating.

### Quasar — implicit trigger

`<q-menu>` is placed **inside** its trigger element. Quasar automatically treats the parent as the trigger:

```html
<q-btn>
  Click me
  <q-menu anchor="bottom left" self="top left">
    <q-list>...</q-list>
  </q-menu>
</q-btn>
```

### ODropdown — explicit trigger slot

The trigger must be placed in the named `#trigger` slot, and the content goes in the default slot:

```html
<ODropdown side="bottom" align="start">
  <template #trigger>
    <OButton>Click me</OButton>
  </template>
  <!-- content here -->
  <ODropdownItem @select="...">...</ODropdownItem>
</ODropdown>
```

**Consequence:** Every migration involves pulling the trigger element out of its current wrapper and restructuring the template. The `<q-btn>` (or any other trigger) must be extracted into the `#trigger` slot, and the `<q-menu>` content must become the default slot children.

---

## Gap Analysis

| Feature                       | Quasar                                           | ODropdown                                | Status                                                                                   |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Basic positioned popup        | `anchor` + `self`                                | `side` + `align`                         | ✅ Mapped — see migration guide for conversion table                                     |
| Pixel offset                  | `:offset="[x, y]"`                               | `:side-offset="n"`                       | ⚠ Partial — ODropdown only supports a single scalar side offset, not a cross-axis offset |
| Controlled open state         | `v-model`                                        | `v-model:open`                           | ✅ Direct                                                                                |
| Open/close lifecycle events   | `@show`, `@hide`, `@before-show`, `@before-hide` | `@update:open`                           | ⚠ Single event — open/close direction distinguished by boolean value                     |
| Trigger-width dropdown        | `fit`                                            | Not supported                            | ✅ Resolved — `fit` dropped in migration; content uses inline `min-width: 100%` or a Tailwind width class                         |
| Route-dismiss prevention      | `no-route-dismiss`                               | N/A                                      | 🗑 Drop — ODropdown uses Reka UI's `DismissableLayer` which is router-agnostic           |
| Enter/exit transitions        | `transition-show`, `transition-hide`             | Built-in via Tailwind `data-[state]`     | 🗑 Drop — ODropdown has its own consistent animation                                     |
| Inline `content-style`        | `content-style="z-index: 10001"`                 | `class` on content div                   | ⚠ Needs manual `class`/`style` on the content wrapper div                                |
| `v-close-popup` directive     | `v-close-popup` on items                         | `@select` on `ODropdownItem` auto-closes | ✅ No action needed if items are migrated to `ODropdownItem`                             |
| Nested sub-menus              | `<q-menu>` inside `<q-item>`                     | Not exposed                              | ✅ Resolved with two workarounds — Workaround A flattened `Header.vue`'s language sub-menu into an `ODropdownGroup`; Workaround C kept Quasar `<q-menu>` inside `ODropdown` for true nested popovers (`OperationsList.vue`, `LabelFilterEditor.vue`) with a pointer-down-outside guard in `ODropdown.vue`                    |
| CSS `.q-menu` class targeting | `.q-menu { ... }`                                | Use custom class on content              | ⚠ Manual — add a custom class to the content wrapper div                                 |
