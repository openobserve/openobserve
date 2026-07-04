// Copyright 2026 OpenObserve Inc.
// Dashboard Report CSV Media Type — E2E tests
//
// Covers:
//   1. CSV option visible in the Report Type dropdown
//   2. Selecting CSV hides Attachment Type and Custom Dimensions
//   3. Save a report with CSV type succeeds
//   4. Switching from CSV back to PDF restores controls
//   5. Selecting PNG type shows PNG warning banner
//   6. Edit mode: CSV report shows CSV as selected and controls hidden
//
// All scenarios are WIRED — no fixme placeholders needed.
// Dashboard + ingestion provisioning follows the setup contract
// (docs/test_generator/ci/setup-contract.md).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ── Unique name helpers ──────────────────────────────────────────────────

function uniqueReportName(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Test suite ───────────────────────────────────────────────────────────

test.describe("Dashboard Report CSV Media Type", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Seed the e2e_automate stream per setup contract
    await pm.ingestionPage.ingestion();

    // Create a dashboard for this test (each parallel worker gets its own)
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.createDashboard();
    await expect(page).toHaveURL(/.*\/dashboards/);

    // Navigate to Reports page and open the Create Report form
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/reports?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.reportsPage.createReportAddReportButton();

    testLogger.info('Test setup completed — dashboard created, form open');
  });

  // ── P0: Critical Path ──────────────────────────────────────────────────

  test("CSV option is visible in the Report Type dropdown", {
    tag: ['@report-csv-media-type', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing CSV option visibility in report type dropdown');

    const TEST_REPORT_NAME = uniqueReportName('csvopt');
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Open the dropdown and assert CSV option is visible
    await pm.reportsPage.expectReportTypeOptionVisible('csv');

    testLogger.info('CSV option confirmed visible in report type dropdown');

    // Cleanup: delete the dashboard
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Dashboard cleanup completed');
  });

  test("Selecting CSV hides Attachment Type and Custom Dimensions", {
    tag: ['@report-csv-media-type', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing CSV selection hides attachment type and custom dimensions');

    const TEST_REPORT_NAME = uniqueReportName('csvhide');
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Baseline: default type is PDF, so controls should be visible
    await pm.reportsPage.expectAttachmentTypeVisible();
    await pm.reportsPage.expectCustomDimensionsVisible();

    // Select CSV (Data)
    await pm.reportsPage.selectReportType('csv');

    // After CSV selection, attachment type and custom dimensions must be hidden
    await pm.reportsPage.expectAttachmentTypeHidden();
    await pm.reportsPage.expectCustomDimensionsHidden();

    // PNG warning banner must not be visible (only for PNG, not CSV)
    await pm.reportsPage.expectPngNoteHidden();

    testLogger.info('CSV hides attachment type and custom dimensions confirmed');

    // Cleanup: delete the dashboard
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Dashboard cleanup completed');
  });

  test("Save a report with CSV type succeeds", {
    tag: ['@report-csv-media-type', '@all', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing full save flow with CSV report type');

    const TEST_REPORT_NAME = uniqueReportName('csvsave');
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Select CSV type
    await pm.reportsPage.selectReportType('csv');

    // Continue to step 2 (Schedule)
    await pm.reportsPage.createReportContinueButtonStep1();

    // Select "Once" frequency and continue to step 3
    await pm.reportsPage.createReportOnce();
    await pm.reportsPage.createReportContinueButtonStep2();

    // Fill share details and save
    await pm.reportsPage.createReportFillDetail();
    await pm.reportsPage.createReportSaveButton();

    // Verify the report was created (waits for success toast + confirms in list)
    await pm.reportsPage.verifyReportCreated(TEST_REPORT_NAME);

    testLogger.info('CSV report saved successfully');

    // Cleanup: delete the report, then the dashboard
    await pm.reportsPage.deleteReport(TEST_REPORT_NAME);
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Cleanup completed');
  });

  // ── P1: Important Variations ───────────────────────────────────────────

  test("Switching from CSV back to PDF restores Attachment Type and Custom Dimensions", {
    tag: ['@report-csv-media-type', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing CSV→PDF toggle restores hidden controls');

    const TEST_REPORT_NAME = uniqueReportName('csvtopdf');
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Select CSV — controls should hide
    await pm.reportsPage.selectReportType('csv');
    await pm.reportsPage.expectAttachmentTypeHidden();
    await pm.reportsPage.expectCustomDimensionsHidden();

    // Switch back to PDF — controls must reappear
    await pm.reportsPage.selectReportType('pdf');
    await pm.reportsPage.expectAttachmentTypeVisible();
    await pm.reportsPage.expectCustomDimensionsVisible();

    testLogger.info('CSV→PDF toggle correctly restores controls');

    // Cleanup: delete the dashboard
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Dashboard cleanup completed');
  });

  test("Selecting PNG type shows PNG warning banner", {
    tag: ['@report-csv-media-type', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing PNG selection shows warning banner');

    const TEST_REPORT_NAME = uniqueReportName('pngwarn');
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Select PNG (Image)
    await pm.reportsPage.selectReportType('png');

    // PNG warning banner must appear
    await pm.reportsPage.expectPngNoteVisible();

    // Attachment type and custom dimensions should remain visible for PNG
    await pm.reportsPage.expectAttachmentTypeVisible();
    await pm.reportsPage.expectCustomDimensionsVisible();

    testLogger.info('PNG warning banner confirmed visible');

    // Cleanup: delete the dashboard
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Dashboard cleanup completed');
  });

  // ── P2: Edit Mode ──────────────────────────────────────────────────────

  test("Edit mode: a previously saved CSV report shows CSV as selected and controls hidden", {
    tag: ['@report-csv-media-type', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing edit mode reflects CSV type with controls hidden');

    const TEST_REPORT_NAME = uniqueReportName('csvedit');

    // ── First, create a CSV report ──────────────────────────────────────
    await pm.reportsPage.createReportReportNameInput(TEST_REPORT_NAME);
    await pm.reportsPage.selectDashboardDefaults(pm.dashboardPage.dashboardName);

    // Confirm we reached the Report Format section
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Select CSV type and save
    await pm.reportsPage.selectReportType('csv');
    await pm.reportsPage.createReportContinueButtonStep1();
    await pm.reportsPage.createReportOnce();
    await pm.reportsPage.createReportContinueButtonStep2();
    await pm.reportsPage.createReportFillDetail();
    await pm.reportsPage.createReportSaveButton();

    // Verify creation succeeded
    await pm.reportsPage.verifyReportCreated(TEST_REPORT_NAME);

    // ── Now edit the report ─────────────────────────────────────────────
    // We are already on the reports list page (verifyReportCreated navigated there).
    // Search again (verifyReportCreated may have cleared the search).
    await pm.reportsPage.reportSearchInputField.fill(TEST_REPORT_NAME);
    await pm.reportsPage.editReportBtn(TEST_REPORT_NAME).click();

    // Wait for edit form to load — Report Format section must be visible
    await pm.reportsPage.expectReportFormatSectionVisible();

    // Assert the report type shows "CSV (Data)" as selected
    await pm.reportsPage.expectReportTypeOptionSelected('csv');

    // Assert attachment type and custom dimensions are hidden
    await pm.reportsPage.expectAttachmentTypeHidden();
    await pm.reportsPage.expectCustomDimensionsHidden();

    testLogger.info('Edit mode correctly reflects CSV type and hidden controls');

    // Cleanup: delete the report, then the dashboard
    // Navigate back to reports list first
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/reports?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.reportsPage.deleteReport(TEST_REPORT_NAME);
    await page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/dashboards?org_identifier=" +
        process.env["ORGNAME"]
    );
    await pm.dashboardPage.navigateToDashboards();
    await pm.dashboardPage.deleteDashboard();
    testLogger.info('Cleanup completed');
  });
});
