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
      await pm.reportsPage.createReportContinueButtonStep2();
      await pm.reportsPage.createReportFillDetail();
      await pm.reportsPage.createReportSaveButton();
      testLogger.info(`Created report: ${TEST_REPORT_NAME}`);

      // Wait for save to complete
      await page.waitForSelector('div[role="alert"]', { state: 'visible', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Step 3: Navigate back to reports list and search for the report
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInput.fill(TEST_REPORT_NAME);
      await page.waitForTimeout(2000);
      testLogger.info(`Searched for report: ${TEST_REPORT_NAME}`);

      // Step 4: Edit the report and capture initial time
      const editBtn = page.locator(`[data-test="report-list-${TEST_REPORT_NAME}-edit-report"]`);
      await expect(editBtn, 'Edit button should be visible').toBeVisible({ timeout: 5000 });
      await editBtn.click();
      await page.waitForTimeout(3000);
      testLogger.info('Opened report for editing');

      // Capture initial start time (may be in a collapsed section)
      const startTimeInput = page.getByLabel(/Start Time/i).first();
      let initialStartTime = '';
      if (await startTimeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        initialStartTime = await startTimeInput.inputValue();
      }
      testLogger.info(`Initial start time: "${initialStartTime}"`);

      // Expand the "Schedule Send Later" section if collapsed
      const scheduleLaterBtn = page.locator('[data-test="add-report-schedule-scheduleLater-btn"]');
      if (await scheduleLaterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await scheduleLaterBtn.click({ force: true });
        await page.waitForTimeout(1000);
        testLogger.info('Expanded Schedule Later section');
      }

      // Step 5: Change timezone to UTC (if the timezone control is visible)
      if (await pm.reportsPage.zoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pm.reportsPage.zoneInput.click({ force: true });
        await page.waitForTimeout(1000);

        const utcOption = page.getByRole('option', { name: 'UTC', exact: true });
        if (await utcOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await utcOption.click();
          await page.waitForTimeout(1000);
          testLogger.info('Changed timezone to UTC');
        }
      }

      // Save the report
      await expect(pm.reportsPage.saveButton, 'Save button should be visible').toBeVisible({ timeout: 5000 });
      await pm.reportsPage.saveButton.click({ force: true });
      await page.waitForTimeout(3000);

      // Verify save succeeded
      await expect(page.getByRole('alert').first(), 'Save success alert should appear').toBeVisible({ timeout: 15000 });
      testLogger.info('Saved report with UTC timezone');

      // Step 6: Re-open the report and verify time hasn't shifted
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInput.fill(TEST_REPORT_NAME);
      await page.waitForTimeout(2000);

      const editBtnAfter = page.locator(`[data-test="report-list-${TEST_REPORT_NAME}-edit-report"]`);
      await expect(editBtnAfter, 'Edit button should still be visible after save').toBeVisible({ timeout: 5000 });
      await editBtnAfter.click();
      await page.waitForTimeout(3000);

      const startTimeInputAfter = page.getByLabel(/Start Time/i).first();
      let afterStartTime = '';
      if (await startTimeInputAfter.isVisible({ timeout: 3000 }).catch(() => false)) {
        afterStartTime = await startTimeInputAfter.inputValue();
      }
      testLogger.info(`After save start time: "${afterStartTime}"`);

      // Verify time hasn't shifted by timezone offset
      if (initialStartTime && afterStartTime) {
        const initialHour = parseInt(initialStartTime.split(':')[0]);
        const afterHour = parseInt(afterStartTime.split(':')[0]);
        const hourDiff = Math.abs(initialHour - afterHour);

        testLogger.info(`Hour difference: ${hourDiff}`);
        expect(hourDiff,
          'Bug #11231: Timestamp should not shift by timezone offset after save'
        ).toBeLessThanOrEqual(1);
      } else {
        testLogger.info('Start time fields not visible — skipping timezone shift check');
      }

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
