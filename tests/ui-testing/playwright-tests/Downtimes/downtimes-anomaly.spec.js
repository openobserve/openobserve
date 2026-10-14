// Copyright 2026 OpenObserve Inc.

// Downtimes — anomaly detection suppression, QA-verified recipe (plan Spec 10, DT-A-01..03).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_anom';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null, sink: null, svc: {}, bgContext: null, bg: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes suppress anomaly detections', { tag: ['@downtimes', '@enterprise', '@all', '@anomaly'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(10 * 60_000);
    shared.bgContext = await browser.newContext();
    const page = await shared.bgContext.newPage();
    Object.assign(gate, await dt.isDowntimesAvailable(page));
    if (!gate.available) return;
    if (gate.config.anomaly_detection_enabled !== true) {
      Object.assign(gate, { available: false, reason: 'anomaly detection is not enabled here (config.anomaly_detection_enabled)' });
      return;
    }
    const wp = workerPrefix(testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    const run = dt.uniqueName('r').slice(-8);
    shared.svc = { an1: `an1-${run}`, an2: `an2-${run}`, an3: `an3-${run}`, ctl: `ctl-${run}` };
    shared.stream = `${wp}_${run}_anom`;
    const services = Object.values(shared.svc);
    await dt.backfillAnomalyStream(page, shared.stream, services, { hours: 4.6, perMinute: 100 });
    const sink = await dt.seedSinkDestination(page, `${wp}_${run}`);
    shared.dest = sink.destination;
    shared.sink = sink.sink;
    // Live baseline of ~100 events per minute per service, spread across each 30 s tick.
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
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), detectors: [], alertFolders: [], folders: [] };
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
      const wp = workerPrefix(testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    }
    if (shared.bgContext) await shared.bgContext.close();
  });

  /** A trained detector on `service`; resolves once the model is ready. */
  async function detector(page, suffix, service, { folder = 'default', tags = [], filterField = 'service_name' } = {}) {
    const d = await dt.createAnomalyDetector(page, {
      name: `${reg.prefix}_${suffix}`, stream: shared.stream, service, destinations: [shared.dest], folder, tags, filterField,
    });
    reg.detectors.push(d.id);
    await dt.trainDetector(page, d.id);
    const ready = await dt.waitForDetectorReady(page, d.id);
    expect(ready, `detector ${d.name} must train to ready`).toBeTruthy();
    return d;
  }

  async function newDtFolder(page) {
    const id = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(id);
    return id;
  }

  const sink = (page, d, sinceUs) => dt.anomalySinkCount(page, shared.sink, d.id, sinceUs);

  async function expectNotifies(page, d, sinceUs, why) {
    const n = await dt.waitForCount(page, () => sink(page, d, sinceUs), (c) => c >= 1, { timeoutMs: 150_000 });
    expect(n, why).toBeGreaterThanOrEqual(1);
  }

  async function expectSilent(page, d, sinceUs, why) {
    const samples = await dt.sampleCountOver(page, () => sink(page, d, sinceUs));
    expect(samples.every((c) => c === 0), `${why}: ${samples}`).toBe(true);
  }

  async function expectSuppressedFor(page, down, d, sinceUs) {
    const rows = await dt.pollUntil(page, () => dt.suppressedRows(page, { downtimeId: down.id, sinceUs }),
      (r) => r.some((h) => h.alert_name === d.name), { timeoutMs: 150_000, intervalMs: 5000 });
    expect(rows.some((h) => h.alert_name === d.name), `${d.name} must record a suppressed detection carrying the downtime id`).toBe(true);
  }

  // ------------------------------------------------------------------ P1

  test('DT-A-01 muted by id: suppressed while the control notifies, then exactly one notification and no catch-up after End now', { tag: ['@P1'] }, async ({ page }) => {
    const x = await detector(page, 'x', shared.svc.an1);
    const y = await detector(page, 'y', shared.svc.an1);
    const f = await newDtFolder(page);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byid`, targets: [dt.idsTarget('anomaly_detections', [x.id])], schedule: dt.activeWindow() });

    await dt.spike(page, shared.stream, shared.svc.an1, 800);
    await dt.detectNow(page, x.id);
    await dt.detectNow(page, y.id);
    await expectSuppressedFor(page, down, x, t0 - 60 * dt.MICROS);
    await expectNotifies(page, y, t0, 'the uncovered detector on the same spike notifies');
    await expectSilent(page, x, t0, 'the muted detector must not notify');

    await dt.cancelDowntime(page, down.id, f);
    const t1 = dt.nowUs();
    // A fresh minute bucket, so the second spike is a new anomaly rather than the muted one.
    await page.waitForTimeout(61_000 - (Date.now() % 60_000));
    await dt.spike(page, shared.stream, shared.svc.an1, 800);
    await dt.detectNow(page, x.id);
    await expectNotifies(page, x, t1, 'after End now the detector notifies at once (the cooldown was not consumed)');
    const held = await dt.sampleCountOver(page, () => sink(page, x, t1));
    expect(held.every((c) => c === 1), `exactly one notification, no catch-up for the muted spike: ${held}`).toBe(true);
  });

  test('DT-A-02 muted by alert folder: the detector in the covered folder is silent, the one in default notifies', { tag: ['@P1'] }, async ({ page }) => {
    const folder = await dt.createAlertFolder(page, `${reg.prefix}_af`);
    reg.alertFolders.push(folder);
    const x = await detector(page, 'x', shared.svc.an2, { folder });
    const y = await detector(page, 'y', shared.svc.an2);
    const f = await newDtFolder(page);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_byfolder`, targets: [dt.folderTarget('anomaly_detections', [folder])], schedule: dt.activeWindow() });

    await dt.spike(page, shared.stream, shared.svc.an2, 800);
    await dt.detectNow(page, x.id);
    await dt.detectNow(page, y.id);
    await expectSuppressedFor(page, down, x, t0 - 60 * dt.MICROS);
    await expectNotifies(page, y, t0, 'the detector outside the folder notifies');
    await expectSilent(page, x, t0, 'the detector in the covered folder must not notify');
  });

  test('DT-A-03 muted by condition through a key:value tag', { tag: ['@P1'] }, async ({ page }) => {
    // Filtering on svc_key (not a semantic field) leaves the tag as the detector's only identity.
    const x = await detector(page, 'x', shared.svc.an3, { tags: [`service:${shared.svc.an3}`], filterField: 'svc_key' });
    const y = await detector(page, 'y', shared.svc.ctl, { tags: [`service:${shared.svc.ctl}`], filterField: 'svc_key' });
    const f = await newDtFolder(page);
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
    await expectSuppressedFor(page, down, x, t0 - 60 * dt.MICROS);
    await expectNotifies(page, y, t0, 'the detector tagged with another service notifies');
    await expectSilent(page, x, t0, 'the detector whose tag matches the condition must not notify');
  });
});
