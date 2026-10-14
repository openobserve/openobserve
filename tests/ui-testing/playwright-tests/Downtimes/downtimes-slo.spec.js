// Copyright 2026 OpenObserve Inc.

// Downtimes — SLO correction (plan Spec 9, DT-SLO-01..05).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const { waitForStreamSearchable } = require('../utils/oncall-seed.js');
const { createSloViaApi, countDefinition, waitForSloMeasured, deleteSlosByPrefix } = require('../utils/slo-seed.js');

const PREFIX = 'e2e_dt_slo';
const ORG = process.env.ORGNAME;
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { parking: null, dest: null, sink: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes correct SLOs', { tag: ['@downtimes', '@enterprise', '@all', '@slo'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      Object.assign(gate, await dt.isDowntimesAvailable(page));
      if (!gate.available) return;
      const wp = workerPrefix(testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      shared.parking = await dt.ensureParkingFolder(page);
      const sink = await dt.seedSinkDestination(page, `${wp}_${dt.uniqueName('r').slice(-8)}`);
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
    test.setTimeout(10 * 60_000);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    // Cancels our parked SLO downtimes; their delete is refused with 409 and they stay parked by design.
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts);
    await deleteSlosByPrefix(page, reg.prefix);
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

  /** Backdated stream + count SLO scoped to this test's service; measured unless `measure` is false. */
  async function measuredSlo(page, suffix = 'slo', { measure = true, service = null } = {}) {
    const svc = service ?? `slo-${reg.prefix.slice(-8)}`;
    const stream = `${reg.prefix}_stream`;
    const rows = dt.sloRows(svc);
    await dt.ingestRows(page, stream, rows);
    await waitForStreamSearchable(page, stream, rows.length);
    const slo = await createSloViaApi(page, countDefinition({
      name: `${reg.prefix}_${suffix}`,
      stream,
      scope: `service_name = '${svc}'`,
      goodExpr: 'status_code != 500',
      windowSecs: 604800,
      sliceIntervalSecs: 60,
    }));
    if (measure) {
      await waitForSloMeasured(page, slo.id);
      // A downtime saved before the first live pass plans no re-measure (slo/corrections.rs remeasure_slo needs watermark_end).
      const live = await dt.waitForSloLive(page, slo.id);
      expect(live?.watermark_end ?? null, 'the SLO must finish its first live pass').not.toBeNull();
    }
    return { ...slo, stream, svc };
  }

  const sloTarget = (sloId, mode) => [dt.idsTarget('slos', [sloId], { slo_mode: mode })];

  const correctedSlices = (page, sloId, downtimeId) => dt.pollUntil(
    page, () => dt.sliceRows(page, sloId, downtimeId), (rows) => rows.length > 0, { timeoutMs: 120_000, intervalMs: 5000 },
  );

  // ------------------------------------------------------------------ P1

  test('DT-SLO-01 "exclude" zeroes the slices in the window, back to before the save, and the downtime cannot be deleted', { tag: ['@P1'] }, async ({ page }) => {
    const slo = await measuredSlo(page);
    const tCreate = Date.now();
    const windowStartMs = tCreate - 30 * 60_000;
    const down = await dt.createDowntime(page, shared.parking, {
      name: `${reg.prefix}_exclude`,
      targets: sloTarget(slo.id, 'exclude'),
      schedule: dt.windowFromMs(windowStartMs, tCreate + 30 * 60_000),
    });

    const corrected = await correctedSlices(page, slo.id, down.id);
    expect(corrected.length, 'slices inside the window are re-measured with corrected_by').toBeGreaterThan(0);
    expect(corrected.every((r) => Number(r.good) === 0 && Number(r.total) === 0), 'excluded slices count neither good nor bad').toBe(true);
    expect(corrected.some((r) => Number(r.slice_start) < (tCreate - 10 * 60_000) / 1000), 'minutes before the save are corrected too').toBe(true);

    const before = (await dt.sliceRows(page, slo.id)).filter((r) => Number(r.slice_start) < windowStartMs / 1000);
    expect(before.length, 'control: slices before the window exist').toBeGreaterThan(0);
    expect(before.every((r) => !r.corrected_by), 'control: slices before the window are not corrected').toBe(true);
    expect(before.some((r) => Number(r.total) > 0), 'control: slices before the window keep their counts').toBe(true);

    await dt.cancelDowntime(page, down.id, shared.parking);
    const del = await dt.deleteDowntime(page, down.id, shared.parking);
    expect(del.status()).toBe(409);
    expect(await del.text()).toContain('This downtime corrected SLO slices. Cancel it instead');
  });

  test('DT-SLO-02 "count as good" makes good equal total on the slices that had errors', { tag: ['@P1'] }, async ({ page }) => {
    const slo = await measuredSlo(page);
    const startMs = Date.now() - 45 * 60_000;
    const endMs = Date.now() + 15 * 60_000;
    const inWindow = (r) => Number(r.slice_start) >= startMs / 1000 && Number(r.slice_start) < endMs / 1000;
    const baseline = (await dt.sliceRows(page, slo.id)).filter((r) => inWindow(r) && !r.corrected_by && Number(r.good) < Number(r.total));
    expect(baseline.length, 'baseline: the window holds slices with errors').toBeGreaterThan(0);

    const down = await dt.createDowntime(page, shared.parking, {
      name: `${reg.prefix}_asgood`,
      targets: sloTarget(slo.id, 'count_as_good'),
      schedule: dt.windowFromMs(startMs, endMs),
    });
    const corrected = await correctedSlices(page, slo.id, down.id);
    expect(corrected.length).toBeGreaterThan(0);
    expect(corrected.every((r) => Number(r.good) === Number(r.total)), 'every corrected slice counts as fully good').toBe(true);
    const erroredStarts = new Set(baseline.map((r) => String(r.slice_start)));
    const fixed = corrected.filter((r) => erroredStarts.has(String(r.slice_start)));
    expect(fixed.length, 'the slices that had errors are among the corrected ones').toBeGreaterThan(0);
    expect(fixed.every((r) => Number(r.total) > 0)).toBe(true);
  });

  test('DT-SLO-03 the SLO list and detail show the correction only while it is active', { tag: ['@P1'] }, async ({ page }) => {
    const slo = await measuredSlo(page);
    const down = await dt.createDowntime(page, shared.parking, {
      name: `${reg.prefix}_ui`,
      targets: sloTarget(slo.id, 'exclude'),
      schedule: dt.activeWindow({ startOffsetSec: -600, durationSec: 3600 }),
    });

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.search(slo.name);
    await pm.sloListPage.expectCorrectedChip(slo.name, true);

    await pm.sloDetailPage.goto(ORG, slo.id);
    await pm.sloDetailPage.expectCorrectedTag();
    await pm.sloDetailPage.expectCorrectionItem(down.id, `${down.name} (Active)`);
    await pm.sloDetailPage.clickCorrectionItem(down.id);
    await pm.downtimesPage.expectOnDetail(down.id);

    await dt.cancelDowntime(page, down.id, shared.parking);
    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.search(slo.name);
    await pm.sloListPage.expectCorrectedChip(slo.name, false);
  });

  test('DT-SLO-04 "Exclude a window…" opens the create page with only SLOs and this SLO prefilled', { tag: ['@P1'] }, async ({ page }) => {
    const slo = await measuredSlo(page, 'slo', { measure: false });

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.search(slo.name);
    await pm.sloListPage.clickExcludeWindow(slo.name);
    await pm.downtimesPage.expectOnAddPage();
    await pm.downtimesPage.expectModulePressed('slos', true);
    await pm.downtimesPage.expectModulePressed('alerts', false);
    await pm.downtimesPage.expectSpecificItemSelected('slos', slo.id);

    const targeting = async () => (await dt.listDowntimes(page)).items
      .filter((r) => r.targets?.some((t) => (t.ids ?? []).includes(slo.id))).length;
    const samples = await dt.sampleCountOver(page, targeting, { holdMs: 3000, everyMs: 1000 });
    expect(samples.every((n) => n === 0), `opening the prefilled page saves nothing: ${samples}`).toBe(true);
  });

  test('DT-SLO-05 an SLO error-budget alert is suppressed while its control keeps firing', { tag: ['@P1', '@alerts'] }, async ({ page }) => {
    // Error budget, not burn rate: a new SLO has no burn windows, so a burn alert stays frozen for about an hour.
    const svc = `slo-${reg.prefix.slice(-8)}`;
    const slo = await measuredSlo(page, 'slo', { service: svc });
    const ctl = await measuredSlo(page, 'ctl', { service: svc });
    const burn = await dt.createSloBurnAlert(page, { name: `${reg.prefix}_burn`, sloId: slo.id, destinations: [shared.dest], kind: 'error_budget', critical: 50 });
    const ctlBurn = await dt.createSloBurnAlert(page, { name: `${reg.prefix}_ctlburn`, sloId: ctl.id, destinations: [shared.dest], kind: 'error_budget', critical: 50 });
    reg.alerts.push(burn, ctlBurn);
    // Keep erroring rows flowing so both SLOs stay over budget while the window runs.
    const bg = dt.startBackgroundIngest(page, slo.stream, {
      rowsFn: () => [0, 1, 2, 3].map((i) => ({ _timestamp: (Date.now() - i * 1000) * 1000, service_name: svc, status_code: i % 2 ? 200 : 500, latency: 120 })),
    });
    try {
      const f = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
      reg.folders.push(f);
      const t0 = dt.nowUs();
      const down = await dt.createDowntime(page, f, { name: `${reg.prefix}_burndt`, targets: [dt.alertIdsTarget([burn.id])], schedule: dt.activeWindow() });

      const suppressed = await dt.waitForSuppressed(page, { alertId: burn.id, downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, timeoutMs: 180_000 });
      expect(suppressed.length, 'the SLO alert records suppressed evaluations').toBeGreaterThanOrEqual(1);
      const ctlRuns = await dt.waitForFiringAfter(page, { alertId: ctlBurn.id, sinceUs: t0 });
      expect(ctlRuns.length, 'the control SLO alert keeps firing unsuppressed').toBeGreaterThanOrEqual(1);
      const ctlDelivered = await dt.waitForCount(page, () => dt.alertSinkCount(page, shared.sink, ctlBurn.name, t0), (c) => c >= 1, { timeoutMs: 150_000 });
      expect(ctlDelivered, 'the control SLO alert notifies').toBeGreaterThanOrEqual(1);
      const held = await dt.sampleCountOver(page, () => dt.alertSinkCount(page, shared.sink, burn.name, t0 + 5 * dt.MICROS));
      expect(held.every((c) => c === 0), `the muted SLO alert must not notify: ${held}`).toBe(true);
    } finally {
      bg.stop();
    }
  });
});
