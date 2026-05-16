# Quasar Card & Expansion Item ΓÇö Migration Audit

> **Goal:** Migrate `q-card`, `q-card-actions`, `q-card-section`, and `q-expansion-item` to Reka-based O2 components.  
> **Scanned:** `web/src/**/*.vue`  
> **Date:** 2026-05-11

---

## Executive Summary

| Component | Files Affected | Tag Occurrences |
|---|---|---|
| `q-card` | 107 | 382 |
| `q-card-section` | 100 | 550 |
| `q-card-actions` | 47 | 142 |
| `q-expansion-item` | 18 | 98 |
| **TOTAL** | **~107 unique files** | **1,172** |

---

## Per-Component File Breakdown

### `q-card` ΓÇö 107 files, 382 occurrences

| File | Occurrences |
|---|---|
| `plugins/logs/SearchBar.vue` | 16 |
| `components/settings/Nodes.vue` | 14 |
| `components/settings/License.vue` | 12 |
| `components/O2AIChat.vue` | 10 |
| `components/alerts/AlertHistory.vue` | 8 |
| `components/alerts/DedupSummaryCards.vue` | 8 |
| `components/anomaly_detection/AnomalyDetectionList.vue` | 6 |
| `components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue` | 6 |
| `components/iam/serviceAccounts/ServiceAccountsList.vue` | 6 |
| `components/iam/users/User.vue` | 6 |
| `components/ingestion/recommended/AWSIntegrationTile.vue` | 6 |
| `components/logstream/schema.vue` | 6 |
| `components/pipelines/BackfillJobDetails.vue` | 6 |
| `components/pipelines/PipelineHistory.vue` | 6 |
| `components/QueryPlanDialog.vue` | 6 |
| `components/settings/ServiceIdentitySetup.vue` | 6 |
| `plugins/logs/patterns/PatternDetailsDialog.vue` | 6 |
| `plugins/traces/ServiceGraph.vue` | 6 |
| `views/CorrelationDemo.vue` | 8 |
| `views/PromQL/QueryBuilder.vue` | 6 |
| `plugins/correlation/TelemetryCorrelationDashboard.vue` | 6 |
| `components/dashboards/AddDashboardFromGitHub.vue` | 4 |
| `components/dashboards/addPanel/AddAnnotation.vue` | 4 |
| `components/functions/EnrichmentSchema.vue` | 4 |
| `components/functions/EnrichmentTableList.vue` | 4 |
| `components/functions/FunctionList.vue` | 4 |
| `components/iam/users/AddUser.vue` | 4 |
| `components/iam/users/InvitationList.vue` | 4 |
| `components/logstream/AssociatedRegexPatterns.vue` | 4 |
| `components/pipelines/BackfillJobsList.vue` | 2 |
| `components/pipelines/CreateBackfillJobDialog.vue` | 4 |
| `components/pipelines/EditBackfillJobDialog.vue` | 4 |
| `components/PredefinedThemes.vue` | 4 |
| `components/settings/General.vue` | 4 |
| `components/settings/OrganizationManagement.vue` | 4 |
| `components/settings/ServiceIdentitySetup.vue` | 6 |
| `plugins/logs/SearchJobInspector.vue` | 4 |
| `plugins/logs/SyntaxGuide.vue` | 4 |
| `plugins/metrics/SyntaxGuideMetrics.vue` | 4 |
| `plugins/traces/DbSpanDetails.vue` | 6 |
| `plugins/traces/SyntaxGuide.vue` | 4 |
| `views/AwsMarketplaceSetup.vue` | 4 |
| `views/AzureMarketplaceSetup.vue` | 4 |
| `views/LogStream.vue` | 4 |
| `components/pipeline/NodeForm/AssociateFunction.vue` | 4 |
| `components/dashboards/addPanel/AddAnnotation.vue` | 4 |
| `components/alerts/ImportSemanticGroups.vue` | 4 |
| `components/alerts/ImportSemanticGroupsDrawer.vue` | 4 |
| `plugins/logs/patterns/PatternDetailsDialog.vue` | 6 |
| `components/alerts/AlertList.vue` | 2 |
| `components/alerts/CustomConfirmDialog.vue` | 2 |
| `components/alerts/DestinationPreview.vue` | 2 |
| `components/alerts/SemanticFieldGroupsConfig.vue` | 2 |
| `components/actionScripts/ActionScripts.vue` | 2 |
| `components/common/JsonEditor.vue` | 2 |
| `components/common/sidebar/AddFolder.vue` | 2 |
| `components/common/sidebar/FieldList.vue` | 2 |
| `components/common/sidebar/MoveAcrossFolders.vue` | 2 |
| `components/ConfirmDialog.vue` | 2 |
| `components/cross-linking/CrossLinkDialog.vue` | 2 |
| `components/dashboards/AddDashboard.vue` | 2 |
| `components/dashboards/AddFolder.vue` | 2 |
| `components/dashboards/addPanel/ColumnOrderPopUp.vue` | 2 |
| `components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue` | 2 |
| `components/dashboards/addPanel/ShowLegendsPopup.vue` | 2 |
| `components/dashboards/MoveDashboardToAnotherFolder.vue` | 2 |
| `components/dashboards/QueryInspector.vue` | 2 |
| `components/dashboards/settings/SinglePanelMove.vue` | 2 |
| `components/dashboards/settings/TabsDeletePopUp.vue` | 2 |
| `components/dashboards/settings/VariableSettings.vue` | 2 |
| `components/dashboards/tabs/AddTab.vue` | 2 |
| `components/EnterpriseUpgradeDialog.vue` | 2 |
| `components/functions/AddEnrichmentTable.vue` | 2 |
| `components/iam/groups/AddGroup.vue` | 2 |
| `components/iam/organizations/AddUpdateOrganization.vue` | 2 |
| `components/iam/roles/AddRole.vue` | 2 |
| `components/iam/serviceAccounts/AddServiceAccount.vue` | 2 |
| `components/iam/users/UpdateRole.vue` | 2 |
| `components/logstream/PerformanceFieldsDialog.vue` | 2 |
| `components/pipeline/NodeForm/Condition.vue` | 2 |
| `components/pipeline/NodeForm/CreateDestinationForm.vue` | 2 |
| `components/pipeline/PipelinesList.vue` | 2 |
| `components/promql/components/OperationsList.vue` | 2 |
| `components/queries/QueryList.vue` | 2 |
| `components/query-plan/MetricsSummaryCard.vue` | 2 |
| `components/ResumePipelineDialog.vue` | 2 |
| `components/rum/EventDetailDrawerContent.vue` | 2 |
| `components/settings/BuiltInPatternsTab.vue` | 2 |
| `components/settings/DiscoveredServices.vue` | 2 |
| `components/settings/ModelPricingEditor.vue` | 2 |
| `components/settings/TestModelMatchDialog.vue` | 2 |
| `components/shared/filter/FilterCreatorPopup.vue` | 2 |
| `enterprise/components/billings/enterprisePlan.vue` | 2 |
| `enterprise/components/billings/proPlan.vue` | 2 |
| `plugins/correlation/DimensionFilterEditor.vue` | 2 |
| `plugins/correlation/TimeRangeEditor.vue` | 2 |
| `plugins/logs/components/FieldExpansion.vue` | 2 |
| `plugins/logs/DetailTable.vue` | 2 |
| `plugins/logs/JsonPreview.vue` | 2 |
| `plugins/metrics/AddToDashboard.vue` | 2 |
| `plugins/metrics/MetricLegends.vue` | 2 |
| `plugins/metrics/MetricList.vue` | 2 |
| `plugins/traces/fields-sidebar/BasicValuesFilter.vue` | 2 |
| `plugins/traces/metrics/TracesAnalysisDashboard.vue` | 2 |
| `plugins/traces/TraceDetails.vue` | 2 |
| `views/Dashboards/DashboardJsonEditor.vue` | 2 |
| `views/Dashboards/RenderDashboardCharts.vue` | 2 |
| `views/DetailTable.vue` | 2 |

