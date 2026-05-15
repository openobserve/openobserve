# Quasar Card & Expansion ΓÇö Migration Checklist

Tracks every file that uses a legacy Quasar card or expansion component and the O2 replacement to use.

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-card>` (default) | `<OCard>` | `@/lib/core/Card/OCard.vue` |
| `<q-card flat>` | `<OCard>` | `@/lib/core/Card/OCard.vue` |
| `<q-card flat bordered>` | `<OCard>` | `@/lib/core/Card/OCard.vue` ΓÇö bordered dropped |
| `<q-card bordered>` | `<OCard>` | `@/lib/core/Card/OCard.vue` ΓÇö bordered dropped |
| `<q-card-section>` | `<OCardSection>` | `@/lib/core/Card/OCardSection.vue` |
| `<q-card-section class="row items-center ...">` | `<OCardSection role="header">` | `@/lib/core/Card/OCardSection.vue` |
| `<q-card-section class="q-pa-none">` | `<OCardSection class="tw:p-0">` | `@/lib/core/Card/OCardSection.vue` |
| `<q-card-section class="q-pa-md tw:flex-1 tw:overflow-y-auto">` | `<OCardSection role="body" scrollable>` | `@/lib/core/Card/OCardSection.vue` |
| `<q-card-actions>` | `<OCardActions>` | `@/lib/core/Card/OCardActions.vue` |
| `<q-card-actions align="right">` | `<OCardActions>` | `@/lib/core/Card/OCardActions.vue` ΓÇö right-align is the default |
| `<q-card-actions align="center">` | `<OCardActions align="center">` | `@/lib/core/Card/OCardActions.vue` |
| `<q-expansion-item>` | `<OCollapsible>` | `@/lib/core/Collapsible/OCollapsible.vue` |
| `<q-expansion-item default-opened>` | `<OCollapsible defaultOpen>` | `@/lib/core/Collapsible/OCollapsible.vue` |
| `<q-expansion-item v-model="...">` | `<OCollapsible v-model="...">` | `@/lib/core/Collapsible/OCollapsible.vue` |

> **Rule:** Migrate `OCard`, `OCardSection`, and `OCardActions` together per file ΓÇö they always appear as a compound structure. Migrating only one in isolation leaves inconsistent markup.

---

## Key Prop Changes

> **Core principle:** Props should bundle decisions, not expose them. Use `role` to get the right layout in one word. If a use case deviates, pass `class` directly ΓÇö do not add a new prop for it.

### q-card ΓåÆ OCard ΓÇö no props

| q-card prop | OCard equivalent | Notes |
|---|---|---|
| _(no props)_ | `<OCard>` | Direct |
| `flat` | `<OCard>` | **Drop** |
| `flat bordered` | `<OCard>` | **Drop both** ΓÇö borders not carried over |
| `bordered` | `<OCard>` | **Drop** ΓÇö borders not carried over |
| `dark` / `square` | removed | Design tokens handle it |
| `class`, `style`, `data-test` | pass-through | No change |

### q-card-section ΓåÆ OCardSection ΓÇö 2 props (`role`, `scrollable`)

| q-card-section pattern | OCardSection equivalent | Notes |
|---|---|---|
| _(dialog title row)_ | `role="header"` | Bundles: `flex items-center`, non-growing, header padding |
| _(main content area)_ | `role="body"` | Bundles: flex-grow, `padding-md` |
| _(scrollable content area)_ | `role="body" scrollable` | Same as above + `overflow-y: auto` |
| _(footer / secondary info)_ | `role="footer"` | Bundles: flex-shrink, footer padding |
| _(plain section, no layout opinion)_ | _(no props)_ | Plain div ΓÇö pass `class` for all layout |
| `class="q-pa-none"` | `class="tw:p-0"` | Pass Tailwind class directly ΓÇö no `padding` prop |
| `class="q-pa-sm"` | `class="tw:p-2"` | Pass Tailwind class directly |
| `class="row items-center"` (non-header) | `class="tw:flex tw:items-center"` | Pass Tailwind class directly |
| `class="tw:flex-shrink-0"` (non-footer) | `class="tw:shrink-0"` | Pass Tailwind class directly |
| `style="max-height: ...; overflow-y: auto"` | `scrollable style="max-height: ..."` | `scrollable` handles overflow |
| `:deep(.q-card__section) { padding: 0 }` | `class="tw:p-0"` on the section | **Delete the deep override** |

### q-card-actions ΓåÆ OCardActions ΓÇö 1 prop (`align`), often zero

| q-card-actions pattern | OCardActions equivalent | Notes |
|---|---|---|
| `align="right"` | _(no props)_ | Right-align is the **default** ΓÇö write nothing |
| `align="center"` | `align="center"` | Only prop you ever write |
| `align="left"` | `align="left"` | |
| `class="confirmActions"` | removed | Absorbed into defaults |
| `class="tw:gap-2"` | removed | Absorbed into defaults |
| `class="q-pa-md"` | removed | Absorbed into defaults |
| `class="tw:flex-shrink-0"` | `class="tw:shrink-0"` | Pass class directly |

### q-expansion-item ΓåÆ OCollapsible ΓÇö 6 props (down from Quasar's 20+)

| q-expansion-item prop | OCollapsible equivalent | Notes |
|---|---|---|
| `label` / `:label` | `label` / `:label` | Unchanged |
| `icon` | `icon` | Unchanged ΓÇö still a string icon name |
| `caption` | `caption` | Unchanged |
| `default-opened` | `defaultOpen` | camelCase |
| `v-model` | `v-model` | Unchanged |
| `@update:model-value` | `@update:modelValue` | camelCase event |
| `expand-separator` | Use `<OSeparator>` between items | **No prop** ΓÇö compose with `OSeparator` |
| `header-class` | Use `#trigger` slot | **No prop** ΓÇö apply classes directly inside slot |
| `expand-icon-class` | Use `#trigger` slot | **No prop** ΓÇö icon lives inside trigger slot |
| `switch-toggle-side` | `#trigger` slot with `class="tw:flex-row-reverse"` | **No prop** ΓÇö layout via Tailwind inside slot |
| `group` | `group` | Unchanged |
| `hide-expand-icon` | Use `#trigger` slot | **No prop** ΓÇö slot presence suppresses default chevron |
| `expand-icon` / `expanded-icon` | Use `#trigger` slot | **No props** ΓÇö put icon in trigger slot |
| Inner `<q-card><q-card-section>` for padding | `<div class="tw:p-...">` wrapping slot content | **No prop** ΓÇö wrap default slot content in a div |
| `dense` / `bordered` / `color` / `dark` / `dense-toggle` | removed | Not needed |

