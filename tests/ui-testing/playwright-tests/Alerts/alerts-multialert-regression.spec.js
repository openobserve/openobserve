// Copyright 2026 OpenObserve Inc.

/**
 * Alerts 4.0 (multi-alerts) — no-regression guards  [P0]
 *
 * The prime directive of this revamp is "zero behaviour change for existing
 * alerts": every new field is opt-in, and nothing is inferred from an existing
 * alert's shape. These tests assert exactly that — a legacy alert round-trips
 * untouched, a grouped alert stays simple until its author flips the flag, and
 * realtime alerts keep their exact current contract (no warning family, no
 * persisted run-state).
 *
 * Coverage: REG-01 (legacy round-trip), REG-02 (grouped stays simple),
 * REG-07/THR-08 (realtime rejects the warning family),
 * OUT-08/INV-6 (realtime persists no run-state; priority/tags still allowed).
 *
 * Pure API — no page navigation. Auth via getAuthHeaders() (Basic).
 * Shared plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, urls, api, simpleAlert, groupedSimpleAlert, realtimeAlert,
  createAlert, listAlerts, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

test.describe('Alerts 4.0 — no-regression guards', {
  tag: ['@alerts', '@alerts-multialert-regression', '@P0', '@smoke'],
}, () => {
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = [];
    await seedAlertFixtures(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
  });

  test('REG-01 — a legacy simple alert round-trips with no opt-in field injected', async ({ page }) => {
    const name = uniq('reg_legacy');
    const resp = await createAlert(page, simpleAlert(name));
    expect(resp.status(), await resp.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    const a = await (await api(page, 'get', `${urls().v2}/alerts/${id}`)).json();
    expect(a.query_condition.aggregation, 'no aggregation/multi inferred').toBeFalsy();
    expect(a.priority ?? null, 'priority must not be injected').toBeNull();
    expect((a.tags || []).length, 'tags must not be injected').toBe(0);
    expect(a.trigger_condition.warning_threshold ?? null, 'warning threshold must not be injected').toBeNull();
  });

  test('REG-02 — a grouped alert without multi_alert stays simple (nothing inferred from group_by)', async ({ page }) => {
    const name = uniq('reg_grouped');
    const resp = await createAlert(page, groupedSimpleAlert(name));
    expect(resp.status(), await resp.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    const a = await (await api(page, 'get', `${urls().v2}/alerts/${id}`)).json();
    expect(a.query_condition.aggregation.group_by, 'group_by is preserved').toContain('city');
    // The opt-in flag must NOT turn on merely because a group_by exists.
    expect(a.query_condition.aggregation.multi_alert ?? false, 'multi_alert must stay off').toBeFalsy();
  });

  test('REG-07/THR-08 — realtime alerts reject the warning family', async ({ page }) => {
    const a = realtimeAlert(uniq('reg_rt_warn'));
    a.trigger_condition.warning_threshold = 2;
    a.trigger_condition.notify_on_warning = true;
    const resp = await createAlert(page, a);
    const body = await resp.text();
    expect(resp.status(), body).toBe(400);
    expect(body.toLowerCase(), 'the error should name real-time as the reason').toContain('real-time');
  });

  test('OUT-08/INV-6 — a realtime alert persists no run-state, but still carries priority', async ({ page }) => {
    const name = uniq('reg_rt');
    const a = realtimeAlert(name);
    a.priority = 2; // inert metadata IS allowed on realtime (PT-01)
    const resp = await createAlert(page, a);
    expect(resp.status(), await resp.text()).toBe(200);
    const item = (await listAlerts(page)).find((x) => x.name === name);
    expect(item, 'the realtime alert must be listable').toBeTruthy();
    created.push(item.alert_id);

    expect(item.last_outcome ?? null, 'realtime persists no run outcome').toBeNull();
    expect(item.level ?? null, 'realtime persists no level').toBeNull();
    expect(item.priority, 'priority is allowed on realtime as inert metadata').toBe(2);
  });
});
