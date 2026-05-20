# CSS Class-Level Audit (Project-Wide)

Branch: `feat/ux-revamp-main`
Scope: `web/src/` (2,205 Vue / SCSS / TS files scanned)
Method: ripgrep + Python tokenization of every `class="..."` attribute and every SCSS rule body.

---

## Executive Summary

| Category | Instances |
|---|---|
| Bare Quasar utility classes in `class=` attrs (silent no-ops) | 432 |
| `tw-` dash-prefixed tokens (Tailwind v3 syntax — silent no-op in v4) | 158 |
| Wrong-order variants (`hover:tw:*`, `md:tw:*`, etc.) | 155 |
| `tw:` with invalid Quasar spacing tokens (`tw:mr-md`, `tw:py-md`, ...) | 21 |
| `tw:` with Quasar palette steps (`tw:bg-blue-5`, `tw:text-grey-7`, ...) | 61 |
| `tw:bg-opacity-X` (deprecated v3 syntax) | 4 |
| `tw:` arbitrary value with spaces (parses to nothing) | 8 |
| `:deep(.q-*)` selectors targeting removed components | 164 |
| Bare `.q-*` selectors in scoped/global SCSS | 1,162 |
| `::v-deep` (deprecated Vue combinator) | 5 |
| `.body--dark` selectors (Quasar dark-mode signal — no longer applied) | 148 |
| `var(--q-*)` CSS variables in templates and styles | 291 |
| Quasar SCSS variables (`$primary`, `$dark`, `$grey-*`, ...) | 94 |
| `v-close-popup` directive usages (no longer registered) | 12 |
| `OIcon name="..."` with underscore (registry uses hyphens) | 20 |
| `OIcon :color="..."` (no `color` prop in current OIcon) | 37 |
| **TOTAL problematic class/selector/directive instances** | **~2,890** |

**Highest-impact categories**
1. Bare `.q-*` SCSS selectors — pervasive, but mostly defensive overrides that no longer match anything.
2. `var(--q-*)` CSS variables — 291 usages spread across templates and styles, all driven by the compat shim and at risk if shim is removed.
3. Bare Quasar layout classes (`column`, `col-auto`, `full-height`, `relative-position`, `text-weight-bold`, `text-weight-medium`) — 432 silent no-ops; the most user-visible class of regression.
4. `tw-*` dash form and `hover:tw:*` wrong-order — 313 silent no-ops, almost all introduced after the prefix flip.

**Top 10 affected files** (across all categories)

| Count | File |
|---|---|
| 200 | `web/src/styles/app.scss` |
| 110 | `web/src/styles/logs/logs-page.scss` |
| 63 | `web/src/components/alerts/AddAlert.vue` |
| 58 | `web/src/components/alerts/IncidentDetailDrawer.vue` |
| 41 | `web/src/styles/logs/search-result.scss` |
| 40 | `web/src/plugins/traces/TraceDetails.vue` |
| 36 | `web/src/plugins/logs/patterns/PatternDetailsDialog.vue` |
| 35 | `web/src/styles/schema.scss` |
| 31 | `web/src/components/pipelines/BackfillJobDetails.vue` |
| 30 | `web/src/plugins/metrics/MetricList.vue` |

---

## 1. Quasar Class Leftovers (silent no-ops)

