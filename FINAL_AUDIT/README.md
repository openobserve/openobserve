# FINAL AUDIT — Quasar Framework Removal

This folder contains the comprehensive audit of OpenObserve's UI codebase after the **Quasar Framework removal** refactor (branch `feat/ux-revamp-main` vs `main`). Quasar was fully removed from `package.json` and `node_modules`. Many Quasar components, utility classes, CSS variables, directives, and theme hooks were replaced — some incompletely. This audit catalogs every regression by page and by class.

- **30 audit documents**, ~17,500 lines total
- ~1,554 source files changed between `main` and current HEAD
- Targeted at engineers who will land the cleanup PRs

## Total problematic class instances catalogued (project-wide)

| Category | Count |
|---|---|
| Bare Quasar utility classes (silent no-ops) | 432 |
| Tailwind v4 misuse (`tw-*`, `hover:tw:`, invalid tokens, etc.) | 348 |
| `var(--q-*)` CSS variables | 291 |
| `:deep(.q-*)` selectors | 164 |
| `.body--dark` selectors (dead) | 148 |
| Bare `.q-*` SCSS selectors in styles/ | 1,162 |
| Quasar SCSS variables (`$primary`, `$dark-page`, etc.) | 94 |
| `v-close-popup` directive (inert) | 12 |
| OIcon underscored names | 20 (+ many computed) |
| Dead `:color` props on OIcon | 37 |
| `::v-deep` deprecated combinator | 5 |
| **Total** | **~2,890** |

Source of truth: [`css_class_level_audit.md`](./css_class_level_audit.md) (1,037 lines).

## Top Offender Files (most issues)

