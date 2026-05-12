# Loading & Progress Migration — Audit & Status

Tracks replacement of all Quasar loading/progress components with O2 equivalents.

## O2 Components

| O2 Component | Replaces | Location |
|---|---|---|
| `<OSpinner variant="ring">` | `q-spinner`, `q-spinner-hourglass`, `q-circular-progress`, `q-spinner-gears` | `@/lib/feedback/Spinner/OSpinner.vue` |
| `<OSpinner variant="dots">` | `q-spinner-dots` | `@/lib/feedback/Spinner/OSpinner.vue` |
| `<OInnerLoading>` | `q-inner-loading` | `@/lib/feedback/InnerLoading/OInnerLoading.vue` |
| `<OSkeleton>` | `q-skeleton` | `@/lib/feedback/Skeleton/OSkeleton.vue` |
| `<OProgressBar>` | `q-linear-progress` | `@/lib/data/ProgressBar/OProgressBar.vue` |

## Size Mapping (Quasar → O2)

| Quasar size | Pixels (approx) | O2 size |
|---|---|---|
| `xs` / `10px` / `1rem` / `16px` | ≤16px | `xs` |
| `sm` / `18px` / `20px` / `1.2em` / `1.25rem` / `1.5em` | 18–20px | `xs` |
| `md` / `24px` / `1.5rem` / `1.8rem` / `1.875rem` / `30px` / `32px` | 24–32px | `sm` |
| `lg` / `36px` / `40px` | 36–40px | `md` |
| `50px` / `3rem` / `3.125rem` / `3.75rem` / `4em` / `60px` | 48–64px | `lg` |
| `80px` / `xl` | 80px+ | `xl` |

---

## Status Legend

- `[ ]` Not started
- `[x]` Done
- `[!]` Special handling required (see note)

---

## OSpinner — ring variant (q-spinner · q-spinner-hourglass · q-circular-progress · q-spinner-gears)

> Total: ~88 usages across ~60 files

### views/

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `views/About.vue` | 181 | `<q-spinner size="40px" color="primary" />` | `<OSpinner size="md" />` |
| `[x]` | `views/StreamExplorer.vue` | 15 | `<q-spinner-hourglass color="primary" size="40px" style="...">` | `<OSpinner size="md" />` |
| `[x]` | `views/ShortUrl.vue` | 6 | `<q-spinner data-test="spinner" color="primary" size="3em" :thickness="2" />` | `<OSpinner size="lg" data-test="spinner" />` — drop `:thickness` |
| `[x]` | `views/LogStream.vue` | 135 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `views/Dashboards/ScheduledDashboards.vue` | 40 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `views/RUM/SourceMaps.vue` | 123 | `<q-spinner-hourglass color="primary" size="...">` | `<OSpinner size="md" />` |
| `[x]` | `views/RUM/RealUserMonitoring.vue` | 24 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `views/RUM/ErrorViewer.vue` | 26 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `views/RUM/AppSessions.vue` | 92 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `views/RUM/AppErrors.vue` | 89 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `views/AwsMarketplaceSetup.vue` | 140 | `<q-spinner-gears size="80px" color="primary" />` | `<OSpinner size="xl" />` |

