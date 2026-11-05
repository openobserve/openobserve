const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { RumReplayPlayerPage } = require('../../../pages/rumPages/rumReplayPlayerPage.js');
const { getOrCreateRumToken } = require('../../utils/rum-token-api.js');
const { pinnedCdnSdkVersion } = require('../../utils/rum-sdk-version.js');
const { waitForStreamRows } = require('../../utils/rum-stream-verify.js');
const { validatedOrgId, validatedBaseUrl } = require('../../utils/rum-env.js');
const { startMultiTabReplayServer } = require('./fixtures/multi-tab-replay-app.js');
const { recordSessionWithLostSegments, FEED_PAGE, REPORT_PAGE } = require('./fixtures/replay-missing-segment-app.js');

const RUN_ID = `${Date.now()}-${process.pid}`;
const HOUR_US = 3600 * 1000 * 1000;
const RECORDING_TIMEOUT_MS = 8 * 60 * 1000;
const FEED_SEGMENTS = 5;

async function recordAndLoad(browser, name, dropFeedUploads) {
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
    service: `e2e-rum-${name}-${RUN_ID}`,
    applicationId: `e2e-rum-${name}-${RUN_ID}`,
    sdkVersion: pinnedCdnSdkVersion(),
  });
  const context = await browser.newContext();
  let session;
  try {
    expect(
      await server.sdkDownloadError(),
      `The RUM browser SDK could not be downloaded from ${server.sdkUrl} (CDN down or version missing), so no session can be recorded`,
    ).toBe('');
    session = await recordSessionWithLostSegments(context, server, org, { feedSegments: FEED_SEGMENTS, dropFeedUploads });
  } finally {
    await context.close();
    await server.close();
  }
  expect(session.sameSession, 'Precondition: both pages must share one RUM session').toBe(true);
  expect(session.dropped, 'Precondition: the chosen uploads must have been lost').toEqual(dropFeedUploads);

  const probe = await browser.newPage();
  const rows = await waitForStreamRows(probe, {
    sql: `SELECT start, "end", view_id, index_in_view, has_full_snapshot FROM "_sessionreplay" WHERE session_id = '${session.sessionId}' ORDER BY start`,
    minRows: session.uploads - session.dropped.length,
    timeoutMs: 60000,
  }).finally(() => probe.close());
  const indexesOf = (viewId) => rows.filter((r) => r.view_id === viewId).map((r) => Number(r.index_in_view));
  const starts = rows.map((r) => Number(r.start));
  return {
    session,
    rows,
    feedIndexes: indexesOf(session.feedViewId),
    reportIndexes: indexesOf(session.reportViewId),
    sessionStart: Math.min(...starts),
    lastStart: Math.max(...starts),
    firstSnapshotStart: Math.min(...rows.filter((r) => r.has_full_snapshot === true || r.has_full_snapshot === 'true').map((r) => Number(r.start))),
  };
}

async function openPlayer(page, recording) {
  const pm = new PageManager(page);
  const player = new RumReplayPlayerPage(page);
  const faults = player.watchPlayerFaults();
  await pm.rumSessionsPage.gotoSessionViewer(recording.session.sessionId, {
    startTimeUs: recording.sessionStart * 1000 - HOUR_US,
    endTimeUs: Date.now() * 1000,
  });
  return { player, faults };
}

test.describe('RUM session replay with lost segments', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test.describe('a segment lost in the middle of a view (#14694)', () => {
    const LOST = 2;
    let recording = null;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(RECORDING_TIMEOUT_MS);
      recording = await recordAndLoad(browser, 'gap', [LOST]);
      testLogger.info('Session with a mid-view gap recorded', recording.feedIndexes);
      expect(recording.feedIndexes, 'Precondition: the stored feed page must skip exactly the lost index').toEqual(
        [0, 1, ...Array.from({ length: FEED_SEGMENTS - LOST - 1 }, (_, i) => LOST + 1 + i)],
      );
    });

    test('the player starts, the timer moves and playback continues past the gap', {
      tag: ['@bug-14694', '@P0', '@regression', '@rumRegression'],
    }, async ({ page }) => {
      const { player, faults } = await openPlayer(page, recording);
      await player.expectFrameShows(FEED_PAGE.heading, 60000);
      await player.expectDurationKnown();
      // The notice only shows while the playhead is inside the gap, which the default 4x can pass between two reads.
      await player.playAtNormalSpeed();
      await player.startPlayback();

      const replayMs = recording.lastStart - recording.sessionStart;
      await player.expectGapNoticeShown(replayMs + 30000);
      await player.expectFrameShows(REPORT_PAGE.heading, replayMs + 30000);
      const playableEndSec = Math.floor(replayMs / 1000) - 1;
      await player.expectPlaybackReachesWithoutFaults(playableEndSec, faults, replayMs + 30000);
      testLogger.info('Playback passed the gap', { reached: await player.playedSeconds(), duration: await player.durationText() });
    });
  });

  test.describe('the first segment of the session lost (#5410)', () => {
    let recording = null;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(RECORDING_TIMEOUT_MS);
      recording = await recordAndLoad(browser, 'nofirst', [0]);
      testLogger.info('Session without its first segment recorded', recording.feedIndexes);
      expect(recording.feedIndexes, 'Precondition: the stored feed page must have no first segment').not.toContain(0);
      expect(recording.feedIndexes.length, 'Precondition: the later feed segments must be stored').toBeGreaterThan(0);
      expect(recording.reportIndexes, 'Precondition: the report page must keep its first segment').toContain(0);
      expect(recording.firstSnapshotStart, 'Precondition: the earliest stored snapshot must be on the report page').toBeGreaterThan(recording.sessionStart);
    });

    test('the replay opens at the first full snapshot, not blank, and plays with no missing-node fault', {
      tag: ['@bug-5410', '@P1', '@regression', '@rumRegression'],
    }, async ({ page }) => {
      const { player, faults } = await openPlayer(page, recording);
      await player.expectFrameShows(REPORT_PAGE.heading, 60000);
      await player.expectDurationKnown();
      await expect
        .poll(() => player.playedSeconds(), { message: 'the replay must open on the first snapshot, past the lost part of the session' })
        .toBe(Math.floor((recording.firstSnapshotStart - recording.sessionStart) / 1000));
      await player.resumePlaybackFromOpening();

      const playableEndSec = Math.floor((recording.lastStart - recording.sessionStart) / 1000) - 1;
      await player.expectPlaybackReachesWithoutFaults(playableEndSec, faults);
      await player.expectFrameShows(REPORT_PAGE.lastStatus);
      testLogger.info('Replay played from its first snapshot', { reached: await player.playedSeconds(), duration: await player.durationText() });
    });
  });
});
