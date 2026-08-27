# Test Setup Contract: RUM Share Link  (area: Rum)

> Read by the **Engineer** (implements setup), **Healer** and **Refiner** (consult instead of
> blind-scanning when a data/setup failure appears). Do NOT invent setup — copy the exact patterns
> and file:line references below.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE (module `beforeAll`).
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`_rumdata` + `_sessionreplay` streams, populated with ONE session** **[shared/read-only]** —
  Why: the RUM module (and every share button's parent page) only renders when RUM is enabled
  (`checkIfRumEnabled` reads `_rumdata`; the Sessions toolbar also needs `_sessionreplay`). The
  generated session's id is needed to reach the **Session Viewer** share button, and its error
  event's id is needed to reach the **Error detail** share button.
- **`_rumlog`** (implicit) — created by the same SDK fixture; not directly asserted, but the sample
  interactions emit log rows into it.

> No separate "empty stream" helper exists. The RUM streams are created implicitly by SDK ingestion,
> so generate ONE real session via the CDN fixture (below). This is the same, proven pattern used by
> the existing `rum-page-dataflow.spec.js`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Generate one session (beforeAll):** copy the block from
  `tests/ui-testing/playwright-tests/RUM/rum-page-dataflow.spec.js:69-162`:
  1. `getOrCreateRumToken(tokenPage)` — `tests/ui-testing/playwright-tests/utils/rum-token-api.js`
  2. `resolveCdnSdkVersion(tokenPage)` — `tests/ui-testing/playwright-tests/utils/rum-sdk-version.js`
  3. `startFixtureServer({ clientToken, org, site, insecureHTTP, service: SERVICE, env, version, applicationId, sdkVersion })`
     — `tests/ui-testing/fixtures/rum/serve.js`
  4. `attachCdnAssetTracker(app)` + wait for recorder chunk + `waitForRumSdkReady(app)` +
     `driveRumSampleInteractions(app)` — `tests/ui-testing/playwright-tests/utils/rum-traffic.js:93-110`
  5. `waitForStreamRows(app, { sql: "SELECT * FROM \"_rumdata\" WHERE service = '<SERVICE>' AND session_id IS NOT NULL", minRows: 1 })`
     — capture `sessionId` from `sessionRows[0]?.session_id` —
     `tests/ui-testing/playwright-tests/utils/rum-stream-verify.js:53-66`
  6. Replay rows: `waitForStreamRows(app, { sql: "SELECT * FROM \"_sessionreplay\" WHERE session_id = '<sessionId>'", minRows: 1 })`
  - Namespace every run: `const RUN_ID = Date.now(); const SERVICE = 'e2e-rum-share-${RUN_ID}'`.
  - Configure `{ mode: 'serial' }` (module state shared across tests) — same as
    `rum-page-dataflow.spec.js:63`.
  - For the Error-detail share test, the error id is captured from the errors-list query response
    (`latest_error_id`), NOT from the fixture — see `tests/ui-testing/pages/rumPages/rumPage.js:88-126`
    (`clickRunQuery` captures `firstErrorId` / `firstErrorTimestamp` from the `/_search?search_type=RUM`
    response that carries `latest_error_id`).

- **Navigation helpers (copy, don't re-invent):**
  - Errors list: `pm.rumPage.gotoErrorsList({ period: '1h' })` — `tests/ui-testing/pages/rumPages/rumPage.js:217-229`
  - Sessions list: `pm.rumSessionsPage.gotoSessionsList({ service: SERVICE, period: '1h' })` — `tests/ui-testing/pages/rumPages/rumSessionsPage.js:19-28`
  - Performance: `pm.rumPerformancePage.gotoPerformance()` — `tests/ui-testing/pages/rumPages/rumPerformancePage.js:15-20`
  - Session Viewer: `pm.rumSessionsPage.openFirstSession()` → `expectSessionViewerFor(sessionId)` — `rumSessionsPage.js:44-53`
  - Error detail: `pm.rumPage.openFirstError()` (constructs URL from captured `firstErrorId`/`firstErrorTimestamp`) — `rumPage.js:245-250`; or `pm.rumPage.clickFirstErrorRow()` — `rumPage.js:143-165`

- **Auth/org:** use the enhanced fixtures — `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
  Org `ORG = process.env.ORGNAME || 'default'`; deep links must include `?org_identifier=<org>`.
  Auth state is pre-saved (`utils/auth/user.json`); the `context` fixture also grants
  `clipboard-read`/`clipboard-write` (required for the clipboard assertion below).

## Preconditions / toggles

- **`ZO_WEB_URL` must be configured in the environment.** The share button is `:disabled` when
  `store.state.zoConfig.web_url` is empty (`ShareButton.vue:126-129`). CI sets `ZO_WEB_URL`; if a
  local run has it unset, every share assertion fails on a disabled button. Do NOT write a fallback —
  assert the precondition is met or `test.skip`.
- **Chromium only.** `playwright.config.js` defines a single `chromium` project (WebKit commented
  out). The Safari polling branch of `ShareButton` is untestable here — park it as `test.fixme`; do
  not attempt to force a WebKit run.
- **Keyboard shortcut** (`Ctrl/Cmd+Shift+C`) is registered only on Errors (`rumErrorsCopyUrl`) and
  Sessions (`rumSessionsCopyUrl`) lists; not on Performance / Session Viewer / Error detail.

## Clipboard assertion (proven pattern)

- Read clipboard via `await page.evaluate(() => navigator.clipboard.readText())`; assert it matches
  `/\/web\/short\/[a-f0-9]{16}\?org_identifier=/` (16-char md5 short-hash id). The clipboard
  permissions are granted by the project config (`playwright.config.js:84`) AND the enhanced
  `context` fixture (`enhanced-baseFixtures.js:36`), so `readText()` resolves.
- Success toast: match by attribute, `.first()` to tolerate stacked toasts —
  `[data-test-variant="success"][data-test-message*="Link Copied Successfully!"]`
  (pattern from `tests/ui-testing/pages/logsPages/logsPage.js:7277-7279`). The toast carries the
  message in `data-test-message`; do not use `getByText` (strict-mode + stacked-toast flake).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **RUM pages render nothing until RUM is enabled.** `RealUserMonitoring.vue:290-317` gates on
  `getStream("_rumdata")` returning `name === "_rumdata"`. On a fresh instance with no RUM data,
  the share buttons don't exist at all — the fixture ingestion (above) is what makes them appear.
- **Sessions toolbar additionally needs `_sessionreplay`.** `AppSessions.vue:19` wraps the whole
  toolbar in `v-if="isSessionReplayEnabled"`. If the CDN recorder chunk never loaded
  (`replayCapable === false`), no session carries `session_has_replay` and the Sessions share button
  is unreachable → `test.skip(!replayCapable, ...)` like `rum-page-dataflow.spec.js:169`.
- **Errors list fans out 5 parallel `_search` calls.** Don't match the share action against a bare
  `/_search` response — use the issues-list predicate keyed on `latest_error_id`
  (`rumPage.js:95-110`).
- **Schema arrives async.** Only click share after the target toolbar button is `visible` (the page's
  `onMounted` awaits `getStreamFields()` before the query runs). Assert `toBeVisible()` on the share
  selector with a generous timeout rather than assuming it exists immediately after `goto`.
- **Spec directory is `RUM` (uppercase).** The run-context `spec_path` says `.../Rum/rumShareLink.spec.js`
  but the on-disk directory is `tests/ui-testing/playwright-tests/RUM/`. Write the spec there.
- **Short link idempotency.** Re-clicking share on an unchanged page returns the SAME short id (md5 of
  the original URL); changing any filter/date changes the link. If the test asserts link uniqueness,
  it must first change a query-affecting control.
