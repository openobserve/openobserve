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

## Pre-work: Missing Registry Entries

These icon names appear in the codebase but are **not yet in `OIcon.icons.ts`**. They must be added to the registry before migration of the affected files can proceed.

| Icon name (q-icon) | OIcon registry key | Affected files |
|---|---|---|
| `open_in_new` | `open-in-new` | `JsonPreview.vue`, `DetailTable.vue (logs)`, `EnterpriseUpgradeDialog.vue` |
| `visibility_off` | `visibility-off` | `DetailTable.vue (logs)` |
| `navigate_before` | `navigate-before` | `PatternDetailsDialog.vue` |
| `navigate_next` | `navigate-next` | `PatternDetailsDialog.vue` |
| `bolt` | `bolt` | `AlertList.vue` |
| `file_upload` | `file-upload` | `AlertList.vue` |
| `cached` | `cached` | `PanelContainer.vue` |
| `check` | `check` | `TabsSettings.vue` |
| `format_list_bulleted` | `format-list-bulleted` | `PanelSchemaRenderer.vue` |
| `share` | `share` | `ShareButton.vue` |
| `drive_file_move` | `drive-file-move` | `Dashboards.vue`, `AlertList.vue` |
| `expand_less` | `expand-less` | `AttributeValueCell.vue` |
| `account_tree` | `account-tree` | `FunctionList.vue` |
| `window` | `window` | `UsageTab.vue` |
| `schema` | `schema` | `logstream/schema.vue` |

> **Note on `outlinedXxx` imports**: All `@quasar/extras/material-icons-outlined` constants (e.g. `outlinedDelete`, `outlinedEdit`, `outlinedWarning`, `outlinedDriveFileMove`) resolve to the same icon as the base name (`delete`, `edit`, `warning`, `drive-file-move`). Material Symbols Light is already the outlined/light style — no suffix needed.

---

## Phase 1 — OButton: Add `icon-left` / `icon-right` Props

### What to implement

Add two optional props to `OButton` / `OButton.types.ts`:

```ts
/** Name of an approved icon to render to the left of the label. Replaces the #icon-left slot for simple cases. */
iconLeft?: IconName;
/** Name of an approved icon to render to the right of the label. Replaces the #icon-right slot for simple cases. */
iconRight?: IconName;
```

**Behaviour rules:**
- When `iconLeft` is set, `OIcon` is rendered as the first child (size inherits from button size).
- When a `#icon-left` slot is also provided, **the slot takes precedence** (backward-compatible).
- Same rules apply to `iconRight` / `#icon-right`.
- Slots remain — nothing is removed.

### OButton icon-left/icon-right call sites (Phase 1 targets)

All of these use `<template #icon-left><q-icon name="…" /></template>` on an `<OButton>`.
After Phase 1 they become `<OButton icon-left="…">`.

#### Dashboard / Panel