These tokens appear in static `class="..."` attributes without the `tw:` prefix. They no longer resolve to any CSS rule (Quasar's utility stylesheet is gone), so they render as visual regressions.

### 1.1 Spacing (`q-pa-*`, `q-ma-*`, `q-gutter-*`) — 6 instances

| File:Line | Class | Suggested Tailwind | Severity |
|---|---|---|---|
| `web/src/components/cipherkeys/AddCipherKey.vue:63` | `q-mt-md` | `tw:mt-4` | P1 |
| `web/src/components/pipelines/BackfillJobDetails.vue:73` | `q-pa-md` | `tw:p-4` | P1 |
| `web/src/components/pipelines/BackfillJobDetails.vue:108` | `q-pa-md` | `tw:p-4` | P1 |
| `web/src/components/pipelines/BackfillJobDetails.vue:137` | `q-pa-md` | `tw:p-4` | P1 |
| `web/src/components/functions/AddEnrichmentTable.vue:101` | `q-gutter-x-xs` | `tw:gap-x-1` | P1 |
| `web/src/components/dashboards/PanelSchemaRenderer.vue:181` | `q-gutter-x-xs` | `tw:gap-x-1` | P1 |

### 1.2 Layout (`column`, `col-auto`, `full-height`, `relative-position`, `flex-center`, `wrap`) — 231 instances

#### `column` — 91 occurrences (Quasar shortcut for `flex-direction:column`)

| File:Line | Severity |
|---|---|
| `web/src/components/DateTime.vue:74` | P1 |
| `web/src/plugins/logs/DetailTable.vue:19` | P1 |
| `web/src/plugins/logs/IndexList.vue:19` | P1 |
| `web/src/plugins/logs/SearchResult.vue:21` | P1 |
| `web/src/views/UsageTab.vue:90` | P1 |
| +86 more |

Replace with `tw:flex tw:flex-col`.

#### `col-auto` — 48 occurrences

| File:Line |
|---|
| `web/src/components/reports/CreateReport.vue:264` |
| `web/src/components/reports/CreateReport.vue:284` |
| `web/src/components/reports/CreateReport.vue:361` |
| `web/src/components/reports/CreateReport.vue:379` |
| `web/src/components/reports/CreateReport.vue:397` |
| +43 more (heaviest: `CreateReport.vue`, `PanelEditor.vue`, `PatternDetailsDialog.vue`, `ImportSemanticGroupsDrawer.vue`) |

Replace with `tw:flex-none`.

#### `full-height` — 42 occurrences

| File:Line |
|---|
| `web/src/components/QueryPlanDialog.vue:25` |
| `web/src/components/QueryPlanDialog.vue:26` |
| `web/src/components/QueryPlanDialog.vue:29` |
| `web/src/components/QueryPlanDialog.vue:59` |
| `web/src/components/QueryPlanDialog.vue:89` |
| +37 more |

Replace with `tw:h-full`.

#### `relative-position` — 25 occurrences

| File:Line |
|---|
| `web/src/views/AzureMarketplaceSetup.vue:19` |
| `web/src/views/AwsMarketplaceSetup.vue:19` |
| `web/src/plugins/traces/SpanBlock.vue:31` |
| `web/src/plugins/logs/Index.vue:57` |
| `web/src/plugins/logs/Index.vue:71` |
| +20 more |

Replace with `tw:relative`.

#### `flex-center` — 16 occurrences

| File:Line |
|---|
| `web/src/components/QueryPlanDialog.vue:89` |
| `web/src/plugins/logs/Index.vue:373` |
| `web/src/plugins/logs/SearchJobInspector.vue:270` |
| `web/src/components/settings/RegexPatternList.vue:67` |
| `web/src/components/settings/BuiltInModelPricingTab.vue:141` |
| +11 more |

Replace with `tw:flex tw:items-center tw:justify-center`.

#### `wrap` — 9 occurrences (Quasar `flex-wrap:wrap`)

| File:Line |
|---|
| `web/src/plugins/traces/SpanBlock.vue:19` |
| `web/src/plugins/logs/patterns/PatternCard.vue:20` |
| `web/src/plugins/logs/patterns/PatternCard.vue:45` |
| `web/src/plugins/logs/patterns/PatternCard.vue:104` |
| `web/src/components/TenstackTable.vue:22` |
| +4 more |

Replace with `tw:flex-wrap`.

### 1.3 Typography (`text-weight-*`, `text-grey-*`, `text-red-*`, etc.) — 144 instances

#### Quasar weight tokens — 70 occurrences

| Token | Count | Sample file:line |
|---|---|---|
| `text-weight-bold` | 42 | `web/src/components/actionScripts/ScriptEditor.vue:12` |
| `text-weight-medium` | 28 | `web/src/components/QueryPlanDialog.vue:39` |

Other reps:
- `web/src/plugins/logs/IndexList.vue:156` (`text-weight-bold`)
- `web/src/plugins/logs/SearchBar.vue:187` (`text-weight-bold`)
- `web/src/plugins/logs/SearchBar.vue:1666` (`text-weight-bold`)
- `web/src/plugins/traces/IndexList.vue:157` (`text-weight-bold`)
- `web/src/views/RUM/UploadSourceMaps.vue:37,49,61` (`text-weight-medium`)

Replace with `tw:font-bold` / `tw:font-medium`.

#### Tailwind v3 numeric colors without `tw:` prefix — 74 occurrences

These are Tailwind v3 tokens with the dash-prefix removed; in v4 they need the `tw:` prefix.

| Token | Count | Severity |
|---|---|---|
| `text-blue-500` | 48 | P0 (link color regression) |
| `text-red-8` | 16 | P1 (Quasar palette name; not a real Tailwind token) |
| `text-red-600` | 4 | P1 |
| `text-green-6` | 2 | P1 (Quasar palette) |
| `text-red-6` | 2 | P1 (Quasar palette) |
| `text-blue-8` | 1 | P1 (Quasar palette) |
| `text-orange-800` | 1 | P1 |

Representative locations:

| File:Line | Class |
|---|---|
| `web/src/components/ingestion/servers/IIS.vue:33` | `text-blue-500 hover:text-blue-600` |
| `web/src/components/ingestion/servers/Nginx.vue:33` | `text-blue-500 hover:text-blue-600` |
| `web/src/components/ingestion/servers/Apache.vue:33` | `text-blue-500 hover:text-blue-600` |
| `web/src/components/ingestion/networking/Netflow.vue:33` | `text-blue-500 hover:text-blue-600` |
| `web/src/components/ingestion/ai/AIIntegrationDetail.vue:54` | `text-blue-500` |
| `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:153,160,276,332,387` | `text-red-8` |
| `web/src/components/alerts/steps/AlertSettings.vue` (×5) | `text-red-8` |
| `web/src/plugins/traces/TraceTree.vue:220,281` | `text-red-6` |
| `web/src/components/settings/License.vue:55,201` | `text-green-6` |
| `web/src/components/pipelines/EditBackfillJobDialog.vue:33,46,110` | `text-red-600`, `text-orange-800` |
| `web/src/components/pipelines/CreateBackfillJobDialog.vue:48,62` | `text-red-600` |
| `web/src/components/settings/DomainManagement.vue:244` | `text-blue-8` |

The `*-blue-500` etc. set should become `tw:text-blue-500` (still a valid Tailwind token). The Quasar palette stops (`-5`, `-6`, `-7`, `-8`) have no direct Tailwind equivalent — map manually (e.g. `red-7 → tw:text-red-700`).

#### Semantic Quasar typography — 40 occurrences

| Token | Count | Sample location |
|---|---|---|
| `text-primary` | 27 | `web/src/plugins/logs/SyntaxGuide.vue:104,206` |
| `text-white` | 7 | `web/src/plugins/logs/SearchResult.vue:36` |
| `text-subtitle` | 5 | `web/src/views/UsageTab.vue:482,495,565,578` |
| `text-info` | 1 | `web/src/enterprise/components/billings/plans.vue:57` |

Other representative `text-primary` locations:
- `web/src/components/pipeline/NodeForm/AssociateFunction.vue:93`
- `web/src/plugins/traces/TraceEvaluationsView.vue:202`
- `web/src/plugins/metrics/SyntaxGuideMetrics.vue:113`
- `web/src/plugins/traces/SyntaxGuide.vue:75,131`
- `web/src/components/pipeline/NodeForm/ScheduledPipeline.vue:813`

Replace with `tw:text-[var(--o2-primary)]` / `tw:text-white` / `tw:text-sm` / `tw:text-[var(--o2-info)]` as appropriate.

### 1.4 Backgrounds (`bg-primary`, `bg-white`, `bg-blue-1`) — 11 instances

| File:Line | Class | Suggested |
|---|---|---|
| `web/src/components/rum/ErrorsList.vue:31` | `bg-primary` | `tw:bg-[var(--o2-primary)]` |
| `web/src/components/rum/VideoPlayer.vue:52` | `bg-primary` | same |
| `web/src/components/rum/VideoPlayer.vue:62` | `bg-primary` | same |
| `web/src/plugins/traces/TraceHeader.vue:37` | `bg-primary` | same |
| `web/src/components/iam/users/AddUser.vue:200` | `bg-primary` | same |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:563` | `bg-primary` | same |
| `web/src/components/iam/users/EditUser.vue` (+2 more) | `bg-primary` | same |
| `web/src/components/functions/StreamRouting.vue:2` | `bg-white` | `tw:bg-white` |
| `web/src/components/iam/roles/PermissionsTable.vue:60` | `bg-white` | `tw:bg-white` |
| `web/src/components/settings/DomainManagement.vue:244` | `bg-blue-1` | manual map; `tw:bg-blue-50` |

### 1.5 Quasar Component CSS Selectors (`.q-table__title`, `.q-card`, `.q-btn`, `.q-field`) — 1,162 selector occurrences

These are CSS rules in `<style scoped>` and global SCSS that targeted Quasar's internal class names. Since Quasar is gone the selectors no longer match — they're either dead code or were copied as "defensive" overrides for the new `O*` components and need rewriting against the real new class names.

**Top occurring selectors:**

| Selector | Count |
|---|---|
| `.q-field__control` | 142 |
| `.q-btn` | 85 |
| `.q-field__native` | 73 |
| `.q-table` | 64 |
| `.q-field--dense` | 61 |
| `.q-field` | 53 |
| `.q-icon` | 41 |
| `.q-field__control-container` | 31 |
| `.q-field__marginal` | 27 |
| `.q-btn__content` | 27 |
| `.q-table__top` | 25 |
| `.q-field__append` | 25 |
| `.q-field__input` | 23 |
| `.q-field__label` | 22 |
| `.q-table__control` | 21 |

**Top files (full count per file):**

| File | Count |
|---|---|
| `web/src/styles/app.scss` | 171 |
| `web/src/styles/logs/logs-page.scss` | 92 |
| `web/src/components/alerts/AddAlert.vue` | 38 |
| `web/src/styles/logs/search-result.scss` | 29 |
| `web/src/plugins/traces/TraceDetails.vue` | 26 |
| `web/src/styles/schema.scss` | 20 |
| `web/src/plugins/traces/TraceDetailsSidebar.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` | 19 |
| `web/src/components/CustomDateTimePicker.vue` | 18 |
| `web/src/plugins/metrics/MetricList.vue` | 17 |
| `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue` | 17 |
| `web/src/components/DateTimePicker.vue` | 17 |
| `web/src/components/DateTime.vue` | 17 |
| +N more (147 files in total) |

### 1.6 Other Quasar utility leftovers (`material-icons`, `material-symbols-outlined`)

These are external font-icon classes and may still resolve if `material-icons` font CSS is loaded externally. Track as informational (low priority):

| File:Line | Class |
|---|---|
| `web/src/lib/navigation/Pagination/OPagination.vue:70,86,123,139` | `material-icons` (used with literal characters like `skip_previous`) |
| `web/src/lib/navigation/Tabs/OTabs.vue:163,192` | `material-icons-outlined` |
| `web/src/lib/navigation/Tabs/OTab.vue:113` | `material-icons-outlined` |
| `web/src/lib/data/Timeline/OTimelineItem.vue:42` | `material-icons` |
| `web/src/lib/core/Collapsible/OCollapsible.vue:116` | `material-icons-outlined` |
| `web/src/lib/core/Badge/OBadge.vue:151` | `material-icons-outlined` |
| `web/src/components/rum/performance/WebVitalsDashboard.vue:32` | `material-symbols-outlined` |
| `web/src/components/alerts/AlertList.vue:298` | `material-symbols-outlined` |

These should be migrated to `<OIcon>` registry entries to drop the font dependency.

---

## 2. Tailwind v4 Misuse

### 2.1 Wrong prefix — `tw-` dash instead of `tw:` colon — 158 instances

The `tw-` form was correct for Tailwind v3 dash-prefix; with the v4 colon-prefix it produces no CSS rule (silent no-op).

**Top files:**

| File | Count |
|---|---|
| `web/src/components/pipelines/BackfillJobDetails.vue` | 22 |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue` | 12 |
| `web/src/components/alerts/IncidentDetailDrawer.vue` | 12 |
| `web/src/components/pipelines/EditBackfillJobDialog.vue` | 6 |
| `web/src/components/alerts/IncidentServiceGraph.vue` | 6 |
| `web/src/components/logs/ChunkedContent.vue` | 2 |
| `web/src/views/AzureMarketplaceSetup.vue` | 1 |
| `web/src/views/AwsMarketplaceSetup.vue` | 1 |
| `web/src/components/functions/AddFunction.vue` | 1 |

**Representative locations:**

| File:Line | Class snippet |
|---|---|
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:29` | `tw-mb-[1rem]` |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:86` | `tw-rounded tw-border tw-border-solid tw-border-negative tw-px-3 tw-py-2 tw-flex tw-gap-3 tw-items-start` |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:135` | `tw-px-[0.625rem] tw-py-[0.375rem] ... tw-border-l-[var(--q-primary)] tw-break-all tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-[2px] tw-gap-y-[2px]` |
| `web/src/views/AzureMarketplaceSetup.vue:19` | `tw:flex relative-position tw-px-3 tw-pt-2` |
| `web/src/views/AwsMarketplaceSetup.vue:19` | `tw:flex relative-position tw-px-3 tw-pt-2` |
| `web/src/components/pipelines/EditBackfillJobDialog.vue:106` | `tw-mt-2 tw-p-3 tw-bg-orange-100 tw-rounded tw-border tw-border-orange-300` |
| `web/src/components/pipelines/EditBackfillJobDialog.vue:111-117` | `tw-font-semibold tw-mb-1`, `tw-mb-2`, `tw-font-semibold tw-text-xs tw-mb-1`, `tw-ml-5 tw-space-y-0.5 tw-list-disc tw-text-xs` |
| `web/src/components/pipelines/BackfillJobDetails.vue:48-152` | 22 `tw-*` tokens (`tw-space-y-3`, `tw-font-medium`, `tw-grid tw-grid-cols-2 tw-gap-4`, `tw-font-mono`, `tw-text-red-800`, etc.) |
| `web/src/components/alerts/IncidentDetailDrawer.vue:1005,1032,1053,1055,1057,1081,1098,1100,1101,1111,1113,1137` | `tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden`, `tw-items-center tw-justify-center`, `tw-text-base`, `tw-text-xs tw-text-gray-500`, etc. |
| `web/src/components/alerts/IncidentServiceGraph.vue:53-69` | `tw-flex tw-items-center tw-justify-center tw-h-full`, `tw-bg-gray-900/50`, `tw-text-gray-400`, `tw-text-xs tw-mt-1` |
| `web/src/components/logs/ChunkedContent.vue:47,58` | `tw-mt-2 tw-flex tw-items-center tw-gap-3`, `tw-text-sm tw-font-medium` |
| `web/src/components/functions/AddFunction.vue:60` | `tw-mt-1` |

(+118 more across the same handful of files.)

### 2.2 Wrong variant order — `hover:tw:*`, `md:tw:*`, etc. — 155 instances

In Tailwind v4 with `tw:` prefix the form is `tw:hover:bg-foo`, not `hover:tw:bg-foo`. The latter produces no rule.

**Top files:**

| File | Count |
|---|---|
| `web/src/components/settings/ServiceIdentitySetup.vue` | 11 |
| `web/src/components/alerts/steps/QueryConfig.vue` | 6 |
| `web/src/components/alerts/IncidentTableOfContents.vue` | 6 |
| `web/src/components/alerts/IncidentDetailDrawer.vue` | 5 |
| `web/src/plugins/traces/TraceDetails.vue` | 4 |
| `web/src/components/dashboards/addPanel/PromQLChartConfig.vue` | 4 |
| `web/src/views/UsageTab.vue` | 3 |
| `web/src/components/rum/common/performance/MetricCard.vue` | 3 |
| `web/src/components/rum/VideoPlayer.vue` | 3 |
| `web/src/components/login/GetStarted.vue` | 3 |
| `web/src/components/alerts/OrganizationDeduplicationSettings.vue` | 3 |
| `web/src/views/About.vue` | 2 |

**Representative locations:**

| File:Line | Class snippet |
|---|---|
| `web/src/plugins/logs/TransformSelector.vue:88` | `... tw:cursor-pointer hover:tw:bg-muted/50` |
| `web/src/plugins/logs/patterns/PatternCard.vue:19` | `... tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)]` |
| `web/src/views/About.vue:61` | `tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4` |
| `web/src/views/About.vue:201` | `tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4` |
| `web/src/plugins/metrics/MetricList.vue:46,160` | `... hover:tw:bg-muted/50` |
| `web/src/plugins/metrics/SyntaxGuideMetrics.vue:113` | `hover:tw:underline text-primary` |
| `web/src/plugins/correlation/TelemetryCorrelationDashboard.vue:247,719` | `... hover:tw:bg-muted/50` |
| `web/src/views/UsageTab.vue:507,512,592` | `xl:tw:min-h-[200px] ... md:tw:h-[calc(...)] lg:tw:h-[calc(...)] xl:tw:h-[calc(...)]` |
| `web/src/plugins/traces/TraceEvaluationsView.vue:172,346` | `dark:tw:text-amber-400` |
| `web/src/plugins/traces/SyntaxGuide.vue:75,131` | `hover:tw:underline` |
| `web/src/plugins/logs/SyntaxGuide.vue:104,206` | `hover:tw:underline` |
| `web/src/plugins/logs/SearchJobInspector.vue:235` | `hover:tw:border-primary hover:tw:shadow-lg` |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:528,585` | `... hover:tw:bg-muted/50` |
| `web/src/plugins/logs/TenstackTable.vue:241` | `... hover:tw:bg-[var(--o2-hover-gray)]` |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:275` | `group-hover:tw:opacity-100 ... tw:hover:text-[var(--color-text-primary)]` |
| `web/src/plugins/traces/TraceDetails.vue:76,97,121,131` | `hover:tw:text-[var(--o2-theme-color)]`, `hover:tw:text-[var(--o2-text-primary)]` |
| `web/src/views/Dashboards/addPanel/AddCondition.vue:119` | `... hover:tw:bg-muted/50` |
| `web/src/lib/core/Table/sub-components/OTableHeader.vue:367` | `group-hover:tw:opacity-100 ... tw:hover:text-text-primary` |
| `web/src/components/settings/ServiceIdentitySetup.vue` (×11 occurrences across lines 1170–1980) | mostly `hover:tw:*` and `dark:tw:*` |

(+118 more.)

Note: A few lines like `tw:hover:text-...` (with `tw:` first) ARE correct — those should not be reported. The listed 155 are confirmed wrong-order.

### 2.3 Invalid tokens — `tw:pb-lg`, `tw:mt-md`, `tw:p-md`, `tw:mr-md` — 21 instances

These mix Tailwind's `tw:` prefix with Quasar's `xs/sm/md/lg/xl` spacing tokens. Tailwind has no such scale, so they parse to nothing.

| File:Line | Class |
|---|---|
| `web/src/plugins/logs/SearchHistory.vue:210` | `tw:mr-md` |
| `web/src/plugins/logs/SearchSchedulersList.vue:209` | `tw:mr-md` |
| `web/src/plugins/logs/TenstackTable.vue:318` | `tw:py-none tw:px-2 tw:items-center tw:justify-start ...` |
| `web/src/plugins/logs/Index.vue:210` | `tw:mt-none!` |
| `web/src/views/Dashboards/Dashboards.vue:333` | `tw:mr-md` |
| `web/src/components/pipelines/PipelineHistory.vue:231` | `tw:mr-md` |
| `web/src/components/pipeline/PipelinesList.vue:305` | `tw:mr-md` |
| `web/src/components/logstream/AssociatedRegexPatterns.vue:384` | `tw:py-md tw:h-[24px]` |
| `web/src/components/logstream/AssociatedRegexPatterns.vue:417` | `tw:py-md tw:h-[24px]` |
| `web/src/components/settings/General.vue:186` | `tw:w-[250px] tw:mr-sm` |
| `web/src/components/functions/FunctionList.vue:102` | `tw:mr-md` |
| `web/src/components/actionScripts/ActionScripts.vue:113` | `tw:mr-md` |
| `web/src/components/functions/EnrichmentTableList.vue:217` | `tw:mr-md` |
| `web/src/components/ingestion/recommended/KubernetesConfig.vue:3` | `tw:p-3 ... tw:pb-lg` |
| `web/src/components/settings/DiscoveredServices.vue:316` | `tw:mr-md` |
| `web/src/components/settings/AddRegexPattern.vue:184` | `tw:mt-1 tw:py-md tw:h-[24px]` |
| `web/src/components/settings/AddRegexPattern.vue:218` | `tw:mt-1 tw:py-md tw:h-[24px]` |
| `web/src/components/TenstackTable.vue:687` | `tw:py-none tw:px-2 ...` |
| `web/src/components/alerts/AlertList.vue:449` | `tw:mr-md` |
| `web/src/components/alerts/IncidentList.vue:162` | `tw:mr-md` |
| `web/src/components/iam/roles/RoleTable.vue:105` | `tw:mr-md` |

Plus 2 occurrences of the made-up `tw:full-width`:

| File:Line | Class |
|---|---|
| `web/src/components/actionScripts/ActionScripts.vue:36` | `tw:full-width tw:flex tw:items-center tw:justify-end tw:gap-3` |
| `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue:25` | `tw:flex ... tw:full-width tw:h-[68px] ...` |

Suggested mapping:
- `tw:mr-md → tw:mr-4`
- `tw:py-md → tw:py-4`
- `tw:pb-lg → tw:pb-6`
- `tw:py-none → tw:py-0`
- `tw:mt-none → tw:mt-0`
- `tw:full-width → tw:w-full`

### 2.4 Arbitrary value bugs (spaces in `tw:[...]`) — 8 instances

In Tailwind v4 spaces inside arbitrary values break parsing — the whole utility is dropped. Use underscores or remove the spaces.

| File:Line | Class |
|---|---|
| `web/src/views/UsageTab.vue:23` | `tw:h-[calc(100% - 2.5rem)]` |
| `web/src/plugins/logs/SearchHistory.vue:68` | `tw:h-[calc(100vh - var(--navbar-height) - 95px)] card-container` |
| `web/src/plugins/logs/SearchSchedulersList.vue:42` | `tw:h-[calc(100vh - var(--navbar-height) - 95px)] card-container` |
| `web/src/views/RUM/RealUserMonitoring.vue:74` | `tw:h-[calc(100vh - 3.125rem)]` |
| `web/src/views/Ingestion.vue:210` | `tw:max-h-[calc(100vh - var(--navbar-height) - 100px)]` |
| `web/src/components/common/JsonEditor.vue:53` | `tw:h-[calc(100vh - 65px)]` |
| `web/src/plugins/traces/Index.vue:19` | `tw:min-h-[calc(100vh - var(--navbar-height))]! tw:max-h-[calc(100vh - var(--navbar-height))]!` (2 instances on the same line) |

**Fix** — replace spaces with underscores: `tw:h-[calc(100vh-var(--navbar-height)-95px)]` or wrap in arbitrary value brackets without spaces.

**Also invalid arbitrary value (missing `calc()`)** — 1 instance:

| File:Line | Class |
|---|---|
| `web/src/views/Invitations.vue:18` | `tw:h-[100vh-128px]` — should be `tw:h-[calc(100vh-128px)]` |

### 2.5 Deprecated `tw:bg-opacity-*` — 4 instances

In v4, opacity is encoded into the color token (`bg-blue-500/10`), not as a separate utility.

| File:Line | Class |
|---|---|
| `web/src/views/About.vue:126` | `tw:rounded tw:bg-opacity-10` + `tw:bg-blue-400` / `tw:bg-blue-500` |
| `web/src/views/About.vue:186` | `tw:rounded tw:bg-opacity-10` + `tw:bg-yellow-400` / `tw:bg-yellow-500` |
| `web/src/views/About.vue:194` | `tw:bg-black tw:bg-opacity-10` |
| `web/src/components/alerts/AlertInsights.vue:176` | `tw:bg-primary tw:bg-opacity-10` |

Fix: `tw:bg-blue-500/10`, `tw:bg-yellow-500/10`, `tw:bg-black/10`, `tw:bg-[var(--o2-primary)]/10`.

### 2.6 Quasar palette steps with `tw:` prefix (`tw:bg-red-5`, `tw:bg-indigo-7`) — 61 instances

These mix `tw:` with Quasar's single-digit palette stops. Tailwind only knows `*-50` to `*-950`; single digits do not resolve.

**Top file (concentrated):**

`web/src/components/settings/ServiceIdentitySetup.vue` — 56 of the 61 occurrences:

| File:Line | Class snippet |
|---|---|
| `web/src/components/settings/ServiceIdentitySetup.vue:207` | `tw:border-grey-4` |
| `web/src/components/settings/ServiceIdentitySetup.vue:293` | `tw:border-grey-7 tw:bg-gray-700/40` |
| `web/src/components/settings/ServiceIdentitySetup.vue:294` | `tw:border-grey-4 tw:bg-gray-50` |
| `web/src/components/settings/ServiceIdentitySetup.vue:564` | `tw:text-teal-6` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1176` | `tw:bg-blue-5` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1178` | `tw:bg-teal-5` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1179` | `tw:bg-purple-5` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1203` | `tw:bg-blue-1/40 tw:text-gray-400` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1225` | `tw:border-grey-8` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1226` | `tw:border-grey-3` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1257` | `tw:bg-teal-10/30 tw:border-teal-9/50 tw:text-teal-3` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1259` | `tw:bg-teal-1/50 tw:border-teal-2 tw:text-teal-8` |
| `web/src/components/settings/ServiceIdentitySetup.vue:1261-1267` | matching pill colors for purple/blue (`-10/30`, `-9/50`, `-3`, etc.) |
| `web/src/components/settings/ServiceIdentitySetup.vue:1905-1972` | repeated `iconClass`/`countClass`/`pillDark`/`pillLight` constants embedding the same palette stops |
| +remaining 5 across other files |

These all need to be remapped to Tailwind's 50-950 scale. Approximate mapping: `*-1 → *-50`, `*-2 → *-100`, `*-3 → *-200`, `*-4 → *-300`, `*-5 → *-500`, `*-6 → *-600`, `*-7 → *-700`, `*-8 → *-800`, `*-9 → *-900`, `*-10 → *-950`. P0 due to high concentration in one file affecting visual identity / "service identity" badges.

### 2.7 Contradictory utilities (`tw:flex-col tw:flex-row`) — 2 instances

| File:Line | Class |
|---|---|
| `web/src/views/About.vue:23` | `tw:flex tw:flex-col tw:flex-row tw:items-center tw:justify-between tw:gap-8` |
| `web/src/lib/forms/Radio/ORadioGroup.vue:40` | `orientation === 'horizontal' ? 'tw:flex-row tw:flex-wrap' : 'tw:flex-col'` (intentionally exclusive — false positive, no fix needed) |

Only `About.vue:23` is a real bug.

---

## 3. Quasar CSS Variables (`var(--q-*)`) — 291 instances

These persist because `_quasar-variables.scss` and Quasar runtime CSS used to define them; now they only resolve if a compatibility shim still defines them globally.

**Top variables:**

| Variable | Count |
|---|---|
| `var(--q-primary)` | 163 |
| `var(--q-primary-rgb)` | 28 |
| `var(--q-text-secondary)` | 10 |
| `var(--q-secondary)` | 10 |
| `var(--q-negative)` | 10 |
| `var(--q-background)` | 10 |
| `var(--q-warning)` | 7 |
| `var(--q-dark)` | 5 |
| `var(--q-border-color)` | 5 |
| `var(--q-positive)` | 4 |
| `var(--q-dark-page)` | 4 |
| `var(--q-text)` | 3 |
| `var(--q-primary-text)` | 3 |
| `var(--q-page-background)` | 3 |
| `var(--q-color-text)` | 3 |
| `var(--q-text-primary)` | 2 |
| `var(--q-text-color)` | 2 |
| `var(--q-positive-rgb)` | 2 |
| `var(--q-color-separator)` | 2 |
| `var(--q-primary-dark)`, `var(--q-negative-rgb)`, `var(--q-light)`, `var(--q-item-hover-bg)`, `var(--q-item-bg)`, `var(--q-hover-color)`, `var(--q-header-bg)`, `var(--q-field-bg)`, `var(--q-color-text-secondary)`, `var(--q-color-text-primary)`, `var(--q-color-text-hint)` | 1 each |

**Top files by count:**

| File | Count |
|---|---|
| `web/src/components/alerts/AlertSummary.vue` | 21 |
| `web/src/components/O2AIChat.vue` | 21 |
| `web/src/components/EnterpriseUpgradeDialog.vue` | 20 |
| `web/src/components/alerts/DestinationTestResult.vue` | 19 |
| `web/src/components/alerts/steps/QueryConfig.vue` | 12 |
| `web/src/views/RUM/UploadSourceMaps.vue` | 11 |
| `web/src/components/anomaly_detection/AnomalySummary.vue` | 11 |
| `web/src/components/TelemetryCorrelationPanel.vue` | 11 |
| `web/src/components/query-plan/MetricsSummaryCard.vue` | 9 |
| `web/src/components/O2AIConfirmDialog.vue` | 8 |
| `web/src/styles/app.scss` | 7 |
| `web/src/components/alerts/QueryEditorDialog.vue` | 7 |
| `web/src/components/alerts/PrebuiltDestinationSelector.vue` | 6 |
| `web/src/components/alerts/ImportSemanticGroups.vue` | 6 |
| `web/src/components/WebinarBanner.vue` | 6 |
| +40 more files |

**Suggested replacement table:**

| Quasar variable | New token |
|---|---|
| `var(--q-primary)` | `var(--o2-primary)` |
| `var(--q-primary-rgb)` | (define `--o2-primary-rgb` if needed for `rgba()`) |
| `var(--q-secondary)` | `var(--o2-secondary)` or theme accent |
| `var(--q-negative)` | `var(--o2-danger)` / `var(--o2-error)` |
| `var(--q-positive)` | `var(--o2-success)` |
| `var(--q-warning)` | `var(--o2-warning)` |
| `var(--q-info)` | `var(--o2-info)` |
| `var(--q-dark)` / `var(--q-dark-page)` | `var(--o2-bg-dark)` |
| `var(--q-text-secondary)` | `var(--o2-text-muted)` / `var(--o2-text-secondary)` |
| `var(--q-text-primary)` / `var(--q-color-text-primary)` | `var(--o2-text-primary)` |
| `var(--q-text-color)` | `var(--o2-text-primary)` |
| `var(--q-background)` / `var(--q-page-background)` | `var(--o2-bg)` / `var(--o2-page-bg)` |
| `var(--q-border-color)` / `var(--q-color-separator)` | `var(--o2-border-color)` |
| `var(--q-card-background)` | `var(--o2-card-bg)` |
| `var(--q-item-hover-bg)` | `var(--o2-hover-gray)` |
| `var(--q-color-text-hint)` | `var(--o2-text-muted)` |
| `var(--q-field-bg)` / `var(--q-header-bg)` | map to corresponding O2 theme tokens |

Representative locations (5 per top variable):

`var(--q-primary)`:
- `web/src/plugins/logs/SearchJobInspector.vue:759`
- `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:116,135`
- `web/src/views/About.vue:599,617,630,637`
- `web/src/components/QueryEditor.vue:657`
- `web/src/components/settings/General.vue:1108`
- `web/src/views/CorrelationDemo.vue:213`
- `web/src/plugins/traces/LLMTrendPanel.vue:185` (`tw:text-[var(--q-primary)]`)
- +153 more

`var(--q-background)`:
- `web/src/views/RUM/UploadSourceMaps.vue:306,336`
- `web/src/views/AzureMarketplaceSetup.vue:349`
- `web/src/plugins/logs/SearchJobInspector.vue:739`
- `web/src/views/RUM/SourceMaps.vue:524,548`
- +4 more

`var(--q-negative)`:
- `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:289,437,2818`
- `web/src/styles/logs/tenstack-table.scss:109` (commented)
- `web/src/components/O2AIChat.vue:6523`
- `web/src/components/TelemetryCorrelationPanel.vue:355`
- +5 more

`var(--q-dark)`:
- `web/src/components/alerts/ImportSemanticGroups.vue:656`
- `web/src/components/O2AIChat.vue:6426`
- `web/src/components/alerts/ImportSemanticGroupsDrawer.vue:587`
- `web/src/components/NLModeQueryBar.vue:517,521`

---

## 4. Dead `:deep()` and `.q-*` SCSS Selectors

### 4.1 `:deep(.q-*)` in scoped styles — 164 instances

These target removed Quasar internal class names. Each one needs to be either deleted or rewritten to target the new `O*` component's real classes.

**Top files:**

| File | Count |
|---|---|
| `web/src/components/alerts/AddAlert.vue` | 12 |
| `web/src/components/dashboards/addPanel/dynamicFunction/SelectFunction.vue` | 9 |
| `web/src/components/dashboards/addPanel/TablePaginationControls.vue` | 7 |
| `web/src/components/QueryEditor.vue` | 7 |
| `web/src/styles/logs/search-result.scss` | 6 |
| `web/src/components/alerts/steps/AlertSettings.vue` | 6 |
| `web/src/components/dashboards/panels/PromQLTableChart.vue` | 5 |
| `web/src/components/common/FieldValuesPanel.vue` | 5 |
| `web/src/components/anomaly_detection/steps/AnomalyAlerting.vue` | 5 |
| `web/src/components/alerts/AlertList.vue` | 5 |
| `web/src/components/NLModeQueryBar.vue` | 5 |
| `web/src/enterprise/components/EvalTemplateEditor.vue` | 4 |
| `web/src/components/settings/ModelPricingEditor.vue` | 4 |
| `web/src/plugins/logs/SearchBar.vue` | 3 |
| `web/src/plugins/correlation/TelemetryCorrelationDashboard.vue` | 3 |
| `web/src/plugins/correlation/DimensionFiltersBar.vue` | 3 |
| `web/src/plugins/correlation/CorrelatedLogsTable.vue` | 3 |
| `web/src/components/pipeline/NodeForm/Condition.vue` | 3 |
| `web/src/components/functions/FunctionsToolbar.vue` | 3 |
| `web/src/components/functions/AddFunction.vue` | 3 |
| +120 more files |

**Representative selectors found (5 lines each):**

| File:Line | Selector |
|---|---|
| `web/src/plugins/metrics/MetricList.vue:634` | `:deep(.q-table__control)` |
| `web/src/plugins/logs/SearchBar.vue:5445,5460` | `:deep(.q-btn)` |
| `web/src/plugins/logs/SearchBar.vue:5572` | `:deep(.q-splitter__separator)` |
| `web/src/plugins/correlation/DimensionFiltersBar.vue:135,140,145` | `:deep(.q-field__control)`, `:deep(.q-field__native)`, `:deep(.q-field__append)` |
| `web/src/plugins/logs/SyntaxGuide.vue:266` | `:deep(.q-btn__content)` |
| `web/src/plugins/correlation/TimeRangeEditor.vue:477` | `:deep(.q-dark)` |
| `web/src/plugins/correlation/DimensionFilterEditor.vue:258` | `:deep(.q-dark)` |
| `web/src/views/IdentityAccessManagement.vue:280` | `:deep(.q-splitter__before)` |
| `web/src/views/RUM/UploadSourceMaps.vue:371` | `:deep(.q-dark)` |
| `web/src/components/queries/RunningQueries.vue:857,858` | `:deep(.q-table th)`, `:deep(.q-table td)` |
| `web/src/enterprise/components/EvalTemplateEditor.vue:414,434,441,448` | `:deep(.q-field__*)` variants |
| (+154 more) |

### 4.2 Bare `.q-*` selectors (global / scoped SCSS) — 1,162 occurrences

These are the dominant share of dead CSS. They're concentrated in legacy global stylesheets plus per-component scoped styles:

| File | Count |
|---|---|
| `web/src/styles/app.scss` | 171 |
| `web/src/styles/logs/logs-page.scss` | 92 |
| `web/src/components/alerts/AddAlert.vue` | 38 |
| `web/src/styles/logs/search-result.scss` | 29 |
| `web/src/plugins/traces/TraceDetails.vue` | 26 |
| `web/src/styles/schema.scss` | 20 |
| `web/src/plugins/traces/TraceDetailsSidebar.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` | 19 |
| `web/src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` | 19 |
| `web/src/components/CustomDateTimePicker.vue` | 18 |
| `web/src/plugins/metrics/MetricList.vue` | 17 |
| `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue` | 17 |
| `web/src/components/DateTimePicker.vue` | 17 |
| `web/src/components/DateTime.vue` | 17 |
| `web/src/components/iam/quota/Quota.vue` | 16 |
| `web/src/components/logstream/explore/SearchBar.vue` | 14 |
| `web/src/enterprise/components/EvalTemplateEditor.vue` | 13 |
| `web/src/components/logstream/schema.vue` | 13 |
| `web/src/plugins/traces/IndexList.vue` | 12 |
| `web/src/plugins/logs/SearchBar.vue` | 12 |
| `web/src/components/functions/AddFunction.vue` | 10 |
| (+125 more) |

### 4.3 `.body--dark` selectors — 148 instances

Quasar applied this class to `<body>` on dark mode. The current app uses `.dark-theme`/`.light-theme` (or per-component `:class`) — `.body--dark` is never set, so any rule under it is dead.

**Top files:**

| File | Count |
|---|---|
| `web/src/components/settings/TestModelMatchDialog.vue` | 17 |
| `web/src/components/pipeline/NodeForm/AssociateFunction.vue` | 11 |
| `web/src/components/settings/ModelPricingList.vue` | 8 |
| `web/src/components/settings/ModelPricingEditor.vue` | 7 |
| `web/src/components/alerts/IncidentDetailDrawer.vue` | 6 |
| `web/src/components/alerts/AddAlert.vue` | 6 |
| `web/src/components/settings/General.vue` | 5 |
| `web/src/plugins/traces/TraceEvaluationsView.vue` | 4 |
| `web/src/plugins/traces/ServiceGraph.vue` | 4 |
| `web/src/plugins/pipelines/CustomNode.vue` | 4 |
| `web/src/plugins/traces/TraceDetailsSidebar.vue` | 3 |
| `web/src/plugins/traces/TraceDetails.vue` | 3 |
| `web/src/plugins/logs/SearchBar.vue` | 3 |
| `web/src/components/alerts/IncidentList.vue` | 3 |
| `web/src/components/Header.vue` | 3 |
| `web/src/views/OverviewTab.vue` | 2 |
| `web/src/styles/logs/search-result.scss` | 2 |
| `web/src/styles/app.scss` | 2 |
| `web/src/styles/_variables.scss` | 2 |
| `web/src/plugins/correlation/TelemetryCorrelationDashboard.vue` | 2 |
| +30 more files |

Sample lines:
- `web/src/plugins/correlation/TelemetryCorrelationDashboard.vue:2968,3105`
- `web/src/plugins/pipelines/PipelineFlow.vue:299`
- `web/src/plugins/pipelines/CustomNode.vue:1180,1354,1476,1600`
- `web/src/enterprise/components/billings/LicensePeriod.vue:91`
- `web/src/enterprise/components/billings/TrialPeriod.vue:156`
- `web/src/plugins/logs/SearchBar.vue:5330,5355,5380`
- `web/src/plugins/traces/TraceEvaluationsView.vue:1098,1109,1122,1232`
- `web/src/plugins/traces/IndexList.vue:734`
- `web/src/views/OverviewTab.vue:871`

Replace with `.dark-theme &` (or `:where(.dark-theme) &`) where the rule still has visual intent — many can simply be deleted.

### 4.4 `::v-deep` combinator usage — 5 instances

Deprecated since Vue 3; `:deep()` should be used.

| File:Line | Selector |
|---|---|
| `web/src/enterprise/components/billings/Billing.vue:305` | `::v-deep(.q-field--auto-height.q-field--dense .q-field__control)` |
| `web/src/enterprise/components/billings/Billing.vue:313` | `::v-deep(.q-field--auto-height.q-field--dense .q-field__native)` |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2637` | `::v-deep { ... }` (block form) |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2704` | `::v-deep { ... }` |
| `web/src/components/alerts/AlertList.vue:2776` | `::v-deep .app-tabs` |

---

## 5. Quasar SCSS Variables (`$primary`, `$dark-page`, etc.) — 94 instances

The compat shim `web/src/styles/_quasar-variables.scss` still defines them, but each consumer is debt that should switch to O2 design tokens.

**Top tokens:**

| SCSS var | Count |
|---|---|
| `$dark` | 43 |
| `$primary` | 15 |
| `$secondary` | 9 |
| `$grey-4` | 8 |
| `$info` | 3 |
| `$negative` | 2 |
| `$grey-3` | 2 |
| `$grey-2` | 2 |
| `$warning`, `$positive`, `$grey-9`, `$grey-8`, `$grey-7`, `$grey-6`, `$grey-5`, `$grey-10`, `$grey-1`, `$grey` | 1 each |

**Top files (excluding the shim itself):**

| File | Count |
|---|---|
| `web/src/styles/_quasar-variables.scss` | 19 (definitions, expected) |
| `web/src/styles/_variables.scss` | 9 |
| `web/src/components/dashboards/settings/VariableAdHocValueSelector.vue` | 8 |
| `web/src/components/DateTimePicker.vue` | 5 |
| `web/src/components/DateTime.vue` | 4 |
| `web/src/components/CustomDateTimePicker.vue` | 4 |
| `web/src/plugins/traces/SearchBar.vue` | 3 |
| `web/src/components/rum/SearchBar.vue` | 3 |
| `web/src/components/pipeline/NodeForm/ScheduledPipeline.vue` | 3 |
| `web/src/views/Dashboards/DashboardSettings.vue` | 2 |
| `web/src/styles/logs/logs-page.scss` | 2 |
| `web/src/styles/app.scss` | 2 |
| `web/src/components/logstream/explore/SearchBar.vue` | 2 |
| `web/src/components/dashboards/panels/PromQLTableChart.vue` | 2 |
| +25 more files with 1 each |

Priority: P2 (compat shim works, but each consumer ties the component to legacy Quasar palette).

---

## 6. Quasar Directives — 12 instances

### 6.1 `v-close-popup` (Quasar dialog close directive — no longer registered, inert)

| File:Line | Usage |
|---|---|
| `web/src/plugins/logs/SearchBar.vue:216` | `v-close-popup` |
| `web/src/plugins/logs/SearchBar.vue:333` | `v-close-popup` |
| `web/src/views/DetailTable.vue:27` | `<OButton variant="ghost" size="icon" v-close-popup icon-left="cancel" />` |
| `web/src/components/common/BaseImport.vue:41` | `v-close-popup` |
| `web/src/views/Dashboards/ImportDashboard.vue:40` | `v-close-popup` |
| `web/src/components/functions/FunctionsToolbar.vue:99` | `v-close-popup="true"` |
| `web/src/components/logstream/schema.vue:925` | `v-close-popup="true"` |
| `web/src/components/pipeline/NodeForm/ExternalDestination.vue:36` | `<OButton variant="ghost" size="icon" v-close-popup>` |
| `web/src/components/actionScripts/ScriptToolbar.vue:56` | `v-close-popup="true"` |
| `web/src/components/pipeline/StreamSelection.vue:32` | `v-close-popup="true"` |
| `web/src/components/alerts/AddTemplate.vue:121` | `v-close-popup` |
| `web/src/components/alerts/AddDestination.vue:484` | `v-close-popup="true"` |

Each must be replaced by an explicit `@click="dialog = false"` (or similar `emit('close')` / `$emit('update:modelValue', false)`).

### 6.2 Other Quasar directives (`v-ripple`, `v-touch-*`, `v-intersection`, `v-mutation`, `v-morph`, `v-scroll`, `v-scroll-fire`)

Search returned 0 instances in `web/src/`. All previously cleaned up.

---

## 7. Icon Migration Issues

### 7.1 Invalid icon names (underscore separator vs registry hyphen) — 20 instances

The icon registry at `web/src/lib/core/Icon/OIcon.icons.ts` only accepts hyphenated keys (`check-circle`, `content-copy`, `arrow-back`, `expand-more`, …). Underscore versions hit the registry's fallback path and render nothing.

| File:Line | Expression |
|---|---|
| `web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue:103` | `OIcon :name="p50DeltaPct > 2 ? 'arrow_upward' : p50DeltaPct < -2 ? 'arrow_downward' : 'remove'"` |
| `web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue:123` | same with `p95DeltaPct` |
| `web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue:143` | same with `p99DeltaPct` |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:279` | `<OIcon :name="copied ? 'check' : 'content_copy'" size="xs" />` |

