# PRD: Synthetic Monitoring — Monitor Results, Runs, & Run Detail

## Problem Statement

The synthetic monitoring UI shows browser check results using hardcoded mock data with seeded random generators. Users cannot see real pass/fail results, response times, error patterns, or step-level execution details from their actual synthetic checks. Every view (Monitor Results overview, Runs table, Run Detail page) needs to be wired to live data from the `synthetics_results` log stream.

The data is already being ingested into the `synthetics_results` stream via the probe infrastructure. The frontend needs to query this stream using the existing `_search_stream` SSE API (`useLLMStreamQuery`) and present the results through the same UI patterns used by the rest of the platform (KPI cards, ECharts, OTable, etc.).

## Solution

Wire the three synthetic monitoring views (MonitorResults, MonitorRuns, RunDetail) to live data from the `synthetics_results` stream. Follow the project's existing patterns: a service + composable layer that queries via SSE streaming, typed schema/mapper modules that isolate components from raw field names, and a mock-data fallback until real data arrives.

The architecture uses the existing `useLLMStreamQuery` composable (which wraps `useStreamingSearch` for SSE) — no new data-fetching infrastructure is needed.

## User Stories

1. As a synthetic monitoring user, I want to see real KPI values (pass rate, p95 duration, failed runs, last run status) for my browser check, so that I can assess its health at a glance.
2. As a synthetic monitoring user, I want the KPI values to update when I change the time range, so that I can analyze different windows.
3. As a synthetic monitoring user, I want to see a Response Time chart with real p95 duration data over time, so that I can spot latency trends.
4. As a synthetic monitoring user, I want to see an Errors Over Time chart with real failure counts, so that I can identify when outages started.
5. As a synthetic monitoring user, I want the Status Timeline bar to show the proportion of passed vs failed runs with each run getting equal visual weight, so that the ratio is visually accurate regardless of timing.
6. As a synthetic monitoring user, I want to see Pass Rate breakdowns by browser, location, and device computed from real data, so that I can identify which environments are failing.
7. As a synthetic monitoring user, I want the browser/location/device filter dropdowns to show only values that actually appear in the data, so that I can filter meaningfully.
8. As a synthetic monitoring user, I want to see a Retry Rate KPI (percentage of runs with attempts > 1), so that I can assess flakiness at the run level.
9. As a synthetic monitoring user, I want to click a run row in the table and open a Run Detail drawer for that run, so that I can debug failures without leaving the overview page.
10. As a synthetic monitoring user, on the Run Detail page I want to see the run status, duration, browser, device, region, and timestamp in an info bar, so that I have context for the run.
11. As a synthetic monitoring user, I want to see the execution steps for a run with their action, name, duration, and pass/fail status, so that I can identify which step failed.
12. As a synthetic monitoring user, I want to expand individual steps to see screenshot previews, selector details, and action metadata, so that I can debug failures without leaving the page.
13. As a synthetic monitoring user, I want to see an error callout for failed runs with the error message and failed step label, so that I understand what went wrong.
14. As a synthetic monitoring user, I want to see a "no data" placeholder state before the first load completes, so that the page never flashes empty or broken.
15. As a synthetic monitoring user, I want the charts to fall back to mock data when no real data has loaded yet, so that the dashboard never shows an empty chart skeleton.

## Implementation Decisions

### Architecture

```
synthetics_results stream (log stream)
      │
      ▼
  _search_stream SSE API
      │
      ▼
  useLLMStreamQuery (existing composable — SSE streaming via web worker)
      │
      ▼
  useSyntheticResults (new orchestration composable)
      │
      ├──► syntheticResultsSchema.ts (pure SQL builders + typed mappers)
      │
      └──► MonitorResults.vue, MonitorRuns.vue, RunDetail.vue
```

### Data Schema Isolation

