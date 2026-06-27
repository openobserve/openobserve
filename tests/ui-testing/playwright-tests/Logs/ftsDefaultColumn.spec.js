/**
 * FTS Default Column Selection — E2E suite
 *
 * Verifies how the Logs results table auto-picks a full-text-search (FTS) default
 * column (`message` preferred over `log`) and how that default interacts with
 * explicit user actions:
 *   - auto-pick on first search (TC-FTS-001)
 *   - user-added field is additive and stops FTS re-injection (TC-FTS-002)
 *   - FTS default re-resolves on subsequent searches / time-range changes (TC-FTS-003)
 *   - reset clears the query but preserves the FTS default (TC-FTS-004)
 *   - FTS default is skipped in SQL mode (TC-FTS-005)
 *   - closing the column re-resolves it on the next search (TC-FTS-006)
 *   - FTS default is not injected over user-pinned fields (TC-FTS-007)
 *   - stream change clears FTS and re-resolves for new stream (TC-FTS-008)
 *   - field reset clears FTS default and re-resolves on next search (TC-FTS-009)
 *
 * Regression coverage for openobserve/openobserve#12857.
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData, waitForStreamData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("FTS Default Column Selection testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Ingest standard test data to e2e_automate stream
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    // Gate on the data being searchable (polls the search API) before driving the UI.
    // All tests share the e2e_automate stream and run in parallel, so under worker
    // contention the UI search could fire before the just-ingested rows were queryable,
    // leaving the results table empty and timing out waitForSearchResults.
    await waitForStreamData(page, "e2e_automate", 1, 30000);

    // Navigate to logs page and select stream
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream("e2e_automate");

    // Set time range to Last 15 minutes and disable Quick Mode
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.ensureQuickModeState(false);

    // Run initial query to trigger FTS default auto-pick. The first search response can
    // still lag under parallel-worker load, so retry the refresh a couple of times rather
    // than failing the whole test on a single slow response.
    let resultsReady = false;
    for (let attempt = 1; attempt <= 3 && !resultsReady; attempt++) {
      await pm.logsPage.clickSearchBarRefreshButton();
      resultsReady = await pm.logsPage
        .waitForSearchResults(20000)
        .then(() => true)
        .catch(() => false);
      if (!resultsReady) {
        testLogger.info(`Search results not ready (attempt ${attempt}/3), retrying refresh...`);
      }
    }
    expect(resultsReady, 'Search results did not render after retries').toBe(true);

    testLogger.info('FTS default column test setup completed');
  });

  // -----------------------------------------------------------------------
  // P0 – Core happy path
  // -----------------------------------------------------------------------

  test("should auto-pick FTS column on first search with no prior selection", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-001: verifying FTS column auto-picked on first search');

    // Results must have rendered
    await pm.logsPage.expectLogTableColumnSourceVisible();

    // At least one FTS column header should be visible (message preferred over log).
    const ftsField = await pm.logsPage.resolveFtsDefaultField(15000);

    // The FTS cell content in row 0 must be non-empty.
    await pm.logsPage.expectLogTableColumnVisible(ftsField, 0);

    testLogger.info('TC-FTS-001 completed: FTS column auto-picked');
  });

  test("should keep user-chosen field and stop FTS re-injection after explicit field toggle", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-002: verifying user field toggle stops FTS re-injection');

    // Verify FTS default column is active (message or log)
    const ftsField = await pm.logsPage.resolveFtsDefaultField(10000);

    // Add a non-FTS field from the sidebar: kubernetes_container_name
    // addFieldToTable is additive — it does not remove existing columns,
    // but clears isFtsDefaultColumn so the FTS resolver will not overwrite
    // the user's explicit selection on the next search.
    const userField = 'kubernetes_container_name';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    // hoverOnFieldExpandButton waits for the field's expand button to be visible,
    // which is the real signal that the sidebar field search has filtered.
    await pm.logsPage.hoverOnFieldExpandButton(userField);
    await pm.logsPage.clickAddFieldToTableButton(userField);

    // After adding a user field, both the FTS column and the user field
    // must be present (addFieldToTable is additive, not a replacement).
    await pm.logsPage.expectFieldInTableHeader(ftsField);
    await pm.logsPage.expectFieldInTableHeader(userField);

    // Re-run query: user field must persist; FTS default column also persists
    // because it was never removed, but no new FTS column is injected.
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectFieldInTableHeader(userField);
    await pm.logsPage.expectFieldInTableHeader(ftsField);

    // Assert the other FTS candidate was NOT re-injected — this is what
    // "stop FTS re-injection" actually means: the resolver should not
    // inject a new FTS column on top of the user's explicit selection.
    const otherField = ftsField === 'message' ? 'log' : 'message';
    await pm.logsPage.expectFieldNotInTableHeader(otherField);

    testLogger.info('TC-FTS-002 completed: user toggle additive, FTS re-injection stopped');
  });

  // -----------------------------------------------------------------------
  // P1 – Important variations
  // -----------------------------------------------------------------------

  test("should re-resolve FTS default on subsequent searches", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-003: verifying FTS default re-resolves on new search');

    // Verify FTS default column is active
    await pm.logsPage.resolveFtsDefaultField(10000);

    // Change time range and confirm it took effect before re-running the search
    await pm.logsPage.clickRelativeTimeButton('1-h');
    await pm.logsPage.verifySchedule(/1\s*Hour/i);
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // FTS column must still be present (re-resolved; could be same or different field)
    const secondField = await pm.logsPage.resolveFtsDefaultField(10000);

    // The FTS column cell content must be non-empty
    await pm.logsPage.expectLogTableColumnVisible(secondField, 0);

    testLogger.info('TC-FTS-003 completed: FTS default re-resolved');
  });

  test("should clear the query via Reset Filters while preserving the FTS default column", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-004: verifying Reset Filters clears the query but keeps the FTS column');

    // The toolbar "Reset Filters" button (SearchBar.vue resetFilters) intentionally clears
    // only the query/filters — it does NOT clear selectedFields / isFtsDefaultColumn. Column
    // selections are reset separately via the FieldsList @reset-fields handler
    // (IndexList.vue resetSelectedFileds), which is not wired to this button. So the correct,
    // expected behavior is: Reset clears the query, and the FTS default column persists.

    // Verify FTS default column is active
    const ftsField = await pm.logsPage.resolveFtsDefaultField(10000);

    // Enter a query filter so Reset has something to clear
    await pm.logsPage.typeQuery("match_all('test')");
    expect(await pm.logsPage.getQueryEditorText()).toContain('match_all');

    // Click Reset Filters
    await pm.logsPage.clickResetFiltersButton();

    // The query must be cleared...
    await expect
      .poll(async () => (await pm.logsPage.getQueryEditorText())?.trim() || '', {
        timeout: 10000,
      })
      .toBe('');

    // ...but the FTS default column must be preserved (reset does not touch column selection)
    await pm.logsPage.expectFieldInTableHeader(ftsField);

    // Re-run the search: the FTS default column must still be present
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectFieldInTableHeader(ftsField);

    testLogger.info('TC-FTS-004 completed: Reset cleared the query and preserved the FTS column');
  });

  test("should not apply FTS default in SQL mode", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-005: verifying FTS default not applied in SQL mode');

    // Verify FTS default column is active in non-SQL mode
    await pm.logsPage.resolveFtsDefaultField(10000);

    // Toggle SQL mode ON and confirm it actually engaged — otherwise a silently
    // failed toggle would leave FTS mode active and the test would pass for the
    // wrong reason (FTS column gone because we never left FTS mode).
    await pm.logsPage.clickSQLModeToggle();
    expect(
      await pm.logsPage.isSqlModeEnabled(),
      'SQL mode should be active after toggling before asserting FTS removal',
    ).toBe(true);

    // Run the auto-generated SQL query — updateGridColumns (which clears FTS
    // fields when sqlMode && isFtsDefaultColumn) only runs on search response.
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // After SQL mode search, the auto-picked FTS column must be gone
    // (useStreamFields.ts:1094 clears selectedFields when entering SQL mode
    // with an active FTS default).
    await pm.logsPage.expectFieldNotInTableHeader('message');
    await pm.logsPage.expectFieldNotInTableHeader('log');

    testLogger.info('TC-FTS-005 completed: FTS default skipped in SQL mode');
  });

  test("should re-resolve FTS default after closing column and re-running search", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-006: verifying close column + re-run re-resolves FTS default');

    // Verify FTS default column is active
    const ftsField = await pm.logsPage.resolveFtsDefaultField(10000);

    // Close the FTS column via the X button on its header
    await pm.logsPage.clickCloseColumnButton(ftsField);

    // Verify column is gone
    await pm.logsPage.expectFieldNotInTableHeader(ftsField);

    // Run query again: FTS default must re-resolve
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // The FTS column must reappear (could be same or different field)
    await pm.logsPage.resolveFtsDefaultField(15000);

    testLogger.info('TC-FTS-006 completed: close column + re-run re-resolved FTS default');
  });

  // -----------------------------------------------------------------------
  // P2 – Edge cases
  // -----------------------------------------------------------------------

  test("should not inject FTS default when user already has pinned fields", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-007: verifying FTS default not injected over user fields');

    // First, explicitly close the FTS default column so it is no longer
    // in selectedFields. (addFieldToTable is additive — it does not clear
    // the existing FTS column, so we must close it first.)
    const ftsField = await pm.logsPage.resolveFtsDefaultField(10000);
    await pm.logsPage.clickCloseColumnButton(ftsField);
    await pm.logsPage.expectFieldNotInTableHeader(ftsField);

    // Now add a user-pinned field
    const userField = 'kubernetes_container_name';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    // hoverOnFieldExpandButton waits for the field's expand button, i.e. the real
    // signal that the sidebar field search has filtered to our field.
    await pm.logsPage.hoverOnFieldExpandButton(userField);
    await pm.logsPage.clickAddFieldToTableButton(userField);

    // Verify user field is now in the table
    await pm.logsPage.expectFieldInTableHeader(userField);

    // Run a new search
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // User-pinned field must persist
    await pm.logsPage.expectFieldInTableHeader(userField);

    // The FTS default column must NOT be injected
    await pm.logsPage.expectFieldNotInTableHeader('message');
    await pm.logsPage.expectFieldNotInTableHeader('log');

    testLogger.info('TC-FTS-007 completed: FTS default not injected over user fields');
  });

  // -----------------------------------------------------------------------
  // P1 — Stream change and field reset
  // -----------------------------------------------------------------------

  test("should clear FTS selection on stream change and re-resolve for new stream", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-008: verifying stream change clears FTS and re-resolves');

    // Verify FTS default column is active on the current stream (e2e_automate)
    const firstFtsField = await pm.logsPage.resolveFtsDefaultField(10000);
    await pm.logsPage.expectFieldInTableHeader(firstFtsField);

    // Ingest the same test data to a second stream so it has FTS-key fields.
    const secondStream = 'e2e_automate_fts2_tc008';
    await ingestTestData(page, secondStream);
    await page.waitForLoadState('domcontentloaded');
    await waitForStreamData(page, secondStream, 1, 30000);

    // Switch to the second stream (stay on the same page — skipNavigation).
    await pm.logsPage.selectStream(secondStream, 5, null, true);

    // Run a search so the watcher re-resolves FTS for the new stream.
    let resultsReady = false;
    for (let attempt = 1; attempt <= 3 && !resultsReady; attempt++) {
      await pm.logsPage.clickSearchBarRefreshButton();
      resultsReady = await pm.logsPage
        .waitForSearchResults(20000)
        .then(() => true)
        .catch(() => false);
      if (!resultsReady) {
        testLogger.info(`TC-FTS-008 search results not ready (attempt ${attempt}/3), retrying refresh...`);
      }
    }
    expect(resultsReady, 'Search results did not render on second stream').toBe(true);

    // Assert that the FTS default column re-resolved on the new stream.
    const secondFtsField = await pm.logsPage.resolveFtsDefaultField(15000);
    await pm.logsPage.expectLogTableColumnVisible(secondFtsField, 0);

    // Assert that the prior stream's FTS field was NOT carried over
    // (onStreamChange cleared selectedFields & isFtsDefaultColumn).
    if (firstFtsField !== secondFtsField) {
      await pm.logsPage.expectFieldNotInTableHeader(firstFtsField);
    }

    testLogger.info('TC-FTS-008 completed: stream change re-resolved FTS default');
  });

  test("should clear FTS default on field reset and re-resolve on next search", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-009: verifying field reset clears FTS default and re-resolves');

    // Verify FTS default column is active
    const firstFtsField = await pm.logsPage.resolveFtsDefaultField(10000);
    await pm.logsPage.expectFieldInTableHeader(firstFtsField);

    // Click the field-list reset icon — this clears selectedFields and sets
    // isFtsDefaultColumn to false, so the FTS column should disappear from
    // the table immediately.
    await pm.logsPage.clickFieldListResetIcon();

    // After reset, the auto-picked FTS column must be gone.
    await pm.logsPage.expectFieldNotInTableHeader(firstFtsField);

    // Run a search — the watcher sees selectedFields is now empty, and
    // isFtsDefaultColumn was cleared, so canResolveDefault is true and
    // the FTS default re-resolves.
    let resultsReady = false;
    for (let attempt = 1; attempt <= 3 && !resultsReady; attempt++) {
      await pm.logsPage.clickSearchBarRefreshButton();
      resultsReady = await pm.logsPage
        .waitForSearchResults(20000)
        .then(() => true)
        .catch(() => false);
      if (!resultsReady) {
        testLogger.info(`TC-FTS-009 search results not ready (attempt ${attempt}/3), retrying refresh...`);
      }
    }
    expect(resultsReady, 'Search results did not render after field reset').toBe(true);

    // Assert that an FTS default column re-appears (could be same or different field).
    const secondFtsField = await pm.logsPage.resolveFtsDefaultField(15000);
    await pm.logsPage.expectLogTableColumnVisible(secondFtsField, 0);

    testLogger.info('TC-FTS-009 completed: field reset re-resolved FTS default');
  });
});