(Note: the `:name` cases on `ServiceGraphEdgeSidePanel.vue` reference `arrow_upward` / `arrow_downward` — these need to be `arrow-upward` / `arrow-downward`.)

**Icons used elsewhere via the static `icon=` prop on other components — also invalid registry keys** (these are NOT `OIcon` but they are user-facing icon strings that pass through the same registry on some host components like buttons/cards):

| File:Line | Icon string |
|---|---|
| `web/src/enterprise/components/billings/proPlan.vue:94,109` | `icon="check_circle"` |
| `web/src/plugins/traces/TraceEvaluationsView.vue:656` | `accuracy: "check_circle"` (computed source) |
| `web/src/components/pipelines/BackfillJobDetails.vue:183` | `icon="check_circle"` |
| `web/src/components/rum/ResourceDetailDrawer.vue:250` | `return "check_circle";` |
| `web/src/components/rum/common/performance/MetricCard.vue:146` | `good: "check_circle"` |
| `web/src/components/rum/common/performance/ViewPerformanceMetrics.vue:110` | `icon="check_circle"` |
| `web/src/components/alerts/AlertHistorySummary.vue:154` | `return "check_circle";` |
| `web/src/components/settings/License.vue:293` | `name="check_circle"` |
| `web/src/components/alerts/ImportSemanticGroups.vue:212` | `icon="check_circle"` |
| `web/src/components/alerts/ImportSemanticGroupsDrawer.vue:193` | `icon="check_circle"` |
| `web/src/components/alerts/AlertHistoryDrawer.vue:717` | `return "check_circle_outline";` |
| `web/src/views/Dashboards/RenderDashboardCharts.vue` | `name="before_panels"` (likely custom — verify registry) |
| `web/src/enterprise/components/billings/Billing.vue` | `name="invoice_history"` (verify registry) |
| `web/src/components/settings/index.vue` | `name="regex_patterns"`, `name="pipeline_destinations"`, `name="organization_management"`, `name="model_pricing"`, `name="domain_management"`, `name="correlation_settings"`, `name="alert_destinations"`, `name="ai_toolsets"` |
| `web/src/components/pipeline/NodeForm/CreateDestinationForm.vue` | `name="url_endpoint"`, `name="output_format"`, `name="esbulk_index"` |