---

### `q-card-section` ΓÇö 100 files, 550 occurrences

| File | Occurrences |
|---|---|
| `plugins/logs/SearchBar.vue` | 28 |
| `components/O2AIChat.vue` | 20 |
| `components/settings/License.vue` | 14 |
| `components/settings/Nodes.vue` | 14 |
| `components/alerts/AlertHistory.vue` | 8 |
| `components/alerts/ImportSemanticGroups.vue` | 8 |
| `components/alerts/ImportSemanticGroupsDrawer.vue` | 8 |
| `components/anomaly_detection/AnomalyDetectionList.vue` | 12 |
| `components/dashboards/AddDashboardFromGitHub.vue` | 10 |
| `components/iam/serviceAccounts/ServiceAccountsList.vue` | 10 |
| `components/ingestion/recommended/AWSIntegrationTile.vue` | 10 |
| `plugins/logs/patterns/PatternDetailsDialog.vue` | 10 |
| `components/dashboards/addPanel/AddAnnotation.vue` | 8 |
| `components/logstream/schema.vue` | 8 |
| `components/pipelines/PipelineHistory.vue` | 8 |
| `plugins/logs/DetailTable.vue` | 8 |
| `plugins/logs/SearchJobInspector.vue` | 8 |
| `plugins/logs/SyntaxGuide.vue` | 8 |
| `plugins/metrics/SyntaxGuideMetrics.vue` | 8 |
| `plugins/traces/ServiceGraph.vue` | 8 |
| `plugins/traces/SyntaxGuide.vue` | 8 |
| `views/CorrelationDemo.vue` | 12 |
| `views/PromQL/QueryBuilder.vue` | 12 |
| `components/settings/ServiceIdentitySetup.vue` | 12 |
| `components/PredefinedThemes.vue` | 12 |
| `components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue` | 8 |
| `components/pipelines/CreateBackfillJobDialog.vue` | 8 |
| `plugins/traces/DbSpanDetails.vue` | 6 |
| `plugins/correlation/TelemetryCorrelationDashboard.vue` | 6 |
| `plugins/traces/metrics/TracesAnalysisDashboard.vue` | 4 |
| `components/alerts/CustomConfirmDialog.vue` | 4 |
| `components/alerts/DestinationPreview.vue` | 4 |
| `components/common/sidebar/AddFolder.vue` | 4 |
| `components/cross-linking/CrossLinkDialog.vue` | 4 |
| `components/dashboards/AddDashboard.vue` | 4 |
| `components/dashboards/AddFolder.vue` | 4 |
| `components/dashboards/tabs/AddTab.vue` | 4 |
| `components/functions/EnrichmentSchema.vue` | 4 |
| `components/functions/EnrichmentTableList.vue` | 4 |
| `components/functions/FunctionList.vue` | 4 |
| `components/iam/users/AddUser.vue` | 4 |
| `components/iam/users/InvitationList.vue` | 4 |
| `components/iam/users/UpdateRole.vue` | 4 |
| `components/logstream/AssociatedRegexPatterns.vue` | 4 |
| `components/logstream/PerformanceFieldsDialog.vue` | 4 |
| `components/pipeline/NodeForm/AssociateFunction.vue` | 6 |
| `components/pipelines/BackfillJobDetails.vue` | 4 |
| `components/pipelines/EditBackfillJobDialog.vue` | 4 |
| `components/ResumePipelineDialog.vue` | 4 |
| `components/settings/BuiltInPatternsTab.vue` | 4 |
| `components/settings/ModelPricingEditor.vue` | 4 |
| `components/shared/filter/FilterCreatorPopup.vue` | 6 |
| `plugins/correlation/DimensionFilterEditor.vue` | 4 |
| `plugins/correlation/TimeRangeEditor.vue` | 4 |
| `plugins/logs/JsonPreview.vue` | 4 |
| `plugins/metrics/AddToDashboard.vue` | 4 |
| `plugins/metrics/MetricLegends.vue` | 4 |
| `plugins/traces/TraceDetails.vue` | 4 |
| `views/Dashboards/DashboardJsonEditor.vue` | 4 |
| `views/DetailTable.vue` | 4 |
| `components/alerts/AlertHistoryDrawer.vue` | 2 |
| `components/alerts/AlertList.vue` | 2 |
| `components/common/JsonEditor.vue` | 4 |
| `components/common/sidebar/FieldList.vue` | 2 |
| `components/common/sidebar/MoveAcrossFolders.vue` | 4 |
| `components/ConfirmDialog.vue` | 2 |
| `components/dashboards/MoveDashboardToAnotherFolder.vue` | 4 |
| `components/dashboards/QueryInspector.vue` | 2 |
| `components/dashboards/settings/SinglePanelMove.vue` | 2 |
| `components/dashboards/settings/TabsDeletePopUp.vue` | 2 |
| `components/dashboards/settings/VariableSettings.vue` | 2 |
| `components/iam/groups/AddGroup.vue` | 2 |
| `components/iam/organizations/AddUpdateOrganization.vue` | 2 |
| `components/iam/roles/AddRole.vue` | 2 |
| `components/iam/serviceAccounts/AddServiceAccount.vue` | 2 |
| `components/iam/users/User.vue` | 6 |
| `components/ingestion/recommended/AzureIntegrationTile.vue` | 2 |
| `components/ingestion/recommended/AzureQuickSetup.vue` | 2 |
| `components/pipeline/NodeForm/Condition.vue` | 2 |
| `components/pipeline/NodeForm/CreateDestinationForm.vue` | 2 |
| `components/pipeline/PipelinesList.vue` | 4 |
| `components/promql/components/OperationsList.vue` | 6 |
| `components/queries/QueryList.vue` | 2 |
| `components/query-plan/MetricsSummaryCard.vue` | 2 |
| `components/QueryPlanDialog.vue` | 6 |
| `components/rum/EventDetailDrawerContent.vue` | 2 |
| `components/settings/General.vue` | 6 |
| `components/settings/OrganizationManagement.vue` | 4 |
| `plugins/logs/components/FieldExpansion.vue` | 2 |
| `plugins/metrics/MetricList.vue` | 2 |
| `plugins/traces/fields-sidebar/BasicValuesFilter.vue` | 2 |
| `views/AwsMarketplaceSetup.vue` | 4 |
| `views/AzureMarketplaceSetup.vue` | 4 |
| `views/LogStream.vue` | 4 |
| `views/RUM/SourceMaps.vue` | 2 |