### components/

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `components/TenstackTable.vue` | 317 | `<q-spinner-hourglass size="20px" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/TelemetryCorrelationPanel.vue` | 20 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/dashboards/AddDashboardFromGitHub.vue` | 45 | `<q-spinner color="primary" size="3em" />` | `<OSpinner size="lg" />` |
| `[x]` | `components/actionScripts/ScriptEditor.vue` | 14 | `<q-spinner-hourglass size="18px" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/actionScripts/ActionScripts.vue` | 98 | `<q-circular-progress indeterminate rounded size="16px" :value="1" color="secondary" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/alerts/AlertInsights.vue` | 235 | `<q-spinner-hourglass color="primary" size="40px" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/AlertList.vue` | 391 | `<q-circular-progress indeterminate rounded size="16px" :value="1" color="secondary" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/alerts/AlertHistoryDrawer.vue` | 170 | `<q-spinner-hourglass size="32px" color="primary" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/alerts/DestinationTestResult.vue` | 126 | `<q-spinner color="primary" size="20px" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/alerts/AddDestination.vue` | 176 | `<q-spinner color="primary" size="40px" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/QueryEditorDialog.vue` | 180 | `<q-spinner size="10px" style="flex-shrink:0;" />` | `<OSpinner size="xs" class="tw:shrink-0" />` — move inline style to class |
| `[x]` | `components/alerts/QueryEditorDialog.vue` | 345 | `<q-spinner-hourglass color="primary" size="36px" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/QueryEditorDialog.vue` | 401 | `<q-spinner-hourglass color="primary" size="36px" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/IncidentDetailDrawer.vue` | 1023 | `<q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />` | `<OSpinner size="lg" class="tw:mb-4" />` — fix class prefix too |
| `[x]` | `components/alerts/IncidentDetailDrawer.vue` | 1073 | `<q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />` | `<OSpinner size="lg" class="tw:mb-4" />` |
| `[x]` | `components/alerts/IncidentDetailDrawer.vue` | 1131 | `<q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />` | `<OSpinner size="lg" class="tw:mb-4" />` |
| `[x]` | `components/alerts/IncidentDetailDrawer.vue` | 1180 | `<q-spinner-hourglass size="lg" color="primary" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/IncidentServiceGraph.vue` | 62 | `<q-spinner size="lg" color="primary" />` | `<OSpinner size="md" />` |
| `[x]` | `components/alerts/IncidentList.vue` | 196 | `<q-spinner-hourglass color="primary" size="3rem" />` | `<OSpinner size="lg" />` |
| `[x]` | `components/functions/TestFunction.vue` | 187 | `<q-spinner-hourglass size="18px" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/functions/TestFunction.vue` | 247 | `<q-spinner-hourglass size="18px" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/functions/EnrichmentSchema.vue` | 50 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/iam/roles/PermissionsTable.vue` | 72 | `<q-circular-progress indeterminate rounded size="20px" color="primary" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/iam/roles/EditRole.vue` | 38 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/iam/quota/Quota.vue` | 264 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/iam/quota/Quota.vue` | 422 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/iam/quota/Quota.vue` | 430 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/iam/quota/Quota.vue` | 457 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/logstream/schema.vue` | 94 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/logstream/LlmEvaluationSettings.vue` | 20 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/logstream/AssociatedRegexPatterns.vue` | 327 | `<q-spinner-hourglass color="primary" size="24px" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/pipeline/NodeForm/ScheduledPipeline.vue` | 1150 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/queries/SummaryList.vue` | 36 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/queries/RunningQueriesList.vue` | 34 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `components/reports/ReportList.vue` | 219 | `<q-circular-progress indeterminate rounded size="16px" :value="1" color="secondary" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/rum/VideoPlayer.vue` | 24 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/rum/EventDetailDrawerContent.vue` | 286 | `<q-spinner-hourglass color="primary" size="1rem" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/rum/performance/WebVitalsDashboard.vue` | 60 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/rum/performance/PerformanceSummary.vue` | 53 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/rum/performance/ErrorsDashboard.vue` | 42 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/rum/performance/ApiDashboard.vue` | 44 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `components/rum/correlation/TraceCorrelationCard.vue` | 23 | `<q-spinner-hourglass color="primary" size="1.5rem" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/settings/ServiceIdentityConfig.vue` | 21 | `<q-spinner-hourglass color="primary" size="30px" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/settings/RegexPatternList.vue` | 58 | `<q-spinner-hourglass size="50px" color="primary" style="margin-top: 20vh" />` | `<OSpinner size="lg" class="tw:mt-[20vh]" />` — convert inline style |
| `[x]` | `components/settings/AddRegexPattern.vue` | 338 | `<q-spinner-hourglass color="primary" size="24px" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/settings/DomainManagement.vue` | 139 | `<q-spinner color="primary" size="sm" />` | `<OSpinner size="xs" />` |
| `[x]` | `components/settings/General.vue` | 430 | `<q-spinner-hourglass v-if="loadingState" class="fixed-center" size="lg" color="primary">` | `<OSpinner size="md" class="tw:fixed tw:top-1/2 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2" />` |
| `[x]` | `components/settings/BuiltInModelPricingTab.vue` | 57 | `<q-spinner-hourglass color="primary" size="50px" />` | `<OSpinner size="lg" />` |
| `[x]` | `components/settings/BuiltInPatternsTab.vue` | 70 | `<q-spinner-hourglass color="primary" size="50px" />` | `<OSpinner size="lg" />` |
| `[x]` | `components/settings/DiscoveredServices.vue` | 24 | `<q-spinner-hourglass color="primary" size="1.875rem" />` | `<OSpinner size="sm" />` |
| `[x]` | `components/settings/DiscoveredServices.vue` | 210 | `<q-spinner-hourglass color="primary" size="3rem" />` | `<OSpinner size="lg" />` |
| `[x]` | `components/settings/ModelPricingList.vue` | 181 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `components/settings/License.vue` | 7 | `<q-spinner size="40px" />` | `<OSpinner size="md" />` |

### plugins/

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 156 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 379 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 449 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 644 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 880 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/correlation/TelemetryCorrelationDashboard.vue` | 944 | `<q-spinner-hourglass color="primary" size="3.75rem" class="tw:mb-4" />` | `<OSpinner size="xl" class="tw:mb-4" />` |
| `[x]` | `plugins/correlation/CorrelatedLogsTable.vue` | 214 | `<q-spinner color="primary" size="md" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/logs/DetailTable.vue` | 291 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/logs/DetailTable.vue` | 333 | `<q-spinner-hourglass v-if="correlationLoading" color="primary" size="3rem" class="tw:mb-4" />` | `<OSpinner size="lg" class="tw:mb-4" />` |
| `[x]` | `plugins/logs/DetailTable.vue` | 363 | `<q-spinner-hourglass v-if="correlationLoading" color="primary" size="3rem" class="tw:mb-4" />` | `<OSpinner size="lg" class="tw:mb-4" />` |
| `[x]` | `plugins/logs/SearchResult.vue` | 51 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/logs/SearchResult.vue` | 274 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/logs/SearchBar.vue` | 218 | `<q-spinner-hourglass size="20px" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/logs/SearchBar.vue` | 2073 | `<q-spinner-hourglass size="20px" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/logs/SearchHistory.vue` | 271 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `plugins/logs/SearchJobInspector.vue` | 272 | `<q-spinner-hourglass color="primary" size="50px" />` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/logs/SearchSchedulersList.vue` | 286 | `<q-spinner-hourglass color="primary" size="lg" />` | `<OSpinner size="md" />` |
| `[x]` | `plugins/logs/TenstackTable.vue` | 156 | `<q-spinner-hourglass size="20px" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/logs/JsonPreview.vue` | 110 | `<q-spinner-hourglass v-if="loading" size="lg" color="primary" />` | `<OSpinner size="md" />` |
| `[x]` | `plugins/logs/patterns/PatternList.vue` | 80 | `<q-spinner-hourglass color="primary" size="3.125rem" />` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/logs/components/FieldList.vue` | 192 | `<q-spinner-hourglass size="1.25rem" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/TraceEvaluationsView.vue` | 20 | `<q-spinner color="primary" size="60px" />` | `<OSpinner size="xl" />` |
| `[x]` | `plugins/traces/TraceDAG.vue` | 20 | `<q-spinner color="primary" size="50px" />` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/traces/TraceDetailsSidebar.vue` | 824 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `plugins/traces/TraceDetailsSidebar.vue` | 880 | `<q-spinner-hourglass ...>` | `<OSpinner size="md" />` |
| `[x]` | `plugins/traces/TraceDetails.vue` | 818 | `<q-spinner-hourglass data-test="trace-details-loading-spinner" color="primary" size="3em" :thickness="2" />` | `<OSpinner size="lg" data-test="trace-details-loading-spinner" />` — drop `:thickness` |
| `[x]` | `plugins/traces/ServiceGraph.vue` | 179 | `<q-spinner-hourglass color="primary" size="4em" />` | `<OSpinner size="xl" />` |
| `[x]` | `plugins/traces/ServiceGraphNodeSidePanel.vue` | 271 | `<q-spinner color="primary" size="sm" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/ServiceGraphNodeSidePanel.vue` | 393 | `<q-spinner color="primary" size="sm" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/ServiceGraphNodeSidePanel.vue` | 521 | `<q-spinner color="primary" size="sm" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/ServiceGraphEdgeSidePanel.vue` | 192 | `<q-spinner color="primary" size="sm" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/ServicesCatalog.vue` | 357 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/traces/ServicesCatalog.vue` | 376 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/traces/IndexList.vue` | 144 | `<q-spinner-hourglass size="1.8rem" color="primary" />` | `<OSpinner size="sm" />` |
| `[x]` | `plugins/traces/fields-sidebar/BasicValuesFilter.vue` | 70 | `<q-spinner size="1rem" color="primary" />` | `<OSpinner size="xs" />` |
| `[x]` | `plugins/traces/components/TracesSearchResultList.vue` | 91 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/traces/components/TracesSearchResultList.vue` | 109 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |
| `[x]` | `plugins/traces/metrics/TracesAnalysisDashboard.vue` | 284 | `<q-spinner-hourglass ...>` | `<OSpinner size="lg" />` |

### enterprise/

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `enterprise/components/EvalTemplateList.vue` | 167 | `<q-spinner-hourglass color="primary" size="3rem" />` | `<OSpinner size="lg" />` |

---

## OSpinner — dots variant (q-spinner-dots)

> Total: 14 usages across 11 files

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `views/Dashboards/ViewDashboard.vue` | 65 | `<q-spinner-dots ...>` | `<OSpinner variant="dots" size="md" />` |
| `[x]` | `views/AzureMarketplaceSetup.vue` | 131 | `<q-spinner-dots size="60px" color="primary" />` | `<OSpinner variant="dots" size="xl" />` |
| `[x]` | `views/AwsMarketplaceSetup.vue` | 131 | `<q-spinner-dots size="60px" color="primary" />` | `<OSpinner variant="dots" size="xl" />` |
| `[x]` | `components/alerts/IncidentRCAAnalysis.vue` | 39 | `<q-spinner-dots size="20px" :color="isDarkMode ? 'indigo-3' : 'indigo-7'" />` | `<OSpinner variant="dots" size="xs" />` — remove dynamic `:color`, token handles dark mode |
| `[x]` | `components/alerts/ImportSemanticGroupsDrawer.vue` | 74 | `<q-spinner-dots size="50px" color="primary" />` | `<OSpinner variant="dots" size="lg" />` |
| `[x]` | `components/alerts/IncidentTimeline.vue` | 22 | `<q-spinner-dots size="40px" color="primary" />` | `<OSpinner variant="dots" size="md" />` |
| `[x]` | `components/common/FieldValuesPanel.vue` | 186 | `<q-spinner-dots v-if="isLoadingMore" color="primary" size="1em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/NLModeQueryBar.vue` | 115 | `<q-spinner-dots color="primary" size="1.2em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/O2AIChat.vue` | 435 | `<q-spinner-dots color="primary" size="1.5em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/O2AIChat.vue` | 1198 | `<q-spinner-dots color="primary" size="1.5em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/O2AIChat.vue` | 1261 | `<q-spinner-dots color="primary" size="1.5em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/O2AIChat.vue` | 1293 | `<q-spinner-dots color="primary" size="1.5em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/O2AIChat.vue` | 1298 | `<q-spinner-dots color="primary" size="1.5em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/QueryEditor.vue` | 16 | `<q-spinner-dots color="primary" size="1.2em" />` | `<OSpinner variant="dots" size="xs" />` |
| `[x]` | `components/QueryPlanDialog.vue` | 97 | `<q-spinner-dots color="primary" size="50px" />` | `<OSpinner variant="dots" size="lg" />` |
| `[x]` | `components/rum/errorTracking/view/PrettyStackTrace.vue` | 21 | `<q-spinner-dots color="primary" size="3em" />` | `<OSpinner variant="dots" size="lg" />` |
| `[x]` | `enterprise/components/billings/plans.vue` | 77 | `<q-spinner-dots color="primary" size="40px" ...>` | `<OSpinner variant="dots" size="md" />` |

