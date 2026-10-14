// Copyright 2026 OpenObserve Inc.

// Downtimes — lifecycle notifications sent by the downtime itself (plan Spec 7, DT-N-01..05).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_notif';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;
const NO_EVENTS = { started: false, ending_soon: false, ended: false, cancelled: false, extended: false };

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null, sink: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtime lifecycle notifications', { tag: ['@downtimes', '@enterprise', '@all'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      Object.assign(gate, await dt.isDowntimesAvailable(page));
      if (!gate.available) return;
      const wp = workerPrefix(testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      const run = dt.uniqueName('r').slice(-8);
      shared.stream = `${wp}_${run}_stream`;
      await dt.seedStream(page, shared.stream, { minutes: 5, services: [`svc-n-${run}`] });
      const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
      shared.dest = sink.destination;
      shared.sink = sink.sink;
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes are not testable here — ${gate.reason}`);
    test.setTimeout(6 * 60_000);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.available) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = workerPrefix(testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  /** A downtime on one disabled per-test alert, subscribed to `events`. */
  async function notifyingDowntime(page, events, { schedule = dt.activeWindow(), leadSecs = 600 } = {}) {
    const f = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(f);
    const alert = await dt.createSqlAlert(page, {
      name: `${reg.prefix}_alert`,
      stream: shared.stream,
      sql: `SELECT count(*) AS c FROM "${shared.stream}"`,
      destinations: [shared.dest],
      frequencyMinutes: 60,
      periodMinutes: 60,
      enabled: false,
    });
    reg.alerts.push(alert);
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_dt`,
      targets: [dt.alertIdsTarget([alert.id])],
      schedule,
      notifications: { destinations: [shared.dest], events: { ...NO_EVENTS, ...events }, ending_soon_lead_secs: leadSecs },
    });
    return { f, down };
  }

  const count = (page, name, event, sinceUs) => dt.downtimeEventCount(page, shared.sink, name, event, sinceUs);

  async function waitAtLeastOne(page, name, event, sinceUs, timeoutMs = 60_000) {
    const n = await dt.waitForCount(page, () => count(page, name, event, sinceUs), (c) => c >= 1, { timeoutMs, intervalMs: 3000 });
    expect(n, `"${event}" must be delivered`).toBeGreaterThanOrEqual(1);
  }

  /** Every event's count, sampled together over one notifier tick, must equal its expected value at each sample. */
  async function expectCountsHold(page, name, sinceUs, expected) {
    const events = Object.keys(expected);
    const samples = await dt.sampleCountOver(page, async () => JSON.stringify(
      Object.fromEntries(await Promise.all(events.map(async (e) => [e, await count(page, name, e, sinceUs)]))),
    ));
    for (const s of samples) expect(JSON.parse(s), 'event counts after a full notifier tick').toEqual(expected);
  }

  // ------------------------------------------------------------------ P1

  test('DT-N-01 started, extended and cancelled are each delivered exactly once', { tag: ['@P1'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await notifyingDowntime(page, { started: true, extended: true, cancelled: true });
    await waitAtLeastOne(page, down.name, 'started', t0);
    await dt.extendDowntime(page, down.id, f, 1800);
    await waitAtLeastOne(page, down.name, 'was extended', t0);
    await dt.cancelDowntime(page, down.id, f);
    await waitAtLeastOne(page, down.name, 'was cancelled', t0);

    await expectCountsHold(page, down.name, t0, {
      started: 1, 'was extended': 1, 'was cancelled': 1, ended: 0, 'ends soon': 0,
    });

    await pm.downtimesPage.gotoDetail(down.id, f);
    await pm.downtimesPage.openDetailTab('notifications');
    await pm.downtimesPage.expectNotificationRows('Sent', 3);
  });

  test('DT-N-02 "ends soon" and "ended" fire once on natural expiry', { tag: ['@P1'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const startMs = Date.now() - 30_000;
    const endMs = Date.now() + 150_000;
    const { f, down } = await notifyingDowntime(page, { ending_soon: true, ended: true }, {
      schedule: dt.windowFromMs(startMs, endMs),
      leadSecs: 60,
    });

    const soon = await dt.waitForCount(page, () => count(page, down.name, 'ends soon', t0), (c) => c >= 1, { timeoutMs: Math.max(5000, endMs - Date.now()), intervalMs: 3000 });
    expect(soon, '"ends soon" arrives before the window ends').toBeGreaterThanOrEqual(1);
    expect(Date.now(), 'observed before the end (plus one poll)').toBeLessThanOrEqual(endMs + 5000);

    const ended = await dt.waitForCount(page, () => count(page, down.name, 'ended', t0), (c) => c >= 1, { timeoutMs: endMs + 60_000 - Date.now(), intervalMs: 3000 });
    expect(ended, '"ended" arrives within 60 s of the end').toBeGreaterThanOrEqual(1);
    await expectCountsHold(page, down.name, t0, { 'ends soon': 1, ended: 1 });

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.expectRowStatus(down.id, 'Ended');
  });

  // ------------------------------------------------------------------ P2

  test('DT-N-03 unsubscribed events are not sent', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await notifyingDowntime(page, { started: true });
    await waitAtLeastOne(page, down.name, 'started', t0);
    await dt.cancelDowntime(page, down.id, f);
    await expectCountsHold(page, down.name, t0, { started: 1, 'was cancelled': 0 });
  });

  test('DT-N-04 editing the end to later does not emit "extended" (current design)', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await notifyingDowntime(page, { started: true, extended: true });
    await waitAtLeastOne(page, down.name, 'started', t0);
    const current = await dt.getDowntime(page, down.id, f);
    const later = current.schedule.ends_at + 1800 * dt.MICROS;
    await dt.updateDowntime(page, down.id, f, {
      schedule: { ...current.schedule, ends_at: later, duration_secs: Math.round((later - current.schedule.starts_at) / dt.MICROS) },
    });
    expect((await dt.getDowntime(page, down.id, f)).schedule.ends_at, 'the edit moved the end').toBe(later);
    await expectCountsHold(page, down.name, t0, { started: 1, 'was extended': 0 });
  });

  test('DT-N-05 "Send test" on the detail page reaches the destination', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await notifyingDowntime(page, { ended: true }, { schedule: dt.futureWindow({ startInSec: 7200 }) });
    expect(await count(page, down.name, null, t0), 'nothing is sent before the test').toBe(0);

    await pm.downtimesPage.gotoDetail(down.id, f);
    await pm.downtimesPage.openDetailTab('notifications');
    await pm.downtimesPage.sendTestFromDetail();
    await pm.downtimesPage.expectToast('Test sent to 1 destination');
    const delivered = await dt.waitForCount(page, () => count(page, down.name, null, t0), (c) => c >= 1, { timeoutMs: 60_000, intervalMs: 3000 });
    expect(delivered, 'the test message lands in the sink').toBeGreaterThanOrEqual(1);
  });
});
