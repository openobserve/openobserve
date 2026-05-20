# Icons, Chips & Badges — Quasar Removal Audit (Consolidated)

This document consolidates every icon/chip/badge-related finding from the 30 page-level audit MDs in `FINAL_AUDIT/`. Tick `- [ ]` boxes off as fixes land. See [README.md](./README.md) for the project-wide checklist.

## Executive Summary
- **Total icon-related findings:** ~90 (across all categories)
- **Total chip/badge-related findings:** ~25
- **Pages affected:** ~25 (Alerts, Anomaly Detection, Billing, Cipher Keys, Common Components, Correlation/AI, Dashboards, Enrichment Tables, Error Tracking, Functions, Home, IAM, Ingestion, Logs, Metrics, O-Library, Pipelines, Reports, RUM Performance, RUM Sessions, Settings, Traces, plus library-level OBadge/OCollapsible/OTabs/OPagination/OTimeline)
- **Recurring patterns (top 5 by count):**
  1. `OIcon :color="..."` props silently dropped — 37 instances across 23 files (cross-checked in css_class_level_audit.md §7.2)
  2. `OIcon name="check_circle"` / underscore names — ~20 instances; registry only accepts kebab-case (css_class_level_audit.md §7.1)
  3. `OIcon name="tw:block"` sed regression from mass-replace — 3+ files (alerts/iam/settings)
  4. `OIcon + OTooltip` sibling pattern — tooltip attaches to wrong parent — ~30 occurrences across alerts, anomaly, enrichment, metrics, common, traces, reports
  5. `material-icons-outlined` / `material-symbols-outlined` font ligature leftovers — 8+ in library + page components

## Quick Reference

### OIcon API (web/src/lib/core/Icon/OIcon.types.ts + OIcon.icons.ts)
- Names: **kebab-case only** (`check-circle`, NOT `check_circle`)
- Sizes: `xs | sm | md | lg | xl` (no pixel values, no `18px`)
- **No `color` prop** — set color via `class="tw:text-[var(--o2-*)]"` directly on `<OIcon>` (attribute fallthrough applies the class to the root `<span>`; the SVG inside inherits `currentColor`). Wrapper-span is unnecessary.
- Registry: `web/src/lib/core/Icon/OIcon.icons.ts` — names not in this file render blank
- Decorative usage: toggle `aria-hidden="true"` (OIcon honors `label` prop for role="img")

### OBadge API
- `variant` accepts the typed union; check `web/src/lib/core/Badge/OBadge.types.ts` for valid values: `default | primary | primary-soft | success | success-soft | warning | error | destructive | ...`
- Use **default slot** for icons (`<OBadge><OIcon name="..." />Label</OBadge>`), not the deprecated `icon` font-ligature prop
- Always pass a label/body (default slot)
- `count: 0` renders the `0` chip — pass `count: undefined` to hide
- `border-radius` is locked to `pill` (rounded-full) — inline `style="border-radius:0"` breaks the design system

### Migration cheatsheet
| Old | New |
|---|---|
| `<q-icon name="check_circle" />` | `<OIcon name="check-circle" />` |
| `<OIcon :color="negative" />` | `<OIcon name="..." class="tw:text-[var(--o2-negative)]" />` |
| `<OIcon size="18px" />` | `<OIcon size="sm" />` (or pick xs/md based on visual) |
| `<q-chip>{{ text }}</q-chip>` | `<OBadge>{{ text }}</OBadge>` |
| `<OBadge icon="check_circle" />` | `<OBadge><OIcon name="check-circle" />Label</OBadge>` |
| `<OIcon /><OTooltip>...</OTooltip>` (siblings) | Wrap in `<span class="tw:inline-flex"><OIcon /><OTooltip>...</OTooltip></span>` or nest tooltip inside OIcon's default slot |
| `class="material-icons-outlined"` (with literal text node) | use `<OIcon name="..." />` |
| `<q-badge :color="positive">` | `<OBadge variant="success">` |
| `<q-badge :label="count">` | `<OBadge>{{ count }}</OBadge>` |

---

## 1. Icon Name Issues (`_` → `-`)

Every finding from the 30 audits where an `OIcon name=` uses underscores instead of hyphens, or otherwise doesn't match the registry. Per `css_class_level_audit.md §7.1`, the registry only accepts hyphenated keys.

### Direct `OIcon name="..."` usage:
- [x] **`web/src/lib/core/Table/sub-components/OTableBodyCell.vue:279`** — `<OIcon :name="copied ? 'check' : 'content_copy'" size="xs" />` — `content_copy` not in registry — `css_class_level_audit.md`
- [ ] **`web/src/lib/core/Table/sub-components/OTableBodyCell.vue:279`** — `<OIcon :name="copied ? 'check' : 'content_copy'" size="xs" />` — `content_copy` not in registry — `css_class_level_audit.md`
  **Solution:**
  ```diff
  - <OIcon :name="copied ? 'check' : 'content_copy'" size="xs" />
  + <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
  ```

- [x] **`web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue:103,123,143`** — `:name="p50DeltaPct > 2 ? 'arrow_upward' : p50DeltaPct < -2 ? 'arrow_downward' : 'remove'"` (3 instances p50/p95/p99) — `css_class_level_audit.md §7.1`
  **Solution:**
  ```diff
  - :name="p50DeltaPct > 2 ? 'arrow_upward' : p50DeltaPct < -2 ? 'arrow_downward' : 'remove'"
  + :name="p50DeltaPct > 2 ? 'arrow-upward' : p50DeltaPct < -2 ? 'arrow-downward' : 'remove'"
  ```

- [x] **`web/src/components/settings/License.vue:293`** — `name="check_circle"` (snake_case Quasar name) — `settings_audit.md §7`
  **Solution:**
  ```diff
  - <OIcon name="check_circle" size="18px" ... />
  + <OIcon name="check-circle" size="sm" ... />
  ```

- [x] **`web/src/components/rum/common/performance/MetricCard.vue:146`** — `good: "check_circle"` icon mapping uses underscore — registry only has `check-circle` — `rum_performance_audit.md C1`
  **Solution:**
  ```diff
  - good: "check_circle",
  + good: "check-circle",
  ```

- [x] **`web/src/plugins/metrics/MetricLegends.vue:354`** — `Histogram: "bar_chart", Counter: "pin"` — neither `bar_chart` nor `pin` exist in registry; `MetricList.vue` correctly uses `bar-chart` / `tag` — `metrics_audit.md`
  **Solution:**
  ```diff
  - Histogram: "bar_chart", Counter: "pin",
  + Histogram: "bar-chart", Counter: "tag",
  ```

