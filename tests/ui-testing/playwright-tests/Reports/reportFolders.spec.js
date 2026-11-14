const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const APICleanup = require('../../pages/apiCleanup.js');
const { createDashboardViaApi } = require('../../pages/dashboardPages/dashCreation.js');
const { createDashboardReportViaApi } = require('../../pages/reportsPages/reportCreation.js');

const timestamp = Date.now();
const FOLDER_A = `test_folder_a_${timestamp}`;
const FOLDER_B = `test_folder_b_${timestamp}`;
const FOLDER_SPECIAL = `test_special_chars_${timestamp}`;
// Spec-scoped report prefix. 'test_report_' also matches scheduledReportsDrawer's
// test_report_sched_* names, so the prefix cleanup below was deleting that spec's
// reports mid-run under fullyParallel.
const RPT_PREFIX = 'test_rf_report_';
const REPORT_A = `${RPT_PREFIX}${timestamp}`;
// Own the dashboard REPORT_A binds to. The suite runs fullyParallel against a
// shared org, and deleting a report's dashboard removes the report from the
// folder listing entirely — so binding to an arbitrary existing dashboard let a
// concurrent spec's cleanup make REPORT_A vanish mid-test. The prefix also lets
// cleanup target only our dashboards, including leaks from a crashed run.
const DASH_PREFIX = 'test_rf_dash_';
const DASHBOARD_A = `${DASH_PREFIX}${timestamp}`;

