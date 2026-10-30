const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { createReportViaApi } = require('../../../pages/reportsPages/reportCreation.js');

test.describe("Reports list refresh", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let deletedReport;
  let survivingReport;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const token = Date.now();
    deletedReport = `e2e_7280_gone_${token}`;
    survivingReport = `e2e_7280_kept_${token}`;
    for (const name of [deletedReport, survivingReport]) {
      const result = await createReportViaApi(pm.apiCleanup, name);
      expect(result.success, `Precondition: report ${name} must be created — ${result.error}`).toBe(true);
    }
    testLogger.info(`Created reports ${deletedReport} and ${survivingReport}`);
  });

  test.afterEach(async () => {
    for (const name of [deletedReport, survivingReport]) {
      if (name) {
        await pm.apiCleanup.deleteReport(name).catch((e) =>
          testLogger.warn(`Report cleanup failed for ${name}: ${e.message}`)
        );
      }
    }
    deletedReport = undefined;
    survivingReport = undefined;
  });

  test("a deleted report must not come back when the list reloads", {
    tag: ['@bug-7280', '@P2', '@regression', '@reportsRegression', '@reportsRegressionList']
  }, async () => {
    await pm.reportsPage.navigateToReports();
    await pm.reportsPage.expectReportListed(deletedReport);

    await pm.reportsPage.deleteReport(deletedReport);
    await pm.reportsPage.expectReportNotListed(deletedReport);
    testLogger.info('Report disappeared from the list on delete');

    // The Cached-tab round trip invalidates the folder cache and reloads — the cache is what handed the row back.
    await pm.reportsPage.selectReportTab('cached');
    await pm.reportsPage.selectReportTab('shared');

    await pm.reportsPage.expectReportNotListed(deletedReport);

    // The control side: without it, a list that reloaded into nothing would pass.
    await pm.reportsPage.expectReportListed(survivingReport);

    testLogger.info('PASSED: deleted report stayed deleted across a reload (Bug #7280)');
  });
});