| File | Current | Proposed |
|---|---|---|
| `views/Dashboards/ViewDashboard.vue:90` | `#icon-left` `add` | `icon-left="add"` |
| `views/Dashboards/ViewDashboard.vue:143` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `views/Dashboards/ViewDashboard.vue:156` | `#icon-left` `refresh` | `icon-left="refresh"` |
| `views/Dashboards/ViewDashboard.vue:187` | `#icon-left` `settings` | `icon-left="settings"` |
| `views/Dashboards/ViewDashboard.vue:248` | `#icon-left` `code` | `icon-left="code"` |
| `views/Dashboards/ScheduledDashboards.vue:90` | `#icon-left` `close` | `icon-left="close"` |
| `views/Dashboards/addPanel/Group.vue:40` | `#icon-left` `add` | `icon-left="add"` |
| `views/Dashboards/addPanel/Group.vue:64` | `#icon-left` `close` | `icon-left="close"` |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:47` | `#icon-right` `arrow_drop_down` | `icon-right="arrow-drop-down"` |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:56` | `#icon-left` `close` | `icon-left="close"` |
| `views/Dashboards/addPanel/DashboardJoinsOption.vue:68` | `#icon-left` `add` | `icon-left="add"` |
| `views/Dashboards/addPanel/AddPanel.vue:64` | `#icon-left` `info_outline` | `icon-left="info-outline"` |
| `views/Dashboards/addPanel/AddJoinPopUp.vue:174` | `#icon-left` `add` | `icon-left="add"` |
| `views/Dashboards/addPanel/AddJoinPopUp.vue:192` | `#icon-left` `close` | `icon-left="close"` |
| `views/Dashboards/addPanel/AddCondition.vue:22` | `#icon-right` `arrow_drop_down` | `icon-right="arrow-drop-down"` |
| `views/Dashboards/addPanel/AddCondition.vue:157` | `#icon-left` `close` | `icon-left="close"` |
| `views/Dashboards/ImportDashboard.vue` | `#icon-left` `arrow_back_ios_new` | `icon-left="arrow-back-ios-new"` |
| `views/Dashboards/PanelLayoutSettings.vue` | `#icon-left` (dynamic OIcon) | keep slot |
| `components/dashboards/viewPanel/ViewPanel.vue:70` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/viewPanel/ViewPanel.vue:81` | `#icon-left` `refresh` | `icon-left="refresh"` |
| `components/dashboards/viewPanel/ViewPanel.vue:94` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/VariablesValueSelector.vue:97` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/tabs/TabList.vue:67` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/tabs/AddTab.vue:44` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/OverrideConfigPopup.vue:16` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/OverrideConfigPopup.vue:114` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/SelectDashboardDropdown.vue:51` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/MoveDashboardToAnotherFolder.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/QueryInspector.vue:46` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/QueryInspector.vue:94` | `#icon-left` `content_copy` | `icon-left="content-copy"` |
| `components/dashboards/QueryInspector.vue:123` | `#icon-left` `content_copy` | `icon-left="content-copy"` |
| `components/dashboards/ExportDashboard.vue:23` | `#icon-left` `download` | `icon-left="download"` |
| `components/dashboards/PanelSchemaRenderer.vue:212` | `#icon-left` `format_list_bulleted` | `icon-left="format-list-bulleted"` ⚠️ |
| `components/dashboards/PanelContainer.vue:67` | `#icon-left` `fullscreen` | `icon-left="fullscreen"` |
| `components/dashboards/PanelContainer.vue:105` | `#icon-left` `refresh` | `icon-left="refresh"` |
| `components/dashboards/PanelContainer.vue:123` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/PanelContainer.vue:228` | `#icon-left` `search` | `icon-left="search"` |
| `components/dashboards/PanelContainer.vue:236` | `#icon-left` `cached` | `icon-left="cached"` ⚠️ |
| `components/dashboards/SelectTabDropdown.vue:51` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/SelectFolderDropdown.vue:52` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/settings/common/DashboardHeader.vue:27` | `#icon-left` `arrow_back_ios_new` | `icon-left="arrow-back-ios-new"` |
| `components/dashboards/settings/AddSettingVariable.vue:399` | `#icon-left` `info` | `icon-left="info"` |
| `components/dashboards/settings/AddSettingVariable.vue:523` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/settings/AddSettingVariable.vue:534` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/settings/AddSettingVariable.vue:640` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/settings/AddSettingVariable.vue:652` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/settings/AddSettingVariable.vue:735` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/settings/AddSettingVariable.vue:752` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/settings/VariableSettings.vue:163` | `#icon-left` `edit` | `icon-left="edit"` |
| `components/dashboards/settings/VariableSettings.vue:197` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/settings/TabsSettings.vue:88` | `#icon-left` `check` | `icon-left="check"` ⚠️ |
| `components/dashboards/settings/TabsSettings.vue:97` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/settings/TabsSettings.vue:109` | `#icon-left` `edit` | `icon-left="edit"` |
| `components/dashboards/settings/VariableAdHocValueSelector.vue:52` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/settings/SinglePanelMove.vue:71` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/addPanel/ColorBySeriesPopUp.vue:37` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/addPanel/ColorBySeriesPopUp.vue:143` | `#icon-left` `close` | `icon-left="close"` |
| `components/dashboards/addPanel/ColorBySeries.vue:29` | `#icon-left` `info_outline` | `icon-left="info-outline"` |
| `components/dashboards/AddDashboard.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/AddDashboardFromGitHub.vue:32` | `#icon-left` `cancel` | `icon-left="cancel"` |
| `components/dashboards/AddDashboardFromGitHub.vue:187` | `#icon-left` `add` | `icon-left="add"` |
| `components/dashboards/AddFolder.vue:36` | `#icon-left` `cancel` | `icon-left="cancel"` |

