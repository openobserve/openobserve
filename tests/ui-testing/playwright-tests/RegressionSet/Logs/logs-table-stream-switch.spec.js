const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const STREAM = 'e2e_automate';

test.describe("Logs table across a stream switch", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("navigating from a stream explorer back to Logs leaves wrap and the histogram alone", {
    tag: ['@bug-7333', '@bug-7460', '@P2', '@regression', '@logsRegression'],
  }, async () => {
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.selectRunQuery();

    // Wrap is a persisted preference, so the invariant is that navigation does
    // not flip it -- not that it arrives off.
    await pm.logsPage.setWrapContentOff();

    await pm.logsPage.exploreStreamFromStreamsPage(STREAM);

    // The menu hop out of the explorer is what runs the watcher the fix changed;
    // stopping at the explorer never reaches it.
    await pm.logsPage.navigateToLogsFromSidebar();

    // #7460 dropped the histogram on this hop; the toggle must survive it before any run can restore it.
    await expect.poll(() => pm.logsPage.isHistogramOn(), { timeout: 15000 }).toBe(true);

    // Returning to Logs lands idle on "Run a query" (#15234), so the chart only renders after a run.
    await pm.logsPage.selectRunQuery();

    // Asserting wrap before the page has rendered reads back the value the test
    // set itself, so the results have to land first.
    await pm.logsPage.expectHistogramChartVisible();
    await pm.logsPage.expectLogsTableVisible();

    await pm.logsPage.expectWrapContentOn(false);
  });
});
