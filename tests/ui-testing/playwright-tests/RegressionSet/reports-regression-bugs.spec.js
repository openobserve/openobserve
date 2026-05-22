/**
 * Reports Regression Bug Tests
 *
 * Bug fixes for Reports page functionality:
 * - #11231: Each save shifts the timestamp by the timezone offset
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Reports Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Reports regression test setup completed');
  });

  // ==========================================================================
  // Bug #11231: In reports each save shifts the timestamp by the timezone offset
  // https://github.com/openobserve/openobserve/issues/11231
  // ==========================================================================
  test("Report save should not shift timestamp by timezone offset @bug-11231 @P1 @regression @reportsRegression", async ({ page }) => {
    testLogger.info('Test: Verify report save does not shift timestamp (Bug #11231)');

    const reportsUrl = `${process.env.ZO_BASE_URL || 'http://localhost:5080'}/web/reports?org_identifier=${process.env.ORGNAME || 'default'}`;
    const TEST_REPORT_NAME = `e2e_tz_test_${Date.now()}`;

    try {
      // Step 1: Dismiss any blocking overlays, then create a dashboard
      await pm.commonActions.dismissBlockingOverlays();
      await page.waitForTimeout(500);

      await pm.dashboardPage.navigateToDashboards();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('Navigated to dashboards');

      await pm.dashboardPage.createDashboard();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info(`Created dashboard: ${pm.dashboardPage.dashboardName}`);

      // Step 2: Navigate to reports and create a report
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('Navigated to reports');

      await pm.reportsPage.createReportAddReportButton();
      await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
      await pm.reportsPage.createReportFolderInput();
      await pm.reportsPage.createReportDashboardInput(pm.dashboardPage.dashboardName);
      await pm.reportsPage.createReportDashboardTabInput();
      await pm.reportsPage.createReportContinueButtonStep1();
      // Skip schedule configuration during creation — we'll configure it in the edit view
      await pm.reportsPage.createReportContinueButtonStep2();
      await pm.reportsPage.createReportFillDetail();
      await pm.reportsPage.createReportSaveButton();
      testLogger.info(`Created report: ${TEST_REPORT_NAME}`);

      // Wait for save to complete
      await page.waitForSelector('div[role="alert"]', { state: 'visible', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Step 3: Navigate to reports list and edit the report
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInput.fill(TEST_REPORT_NAME);
      await page.waitForTimeout(2000);
      testLogger.info(`Searched for report: ${TEST_REPORT_NAME}`);

      const editBtn = page.locator(`[data-test="report-list-${TEST_REPORT_NAME}-edit-report"]`);
      await expect(editBtn, 'Edit button should be visible').toBeVisible({ timeout: 5000 });
      await editBtn.click();
      await page.waitForTimeout(3000);
      testLogger.info('Opened report for editing');

      // Navigate to the Schedule step in the stepper
      const scheduleStep = page.locator('[data-test="add-report-select-schedule-step"]');
      await expect(scheduleStep, 'Schedule stepper step should be visible').toBeVisible({ timeout: 5000 });
      await scheduleStep.click();
      await page.waitForTimeout(1000);
      testLogger.info('Navigated to Schedule step in edit view');

      // Click "Schedule later" to expand the date/time fields
      await pm.reportsPage.createReportScheduleLater();
      await page.waitForTimeout(1000);

      // Set a fixed start time and UTC timezone to detect subsequent shifts
      const TEST_START_TIME = '10:30';
      const startTimeInput = page.getByLabel('Start Time *');
      await expect(startTimeInput, 'Start Time input should be visible').toBeVisible({ timeout: 5000 });
      await startTimeInput.fill(TEST_START_TIME);
      testLogger.info(`Set start time to: "${TEST_START_TIME}"`);

      // Set timezone to UTC
      await pm.reportsPage.createReportZone();
      testLogger.info('Set timezone to UTC');

      // Save the report with schedule configured
      await expect(pm.reportsPage.saveButton, 'Save button should be visible').toBeVisible({ timeout: 5000 });
      await pm.reportsPage.saveButton.click({ force: true });
      await page.waitForTimeout(3000);
      await expect(page.getByRole('alert').first(), 'Save success alert should appear').toBeVisible({ timeout: 15000 });
      testLogger.info('Saved report with schedule configured');

      // Step 4: Re-open and verify time hasn't shifted from the re-save
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInput.fill(TEST_REPORT_NAME);
      await page.waitForTimeout(2000);

      const editBtnAfter = page.locator(`[data-test="report-list-${TEST_REPORT_NAME}-edit-report"]`);
      await expect(editBtnAfter, 'Edit button should still be visible after save').toBeVisible({ timeout: 5000 });
      await editBtnAfter.click();
      await page.waitForTimeout(3000);

      // Navigate to Schedule step again in the re-opened edit view
      const scheduleStepAfter = page.locator('[data-test="add-report-select-schedule-step"]');
      await expect(scheduleStepAfter, 'Schedule stepper step should be visible after re-open').toBeVisible({ timeout: 5000 });
      await scheduleStepAfter.click();
      await page.waitForTimeout(1000);

      const startTimeInputAfter = page.getByLabel('Start Time *');
      await expect(startTimeInputAfter, 'Start Time input should be visible after re-save').toBeVisible({ timeout: 5000 });
      const afterStartTime = await startTimeInputAfter.inputValue();
      testLogger.info(`After re-save start time: "${afterStartTime}"`);

      // Verify time hasn't shifted by timezone offset
      const initialHour = parseInt(TEST_START_TIME.split(':')[0]);
      const afterHour = parseInt(afterStartTime.split(':')[0]);
      const hourDiff = Math.abs(initialHour - afterHour);

      testLogger.info(`Hour difference: ${hourDiff}`);
      expect(hourDiff,
        'Bug #11231: Timestamp should not shift by timezone offset after save'
      ).toBe(0);

      testLogger.info('PASSED: Report save does not shift timestamp');
    } finally {
      // Cleanup always runs, even if test fails mid-way
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      try {
        await pm.reportsPage.deleteReport(TEST_REPORT_NAME);
        testLogger.info('Deleted test report');
      } catch (e) {
        testLogger.warn(`Could not delete report: ${e.message}`);
      }

      await pm.dashboardPage.navigateToDashboards();
      try {
        await pm.dashboardPage.deleteDashboard();
        testLogger.info('Deleted test dashboard');
      } catch (e) {
        testLogger.warn(`Could not delete dashboard: ${e.message}`);
      }
    }
  });

  test.afterEach(async () => {
    testLogger.info('Reports regression test completed');
  });
});
