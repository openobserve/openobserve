const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");
const fs = require('fs');

test.describe("Logs Downloads testcases", () => {
  let pageManager;
  let downloadDir;

  // Helper function to set up SQL mode with LIMIT 2000
  async function setupSQLMode() {
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
    await pageManager.logsPage.expectPaginationTotalAtLeast(2000);
  }

  // ---- Individual download scenarios (each asserts and throws on its own failure) ----

  async function downloadNormalCsv() {
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.hoverDownloadResults();
    const csvDownloadPromise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickDownloadCsv();

    const csvDownload = await csvDownloadPromise;
    expect(csvDownload).toBeDefined();
    await pageManager.logsPage.verifyDownload(csvDownload, 'download_normal.csv', downloadDir);
  }

  async function downloadNormalJson() {
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.hoverDownloadResults();
    const jsonDownloadPromise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickDownloadJson();

    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload).toBeDefined();
    await pageManager.logsPage.verifyJsonDownload(jsonDownload, 'download_normal.json', downloadDir);
  }

  async function downloadCustomRangeCsv(range) {
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
  }

  async function downloadCustomRangeJson(range) {
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
  }

  async function downloadSqlModeCsv() {
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.hoverDownloadResults();
    const csvDownloadPromise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickDownloadCsv();
    const csvDownload = await csvDownloadPromise;

    expect(csvDownload).toBeDefined();
    await pageManager.logsPage.verifyDownload(csvDownload, 'download_sql_2000.csv', downloadDir);
  }

  async function downloadSqlModeJson() {
    await pageManager.logsPage.clickMoreOptionsButton();
    await pageManager.logsPage.hoverDownloadResults();
    const jsonDownloadPromise = pageManager.logsPage.waitForDownload();
    await pageManager.logsPage.clickDownloadJson();
    const jsonDownload = await jsonDownloadPromise;

    expect(jsonDownload).toBeDefined();
    // SQL mode downloads searchObj.data.queryResults.hits (current page), not the
    // full LIMIT-2000 result set — verify valid JSON with records, not exact count.
    await pageManager.logsPage.verifyJsonDownload(jsonDownload, 'download_sql_2000.json', downloadDir);
  }

  const CUSTOM_RANGES = ['100', '500', '1000', '5000', '10000'];

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

    // Ingest additional data to ensure we have at least 10000 records (needed for the
    // Custom Range 10000 download scenario).
    for (let i = 0; i < 5; i++) {
      await pageManager.logsPage.ingestLogs(process.env["ORGNAME"], "e2e_automate", logsdata);
      await page.waitForLoadState('domcontentloaded');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    // Use runQueryAndWaitForResults (not a bare refresh click) so the stream-selection
    // auto-search isn't force-cancelled into a stuck 0-hit loading state.
    await pageManager.logsPage.runQueryAndWaitForResults();
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

  // NOTE: The former single "download all formats and scenarios" test ran ALL 14 download
  // scenarios sequentially inside ONE test body (each with a full page.reload + re-setup).
  // That reliably exceeded the 360s test timeout on CI — Playwright then tore down the page,
  // so the remaining scenarios failed with "Target page/context closed" (a cascade from the
  // timeout, not a real download bug). It also swallowed per-scenario errors (try/catch +
  // aggregate throw), hiding the real stack.
  //
  // Each scenario is now its own test. The beforeEach already leaves a fresh logs page with
  // results loaded, so no per-scenario reload is needed — every test is short, isolated
  // (one failing download can't close the page for the others), and parallelizes across
  // workers. The @downloadAll tag is preserved on every test for suite selection.

  test("Normal CSV download", {
    tag: ['@downloadAll', '@downloadNormal', '@all', '@logs', '@logsDownloads']
  }, async () => {
    await downloadNormalCsv();
  });

  test("Normal JSON download", {
    tag: ['@downloadAll', '@downloadNormal', '@all', '@logs', '@logsDownloads']
  }, async () => {
    await downloadNormalJson();
  });

  for (const range of CUSTOM_RANGES) {
    test(`Custom Range ${range} CSV download`, {
      tag: ['@downloadAll', '@downloadCustomCsv', '@all', '@logs', '@logsDownloads']
    }, async () => {
      await downloadCustomRangeCsv(range);
    });

    test(`Custom Range ${range} JSON download`, {
      tag: ['@downloadAll', '@downloadCustomJson', '@all', '@logs', '@logsDownloads']
    }, async () => {
      await downloadCustomRangeJson(range);
    });
  }

  test("SQL Mode LIMIT 2000 CSV download", {
    tag: ['@downloadAll', '@downloadSql', '@all', '@logs', '@logsDownloads']
  }, async () => {
    await setupSQLMode();
    await downloadSqlModeCsv();
  });

  test("SQL Mode LIMIT 2000 JSON download", {
    tag: ['@downloadAll', '@downloadSql', '@all', '@logs', '@logsDownloads']
  }, async () => {
    await setupSQLMode();
    await downloadSqlModeJson();
  });

});