---

## OInnerLoading (q-inner-loading)

> Total: 3 usages across 3 files

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `components/common/FieldValuesPanel.vue` | 105 | `<q-inner-loading size="xs" :showing="..." label="Fetching values..." label-style="font-size: 1.1em" />` | `<OInnerLoading :showing="..." label="Fetching values..." size="xs" />` — drop `label-style` |
| `[x]` | `components/functions/AssociatedStreamFunction.vue` | 83 | `<q-inner-loading size="sm" :showing="loadingFunctions" label="Fetching functions..." label-style="font-size: 1.1em" />` | `<OInnerLoading :showing="loadingFunctions" label="Fetching functions..." size="xs" />` — note: container needs `tw:relative` if not already set |
| `[x]` | `plugins/metrics/MetricList.vue` | 149 | `<q-inner-loading size="xs" :showing="..." label="Fetching values..." label-style="font-size: 1.1em" />` | `<OInnerLoading :showing="..." label="Fetching values..." size="xs" />` |

---

## OSkeleton (q-skeleton)

> Total: 7 usages across 3 files + 1 `:deep(.q-skeleton)` CSS rule to remove

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `components/EnterpriseUpgradeDialog.vue` | 49 | `<q-skeleton type="circle" size="40px" animation="pulse" style="background: rgba(255,255,255,0.2);" />` | `<OSkeleton type="circle" class="tw:size-10" />` — remove inline `style` bg override (token handles it) |
| `[x]` | `components/EnterpriseUpgradeDialog.vue` | 56 | `<q-skeleton type="rect" width="200px" height="44px" animation="pulse" style="background: rgba(255,255,255,0.2); border-radius:24px;" />` | `<OSkeleton type="rect" class="tw:w-[200px] tw:h-11 tw:rounded-full" />` — convert props to classes |
| `[x]` | `components/EnterpriseUpgradeDialog.vue` | 79 | `<q-skeleton type="rect" height="150px" animation="pulse" style="background: rgba(255,255,255,0.1); border-radius:8px;" />` | `<OSkeleton type="rect" class="tw:h-[150px] tw:rounded-lg" />` — convert props to classes |
| `[x]` | `components/settings/ServiceIdentitySetup.vue` | 24 | `<q-skeleton type="rect" height="56px" class="tw:rounded-lg" />` | `<OSkeleton type="rect" class="tw:h-14 tw:rounded-lg" />` |
| `[x]` | `components/settings/ServiceIdentitySetup.vue` | 25 | `<q-skeleton type="rect" height="56px" class="tw:rounded-lg" />` | `<OSkeleton type="rect" class="tw:h-14 tw:rounded-lg" />` |
| `[x]` | `components/settings/ServiceIdentitySetup.vue` | 26 | `<q-skeleton type="rect" height="40px" width="160px" class="tw:rounded-lg" />` | `<OSkeleton type="rect" class="tw:h-10 tw:w-40 tw:rounded-lg" />` |
| `[x]` | `plugins/correlation/CorrelatedLogsTable.vue` | 135 | `<q-skeleton type="rect" width="200px" height="32px" />` | `<OSkeleton type="rect" class="tw:w-[200px] tw:h-8" />` |
| `[x]` | `plugins/correlation/CorrelatedLogsTable.vue` | 138 | `<q-skeleton type="rect" width="200px" height="32px" />` | `<OSkeleton type="rect" class="tw:w-[200px] tw:h-8" />` |
| `[x]` | `plugins/correlation/CorrelatedLogsTable.vue` | 141 | `<q-skeleton type="rect" width="200px" height="32px" />` | `<OSkeleton type="rect" class="tw:w-[200px] tw:h-8" />` |
| `[x]` | `plugins/correlation/CorrelatedLogsTable.vue` | 1063 | `:deep(.q-skeleton) { ... }` | Remove the entire `:deep(.q-skeleton)` CSS block — `OSkeleton` uses its own token |

