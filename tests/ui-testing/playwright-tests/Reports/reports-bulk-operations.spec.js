const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createReportViaApi } = require('../../pages/reportsPages/reportCreation.js');

const timestamp = Date.now();
const BULK_FOLDER = `bulk_test_folder_${timestamp}`;
const REPORT_1 = `bulk_report_1_${timestamp}`;
const REPORT_2 = `bulk_report_2_${timestamp}`;
const REPORT_3 = `bulk_report_3_${timestamp}`;

test.describe("Report Bulk Operations", () => {
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

  test("P0: Bulk action buttons hidden when no reports selected", {
    tag: ['@reportBulkOps', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying bulk buttons are hidden with no selection');
    await pm.reportFoldersPage.expectBulkButtonsHidden();
    testLogger.info('Bulk buttons are correctly hidden when nothing is selected');
  });

  test("P0: Selecting all reports reveals bulk action buttons", {
    tag: ['@reportBulkOps', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating a report via API to ensure table is non-empty');
    const result = await createReportViaApi(pm.apiCleanup, REPORT_1);
    if (!result.success) {
      throw new Error(`Setup: failed to create report: ${result.error}`);
    }

    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.expectReportVisibleInTable(REPORT_1);

    testLogger.info('Selecting all reports via header checkbox');
    await pm.reportFoldersPage.selectAllReports();
    await pm.reportFoldersPage.expectBulkButtonsVisible();

    testLogger.info('Bulk action buttons appeared after selecting reports');

    // Cleanup: delete created report via API
    await pm.apiCleanup.deleteReport(REPORT_1);
  });

  // ===== P1: FUNCTIONAL TESTS =====

  test("P1: Bulk move selected reports to another folder", {
    tag: ['@reportBulkOps', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting up: creating folder and two reports');
    await pm.reportFoldersPage.createFolder(BULK_FOLDER);
    await pm.reportFoldersPage.expectFolderTabVisible(BULK_FOLDER);

    const r1 = await createReportViaApi(pm.apiCleanup, `${REPORT_1}_move`);
    const r2 = await createReportViaApi(pm.apiCleanup, `${REPORT_2}_move`);
    if (!r1.success || !r2.success) {
      throw new Error('Setup: failed to create reports for bulk move test');
    }

    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.clickFolderTab('default');

    testLogger.info('Selecting all reports and initiating bulk move');
    await pm.reportFoldersPage.selectAllReports();
    await pm.reportFoldersPage.clickBulkMove();

    testLogger.info(`Selecting destination folder: ${BULK_FOLDER}`);
    await pm.reportFoldersPage.selectMoveDestination(BULK_FOLDER);
    await pm.reportFoldersPage.expectMoveButtonEnabled();
    await pm.reportFoldersPage.clickMove();

    testLogger.info('Verifying reports appear in destination folder');
    await pm.reportFoldersPage.clickFolderTab(BULK_FOLDER);
    await pm.reportFoldersPage.expectReportVisibleInTable(`${REPORT_1}_move`);

    testLogger.info('Verifying source folder no longer contains the moved reports');
    await pm.reportFoldersPage.clickFolderTab('default');
    await pm.reportFoldersPage.expectReportNotVisibleInTable(`${REPORT_1}_move`);

    // Cleanup
    await pm.apiCleanup.deleteReport(`${REPORT_1}_move`);
    await pm.apiCleanup.deleteReport(`${REPORT_2}_move`);
    await pm.reportFoldersPage.deleteFolderIfExists(BULK_FOLDER);
  });

  test("P1: Bulk delete selected reports with confirmation", {
    tag: ['@reportBulkOps', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Creating reports for bulk delete test');
    const r1 = await createReportViaApi(pm.apiCleanup, `${REPORT_2}_del`);
    const r2 = await createReportViaApi(pm.apiCleanup, `${REPORT_3}_del`);
    if (!r1.success || !r2.success) {
      throw new Error('Setup: failed to create reports for bulk delete test');
    }

    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.expectReportVisibleInTable(`${REPORT_2}_del`);

    testLogger.info('Selecting all reports and clicking bulk delete');
    await pm.reportFoldersPage.selectAllReports();
    await pm.reportFoldersPage.clickBulkDelete();

    testLogger.info('Confirming bulk delete');
    await pm.reportFoldersPage.confirmBulkDelete();

    testLogger.info('Verifying success notification after bulk delete');
    await pm.reportFoldersPage.expectBulkDeleteSuccessVisible();

    testLogger.info('Verifying deleted reports are no longer in the table');
    await pm.reportFoldersPage.expectReportNotVisibleInTable(`${REPORT_2}_del`);
  });

  // ===== P2: EDGE CASE TESTS =====

  test("P2: Cancel bulk delete does not remove reports", {
    tag: ['@reportBulkOps', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Creating a report to verify cancel behaviour');
    const r1 = await createReportViaApi(pm.apiCleanup, `${REPORT_3}_cancel`);
    if (!r1.success) {
      throw new Error('Setup: failed to create report for cancel test');
    }

    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.expectReportVisibleInTable(`${REPORT_3}_cancel`);

    testLogger.info('Selecting reports and clicking bulk delete then cancelling');
    await pm.reportFoldersPage.selectAllReports();
    await pm.reportFoldersPage.clickBulkDelete();
    await pm.reportFoldersPage.cancelBulkDelete();

    testLogger.info('Verifying report still exists after cancel');
    await pm.reportFoldersPage.expectReportVisibleInTable(`${REPORT_3}_cancel`);

    // Cleanup
    await pm.apiCleanup.deleteReport(`${REPORT_3}_cancel`);
  });

  test("P2: Cancel bulk move closes dialog without moving reports", {
    tag: ['@reportBulkOps', '@edge', '@P2']
  }, async ({ page }) => {
    testLogger.info('Creating test folder and report');
    const cancelFolder = `cancel_folder_${timestamp}`;
    await pm.reportFoldersPage.createFolder(cancelFolder);
    await pm.reportFoldersPage.expectFolderTabVisible(cancelFolder);

    const r1 = await createReportViaApi(pm.apiCleanup, `${REPORT_1}_cancel_move`);
    if (!r1.success) {
      throw new Error('Setup: failed to create report');
    }

    await pm.reportFoldersPage.navigateToReports();
    await pm.reportFoldersPage.clickFolderTab('default');

    testLogger.info('Opening bulk move dialog and cancelling');
    await pm.reportFoldersPage.selectAllReports();
    await pm.reportFoldersPage.clickBulkMove();
    await pm.reportFoldersPage.cancelMove();

    testLogger.info('Verifying report stays in original folder after cancel');
    await pm.reportFoldersPage.clickFolderTab('default');
    await pm.reportFoldersPage.expectReportVisibleInTable(`${REPORT_1}_cancel_move`);

    // Cleanup
    await pm.apiCleanup.deleteReport(`${REPORT_1}_cancel_move`);
    await pm.reportFoldersPage.deleteFolderIfExists(cancelFolder);
  });
});
