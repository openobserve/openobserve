# Quasar Separator ΓÇö Migration Checklist

Tracks every file that uses `q-separator` and the O2 replacement.

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-separator />` | `<OSeparator />` | `@/lib/core/Separator/OSeparator.vue` |
| `<q-separator vertical />` | `<OSeparator vertical />` | same |
| `<q-separator inset />` | `<OSeparator class="tw:mx-4">` | same ΓÇö inset via class |
| `<q-separator vertical inset />` | `<OSeparator vertical class="tw:my-2">` | same ΓÇö inset via class |
| `<q-separator spaced />` | `<OSeparator class="tw:my-2">` | same ΓÇö spaced via class |
| `<q-separator color="grey-4">` | `<OSeparator class="tw:bg-separator-strong">` | same ΓÇö color via class |
| `<q-separator color="white">` | `<OSeparator class="tw:bg-white">` | same ΓÇö color via class |
| `<q-separator size="2px">` | `<OSeparator class="tw:h-[2px]">` | same ΓÇö size via class |
| `<q-separator horizontal>` | `<OSeparator>` | same ΓÇö horizontal is the default |

---

## Key Prop Changes

| q-separator prop | OSeparator equivalent | Notes |
|---|---|---|
| `vertical` | `vertical` | Unchanged |
| `inset` | `class="tw:mx-4"` / `class="tw:my-2"` (vertical) | **Drop prop** ΓÇö Tailwind class |
| `spaced` | `class="tw:my-2"` / `class="tw:mx-2"` (vertical) | **Drop prop** ΓÇö Tailwind class |
| `horizontal` | removed | Horizontal is the default ΓÇö drop it |
| `color="grey-4"` | `class="tw:bg-separator-strong"` | **Drop prop** ΓÇö Tailwind class |
| `color="white"` / any other color | `class="tw:bg-[value]"` | **Drop prop** ΓÇö Tailwind class |
| `size="Xpx"` | `class="tw:h-[Xpx]"` | **Drop prop** ΓÇö Tailwind class |
| `dark` | removed | CSS variables handle dark mode |
| Quasar spacing classes (`q-my-sm`, etc.) | Tailwind equivalent (`tw:my-2`, etc.) | See spacing table in migration guide |
| `style="margin-top: -1px"` | `class="tw:-mt-px"` | Inline style ΓåÆ Tailwind class |
| `style="flex-shrink: 0"` | `class="tw:shrink-0"` | Inline style ΓåÆ Tailwind class |
| `style="width: 100%"` | `class="tw:w-full"` | Inline style ΓåÆ Tailwind class |

---

## Files to Migrate

Legend: `[ ]` = not done ┬╖ `[x]` = done

### Tier 1 ΓÇö High density (5+ occurrences)

- [ ] src/plugins/logs/SearchBar.vue *(14)*
- [ ] src/components/logstream/AssociatedRegexPatterns.vue *(8)*
- [ ] src/components/alerts/AlertHistory.vue *(9)*
- [ ] src/components/pipelines/PipelineHistory.vue *(9)*
- [ ] src/components/O2AIChat.vue *(7)*
- [ ] src/plugins/pipelines/CustomNode.vue *(6)*
- [ ] src/components/dashboards/addPanel/DashboardQueryBuilder.vue *(6)*
- [ ] src/components/Header.vue *(5)*
- [ ] src/components/rum/ResourceDetailDrawer.vue *(5)*
- [ ] src/components/alerts/ImportSemanticGroupsDrawer.vue *(5)*

### Tier 2 ΓÇö Medium density (2ΓÇô4 occurrences)

- [ ] src/components/DateTime.vue *(4)*
- [ ] src/components/DateTimePicker.vue *(3)*
- [ ] src/components/QueryPlanDialog.vue *(4)*
- [ ] src/components/alerts/AlertList.vue *(3)*
- [ ] src/components/alerts/AlertInsightsContextMenu.vue *(2)*
- [ ] src/components/alerts/ImportSemanticGroups.vue *(3)*
- [ ] src/components/alerts/SemanticFieldGroupsConfig.vue *(2)*
- [ ] src/components/dashboards/AddDashboardFromGitHub.vue *(2)*
- [ ] src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue *(4)*
- [ ] src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue *(3)*
- [ ] src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue *(4)*
- [ ] src/components/dashboards/PanelEditor/PanelEditor.vue *(4)*
- [ ] src/components/dashboards/settings/VariableQueryValueSelector.vue *(3)*
- [ ] src/components/functions/AddEnrichmentTable.vue *(2)*
- [ ] src/components/ingestion/recommended/KubernetesConfig.vue *(2)*
- [ ] src/components/logstream/schema.vue *(2)*
- [ ] src/components/pipeline/NodeSidebar.vue *(2)*
- [ ] src/components/pipeline/NodeForm/AssociateFunction.vue *(2)*
- [ ] src/components/pipeline/NodeForm/Stream.vue *(2)*
- [ ] src/components/pipeline/PipelinesList.vue *(4)*
- [ ] src/components/pipelines/CreateBackfillJobDialog.vue *(2)*
- [ ] src/components/rum/EventDetailDrawerContent.vue *(2)*
- [ ] src/components/rum/errorTracking/view/ErrorTags.vue *(2)*
- [ ] src/components/settings/AddRegexPattern.vue *(2)*
- [ ] src/components/settings/BuiltInPatternsTab.vue *(2)*
- [ ] src/components/settings/ModelPricingList.vue *(2)*
- [ ] src/components/settings/ServiceIdentitySetup.vue *(4)*
- [ ] src/components/shared/HomeViewSkeleton.vue *(2)*
- [ ] src/enterprise/components/billings/enterprisePlan.vue *(2)*
- [ ] src/enterprise/components/billings/proPlan.vue *(2)*
- [ ] src/plugins/correlation/DimensionFilterEditor.vue *(2)*
- [ ] src/plugins/correlation/TimeRangeEditor.vue *(2)*
- [ ] src/plugins/logs/DetailTable.vue *(3)*
- [ ] src/plugins/logs/SyntaxGuide.vue *(2)*
- [ ] src/plugins/logs/components/FieldListPagination.vue *(2)*
- [ ] src/plugins/logs/patterns/PatternDetailsDialog.vue *(2)*
- [ ] src/plugins/metrics/SyntaxGuideMetrics.vue *(2)*
- [ ] src/plugins/traces/ServiceGraph.vue *(3)*
- [ ] src/plugins/traces/SyntaxGuide.vue *(2)*
- [ ] src/views/CorrelationDemo.vue *(3)*
- [ ] src/views/DetailTable.vue *(2)*
- [ ] src/views/Dashboards/Dashboards.vue *(2)*
- [ ] src/views/PromQL/QueryBuilder.vue *(2)*

### Tier 3 ΓÇö Low density (1 occurrence)

- [ ] src/components/AutoRefreshInterval.vue
- [ ] src/components/NLModeQueryBar.vue
- [ ] src/components/PredefinedThemes.vue
- [ ] src/components/TelemetryCorrelationPanel.vue
- [ ] src/components/ai_toolsets/AddAiToolset.vue
- [ ] src/components/alerts/AddTemplate.vue
- [ ] src/components/alerts/AlertHistoryDrawer.vue
- [ ] src/components/alerts/DeduplicationConfig.vue
- [ ] src/components/alerts/DestinationPreview.vue
- [ ] src/components/alerts/ImportAlert.vue
- [ ] src/components/alerts/ImportDestination.vue
- [ ] src/components/alerts/ImportTemplate.vue
- [ ] src/components/alerts/OrganizationDeduplicationSettings.vue
- [ ] src/components/cipherkeys/AddCipherKey.vue
- [ ] src/components/common/BaseImport.vue
- [ ] src/components/common/GroupHeader.vue
- [ ] src/components/common/JsonEditor.vue
- [ ] src/components/common/sidebar/AddFolder.vue
- [ ] src/components/common/sidebar/FolderList.vue
- [ ] src/components/common/sidebar/MoveAcrossFolders.vue
- [ ] src/components/dashboards/AddDashboard.vue
- [ ] src/components/dashboards/AddFolder.vue
- [ ] src/components/dashboards/MoveDashboardToAnotherFolder.vue
- [ ] src/components/dashboards/PanelSchemaRenderer.vue
- [ ] src/components/dashboards/addPanel/DashboardErrors.vue
- [ ] src/components/dashboards/addPanel/PanelSidebar.vue
- [ ] src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue
- [ ] src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue
- [ ] src/components/dashboards/settings/VariableCustomValueSelector.vue
- [ ] src/components/dashboards/settings/common/DashboardHeader.vue
- [ ] src/components/dashboards/tabs/AddTab.vue
- [ ] src/components/dashboards/viewPanel/ViewPanel.vue
- [ ] src/components/functions/EnrichmentSchema.vue
- [ ] src/components/functions/StreamRouting.vue
- [ ] src/components/iam/groups/AddGroup.vue
- [ ] src/components/iam/groups/EditGroup.vue
- [ ] src/components/iam/organizations/AddUpdateOrganization.vue
- [ ] src/components/iam/roles/AddRole.vue
- [ ] src/components/iam/roles/EditRole.vue
- [ ] src/components/iam/serviceAccounts/AddServiceAccount.vue
- [ ] src/components/iam/users/AddUser.vue
- [ ] src/components/iam/users/UpdateRole.vue
- [ ] src/components/ingestion/recommended/AWSConfig.vue
- [ ] src/components/ingestion/recommended/AWSQuickSetup.vue
- [ ] src/components/ingestion/recommended/AzureQuickSetup.vue
- [ ] src/components/ingestion/recommended/FrontendRumConfig.vue
- [ ] src/components/logstream/AddStream.vue
- [ ] src/components/pipeline/ImportPipeline.vue
- [ ] src/components/pipeline/PipelineEditor.vue
- [ ] src/components/pipeline/NodeForm/Condition.vue
- [ ] src/components/pipeline/NodeForm/ExternalDestination.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue
- [ ] src/components/pipeline/NodeForm/Query.vue
- [ ] src/components/pipeline/NodeForm/ScheduledPipeline.vue
- [ ] src/components/pipelines/BackfillJobDetails.vue
- [ ] src/components/pipelines/BackfillJobsList.vue
- [ ] src/components/pipelines/EditBackfillJobDialog.vue
- [ ] src/components/promql/components/PromQLBuilderOptions.vue
- [ ] src/components/queries/QueryList.vue
- [ ] src/components/rum/PlayerEventsSidebar.vue
- [ ] src/components/rum/correlation/TraceCorrelationCard.vue
- [ ] src/components/rum/errorTracking/view/ErrorStackTrace.vue
- [ ] src/components/rum/errorTracking/view/ErrorTag.vue
- [ ] src/components/settings/DiscoveredServices.vue
- [ ] src/components/settings/DomainManagement.vue
- [ ] src/components/settings/ImportModelPricing.vue
- [ ] src/components/settings/ImportRegexPattern.vue
- [ ] src/components/settings/OrganizationSettings.vue
- [ ] src/components/shared/grid/Pagination.vue
- [ ] src/plugins/logs/SearchHistory.vue
- [ ] src/plugins/logs/SearchJobInspector.vue
- [ ] src/plugins/logs/SearchSchedulersList.vue
- [ ] src/plugins/metrics/AddToDashboard.vue
- [ ] src/plugins/metrics/MetricLegends.vue
- [ ] src/plugins/traces/SearchBar.vue
- [ ] src/plugins/traces/ServiceGraphNodeSidePanel.vue
- [ ] src/plugins/traces/TraceDetailsSidebar.vue
- [ ] src/views/HomeView.vue
- [ ] src/views/Dashboards/DashboardJsonEditor.vue
- [ ] src/views/Dashboards/DashboardSettings.vue
- [ ] src/views/Dashboards/ImportDashboard.vue
- [ ] src/views/Dashboards/PanelLayoutSettings.vue
- [ ] src/views/Dashboards/ViewDashboard.vue
- [ ] src/views/Dashboards/addPanel/AddCondition.vue
- [ ] src/views/RUM/ErrorViewer.vue
- [ ] src/views/RUM/SessionViewer.vue
- [ ] src/views/RUM/SourceMaps.vue