#### Alerts

| File | Current | Proposed |
|---|---|---|
| `components/alerts/AlertInsights.vue:164` | `#icon-left` `clear` | `icon-left="clear"` |
| `components/alerts/AlertInsights.vue:188` | `#icon-left` `settings` | `icon-left="settings"` |
| `components/alerts/AlertInsights.vue:199` | `#icon-left` `edit` | `icon-left="edit"` |
| `components/alerts/AlertInsights.vue:210` | `#icon-left` `history` | `icon-left="history"` |
| `components/alerts/AlertList.vue:49` | `#icon-left` `schedule` | `icon-left="schedule"` |
| `components/alerts/AlertList.vue:53` | `#icon-left` `bolt` | `icon-left="bolt"` ⚠️ |
| `components/alerts/AlertList.vue:57` | `#icon-left` `query_stats` | `icon-left="query-stats"` |
| `components/alerts/AlertList.vue:139` | `#icon-left` `file_upload` | `icon-left="file-upload"` ⚠️ |
| `components/alerts/AddDestination.vue:541` | `#icon-left` `preview` | `icon-left="preview"` |
| `components/alerts/AddDestination.vue:551` | `#icon-left` `send` | `icon-left="send"` |
| `components/alerts/AddAlert.vue:67` | `#icon-left` `replay` | `icon-left="replay"` |
| `components/alerts/DestinationTestResult.vue:112` | `#icon-left` `refresh` | `icon-left="refresh"` |
| `components/alerts/DestinationPreview.vue:264` | `#icon-left` `content_copy` | `icon-left="content-copy"` |
| `components/alerts/FieldsInput.vue:31` | `#icon-left` `add` | `icon-left="add"` |
| `components/alerts/PrebuiltDestinationForm.vue:415` | `#icon-left` `preview` | `icon-left="preview"` |
| `components/alerts/PrebuiltDestinationForm.vue:425` | `#icon-left` `send` | `icon-left="send"` |

#### Pagination

| File | Current | Proposed |
|---|---|---|
| `components/shared/grid/Pagination.vue:116` | `#icon-left` `chevron_left` | `icon-left="chevron-left"` |
| `components/shared/grid/Pagination.vue:124` | `#icon-left` `chevron_right` | `icon-left="chevron-right"` |

#### Misc app-level components

| File | Current | Proposed |
|---|---|---|
| `components/common/ShareButton.vue:27` | `#icon-left` `share` | `icon-left="share"` ⚠️ |
| `components/settings/DomainManagement.vue:75` | `#icon-left` `help_outline` | `icon-left="help-outline"` |
| `components/ai_toolsets/AddAiToolset.vue:167` | `#icon-left` `add` | `icon-left="add"` |
| `components/ai_toolsets/AddAiToolset.vue:296` | `#icon-left` `add` | `icon-left="add"` |
| `components/ai_toolsets/AddAiToolset.vue:343` | `#icon-left` `add` | `icon-left="add"` |
| `enterprise/components/EvalTemplateEditor.vue:32` | `#icon-left` `ChevronLeft` (already OIcon-like) | already using SVG component — keep slot |

#### Log/Traces plugins

