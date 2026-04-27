# Quasar → O2 Migration Guide

Full mapping of every Quasar component to its O2 equivalent, with prop translation tables.

---

## Component Map

| Quasar                                              | O2 Family   | Status     | Folder                    |
| --------------------------------------------------- | ----------- | ---------- | ------------------------- |
| `q-tabs` + `q-tab` + `q-tab-panels` + `q-tab-panel` | Tabs        | ✅ Built   | `navigation/Tabs/`        |
| `q-btn`                                             | Button      | ✅ Built   | `core/Button/`            |
| `q-separator`                                       | Separator   | ✅ Built   | `core/Separator/`         |
| `q-btn-group`                                       | ButtonGroup | 🔲 Planned | `core/Button/`            |
| `q-input`                                           | Input       | 🔲 Planned | `forms/Input/`            |
| `q-select`                                          | Select      | 🔲 Planned | `forms/Select/`           |
| `q-checkbox`                                        | Checkbox    | 🔲 Planned | `forms/Checkbox/`         |
| `q-radio`                                           | Radio       | 🔲 Planned | `forms/Radio/`            |
| `q-toggle`                                          | Switch      | 🔲 Planned | `forms/Switch/`           |
| `q-dialog`                                          | Modal       | 🔲 Planned | `overlay/Modal/`          |
| `q-tooltip`                                         | Tooltip     | 🔲 Planned | `overlay/Tooltip/`        |
| `q-menu`                                            | Dropdown    | 🔲 Planned | `overlay/Dropdown/`       |
| `q-badge`                                           | Badge       | 🔲 Planned | `core/Badge/`             |
| `q-chip`                                            | Tag         | 🔲 Planned | `core/Tag/`               |
| `q-card`                                            | Card        | 🔲 Planned | `core/Card/`              |
| `q-spinner`                                         | Spinner     | 🔲 Planned | `feedback/Spinner/`       |
| `q-linear-progress`                                 | Progress    | 🔲 Planned | `feedback/Progress/`      |
| `q-banner`                                          | Alert       | 🔲 Planned | `feedback/Alert/`         |
| `q-breadcrumbs` + `q-breadcrumbs-el`                | Breadcrumbs | 🔲 Planned | `navigation/Breadcrumbs/` |
| `q-pagination`                                      | Pagination  | 🔲 Planned | `navigation/Pagination/`  |
| `q-table`                                           | Table       | 🔲 Planned | `data/Table/`             |
| `q-tree`                                            | Tree        | 🔲 Planned | `data/Tree/`              |

---

## Tabs Family — Full Prop Translation

### OTabs (replaces `q-tabs`)

| Quasar prop                                                  | O2 prop                            | Change                         |
| ------------------------------------------------------------ | ---------------------------------- | ------------------------------ |
| `v-model`                                                    | `v-model`                          | ✅ Same                        |
| `dense`                                                      | `dense`                            | ✅ Same                        |
| `align` (`"left"` \| `"right"` \| `"center"` \| `"justify"`) | `align`                            | ✅ Same                        |
| `vertical`                                                   | `orientation="vertical"`           | ⚠️ Renamed                     |
| `inline-label`                                               | (removed)                          | ✅ Default behavior            |
| `no-caps`                                                    | (removed)                          | ✅ Default — no uppercase      |
| `indicator-color="transparent"`                              | (removed)                          | ✅ Default — no indicator      |
| `indicator-color="primary"`                                  | (removed)                          | ✅ Default — primary indicator |
| `active-color`                                               | (removed)                          | ✅ Baked into design tokens    |
| `narrow-indicator`                                           | (removed)                          | ✅ Default — narrow            |
| `outside-arrows`                                             | (removed — scroll arrows built-in) | ✅                             |
| `shrink`                                                     | (removed)                          | ✅ Not needed                  |
| `@update:model-value`                                        | `@update:modelValue`               | ✅ Same                        |

### OTab (replaces `q-tab`)