Some of those are route names / tab keys (not icon names) — manual triage required, but each underscore-named "icon" should be checked against the registry.

### 7.2 Dead `:color` props on `OIcon` — 37 instances

`OIcon`'s typed props are `{ name, size, label }` (see `web/src/lib/core/Icon/OIcon.types.ts`). `color` and `:color` are silently dropped — every binding below is dead.

**Top files:**

| File | Count |
|---|---|
| `web/src/components/O2AIChat.vue` | 4 |
| `web/src/components/pipelines/PipelineHistory.vue` | 4 |
| `web/src/components/alerts/IncidentDetailDrawer.vue` | 3 |
| `web/src/plugins/traces/TraceDetailsSidebar.vue` | 2 |
| `web/src/plugins/logs/SearchBar.vue` | 2 |
| `web/src/components/ingestion/recommended/AWSQuickSetup.vue` | 2 |
| `web/src/components/rum/EventDetailDrawerContent.vue` | 2 |
| `web/src/components/rum/common/performance/MetricCard.vue` | 2 |
| `web/src/components/alerts/AlertHistory.vue` | 2 |
| `web/src/enterprise/components/billings/enterprisePlan.vue` | 1 |
| `web/src/enterprise/components/billings/proPlan.vue` | 1 |
| `web/src/plugins/traces/SearchBar.vue` | 1 |
| `web/src/plugins/traces/TraceEvaluationsView.vue` | 1 |
| `web/src/components/settings/ServiceIdentitySetup.vue` | 1 |
| `web/src/components/settings/AddRegexPattern.vue` | 1 |
| `web/src/components/ingestion/recommended/AzureQuickSetup.vue` | 1 |
| `web/src/components/rum/ResourceDetailDrawer.vue` | 1 |
| `web/src/components/pipelines/CreateBackfillJobDialog.vue` | 1 |
| `web/src/components/alerts/AlertHistoryDrawer.vue` | 1 |
| `web/src/components/alerts/AddAlert.vue` | 1 |
| `web/src/components/alerts/AlertHistorySummary.vue` | 1 |
| `web/src/components/dashboards/addPanel/PanelFieldList.vue` | 1 |
| `web/src/components/functions/AddEnrichmentTable.vue` | 1 |

