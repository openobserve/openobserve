const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createDashboardViaApi } = require('../../pages/dashboardPages/dashCreation.js');
const {
  createReportFolderViaApi,
  createDashboardReportViaApi,
} = require('../../pages/reportsPages/reportCreation.js');

/**
 * Regression coverage for PR #13569 —
 * "fix: dashboard reports drawer duplicates entries and hides reports in custom folders"
 *
 * Bug 1: ScheduledDashboards.vue seeded `scheduledReports` with the `reports` prop
 *        array and pushed onto it, mutating the prop. The drawer stays mounted
 *        between opens, so every reopen multiplied the rows.
 * Bug 2: ViewDashboard.vue passed the DASHBOARD's folder id as `folder_id` to
 *        `reports.list`, but that param filters by the REPORT's own folder — so a
 *        report saved in a custom report folder never appeared.
 */

const timestamp = Date.now();
const DASH_PREFIX = 'test_dash_sched_';
const DASHBOARD_A = `${DASH_PREFIX}a_${timestamp}`;
const DASHBOARD_B = `${DASH_PREFIX}b_${timestamp}`;
const REPORT_FOLDER = `test_folder_sched_${timestamp}`;
const REPORT_DEFAULT_FOLDER = `test_report_sched_default_${timestamp}`;
const REPORT_CUSTOM_FOLDER = `test_report_sched_custom_${timestamp}`;
const REPORT_OTHER_DASHBOARD = `test_report_sched_other_${timestamp}`;

