const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier, isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: "serial", timeout: 5 * 60 * 1000 });

const { ingestTestData: ingestion } = require('../utils/data-ingestion.js');

test.describe("Unflattened testcases", () => {
  let pageManager;
  function removeUTFCharacters(text) {
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  // ── Time budget ───────────────────────────────────────────────────────────
  // beforeEach + body + afterEach all share ONE Playwright timeout. The waits
  // below used to be sized in isolation and optimistically — a 90s + 120s
  // readiness gate, then up to 3 scan attempts each fronted by a fresh
  // navigation and a 60s + 120s query wait — so their sum could exceed the
  // whole budget several times over. When it did, Playwright killed the test in
  // the middle of whatever it was doing and reported
  // "page.goto: Target page, context or browser has been closed" — the symptom
  // of the kill, not the cause. Every long wait is now clamped to the time
  // actually left, so a slow backend produces a diagnostic failure while the
  // browser is still alive, and the honest path has room to finish.
  let testStartedAt = 0;

  // Held back so each test's "toggle Store Original Data back OFF" cleanup can
  // always run; leaving the stream with the flag ON leaks into the next test in
  // this serial file.
  const CLEANUP_RESERVE_MS = 45000;

  // A scan attempt costs a row sweep plus, on a miss, a fresh navigation and a
  // full re-query. Only start another round when at least this much is left.
  const SCAN_ATTEMPT_COST_MS = 90000;

  function msLeft(reserve = CLEANUP_RESERVE_MS) {
    const budget = test.info().timeout;
    if (!budget) return Number.MAX_SAFE_INTEGER; // timeout disabled
    return budget - (Date.now() - testStartedAt) - reserve;
  }

  function clampToBudget(preferred, { min = 10000, reserve = CLEANUP_RESERVE_MS } = {}) {
    return Math.max(min, Math.min(preferred, msLeft(reserve)));
  }

  async function applyQueryButton(page) {
    // runQueryAndWaitForResults already handles an in-flight auto-search internally:
    // it waits for the button to exit the "Cancel" state before clicking, and if the
    // state never clears it cancels and re-clicks Run itself. The old double-click
    // wrapper (3s sleep + run + 1s sleep + run) duplicated that logic and added ~5s
    // of fixed sleep to every call.
    await pageManager.logsPage.runQueryAndWaitForResults(clampToBudget(60000, { min: 20000 }));

    // Up to 2 minutes: cloud re-indexing after Store Original Data changes takes
    // longer than the default 30s — but never longer than the budget left.
    await pageManager.logsPage.waitForSearchResults(clampToBudget(120000, { min: 20000 }));
  }

  // Re-run the log search from a FRESH page load so the row scan below sees a
  // complete, freshly-ordered result set. Re-clicking Run in place does not
  // recover a stale/partial streaming result set (ZO_STREAMING_ENABLED delivers
  // hits over a WebSocket that can lag the HTTP _search readiness gate) — the
  // only reliable recovery is a new navigation + query, which is exactly what the
  // whole-test Playwright retry does when it succeeds. This reproduces that here
  // without re-ingesting, so it stays cheap. Pass sqlSelectAll for the quick-mode
  // test, whose intent is specifically a `SELECT *` query (a plain reload would
  // otherwise fall back to the quick-mode interesting-fields-only query).
  async function runFreshLogSearch(page, { sqlSelectAll = false } = {}) {
    await page.goto(
      `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}&stream_type=logs&stream=e2e_automate`,
      { waitUntil: 'domcontentloaded', timeout: clampToBudget(45000, { min: 15000 }) }
    );
    if (sqlSelectAll) {
      await pageManager.logsPage.typeQuery('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC');
      await pageManager.logsPage.waitForQueryEditorValue('ORDER BY _timestamp DESC');
    }
    await applyQueryButton(page);
  }

  // Backend readiness gate for _o2_id. A single budget-bounded wait: the old
  // 90s-then-120s pair could consume 210s of a 300s test on its own, leaving
  // nothing for the UI work it was supposed to be preparing.
  async function waitForO2IdReady() {
    const ready = await pageManager.unflattenedPage.waitForO2IdQueryable({
      timeout: clampToBudget(90000, { min: 20000 }),
    });
    if (ready) {
      testLogger.info('_o2_id confirmed queryable via search API');
    } else {
      testLogger.warn('_o2_id readiness gate timed out — the UI scan below is unlikely to find it');
    }
    return ready;
  }

  // Scan the rendered log rows for _o2_id, leaving the detail drawer open on the
  // matching row. A miss means UI/streaming lag, which only a fresh navigation +
  // re-query recovers (re-clicking Run in place does not recover a stale/partial
  // streaming result set), so each retry costs a full search — hence the budget
  // check before starting another one.
  async function scanForO2IdOrFail(page, { sqlSelectAll = false, backendReady = true, reserve = CLEANUP_RESERVE_MS } = {}) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const matchedRow = await pageManager.unflattenedPage.findRowWithO2Id(15, {
        deadlineAt: Date.now() + clampToBudget(45000, { min: 15000, reserve }),
      });
      if (matchedRow !== -1) {
        testLogger.info(`Found _o2_id in row ${matchedRow} (attempt ${attempt})`);
        await pageManager.unflattenedPage.o2IdText.click();
        return;
      }

      testLogger.warn(`_o2_id not found in the scanned rows on attempt ${attempt}`);
      await pageManager.unflattenedPage.closeLogDetailDrawerIfOpen();

      // A fresh search only fixes UI-side staleness. If the backend never
      // surfaced _o2_id, retrying the UI cannot help — it just burns the budget
      // until Playwright kills the test mid-action.
      if (!backendReady) break;
      if (attempt === 3) break;
      if (msLeft(reserve) < SCAN_ATTEMPT_COST_MS) {
        testLogger.warn('Not enough test budget left for another scan attempt');
        break;
      }
      testLogger.info('Re-running the query from a fresh page before the next scan');
      await runFreshLogSearch(page, { sqlSelectAll });
    }

    // Diagnostic: dump what the first row actually does contain. Skipped when
    // the budget is nearly gone — being killed here would replace the useful
    // error below with an opaque "browser has been closed".
    if (msLeft(0) > 30000) {
      try {
        await pageManager.unflattenedPage.openLogRowDetail(0);
        const allKeys = await pageManager.unflattenedPage.allLogDetailKeys.allTextContents();
        testLogger.error('Available fields in log detail', { fields: allKeys });
      } catch (e) {
        testLogger.error('Could not retrieve available fields');
      }
    }

    throw new Error(
      'Failed to find _o2_id field in log details' +
      (backendReady
        ? ''
        : ' — the search API never returned a record containing _o2_id, so "Store Original Data" had not taken effect on the backend') +
      ` (${Math.round(Math.max(0, msLeft(0)) / 1000)}s of test budget left)`
    );
  }

  test.beforeEach(async ({ page }) => {
    testStartedAt = Date.now();
    pageManager = new PageManager(page);
    if (isCloudEnvironment()) {
      await navigateToBase(page);
    } else {
      await pageManager.loginPage.gotoLoginPage();
      await pageManager.loginPage.loginAsInternalUser();
      await pageManager.loginPage.login();
    }
    await page.waitForLoadState('domcontentloaded');
    await ingestion(page);
    // Wait for the stream to actually be queryable instead of a blind 2s sleep —
    // deterministic (usually instant once the stream exists) and more tolerant on
    // slow CI runners than a fixed pause.
    await pageManager.logsPage.waitForStreamAvailable('e2e_automate', 30000, 1000);

    // Check and disable Store Original Data if it's enabled.
    // Navigate directly to the streams URL with the correct org — clicking the
    // sidebar link would use the Pinia store's active org which may still be _meta.
    testLogger.info('Navigating to Streams page with correct org');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 15000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Checking Store Original Data toggle state');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 15000 });

    const wasDisabled = await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();
    if (wasDisabled) {
      testLogger.info('Store Original Data was enabled, disabled it successfully');
    } else {
      testLogger.info('Store Original Data is already disabled');
    }

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();
    await page.waitForTimeout(500);

    // Leave the browser on the logs page with e2e_automate selected. Two costs
    // were removed here because nothing in either test consumes their result:
    //  - the trailing search (up to 180s of query waiting) — both tests navigate
    //    straight back to Streams from here;
    //  - the explicit goto, since selectStream navigates to the logs page itself.
    // apiWaitMs=0 also skips selectStream's own stream-availability poll (up to
    // 120s on cloud) — waitForStreamAvailable above already established that.
    await pageManager.logsPage.selectStream("e2e_automate", 5, 0);
  });

  test.afterEach(async ({ page }) => {
    // await pageManager.commonActions.flipStreaming();
  });

  test("stream to toggle store original data toggle and display o2 id", {
    tag: ['@unflattened', '@logs', '@all'],
    timeout: 5 * 60 * 1000,
  }, async ({ page }) => {
    testLogger.info('Starting test: toggle store original data and display o2 id');

    // Navigate directly — sidebar click uses Pinia store org which may still be _meta
    testLogger.info('Navigating to Streams page');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Enabling Store Original Data toggle');
    const wasDisabled = await pageManager.unflattenedPage.ensureStoreOriginalDataEnabled();
    testLogger.info(wasDisabled ? 'Store Original Data enabled' : 'Store Original Data was already enabled');

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);

    // Deterministic readiness gate: poll the search API until _o2_id is queryable
    // instead of sleeping a fixed interval and hoping indexing has caught up.
    // This is what makes the UI scan below succeed on the first attempt.
    testLogger.info('Waiting for _o2_id to become queryable via search API');
    const o2idReady = await waitForO2IdReady();

    // Navigate directly with stream in URL — selectStream would deselect it because
    // the Pinia store already has e2e_automate selected from beforeEach
    testLogger.info('Navigating to logs with e2e_automate stream');
    await page.goto(
      `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}&stream_type=logs&stream=e2e_automate`,
      { waitUntil: 'domcontentloaded', timeout: clampToBudget(45000, { min: 15000 }) }
    );
    await applyQueryButton(page);
    testLogger.info('Search query applied, logs should now contain _o2_id field');

    testLogger.info('Searching log rows for _o2_id field');
    await scanForO2IdOrFail(page, { backendReady: o2idReady });

    testLogger.info('Switching to unflattened tab');
    await pageManager.unflattenedPage.unflattenedTab.waitFor();
    await pageManager.unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(500);

    testLogger.info('Closing log detail dialog');
    await pageManager.unflattenedPage.closeDialog.waitFor();
    await pageManager.unflattenedPage.closeDialog.click();

    // Cleanup: Toggle Store Original Data back OFF
    testLogger.info('Cleanup: Toggling Store Original Data back OFF');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();
    testLogger.info('Store Original Data confirmed OFF — test completed successfully');
  });


  test("stream to display o2 id when quick mode is on and select * query is added", {
    tag: ['@unflattened', '@logs', '@all'],
    timeout: 5 * 60 * 1000,
  }, async ({ page }) => {
    testLogger.info('Starting test: display o2 id with quick mode and SELECT * query');

    testLogger.info('Navigating to Streams page');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');

    // Wait for stream details sidebar to fully open and load
    await page.waitForTimeout(2000);
    testLogger.info('Stream details sidebar opened');

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    testLogger.info('Configuration tab clicked, waiting for content to load');
    await page.waitForTimeout(1000);

    testLogger.info('Waiting for Store Original Data toggle to be visible');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 5000 });

    // Ensure Store Original Data is enabled
    const wasEnabled = await pageManager.unflattenedPage.ensureStoreOriginalDataEnabled();
    if (wasEnabled) {
      testLogger.info('Store Original Data was disabled, enabled it successfully');
    } else {
      testLogger.info('Store Original Data is already enabled');
    }

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);

    // Deterministic readiness gate: poll the search API until _o2_id is queryable
    // instead of a fixed 15s sleep + UI re-ingestion retry loop. This was the
    // dominant source of the timeout flake on contended CI runners.
    testLogger.info('Waiting for _o2_id to become queryable via search API');
    const o2idReady = await waitForO2IdReady();

    // Navigate directly with stream in URL — selectStream would deselect it because
    // the Pinia store already has e2e_automate selected from beforeEach
    testLogger.info('Navigating to logs with e2e_automate stream');
    await page.goto(
      `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}&stream_type=logs&stream=e2e_automate`,
      { waitUntil: 'domcontentloaded', timeout: clampToBudget(45000, { min: 15000 }) }
    );

    testLogger.info('Ensuring Quick Mode is on');
    await pageManager.logsPage.ensureQuickModeState(true);
    await page.waitForTimeout(500);

    await applyQueryButton(page);
    testLogger.info('Search query applied, logs should now contain _o2_id field');

    testLogger.info('Opening all fields panel');
    await pageManager.unflattenedPage.allFieldsButton.waitFor();
    await pageManager.unflattenedPage.allFieldsButton.click();

    testLogger.info('Searching for field: kubernetes_pod_id');
    await pageManager.unflattenedPage.indexFieldSearchInput.waitFor();
    await pageManager.unflattenedPage.indexFieldSearchInput.fill("kubernetes_pod_id");
    await page.waitForTimeout(500);

    testLogger.info('Selecting kubernetes_pod_id field');
    await pageManager.unflattenedPage.clickInterestingFieldButton('kubernetes_pod_id');

    testLogger.info('Waiting for kubernetes_pod_id to be marked as interesting (button title flips to "Remove…")');
    await pageManager.unflattenedPage.expectFieldMarkedAsInteresting('kubernetes_pod_id');

    testLogger.info('Switching to SQL mode');
    await pageManager.unflattenedPage.toggleSqlMode();
    await page.waitForTimeout(500);

    testLogger.info('Verifying kubernetes_pod_id appears in query editor');
    await pageManager.unflattenedPage.expectQueryEditorContainsText(/kubernetes_pod_id/);

    testLogger.info('Replacing query with SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC');
    await pageManager.logsPage.typeQuery('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC');

    // Wait for Monaco to commit the typed query to the Vue store before clicking Run.
    // Without this the click can race the editor debounce and re-run the PREVIOUS
    // (quick-mode fields-only) query, whose hits never contain _o2_id — dooming the
    // row scan below and burning the whole 5-minute test budget (CI flake).
    await pageManager.logsPage.waitForQueryEditorValue('ORDER BY _timestamp DESC');

    testLogger.info('Executing SELECT * query to fetch fresh data with _o2_id');
    await applyQueryButton(page);

    testLogger.info('Searching log rows for _o2_id field');
    // With ORDER BY _timestamp DESC the newest rows come first (the fixture carries
    // no _timestamp, so the Store-Original-Data re-ingest is genuinely newest).
    // Larger reserve than the default: this test's tail does a third ingestion and
    // a full explorer walk after the cleanup toggle, so it needs more budget kept back.
    await scanForO2IdOrFail(page, { sqlSelectAll: true, backendReady: o2idReady, reserve: 90000 });

    await page.waitForTimeout(500);
    testLogger.info('Switching to unflattened tab');
    await pageManager.unflattenedPage.unflattenedTab.waitFor();
    await pageManager.unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(500);

    testLogger.info('Closing log detail dialog');
    await pageManager.unflattenedPage.closeDialog.waitFor();
    await pageManager.unflattenedPage.closeDialog.click();

    testLogger.info('Toggling Store Original Data back OFF to clean up');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();

    testLogger.info('Closing dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    await page.waitForTimeout(500);
    testLogger.info('Ingesting data with Store Original Data OFF');
    await ingestion(page);
    testLogger.info('Data ingestion completed, waiting 3s for indexing');
    await page.waitForTimeout(3000);

    testLogger.info('Navigating to logs explorer');
    await pageManager.unflattenedPage.exploreButton.waitFor();
    await pageManager.unflattenedPage.exploreButton.click();
    await page.waitForTimeout(1000);

    testLogger.info('Opening date/time picker');
    await pageManager.unflattenedPage.dateTimeButton.waitFor();
    await pageManager.unflattenedPage.dateTimeButton.click();

    testLogger.info('Selecting relative time range');
    await pageManager.unflattenedPage.relativeTab.waitFor();
    await pageManager.unflattenedPage.relativeTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Verifying timestamp field is visible (final verification)');
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();

    testLogger.info('Opening log source details');
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1500);

    testLogger.info('Waiting for log detail panel to load');
    await pageManager.unflattenedPage.logDetailJsonContent.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(1000);

    testLogger.info('Looking for timestamp dropdown in log details');
    await pageManager.unflattenedPage.timestampDropdown.waitFor({ state: "visible", timeout: 10000 });
    await pageManager.unflattenedPage.timestampDropdown.click();
    testLogger.info('Test completed successfully');
});


})