All stream field names and status values are defined in a single module (`syntheticResultsSchema.ts`). Components consume only typed UI models (`SyntheticKpi`, `SyntheticRun`, `SyntheticRunDetail`). If stream schema changes, only this module changes — the composable and components stay untouched.

Stream field mapping:
- `_timestamp` → ms epoch timestamps (used directly in SQL, divided by 1000 for display)
- `response_time_ms` → `durationMs` (displayed as `fmtDur()`)
- `engine` → `browserEngine` (capitalized at display time)
- Statuses normalized: `"passed"` → `RunStatus.passed`, `"failed"` → `RunStatus.failed`
- `attempts` field drives Retry Rate (attempts > 1 = retried)
- `execution_id` → `executionId` — disambiguates engine×device×location combos for the same logical run
- `last_attempt_steps` JSON uses snake_case keys (`step_id`, `duration_ms`, `screenshot_key`, `error`) — the `StepExecution` type field names match the raw stream data (no camelCase mapping)
- **Step status normalization**: `mapRunDetail()` normalizes step statuses via `.map()` — `"ok"`/`"passed"` → `"ok"`, everything else → `"fail"`. This matches `parseSteps()` behavior used by the drawer components. Without this normalization, the raw stream value `"failed"` never matches `ex.status === "fail"` in `buildSteps()`, causing all steps to render as passed.

### Composable: useSyntheticResults

Fires 4 parallel queries on `fetchAll()`:
1. **KPI aggregates**: `COUNT(*)`, `COUNT(*) FILTER (WHERE ...)`, `approx_percentile_cont(duration_ms, 0.95)`
2. **Last run**: `ORDER BY _timestamp DESC LIMIT 1`
3. **Histogram**: `histogram(_timestamp, 'interval')` with GROUP BY for time-series charts
4. **Runs table**: `SELECT _timestamp, status, duration_ms, ...` with `ORDER BY _timestamp DESC LIMIT 500`

Plus a single-run query on `fetchRun()`:
5. **Run detail**: `SELECT _timestamp, status, response_time_ms, ...` filtered by `synthetics_id` + `run_id` + `execution_id`

Each query is wrapped in a safe handler so individual query failures don't block others. The composable exposes `hasLoadedOnce` so components can show mock data before the first successful load.

### Run Detail Navigation

Each logical run produces multiple execution rows in the `synthetics_results` stream (one per engine×device×location combo). To disambiguate, the route uses three params:

- `:id` — monitor ID
- `:runId` — the logical run UUID
- `:executionId` — the specific execution row UUID

Route path: `synthetic/:id/results/run/:runId/:executionId`

The `executionId` is threaded from `MonitorRuns.vue` → `MonitorResults.vue` → `useSyntheticResults.fetchRun()` → `buildRunDetailSql()`.

The `buildRunsSql` query includes `execution_id` in its SELECT so the runs table can provide the correct execution ID when the user clicks a row.

### Run Detail Drawer (ODrawer)

RunDetail is embedded in an ODrawer that opens from the left side at **80% width**. This avoids a full-page navigation and keeps the MonitorResults context visible behind the dimmed backdrop.

**Drawer vs Route mode:**

- **Primary UX**: Clicking a run row opens the ODrawer on MonitorResults. The route page (`synthetic-run-detail`) is preserved for direct URL access.
- **Drawer mode**: RunDetail receives `drawerMode=true` + override props (`overrideMonitorId`, `overrideRunId`, `overrideExecutionId`) instead of reading route params. The `AppPageHeader` (with back button) is hidden in drawer mode — the ODrawer's built-in header and close button serve as the navigation boundary.
- **Route mode**: When accessed directly via the URL, RunDetail renders the full AppPageHeader with back button + title + status badge + action buttons.

**URL state tracking:**
- On drawer open, `?run=<runId>&exec=<executionId>` is written to the query params
- On drawer close, these params are cleared
- On page mount, if the query params are present, the drawer auto-opens (supports refresh and URL sharing)