### Computed / passed-through icon strings (also resolve via OIcon registry on host components):
- [x] **`web/src/enterprise/components/billings/proPlan.vue:94,109`** — `<OBadge variant="success-soft" icon="check_circle" ...>` — OBadge passes string to OIcon registry — `billing_audit.md #2`
  **Solution:**
  ```diff
  - <OBadge variant="success-soft" icon="check_circle" class="tw:px-3 tw:py-2">
  + <OBadge variant="success-soft" class="tw:px-3 tw:py-2">
  +   <OIcon name="check-circle" size="xs" class="tw:mr-1" />
  +   <slot />
  + </OBadge>
  ```

- [x] **`web/src/plugins/traces/TraceEvaluationsView.vue:656`** — `accuracy: "check_circle"` computed source — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/pipelines/BackfillJobDetails.vue:183`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/rum/ResourceDetailDrawer.vue:250`** — `return "check_circle";` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/rum/common/performance/ViewPerformanceMetrics.vue:110`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/alerts/AlertHistorySummary.vue:154`** — `return "check_circle";` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/alerts/ImportSemanticGroups.vue:212`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/alerts/ImportSemanticGroupsDrawer.vue:193`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/alerts/AlertHistoryDrawer.vue:717`** — `return "check_circle_outline";` — `css_class_level_audit.md §7.1` (use `check-circle-outline` or `check-circle`)
  **Solution (apply pattern to all 9 above):**
  ```diff
  - icon="check_circle"           // or return "check_circle"
  + icon="check-circle"           // or return "check-circle"
  ```

### Settings tab icon names (rely on Material Icons font fallback):
- [x] **`web/src/components/settings/index.vue`** — tab `icon=` props use snake_case for: `query_stats`, `domain`, `location_on`, `person_pin_circle`, `card_membership`, `smart_toy`, `group_work`, `lan`, `key`, `paid`, `hub`, `regex_patterns`, `pipeline_destinations`, `organization_management`, `model_pricing`, `domain_management`, `correlation_settings`, `alert_destinations`, `ai_toolsets` — only single-word ones already registered; `card-membership`, `person-pin-circle` need registry entries — `settings_audit.md §11` + `css_class_level_audit.md §7.1`
  **Solution:**
  ```diff
  - icon="query_stats"
  + icon="query-stats"
  - icon="card_membership"
  + icon="card-membership"   // also register in OIcon.icons.ts if missing
  ```

### Pipeline icon strings:
- [ ] **`web/src/components/pipeline/NodeForm/CreateDestinationForm.vue`** — `name="url_endpoint"`, `name="output_format"`, `name="esbulk_index"` (verify these are intentional route keys vs icon names) — `css_class_level_audit.md §7.1`

### Pipelines node-form icon string typo:
- [x] **`web/src/plugins/pipelines/CustomNode.vue` line ~71-89** — `<OIcon :name="getIcon(data, io - type)" size="md" ... />` — `io - type` is computed JS subtraction; should be `io_type` (string) — `pipelines_audit.md`
  **Solution:**
  ```diff
  - <OIcon :name="getIcon(data, io - type)" size="md" ... />
  + <OIcon :name="getIcon(data, io_type)" size="md" ... />
  ```

## 2. Icon Name Sed Regressions (`tw:block`, etc.)

Mass-replace of Quasar utility classes prefixed `tw:` accidentally rewrote icon `name="..."` attribute values.

- [x] **`web/src/components/alerts/AlertHistory.vue:190`** — `<OIcon name="tw:block" size="sm" />` should be `name="block"` — breaks dedup "Suppressed" icon — `alerts_audit.md #1`
  **Solution:**
  ```diff
  - <OIcon name="tw:block" size="sm" />
  + <OIcon name="block" size="sm" />
  ```

- [x] **`web/src/components/iam/organizations/OrganizationManagement.vue:90`** — `<OIcon name="tw:block" size="xs" />` should be `name="block"` — Revoke action icon — `iam_audit.md` / `settings_audit.md #2`
  **Solution:**
  ```diff
  - <OIcon name="tw:block" size="xs" />
  + <OIcon name="block" size="xs" />
  ```

- [x] **`web/src/enterprise/components/billings/proPlan.vue:65`** — `<OIcon v-else name="" color="green" size="sm" />` — `name=""` empty string, also dead `color` prop — `billing_audit.md #6` + `css_class_level_audit.md §7.2`
  **Solution:**
  ```diff
  - <OIcon v-else name="" color="green" size="sm" class="tw:mr-2" />
  + <span v-else class="tw:mr-2 tw:text-[var(--o2-positive)]">
  +   <OIcon name="check-circle" size="sm" />
  + </span>
  ```

- [x] **`web/src/enterprise/components/billings/enterprisePlan.vue:66`** — `<OIcon v-else name="" color="green" size="sm" />` — same empty-name + dead color — `billing_audit.md #6`
  **Solution:** Same as above.

- [x] **`web/src/enterprise/components/billings/enterprisePlan.vue:80`** — `<OButton ... tw:block @click="contactSales">` — `block` prop was reformatted as `tw:block` attribute (HTML-attr namespace), button no longer full-width — `billing_audit.md #1`
  **Solution:**
  ```diff
  - <OButton variant="primary" size="sm-action" tw:block @click="contactSales">
  + <OButton variant="primary" size="sm-action" block @click="contactSales">
  ```

## 3. Icons Not in Registry (`bar_chart`, `pin`, `radio-button-unchecked`, etc.)

Names referenced but missing from `web/src/lib/core/Icon/OIcon.icons.ts`.

- [x] **`web/src/components/HomeView` (O2AIChat.vue context) — `radio-button-unchecked`** — used by Auto Navigation toggle off-state; not registered — `home_audit.md C4`
  **Solution (add to OIcon.icons.ts):**
  ```diff
  // web/src/lib/core/Icon/OIcon.icons.ts
  + import RadioButtonUnchecked from "~icons/material-symbols/radio-button-unchecked";
  + // in registry map:
  +   "radio-button-unchecked": RadioButtonUnchecked,
  ```

- [x] **`web/src/plugins/metrics/MetricLegends.vue:354`** — `bar_chart` / `pin` — not in registry; reconcile with `MetricList.vue` (`bar-chart` / `tag`) — `metrics_audit.md`

- [ ] **`web/src/views/Dashboards/RenderDashboardCharts.vue`** — `name="before_panels"` (likely custom — verify in registry) — `css_class_level_audit.md §7.1`

- [ ] **`web/src/enterprise/components/billings/Billing.vue`** — `name="invoice_history"` (verify in registry) — `css_class_level_audit.md §7.1`

- [x] **Settings tabs icons** referenced via Material Icons font fallback in `OTab.vue:111-114` — see Section 1 for full list; missing kebab-case registry entries: `card-membership`, `domain`, `person-pin-circle` — `settings_audit.md §11`

## 4. `OIcon :color` — Unsupported Prop

