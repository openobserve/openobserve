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
  recordTwoTabSession,
  ORDERS_TAB,
  CATALOGUE_TAB,
} = require('./fixtures/multi-tab-replay-app.js');

const TAGS = ['@bug-15251', '@P1', '@regression', '@rumRegression'];
const RUN_ID = `${Date.now()}-${process.pid}`;
const HOUR_US = 3600 * 1000 * 1000;
const RECORDING_TIMEOUT_MS = 8 * 60 * 1000;

let session = null;
let timeline = null;

async function recordSession(browser) {
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
    service: `e2e-rum-multitab-${RUN_ID}`,
    applicationId: `e2e-rum-multitab-${RUN_ID}`,
    sdkVersion: pinnedCdnSdkVersion(),
  });
  const context = await browser.newContext();
  try {
    expect(
      await server.sdkDownloadError(),
      `The RUM browser SDK could not be downloaded from ${server.sdkUrl} (CDN down or version missing), so no two-tab session can be recorded`,
    ).toBe('');
    return await recordTwoTabSession(context, server, org);
  } finally {
    await context.close();
    await server.close();
  }
}

// The replay clock starts at the first segment, and a live session's last row is held back, so its start bounds what can play.
function buildTimeline(rows, recorded) {
  const starts = rows.map((r) => Number(r.start));
  const sessionStart = Math.min(...starts);
  const lastStart = Math.max(...starts);
  const catalogueStart = Math.min(...rows.filter((r) => r.view_id === recorded.catalogueViewId).map((r) => Number(r.start)));
  const resumed = rows.filter(
    (r) => r.view_id === recorded.ordersViewId && Number(r.start) > catalogueStart && Number(r.start) < lastStart,
  );
  return {
    sessionStart,
    catalogueStart,
    resumedSegments: resumed.length,
    playableEndSec: Math.floor((lastStart - sessionStart) / 1000) - 1,
  };
}

async function openPlayer(page) {
  const pm = new PageManager(page);
  const player = new RumReplayPlayerPage(page);
  const faults = player.watchPlayerFaults();
  await pm.rumSessionsPage.gotoSessionViewer(session.sessionId, {
    startTimeUs: timeline.sessionStart * 1000 - HOUR_US,
    endTimeUs: Date.now() * 1000,
  });
  await player.expectFrameShows(ORDERS_TAB.heading, 60000);
  testLogger.info('Replay opened', { sessionId: session.sessionId, duration: await player.durationText() });
  return { player, faults };
}

test.describe('RUM session replay across two browser tabs (#15251)', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ browser }) => {
    // Every recording step has its own wait, and together their worst case reaches the 5-minute CI test timeout.
    test.setTimeout(RECORDING_TIMEOUT_MS);
    session = await recordSession(browser);
    expect(session.sameSession, 'Precondition: both tabs must share one RUM session').toBe(true);

    const probe = await browser.newPage();
    const rows = await waitForStreamRows(probe, {
      sql: `SELECT start, "end", view_id FROM "_sessionreplay" WHERE session_id = '${session.sessionId}' ORDER BY start`,
      minRows: session.uploads,
      timeoutMs: 60000,
    }).finally(() => probe.close());
    expect(rows.length, 'Precondition: every uploaded replay segment must be searchable').toBeGreaterThanOrEqual(session.uploads);

    timeline = buildTimeline(rows, session);
    expect(
      timeline.resumedSegments,
      'Precondition: tab A must have a segment that starts after tab B recorded its first snapshot',
    ).toBeGreaterThan(0);
    testLogger.info('Two-tab session recorded', { ...session, ...timeline });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('a session recorded in two browser tabs plays to the end without freezing', { tag: TAGS }, async ({ page }) => {
    const { player, faults } = await openPlayer(page);
    await player.startPlayback();

    await player.expectPlaybackReachesWithoutFaults(timeline.playableEndSec, faults);
    testLogger.info('Playback reached the end without a player fault', { reached: await player.playedSeconds() });
  });

  test('the replay shows the tab the user was working in, not the tab opened last', { tag: TAGS }, async ({ page }) => {
    const { player } = await openPlayer(page);
    await player.playAtNormalSpeed();
    await player.startPlayback();

    await player.expectFrameShows(CATALOGUE_TAB.finalProduct);
    await player.expectFrameShows(ORDERS_TAB.finalCount);
    await player.expectFrameShows(ORDERS_TAB.heading);
    await player.expectFrameDoesNotShow(CATALOGUE_TAB.heading);
    testLogger.info('Replay returned to the orders tab after the catalogue tab');
  });
});
