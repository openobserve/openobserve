# OIcon Migration Tracker

Tracks the full replacement of `<q-icon>` with `<OIcon>` across the application.

> **Icons source**: `material-symbols-light` via `unplugin-icons` — all static imports, fully air-gap safe.
> **Registry**: `web/src/lib/core/Icon/OIcon.icons.ts`

---

## Quick Legend

| Symbol | Meaning |
|---|---|
| ✅ | Done |
| 🔲 | Ready to migrate now |
| 🔴 | Blocked — parent Quasar component must be migrated first |
| ⚠️ | Needs registry entry before migration |
| 🔁 | Dynamic binding — requires app-level mapping strategy |

---

## Pre-work: Missing Registry Entries ✅ DONE

These icon names appear in the codebase but were **not yet in `OIcon.icons.ts`**. All Phase 1 icons below have been added to the registry.

| Icon name (q-icon) | OIcon registry key | Status |
|---|---|---|
| `open_in_new` | `open-in-new` | ✅ added |
| `visibility_off` | `visibility-off` | ✅ added |
| `navigate_before` | `navigate-before` | ✅ added |
| `navigate_next` | `navigate-next` | ✅ added |
| `bolt` | `bolt` | ✅ added |
| `file_upload` | `file-upload` | ✅ added |
| `cached` | `cached` | ✅ added |
| `check` | `check` | ✅ added |
| `format_list_bulleted` | `format-list-bulleted` | ✅ added |
| `share` | `share` | ✅ added |
| `drive_file_move` | `drive-file-move` | 🔲 Phase 2b |
| `expand_less` | `expand-less` | 🔲 Phase 2b |
| `account_tree` | `account-tree` | 🔲 Phase 2b |
| `window` | `window` | 🔲 Phase 2b |
| `schema` | `schema` | 🔲 Phase 2b |

> **Note on `outlinedXxx` imports**: All `@quasar/extras/material-icons-outlined` constants (e.g. `outlinedDelete`, `outlinedEdit`, `outlinedWarning`, `outlinedDriveFileMove`) resolve to the same icon as the base name (`delete`, `edit`, `warning`, `drive-file-move`). Material Symbols Light is already the outlined/light style — no suffix needed.

---

## Phase 1 — OButton: `icon-left` / `icon-right` Props ✅ DONE

### What was implemented

Two optional props were added to `OButton` / `OButton.types.ts` with slot-fallback pattern:

```ts
iconLeft?: IconName;   // renders OIcon left of label; slot takes precedence
iconRight?: IconName;  // renders OIcon right of label; slot takes precedence
```

### OButton icon-left/icon-right call sites — ALL DONE

#### Dashboard / Panel ✅

