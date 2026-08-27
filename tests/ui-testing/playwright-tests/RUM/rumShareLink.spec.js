/**
 * RUM Share Link — copy short-link to clipboard across the five RUM surfaces.
 *
 * The RUM module renders nothing until RUM is enabled (_rumdata stream exists)
 * and the Sessions toolbar additionally needs _sessionreplay — so beforeAll
 * generates ONE real session via the shared CDN sample fixture (same proven
 * pattern as rum-page-dataflow.spec.js) and captures its sessionId. Every test
 * then navigates to a RUM surface and asserts the shared ShareButton shortens
 * the current URL and copies a /web/short/<16-char-id> link to the clipboard.
 *
 * SERIAL IS REQUIRED: the tests share the module-state sessionId captured in
 * beforeAll (the session whose id reaches the Session Viewer / Error detail
 * share buttons); with parallel workers each test would re-run beforeAll and
 * lose the shared id.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080).
 *   - Network access to the CDN bundle; cross-origin RUM ingestion allowed.
 *   - ZO_WEB_URL configured (CI sets it) — otherwise every ShareButton renders
 *     :disabled and each test skips rather than failing on a missing env.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { RumShareButton } = require('../../pages/rumPages/rumShareButton.js');
const { startFixtureServer } = require('../../fixtures/rum/serve.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');
const { resolveCdnSdkVersion } = require('../utils/rum-sdk-version.js');
const {
  driveRumSampleInteractions,
  attachCdnAssetTracker,
  waitForRumSdkReady,
} = require('../utils/rum-traffic.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const SITE = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const INSECURE = BASE.startsWith('http://');

const RUN_ID = Date.now();
const SERVICE = `e2e-rum-share-${RUN_ID}`;
// The SDK session generated for this run — captured in beforeAll and used to
// reach the Session Viewer share button (its id is the route param).
let sessionId = null;
// False when the live CDN never delivered the lazy recorder chunk — without it
// no session carries session_has_replay and the Sessions toolbar (wrapped in
// v-if="isSessionReplayEnabled") never renders. External dependency → skip.
let replayCapable = false;

/**
 * Click a RUM share button and assert the share flow: success toast + a valid
 * /web/short/<id> URL on the clipboard. Skips (rather than fails) when the
 * button stays disabled — i.e. ZO_WEB_URL is not configured.
 */
async function shareAndExpectCopied(test, page, buttonLocator) {
  const share = new RumShareButton(page, buttonLocator);
  await share.expectVisible();
  test.skip(!(await share.waitForEnabled()), 'ZO_WEB_URL not configured — share button disabled');
  await share.click();
  await share.expectShortUrlCopied();
}