**Implementation:**
- `ODrawer` from `@/lib/overlay/Drawer/ODrawer.vue` — `v-model:open`, `side="right"`, `width=80`
- `RunDetail` wrapped inside the drawer with `drawer-mode` prop set
- Status badge in `#header-right` slot, updated via `@update-status` emit from RunDetail

### Run Detail Header

**Route mode** — AppPageHeader with:
- **Title**: "Run Details" (no execution ID shown)
- **Title-trail**: Status badge (Passed/Failed/Error), URL badge (if present), timestamp label
- **Actions**: Open Playwright Trace button, Rerun button, prev/next navigation buttons

**Drawer mode** — ODrawer's built-in title bar:
- **Title**: "Run Details" (via `:title` prop)
- **Header-right slot**: Status badge only (updated via `@update-status` emit)

### Info Chips (RunDetail Summary Tab)

Six individual cards matching the KPI card pattern from MonitorRuns (`card-container`, `bg-[var(--o2-card-bg)]`, border). Each chip is a standalone card in a `grid grid-cols-5` layout:

1. **Duration** — `fmtDur(currentRun.duration)` (monospace)
2. **URL** — target URL from recorded steps, or "—" fallback. Icon: `link` when present.
3. **Browser** — Chromium/Firefox/WebKit with branded SVG icon (via `img:` prefix)
4. **Device** — computer/tablet/smartphone icon
5. **Location** — AWS region name with cloud provider SVG icon

### Error Status Handling

The `synthetics_results` stream returns distinct status values that drive different UI states:

| Status | Meaning | Badge | Steps Banner | Error Callout |
|--------|---------|-------|-------------|---------------|
| `"passed"` | All steps completed | Success (green check) | "Run passed — N/N steps completed" | Hidden |
| `"failed"` | Browser ran but a step failed | Error (red cancel) | "Run failed — {failedStepLabel}" | Shown with error type + stack trace |
| `"error"` | Infra failure (Lambda, credentials, etc.) | Error-soft (soft red error icon) | "Lambda execution failed — check the error details above" | Shown with error type + stack trace |

**Error callout styling** matches BrowserJourney.vue:
- Background: `var(--color-badge-error-soft-bg)`
- Border: `border-badge-error-ol-border/30`
- Icon/text: `var(--o2-status-error-text)` for heading, `text-badge-error-ol-text` for banner text
- Badge shows step number + action name (e.g. "Step 8: click failed") instead of just the step ID
- Body text shows the error summary (first line of the Playwright error) rather than the full multiline log
- "View full error & stack trace" uses OButton (variant `outline-destructive`, size `xs`) — expands to show the full Playwright call log with preserved formatting

**Steps section** is hidden (`v-if="steps.length > 0"`) when there are no steps to display — for `"error"` runs with empty `last_attempt_steps`, only the info chips + error callout render.

### Loading Skeletons

During data fetch (`synthetics.loading === true`), RunDetail shows OSkeleton placeholders instead of blank/zero values:

- **Info chips skeleton**: 4 cards in `grid grid-cols-4`, each with `OSkeleton type="text"` for label (h-3 w-16) and value (h-5 w-24). Wrapped in `<template v-if="loading">`.
- **Steps skeleton**: Full card with header skeleton (`OSkeleton type="text" h-4 w-14`) + `OSeparator` + 4 step rows. Each row: `OSkeleton type="rect"` for thumbnail (h-12 w-18), `type="circle"` for step number, `type="text"` for step name, `type="text"` for duration.
- **Transition**: `v-if="loading"` for skeletons, `v-else` for real content. Once `runDetail` is populated, skeletons disappear and real chips/steps render.
- **Import**: `OSkeleton` from `@/lib/feedback/Skeleton/OSkeleton.vue`.
- **Composable**: `const loading = computed(() => synthetics.loading.value)` aliases the existing `loading` ref from `useSyntheticResults`.

