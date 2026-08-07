# Test Setup Contract: Traces In-Page Toolbar Tabs (area: Traces)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place.

- **`default` [shared/read-only]** — trace stream pre-ingested with ~20 traces via global setup.
  Fields include: `trace_id`, `span_id`, `start_time`, `duration`, `service_name`, `operation_name`,
  `span_status`, `span_kind`, etc. Why: all tab-switch tests that verify search results (spans/traces
  modes) need data to query; the in-page tabs re-run queries when switching. Services Catalog also
  needs this data to discover services.
- **No separate streams needed for toolbar-tab tests** — the toolbar toggles live inside the Traces
  page and use the same stream context. Service Graph / Services Catalog use the shared datetime
  from `searchObj.data.datetime` and do not need special data beyond what global setup provides.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Global trace ingestion** — already runs in every CI run via `global-setup.js`:
  ```js
  // tests/ui-testing/playwright-tests/utils/global-setup.js:124
  await ingestTraces(page, 20); // Ingest 20 test traces to default stream
  ```
  Import: `const { ingestTraces } = require('./trace-ingestion.js');`
  See: `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255`
  The `ingestTraces` function POSTs to `/api/{org}/v1/traces`.

- **If per-test ingestion is needed** (e.g. a test mangles the stream), reuse:
  ```js
  const { ingestTraces } = require('../utils/trace-ingestion.js');
  await ingestTraces(page, 10);
  ```

- **Auth/org**: Tests use `navigateToBase(page)` from `../utils/enhanced-baseFixtures.js` which
  authenticates; ORGNAME defaults to the default org (`e2e_automate` stream). Trace tests use
  `pm.tracesPage.navigateToTraces()` which clicks the left-rail Traces menu item.
  Worker auth state / login pattern from: `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`

- **Stream selection**: After navigating to traces, select the `default` stream:
  ```js
  await pm.tracesPage.selectTraceStream('default');
  ```
  See: `tests/ui-testing/pages/tracesPages/tracesPage.js:237`
  Used in: `tests/ui-testing/playwright-tests/Traces/tracesSearch.spec.js:22`

- **Time range setup** (if needed before tab switches):
  ```js
  await pm.tracesPage.setTimeRange('15m'); // '15m', '30m', '1h', etc.
  ```
  See: `tests/ui-testing/pages/tracesPages/tracesPage.js:510`

- **Timing**: Wait for results to load after switching tabs. The existing spec pattern uses
  `page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});`

## Preconditions / toggles

- **Service Graph tab requires enterprise**: The OToggleGroupItem is gated by
  `v-if="config.isEnterprise == 'true'"`. In OSS tests this button does NOT render. The existing spec
  marks Service Graph tests `@enterprise`. OSS tests should NOT attempt to click the service-graph
  toggle.
- **All other tabs (spans, traces, services-catalog) are available in OSS**.
- **SQL mode**: Traces page uses non-SQL mode by default (`searchObj.meta.sqlMode = false`).
  The query editor uses WHERE-clause syntax, not full SQL.
- **Live mode**: May be active by default (localStorage `oo_toggle_auto_run`). The existing spec
  pattern does not require explicit live-mode toggling for tab-switch tests.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Service Graph / Services Catalog tabs navigate in-page** — the URL stays at `/traces` and gains
  `?tab=service-graph` / `?tab=services-catalog`. They do NOT navigate to `/traces/service-graph`
  or `/traces/services`. The **rail flyout** is a separate access path that navigates to standalone
  routes — dual semantics coexist.
- **Search context carries implicitly**: When switching from spans/traces to services-catalog, the
  datetime/stream context is shared via `searchObj.data.datetime`. The catalog uses the same
  `DateTime` picker binding.
- **Tab state persists in URL**: After clicking a tab, `?tab=...` is added to the URL. A cold page
  reload restores the tab. Warm in-app navigation does NOT re-run `restoreUrlQueryParams`.
- **Service Graph no-data state**: Without topology daemon data, the Service Graph tab shows an empty
  state (`[data-test="service-graph-container"] [data-test="o2-empty-state"]`). Tests should use
  `.or()` to match either the chart or the empty state.
- **Services Catalog empty state**: Similarly, the catalog may show empty state
  (`[data-test="services-catalog-empty"]`) if no services are discovered.
- **Responsive breakpoints**: At narrow viewports, tab text labels hide (icon-only mode). The
  `shouldHideToggleText` threshold is 750px available left width. CI viewports are typically wide
  enough, but this matters for local debugging.
- **Stream schema arrives async**: After selecting a stream, fields hydrate asynchronously. Tab
  switches that trigger queries (`getQueryData`) handle this internally by checking `selectedStream`.
