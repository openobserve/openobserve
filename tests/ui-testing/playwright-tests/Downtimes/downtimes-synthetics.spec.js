// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');
const { ensureSyntheticsLocation } = require('../utils/synthetics-helpers.js');

const PREFIX = 'e2e_dt_synth';
// Synthetics alerting runs only when a probe acks a job (job_api.rs ack → resolve_alert); seeded result rows never reach it.
const NO_RUNTIME = 'needs a probe runner that executes checks and acks their results; CI has none';

const gate = { ready: false, available: false, reason: '', config: {} };
const shared = { location: null, dest: null, sink: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes on synthetics checks', { tag: ['@downtimes', '@enterprise', '@all', '@synthetics'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      if (gate.config.synthetics_enabled !== true) {
        // The ENT gate runs without ZO_SYNTHETICS_ENABLED, so the module is legitimately absent there.
        gate.reason = 'synthetics are not enabled here (config.synthetics_enabled)';
        return;
      }
      gate.available = true;
      shared.location = await ensureSyntheticsLocation(page);
      const wp = fx.workerPrefix(PREFIX, testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
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
    test.skip(!gate.available, `Downtimes on synthetics are not testable here — ${gate.reason}`);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), checks: [], synthFolders: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    // Row mutes get server-generated names, so they are found by the checks they target.
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders, targetIds: reg.checks.map((c) => c.id) });
    for (const c of reg.checks) await dt.deleteSyntheticCheck(page, c.id, c.folder);
    for (const f of reg.synthFolders) await dt.deleteSyntheticsFolder(page, f);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.available) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await dt.cleanupDowntimes(page, { prefix: `${fx.workerPrefix(PREFIX, testInfo)}_` });
    await dt.deleteDestinationsByPrefix(page, `${fx.workerPrefix(PREFIX, testInfo)}_`);
    await context.close();
  });

  test('DT-SY-01 a saved check shows the Muted chip and the control does not', { tag: ['@P1'] }, async ({ page }) => {
    const x = await fx.syntheticCheck(page, reg, shared, 'x');
    const y = await fx.syntheticCheck(page, reg, shared, 'y');
    const f = await fx.newDowntimeFolder(page, reg);
    await dt.createDowntime(page, f, { name: `${reg.prefix}_dt`, targets: [dt.idsTarget('synthetics', [x.id])], schedule: dt.activeWindow() });

    await pm.downtimesPage.gotoSynthetics(reg.prefix);
    await pm.downtimesPage.expectSyntheticMuted(x, true);
    await pm.downtimesPage.expectSyntheticMuted(y, false);
  });

  test('DT-SY-02 row ⋯ → Mute 1h mutes exactly that check', { tag: ['@P1'] }, async ({ page }) => {
    const x = await fx.syntheticCheck(page, reg, shared, 'x');
    const y = await fx.syntheticCheck(page, reg, shared, 'y');

    await pm.downtimesPage.gotoSynthetics(reg.prefix);
    await pm.downtimesPage.muteSyntheticRow(x.name, '1h');

    const mute = await dt.waitForDowntimeTargeting(page, 'synthetics', x.id);
    expect(mute, 'a downtime targeting the check must exist').toBeTruthy();
    expect(mute.targets).toHaveLength(1);
    expect(mute.targets[0]).toMatchObject({ module: 'synthetics', ids: [x.id] });
    expect(await dt.countDowntimesNamingId(page, y.id), 'the other check must not be muted').toBe(0);
  });

  test('DT-SY-03 suppression by tags: only a check carrying every tag is suppressed', { tag: ['@P0'] }, async ({ page }) => {
    test.fixme(true, NO_RUNTIME);
    test.setTimeout(8 * 60_000);
    const run = reg.prefix.slice(-8);
    const x = await fx.syntheticCheck(page, reg, shared, 'x', { tags: [`team:${run}`, 'env:prod'] });
    const y = await fx.syntheticCheck(page, reg, shared, 'y', { tags: [`team:${run}`] });
    const f = await fx.newDowntimeFolder(page, reg);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_tags`,
      targets: [dt.allFoldersTarget('synthetics', { tags: [`team:${run}`, 'env:prod'] })],
      schedule: dt.activeWindow(),
    });

    const suppressed = await dt.waitForSuppressed(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, timeoutMs: 240_000 });
    expect(suppressed.some((h) => h.alert_name === x.name), 'the fully tagged check must be suppressed').toBe(true);
    expect(suppressed.some((h) => h.alert_name === y.name), 'a partially tagged check must not be suppressed').toBe(false);
    expect(await dt.waitForAlertDelivered(page, shared.sink, y.name, t0, { timeoutMs: 180_000 }), 'the partially tagged control keeps notifying').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, x.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the suppressed check must not notify: ${silent}`).toBe(true);
  });

  test('DT-SY-04 suppression by synthetics folder: only the check in the covered folder is suppressed', { tag: ['@P0'] }, async ({ page }) => {
    test.fixme(true, NO_RUNTIME);
    test.setTimeout(8 * 60_000);
    const s1 = await fx.newSyntheticsFolder(page, reg, 's1');
    const s2 = await fx.newSyntheticsFolder(page, reg, 's2');
    const x = await fx.syntheticCheck(page, reg, shared, 'x', { folder: s1 });
    const y = await fx.syntheticCheck(page, reg, shared, 'y', { folder: s2 });
    const f = await fx.newDowntimeFolder(page, reg);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_sfolder`,
      targets: [dt.folderTarget('synthetics', [s1])],
      schedule: dt.activeWindow(),
    });

    const suppressed = await dt.waitForSuppressed(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, timeoutMs: 240_000 });
    expect(suppressed.some((h) => h.alert_name === x.name), 'the check in the covered folder must be suppressed').toBe(true);
    expect(suppressed.some((h) => h.alert_name === y.name), 'the check in the other folder must not be suppressed').toBe(false);
    expect(await dt.waitForAlertDelivered(page, shared.sink, y.name, t0, { timeoutMs: 180_000 }), 'the control check keeps notifying').toBeGreaterThanOrEqual(1);
    const silent = await dt.sampleAlertSink(page, shared.sink, x.name, t0 + 5 * dt.MICROS);
    expect(silent.every((c) => c === 0), `the suppressed check must not notify: ${silent}`).toBe(true);
  });
});
