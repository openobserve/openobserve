const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { RumReplayPlayerPage } = require('../../../pages/rumPages/rumReplayPlayerPage.js');
const { getOrCreateRumToken } = require('../../utils/rum-token-api.js');
const { waitForStreamRows } = require('../../utils/rum-stream-verify.js');
const { validatedOrgId } = require('../../utils/rum-env.js');
const { nextReplayUpload } = require('./fixtures/multi-tab-replay-app.js');
const { startSnippetAppServer, snippetBundleDownloadError, HEADING, ADD_ITEM_BTN } = require('./fixtures/onboarding-snippet-app.js');

const TAGS = ['@bug-2725', '@P0', '@regression', '@rumRegression'];
const CDN_HOST = 'browsersdk.openobserve.ai';
const RECORDER_CHUNK = /browsersdk\.openobserve\.ai\/[^/]+\/chunks\/recorder-[^/]*\.js/;
const SDK_BUNDLE = /https:\/\/browsersdk\.openobserve\.ai\/[^'"\s]+\.js/;
const CDN_LOAD_TIMEOUT_MS = 30000;
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
      const app = await appContext.newPage();
      const recorderFailures = [];
      app.on('console', (msg) => {
        if (/Recorder failed to start|Failed to load module script/.test(msg.text())) recorderFailures.push(msg.text());
      });
      const cdnFailures = [];
      app.on('requestfailed', (req) => {
        if (req.url().includes(CDN_HOST)) cdnFailures.push(`${req.url()}: ${req.failure()?.errorText}`);
      });
      const recorderChunk = app.waitForResponse((r) => RECORDER_CHUNK.test(r.url()), { timeout: CDN_LOAD_TIMEOUT_MS });
      const firstUpload = nextReplayUpload(app, org);
      await app.goto(server.url, { waitUntil: 'domcontentloaded' });

      const chunk = await recorderChunk.catch((err) => {
        throw new Error(`No recorder chunk arrived from the CDN. Failed CDN requests: ${JSON.stringify(cdnFailures)}. With none, the page never asked for it, which is what a snippet without crossOrigin does. ${err.message}`);
      });
      expect(chunk.status(), `the CDN must serve ${chunk.url()}`).toBe(200);
      expect(chunk.headers()['content-type'], 'module scripts are rejected unless served as JavaScript').toMatch(/javascript/);
      expect(recorderFailures, 'the SDK must not report a recorder failure').toEqual([]);
      await app.locator(ADD_ITEM_BTN).click();
      await firstUpload.catch((err) => {
        throw new Error(`The recorder chunk loaded but no replay upload followed. SDK recorder failures: ${JSON.stringify(recorderFailures)}. ${err.message}`);
      });

      // A live session's newest segment is held back by the player, so a second one must follow the first.
      const secondUpload = nextReplayUpload(app, org);
      await app.locator(ADD_ITEM_BTN).click();
      await secondUpload;

      sessionId = await app.evaluate(() => window.O2_RUM.getInternalContext()?.session_id);
      expect(sessionId, 'the SDK must have started a session').toBeTruthy();
      const rows = await waitForStreamRows(app, {
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
