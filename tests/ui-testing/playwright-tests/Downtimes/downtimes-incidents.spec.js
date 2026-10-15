// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_inc';
const TIMEOUT = 8 * 60_000;
const OPENED = 'new_incident_created';

const gate = { ready: false, available: false, reason: '', config: {} };
const shared = { stream: null, dest: null, sink: null, services: [], bgContext: null, bg: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes mute incidents', { tag: ['@downtimes', '@enterprise', '@all', '@incidents'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    gate.config = await dt.assertDowntimesEnabled(page);
    gate.ready = true;
    if (gate.config.incidents_enabled !== true) {
      Object.assign(gate, { reason: 'incidents are not enabled here (config.incidents_enabled)' });
      return;
    }
    gate.available = true;
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    const run = dt.uniqueName('r').slice(-8);
    shared.stream = `${wp}_${run}_stream`;
    await dt.ingestRows(page, shared.stream, dt.incidentRows([`svc-seed-${run}`], 5));
    const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
    shared.dest = sink.destination;
    shared.sink = sink.sink;
    shared.bg = dt.startBackgroundIngest(page, shared.stream, { rowsFn: () => dt.incidentRows(shared.services) });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes on incidents are not testable here — ${gate.reason}`);
    test.setTimeout(TIMEOUT);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), alerts: [], folders: [], services: [] };
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
      const wp = fx.workerPrefix(PREFIX, testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    }
    if (shared.bgContext) await shared.bgContext.close();
  });

  test('DT-I-01 an incident opened during the window is muted and pages nobody; the control incident notifies', { tag: ['@P0'] }, async ({ page }) => {
    const svc = await fx.incidentService(page, reg, shared, 'i');
    const svcD = await fx.incidentService(page, reg, shared, 'd');
    const d = await fx.incidentAlert(page, reg, shared, 'd', svcD);
    const { down, trigger } = await fx.mutedAlert(page, reg, shared, svc);
    expect(trigger).toBe(`Alert suppressed by downtime ${down.name}`);
    const incident = await dt.waitForIncidentByService(page, svc);

    expect(incident, 'the covered alert must open an incident').toBeTruthy();
    expect(incident.muted_by_downtime_id).toBe(down.id);
    const control = await dt.waitForIncidentByService(page, svcD);
    expect(control, 'the control alert must open its own incident').toBeTruthy();
    expect(control.muted_by_downtime_id ?? null).toBeNull();

    expect(await dt.waitForIncidentEvent(page, shared.sink, control.id, OPENED), `the control incident (${d.name}) notifies`).toBeGreaterThanOrEqual(1);
    const muted = await dt.sampleIncidentEvents(page, shared.sink, incident.id, null);
    expect(muted.every((c) => c === 0), `the muted incident must page nobody: ${muted}`).toBe(true);

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
    const svc = await fx.incidentService(page, reg, shared, 'i');
    const { down, trigger } = await fx.mutedAlert(page, reg, shared, svc);
    expect(trigger).toBe(`Alert suppressed by downtime ${down.name}`);
    const incident = await dt.waitForIncidentByService(page, svc);
    expect(incident, 'the covered alert must open an incident').toBeTruthy();
    expect(incident.muted_by_downtime_id).toBe(down.id);

    const c = await fx.incidentAlert(page, reg, shared, 'c', svc, { enabled: false });
    await dt.enableAlert(page, c.id);

    const unmuted = await dt.waitForIncidentUnmuted(page, incident.id);
    expect(unmuted?.muted_by_downtime_id ?? null, 'the uncovered firing clears the mute').toBeNull();
    expect(await dt.waitForIncidentEvent(page, shared.sink, incident.id, OPENED), 'the un-muted incident sends its delayed "opened"').toBeGreaterThanOrEqual(1);
    const once = await dt.sampleIncidentEvents(page, shared.sink, incident.id, OPENED, { holdMs: 45_000 });
    expect(once.every((n) => n === 1), `the delayed "opened" is sent exactly once: ${once}`).toBe(true);
  });

  test('DT-I-03 when the window ends the covered alert fires and sends exactly one delayed "opened"', { tag: ['@P0'] }, async ({ page }) => {
    const svc = await fx.incidentService(page, reg, shared, 'i');
    const { f, down, trigger } = await fx.mutedAlert(page, reg, shared, svc);
    expect(trigger).toBe(`Alert suppressed by downtime ${down.name}`);
    const incident = await dt.waitForIncidentByService(page, svc);
    expect(incident, 'the covered alert must open an incident').toBeTruthy();
    expect(incident.muted_by_downtime_id, 'the incident opens muted by this downtime').toBe(down.id);
    const muted = await dt.sampleIncidentEvents(page, shared.sink, incident.id, null);
    expect(muted.every((n) => n === 0), `nothing is sent while the incident is muted: ${muted}`).toBe(true);

    await dt.cancelDowntime(page, down.id, f);
    const unmuted = await dt.waitForIncidentUnmuted(page, incident.id);
    expect(unmuted?.muted_by_downtime_id ?? null, 'the first firing after the window un-mutes the incident').toBeNull();
    expect(await dt.waitForIncidentEvent(page, shared.sink, incident.id, OPENED), 'the un-muted incident sends its delayed "opened"').toBeGreaterThanOrEqual(1);
    const once = await dt.sampleIncidentEvents(page, shared.sink, incident.id, OPENED, { holdMs: 75_000 });
    expect(once.every((n) => n === 1), `one delayed "opened", even after further scheduled firings: ${once}`).toBe(true);
  });

  test('DT-I-04 a suppressed firing that joins an open, unmuted incident keeps it unmuted', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await fx.incidentService(page, reg, shared, 'i');
    await fx.incidentAlert(page, reg, shared, 'c', svc);
    const open = await dt.waitForIncidentByService(page, svc);
    expect(open, 'the uncovered alert opens a normal incident first').toBeTruthy();
    expect(await dt.waitForIncidentEvent(page, shared.sink, open.id, OPENED)).toBeGreaterThanOrEqual(1);

    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.incidentAlert(page, reg, shared, 'a', svc, { enabled: false });
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_dt`, targets: [dt.alertIdsTarget([a.id])], schedule: dt.activeWindow() });
    await dt.enableAlert(page, a.id);
    expect(await dt.triggerMessage(page, a.id)).toBe(`Alert suppressed by downtime ${down.name}`);

    const samples = await dt.sampleCountOver(page, async () => ((await dt.getIncident(page, open.id))?.muted_by_downtime_id ? 1 : 0), { holdMs: 20_000, everyMs: 5000 });
    expect(samples.every((m) => m === 0), `the open incident must stay unmuted: ${samples}`).toBe(true);
    expect((await dt.findIncidentByService(page, svc))?.id, 'the suppressed firing joins the same incident').toBe(open.id);
  });

  test('DT-I-05 a severity change notifies on a normal incident only', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await fx.incidentService(page, reg, shared, 'i');
    const svcD = await fx.incidentService(page, reg, shared, 'd');
    await fx.incidentAlert(page, reg, shared, 'd', svcD);
    const { down, trigger } = await fx.mutedAlert(page, reg, shared, svc);
    expect(trigger).toBe(`Alert suppressed by downtime ${down.name}`);
    const incident = await dt.waitForIncidentByService(page, svc);
    expect(incident, 'the covered alert must open an incident').toBeTruthy();
    const control = await dt.waitForIncidentByService(page, svcD);
    expect(control, 'the control incident must exist').toBeTruthy();

    // A change only notifies when the severity actually moves, so pick one the incident does not have yet.
    await dt.setIncidentSeverity(page, incident.id, incident.severity === 'P1' ? 'P4' : 'P1');
    await dt.setIncidentSeverity(page, control.id, control.severity === 'P1' ? 'P4' : 'P1');

    expect(await dt.waitForIncidentEvent(page, shared.sink, control.id, 'severity_changed'), 'the normal incident notifies its severity change').toBeGreaterThanOrEqual(1);
    const ctlOnce = await dt.sampleIncidentEvents(page, shared.sink, control.id, 'severity_changed', { holdMs: 45_000 });
    expect(ctlOnce.every((n) => n === 1), `the severity change is sent exactly once: ${ctlOnce}`).toBe(true);
    const muted = await dt.sampleIncidentEvents(page, shared.sink, incident.id, 'severity_changed');
    expect(muted.every((n) => n === 0), `the muted incident must not notify a severity change: ${muted}`).toBe(true);
  });

  test('DT-I-06 incident mode "Not created": no incident during the window, a normal one after it', { tag: ['@P1'] }, async ({ page }) => {
    const svc = await fx.incidentService(page, reg, shared, 'i');
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.incidentAlert(page, reg, shared, 'a', svc, { enabled: false });
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
    expect(await dt.waitForIncidentEvent(page, shared.sink, after.id, OPENED), 'the post-window incident notifies').toBeGreaterThanOrEqual(1);
    const once = await dt.sampleIncidentEvents(page, shared.sink, after.id, OPENED, { holdMs: 45_000 });
    expect(once.every((n) => n === 1), `the post-window incident notifies once: ${once}`).toBe(true);
  });
});