### Status Timeline Design

Custom HTML/CSS bar chart with OTooltip integration. Pure HTML/CSS bar chart with no charting library dependency.

Segments are grouped by `runId` — each logical run gets one segment, regardless of how many parallel executions it has (3–18 across browser×location×device combinations). Adjacent same-status merging is NOT used; every run gets equal visual weight.

**Three-color aggregate status:**
- **Green** (`--o2-status-success-text`) — all executions in the run passed
- **Orange** (`--o2-status-warning-text`) — mixed pass/fail within the run
- **Red** (`--o2-status-error-text`) — all executions failed

**Legend:** Three items in the card header — Mixed count (orange dot), Failed count (red dot), Passed count (green dot).

- **Rendering:** A flex container of `<div>` segments, each sized to `(100 / MAX_VISIBLE)%` width with `min-width: 3px`, full height of the bar container (26px).
- **Navigation:** Smooth programmatic scroll via `scrollTo({ behavior: "smooth" })`. Arrow buttons scroll by one page width. Scroll bounds are detected via `scrollLeft + clientWidth < scrollWidth`.
- **Per-segment hover:** Uses `OTooltip` in child mode (teleported to body, `side="top"`, zero delay). Tooltip has two sections:
  - **Header:** `🟢 N passed 🔴 M failed` — pass/fail counts with status dots, no branching for all-pass/all-fail.
  - **Body:** Executions grouped by location. Each group header shows a location name with an aggregate status dot (green = all passed, orange = mixed, red = all failed). Underneath, indented execution rows show per-execution status dot, browser brand SVG icon (Chromium, Firefox, WebKit from `src/assets/images/synthetics/`), and device name.
- **Segment hover effect:** `scaleY(1.35)` on hover for visual feedback.
- **Footer labels:** Three-part footer — **endLabel** (most recent bound, left), **rangeLabel** ("Showing X-Y of N runs", center), **startLabel** (earliest bound, right). Progressive date formatting (24-hour `hourCycle: "h23"`): same day → "14:30", same month → "Jul 7, 14:30", different year → "Jul 7 2025, 14:30".
- **Colors:** CSS variables (`var(--o2-status-success-text)`, etc.) used directly since they're applied via HTML `style` attribute. No runtime resolution needed.
- **Container:** `overflow: hidden` with `tw:gap-0.5` between segments. Scrollbar hidden via overflow clip on the wrapper.
- **Mock data time range:** Mock data (used via `generateRuns()` before the first live data load completes) respects the selected time range. Runs are evenly spread across the `[startTime, endTime]` window.

**Dependencies:** OTooltip (teleported to body — no ancestor clipping), OIcon (arrow buttons).

### Step Row Design (RunDetail)

Follows `BrowserJourneyStep.vue` conventions:

- **Execution-driven**: Iterates `lastAttemptSteps` (real execution data with duration, status, timestamps) rather than `recordedSteps` (original step definitions). Looks up `recordedSteps` by `step_id` → `id` for display metadata (action type, name, selector).
- **Step name fallback**: Displays `name → selector → url → truncated step_id` when earlier fields are absent.
- **Action icons**: Uses kebab-case icon names matching OIcon's validated icon set (`open-in-browser`, `ads-click`, `keyboard`, `touch-app`, etc.) — sourced from `BrowserJourneyStep.vue`.
- **Status circles**: Colored step number circles — green (`--color-badge-success-soft-bg/text`) for pass, red (`--color-badge-error-soft-bg/text`) for fail.
- **Error card**: Error section is rendered inside the expanded details panel (right side), not as a standalone inline card. Shows error icon, "Error" label, `exit · duration`, and the Playwright error in a `<pre>` with `whitespace-pre-wrap font-mono`. Long errors (>200 chars) collapse with "Show full error"/"Show less" toggle.
- **Card container**: `rounded border bg-[--o2-card-bg] mb-1`.
- **Compact row**: Step status circle, action icon chip (primary-50 bg), action label badge, step name, duration monospace, expand/collapse chevron.
- **Multi-expand**: `expandedStepIds: Set<number>` — multiple steps expandable simultaneously.
- **Auto-expand failed steps**: A `watch(steps)` auto-adds failed steps to `expandedStepIds` when data loads.
- **Expanded content**: 30%-width screenshot preview (no grey details header bar) + right panel with KV metadata (Action/Selector/URL/Duration), error section (for failed steps), and download button.
- **Session replay card**: Hidden entirely (via `v-if`) when `hasReplay` is false — no "No replay" placeholder. The steps timeline fills the full width.

