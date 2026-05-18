# Quasar List Components — Migration Checklist

Tracks every file that uses a legacy Quasar list component and the replacement to use.

## Replacement Map

| Quasar                               | Replacement                                                                          | Context                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `<q-list>` inside `q-menu`           | **Delete** — not needed inside `ODropdown`                                           | Dropdown                                                                    |
| `<q-list>` standalone                | `<ul class="tw:flex tw:flex-col">` or `<div>`                                        | Display                                                                     |
| `<q-item clickable>` inside `q-menu` | `<ODropdownItem>`                                                                    | Dropdown — import `@/lib/overlay/Dropdown/ODropdownItem.vue`                |
| `<q-item v-bind="scope.itemProps">`  | OSelect `#option` slot — handled by OSelect migration                                | Select option                                                               |
| `<q-item>` (non-clickable)           | `<li class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2">`                      | Display                                                                     |
| `<q-item-section>`                   | `<div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">`                             | Layout                                                                      |
| `<q-item-section avatar>`            | `<div class="tw:flex tw:items-center tw:shrink-0">` or `#icon-left` slot             | Layout                                                                      |
| `<q-item-section side>`              | `<div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">` or `#icon-right` slot | Layout                                                                      |
| `<q-item-label>`                     | Plain text / `<span class="tw:text-sm">`                                             | Text                                                                        |
| `<q-item-label caption>`             | `<span class="tw:block tw:text-xs tw:text-muted-foreground">`                        | Text                                                                        |
| `<q-item-label header>`              | `<ODropdownGroup :label="...">`                                                      | Dropdown group heading — import `@/lib/overlay/Dropdown/ODropdownGroup.vue` |

> **Rule:** Identify the context first (A=dropdown, B=select-option, C=nav, D=display) before choosing a replacement.  
> See `quasar-list-components-migration.md` for before/after examples for each context.

---

## Key Prop Changes

### q-list

| q-list prop | Replacement in display context                   | Notes     |
| ----------- | ------------------------------------------------ | --------- |
| `separator` | `class="tw:divide-y tw:divide-border"` on `<ul>` |           |
| `bordered`  | `class="tw:border tw:rounded-md"` on `<ul>`      |           |
| `dense`     | Drop — items control their own padding           |           |
| `style`     | Inline style on native element                   | unchanged |
| `data-test` | `data-test` on native element                    | unchanged |

### q-item

| q-item prop                | ODropdownItem prop   | Display (native)  | Notes                               |
| -------------------------- | -------------------- | ----------------- | ----------------------------------- |
| `clickable`                | — (always clickable) | Drop              | ODropdownItem is always interactive |
| `dense`                    | —                    | Drop              | Baked in / not needed               |
| `v-ripple`                 | —                    | Drop              | No ripple in O2                     |
| `tag="label"`              | —                    | Wrap in `<label>` | If needed for checkbox association  |
| `:disable`                 | `:disabled`          | `disabled` attr   | Rename                              |
| `@click`                   | `@select`            | `@click`          | Renamed in dropdown context         |
| `v-close-popup`            | —                    | Drop              | ODropdown auto-closes on select     |
| `v-bind="scope.itemProps"` | —                    | —                 | Handled by OSelect migration        |

### q-item-section

| q-item-section variant   | Tailwind replacement                                           | ODropdownItem slot |
| ------------------------ | -------------------------------------------------------------- | ------------------ |
| `(default)` main content | `<div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">`       | `#default` content |
| `avatar`                 | `<div class="tw:flex tw:items-center tw:shrink-0">`            | `#icon-left`       |
| `side`                   | `<div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">` | `#icon-right`      |
| `top`                    | Add `tw:self-start`                                            | —                  |
| `dense`                  | Drop                                                           | —                  |
| `@click.stop`            | `<div @click.stop>`                                            | —                  |
| `v-close-popup`          | Drop (auto-close in ODropdown)                                 | —                  |

### q-item-label

