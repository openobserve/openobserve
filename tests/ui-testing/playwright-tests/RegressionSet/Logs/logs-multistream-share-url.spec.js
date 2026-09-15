/**
 * Multi-stream selection survives a shared Logs URL — #7332.
 *
 * The report is "the stream settings are not a part of share url": with more
 * than one stream selected, the shared link came back with the selection lost.
 * `Logs/shareLink.spec.js` already covers the single-stream case thoroughly, so
 * this spec only adds the multi-stream one.
 *
 * It MUST go through `clickShareLinkAndGetUrl` (the short link), not the
 * address bar. Verified against o2latestmain: with two streams selected the
 * index list shows both, but `window.location` carries only the first, and
 * that is by design — multi-stream state is held server-side against the
 * short link, which is what the fix for #7332 addressed (the closing
 * verification on the issue cites a `/web/short/…` URL). Asserting on the
 * address bar therefore fails on a correctly working build.
 *
 * Consequence: this spec needs a deployment with `web_url` set, because
 * `ShareButton` is disabled outright without it
 * (components/common/ShareButton.vue). The regression workflow sets
 * `ZO_WEB_URL`, so it runs in CI; it cannot run against a dev env that leaves
 * `web_url` empty.
 */

const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

test.describe("Logs multi-stream share URL", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Multi-stream share URL setup completed');
  });

  // ==========================================================================
  // Bug #7332: when I select multi stream, share URL does not work
  // https://github.com/openobserve/openobserve/issues/7332
  // ==========================================================================
  test("a shared Logs URL should restore every selected stream, not just the first", {
    tag: ['@bug-7332', '@P2', '@regression', '@logsRegression', '@logsRegressionShareUrl']
  }, async ({ page, context }) => {
    testLogger.info('Test: multi-stream selection survives share URL (Bug #7332)');

    const prefix = `e2e_ms7332_${Math.random().toString(36).substring(2, 7)}_`;
    const streams = await pm.logsPage.seedLogStreams(prefix, 2);
    testLogger.info(`Seeded streams: ${streams.join(', ')}`);

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.waitForStreamAvailable(streams[0], 90000, 3000);
    await pm.logsPage.waitForStreamAvailable(streams[1], 90000, 3000);

    await pm.logsPage.selectStream(streams[0]);

    // The second stream has to be added through its checkbox: clicking the
    // option's label zone REPLACES the selection instead of extending it.
    await pm.logsPage.fillStreamFilter(streams[1]);
    await pm.logsPage.toggleStreamSelection(streams[1]);
    await page.keyboard.press('Escape');

    await pm.logsPage.expectLogsSearchIndexListContainsText(streams.join(', '));
    testLogger.info('Both streams selected');

    await pm.logsPage.clickRefresh();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info(`Shared short URL: ${sharedUrl}`);

    // A fresh page, so the restored selection cannot come from this page's
    // in-memory state. No Refresh click after arriving — the selection has to
    // be restored by the link alone.
    const reopened = await context.newPage();
    try {
      await reopened.goto(sharedUrl);
      const reopenedPm = new PageManager(reopened);
      await reopenedPm.logsPage.waitForRedirectComplete();
      await reopened.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      // The index list is the assertion, not the URL: the short link restores
      // the selection into app state, and only the first stream ever reaches
      // window.location even on a working build.
      await reopenedPm.logsPage.expectLogsSearchIndexListContainsText(streams.join(', '));

      testLogger.info('✓ PASSED: multi-stream selection restored from shared link (Bug #7332)');
    } finally {
      await reopened.close();
    }
  });
});