**Representative lines:**

| File:Line | Snippet |
|---|---|
| `web/src/enterprise/components/billings/enterprisePlan.vue:66` | `<OIcon v-else name="" color="green" size="sm" class="tw:mr-2" />` |
| `web/src/enterprise/components/billings/proPlan.vue:65` | `<OIcon v-else name="" color="green" size="sm" class="tw:mr-2" />` |
| `web/src/plugins/traces/TraceEvaluationsView.vue:361` | `<OIcon :name="getDimIcon(dim.dimension)" :color="getDimColor(dim.dimension)" size="sm" />` |
| `web/src/components/pipelines/CreateBackfillJobDialog.vue:163` | `<OIcon name="warning" :color="store.state.theme === 'dark' ? 'orange-4' : 'orange'" size="md" class="...">` |
| `web/src/components/O2AIChat.vue:345,397,1317,1335` | several `<OIcon ... :color="...">` lines |
| `web/src/components/pipelines/PipelineHistory.vue:155,165,178,377` | multiple `<OIcon ... :color="...">` |

To restore color, wrap `OIcon` in a span with the desired `tw:text-[color]` class, since OIcon inherits `currentColor`.

---

## Top Offender Files

Combined across all categories (most issues to least):

| Count | File |
|---|---|
| 200 | `web/src/styles/app.scss` |
| 110 | `web/src/styles/logs/logs-page.scss` |
| 63 | `web/src/components/alerts/AddAlert.vue` |
| 58 | `web/src/components/alerts/IncidentDetailDrawer.vue` |
| 41 | `web/src/styles/logs/search-result.scss` |
| 40 | `web/src/plugins/traces/TraceDetails.vue` |
| 36 | `web/src/plugins/logs/patterns/PatternDetailsDialog.vue` |
| 35 | `web/src/styles/schema.scss` |
| 31 | `web/src/components/pipelines/BackfillJobDetails.vue` |
| 30 | `web/src/plugins/metrics/MetricList.vue` |
| 29 | `web/src/plugins/traces/TraceDetailsSidebar.vue` |
| 25 | `web/src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` |
| 25 | `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue` |
| 25 | `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` |
| 25 | `web/src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` |
| 25 | `web/src/components/O2AIChat.vue` |
| 24 | `web/src/components/alerts/IncidentServiceGraph.vue` |
| 23 | `web/src/components/alerts/AlertSummary.vue` |
| 22 | `web/src/plugins/logs/SearchBar.vue` |
| 22 | `web/src/components/DateTimePicker.vue` |
| 22 | `web/src/components/CustomDateTimePicker.vue` |
| 21 | `web/src/components/EnterpriseUpgradeDialog.vue` |
| 21 | `web/src/components/DateTime.vue` |
| 20 | `web/src/enterprise/components/EvalTemplateEditor.vue` |
| 20 | `web/src/components/alerts/steps/QueryConfig.vue` |
| 19 | `web/src/components/alerts/DestinationTestResult.vue` |
| 18 | `web/src/views/Dashboards/addPanel/Group.vue` |
| 18 | `web/src/views/About.vue` |
| 17 | `web/src/components/settings/TestModelMatchDialog.vue` |

