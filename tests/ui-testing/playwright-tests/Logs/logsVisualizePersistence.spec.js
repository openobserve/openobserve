const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ----- Helpers -----

async function ingestTestData(page) {
  await _ingestData(page);
}

// ----- Test Suite -----

test.describe("Logs Visualization State Persistence testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ===== P0 — Critical path: tab toggle persists across side-navigation =====

  test("should persist Visualize tab after navigating away and returning", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Click Visualize toggle.
    await pm.logsPage.clickVisualizeToggle();

    // 3. Verify Visualize tab content is loaded and Logs search result is NOT visible.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Visualize tab content is still visible (NOT the Logs table).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('Visualize tab persistence test completed');
  });

  test("should persist Build tab after navigating away and returning", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Build tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Click Build toggle.
    await pm.logsPage.clickBuildToggle();

    // 3. Verify Build query page is visible and Logs table is NOT.
    await pm.logsPage.expectBuildQueryPageVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Build query page is still visible.
    await pm.logsPage.expectBuildQueryPageVisible();

    testLogger.info('Build tab persistence test completed');
  });

  test("should persist default Logs tab after navigating away (no toggle change)", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing default Logs tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 3. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 4. Assert Logs tab is active and search results visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    testLogger.info('Default Logs tab persistence test completed');
  });

  // ===== P1 — Important variations =====

  test("should persist Logs tab after switching Visualize → Logs then navigating", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize-to-Logs toggle persistence');

    // 1. Verify Logs table visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Switch to Visualize.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();

    // 3. Switch back to Logs.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Logs tab restored.
    await pm.logsPage.expectLogsSearchResultVisible();

    testLogger.info('Visualize-to-Logs toggle persistence test completed');
  });

  test("should persist stream selection after page reload", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing stream selection persistence after page reload');

    // 1. Verify stream is selected and results visible (done in beforeEach).

    // 2. Reload the page.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 3. Assert e2e_automate is pre-selected in the stream dropdown.
    await pm.logsPage.expectStreamSelectorContainsText("e2e_automate");

    testLogger.info('Stream selection persistence test completed');
  });

  test("should persist live mode / auto-run toggle across navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing live mode persistence across navigation');

    // 1. Verify Logs table visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Enable live mode (auto-run).
    await pm.logsPage.logsQueryPage.enableAutoRun();

    // Guard: confirm the toggle actually activated before navigating away.
    // If auto_query_enabled is false, _toggleAutoRun silently returns and
    // this assertion catches the no-op so the test doesn't false-pass.
    await pm.logsPage.expectLiveModeStatusVisible();
    testLogger.info('Live mode confirmed active before navigation');

    // 3. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 4. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 5. Assert that the live-mode refresh-interval button is visible (indicates live mode active).
    await pm.logsPage.expectLiveModeStatusVisible();
    testLogger.info('Live mode is still active after navigation');

    testLogger.info('Live mode persistence test completed');
  });

  test("should persist Visualize tab as last selected after full toggle cycle (Logs → Build → Visualize)", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing full toggle cycle persistence (Logs → Build → Visualize)');

    // 1. Verify Logs tab active.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Switch to Build.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.expectBuildQueryPageVisible();

    // 3. Switch to Visualize.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Visualize tab is active (NOT Build, NOT Logs).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();
    await pm.logsPage.expectBuildQueryPageNotVisible();

    testLogger.info('Full toggle cycle persistence test completed');
  });

  // ===== P2 — Edge cases / nice-to-have =====

  test("should disable Visualize toggle when multiple streams are selected", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize toggle disabled with multi-stream selection');

    // 1. Add _rumdata to the current selection (e2e_automate already selected in beforeEach).
    await pm.logsPage.addStreamToSelection('_rumdata');

    // 2. Run query to load results.
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 3. Assert Visualize toggle is disabled.
    await pm.logsPage.expectVisualizeToggleDisabled();

    testLogger.info('Visualize toggle disabled test completed');
  });

  test("should restore Visualize tab via URL param on direct navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize tab restoration via URL param');

    // 1. Navigate directly to logs page with visualize toggle param.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}&logs_visualize_toggle=visualize`
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2. Assert Visualize tab content is visible on first load.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('URL param Visualize tab restoration test completed');
  });

  test("should restore Build tab via URL param on direct navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Build tab restoration via URL param');

    // 1. Navigate directly to logs page with build toggle param.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}&logs_visualize_toggle=build`
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2. Assert Build query page is visible on first load.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('URL param Build tab restoration test completed');
  });

  test("should render toggle group buttons (not dropdown) at wide viewport", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing toggle group rendering at wide viewport');

    // 1. Verify Logs table visible (pre-condition from beforeEach).

    // 2. Assert all three toggle buttons are visible.
    await pm.logsPage.expectAllToggleButtonsVisible();

    // 3. Assert the view-mode dropdown fallback is NOT visible.
    await pm.logsPage.expectViewModeDropdownNotVisible();

    testLogger.info('Toggle group rendering test completed');
  });
});
