const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createDashboardViaApi } = require('../../pages/dashboardPages/dashCreation.js');
const { createReportViaApi } = require('../../pages/reportsPages/reportCreation.js');

const timestamp = Date.now();
const FOLDER_A = `test_folder_a_${timestamp}`;
const FOLDER_B = `test_folder_b_${timestamp}`;
const FOLDER_SPECIAL = `test_special_chars_${timestamp}`;
const REPORT_A = `test_report_${timestamp}`;

test.describe("Report Folders", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

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
    testLogger.info('Creating dashboard via API for report');

    // Create a dashboard via API helper (from dashCreation.js)
    const dashResult = await createDashboardViaApi(
      pm.apiCleanup,
      `dash_${Date.now()}`
    );
    if (!dashResult.success) {
      throw new Error(`Failed to create dashboard: ${dashResult.error}`);
    }
    testLogger.info(`Dashboard "${dashResult.dashboard.dashboard_id}" created via API`);

    // Navigate to reports
    await pm.reportFoldersPage.navigateToReports();

    testLogger.info('Creating test report via API');
    const result = await createReportViaApi(pm.apiCleanup, REPORT_A);
    if (!result.success) {
      throw new Error(`Failed to create test report: ${result.error}`);
    }

    testLogger.info(`Test report "${REPORT_A}" created via API`);

    // Refresh the page so the reports table picks up the newly created report
    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);

    testLogger.info('Test report visible in default folder');
  });

  test("P1: Move a report to another folder", {
    tag: ['@reportFolders', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing move report between folders');

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

    // Move it back to default
    await pm.reportFoldersPage.searchReports(REPORT_A);
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_A);
    await pm.reportFoldersPage.openMoveDialog(REPORT_A);
    await pm.reportFoldersPage.selectMoveDestination('default');
    await pm.reportFoldersPage.clickMove();

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

  // ===== CLEANUP via API =====

  test("Cleanup: Remove all test resources via API", {
    tag: ['@reportFolders', '@cleanup']
  }, async ({ page }) => {
    testLogger.info('Cleaning up all test resources via API');

    // Delete all test reports matching prefix (catches leftovers from failed runs too)
    const reports = await pm.apiCleanup.fetchReports();
    expect(Array.isArray(reports)).toBeTruthy();
    const testReports = reports.filter(r => r.name && r.name.startsWith('test_report_'));
    for (const report of testReports) {
      const result = await pm.apiCleanup.deleteReport(report.name);
      // Accept 200 (deleted) or 404 (already gone from a prior partial cleanup)
      if (result.code !== 200 && result.code !== 404) {
        throw new Error(`Unexpected status deleting report ${report.name}: ${result.code}`);
      }
      testLogger.info(`Deleted/already gone test report: ${report.name} (${result.code})`);
    }

    // Delete all test folders
    const foldersBefore = await pm.apiCleanup.fetchReportFolders();
    expect(Array.isArray(foldersBefore)).toBeTruthy();
    await pm.apiCleanup.cleanupReportFolders(['test_folder_', 'test_special_']);

    // Delete dashboards created during tests
    await pm.apiCleanup.cleanupDashboards();

    testLogger.info('Cleanup completed');
  });
});