---

## Migration Cheatsheet

| Quasar / wrong form | Tailwind v4 (with `tw:` prefix) |
|---|---|
| `q-pa-xs` / `tw:p-xs` | `tw:p-1` |
| `q-pa-sm` / `tw:p-sm` | `tw:p-2` |
| `q-pa-md` / `tw:p-md` | `tw:p-4` |
| `q-pa-lg` / `tw:p-lg` | `tw:p-6` |
| `q-pa-xl` / `tw:p-xl` | `tw:p-8` |
| `q-mt-md` / `tw:mt-md` | `tw:mt-4` |
| `q-mr-md` / `tw:mr-md` | `tw:mr-4` |
| `q-gutter-x-xs` | `tw:gap-x-1` |
| `row` | `tw:flex` |
| `column` | `tw:flex tw:flex-col` |
| `col` / `col-auto` | `tw:flex-1` / `tw:flex-none` |
| `flex-center` | `tw:flex tw:items-center tw:justify-center` |
| `items-center` | `tw:items-center` |
| `justify-between` | `tw:justify-between` |
| `no-wrap` | `tw:flex-nowrap` |
| `wrap` | `tw:flex-wrap` |
| `text-bold` | `tw:font-bold` |
| `text-weight-medium` | `tw:font-medium` |
| `text-weight-bold` | `tw:font-bold` |
| `text-grey-7` (Quasar) | `tw:text-gray-600` |
| `text-red-7` / `text-red-8` (Quasar) | `tw:text-red-700` / `tw:text-red-800` |
| `text-red-600` (raw v3) | `tw:text-red-600` |
| `text-blue-500` (raw v3) | `tw:text-blue-500` |
| `text-primary` | `tw:text-[var(--o2-primary)]` |
| `text-positive` / `text-negative` / `text-warning` | `tw:text-[var(--o2-success)]` etc. |
| `text-subtitle` | `tw:text-sm` (verify intent) |
| `bg-primary` | `tw:bg-[var(--o2-primary)]` |
| `bg-white` | `tw:bg-white` |
| `bg-blue-1` (Quasar) | `tw:bg-blue-50` |
| `full-width` / `tw:full-width` | `tw:w-full` |
| `full-height` | `tw:h-full` |
| `relative-position` | `tw:relative` |
| `cursor-pointer` (bare) | `tw:cursor-pointer` |
| `tw:bg-opacity-10` + `tw:bg-blue-500` | `tw:bg-blue-500/10` |
| `tw:h-[calc(100vh - 50px)]` | `tw:h-[calc(100vh-50px)]` (no spaces) |
| `tw:h-[100vh-128px]` | `tw:h-[calc(100vh-128px)]` |
| `tw:flex-col tw:flex-row` | choose one |
| `hover:tw:bg-foo` | `tw:hover:bg-foo` |
| `md:tw:grid-cols-2` | `tw:md:grid-cols-2` |
| `dark:tw:text-amber-400` | `tw:dark:text-amber-400` |
| `var(--q-primary)` | `var(--o2-primary)` |
| `var(--q-text-secondary)` | `var(--o2-text-muted)` |
| `var(--q-negative)` | `var(--o2-danger)` |
| `var(--q-background)` | `var(--o2-bg)` |
| `:deep(.q-field__control)` | `:deep(.o-input__control)` (or whatever real class) |
| `.body--dark` | `.dark-theme` (or delete) |
| `::v-deep(.foo)` | `:deep(.foo)` |
| `$primary` (SCSS) | `var(--o2-primary)` |
| `$dark` (SCSS) | `var(--o2-bg-dark)` |
| `v-close-popup` | explicit `@click="close()"` / `emit('update:modelValue', false)` |
| `<OIcon name="check_circle">` | `<OIcon name="check-circle">` |
| `<OIcon :color="...">` | `<span class="tw:text-[color]"><OIcon ... /></span>` |

