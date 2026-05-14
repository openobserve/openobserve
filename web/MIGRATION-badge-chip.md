# OBadge Migration Audit

Tracks replacement of `<q-badge>` and `<q-chip>` (display-only) with `<OBadge>`.

**Component:** `@/lib/core/Badge/OBadge.vue`  
**Replaces:** `q-badge` (62 usages), `q-chip` display-only (63 usages)  
**Excludes:** `TagInput.vue` — needs `OTag` (separate component, not OBadge)

---

## Variant mapping guide

| Quasar prop | OBadge prop |
|-------------|-------------|
| `color="positive"` / `color="green"` | `variant="success"` |
| `color="negative"` / `color="red"` | `variant="error"` |
| `color="warning"` | `variant="warning"` |
| `color="primary"` / `color="blue"` / `color="teal"` | `variant="primary"` |
| `color="grey"` / `color="grey-6"` / `color="grey-4"` | `variant="default"` |
| `color="blue-2"` (light tint) | `variant="primary"` |
| `outline` boolean flag | append `-outline` → e.g. `variant="primary-outline"` |
| `label="text"` prop | move to default slot: `>text</OBadge>` |
| `text-color` | dropped — baked into variant token |
| `dense` | dropped — baked into default sizing |
| `size="sm"` / `size="xs"` | `size="sm"` |
| default (no size) | `size="md"` |
| `clickable` + `@click` | `clickable` + `@click` (same API) |
| `removable` + `@remove` | ⛔ Not OBadge — needs `OTag` |
| `square` | ⛔ Forbidden shape prop — see special cases below |

### Content migration
```html
<!-- Before -->
<q-badge color="positive" label="Active" />

<!-- After -->
<OBadge variant="success">Active</OBadge>
```
```html
<!-- Before — slot content (tooltip, icon+text) -->
<q-badge :color="statusColor(row)">
  <q-tooltip>{{ row.status }}</q-tooltip>
</q-badge>

<!-- After -->
<OBadge :variant="statusVariant(row)">
  <OTooltip>{{ row.status }}</OTooltip>
</OBadge>
```

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Done |
| ⚠️ | Special case — read note |

---

## q-badge replacements

### alerts/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/alerts/AddAlert.vue` | 58 | 1 | `primary` (anomaly status, dynamic color) | ⬜ |
| `src/components/alerts/AlertList.vue` | 318 | 1 | dynamic status → `success`/`error`/`warning` | ⬜ |
| `src/components/alerts/AlertsDestinationList.vue` | 132, 147 | 2 | dynamic status | ⬜ |
| `src/components/alerts/ImportSemanticGroups.vue` | 149, 269, 270 | 3 | `primary`, `default` | ⬜ |
| `src/components/alerts/IncidentDetailDrawer.vue` | 73, 89, 104, 929 | 4 | `*-outline` (lines 73–104), `primary`/`error` (line 929) | ⬜ |
| `src/components/alerts/IncidentAlertTriggersTable.vue` | 57 | 1 | dynamic status | ⬜ |

### settings/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/settings/Nodes.vue` | 629, 633 | 2 | `default` (region/cluster labels) | ⬜ |
| `src/components/settings/ServiceIdentitySetup.vue` | 475, 482, 574, 581, 1450, 1465 | 6 | dynamic status | ⬜ |
| `src/components/settings/AiToolsets.vue` | 85 | 1 | dynamic status | ⬜ |
| `src/components/settings/License.vue` | 102 | 1 | `success` / `error` (expired) | ⬜ |
| `src/components/settings/TestModelMatchDialog.vue` | 150 | 1 | dynamic status | ⬜ |

### dashboards/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/dashboards/settings/VariableSettings.vue` | 112, 118, 124 | 3 | `primary` (Global/Tabs/Panels counts) | ⬜ |

### pipelines/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/pipelines/BackfillJobDetails.vue` | 50, 132 | 2 | dynamic status | ⬜ |

### rum/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/rum/FrustrationEventBadge.vue` | 22 | 1 | custom class override → `error`/`warning` | ⬜ |
| `src/components/rum/FrustrationBadge.vue` | 19 | 1 | custom class override → `error`/`warning` | ⬜ |