Every instance where `OIcon` has a `:color` prop. The prop is silently dropped (OIcon types only allow `name | size | label`). Total: **37 instances across 23 files** per `css_class_level_audit.md §7.2`.

**Canonical fix — Option 2 (attribute fallthrough):** Apply `class="tw:text-[var(--o2-*)]"` directly on `<OIcon>`. Vue forwards the unused `class` to OIcon's root `<span>`, and the SVG inside inherits `currentColor`. No wrapper span needed.

```vue
<OIcon name="error" class="tw:text-[var(--o2-negative)]" />
<OIcon name="check-circle" :class="row.healthy ? 'tw:text-[var(--o2-positive)]' : 'tw:text-gray-500'" />
```

### Most affected files (counts from css_class_level_audit.md):
- [x] **`web/src/components/O2AIChat.vue:345,397,1317,1335`** — 4 instances (status colors for AI tool calls — success/warning/failure indistinguishable) — `home_audit.md C3`
  **Solution:**
  ```diff
  - <OIcon :color="block.success ? 'positive' : block.warning ? 'warning' : 'negative'" name="..." />
  + <OIcon
  +   :class="block.success ? 'tw:text-[var(--o2-positive)]' : block.warning ? 'tw:text-[var(--o2-warning)]' : 'tw:text-[var(--o2-negative)]'"
  +   name="..." />
  ```

- [x] **`web/src/components/pipelines/PipelineHistory.vue:155,165,178,377`** — 4 instances — `pipelines_audit.md C8`
- [x] **`web/src/components/alerts/IncidentDetailDrawer.vue:1015,1064,1120`** — 3 instances using Quasar tokens (`warning`/`negative`/`grey-5`) — `alerts_audit.md M-4`
  **Solution:**
  ```diff
  - :color="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'negative') : 'grey-5'"
  + :class="correlationError ? (correlationError.includes('disambiguation fields') ? 'tw:text-[var(--o2-warning)]' : 'tw:text-[var(--o2-negative)]') : 'tw:text-gray-500'"
  ```

- [x] **`web/src/plugins/traces/TraceDetailsSidebar.vue`** — 2 instances — `css_class_level_audit.md`
- [x] **`web/src/plugins/logs/SearchBar.vue`** — 2 instances — `css_class_level_audit.md`
- [x] **`web/src/components/ingestion/recommended/AWSQuickSetup.vue`** — 2 instances — `css_class_level_audit.md`
- [x] **`web/src/components/rum/EventDetailDrawerContent.vue`** — 2 instances — `css_class_level_audit.md`
- [x] **`web/src/components/rum/common/performance/MetricCard.vue` lines ~163,175** — 2 instances (status colors lost) — `rum_performance_audit.md C2`
  **Solution:**
  ```diff
  - <OIcon v-if="icon" :name="icon" size="sm" :color="statusColor" />
  - <OIcon v-if="status" :name="statusIcon" size="sm" :color="statusColor" />
  + <OIcon v-if="icon" :name="icon" size="sm" :class="statusColorClass" />
  + <OIcon v-if="status" :name="statusIcon" size="sm" :class="statusColorClass" />
  ```
  Where `statusColorClass` is a computed returning `'tw:text-[var(--o2-positive)]' | 'tw:text-[var(--o2-warning)]' | 'tw:text-[var(--o2-negative)]'` etc.

- [ ] **`web/src/components/alerts/AlertHistory.vue`** — 2 instances — `css_class_level_audit.md`
- [x] **`web/src/plugins/traces/TraceEvaluationsView.vue:361`** — `:color="getDimColor(dim.dimension)"` — `css_class_level_audit.md`
- [x] **`web/src/components/pipelines/CreateBackfillJobDialog.vue:163`** — `:color="store.state.theme === 'dark' ? 'orange-4' : 'orange'"` — `pipelines_audit.md C8/M5`
  **Solution:**
  ```diff
  - <OIcon name="warning" :color="store.state.theme === 'dark' ? 'orange-4' : 'orange'" size="md" />
  + <OIcon name="warning" class="tw:text-orange-500 dark:tw:text-orange-400" size="md" />
  ```

- [x] **`web/src/components/pipelines/PipelineHistory.vue` (general):** `<OIcon :name="..." :color="row.is_realtime ? 'positive' : 'grey'" />` — `pipelines_audit.md C8`
  **Solution:**
  ```diff
  - <OIcon :name="..." :color="row.is_realtime ? 'positive' : 'grey'" />
  + <OIcon
  +   :name="..."
  +   :class="row.is_realtime ? 'tw:text-[var(--o2-positive)]' : 'tw:text-gray-500'"
  + />
  ```

- [x] **`web/src/components/functions/AddEnrichmentTable.vue:108`** — `:color="job.status === 'completed' ? 'positive' : ..."` — `enrichment_tables_audit.md §3` + `functions_audit.md M1`
  **Solution:**
  ```diff
  - <OIcon :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : ..." size="sm" />
  + <OIcon
  +   :class="job.status === 'completed' ? 'tw:text-green-500' : job.status === 'failed' ? 'tw:text-red-500' : 'tw:text-gray-500'"
  +   size="sm"
  + />
  ```

- [x] **`web/src/components/alerts/AddAlert.vue:348`** — `:color="...'positive' : 'grey-5'"` — `alerts_audit.md class-level §7`
- [x] **`web/src/components/dashboards/addPanel/PanelFieldList.vue`** — 1 instance — `css_class_level_audit.md`
- [x] **`web/src/enterprise/components/billings/enterprisePlan.vue:66`** + **`proPlan.vue:65`** — `color="green"` — see Section 2 above

### Remaining single-instance files (drop `:color`, apply `class="tw:text-*"` directly on `<OIcon>`):
- [x] `web/src/plugins/traces/SearchBar.vue` — 1
- [x] `web/src/components/settings/ServiceIdentitySetup.vue` — 1
- [x] `web/src/components/settings/AddRegexPattern.vue` — 1
- [x] `web/src/components/ingestion/recommended/AzureQuickSetup.vue` — 1
- [x] `web/src/components/rum/ResourceDetailDrawer.vue` — 1
- [x] `web/src/components/alerts/AlertHistoryDrawer.vue` — 1
- [x] `web/src/components/alerts/AlertHistorySummary.vue` — 1

## 5. `OIcon :size` — Invalid Pixel Values

OIcon's `size` prop only accepts `xs|sm|md|lg|xl` per `OIcon.types.ts`. Pixel values fall back to default `md`.

- [x] **`web/src/components/settings/License.vue:285`** — `<OIcon name="warning" size="18px" ... />` — `settings_audit.md §8`
  **Solution:**
  ```diff
  - <OIcon name="warning" size="18px" ... />
  + <OIcon name="warning" size="sm" ... />
  ```