---

## OProgressBar (q-linear-progress)

> Total: 7 usages across 5 files

| Status | File | Line | Current | O2 replacement |
|---|---|---|---|---|
| `[x]` | `enterprise/components/billings/plans.vue` | 46 | `<q-linear-progress :value="aiUsageRatio" size="12px" rounded :color="aiUsageRatio >= 1 ? 'negative' : aiUsageRatio >= 0.9 ? 'warning' : 'primary'" track-color="grey-3" />` | `<OProgressBar :value="aiUsageRatio" size="md" :variant="aiUsageRatio >= 1 ? 'danger' : aiUsageRatio >= 0.9 ? 'warning' : 'default'" />` |
| `[x]` | `components/settings/Nodes.vue` | 651 | `<q-linear-progress dark size="10px" rounded :value="props.row.cpu_usage / 100" :color="props.row.cpu_usage > 85 ? 'red-9' : 'primary'" />` | `<OProgressBar :value="props.row.cpu_usage / 100" size="sm" :variant="props.row.cpu_usage > 85 ? 'danger' : 'default'" />` |
| `[x]` | `components/settings/Nodes.vue` | 665 | `<q-linear-progress dark size="10px" rounded :value="props.row.percentage_memory_usage / 100" :color="props.row.percentage_memory_usage > 85 ? 'red-9' : 'primary'" />` | `<OProgressBar :value="props.row.percentage_memory_usage / 100" size="sm" :variant="props.row.percentage_memory_usage > 85 ? 'danger' : 'default'" />` |
| `[x]` | `components/pipelines/BackfillJobsList.vue` | 155 | `<q-linear-progress :value="..." :color="getProgressColor(...)" size="20px" rounded data-test="progress-bar"> <div ...>{{ progress }}%</div> </q-linear-progress>` | `<OProgressBar :value="..." :variant="getProgressVariant(...)" size="lg" data-test="progress-bar">{{ progress }}%</OProgressBar>` — rename `getProgressColor` → `getProgressVariant` returning O2 variant string |
| `[x]` | `components/pipelines/BackfillJobDetails.vue` | 95 | `<q-linear-progress :value="job.progress_percent / 100" :color="getProgressColor(job.deletion_status)" size="12px" rounded />` | `<OProgressBar :value="job.progress_percent / 100" :variant="getProgressVariant(job.deletion_status)" size="md" />` |
| `[x]` | `components/rum/common/performance/MetricCard.vue` | 61 | `<q-linear-progress :value="progressValue" :color="statusColor" size="4px" />` | `<OProgressBar :value="progressValue" :variant="statusVariant" size="xs" />` — rename `statusColor` computed → `statusVariant` returning `'default' \| 'warning' \| 'danger'` |

