# Test Setup Contract: Splunk HEC Ingestion Window Warning  (area: GeneralTests)

This feature is a **static documentation page** — it requires **no streams, no ingested data, and
no server-side setup**. The only preconditions are an authenticated session and a resolved org
identifier. This contract is intentionally minimal; every "data condition" below is really a
*navigation/state* condition.

## Streams / data the spec must establish

**None.** The Splunk HEC page (`web/src/components/ingestion/logs/SplunkHec.vue`) has no async data
dependency and renders every section unconditionally. The E2E spec must NOT ingest or create any
stream — doing so would be wasted work and would introduce cleanup risk for a read-only page.

## How to reach the page (copy these EXACT patterns — do NOT invent navigation)

- **Auth + base navigation**: `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141`. It lands on
  `${ZO_BASE_URL}/web/?org_identifier=${ORGNAME}`, waits for the nav rail, and self-heals cloud
  auth. Use it in `beforeEach`, mirroring `GeneralTests/ingestion-config.spec.js:13`.
- **Direct deep-link to the page** (preferred, avoids tab-clicking through three nested rails):
  ```js
  const orgId = getOrgIdentifier();                 // cloud-auth.js:64
  await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/splunkhec', orgId);
  ```
  Reference: `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:63-66`
  (`page.goto(`${ZO_BASE_URL}/web${integrationPath}?org_identifier=${orgId}`)` + `domcontentloaded`).
- **Alternatively, tab-click from the Logs rail** (use only if the spec must prove the tab is
  reachable): click `[data-test="ingestion-logs-tab-splunkhec"]` in `Index.vue:113-124`.

## Preconditions / toggles

- **Org identifier** — required for the URL query and the tokens-link target; obtain via
  `getOrgIdentifier()` (`cloud-auth.js:64` → `ORGNAME` env on self-hosted). The endpoint URL itself
  must NOT contain it (that is an assertion, not a precondition).
- **No SQL-mode / quick-mode / edition toggle** applies to this page. It is an ingestion
  documentation page, not a query view.
- **Non-cloud vs cloud**: the page and route exist on both. The existing ingestion spec tags use
  `@ingestion` and run in parallel; no cloud-specific skip is needed for the window banner itself.

## Assertion timing / gotchas (so the Healer/Engineer don't rediscover them)

- **No hydration wait beyond the banner**: there is no async data, so wait for the page marker to be
  visible and assert. Use `page.waitForLoadState('domcontentloaded')` (already in
  `navigateToIntegration`), then `expect([data-test="ingestion-logs-splunkhec-window-note"]).toBeVisible()`.
- **Endpoint URL is `origin`-derived**: assert the rendered `rum-content-text` (first) equals
  `${page.url()} origin + /services/collector` and contains neither `org_identifier`/org id nor
  `/api/`. `window.location.origin` in the browser is the SPA's origin — read it via `page.evaluate`
  if comparing exactly.
- **The `time` field is live (60 s interval)**: assert it is present and *a fractional number near
  now* at read time; do NOT assert a fixed value. (`SplunkHec.vue:194-204`.)
- **curl example has no `time`; payload example has `time`**: if a test parses the JSON bodies,
  expect `time` absent in the curl snippet and present (fractional) in the payload snippet.
- **Warning banner `role="alert"`**: `OBanner` maps `variant="warning"` → `role="alert"`
  (`OBanner.vue:54-57`). Asserting `role` is the robust way to prove it's a *warning* banner, not
  furniture.
- **Copy toast**: copy feedback uses `[data-test-variant="success"]` (see
  `ingestionConfigPage.js:30-31`), and the clipboard needs the `clipboard-read`/`clipboard-write`
  permissions already granted by the `enhanced-baseFixtures` context (line 37/43).
- **Tokens link target**: route `ingestionTokens` is registered in OSS via
  `useEnterpriseRoutes.ts:132-141` (spread at `router.ts:1117`) despite the "Enterprise" filename —
  the link is live on OSS; no enterprise gating applies.

## Known limitations / parked cases

- **Payload clock ticking** is covered by the Vitest unit spec (`SplunkHec.spec.ts:146-160`, fake
  timers). It is NOT a viable E2E assertion (would require a 5 h+ fake-time hold) — do not attempt it.
- **No form validation, no error states, no destructive actions** — this page is read-only, so there
  is no cleanup step and the spec can run in parallel with the rest of the `GeneralTests` suite.
