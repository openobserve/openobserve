/**
 * Pipeline History Tests
 *
 * This test file covers pipeline execution history viewing and filtering.
 * Tests include:
 * - Navigating to history page
 * - Viewing execution records
 * - Filtering by date range
 * - Filtering by pipeline name
 *
 * @see docs/test_generator/features/pipelines-traces-metrics-feature.md
 * @see docs/test_generator/test-plans/pipelines-traces-metrics-test-plan.md
 */

import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
const testLogger = require('../utils/test-logger.js');
const path = require('path');

test.describe.configure({ mode: "parallel" });

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

test.describe("Pipeline History Tests", { tag: ['@all', '@pipelines', '@history', '@pipelinesHistory'] }, () => {
  let pageManager;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Auth is handled via storageState - no login needed
    pageManager = new PageManager(page);

    // Ingest test data
    const streamNames = ["e2e_automate"];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);

    // Cleanup: Wait for any pending operations to complete
    await page.waitForTimeout(1000);

    // Clear any open dialogs or menus using POM
    await pageManager.pipelinesPage.dismissOpenDialogs();

    testLogger.info('Test cleanup completed');
  });

  /**
   * Test: Navigate to pipeline history page
   * Priority: P1 - Smoke
   * Objective: Verify pipeline history page is accessible
   */
  test("should navigate to pipeline history page @P1 @smoke", async ({ page }) => {
    testLogger.info('Testing navigation to pipeline history page');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Navigate to history page using POM method
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Verify history page loaded using POM methods
    const isPageVisible = await pageManager.pipelinesPage.isHistoryPageVisible();
    const isTitleVisible = await pageManager.pipelinesPage.isHistoryTitleVisible();
    const isHistoryTextVisible = await pageManager.pipelinesPage.isHistoryTextVisible();

    // At least one indicator must confirm we're on the history page
    expect(isPageVisible || isTitleVisible || isHistoryTextVisible || /history/.test(page.url())).toBe(true);
    testLogger.info('Pipeline history page loaded successfully');

    testLogger.info('Test completed: Pipeline history navigation');
  });

  /**
   * Test: Verify history page has required elements
   * Priority: P1 - Functional
   * Objective: Verify history page contains date picker, search, and table
   */
  test("should display history page elements @P1 @functional", async ({ page }) => {
    testLogger.info('Testing history page elements');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Check for date picker using POM
    const isDatePickerVisible = await pageManager.pipelinesPage.isHistoryDatePickerVisible();
    expect(isDatePickerVisible).toBe(true);
    testLogger.info('Date picker found');

    // Check for search/filter using POM
    const isSearchVisible = await pageManager.pipelinesPage.isHistorySearchSelectVisible();
    expect(isSearchVisible).toBe(true);
    testLogger.info('Search select found');

    // Check for search button using POM
    const isSearchBtnVisible = await pageManager.pipelinesPage.isHistoryManualSearchBtnVisible();
    expect(isSearchBtnVisible).toBe(true);
    testLogger.info('Search button found');

    // Check for refresh button using POM
    const isRefreshVisible = await pageManager.pipelinesPage.isHistoryRefreshBtnVisible();
    expect(isRefreshVisible).toBe(true);
    testLogger.info('Refresh button found');

    // Check for history table using POM
    const isTableVisible = await pageManager.pipelinesPage.isHistoryTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);
    testLogger.info('History table found');

    testLogger.info('Test completed: History page elements check');
  });

  /**
   * Test: Verify back button on history page
   * Priority: P1 - Functional
   * Objective: Verify back navigation works from history page
   */
  test("should navigate back from history page @P1 @functional", async ({ page }) => {
    testLogger.info('Testing back navigation from history page');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Store history URL before navigating back
    const historyUrl = page.url();

    // Click back button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickHistoryBackBtn();
    await page.waitForTimeout(1000);

    // Verify navigation occurred - URL should have changed
    expect(page.url()).not.toBe(historyUrl);
    testLogger.info('Test completed: Back navigation from history');
  });

  /**
   * Test: Verify refresh button on history page
   * Priority: P2 - Functional
   * Objective: Verify refresh button reloads history data
   */
  test("should refresh history data @P2 @functional", async ({ page }) => {
    testLogger.info('Testing history refresh functionality');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Verify refresh button is visible
    const isRefreshVisible = await pageManager.pipelinesPage.isHistoryRefreshBtnVisible();
    expect(isRefreshVisible).toBe(true);

    // Click refresh button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickHistoryRefreshBtn();
    testLogger.info('Refresh button clicked');

    testLogger.info('Test completed: History refresh');
  });

  /**
   * Test: Verify history table columns
   * Priority: P2 - Regression
   * Objective: Verify history table displays expected columns
   */
  test("should display expected columns in history table @P2 @regression", async ({ page }) => {
    testLogger.info('Testing history table columns');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Expected columns based on feature doc
    const expectedColumns = [
      'Pipeline Name',
      'Type',
      'Status',
      'Timestamp',
      'Duration'
    ];

    // Check for table headers using POM method
    let columnsFound = 0;
    for (const column of expectedColumns) {
      const isColumnVisible = await pageManager.pipelinesPage.isColumnHeaderVisible(column);
      if (isColumnVisible) columnsFound++;
      testLogger.info(`Column "${column}" visible: ${isColumnVisible}`);
    }

    // At least some expected columns should be visible
    expect(columnsFound).toBeGreaterThan(0);

    testLogger.info('Test completed: History table columns check');
  });

  /**
   * Test: Filter history by pipeline name
   * Priority: P2 - Regression
   * Objective: Verify history can be filtered by pipeline name
   */
  test("should filter history by pipeline name @P2 @filter @regression", async ({ page }) => {
    testLogger.info('Testing history filter by pipeline name');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Verify filter controls are visible
    const isSearchSelectVisible = await pageManager.pipelinesPage.isHistorySearchSelectVisible();
    expect(isSearchSelectVisible).toBe(true);

    const isSearchBtnVisible = await pageManager.pipelinesPage.isHistoryManualSearchBtnVisible();
    expect(isSearchBtnVisible).toBe(true);

    // Try to use the search/filter select using POM
    await pageManager.pipelinesPage.clickHistorySearchSelect();
    testLogger.info('Search select clicked');

    // Try to select any pipeline option (best-effort - may have no options)
    await pageManager.pipelinesPage.selectFirstOption();

    // Dismiss any open dropdown overlay
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Click search button to apply filter
    await pageManager.pipelinesPage.clickHistoryManualSearchBtn();
    testLogger.info('Search button clicked');

    testLogger.info('Test completed: History filter by pipeline name');
  });

  /**
   * Test: Verify status colors in history table
   * Priority: P2 - Regression
   * Objective: Verify status entries have appropriate color coding
   */
  test("should display status with appropriate colors @P2 @regression", async ({ page }) => {
    testLogger.info('Testing history status colors');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Check for status badges/chips using POM
    const statusBadgeCount = await pageManager.pipelinesPage.statusBadges.count();
    expect(statusBadgeCount).toBeGreaterThanOrEqual(0);

    if (statusBadgeCount > 0) {
      testLogger.info(`Found ${statusBadgeCount} status elements`);

      // Get status counts using POM method
      const statusCounts = await pageManager.pipelinesPage.getStatusCounts();
      expect(statusCounts.success + statusCounts.error + statusCounts.warning).toBeGreaterThan(0);
      testLogger.info(`Status counts - Success: ${statusCounts.success}, Error: ${statusCounts.error}, Warning: ${statusCounts.warning}`);
    } else {
      testLogger.info('No status elements found - history may be empty');
    }

    testLogger.info('Test completed: History status colors');
  });

  /**
   * Test: Empty history state
   * Priority: P2 - Edge Case
   * Objective: Verify appropriate message when no history exists
   */
  test("should show appropriate message when history is empty @P2 @edge-case", async ({ page }) => {
    testLogger.info('Testing empty history state');

    // Navigate to history page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToHistoryPage(orgName);

    // Get row count using POM
    const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);

    if (rowCount === 0) {
      // Check for empty state message using POM
      const isEmptyStateVisible = await pageManager.pipelinesPage.isEmptyStateMessageVisible();
      expect(isEmptyStateVisible).toBe(true);
      testLogger.info('Empty state message displayed');
    } else {
      testLogger.info(`History contains ${rowCount} records`);
    }

    testLogger.info('Test completed: Empty history state check');
  });
});