---

### `q-card-actions` ΓÇö 47 files, 142 occurrences

| File | Occurrences |
|---|---|
| `plugins/logs/SearchBar.vue` | 14 |
| `components/alerts/AlertHistory.vue` | 4 |
| `components/alerts/ImportSemanticGroups.vue` | 4 |
| `components/alerts/ImportSemanticGroupsDrawer.vue` | 4 |
| `components/anomaly_detection/AnomalyDetectionList.vue` | 6 |
| `components/iam/serviceAccounts/ServiceAccountsList.vue` | 6 |
| `components/iam/users/User.vue` | 6 |
| `components/O2AIChat.vue` | 4 |
| `components/settings/General.vue` | 4 |
| `components/settings/OrganizationManagement.vue` | 4 |
| `components/pipelines/CreateBackfillJobDialog.vue` | 4 |
| `components/pipelines/PipelineHistory.vue` | 4 |
| `views/LogStream.vue` | 4 |
| `views/CorrelationDemo.vue` | 2 |
| `components/alerts/CustomConfirmDialog.vue` | 2 |
| `components/alerts/DestinationPreview.vue` | 2 |
| `components/common/JsonEditor.vue` | 2 |
| `components/ConfirmDialog.vue` | 2 |
| `components/cross-linking/CrossLinkDialog.vue` | 2 |
| `components/dashboards/addPanel/AddAnnotation.vue` | 4 |
| `components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue` | 2 |
| `components/dashboards/addPanel/DrilldownPopUp.vue` | 2 |
| `components/dashboards/OverrideConfigPopup.vue` | 2 |
| `components/dashboards/settings/SinglePanelMove.vue` | 2 |
| `components/dashboards/settings/TabsDeletePopUp.vue` | 2 |
| `components/iam/users/AddUser.vue` | 2 |
| `components/iam/users/InvitationList.vue` | 4 |
| `components/ingestion/recommended/AWSIntegrationTile.vue` | 4 |
| `components/ingestion/recommended/AzureIntegrationTile.vue` | 2 |
| `components/logstream/PerformanceFieldsDialog.vue` | 2 |
| `components/pipeline/PipelinesList.vue` | 2 |
| `components/pipelines/BackfillJobsList.vue` | 2 |
| `components/PredefinedThemes.vue` | 2 |
| `components/promql/components/OperationsList.vue` | 2 |
| `components/ResumePipelineDialog.vue` | 2 |
| `components/settings/BuiltInPatternsTab.vue` | 2 |
| `components/settings/License.vue` | 2 |
| `components/settings/ServiceIdentitySetup.vue` | 2 |
| `components/shared/filter/FilterCreatorPopup.vue` | 2 |
| `plugins/correlation/DimensionFilterEditor.vue` | 2 |
| `plugins/correlation/TimeRangeEditor.vue` | 2 |
| `plugins/logs/JsonPreview.vue` | 2 |
| `plugins/traces/ServiceGraph.vue` | 2 |
| `plugins/traces/TraceDetails.vue` | 2 |
| `views/Dashboards/DashboardJsonEditor.vue` | 2 |
| `views/RUM/SourceMaps.vue` | 2 |