- [x] **`web/src/components/settings/License.vue:294`** — `<OIcon name="check_circle" size="18px" ... />` — both name and size invalid — `settings_audit.md §8`
  **Solution:**
  ```diff
  - <OIcon name="check_circle" size="18px" ... />
  + <OIcon name="check-circle" size="sm" ... />
  ```

## 6. Decorative Icons Missing `aria-hidden`

OIcon toggles between `role="img" + aria-label` and `aria-hidden="true"` based on the `label` prop. Decorative icons next to a visible label should explicitly set `aria-hidden`.

- [ ] **`web/src/views/About.vue`** — all OIcons in template are purely decorative next to visible labels — `about_audit.md A-1`
  **Solution:**
  ```diff
  - <OIcon name="workspaces" size="lg" />
  + <OIcon name="workspaces" size="lg" aria-hidden="true" />
  ```

- [ ] **`web/src/components/ingestion/{Recommended,Server,Database,Networking,Security,Languages,DevOps,Others,MessageQueues}.vue`** — `<OIcon name="search" class="tw:cursor-pointer" />` in search-bar `#icon-left` — implies clickable but no handler — `ingestion_audit.md`
  **Solution:**
  ```diff
  - <OIcon name="search" class="tw:cursor-pointer" />
  + <OIcon name="search" aria-hidden="true" />
  ```

- [ ] **`web/src/plugins/traces/TraceDetails.vue` ~line 92-118** — clickable `<OIcon>` (copy trace ID) with only `title=`, no `aria-label` — `traces_audit.md A2`
  **Solution:**
  ```diff
  - <OIcon name="content-copy" @click="copyTraceId" title="Copy trace ID" />
  + <button :aria-label="t('traces.copyTraceId')" @click="copyTraceId" class="...">
  +   <OIcon name="content-copy" aria-hidden="true" />
  + </button>
  ```

- [ ] **`web/src/components/reports/CreateReport.vue` info-tooltip icons** — `reports_audit.md`
  **Solution:**
  ```diff
  - <OIcon name="info-circle" />
  + <OIcon name="info-circle" aria-hidden="true" />
  ```

- [ ] **`web/src/components/functions/AssociatedStreamFunction.vue`** — decorative info icons — `functions_audit.md`

## 7. OIcon + OTooltip Sibling Pattern

OTooltip in "child mode" (no default slot) attaches mouse handlers to its **parent element** — when placed as a sibling of `<OIcon />` the tooltip triggers on the surrounding wrapper, not the icon. Hover hit-box is wider than intended.

- [ ] **`web/src/components/actionScripts/EditScript.vue:246-273, 340-357`** — `<OIcon name="info" size="sm" />` + `<OTooltip :content="..." />` as siblings — `action_scripts_audit.md #27`
  **Solution:**
  ```diff
  - <OIcon name="info" size="sm" />
  - <OTooltip :content="..." />
  + <OIcon name="info" size="sm">
  +   <OTooltip :content="..." />
  + </OIcon>
  ```

- [ ] **`web/src/views/HomeView.vue` / `O2AIChat.vue:99-100,141-142,437,549-550,646-647,670-671,693-694,820-821,862-863,911-912,1050,1106-1107,1119-1120,1212-1213,1287,1322,1352`** — broad pattern across 18+ sites; line 437 is particularly broken (orphan tooltip without v-if guard) — `home_audit.md C1, M1`
  **Solution:**
  ```diff
  - <OIcon name="info" />
  - <OTooltip :content="..." />
  + <OIcon name="info">
  +   <OTooltip :content="..." />
  + </OIcon>
  ```

- [ ] **`web/src/components/functions/EnrichmentTableList.vue:98-107,115-124,133-142,149-158,208-210`** (5 occurrences) — `functions_audit.md M3` / `enrichment_tables_audit.md L2`
- [ ] **`web/src/components/functions/TestFunction.vue:23-28,175-180,233-238`** (3) — `functions_audit.md M3`
- [ ] **`web/src/components/functions/FunctionsToolbar.vue:46-52,73-78`** (2) — `functions_audit.md M3`
- [ ] **`web/src/plugins/metrics/PromQLBuilderOptions.vue`** — `<OIcon name="info" size="sm" /> <OTooltip ...>` no anchor — `metrics_audit.md`
  **Solution:**
  ```diff
  - <OIcon name="info" size="sm" />
  - <OTooltip ... />
  + <OTooltip ...>
  +   <template #trigger><OIcon name="info" size="sm" /></template>
  + </OTooltip>
  ```

- [ ] **`web/src/components/reports/CreateReport.vue`** — info-tooltip pattern — `reports_audit.md`
  **Solution:**
  ```diff
  - <OIcon name="info-circle" />
  - <OTooltip ... />
  + <OTooltip ...>
  +   <OIcon name="info-circle" />
  + </OTooltip>
  ```

- [ ] **`web/src/components/iam/organizations/OrganizationManagement.vue:61,71,81,91,101,112` and `ServiceAccountsList.vue:98`** — `<OTooltip :content="..." />` placed inside `<OButton>` or `<OBadge>` without wrapping pattern — `iam_audit.md`

- [ ] **`web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:244,300,...`** + `AnomalyAlerting.vue:38` — `anomaly_detection_audit.md` (these note tooltip child-mode works but check anchor scope)

- [ ] **`web/src/components/QueryEditor.vue` lines 51-54** — `<OTooltip>` sibling of `<OIcon>` inside `<OButton>` — `query_editor_audit.md`

- [ ] **`web/src/plugins/correlation/DimensionFiltersBar.vue` line 48** — tooltip child-mode works because OTooltip implements anchor-to-parent, but pattern is "Quasar-style" — `correlation_ai_audit.md`

- [ ] **`web/src/components/functions/EnrichmentTableList.vue` (5)** + same pattern across status icon columns — `enrichment_tables_audit.md L2`

## 8. Material Font Ligature Leftovers (`material-icons-outlined`, `material-symbols-outlined`)

External font-icon classes that depend on the Material Icons font CSS being loaded (conflicts with the offline SVG OIcon registry — see `OIcon.icons.ts` design: "zero runtime fetches, fully functional in air-gapped environments"). Source: `css_class_level_audit.md §1.6`.

### Library-level (highest priority):
- [x] **`web/src/lib/navigation/Pagination/OPagination.vue:70,86,123,139`** — `material-icons` with literal characters like `skip_previous` — `css_class_level_audit.md` / `o_library_audit.md`
  **Solution:**
  ```diff
  - <span class="material-icons">skip_previous</span>
  + <OIcon name="skip-previous" />
  ```