### reports/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/reports/ReportList.vue` | 185, 192 | 2 | dynamic status | ⬜ |

### functions/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/functions/EnrichmentTableList.vue` | 332 | 1 | dynamic status | ⬜ |

### iam/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/iam/serviceAccounts/ServiceAccountsList.vue` | 84, 106 | 2 | `primary` (line 84 `blue-2`), `default` (line 106) | ⬜ |

### cross-linking/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/cross-linking/CrossLinkManager.vue` | 36 | 1 | dynamic status | ⬜ |

### anomaly_detection/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/anomaly_detection/AnomalyDetectionList.vue` | 50 | 1 | dynamic status + spinner in slot | ⬜ |

### traces/ plugins

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/plugins/traces/TraceDetailsSidebar.vue` | 43, 270, 312 | 3 | dynamic status/severity | ⬜ |
| `src/plugins/traces/TraceEvaluationsView.vue` | 224, 250, 377, 387, 437 | 5 | `warning`, dynamic | ⬜ |
| `src/plugins/traces/SearchResult.vue` | 34, 40 | 2 | dynamic status | ⬜ |
| `src/plugins/traces/LLMContentRenderer.vue` | 22, 28 | 2 | dynamic status | ⬜ |

### correlation/ plugins

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/plugins/correlation/TelemetryCorrelationDashboard.vue` | 252, 355, 747, 858, 1149 | 5 | dynamic status/severity | ⬜ |

### enterprise/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/enterprise/components/billings/plans.vue` | 38 | 1 | `primary` | ⬜ |

### views/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/views/About.vue` | 212 | 1 | `success` / `error` (expired) | ⬜ |
| `src/views/CorrelationDemo.vue` | 78, 83 | 2 | dynamic | ⬜ |

### components/

| File | Lines | Usages | Variant(s) needed | Status |
|------|-------|--------|-------------------|--------|
| `src/components/PredefinedThemes.vue` | 72, 113, 147, 188 | 4 | `primary`, `default` | ⬜ |

---

## q-chip replacements (display-only)

> ⚠️ `TagInput.vue` is **excluded** — its `removable` chip needs `OTag`, a separate component.

### alerts/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/alerts/AlertHistory.vue` | 163, 346 | 2 | `outline` status chips | ⬜ |
| `src/components/alerts/AlertHistoryDrawer.vue` | 269 | 1 | status chip | ⬜ |
| `src/components/alerts/AddDestination.vue` | 96 | 1 | `primary` label | ⬜ |
| `src/components/alerts/ImportSemanticGroups.vue` | 83, 88, 93, 258, 296, 312 | 6 | diff summary chips + field chips | ⬜ |
| `src/components/alerts/ImportSemanticGroupsDrawer.vue` | 84, 90, 96, 293, 328, 345 | 6 | diff summary chips + field chips | ⬜ |

### settings/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/settings/BuiltInPatternsTab.vue` | 118, 128, 209 | 3 | tag chips, `size="sm"` | ⬜ |
| `src/components/settings/ServiceIdentityConfig.vue` | 65, 75, 85 | 3 | field label chips | ⬜ |

### logstream/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/logstream/PerformanceFieldsDialog.vue` | 37, 57 | 2 | field chips | ⬜ |

### cross-linking/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/cross-linking/CrossLinkManager.vue` | 49 | 1 | label chip | ⬜ |
| `src/components/cross-linking/CrossLinkDialog.vue` | 53 | 1 | label chip | ⬜ |

### pipelines/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/pipelines/PipelineHistory.vue` | 173, 332 | 2 | status chips | ⬜ |

### ingestion/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/ingestion/recommended/AWSQuickSetup.vue` | 76, 168, 338 | 3 | `primary` label chips | ⬜ |

### anomaly_detection/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/anomaly_detection/steps/AnomalyAlerting.vue` | 97 | 1 | label chip | ⬜ |

### ai_toolsets/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/ai_toolsets/AddAiToolset.vue` | 182 | 1 | label chip | ⬜ |

