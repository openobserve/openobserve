const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Logs Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Data ingestion for logs page testing
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Logs regression bug test setup completed');
  });

  test("should display error icon and error message when entering invalid time in absolute time range", {
    tag: ['@absoluteTimeError', '@regressionBugs', '@logs']
  }, async () => {
    testLogger.info('Testing error validation for invalid absolute time input');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select e2e_automate stream
    await pm.logsPage.selectStream("e2e_automate");

    // Open date-time picker
    await pm.logsPage.clickDateTimeButton();

    // Switch to absolute time tab
    await pm.logsPage.clickAbsoluteTimeTab();

    // Verify Start time and End time are visible
    await pm.logsPage.expectStartTimeVisible();
    await pm.logsPage.expectEndTimeVisible();

    // Click on time cell and enter invalid time value (partial time)
    await pm.logsPage.clickTimeCell();
    await pm.logsPage.fillTimeCellWithInvalidValue('07:39:2');

    // Click outside to trigger validation
    await pm.logsPage.clickOutsideTimeInput();

    // Verify error icon is visible
    await pm.logsPage.expectErrorIconVisible();

    // Click run query button
    await pm.logsPage.clickRefreshButton();

    // Verify error details button is visible
    await pm.logsPage.expectResultErrorDetailsButtonVisible();

    // Click error details button
    await pm.logsPage.clickResultErrorDetailsButton();

    // Verify error message is visible
    await pm.logsPage.expectSearchDetailErrorMessageVisible();

    testLogger.info('Absolute time error validation test completed');
  });

  test("should display correct table fields when switching between saved views of different streams (#9388)", {
    tag: ['@savedViews', '@streamSwitching', '@regressionBugs', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing stream field persistence when switching saved views');

    // Generate unique names for streams and saved views
    const uniqueId = Date.now();
    const streamA = `e2e_stream_a_${uniqueId}`;
    const streamB = `e2e_stream_b_${uniqueId}`;
    const savedViewA = `view_a_${uniqueId}`;
    const savedViewB = `view_b_${uniqueId}`;
    const fieldForStreamA = 'kubernetes_container_name';
    const fieldForStreamB = 'log';

    // Ingest data to both streams
    testLogger.info(`Ingesting data to stream A: ${streamA}`);
    await ingestTestData(page, streamA);
    testLogger.info(`Ingesting data to stream B: ${streamB}`);
    await ingestTestData(page, streamB);
    await page.waitForLoadState('networkidle'); // Wait for data to be indexed

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // ===== STREAM A SETUP =====
    testLogger.info(`Setting up Stream A (${streamA}) with saved view`);

    // Select stream A
    await pm.logsPage.selectStream(streamA);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamA);
    await page.waitForTimeout(500);

    // Add field to table for stream A
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamA);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamA);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Added ${fieldForStreamA} to table for stream A`);

    // Create saved view for stream A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewA);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewA}`);

    // ===== STREAM B SETUP =====
    testLogger.info(`Setting up Stream B (${streamB}) with saved view`);

    // Switch to stream B
    await pm.logsPage.selectStream(streamB);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamB);
    await page.waitForTimeout(500);

    // Add different field to table for stream B
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamB);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamB);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Added ${fieldForStreamB} to table for stream B`);

    // Create saved view for stream B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewB);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewB}`);

    // ===== VERIFY SAVED VIEW SWITCHING =====
    testLogger.info('Verifying saved view switching maintains correct fields');

    // Switch to saved view A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewA);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewA);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream A field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Verified ${fieldForStreamA} present in saved view A`);

    // Switch to saved view B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewB);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewB);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream B field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Verified ${fieldForStreamB} present in saved view B`);

    // ===== CLEANUP: Delete saved views =====
    testLogger.info('Cleaning up saved views');

    // Delete saved view A
    await pm.logsPage.clickDeleteSavedViewButton(savedViewA);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    // Delete saved view B
    await pm.logsPage.clickDeleteSavedViewButton(savedViewB);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    testLogger.info('Stream switching test completed - saved views maintain correct fields for each stream');
  });

  test.afterEach(async () => {
    testLogger.info('Logs regression test completed');
  });
});