---

## Recommendations

### P0 — Critical visual regressions to fix first

1. **`text-blue-500` link colors in ingestion docs** — 48 links across `web/src/components/ingestion/**` render with default text color. Sweep replacement: prepend `tw:` to `text-blue-500` and `hover:text-blue-600` (also fix `hover:text-blue-600 → tw:hover:text-blue-600`).
2. **`ServiceIdentitySetup.vue` palette colors** — 56 invalid `tw:bg-*-N` / `tw:text-*-N` tokens drive the entire service identity card visuals. Map Quasar stops (`-1..-10`) to Tailwind scale (`-50..-950`) in a single PR.
3. **`PatternDetailsDialog.vue`, `BackfillJobDetails.vue`, `IncidentDetailDrawer.vue`, `IncidentServiceGraph.vue`, `EditBackfillJobDialog.vue`, `ChunkedContent.vue`** — 78 `tw-*` dashed tokens producing no CSS in critical alert/pipeline UIs.
4. **`q-pa-md`, `q-mt-md`, `q-gutter-x-xs`** — 6 instances in `BackfillJobDetails.vue`, `AddCipherKey.vue`, `AddEnrichmentTable.vue`, `PanelSchemaRenderer.vue`.
5. **`column` (91) / `full-height` (42) / `relative-position` (25) / `flex-center` (16)** — visible layout breakage across logs, traces, dashboards.
6. **OIcon underscore names** — 4 in `ServiceGraphEdgeSidePanel.vue` and `OTableBodyCell.vue` cause missing icons. Plus the `icon=` / `name=` underscore usages elsewhere.
7. **Wrong-order variants on dashboards & traces** — `hover:tw:bg-muted/50`, `md:tw:grid-cols-2`, `dark:tw:text-*` (155 total). Sweep regex: `s/(hover|focus|active|md|lg|sm|xl|dark|disabled):tw:/tw:$1:/g`.

