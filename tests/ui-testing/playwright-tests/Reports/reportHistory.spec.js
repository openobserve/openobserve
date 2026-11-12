const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createDashboardViaApi } = require('../../pages/dashboardPages/dashCreation.js');
const { createDashboardReportViaApi } = require('../../pages/reportsPages/reportCreation.js');
const APICleanup = require('../../pages/apiCleanup.js');

const timestamp = Date.now();
const DASH_PREFIX = 'report_history_dash_';
const DASHBOARD_NAME = `${DASH_PREFIX}${timestamp}`;
const REPORT_NAME = `report_history_${timestamp}`;
// Pin the "once" report's first run a week out — unset `start` = epoch = fires immediately and pollutes the clean history with a failed scheduled run.
const FUTURE_START_US = Date.now() * 1000 + 7 * 24 * 3600 * 1_000_000;
// Per-test unique reports (each test builds its own cached report + dashboard).
const REPORT_CACHED_DRAWER_NAME = `report_history_${timestamp}_cached_drawer`;
const REPORT_EMPTY_NAME = `report_history_${timestamp}_empty`;
const REPORT_FILTERED_NAME = `report_history_${timestamp}_filtered`;
const REPORT_TRIGGER_NAME = `report_history_${timestamp}_trigger`;

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
      start: FUTURE_START_US,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    testLogger.info('Opening the report detail page from its row');
    await pm.reportHistoryPage.openReportDetail(REPORT_NAME);

    testLogger.info('Running the report now');
    await pm.reportHistoryPage.runNow();

    // The trigger response carries the run row, so it shows before the stream copy is searchable.
    await pm.reportHistoryPage.expectStatusChipVisible();
    await pm.reportHistoryPage.expectFirstTriggerSourceManual();

    testLogger.info('Opening the run drawer from the row');
    await pm.reportHistoryPage.openRunDrawer();
    await pm.reportHistoryPage.expectDrawerOutcomeVisible();
    await pm.reportHistoryPage.expectRunDeepLink();
  });

  test("P1: The Reports page has a History tab with the org-wide runs", {
    tag: ['@reportHistory', '@functional', '@P1']
  }, async ({ page }) => {
    await pm.reportFoldersPage.navigateToReports();
    await pm.reportHistoryPage.clickHistoryTab();
    await pm.reportHistoryPage.expectHistoryTabActive();
    await pm.reportHistoryPage.expectOrgHistoryPanelVisible();
    await pm.reportHistoryPage.expectOrgHistoryTileAllVisible();
  });

  test("P0: Cached run drawer shows the cached tile and hides Edit recipients", {
    tag: ['@reportHistory', '@smoke', '@P0']
  }, async ({ page }) => {
    const dashboardName = `${DASH_PREFIX}${timestamp}_cached_drawer`;
    const dash = await createDashboardViaApi(pm.apiCleanup, dashboardName);
    if (!dash.success) throw new Error(`Setup: failed to create dashboard: ${dash.error}`);
    const report = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_CACHED_DRAWER_NAME,
      dashboardId: dash.dashboard.dashboard_id,
      tabId: dash.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: true,
      start: FUTURE_START_US,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    testLogger.info('Running the cached report now and asserting the cached tile');
    await pm.reportHistoryPage.openReportDetail(REPORT_CACHED_DRAWER_NAME);
    await pm.reportHistoryPage.runNow();
    await pm.reportHistoryPage.expectStatusChipVisible();
    await pm.reportHistoryPage.expectCachedTileVisible();

    testLogger.info('Opening the run drawer and asserting the cached-run footer');
    await pm.reportHistoryPage.openRunDrawer();
    await pm.reportHistoryPage.expectDrawerOutcomeVisible();
    await pm.reportHistoryPage.expectEditRecipientsHidden();
  });

  test("P1: A fresh report shows the 'No runs yet' empty state with a Run now action", {
    tag: ['@reportHistory', '@functional', '@P1']
  }, async ({ page }) => {
    const dashboardName = `${DASH_PREFIX}${timestamp}_empty`;
    const dash = await createDashboardViaApi(pm.apiCleanup, dashboardName);
    if (!dash.success) throw new Error(`Setup: failed to create dashboard: ${dash.error}`);
    const report = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_EMPTY_NAME,
      dashboardId: dash.dashboard.dashboard_id,
      tabId: dash.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: true,
      start: FUTURE_START_US,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    testLogger.info('Opening the fresh report detail (History is the default tab)');
    await pm.reportHistoryPage.openReportDetail(REPORT_EMPTY_NAME);
    await pm.reportHistoryPage.expectEmptyStateVisible();
    await pm.reportHistoryPage.expectEmptyStateRunNowVisible();
  });

  test("P1: Filtering to the skipped tile shows 'No runs in this range' and Widen the range resets it", {
    tag: ['@reportHistory', '@functional', '@P1']
  }, async ({ page }) => {
    const dashboardName = `${DASH_PREFIX}${timestamp}_filtered`;
    const dash = await createDashboardViaApi(pm.apiCleanup, dashboardName);
    if (!dash.success) throw new Error(`Setup: failed to create dashboard: ${dash.error}`);
    const report = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_FILTERED_NAME,
      dashboardId: dash.dashboard.dashboard_id,
      tabId: dash.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: true,
      start: FUTURE_START_US,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    testLogger.info('Applying a no-match status tile to reach the filtered-empty state');
    await pm.reportHistoryPage.openReportDetail(REPORT_FILTERED_NAME);
    await pm.reportHistoryPage.clickSkippedTile();
    await pm.reportHistoryPage.expectEmptyRangeVisible();

    testLogger.info('Widening the range clears the filtered-empty state');
    await pm.reportHistoryPage.clickWidenRange();
    await pm.reportHistoryPage.expectEmptyRangeHidden();
    await pm.reportHistoryPage.expectEmptyStateVisible();
  });

  test("P1: The 'scheduled' trigger filter empties a manual-only history", {
    tag: ['@reportHistory', '@functional', '@P1']
  }, async ({ page }) => {
    const dashboardName = `${DASH_PREFIX}${timestamp}_trigger`;
    const dash = await createDashboardViaApi(pm.apiCleanup, dashboardName);
    if (!dash.success) throw new Error(`Setup: failed to create dashboard: ${dash.error}`);
    const report = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_TRIGGER_NAME,
      dashboardId: dash.dashboard.dashboard_id,
      tabId: dash.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: true,
      start: FUTURE_START_US,
    });
    if (!report.success) throw new Error(`Setup: failed to create report: ${report.error}`);

    testLogger.info('Creating one manual run, then filtering by the scheduled trigger');
    await pm.reportHistoryPage.openReportDetail(REPORT_TRIGGER_NAME);
    await pm.reportHistoryPage.runNow();
    await pm.reportHistoryPage.expectStatusChipVisible();
    await pm.reportHistoryPage.clickScheduledTrigger();
    await pm.reportHistoryPage.expectEmptyRangeVisible();
  });

  test("P2: A malformed run deep-link shows the linked-run banner", {
    tag: ['@reportHistory', '@functional', '@P2']
  }, async ({ page }) => {
    testLogger.info('Navigating to the History tab with a malformed run query param');
    await pm.reportHistoryPage.navigateToOrgHistory('not-a-valid-run-key');
    await pm.reportHistoryPage.expectLinkedRunMessage('invalid');
  });

  test.fixme("history disabled empty state — not wired: disabled_reason only in remote reporting mode (reports_history.rs:714-742)", {
    tag: ['@reportHistory', '@functional', '@P2']
  }, async ({ page }) => {
    await pm.reportHistoryPage.navigateToOrgHistory();
    await pm.reportHistoryPage.expectDisabledStateVisible();
  });

  // afterAll runs even when a serial test fails, so a skipped cleanup test can no longer leak fixtures.
  test.afterAll(async () => {
    const apiCleanup = new APICleanup();
    const reports = await apiCleanup.fetchReports();
    for (const report of (reports || []).filter(r => r.name && r.name.startsWith('report_history_'))) {
      await apiCleanup.deleteReport(report.name);
    }
    const dashboards = await apiCleanup.fetchDashboardsInFolder('default');
    for (const d of dashboards.filter(x => x.title && x.title.startsWith(DASH_PREFIX))) {
      await apiCleanup.deleteDashboard(d.dashboard_id, d.folder_id || 'default');
    }
  });
});