| q-item-label variant | Replacement                                                                                 | Notes                                    |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `(default)` primary  | Plain text or `<span class="tw:text-sm">`                                                   | Main label                               |
| `caption`            | `<span class="tw:block tw:text-xs tw:text-muted-foreground">`                               |                                          |
| `header`             | `ODropdownGroup` `:label` prop                                                              | The ONLY case mapping to an O2 component |
| `overline`           | `<span class="tw:block tw:text-xs tw:uppercase tw:tracking-wide tw:text-muted-foreground">` | Not used in codebase                     |
| `lines="1"`          | `class="tw:truncate"`                                                                       | Add to the span                          |
| `lines="2"`          | `class="tw:line-clamp-2"`                                                                   | Add to the span                          |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done

> **Do NOT migrate Context B (q-select option slots) independently** — they are part of the `q-select → OSelect` migration. See `quasar-form-migration-checklist.md`.  
> **Do NOT rush Context C (MenuLink.vue navigation)** — requires a full nav redesign.

---

### Context A — `q-menu` + `q-list` + `q-item[clickable]` → `ODropdown` + `ODropdownItem`

Replace the `q-menu` wrapper with `ODropdown`, delete `q-list`, replace clickable `q-item` with `ODropdownItem`, decompose `q-item-section` into `#icon-left` / `#default` / `#icon-right` slots.

**Definition:** files that contain **both** `<q-menu>` and at least one of `<q-list>` / `<q-item>` / `<q-item-section>` / `<q-item-label>`. 10 files.

- [ ] `src/components/Header.vue` _(3 `<q-menu>` instances — help menu, user profile, nested language sub-menu)_
- [ ] `src/components/O2AIChat.vue` _(1 menu — chat history)_
- [ ] `src/components/alerts/AlertList.vue` _(row action menu)_
- [ ] `src/components/common/sidebar/FolderList.vue` _(folder context menu)_
- [ ] `src/components/pipeline/PipelinesList.vue` _(2 row context menus)_
- [ ] `src/components/promql/components/OperationsList.vue` _(field config menu — Pattern 4)_
- [ ] `src/components/promql/components/LabelFilterEditor.vue` _(field config menu — mixed A+B, also has itemProps)_
- [ ] `src/plugins/logs/SearchBar.vue` _(3 menus: suggestions, overflow, download — highest complexity, also has Edge Case 1 inner-section click pattern)_
- [ ] `src/views/Dashboards/addPanel/AddCondition.vue` _(mixed A+B — menu AND OSelect option slot with itemProps)_
- [ ] `src/views/Dashboards/addPanel/Group.vue` _(1 menu — add condition / add group)_

> q-menu-only files (no list components inside) — `AutoRefreshInterval`, `CustomDateTimePicker`, `DateTime`, `DateTimePicker`, `DashboardGeoMapsQueryBuilder`, `DashboardMapsQueryBuilder`, `DashboardQueryBuilder`, `DashboardSankeyChartBuilder`, `DashboardJoinsOption`, `ServiceIdentitySetup`, `logs/SyntaxGuide`, `metrics/MetricLegends`, `metrics/SyntaxGuideMetrics`, `traces/SyntaxGuide` — only need the q-menu migration; tracked in `quasar-menu-migration-checklist.md`.

---

### Context B — `OSelect` / `q-select` `#option` slots (Migrate WITH OSelect, not independently)

> These files contain `q-item v-bind="(scope|props).itemProps"` inside an `OSelect` (or, in one remaining case, `q-select`) `#option` slot.  
> Migrate together with the OSelect option-slot cleanup. See `quasar-form-migration-checklist.md`.

**Definition:** files matching `grep -rl 'v-bind="(scope.|props.)?itemProps"'`. 9 files. Only `logstream/schema.vue` still uses a literal `<q-select>` — the rest already render through `<OSelect>` and just need the slot internals modernised.

- [ ] `src/components/alerts/SemanticFieldGroupsConfig.vue`
- [ ] `src/components/dashboards/addPanel/PromQLChartConfig.vue`
- [ ] `src/components/logstream/schema.vue` _(only file still using `<q-select>`)_
- [ ] `src/components/pipeline/ImportPipeline.vue`
- [ ] `src/components/pipeline/NodeForm/ExternalDestination.vue`
- [ ] `src/components/promql/components/LabelFilterEditor.vue` _(mixed A+B)_
- [ ] `src/components/reports/CreateReport.vue`
- [ ] `src/plugins/metrics/MetricList.vue`
- [ ] `src/views/Dashboards/addPanel/AddCondition.vue` _(mixed A+B)_