| File | Before | After | Status |
|---|---|---|---|
| `views/Dashboards/ViewDashboard.vue:90` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `views/Dashboards/ViewDashboard.vue:143` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `views/Dashboards/ViewDashboard.vue:156` | `#icon-left` `refresh` | `icon-left="refresh"` | ✅ |
| `views/Dashboards/ViewDashboard.vue:187` | `#icon-left` `settings` | `icon-left="settings"` | ✅ |
| `views/Dashboards/ViewDashboard.vue:248` | `#icon-left` `code` | `icon-left="code"` | ✅ |
| `views/Dashboards/ScheduledDashboards.vue:90` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `views/Dashboards/addPanel/Group.vue:40` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `views/Dashboards/addPanel/Group.vue:64` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:47` | `#icon-right` `arrow_drop_down` | `icon-right="arrow-drop-down"` | ✅ |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:56` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:68` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `views/Dashboards/addPanel/AddPanel.vue:64` | `#icon-left` `info_outline` | `icon-left="info-outline"` | ✅ |
| `views/Dashboards/addPanel/AddJoinPopUp.vue:174` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `views/Dashboards/addPanel/AddJoinPopUp.vue:192` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `views/Dashboards/addPanel/AddCondition.vue:22` | `#icon-right` `arrow_drop_down` | `icon-right="arrow-drop-down"` | ✅ |
| `views/Dashboards/addPanel/AddCondition.vue:157` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `views/Dashboards/ImportDashboard.vue` | `#icon-left` `arrow_back_ios_new` | `icon-left="arrow-back-ios-new"` | ✅ |
| `views/Dashboards/PanelLayoutSettings.vue` | `#icon-left` (dynamic OIcon) | keep slot — dynamic | — |
| `components/dashboards/viewPanel/ViewPanel.vue:70` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/viewPanel/ViewPanel.vue:81` | `#icon-left` `refresh` | `icon-left="refresh"` | ✅ |
| `components/dashboards/viewPanel/ViewPanel.vue:94` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/VariablesValueSelector.vue:97` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/tabs/TabList.vue:67` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/tabs/AddTab.vue:44` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/OverrideConfigPopup.vue:16` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/OverrideConfigPopup.vue:114` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/SelectDashboardDropdown.vue:51` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/MoveDashboardToAnotherFolder.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/QueryInspector.vue:46` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/QueryInspector.vue:94` | `#icon-left` `content_copy` | `icon-left="content-copy"` | ✅ |
| `components/dashboards/QueryInspector.vue:123` | `#icon-left` `content_copy` | `icon-left="content-copy"` | ✅ |
| `components/dashboards/ExportDashboard.vue:23` | `#icon-left` `download` | `icon-left="download"` | ✅ |
| `components/dashboards/PanelSchemaRenderer.vue:212` | `#icon-left` `format_list_bulleted` | `icon-left="format-list-bulleted"` | ✅ |
| `components/dashboards/PanelContainer.vue:67` | `#icon-left` `fullscreen` | `icon-left="fullscreen"` | ✅ |
| `components/dashboards/PanelContainer.vue:105` | `#icon-left` `refresh` | `icon-left="refresh"` | ✅ |
| `components/dashboards/PanelContainer.vue:123` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/PanelContainer.vue:228` | `#icon-left` `search` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `components/dashboards/PanelContainer.vue:236` | `#icon-left` `cached` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `components/dashboards/SelectTabDropdown.vue:51` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/SelectFolderDropdown.vue:52` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/settings/common/DashboardHeader.vue:27` | `#icon-left` `arrow_back_ios_new` | `icon-left="arrow-back-ios-new"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:399` | `#icon-left` `info` | `icon-left="info"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:523` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:534` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:640` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:652` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:735` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/settings/AddSettingVariable.vue:752` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/settings/VariableSettings.vue:163` | `#icon-left` `edit` | `icon-left="edit"` | ✅ |
| `components/dashboards/settings/VariableSettings.vue:197` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/settings/TabsSettings.vue:88` | `#icon-left` `check` | `icon-left="check"` | ✅ |
| `components/dashboards/settings/TabsSettings.vue:97` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/settings/TabsSettings.vue:109` | `#icon-left` `edit` | `icon-left="edit"` | ✅ |
| `components/dashboards/settings/VariableAdHocValueSelector.vue:52` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/settings/SinglePanelMove.vue:71` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/addPanel/ColorBySeriesPopUp.vue:37` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/addPanel/ColorBySeriesPopUp.vue:143` | `#icon-left` `close` | `icon-left="close"` | ✅ |
| `components/dashboards/addPanel/ColorBySeries.vue:29` | `#icon-left` `info_outline` | `icon-left="info-outline"` | ✅ |
| `components/dashboards/addPanel/ConfigPanel.vue` | `#icon-left` `info_outline` (×7) | `icon-left="info-outline"` | ✅ |
| `components/dashboards/AddDashboard.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/AddDashboardFromGitHub.vue:32` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |
| `components/dashboards/AddDashboardFromGitHub.vue:187` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/dashboards/AddFolder.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` | ✅ |

#### Alerts ✅

| File | Before | After | Status |
|---|---|---|---|
| `components/alerts/AlertInsights.vue:164` | `#icon-left` `clear` | `icon-left="clear"` | ✅ |
| `components/alerts/AlertInsights.vue:188` | `#icon-left` `settings` | `icon-left="settings"` | ✅ |
| `components/alerts/AlertInsights.vue:199` | `#icon-left` `edit` | `icon-left="edit"` | ✅ |
| `components/alerts/AlertInsights.vue:210` | `#icon-left` `history` | `icon-left="history"` | ✅ |
| `components/alerts/AlertList.vue:49` | `#icon-left` `schedule` (OToggleGroupItem) | keep slot — Phase 2 OToggleGroup | — |
| `components/alerts/AlertList.vue:53` | `#icon-left` `bolt` (OToggleGroupItem) | keep slot — Phase 2 OToggleGroup | — |
| `components/alerts/AlertList.vue:57` | `#icon-left` `query_stats` (OToggleGroupItem) | keep slot — Phase 2 OToggleGroup | — |
| `components/alerts/AlertList.vue:139` | `#icon-left` `file_upload` | `icon-left="file-upload"` | ✅ |
| `components/alerts/AddDestination.vue:541` | `#icon-left` `preview` | `icon-left="preview"` | ✅ |
| `components/alerts/AddDestination.vue:551` | `#icon-left` `send` | `icon-left="send"` | ✅ |
| `components/alerts/AddAlert.vue:67` | `#icon-left` `replay` | `icon-left="replay"` | ✅ |
| `components/alerts/DestinationTestResult.vue:112` | `#icon-left` `refresh` | `icon-left="refresh"` | ✅ |
| `components/alerts/DestinationPreview.vue:264` | `#icon-left` `content_copy` | `icon-left="content-copy"` | ✅ |
| `components/alerts/FieldsInput.vue:31` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/alerts/PrebuiltDestinationForm.vue:415` | `#icon-left` `preview` | `icon-left="preview"` | ✅ |
| `components/alerts/PrebuiltDestinationForm.vue:425` | `#icon-left` `send` | `icon-left="send"` | ✅ |

#### Pagination ✅

| File | Before | After | Status |
|---|---|---|---|
| `components/shared/grid/Pagination.vue:116` | `#icon-left` `chevron_left` | `icon-left="chevron-left"` | ✅ |
| `components/shared/grid/Pagination.vue:124` | `#icon-left` `chevron_right` | `icon-left="chevron-right"` | ✅ |

#### Misc app-level components ✅

| File | Before | After | Status |
|---|---|---|---|
| `components/common/ShareButton.vue:27` | `#icon-left` `share` | `icon-left="share"` | ✅ |
| `components/settings/DomainManagement.vue:75` | `#icon-left` `help_outline` | `icon-left="help-outline"` | ✅ |
| `components/ai_toolsets/AddAiToolset.vue:167` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/ai_toolsets/AddAiToolset.vue:296` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `components/ai_toolsets/AddAiToolset.vue:343` | `#icon-left` `add` | `icon-left="add"` | ✅ |
| `enterprise/components/EvalTemplateEditor.vue:32` | `#icon-left` `ChevronLeft` (SVG component) | keep slot | — |

#### Log/Traces plugins ✅

| File | Before | After | Status |
|---|---|---|---|
| `plugins/logs/JsonPreview.vue:178` | `#icon-left` `visibility` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `plugins/logs/JsonPreview.vue:190` | `#icon-left` `open_in_new` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `plugins/logs/DetailTable.vue:213` | `#icon-left` `visibility` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `plugins/logs/DetailTable.vue:221` | `#icon-left` `visibility_off` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `plugins/logs/DetailTable.vue:233` | `#icon-left` `open_in_new` (ODropdownItem) | keep slot — Phase 2 ODropdown | — |
| `plugins/logs/SearchSchedulersList.vue:194` | `#icon-left` `search` | `icon-left="search"` | ✅ |
| `plugins/logs/patterns/PatternDetailsDialog.vue:279` | `#icon-left` `navigate_before` | `icon-left="navigate-before"` | ✅ |
| `plugins/logs/patterns/PatternDetailsDialog.vue:297` | `#icon-right` `navigate_next` | `icon-right="navigate-next"` | ✅ |
| `plugins/traces/ServiceGraph.vue:200` | `#icon-left` `refresh` | `icon-left="refresh"` | ✅ |

