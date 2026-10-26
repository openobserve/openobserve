// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');
const { seedMinimalStream, createSloViaApi, countDefinition, deleteSlosByPrefix } = require('../utils/slo-seed.js');

const PREFIX = 'e2e_dt_qmute';
const ENT_2848 = 'https://github.com/openobserve/o2-enterprise/issues/2848';
const PRESET_SECS = { '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400 };

const gate = { ready: false, config: {} };
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
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      const wp = fx.workerPrefix(PREFIX, testInfo);
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
    testLogger.testStart(testInfo.title, testInfo.file);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), alerts: [], alertFolders: [], folders: [], detectors: [] };
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
    if (!gate.ready) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await deleteSlosByPrefix(page, `${wp}_`);
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('DT-Q-01 the 3am path: row ⋯ → Mute 1h mutes at once, with no dialog', { tag: ['@P0'] }, async ({ page }) => {
    const { folder, alerts } = await fx.alertsInFolder(page, reg, shared, ['target', 'control']);
    const { target, control } = alerts;

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.muteAlertPreset(target.name, '1h');
    await pm.downtimesPage.expectQuickMuteDialog(false);
    await pm.downtimesPage.expectToast(/^Muted 1 item until \d{2}:\d{2}/);

    const rows = await dt.waitForActiveMutes(page, target.id);
    expect(rows, 'exactly one active mute must exist for the target').toHaveLength(1);
    const mute = rows[0];
    expect(mute.targets).toHaveLength(1);
    expect(mute.targets[0]).toMatchObject({ module: 'alerts', folders: { kind: 'all' }, ids: [target.id] });
    expect(mute.show_banner).toBe(false);
    expect(mute.folder_id).toBe('default');
    expect(Math.abs(dt.secsLeft(mute) - 3600)).toBeLessThanOrEqual(90);
    expect(await dt.activeDowntimesForAlert(page, control.id), 'the control must not be muted').toHaveLength(0);

    await pm.downtimesPage.clickToastAction('Muted 1 item');
    await pm.downtimesPage.expectOnDetail(mute.id);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(target.name, true);
    await pm.alertsPage.expectMutedChip(control.name, false);
  });

  test('DT-Q-02 the Until… dialog: Cancel creates nothing; a custom end, reason and folder are saved', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await fx.alertsInFolder(page, reg, shared, ['target']);
    const dtFolder = await fx.newDowntimeFolder(page, reg);
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(10, 0, 0, 0);
    const reason = `${reg.prefix} maintenance`;

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.expectQuickMuteDialog(true);
    await pm.downtimesPage.cancelQuickMute();
    const afterCancel = await dt.sampleCountOver(page, async () => (await dt.activeDowntimesForAlert(page, alerts.target.id)).length, { holdMs: 3000, everyMs: 1000 });
    expect(afterCancel.every((c) => c === 0), `Cancel must create nothing: ${afterCancel}`).toBe(true);

    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.quickMuteCustom({ end, reason, folderId: dtFolder, folderName: `${reg.prefix}_f` });

    const [mute] = await dt.waitForActiveMutes(page, alerts.target.id);
    expect(mute, 'the custom mute must exist').toBeTruthy();
    const saved = await dt.getDowntime(page, mute.id, dtFolder);
    expect(saved.reason).toBe(reason);
    expect(saved.folder_id).toBe(dtFolder);
    expect(Math.abs(saved.schedule.ends_at / 1000 - end.getTime())).toBeLessThanOrEqual(60_000);
  });

  test('DT-Q-03 bulk mute covers both selected alerts and leaves the unselected control alone', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await fx.alertsInFolder(page, reg, shared, ['one', 'two', 'control']);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.bulkMute([alerts.one.name, alerts.two.name], '1h');

    expect(await dt.waitForActiveMutes(page, alerts.one.id)).not.toHaveLength(0);
    expect(await dt.waitForActiveMutes(page, alerts.two.id)).not.toHaveLength(0);
    expect(await dt.activeDowntimesForAlert(page, alerts.control.id), 'the unselected control must not be muted').toHaveLength(0);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(alerts.one.name, true);
    await pm.alertsPage.expectMutedChip(alerts.two.name, true);
    await pm.alertsPage.expectMutedChip(alerts.control.name, false);
  });

  test('DT-Q-04 the Muted chip also shows on a real-time alert', { tag: ['@P1'] }, async ({ page }) => {
    const folder = await fx.newAlertFolder(page, reg);
    const rt = await dt.createRealtimeAlert(page, { name: `${reg.prefix}_rt`, stream: shared.stream, service: shared.service, destinations: [shared.dest], folder });
    reg.alerts.push(rt);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.muteAlertPreset(rt.name, '30m');
    const [mute] = await dt.waitForActiveMutes(page, rt.id);
    expect(mute).toBeTruthy();
    expect(Math.abs(dt.secsLeft(mute) - 1800)).toBeLessThanOrEqual(90);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.expectMutedChip(rt.name, true);
  });

  test('DT-Q-05 the 30m, 2h and 4h presets set the matching end', { tag: ['@P1'] }, async ({ page }) => {
    const { folder, alerts } = await fx.alertsInFolder(page, reg, shared, ['p30m', 'p2h', 'p4h']);
    await pm.alertsPage.gotoAlertListFolder(folder);
    for (const preset of ['30m', '2h', '4h']) {
      await pm.alertsPage.muteAlertPreset(alerts[`p${preset}`].name, preset);
    }
    for (const preset of ['30m', '2h', '4h']) {
      const [mute] = await dt.waitForActiveMutes(page, alerts[`p${preset}`].id);
      expect(mute, `the ${preset} mute must exist`).toBeTruthy();
      expect(Math.abs(dt.secsLeft(mute) - PRESET_SECS[preset]), `${preset} end`).toBeLessThanOrEqual(90);
    }
  });

  test('DT-Q-06 quick mute from an anomaly detection row targets the anomaly module', { tag: ['@P1', '@anomaly'] }, async ({ page }) => {
    test.skip(gate.config.anomaly_detection_enabled !== true, 'anomaly detection is not enabled here (config.anomaly_detection_enabled)');
    const folder = await fx.newAlertFolder(page, reg);
    const det = await dt.createAnomalyDetector(page, { name: `${reg.prefix}_det`, stream: shared.stream, service: shared.service, destinations: [shared.dest], folder });
    reg.detectors.push(det.id);

    await pm.alertsPage.gotoAlertListFolder(folder, { tab: 'anomalyDetection' });
    await pm.alertsPage.muteAlertPreset(det.name, '1h');
    await pm.downtimesPage.expectToast(/^Muted 1 item until /);

    const mute = await dt.waitForDowntimeTargeting(page, 'anomaly_detections', det.id);
    expect(mute, 'a downtime targeting the detector must exist').toBeTruthy();
    expect(mute.targets[0]).toMatchObject({ module: 'anomaly_detections', ids: [det.id] });
  });

  test('DT-Q-07 the quick-mute toast names the folder it was filed in', { tag: ['@P2'] }, async ({ page }) => {
    test.fixme(true, `The quick-mute toast prints the raw folder id — ${ENT_2848}`);
    const { folder, alerts } = await fx.alertsInFolder(page, reg, shared, ['target']);
    const dtFolder = await fx.newDowntimeFolder(page, reg, 'named');
    const end = new Date(Date.now() + 2 * 3600_000);
    end.setSeconds(0, 0);

    await pm.alertsPage.gotoAlertListFolder(folder);
    await pm.alertsPage.openMuteUntil(alerts.target.name);
    await pm.downtimesPage.quickMuteCustom({ end, reason: 'toast folder name', folderId: dtFolder, folderName: `${reg.prefix}_named` });
    await pm.downtimesPage.expectToast(`Filed in ${reg.prefix}_named.`);
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
    const alertFolder = await fx.newAlertFolder(page, reg, 'chipfolder');
    const dtFolder = await fx.newDowntimeFolder(page, reg);
    const row = await dt.createDowntime(page, dtFolder, {
      name: `${reg.prefix}_chip`,
      targets: [dt.folderTarget('alerts', [alertFolder])],
      schedule: dt.futureWindow({ startInSec: 7200 }),
    });

    await pm.downtimesPage.gotoList(dtFolder);
    await pm.downtimesPage.expectTargetsCell(row.id, { contains: `${reg.prefix}_chipfolder`, notContains: alertFolder });
  });
});
