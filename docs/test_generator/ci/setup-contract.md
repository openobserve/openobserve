# Test Setup Contract: RUM App Performance Toolbar & Toggle Group  (area: RUM)

Spec target: `tests/ui-testing/playwright-tests/RUM/app-performance.spec.js`
Test group: `RUM`. Import the enhanced fixture (`const { test, expect } = require('../utils/enhanced-baseFixtures.js')`) and `const PageManager = require('../../pages/page-manager.js')` exactly as `rum-page-dataflow.spec.js` and `rum-product-analytics-schema-states.spec.js` do.

## Streams / data the spec must establish

### `_rumdata` (browser, Web-Vitals schema) — `[shared/read-only]`
- **Why:** the Overview and Vitals tabs only render their *browser* panels when the schema carries the browser Web Vitals columns (`view_largest_contentful_paint`, `view_cumulative_layout_shift`, `view_interaction_to_next_paint`, `view_first_contentful_paint`, `view_first_byte`, `view_loading_time` — see `useRumPlatforms.ts:53-60`). This is the persona for the primary "tabs render + refresh doesn't hang" workflows.
- **How (copy the EXACT real-SDK pattern — do NOT invent setup):** generate a real browser session via the CDN fixture, the same way the existing dataflow spec does:
  - `getOrCreateRumToken` from `../utils/rum-token-api.js`
  - `startFixtureServer` from `../../fixtures/rum/serve.js` with `{ clientToken, org, site, insecureHTTP, service: SERVICE, env: 'e2e', version: '1.0.0', applicationId, sdkVersion }`
  - `driveRumSampleInteractions` + `isRumSdkReady` from `../utils/rum-traffic.js`
  - wait via `waitForStreamRows` from `../utils/rum-stream-verify.js` (`SELECT * FROM "_rumdata" WHERE service = '<SERVICE>'`)
  - **Reference:** `tests/ui-testing/playwright-tests/RUM/rum-page-dataflow.spec.js:73-176` (beforeAll generation) and the Overview assertion `rum-page-dataflow.spec.js:201-211`.
- **Reuse note:** `rum-page-dataflow.spec.js` already proves this exact path. If the app-performance spec only needs the toolbar (tabs/refresh/share/date), it can run against the *same* real-SDK session or its own unique `SERVICE` (`e2e-rum-app-perf-<RUN_ID>`) — never reuse a fixed `service` across runs (see Gotchas).

### `_rumdata` (mobile-only) — `[per-test]` for the browser-only / platform-gating edge cases (optional scope)
- **Why:** exercises `web-vitals-dashboard-browser-only-empty` ("Web Vitals need the Browser RUM SDK") and the Overview mobile sections.
- **How:** `buildMobileScreensSeed` (source `'android'`) + `seedBuilt` from `../utils/rum-analytics-ingestion.js`, into a **fresh per-test org** via `ensureRumStateOrg` (stable name, e.g. `appperf_mobile`).
  - **Reference:** `tests/ui-testing/playwright-tests/RegressionSet/RUM/rum-product-analytics-schema-states.spec.js:81-102` (`prepareStateOrg`) and `:117-123` (mobile + browser seeds together).

