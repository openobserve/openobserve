import { test, expect } from "../baseFixtures";
import PageManager from "../../pages/page-manager.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
// (duplicate import removed)
import * as fs from 'fs';

test.describe("Logs Downloads testcases", () => {
  let pageManager;
  let downloadDir;

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);
    
    // Navigate to login page first
    await page.goto(process.env["ZO_BASE_URL"]);
    
    // Click "Login as internal user" if visible
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    
    // Use existing login function from logs page
    await pageManager.logsPage.login();
    await page.waitForTimeout(1000);
    
    // Use existing ingestion function from logs page - ingest multiple times to ensure enough data
    console.log('📊 Ingesting data to ensure sufficient records for testing...');
    await pageManager.logsPage.ingestLogs(process.env["ORGNAME"], "e2e_automate", logsdata);
    await page.waitForTimeout(1000);
    
    // Ingest additional data to ensure we have at least 10000 records
    for (let i = 0; i < 5; i++) {
      await pageManager.logsPage.ingestLogs(process.env["ORGNAME"], "e2e_automate", logsdata);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.clickRefreshButton();
    await expect(page.locator('[data-test="log-table-column-0-source"]').getByText('{"_timestamp":')).toBeVisible();
    
    // Setup download directory using page function
    downloadDir = await pageManager.logsPage.setupDownloadDirectory();
    
    // Verify directory exists and is accessible
    expect(fs.existsSync(downloadDir)).toBe(true);
  });

  test.afterEach(async () => {
    // Cleanup download directory using page function
    await pageManager.logsPage.cleanupDownloadDirectory(downloadDir);
  });

  // No streaming flips in this suite

  test("should download normal results and verify CSV content", {
    tag: ['@downloadNormal', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Normal download (no custom range)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResults();
    const downloadPromise = pageManager.logsPage.waitForDownload();
    await page.getByText('CSV', { exact: true }).click();
    const download = await downloadPromise;
    
    // Verify download started
    expect(download).toBeDefined();
    expect(download.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download, 'download_results.csv', downloadDir);
    console.log('✅ Test completed: Normal download verification finished');
  });

  test("should download custom range 100 results and verify CSV content", {
    tag: ['@downloadCustom100', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Custom range download (100 rows)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.expectCustomDownloadDialogVisible();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('100');
    const download1Promise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download1 = await download1Promise;
    
    // Verify download started
    expect(download1).toBeDefined();
    expect(download1.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download1, 'download_custom_100.csv', downloadDir);
    console.log('✅ Test completed: Custom range 100 rows verification finished');
  });

  test("should download custom range 500 results and verify CSV content", {
    tag: ['@downloadCustom500', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Custom range download (500 rows)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.expectCustomDownloadDialogVisible();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('500');
    const download2Promise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download2 = await download2Promise;
    
    // Verify download started
    expect(download2).toBeDefined();
    expect(download2.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download2, 'download_custom_500.csv', downloadDir);
    console.log('✅ Test completed: Custom range 500 rows verification finished');
  });

  test("should download custom range 1000 results and verify CSV content", {
    tag: ['@downloadCustom1000', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Custom range download (1000 rows)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('1000');
    const download3Promise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download3 = await download3Promise;
    
    // Verify download started
    expect(download3).toBeDefined();
    expect(download3.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download3, 'download_custom_1000.csv', downloadDir);
    console.log('✅ Test completed: Custom range 1000 rows verification finished');
  });

  test("should download custom range 5000 results and verify CSV content", {
    tag: ['@downloadCustom5000', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Custom range download (5000 rows)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('5000');
    const download4Promise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download4 = await download4Promise;
    
    // Verify download started
    expect(download4).toBeDefined();
    expect(download4.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download4, 'download_custom_5000.csv', downloadDir);
    console.log('✅ Test completed: Custom range 5000 rows verification finished');
  });

  test("should download custom range 10000 results and verify CSV content", {
    tag: ['@downloadCustom10000', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: Custom range download (10000 rows)');
    
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('10000');
    const download5Promise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download5 = await download5Promise;
    
    // Verify download started
    expect(download5).toBeDefined();
    expect(download5.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download5, 'download_custom_10000.csv', downloadDir);
    console.log('✅ Test completed: Custom range 10000 rows verification finished');
  });

  test("should download results with SQL mode LIMIT 2000 and verify CSV content", {
    tag: ['@downloadSQLLimit2000', '@downloadWithLimit', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: SQL mode download with LIMIT 2000');
    
    // Enable SQL mode
    await pageManager.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);
    
    // Clear and fill query editor with LIMIT query
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.clearQueryEditor();
    await pageManager.logsPage.fillQueryEditor('SELECT * FROM "e2e_automate" LIMIT 2000');
    await page.waitForTimeout(1000);
    
    // Execute query
    await pageManager.logsPage.clickRefreshButton();
    await page.waitForTimeout(2000);
    
    // Download results
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResults();
    const downloadPromise = pageManager.logsPage.waitForDownload();
    await page.getByText('CSV', { exact: true }).click();
    const download = await downloadPromise;
    
    // Verify download started
    expect(download).toBeDefined();
    expect(download.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download, 'download_sql_limit_2000.csv', downloadDir);
    console.log('✅ Test completed: SQL mode LIMIT 2000 download verification finished');
  });

  // To be uncommented post the bug fix

  test.skip("should download custom range 500 with SQL mode LIMIT 2000 and verify CSV content", {
    tag: ['@downloadSQLLimit2000Custom500', '@downloadWithLimit', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    console.log('🧪 Starting test: SQL mode LIMIT 2000 with custom range 500');
    
    // Enable SQL mode
    await pageManager.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);
    
    // Clear and fill query editor with LIMIT query
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.clearQueryEditor();
    await pageManager.logsPage.fillQueryEditor('SELECT * FROM "e2e_automate" LIMIT 2000');
    await page.waitForTimeout(1000);
    
    // Execute query
    await pageManager.logsPage.clickRefreshButton();
    await page.waitForTimeout(2000);
    
    // Download with custom range 500
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.clickDownloadResultsForCustom();
    await pageManager.logsPage.clickCustomDownloadRangeSelect();
    await pageManager.logsPage.selectCustomDownloadRange('500');
    const downloadPromise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickConfirmDialogOkButton();
    const download = await downloadPromise;
    
    // Verify download started
    expect(download).toBeDefined();
    expect(download.suggestedFilename()).toBeTruthy();
    
    await pageManager.logsPage.verifyDownload(download, 'download_sql_limit_2000_custom_500.csv', downloadDir);
    console.log('✅ Test completed: SQL mode LIMIT 2000 with custom range 500 verification finished');
  });

});