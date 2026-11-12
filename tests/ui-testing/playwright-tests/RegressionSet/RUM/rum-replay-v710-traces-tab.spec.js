// Session player coverage for openobserve#16245 (SDK v7.10+ replay Change types 11-15) and
// openobserve#16468 (the Traces tab lists every request, with browser-timed durations and HTTP errors).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedReplayTracesSession } = require('../../utils/rum-replay-traces-seed.js');

const TAGS = ['@rum', '@sessionReplay', '@rumTraces', '@P1', '@all'];
const SEED_TIMEOUT_MS = 5 * 60 * 1000;
const OLD_ROW_CAP = 250;

let seeded;

test.describe('RUM session player: v7.10+ replay and the Traces tab', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(SEED_TIMEOUT_MS);
    const page = await browser.newPage();
    try {
      seeded = await seedReplayTracesSession(page);
    } finally {
      await page.close();
    }
    expect(seeded.requests.length, 'Precondition: the session must have more requests than the old row cap').toBeGreaterThan(OLD_ROW_CAP);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a replay in the SDK v7.10+ change format opens on the page it recorded', { tag: TAGS }, async ({ page }) => {
    const player = new PageManager(page).rumReplayPlayerPage;
    const faults = await player.openSession(seeded.sessionId, { startTimeUs: seeded.viewerStartUs });

    await player.expectFrameElementText('#replay-title', seeded.page.title);
    await player.expectFrameElementText('#replay-status', seeded.page.status);
    await player.expectFrameInputValue('#coupon', '');
    await player.expectFrameChecked('#gift', false);
    await player.expectFrameInputValue('#plan', seeded.page.plan);
    expect(faults, 'opening the replay must raise no player fault').toEqual([]);
  });

  test('the replay plays its v7.10+ text, input and selection changes to the end', { tag: TAGS }, async ({ page }) => {
    const player = new PageManager(page).rumReplayPlayerPage;
    const faults = await player.openSession(seeded.sessionId, { startTimeUs: seeded.viewerStartUs });
    await player.expectFrameElementText('#replay-title', seeded.page.title);
    await player.startPlayback();

    await player.expectFrameElementText('#replay-title', seeded.page.confirmed, 60000);
    await player.expectFrameElementText('#replay-status', seeded.page.paid);
    await player.expectFrameInputValue('#coupon', seeded.page.coupon);
    await player.expectFrameChecked('#gift', true);
    await player.expectFrameInputValue('#plan', seeded.page.chosenPlan);
    await player.expectPlaybackReachesWithoutFaults(seeded.replaySeconds - 1, faults, 90000);
  });

  test('the Traces tab lists every request, including URLs that need encoding', { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionViewer(seeded.sessionId, { startTimeUs: seeded.viewerStartUs });
    const traces = pm.rumSessionTracesTabPage;
    await traces.open();

    await traces.expectTraceCount(seeded.requests.length);
    await traces.expectListComplete();
    await traces.expectListedRequests(seeded.requests, ['op']);
    for (const op of seeded.specialOps) {
      await expect(traces.rowFor(op), `"${op}" must be listed once`).toHaveCount(1);
    }
  });

  test('each request shows the duration the browser timed', { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionViewer(seeded.sessionId, { startTimeUs: seeded.viewerStartUs });
    const traces = pm.rumSessionTracesTabPage;
    await traces.open();

    await traces.expectTraceCount(seeded.requests.length);
    await traces.expectListedRequests(seeded.requests, ['op', 'duration']);
  });

  test('a 4xx or 5xx request shows its HTTP error status', { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumSessionsPage.gotoSessionViewer(seeded.sessionId, { startTimeUs: seeded.viewerStartUs });
    const traces = pm.rumSessionTracesTabPage;
    await traces.open();
    const failed = seeded.requests.filter((req) => req.httpStatus);
    expect(failed.length, 'Precondition: the fixture must hold failed requests').toBeGreaterThan(0);

    await traces.expectTraceCount(seeded.requests.length);
    await traces.expectErrorTraceCount(failed.length);
    await traces.expectListedRequests(seeded.requests, ['op', 'status']);
    for (const req of failed) {
      await traces.openRequest(req.op);
      await traces.expectHttpStatus(req.httpStatus);
      await traces.backToList();
    }
    await traces.openRequest(seeded.specialOps[0]);
    await expect(traces.httpStatusChip, 'a successful request must show no HTTP error chip').toHaveCount(0);
  });
});