- [x] **`web/src/lib/navigation/Tabs/OTabs.vue:163,192`** — `material-icons-outlined` fallback — `css_class_level_audit.md` / `o_library_audit.md`
- [x] **`web/src/lib/navigation/Tabs/OTab.vue:113`** — `material-icons-outlined` fallback when icon name not in registry — `css_class_level_audit.md` / `settings_audit.md §11`
- [x] **`web/src/lib/data/Timeline/OTimelineItem.vue:42`** — `material-icons` — `css_class_level_audit.md`
- [x] **`web/src/lib/core/Collapsible/OCollapsible.vue:116`** — `material-icons-outlined` — `css_class_level_audit.md` / `o_library_audit.md #6`
  **Solution:**
  ```diff
  - <span class="material-icons-outlined">{{ icon }}</span>
  + <OIcon :name="icon" :size="size === 'sm' ? 'xs' : 'sm'" />
  ```
- [x] **`web/src/lib/core/Badge/OBadge.vue:151`** — `material-icons-outlined` — Critical: this is the core OBadge component; `OBadge.icon` prop should be `IconName`, render via OIcon — `o_library_audit.md #6` + `css_class_level_audit.md`
  **Solution:**
  ```diff
  - <span class="material-icons-outlined">{{ icon }}</span>
  + <OIcon :name="icon" :size="size === 'sm' ? 'xs' : 'sm'" />
  ```
  Update the `icon` prop type to `IconName` (imported from `@/lib/core/Icon/OIcon.icons`).

### Page-level:
- [x] **`web/src/components/rum/performance/WebVitalsDashboard.vue:32`** — `material-symbols-outlined` — `css_class_level_audit.md`
- [x] **`web/src/components/alerts/AlertList.vue:298`** — `material-symbols-outlined` — `css_class_level_audit.md`
- [x] **`web/src/components/rum/common/performance/MetricCard.vue` and other RUM metric cards** — `<OIcon name="info" size="sm" class="material-symbols-outlined tw:mr-1" />` — dead class but harmless — `rum_performance_audit.md CSS2`
  **Solution:**
  ```diff
  - <OIcon name="info" size="sm" class="material-symbols-outlined tw:mr-1" />
  + <OIcon name="info" size="sm" class="tw:mr-1" />
  ```

## 9. `q-icon` Leftovers (Not Migrated)

After cross-checking, no live `q-icon` runtime usages remain (most replaced with OIcon). What remains are:
- Dead `:deep(.q-icon)` / `.q-icon` SCSS selectors — 41 occurrences per `css_class_level_audit.md §1.5` (silent no-ops; targeting these for cleanup is P2)
- Spec files still stubbing `q-icon` — see Section 17 below

Library/page-level relevant references:
- [ ] **`web/src/styles/app.scss:822-873`** — `.q-icon` rules dead — `global_css_architecture_audit.md`
- [ ] **`web/src/styles/logs/logs-page.scss:75-262`** — 42 `q-icon/.q-btn/.q-select/.q-field*` selectors — `global_css_architecture_audit.md`
- [ ] **`web/src/styles/logs/detail-table.scss:13`** — `.q-icon` rule dead — `global_css_architecture_audit.md`
- [ ] **`web/src/styles/logs/function-selector.scss:43-61`** — `.q-btn__content .q-icon` selector — `global_css_architecture_audit.md`

