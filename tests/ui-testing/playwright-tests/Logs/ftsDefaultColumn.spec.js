const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

test.describe("FTS Default Column Selection testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page with fresh state
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Ensure quick mode is OFF — FTS auto-pick only fires in standard view
    await pm.logsPage.ensureQuickModeState(false);
    testLogger.info('Test setup completed');
  });

  // =========================================================================
  // P0 — Core auto-pick and SQL bypass
  // =========================================================================

  test("should auto-pick an FTS default column on fresh navigation", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P0-1: Fresh navigation auto-picks an FTS default column');

    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    testLogger.info('TC-P0-1 completed');
  });

  test("should render source column in SQL mode (no FTS auto-pick)", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P0-2: SQL mode skips FTS auto-pick — renders source column');

    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectSourceColumnVisible();

    testLogger.info('TC-P0-2 completed');
  });

  // =========================================================================
  // P1 — User override and reset
  // =========================================================================

  test("should clear system-pick flag when user adds a field and user choice persists", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P1-1: User column action clears system-pick flag and user choice persists');

    // Step 1: Establish auto-pick state
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    // Step 2: Filter field list and add a user-chosen field
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_container_name");
    await pm.logsPage.hoverOnFieldExpandButton("kubernetes_container_name");
    await pm.logsPage.clickAddFieldToTableButton("kubernetes_container_name");

    // Step 3: Assert the user's field is now in the table header
    await pm.logsPage.expectFieldInTableHeader("kubernetes_container_name");

    // Step 4: Re-run query and assert user choice persists (not overwritten by auto-pick)
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFieldInTableHeader("kubernetes_container_name");

    testLogger.info('TC-P1-1 completed');
  });

  test("should re-enable auto-pick after resetting selected fields", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P1-2: Reset selected fields brings back auto-pick on next search');

    // Step 1: Establish user-selected columns state (build on P1-1 pattern)
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    // Add a user field to clear the system-pick flag
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_container_name");
    await pm.logsPage.hoverOnFieldExpandButton("kubernetes_container_name");
    await pm.logsPage.clickAddFieldToTableButton("kubernetes_container_name");
    await pm.logsPage.expectFieldInTableHeader("kubernetes_container_name");

    // Step 2: Click the field list reset icon
    await pm.logsPage.clickClearButton();

    // Step 3: Assert user field is gone from table header
    await pm.logsPage.expectFieldNotInTableHeader("kubernetes_container_name");

    // Step 4: Re-run query — auto-pick should re-fire
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    testLogger.info('TC-P1-2 completed');
  });

  // =========================================================================
  // P2 — Edge cases
  // =========================================================================

  test("should re-evaluate auto-pick after reset filters", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P2-1: Reset filters button clears auto-pick and re-evaluates on next search');

    // Step 1: Establish auto-pick state
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    // Step 2: Click "Reset Filters" button
    await pm.logsPage.clickResetFiltersButton();

    // Step 3: Re-run query — auto-pick should re-evaluate
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    testLogger.info('TC-P2-1 completed');
  });

  test("should drop auto-pick column when entering SQL mode", {
    tag: ['@fts-default-column', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('TC-P2-2: Entering SQL mode with active system-pick drops the auto-pick column');

    // Step 1: Establish auto-pick state
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectFTSDefaultColumnActive();

    // Step 2: Toggle SQL mode ON
    await pm.logsPage.clickSQLModeToggle();

    // Step 3: Re-run query — source column should render instead
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectSourceColumnVisible();

    testLogger.info('TC-P2-2 completed');
  });
});
