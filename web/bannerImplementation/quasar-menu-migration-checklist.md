# Quasar `q-menu` — Migration Checklist

Tracks every file that uses `<q-menu>` (template) or `.q-menu` (CSS) and the O2 replacement to use.

## Replacement Map

| Quasar                               | O2 Replacement         | Import                                          |
| ------------------------------------ | ---------------------- | ----------------------------------------------- |
| `<q-menu>`                           | `<ODropdown>`          | `@/lib/overlay/Dropdown/ODropdown.vue`          |
| `<q-item clickable>` (inside menu)   | `<ODropdownItem>`      | `@/lib/overlay/Dropdown/ODropdownItem.vue`      |
| `<q-item-label header>` / item group | `<ODropdownGroup>`     | `@/lib/overlay/Dropdown/ODropdownGroup.vue`     |
| `<q-separator>` (inside menu)        | `<ODropdownSeparator>` | `@/lib/overlay/Dropdown/ODropdownSeparator.vue` |

> **Rule**: `q-menu` is always replaced by `ODropdown`. See the migration guide for the structural template change required.

---

## Key Changes Summary

| Before (Quasar)                            | After (O2)                                        | Notes                                                    |
| ------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| `<q-btn><q-menu>`                          | `<ODropdown><template #trigger><OButton>`         | Structural inversion — trigger goes into `#trigger` slot |
| `anchor="bottom left" self="top left"`     | `side="bottom" align="start"`                     | See full mapping table in migration guide                |
| `anchor="bottom middle" self="top middle"` | `side="bottom" align="center"`                    |                                                          |
| `anchor="top middle" self="bottom middle"` | `side="top" align="center"`                       |                                                          |
| `anchor="bottom right" self="top right"`   | `side="bottom" align="end"`                       |                                                          |
| `anchor="center right" self="center left"` | `side="right" align="center"`                     |                                                          |
| `v-model="show"`                           | `v-model:open="show"`                             | Rename                                                   |
| `@show="fn"`                               | `@update:open="(v) => v && fn()"`                 | Open only                                                |
| `@hide="fn"`                               | `@update:open="(v) => !v && fn()"`                | Close only                                               |
| `v-close-popup` on `q-item`                | Remove — `@select` on `ODropdownItem` auto-closes |                                                          |
| `v-close-popup` on non-item                | Manage via `v-model:open` manually                |                                                          |
| `content-style="z-index: 10001"`           | Drop — ODropdown uses `z-[6000]`                  |                                                          |
| `transition-show` / `transition-hide`      | Drop — built-in animation                         |                                                          |
| `fit`                                      | Not yet supported — workaround: CSS var           |                                                          |
| `.q-menu { }` CSS                          | Rename to custom class on content wrapper         |                                                          |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done · `[!]` = complex / needs special handling

---

### Template Usages (`<q-menu>` in `<template>`)

#### Simple Action List — Pattern 1

Items are `q-item[clickable]` rows. Migrate to `ODropdownItem` children.

- [ ] `src/views/Dashboards/addPanel/Group.vue` — `v-model="showAddMenu"`, 2 items (Add Condition, Add Group)
- [ ] `src/components/pipeline/PipelinesList.vue` — 2 separate `<q-menu>` instances (context menus on pipeline rows)
- [ ] `src/components/common/sidebar/FolderList.vue` — context menu on folder rows

#### Dashboard Query Builder Field Menus — Pattern 1 + 4

Each field chip in the query builder (x/y/z axes, breakdowns) has a config menu. Uses `@show` pattern.

- [ ] `src/components/dashboards/addPanel/DashboardQueryBuilder.vue` — 4 instances (x, y, breakdown, filter field config menus)
- [ ] `src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` — 3 instances
- [ ] `src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` — 2 instances
- [ ] `src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` — 3 instances
- [ ] `src/views/Dashboards/addPanel/AddCondition.vue` — `class="q-pa-md" @show="loadFilterItem"` — Pattern 4
- [ ] `src/views/Dashboards/addPanel/DashboardJoinsOption.vue` — field config menu

#### PromQL Builder Menus — Pattern 1 + 4

- [ ] `src/components/promql/components/OperationsList.vue` — `class="q-pa-md"`, inside a filter chip
- [ ] `src/components/promql/components/LabelFilterEditor.vue` — `class="q-pa-md"`, filter value picker

#### Syntax Guide Panels — Pattern 2

Non-interactive documentation card toggled by a button. Content moves into the default slot.

- [ ] `src/plugins/logs/SyntaxGuide.vue` — `:class` theme toggle, syntax guide panel
- [ ] `src/plugins/metrics/SyntaxGuideMetrics.vue` — `:class` theme toggle, metrics syntax guide
- [ ] `src/plugins/metrics/MetricLegends.vue` — `:class` theme toggle, legend info panel
- [ ] `src/plugins/traces/SyntaxGuide.vue` — `data-test="syntax-guide-menu"`, trace query guide

#### ServiceIdentity Context Menu — Pattern 1

- [ ] `src/components/settings/ServiceIdentitySetup.vue` — `anchor="bottom left" self="top left"`, action menu

#### AlertList Context Menu — Pattern 1

- [ ] `src/components/alerts/AlertList.vue` — row action menu (edit, clone, delete, etc.)

#### SearchBar Menus — Pattern 3 + 4