---

## Phase 2 — Standalone `q-icon` → `<OIcon>`

These are `q-icon` used as standalone elements (not inside OButton slots), in app-level components that do **not** have a Quasar parent blocking them.

### 2a — Straightforward: static `name="…"` ✅ DONE

| File | Line | Icon | Registry key | Notes | Status |
|---|---|---|---|---|---|
| `components/about/FeatureComparisonTable.vue` | 22 | `compare_arrows` | `compare-arrows` | | ✅ |
| `components/DatabaseDeprecationBanner.vue` | 37 | `close` | `close` | OButton slot → icon-left prop | ✅ |
| `components/alerts/AlertHistorySummary.vue` | 60 | `history` | `history` | | ✅ |
| `components/alerts/AlertHistory.vue` | 35,104,114,276,286,323,557 | OButton slots | icon-left props | | ✅ |
| `components/alerts/AlertHistory.vue` | 231,242,254 | `block`, `group_work`, `check_circle` | in registry | | ✅ |
| `components/alerts/AlertHistory.vue` | 470,499 | `error`, `check_circle` | in registry | detail dialog | ✅ |
| `components/alerts/AlertHistory.vue` | 542,547 | `error`, `schedule` | in registry | error dialog header | ✅ |
| `components/alerts/AlertHistory.vue` | 77 | `search` in q-select prepend | — | blocked by OInput | 🔴 |
| `components/alerts/AlertHistory.vue` | 176,190,388,399,406 | dynamic ternaries | — | Phase 2b | 🔲 |
| `components/alerts/AlertInsightsContextMenu.vue` | 38,46,54,65 | `tune`,`edit`,`history`,`close` | in registry | | ✅ |
| `components/TelemetryCorrelationPanel.vue` | 5 | `link` | `link` | | ✅ |
| `components/TelemetryCorrelationPanel.vue` | 13 | `close` | `close` | OButton slot → icon-left prop | ✅ |
| `components/TelemetryCorrelationPanel.vue` | 26,32 | `error_outline`, `info_outline` | `error-outline`, `info-outline` | color= stripped | ✅ |
| `components/TelemetryCorrelationPanel.vue` | 41,52 | `cloud`, `link` | `cloud`, `link` | color= stripped | ✅ |
| `components/TelemetryCorrelationPanel.vue` | 79,127,152,177 | `tune`,`timeline`,`show_chart`,`article` | in registry | color= stripped | ✅ |
| `components/functions/RetryJobDialog.vue` | 42 | `close` | `close` | OButton slot → icon-left prop | ✅ |
| `components/functions/RetryJobDialog.vue` | 61,86,107 | `warning`,`refresh`,`play_arrow` | in registry | standalone | ✅ |
| `components/shared/grid/NoPanel.vue` | 34 | `insert_drive_file` | `insert-drive-file` | OButton slot → icon-left prop | ✅ |
| `components/TenstackTable.vue` | 336,369 | `warning` | `warning` | | ✅ |
| `components/EnterpriseUpgradeDialog.vue` | 27 | `cancel` | `cancel` | OButton slot → icon-left prop | ✅ |
| `components/EnterpriseUpgradeDialog.vue` | 37 | `workspace_premium` | `workspace-premium` | size="xl" | ✅ |
| `components/EnterpriseUpgradeDialog.vue` | 105 | `info` | `info` | | ✅ |
| `components/WebinarBanner.vue` | 79,95 | `schedule`,`arrow_forward` | in registry | | ✅ |
| `components/actionScripts/FileItem.vue` | 27,30 | `edit`, `delete` | in registry | dynamic class kept | ✅ |
| `views/DetailTable.vue` | 28 | `cancel` | `cancel` | OButton slot → icon-left prop | ✅ |
| `views/About.vue` | 40–187 | 15 icons | all in registry | | ✅ |
| `views/UsageTab.vue` | 54 | `outlinedWindow` | `window` | Phase 2b | 🔲 |
| `views/UsageTab.vue` | 70,115,156,199,242,283,342,407,465,548 | `arrow_forward`,`arrow_upward`,`arrow_downward` | in registry | | ✅ |
| `views/RUM/UploadSourceMaps.vue` | 34,103,112 | `arrow_back_ios_new`,`cloud_upload`,`insert_drive_file` | in registry | color= stripped | ✅ |
| `views/RUM/UploadSourceMaps.vue` | 123 | `close` | `close` | OButton slot → icon-left prop | ✅ |
| `views/RUM/SessionViewer.vue` | 26–45 | 6 icons | in registry | | ✅ |
| `views/RUM/SessionViewer.vue` | 54 | `sentiment_very_dissatisfied` | not in registry | skipped — add to registry if needed | — |
| `views/RUM/RealUserMonitoring.vue` | 94 | `arrow_forward` | `arrow-forward` | OButton slot → icon-right prop | ✅ |
| `views/RUM/AppPerformance.vue` | 48 | `refresh` | `refresh` | OButton slot → icon-left prop | ✅ |
| `views/RUM/SourceMaps.vue` | 221 | `code` | `code` | color= stripped | ✅ |
| `views/PromQL/QueryBuilder.vue` | 53,61,70 | `content_copy`,`clear`,`play_arrow` | in registry | icon labels in OButton slot | ✅ |
| `views/Dashboards/Dashboards.vue` | 94 | `expand_more` | `expand-more` | OButton `#icon-right` template → icon-right prop | ✅ |
| `views/Dashboards/Dashboards.vue` | 175,257 | `add`,`more_vert` | `add`,`more-vert` | OButton slot → icon-left prop | ✅ |
| `views/Dashboards/Dashboards.vue` | 424 | `content_copy` | `content-copy` | OButton slot → icon-left prop | ✅ |
| `views/Dashboards/Dashboards.vue` | 469,482 | template #icon-left → `download`,`delete` | in registry | OButton #icon-left → icon-left prop | ✅ |
| `views/Dashboards/Dashboards.vue` | 54,198,260,269,407,450 | dynamic/q-input | — | blocked or Phase 2b | 🔲/🔴 |
| `views/Dashboards/addPanel/AddPanel.vue` | 136 | `keyboard_arrow_down` | `keyboard-arrow-down` | OButton slot → icon-left prop | ✅ |
| `views/Dashboards/addPanel/AddPanel.vue` | 141 | `refresh` | `refresh` | ODropdownItem standalone → OIcon | ✅ |
| `views/Ingestion.vue` | 62 | `search` | `search` | inside q-input context | 🔴 blocked |
| `enterprise/components/EvalTemplateList.vue` | 45 | `search` | `search` | inside q-input prepend | 🔴 blocked |
| `enterprise/components/EvalTemplateEditor.vue` | 47–134 | `info` | `info` | `q-icon` wrapping `q-tooltip` | 🔴 blocked |