---

### Context C — Navigation Sidebar (Migrate as part of nav redesign — do not rush)

> Files that use `q-item` as a styled navigation link with deep CSS class selectors on `.q-item`.  
> Requires a full navigation redesign — coordinate with the nav team before touching.

- [ ] `src/components/MenuLink.vue` _(core nav link component — ~200 lines of `.q-item` CSS)_

> `common/sidebar/FolderList.vue` was previously categorised here; its remaining `<q-item>` usage is inside a `<q-menu>` context menu and is now covered by **Context A** above.  
> `common/sidebar/SelectFolderDropDown.vue` no longer contains `q-item` / `q-list` — removed.

---

### Context D — Standalone Display Rows (Replace with native HTML + Tailwind)

> Files that use non-clickable `q-item` rows to display read-only info, with **no** `<q-menu>` wrapper and **no** `itemProps` binding. Replace with `<li>` / `<div>` + Tailwind flex.

**Definition:** files in the 48-file total minus Context A (10) minus Context B unique (7) minus Context C (1). 30 files.

- [ ] `src/components/alerts/AlertHistory.vue`
- [ ] `src/components/alerts/ImportSemanticGroups.vue`
- [ ] `src/components/alerts/ImportSemanticGroupsDrawer.vue`
- [ ] `src/components/alerts/QueryEditorDialog.vue`
- [ ] `src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue`
- [ ] `src/components/common/DualListSelector.vue`
- [ ] `src/components/common/FieldValuesPanel.vue`
- [ ] `src/components/cross-linking/CrossLinkDialog.vue`
- [ ] `src/components/dashboards/AddDashboardFromGitHub.vue`
- [ ] `src/components/dashboards/addPanel/AddAnnotation.vue`
- [ ] `src/components/dashboards/addPanel/ChartSelection.vue`
- [ ] `src/components/dashboards/addPanel/StreamFieldSelect.vue`
- [ ] `src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue`
- [ ] `src/components/functions/EnrichmentTableList.vue`
- [ ] `src/components/functions/FunctionList.vue`
- [ ] `src/components/ingestion/recommended/AWSIntegrationTile.vue`
- [ ] `src/components/settings/BuiltInPatternsTab.vue`
- [ ] `src/components/settings/Nodes.vue`
- [ ] `src/components/shared/filter/FilterCreatorPopup.vue`
- [ ] `src/plugins/correlation/CorrelatedLogsTable.vue`
- [ ] `src/plugins/correlation/TelemetryCorrelationDashboard.vue`
- [ ] `src/plugins/logs/FunctionSelector.vue`
- [ ] `src/plugins/logs/Index.vue`
- [ ] `src/plugins/logs/TransformSelector.vue`
- [ ] `src/plugins/traces/Index.vue`
- [ ] `src/plugins/traces/ServiceGraphNodeSidePanel.vue`
- [ ] `src/plugins/traces/TraceDetailsSidebar.vue` _(Edge Case 2 — contains `q-virtual-scroll`; handled by OSelect)_
- [ ] `src/plugins/traces/metrics/TracesAnalysisDashboard.vue`
- [ ] `src/views/DetailTable.vue`
- [ ] `src/views/RUM/SourceMaps.vue`

> Removed from previous version (files contain **no** `q-list` / `q-item` / `q-item-section` / `q-item-label` at all): `alerts/ImportAlert.vue`, `alerts/steps/AlertSettings.vue`, `anomaly_detection/steps/AnomalyAlerting.vue`, `dashboards/addPanel/DrilldownPopUp.vue`, `dashboards/addPanel/FieldList.vue`, `settings/DomainManagement.vue`, `settings/ServiceIdentitySetup.vue`, `plugins/logs/IndexList.vue`, `plugins/logs/JsonPreview.vue`.
