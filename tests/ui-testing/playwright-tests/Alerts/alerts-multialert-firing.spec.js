// Copyright 2026 OpenObserve Inc.

/**
 * Alerts 4.0 (multi-alerts) — firing behaviour  [P0]
 *
 * Proves an alert actually FIRES at the right level (not just that it saves):
 * a critical alert fires critical, a warning alert fires warning, a per-group
 * (multi) alert fires independently for each breaching group, and a grouped
 * alert left in simple mode fires once as a single rollup. Each alert is created,
 * fed data into a fresh stream (so the count is deterministic), and polled until
 * the scheduler records the outcome (~15s).
 *
 * Pure API. Shared plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, simpleAlert, multiAlert, groupedSimpleAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
  ingest, getAlertGroups, waitForAlertOutcome, isFiringOutcome,
} = require('../utils/alerts-api-helpers.js');

/** Fastest scheduler cadence so a firing shows up in ~15s instead of a 10-minute cycle. */
function fastEval(alert, stream) {
  alert.stream_name = stream;
  alert.trigger_condition.frequency = 1;
  alert.trigger_condition.period = 5;
  alert.trigger_condition.silence = 1;
  return alert;
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ i }));
const cityRows = (city, n, latency) => Array.from({ length: n }, () => ({ city, latency }));

test.describe('Alerts 4.0 — firing behaviour', {
  tag: ['@alerts', '@alerts-multialert', '@P0'],
}, () => {
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await seedAlertFixtures(page); // template + destination
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
    created.length = 0;
  });

  test('critical alert fires at critical level when the critical threshold is crossed', async ({ page }) => {
    test.setTimeout(120000);
    const stream = uniq('alerts_fire_crit');
    await ingest(page, stream, rows(6)); // count 6 -> >= 5 critical

    const name = uniq('fire_crit');
    const a = fastEval(simpleAlert(name), stream);
    a.trigger_condition.threshold = 5;
    a.trigger_condition.warning_threshold = 2;
    a.trigger_condition.notify_on_warning = true;
    expect((await createAlert(page, a)).status(), 'alert saves').toBe(200);
    created.push(await findAlertId(page, name));

    const item = await waitForAlertOutcome(page, name);
    expect(item, 'the alert must be evaluated within the poll window').toBeTruthy();
    expect(item.level, 'a count of 6 crosses the critical threshold (>= 5)').toBe('critical');
    expect(isFiringOutcome(item.last_outcome), `outcome "${item.last_outcome}" should be a firing state`).toBeTruthy();
  });

  test('warning alert fires at warning level when only the warning threshold is crossed', async ({ page }) => {
    test.setTimeout(120000);
    const stream = uniq('alerts_fire_warn');
    await ingest(page, stream, rows(3)); // count 3 -> >= 2 warning, < 5 critical

    const name = uniq('fire_warn');
    const a = fastEval(simpleAlert(name), stream);
    a.trigger_condition.threshold = 5;
    a.trigger_condition.warning_threshold = 2;
    a.trigger_condition.notify_on_warning = true;
    expect((await createAlert(page, a)).status(), 'alert saves').toBe(200);
    created.push(await findAlertId(page, name));

    const item = await waitForAlertOutcome(page, name);
    expect(item).toBeTruthy();
    expect(item.level, 'a count of 3 crosses warning (>= 2) but not critical (< 5)').toBe('warning');
    expect(isFiringOutcome(item.last_outcome)).toBeTruthy();
  });

  test('per-group alert fires independently for each breaching group', async ({ page }) => {
    test.setTimeout(120000);
    const stream = uniq('alerts_fire_multi');
    // three cities, each averaging > 500 latency -> three firing groups
    await ingest(page, stream, [...cityRows('bangalore', 2, 900), ...cityRows('mumbai', 2, 900), ...cityRows('delhi', 2, 900)]);

    const name = uniq('fire_multi');
    expect((await createAlert(page, fastEval(multiAlert(name), stream))).status(), 'multi-alert saves').toBe(200);
    const id = await findAlertId(page, name);
    created.push(id);

    const item = await waitForAlertOutcome(page, name);
    expect(item).toBeTruthy();
    expect(item.groups_firing, 'all three groups breached, so three groups fire').toBe(3);

    const groups = await getAlertGroups(page, id);
    expect(groups.list.length, 'a multi-alert tracks one row per group').toBe(3);
  });

  test('grouped alert in simple mode fires once as a single rollup with no per-group rows', async ({ page }) => {
    test.setTimeout(120000);
    const stream = uniq('alerts_fire_simple');
    await ingest(page, stream, [...cityRows('bangalore', 2, 900), ...cityRows('mumbai', 2, 900), ...cityRows('delhi', 2, 900)]);

    const name = uniq('fire_simple');
    expect((await createAlert(page, fastEval(groupedSimpleAlert(name), stream))).status(), 'grouped simple alert saves').toBe(200);
    const id = await findAlertId(page, name);
    created.push(id);

    const item = await waitForAlertOutcome(page, name);
    expect(item).toBeTruthy();
    expect(isFiringOutcome(item.last_outcome), 'the collapsed rollup fires once').toBeTruthy();
    expect(item.groups_firing ?? null, 'a simple alert has no per-group firing count').toBeNull();

    const groups = await getAlertGroups(page, id);
    expect(groups.list.length, 'a simple alert has no per-group rows').toBe(0);
  });
});