### TelemetryCorrelationPanel

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/TelemetryCorrelationPanel.vue` | 57, 84, 104 | 3 | service/type chips | ⬜ |

### traces/ plugins

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/plugins/traces/TraceDetailsSidebar.vue` | 77–255 | 11 | ⚠️ includes 1 clickable chip (copy span ID) → `clickable @click` | ⬜ |
| `src/plugins/traces/TraceDAG.vue` | 66 | 1 | `error` chip `"ERR"` | ⬜ |
| `src/plugins/traces/ThreadView.vue` | 35, 46, 52, 60, 68, 80 | 6 | ⚠️ square metric chips — see special cases | ⬜ |

### logs/ plugins

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/plugins/logs/patterns/PatternDetailsDialog.vue` | 184, 224 | 2 | tag chips | ⬜ |
| `src/plugins/logs/patterns/PatternCard.vue` | 62 | 1 | tag chip | ⬜ |

### correlation/ plugins

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/plugins/correlation/TelemetryCorrelationDashboard.vue` | 544, 1026 | 2 | `primary` label chips | ⬜ |

### enterprise/

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/enterprise/components/billings/proPlan.vue` | 24, 75, 87, 103 | 4 | pricing plan chips | ⬜ |
| `src/enterprise/components/billings/enterprisePlan.vue` | 24 | 1 | pricing plan chip | ⬜ |

---

## Special cases

### ⚠️ `TagInput.vue` — EXCLUDED
**Do not migrate.** The single `q-chip removable @remove` usage here requires `OTag` (a form input component, not a display badge). Migrate when `OTag` is built.

### ⚠️ `ThreadView.vue` — Square metric chips (lines 35–80)
Six chips using `square` + `dense` + icon+label+value triplet pattern:
```html
<q-chip dense square class="thread-chip thread-chip--tools">
  <q-icon name="build" />
  <span class="label">Tools</span>
  <span class="value">3</span>
</q-chip>
```
These are metric display tiles, not semantic status badges. Migrate as `OBadge` with `size="sm"` and the `#icon` slot + trailing slot. The `square` shape is dropped — the pill shape is acceptable here, or revisit when a `OMetricChip` component is built.

### ⚠️ `IncidentDetailDrawer.vue` line 929 — Stream type badges
```html
:color="stream_type === 'logs' ? 'blue' : stream_type === 'metrics' ? 'purple' : 'teal'"
```
Map all three to `variant="primary"`. Purple/teal are not in the token palette — this is a product-level mapping decision. If distinct colors are required, create an app-level `StreamTypeBadge` wrapper component.

### ⚠️ `FrustrationBadge.vue` / `FrustrationEventBadge.vue`
These files use custom CSS class overrides on `q-badge` instead of `color` prop. Inspect the actual rendered colours and map to the nearest semantic variant (`error`, `warning`, `default`). Remove the custom CSS overrides after migration.

### ⚠️ `AnomalyDetectionList.vue` line 50 — Spinner in badge slot
```html
<q-badge ...>
  <q-spinner v-if="row.status === 'training'" />
</q-badge>
```
After migration, the `<q-spinner>` becomes `<OSpinner>` (or a plain spinner element) inside the default slot of `OBadge`.

---

## Dynamic color helper pattern

Most files compute a color string dynamically (e.g. `statusColor(row)`). After migration, replace with a variant-returning helper:

```ts
// Before
function statusColor(status: string): string {
  return status === 'active' ? 'positive' : status === 'failed' ? 'negative' : 'grey'
}

// After
import type { BadgeVariant } from '@/lib/core/Badge/OBadge.types'

function statusVariant(status: string): BadgeVariant {
  if (status === 'active') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'warning') return 'warning'
  return 'default'
}
```

---

## Progress summary

| Category | Total files | Done | Remaining |
|----------|------------|------|-----------|
| q-badge | 29 | 0 | 29 |
| q-chip (display) | 27 | 0 | 27 |
| **Total** | **56** | **0** | **56** |

_Update this table as files are completed._
