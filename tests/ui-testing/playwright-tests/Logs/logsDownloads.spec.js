const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");
const fs = require('fs');

test.describe("Logs Downloads testcases", () => {
  let pageManager;
  let downloadDir;

  // Helper function to set up logs page after navigation
  async function setupLogsPage(page) {
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.clickRefreshButton();
    // Wait for results to load by checking the results summary text shows non-zero records
    await pageManager.logsPage.expectPaginationRowCountVisible();
  }

  // Helper function to set up SQL mode with LIMIT 2000
  async function setupSQLMode(page) {
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.clearQueryEditor();
    await pageManager.logsPage.fillQueryEditor('SELECT * FROM "e2e_automate" LIMIT 2000');
    await pageManager.logsPage.waitForQueryEditorValue('LIMIT 2000');
    // Use runQueryAndWaitForResults: toggling SQL mode auto-fires a search, and the
    // bare refresh-button click can cancel that in-flight search (the button is in
    // "Cancel query" mode while the auto-search runs). runQueryAndWaitForResults
    // waits for the Cancel state to clear before clicking and then waits for the
    // new search to fully complete.
    await pageManager.logsPage.runQueryAndWaitForResults();
    // Wait deterministically for the SQL results to fully load — the download click
    // reads `searchObj.data.queryResults.hits` directly, so we must wait until the
    // pagination title reports >= 2000 records before triggering the download.
    // (HEAD's strict check kept — the lenient `expectPaginationRowCountVisible`
    // from main would mask the documented §7a in-memory hits replace race.)
    await pageManager.logsPage.expectPaginationTotalAtLeast(2000);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Use existing ingestion function from logs page - ingest multiple times to ensure enough data
    testLogger.info('Ingesting data to ensure sufficient records for testing');
    await pageManager.logsPage.ingestLogs(process.env["ORGNAME"], "e2e_automate", logsdata);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Ingest additional data to ensure we have at least 10000 records
    for (let i = 0; i < 5; i++) {
      await pageManager.logsPage.ingestLogs(process.env["ORGNAME"], "e2e_automate", logsdata);
      await page.waitForLoadState('domcontentloaded');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.clickRefreshButton();
    // Wait for results to load by checking the results summary text shows non-zero records
    await pageManager.logsPage.expectPaginationRowCountVisible();

    // Setup download directory using page function
    downloadDir = await pageManager.logsPage.setupDownloadDirectory();

    // Verify directory exists and is accessible
    expect(fs.existsSync(downloadDir)).toBe(true);
  });

  test.afterEach(async () => {
    // Cleanup download directory using page function
    await pageManager.logsPage.cleanupDownloadDirectory(downloadDir);
  });

  test("should download all formats and scenarios with detailed error handling", {
    tag: ['@downloadAll', '@all', '@logs', '@logsDownloads']
  }, async ({ page }) => {
    // Set timeout for this specific test to 6 minutes
    test.setTimeout(360000);

    testLogger.info('🚀 Starting comprehensive download test: All formats and scenarios');

    const testResults = [];
    let totalTests = 0;
    let passedTests = 0;

    // Helper function to execute download with error handling
    async function executeDownloadTest(testName, downloadFunction) {
      totalTests++;
      try {
        testLogger.info(`Testing: ${testName}`);
        await downloadFunction();
        testLogger.info(`✅ PASSED: ${testName}`);
        testResults.push({ test: testName, status: 'PASSED', error: null });
        passedTests++;
      } catch (error) {
        testLogger.error(`❌ FAILED: ${testName}`, { error: error.message });
        testResults.push({ test: testName, status: 'FAILED', error: error.message });
        // Don't throw, continue with other tests
      }
    }

    // 1. Normal Downloads
    await executeDownloadTest('Normal CSV Download', async () => {
      await pageManager.logsPage.clickMoreOptionsButton();
      await pageManager.logsPage.hoverDownloadResults();
      const csvDownloadPromise = pageManager.logsPage.waitForDownload();
      await pageManager.logsPage.clickDownloadCsv();

      const csvDownload = await csvDownloadPromise;
      expect(csvDownload).toBeDefined();
      await pageManager.logsPage.verifyDownload(csvDownload, 'download_normal.csv', downloadDir);
    });

    await executeDownloadTest('Normal JSON Download', async () => {
      testLogger.debug('🔄 Refreshing for Normal JSON');
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await setupLogsPage(page);

      await pageManager.logsPage.clickMoreOptionsButton();
      await pageManager.logsPage.hoverDownloadResults();
      const jsonDownloadPromise = pageManager.logsPage.waitForDownload();
      await pageManager.logsPage.clickDownloadJson();

      const jsonDownload = await jsonDownloadPromise;
      expect(jsonDownload).toBeDefined();
      await pageManager.logsPage.verifyJsonDownload(jsonDownload, 'download_normal.json', downloadDir);
    });

    // 2. Custom Range Downloads
    const ranges = ['100', '500', '1000', '5000', '10000'];
    for (const range of ranges) {

      await executeDownloadTest(`Custom Range ${range} CSV Download`, async () => {
        testLogger.debug(`🔄 Refreshing for Custom Range ${range} CSV`);
        await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await setupLogsPage(page);

        await pageManager.logsPage.clickMoreOptionsButton();
        await pageManager.logsPage.clickDownloadResultsForCustom();
        await pageManager.logsPage.expectCustomDownloadDialogVisible();
        await pageManager.logsPage.clickCustomDownloadRangeSelect();
        await pageManager.logsPage.selectCustomDownloadRange(range);

        const csvDownloadPromise = pageManager.logsPage.waitForDownload();
        await pageManager.logsPage.clickConfirmDialogOkButton();
        const csvDownload = await csvDownloadPromise;

        expect(csvDownload).toBeDefined();
        await pageManager.logsPage.verifyDownload(csvDownload, `download_custom_${range}.csv`, downloadDir);
      });

      await executeDownloadTest(`Custom Range ${range} JSON Download`, async () => {
        testLogger.debug(`🔄 Refreshing for Custom Range ${range} JSON`);
        await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await setupLogsPage(page);

        await pageManager.logsPage.clickMoreOptionsButton();
        await pageManager.logsPage.clickDownloadResultsForCustom();
        await pageManager.logsPage.expectCustomDownloadDialogVisible();
        await pageManager.logsPage.clickCustomDownloadRangeSelect();
        await pageManager.logsPage.selectCustomDownloadRange(range);

        await pageManager.logsPage.clickCustomDownloadFileTypeJson();

        const jsonDownloadPromise = pageManager.logsPage.waitForDownload();
        await pageManager.logsPage.clickConfirmDialogOkButton();
        const jsonDownload = await jsonDownloadPromise;

        expect(jsonDownload).toBeDefined();
        await pageManager.logsPage.verifyJsonDownloadWithCount(jsonDownload, `download_custom_${range}.json`, downloadDir, parseInt(range));
      });
    }

    // 3. SQL Mode Downloads
    await executeDownloadTest('SQL Mode LIMIT 2000 CSV Download', async () => {
      testLogger.debug('🔄 Refreshing for SQL Mode CSV');
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await setupLogsPage(page);
      await setupSQLMode(page);

      await pageManager.logsPage.clickMoreOptionsButton();
      await pageManager.logsPage.hoverDownloadResults();
      const csvDownloadPromise = pageManager.logsPage.waitForDownload();
      await pageManager.logsPage.clickDownloadCsv();
      const csvDownload = await csvDownloadPromise;

      expect(csvDownload).toBeDefined();
      await pageManager.logsPage.verifyDownload(csvDownload, 'download_sql_2000.csv', downloadDir);
    });

    await executeDownloadTest('SQL Mode LIMIT 2000 JSON Download', async () => {
      testLogger.debug('🔄 Refreshing for SQL Mode JSON');
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await setupLogsPage(page);
      await setupSQLMode(page);

      await pageManager.logsPage.clickMoreOptionsButton();
      await pageManager.logsPage.hoverDownloadResults();
      const jsonDownloadPromise = pageManager.logsPage.waitForDownload();
      await pageManager.logsPage.clickDownloadJson();
      const jsonDownload = await jsonDownloadPromise;

      expect(jsonDownload).toBeDefined();
      // SQL mode downloads searchObj.data.queryResults.hits (current page), not the
      // full LIMIT-2000 result set — verify valid JSON with records, not exact count.
      await pageManager.logsPage.verifyJsonDownload(jsonDownload, 'download_sql_2000.json', downloadDir);
    });

    // Final Results Summary
    testLogger.info('\n📊 COMPREHENSIVE TEST RESULTS SUMMARY:');
    testLogger.info('='.repeat(50));
    testLogger.info(`Total Tests: ${totalTests}`);
    testLogger.info(`Passed: ${passedTests}`);
    testLogger.info(`Failed: ${totalTests - passedTests}`);
    testLogger.info('='.repeat(50));

    testResults.forEach(result => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      testLogger.info(`${status} ${result.test}`);
      if (result.error) {
        testLogger.error(`   Error: ${result.error}`);
      }
    });

    testLogger.info('='.repeat(50));

    // Fail the test if any individual test failed
    const failedTests = testResults.filter(r => r.status === 'FAILED');
    if (failedTests.length > 0) {
      const failedTestNames = failedTests.map(f => f.test).join(', ');
      throw new Error(`${failedTests.length} test(s) failed: ${failedTestNames}`);
    }

    testLogger.info('🎉 ALL DOWNLOAD TESTS PASSED SUCCESSFULLY!');
  });


});