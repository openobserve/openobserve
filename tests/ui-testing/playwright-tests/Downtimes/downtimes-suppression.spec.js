// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_sup';
const TIMEOUT = 8 * 60_000;

const gate = { ready: false, config: {} };
const shared = { stream: null, dest: null, sink: null, svcA: null, svcB: null, h1: null, h2: null, bgContext: null, bg: null };

// Never an active unnarrowed "All folders" downtime here: it would mute every worker's, and every other spec's, control alerts.
test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes suppress alert notifications', { tag: ['@downtimes', '@enterprise', '@all', '@alerts'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    gate.config = await dt.assertDowntimesEnabled(page);
    gate.ready = true;
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });

    const run = dt.uniqueName('r').slice(-8);
    Object.assign(shared, {
      svcA: `svc-a-${run}`, svcB: `svc-b-${run}`, h1: `h1-${run}`, h2: `h2-${run}`, stream: `${wp}_${run}_stream`,
    });
    const seedOpts = { services: [shared.svcA, shared.svcB], hosts: [shared.h1, shared.h2] };
    await dt.seedStream(page, shared.stream, { minutes: 15, ...seedOpts });
    const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
    shared.dest = sink.destination;
    shared.sink = sink.sink;
    shared.bg = dt.startBackgroundIngest(page, shared.stream, seedOpts);
    testLogger.info('Suppression fixtures seeded', { stream: shared.stream, sink: shared.sink });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(TIMEOUT);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), alerts: [], alertFolders: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts, reg.alertFolders);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (shared.bg) shared.bg.stop();
    if (gate.ready) {
      const page = shared.bgContext ? await shared.bgContext.newPage() : await (await browser.newContext()).newPage();
      const wp = fx.workerPrefix(PREFIX, testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    }
    if (shared.bgContext) await shared.bgContext.close();
  });

  test('DT-S-01 by id: silent during the window, notifies again after End now, control keeps firing', { tag: ['@P0'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.sinkAlert(page, reg, shared, 'a');
    const b = await fx.sinkAlert(page, reg, shared, 'b');
    const tStart = dt.nowUs();
    expect(await dt.waitForAlertDelivered(page, shared.sink, a.name, tStart), 'baseline: the covered alert delivers before any downtime').toBeGreaterThanOrEqual(1);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, tStart), 'baseline: the control alert delivers').toBeGreaterThanOrEqual(1);

    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byid`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    expect(await dt.triggerMessage(page, a.id)).toBe(`Alert suppressed by downtime ${down.name}`);
    expect(await dt.triggerMessage(page, b.id)).toBe('Alert triggered');
    const tAfterTrigger = dt.nowUs();

    const first = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS });
    expect(first.length, 'a scheduled run of the covered alert must be recorded as suppressed').toBeGreaterThanOrEqual(1);
    const earliest = Math.min(...first.map((h) => Number(h.timestamp)));
    expect(earliest - t0, 'the first suppressed run lands within 90 s of the save').toBeLessThanOrEqual(90 * dt.MICROS);
    const two = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, minRows: 2, timeoutMs: 180_000 });
    expect(two.length).toBeGreaterThanOrEqual(2);

    const silent = await dt.sampleAlertSink(page, shared.sink, a.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the covered alert must not notify inside the window: ${silent}`).toBe(true);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, tAfterTrigger), 'the uncovered control keeps notifying from its schedule').toBeGreaterThanOrEqual(1);

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    const firing = await dt.waitForFiringAfter(page, { alertId: a.id, sinceUs: t1 });
    expect(firing.length, 'after End now the covered alert records an unsuppressed run').toBeGreaterThanOrEqual(1);
    expect(await dt.waitForAlertDelivered(page, shared.sink, a.name, t1), 'after End now the covered alert notifies again').toBeGreaterThanOrEqual(1);
  });

  test('DT-S-02 by alert folder: the covered folder is silent, the other folder keeps firing', { tag: ['@P0'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const f1 = await fx.newAlertFolder(page, reg, 'af1');
    const f2 = await fx.newAlertFolder(page, reg, 'af2');
    const a = await fx.sinkAlert(page, reg, shared, 'a', { folder: f1 });
    const b = await fx.sinkAlert(page, reg, shared, 'b', { folder: f2 });

    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byfolder`, targets: [dt.folderTarget('alerts', [f1])], schedule: dt.activeWindow() });
    expect(await dt.triggerMessage(page, a.id, f1)).toBe(`Alert suppressed by downtime ${down.name}`);
    expect(await dt.triggerMessage(page, b.id, f2)).toBe('Alert triggered');
    const tAfterTrigger = dt.nowUs();

    const suppressed = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    const bRuns = await dt.waitForFiringAfter(page, { alertId: b.id, sinceUs: t0 });
    expect(bRuns.length, 'the control in the other folder records unsuppressed runs').toBeGreaterThanOrEqual(1);
    expect((await dt.suppressedRows(page, { alertId: b.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS })).length).toBe(0);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, tAfterTrigger), 'the control keeps notifying').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, a.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the alert in the covered folder must not notify: ${silent}`).toBe(true);
  });

  test('DT-S-03 by condition service=<svc-a>: only the matching alert is silenced, and its chip appears after the first suppressed run', { tag: ['@P0'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const af = await fx.newAlertFolder(page, reg, 'af');
    const a = await fx.sinkAlert(page, reg, shared, 'a', { folder: af, service: shared.svcA });
    const b = await fx.sinkAlert(page, reg, shared, 'b', { folder: af, service: shared.svcB });

    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_bycond`,
      condition: dt.pair('service', shared.svcA),
      targets: [dt.allFoldersTarget('alerts')],
      schedule: dt.activeWindow(),
    });
    const tAfterCreate = dt.nowUs();

    const suppressed = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.length, 'the alert whose identity matches the condition is suppressed').toBeGreaterThanOrEqual(1);
    const bRuns = await dt.waitForFiringAfter(page, { alertId: b.id, sinceUs: t0 });
    expect(bRuns.length).toBeGreaterThanOrEqual(1);
    expect((await dt.suppressedRows(page, { alertId: b.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS })).length,
      'an alert on another service must not be suppressed').toBe(0);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, tAfterCreate), 'the other-service control keeps notifying').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, a.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the matching alert must not notify: ${silent}`).toBe(true);

    await pm.alertsPage.gotoAlertListFolder(af);
    await pm.alertsPage.expectMutedChip(a.name, true);
    await pm.alertsPage.expectMutedChip(b.name, false);
  });

  test('DT-S-04 a real-time alert is suppressed at ingest', { tag: ['@P0'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await dt.createRealtimeAlert(page, { name: `${reg.prefix}_rta`, stream: shared.stream, service: shared.svcA, destinations: [shared.dest] });
    const b = await dt.createRealtimeAlert(page, { name: `${reg.prefix}_rtb`, stream: shared.stream, service: shared.svcB, destinations: [shared.dest] });
    reg.alerts.push(a, b);

    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_rt`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    // The ingest path reads the downtime cache; give it a moment before the matching rows arrive.
    await page.waitForTimeout(5000);
    await dt.ingestRows(page, shared.stream, dt.minuteRows({ minutes: 3, services: [shared.svcA, shared.svcB], hosts: [shared.h1] }));
    const tIngest = dt.nowUs();

    const suppressed = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.length, 'the real-time alert records suppressed evaluations').toBeGreaterThanOrEqual(1);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, tIngest - 5 * dt.MICROS), 'the uncovered real-time control notifies').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, a.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the covered real-time alert must not notify: ${silent}`).toBe(true);
  });

  test('DT-S-05 a group-by alert is suppressed per group: h1 silent, h2 still notifies', { tag: ['@P0'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await dt.createGroupedAlert(page, {
      name: `${reg.prefix}_grouped`, stream: shared.stream, groupBy: ['host'], destinations: [shared.dest], rowTemplate: 'host={host}',
    });
    reg.alerts.push(a);

    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_byhost`,
      condition: dt.pair('host', shared.h1),
      targets: [dt.allFoldersTarget('alerts')],
      schedule: dt.activeWindow(),
    });

    // A run with only some groups muted records status firing plus the downtime_id (scheduler/handlers.rs record_downtime).
    const muted = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, status: 'firing' });
    expect(muted.length, 'a run of the grouped alert names the downtime that muted h1').toBeGreaterThanOrEqual(1);
    const since = t0 + 5 * dt.MICROS;
    const h2 = await dt.waitForAlertDelivered(page, shared.sink, a.name, since, { extraWhere: `str_match(text, 'host=${shared.h2}')` });
    expect(h2, 'the uncovered group (h2) of the same alert keeps notifying').toBeGreaterThanOrEqual(1);
    const h1 = await dt.sampleAlertSink(page, shared.sink, a.name, since, { extraWhere: `str_match(text, 'host=${shared.h1}')` });
    expect(h1.every((c) => c === 0), `the covered group (h1) must not notify: ${h1}`).toBe(true);
  });

  test('DT-S-06 UI evidence: Muted chip, "Firing · muted", the Suppressed tab, and End now from the detail page', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const af = await fx.newAlertFolder(page, reg, 'af');
    const a = await fx.sinkAlert(page, reg, shared, 'a', { folder: af });
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_ui`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    const rows = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, minRows: 2, timeoutMs: 180_000 });
    expect(rows.length).toBeGreaterThanOrEqual(2);

    await pm.alertsPage.gotoAlertListFolder(af);
    await pm.alertsPage.expectMutedChip(a.name, true, /^Muted · ends in \d+ min/);
    await pm.alertsPage.expectLastOutcome(a.name, 'Firing · muted');

    await pm.downtimesPage.gotoDetail(down.id, f);
    await pm.downtimesPage.expectDetailTabLabel('suppressed', /Suppressed · [1-9]\d*/);
    await pm.downtimesPage.openDetailTab('suppressed');
    await pm.downtimesPage.expectSuppressedRowFor(a.name);

    await pm.downtimesPage.endNowFromDetail();
    const tEnd = dt.nowUs();
    await pm.downtimesPage.expectDetailStatus('Ended early');
    await pm.alertsPage.gotoAlertListFolder(af);
    await pm.alertsPage.expectMutedChip(a.name, false);
    const firing = await dt.waitForFiringAfter(page, { alertId: a.id, sinceUs: tEnd });
    expect(firing.length, 'the alert records an unsuppressed run after End now').toBeGreaterThanOrEqual(1);
  });

  test('DT-S-07 suppressed runs do not start the alert silence period', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.sinkAlert(page, reg, shared, 'silenced', { silence: 30, enabled: false });
    const b = await fx.sinkAlert(page, reg, shared, 'control');
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_silence`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    // Enabled only now, so the alert's first runs are all suppressed and no real firing has started a silence.
    await dt.enableAlert(page, a.id);

    const rows = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, minRows: 2, timeoutMs: 180_000 });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(await dt.waitForAlertDelivered(page, shared.sink, b.name, t0), 'the control proves delivery works in this span').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, a.name, t0);
    expect(silent.every((c) => c === 0), `the covered alert stays silent inside the window: ${silent}`).toBe(true);

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    const delivered = await dt.waitForAlertDelivered(page, shared.sink, a.name, t1, { timeoutMs: 120_000 });
    expect(delivered, 'a 30-minute silence must not have been started by the suppressed runs').toBeGreaterThanOrEqual(1);
  });

  test('DT-S-08 a scheduled (future) downtime does not suppress', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.sinkAlert(page, reg, shared, 'a');
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_future`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.futureWindow({ startInSec: 1800 }) });
    expect((await dt.getDowntime(page, down.id, f)).status).toBe('scheduled');
    expect(await dt.triggerMessage(page, a.id)).toBe('Alert triggered');
    const tAfterTrigger = dt.nowUs();

    const firing = await dt.waitForFiringAfter(page, { alertId: a.id, sinceUs: t0 });
    expect(firing.length, 'scheduled runs stay unsuppressed before the window opens').toBeGreaterThanOrEqual(1);
    expect(await dt.waitForAlertDelivered(page, shared.sink, a.name, tAfterTrigger), 'the alert keeps notifying from its schedule').toBeGreaterThanOrEqual(1);
    const held = await dt.sampleCountOver(page, async () => (await dt.suppressedRows(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS })).length, { holdMs: 20_000 });
    expect(held.every((c) => c === 0), `a future downtime must suppress nothing: ${held}`).toBe(true);
  });
});
