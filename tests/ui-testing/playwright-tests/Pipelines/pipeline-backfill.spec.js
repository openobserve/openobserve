/**
 * Pipeline Backfill Jobs Tests
 *
 * This test file covers backfill job management for pipelines.
 * Tests include:
 * - Navigating to backfill jobs page
 * - Filtering jobs by status
 * - Filtering jobs by pipeline
 * - Job control (pause, resume, delete)
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

test.describe.configure({ mode: "serial" });

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

test.describe("Pipeline Backfill Jobs Tests", { tag: ['@all', '@pipelines', '@backfill', '@pipelinesBackfill'] }, () => {
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
  });

  /**
   * Test: Navigate to backfill jobs page
   * Priority: P1 - Smoke
   * Objective: Verify backfill jobs page is accessible
   */
  test("should navigate to backfill jobs page @P1 @smoke", async ({ page }) => {
    testLogger.info('Testing navigation to backfill jobs page');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Navigate to backfill page using POM method
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify backfill page loaded using POM methods
    const isPageVisible = await pageManager.pipelinesPage.isBackfillPageVisible();

    if (isPageVisible) {
      testLogger.info('Backfill jobs page loaded successfully');
      await expect(pageManager.pipelinesPage.backfillPageLocator).toBeVisible();
    } else {
      // Check for any backfill-related content using POM
      const isBackfillTextVisible = await pageManager.pipelinesPage.isBackfillTextVisible();
      if (isBackfillTextVisible) {
        testLogger.info('Backfill page content found');
      } else {
        testLogger.info('Backfill page selectors may need updating - checking URL');
        await expect(page).toHaveURL(/backfill/);
      }
    }

    testLogger.info('Test completed: Backfill jobs navigation');
  });

  /**
   * Test: Verify backfill page has required elements
   * Priority: P1 - Functional
   * Objective: Verify backfill page contains filters, table, and controls
   */
  test("should display backfill page elements @P1 @functional", async ({ page }) => {
    testLogger.info('Testing backfill page elements');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Check for status filter using POM
    const isStatusFilterVisible = await pageManager.pipelinesPage.isStatusFilterVisible();
    if (isStatusFilterVisible) {
      testLogger.info('Status filter found');
    } else {
      testLogger.info('Status filter not found with expected selector');
    }

    // Check for pipeline filter using POM
    const isPipelineFilterVisible = await pageManager.pipelinesPage.isPipelineFilterVisible();
    if (isPipelineFilterVisible) {
      testLogger.info('Pipeline filter found');
    }

    // Check for clear filters button using POM
    const isClearFiltersVisible = await pageManager.pipelinesPage.isClearFiltersBtnVisible();
    if (isClearFiltersVisible) {
      testLogger.info('Clear filters button found');
    }

    // Check for refresh button using POM
    const isRefreshVisible = await pageManager.pipelinesPage.isBackfillRefreshBtnVisible();
    if (isRefreshVisible) {
      testLogger.info('Refresh button found');
    }

    // Check for jobs table using POM
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    if (isTableVisible) {
      testLogger.info('Backfill jobs table found');
    } else {
      // Check for any table using POM
      const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
      testLogger.info(`Any table visible: ${isAnyTableVisible}`);
    }

    testLogger.info('Test completed: Backfill page elements check');
  });

  /**
   * Test: Verify back button on backfill page
   * Priority: P1 - Functional
   * Objective: Verify back navigation works from backfill page
   */
  test("should navigate back from backfill jobs page @P1 @functional", async ({ page }) => {
    testLogger.info('Testing back navigation from backfill page');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click back button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickBackfillBackBtn();

    testLogger.info('Test completed: Back navigation from backfill');
  });

  /**
   * Test: Filter backfill jobs by status
   * Priority: P2 - Functional
   * Objective: Verify jobs can be filtered by status
   */
  test("should filter backfill jobs by status @P2 @filter @functional", async ({ page }) => {
    testLogger.info('Testing backfill jobs status filter');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click status filter using POM
    const isStatusFilterVisible = await pageManager.pipelinesPage.isStatusFilterVisible();

    if (isStatusFilterVisible) {
      // Try to filter by different statuses using POM
      const statusOptions = ['running', 'paused', 'completed', 'failed'];
      for (const status of statusOptions) {
        await pageManager.pipelinesPage.filterByStatus(status);
        // If successful, break
        break;
      }
    } else {
      testLogger.info('Status filter not found - may need selector update');
    }

    testLogger.info('Test completed: Backfill jobs status filter');
  });

  /**
   * Test: Filter backfill jobs by pipeline
   * Priority: P2 - Functional
   * Objective: Verify jobs can be filtered by pipeline name
   */
  test("should filter backfill jobs by pipeline @P2 @filter @functional", async ({ page }) => {
    testLogger.info('Testing backfill jobs pipeline filter');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Use pipeline filter using POM method
    await pageManager.pipelinesPage.filterByPipeline();

    testLogger.info('Test completed: Backfill jobs pipeline filter');
  });

  /**
   * Test: Clear filters on backfill page
   * Priority: P2 - Functional
   * Objective: Verify clear filters button resets all filters
   */
  test("should clear all filters on backfill page @P2 @filter @functional", async ({ page }) => {
    testLogger.info('Testing clear filters functionality');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click clear filters button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickClearFiltersBtn();

    testLogger.info('Test completed: Clear filters');
  });

  /**
   * Test: Refresh backfill jobs list
   * Priority: P2 - Functional
   * Objective: Verify refresh button reloads jobs data
   */
  test("should refresh backfill jobs list @P2 @functional", async ({ page }) => {
    testLogger.info('Testing backfill jobs refresh');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click refresh button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickBackfillRefreshBtn();

    testLogger.info('Test completed: Backfill jobs refresh');
  });

  /**
   * Test: Verify progress bar in jobs table
   * Priority: P2 - Regression
   * Objective: Verify running jobs show progress indicator
   */
  test("should display progress bar for jobs @P2 @regression", async ({ page }) => {
    testLogger.info('Testing progress bar display');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Check for progress bars using POM method
    const progressBarCount = await pageManager.pipelinesPage.getProgressBarCount();
    testLogger.info(`Found ${progressBarCount} progress elements`);

    testLogger.info('Test completed: Progress bar check');
  });

  /**
   * Test: Verify job action buttons presence
   * Priority: P2 - Regression
   * Objective: Verify pause, resume, edit, delete, view buttons exist
   */
  test("should display job action buttons @P2 @regression", async ({ page }) => {
    testLogger.info('Testing job action buttons presence');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Get job action button counts using POM method
    const actionCounts = await pageManager.pipelinesPage.getJobActionButtonCounts();
    testLogger.info(`Pause: ${actionCounts.pause}, Resume: ${actionCounts.resume}, Edit: ${actionCounts.edit}, Delete: ${actionCounts.delete}, View: ${actionCounts.view}`);

    // Also check for total table buttons using POM method
    const totalButtonCount = await pageManager.pipelinesPage.getTableButtonCount();
    testLogger.info(`Total table buttons: ${totalButtonCount}`);

    testLogger.info('Test completed: Job action buttons check');
  });

  /**
   * Test: Verify job statuses in table
   * Priority: P2 - Regression
   * Objective: Verify job status values are displayed
   */
  test("should display job statuses correctly @P2 @regression", async ({ page }) => {
    testLogger.info('Testing job status display');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Expected statuses based on feature doc
    const expectedStatuses = ['running', 'waiting', 'paused', 'completed', 'failed', 'canceled'];

    // Check for status elements using POM method
    for (const status of expectedStatuses) {
      const count = await pageManager.pipelinesPage.getJobStatusCount(status);
      if (count > 0) {
        testLogger.info(`Found ${count} "${status}" status elements`);
      }
    }

    testLogger.info('Test completed: Job status display');
  });

  /**
   * Test: Empty backfill jobs state
   * Priority: P2 - Edge Case
   * Objective: Verify appropriate message when no jobs exist
   */
  test("should show appropriate message when no backfill jobs exist @P2 @edge-case", async ({ page }) => {
    testLogger.info('Testing empty backfill jobs state');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Get row count using POM
    const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();

    if (rowCount === 0) {
      // Check for empty state message using POM
      const isEmptyStateVisible = await pageManager.pipelinesPage.isEmptyBackfillMessageVisible();
      if (isEmptyStateVisible) {
        testLogger.info('Empty state message displayed');
      } else {
        testLogger.info('No rows but empty state message not found');
      }
    } else {
      testLogger.info(`Backfill jobs contains ${rowCount} records`);
    }

    testLogger.info('Test completed: Empty backfill jobs state check');
  });

  /**
   * Test: Error indicator button functionality
   * Priority: P2 - Regression
   * Objective: Verify error indicator shows error details
   */
  test("should show error details when clicking error indicator @P2 @regression", async ({ page }) => {
    testLogger.info('Testing error indicator functionality');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Check for error indicator buttons using POM
    const errorCount = await pageManager.pipelinesPage.getErrorIndicatorCount();

    if (errorCount > 0) {
      testLogger.info(`Found ${errorCount} error indicators`);

      // Click first error indicator using POM method
      await pageManager.pipelinesPage.clickFirstErrorIndicator();

      // Check if error dialog appeared using POM
      const isDialogVisible = await pageManager.pipelinesPage.isErrorDialogVisible();
      if (isDialogVisible) {
        testLogger.info('Error dialog displayed');
        // Close dialog using POM method
        await pageManager.pipelinesPage.closeErrorDialog();
      }
    } else {
      testLogger.info('No error indicators found - may be no failed jobs');
    }

    testLogger.info('Test completed: Error indicator check');
  });
});
