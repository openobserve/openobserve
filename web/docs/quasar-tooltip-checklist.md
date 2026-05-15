# Quasar Tooltip — Migration Checklist

Tracks every file that uses `q-tooltip` or `q-tooltip` stubs in tests, and the O2 replacement to use.

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-tooltip>` | `<OTooltip>` | `@/lib/overlay/Tooltip/OTooltip.vue` |
| `'q-tooltip'` stub in spec | `OTooltip: OTooltipStub` | `@/lib/overlay/Tooltip/OTooltipStub.vue` |

> **Rule**: `OTooltip` wraps the trigger element. The tooltip content moves to the `content` prop (plain text) or `<template #content>` slot (rich markup). See `quasar-tooltip-migration.md` for full examples.

---

## Key Structural Change

Every `q-tooltip` migration requires restructuring the template:

```
BEFORE:
<trigger-element>
  ...
  <q-tooltip [props]>content</q-tooltip>
</trigger-element>

AFTER:
<OTooltip content="content" [o2-props]>
  <trigger-element>...</trigger-element>
</OTooltip>
```

---

## Key Prop Changes

| `q-tooltip` prop | `OTooltip` prop | Notes |
|---|---|---|
| Default slot text | `content` prop | Plain text only |
| Default slot (markup) | `#content` named slot | Rich content |
| `anchor="top middle"` | `side="top"` | Drop `self` |
| `anchor="bottom middle"` | `side="bottom"` | Drop `self` |
| `anchor="center right"` | `side="right"` | Drop `self` |
| `anchor="center left"` | `side="left"` | Drop `self` |
| `anchor="bottom right"` | `side="bottom" align="end"` | Drop `self` |
| `self` | — | **Drop** — Reka handles automatically |
| `:delay` | `:delay` | Direct |
| `:offset="[0, y]"` | `:side-offset="y"` | Extract Y value |
| `max-width` | `max-width` | Direct |
| `class` (utility) | `content-class` | Rename; drop color/spacing classes |
| `style` | `max-width` prop + `content-class` | Convert to typed props/utilities |
| `v-if` | `v-if` on `<OTooltip>` or `:disabled` prop | See migration guide |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done

---

### Vue Component Files (143 files)

#### src/components/actionScripts/

- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/actionScripts/EditScript.vue
- [ ] src/components/actionScripts/ScriptEditor.vue
- [ ] src/components/actionScripts/ScriptToolbar.vue

#### src/components/alerts/

- [ ] src/components/alerts/AddAlert.vue
- [ ] src/components/alerts/AlertHistory.vue
- [ ] src/components/alerts/AlertHistoryDrawer.vue
- [ ] src/components/alerts/AlertInsights.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/AlertSummary.vue
- [ ] src/components/alerts/DeduplicationConfig.vue
- [ ] src/components/alerts/DedupSummaryCards.vue
- [ ] src/components/alerts/FilterCondition.vue
- [ ] src/components/alerts/FilterGroup.vue
- [ ] src/components/alerts/IncidentAlertTriggersTable.vue
- [ ] src/components/alerts/IncidentDetailDrawer.vue
- [ ] src/components/alerts/IncidentList.vue
- [ ] src/components/alerts/IncidentServiceGraph.vue
- [ ] src/components/alerts/IncidentTableOfContents.vue
- [ ] src/components/alerts/IncidentTimeline.vue
- [ ] src/components/alerts/OrganizationDeduplicationSettings.vue
- [ ] src/components/alerts/QueryEditorDialog.vue
- [ ] src/components/alerts/SemanticFieldGroupsConfig.vue
- [ ] src/components/alerts/SemanticGroupItem.vue
- [ ] src/components/alerts/VariablesInput.vue
- [ ] src/components/alerts/steps/Advanced.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/alerts/steps/CompareWithPast.vue
- [ ] src/components/alerts/steps/Deduplication.vue
- [ ] src/components/alerts/steps/QueryConfig.vue

#### src/components/anomaly_detection/

