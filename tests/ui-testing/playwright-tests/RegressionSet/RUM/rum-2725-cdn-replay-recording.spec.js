const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { RumReplayPlayerPage } = require('../../../pages/rumPages/rumReplayPlayerPage.js');
const { getOrCreateRumToken } = require('../../utils/rum-token-api.js');
const { waitForStreamRows } = require('../../utils/rum-stream-verify.js');
const { validatedOrgId } = require('../../utils/rum-env.js');
const { startSnippetAppServer, snippetBundleDownloadError, SnippetAppPage, HEADING } = require('./fixtures/onboarding-snippet-app.js');

const TAGS = ['@bug-2725', '@P0', '@regression', '@rumRegression'];
const SDK_BUNDLE = /https:\/\/browsersdk\.openobserve\.ai\/[^'"\s]+\.js/;
const HOUR_US = 3600 * 1000 * 1000;

test.describe('RUM session replay through the CDN snippet the app hands out (ENT#2725)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('a page using the onboarding CDN snippet loads the recorder, uploads replay segments and plays back', {
    tag: TAGS,
  }, async ({ page, browser }) => {
    const pm = new PageManager(page);
    const org = validatedOrgId();
    expect(await getOrCreateRumToken(page), 'Precondition: a RUM token must exist').toBeTruthy();
    await pm.rumIngestionPage.gotoFrontendMonitoring();
    await pm.rumIngestionPage.expectPageLoaded();
    await pm.rumIngestionPage.switchToCdnVariant();
    const { install, init } = await pm.rumIngestionPage.cdnSnippets();
    // The snippet samples replay at 50%, and a session outside the sample would record nothing for an unrelated reason.
    const everySession = init.replace(/sessionReplaySampleRate:\s*\d+/, 'sessionReplaySampleRate: 100');
    expect(everySession, 'Precondition: the snippet must set the replay sample rate').toContain('sessionReplaySampleRate: 100');

    const bundleUrl = install.match(SDK_BUNDLE)?.[0];
    expect(bundleUrl, 'Precondition: the snippet must load the SDK from the CDN').toBeTruthy();
    expect(
      await snippetBundleDownloadError(bundleUrl),
      `The RUM browser SDK could not be downloaded from ${bundleUrl} (CDN down or version missing), so no session can be recorded`,
    ).toBe('');

    const server = await startSnippetAppServer({ install, init: everySession });
    const appContext = await browser.newContext();
    let sessionId;
    try {
      const app = new SnippetAppPage(await appContext.newPage(), org);
      app.watchRecorderFailures();
      const firstUpload = app.nextReplayUpload();
      const chunk = await app.openAndAwaitRecorderChunk(server.url);
      expect(chunk.status, `the CDN must serve ${chunk.url}`).toBe(200);
      expect(chunk.contentType, 'module scripts are rejected unless served as JavaScript').toMatch(/javascript/);
      expect(app.recorderFailures, 'the SDK must not report a recorder failure').toEqual([]);
      await app.clickAddItem();
      await app.awaitReplayUpload(firstUpload);

      // A live session's newest segment is held back by the player, so a second one must follow the first.
      const secondUpload = app.nextReplayUpload();
      await app.clickAddItem();
      await secondUpload;

      sessionId = await app.sessionId();
      expect(sessionId, 'the SDK must have started a session').toBeTruthy();
      const rows = await waitForStreamRows(app.page, {
        sql: `SELECT start FROM "_sessionreplay" WHERE session_id = '${sessionId}'`,
        minRows: 2,
        timeoutMs: 60000,
      });
      expect(rows.length, `_sessionreplay must hold both segments of session ${sessionId}`).toBeGreaterThanOrEqual(2);
    } finally {
      await appContext.close();
      await server.close();
    }

    const player = new RumReplayPlayerPage(page);
    await pm.rumSessionsPage.gotoSessionViewer(sessionId, {
      startTimeUs: Date.now() * 1000 - HOUR_US,
      endTimeUs: Date.now() * 1000,
    });
    await player.expectFrameShows(HEADING, 60000);
    testLogger.info('Replay recorded over the CDN plays back', { sessionId });
  });
});
