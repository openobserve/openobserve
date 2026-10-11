const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createDashboardViaApi } = require('../../pages/dashboardPages/dashCreation.js');
const { createDashboardReportViaApi } = require('../../pages/reportsPages/reportCreation.js');

const timestamp = Date.now();
const DASH_PREFIX = 'report_history_dash_';
const DASHBOARD_NAME = `${DASH_PREFIX}${timestamp}`;
const REPORT_NAME = `report_history_${timestamp}`;

test.describe("Report History", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("P0: Run now writes a manual run that appears in the History tab at once", {
    tag: ['@reportHistory', '@smoke', '@P0']
  }, async ({ page }) => {
    const dash = await createDashboardViaApi(pm.apiCleanup, DASHBOARD_NAME);
    if (!dash.success) throw new Error(`Setup: failed to create dashboard: ${dash.error}`);
    // A cache-only report: Run now warms the cache and needs no SMTP server in CI.
    const report = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_NAME,
      dashboardId: dash.dashboard.dashboard_id,
      tabId: dash.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: true,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/reports?org_identifier=${process.env["ORGNAME"]}&tab=cached`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.locator('[data-test="report-list-search-input"] input').fill(REPORT_NAME);
    const nameCell = page.locator(`[data-test="report-list-name-cell-${REPORT_NAME}"]`);
    await expect(nameCell).toBeVisible({ timeout: 30000 });

    testLogger.info('Opening the report detail page from its row');
    await nameCell.click();
    await expect(page.locator('[data-test="reports-reportdetail-title"]')).toContainText(REPORT_NAME);

    testLogger.info('Running the report now');
    await page.locator('[data-test="reports-reportdetail-run-now"]').click();
    await page.locator('[data-test="o-dialog-primary-btn"]').click();

    // The trigger response carries the run row, so it shows before the stream copy is searchable.
    const firstStatus = page.locator('[data-test="reports-reportrunhistory-status"]').first();
    await expect(firstStatus).toBeVisible({ timeout: 120000 });
    await expect(page.locator('[data-test="reports-reportrunhistory-table"]')).toContainText('Manual');

    testLogger.info('Opening the run drawer from the row');
    await firstStatus.click();
    await expect(page.locator('[data-test="reports-reportrundrawer-outcome"]')).toBeVisible();
    await expect(page).toHaveURL(/[?&]run=/);
  });

  test("P1: The Reports page has a History tab with the org-wide runs", {
    tag: ['@reportHistory', '@functional', '@P1']
  }, async ({ page }) => {
    await pm.reportFoldersPage.navigateToReports();
    await page.locator('[data-test="tab-history"]').click();
    await expect(page).toHaveURL(/[?&]tab=history/);
    await expect(page.locator('[data-test="reports-reporthistory"]')).toBeVisible();
    await expect(page.locator('[data-test="reports-reportrunhistory-tile-all"]')).toBeVisible();
  });

  test("Cleanup: Remove the report and dashboard this spec created", {
    tag: ['@reportHistory', '@cleanup']
  }, async () => {
    await pm.apiCleanup.deleteReport(REPORT_NAME);
    const dashboards = await pm.apiCleanup.fetchDashboardsInFolder('default');
    for (const d of dashboards.filter(x => x.title && x.title.startsWith(DASH_PREFIX))) {
      await pm.apiCleanup.deleteDashboard(d.dashboard_id, d.folder_id || 'default');
    }
  });
});