| File | Current | Proposed |
|---|---|---|
| `plugins/logs/JsonPreview.vue:178` | `#icon-left` `visibility` | `icon-left="visibility"` |
| `plugins/logs/JsonPreview.vue:190` | `#icon-left` `open_in_new` | `icon-left="open-in-new"` ⚠️ |
| `plugins/logs/DetailTable.vue:213` | `#icon-left` `visibility` | `icon-left="visibility"` |
| `plugins/logs/DetailTable.vue:221` | `#icon-left` `visibility_off` | `icon-left="visibility-off"` ⚠️ |
| `plugins/logs/DetailTable.vue:233` | `#icon-left` `open_in_new` | `icon-left="open-in-new"` ⚠️ |
| `plugins/logs/SearchSchedulersList.vue:194` | `#icon-left` `search` | `icon-left="search"` |
| `plugins/logs/patterns/PatternDetailsDialog.vue:279` | `#icon-left` `navigate_before` | `icon-left="navigate-before"` ⚠️ |
| `plugins/logs/patterns/PatternDetailsDialog.vue:297` | `#icon-right` `navigate_next` | `icon-right="navigate-next"` ⚠️ |
| `plugins/traces/ServiceGraph.vue:200` | `#icon-left` `refresh` | `icon-left="refresh"` |

---

## Phase 2 — Standalone `q-icon` → `<OIcon>`

These are `q-icon` used as standalone elements (not inside OButton slots), in app-level components that do **not** have a Quasar parent blocking them.

### 2a — Straightforward: static `name="…"`