---

## Files to Migrate

Legend: `[ ]` = not done ┬╖ `[x]` = done ┬╖ `[C]` = contains all 3 card family components ┬╖ `[E]` = contains q-expansion-item

> Files that appear in both the Card section and the Expansion section must be migrated
> for **both** in a single pass ΓÇö they share the same compound structure in most cases.

---

### q-card + q-card-section + q-card-actions ΓåÆ OCard + OCardSection + OCardActions

Files marked `[C]` use all three card family components and should be migrated as a unit.
Files with only q-card or only q-card-section (no actions) are not marked.

**Highest priority (most tags):**

- [ ] [C] src/plugins/logs/SearchBar.vue *(58 total tags)*
- [ ] [C] src/components/settings/Nodes.vue *(42 tags ΓÇö also has 14 q-expansion-item)*
- [ ] [C] src/components/O2AIChat.vue *(34 tags)*
- [ ] [C] src/components/settings/License.vue *(28 tags)*
- [ ] [C] src/components/anomaly_detection/AnomalyDetectionList.vue *(24 tags)*
- [ ] [C] src/views/CorrelationDemo.vue *(22 tags)*
- [ ] [C] src/components/iam/serviceAccounts/ServiceAccountsList.vue *(22 tags)*
- [ ] [C] src/components/alerts/AlertHistory.vue *(20 tags)*
- [ ] [C] src/components/ingestion/recommended/AWSIntegrationTile.vue *(20 tags)*
- [ ] [C] src/components/pipelines/PipelineHistory.vue *(20 tags)*
- [ ] [C] src/components/settings/ServiceIdentitySetup.vue *(20 tags)*
- [ ] [C] src/components/alerts/ImportSemanticGroups.vue *(18 tags ΓÇö also has q-expansion-item)*
- [ ] [C] src/components/alerts/ImportSemanticGroupsDrawer.vue *(18 tags ΓÇö also has q-expansion-item)*
- [ ] [C] src/components/iam/users/User.vue *(18 tags)*
- [ ] [C] src/components/PredefinedThemes.vue *(18 tags)*
- [ ] [C] src/views/PromQL/QueryBuilder.vue *(18 tags)*
- [ ] [C] src/components/dashboards/AddDashboardFromGitHub.vue *(16 tags)*
- [ ] [C] src/components/dashboards/addPanel/AddAnnotation.vue *(16 tags)*
- [ ] src/plugins/logs/patterns/PatternDetailsDialog.vue *(16 tags)*
- [ ] [C] src/components/alerts/DedupSummaryCards.vue *(16 tags)*

**Standard priority (6ΓÇô14 tags):**

