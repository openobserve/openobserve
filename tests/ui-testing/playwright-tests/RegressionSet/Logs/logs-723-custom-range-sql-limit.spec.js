const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const logData = require('../../../fixtures/log.json');
const logsdata = require('../../../../test-data/logs_data.json');

// The server lets a SQL LIMIT override the requested range, so the range must be trimmed client-side.
test.describe('Regression: custom range download honours the range under a SQL LIMIT (#723)', () => {
  const RANGE = 500;
  let pm;
  let downloadDir;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    for (let i = 0; i < 3; i++) {
      await pm.logsPage.ingestLogs(process.env['ORGNAME'], 'e2e_automate', logsdata);
    }
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate" LIMIT 1000');
    await pm.logsPage.runQueryAndWaitForResults();
    downloadDir = await pm.logsPage.setupDownloadDirectory();
  });

  test.afterEach(async () => {
    await pm.logsPage.cleanupDownloadDirectory(downloadDir);
  });

  test('Custom range JSON download returns only the requested rows', {
    tag: ['@regression', '@logs', '@logsDownloads', '@P2'],
  }, async () => {
    await pm.logsPage.clickMoreOptionsButton();
    await pm.logsPage.clickDownloadResultsForCustom();
    await pm.logsPage.expectCustomDownloadDialogVisible();
    await pm.logsPage.clickCustomDownloadRangeSelect();
    await pm.logsPage.selectCustomDownloadRange(String(RANGE));
    await pm.logsPage.clickCustomDownloadFileTypeJson();

    const downloadPromise = pm.logsPage.waitForDownload();
    await pm.logsPage.clickConfirmDialogOkButton();
    const download = await downloadPromise;

    expect(download).toBeDefined();
    await pm.logsPage.verifyJsonDownloadWithCount(download, 'download_custom_limit.json', downloadDir, RANGE);
  });
});