`.OIcon` selectors (PascalCase as class) — OIcon does not emit a `.OIcon` class; these are renamed-but-still-wrong:
- [ ] **`web/src/views/HomeView.vue`** scoped `.OIcon { font-size: 18px; animation: bounce ... }` — dead — `home_audit.md S4`
- [ ] **`web/src/plugins/logs/IndexList.vue:1978`** — `.OIcon { margin-right: 4px; ... }` — `logs_audit.md`
- [ ] **`web/src/components/ingestion/Recommended.vue:273`** + `Custom.vue:245` + `logs/Index.vue:286` — `.OIcon > img` (OIcon renders SVG, not `<img>`) — `ingestion_audit.md`
- [ ] **`web/src/views/RUM/AppSessions.vue:755-826`** + `SearchBar.vue:343-468` — `.OIcon` in SCSS — `rum_sessions_audit.md`
- [ ] **`web/src/plugins/traces/IndexList.vue:714, 794`** — `.OIcon { ... }` — `traces_audit.md`
- [ ] **`web/src/plugins/metrics/Index.vue:635-652`** — `.OIcon { font-size: ... }` (won't size SVG) — `metrics_audit.md`

---

## 10. OBadge `icon` Prop Rendering Font Glyph

Per `o_library_audit.md §6`, `OBadge.icon` currently renders via `<span class="material-icons-outlined">{{ icon }}</span>`, conflicting with the offline SVG `OIcon` registry. Each usage should switch to the default slot with `<OIcon>`.

- [ ] **`web/src/lib/core/Badge/OBadge.vue:149-154`** — Fix at the library level: change `icon` rendering to use OIcon registry — `o_library_audit.md #6`
  **Solution:**
  ```diff
  - <span class="material-icons-outlined">{{ icon }}</span>
  + <OIcon :name="icon" :size="size === 'sm' ? 'xs' : 'sm'" />
  ```
  Update prop type `icon: string` → `icon: IconName`.

- [x] **`web/src/enterprise/components/billings/proPlan.vue:94,109`** — `<OBadge variant="success-soft" icon="check_circle" ...>` — switch to default slot + OIcon — `billing_audit.md #2, #22`
  **Solution:**
  ```diff
  - <OBadge variant="success-soft" icon="check_circle" class="tw:px-3 tw:py-2">
  + <OBadge variant="success-soft" class="tw:px-3 tw:py-2">
  +   <OIcon name="check-circle" size="xs" class="tw:mr-1" />
  +   Managed via AWS Marketplace
  + </OBadge>
  ```

- [x] **`web/src/components/alerts/ImportSemanticGroups.vue:212`** + **`ImportSemanticGroupsDrawer.vue:193`** — `icon="check_circle"` — same fix — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/pipelines/BackfillJobDetails.vue:183`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`
- [x] **`web/src/components/rum/common/performance/ViewPerformanceMetrics.vue:110`** — `icon="check_circle"` — `css_class_level_audit.md §7.1`

## 11. OBadge Empty Label / Missing Body

- [x] **`web/src/components/rum/FrustrationBadge.vue:19-25`** — `<OBadge variant="..." size="sm" />` empty body — count never renders — original had `<q-badge :label="count">` — `rum_sessions_audit.md C3`
  **Solution:**
  ```diff
  - <OBadge
  -   :variant="severity"
  -   size="sm"
  - />
  + <OTooltip :content="tooltipText">
  +   <OBadge :variant="severity" size="sm">{{ count }}</OBadge>
  + </OTooltip>
  ```

- [x] **`web/src/components/rum/FrustrationEventBadge.vue:22-29`** — `<OBadge v-for="(type, index) in frustrationTypes" ... />` empty body — `rum_sessions_audit.md C4`
  **Solution:**
  ```diff
  - <OBadge v-for="(type, index) in frustrationTypes" :variant="getBadgeVariant(type)" />
  + <OTooltip v-for="(type, index) in frustrationTypes" :content="getBadgeTooltip(type)">
  +   <OBadge :variant="getBadgeVariant(type)">{{ getBadgeLabel(type) }}</OBadge>
  + </OTooltip>
  ```
  Also remove unused `OTooltip` import or wire as shown.

## 12. OBadge Variant Misuse

- [ ] **`web/src/components/settings/AiToolsets.vue:128-133`** — `KIND_VARIANTS = { skill: "primary-soft", generic: "default" }` — `mcp: "primary"` and `skill: "primary-soft"` both render blueish, losing the old blue-vs-purple distinction — `settings_audit.md §3` + `§508`
  **Solution (optional, design-dependent):**
  ```diff
  - skill: "primary-soft",
  + skill: "warning",     // or another non-blue variant; OR add a "purple" variant to OBadge.types.ts
  ```

- [x] **`web/src/components/alerts/IncidentDetailDrawer.vue:1015,1064,1120`** — `:color="'warning'|'negative'|'grey-5'"` Quasar tokens passed to OIcon (not OBadge but related to badge-adjacent state icons) — verify variant tokens — `alerts_audit.md M-4`

- [ ] **`web/src/views/Dashboards/viewPanel/ViewPanel.vue:75`** — `:variant="isVariablesChanged ? 'outline' : 'warning'"` on OButton — confirm `warning` variant exists (other places use `ghost-warning`) — `dashboards_audit.md §3`
  **Solution:**
  ```diff
  - :variant="isVariablesChanged ? 'outline' : 'warning'"
  + :variant="isVariablesChanged ? 'outline' : 'ghost-warning'"
  ```

## 13. `q-badge` Leftovers (Not Migrated)

No active `<q-badge>` runtime usage found after the migration. References live in:
- Spec files / stubs (see Section 17)
- Migration notes (`about_audit.md M-3`, `enrichment_tables_audit.md` migration table) — confirmed `q-badge → OBadge variant="..."` migration is correct

## 14. `q-chip` Leftovers (Not Migrated)

No active `<q-chip>` runtime usage found, but related cleanup:

- [ ] **`web/src/components/alerts/steps/Deduplication.vue:310,331,350`** — `.q-chip { ... }` SCSS selectors targeting OBadge/OChip elements that don't emit `.q-chip` class — `alerts_audit.md` CSS table
  **Solution:**
  ```diff
  - .q-chip { ... }
  + :deep(.o-badge__root) { ... }   // (or use OBadge :class prop)
  ```

- [ ] **`web/src/plugins/logs/patterns/PatternCard.vue:62-68`** — `q-chip` → `OBadge size="sm"` migration; verify `.wildcard-chip` SCSS no longer targets `.q-chip__content`. Re-scope to OBadge root — `logs_audit.md`
  **Solution:**
  ```diff
  - <q-chip>{{ wildcard }}</q-chip>     // (already migrated)
  + <OBadge size="sm" class="wildcard-chip">{{ wildcard }}</OBadge>
  ```
  Then update `.wildcard-chip` scoped SCSS to target OBadge root selectors instead of `.q-chip__content`.

- [ ] **`web/src/plugins/traces/TraceDetails.vue` (various)** — `q-chip dense square` (24px height, square corners) became `OBadge size="sm"` — OBadge defaults to pill shape; if square corners required: `class="tw:rounded-sm"` or extend OBadge with a `square` prop — `traces_audit.md CM3`
  **Solution:**
  ```diff
  - <OBadge size="sm">{{ value }}</OBadge>
  + <OBadge size="sm" class="tw:rounded-sm">{{ value }}</OBadge>
  ```

## 15. Ad-hoc Chip-like `tw:bg-[...]` Tags (Normalize to OBadge)

Not surfaced as discrete findings per audit; review during sweep for `tw:bg-[var(--o2-primary)] tw:text-white` chip patterns that should become `<OBadge variant="primary">`.

- [ ] **`web/src/components/dashboards/PanelEditor/PanelEditor.vue:563`** — `bg-primary text-white` on a chip-like element — convert to OBadge — `dashboards_audit.md` (also see Section 16)
- [ ] **`web/src/components/dashboards/addPanel/CustomHTMLEditor.vue:41`** — `bg-primary text-white` selected-state pill — see Section 16
- [ ] **`web/src/components/dashboards/addPanel/CustomMarkdownEditor.vue:44`** — same pattern — see Section 16

## 16. Selected-State Pill Highlighting Lost

`bg-primary text-white` (Quasar utility) was unprefixed `tw:` — silently dropped, so selected states show no highlight. Per `css_class_level_audit.md §1.4`.

- [ ] **`web/src/components/rum/ErrorsList.vue:31`** — `bg-primary text-white` (splitter drag-grip) — `error_tracking_audit.md` (orphan file)
  **Solution:**
  ```diff
  - <div class="bg-primary text-white">
  + <div class="tw:bg-[var(--o2-primary)] tw:text-white">
  ```

- [ ] **`web/src/components/rum/VideoPlayer.vue:52,62`** — `bg-primary` × 2 — `rum_sessions_audit.md`
- [ ] **`web/src/plugins/traces/TraceHeader.vue:37`** — `bg-primary` — `traces_audit.md`
- [ ] **`web/src/components/iam/users/AddUser.vue:200`** + `EditUser.vue` (+2 more) — `bg-primary` — `iam_audit.md`
- [ ] **`web/src/components/dashboards/PanelEditor/PanelEditor.vue:563`** — week/segmented control selected state — `dashboards_audit.md`
- [ ] **`web/src/components/dashboards/addPanel/CustomHTMLEditor.vue:41`** — `bg-primary text-white` — `dashboards_audit.md`
- [ ] **`web/src/components/dashboards/addPanel/CustomMarkdownEditor.vue:44`** — same — `dashboards_audit.md`
- [ ] **`web/src/components/actionScripts/FileItem.vue:5`** — `:class="{ 'bg-primary text-white': active }"` — file-tree selection lost color — `action_scripts_audit.md #8`
  **Solution:**
  ```diff
  - :class="{ 'bg-primary text-white': active }"
  + :class="{ 'tw:bg-[var(--o2-primary)] tw:text-white': active }"
  ```

- [ ] **`web/src/components/functions/StreamRouting.vue:2`** — `bg-white` (no `tw:` prefix) — `functions_audit.md` / `css_class_level_audit.md §1.4`
- [ ] **`web/src/components/iam/roles/PermissionsTable.vue:60`** — `bg-white` — `iam_audit.md` / `css_class_level_audit.md §1.4`
- [ ] **`web/src/components/settings/DomainManagement.vue:244`** — `bg-blue-1` (Quasar palette) — `css_class_level_audit.md §1.4`
  **Solution:**
  ```diff
  - <span class="bg-blue-1 text-blue-8">
  + <span class="tw:bg-blue-50 tw:text-blue-800">
  ```

## 17. Status Badge Color Regressions

State semantics (positive/negative/warning) lost when Quasar palette tokens were not migrated to OBadge variants or `tw:text-[var(--o2-*)]`.

- [ ] **`web/src/components/rum/ErrorDetail.vue:34`** — `text-red-6` (Quasar palette) — `error_tracking_audit.md`
  **Solution:**
  ```diff
  - <span class="text-red-6">
  + <span class="tw:text-red-600">
  ```

- [ ] **`web/src/components/rum/errorTracking/view/ErrorHeader.vue:57`** — `text-red-6` — `error_tracking_audit.md`
- [ ] **`web/src/components/rum/errorTracking/view/ErrorEventDescription.vue:27,39`** — `text-primary` (lost) — `error_tracking_audit.md`
- [ ] **`web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:153,160,276,332,387,439`** (6) + `AnomalyAlerting.vue:127` — `text-red-8` Quasar palette unstyled — error labels invisible — `anomaly_detection_audit.md #5`
  **Solution:**
  ```diff
  - <span class="text-red-8">
  + <span class="tw:text-red-700">
  ```

- [ ] **`web/src/components/alerts/steps/AlertSettings.vue:83,136,196,254,317`** (5) — `text-red-8` — `alerts_audit.md class-level §1`
- [ ] **`web/src/components/actionScripts/ScriptToolbar.vue:46`** — `text-red-5` / `text-red-7` Quasar palette — validation icon loses red color — `action_scripts_audit.md #6`
  **Solution:**
  ```diff
  - class="... text-red-5 ..."
  + class="... tw:text-red-500 ..."
  - class="... text-red-7 ..."
  + class="... tw:text-red-700 ..."
  ```

- [ ] **`web/src/components/PendingSubscriptionWarning.vue:23`** — `text-red` Quasar class + adjacent OIcon without color — washed-out warning — `billing_audit.md §20`
  **Solution:**
  ```diff
  - <OIcon name="warning" />
  - <span class="text-red">Warning:</span>
  + <OIcon name="warning" class="tw:text-[var(--o2-warning)]" />
  + <span class="tw:text-red-500">Warning:</span>
  ```

- [ ] **`web/src/components/settings/License.vue:55,201`** — `text-green-6` Quasar palette — `css_class_level_audit.md §1.3`
- [ ] **`web/src/plugins/traces/TraceTree.vue:220,281`** — `text-red-6` Quasar palette — `css_class_level_audit.md §1.3`
- [ ] **`web/src/components/pipelines/EditBackfillJobDialog.vue:33,46,110`** — `text-red-600`, `text-orange-800` (raw v3 without `tw:` prefix) — `css_class_level_audit.md §1.3`
- [ ] **`web/src/components/pipelines/CreateBackfillJobDialog.vue:48,62`** — `text-red-600` (raw v3) — `css_class_level_audit.md §1.3`

Plus 48 instances of `text-blue-500 hover:text-blue-600` link colors across `web/src/components/ingestion/**` per `css_class_level_audit.md §1.3` — silently dropped, ingestion doc links unstyled:
- [ ] **`web/src/components/ingestion/servers/{IIS,Nginx,Apache}.vue:33`** + many more
  **Solution:**
  ```diff
  - class="text-blue-500 hover:text-blue-600"
  + class="tw:text-blue-500 tw:hover:text-blue-600"
  ```

## 18. OBadge / OBadge Slot API Mismatches

- [ ] **`web/src/enterprise/components/billings/proPlan.vue:30` + `enterprisePlan.vue:31`** — `<OBadge ... style="border-radius: 0px">` overrides the design-system pill shape — `billing_audit.md §18`
  **Solution:**
  ```diff
  - <OBadge variant="primary-soft" class="..." style="border-radius: 0px">
  + <OBadge variant="primary-soft" class="...">
  ```

- [ ] **`web/src/lib/core/Badge/OBadge.vue:24-26`** — `count: 0` always renders the `0` chip (q-badge hid empty counts). Confirm intent or add `hideZeroCount` flag — `o_library_audit.md #7`

- [ ] **`web/src/lib/core/Badge/OBadge.vue:138`** — `:tabindex="clickable && !disabled ? 0 : undefined"` on a native `<button>` is redundant (button is already tabbable) — `o_library_audit.md`

---

## Pages Affected (cross-reference)

| Page | Icon issues | Chip/Badge issues |
|---|---|---|
| Alerts | 4 (`name="tw:block"` + `:color` props + tooltip pattern + check_circle) | 1 (`.q-chip` SCSS) |
| Anomaly Detection | 1 (`text-red-8` color) | 1 (variant validation) |
| Billing | 4 (proPlan/enterprisePlan empty/wrong names, `block`→`tw:block`) | 4 (OBadge `icon=check_circle`, border-radius:0, variant) |
| Cipher Keys | 0 | 0 |
| Common Components | 1 (BaseImport tooltip pattern via OFile slots) | 0 |
| Correlation / AI | 1 (CrossLinkDialog OSelect-related) | 0 |
| Dashboards | 2 (PanelEditor.bg-primary, sed `_` → `-` notes) | 1 (variant=`warning` vs `ghost-warning`) |
| Enrichment Tables | 2 (`:color` prop, tooltip pattern, `check_circle` migration) | 1 (status badge color) |
| Error Tracking | 3 (`text-red-6`, decorative aria-hidden, OSplitter-affected status icons) | 1 (`bg-primary text-white` highlighting) |
| Functions | 3 (5 tooltip siblings, `:color` prop, `tw-mt-1` typo) | 0 |
| Home (HomeView/O2AIChat) | 4 (orphan tooltip TypeError, `:color` dropped, `radio-button-unchecked` missing, M2 a11y) | 0 |
| IAM | 1 (`name="tw:block"` in OrgManagement) | 1 (OTooltip in OBadge) |
| Ingestion | 1 (search OIcon `aria-hidden`) | 0 |
| Layout | 0 | 0 |
| Login | 0 | 0 |
| Logs | 1 (`q-icon` snake→kebab verify; `.OIcon` selector) | 1 (`q-chip` → `OBadge size="sm"` + `.wildcard-chip`) |
| Metrics | 2 (`bar_chart`/`pin` not in registry, tooltip anchoring) | 0 |
| O-Library | 7 (OPagination, OTabs, OTab, OTimelineItem, OCollapsible, OBadge font-icon, count=0) | 2 (OBadge default-slot, count=0) |
| Pipelines | 3 (`io - type` typo, `:color` props × 4 in PipelineHistory, CreateBackfillJobDialog) | 0 |
| Query Editor | 1 (OTooltip sibling pattern) | 0 |
| Reports | 1 (decorative info icons missing aria-hidden + tooltip sibling) | 0 |
| RUM Performance | 4 (`check_circle` registry miss, `:color` props, `material-symbols-outlined` leftover, `.OIcon` selector) | 0 |
| RUM Sessions | 2 (`.OIcon` selectors in scoped SCSS, video player a11y) | 2 (FrustrationBadge / FrustrationEventBadge empty body) |
| Settings | 5 (`name="tw:block"`, License `check_circle` + `size="18px"`, settings tab snake_case names) | 1 (`skill: primary-soft` indistinguishable from mcp `primary`) |
| Streams | 0 | 0 |
| Traces | 4 (icon name verifications, copy-icon a11y, ServiceGraphEdgeSidePanel `arrow_upward` × 3, toast color) | 1 (`q-chip square` → OBadge needs `tw:rounded-sm`) |
| CSS class-level | Cross-cuts all of the above with file:line totals | Cross-cuts |

## Recommended Sweep Order

### P0 — visible regressions
- [x] Fix all `name="tw:block"` sed-regression icon names (3 files: AlertHistory, OrganizationManagement, SortByBtnGrp)
- [x] Fix all underscored `OIcon name="check_circle"` (registry mismatch — icons render blank) — see Section 1 (~10 files)
- [x] Fix OBadge empty labels in `FrustrationBadge.vue` + `FrustrationEventBadge.vue` (count never renders)
- [x] Fix `OIcon name=""` (empty string) in `proPlan.vue:65` + `enterprisePlan.vue:66`
- [x] Fix `name="bar_chart"`/`"pin"` in `MetricLegends.vue` (icons missing in metric legend table)
- [x] Fix `arrow_upward`/`arrow_downward` in `ServiceGraphEdgeSidePanel.vue` (3 occurrences)
- [x] Add `radio-button-unchecked` to `OIcon.icons.ts` (Auto Navigation toggle off-state); also added `radio-button-checked`, `touch-app`, `network-check`, `cloud-download`, `call-made`, `call-received`, `inbox`, `star-rate`

### P1 — silent no-ops
- [x] Remove all `OIcon :color` props (apply `class="tw:text-[var(--o2-*)]"` directly on `<OIcon>` via attribute fallthrough; **no wrapper span needed**) — done across AddAlert, AlertHistory, AlertHistoryDrawer, AlertHistorySummary, CreateBackfillJobDialog, PipelineHistory, ServiceIdentitySetup, AddRegexPattern, ResourceDetailDrawer, EventDetailDrawerContent, MetricCard, useEventFormatters, TraceEvaluationsView, O2AIChat, IncidentDetailDrawer, AddEnrichmentTable, plugins/traces/SearchBar, plugins/logs/SearchBar, ImportSemanticGroups (variant=success), proPlan/enterprisePlan (class on OIcon)
- [x] Normalize all `OIcon :size="18px"` to enum values (`License.vue:285,294` → `sm`; ServiceGraphEdgeSidePanel `size="10px"` → `xs`)
- [ ] Wrap all OIcon+OTooltip sibling patterns (~30 occurrences across alerts, anomaly, common, enrichment, functions, home, metrics, query-editor, reports)
- [ ] Add `tw:` prefix to all `text-blue-500 hover:text-blue-600` ingestion doc links (48 instances)
- [ ] Add `tw:` prefix to all `bg-primary text-white` selected-state pills (8 occurrences)

### P2 — cleanup + API alignment
- [ ] Migrate all OBadge `icon=...` props to default-slot `<OIcon>` (proPlan, enterprisePlan, ImportSemanticGroups × 2, BackfillJobDetails, ViewPerformanceMetrics)
- [ ] Replace all `material-icons-outlined` / `material-symbols-outlined` ligature classes in `web/src/lib/**` with OIcon registry usage (OPagination, OTabs, OTab, OTimelineItem, OCollapsible, OBadge)
- [ ] Normalize ad-hoc chip-like `tw:bg-[...]` badges to OBadge
- [ ] Add `aria-hidden="true"` to decorative icons next to labels (About, ingestion search, reports info-tooltips, traces copy-icon)
- [ ] Restore lost status semantics (positive/negative/warning) on badges/pills — `text-red-{5,6,7,8}` Quasar palette → `tw:text-red-{500,600,700,800}` (16 occurrences); `text-green-6` → `tw:text-green-600` (2 occurrences); `text-primary` → `tw:text-[var(--o2-primary)]` (27 occurrences)
- [ ] Remove `border-radius: 0` inline override from OBadge instances (proPlan, enterprisePlan)
- [ ] Drop dead `material-symbols-outlined` classes from OIcon call-sites (e.g. `MetricCard.vue` info icon)
- [ ] Drop dead `.OIcon { ... }` PascalCase selectors in scoped SCSS (HomeView, IndexList, ingestion pages, AppSessions, traces IndexList)

### P3 — library-level fixes
- [ ] Fix `OBadge.icon` to render via OIcon registry instead of Material font (`web/src/lib/core/Badge/OBadge.vue:149-154`) — also update prop type `icon: string` → `icon: IconName`
- [x] Fix `OCollapsible.icon` (same pattern: `web/src/lib/core/Collapsible/OCollapsible.vue:116`)
- [x] Fix `OTabs.vue:163,192` + `OTab.vue:113` to render fallback icons via OIcon registry
- [x] Fix `OPagination.vue:70,86,123,139` to use OIcon (`skip-previous`, `skip-next`, etc.) instead of `material-icons` ligature
- [x] Fix `OTimelineItem.vue:42` material-icons → OIcon
- [ ] *(Optional)* Consider adding a typed `tone` prop to OIcon as syntactic sugar for the `tw:text-[var(--o2-tone)]` class. Not needed — current attribute-fallthrough approach (`class="tw:text-..."`) works cleanly and is the canonical fix.
- [x] Add missing icons to OIcon registry: `radio-button-unchecked`, `card-membership`, `domain`, `person-pin-circle`, `add-outlined` (if outlined add icon desired), `check-circle-outline` (if used distinctly from `check-circle`), plus any custom dashboard route-key icons (`before_panels`, `invoice_history`)
- [ ] Sanitize `OBadge` `count: 0` behaviour (q-badge hid empty counts; current OBadge renders the `0` chip — confirm intent or add `hideZeroCount` flag)
- [ ] Drop redundant `:tabindex="0"` on native `<button>` in clickable OBadge (OBadge.vue:138)
- [ ] Derive `<OIcon size>` inside OButton from parent button size (OButton.vue:292,296 — currently forces `sm` regardless of button size, looks under-sized in `lg`/`icon-lg`)