- [ ] [C] src/components/iam/users/AddUser.vue
- [ ] [C] src/components/iam/users/InvitationList.vue
- [ ] [C] src/components/pipelines/CreateBackfillJobDialog.vue
- [ ] [C] src/components/settings/General.vue
- [ ] [C] src/components/settings/OrganizationManagement.vue
- [ ] [C] src/components/pipelines/BackfillJobDetails.vue
- [ ] src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue
- [ ] src/views/Dashboards/PanelLayoutSettings.vue
- [ ] [C] src/components/shared/filter/FilterCreatorPopup.vue
- [ ] [C] src/plugins/correlation/TelemetryCorrelationDashboard.vue
- [ ] [C] src/plugins/traces/ServiceGraph.vue
- [ ] [C] src/components/QueryPlanDialog.vue
- [ ] src/views/LogStream.vue
- [ ] [C] src/components/logstream/schema.vue
- [ ] src/plugins/logs/SearchJobInspector.vue
- [ ] src/plugins/logs/SyntaxGuide.vue
- [ ] src/plugins/metrics/SyntaxGuideMetrics.vue
- [ ] src/plugins/traces/SyntaxGuide.vue
- [ ] [C] src/components/pipeline/NodeForm/AssociateFunction.vue
- [ ] [C] src/plugins/logs/DetailTable.vue
- [ ] [C] src/components/promql/components/OperationsList.vue *(also has q-expansion-item)*
- [ ] [C] src/components/settings/ServiceIdentitySetup.vue
- [ ] [C] src/components/logstream/AssociatedRegexPatterns.vue *(also has q-expansion-item)*
- [ ] [C] src/plugins/traces/DbSpanDetails.vue *(also has q-expansion-item)*

**Standard priority (4ΓÇô6 tags):**

- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] [C] src/components/alerts/CustomConfirmDialog.vue
- [ ] [C] src/components/alerts/DestinationPreview.vue
- [ ] src/components/common/JsonEditor.vue
- [ ] src/components/common/sidebar/AddFolder.vue
- [ ] src/components/common/sidebar/FieldList.vue *(also has q-expansion-item)*
- [ ] src/components/common/sidebar/MoveAcrossFolders.vue
- [ ] [C] src/components/ConfirmDialog.vue
- [ ] [C] src/components/cross-linking/CrossLinkDialog.vue
- [ ] src/components/dashboards/AddDashboard.vue
- [ ] src/components/dashboards/AddFolder.vue
- [ ] src/components/dashboards/MoveDashboardToAnotherFolder.vue
- [ ] src/components/dashboards/addPanel/ShowLegendsPopup.vue
- [ ] [C] src/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue
- [ ] src/components/dashboards/QueryInspector.vue
- [ ] [C] src/components/dashboards/settings/SinglePanelMove.vue
- [ ] [C] src/components/dashboards/settings/TabsDeletePopUp.vue
- [ ] src/components/dashboards/settings/VariableSettings.vue
- [ ] src/components/dashboards/tabs/AddTab.vue
- [ ] src/components/functions/EnrichmentSchema.vue
- [ ] src/components/functions/EnrichmentTableList.vue
- [ ] src/components/functions/FunctionList.vue
- [ ] src/components/iam/groups/AddGroup.vue
- [ ] src/components/iam/organizations/AddUpdateOrganization.vue
- [ ] src/components/iam/roles/AddRole.vue
- [ ] src/components/iam/serviceAccounts/AddServiceAccount.vue
- [ ] src/components/iam/users/UpdateRole.vue
- [ ] [C] src/components/logstream/PerformanceFieldsDialog.vue
- [ ] src/components/pipeline/NodeForm/Condition.vue
- [ ] src/components/pipeline/NodeForm/CreateDestinationForm.vue
- [ ] [C] src/components/pipeline/PipelinesList.vue
- [ ] [C] src/components/pipelines/BackfillJobsList.vue
- [ ] [C] src/components/pipelines/EditBackfillJobDialog.vue *(also has q-expansion-item)*
- [ ] [C] src/components/ResumePipelineDialog.vue
- [ ] [C] src/components/settings/BuiltInPatternsTab.vue
- [ ] src/components/settings/ModelPricingEditor.vue
- [ ] [C] src/plugins/correlation/DimensionFilterEditor.vue
- [ ] [C] src/plugins/correlation/TimeRangeEditor.vue
- [ ] src/plugins/logs/JsonPreview.vue
- [ ] src/plugins/metrics/AddToDashboard.vue
- [ ] src/plugins/metrics/MetricLegends.vue
- [ ] src/plugins/metrics/MetricList.vue *(also has q-expansion-item)*
- [ ] [C] src/plugins/traces/metrics/TracesAnalysisDashboard.vue
- [ ] [C] src/plugins/traces/TraceDetails.vue
- [ ] [C] src/views/AwsMarketplaceSetup.vue
- [ ] [C] src/views/AzureMarketplaceSetup.vue
- [ ] [C] src/views/Dashboards/DashboardJsonEditor.vue
- [ ] src/views/DetailTable.vue
- [ ] [C] src/views/RUM/SourceMaps.vue