---

### `q-expansion-item` ΓÇö 18 files, 98 occurrences

| File | Occurrences |
|---|---|
| `components/dashboards/addPanel/ConfigPanel.vue` | 40 |
| `components/settings/Nodes.vue` | 14 |
| `plugins/traces/TraceEvaluationsView.vue` | 8 |
| `components/alerts/DestinationTestResult.vue` | 2 |
| `components/alerts/ImportSemanticGroups.vue` | 2 |
| `components/alerts/ImportSemanticGroupsDrawer.vue` | 2 |
| `components/common/sidebar/FieldList.vue` | 2 |
| `components/dashboards/addPanel/StreamFieldSelect.vue` | 2 |
| `components/ingestion/recommended/KubernetesConfig.vue` | 2 |
| `components/logstream/AssociatedRegexPatterns.vue` | 4 |
| `components/pipelines/EditBackfillJobDialog.vue` | 2 |
| `components/promql/components/OperationsList.vue` | 2 |
| `components/settings/ServiceIdentityConfig.vue` | 4 |
| `plugins/logs/components/FieldExpansion.vue` | 2 |
| `plugins/metrics/MetricList.vue` | 2 |
| `plugins/traces/DbSpanDetails.vue` | 2 |
| `plugins/traces/fields-sidebar/BasicValuesFilter.vue` | 2 |
| `plugins/traces/TraceDetailsSidebar.vue` | 4 |

