// A replay segment lost in transit left the player at 00:00 / 00:00 (openobserve#14694); each session here drops one upload on purpose.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { RumReplayPlayerPage } = require('../../../pages/rumPages/rumReplayPlayerPage.js');
const {
  recordPageChangeScenarios,
  readStoredReplay,
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

let sessions = {};

test.describe('RUM session replay with a missing segment (#14694)', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(RECORDING_TIMEOUT_MS);
    sessions = await recordPageChangeScenarios(browser, SCENARIOS, { appId: `e2e-rum-gap-${RUN_ID}` });
    for (const [name, recorded] of Object.entries(sessions)) {
      expect(recorded.sameSession, `Precondition: the ${name} page change must stay in one RUM session`).toBe(true);
      const stored = recorded.uploads - (SCENARIOS[name].dropUpload ? 1 : 0);
      Object.assign(recorded, await readStoredReplay(browser, recorded, stored));
      recorded.viewerStartUs = recorded.firstStartMs * 1000 - HOUR_US;
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
    const recorded = sessions.middleGap;
    const player = new RumReplayPlayerPage(page);
    const faults = await player.openSession(recorded.sessionId, { startTimeUs: recorded.viewerStartUs });
    await player.expectFrameShows(ORDERS_TAB.heading, 60000);
    await player.playAtNormalSpeed();
    await player.startPlayback();

    await player.expectGapNoticeDuringPlayback();
    await player.expectFrameShows(CATALOGUE_TAB.heading, 90000);
    await player.expectGapNoticeHidden();
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
  });

  test('a replay missing its first segment opens at the first full snapshot instead of a blank player', { tag: TAGS }, async ({ page }) => {
    const recorded = sessions.firstMissing;
    const player = new RumReplayPlayerPage(page);
    const faults = await player.openSession(recorded.sessionId, { startTimeUs: recorded.viewerStartUs });

    await player.expectFrameShows(CATALOGUE_TAB.heading, 60000);
    await expect
      .poll(() => player.playedSeconds(), { timeout: 30000, message: 'the player must open at the catalogue snapshot, not at 00:00' })
      .toBeGreaterThan(0);
    await player.expectFrameDoesNotShow(ORDERS_TAB.heading);
    await player.resumePlayback();
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
  });

  test('a complete replay plays to the end with no gap notice', { tag: TAGS }, async ({ page }) => {
    const recorded = sessions.complete;
    const player = new RumReplayPlayerPage(page);
    const faults = await player.openSession(recorded.sessionId, { startTimeUs: recorded.viewerStartUs });
    await player.expectFrameShows(ORDERS_TAB.heading, 60000);
    await player.watchGapNotice();
    await player.startPlayback();

    await player.expectFrameShows(CATALOGUE_TAB.heading, 90000);
    await player.expectPlaybackReachesWithoutFaults(recorded.playableEndSec, faults, 90000);
    expect(await player.gapNoticeSeen(), 'a complete replay must never show the gap notice').toBe(false);
  });
});
