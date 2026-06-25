const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
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

    // Navigate to logs page and select stream
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream("e2e_automate");

    // Set time range to Last 15 minutes and disable Quick Mode
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.ensureQuickModeState(false);

    // Run initial query to trigger FTS default auto-pick
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

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

    // At least one FTS column header should be visible.
    // message has higher FTS_PRIORITY than log; try message first, fall back to log.
    let ftsField = null;
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 15000);
      ftsField = 'message';
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 15000);
      ftsField = 'log';
    }

    // The FTS cell content in row 0 must be non-empty.
    await pm.logsPage.expectLogTableColumnVisible(ftsField, 0);

    testLogger.info('TC-FTS-001 completed: FTS column auto-picked');
  });

  test("should keep user-chosen field and stop FTS re-injection after explicit field toggle", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-002: verifying user field toggle stops FTS re-injection');

    // Verify FTS default column is active (message or log)
    let ftsField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      ftsField = 'log';
    }

    // Add a non-FTS field from the sidebar: kubernetes_container_name
    // addFieldToTable is additive — it does not remove existing columns,
    // but clears isFtsDefaultColumn so the FTS resolver will not overwrite
    // the user's explicit selection on the next search.
    const userField = 'kubernetes_container_name';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    // Allow field search to filter
    await page.waitForTimeout(500);
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
    let firstField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      firstField = 'log';
    }

    // Change time range and run another search — use page-object method
    await pm.logsPage.clickRelativeTimeButton('1-h');
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // FTS column must still be present (re-resolved; could be same or different field)
    let secondField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      secondField = 'log';
    }

    // The FTS column cell content must be non-empty
    await pm.logsPage.expectLogTableColumnVisible(secondField, 0);

    testLogger.info('TC-FTS-003 completed: FTS default re-resolved');
  });

  test("should reset clear FTS default and re-resolve on new search", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-004: verifying reset clears FTS default');
    test.fixme(
      'Reset button (SearchBar.vue:4016 resetFilters) only clears query/filters, not selectedFields. ' +
      'The resetSelectedFileds fn (IndexList.vue:870) exists but is wired to @reset-fields from the ' +
      'FieldsList bottom component, not the SearchBar Reset button. See #fts-reset-fields-gap',
    );

    // Verify FTS default column is active
    let ftsField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      ftsField = 'log';
    }

    // Click Reset
    await pm.logsPage.clickResetFiltersButton();

    // After reset, the FTS column header must be gone
    await pm.logsPage.expectFieldNotInTableHeader(ftsField);

    // Run query again: FTS default must re-appear
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // The FTS column must be back
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 15000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 15000);
    }

    testLogger.info('TC-FTS-004 completed: reset cleared and FTS re-resolved');
  });

  test("should not apply FTS default in SQL mode", {
    tag: ['@ftsDefaultColumn', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-FTS-005: verifying FTS default not applied in SQL mode');

    // Verify FTS default column is active in non-SQL mode
    let ftsField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      ftsField = 'log';
    }

    // Toggle SQL mode ON
    await pm.logsPage.clickSQLModeToggle();

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
    let ftsField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      ftsField = 'log';
    }

    // Close the FTS column via the X button on its header
    await pm.logsPage.clickCloseColumnButton(ftsField);

    // Verify column is gone
    await pm.logsPage.expectFieldNotInTableHeader(ftsField);

    // Run query again: FTS default must re-resolve
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults(30000);

    // The FTS column must reappear (could be same or different field)
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 15000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 15000);
    }

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
    let ftsField = 'message';
    try {
      await pm.logsPage.expectFieldInTableHeader('message', 10000);
    } catch {
      await pm.logsPage.expectFieldInTableHeader('log', 10000);
      ftsField = 'log';
    }
    await pm.logsPage.clickCloseColumnButton(ftsField);
    await pm.logsPage.expectFieldNotInTableHeader(ftsField);

    // Now add a user-pinned field
    const userField = 'kubernetes_container_name';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    await page.waitForTimeout(500);
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
});
