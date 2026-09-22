# Test Setup Contract: Splunk HEC Ingestion Endpoint  (area: GeneralTests)

> **Key fact:** this is a **static documentation page — no streams, no data, no API
> setup is required.** Every section/banner renders unconditionally from store state
> already present after login. The only "setup" is authentication + a selected org.
> Any test that ingests data or creates a stream for this feature is doing unnecessary
> and fragile work.

## Preconditions / toggles

- **Auth:** standard worker auth state. `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141` authenticates
  and verifies via `[data-test="navbar-main-nav"]`. The existing sibling spec
  `splunk-hec-ingestion-window.spec.js:10-18` uses exactly this in `beforeEach`.
- **Org:** `const orgId = getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:64` (cloud → cloud-config.json,
  self-hosted → `process.env.ORGNAME`). Pass it as the `org_identifier` query param.
- **No SQL-mode / quick-mode / feature toggles.** The page has none.

## Streams / data the spec must establish

None. There is no `[shared/read-only]` or `[per-test]` stream. Do **not** call
`pm.ingestionPage.ingestion(...)` — the Splunk HEC card never reads any stream.

## Navigation (copy this EXACT pattern — do NOT invent)

- Page object already exists: `tests/ui-testing/pages/generalPages/splunkHecPage.js`
  (registered as `pm.splunkHecPage` in `tests/ui-testing/pages/page-manager.js:197`).
- Navigate with the existing helper:
  ```js
  await pm.splunkHecPage.navigateToSplunkHec(orgId);
  ```
  It does `page.goto(\`${process.env.ZO_BASE_URL}/web/ingestion/custom/logs/splunkhec?org_identifier=${orgId}\`)`
  and waits for `[data-test="ingestion-logs-splunkhec-intro"]` to be visible
  (`splunkHecPage.js:31-36`).
- `PageManager` construction + `navigateToBase` in `beforeEach` mirror
  `splunk-hec-ingestion-window.spec.js:10-18` verbatim.

## Assertion strategy for the endpoint URL (the headline behavior)

The component builds the collector base from `getEndPoint(getIngestionURL()).url`, where
`getIngestionURL()` returns `store.state.API_ENDPOINT` unless `zoConfig.ingestion_url` is
set (`queryUtils.ts:268-278`). In a standard self-hosted E2E deployment
`API_ENDPOINT === window.location.origin` (see `stores/index.ts:27-37`), so
`endpoint === \`${origin}/services/collector\`` — **but** a deployment with
`zoConfig.ingestion_url` configured (or a separate ingest host) will render a different
host. Therefore:

- **Preferred (robust across deployments):** assert structural properties, matching the
  existing spec `splunk-hec-ingestion-window.spec.js:39-54`:
  - `endpoint.endsWith('/services/collector')`
  - `endpoint` does **not** contain `orgId`, `/api/`, or `/web/`
- **If asserting the exact host**, resolve the expected base via the same source (read
  `process.env`/config), not `window.location.origin` alone. Do **not** hardcode a host.

## Toast / copy assertions

- Copy buttons: `[data-test="rum-copy-btn"]` — exactly **4** (endpoint, curl, payload,
  health). See `splunkHecPage.js:21`.
- Success toast: `[data-test-variant="success"] [data-test="o-toast-message"]` with text
  `Copied Successfully`; auto-hides (~5s). Use `splunkHecPage.js:107-115`
  (`expectCopyToast` / `waitForCopyToastToHide`).

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **There is no async data on this page** — the intro paragraph is the only reliable
   "loaded" marker. Don't wait for any stream/schema/field hydration; there is none.
2. **`OBanner` `data-test` → `dataTest` prop.** `data-test="…"` in the parent maps to the
   `dataTest` prop, and `OBanner` re-emits `data-test` on its root `div`
   (`OBanner.vue:115-116`). Warning banners carry `role="alert"` (`OBanner.vue:54-57`).
   Assert `role` on the window-note only (it's the only one the existing spec checks).
3. **Payload `time` is live and fractional.** Assert it's a finite number within ±120s of
   `Date.now()/1000` and that the raw text matches `"time":\s*\d+\.\d+` (millisecond
   precision). A whole-second `Date.now()` lands on `%.3f == .000` ~1-in-1000 runs, so
   assert on the JSON number (`Number.isFinite(payload.time)`) rather than `.000`.
   See `splunk-hec-ingestion-window.spec.js:103-128`.
4. **curl example must omit `time`.** A literal epoch ages past `ZO_INGEST_ALLOWED_UPTO`
   and is silently discarded behind `code 0`. Assert `curlData` has `event` + `index` and
   `not.toHaveProperty('time')`.
5. **Health probe is unauthenticated.** The health curl must **not** contain
   `Authorization`. Only the curl/example section carries the Splunk auth header.
6. **Endpoint is org-less.** Never assert the org id appears in the endpoint URL — the
   org is resolved from the token server-side.

## Reference implementations (existing, already-green)

- `tests/ui-testing/playwright-tests/GeneralTests/splunk-hec-ingestion-window.spec.js`
  — 6 passing tests covering banner alert, endpoint root-mount, tokens-link navigation,
  three banners, 4-snippet copy, live payload time.
- `tests/ui-testing/pages/generalPages/splunkHecPage.js` — the page object to reuse as-is
  (do not re-derive selectors).
