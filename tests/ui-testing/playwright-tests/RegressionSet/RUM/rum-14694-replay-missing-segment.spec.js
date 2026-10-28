// A replay segment lost in transit left the player at 00:00 / 00:00 (openobserve#14694); each session here drops one upload on purpose.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { RumReplayPlayerPage } = require('../../../pages/rumPages/rumReplayPlayerPage.js');
const { getOrCreateRumToken } = require('../../utils/rum-token-api.js');
const { pinnedCdnSdkVersion } = require('../../utils/rum-sdk-version.js');
const { waitForStreamRows } = require('../../utils/rum-stream-verify.js');
const { validatedOrgId, validatedBaseUrl } = require('../../utils/rum-env.js');
const {
  startMultiTabReplayServer,
  localSdkBundleDir,
  recordPageChangeSession,
  ORDERS_TAB,
  CATALOGUE_TAB,
} = require('./fixtures/multi-tab-replay-app.js');

const TAGS = ['@bug-14694', '@P2', '@regression', '@rumRegression'];
const RUN_ID = `${Date.now()}-${process.pid}`;
const HOUR_US = 3600 * 1000 * 1000;
const RECORDING_TIMEOUT_MS = 9 * 60 * 1000;

// Upload 1 carries the orders view's full snapshot; upload 2 is a mutation-only segment in the middle of that view.
const SCENARIOS = {
  middleGap: { dropUpload: 2 },
  firstMissing: { dropUpload: 1 },
  complete: { dropUpload: 0 },
};

const sessions = {};

async function recordScenarios(browser) {
  const base = validatedBaseUrl();
  const org = validatedOrgId();
  const tokenPage = await browser.newPage();
  const clientToken = await getOrCreateRumToken(tokenPage).finally(() => tokenPage.close());
  expect(clientToken, 'Precondition: a RUM token must exist').toBeTruthy();

  const server = await startMultiTabReplayServer({
    clientToken,
    org,
    site: base.replace(/^https?:\/\//, ''),
    insecureHTTP: base.startsWith('http://'),
    service: `e2e-rum-gap-${RUN_ID}`,
    applicationId: `e2e-rum-gap-${RUN_ID}`,
    // The player is under test, not the SDK delivery, so a CDN outage must not fail the recording.
    sdkDir: localSdkBundleDir(pinnedCdnSdkVersion()),
  });
  try {
    expect(
      await server.sdkDownloadError(),
      `The RUM browser SDK could not be loaded from ${server.sdkUrl}, so no replay can be recorded`,
    ).toBe('');
    for (const [name, opts] of Object.entries(SCENARIOS)) {
      // A fresh context per scenario, so each recording is its own RUM session.
      const context = await browser.newContext();
      try {
        sessions[name] = await recordPageChangeSession(context, server, org, opts);
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.close();
  }
}

async function storedSegments(browser, recorded) {
  const probe = await browser.newPage();
  try {
    return await waitForStreamRows(probe, {
      sql: `SELECT start, view_id, index_in_view FROM "_sessionreplay" WHERE session_id = '${recorded.sessionId}' ORDER BY start`,
      minRows: recorded.stored,
      timeoutMs: 60000,
    });
  } finally {
    await probe.close();
  }
}

const viewIndexes = (rows, viewId) => rows.filter((r) => r.view_id === viewId).map((r) => Number(r.index_in_view)).sort((a, b) => a - b);

async function openPlayer(page, name) {
  const recorded = sessions[name];
  const pm = new PageManager(page);
  const player = new RumReplayPlayerPage(page);
  const faults = player.watchPlayerFaults();
  await pm.rumSessionsPage.gotoSessionViewer(recorded.sessionId, {
    startTimeUs: recorded.firstStartMs * 1000 - HOUR_US,
    endTimeUs: Date.now() * 1000,
  });
  await player.expectDurationNotZero(60000);
  testLogger.info('Replay opened', { name, sessionId: recorded.sessionId, duration: await player.durationText() });
  return { player, faults, recorded };
}

test.describe('RUM session replay with a missing segment (#14694)', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(RECORDING_TIMEOUT_MS);
    await recordScenarios(browser);
    for (const [name, recorded] of Object.entries(sessions)) {
      expect(recorded.sameSession, `Precondition: the ${name} page change must stay in one RUM session`).toBe(true);
      recorded.stored = recorded.uploads - (SCENARIOS[name].dropUpload ? 1 : 0);
      const rows = await storedSegments(browser, recorded);
      recorded.firstStartMs = Math.min(...rows.map((r) => Number(r.start)));
      recorded.playableEndSec = Math.floor((Math.max(...rows.map((r) => Number(r.start))) - recorded.firstStartMs) / 1000) - 1;
      recorded.ordersIndexes = viewIndexes(rows, recorded.ordersViewId);
      recorded.catalogueIndexes = viewIndexes(rows, recorded.catalogueViewId);
      testLogger.info('Recorded replay', { name, ...recorded });
    }
    expect(sessions.middleGap.ordersIndexes, 'Precondition: the orders view must miss index 1 only').toEqual(
      expect.arrayContaining([0, 2]),
    );
    expect(sessions.middleGap.ordersIndexes).not.toContain(1);
    expect(sessions.firstMissing.ordersIndexes, 'Precondition: the orders view must miss its full snapshot').not.toContain(0);
    expect(sessions.firstMissing.catalogueIndexes, 'Precondition: the catalogue view must hold a full snapshot').toContain(0);
    expect(sessions.complete.ordersIndexes.slice(0, 3)).toEqual([0, 1, 2]);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('a replay missing a middle segment plays past the gap and flags it until the page changes', { tag: TAGS }, async ({ page }) => {
    const { player, faults, recorded } = await openPlayer(page, 'middleGap');
    await player.expectFrameShows(ORDERS_TAB.heading, 60000);
    await player.playAtNormalSpeed();
    await player.startPlayback();

    await player.expectGapNoticeDuringPlayback();
    await player.expectFrameShows(CATALOGUE_TAB.heading, 90000);
    await player.expectGapNoticeHidden();
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
  });

  test('a replay missing its first segment opens at the first full snapshot instead of a blank player', { tag: TAGS }, async ({ page }) => {
    const { player, faults, recorded } = await openPlayer(page, 'firstMissing');

    await player.expectFrameShows(CATALOGUE_TAB.heading, 60000);
    await expect
      .poll(() => player.playedSeconds(), { timeout: 30000, message: 'the player must open at the catalogue snapshot, not at 00:00' })
      .toBeGreaterThan(0);
    await player.expectFrameDoesNotShow(ORDERS_TAB.heading);
    await player.resumePlayback();
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
  });

  test('a complete replay plays to the end with no gap notice', { tag: TAGS }, async ({ page }) => {
    const { player, faults, recorded } = await openPlayer(page, 'complete');
    await player.expectFrameShows(ORDERS_TAB.heading, 60000);
    await player.watchGapNotice();
    await player.startPlayback();

    await player.expectFrameShows(CATALOGUE_TAB.heading, 90000);
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
    expect(await player.gapNoticeSeen(), 'a complete replay must never show the gap notice').toBe(false);
  });
});
