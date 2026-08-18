# Test Setup Contract: Traces Query Tab Navigation  (area: Traces)

This contract tells the Engineer exactly what preconditions the `tracesQueryTabs.spec.js`
tests need, and the **exact existing patterns** to establish them. Do NOT invent setup —
copy the referenced helpers/lines.

## Streams / data the spec must establish

Navigation itself is pure client-side routing and needs **no** trace data; the search tabs
fall back to empty/no-stream states and Services Catalog renders an empty state when it has
no services. Trace data is only needed if a test asserts *results* (not required here).

- **`default` trace stream** **[shared/read-only]** — fields include `service_name`,
  `operation_name`, `span_status`, `duration`, `trace_id`, `span_id`, `start_time`,
  `end_time`. Why: pre-seeded so the search tabs have a selectable stream and the catalog
  has *some* services (catalog may still legitimately be empty). **Already established by
  global setup — do NOT re-ingest per test.**
  - Established by: `tests/ui-testing/playwright-tests/utils/global-setup.js:124`
    (`await ingestTraces(page, 20)`) which POSTs 20 OTLP traces to
    `/api/<org>/v1/traces` (see `utils/trace-ingestion.js:255-317`).

No per-test stream/data setup is required for the navigation tests. If a test must assert
catalog **table** rows (rather than table-or-empty), it may call
`ingestTraces(page, N)` from `tests/ui-testing/playwright-tests/utils/trace-ingestion.js`
inside that test — but prefer the `.or()` (table OR empty) assertion used by the existing
suite.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / navigate to Traces:**
  - `navigateToBase(page)` from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`
    (see how `traces-toolbar-tabs.spec.js:20` uses it, then `pm.tracesPage.navigateToTraces()`).
  - ORGNAME = `default` (global setup logs in as the default org; see `global-setup.js:37`).
  - Page manager: `const PageManager = require('../../pages/page-manager.js');` →
    `pm = new PageManager(page)` → `pm.tracesPage.navigateToTraces()`.
    Reference: `tests/ui-testing/playwright-tests/Traces/traces-toolbar-tabs.spec.js:17-28`.

- **Toolbar tab switching helpers (already exist — reuse):**
  - `pm.tracesPage.navigateToServicesViaTab()` — clicks `traces-search-mode-services-catalog-btn`
    and waits for `/traces?tab=services-catalog` + catalog view.
    `tests/ui-testing/pages/tracesPages/tracesPage.js:434-442`.
  - `pm.tracesPage.expectServicesCatalogTabActive()` — asserts `data-state="on"`.
    `tracesPage.js:480-483`.
  - `pm.tracesPage.switchToSearchView()` — clicks `traces-search-mode-traces-btn`.
    `tracesPage.js:444-446`.

- **Flyout navigation (SELECTORS CHANGED — the existing helper is stale):**
  - The flyout items are now `[data-test="nav-group-item-traces-spans"]`,
    `nav-group-item-traces-traces`, `nav-group-item-traces-service-graph`,
    `nav-group-item-traces-services-catalog` (derived in `ONavGroup.vue:228`).
  - The page object's `tracesRailTile` (`nav-group-traces`) is still correct for the tile;
    hover it, then click the **new** `nav-group-item-traces-*` selectors directly in the spec
    (or add a page-object method). The old `nav-group-item-serviceGraph` /
    `nav-group-item-servicesCatalog` selectors match nothing.

## Preconditions / toggles

- **OSS only** — the run is `edition: oss`. `config.isEnterprise != "true"`, so:
  - Service Graph toolbar toggle (`traces-service-graph-toggle`) is NOT rendered.
  - Service Graph flyout item (`nav-group-item-traces-service-graph`) is NOT rendered.
  - `/traces?tab=service-graph` and `/traces/service-graph` redirect to `?tab=spans`.
  - Do NOT write a green test that clicks Service Graph; if covering it, assert
    **absence/redirect**, or park as `test.fixme` (Architect decides).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Stale page-object flyout selectors.** `tracesPage.js:25-26`, `serviceGraphPage.js:15`,
  and `servicesCatalogPage.js:95` reference `nav-group-item-serviceGraph` /
  `nav-group-item-servicesCatalog`; `tracesPage.js:83` references `service-graph-page`
  (a removed standalone page). All are stale against the new `nav-group-item-traces-*`
  scheme. Use the new selectors directly.
- **`switchToServiceMaps()` (tracesPage.js:409-414) waits for `/traces/service-graph`** —
  that URL now redirects to `/traces?tab=service-graph`, so this helper will time out.
  Do not reuse it; the flyout now lands on `/traces?tab=service-graph`.
- **Existing `traces-toolbar-tabs.spec.js:91-102` ("Rail flyout → standalone route") is now
  obsolete** — it asserts `/traces/service-graph`, which redirects. The new spec encodes the
  new flyout → `/traces?tab=` behavior instead.
- **Default tab is `spans`**, not `traces` — `DEFAULT_TRACE_SEARCH_MODE = "spans"`
  (`trace.types.ts:20`) and `defaultForRoute` is on the spans flyout child (`navGroups.ts:229`).
  A tabless `/traces` lands on spans. (The `ONavGroup.spec.ts` unit fixture inverts this —
  ignore that fixture; production is authoritative.)
- **Assert on the toggle item's `data-state`** (Reka `ToggleGroupItem` puts `data-state="on"|"off"`
  on the same element as `data-test`) rather than CSS classes for "active tab".
- **Catalog view is table OR empty** — never assert a populated `services-catalog-table`
  unconditionally; use `.or(services-catalog-empty)` (pattern: `tracesPage.js:464-471`).
- **`?tab=` survives only a cold load** — a warm in-app visit doesn't re-run
  `restoreUrlQueryParams`; use `page.reload()` to prove bookmark behavior
  (pattern: `traces-toolbar-tabs.spec.js:79-88`).
- **Wait for stream-list hydration before switching** — the stream select and catalog load are
  async; if you assert results, first wait for `log-search-index-list-select-stream` options
  (`tracesPage.js:237-260`) or the catalog table/empty state, else you read a pre-load empty.