---

## Special Cases Summary

| File | Issue | Action |
|---|---|---|
| `views/ShortUrl.vue:6` | `:thickness="2"` prop | Drop — not supported, not visible |
| `plugins/traces/TraceDetails.vue:818` | `:thickness="2"` prop | Drop — not supported, not visible |
| `components/alerts/QueryEditorDialog.vue:180` | `style="flex-shrink:0;"` inline style | Replace with `class="tw:shrink-0"` |
| `components/alerts/IncidentDetailDrawer.vue:1023/1073/1131` | `class="tw-mb-4"` (wrong prefix — `tw-` not `tw:`) | Fix prefix to `tw:mb-4` while migrating |
| `components/alerts/IncidentRCAAnalysis.vue:39` | `:color="isDarkMode ? 'indigo-3' : 'indigo-7'"` | Drop entirely — `OSpinner` uses brand primary token; dark mode handled by `dark.css` |
| `components/settings/RegexPatternList.vue:58` | `style="margin-top: 20vh"` inline style | Replace with `class="tw:mt-[20vh]"` |
| `components/settings/General.vue:430` | `class="fixed-center"` (Quasar utility) | Replace with `class="tw:fixed tw:top-1/2 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2"` |
| `components/EnterpriseUpgradeDialog.vue:49/56/79` | `height=`, `width=`, `size=` HTML props + `style=` inline bg overrides | Convert all sizing to Tailwind classes; remove inline `style` |
| `components/pipelines/BackfillJobsList.vue:155` | `q-linear-progress` with slot child for label | Wrap slot content directly: `<OProgressBar ...>{{ text }}</OProgressBar>` |
| `components/pipelines/BackfillJobsList.vue` | `getProgressColor()` returns Quasar color string | Add/rename to `getProgressVariant()` returning `'default' \| 'warning' \| 'danger'` |
| `components/pipelines/BackfillJobDetails.vue` | Same as above | Same |
| `components/rum/common/performance/MetricCard.vue` | `statusColor` computed returns Quasar color | Add `statusVariant` computed returning O2 variant |
| `plugins/correlation/CorrelatedLogsTable.vue:1063` | `:deep(.q-skeleton) { ... }` scoped CSS | Delete the entire block |

---

## Progress Summary

| Component | Total usages | Done | Remaining |
|---|---|---|---|
| OSpinner (ring) | 88 | 88 | 0 |
| OSpinner (dots) | 17 | 17 | 0 |
| OInnerLoading | 3 | 3 | 0 |
| OSkeleton | 10 | 10 | 0 |
| OProgressBar | 6 | 6 | 0 |
| **Total** | **124** | **124** | **0** |
