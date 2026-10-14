// Copyright 2026 OpenObserve Inc.

// Downtimes — incidents open muted and are un-muted exactly once (plan Spec 6, DT-I-01..06).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_inc';
const TIMEOUT = 8 * 60_000;
const OPENED = 'new_incident_created';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null, sink: null, services: [], bgContext: null, bg: null };

/** One row per service for each of the last `minutes`, carrying the dimensions incidents correlate on. */
function incidentRows(services, minutes = 1) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < minutes; i++) {
    for (const service of services) {
      rows.push({
        _timestamp: (now - i * 60_000) * 1000,
        k8s_cluster: 'e2e-dt-cluster',
        k8s_deployment_name: `${service}-v1`,
        service_name: service,
        level: 'error',
      });
    }
  }
  return rows;
}

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes mute incidents', { tag: ['@downtimes', '@enterprise', '@all', '@incidents'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    Object.assign(gate, await dt.isDowntimesAvailable(page));
    if (!gate.available) return;
    if (gate.config.incidents_enabled !== true) {
      Object.assign(gate, { available: false, reason: 'incidents are not enabled here (config.incidents_enabled)' });
      return;
    }
    const wp = workerPrefix(testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    const run = dt.uniqueName('r').slice(-8);
    shared.stream = `${wp}_${run}_stream`;
    await dt.ingestRows(page, shared.stream, incidentRows([`svc-seed-${run}`], 5));
    const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
    shared.dest = sink.destination;
    shared.sink = sink.sink;
    shared.bg = dt.startBackgroundIngest(page, shared.stream, { rowsFn: () => incidentRows(shared.services) });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes on incidents are not testable here — ${gate.reason}`);
    test.setTimeout(TIMEOUT);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], folders: [], services: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    shared.services = shared.services.filter((s) => !reg.services.includes(s));
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts);
    for (const service of reg.services) {
      const incident = await dt.findIncidentByService(page, service).catch(() => null);
      if (incident) await dt.resolveIncident(page, incident.id);
    }
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

  /** A fresh service value with ten minutes of rows now and fresh rows every 30 s after. */
  async function service(page, label) {
    const svc = `svc-${label}-${reg.prefix.slice(-8)}`;
    reg.services.push(svc);
    shared.services.push(svc);
    await dt.ingestRows(page, shared.stream, incidentRows([svc], 10));
    return svc;
  }

  async function incidentAlert(page, suffix, svc, { enabled = true } = {}) {
    const a = await dt.createSqlAlert(page, {
      name: `${reg.prefix}_${suffix}`,
      stream: shared.stream,
      sql: `SELECT k8s_cluster, k8s_deployment_name, service_name, count(*) AS c FROM "${shared.stream}" WHERE service_name = '${svc}' GROUP BY k8s_cluster, k8s_deployment_name, service_name`,
      destinations: [shared.dest],
      createsIncident: true,
      enabled,
    });
    reg.alerts.push(a);
    return a;
  }

  async function newDtFolder(page) {
    const id = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(id);
    return id;
  }

  /** The manual trigger sends no incident notification, so it only opens A's MUTED incident; every asserted notification comes from the scheduler. */
  async function mutedIncident(page, svc, { targetExtra = {} } = {}) {
    const f = await newDtFolder(page);
    const a = await incidentAlert(page, 'a', svc, { enabled: false });
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_dt`, targets: [dt.alertIdsTarget([a.id], targetExtra)], schedule: dt.activeWindow() });
    await dt.enableAlert(page, a.id);
    expect(await dt.triggerMessage(page, a.id)).toBe(`Alert suppressed by downtime ${down.name}`);
    const incident = await dt.waitForIncidentByService(page, svc);
    return { f, a, down, incident };
  }

  const count = (page, incidentId, event) => dt.incidentEventCount(page, shared.sink, incidentId, event);

  async function expectExactlyOne(page, incidentId, event, why, holdMs = 45_000) {
    const first = await dt.waitForCount(page, () => count(page, incidentId, event), (c) => c >= 1, { timeoutMs: 180_000 });
    expect(first, why).toBeGreaterThanOrEqual(1);
    const samples = await dt.sampleCountOver(page, () => count(page, incidentId, event), { holdMs });
    expect(samples.every((c) => c === 1), `${why} — exactly once: ${samples}`).toBe(true);
  }

  async function expectNone(page, incidentId, event, why) {
    const samples = await dt.sampleCountOver(page, () => count(page, incidentId, event));
    expect(samples.every((c) => c === 0), `${why}: ${samples}`).toBe(true);
  }

  // ------------------------------------------------------------------ P0

  test('DT-I-01 an incident opened during the window is muted and pages nobody; the control incident notifies', { tag: ['@P0'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    const svcD = await service(page, 'd');
    const d = await incidentAlert(page, 'd', svcD);
    const { down, incident } = await mutedIncident(page, svc);

    expect(incident, 'the covered alert must open an incident').toBeTruthy();
    expect(incident.muted_by_downtime_id).toBe(down.id);
    const control = await dt.waitForIncidentByService(page, svcD);
    expect(control, 'the control alert must open its own incident').toBeTruthy();
    expect(control.muted_by_downtime_id ?? null).toBeNull();

    const controlOpened = await dt.waitForCount(page, () => count(page, control.id, OPENED), (c) => c >= 1, { timeoutMs: 180_000 });
    expect(controlOpened, `the control incident (${d.name}) notifies`).toBeGreaterThanOrEqual(1);
    await expectNone(page, incident.id, null, 'the muted incident must page nobody');

    await pm.incidentsPage.goto();
    await pm.incidentsPage.searchIncidents(svc);
    await pm.incidentsPage.expectMutedTag(svc, `Muted · ${down.name}`);
    await pm.incidentsPage.openIncidentRow(svc);
    await pm.incidentsPage.expectMutedBanner(`Muted by ${down.name}`);
    await pm.incidentsPage.clickMutedViewDowntime();
    await pm.downtimesPage.expectOnDetail(down.id);

    await pm.incidentsPage.goto();
    await pm.incidentsPage.searchIncidents(svcD);
    await pm.incidentsPage.expectNoMutedTag(svcD);
  });

  test('DT-I-02 an uncovered alert firing into a muted incident un-mutes it with exactly one notification', { tag: ['@P0'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    const { down, incident } = await mutedIncident(page, svc);
    expect(incident.muted_by_downtime_id).toBe(down.id);

    const c = await incidentAlert(page, 'c', svc, { enabled: false });
    await dt.enableAlert(page, c.id);

    const unmuted = await dt.pollUntil(page, () => dt.getIncident(page, incident.id), (i) => i && !i.muted_by_downtime_id, { timeoutMs: 180_000 });
    expect(unmuted?.muted_by_downtime_id ?? null, 'the uncovered firing clears the mute').toBeNull();
    await expectExactlyOne(page, incident.id, OPENED, 'the un-muted incident sends its delayed "opened"');
  });

  test('DT-I-03 when the window ends the covered alert fires and sends exactly one delayed "opened"', { tag: ['@P0'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    const { f, down, incident } = await mutedIncident(page, svc);
    await expectNone(page, incident.id, null, 'nothing is sent while the incident is muted');

    await dt.cancelDowntime(page, down.id, f);
    const unmuted = await dt.pollUntil(page, () => dt.getIncident(page, incident.id), (i) => i && !i.muted_by_downtime_id, { timeoutMs: 180_000 });
    expect(unmuted?.muted_by_downtime_id ?? null, 'the first firing after the window un-mutes the incident').toBeNull();
    await expectExactlyOne(page, incident.id, OPENED, 'one delayed "opened", even after further scheduled firings', 75_000);
  });

  // ------------------------------------------------------------------ P1

  test('DT-I-04 a suppressed firing that joins an open, unmuted incident keeps it unmuted', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    await incidentAlert(page, 'c', svc);
    const open = await dt.waitForIncidentByService(page, svc);
    expect(open, 'the uncovered alert opens a normal incident first').toBeTruthy();
    const opened = await dt.waitForCount(page, () => count(page, open.id, OPENED), (n) => n >= 1, { timeoutMs: 180_000 });
    expect(opened).toBeGreaterThanOrEqual(1);

    const f = await newDtFolder(page);
    const a = await incidentAlert(page, 'a', svc, { enabled: false });
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_dt`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    await dt.enableAlert(page, a.id);
    expect(await dt.triggerMessage(page, a.id)).toBe(`Alert suppressed by downtime ${down.name}`);

    const samples = await dt.sampleCountOver(page, async () => {
      const current = await dt.getIncident(page, open.id);
      return current?.muted_by_downtime_id ? 1 : 0;
    }, { holdMs: 20_000, everyMs: 5000 });
    expect(samples.every((m) => m === 0), `the open incident must stay unmuted: ${samples}`).toBe(true);
    expect((await dt.findIncidentByService(page, svc))?.id, 'the suppressed firing joins the same incident').toBe(open.id);
  });

  test('DT-I-05 a severity change notifies on a normal incident only', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    const svcD = await service(page, 'd');
    await incidentAlert(page, 'd', svcD);
    const { incident } = await mutedIncident(page, svc);
    const control = await dt.waitForIncidentByService(page, svcD);
    expect(control, 'the control incident must exist').toBeTruthy();

    // A change only notifies when the severity actually moves, so pick one the incident does not have yet.
    const other = (sev) => (sev === 'P1' ? 'P4' : 'P1');
    await dt.setIncidentSeverity(page, incident.id, other(incident.severity));
    await dt.setIncidentSeverity(page, control.id, other(control.severity));

    await expectExactlyOne(page, control.id, 'severity_changed', 'the normal incident notifies its severity change');
    await expectNone(page, incident.id, 'severity_changed', 'the muted incident must not notify a severity change');
  });

  test('DT-I-06 incident mode "Not created": no incident during the window, a normal one after it', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await service(page, 'i');
    const f = await newDtFolder(page);
    const a = await incidentAlert(page, 'a', svc, { enabled: false });
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_none`,
      targets: [dt.alertIdsTarget([a.id], { incident_mode: 'none' })],
      schedule: dt.activeWindow(),
    });
    await dt.enableAlert(page, a.id);
    expect(await dt.triggerMessage(page, a.id)).toBe(`Alert suppressed by downtime ${down.name}`);

    const during = await dt.sampleCountOver(page, async () => ((await dt.findIncidentByService(page, svc)) ? 1 : 0), { holdMs: 45_000 });
    expect(during.every((n) => n === 0), `no incident may open during the window: ${during}`).toBe(true);

    await dt.cancelDowntime(page, down.id, f);
    const after = await dt.waitForIncidentByService(page, svc, { timeoutMs: 180_000 });
    expect(after, 'the first firing after the window opens an incident').toBeTruthy();
    expect(after.muted_by_downtime_id ?? null).toBeNull();
    await expectExactlyOne(page, after.id, OPENED, 'the post-window incident notifies once');
  });
});
