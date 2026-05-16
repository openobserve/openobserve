# OBadge Migration Audit

Tracks replacement of `<q-badge>` and `<q-chip>` (display-only) with `<OBadge>`.

**Component:** `@/lib/core/Badge/OBadge.vue`  
**Replaces:** `q-badge` (63 usages), `q-chip` display-only (63 usages)  
**Excludes:** `TagInput.vue` — needs `OTag` (separate component, not OBadge)

---

## OBadge capability audit

### What OBadge supports

| Feature | API | Notes |
|---------|-----|-------|
| 15 semantic variants | `variant` prop | `default`, `primary`, `success`, `warning`, `error` + `-outline` and `-soft` of each |
| 2 sizes | `size` prop | `sm`, `md` |
| Material icon (left) | `icon` prop | Renders as `<span class="material-icons">` |
| Custom icon (left) | `#icon` slot | Any markup — images, SVGs, avatars |
| Trailing segment (right) | `count` prop / `#trailing` slot | Separated by a thin divider |
| Flexible label | default slot | Text, tooltips, spinners, icons — anything |
| Clickable | `clickable` prop + `@click` | Renders `<button>`, adds focus ring + hover |
| Disabled | `disabled` prop | Mutes opacity, suppresses interaction |
| Passthrough attrs | `v-bind="$attrs"` | `data-test`, `class`, `style`, `title` all pass through |
| Shape | Always pill (`rounded-full`) | Not configurable |

### Gaps — what needs attention before migration

#### ~~GAP 1 — Colors beyond 5 semantic variants~~ ✅ RESOLVED (migration strategy)

No component changes needed. Rewrite each color helper to return `BadgeVariant` during file migration.

**1. `getSeverityColorHex()` in `IncidentDetailDrawer.vue`** (line 2227)

```ts
// Before — returns arbitrary hex
const getSeverityColorHex = (severity: string) => {
  switch (severity) {
    case "P1": return "#b91c1c"
    case "P2": return "#c2410c"
    case "P3": return "#d97706"
    case "P4": return "#6b7280"
    default:   return "#6b7280"
  }
}

// After — returns BadgeVariant
import type { BadgeVariant } from '@/lib/core/Badge/OBadge.types'
const getSeverityVariant = (severity: string): BadgeVariant => {
  switch (severity) {
    case "P1": return "error"         // red-700 → error
    case "P2": return "warning"       // orange-700 → warning
    case "P3": return "warning-soft"  // amber-600 → warning-soft
    case "P4": return "default"       // gray-500 → default
    default:   return "default"
  }
}
```
Template: `:style="{ color: getSeverityColorHex(...) }" outline` → `:variant="getSeverityVariant(...)"`

**2. `getStatusColor()` in `IncidentDetailDrawer.vue`** (line 2201)

```ts
// Before
"open" → "negative" | "acknowledged" → "orange" | "resolved" → "positive" | default → "grey"

// After
"open" → "error" | "acknowledged" → "warning" | "resolved" → "success" | default → "default"
```

**3. `getStatusColor()` in `AlertHistory.vue`** (line 943)

```ts
// Before
success/ok/completed → "positive" | error/failed → "negative" | warning → "warning"
pending/running → "info" | default → theme-based "white"/"black"

// After
success/ok/completed → "success" | error/failed → "error" | warning → "warning"
pending/running → "primary" | default → "default"
```

**4. `getObservationTypeColor()` in `llmUtils.ts`** (line 450) — used in 1 badge

Collapse 13+ Quasar colors to semantic variants:

| Quasar color(s) | Maps to | Types |
|-----------------|---------|-------|
| `green` | `success` | chat, text_completion, generate_content |
| `blue`, `indigo`, `cyan`, `teal`, `light-blue` | `primary` | embeddings, chain, retrieval, task, rerank |
| `purple`, `deep-purple`, `pink` | `primary-soft` | invoke_agent, create_agent, invoke_workflow, evaluator |
| `orange`, `amber` | `warning` | execute_tool, event |
| `red` | `error` | guardrail |
| `grey` | `default` | span, fallback |

**5. Stream type badge** in `IncidentDetailDrawer.vue` (line 929)

`blue`/`purple`/`teal` → all collapse to `variant="primary-outline"` (same as existing guide note)

#### ~~GAP 2 — No "soft/tinted" variant style~~ ✅ RESOLVED

Added 5 soft variants: `default-soft`, `primary-soft`, `success-soft`, `warning-soft`, `error-soft`.

Light tinted bg + dark text. Maps directly:
- `color="indigo-1" text-color="indigo-10"` → `variant="primary-soft"`
- `color="green-2" text-color="green-10"` → `variant="success-soft"`
- `color="grey-3" text-color="grey-8"` → `variant="default-soft"`
- `color="blue-2" text-color="blue-8"` → `variant="primary-soft"`

#### GAP 3 — Shape always pill (~18 usages, cosmetic only) — NO FIX NEEDED

OBadge is always `rounded-full`. Accept pill shape for all migrated badges. The square metric tiles in `ThreadView.vue` and `TraceDetailsSidebar.vue` can override via `class="tw:rounded-md!"` through `$attrs` if pill feels wrong after visual review.

### What works without issues (all 126 usages)

The vast majority of usages map cleanly:

