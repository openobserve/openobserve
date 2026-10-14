// Copyright 2026 OpenObserve Inc.

// Downtimes — the 3am quick mute from the Alerts list (plan Spec 3, DT-Q-01..09).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const { seedMinimalStream, createSloViaApi, countDefinition, deleteSlosByPrefix } = require('../utils/slo-seed.js');

const PREFIX = 'e2e_dt_qmute';
const ENT_2848 = 'https://github.com/openobserve/o2-enterprise/issues/2848';
const PRESET_SECS = { '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400 };
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null, service: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes quick mute', { tag: ['@downtimes', '@enterprise', '@all', '@alerts'] }, () => {
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
      shared.service = `svc-q-${run}`;
      shared.stream = `${wp}_${run}_stream`;
      await dt.seedStream(page, shared.stream, { minutes: 10, services: [shared.service] });
      shared.dest = (await dt.seedSinkDestination(page, `${wp}_${run}`)).destination;
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes are not testable here — ${gate.reason}`);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], alertFolders: [], folders: [], detectors: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, alertIds: reg.alerts.map((a) => a.id), targetIds: reg.detectors, folderIds: reg.folders });
    for (const id of reg.detectors) await dt.deleteDetector(page, id);
    await dt.deleteAlertsAndFolders(page, reg.alerts, reg.alertFolders);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.available) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = workerPrefix(testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await deleteSlosByPrefix(page, `${wp}_`);
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  /** An alert folder with one alert per suffix; returns { folder, alerts: {suffix: alert} }. */
  async function alertsInFolder(page, suffixes) {
    const folder = await dt.createAlertFolder(page, `${reg.prefix}_af`);
    reg.alertFolders.push(folder);
    const alerts = {};
    for (const suffix of suffixes) {
      const alert = await dt.createSqlAlert(page, {
        name: `${reg.prefix}_${suffix}`,
        stream: shared.stream,
        sql: `SELECT count(*) AS c FROM "${shared.stream}"`,
        destinations: [shared.dest],
        folder,
        frequencyMinutes: 60,
        periodMinutes: 60,
      });
      reg.alerts.push(alert);
      alerts[suffix] = alert;
    }
    return { folder, alerts };
  }

  /** The active quick-mute downtimes for an alert, polled until one exists. */
  const mutesFor = (page, alertId) => dt.pollUntil(
    page,
    async () => (await dt.downtimesForAlert(page, alertId)).filter((r) => r.status === 'active'),
    (rows) => rows.length >= 1,
    { timeoutMs: 20_000, intervalMs: 2000 },
  );

  const secsLeft = (row) => (row.schedule.ends_at / dt.MICROS) - Date.now() / 1000;

  // ------------------------------------------------------------------ P0

  test('DT-Q-01 the 3am path: row ⋯ → Mute 1h mutes at once, with no dialog', { tag: ['@P0'] }, async ({ page }) => {
    const { folder, alerts } = await alertsInFolder(page, ['target', 'control']);
    const { target, control } = alerts;

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.muteAlertPreset(target.name, '1h');
    await pm.downtimesPage.expectQuickMuteDialog(false);
    await pm.downtimesPage.expectToast(/^Muted 1 item until \d{2}:\d{2}/);

    const rows = await mutesFor(page, target.id);
    expect(rows, 'exactly one active mute must exist for the target').toHaveLength(1);
    const mute = rows[0];
    expect(mute.targets).toHaveLength(1);
    expect(mute.targets[0]).toMatchObject({ module: 'alerts', folders: { kind: 'all' }, ids: [target.id] });
    expect(mute.show_banner).toBe(false);
    expect(mute.folder_id).toBe('default');
    expect(Math.abs(secsLeft(mute) - 3600)).toBeLessThanOrEqual(90);
    expect(await dt.downtimesForAlert(page, control.id), 'the control must not be muted').toHaveLength(0);

    await pm.downtimesPage.clickToastAction('Muted 1 item');
    await pm.downtimesPage.expectOnDetail(mute.id);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(target.name, true);
    await pm.alertsPage.expectMutedChip(control.name, false);
  });

  // ------------------------------------------------------------------ P1

  test('DT-Q-02 the Until… dialog: Cancel creates nothing; a custom end, reason and folder are saved', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await alertsInFolder(page, ['target']);
    const dtFolder = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(dtFolder);
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(10, 0, 0, 0);
    const reason = `${reg.prefix} maintenance`;

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.expectQuickMuteDialog(true);
    await pm.downtimesPage.cancelQuickMute();
    const afterCancel = await dt.sampleCountOver(page, async () => (await dt.downtimesForAlert(page, alerts.target.id)).length, { holdMs: 3000, everyMs: 1000 });
    expect(afterCancel.every((c) => c === 0), `Cancel must create nothing: ${afterCancel}`).toBe(true);

    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.quickMuteCustom({ end, reason, folderId: dtFolder });

    const [mute] = await mutesFor(page, alerts.target.id);
    expect(mute, 'the custom mute must exist').toBeTruthy();
    const saved = await dt.getDowntime(page, mute.id, dtFolder);
    expect(saved.reason).toBe(reason);
    expect(saved.folder_id).toBe(dtFolder);
    expect(Math.abs(saved.schedule.ends_at / 1000 - end.getTime())).toBeLessThanOrEqual(60_000);
  });

  test('DT-Q-03 bulk mute covers both selected alerts and leaves the unselected control alone', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await alertsInFolder(page, ['one', 'two', 'control']);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.bulkMute([alerts.one.name, alerts.two.name], '1h');

    expect(await mutesFor(page, alerts.one.id)).not.toHaveLength(0);
    expect(await mutesFor(page, alerts.two.id)).not.toHaveLength(0);
    expect(await dt.downtimesForAlert(page, alerts.control.id)).toHaveLength(0);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(alerts.one.name, true);
    await pm.alertsPage.expectMutedChip(alerts.two.name, true);
    await pm.alertsPage.expectMutedChip(alerts.control.name, false);
  });

  test('DT-Q-04 the Muted chip also shows on a real-time alert', { tag: ['@P1'] }, async ({ page }) => {
    const folder = await dt.createAlertFolder(page, `${reg.prefix}_af`);
    reg.alertFolders.push(folder);
    const rt = await dt.createRealtimeAlert(page, { name: `${reg.prefix}_rt`, stream: shared.stream, service: shared.service, destinations: [shared.dest], folder });
    reg.alerts.push(rt);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.muteAlertPreset(rt.name, '30m');
    const [mute] = await mutesFor(page, rt.id);
    expect(mute).toBeTruthy();
    expect(Math.abs(secsLeft(mute) - 1800)).toBeLessThanOrEqual(90);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(rt.name, true);
  });

  test('DT-Q-05 the 30m, 2h and 4h presets set the matching end', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await alertsInFolder(page, ['p30m', 'p2h', 'p4h']);
    await pm.alertsPage.gotoAlertListFolder(folder);
    for (const preset of ['30m', '2h', '4h']) {
      await pm.alertsPage.muteAlertPreset(alerts[`p${preset}`].name, preset);
    }
    for (const preset of ['30m', '2h', '4h']) {
      const [mute] = await mutesFor(page, alerts[`p${preset}`].id);
      expect(mute, `the ${preset} mute must exist`).toBeTruthy();
      expect(Math.abs(secsLeft(mute) - PRESET_SECS[preset]), `${preset} end`).toBeLessThanOrEqual(90);
    }
  });

  test('DT-Q-06 quick mute from an anomaly detection row targets the anomaly module', { tag: ['@P1', '@anomaly'] }, async ({ page }) => {
    test.skip(gate.config.anomaly_detection_enabled !== true, 'anomaly detection is not enabled here (config.anomaly_detection_enabled)');
    const folder = await dt.createAlertFolder(page, `${reg.prefix}_af`);
    reg.alertFolders.push(folder);
    const det = await dt.createAnomalyDetector(page, { name: `${reg.prefix}_det`, stream: shared.stream, service: shared.service, destinations: [shared.dest], folder });
    reg.detectors.push(det.id);

    await pm.alertsPage.gotoAlertListFolder(folder, { tab: 'anomalyDetection' });
    await pm.alertsPage.muteAlertPreset(det.name, '1h');
    await pm.downtimesPage.expectToast(/^Muted 1 item until /);

    // Quick mutes get a server-generated name ("1 item · once …"), so find the row by its target.
    const mute = await dt.pollUntil(page, async () => (await dt.listDowntimes(page)).items
      .find((r) => r.targets?.some((t) => t.module === 'anomaly_detections' && (t.ids ?? []).includes(det.id))),
    (row) => !!row, { timeoutMs: 20_000, intervalMs: 2000 });
    expect(mute, 'a downtime targeting the detector must exist').toBeTruthy();
    expect(mute.targets[0]).toMatchObject({ module: 'anomaly_detections', ids: [det.id] });
  });

  // ------------------------------------------------------------------ P2 (known ENT#2848 bugs)

  test('DT-Q-07 the quick-mute toast names the folder it was filed in', { tag: ['@P2'] }, async ({ page }) => {
    test.fixme(true, `The quick-mute toast prints the raw folder id — ${ENT_2848}`);
    const { folder, alerts } = await alertsInFolder(page, ['target']);
    const folderName = `${reg.prefix}_named`;
    const dtFolder = await dt.createDowntimeFolder(page, folderName);
    reg.folders.push(dtFolder);
    const end = new Date(Date.now() + 2 * 3600_000);
    end.setSeconds(0, 0);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.quickMuteCustom({ end, reason: 'toast folder name', folderId: dtFolder });
    await pm.downtimesPage.expectToast(`Filed in ${folderName}.`);
  });

  test('DT-Q-08 a muted SLO burn alert keeps its full name visible next to the chips', { tag: ['@P2', '@slo'] }, async ({ page }) => {
    test.fixme(true, `SLO alert name truncated by the chips — ${ENT_2848}`);
    const stream = `${reg.prefix}_slo`;
    await seedMinimalStream(page, stream);
    const slo = await createSloViaApi(page, countDefinition({ name: `${reg.prefix}_slo`, stream, windowSecs: 604800, sliceIntervalSecs: 60 }));
    const burn = await dt.createSloBurnAlert(page, { name: `${reg.prefix}_burn`, sloId: slo.id, destinations: [shared.dest] });
    reg.alerts.push(burn);
    await dt.createDowntime(page, 'default', { name: `${reg.prefix}_slo_mute`, targets: [dt.alertIdsTarget([burn.id])], schedule: dt.activeWindow() });

    await pm.alertsPage.gotoAlertListFolder('default');
    await pm.alertsPage.expectMutedChip(burn.name, true);
    expect(await pm.alertsPage.isAlertNameClipped(burn.name), 'the alert name must not be clipped').toBe(false);
  });

  test('DT-Q-09 the target chip shows the folder name, not its id', { tag: ['@P2'] }, async ({ page }) => {
    const folderName = `${reg.prefix}_chipfolder`;
    const alertFolder = await dt.createAlertFolder(page, folderName);
    reg.alertFolders.push(alertFolder);
    const dtFolder = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(dtFolder);
    const row = await dt.createDowntime(page, dtFolder, {
      name: `${reg.prefix}_chip`,
      targets: [dt.folderTarget('alerts', [alertFolder])],
      schedule: dt.futureWindow({ startInSec: 7200 }),
    });

    await pm.downtimesPage.gotoList(dtFolder);
    await pm.downtimesPage.expectTargetsCell(row.id, { contains: folderName, notContains: alertFolder });
  });
});