- [ ] src/components/anomaly_detection/AnomalyDetectionList.vue
- [ ] src/components/anomaly_detection/AnomalySummary.vue
- [ ] src/components/anomaly_detection/steps/AnomalyAlerting.vue
- [ ] src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue

#### src/components/ (root)

- [ ] src/components/AutoRefreshInterval.vue
- [ ] src/components/CodeQueryEditor.vue
- [ ] src/components/DateTime.vue
- [ ] src/components/EnterpriseUpgradeDialog.vue
- [ ] src/components/Header.vue
- [ ] src/components/JsonPreview.vue
- [ ] src/components/NLModeQueryBar.vue
- [ ] src/components/O2AIChat.vue
- [ ] src/components/QueryEditor.vue
- [ ] src/components/QueryPlanDialog.vue
- [ ] src/components/TelemetryCorrelationPanel.vue
- [ ] src/components/ThemeSwitcher.vue

#### src/components/common/

- [ ] src/components/common/AppTabs.vue
- [ ] src/components/common/DualListSelector.vue
- [ ] src/components/common/ShareButton.vue
- [ ] src/components/common/sidebar/FieldList.vue

#### src/components/cross-linking/

- [ ] src/components/cross-linking/CrossLinkUserGuide.vue

#### src/components/dashboards/

- [ ] src/components/dashboards/ExportDashboard.vue
- [ ] src/components/dashboards/PanelContainer.vue
- [ ] src/components/dashboards/PanelErrorButtons.vue
- [ ] src/components/dashboards/PanelSchemaRenderer.vue
- [ ] src/components/dashboards/addPanel/ChartSelection.vue
- [ ] src/components/dashboards/addPanel/ColorBySeries.vue
- [ ] src/components/dashboards/addPanel/ColumnOrderPopUp.vue
- [ ] src/components/dashboards/addPanel/ConfigPanel.vue
- [ ] src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue
- [ ] src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue
- [ ] src/components/dashboards/addPanel/DashboardQueryBuilder.vue
- [ ] src/components/dashboards/addPanel/DashboardQueryEditor.vue
- [ ] src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue
- [ ] src/components/dashboards/addPanel/DrilldownUserGuide.vue
- [ ] src/components/dashboards/addPanel/PromQLChartConfig.vue
- [ ] src/components/dashboards/addPanel/ShowLegendsPopup.vue
- [ ] src/components/dashboards/settings/AddSettingVariable.vue
- [ ] src/components/dashboards/settings/SinglePanelMove.vue
- [ ] src/components/dashboards/settings/VariableAdHocValueSelector.vue
- [ ] src/components/dashboards/settings/VariableSettings.vue
- [ ] src/components/dashboards/tabs/TabList.vue
- [ ] src/components/dashboards/viewPanel/ViewPanel.vue

#### src/components/functions/

- [ ] src/components/functions/EnrichmentTableList.vue
- [ ] src/components/functions/FunctionList.vue
- [ ] src/components/functions/FunctionsToolbar.vue
- [ ] src/components/functions/TestFunction.vue

#### src/components/iam/

- [ ] src/components/iam/groups/GroupUsers.vue
- [ ] src/components/iam/serviceAccounts/ServiceAccountsList.vue

#### src/components/ingestion/

- [ ] src/components/ingestion/recommended/AWSIntegrationTile.vue
- [ ] src/components/ingestion/recommended/AWSQuickSetup.vue
- [ ] src/components/ingestion/recommended/AzureIntegrationTile.vue
- [ ] src/components/ingestion/recommended/KubernetesConfig.vue

#### src/components/logstream/

- [ ] src/components/logstream/schema.vue

#### src/components/pipeline/

- [ ] src/components/pipeline/NodeForm/Query.vue
- [ ] src/components/pipeline/NodeForm/ScheduledPipeline.vue
- [ ] src/components/pipeline/NodeSidebar.vue
- [ ] src/components/pipeline/PipelineEditor.vue
- [ ] src/components/pipeline/PipelinesList.vue

#### src/components/pipelines/

