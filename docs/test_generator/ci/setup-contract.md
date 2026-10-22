# Test Setup Contract: Ingestion First-Event Status (area: Streams)

Concrete preconditions for `tests/ui-testing/playwright-tests/Streams/first-event-status.spec.js`.
All helpers below already exist — copy the exact call, do **not** invent setup.

## Streams / data the spec must establish

The bar's headline behavior is **"received"** (green). The deterministic path uses the **curl test
guide**, whose target stream is `default` (see `TEST_GUIDES = { curl: "default" }` in
`web/src/components/ingestion/IngestionContent.vue:58`).

- **`default` [per-test mutation]** — logs stream the curl guide watches.
  Why: every received/idle/no-requests test drives the bar mounted on `/web/ingestion/custom/logs/curl`,
  which is hardwired to `targetStream="default"`.
  Scope note: `default` is a shared, well-known stream that other suites also touch. Tests that need a
  clean baseline should prefer the **copy-then-ingest** path (anchor → count-since-anchor), which is
  insensitive to whether `default` pre-exists, over assuming `default` is empty.

### How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest a log record to `default`:**
  `require('../utils/data-ingestion.js').ingestTestData(page, 'default', { force: true })`
  — see `tests/ui-testing/playwright-tests/utils/data-ingestion.js:17` (posts
  `tests/test-data/logs_data.json` to `POST {INGESTION_URL}/api/{org}/default/_json`).
  Use `{ force: true }` so the shared-stream 5-min throttle (`SHARED_STREAM` is `e2e_automate`, not
  `default`, so force is only belt-and-braces for a named stream) never skips the write.
- **Custom payload to a specific stream (preferred for a unique first record):**
  `require('../utils/data-ingestion.js').ingestCustomData(page, 'default', [{ log: 'first-event-status e2e', level: 'info' }])`
  — see `tests/ui-testing/playwright-tests/utils/data-ingestion.js:102`.
- **Readiness wait (ingest → queryable):**
  `await require('../utils/data-ingestion.js').waitForStreamData(page, 'default', 1, 30000)`
  — see `tests/ui-testing/playwright-tests/utils/data-ingestion.js:192`. The watch reads stream stats
  (`doc_num`/`doc_time_min`) via `stream.nameList` AND a SQL COUNT, so wait on search, not just on the 200
  of the ingest call.
- **Readiness wait (stream enumerated in the picker/list):**
  `await require('../utils/data-ingestion.js').waitForStreamListed(page, 'default', 'logs', 90000)`
  — see `tests/ui-testing/playwright-tests/utils/data-ingestion.js:316`. The watcher's `findTarget`
  probes `stream.nameList`; a stream not yet listed reads as "does not exist", flipping the path.
- **Auth / org (self-hosted OSS):**
  `getOrgIdentifier()` → `process.env.ORGNAME`; `getAuthHeaders()` → Basic `ZO_ROOT_USER_EMAIL`:`ZO_ROOT_USER_PASSWORD`.
  — see `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29` and `:64`.
- **Navigation to the curl guide:**
  `await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/curl', orgId)`
  — see `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:77` (goto
  `${ZO_BASE_URL}/web/ingestion/custom/logs/curl?org_identifier=${orgId}`).
  Page-manager wiring: `this.ingestionConfigPage = new IngestionConfigPage(page)` at
  `tests/ui-testing/pages/page-manager.js:255`.
- **Copy the snippet to engage the watch:**
  `await pm.ingestionConfigPage.clickCopyButton()` then optionally `await pm.ingestionConfigPage.expectToastText('Copied')`
  — see `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:122`. The code-block copy button
  (`[data-test^="ingestion-"][data-test$="-code-block-copy-btn"]`) triggers
  `FIRST_EVENT_SNIPPET_COPIED → bar.start("copy")`, which marks the watch engaged.

## Preconditions / toggles

- **Engagement is required to count existing traffic.** On page load (`start("open")`) the watch is
  **not** engaged: a target stream that already has records sends it to `idle` ("Not checking yet")
  instead of green. Turning green requires either (a) copy the snippet (`start("copy")`), (b) "Check now"
  (`start("check")`), or (c) the target stream did not exist at watch start (the "new-data" path counts
  the first record automatically). **Write the received test against (a) or (c).**
- **OSS run → no Ask AI.** `config.isEnterprise === "false"` (`web/src/aws-exports`) ⇒
  `aiEnabled` is false ⇒ `[data-test="first-event-diagnosis-ask-ai-btn"]` never renders. Do not assert it.
- **Poll cadence:** fast `5s` for the first 10 min, then `30s`; stop at `60min`
  (`FIRST_EVENT_BUDGET`, `web/src/composables/firstEvent/firstEventBudget.ts:30`). Assertions on
  `received` should wait up to ~10–15 s after ingest (covers a poll cycle), not just one tick.
- **Auto diagnosis is slow (`diagnosisAtMs = 120_000`).** For a deterministic diagnosis test, click
  `[data-test="first-event-status-troubleshoot-btn"]` instead of waiting 2 minutes; the Troubleshoot
  path reads `recent_rejections` immediately.
- **`stopped` (60 min) is not e2e-reachable** without clock mocking — leave it unit-covered; do not
  write a green test for it.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`default` is shared.** The bar's `idle`/`received` decision depends on whether `default` already
  has records *at watch start*. A test that assumes "empty org" will flake against a warm `default`.
  Prefer the copy-then-ingest path (anchor semantics) which is independent of pre-existing data.
- **Stats lag the ingester.** `confirmNewStream` trusts `doc_num`/`doc_time_min` only when
  `docMin > 0`; immediately after ingest those may still be 0, so it falls back to a SQL COUNT. Always
  gate on `waitForStreamData` (search-index readiness) before asserting green.
- **Stream list lag vs search.** A newly-ingested stream can be queryable before it appears in
  `stream.nameList`. The watcher's `findTarget` reads the name list, so also gate on
  `waitForStreamListed` when the test depends on the "new stream" existence path.
- **The bar does not render without an org.** If `selectedOrganization.identifier` is empty the bar is
  omitted (`IngestionContent.vue:113`). The standard `navigateToBase` + org flow in the existing
  Streams specs already guarantees this.
- **`data-kind="test"` only on the curl guide** (route name `curl`). Other guides are `standard` and
  show "Setup another source" instead of "Connect your real source".
- **The first-record strip is bar-display only** (`display="bar"` default). The `pill` display (empty
  pages) omits it and the action buttons.
