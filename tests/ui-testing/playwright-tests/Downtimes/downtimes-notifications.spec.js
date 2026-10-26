// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_notif';

const gate = { ready: false, config: {} };
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
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      const wp = fx.workerPrefix(PREFIX, testInfo);
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
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(6 * 60_000);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), alerts: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.ready) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('DT-N-01 started, extended and cancelled are each delivered exactly once', { tag: ['@P1'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await fx.notifyingDowntime(page, reg, shared, { started: true, extended: true, cancelled: true });
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'started', t0), '"started" must be delivered').toBeGreaterThanOrEqual(1);
    await dt.extendDowntime(page, down.id, f, 1800);
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'was extended', t0), '"extended" must be delivered').toBeGreaterThanOrEqual(1);
    await dt.cancelDowntime(page, down.id, f);
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'was cancelled', t0), '"cancelled" must be delivered').toBeGreaterThanOrEqual(1);

    const expected = { started: 1, 'was extended': 1, 'was cancelled': 1, ended: 0, 'ends soon': 0 };
    for (const s of await dt.sampleDowntimeEventCounts(page, shared.sink, down.name, t0, Object.keys(expected))) {
      expect(s, 'event counts after a full notifier tick').toEqual(expected);
    }

    await pm.downtimesPage.gotoDetail(down.id, f);
    await pm.downtimesPage.openDetailTab('notifications');
    await pm.downtimesPage.expectNotificationRows('Sent', 3);
  });

  test('DT-N-02 "ends soon" and "ended" fire once on natural expiry', { tag: ['@P1'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const startMs = Date.now() - 30_000;
    const endMs = Date.now() + 150_000;
    const { f, down } = await fx.notifyingDowntime(page, reg, shared, { ending_soon: true, ended: true }, {
      schedule: dt.windowFromMs(startMs, endMs),
      leadSecs: 60,
    });

    const soon = await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'ends soon', t0, { timeoutMs: Math.max(5000, endMs - Date.now()) });
    expect(soon, '"ends soon" arrives before the window ends').toBeGreaterThanOrEqual(1);
    expect(Date.now(), 'observed before the end (plus one poll)').toBeLessThanOrEqual(endMs + 5000);

    const ended = await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'ended', t0, { timeoutMs: endMs + 60_000 - Date.now() });
    expect(ended, '"ended" arrives within 60 s of the end').toBeGreaterThanOrEqual(1);
    for (const s of await dt.sampleDowntimeEventCounts(page, shared.sink, down.name, t0, ['ends soon', 'ended'])) {
      expect(s, 'event counts after a full notifier tick').toEqual({ 'ends soon': 1, ended: 1 });
    }

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.expectRowStatus(down.id, 'Ended');
  });

  test('DT-N-03 unsubscribed events are not sent', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await fx.notifyingDowntime(page, reg, shared, { started: true });
    const ctl = await fx.notifyingDowntime(page, reg, shared, { started: true, cancelled: true }, { suffix: 'ctl' });
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'started', t0), '"started" must be delivered').toBeGreaterThanOrEqual(1);

    await dt.cancelDowntime(page, down.id, f);
    await dt.cancelDowntime(page, ctl.down.id, ctl.f);
    // The control was cancelled after ours, so its "cancelled" landing proves the notifier has passed both cancels on this sink.
    expect(await dt.waitForDowntimeEvent(page, shared.sink, ctl.down.name, 'was cancelled', t0), 'control: a subscribed "cancelled" is delivered').toBeGreaterThanOrEqual(1);
    for (const s of await dt.sampleDowntimeEventCounts(page, shared.sink, down.name, t0, ['started', 'was cancelled'])) {
      expect(s, 'event counts after a full notifier tick').toEqual({ started: 1, 'was cancelled': 0 });
    }
  });

  test('DT-N-04 editing the end to later does not emit "extended" (current design)', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await fx.notifyingDowntime(page, reg, shared, { started: true, extended: true });
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'started', t0), '"started" must be delivered').toBeGreaterThanOrEqual(1);
    const current = await dt.getDowntime(page, down.id, f);
    const later = current.schedule.ends_at + 1800 * dt.MICROS;
    await dt.updateDowntime(page, down.id, f, {
      schedule: { ...current.schedule, ends_at: later, duration_secs: Math.round((later - current.schedule.starts_at) / dt.MICROS) },
    });
    expect((await dt.getDowntime(page, down.id, f)).schedule.ends_at, 'the edit moved the end').toBe(later);
    for (const s of await dt.sampleDowntimeEventCounts(page, shared.sink, down.name, t0, ['started', 'was extended'])) {
      expect(s, 'event counts after a full notifier tick').toEqual({ started: 1, 'was extended': 0 });
    }

    // A real extend after the edit proves this sink delivers "extended", so the zero above was not a dead sink.
    await dt.extendDowntime(page, down.id, f, 600);
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, 'was extended', t0), 'control: the real extend is delivered').toBeGreaterThanOrEqual(1);
    for (const s of await dt.sampleDowntimeEventCounts(page, shared.sink, down.name, t0, ['started', 'was extended'])) {
      expect(s, 'only the real extend is announced').toEqual({ started: 1, 'was extended': 1 });
    }
  });

  test('DT-N-05 "Send test" on the detail page reaches the destination', { tag: ['@P2'] }, async ({ page }) => {
    const t0 = dt.nowUs() - 5 * dt.MICROS;
    const { f, down } = await fx.notifyingDowntime(page, reg, shared, { ended: true }, { schedule: dt.futureWindow({ startInSec: 7200 }) });
    expect(await dt.downtimeEventCount(page, shared.sink, down.name, null, t0), 'nothing is sent before the test').toBe(0);

    await pm.downtimesPage.gotoDetail(down.id, f);
    await pm.downtimesPage.openDetailTab('notifications');
    await pm.downtimesPage.sendTestFromDetail();
    await pm.downtimesPage.expectToast('Test sent to 1 destination');
    expect(await dt.waitForDowntimeEvent(page, shared.sink, down.name, null, t0), 'the test message lands in the sink').toBeGreaterThanOrEqual(1);
  });
});