- [ ] src/components/pipelines/BackfillJobsList.vue
- [ ] src/components/pipelines/CreateBackfillJobDialog.vue
- [ ] src/components/pipelines/EditBackfillJobDialog.vue
- [ ] src/components/pipelines/PipelineHistory.vue

#### src/components/promql/

- [ ] src/components/promql/components/LabelFilterEditor.vue
- [ ] src/components/promql/components/OperationsList.vue
- [ ] src/components/promql/components/PromQLBuilderOptions.vue

#### src/components/reports/

- [ ] src/components/reports/CreateReport.vue
- [ ] src/components/reports/ReportList.vue

#### src/components/rum/

- [ ] src/components/rum/correlation/TraceCorrelationCard.vue
- [ ] src/components/rum/FrustrationBadge.vue
- [ ] src/components/rum/FrustrationEventBadge.vue

#### src/components/settings/

- [ ] src/components/settings/BuiltInPatternsTab.vue
- [ ] src/components/settings/DiscoveredServices.vue
- [ ] src/components/settings/DomainManagement.vue
- [ ] src/components/settings/General.vue
- [ ] src/components/settings/ModelPricingEditor.vue
- [ ] src/components/settings/ModelPricingList.vue
- [ ] src/components/settings/Nodes.vue
- [ ] src/components/settings/ServiceIdentitySetup.vue

#### src/enterprise/

- [ ] src/enterprise/components/EvalTemplateEditor.vue

#### src/plugins/correlation/

- [ ] src/plugins/correlation/DimensionFilterEditor.vue
- [ ] src/plugins/correlation/DimensionFiltersBar.vue
- [ ] src/plugins/correlation/TelemetryCorrelationDashboard.vue

#### src/plugins/logs/

- [ ] src/plugins/logs/components/FieldListPagination.vue
- [ ] src/plugins/logs/FunctionSelector.vue
- [ ] src/plugins/logs/IndexList.vue
- [ ] src/plugins/logs/JsonPreview.vue
- [ ] src/plugins/logs/patterns/PatternCard.vue
- [ ] src/plugins/logs/SearchBar.vue
- [ ] src/plugins/logs/SearchJobInspector.vue
- [ ] src/plugins/logs/SearchResult.vue
- [ ] src/plugins/logs/SyntaxGuide.vue
- [ ] src/plugins/logs/TransformSelector.vue

#### src/plugins/pipelines/

- [ ] src/plugins/pipelines/CustomNode.vue

#### src/plugins/traces/

- [ ] src/plugins/traces/components/SpanKindBadge.vue
- [ ] src/plugins/traces/components/TraceErrorTab.vue
- [ ] src/plugins/traces/components/TracesSearchResultList.vue
- [ ] src/plugins/traces/LLMInsightsDashboard.vue
- [ ] src/plugins/traces/metrics/TracesAnalysisDashboard.vue
- [ ] src/plugins/traces/SearchBar.vue
- [ ] src/plugins/traces/SearchResult.vue
- [ ] src/plugins/traces/ServiceGraph.vue
- [ ] src/plugins/traces/ServiceGraphEdgeSidePanel.vue
- [ ] src/plugins/traces/ServiceGraphNodeSidePanel.vue
- [ ] src/plugins/traces/ServicesCatalog.vue
- [ ] src/plugins/traces/SyntaxGuide.vue
- [ ] src/plugins/traces/ThreadView.vue
- [ ] src/plugins/traces/TraceDetails.vue
- [ ] src/plugins/traces/TraceEvaluationsView.vue

#### src/views/

- [ ] src/views/Dashboards/addPanel/AddJoinPopUp.vue
- [ ] src/views/Dashboards/addPanel/AddPanel.vue
- [ ] src/views/Dashboards/addPanel/DashboardJoinsOption.vue
- [ ] src/views/Dashboards/Dashboards.vue
- [ ] src/views/Dashboards/PanelLayoutSettings.vue
- [ ] src/views/Dashboards/ViewDashboard.vue
- [ ] src/views/Functions.vue
- [ ] src/views/RUM/AppPerformance.vue