---

## Complete File Matrix

All files that use at least one of the four components, with counts per component:

| File | `q-card` | `q-card-section` | `q-card-actions` | `q-expansion-item` | Total Tags |
|---|---|---|---|---|---|
| `components/actionScripts/ActionScripts.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/alerts/AlertHistory.vue` | 8 | 8 | 4 | ΓÇö | 20 |
| `components/alerts/AlertHistoryDrawer.vue` | ΓÇö | 2 | ΓÇö | ΓÇö | 2 |
| `components/alerts/AlertList.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/alerts/CustomConfirmDialog.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/alerts/DedupSummaryCards.vue` | 8 | 8 | ΓÇö | ΓÇö | 16 |
| `components/alerts/DestinationPreview.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/alerts/DestinationTestResult.vue` | ΓÇö | ΓÇö | ΓÇö | 2 | 2 |
| `components/alerts/ImportSemanticGroups.vue` | 4 | 8 | 4 | 2 | 18 |
| `components/alerts/ImportSemanticGroupsDrawer.vue` | 4 | 8 | 4 | 2 | 18 |
| `components/alerts/SemanticFieldGroupsConfig.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/anomaly_detection/AnomalyDetectionList.vue` | 6 | 12 | 6 | ΓÇö | 24 |
| `components/common/JsonEditor.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/common/sidebar/AddFolder.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/common/sidebar/FieldList.vue` | 2 | 2 | ΓÇö | 2 | 6 |
| `components/common/sidebar/MoveAcrossFolders.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/ConfirmDialog.vue` | 2 | 2 | 2 | ΓÇö | 6 |
| `components/cross-linking/CrossLinkDialog.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/dashboards/AddDashboard.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/dashboards/AddDashboardFromGitHub.vue` | 4 | 10 | 2 | ΓÇö | 16 |
| `components/dashboards/AddFolder.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/dashboards/addPanel/AddAnnotation.vue` | 4 | 8 | 4 | ΓÇö | 16 |
| `components/dashboards/addPanel/ColumnOrderPopUp.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/dashboards/addPanel/ConfigPanel.vue` | ΓÇö | ΓÇö | ΓÇö | 40 | 40 |
| `components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue` | 2 | 2 | 2 | ΓÇö | 6 |
| `components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue` | 6 | 8 | ΓÇö | ΓÇö | 14 |
| `components/dashboards/addPanel/DrilldownPopUp.vue` | ΓÇö | ΓÇö | 2 | ΓÇö | 2 |
| `components/dashboards/addPanel/ShowLegendsPopup.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/dashboards/addPanel/StreamFieldSelect.vue` | ΓÇö | ΓÇö | ΓÇö | 2 | 2 |
| `components/dashboards/MoveDashboardToAnotherFolder.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/dashboards/OverrideConfigPopup.vue` | ΓÇö | ΓÇö | 2 | ΓÇö | 2 |
| `components/dashboards/QueryInspector.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/dashboards/settings/SinglePanelMove.vue` | 2 | 2 | 2 | ΓÇö | 6 |
| `components/dashboards/settings/TabsDeletePopUp.vue` | 2 | 2 | 2 | ΓÇö | 6 |
| `components/dashboards/settings/VariableSettings.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/dashboards/tabs/AddTab.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/EnterpriseUpgradeDialog.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/functions/AddEnrichmentTable.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/functions/EnrichmentSchema.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/functions/EnrichmentTableList.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/functions/FunctionList.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/iam/groups/AddGroup.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/iam/organizations/AddUpdateOrganization.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/iam/roles/AddRole.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/iam/serviceAccounts/AddServiceAccount.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/iam/serviceAccounts/ServiceAccountsList.vue` | 6 | 10 | 6 | ΓÇö | 22 |
| `components/iam/users/AddUser.vue` | 4 | 4 | 2 | ΓÇö | 10 |
| `components/iam/users/InvitationList.vue` | 4 | 4 | 4 | ΓÇö | 12 |
| `components/iam/users/UpdateRole.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/iam/users/User.vue` | 6 | 6 | 6 | ΓÇö | 18 |
| `components/ingestion/recommended/AWSIntegrationTile.vue` | 6 | 10 | 4 | ΓÇö | 20 |
| `components/ingestion/recommended/AzureIntegrationTile.vue` | 2 | 2 | 2 | ΓÇö | 6 |
| `components/ingestion/recommended/AzureQuickSetup.vue` | ΓÇö | 2 | ΓÇö | ΓÇö | 2 |
| `components/ingestion/recommended/KubernetesConfig.vue` | ΓÇö | ΓÇö | ΓÇö | 2 | 2 |
| `components/logstream/AssociatedRegexPatterns.vue` | 4 | 4 | ΓÇö | 4 | 12 |
| `components/logstream/PerformanceFieldsDialog.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/logstream/schema.vue` | 6 | 8 | ΓÇö | ΓÇö | 14 |
| `components/O2AIChat.vue` | 10 | 20 | 4 | ΓÇö | 34 |
| `components/pipeline/NodeForm/AssociateFunction.vue` | 4 | 6 | ΓÇö | ΓÇö | 10 |
| `components/pipeline/NodeForm/Condition.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/pipeline/NodeForm/CreateDestinationForm.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/pipeline/PipelinesList.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/pipelines/BackfillJobDetails.vue` | 6 | 4 | ΓÇö | ΓÇö | 10 |
| `components/pipelines/BackfillJobsList.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/pipelines/CreateBackfillJobDialog.vue` | 4 | 8 | 4 | ΓÇö | 16 |
| `components/pipelines/EditBackfillJobDialog.vue` | 4 | 4 | ΓÇö | 2 | 10 |
| `components/pipelines/PipelineHistory.vue` | 8 | 8 | 4 | ΓÇö | 20 |
| `components/PredefinedThemes.vue` | 4 | 12 | 2 | ΓÇö | 18 |
| `components/promql/components/OperationsList.vue` | 2 | 6 | 2 | 2 | 12 |
| `components/queries/QueryList.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/query-plan/MetricsSummaryCard.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/QueryPlanDialog.vue` | 6 | 6 | ΓÇö | ΓÇö | 12 |
| `components/ResumePipelineDialog.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/rum/EventDetailDrawerContent.vue` | 2 | 2 | ΓÇö | ΓÇö | 4 |
| `components/settings/BuiltInPatternsTab.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `components/settings/DiscoveredServices.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/settings/General.vue` | 4 | 6 | 4 | ΓÇö | 14 |
| `components/settings/License.vue` | 12 | 14 | 2 | ΓÇö | 28 |
| `components/settings/ModelPricingEditor.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `components/settings/Nodes.vue` | 14 | 14 | ΓÇö | 14 | 42 |
| `components/settings/OrganizationManagement.vue` | 4 | 4 | 4 | ΓÇö | 12 |
| `components/settings/ServiceIdentityConfig.vue` | ΓÇö | ΓÇö | ΓÇö | 4 | 4 |
| `components/settings/ServiceIdentitySetup.vue` | 6 | 12 | 2 | ΓÇö | 20 |
| `components/settings/TestModelMatchDialog.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `components/shared/filter/FilterCreatorPopup.vue` | 2 | 6 | 2 | ΓÇö | 10 |
| `enterprise/components/billings/enterprisePlan.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `enterprise/components/billings/proPlan.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `plugins/correlation/DimensionFilterEditor.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `plugins/correlation/TelemetryCorrelationDashboard.vue` | 6 | 6 | ΓÇö | ΓÇö | 12 |
| `plugins/correlation/TimeRangeEditor.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `plugins/logs/components/FieldExpansion.vue` | 2 | 2 | ΓÇö | 2 | 6 |
| `plugins/logs/DetailTable.vue` | 2 | 8 | ΓÇö | ΓÇö | 10 |
| `plugins/logs/JsonPreview.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `plugins/logs/patterns/PatternDetailsDialog.vue` | 6 | 10 | ΓÇö | ΓÇö | 16 |
| `plugins/logs/SearchBar.vue` | 16 | 28 | 14 | ΓÇö | 58 |
| `plugins/logs/SearchJobInspector.vue` | 4 | 8 | ΓÇö | ΓÇö | 12 |
| `plugins/logs/SyntaxGuide.vue` | 4 | 8 | ΓÇö | ΓÇö | 12 |
| `plugins/metrics/AddToDashboard.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `plugins/metrics/MetricLegends.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `plugins/metrics/MetricList.vue` | 2 | 2 | ΓÇö | 2 | 6 |
| `plugins/metrics/SyntaxGuideMetrics.vue` | 4 | 8 | ΓÇö | ΓÇö | 12 |
| `plugins/traces/DbSpanDetails.vue` | 6 | 6 | ΓÇö | 2 | 14 |
| `plugins/traces/fields-sidebar/BasicValuesFilter.vue` | 2 | 2 | ΓÇö | 2 | 6 |
| `plugins/traces/metrics/TracesAnalysisDashboard.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `plugins/traces/ServiceGraph.vue` | 6 | 8 | 2 | ΓÇö | 16 |
| `plugins/traces/SyntaxGuide.vue` | 4 | 8 | ΓÇö | ΓÇö | 12 |
| `plugins/traces/TraceDetails.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `plugins/traces/TraceDetailsSidebar.vue` | ΓÇö | ΓÇö | ΓÇö | 4 | 4 |
| `plugins/traces/TraceEvaluationsView.vue` | ΓÇö | ΓÇö | ΓÇö | 8 | 8 |
| `views/AwsMarketplaceSetup.vue` | 4 | 4 | ΓÇö | ΓÇö | 8 |
| `views/AzureMarketplaceSetup.vue` | 4 | 4 | ΓÇö | ΓÇö | 8 |
| `views/CorrelationDemo.vue` | 8 | 12 | 2 | ΓÇö | 22 |
| `views/Dashboards/DashboardJsonEditor.vue` | 2 | 4 | 2 | ΓÇö | 8 |
| `views/Dashboards/RenderDashboardCharts.vue` | 2 | ΓÇö | ΓÇö | ΓÇö | 2 |
| `views/DetailTable.vue` | 2 | 4 | ΓÇö | ΓÇö | 6 |
| `views/LogStream.vue` | 4 | 4 | 4 | ΓÇö | 12 |
| `views/PromQL/QueryBuilder.vue` | 6 | 12 | ΓÇö | ΓÇö | 18 |
| `views/RUM/SourceMaps.vue` | 2 | 2 | 2 | ΓÇö | 6 |