test.describe("Dashboard Scheduled Reports Drawer", () => {
  test.describe.configure({ mode: 'serial' });

  let pm;
  // Shared across the serial suite — created once in the first test.
  let dashboardAId;
  let dashboardBId;
  let customFolderId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ===== P0: SMOKE / DIRECT BUG REGRESSIONS =====

  test("P0: Drawer opens and lists the dashboard's cached report", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating dashboards and reports via API');

    const dashA = await createDashboardViaApi(pm.apiCleanup, DASHBOARD_A);
    expect(dashA.success, `Dashboard A creation failed: ${dashA.error}`).toBeTruthy();
    dashboardAId = dashA.dashboard.dashboard_id;

    const dashB = await createDashboardViaApi(pm.apiCleanup, DASHBOARD_B);
    expect(dashB.success, `Dashboard B creation failed: ${dashB.error}`).toBeTruthy();
    dashboardBId = dashB.dashboard.dashboard_id;

    const folder = await createReportFolderViaApi(pm.apiCleanup, REPORT_FOLDER, 'PR 13569 regression');
    expect(folder.success, `Report folder creation failed: ${folder.error}`).toBeTruthy();
    customFolderId = folder.folderId;

    // Report in the DEFAULT report folder, bound to dashboard A, no destinations
    // => it belongs to the drawer's default "Cached" tab.
    const defaultFolderReport = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_DEFAULT_FOLDER,
      dashboardId: dashboardAId,
      cached: true,
    });
    expect(defaultFolderReport.success,
      `Default-folder report creation failed: ${defaultFolderReport.error}`).toBeTruthy();

    testLogger.info('Opening dashboard A and its scheduled reports drawer');
    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    await pm.scheduledReportsDrawer.openDrawer();

    await pm.scheduledReportsDrawer.expectDrawerVisible();
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);

    testLogger.info('Drawer lists the dashboard-bound cached report');
  });

  test("P0: Bug 13569-1 — reopening the drawer does not duplicate rows", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying row count is stable across repeated open/close cycles');

    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);

    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);
    const baselineCount = await pm.scheduledReportsDrawer.getRowCount();
    expect(baselineCount).toBeGreaterThan(0);
    testLogger.info(`Baseline row count on first open: ${baselineCount}`);

    // Before the fix each reopen appended the whole list again (1 -> 2 -> 4 ...),
    // because formatReports() pushed onto the aliased `reports` prop.
    for (let cycle = 1; cycle <= 3; cycle++) {
      await pm.scheduledReportsDrawer.closeDrawer();
      await pm.scheduledReportsDrawer.openDrawer();
      await pm.scheduledReportsDrawer.expectRowCount(baselineCount);
      await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);
      testLogger.info(`Reopen cycle ${cycle}: row count still ${baselineCount}`);
    }

    testLogger.info('No duplication across three reopen cycles');
  });

  test("P0: Bug 13569-2 — report saved in a custom report folder is listed", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating a report in a custom report folder for dashboard A');

    // Dashboard A lives in the DEFAULT dashboard folder, but this report is saved
    // into a custom REPORT folder. Before the fix the drawer sent the dashboard's
    // folder id as `folder_id` and filtered this report out.
    const result = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_CUSTOM_FOLDER,
      dashboardId: dashboardAId,
      dashboardFolderId: 'default',
      reportFolderId: customFolderId,
      cached: true,
    });
    expect(result.success, `Custom-folder report creation failed: ${result.error}`).toBeTruthy();

    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    await pm.scheduledReportsDrawer.openDrawer();

    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_CUSTOM_FOLDER);
    // The default-folder report must still be there — the fix widens the list,
    // it does not swap one folder's reports for another's.
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);

    testLogger.info('Custom report folder report is visible in the drawer');
  });

  // ===== P1: FUNCTIONAL =====

  test("P1: Reports list request omits folder_id", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Asserting the reports list query contract');

    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    const requestUrl = await pm.scheduledReportsDrawer.openDrawer();

    pm.scheduledReportsDrawer.expectNoFolderIdInListRequest(requestUrl);

    testLogger.info(`Reports list request scoped by dashboard only: ${requestUrl}`);
  });

  test("P1: Switching tabs re-filters the list without duplicating rows", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Round-tripping the Cached/Scheduled tabs');

    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    await pm.scheduledReportsDrawer.openDrawer();

    // Default tab is "Cached".
    const cachedCount = await pm.scheduledReportsDrawer.getRowCount();
    expect(cachedCount).toBeGreaterThan(1);
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_CUSTOM_FOLDER);

    // The "Scheduled" tab is the complement of "Cached", so neither cached
    // report may appear there.
    await pm.scheduledReportsDrawer.selectScheduledTab();
    await pm.scheduledReportsDrawer.expectReportNotVisible(REPORT_DEFAULT_FOLDER);
    await pm.scheduledReportsDrawer.expectReportNotVisible(REPORT_CUSTOM_FOLDER);

    // Switching back re-runs filterReports() over the same source array — the
    // count must be identical, not doubled.
    await pm.scheduledReportsDrawer.selectCachedTab();
    await pm.scheduledReportsDrawer.expectRowCount(cachedCount);
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_DEFAULT_FOLDER);
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_CUSTOM_FOLDER);

    testLogger.info('Tab round-trip leaves the cached list unchanged');
  });

  test("P1: Search filter does not survive a reopen or leave stale rows", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Filtering the drawer, then reopening it');

    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    await pm.scheduledReportsDrawer.openDrawer();

    const unfilteredCount = await pm.scheduledReportsDrawer.getRowCount();
    expect(unfilteredCount).toBeGreaterThan(1);

    await pm.scheduledReportsDrawer.searchReports(REPORT_CUSTOM_FOLDER);
    await pm.scheduledReportsDrawer.expectRowCount(1);
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_CUSTOM_FOLDER);

    await pm.scheduledReportsDrawer.clearSearch();
    await pm.scheduledReportsDrawer.expectRowCount(unfilteredCount);

    // Reopen: the list must be rebuilt from scratch, not re-accumulated.
    await pm.scheduledReportsDrawer.closeDrawer();
    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectRowCount(unfilteredCount);

    testLogger.info('Row count after filtering and reopening is unchanged');
  });

  // ===== P2: EDGE CASES =====

  test("P2: Dashboard with no reports shows the empty state on every open", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Opening the drawer for a dashboard without reports');

    await pm.scheduledReportsDrawer.openDashboard(dashboardBId);
    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectEmptyState();

    await pm.scheduledReportsDrawer.closeDrawer();
    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectEmptyState();

    testLogger.info('Empty state is stable across reopen');
  });

  test("P2: A report bound to another dashboard is not listed", {
    tag: ['@scheduledReportsDrawer', '@dashboards', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Creating a report bound to dashboard B in the custom folder');

    const result = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_OTHER_DASHBOARD,
      dashboardId: dashboardBId,
      reportFolderId: customFolderId,
      cached: true,
    });
    expect(result.success, `Dashboard B report creation failed: ${result.error}`).toBeTruthy();

    // Dashboard B shows only its own report...
    await pm.scheduledReportsDrawer.openDashboard(dashboardBId);
    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_OTHER_DASHBOARD);
    await pm.scheduledReportsDrawer.expectReportNotVisible(REPORT_DEFAULT_FOLDER);

    // ...and dashboard A does not pick it up even though both reports share the
    // same custom report folder (dropping folder_id must not drop dashboard_id).
    await pm.scheduledReportsDrawer.openDashboard(dashboardAId);
    await pm.scheduledReportsDrawer.openDrawer();
    await pm.scheduledReportsDrawer.expectReportVisible(REPORT_CUSTOM_FOLDER);
    await pm.scheduledReportsDrawer.expectReportNotVisible(REPORT_OTHER_DASHBOARD);

    testLogger.info('Reports stay scoped to their own dashboard');
  });

  // ===== CLEANUP via API =====

  test("Cleanup: Remove all test resources via API", {
    tag: ['@scheduledReportsDrawer', '@cleanup']
  }, async ({ page }) => {
    testLogger.info('Cleaning up scheduled-reports-drawer test resources');

    const reports = await pm.apiCleanup.fetchReports();
    expect(Array.isArray(reports)).toBeTruthy();
    const testReports = reports.filter(r => r.name && r.name.startsWith('test_report_sched_'));
    for (const report of testReports) {
      // Delete by id: these reports live in a custom report folder, and the
      // name-based v1 route only resolves names inside the default folder.
      const result = await pm.apiCleanup.deleteReportById(report.report_id, report.name);
      // 404 is fine — a prior partial cleanup may already have removed it.
      if (result.code !== 200 && result.code !== 404) {
        throw new Error(`Unexpected status deleting report ${report.name}: ${result.code} — ${result.message}`);
      }
      testLogger.info(`Deleted/already gone report: ${report.name} (${result.code})`);
    }

    await pm.apiCleanup.cleanupReportFolders(['test_folder_sched_']);
    // Delete only the dashboards this spec created. cleanupDashboards() removes
    // every dashboard owned by the automation user — under fullyParallel that is
    // every other spec's too, and deleting a dashboard also makes any report
    // bound to it vanish. Mirrors the scoped report/folder cleanups above.
    const dashboards = await pm.apiCleanup.fetchDashboardsInFolder('default');
    const ourDashboards = dashboards.filter(d => d.title && d.title.startsWith(DASH_PREFIX));
    for (const dash of ourDashboards) {
      await pm.apiCleanup.deleteDashboard(dash.dashboard_id, dash.folder_id || 'default');
      testLogger.info(`Deleted test dashboard: ${dash.title}`);
    }

    testLogger.info('Cleanup completed');
  });
});
