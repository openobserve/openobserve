// Copyright 2026 OpenObserve Inc.

// Downtimes — synthetics checks (plan Spec 4, DT-SY-01..04).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_synth';
const NO_LOCATION = 'no synthetics probe location in this env: a check cannot be saved/run';
const NO_RUNTIME = 'needs a probe (Lambda/agent) to execute checks; CI has none';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { available: false, reason: 'gate not probed', config: {}, location: null };
const shared = { dest: null, sink: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes on synthetics checks', { tag: ['@downtimes', '@enterprise', '@all', '@synthetics'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      Object.assign(gate, await dt.isDowntimesAvailable(page));
      if (!gate.available) return;
      if (gate.config.synthetics_enabled !== true) {
        Object.assign(gate, { available: false, reason: 'synthetics are not enabled here (config.synthetics_enabled)' });
        return;
      }
      const locations = await dt.listSyntheticLocations(page);
      const first = locations.find((l) => l.enabled !== false) ?? locations[0];
      gate.location = first ? (first.id ?? first.name ?? first.location_id) : null;
      if (!gate.location) return;
      const wp = workerPrefix(testInfo);
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
    test.skip(!gate.location, NO_LOCATION);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), checks: [], synthFolders: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    for (const c of reg.checks) await dt.deleteSyntheticCheck(page, c.id, c.folder);
    for (const f of reg.synthFolders) await dt.deleteSyntheticsFolder(page, f);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.available || !gate.location) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await dt.cleanupDowntimes(page, { prefix: `${workerPrefix(testInfo)}_` });
    await dt.deleteDestinationsByPrefix(page, `${workerPrefix(testInfo)}_`);
    await context.close();
  });

  async function check(page, suffix, { tags = [], folder = 'default' } = {}) {
    const c = await dt.createSyntheticCheck(page, { name: `${reg.prefix}_${suffix}`, tags, location: gate.location, destinations: [shared.dest], folder });
    reg.checks.push(c);
    return c;
  }

  async function newFolder(page) {
    const id = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(id);
    return id;
  }

  test('DT-SY-01 a saved check shows the Muted chip and the control does not', { tag: ['@P1'] }, async ({ page }) => {
    const x = await check(page, 'x');
    const y = await check(page, 'y');
    const f = await newFolder(page);
    await dt.createDowntime(page, f, { name: `${reg.prefix}_dt`, targets: [dt.idsTarget('synthetics', [x.id])], schedule: dt.activeWindow() });

    await pm.downtimesPage.gotoSynthetics();
    await pm.downtimesPage.expectSyntheticMuted(x.id, true);
    await pm.downtimesPage.expectSyntheticMuted(y.id, false);
  });

  test('DT-SY-02 row ⋯ → Mute 1h mutes exactly that check', { tag: ['@P1'] }, async ({ page }) => {
    const x = await check(page, 'x');
    await check(page, 'y');

    await pm.downtimesPage.gotoSynthetics();
    await pm.downtimesPage.muteSyntheticRow(x.name, '1h');

    const mute = await dt.pollUntil(page, async () => (await dt.listDowntimes(page, { search: x.name })).items
      .find((r) => r.targets?.some((t) => t.module === 'synthetics' && (t.ids ?? []).includes(x.id))),
    (row) => !!row, { timeoutMs: 20_000, intervalMs: 2000 });
    expect(mute, 'a downtime targeting the check must exist').toBeTruthy();
    expect(mute.targets[0]).toMatchObject({ module: 'synthetics', ids: [x.id] });
  });

  test('DT-SY-03 suppression by tags: only a check carrying every tag is suppressed', { tag: ['@P0'] }, async ({ page }) => {
    test.skip(!process.env.DOWNTIMES_SYNTHETICS_RUNTIME, NO_RUNTIME);
    test.setTimeout(8 * 60_000);
    const run = reg.prefix.slice(-8);
    const x = await check(page, 'x', { tags: [`team:${run}`, 'env:prod'] });
    const y = await check(page, 'y', { tags: [`team:${run}`] });
    const f = await newFolder(page);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_tags`,
      targets: [dt.allFoldersTarget('synthetics', { tags: [`team:${run}`, 'env:prod'] })],
      schedule: dt.activeWindow(),
    });

    const suppressed = await dt.waitForSuppressed(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, timeoutMs: 240_000 });
    expect(suppressed.some((h) => h.alert_name === x.name), 'the fully tagged check must be suppressed').toBe(true);
    expect(suppressed.some((h) => h.alert_name === y.name), 'a partially tagged check must not be suppressed').toBe(false);
    const yDelivered = await dt.waitForCount(page, () => dt.alertSinkCount(page, shared.sink, y.name, t0), (c) => c >= 1, { timeoutMs: 180_000 });
    expect(yDelivered, 'the partially tagged control keeps notifying').toBeGreaterThanOrEqual(1);
    const xSamples = await dt.sampleCountOver(page, () => dt.alertSinkCount(page, shared.sink, x.name, t0 + 5 * dt.MICROS));
    expect(xSamples.every((c) => c === 0), `the suppressed check must not notify: ${xSamples}`).toBe(true);
  });

  test('DT-SY-04 suppression by synthetics folder: only the check in the covered folder is suppressed', { tag: ['@P0'] }, async ({ page }) => {
    test.skip(!process.env.DOWNTIMES_SYNTHETICS_RUNTIME, NO_RUNTIME);
    test.setTimeout(8 * 60_000);
    const s1 = await dt.createSyntheticsFolder(page, `${reg.prefix}_s1`);
    const s2 = await dt.createSyntheticsFolder(page, `${reg.prefix}_s2`);
    reg.synthFolders.push(s1, s2);
    const x = await check(page, 'x', { folder: s1 });
    const y = await check(page, 'y', { folder: s2 });
    const f = await newFolder(page);
    const t0 = dt.nowUs();
    const down = await dt.createDowntime(page, f, {
      name: `${reg.prefix}_sfolder`,
      targets: [dt.folderTarget('synthetics', [s1])],
      schedule: dt.activeWindow(),
    });

    const suppressed = await dt.waitForSuppressed(page, { downtimeId: down.id, sinceUs: t0 - 60 * dt.MICROS, timeoutMs: 240_000 });
    expect(suppressed.some((h) => h.alert_name === x.name)).toBe(true);
    expect(suppressed.some((h) => h.alert_name === y.name)).toBe(false);
    const yDelivered = await dt.waitForCount(page, () => dt.alertSinkCount(page, shared.sink, y.name, t0), (c) => c >= 1, { timeoutMs: 180_000 });
    expect(yDelivered, 'the control check keeps notifying').toBeGreaterThanOrEqual(1);
    const xSamples = await dt.sampleCountOver(page, () => dt.alertSinkCount(page, shared.sink, x.name, t0 + 5 * dt.MICROS));
    expect(xSamples.every((c) => c === 0), `the suppressed check must not notify: ${xSamples}`).toBe(true);
  });
});