### 2b — Dynamic bindings (`:name="variable"`) — `🔁` requires mapping

These use `:name` bound to a runtime string (Quasar extras constants or data-driven). Each one needs the variable resolved to an `IconName` registry key.

| File | Line | Current variable | Maps to | Action |
|---|---|---|---|---|
| `views/Dashboards/Dashboards.vue` | 265 | `outlinedEdit` | `"edit"` | Replace variable with string literal |
| `views/Dashboards/Dashboards.vue` | 274,434 | `outlinedDelete` | `"delete"` | Replace variable with string literal |
| `views/Dashboards/Dashboards.vue` | 412,456 | `outlinedDriveFileMove` | `"drive-file-move"` ⚠️ | Add to registry, replace variable |
| `views/RUM/SourceMaps.vue` | 173 | `outlinedDelete` | `"delete"` | Replace variable |
| `views/UsageTab.vue` | 54 | `outlinedWindow` | `"window"` ⚠️ | Add to registry, replace variable |
| `views/IdentityAccessManagement.vue` | 31 | `showSidebar ? 'chevron_left' : 'chevron_right'` | `"chevron-left"/"chevron-right"` | Use ternary with registry keys |
| `views/Functions.vue` | 141 | `showSidebar ? 'chevron_left' : 'chevron_right'` | `"chevron-left"/"chevron-right"` | Same |
| `components/AttributeValueCell.vue` | 16 | `isDropdownOpen ? 'expand_less' : 'expand_more'` | `"expand-less"/"expand-more"` | ⚠️ add `expand-less` |
| `components/actionScripts/ActionScripts.vue` | 120 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/alerts/AlertList.vue` | 451,466 | `outlinedDriveFileMove`, `outlinedDelete` | `"drive-file-move"`, `"delete"` | Replace variables |
| `components/alerts/AlertList.vue` | 634 | `outlinedDriveFileMove` | `"drive-file-move"` ⚠️ | |
| `components/alerts/TemplateList.vue` | 145 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/alerts/VariablesInput.vue` | 91 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/alerts/PipelinesDestinationList.vue` | 94 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/alerts/QueryEditorDialog.vue` | 339,395 | `outlinedWarning` | `"warning"` | Replace variable |
| `components/dashboards/settings/VariableSettings.vue` | 175 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/dashboards/settings/TabsSettings.vue` | 120 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/dashboards/PanelErrorButtons.vue` | 20,33 | `outlinedWarning` | `"warning"` | Replace variable |
| `components/dashboards/PanelContainer.vue` | 76 | `outlinedWarning` | `"warning"` | Replace variable |
| `components/functions/FunctionList.vue` | 98 | `outlinedAccountTree` | `"account-tree"` ⚠️ | Add to registry |
| `components/logstream/schema.vue` | 432–522 | `outlinedPerson`, `outlinedSchema` | `"person"`, `"schema"` ⚠️ | `schema` needs registry entry |
| `components/settings/ModelPricingList.vue` | 422,706,766 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/settings/ModelPricingEditor.vue` | 263,400 | `outlinedDelete` | `"delete"` | Replace variable |
| `components/ThemeSwitcher.vue` | 19 | `DarkModeIcon` | `"dark-mode"` / `"light-mode"` | Add 2 icons; use conditional instead of dynamic |
| `components/Header.vue` | 415 | `outlinedSettings` | `"settings"` | Replace variable |
| `components/EnterpriseUpgradeDialog.vue` | 69,119,162,183,206,167,188,211 | `dialogConfig.badgeIcon`, `dialogConfig.primaryButtonIcon`, `feature.icon` | data-driven | 🔁 requires a `string → IconName` map in the component |
| `components/AppTable.vue` | 130 | `col.icon` | data-driven | 🔁 requires a `string → IconName` map in the component or column def update |
| `components/MenuLink.vue` | 45,59 | `icon` prop (string) or `iconComponent` | nav icon system | 🔁 nav menu icons need a dedicated mapping — coordinate with nav migration |

---

## Phase 3 — Blocked by Quasar Parent Components 🔴

These `q-icon` usages are **inside Quasar component slots** (prepend/append of `q-input`, children of `q-list`/`q-item`, `q-popup-proxy`, etc.). They cannot be migrated until the parent Quasar component itself is replaced by an O2 equivalent.

| File | Line | Context | Blocked by |
|---|---|---|---|
| `components/DateTime.vue` | 32 | `<template #icon-left>` inside **q-btn** (Quasar btn, not OButton) | migrate DateTime to use OButton |
| `components/DateTime.vue` | 220,260 | `access_time` inside `q-popup-proxy` | replace with ODatePicker (future) |
| `components/DateTimePicker.vue` | 25 | `<template #icon-left>` inside Quasar q-btn | same |
| `components/DateTimePicker.vue` | 152,183 | `access_time` inside `q-popup-proxy` | replace with ODatePicker (future) |
| `components/CustomDateTimePicker.vue` | 16,20 | inside q-btn slots | same |
| `components/actionScripts/ActionScripts.vue` | 47 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/functions/EnrichmentTableList.vue` | 47 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/functions/EnrichmentSchema.vue` | 107 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/functions/AssociatedStreamFunction.vue` | 229 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/logstream/schema.vue` | 332 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/Header.vue` | 273 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `components/NLModeQueryBar.vue` | 77,87 | inside Quasar markup | audit context |
| `components/MenuLink.vue` | 45,59 | inside `q-item` | OListItem/nav migration |
| `views/LogStream.vue` | 75 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `views/Ingestion.vue` | 62 | standalone in q-input context | OInput not yet built |
| `views/Dashboards/Dashboards.vue` | 94 | `#icon-right` on q-btn (Quasar, not OButton) | confirm if OButton |
| `enterprise/components/EvalTemplateList.vue` | 45 | `q-icon` in `q-input #prepend` | OInput not yet built |
| `enterprise/components/EvalTemplateEditor.vue` | 47–134 | `q-icon` wrapping `q-tooltip` | OTooltip not yet built |
| `components/ScriptToolbar.vue` | 67 | closing `</q-icon>` — tooltip slot | OTooltip not yet built |
| `components/functions/FunctionsToolbar.vue` | 61,94 | `q-icon` wrapping `q-tooltip` | OTooltip not yet built |