### `_rumdata` (browser, but NO Web Vitals fields) — do NOT use for Overview/Vitals panel assertions
- `buildFunnelSessions` (`rum-analytics-ingestion.js:206-230`) emits `view_url`, `session_id`, `source='browser'`, `action_*`, `error_*` but **not** `view_largest_contentful_paint` etc. For a `buildFunnelSessions` seed, the Overview/Vitals *browser Web Vitals* panels get filtered out (schema lacks the gated fields). It is fine only for the Errors/API tabs or for "no Web Vitals" scenarios.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / org:** the seeded helpers bypass the browser session — they call `page.request` with Basic auth from `rumTestContext()` / `basicAuthHeader` (`../utils/rum-env.js`), using `ZO_RUM_TEST_EMAIL/ZO_RUM_TEST_PASSWORD` (preferred) or `ZO_ROOT_USER_EMAIL/ZO_ROOT_USER_PASSWORD`. The *UI* navigation then uses the already-authenticated `page` fixture.
- **Navigate to the page:** `pm.rumPerformancePage.gotoPerformance()` — `tests/ui-testing/pages/rumPages/rumPerformancePage.js:15-20` (exposed on `page-manager.js:339`). It waits for `[data-test="rum-performance-refresh"]` to be visible.
- **Assert refresh resolves:** `pm.rumPerformancePage.expectSummaryLoadingResolved()` — `rumPerformancePage.js:27-29` (waits for `performance-summary-loading-indicator` to hide).
- **Tab switch via URL is the robust path:** the page object does not yet have tab helpers; drive tabs by clicking `[data-test="rum-performance-tab-<value>"]` and assert `page.toHaveURL(/performance\/web-vitals/)` etc., or deep-link with `page.goto(.../performance/web-vitals?org_identifier=...)`.

## Preconditions / toggles
- **Auto-Run (Live Mode) toggle:** gated on `zoConfig.auto_query_enabled === true` (`useAutoRunToggle.ts:38`), which the server sets from `ZO_AUTO_QUERY_ENABLED` and **defaults to `false`** (`src/config/src/config.rs:2487`). The refresh-options dropdown and the toggle (`rum-performance-refresh-options-btn`, `rum-performance-auto-run-toggle-btn`) do **not** render without it.
  - If the CI env enables `ZO_AUTO_QUERY_ENABLED=true`, test the toggle and assert `localStorage["oo_toggle_auto_run"]` flips.
  - If not, the Architect should mark the Auto-Run test `test.fixme` (config-gated), and the toggle assertions must NOT run.
- **Share button:** `ShareButton` disables itself when `zoConfig.web_url` is unset (`ShareButton.vue:131-134`). Share-copy assertions should gate on `web_url` being configured (the short-URL service must also be reachable).
- **Schema hydration is async:** the child tabs resolve `_rumdata` schema in `onMounted` → `ensureRumSchema()`. Do not assert on panels/empty-state until the `…-schema-loading` block is gone (or, for Overview, until `performance-summary-loading-indicator` is hidden).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **No predicate-scoped delete on `_rumdata`:** rows cannot be removed per-test; only whole hour-aligned windows. Namespace every run with a unique `service`/`application_id` so reruns never cross-assert (`rum-page-dataflow.spec.js` header comment, `:29-39`).
- **Schema is forever:** once an org ingests browser data, its `_rumdata` schema keeps the Web Vitals columns — the field-gating (`filterDashboardBySchema`) then keeps browser panels even if the *range* has no browser rows. Platform *range* gating (Overview) is the only thing that hides a platform section based on current data (`useRumPlatforms.detectPlatforms`). So browser-only vs mobile-only *empty-state* cases must use their own fresh org (`ensureRumStateOrg`), not the shared default org.
- **`buildFunnelSessions` lacks Web Vitals fields** — see the third stream entry above; don't seed it and then assert Overview/Vitals browser panels render.
- **Mobile viewport collapses the tabs into a dropdown** — desktop selectors (`rum-performance-tab-*`) won't match; the trigger is `rum-performance-tabs-dropdown-btn` and items get a `-item` suffix.
- **Refresh-button icon flips** `refresh`↔`autorenew` based on Auto-Run state — don't assert a fixed icon unless Auto-Run is pinned.
- **DateTimePickerDashboard has no `data-test`** (only class `.rum-date-time-picker`) — `NEEDS SELECTOR` if a test must manipulate the range directly; otherwise set the range via the URL query (`?period=1h` or `?from=&to=`), which `AppPerformance.vue` reads in `getSelectedDateFromQueryParams` (`:365-370`).