---

## Top 20 Heaviest Files (by total tag count)

| Rank | File | Total Tags |
|---|---|---|
| 1 | `plugins/logs/SearchBar.vue` | 58 |
| 2 | `components/settings/Nodes.vue` | 42 |
| 3 | `components/dashboards/addPanel/ConfigPanel.vue` | 40 |
| 4 | `components/O2AIChat.vue` | 34 |
| 5 | `components/settings/License.vue` | 28 |
| 6 | `components/anomaly_detection/AnomalyDetectionList.vue` | 24 |
| 7 | `views/CorrelationDemo.vue` | 22 |
| 8 | `components/iam/serviceAccounts/ServiceAccountsList.vue` | 22 |
| 9 | `components/alerts/AlertHistory.vue` | 20 |
| 10 | `components/ingestion/recommended/AWSIntegrationTile.vue` | 20 |
| 11 | `components/pipelines/PipelineHistory.vue` | 20 |
| 12 | `components/settings/ServiceIdentitySetup.vue` | 20 |
| 13 | `components/alerts/ImportSemanticGroups.vue` | 18 |
| 14 | `components/alerts/ImportSemanticGroupsDrawer.vue` | 18 |
| 15 | `components/iam/users/User.vue` | 18 |
| 16 | `components/PredefinedThemes.vue` | 18 |
| 17 | `views/PromQL/QueryBuilder.vue` | 18 |
| 18 | `components/dashboards/AddDashboardFromGitHub.vue` | 16 |
| 19 | `components/dashboards/addPanel/AddAnnotation.vue` | 16 |
| 20 | `plugins/logs/patterns/PatternDetailsDialog.vue` | 16 |