---

## Phase 7 — `lucide-vue-next` Icons → `<OIcon>`

> **Package**: `lucide-vue-next` v0.562.0 (see `web/package.json`)
> **~90 unique icons across ~75 files.**
> **Strategy**: Map each Lucide component to the nearest `material-symbols-light` symbol, add to `OIcon.icons.ts`, then replace `<LucideComponent />` usages with `<OIcon name="..." />` and remove the `lucide-vue-next` import line.

> **Custom SVG icons** (`EqualIcon`, `NotEqualIcon`, `DynamicFilterIcon` in `components/icons/`) are **not** from lucide — they are hand-rolled SVGs used as slot children inside `<q-icon>` and `<OButton>`. Tracked separately.

---

### 7a — Unique Lucide icons (~90 total)

| Lucide component | Suggested OIcon key | Registry | Notes |
|---|---|---|---|
| `Activity` | `activity` | ⚠️ | `components/functions/TestFunction.vue` |
| `AlertCircle` | `error-outline` | ⚠️ map to existing | `components/pipelines/BackfillJobsList.vue` |
| `AlignLeft` | `align-horizontal-left` | ⚠️ | `plugins/logs/JsonPreview.vue`, `plugins/traces/TraceDetails.vue` |
| `ArrowDown` | `arrow-downward` | ⚠️ | `components/anomaly_detection/AnomalySummary.vue` |
| `BarChart2` | `bar-chart` | ⚠️ | `components/functions/TestFunction.vue`, `views/LogStream.vue`, `components/pipeline/NodeForm/ScheduledPipeline.vue` |
| `Bell` | `notifications` | ⚠️ | `components/alerts/AddAlert.vue`, `components/settings/CorrelationSettings.vue` |
| `Bookmark` | `bookmark` | ⚠️ | `plugins/logs/SearchBar.vue` |
| `Bot` | `smart-toy` | ⚠️ | `components/iam/groups/EditGroup.vue`, `components/iam/roles/EditRole.vue` |
| `Braces` | `data-object` | ⚠️ | `components/alerts/steps/Advanced.vue`, `components/iam/roles/EditRole.vue`, `components/iam/quota/Quota.vue`, `plugins/traces/TraceDetailsSidebar.vue` |
| `BrainCircuit` | — | 🔁 no equivalent | `components/anomaly_detection/AnomalyDetectionList.vue` — keep lucide or custom SVG |
| `Building2` | `business` | ⚠️ | `components/settings/ModelPricingList.vue` |
| `CalendarClock` | `schedule` | ⚠️ | `components/alerts/AlertList.vue`, `views/Dashboards/ScheduledDashboards.vue`, `components/reports/ReportList.vue` |
| `ChartLine` | `show-chart` | ⚠️ | `components/alerts/steps/QueryConfig.vue`, `components/dashboards/addPanel/QueryTypeSelector.vue`, `plugins/logs/SearchBar.vue` |
| `ChartNoAxesColumn` | `bar-chart` | ⚠️ | `plugins/logs/SearchBar.vue` |
| `Check` | `check` | ✅ | `plugins/logs/SearchJobInspector.vue` |
| `CheckSquare` | `check-box` | ⚠️ | `components/iam/roles/EditRole.vue` |
| `ChevronDown` | `expand-more` | ⚠️ | `components/functions/AssociatedStreamFunction.vue`, `components/pipeline/PipelinesList.vue` |
| `ChevronLeft` | `chevron-left` | ✅ | many files |
| `ChevronRight` | `chevron-right` | ✅ | many files |
| `ChevronsUpDown` | `unfold-more` | ⚠️ | `components/pipelines/CreateBackfillJobDialog.vue` |
| `ChevronUp` | `expand-less` | ⚠️ Phase 2b | `components/functions/AssociatedStreamFunction.vue`, `components/pipeline/PipelinesList.vue` |
| `ClipboardCheck` | `assignment-turned-in` | ⚠️ | `plugins/traces/TraceDetails.vue` |
| `Clock` | `access-time` | ⚠️ | `components/iam/quota/Quota.vue` |
| `Code2` | `code` | ✅ | `components/alerts/AlertHistoryDrawer.vue`, `components/pipeline/PipelineEditor.vue`, `plugins/logs/SearchHistory.vue`, `plugins/logs/SearchSchedulersList.vue`, `components/dashboards/addPanel/QueryTypeSelector.vue`, `components/pipeline/NodeForm/ScheduledPipeline.vue` |
| `Copy` | `content-copy` | ✅ | `components/rum/EventDetailDrawerContent.vue`, `components/rum/correlation/TraceCorrelationCard.vue`, `plugins/logs/SearchJobInspector.vue` |
| `Database` | `database` | ⚠️ | `components/alerts/steps/QueryConfig.vue`, `components/dashboards/addPanel/QueryTypeSelector.vue`, `views/Dashboards/ScheduledDashboards.vue`, `components/reports/ReportList.vue`, `enterprise/components/billings/Billing.vue`, `components/iam/roles/EditRole.vue` |
| `Download` | `download` | ✅ | `components/settings/RegexPatternList.vue`, `components/functions/EnrichmentTableList.vue`, `components/logstream/explore/SearchBar.vue`, `components/rum/SearchBar.vue`, `enterprise/components/billings/invoiceTable.vue`, `components/pipeline/PipelinesList.vue` |
| `Ellipsis` | `more-horiz` | ⚠️ | `plugins/logs/SearchBar.vue` |
| `ExternalLink` | `open-in-new` | ✅ | `components/settings/DomainManagement.vue`, `plugins/correlation/TelemetryCorrelationDashboard.vue` |
| `Eye` | `visibility` | ✅ | `components/pipelines/BackfillJobsList.vue`, `components/pipeline/PipelinesList.vue` |
| `FileJson` | `description` | ⚠️ | `plugins/logs/JsonPreview.vue` |
| `FileText` | `description` | ⚠️ | `components/functions/TestFunction.vue`, `views/LogStream.vue` |
| `Flame` | — | 🔁 no equivalent | `plugins/traces/TraceDetails.vue` — keep lucide |
| `FolderInput` | `drive-file-move` | ⚠️ Phase 2b | `components/reports/ReportList.vue` |
| `Gauge` | `speed` | ⚠️ | `components/iam/quota/Quota.vue` |
| `GitBranch` | — | 🔁 no close equivalent | `components/alerts/FilterGroup.vue`, `components/rum/EventDetailDrawerContent.vue`, `plugins/traces/SearchBar.vue`, `plugins/traces/TraceDetails.vue` — keep lucide or `fork-right` |
| `GitFork` | `fork-right` | ⚠️ | `views/LogStream.vue` |
| `GitMerge` | `merge` | ⚠️ | `components/alerts/FilterGroup.vue` |
| `HardDrive` | `storage` | ⚠️ | `enterprise/components/billings/Billing.vue` |
| `HelpCircle` | `help` | ⚠️ | `components/cross-linking/CrossLinkUserGuide.vue`, `plugins/logs/SyntaxGuide.vue`, `plugins/traces/SyntaxGuide.vue`, `plugins/metrics/SyntaxGuideMetrics.vue` |
| `History` | `history` | ✅ | `components/alerts/AlertHistoryDrawer.vue` |
| `Hourglass` | `hourglass-empty` | ⚠️ | `components/iam/quota/Quota.vue` |
| `Info` | `info` | ✅ | `plugins/logs/SearchHistory.vue`, `plugins/logs/SearchSchedulersList.vue`, `views/LogStream.vue` |
| `Infinity` | `all-inclusive` | ⚠️ | `plugins/correlation/DimensionFilterEditor.vue` |
| `Layers` | `layers` | ⚠️ | `plugins/traces/SearchBar.vue`, `plugins/logs/SearchBar.vue` |
| `LayoutList` | `format-list-bulleted` | ✅ | `components/alerts/AlertList.vue`, `components/logstream/schema.vue`, `components/settings/ModelPricingList.vue`, `components/iam/roles/EditRole.vue`, `components/functions/EnrichmentTableList.vue` |
| `Link` | `link` | ✅ | `components/settings/ImportRegexPattern.vue`, `components/functions/EnrichmentTableList.vue`, `components/common/BaseImport.vue` |
| `Link2` | `link` | ✅ | `components/settings/CorrelationSettings.vue` |
| `List` | `format-list-bulleted` | ✅ | `components/functions/EnrichmentTableList.vue`, `components/rum/ResourceDetailDrawer.vue`, `components/queries/RunningQueriesList.vue` |
| `Mail` | `mail` | ⚠️ | `components/alerts/AddTemplate.vue`, `components/alerts/AddDestination.vue` |
| `Maximize` | `fullscreen` | ✅ | `components/functions/FunctionsToolbar.vue`, `plugins/logs/SearchBar.vue` |
| `Maximize2` | `open-in-full` | ⚠️ | `components/pipeline/PipelineEditor.vue`, `components/pipeline/NodeForm/ScheduledPipeline.vue` |
| `MessageSquare` | `chat` | ⚠️ | `plugins/traces/TraceDetails.vue` |
| `Minimize` | `fullscreen-exit` | ⚠️ | `plugins/logs/SearchBar.vue` |
| `Minimize2` | `close-fullscreen` | ⚠️ | `components/pipeline/PipelineEditor.vue`, `components/pipeline/NodeForm/ScheduledPipeline.vue` |
| `MoreVertical` | `more-vert` | ✅ | `components/pipeline/PipelinesList.vue` |
| `Navigation` | `navigation` | ⚠️ | `components/rum/PlayerEventsSidebar.vue` |
| `Network` | `account-tree` | ⚠️ Phase 2b | `plugins/traces/SearchBar.vue`, `src/mixins/mainLayout.mixin.ts`, `src/enterprise/mixins/mainLayout.mixin.ts` |
| `Pause` | `pause` | ⚠️ | `components/pipelines/BackfillJobsList.vue`, `components/anomaly_detection/AnomalyDetectionList.vue`, `components/reports/ReportList.vue`, `components/pipeline/PipelinesList.vue` |
| `Pencil` | `edit` | ✅ | `components/settings/RegexPatternList.vue`, `components/settings/General.vue`, `components/settings/CipherKeys.vue`, `components/settings/AiToolsets.vue`, `components/functions/FunctionList.vue`, `components/functions/EnrichmentTableList.vue`, `components/anomaly_detection/AnomalyDetectionList.vue`, `components/pipelines/BackfillJobsList.vue`, `enterprise/components/EvalTemplateList.vue`, `components/cross-linking/CrossLinkManager.vue`, `components/reports/ReportList.vue`, `components/pipeline/PipelinesList.vue` |
| `Play` | `play-arrow` | ✅ | `components/functions/FunctionsToolbar.vue`, `components/pipelines/BackfillJobsList.vue`, `components/anomaly_detection/AnomalyDetectionList.vue`, `components/reports/ReportList.vue`, `components/pipeline/PipelinesList.vue` |
| `PlayCircle` | `play-circle` | ⚠️ | `components/rum/ResourceDetailDrawer.vue`, `components/rum/errorTracking/view/ErrorSessionReplay.vue` |
| `Plus` | `add` | ✅ | `components/settings/ServiceIdentitySetup.vue`, `components/logstream/StreamFieldInputs.vue`, `components/logstream/schema.vue`, `components/logstream/AssociatedRegexPatterns.vue`, `plugins/metrics/MetricList.vue`, `components/pipeline/NodeForm/CreateDestinationForm.vue`, `components/pipeline/NodeForm/ScheduledPipeline.vue`, `components/cross-linking/CrossLinkManager.vue`, `components/cross-linking/CrossLinkDialog.vue` |
| `RefreshCcw` | `refresh` | ✅ | `plugins/logs/SearchBar.vue` |
| `RefreshCw` | `refresh` | ✅ | `components/settings/DomainManagement.vue`, `components/settings/DiscoveredServices.vue`, `components/logstream/LlmEvaluationSettings.vue`, `components/functions/AssociatedStreamFunction.vue`, `components/pipeline/NodeForm/LlmEvaluation.vue`, `components/pipelines/PipelineHistory.vue`, `components/pipelines/BackfillJobsList.vue`, `components/anomaly_detection/steps/AnomalyAlerting.vue`, `components/anomaly_detection/AnomalyDetectionList.vue`, `components/rum/correlation/TraceCorrelationCard.vue`, `plugins/correlation/TelemetryCorrelationDashboard.vue`, `plugins/traces/metrics/TracesAnalysisDashboard.vue` |
| `RotateCcw` | `undo` | ⚠️ | `plugins/correlation/TimeRangeEditor.vue`, `plugins/correlation/DimensionFilterEditor.vue` |
| `ScanSearch` | `manage-search` | ⚠️ | `components/settings/CorrelationSettings.vue`, `plugins/logs/SearchBar.vue` |
| `ScrollText` | `article` | ✅ | `views/LogStream.vue` |
| `Search` | `search` | ✅ | `components/functions/EnrichmentTableList.vue`, `components/pipelines/PipelineHistory.vue`, `views/LogStream.vue` |
| `Server` | `dns` | ⚠️ | `components/settings/CorrelationSettings.vue` |
| `Share` | `share` | ✅ | `plugins/logs/SearchBar.vue` |
| `Share2` | `share` | ✅ | `plugins/traces/SearchBar.vue` |
| `Shield` | `security` | ⚠️ | `components/alerts/AddAlert.vue`, `components/iam/groups/EditGroup.vue`, `components/iam/roles/EditRole.vue`, `components/iam/quota/Quota.vue` |
| `SlidersHorizontal` | `tune` | ✅ | `components/alerts/AddAlert.vue` |
| `Sliders` | `tune` | ✅ | `components/settings/ModelPricingList.vue` |
| `Sparkles` | `auto-awesome` | ⚠️ | `plugins/traces/SearchBar.vue` |
| `StopCircle` | `stop-circle` | ⚠️ | `components/anomaly_detection/AnomalyDetectionList.vue` |
| `Table2` | `table-chart` | ⚠️ | `components/iam/roles/EditRole.vue`, `components/iam/quota/Quota.vue`, `plugins/traces/TraceDetailsSidebar.vue` |
| `Tag` | `label` | ⚠️ | `components/rum/PlayerEventsSidebar.vue` |
| `Timer` | `timer` | ⚠️ | `components/iam/quota/Quota.vue` |
| `Trash2` | `delete` | ✅ | many files — see 7b |
| `TrendingUp` | `trending-up` | ⚠️ | `components/alerts/AlertList.vue`, `components/alerts/AddAlert.vue` |
| `Type` (as `TypeIcon`) | `title` | ⚠️ | `components/alerts/steps/Advanced.vue` |
| `Upload` | `upload` | ⚠️ | `components/settings/ImportRegexPattern.vue`, `components/common/BaseImport.vue`, `components/rum/errorTracking/view/PrettyStackTrace.vue`, `components/functions/EnrichmentTableList.vue` |
| `UserCheck` | `verified-user` | ⚠️ | `components/logstream/schema.vue` |
| `Users` | `group` | ⚠️ | `components/iam/groups/EditGroup.vue`, `components/iam/roles/EditRole.vue` |
| `Webhook` | `webhook` | ⚠️ | `components/alerts/AddTemplate.vue`, `components/alerts/AddDestination.vue` |
| `Wrench` | `build` | ⚠️ | `components/alerts/steps/QueryConfig.vue`, `components/dashboards/addPanel/QueryTypeSelector.vue`, `plugins/logs/SearchBar.vue` |
| `X` | `close` | ✅ | many files — see 7b |
| `Zap` | `bolt` | ✅ | `components/alerts/AlertList.vue`, `components/alerts/AddDestination.vue` |