- `color="positive"/"green"` → `variant="success"` ✅
- `color="negative"/"red"` → `variant="error"` ✅
- `color="warning"` → `variant="warning"` ✅
- `color="primary"/"blue"` → `variant="primary"` ✅
- `color="grey"/"grey-6"` → `variant="default"` ✅
- `outline` → append `-outline` to variant ✅
- `label` prop → default slot ✅
- `dense` / `size="sm"` → `size="sm"` ✅
- `clickable @click` → same API ✅
- `<q-icon>` in badge → `icon` prop or `#icon` slot ✅
- `<q-tooltip>` in badge → default slot ✅
- `<q-spinner>` in badge → default slot ✅
- `data-test`, custom `class`, `style` → passthrough via `$attrs` ✅
- `v-for` loops, `v-if` conditionals → standard Vue, works naturally ✅

---

## Variant mapping guide

| Quasar prop | OBadge prop |
|-------------|-------------|
| `color="positive"` / `color="green"` | `variant="success"` |
| `color="negative"` / `color="red"` | `variant="error"` |
| `color="warning"` | `variant="warning"` |
| `color="primary"` / `color="blue"` / `color="teal"` | `variant="primary"` |
| `color="grey"` / `color="grey-6"` / `color="grey-4"` | `variant="default"` |
| `color="blue-2"` (light tint) | `variant="primary-soft"` |
| `color="indigo-1" text-color="indigo-10"` | `variant="primary-soft"` |
| `color="green-2" text-color="green-10"` | `variant="success-soft"` |
| `color="grey-3" text-color="grey-8"` | `variant="default-soft"` |
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
| `src/components/settings/OrgStorageSettings.vue` | 190 | 1 | `success` (active status + icon in slot) | ⬜ |
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
| `src/components/ai_toolsets/AddAiToolset.vue` | 182 | 1 | ⚠️ clickable preset chips — `clickable @click` (see special cases) | ⬜ |

### TelemetryCorrelationPanel

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/components/TelemetryCorrelationPanel.vue` | 57, 84, 104 | 3 | service/type chips | ⬜ |

### traces/ plugins

| File | Lines | Usages | Notes | Status |
|------|-------|--------|-------|--------|
| `src/plugins/traces/TraceDetailsSidebar.vue` | 77, 100, 115, 131, 146, 164, 213, 226, 240, 255 | 10 | ⚠️ includes 1 clickable chip (line 164 — copy span ID) → `clickable @click` | ⬜ |
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

### ⚠️ `AddAiToolset.vue` — Clickable preset chips
```html
<q-chip
  v-for="preset in CLI_PRESETS"
  :key="preset.id"
  clickable
  @click="applyPreset(preset)"
>
  {{ preset.label }}
</q-chip>
```
These are **clickable** preset selection chips, not display-only labels. Migrate using `OBadge` with `clickable` + `@click`. The `v-for` loop stays the same.

### ⚠️ `OrgStorageSettings.vue` line 190 — Badge with icon in slot
```html
<q-badge color="positive" style="...">
  <q-icon name="check_circle" size="11px" style="margin-right: 3px;" />
  {{ t("storage_settings.active") }}
</q-badge>
```
Uses inline style for pill shape. After migration, use `OBadge variant="success"` with `#icon` slot for the check icon. Drop inline styles.

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

## CSS-only references (post-migration cleanup)

These files have `.q-chip` or `.q-badge` CSS selectors in `<style>` blocks but no template-level component usage. Update these selectors **after** the parent component's template is migrated.

| File | Lines | Selector(s) | Notes |
|------|-------|-------------|-------|
| `src/components/alerts/steps/Deduplication.vue` | 312, 333, 352 | `.q-chip` | Styles chips rendered by child (TagInput/q-select) — update when `OTag` is built |
| `src/enterprise/components/EvalTemplateEditor.vue` | 365, 382, 393 | `.q-chip` | Dimension selection chips — dark/light mode overrides |
| `src/plugins/traces/TraceDetailsSidebar.vue` | 2191, 2197 | `.q-chip__content`, `.q-chip__icon--remove` | Styling for trace detail chips — update alongside template migration |
| `src/components/dashboards/settings/VariableSettings.vue` | 544 | `.q-badge` | Font-size/padding override — remove after template migration |
| `src/components/alerts/ImportSemanticGroups.vue` | 679 | `:deep(.q-chip__content)` | Padding/font-weight override — remove after template migration |

---

## Test file mocks (post-migration cleanup)

These test files mock `q-badge`/`q-chip` components or query `.q-chip`/`.q-badge` CSS classes. Update after the parent component is migrated.

| File | Lines | What to update |
|------|-------|---------------|
| `src/components/settings/BuiltInPatternsTab.spec.ts` | 128 | Remove `q-chip` mock from global stubs |
| `src/components/cross-linking/CrossLinkManager.spec.ts` | 58–64, 155 | Remove `q-chip`/`q-badge` mocks; update `.q-chip` selector to new class |

---

## ESLint deprecation rules

`eslint.config.js` (lines 127–132) already has deprecation warnings for both `q-badge` and `q-chip` → `OBadge`. These rules should remain active until migration is complete, then be removed.

---

## Progress summary

| Category | Total files | Done | Remaining |
|----------|------------|------|-----------|
| q-badge | 30 | 0 | 30 |
| q-chip (display) | 23 | 0 | 23 |
| CSS-only refs | 5 | 0 | 5 |
| Test mocks | 2 | 0 | 2 |
| **Total** | **60** | **0** | **60** |

_Update this table as files are completed._
