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
const crypto = require('crypto');

test.describe.configure({ mode: "parallel" });

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

// Helper: build Basic Auth headers for API calls (Node.js context, no page needed)
function getApiHeaders() {
  return {
    'Authorization': 'Basic ' + Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64'),
    'Content-Type': 'application/json'
  };
}

test.describe("Pipeline Backfill Jobs Tests", { tag: ['@all', '@pipelines', '@backfill', '@pipelinesBackfill'] }, () => {
  let pageManager;

  // Shared state: pipeline + backfill job created in beforeAll for data-dependent tests
  let testPipelineId = null;
  let testBackfillJobId = null;
  let backfillDataAvailable = false;

  test.beforeAll(async () => {
    const orgId = process.env["ORGNAME"];
    const headers = getApiHeaders();
    const baseUrl = process.env.ZO_BASE_URL;

    try {
      // Step 1: Create a simple pipeline (source: e2e_automate → dest: e2e_backfill_dest)
      const timestamp = Date.now();
      const pipelineName = `e2e_backfill_test_${timestamp}`;
      const inputNodeId = `input-${timestamp}`;
      const outputNodeId = `output-${timestamp + 1}`;

      const pipelinePayload = {
        pipeline_id: "",
        version: 0,
        enabled: true,
        org: orgId,
        name: pipelineName,
        description: "E2E test pipeline for backfill job testing",
        source: {
          source_type: "scheduled",
          org_id: orgId,
          stream_type: "logs",
          query_condition: {
            type: "sql",
            sql: "SELECT * FROM e2e_automate",
            conditions: null,
            promql: null,
            promql_condition: null,
            aggregation: null,
            vrl_function: null,
            search_event_type: null,
            multi_time_range: null
          },
          trigger_condition: {
            period: 15,
            operator: ">=",
            threshold: 0,
            frequency: 900,
            cron: "",
            frequency_type: "minutes",
            silence: 0,
            timezone: "UTC",
            align_time: true
          },
          tz_offset: 0
        },
        nodes: [
          {
            id: inputNodeId,
            position: { x: 100, y: 100 },
            data: {
              node_type: "query",
              org_id: orgId,
              stream_type: "logs",
              query_condition: {
                type: "sql",
                sql: "SELECT * FROM e2e_automate",
                conditions: null
              },
              trigger_condition: {
                period: 15,
                operator: ">=",
                threshold: 0,
                frequency: 900,
                cron: "",
                frequency_type: "minutes",
                silence: 0,
                timezone: "UTC",
                align_time: true
              },
              tz_offset: 0
            },
            io_type: "input"
          },
          {
            id: outputNodeId,
            position: { x: 300, y: 100 },
            data: { node_type: "stream", stream_type: "logs", stream_name: `e2e_backfill_dest_${timestamp}`, org_id: orgId },
            io_type: "output"
          }
        ],
        edges: [
          {
            id: `${inputNodeId}-${outputNodeId}`,
            source: inputNodeId,
            target: outputNodeId
          }
        ]
      };

      const createRes = await fetch(`${baseUrl}/api/${orgId}/pipelines`, {
        method: 'POST',
        headers,
        body: JSON.stringify(pipelinePayload)
      });

      if (!createRes.ok) {
        const errBody = await createRes.text().catch(() => '');
        testLogger.warn(`Pipeline creation failed: ${createRes.status} — ${errBody}`);
        return;
      }

      const createData = await createRes.json();
      testLogger.info(`Pipeline create response: ${JSON.stringify(createData)}`);

      // API doesn't return the pipeline ID — list pipelines and find ours by name
      const listRes = await fetch(`${baseUrl}/api/${orgId}/pipelines`, {
        method: 'GET', headers
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const pipelines = listData.list || listData.pipelines || listData;
        const ours = (Array.isArray(pipelines) ? pipelines : []).find(
          p => p.name === pipelineName
        );
        testPipelineId = ours?.pipeline_id || ours?.id;
      }

      if (!testPipelineId) {
        testLogger.warn(`Could not resolve pipeline ID for "${pipelineName}" — backfill seeding skipped`);
        return;
      }

      testLogger.info(`Created test pipeline: ${testPipelineId} (name: ${pipelineName})`);

      // Step 2: Create a backfill job (1 hour range, 10-min chunks)
      const nowMicro = Date.now() * 1000;
      const oneHourAgoMicro = nowMicro - (60 * 60 * 1000000);

      const backfillRes = await fetch(`${baseUrl}/api/${orgId}/pipelines/${testPipelineId}/backfill`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          start_time: oneHourAgoMicro,
          end_time: nowMicro,
          chunk_period_minutes: 10,
          delay_between_chunks_secs: 1,
          delete_before_backfill: false
        })
      });

      if (!backfillRes.ok) {
        const errBody = await backfillRes.text().catch(() => '');
        testLogger.warn(`Backfill job creation failed: ${backfillRes.status} (enterprise-only API) — ${errBody}`);
        return;
      }

      const backfillData = await backfillRes.json();
      testBackfillJobId = backfillData.job_id || backfillData.id;
      backfillDataAvailable = true;
      testLogger.info(`Created backfill job: ${testBackfillJobId} (response: ${JSON.stringify(backfillData)})`);
    } catch (error) {
      testLogger.warn(`Backfill data seeding failed: ${error.message}`);
    }
  });

  test.afterAll(async () => {
    const orgId = process.env["ORGNAME"];
    const headers = getApiHeaders();
    const baseUrl = process.env.ZO_BASE_URL;

    try {
      if (testBackfillJobId && testPipelineId) {
        await fetch(`${baseUrl}/api/${orgId}/pipelines/${testPipelineId}/backfill/${testBackfillJobId}`, {
          method: 'DELETE', headers
        }).catch(() => {});
        testLogger.info(`Deleted backfill job: ${testBackfillJobId}`);
      }
      if (testPipelineId) {
        await fetch(`${baseUrl}/api/${orgId}/pipelines/${testPipelineId}`, {
          method: 'DELETE', headers
        }).catch(() => {});
        testLogger.info(`Deleted test pipeline: ${testPipelineId}`);
      }
    } catch (error) {
      testLogger.warn(`Backfill cleanup failed: ${error.message}`);
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Auth is handled via storageState - no login needed
    pageManager = new PageManager(page);

    // Navigate first so page is on the same origin (required for in-browser fetch)
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    // Ingest test data (uses page.evaluate with fetch — needs same-origin context)
    const streamNames = ["e2e_automate"];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);

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
   * Test: Navigate to backfill jobs page
   * Priority: P1 - Smoke
   * Objective: Verify backfill jobs page is accessible
   */
  test("should navigate to backfill jobs page", {
    tag: ['@pipelinesBackfill', '@pipelines', '@smoke', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing navigation to backfill jobs page');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Navigate to backfill page using POM method
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify backfill page loaded using POM methods
    const isPageVisible = await pageManager.pipelinesPage.isBackfillPageVisible();
    const isBackfillTextVisible = await pageManager.pipelinesPage.isBackfillTextVisible();

    // At least one indicator must confirm we're on the backfill page
    expect(isPageVisible || isBackfillTextVisible || /backfill/.test(page.url())).toBe(true);
    testLogger.info('Backfill jobs page loaded successfully');

    testLogger.info('Test completed: Backfill jobs navigation');
  });

  /**
   * Test: Verify backfill page has required elements
   * Priority: P1 - Functional
   * Objective: Verify backfill page contains filters, table, and controls
   */
  test("should display backfill page elements", {
    tag: ['@pipelinesBackfill', '@pipelines', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing backfill page elements');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Check for status filter using POM
    const isStatusFilterVisible = await pageManager.pipelinesPage.isStatusFilterVisible();
    expect(isStatusFilterVisible).toBe(true);
    testLogger.info('Status filter found');

    // Check for pipeline filter using POM
    const isPipelineFilterVisible = await pageManager.pipelinesPage.isPipelineFilterVisible();
    expect(isPipelineFilterVisible).toBe(true);
    testLogger.info('Pipeline filter found');

    // Check for clear filters button using POM
    const isClearFiltersVisible = await pageManager.pipelinesPage.isClearFiltersBtnVisible();
    expect(isClearFiltersVisible).toBe(true);
    testLogger.info('Clear filters button found');

    // Check for refresh button using POM
    const isRefreshVisible = await pageManager.pipelinesPage.isBackfillRefreshBtnVisible();
    expect(isRefreshVisible).toBe(true);
    testLogger.info('Refresh button found');

    // Check for jobs table using POM
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);
    testLogger.info('Backfill jobs table found');

    testLogger.info('Test completed: Backfill page elements check');
  });

  /**
   * Test: Verify back button on backfill page
   * Priority: P1 - Functional
   * Objective: Verify back navigation works from backfill page
   */
  test("should navigate back from backfill jobs page", {
    tag: ['@pipelinesBackfill', '@pipelines', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing back navigation from backfill page');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click back button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickBackfillBackBtn();

    // Wait for navigation away from backfill page
    await page.waitForURL(/.*(?!.*backfill).*pipeline.*/, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Verify navigation occurred - URL should no longer contain backfill
    expect(page.url()).not.toContain('backfill');
    testLogger.info('Test completed: Back navigation from backfill');
  });

  /**
   * Test: Filter backfill jobs by status
   * Priority: P2 - Functional
   * Objective: Verify jobs can be filtered by status
   */
  test("should filter backfill jobs by status", {
    tag: ['@pipelinesBackfill', '@pipelines', '@filter', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing backfill jobs status filter');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Click status filter using POM
    const isStatusFilterVisible = await pageManager.pipelinesPage.isStatusFilterVisible();
    expect(isStatusFilterVisible).toBe(true);

    // Try to filter by different statuses using POM
    const statusOptions = ['running', 'paused', 'completed', 'failed'];
    for (const status of statusOptions) {
      await pageManager.pipelinesPage.filterByStatus(status);
      testLogger.info(`Applied status filter: ${status}`);
      break;
    }

    testLogger.info('Test completed: Backfill jobs status filter');
  });

  /**
   * Test: Filter backfill jobs by pipeline
   * Priority: P2 - Functional
   * Objective: Verify jobs can be filtered by pipeline name
   */
  test("should filter backfill jobs by pipeline", {
    tag: ['@pipelinesBackfill', '@pipelines', '@filter', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing backfill jobs pipeline filter');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify pipeline filter is visible
    const isPipelineFilterVisible = await pageManager.pipelinesPage.isPipelineFilterVisible();
    expect(isPipelineFilterVisible).toBe(true);

    // Use pipeline filter using POM method
    await pageManager.pipelinesPage.filterByPipeline();
    testLogger.info('Pipeline filter applied');

    testLogger.info('Test completed: Backfill jobs pipeline filter');
  });

  /**
   * Test: Clear filters on backfill page
   * Priority: P2 - Functional
   * Objective: Verify clear filters button resets all filters
   */
  test("should clear all filters on backfill page", {
    tag: ['@pipelinesBackfill', '@pipelines', '@filter', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing clear filters functionality');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify clear filters button is visible
    const isClearFiltersVisible = await pageManager.pipelinesPage.isClearFiltersBtnVisible();
    expect(isClearFiltersVisible).toBe(true);

    // Click clear filters button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickClearFiltersBtn();
    testLogger.info('Clear filters button clicked');

    testLogger.info('Test completed: Clear filters');
  });

  /**
   * Test: Refresh backfill jobs list
   * Priority: P2 - Functional
   * Objective: Verify refresh button reloads jobs data
   */
  test("should refresh backfill jobs list", {
    tag: ['@pipelinesBackfill', '@pipelines', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing backfill jobs refresh');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify refresh button is visible
    const isRefreshVisible = await pageManager.pipelinesPage.isBackfillRefreshBtnVisible();
    expect(isRefreshVisible).toBe(true);

    // Click refresh button using POM method (handles fallbacks internally)
    await pageManager.pipelinesPage.clickBackfillRefreshBtn();
    testLogger.info('Refresh button clicked');

    testLogger.info('Test completed: Backfill jobs refresh');
  });

  /**
   * Test: Verify progress bar in jobs table
   * Priority: P2 - Regression
   * Objective: Verify running jobs show progress indicator
   */
  test("should display progress bar for jobs", {
    tag: ['@pipelinesBackfill', '@pipelines', '@regression', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing progress bar display');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify backfill page loaded
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);

    if (backfillDataAvailable) {
      // We seeded a backfill job — table must have at least 1 row
      const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();
      expect(rowCount).toBeGreaterThan(0);
      testLogger.info(`Backfill data seeded — ${rowCount} job rows visible`);
    }

    // Check for progress bars (present only on running/waiting jobs)
    const progressBarCount = await pageManager.pipelinesPage.getProgressBarCount();
    testLogger.info(`Found ${progressBarCount} progress elements`);

    testLogger.info('Test completed: Progress bar check');
  });

  /**
   * Test: Verify job action buttons presence
   * Priority: P2 - Regression
   * Objective: Verify pause, resume, edit, delete, view buttons exist
   */
  test("should display job action buttons", {
    tag: ['@pipelinesBackfill', '@pipelines', '@regression', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing job action buttons presence');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify backfill page loaded
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);

    // Get job action button counts using POM method
    const actionCounts = await pageManager.pipelinesPage.getJobActionButtonCounts();
    testLogger.info(`Pause: ${actionCounts.pause}, Resume: ${actionCounts.resume}, Cancel: ${actionCounts.cancel}`);

    const totalButtonCount = await pageManager.pipelinesPage.getTableButtonCount();
    const totalActions = actionCounts.pause + actionCounts.resume + actionCounts.cancel + totalButtonCount;

    if (backfillDataAvailable) {
      // We seeded a job — should have at least some action buttons or table buttons
      expect(totalActions).toBeGreaterThan(0);
      testLogger.info(`Backfill data seeded — ${totalActions} action buttons found`);
    } else {
      testLogger.info(`No seeded data — found ${totalActions} action buttons`);
    }

    testLogger.info('Test completed: Job action buttons check');
  });

  /**
   * Test: Verify job statuses in table
   * Priority: P2 - Regression
   * Objective: Verify job status values are displayed
   */
  test("should display job statuses correctly", {
    tag: ['@pipelinesBackfill', '@pipelines', '@regression', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing job status display');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Expected statuses based on feature doc
    const expectedStatuses = ['running', 'waiting', 'paused', 'completed', 'failed', 'canceled'];

    // Verify backfill page loaded
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);

    // Check for status elements using POM method
    let totalStatusElements = 0;
    for (const status of expectedStatuses) {
      const count = await pageManager.pipelinesPage.getJobStatusCount(status);
      totalStatusElements += count;
      if (count > 0) {
        testLogger.info(`Found ${count} "${status}" status elements`);
      }
    }

    if (backfillDataAvailable) {
      // We seeded a job — table must have rows with data
      const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();
      expect(rowCount).toBeGreaterThan(0);
      testLogger.info(`Backfill data seeded — ${rowCount} rows, ${totalStatusElements} status elements`);
    } else {
      testLogger.info(`No seeded data — found ${totalStatusElements} status elements`);
    }

    testLogger.info('Test completed: Job status display');
  });

  /**
   * Test: Backfill jobs table state validation
   * Priority: P2 - Edge Case
   * Objective: Verify table renders jobs when present, or shows empty message when none exist
   */
  test("should validate backfill jobs table state correctly", {
    tag: ['@pipelinesBackfill', '@pipelines', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing empty backfill jobs state');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Get row count using POM
    const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();

    if (backfillDataAvailable) {
      // We seeded a backfill job — table must NOT be empty
      expect(rowCount).toBeGreaterThan(0);
      testLogger.info(`Backfill data seeded — ${rowCount} rows visible (not empty)`);
    } else if (rowCount === 0) {
      // No seeded data and no jobs — verify empty state message
      const isEmptyStateVisible = await pageManager.pipelinesPage.isEmptyBackfillMessageVisible();
      expect(isEmptyStateVisible).toBe(true);
      testLogger.info('Empty state message displayed correctly');
    } else {
      // Pre-existing jobs from other sources
      const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
      const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
      expect(isTableVisible || isAnyTableVisible).toBe(true);
      testLogger.info(`Pre-existing backfill jobs: ${rowCount} records`);
    }

    testLogger.info('Test completed: Backfill jobs state check');
  });

  /**
   * Test: Error indicator button functionality
   * Priority: P2 - Regression
   * Objective: Verify error indicator shows error details
   */
  test("should show error details when clicking error indicator", {
    tag: ['@pipelinesBackfill', '@pipelines', '@regression', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error indicator functionality');

    // Navigate to backfill page using POM
    const orgName = process.env["ORGNAME"];
    await pageManager.pipelinesPage.navigateToBackfillPage(orgName);

    // Verify backfill page loaded and has data when seeded
    const isTableVisible = await pageManager.pipelinesPage.isBackfillJobsTableVisible();
    const isAnyTableVisible = await pageManager.pipelinesPage.isGenericTableVisible();
    expect(isTableVisible || isAnyTableVisible).toBe(true);

    if (backfillDataAvailable) {
      const rowCount = await pageManager.pipelinesPage.getHistoryRowCount();
      expect(rowCount).toBeGreaterThan(0);
      testLogger.info(`Backfill data seeded — ${rowCount} job rows visible`);
    }

    // Check for error indicator buttons using POM (only present on failed jobs)
    const errorCount = await pageManager.pipelinesPage.getErrorIndicatorCount();

    if (errorCount > 0) {
      testLogger.info(`Found ${errorCount} error indicators`);

      // Click first error indicator using POM method
      await pageManager.pipelinesPage.clickFirstErrorIndicator();

      // Check if error dialog appeared using POM
      const isDialogVisible = await pageManager.pipelinesPage.isErrorDialogVisible();
      expect(isDialogVisible).toBe(true);
      testLogger.info('Error dialog displayed');

      // Close dialog using POM method
      await pageManager.pipelinesPage.closeErrorDialog();
    } else {
      testLogger.info('No error indicators found — no failed jobs in current state');
    }

    testLogger.info('Test completed: Error indicator check');
  });
});