| File | Issue Count |
|---|---|
| `web/src/styles/app.scss` | 200 |
| `web/src/styles/logs/logs-page.scss` | 110 |
| `web/src/components/alerts/AddAlert.vue` | 63 |
| `web/src/components/alerts/IncidentDetailDrawer.vue` | 58 |
| `web/src/styles/logs/search-result.scss` | 41 |
| `web/src/plugins/traces/TraceDetails.vue` | 40 |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue` | 36 |
| `web/src/styles/schema.scss` | 35 |
| `web/src/components/pipelines/BackfillJobDetails.vue` | 31 |
| `web/src/plugins/metrics/MetricList.vue` | 30 |

## Three-Layer CSS Architecture (the standard this audit measures against)

1. **Global layer** — `web/src/styles/app.scss` (resets, theme tokens, base typography). Currently bloated (2,316 lines incl. ~360 lines of component-specific `.default-index-menu` skin).
2. **Component-level layer** — shared partials under `web/src/styles/` (`logs/*.scss`, `schema.scss`, etc.) and `web/src/lib/core/*` co-located styles. Mostly dead Quasar selectors that need pruning.
3. **File-level layer** — `<style scoped>` in each `.vue`. Many files keep `:deep(.q-*)` selectors that no longer match anything.

Violations are tagged in each audit's `## Class-Level Styling Audit` section with a **Layer** column.

## How to use the checkboxes

Every actionable item below is a GitHub-task-list checkbox (`- [ ]`). As you fix something, change to `- [x]`. GitHub will then show a progress bar at the top of the file and per-section. Group checkboxes by PR scope when sweeping (e.g. "fix all OSplitter inversions in one PR").

## Page Audits (Table of Contents)

Tick the page off only when **all** of its Critical + Logical + Class-Level findings are landed.

### Core observability pages

- [ ] **Logs (search)** — [logs_audit.md](./logs_audit.md) — `GroupedFieldListPagination` undefined component; `tw-` dash prefix all over PatternCard/ChunkedContent; `tw:flex-col` flipped horizontal toolbars vertical; 4 spec files with `plugins: [quasar.],` syntax error
- [ ] **Metrics** — [metrics_audit.md](./metrics_audit.md) — `MetricList.vue:513` returns undef `quasar`; `MetricSelector.vue:72` deleted `filteredMetrics`; OSelect using `use-input`/`@filter` (Quasar-only) silently no-op; `bar_chart`/`pin` icons not in registry
- [ ] **Traces** — [traces_audit.md](./traces_audit.md) — `Index.vue:19` Tailwind arbitrary value with spaces drops the height; 13+ specs `import * as quasar from "quasar"`; SearchBar duplicate `tw:flex tw:flex-col` flipping toolbar
- [ ] **Dashboards** — [dashboards_audit.md](./dashboards_audit.md) — `viewPanel/ViewPanel.vue:890` `"warning": "warning"` literal; spec imports removed `exportFile from "quasar"`; 41 dead `:deep(.q-*)` selectors
- [ ] **Alerts** — [alerts_audit.md](./alerts_audit.md) — `name="tw:block"` from sed bug; 30 occurrences of `tw-` dash prefix in IncidentDetailDrawer; broken `document.querySelector('.q-dialog, .q-menu')` Escape guard
- [ ] **Pipelines** — [pipelines_audit.md](./pipelines_audit.md) — `CustomNode.vue` icon expression typo `io - type` (subtract two undef); `PipelineHistory.vue` `formatDate` infinite recursion; writes to `computed` ref clearing selection
- [ ] **Streams** — [streams_audit.md](./streams_audit.md) — `StreamFieldInputs.vue:119-138` Add/Delete buttons lost `@click`; all specs import the no-op `installQuasar` shim; `<q-form>` → `<div>` killed Enter-key submit on schema
- [ ] **Functions (VRL)** — [functions_audit.md](./functions_audit.md) — `AssociatedStreamFunction.vue:156` trash-icon lost `@click`; `FunctionsToolbar` back button became `<div>` keeping Quasar props; `v-close-popup` still on Fullscreen button
- [ ] **Ingestion** — [ingestion_audit.md](./ingestion_audit.md) — `Ingestion.vue:210` Tailwind arbitrary value with spaces breaks shell height; `KubernetesConfig` malformed `horizontalalign` attr, `q:mt-md` hybrid typo, `tw:pb-lg` invalid token; 89 specs reference `quasar`
- [ ] **Action Scripts** — [action_scripts_audit.md](./action_scripts_audit.md) — Service-account OSelect unusable (string options vs object schema); `submitForm`/`showForm` referenced but never declared in `ActionScripts.vue`; `tw:full-width`, `tw:mr-md`, `hover:tw:` errors

### RUM (Real User Monitoring)

- [ ] **Sessions** — [rum_sessions_audit.md](./rum_sessions_audit.md) — OSplitter direction inverted (Quasar `vertical` ≠ OSplitter `horizontal`); `SessionViewer.vue:18` `row` → `tw:flex` lost wrap; FrustrationBadge empty (lost `:label="count"`); VideoPlayer speed selector broken (number vs object)
- [ ] **Error Tracking** — [error_tracking_audit.md](./error_tracking_audit.md) — Same OSplitter inversion in `AppErrors.vue:67`; all specs broken (deleted `installQuasar` helper signature); undefined `--q-primary-rgb` parses to invalid `rgba()`
- [ ] **Performance** — [rum_performance_audit.md](./rum_performance_audit.md) — `MetricCard.vue:146` `"check_circle"` not in OIcon registry; OIcon `:color` ignored — all status indicators identical; `WebVitalsDashboard.vue:27` Quasar `bg-indigo-7/2` palette without `tw:` prefix

### IAM / Org / Settings / Billing

- [ ] **IAM / Users** — [iam_audit.md](./iam_audit.md) — `ListOrganizations.vue:378` `props.row` undef → ReferenceError; `UpdateRole` calls `.validate()` on a `ref(null)`; double `v-model` on dialogs; `name="tw:block"` icon
- [ ] **Settings** — [settings_audit.md](./settings_audit.md) — `AiToolsets.vue` 6 missing imports — page won't mount; `OrganizationManagement.vue:90` `name="tw:block"`; `:disable` instead of `:disabled` on Nodes inputs; `<OInput type="date">` falls back to text
- [ ] **Billing** — [billing_audit.md](./billing_audit.md) — `enterprisePlan.vue:80` `block` prop typo'd as `tw:block`; `proPlan.vue:94,109` OBadge icon `check_circle` not in registry; `AwsMarketplaceSetup.vue:19` `tw-px-3` dash prefix; dark mode broken in TrialPeriod/LicensePeriod/UsageReportBanner
- [ ] **Reports** — [reports_audit.md](./reports_audit.md) — `ODate` ↔ `convertDateToTimestamp` ISO/DD-MM-YYYY format mismatch silently corrupts scheduled-report timestamps; `timezoneOptions` bare strings instead of `{label,value}`; tooltip text "inline" → "tw:inline"
- [ ] **Cipher Keys** — [cipher_keys_audit.md](./cipher_keys_audit.md) — Akeyless validators defined but no caller — save with all fields blank; `cipherKeyTestFixtures.ts:20` imports removed `Quasar`; `:disable=` on OInput

### App shell + remaining surfaces

- [ ] **Layout / Shell** — [layout_audit.md](./layout_audit.md) — ~580 specs still `import { installQuasar }`; theme regression — only `<html>.dark` toggled, ~189 `body--dark` selectors stale; drawer collapse + mobile responsive lost; broken `:global` and `:deep` in scoped/unscoped style blocks
- [ ] **Home** — [home_audit.md](./home_audit.md) — `O2AIChat.vue:426-437` orphan tooltip throws TypeError; 4 specs fail at import time; OIcon `:color` ignored; `radio-button-unchecked` not in registry
- [ ] **About** — [about_audit.md](./about_audit.md) — `tw:bg-opacity-10` deprecated in v4 → 3 panels render fully opaque; `tw:flex-col tw:flex-row` contradictory; dead `body--dark` zebra striping; FeatureComparisonTable spec fully stale
- [ ] **Login / Auth** — [login_audit.md](./login_audit.md) — Enter-to-submit broken (`<q-form>` deleted, no replacement); wrong toast variant `"loading"` for error path → never-dismissing spinner; `:rules` validation removed from GetStarted
- [ ] **Anomaly Detection** — [anomaly_detection_audit.md](./anomaly_detection_audit.md) — `AnomalyAlerting.vue:76` `visibleChipCount` referenced but never declared — destination chips never render; OSelect with Quasar-only `use-input`/`@filter`; raw `string[]` to OSelect requiring `{label,value}`
- [ ] **Enrichment Tables** — [enrichment_tables_audit.md](./enrichment_tables_audit.md) — Success toast condition checked AFTER `formData` reset → wrong message always shows; `v-slot:hint` on OInput silently dropped; `file: ""` initial value violates OFile types
- [ ] **Cross-Linking / AI / Correlation** — [correlation_ai_audit.md](./correlation_ai_audit.md) — CrossLinkDialog OSelect typing/clear dead (Quasar-only API); 50+ `var(--q-*)` in O2AIChat; 7 dead `:deep(.q-field*)` blocks; `body.body--dark` dead in 4 files
- [ ] **Query Editor / Plan** — [query_editor_audit.md](./query_editor_audit.md) — `RunningQueries.spec.ts:19` and `RunningQueriesList.spec.ts:4` still `import { QTable } from "quasar"`; `--q-primary-rgb` used 7+ times but never defined; dead `body--dark` in scoped styles

### Library + global styles

- [ ] **Common Components** — [common_components_audit.md](./common_components_audit.md) — `DateTime.vue:95` comparing tab string to literal `'tw:relative'` (bulk-replace bug); 4 unscoped `<style>` blocks leak class names globally; 9 broken `hover:tw:` variants; spec files testing the wrong code paths (`QTable`/`QBtn` stubs)
- [ ] **O-Library Core** — [o_library_audit.md](./o_library_audit.md) — Stale `--q-primary` in OTable tree connectors; 3 specs in `core/` call `installQuasar`; OButton has no spinner for `loading`; OBadge/OCollapsible still use Material font ligature instead of OIcon registry
- [ ] **Global CSS Architecture** — [global_css_architecture_audit.md](./global_css_architecture_audit.md) — Dark-mode `--o2-*` block (170 lines) silently dead — gated on `body--dark` which is no longer applied anywhere; "Nunito Sans" `@font-face` deleted but 5 files still reference it; `.o2-input` rules deleted but 15+ files still use the class
- [ ] **CSS Class-Level Registry** — [css_class_level_audit.md](./css_class_level_audit.md) — Project-wide 1,037-line catalog with file:line for every problematic class. Use as the single source of truth when sweeping.
- [ ] **Icons / Chips / Badges** — [icons.md](./icons.md) — Cross-page consolidation of every OIcon/OBadge/q-icon/q-chip/q-badge finding with solution diffs. 722 lines, 18 sections, P0→P3 sweep order.

## Cross-Cutting Patterns (apply once, fixes many)

### Pattern A — OSplitter orientation inversion

Quasar `<q-splitter vertical>` = vertical divider (left/right). OSplitter `horizontal=true` = horizontal divider (top/bottom). These mean OPPOSITE things.

- **Bad migration**: `<q-splitter vertical>` → `<OSplitter :horizontal="true">` (now wrong)
- **Right fix**: `<OSplitter :horizontal="false">` or omit the prop entirely (default is vertical divider)
- **Found in**: `AppSessions.vue:67`, `SessionsList.vue:20-25`, `AppErrors.vue:67`

### Pattern B — Tailwind v4 with `prefix(tw)`

Project uses Tailwind v4 with `prefix(tw)`. The right form is:
- `tw:p-4`, `tw:bg-gray-100`
- **Variants come AFTER the prefix**: `tw:hover:bg-gray-200`, `tw:dark:text-white`, `tw:md:flex-row`

Common wrong forms (silent no-ops):
- `hover:tw:bg-gray-200` (wrong order)
- `tw-p-4` (dash form is Tailwind v3 syntax)
- `tw:pb-lg`, `tw:mt-md`, `tw:mr-md`, `tw:full-width` (invalid tokens — these were Quasar spacing names accidentally `tw:`-prefixed)
- `tw:bg-blue-400 tw:bg-opacity-10` (v3) → `tw:bg-blue-400/10` (v4)
- `tw:bg-red-5`, `tw:bg-indigo-7` (Quasar palette steps not in Tailwind)

### Pattern C — OIcon API mismatches

- Names must be **kebab-case** (`check-circle`, NOT `check_circle`). Registry: `web/src/lib/core/Icon/OIcon.icons.ts`
- OIcon has **no `color` prop**. Wrap in a span instead: `<span class="tw:text-[var(--o2-negative)]"><OIcon name="..." /></span>`
- `name=""` (empty string) is invalid per the IconName union — must always pass a real name
- `size` accepts `xs|sm|md|lg|xl`, NOT `"18px"` or arbitrary pixel values

### Pattern D — OSelect Quasar-only props/slots silently no-op

`OSelect` doesn't support: `use-input`, `fill-input`, `hide-selected`, `input-debounce`, `@filter`, `v-slot:option`, `v-slot:no-option`, `v-slot:hint`, `v-slot:prepend`, `v-slot:append`, `updateInputValue()`, `hidePopup()`.

- Search/filter: use `searchable :options="..."` and filter reactively (computed) on the parent
- Options must be `{ label, value }` objects — bare string arrays render with empty labels
- Custom option rendering: not supported — pre-format labels or filter options reactively
- `labelKey` / `valueKey` props let you point to other field names

### Pattern E — Quasar dark-mode signal removal

The app used to mark `<body class="body--dark body">`. Now only `<html class="dark">` is set (`utils/theme.ts:100`). **All `body.body--dark` / `.body--dark` selectors are dead** (~189 across 30+ files).

Fix:
- In scoped styles: `:deep(html.dark) &` or wrap the file's root in `:class="{ 'dark': isDark }"` and select against that
- In global SCSS: `html.dark` selector
- In JS (`convertLogData.ts:101`, `PredefinedThemes.vue:488`): check `document.documentElement.classList.contains('dark')` instead

### Pattern F — `--q-*` CSS variables undefined

Quasar used to inject `--q-primary`, `--q-negative`, `--q-text-color`, `--q-primary-rgb`, etc. into `:root`. These are gone. Replace with the `--o2-*` design tokens (`web/src/styles/_variables.scss`).

| Old Quasar var | New O2 token |
|---|---|
| `--q-primary` | `--o2-primary` |
| `--q-negative` | `--o2-negative` |
| `--q-positive` | `--o2-positive` |
| `--q-warning` | `--o2-warning` |
| `--q-text-color` / `--q-text-primary` | `--o2-text-primary` |
| `--q-background` / `--q-card-background` | `--o2-bg` / `--o2-card-bg` |
| `--q-border-color` | `--o2-border-color` |
| `--q-dark` | `--o2-dark` (define if missing) |
| `--q-primary-rgb` | Define equivalent in `_variables.scss` or use `color-mix(in srgb, var(--o2-primary) X%, transparent)` |

### Pattern G — Quasar→Tailwind utility cheatsheet

| Quasar | Tailwind v4 (`tw:` prefix) |
|---|---|
| `q-pa-xs/sm/md/lg/xl` | `tw:p-1/2/4/6/8` |
| `q-mt-* / mb-* / ml-* / mr-*` | `tw:mt-* / mb-* / ml-* / mr-*` (with 1/2/4/6/8 mapping) |
| `q-px-md` / `q-py-sm` | `tw:px-4` / `tw:py-2` |
| `q-gutter-sm/md/lg` | `tw:gap-2/4/6` |
| `row` | `tw:flex` |
| `column` | `tw:flex tw:flex-col` |
| `col` / `col-auto` | `tw:flex-1` / `tw:flex-none` |
| `items-center/start/end/stretch/baseline` | `tw:items-*` |
| `justify-center/between/start/end/around/evenly` | `tw:justify-*` |
| `no-wrap` / `wrap` | `tw:flex-nowrap` / `tw:flex-wrap` |
| `full-width` / `full-height` | `tw:w-full` / `tw:h-full` |
| `relative-position` | `tw:relative` |
| `absolute-*` / `fixed-*` | `tw:absolute` / `tw:fixed` |
| `cursor-pointer` (bare) | `tw:cursor-pointer` |
| `float-left/right` | `tw:float-left/right` |
| `text-bold` / `text-weight-bold` | `tw:font-bold` |
| `text-weight-medium` | `tw:font-medium` |
| `text-grey-1..10` | `tw:text-gray-100..900` |
| `text-red/green/blue/yellow-N` | `tw:text-red/green/blue/yellow-N00` |
| `text-primary` | `tw:text-[var(--o2-primary)]` |
| `text-positive/negative/warning/info` | `tw:text-[var(--o2-positive/negative/warning/info)]` |
| `bg-primary/secondary` | `tw:bg-[var(--o2-primary/secondary)]` |
| `bg-white/black/dark` | `tw:bg-white/black` / `tw:bg-[var(--o2-dark)]` |
| `bg-grey-N` | `tw:bg-gray-N00` |
| `text-h1..h6` / `text-subtitle1/2` | `tw:text-3xl/2xl/xl/lg/base/sm` |
| `text-italic` | `tw:italic` |
| `text-uppercase/capitalize` | `tw:uppercase` / `tw:capitalize` |
| `q-table__title` | (remove; use `tw:text-base tw:font-semibold`) |
| `q-w-md` / `q-h-md` etc. | (invalid in Tailwind; use specific sizes) |

## Test Suite Status

**~580 spec files** still import `installQuasar` from the no-op shim helper. **30+ spec files** still directly `import { QTable, QBtn, ... } from "quasar"` or `import * as quasar from "quasar"` — these will fail to resolve once Quasar is dropped from `node_modules` (which the audit already did via `npm prune`).

The team has a TODO at the top of `web/src/test/unit/helpers/install-quasar-plugin.ts` acknowledging the tests need a separate rewrite. **The build (`npm run build`) is unaffected** — tests are not bundled by Vite.

## Recommended Sweep Order (priority list)

### P0 — fix immediately (visible regressions or crashes)

- [ ] **OSplitter orientation inversion** — 3 files (`AppSessions.vue`, `SessionsList.vue`, `AppErrors.vue`)
- [ ] **Undefined identifiers in templates** — `tw:block` icon name, `props.row`, `addReportFormRef`, `submitForm`, `showForm`, `visibleChipCount`, `GroupedFieldListPagination`
- [ ] **AiToolsets.vue missing imports** — page won't mount
- [ ] **Reports date format corruption** — ODate ISO vs `convertDateToTimestamp` DD-MM-YYYY
- [ ] **PipelineHistory infinite recursion** — `formatDate` re-declared locally with same name
- [ ] **CustomNode icon expression `io - type`** — typo subtracting two undef
- [ ] **Mass `tw-*` dash-prefix fixes** — 158 instances across the project; biggest offenders BackfillJobDetails, PatternDetailsDialog, IncidentDetailDrawer
- [ ] **Mass `hover:tw:` order fixes** — 155 instances
- [ ] **`tw:` with Quasar spacing tokens** (21 + 56 palette steps) — invalid Tailwind, silent no-op
- [ ] **OIcon `_` → `-`** in all `name=` props
- [ ] **`tw:block` icon name sed regression** — `OrganizationManagement.vue:90`, `AlertHistory.vue:190`, and any other site
- [ ] **Tailwind arbitrary values with whitespace** — drop the whole utility silently: `Index.vue:19` (traces), `Ingestion.vue:210`, others
- [ ] **AssociatedStreamFunction trash icon `@click` missing**
- [ ] **StreamFieldInputs Add/Delete `@click` missing**
- [ ] **Login Enter-to-submit broken** (no `<form>` or `@keyup.enter`)

### P1 — code-level corrections (logic + spec)

- [ ] **OSelect Quasar-only props/slots replacement** (search, filter, option templates)
- [ ] **OIcon `:color` replacement** (wrap in colored span)
- [ ] **OBadge / OCollapsible icon migration** (use OIcon in default slot, not Material font ligature)
- [ ] **Toast variant fixes** (`variant: "error"` on error paths; `timeout: 0` for sticky loaders)
- [ ] **`v-close-popup` removal** (replace with `@click`)
- [ ] **Spec files** — drop `installQuasar`, drop `quasar` imports, swap `q-*` stubs for `O*`, swap `useQuasar` for `useToast`
- [ ] **OSelect options must be `{label,value}` objects** — fix bare string arrays (timezone, several other dropdowns)
- [ ] **`:disable` → `:disabled`** on all OInput / OToggle / OCheckbox sites
- [ ] **Double `v-model` on dialogs** — IAM `update-user-role`, `add-user`, `add-service-account`
- [ ] **OPagination prop trim** — drop Quasar-only props (`icon-first/last/prev/next`, `direction-links`, `rows-per-page-options`, etc.)
- [ ] **Tooltip nesting fix** — wrap OTooltip inside its trigger (`<span class="tw:inline-flex"><OIcon /><OTooltip /></span>`)

### P2 — CSS layer cleanup (no behavioral change)

- [ ] **Remove all bare `.q-*` selectors from `web/src/styles/`** (~350+ lines of dead CSS in `app.scss` / `logs/*.scss` / `schema.scss`)
- [ ] **Replace `var(--q-*)` references with `var(--o2-*)`** — 291 instances project-wide
- [ ] **Replace `body.body--dark` selectors with `html.dark`** — 148 instances
- [ ] **Remove dead `:deep(.q-*)` blocks** in component-scoped styles — 164 instances
- [ ] **Replace remaining Quasar SCSS variables** (`$primary`, `$dark-page`, `$grey-N`) with `--o2-*` tokens — 94 instances
- [ ] **Promote duplicated style blocks to component-level partials**:
  - [ ] Triplicated date-picker styles → `web/src/styles/forms/date-picker.scss`
  - [ ] `.search-field-select .q-field__control` (RunningQueries/RunningQueriesList/SummaryList) → component partial
  - [ ] `.ai-hover-btn` / `.ai-btn-active` duplicates → remove (canonical in `app.scss:2217-2255`)
  - [ ] `.ingestionPage` block (9 files) → `web/src/styles/ingestion/_shell.scss`
  - [ ] `.rotate-animation` keyframes (EnrichmentTableList + AddEnrichmentTable) → shared partial
  - [ ] `.q-table { &__top { … } }` block (all 5 RUM Performance dashboards) → component partial
  - [ ] Stat-tile blocks in `schema.vue` (4 copies) → `<SchemaStatTile>` SFC
  - [ ] NodeForm `bg-dark : bg-white` ternaries (6 dialogs) → partial
- [ ] **Convert long inline `style="..."`** to scoped classes (CreateReport.vue 36+, AnomalyDetectionConfig 20+, EditScript.vue 16+)
- [ ] **Three-layer architecture fixes**:
  - [ ] Move global `.default-index-menu` (360 lines) out of `app.scss` into a component partial
  - [ ] Move shared `.openobserve-logo` sizing out of inline styles into `web/src/styles/_header.scss`
  - [ ] Promote dark-mode rules from scoped blocks to a single source-of-truth using `html.dark`

### P3 — architectural debt

- [ ] **Migrate all SCSS `@import` to `@use`/`@forward`** (Sass 2 prep) — ~43 files; currently suppressed via `silenceDeprecations` in `vite.config.ts`
- [ ] **Remove orphan SCSS files** (`index-list.scss`, `assets/main.css`, `assets/inputs.scss`)
- [ ] **Remove dead "Nunito Sans" font references** (woff2 binaries never loaded)
- [ ] **Reconcile parallel token systems** (`--o2-*` legacy vs new `--color-*` lib tokens) — pick one canonical set
- [ ] **Define missing tokens** that are referenced: `--o2-theme-elements`, `--tile-bg`, `--q-primary-rgb`
- [ ] **Trim unused legacy Sass variables** in `_quasar-variables.scss` shim (~30 of 52 lines unused)
- [ ] **Migrate `<OInput type="date">`** to a real ODate-based component
- [ ] **Rewrite the 580+ spec files** now that test infrastructure is broken

## Build Status (current branch)

- [x] `npm run build` passes
- [x] Quasar fully removed from `package.json` and `node_modules` (verified via `npm prune`)
- [x] Sass deprecation warnings silenced via `silenceDeprecations` in `vite.config.ts`
- [x] `::v-deep` migrations done (Billing.vue, TraceDetailsSidebar.vue, AlertList.vue)
- [x] Invalid CSS variable names (`--sticky-tw:w-1/12-width`) fixed in `PromQLTableChart.vue`
- [ ] Tests broken — separate cleanup epic (per TODO in `install-quasar-plugin.ts`)

## How to use this folder

- For a specific page bug, open the corresponding `<page>_audit.md` and scan Critical Issues
- For a CSS sweep PR, open [`css_class_level_audit.md`](./css_class_level_audit.md) and filter by file
- For an architecture PR, open [`global_css_architecture_audit.md`](./global_css_architecture_audit.md)
- For library-level work, open [`o_library_audit.md`](./o_library_audit.md) and [`common_components_audit.md`](./common_components_audit.md)
- Each audit's `## Class-Level Styling Audit` section catalogs class issues with a **Layer** column (Global / Component / File) — use this to scope your PR to the right layer

## Audit Method

Each audit was produced by:
1. Identifying the page's source files (`web/src/views/`, `web/src/plugins/<page>/`, `web/src/components/<page>/`)
2. `git diff main..HEAD -- <path>` to surface every line changed by the Quasar removal
3. `git show main:<path>` to inspect originals when changes looked broken
4. `rg` (ripgrep) sweeps for Quasar leftover patterns (classes, vars, directives, selectors)
5. Cross-checks against the actual O-library API (`web/src/lib/core/`, `web/src/lib/forms/`) for prop/slot mismatches
6. Cross-checks against `OIcon.icons.ts` for icon-name validity
7. Verification against the project's Tailwind v4 + `prefix(tw)` config

All audits are **read-only** — no source files were modified during the audit pass. Solutions are concrete copy-pasteable diffs that an engineer can apply.