| Quasar prop                   | O2 prop                      | Change                                     |
| ----------------------------- | ---------------------------- | ------------------------------------------ |
| `name`                        | `name`                       | ✅ Same (required)                         |
| `label`                       | `label`                      | ✅ Same                                    |
| `icon`                        | `icon`                       | ✅ Same                                    |
| `no-caps`                     | (removed)                    | ✅ Baked in                                |
| `ripple=false`                | (removed)                    | ✅ No ripple                               |
| `content-class`               | (removed — use default slot) | ⚠️ Use slot                                |
| `disable`                     | `disabled`                   | ⚠️ Renamed                                 |
| Default slot (custom content) | Default slot                 | ✅ Same — slot takes priority over `label` |
| `v-ripple` directive          | (remove directive)           | ✅ No ripple                               |

### OTabPanels (replaces `q-tab-panels`)

| Quasar prop  | O2 prop                   | Change    |
| ------------ | ------------------------- | --------- |
| `v-model`    | `v-model`                 | ✅ Same   |
| `animated`   | `animated`                | ✅ Same   |
| `swipeable`  | (removed — not supported) | ⚠️ Remove |
| `keep-alive` | `keepAlive`               | ✅ Same   |
| `class`      | `class`                   | ✅ Same   |

### OTabPanel (replaces `q-tab-panel`)

| Quasar prop      | O2 prop                       | Change                                |
| ---------------- | ----------------------------- | ------------------------------------- |
| `name`           | `name`                        | ✅ Same (required)                    |
| `class="tw:p-0"` | (remove — no default padding) | ✅ No Quasar default padding to reset |
| Default slot     | Default slot                  | ✅ Same                               |

---

## Button Family — Full Prop Translation

### OButton (replaces `q-btn`)

| Quasar prop         | O2 prop                             | Change                            |
| ------------------- | ----------------------------------- | --------------------------------- |
| `label`             | Default slot                        | ⚠️ Use `<OButton>Label</OButton>` |
| `icon`              | `icon-left` slot                    | ⚠️ Use `<template #icon-left>`    |
| `icon-right`        | `icon-right` slot                   | ⚠️ Use `<template #icon-right>`   |
| `flat`              | `variant="ghost"`                   | ⚠️ Map variant                    |
| `outline`           | `variant="outline"`                 | ⚠️ Map variant                    |
| (default filled)    | `variant="primary"`                 | ✅ Default                        |
| `color="negative"`  | `variant="destructive"`             | ⚠️ Map variant                    |
| `color="secondary"` | `variant="secondary"`               | ⚠️ Map variant                    |
| `size="sm"`         | `size="sm"`                         | ✅ Same                           |
| `size="md"`         | `size="md"`                         | ✅ Same                           |
| `size="lg"`         | `size="lg"`                         | ✅ Same                           |
| `round` / `fab`     | `size="icon"` + icon slot           | ⚠️ Use icon variant               |
| `disable`           | `disabled`                          | ⚠️ Renamed                        |
| `loading`           | `loading`                           | ✅ Same                           |
| `type`              | `type`                              | ✅ Same                           |
| `@click`            | `@click`                            | ✅ Same                           |
| `to` (router)       | Use `<router-link>` wrapper         | ⚠️ OButton is not a link          |
| `no-caps`           | (removed — no uppercase by default) | ✅                                |
| `unelevated`        | (removed)                           | ✅ No elevation by default        |
| `ripple=false`      | (removed)                           | ✅ No ripple                      |

---

## Using the Audit Script

From the `web/` directory:

```bash
# Find all remaining q-tabs usages
node scripts/component-audit.mjs find --pattern "q-tabs|q-tab[^-]|<q-tab-panel" --dir src

# Analyze migration progress on current branch
node scripts/component-audit.mjs diff \
  --from "q-tabs|q-tab[^-]|q-tab-panel" \
  --to "OTabs|OTab[^P]|OTabPanel"

# Get migration status per module
node scripts/component-audit.mjs status \
  --from "q-tabs" \
  --to "OTabs"

# Output a Markdown report
node scripts/component-audit.mjs diff \
  --from "q-tabs|q-tab[^-]|q-tab-panel" \
  --to "OTabs|OTab[^P]|OTabPanel" \
  --format markdown
```