---

## Usage Patterns & Migration Notes

### `q-card`
- Used as container wrappers in dialogs, drawers, sidebars, and list items.
- Common props seen: `flat`, `bordered`, `style="min-width: ..."`, class utilities.
- **O2 replacement:** `OCard` (Reka-based) ΓÇö headless surface with design tokens.

### `q-card-section`
- Pure layout divider inside `q-card`. Used to pad and separate header, body, and footer regions.
- **O2 replacement:** Semantic `div` / slot regions inside `OCard` (header, body, footer slots).

### `q-card-actions`
- Button row at the bottom of dialogs. Almost always has `align="right"` and contains cancel/confirm buttons.
- **O2 replacement:** `OCardActions` or a styled footer slot in `OCard`.

### `q-expansion-item`
- Collapsible accordion rows. Heaviest use in `ConfigPanel.vue` (40 tags ΓÇö the entire panel config tree).
- Common pattern: `q-expansion-item` ΓåÆ `q-card` ΓåÆ `q-card-section` for expanded content.
- **O2 replacement:** `OCollapsible` / Reka `Collapsible` primitive.

---

## Suggested Migration Priority

| Priority | Scope | Rationale |
|---|---|---|
| **P1 ΓÇö High** | `components/ConfirmDialog.vue` | Single shared confirm dialog used everywhere; one migration covers many call sites |
| **P1 ΓÇö High** | `components/dashboards/addPanel/ConfigPanel.vue` | 40 `q-expansion-item` ΓÇö entire config tree |
| **P1 ΓÇö High** | `plugins/logs/SearchBar.vue` | 58 total tags ΓÇö highest density |
| **P2 ΓÇö Medium** | All dialog patterns (`q-card` + `q-card-section` + `q-card-actions` triad) | ~47 files follow this exact pattern |
| **P2 ΓÇö Medium** | `components/settings/Nodes.vue` | 42 total tags, 14 expansion items |
| **P3 ΓÇö Low** | Standalone `q-card` wrappers with no section/actions | Simple swap, low risk |
| **P3 ΓÇö Low** | `enterprise/` billing cards | Low usage, isolated |