> **Icons with no material-symbols-light equivalent** (keep `lucide-vue-next` or replace with custom SVG): `BrainCircuit`, `Flame`, `GitBranch`.

---

### 7b — Files by area

| Area | Files with lucide imports |
|---|---|
| **Alerts** | `AlertList.vue`, `AddAlert.vue`, `AddTemplate.vue`, `AddDestination.vue`, `AlertHistoryDrawer.vue`, `FilterGroup.vue`, `steps/QueryConfig.vue`, `steps/Advanced.vue` |
| **Settings** | `ServiceIdentitySetup.vue`, `RegexPatternList.vue`, `ModelPricingList.vue`, `ImportRegexPattern.vue`, `General.vue`, `DomainManagement.vue`, `DiscoveredServices.vue`, `CorrelationSettings.vue`, `CipherKeys.vue`, `AiToolsets.vue` |
| **Logstream** | `StreamFieldInputs.vue`, `schema.vue`, `LlmEvaluationSettings.vue`, `explore/SearchBar.vue`, `AssociatedRegexPatterns.vue`, `AddStream.vue` |
| **Functions** | `AssociatedStreamFunction.vue`, `EnrichmentSchema.vue`, `FunctionList.vue`, `EnrichmentTableList.vue`, `FunctionsToolbar.vue`, `TestFunction.vue` |
| **Pipelines** | `pipeline/PipelinesList.vue`, `pipeline/PipelineEditor.vue`, `pipeline/NodeForm/CreateDestinationForm.vue`, `pipeline/NodeForm/LlmEvaluation.vue`, `pipeline/NodeForm/ScheduledPipeline.vue`, `pipelines/PipelineHistory.vue`, `pipelines/EditBackfillJobDialog.vue`, `pipelines/CreateBackfillJobDialog.vue`, `pipelines/BackfillJobsList.vue`, `pipelines/BackfillJobDetails.vue` |
| **IAM** | `iam/groups/EditGroup.vue`, `iam/roles/EditRole.vue`, `iam/quota/Quota.vue` |
| **RUM** | `rum/SearchBar.vue`, `rum/ResourceDetailDrawer.vue`, `rum/PlayerEventsSidebar.vue`, `rum/EventDetailDrawerContent.vue`, `rum/errorTracking/view/PrettyStackTrace.vue`, `rum/errorTracking/view/ErrorSessionReplay.vue`, `rum/correlation/TraceCorrelationCard.vue` |
| **Queries** | `queries/SummaryList.vue`, `queries/RunningQueriesList.vue`, `queries/QueryList.vue` |
| **Reports** | `reports/ReportList.vue` |
| **Anomaly Detection** | `anomaly_detection/steps/AnomalyDetectionConfig.vue`, `anomaly_detection/steps/AnomalyAlerting.vue`, `anomaly_detection/AnomalySummary.vue`, `anomaly_detection/AnomalyDetectionList.vue` |
| **Dashboards** | `dashboards/addPanel/QueryTypeSelector.vue`, `views/Dashboards/ScheduledDashboards.vue`, `views/Dashboards/ImportDashboard.vue` |
| **Common** | `common/BaseImport.vue` |
| **Cross-linking** | `cross-linking/CrossLinkUserGuide.vue`, `cross-linking/CrossLinkManager.vue`, `cross-linking/CrossLinkDialog.vue` |
| **Logs plugin** | `plugins/logs/Index.vue`, `plugins/logs/SearchBar.vue`, `plugins/logs/SearchHistory.vue`, `plugins/logs/SearchJobInspector.vue`, `plugins/logs/SyntaxGuide.vue`, `plugins/logs/SearchSchedulersList.vue`, `plugins/logs/JsonPreview.vue` |
| **Traces plugin** | `plugins/traces/Index.vue`, `plugins/traces/SearchBar.vue`, `plugins/traces/SyntaxGuide.vue`, `plugins/traces/TraceDetails.vue`, `plugins/traces/TraceDetailsSidebar.vue`, `plugins/traces/metrics/TracesAnalysisDashboard.vue` |
| **Metrics plugin** | `plugins/metrics/SyntaxGuideMetrics.vue`, `plugins/metrics/MetricList.vue`, `plugins/metrics/AddToDashboard.vue` |
| **Correlation plugin** | `plugins/correlation/TimeRangeEditor.vue`, `plugins/correlation/TelemetryCorrelationDashboard.vue`, `plugins/correlation/DimensionFilterEditor.vue` |
| **Views** | `views/LogStream.vue` |
| **Mixins** | `src/mixins/mainLayout.mixin.ts`, `src/enterprise/mixins/mainLayout.mixin.ts` |
| **Enterprise** | `enterprise/components/EvalTemplateList.vue`, `enterprise/components/EvalTemplateEditor.vue`, `enterprise/components/billings/invoiceTable.vue`, `enterprise/components/billings/Billing.vue` |