| File | Line | Icon | Registry key | Notes |
|---|---|---|---|---|
| `components/about/FeatureComparisonTable.vue` | 22 | `compare_arrows` | `compare-arrows` | |
| `components/DatabaseDeprecationBanner.vue` | 37 | `close` | `close` | |
| `components/alerts/AlertContextMenu.vue` | 35,46 | `arrow_upward`, `arrow_downward` | `arrow-upward`, `arrow-downward` | |
| `components/alerts/AlertHistorySummary.vue` | 60 | `history` | `history` | |
| `components/alerts/AlertHistory.vue` | 231,242,254 | `block`, `group_work`, `check_circle` | in registry | |
| `components/alerts/AlertHistory.vue` | 276 | `visibility` | `visibility` | |
| `components/alerts/AlertHistory.vue` | 286,542 | `error` | `error` | |
| `components/alerts/AlertHistory.vue` | 323,557 | `close` | `close` | |
| `components/alerts/AlertHistory.vue` | 547 | `schedule` | `schedule` | |
| `components/alerts/AlertInsightsContextMenu.vue` | 38,46,54,65 | `tune`,`edit`,`history`,`close` | in registry | |
| `components/TelemetryCorrelationPanel.vue` | 5,13 | `link`, `close` | in registry | |
| `components/TelemetryCorrelationPanel.vue` | 26,32 | `error_outline`, `info_outline` | `error-outline`, `info-outline` | has `color=` prop → remove, set on wrapper |
| `components/TelemetryCorrelationPanel.vue` | 41,52 | `cloud`, `link` | `cloud`, `link` | has `color=` prop → remove |
| `components/TelemetryCorrelationPanel.vue` | 79,127,152,177 | `tune`,`timeline`,`show_chart`,`article` | in registry | has `color=` prop → remove |
| `components/functions/RetryJobDialog.vue` | 42 | `close` | `close` | |
| `components/functions/RetryJobDialog.vue` | 61 | `warning` | `warning` | |
| `components/functions/RetryJobDialog.vue` | 86,107 | `refresh`, `play_arrow` | `refresh`, `play-arrow` | |
| `components/shared/grid/NoPanel.vue` | 34 | `insert_drive_file` | `insert-drive-file` | |
| `components/TenstackTable.vue` | 336,369 | `warning` | `warning` | |
| `components/EnterpriseUpgradeDialog.vue` | 27 | `cancel` | `cancel` | |
| `components/EnterpriseUpgradeDialog.vue` | 37 | `workspace_premium` | `workspace-premium` | |
| `components/EnterpriseUpgradeDialog.vue` | 105 | `info` | `info` | |
| `components/WebinarBanner.vue` | 79 | `schedule` | `schedule` | |
| `components/WebinarBanner.vue` | 95 | `arrow_forward` | `arrow-forward` | |
| `components/actionScripts/FileItem.vue` | 27,30 | `edit`, `delete` | in registry | has color via class — keep class on `<OIcon>` |
| `views/DetailTable.vue` | 28 | `cancel` | `cancel` | |
| `views/About.vue` | 40–187 | `workspaces`,`code`,`event`,`settings`,`backpack`,`javascript`,`inventory_2`,`shield`,`info`,`groups`,`language`,`workspace_premium`,`warning` | all in registry | |
| `views/UsageTab.vue` | 70,115,156,199,242,283,342,407,465,548 | `arrow_forward`,`arrow_upward`,`arrow_downward` | in registry | |
| `views/RUM/UploadSourceMaps.vue` | 34 | `arrow_back_ios_new` | `arrow-back-ios-new` | |
| `views/RUM/UploadSourceMaps.vue` | 103 | `cloud_upload` | `cloud-upload` | has color class — remove `color=` prop |
| `views/RUM/UploadSourceMaps.vue` | 112 | `insert_drive_file` | `insert-drive-file` | has color class |
| `views/RUM/UploadSourceMaps.vue` | 123 | `close` | `close` | |
| `views/RUM/SessionViewer.vue` | 26–45 | `arrow_back_ios_new`,`language`,`calendar_month`,`person`,`location_on`,`settings` | in registry | |
| `views/RUM/RealUserMonitoring.vue` | 94 | `arrow_forward` | `arrow-forward` | |
| `views/RUM/AppPerformance.vue` | 48 | `refresh` | `refresh` | |
| `views/RUM/SourceMaps.vue` | 221 | `code` | `code` | has `color=` prop → remove |
| `views/PromQL/QueryBuilder.vue` | 53,61,70 | `content_copy`,`clear`,`play_arrow` | `content-copy`,`clear`,`play-arrow` | |
| `views/Ingestion.vue` | 62 | `search` | `search` | |
| `views/Dashboards/Dashboards.vue` | 175,257 | `add`,`more_vert` | `add`,`more-vert` | |
| `views/Dashboards/Dashboards.vue` | 424,469,482 | `content_copy`,`download`,`delete` | in registry | |
| `views/Dashboards/addPanel/AddPanel.vue` | 136,141 | `keyboard_arrow_down`,`refresh` | `keyboard-arrow-down`,`refresh` | |
| `enterprise/components/EvalTemplateList.vue` | 45 | `search` | `search` | inside q-input prepend → 🔴 blocked |
| `enterprise/components/EvalTemplateEditor.vue` | 47–134 | `info` | `info` | inside `q-icon` with tooltip slot — keep as `<OIcon>` + `<OTooltip>` once OTooltip exists |

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

## Summary by Phase

| Phase | Scope | Approx. files | Prerequisite |
|---|---|---|---|
| **Pre-work** | Add 15 missing icons to registry | 1 file | None — do first |
| **Phase 1** | Add `icon-left`/`icon-right` props to OButton; migrate all `#icon-left`/`#icon-right` q-icon slots | ~50 files | Pre-work |
| **Phase 2a** | Replace standalone static-name `q-icon` with `<OIcon>` | ~25 files | Pre-work |
| **Phase 2b** | Replace dynamic-bound `q-icon` (outlinedXxx constants and ternaries) | ~20 files | Pre-work |
| **Phase 3 (data-driven)** | Map `dialogConfig.badgeIcon`, `feature.icon`, `col.icon`, nav `icon` prop to `IconName` | ~4 files | Phase 2 |
| **Phase 4 (blocked)** | Migrate q-input prepend icons | ~10 files | OInput component built |
| **Phase 5 (blocked)** | Migrate q-icon-wrapping-tooltip | ~5 files | OTooltip component built |
| **Phase 6 (blocked)** | Migrate DateTime picker internal icons | ~3 files | ODatePicker component built |