- [ ] `src/plugins/logs/SearchBar.vue` — 3 instances:
  - Line 436: suggestions menu `anchor="bottom left" self="top left"`
  - Line 652: simple overflow menu (no positioning attrs)
  - Line 713: download format menu `v-model="showDownloadMenu" anchor="top end" self="top start" :offset="[0,0]"` — **controlled**

#### DateTime / DateTimePicker Menus — Pattern 3

Large date-picker UI rendered inside the menu. Requires controlled open state.

- [ ] `src/components/DateTimePicker.vue` — `no-route-dismiss id="date-time-menu" class="date-time-dialog" anchor="bottom left" self="top left"` — **complex content**
- [ ] `src/components/DateTime.vue` — `@before-show @before-hide @hide @show` lifecycle hooks — **complex content**
- [ ] `src/components/CustomDateTimePicker.vue` — date picker variant

#### AutoRefreshInterval Menu — Pattern 3

- [ ] `src/components/AutoRefreshInterval.vue` — `content-style="z-index: 10001"`, interval buttons — **complex content**

#### Header Menus — Pattern 3 + 5 (Complex)

- [!] `src/components/Header.vue` — **4 instances**, requires special handling:
  - **Organization selector** (`anchor="bottom middle" self="top middle"`) — contains `q-table` with search — Pattern 3
  - **Help menu** (`fit anchor="bottom right" self="top right" transition-show="jump-down"`) — simple action list — Pattern 1
  - **User profile menu** (`fit anchor="bottom right" self="top right" transition-show="jump-down"`) — contains a language sub-menu — **Pattern 5 ⚠ nested sub-menu not supported by ODropdown**
  - A fourth `<q-menu>` instance (line 223)

  > The language selector nested sub-menu requires a custom workaround — do not use `ODropdown` nesting. Consider a flat panel or a separate `ODialog`.

---

### CSS-Only References (`.q-menu` in `<style>`)

These files do not have `<q-menu>` in the template but override `.q-menu` styles. Each needs a custom class added to the content wrapper and the CSS selector renamed.

- [ ] `src/plugins/traces/TraceDetails.vue` — 4 rules (active, dark-active, focused, dark-focused item overrides)
- [ ] `src/plugins/traces/IndexList.vue` — 1 rule
- [ ] `src/plugins/logs/components/FieldList.vue` — 1 rule
- [ ] `src/plugins/metrics/MetricList.vue` — 2 rules
- [ ] `src/components/dashboards/addPanel/FieldList.vue` — 1 rule
- [ ] `src/components/dashboards/addPanel/DashboardQueryBuilder.vue` — 1 rule (also has template usage above)
- [ ] `src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` — 1 rule (also has template usage above)
- [ ] `src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` — 1 rule (also has template usage above)
- [ ] `src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` — 1 rule (also has template usage above)
- [ ] `src/components/promql/components/OperationsList.vue` — 1 rule (also has template usage above)
- [ ] `src/components/promql/components/LabelFilterEditor.vue` — 1 rule (also has template usage above)
- [ ] `src/components/iam/users/UpdateRole.vue` — 1 rule
- [ ] `src/plugins/logs/SearchBar.vue` — 1 rule (also has template usage above)

---

## Migration Order (Recommended)

Migrate from simplest to most complex to build familiarity:

```
Tier 1 — Simple action lists (no state, no lifecycle events)
1.  Group.vue                             (2 items, controlled v-model)
2.  FolderList.vue                        (context menu, no state)
3.  PipelinesList.vue                     (2 row action menus)
4.  ServiceIdentitySetup.vue              (action menu)
5.  AlertList.vue                         (row action menu)

Tier 2 — Themed panels (non-interactive content)
6.  logs/SyntaxGuide.vue                  (theme class, no events)
7.  metrics/SyntaxGuideMetrics.vue        (theme class, no events)
8.  metrics/MetricLegends.vue             (theme class, no events)
9.  traces/SyntaxGuide.vue                (data-test, theme class)

Tier 3 — PromQL / Dashboard field menus (event-driven)
10. OperationsList.vue                    (q-pa-md, Pattern 4)
11. LabelFilterEditor.vue                 (q-pa-md, Pattern 4)
12. AddCondition.vue                      (@show, Pattern 4)
13. DashboardQueryBuilder.vue             (4 instances, Pattern 4)
14. DashboardSankeyChartBuilder.vue       (3 instances)
15. DashboardMapsQueryBuilder.vue         (2 instances)
16. DashboardGeoMapsQueryBuilder.vue      (3 instances)
17. DashboardJoinsOption.vue

Tier 4 — Controlled complex content
18. AutoRefreshInterval.vue               (content-style z-index)
19. SearchBar.vue                         (3 instances, one controlled)
20. DateTimePicker.vue                    (no-route-dismiss, complex content)
21. DateTime.vue                          (lifecycle events)
22. CustomDateTimePicker.vue

Tier 5 — Header (most complex, nested sub-menu workaround needed)
23. Header.vue                            (4 instances including nested language sub-menu)
```

---

## CSS Migration Notes

For each file in the CSS-only list:

1. Identify the ODropdown usage that created the popup (may be in a parent component).
2. Add a unique class (e.g. `my-component-dropdown-content`) to a `<div>` wrapper inside the ODropdown default slot.
3. In the `<style>` block, change `.q-menu` to `.my-component-dropdown-content`.

Example for `UpdateRole.vue` (CSS-only, the menu is in a parent component):

- The `.q-menu` CSS rule in `UpdateRole.vue` overrides the popup that `q-select` creates. After `q-select` is migrated to `OSelect`, the override may no longer be needed at all — verify and remove.