### Card Styling

All cards in the overview (Status Timeline, KPI cards, charts, breakdowns) use the same container pattern:
```
card-container rounded-lg tw:flex tw:flex-col
  tw:bg-[var(--o2-card-bg)]
  tw:border tw:border-[var(--o2-border-color)]
```
Header section uses `tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.5rem]`, separators use `tw:border-t tw:border-[var(--o2-border-color)]`.

### Mock Data Fallback

Components always render — there is no loading skeleton. The `hasLoadedOnce` flag from the composable gates real data:
- Before load: deterministic seeded mock data
- After load: real data from the composable
- Charts: fall back to seed-generated synthetic series until real bucket data arrives

### KPI Card Set (5 cards)

1. **Pass Rate** — `uptimePct%` or `—`
2. **p95 Duration** — `fmtDur(p95Ms)` or `—`
3. **Retry Rate** — `(retriedRuns / totalRuns) * 100%` or `—`
4. **Failed Runs** — count, red text when > 0
5. **Last Run** — "Passed"/"Failed" + time ago

### Breakdown Cards (Pass Rate by Browser / Location / Device)

Three cards in a 3-column grid below the charts:

- **Labels:** "Pass Rate by Browser", "Pass Rate by Location", "Pass Rate by Device"
- **Bars:** Single green (`--o2-status-success-text`), always. Bar length alone communicates the rate — no threshold-based colors (removed to avoid cognitive friction where a red bar would conflict with a "Pass Rate" label). Bar background is `bg-text-disabled/25` so the empty portion is visible as a light grey track.
- **Text:** Pass rate percentage in `--o2-success-700`. Tabular-nums monospace font for alignment.
- **Row icons:**
  - **Browser:** Branded SVGs from `web/src/assets/images/synthetics/`:
    - Chromium → `chromium.svg`
    - Firefox → `firefox.svg`
    - WebKit → `webkit.svg`
    - Unknown → Material Symbol `"open-in-browser"` (fallback)
  - **Location:** Cloud provider SVGs mapped by region name:
    - Regions with `aws` prefix or AWS format (`us-east-1`, `eu-west-1`) → `aws.svg`
    - Regions with `gcp` prefix or GCP format (`us-central1`, `europe-west1`) → `gcp.svg`
    - Azure / unknown → Material Symbol `"location-on"` (fallback)
  - **Device:** Material Symbols:
    - Desktop → `"window"`
    - Mobile → `"touch-app"`
    - Unknown → `"devices"` (fallback)
- **Icons use Vite asset imports** (`import ... from "@/assets/..."`) and the `img:` prefix for OIcon — not `getImageURL()`, which builds URLs from `window.location` at runtime and can fail in Vite's asset pipeline.
- **No colored dots** in the Location card — removed to avoid visual inconsistency with the other cards.

### Calculation

Breakdowns are computed entirely in `MonitorRuns.vue` as Vue `computed` properties. They:
1. Iterate over `allRuns.value` (live data or mock fallback)
2. Group runs by dimension (browser / location / device)
3. Count `pass / total` per group
4. Convert to percentage: `Math.round((g.pass / g.total) * 100) + "%"`