---

## Summary by Phase

| Phase | Scope | Approx. files | Prerequisite | Status |
|---|---|---|---|---|
| **Pre-work** | Add missing icons to registry | 1 file | None | ✅ Done |
| **Phase 1** | `icon-left`/`icon-right` props on OButton; migrate all OButton q-icon slots | ~50 files | Pre-work | ✅ Done |
| **Phase 2a** | Replace standalone static-name `q-icon` with `<OIcon>` | ~25 files | Pre-work | ✅ Done |
| **Phase 2b** | Replace dynamic-bound `q-icon` (outlinedXxx constants and ternaries) | ~20 files | Pre-work | 🔲 Next |
| **Phase 3 (data-driven)** | Map `dialogConfig.badgeIcon`, `feature.icon`, `col.icon`, nav `icon` prop to `IconName` | ~4 files | Phase 2 | 🔲 |
| **Phase 4 (blocked)** | Migrate q-input prepend icons | ~10 files | OInput component built | 🔴 |
| **Phase 5 (blocked)** | Migrate q-icon-wrapping-tooltip | ~5 files | OTooltip component built | 🔴 |
| **Phase 6 (blocked)** | Migrate DateTime picker internal icons | ~3 files | ODatePicker component built | 🔴 |
| **Phase 7** | Replace `lucide-vue-next` component usages with `<OIcon>` | ~75 files / ~90 icons | Registry mappings for each Lucide icon | 🔲 |
