// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_anom';

const gate = { ready: false, available: false, reason: '', config: {} };
const shared = { stream: null, dest: null, sink: null, svc: {}, bgContext: null, bg: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes suppress anomaly detections', { tag: ['@downtimes', '@enterprise', '@all', '@anomaly'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(10 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    gate.config = await dt.assertDowntimesEnabled(page);
    gate.ready = true;
    if (gate.config.anomaly_detection_enabled !== true) {
      Object.assign(gate, { reason: 'anomaly detection is not enabled here (config.anomaly_detection_enabled)' });
      return;
    }
    gate.available = true;
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    const run = dt.uniqueName('r').slice(-8);
    shared.svc = { an1: `an1-${run}`, an2: `an2-${run}`, an3: `an3-${run}`, ctl: `ctl-${run}` };
    shared.stream = `${wp}_${run}_anom`;
    const services = Object.values(shared.svc);
    await dt.backfillAnomalyStream(page, shared.stream, services, { hours: 4.6, perMinute: 100 });
    const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
    shared.dest = sink.destination;
    shared.sink = sink.sink;
    // A live baseline of about 100 events per minute per service keeps the trained model's normal range current.
    shared.bg = dt.startBackgroundIngest(page, shared.stream, {
      rowsFn: () => services.flatMap((service) => Array.from({ length: 50 }, (_, i) => ({
        _timestamp: (Date.now() - i * 600) * 1000, service_name: service, svc_key: service, level: 'info',
      }))),
    });
    testLogger.info('Anomaly stream backfilled', { stream: shared.stream });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes on anomaly detection are not testable here — ${gate.reason}`);
    test.setTimeout(10 * 60_000);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), detectors: [], alertFolders: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    for (const id of reg.detectors) await dt.deleteDetector(page, id);
    await dt.deleteAlertsAndFolders(page, [], reg.alertFolders);
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

  test('DT-A-01 muted by id: suppressed while the control notifies, then exactly one notification and no catch-up after End now', { tag: ['@P1'] }, async ({ page }) => {
    const x = await fx.trainedDetector(page, reg, shared, 'x', shared.svc.an1);
    const y = await fx.trainedDetector(page, reg, shared, 'y', shared.svc.an1);
    expect([x, y].map((d) => dt.isDetectorReady(d.ready)), 'both detectors must train to ready (is_trained or status "ready")').toEqual([true, true]);
    const f = await fx.newDowntimeFolder(page, reg);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byid`, targets: [dt.idsTarget('anomaly_detections', [x.id])], schedule: dt.activeWindow() });

    await dt.spike(page, shared.stream, shared.svc.an1, 800);
    await dt.detectNow(page, x.id);
    await dt.detectNow(page, y.id);
    const suppressed = await dt.waitForSuppressedRowNamed(page, { downtimeId: down.id, name: x.name, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.some((h) => h.alert_name === x.name), `${x.name} must record a suppressed detection carrying the downtime id`).toBe(true);
    expect(await dt.waitForAnomalyNotified(page, shared.sink, y.id, t0), 'the uncovered detector on the same spike notifies').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAnomalySink(page, shared.sink, x.id, t0);
    expect(silent.every((c) => c === 0), `the muted detector must not notify: ${silent}`).toBe(true);

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    // A fresh minute bucket, so the second spike is a new anomaly rather than the muted one.
    await page.waitForTimeout(61_000 - (Date.now() % 60_000));
    await dt.spike(page, shared.stream, shared.svc.an1, 800);
    await dt.detectNow(page, x.id);
    expect(await dt.waitForAnomalyNotified(page, shared.sink, x.id, t1), 'after End now the detector notifies at once (the cooldown was not consumed)').toBeGreaterThanOrEqual(1);
    const held = await dt.sampleAnomalySink(page, shared.sink, x.id, t1);
    expect(held.every((c) => c === 1), `exactly one notification, no catch-up for the muted spike: ${held}`).toBe(true);
  });

  test('DT-A-02 muted by alert folder: the detector in the covered folder is silent, the one in default notifies', { tag: ['@P1'] }, async ({ page }) => {
    const folder = await fx.newAlertFolder(page, reg);
    const x = await fx.trainedDetector(page, reg, shared, 'x', shared.svc.an2, { folder });
    const y = await fx.trainedDetector(page, reg, shared, 'y', shared.svc.an2);
    expect([x, y].map((d) => dt.isDetectorReady(d.ready)), 'both detectors must train to ready (is_trained or status "ready")').toEqual([true, true]);
    const f = await fx.newDowntimeFolder(page, reg);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byfolder`, targets: [dt.folderTarget('anomaly_detections', [folder])], schedule: dt.activeWindow() });

    await dt.spike(page, shared.stream, shared.svc.an2, 800);
    await dt.detectNow(page, x.id);
    await dt.detectNow(page, y.id);
    const suppressed = await dt.waitForSuppressedRowNamed(page, { downtimeId: down.id, name: x.name, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.some((h) => h.alert_name === x.name), `${x.name} must record a suppressed detection carrying the downtime id`).toBe(true);
    expect(await dt.waitForAnomalyNotified(page, shared.sink, y.id, t0), 'the detector outside the folder notifies').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAnomalySink(page, shared.sink, x.id, t0);
    expect(silent.every((c) => c === 0), `the detector in the covered folder must not notify: ${silent}`).toBe(true);
  });

  test('DT-A-03 muted by condition through a key:value tag', { tag: ['@P1'] }, async ({ page }) => {
    // Filtering on svc_key (not a semantic field) leaves the tag as the detector's only identity.
    const x = await fx.trainedDetector(page, reg, shared, 'x', shared.svc.an3, { tags: [`service:${shared.svc.an3}`], filterField: 'svc_key' });
    const y = await fx.trainedDetector(page, reg, shared, 'y', shared.svc.ctl, { tags: [`service:${shared.svc.ctl}`], filterField: 'svc_key' });
    expect([x, y].map((d) => dt.isDetectorReady(d.ready)), 'both detectors must train to ready (is_trained or status "ready")').toEqual([true, true]);
    const f = await fx.newDowntimeFolder(page, reg);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_bytag`,
      condition: dt.pair('service', shared.svc.an3),
      targets: [dt.allFoldersTarget('anomaly_detections')],
      schedule: dt.activeWindow(),
    });

    await dt.spike(page, shared.stream, shared.svc.an3, 800);
    await dt.spike(page, shared.stream, shared.svc.ctl, 800);
    await dt.detectNow(page, x.id);
    await dt.detectNow(page, y.id);
    const suppressed = await dt.waitForSuppressedRowNamed(page, { downtimeId: down.id, name: x.name, sinceUs: t0 - 60 * dt.MICROS });
    expect(suppressed.some((h) => h.alert_name === x.name), `${x.name} must record a suppressed detection carrying the downtime id`).toBe(true);
    expect(await dt.waitForAnomalyNotified(page, shared.sink, y.id, t0), 'the detector tagged with another service notifies').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAnomalySink(page, shared.sink, x.id, t0);
    expect(silent.every((c) => c === 0), `the detector whose tag matches the condition must not notify: ${silent}`).toBe(true);
  });
});
