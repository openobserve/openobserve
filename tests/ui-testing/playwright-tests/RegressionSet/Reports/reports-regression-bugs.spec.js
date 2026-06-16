/**
 * Reports Regression Bug Tests
 *
 * Bug fixes for Reports page functionality:
 * - #11231: Each save shifts the timestamp by the timezone offset
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

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
  test("Report save should not shift timestamp by timezone offset", {
    tag: ['@bug-11231', '@P1', '@regression', '@reportsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify report save does not shift timestamp (Bug #11231)');

    const reportsUrl = `${process.env.ZO_BASE_URL || 'http://localhost:5080'}/web/reports?org_identifier=${process.env.ORGNAME || 'default'}`;
    const TEST_REPORT_NAME = `e2e_tz_test_${Date.now()}`;

    try {
      // Create a dashboard prerequisite for the report
      await pm.commonActions.dismissBlockingOverlays();
      await page.waitForTimeout(500);
      await pm.dashboardPage.navigateToDashboards();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('Navigated to dashboards');

      await pm.dashboardPage.createDashboard();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info(`Created dashboard: ${pm.dashboardPage.dashboardName}`);

      // Create a report using the dashboard via POM methods
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

      // Wait for success toast after report save (OToast component's success variant)
      await pm.reportsPage.toastSuccess.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      // Navigate to reports list and edit the report to configure schedule
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInputField.fill(TEST_REPORT_NAME);

      const editBtn = pm.reportsPage.editReportBtn(TEST_REPORT_NAME);
      await expect(editBtn, 'Edit button should be visible').toBeVisible({ timeout: 5000 });
      await editBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('Opened report for editing');

      // Navigate through step 1 (dashboard) to reach step 2 (schedule)
      await pm.reportsPage.createReportContinueButtonStep1();
      testLogger.info('Navigated to Schedule step');

      // Configure schedule: "Schedule later" with fixed start time and UTC timezone
      await expect(pm.reportsPage.scheduleLaterBtn,
        'Schedule Later button should be visible').toBeVisible({ timeout: 5000 });
      await pm.reportsPage.createReportScheduleLater();

      const TEST_START_TIME = '10:30';
      const TEST_START_HOUR = 10;

      // OTime wraps a hidden <input type="time"> inside the role="group" div.
      // Fill with force:true since the native input is visually hidden.
      const startTimeInput = page.locator('[data-test="add-report-schedule-start-time-field"] input[type="time"]');
      await expect(startTimeInput, 'Start Time input should exist').toHaveCount(1, { timeout: 5000 });
      await startTimeInput.fill(TEST_START_TIME, { force: true });
      testLogger.info(`Set start time to: "${TEST_START_TIME}"`);

      await pm.reportsPage.createReportZone();
      testLogger.info('Set timezone to UTC');

      // Save with schedule
      await expect(pm.reportsPage.saveButton, 'Save button should be visible').toBeVisible({ timeout: 5000 });
      await pm.reportsPage.saveButton.click({ force: true });
      await expect(page.getByRole('alert').first(),
        'Save success alert should appear').toBeVisible({ timeout: 15000 });
      testLogger.info('Saved report with schedule configured');

      // Re-open to verify time has NOT shifted (the bug: each save shifts by TZ offset)
      await page.goto(reportsUrl, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.reportsPage.reportSearchInputField.fill(TEST_REPORT_NAME);

      const editBtnReopen = pm.reportsPage.editReportBtn(TEST_REPORT_NAME);
      await expect(editBtnReopen, 'Edit button should still be visible after re-save').toBeVisible({ timeout: 5000 });
      await editBtnReopen.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Navigate through step 1 to reach schedule step
      await pm.reportsPage.createReportContinueButtonStep1();
      await expect(pm.reportsPage.scheduleLaterBtn,
        'Schedule Later button should be visible after re-open').toBeVisible({ timeout: 5000 });

      // Read back from the hidden <input type="time">
      const startTimeInputAfter = page.locator('[data-test="add-report-schedule-start-time-field"] input[type="time"]');
      await expect(startTimeInputAfter, 'Start Time input should exist after re-open').toHaveCount(1, { timeout: 5000 });
      const afterStartTime = await startTimeInputAfter.inputValue({ timeout: 5000 });
      testLogger.info(`After re-open start time: "${afterStartTime}"`);

      // Bug assertion: the hour component must not have shifted
      const afterHour = parseInt(afterStartTime?.split(':')[0] || '-1');
      const hourDiff = Math.abs(TEST_START_HOUR - afterHour);
      testLogger.info(`Expected hour: ${TEST_START_HOUR}, Got: ${afterHour}, Diff: ${hourDiff}`);

      expect(hourDiff,
        'Bug #11231: Timestamp should not shift by timezone offset after save'
      ).toBe(0);

      testLogger.info('PASSED: Report save does not shift timestamp');
    } finally {
      // Cleanup: delete report and dashboard regardless of test outcome
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