---

### Spec Files (35 files — update stubs)

Update each spec file to replace the `'q-tooltip'` stub with `OTooltip: OTooltipStub`.

#### src/components/

- [ ] src/components/actionScripts/ScriptEditor.spec.ts
- [ ] src/components/actionScripts/ScriptToolbar.spec.ts
- [ ] src/components/AutoRefreshInterval.spec.ts
- [ ] src/components/common/DualListSelector.spec.ts
- [ ] src/components/cross-linking/CrossLinkUserGuide.spec.ts
- [ ] src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.spec.ts
- [ ] src/components/dashboards/addPanel/DashboardMapsQueryBuilder.spec.ts
- [ ] src/components/dashboards/addPanel/DashboardSankeyChartBuilder.spec.ts
- [ ] src/components/dashboards/addPanel/ShowLegendsPopup.spec.ts
- [ ] src/components/dashboards/PanelContainer.spec.ts
- [ ] src/components/dashboards/settings/VariableAdHocValueSelector.spec.ts
- [ ] src/components/dashboards/tabs/TabList.spec.ts
- [ ] src/components/dashboards/viewPanel/ViewPanel.spec.ts
- [ ] src/components/DateTime.spec.ts
- [ ] src/components/EnterpriseUpgradeDialog.spec.ts
- [ ] src/components/PredefinedThemes.spec.ts
- [ ] src/components/queries/RunningQueries.spec.ts
- [ ] src/components/QueryPlanDialog.spec.ts
- [ ] src/components/settings/BuiltInPatternsTab.spec.ts
- [ ] src/components/settings/DiscoveredServices.spec.ts
- [ ] src/components/settings/ModelPricingEditor.spec.ts
- [ ] src/components/settings/ModelPricingList.spec.ts
- [ ] src/components/settings/Nodes.spec.ts
- [ ] src/components/settings/ServiceIdentityConfig.spec.ts
- [ ] src/components/settings/ServiceIdentitySetup.spec.ts

#### src/plugins/

- [ ] src/plugins/correlation/DimensionFilterEditor.spec.ts
- [ ] src/plugins/logs/components/FieldListPagination.spec.ts
- [ ] src/plugins/logs/FunctionSelector.spec.ts
- [ ] src/plugins/traces/components/SpanKindBadge.spec.ts
- [ ] src/plugins/traces/ServicesCatalog.spec.ts

#### src/test/

- [ ] src/test/unit/plugins/logs/components/FieldExpansion.spec.ts
- [ ] src/test/unit/plugins/logs/TransformSelector.spec.ts
- [ ] src/test/unit/plugins/pipelines/CustomNode.spec.ts

#### src/views/

- [ ] src/views/Dashboards/Dashboards.spec.ts
- [ ] src/views/Dashboards/PanelLayoutSettings.spec.ts

---

## Pre-Migration Checklist

Before beginning migration in a file:

- [ ] `OTooltip` component is built at `web/src/lib/overlay/Tooltip/OTooltip.vue`
- [ ] `OTooltipStub` is built at `web/src/lib/overlay/Tooltip/OTooltipStub.vue`
- [ ] `TooltipProvider` is added to `App.vue` or root layout (one-time setup)
- [ ] Read `quasar-tooltip-migration.md` for prop mapping reference
- [ ] Read `quasar-tooltip-audit.md` for anchor/self → side/align conversion table

## Post-Migration Validation Per File

After migrating a `.vue` file:

- [ ] No remaining `<q-tooltip` in the file
- [ ] All `OTooltip` wrappers have a single-element default slot (no fragments)
- [ ] Plain text content uses `content` prop; rich content uses `#content` slot
- [ ] `bg-grey-8`, `q-mt-*` classes removed from `content-class`
- [ ] `self` prop dropped from all usages
- [ ] `OTooltip` imported from `@/lib/overlay/Tooltip/OTooltip.vue`
- [ ] Corresponding `.spec.ts` stub updated (if exists)
