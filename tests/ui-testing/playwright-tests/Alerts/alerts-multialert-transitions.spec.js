// Copyright 2026 OpenObserve Inc.

/**
 * Alerts 4.0 (multi-alerts) — level-change history  [P0]
 *
 * Proves that a multi-level alert records each level change durably. A two-tier
 * alert (warning >= 2, critical >= 5) is driven up the ladder: three rows put it
 * in the warning band, three more push it into critical. The scheduler must
 * record both steps in the level-transition history (Ok -> Warning, then
 * Warning -> Critical) — the data behind the detail page's "Level changes" view.
 *
 * Pure API. Shared plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, simpleAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
  ingest, getAlertTransitions, waitForAlertLevel,
} = require('../utils/alerts-api-helpers.js');

/** Fastest scheduler cadence so level changes show up in ~1 min instead of a 10-minute cycle. */
function fastEval(alert, stream) {
  alert.stream_name = stream;
  alert.trigger_condition.frequency = 1;
  alert.trigger_condition.period = 5;
  alert.trigger_condition.silence = 1;
  return alert;
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ i }));

test.describe('Alerts 4.0 — level-change history', {
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

  test('level transitions are recorded as the count climbs from warning into critical', async ({ page }) => {
    test.setTimeout(240000);
    const stream = uniq('alerts_txn');
    const name = uniq('txn_incr');

    // A two-tier alert on a fresh stream, seeded with just enough to breach warning first.
    const a = fastEval(simpleAlert(name), stream);
    a.trigger_condition.threshold = 5;
    a.trigger_condition.warning_threshold = 2;
    a.trigger_condition.notify_on_warning = true;
    await ingest(page, stream, rows(3)); // count 3 -> warning band (>= 2, < 5)
    expect((await createAlert(page, a)).status(), 'alert saves').toBe(200);
    const id = await findAlertId(page, name);
    created.push(id);

    // Step 1: it settles into the warning band (Ok -> Warning).
    const atWarning = await waitForAlertLevel(page, name, 'warning', { timeoutMs: 60000 });
    expect(atWarning, 'the alert is evaluated within the poll window').toBeTruthy();
    expect(atWarning.level, 'a count of 3 sits in the warning band (>= 2, < 5)').toBe('warning');

    // Step 2: push the count into critical (Warning -> Critical).
    await ingest(page, stream, rows(3)); // count 6 -> critical band (>= 5)
    const atCritical = await waitForAlertLevel(page, name, 'critical', { timeoutMs: 120000 });
    expect(atCritical, 'the level advances once the critical threshold is crossed').toBeTruthy();
    expect(atCritical.level, 'a count of 6 crosses the critical threshold (>= 5)').toBe('critical');

    // Both level changes must be durably recorded as transitions (newest first).
    const txns = await getAlertTransitions(page, id);
    const toWarning = txns.list.find((t) => t.to_level === 'warning');
    const toCritical = txns.list.find((t) => t.to_level === 'critical');
    expect(toWarning, 'the first breach records a transition into warning').toBeTruthy();
    expect(toWarning.from_level ?? null, 'the alert has no prior level before its first breach').toBeNull();
    expect(toCritical, 'the climb into critical records a second transition').toBeTruthy();
    expect(toCritical.from_level, 'the increment steps up from warning, not from ok/none').toBe('warning');
  });
});
