const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';
// Both sides of the switch need fresh rows, so the second stream is seeded here.
const OTHER_STREAM = 'regression_8383_switch';

test.describe("Logs table across a stream switch", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("the timestamp column survives a stream change", {
    tag: ['@bug-8383', '@P1', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    await ingestTestData(page, STREAM);
    await ingestTestData(page, OTHER_STREAM);

    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.expectTimestampColumnVisible();

    await pm.logsPage.selectStream(OTHER_STREAM);
    await pm.logsPage.selectRunQuery();

    await pm.logsPage.expectTimestampColumnVisible();
  });

  test("exploring a stream from the streams page leaves wrap and the histogram alone", {
    tag: ['@bug-7333', '@bug-7460', '@P2', '@regression', '@logsRegression'],
  }, async () => {
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.selectRunQuery();

    // Wrap is a persisted preference, so the invariant is that navigation does
    // not flip it -- not that it arrives off.
    await pm.logsPage.setWrapContentOff();

    await pm.logsPage.exploreStreamFromStreamsPage(STREAM);

    await pm.logsPage.expectWrapContentOn(false);
    await pm.logsPage.expectHistogramChartVisible();
  });
});