**Low priority (2 tags each):**

- [ ] src/components/alerts/AlertHistoryDrawer.vue
- [ ] src/components/alerts/SemanticFieldGroupsConfig.vue
- [ ] src/components/dashboards/addPanel/ColumnOrderPopUp.vue
- [ ] src/components/EnterpriseUpgradeDialog.vue
- [ ] src/components/functions/AddEnrichmentTable.vue
- [ ] src/components/ingestion/recommended/AzureIntegrationTile.vue
- [ ] src/components/ingestion/recommended/AzureQuickSetup.vue
- [ ] src/components/queries/QueryList.vue
- [ ] src/components/query-plan/MetricsSummaryCard.vue
- [ ] src/components/rum/EventDetailDrawerContent.vue
- [ ] src/components/settings/DiscoveredServices.vue
- [ ] src/components/settings/TestModelMatchDialog.vue
- [ ] src/enterprise/components/billings/enterprisePlan.vue
- [ ] src/enterprise/components/billings/proPlan.vue
- [ ] src/plugins/logs/components/FieldExpansion.vue *(also has q-expansion-item)*
- [ ] src/plugins/traces/fields-sidebar/BasicValuesFilter.vue *(also has q-expansion-item)*
- [ ] src/views/Dashboards/RenderDashboardCharts.vue

---

### q-expansion-item ΓåÆ OCollapsible

Files marked `[deep]` have `:deep()` CSS overrides that are **eliminated** by O2 props ΓÇö delete the override once migrated.

- [ ] [deep] src/components/dashboards/addPanel/ConfigPanel.vue *(40 tags ΓÇö fully controlled pattern)*
- [ ] [deep] src/components/settings/Nodes.vue *(14 tags ΓÇö also in card section above)*
- [ ] [deep] src/plugins/traces/TraceEvaluationsView.vue *(8 tags)*
- [ ] src/plugins/traces/TraceDetailsSidebar.vue *(4 tags)*
- [ ] [deep] src/components/settings/ServiceIdentityConfig.vue *(4 tags)*
- [ ] [deep] src/components/logstream/AssociatedRegexPatterns.vue *(4 tags ΓÇö also in card section above)*
- [ ] src/components/alerts/DestinationTestResult.vue *(2 tags)*
- [ ] src/components/alerts/ImportSemanticGroups.vue *(2 tags ΓÇö also in card section above)*
- [ ] src/components/alerts/ImportSemanticGroupsDrawer.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/components/common/sidebar/FieldList.vue *(2 tags ΓÇö also in card section above)*
- [ ] src/components/dashboards/addPanel/StreamFieldSelect.vue *(2 tags)*
- [ ] src/components/ingestion/recommended/KubernetesConfig.vue *(2 tags)*
- [ ] src/components/pipelines/EditBackfillJobDialog.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/components/promql/components/OperationsList.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/plugins/logs/components/FieldExpansion.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/plugins/metrics/MetricList.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/plugins/traces/DbSpanDetails.vue *(2 tags ΓÇö also in card section above)*
- [ ] [deep] src/plugins/traces/fields-sidebar/BasicValuesFilter.vue *(2 tags ΓÇö also in card section above)*

---

## CSS to Delete After Migration

Once a file is migrated, remove these now-redundant override rules:

| File | Rule to delete |
|---|---|
| `src/components/O2AIChat.vue` | `.q-card__section { padding: 0 }` |
| `src/components/common/JsonEditor.vue` | `:deep(.q-card__section) { ... }` |
| `src/components/functions/EnrichmentSchema.vue` | `.q-card__section--vert { ... }` |
| `src/components/ingestion/recommended/AWSIntegrationTile.vue` | `.q-card__section, .q-card__actions { padding: ... }` |
| `src/components/ingestion/recommended/AzureIntegrationTile.vue` | `.q-card__section, .q-card__actions { ... }` |
| `src/plugins/traces/metrics/TracesAnalysisDashboard.vue` | `.q-card__section--vert { ... }` |
| `src/views/Dashboards/DashboardJsonEditor.vue` | `:deep(.q-card__section) { padding: 0 }` |
| `src/components/settings/ServiceIdentityConfig.vue` | `:deep(.q-expansion-item__content) { padding-top: 0 }` |
| `src/plugins/logs/components/FieldExpansion.vue` | `:deep(.q-expansion-item__container .q-item) { ... }` |
| `src/plugins/traces/TraceEvaluationsView.vue` | `:deep(.q-expansion-item__container) { border-radius: ... }` |
| `src/components/actionScripts/EditScript.vue` | `.q-expansion-item .q-item { ... }` |
| `src/components/logstream/schema.vue` | `.q-card__section--vert { ... }` |