The composable (`useSyntheticResults`) does **not** compute breakdowns — it only provides raw `SyntheticRun[]` data.

## Testing Decisions

### Test Philosophy

Test the schema module (pure functions, no Vue dependencies) thoroughly — it's the highest-value seam. Component tests for the three views should verify rendered output against known data, not internal state.

### Existing Test Files

- `syntheticResultsSchema.spec.ts` — Tests for the schema/mapper module (pure functions)
- `RunDetail.spec.ts` — Vue component tests for RunDetail
- `MonitorResultsDashboard.spec.ts` — Vue component tests for the dashboard
- `mapRecordedStep.spec.ts` — Utility mapper tests

### Timeline Test Seams

The timeline component is purely presentational — props in, DOM out. The highest seam is component-level:

1. **MonitorStatusTimeline.spec.ts** — Mount with known segments, verify:
   - All segment divs render
   - Scroll state detects bounds correctly
   - Footer labels render with correct progressive date formatting
   - Range label text ("Showing X-Y of N runs")

### What Makes a Good Test

- **Schema tests**: Verify that `buildKpiSql` generates the expected SQL shape, that `mapKpi` correctly parses aggregate rows, that `mapRun` handles missing fields gracefully, that `mapHistogram` properly zero-fills empty buckets.
- **Component tests**: Mount the component with known data via the composable mock, assert that the correct text/status/badges render. Use `data-test` selectors (existing pattern: `synthetics-*-*`).
- **Avoid**: Testing internal composable state (`wrapper.vm.synthetics`), testing mock data generation logic, snapshot testing.

### Prior Art

- `web/src/composables/synthetics/syntheticResultsSchema.spec.ts` — existing tests for schema mappers
- Other dashboard composables in `web/src/composables/` that use `useLLMStreamQuery` (e.g., `useDurationPercentiles`)
- `web/src/plugins/traces/LLMInsightsDashboard.vue` — same KPI card + chart + breakdown pattern

### Recommended Testing Approach

1. Unit-test `mapKpi`, `mapRun`, `mapRunDetail`, `mapHistogram` with known input/output pairs
2. Unit-test `buildKpiSql`, `buildRunsSql`, `buildRunDetailSql`, `buildHistogramSql` for SQL correctness (character escaping, field names, LIMIT clauses)
3. Component-test MonitorRuns with a mocked composable — verify all 4 KPI values render, timeline bar proportional, breakdown cards populated

## Out of Scope

- **Steps tab and Errors tab** in MonitorRuns — these still use mock data. A future PRD should wire them to stream queries (step cross-run analysis requires aggregation queries not yet defined).
- **Logs/Traces/RUM sub-tabs** in RunDetail — these are placeholder empty states. Correlated observability data requires linking run IDs to other streams.
- **Session replay** — the VideoPlayer card is hidden when no replay data exists (no placeholder shown). Real replay requires the RUM integration.
- **Prev/Next run navigation** in RunDetail — disabled. Requires a runs-list query in the detail page context.
- **Runs REST API** (`getRuns`/`getRun` in `synthetics.ts` service) — the composable queries the stream directly via SSE rather than using these endpoints. The service endpoints may be used in the future for CRUD operations on the runs table.
- **Pagination of the runs table** — currently limited to 500 rows via `LIMIT 500`. Pagination via stream queries would require cursor-based pagination.

## Further Notes

- The `runId` field maps to `run_id` in the stream, which is a UUID string. Router requires a non-empty string for the `:runId` param — empty-string guard added in `openRunDetail`.
- Timestamps come from the API in microseconds but are converted to milliseconds via `/ 1000` before any Date.now() comparisons.
- The `response_time_ms` field alias — despite the name `response_time_ms`, the stream schema field is already in milliseconds. Confirmed against sample log data.
- The `syntheticResultsSchema.spec.ts` file already exists and should be extended rather than rewritten.
