const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

test.describe("Logs multi-stream share URL", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const seededStreams = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Multi-stream share URL setup completed');
  });

  // Without this the seeded streams accumulate in the org on every nightly run.
  test.afterEach(async () => {
    while (seededStreams.length) {
      const name = seededStreams.pop();
      await pm.logsPage.deleteStream(name).catch((e) =>
        testLogger.warn(`Failed to delete stream ${name}: ${e.message}`)
      );
    }
  });
  test("a shared Logs URL should restore every selected stream, not just the first", {
    tag: ['@bug-7332', '@P2', '@regression', '@logsRegression', '@logsRegressionShareUrl']
  }, async ({ page, context }) => {
    testLogger.info('Test: multi-stream selection survives share URL (Bug #7332)');

    const prefix = `e2e_ms7332_${Math.random().toString(36).substring(2, 7)}_`;
    const streams = await pm.logsPage.seedLogStreams(prefix, 2);
    seededStreams.push(...streams);
    testLogger.info(`Seeded streams: ${streams.join(', ')}`);

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.waitForStreamAvailable(streams[0], 90000, 3000);
    await pm.logsPage.waitForStreamAvailable(streams[1], 90000, 3000);

    await pm.logsPage.selectStream(streams[0]);

    // Must click the checkbox: the option's label zone replaces the selection instead.
    await pm.logsPage.fillStreamFilter(streams[1]);
    await pm.logsPage.toggleStreamSelection(streams[1]);
    await page.keyboard.press('Escape');

    await pm.logsPage.expectLogsSearchIndexListContainsText(streams.join(', '));
    testLogger.info('Both streams selected');

    await pm.logsPage.clickRefresh();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info(`Shared short URL: ${sharedUrl}`);

    // Fresh page, and no Refresh after arriving: the link alone must restore the selection.
    const reopened = await context.newPage();
    try {
      await reopened.goto(sharedUrl);
      const reopenedPm = new PageManager(reopened);
      await reopenedPm.logsPage.waitForRedirectComplete();
      await reopened.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      // Asserts app state, not the URL: only the first stream reaches window.location.
      await reopenedPm.logsPage.expectLogsSearchIndexListContainsText(streams.join(', '));

      testLogger.info('✓ PASSED: multi-stream selection restored from shared link (Bug #7332)');
    } finally {
      await reopened.close();
    }
  });
});
