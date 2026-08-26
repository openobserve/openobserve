# Test Setup Contract: Dashboard Lazy Panel Mounting (area: Dashboards)

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — logs stream with fields incl.
  `kubernetes_container_name`, `kubernetes_namespace_name`, `code`, `stream`, `_timestamp`.
  Why: every panel in the dashboard queries this stream; panels only need to *exist and mount*, so
  any valid log stream works. Reuse the stream already ingested by sibling dashboard specs — do NOT
  create a new one.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest logs** — reuse the existing ingestion helper, called in `beforeEach`:
  ```js
  import { ingestion } from "./utils/dashIngestion.js";
  // in beforeEach: await ingestion(page);   // ingests logs_data.json → stream "e2e_automate"
  ```
  Reference: `tests/ui-testing/playwright-tests/Dashboards/dashboard-panel-time-advanced-edge-cases.spec.js:28`
  (helper source: `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:25`).
  The payload (`test-data/logs_data.json`) is **CI-seeded and absent from this checkout** — rely on
  the helper, do not commit a new fixture.

- **Dashboard with many vertically-stacked panels** — two options, in order of preference:

  1. **API (preferred, deterministic panel ids)** — POST a full v8 dashboard with N panels, each
     `layout.y = i * 20` (so the last panels sit several viewports below the fold), each with one
     simple query against `e2e_automate`. Use the authenticated `APICleanup` client:
     ```js
     const api = new APICleanup(page);
     await api._fetch(`${api.baseUrl}/api/${api.org}/dashboards?folder=default`, {
       method: "POST",
       headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
       body: JSON.stringify(payload),
     });
     ```
     Reference patterns:
     - minimal empty dashboard POST: `tests/ui-testing/pages/apiCleanup.js:283` (`createMinimalDashboard`)
     - POST envelope + response shape (`result.v8.tabs[0].panels[i].id`):
       `tests/ui-testing/pages/dashboardPages/dashCreation.js:197-247` (`createDashboardViaApi`) and
       `tests/ui-testing/playwright-tests/Dashboards/utils/panelTimeSetup.js:398-407`.
     The **panel+query JSON shape** (v8) has no committed fixture in this checkout — capture it from
     a live dashboard (inspect the `PUT /api/{org}/dashboards/{id}` body in devtools) or mirror the
     fields the UI sends. Keep queries trivial (e.g. a `bar`/`line` panel with a count over
     `e2e_automate`).

  2. **UI-driven (fallback, no JSON schema needed)** — reuse the existing multi-panel helper:
     ```js
     import { createDashboardWithMultiplePanels } from "./utils/panelTimeSetup.js";
     const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
       dashboardName, panels: [ /* { panelName } × N */ ],
     });
     ```
     Reference: `tests/ui-testing/playwright-tests/Dashboards/utils/panelTimeSetup.js:242-275`.
     Panels auto-stack at increasing y; create ~8–12 panels so the last ones are off-screen.

- **Open the dashboard** — either `page.goto('/web/dashboards/view?dashboard=<id>')` (API path) or
  `openDashboard(page, dashboardName)` (`panelTimeSetup.js:282`) for the UI path.

## Preconditions / toggles

- **Non-print, non-forceLoad** — the view dashboard already renders `RenderDashboardCharts` with
  `forceLoad=false` and `store.state.printMode=false`. Do nothing; just do NOT open print/report mode.
- **Single tab** — `selectedTabId` is provided by `ViewDashboard.vue` from `route.query.tab` (defaults
  to the dashboard's first tab). Place all panels on the default tab; do not set `tab` in the URL
  unless testing tab-switch behavior.

## Timing / load-state waits

- **Placeholder assertion** — after navigating, the `.grid-stack-item` tiles must exist before the
  `panelMountObserver` (`rootMargin: "100% 0px 100% 0px"`) can evaluate them. Wait for the grid host:
  `page.locator('.grid-stack-item').first()` visible (or `waitForDashboardPage`), then assert the
  far-down panel's placeholder.
- **Mount assertion** — after `locator('[data-test="dashboard-panel-placeholder-<id>"]').scrollIntoViewIfNeeded()`,
  wait for `[data-test="dashboard-panel-container"][data-test-panel-id="<id>"]` (the observer + Vue
  re-render is async; use a visible/hidden wait, not a fixed sleep).
- **Do NOT wait for chart data** on the mount-only test: data fetch is a *separate* gate
  (`usePanelDataLoader`'s own IntersectionObserver) and is not needed to assert the mount transition.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`rootMargin` mounts ~1 viewport ahead** — a panel within ~1 viewport below the fold is already
  "intersecting" and mounts on load (no placeholder). Place the target placeholder panel ≥ 1.5–2
  viewports down (large `layout.y`).
- **Placeholder selector is id-suffixed** — you must know the panel id first (API response or the
  `getPanelId(page, index)` helper at `panelTimeSetup.js:428`).
- **Mount is one-way** — after scrolling away, `dashboard-panel-placeholder-<id>` stays absent; assert
  presence→absence→(scroll back)→still absent, not "placeholder returns".
- **`test-data/*.json` is not in this checkout** — ingestion goes through `dashIngestion.js`, which
  is wired for CI; do not `import` a fixture path directly or it will fail locally.
- **`dashboard-panel-container` count is not "all panels"** — lazy mounting means the DOM only has
  mounted panels + placeholders; do not assert `[data-test^="dashboard-panel-"]` count == total panels.
