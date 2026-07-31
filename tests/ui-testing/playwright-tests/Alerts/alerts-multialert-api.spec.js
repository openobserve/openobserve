// Copyright 2026 OpenObserve Inc.

/**
 * Alerts 4.0 (multi-alerts) — API contract & save-time guardrails  [P0]
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The multi-alert feature travels through four hand-maintained mappings
 * (form -> payload -> API request -> domain Alert -> DB, and back), and its
 * safety rests on a set of save-time validations that MUST reject bad configs.
 * This suite asserts the raw API contract directly, so a silently-dropped flag
 * or a disabled guard fails here even when the UI still "looks" right.
 *
 * Coverage: MA-03/04/05/06 (save validation), THR-03 (threshold matrix),
 * PT-06 (tag validation), API-01/02 (round-trip + type contract),
 * API-06/07 (group endpoints reachable — the B1 RBAC regression guard),
 * PT-10/13 (priority filter + tag facet).
 *
 * Pure API — no page navigation. Auth via getAuthHeaders() (Basic).
 * Shared plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, urls, api, simpleAlert, multiAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

test.describe('Alerts 4.0 — multi-alert API contract & guardrails', {
  tag: ['@alerts', '@alerts-multialert', '@P0', '@smoke'],
}, () => {
  /** alert_ids created by a test, cleaned up after it. */
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = [];
    await seedAlertFixtures(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
  });

  // ── Save-time guardrails: a multi-alert opt-in is rejected unless it is the
  //    provably-equivalent "any breaching group" shape (M-10) and not combined
  //    with incident creation (MN-11). Each must 400, never silently accept. ──
  const badMulti = [
    ['MA-05 rejects creates_incident', (a) => { a.creates_incident = true; }],
    ['MA-03 rejects a group-count threshold > 1', (a) => { a.trigger_condition.threshold = 3; }],
    ['MA-04 rejects an empty group_by', (a) => { a.query_condition.aggregation.group_by = []; }],
    ['MA-06 rejects an unordered operator (=)', (a) => { a.query_condition.aggregation.having.operator = '='; }],
  ];
  for (const [title, mutate] of badMulti) {
    test(`multi-alert save validation — ${title}`, async ({ page }) => {
      const a = multiAlert(uniq('p0_badmulti'));
      mutate(a);
      const resp = await createAlert(page, a);
      expect(resp.status(), await resp.text()).toBe(400);
    });
  }

  test('THR-03 threshold matrix — warning not less severe than critical is rejected', async ({ page }) => {
    const a = simpleAlert(uniq('p0_badwarn'));
    a.trigger_condition.operator = '>';
    a.trigger_condition.threshold = 5;      // critical
    a.trigger_condition.warning_threshold = 10; // warning >= critical for '>' is invalid
    a.trigger_condition.notify_on_warning = true;
    const resp = await createAlert(page, a);
    expect(resp.status(), await resp.text()).toBe(400);
  });

  test('PT-06 tag validation — a tag that does not start with a letter is rejected', async ({ page }) => {
    const a = simpleAlert(uniq('p0_badtag'));
    a.tags = ['1prod'];
    const resp = await createAlert(page, a);
    expect(resp.status(), await resp.text()).toBe(400);
  });

  test('API-01/02 — a valid multi-alert round-trips and its group endpoints are authorized (B1 regression)', async ({ page }) => {
    const name = uniq('p0_multi');
    const resp = await createAlert(page, multiAlert(name));
    expect(resp.status(), await resp.text()).toBe(200);

    const id = await findAlertId(page, name);
    expect(id, 'created multi-alert must be listable').toBeTruthy();
    created.push(id);

    const { v2 } = urls();
    // Type contract survives the four mappings — the opt-in flag is not dropped.
    const detail = await (await api(page, 'get', `${v2}/alerts/${id}`)).json();
    expect(detail.query_condition.aggregation.multi_alert).toBe(true);
    expect(detail.query_condition.aggregation.group_by).toContain('city');
    expect(detail.query_condition.aggregation.having.operator).toBe('>');

    // B1 regression guard: the two new group routes returned 403 for a non-admin
    // before the RBAC fix. They must stay authorized for a user who can read the alert.
    const groups = await api(page, 'get', `${v2}/alerts/${id}/groups`);
    expect(groups.status(), 'group endpoint must not 403 (B1)').toBe(200);
    const gjson = await groups.json();
    expect(Array.isArray(gjson.list)).toBeTruthy();
    expect(gjson).toHaveProperty('group_cap');

    const trans = await api(page, 'get', `${v2}/alerts/${id}/groups/transitions?limit=5`);
    expect(trans.status(), 'group transitions endpoint must not 403 (B1)').toBe(200);
  });

  test('PT-13/PT-10 — tags normalize + dedupe into the facet, and priority filters', async ({ page }) => {
    const name = uniq('p0_tags');
    const a = simpleAlert(name);
    a.priority = 1;
    a.tags = ['  PROD  ', 'Service:Checkout', 'prod']; // messy on purpose: trim/lowercase/dedupe
    const resp = await createAlert(page, a);
    expect(resp.status(), await resp.text()).toBe(200);

    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    const { v2 } = urls();
    // The server is the normalization authority — the facet proves the repair happened.
    const facet = await (await api(page, 'get', `${v2}/alerts/tags`)).json();
    const tags = (Array.isArray(facet) ? facet : []).map((t) => t.tag);
    expect(tags).toContain('prod');             // trimmed + lowercased + deduped
    expect(tags).toContain('service:checkout'); // colon preserved

    const filtered = await (await api(page, 'get', `${v2}/alerts?priority=1&folder=default`)).json();
    expect((filtered.list || []).some((x) => x.name === name), 'priority=1 filter must return the P1 alert').toBeTruthy();
  });
});