test.describe('RUM Share Link testcases', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.beforeAll(async ({ browser }) => {
    // 1) token + CDN SDK version (probed best-effort; falls back to the pin)
    const tokenPage = await browser.newPage();
    const rumToken = await getOrCreateRumToken(tokenPage);
    const sdkVersion = await resolveCdnSdkVersion(tokenPage);
    await tokenPage.close();
    expect(rumToken, 'RUM token should be available').toBeTruthy();

    // 2) serve fixture + generate one real session (fixture app needs no OO auth)
    const server = await startFixtureServer({
      clientToken: rumToken,
      org: ORG,
      site: SITE,
      insecureHTTP: INSECURE,
      service: SERVICE,
      env: 'e2e',
      version: '1.0.0',
      applicationId: `e2e-rum-share-app-${RUN_ID}`,
      sdkVersion,
    });

    const genContext = await browser.newContext();
    const app = await genContext.newPage();
    const cdn = attachCdnAssetTracker(app);
    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    await app
      .waitForResponse((r) => r.url().includes('browsersdk.openobserve.ai') && r.url().includes('openobserve-rum'), { timeout: 30000 })
      .catch(() => testLogger.warn('CDN rum bundle response not observed'));
    await waitForRumSdkReady(app);
    // Replay recording only starts once the LAZY recorder chunk arrives — wait
    // for it BEFORE interacting so events carry session_has_replay.
    await expect
      .poll(() => cdn.chunkLoaded('recorder'), { timeout: 20000, intervals: [1000, 2000] })
      .toBe(true)
      .catch(() => {});
    replayCapable = cdn.chunkLoaded('recorder');
    if (!replayCapable) {
      testLogger.warn('CDN recorder chunk unavailable — Sessions page assertions will be skipped', {
        failures: cdn.failures,
      });
    }
    await driveRumSampleInteractions(app);

    // 3) wait for the data to be searchable (mirroring rum-page-dataflow.spec.js)
    await waitForStreamRows(app, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });
    // Wait for a row that actually CARRIES a session (telemetry rows can lack it).
    const sessionRows = await waitForStreamRows(app, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}' AND session_id IS NOT NULL`,
      minRows: 1,
      timeoutMs: 30000,
    });
    sessionId = sessionRows[0]?.session_id || null;

    // 4) the session RECORDING must land too (precondition for the Sessions toolbar).
    const replayRows = replayCapable && sessionId
      ? await waitForStreamRows(app, {
          sql: `SELECT * FROM "_sessionreplay" WHERE session_id = '${sessionId}'`,
          minRows: 1,
          timeoutMs: 45000,
        })
      : [];

    await genContext.close();
    await server.close();

    expect(sessionId, 'generated RUM events should carry a session_id').toBeTruthy();
    if (replayCapable) {
      expect(replayRows.length, `_sessionreplay should contain segments for session ${sessionId}`)
        .toBeGreaterThan(0);
    }
    testLogger.info('RUM share-link setup complete', {
      service: SERVICE,
      sessionId,
      replayCapable,
      replayRows: replayRows.length,
    });
  });

  test('should copy a valid short link to clipboard via the Errors list share button', {
    tag: ['@rum-share-link', '@rum', '@share', '@all', '@P0'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumPage.gotoErrorsList({ service: SERVICE, period: '1h' });
    await shareAndExpectCopied(test, page, pm.rumPage.errorsShareButton);
    testLogger.info('Errors list share button copied a valid short link');
  });

  test('should copy a valid short link to clipboard via the Performance share button', {
    tag: ['@rum-share-link', '@rum', '@share', '@all', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumPerformancePage.gotoPerformance();
    await shareAndExpectCopied(test, page, pm.rumPerformancePage.performanceShareButton);
    testLogger.info('Performance share button copied a valid short link');
  });

  test('should copy a valid short link to clipboard via the Sessions list share button', {
    tag: ['@rum-share-link', '@rum', '@share', '@all', '@P1'],
  }, async ({ page }) => {
    test.skip(!replayCapable, 'CDN recorder chunk unavailable this run (external dependency)');
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionsList({ service: SERVICE, period: '1h' });
    await pm.rumSessionsPage.waitForSessionRowsPresent();
    await shareAndExpectCopied(test, page, pm.rumSessionsPage.sessionsShareButton);
    testLogger.info('Sessions list share button copied a valid short link');
  });

  test('should copy a valid short link to clipboard via the Session Viewer share button', {
    tag: ['@rum-share-link', '@rum', '@share', '@all', '@P1'],
  }, async ({ page }) => {
    test.skip(!replayCapable, 'CDN recorder chunk unavailable this run (external dependency)');
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionsList({ service: SERVICE, period: '1h' });
    await pm.rumSessionsPage.waitForSessionRowsPresent();
    await pm.rumSessionsPage.openFirstSession();
    await pm.rumSessionsPage.expectSessionViewerFor(sessionId);
    await shareAndExpectCopied(test, page, pm.rumSessionsPage.sessionViewerShareButton);
    testLogger.info('Session Viewer share button copied a valid short link');
  });

  test('should copy a valid short link to clipboard via the Error detail share button', {
    tag: ['@rum-share-link', '@rum', '@share', '@all', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumPage.gotoErrorsList({ service: SERVICE, period: '1h' });
    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForErrorRowsPresent();
    // URL-construction path (not openFirstError's row click): Playwright clicks
    // don't trigger the Vue @click row handler (see rumPage.clickFirstErrorRow).
    await pm.rumPage.clickFirstErrorRow();
    await pm.rumPage.expectErrorDetailViewLoaded();
    await shareAndExpectCopied(test, page, pm.rumPage.errorHeaderShareButton);
    testLogger.info('Error detail share button copied a valid short link');
  });

  test('should copy the Errors list share URL via the Ctrl+Shift+C shortcut', {
    tag: ['@rum-share-link', '@rum', '@shortcut', '@all', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumPage.gotoErrorsList({ service: SERVICE, period: '1h' });
    const share = new RumShareButton(page, pm.rumPage.errorsShareButton);
    await share.expectVisible();
    test.skip(!(await share.waitForEnabled()), 'ZO_WEB_URL not configured — share button disabled');
    await share.pressCopyShortcut();
    await share.expectShortUrlCopied();
    testLogger.info('Ctrl+Shift+C shortcut copied the Errors list share URL');
  });

  test('should copy the Sessions list share URL via the Ctrl+Shift+C shortcut', {
    tag: ['@rum-share-link', '@rum', '@shortcut', '@all', '@P1'],
  }, async ({ page }) => {
    test.skip(!replayCapable, 'CDN recorder chunk unavailable this run (external dependency)');
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionsList({ service: SERVICE, period: '1h' });
    await pm.rumSessionsPage.waitForSessionRowsPresent();
    const share = new RumShareButton(page, pm.rumSessionsPage.sessionsShareButton);
    await share.expectVisible();
    test.skip(!(await share.waitForEnabled()), 'ZO_WEB_URL not configured — share button disabled');
    await share.pressCopyShortcut();
    await share.expectShortUrlCopied();
    testLogger.info('Ctrl+Shift+C shortcut copied the Sessions list share URL');
  });

  test('should return an identical short link for an unchanged page (idempotency)', {
    tag: ['@rum-share-link', '@rum', '@share', '@idempotency', '@all', '@P2'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumPage.gotoErrorsList({ service: SERVICE, period: '1h' });
    const share = new RumShareButton(page, pm.rumPage.errorsShareButton);
    await share.expectVisible();
    test.skip(!(await share.waitForEnabled()), 'ZO_WEB_URL not configured — share button disabled');

    await share.click();
    await share.expectShortUrlCopied();
    const shortUrl1 = await share.readClipboardUrl();

    await share.click();
    await share.expectShortUrlCopied();
    const shortUrl2 = await share.readClipboardUrl();

    expect(shortUrl1, 'first copy should be a valid short URL').toMatch(RumShareButton.SHORT_URL_REGEX);
    expect(shortUrl2, 'unchanged page must yield the identical short id').toBe(shortUrl1);
    testLogger.info('Idempotency verified: repeated share returns the same short link');
  });

  // Safari polling branch is unreachable under the Chromium-only Playwright
  // project (playwright.config.js has WebKit commented out) — an environment
  // limitation, not feature-incomplete. Documented as fixme, no assertion body.
  test.fixme('Safari polling copy branch — not runnable under the Chromium-only Playwright project (ShareButton.vue:123,231-233,243-245)', {
    tag: ['@rum-share-link', '@rum', '@safari', '@all', '@P2'],
  }, async () => {});
});
