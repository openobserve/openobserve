// Copyright 2026 OpenObserve Inc.

// Downtimes — alerts stay silent inside the window and notify again after it (plan Spec 5, DT-S-01..08).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_sup';
const TIMEOUT = 8 * 60_000;
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null, sink: null, svcA: null, svcB: null, h1: null, h2: null, bgContext: null, bg: null };

// Never an active unnarrowed "All folders" downtime here: it would mute every worker's control alerts.
test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes suppress alert notifications', { tag: ['@downtimes', '@enterprise', '@all', '@alerts'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    Object.assign(gate, await dt.isDowntimesAvailable(page));
    if (!gate.available) return;
    const wp = workerPrefix(testInfo);
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
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes are not testable here — ${gate.reason}`);
    test.setTimeout(TIMEOUT);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], alertFolders: [], folders: [] };
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
    if (gate.available) {
      const page = shared.bgContext ? await shared.bgContext.newPage() : await (await browser.newContext()).newPage();
      const wp = workerPrefix(testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    }
    if (shared.bgContext) await shared.bgContext.close();
  });

  async function newDtFolder(page) {
    const id = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(id);
    return id;
  }

  async function newAlertFolder(page, suffix) {
    const id = await dt.createAlertFolder(page, `${reg.prefix}_${suffix}`);
    reg.alertFolders.push(id);
    return id;
  }

  /** A 1-minute count alert delivering to the sink; `service` adds the WHERE equality a condition matches. */
  async function alert(page, suffix, { folder = 'default', service = null, silence = 0, enabled = true } = {}) {
    const sql = service
      ? `SELECT service_name, count(*) AS c FROM "${shared.stream}" WHERE service_name = '${service}' GROUP BY service_name`
      : `SELECT count(*) AS c FROM "${shared.stream}"`;
    const a = await dt.createSqlAlert(page, {
      name: `${reg.prefix}_${suffix}`, stream: shared.stream, sql, destinations: [shared.dest], folder, silence, enabled,
    });
    reg.alerts.push(a);
    return a;
  }

  const sink = (page, a, sinceUs, extraWhere) => dt.alertSinkCount(page, shared.sink, a.name, sinceUs, extraWhere);

  async function expectDelivers(page, a, sinceUs, why) {
    const count = await dt.waitForCount(page, () => sink(page, a, sinceUs), (c) => c >= 1, { timeoutMs: 150_000 });
    expect(count, why).toBeGreaterThanOrEqual(1);
  }

  async function expectSilent(page, a, sinceUs, why) {
    const samples = await dt.sampleCountOver(page, () => sink(page, a, sinceUs));
    expect(samples.every((c) => c === 0), `${why}: ${samples}`).toBe(true);
  }

  // ------------------------------------------------------------------ P0

  test('DT-S-01 by id: silent during the window, notifies again after End now, control keeps firing', { tag: ['@P0'] }, async ({ page }) => {
    const f = await newDtFolder(page);
    const a = await alert(page, 'a');
    const b = await alert(page, 'b');
    const tStart = dt.nowUs();
    await expectDelivers(page, a, tStart, 'baseline: the covered alert delivers before any downtime');
    await expectDelivers(page, b, tStart, 'baseline: the control alert delivers');

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

    await expectSilent(page, a, t0 + 5 * dt.MICROS, 'the covered alert must not notify inside the window');
    await expectDelivers(page, b, tAfterTrigger, 'the uncovered control keeps notifying from its schedule');

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    const firing = await dt.waitForFiringAfter(page, { alertId: a.id, sinceUs: t1 });
    expect(firing.length, 'after End now the covered alert records an unsuppressed run').toBeGreaterThanOrEqual(1);
    await expectDelivers(page, a, t1, 'after End now the covered alert notifies again');
  });

  test('DT-S-02 by alert folder: the covered folder is silent, the other folder keeps firing', { tag: ['@P0'] }, async ({ page }) => {
    const f = await newDtFolder(page);
    const f1 = await newAlertFolder(page, 'af1');
    const f2 = await newAlertFolder(page, 'af2');
    const a = await alert(page, 'a', { folder: f1 });
    const b = await alert(page, 'b', { folder: f2 });

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
    await expectDelivers(page, b, tAfterTrigger, 'the control keeps notifying');
    await expectSilent(page, a, t0 + 5 * dt.MICROS, 'the alert in the covered folder must not notify');
  });

  test('DT-S-03 by condition service=<svc-a>: only the matching alert is silenced, and its chip appears after the first suppressed run', { tag: ['@P0'] }, async ({ page }) => {
    const f = await newDtFolder(page);
    const af = await newAlertFolder(page, 'af');
    const a = await alert(page, 'a', { folder: af, service: shared.svcA });
    const b = await alert(page, 'b', { folder: af, service: shared.svcB });

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
    await expectDelivers(page, b, tAfterCreate, 'the other-service control keeps notifying');
    await expectSilent(page, a, t0 + 5 * dt.MICROS, 'the matching alert must not notify');

    await pm.alertsPage.gotoAlertListFolder(af);
    await pm.alertsPage.expectMutedChip(a.name, true);
    await pm.alertsPage.expectMutedChip(b.name, false);
  });

  test('DT-S-04 a real-time alert is suppressed at ingest', { tag: ['@P0'] }, async ({ page }) => {
    const f = await newDtFolder(page);
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
    await expectDelivers(page, b, tIngest - 5 * dt.MICROS, 'the uncovered real-time control notifies');
    await expectSilent(page, a, t0 + 5 * dt.MICROS, 'the covered real-time alert must not notify');
  });

  test('DT-S-05 a group-by alert is suppressed per group: h1 silent, h2 still notifies', { tag: ['@P0'] }, async ({ page }) => {
    const f = await newDtFolder(page);
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
    const h2 = await dt.waitForCount(page, () => sink(page, a, since, `str_match(text, 'host=${shared.h2}')`), (c) => c >= 1, { timeoutMs: 150_000 });
    expect(h2, 'the uncovered group (h2) of the same alert keeps notifying').toBeGreaterThanOrEqual(1);
    const h1 = await dt.sampleCountOver(page, () => sink(page, a, since, `str_match(text, 'host=${shared.h1}')`));
    expect(h1.every((c) => c === 0), `the covered group (h1) must not notify: ${h1}`).toBe(true);
  });

  // ------------------------------------------------------------------ P1

  test('DT-S-06 UI evidence: Muted chip, "Firing · muted", the Suppressed tab, and End now from the detail page', { tag: ['@P1'] }, async ({ page }) => {
    const f = await newDtFolder(page);
    const af = await newAlertFolder(page, 'af');
    const a = await alert(page, 'a', { folder: af });
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
    const f = await newDtFolder(page);
    const a = await alert(page, 'silenced', { silence: 30, enabled: false });
    const b = await alert(page, 'control');
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_silence`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    // Enabled only now, so the alert's first runs are all suppressed and no real firing has started a silence.
    await dt.enableAlert(page, a.id);

    const rows = await dt.waitForSuppressed(page, { alertId: a.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, minRows: 2, timeoutMs: 180_000 });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await expectDelivers(page, b, t0, 'the control proves delivery works in this span');
    await expectSilent(page, a, t0, 'the covered alert stays silent inside the window');

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    const delivered = await dt.waitForCount(page, () => sink(page, a, t1), (c) => c >= 1, { timeoutMs: 120_000 });
    expect(delivered, 'a 30-minute silence must not have been started by the suppressed runs').toBeGreaterThanOrEqual(1);
  });

  test('DT-S-08 a scheduled (future) downtime does not suppress', { tag: ['@P1'] }, async ({ page }) => {
    const f = await newDtFolder(page);
    const a = await alert(page, 'a');
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_future`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.futureWindow({ startInSec: 1800 }) });
    expect((await dt.getDowntime(page, down.id, f)).status).toBe('scheduled');
    expect(await dt.triggerMessage(page, a.id)).toBe('Alert triggered');
    const tAfterTrigger = dt.nowUs();

    const firing = await dt.waitForFiringAfter(page, { alertId: a.id, sinceUs: t0 });
    expect(firing.length, 'scheduled runs stay unsuppressed before the window opens').toBeGreaterThanOrEqual(1);
    await expectDelivers(page, a, tAfterTrigger, 'the alert keeps notifying from its schedule');
    const held = await dt.sampleCountOver(page, async () => (await dt.suppressedRows(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS })).length, { holdMs: 20_000 });
    expect(held.every((c) => c === 0), `a future downtime must suppress nothing: ${held}`).toBe(true);
  });
});