test.describe("Report Folders", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let reportACreated = false;

  // CI reruns only the failed tests, so any test that needs REPORT_A creates it when an earlier one did not.
  async function ensureReportA() {
    if (reportACreated) return;
    const dashResult = await createDashboardViaApi(pm.apiCleanup, DASHBOARD_A);
    if (!dashResult.success) {
      throw new Error(`Failed to create dashboard: ${dashResult.error}`);
    }
    testLogger.info(`Dashboard "${dashResult.dashboard.dashboard_id}" created via API`);
    // cached: false keeps a destination, so the report lands in the "Scheduled" tab the list shows.
    const result = await createDashboardReportViaApi(pm.apiCleanup, {
      reportName: REPORT_A,
      dashboardId: dashResult.dashboard.dashboard_id,
      tabId: dashResult.dashboard.tabs?.[0]?.tab_id || 'default',
      cached: false,
    });
    if (!result.success) {
      throw new Error(`Failed to create test report: ${result.error}`);
    }
    reportACreated = true;
    testLogger.info(`Test report "${REPORT_A}" created via API`);
    await pm.reportFoldersPage.navigateToReports();
  }

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.reportFoldersPage.navigateToReports();
    testLogger.info('Test setup completed');
  });

  // ===== P0: SMOKE TESTS =====

  test("P0: Folder sidebar renders with default folder", {
    tag: ['@reportFolders', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying folder sidebar renders with default folder');
    await pm.reportFoldersPage.expectDefaultFolderExists();
    testLogger.info('Default folder is visible in sidebar');
  });

  test("P0: Create a new folder via Add Folder dialog", {
    tag: ['@reportFolders', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating a new folder');
    await pm.reportFoldersPage.createFolder(FOLDER_A, 'Test folder A description');
    await pm.reportFoldersPage.expectFolderTabVisible(FOLDER_A);
    testLogger.info(`Folder "${FOLDER_A}" created and visible in sidebar`);
  });

  // ===== P1: FUNCTIONAL TESTS =====

  test("P1: Create a report from scratch via API and verify it is visible", {
    tag: ['@reportFolders', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Creating dashboard and report via API');
    await ensureReportA();
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);

    testLogger.info('Test report visible in default folder');
  });

  test("P1: Move a report to another folder", {
    tag: ['@reportFolders', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing move report between folders');
    await ensureReportA();

    await pm.reportFoldersPage.createFolder(FOLDER_B);
    await pm.reportFoldersPage.expectFolderTabVisible(FOLDER_B);

    // Navigate to default folder where REPORT_A lives
    await pm.reportFoldersPage.clickFolderTab('default');

    testLogger.info(`Moving report "${REPORT_A}" to folder "${FOLDER_B}"`);

    // Search to ensure REPORT_A is visible (table may be paginated with many reports)
    await pm.reportFoldersPage.searchReports(REPORT_A);
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);

    // Open move dialog and move to destination folder
    await pm.reportFoldersPage.openMoveDialog(REPORT_A);
    await pm.reportFoldersPage.selectMoveDestination(FOLDER_B);
    await pm.reportFoldersPage.expectMoveButtonEnabled();
    await pm.reportFoldersPage.clickMove();

    // Verify report is now in destination folder
    await pm.reportFoldersPage.clickFolderTab(FOLDER_B);
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);

    // Move it back to default — later serial tests expect REPORT_A there.
    await pm.reportFoldersPage.searchReports(REPORT_A);
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);
    await pm.reportFoldersPage.openMoveDialog(REPORT_A);
    await pm.reportFoldersPage.selectMoveDestination('default');
    await pm.reportFoldersPage.expectMoveButtonEnabled();
    await pm.reportFoldersPage.clickMove();

    // Confirm it landed before handing off to the next test.
    await pm.reportFoldersPage.clickFolderTab('default');
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);

    testLogger.info('Report moved to another folder and back successfully');
  });

  test("P1: Cross-folder search with All Folders toggle", {
    tag: ['@reportFolders', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing cross-folder search');

    await pm.reportFoldersPage.toggleAllFolders();
    await pm.reportFoldersPage.searchReports(REPORT_A.substring(0, 8)); // search by prefix
    await pm.reportFoldersPage.expectAllFoldersToggleVisible();

    testLogger.info('Cross-folder search toggled successfully');
  });

  test("P1: Filter folders via sidebar search", {
    tag: ['@reportFolders', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing folder search filter');

    // Search for a known folder
    await pm.reportFoldersPage.searchFolders('default');
    await pm.reportFoldersPage.expectFolderTabVisible('default');

    // Search for non-existent folder - default should disappear
    await pm.reportFoldersPage.searchFolders('zzz_nonexistent_xyz');
    await pm.reportFoldersPage.expectFolderTabNotVisible('default');

    // Clear search - folders should reappear
    await pm.reportFoldersPage.clearFolderSearch();
    await pm.reportFoldersPage.expectFolderTabVisible('default');

    testLogger.info('Folder search filter works correctly');
  });

  // ===== P2: EDGE CASE TESTS =====

  test("P2: Move button disabled when source equals destination", {
    tag: ['@reportFolders', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing move button disabled for same folder');
    await ensureReportA();

    await pm.reportFoldersPage.clickFolderTab('default');

    await pm.reportFoldersPage.searchReports(REPORT_A);
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);
    await pm.reportFoldersPage.openMoveDialog(REPORT_A);
    await pm.reportFoldersPage.expectMoveButtonDisabled();
    await pm.reportFoldersPage.cancelMove();

    testLogger.info('Move button correctly disabled when source = destination');
  });

  test("P2: Save button disabled when folder name is empty", {
    tag: ['@reportFolders', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing save button disabled for empty name');

    await pm.reportFoldersPage.clickAddFolder();
    await pm.reportFoldersPage.expectFolderSaveDisabled();

    await pm.reportFoldersPage.fillFolderName('Temporary');
    await pm.reportFoldersPage.expectFolderSaveEnabled();

    await pm.reportFoldersPage.fillFolderName('');
    await pm.reportFoldersPage.expectFolderSaveDisabled();

    await pm.reportFoldersPage.clickCancelFolder();

    testLogger.info('Save button correctly disabled when name is empty');
  });

  test("P2: Cancel button closes Add Folder dialog", {
    tag: ['@reportFolders', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing cancel closes dialog');

    await pm.reportFoldersPage.clickAddFolder();
    await pm.reportFoldersPage.fillFolderName('Should Not Save');
    await pm.reportFoldersPage.clickCancelFolder();

    await pm.reportFoldersPage.expectFolderTabNotVisible('Should Not Save');

    testLogger.info('Cancel correctly closes dialog without creating folder');
  });

  test("P2: Default folder has no edit/delete options", {
    tag: ['@reportFolders', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing default folder has no more_vert menu');

    await pm.reportFoldersPage.expectMoreIconNotVisible('default');

    testLogger.info('Default folder correctly has no edit/delete options');
  });

  test("P2: Special characters allowed in folder names", {
    tag: ['@reportFolders', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing special characters in folder names');

    const specialName = `${FOLDER_SPECIAL}/?#`;
    await pm.reportFoldersPage.createFolder(specialName);
    await pm.reportFoldersPage.expectFolderTabVisible(specialName);

    testLogger.info('Special characters are allowed in folder names (known behavior)');
  });

  // afterAll runs even when a serial test fails, so a failed run still removes its folders, report and dashboard.
  test.afterAll(async () => {
    const apiCleanup = new APICleanup();
    // Reports go first: a folder that still holds one cannot be deleted, and dropping its dashboard orphans it.
    const reports = await apiCleanup.fetchReports();
    for (const report of (reports || []).filter(r => r.name && r.name.startsWith(RPT_PREFIX))) {
      const result = await apiCleanup.deleteReport(report.name);
      testLogger.info(`Deleted/already gone test report: ${report.name} (${result.code})`);
    }
    // Spec-specific prefixes: 'test_folder_' alone also matches scheduledReportsDrawer's folders mid-run.
    await apiCleanup.cleanupReportFolders(['test_folder_a_', 'test_folder_b_', 'test_special_chars_'])
      .catch(e => testLogger.warn(`Report folder cleanup incomplete: ${e.message}`));
    // cleanupDashboards() would also remove every other spec's dashboards under fullyParallel.
    const dashboards = await apiCleanup.fetchDashboardsInFolder('default');
    for (const dash of dashboards.filter(d => d.title && d.title.startsWith(DASH_PREFIX))) {
      await apiCleanup.deleteDashboard(dash.dashboard_id, dash.folder_id || 'default');
      testLogger.info(`Deleted test dashboard: ${dash.title}`);
    }
  });
});