### P1 — Broad sweeps to clean up

1. **`var(--q-primary)`** — 163 references. Define `--o2-primary` already exists; introduce a SCSS shim `--q-primary: var(--o2-primary)` to bridge while replacements roll out, then sweep file-by-file.
2. **`text-weight-bold` / `text-weight-medium`** (70 instances) — global find/replace to `tw:font-bold` / `tw:font-medium`.
3. **`col-auto` (48)** — global replacement to `tw:flex-none` is safe.
4. **`text-red-8 / text-red-7 / text-red-6`** etc. — manual map to Tailwind 700/600/500.
5. **`text-primary` (27)** — replace with `tw:text-[var(--o2-primary)]`.
6. **`bg-primary` (8)** — replace with `tw:bg-[var(--o2-primary)]`.
7. **OIcon `:color` props (37)** — wrap or extend the OIcon component to accept a `color` prop again, OR refactor each call site.
8. **Spaces in arbitrary values (8)** — quick sweep.
9. **`tw:bg-opacity-X` (4)** — quick sweep.
10. **`tw:full-width`, `tw:mr-md`, `tw:pb-lg`, `tw:py-none`, `tw:mt-none`** (21+2) — straightforward token substitution.

### P2 — Deferred cleanup

1. **`:deep(.q-*)` selectors (164)** — most no longer match; audit per file. Some may need to be rewritten to target O* component internals.
2. **Bare `.q-*` SCSS selectors (1,162)** — most are dead. Best handled by moving global Quasar overrides out of `styles/app.scss`, `styles/logs/*.scss`, `styles/schema.scss`, then deleting per-component dead rules.
3. **`.body--dark` (148)** — sweep to `.dark-theme` or delete entirely.
4. **`var(--q-*)` smaller variables** (e.g. `--q-text-color`, `--q-color-text-hint`) — replace with O2 equivalents.
5. **Quasar SCSS variables (`$primary`, `$dark`, `$grey-*`)** — eventually remove `_quasar-variables.scss` and migrate each consumer.
6. **`::v-deep` (5)** — convert to `:deep()`.
7. **`v-close-popup` (12)** — replace with explicit event handlers.
8. **`material-icons` / `material-symbols-outlined` in lib components** — migrate Pagination/Tabs/Badge/Collapsible/Timeline to `OIcon`.

---

## Notes on Method

- All bare-Quasar class detection was done on **static `class="..."` attributes only**. Dynamic `:class` bindings using literal strings (e.g. `:class="'row'"`) are not in the static catalog — there are 0 of those in this codebase.
- The `q-*` and `.body--dark` selector counts include both inert selectors in scoped styles and live selectors in global stylesheets. Either way they're dead today (Quasar no longer toggles `.body--dark` and no element gets the `.q-*` class).
- `var(--q-*)` resolves at runtime ONLY if the variable is defined by a global stylesheet/shim. If/when the shim is removed, all 291 usages will silently fall back to inherited or initial values.
- OIcon name validation was done by intersecting the template `name="..."` strings against `OIcon.icons.ts` registry keys (270 valid entries, all hyphenated).
