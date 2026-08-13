// Copyright 2026 OpenObserve Inc.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const {
  uniq, urls, api, simpleAlert, realtimeAlert, compositeAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
  validateComposite, getCompositeReferences,
} = require('../utils/alerts-api-helpers.js');

test.describe('Composite alerts — web API contracts', {
  tag: ['@alerts', '@alerts-composite', '@P0'],
}, () => {
  let created = [];

  test.beforeEach(async ({ page }) => {
    created = [];
    await seedAlertFixtures(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, [...created].reverse());
  });

  async function createChild(page, name, mutate = () => {}) {
    const payload = simpleAlert(name);
    mutate(payload);
    const response = await createAlert(page, payload);
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);
    return id;
  }

  async function createComposite(page, name, childIds, overrides = {}) {
    const response = await createAlert(page, compositeAlert(name, childIds, overrides));
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);
    return id;
  }

  test('create/get/list/filter round-trip returns the web DTO without query placeholders', async ({ page }) => {
    const first = await createChild(page, uniq('composite_child_a'));
    const second = await createChild(page, uniq('composite_child_b'));
    const name = uniq('checkout_degraded');
    const id = await createComposite(page, name, [first, second]);
    const { v2 } = urls();

    const detail = await (await api(page, 'get', `${v2}/alerts/${id}?folder=default`)).json();
    expect(detail).toMatchObject({
      id,
      alert_type: 'composite',
      name,
      enabled: false,
      scheduler_job_present: false,
      composite_condition: {
        warning_counts_as_firing: true,
        stale_child_policy: 'use_last_state',
      },
    });
    expect(detail.composite_condition.expression).toContain(`{${first}}`);
    expect(detail.composite_condition.expression).toContain(`{${second}}`);
    expect(detail.children.map((child) => child.alert_id)).toEqual([first, second]);
    expect(detail).not.toHaveProperty('query_condition');
    expect(detail).not.toHaveProperty('stream_name');

    const composites = await (await api(page, 'get', `${v2}/alerts?alert_type=composite&page_size=100`)).json();
    const row = composites.list.find((item) => item.alert_id === id);
    expect(row).toMatchObject({
      alert_type: 'composite',
      condition: null,
      child_count: 2,
    });
    const scheduled = await (await api(page, 'get', `${v2}/alerts?alert_type=scheduled&page_size=100`)).json();
    expect(scheduled.list.some((item) => item.alert_id === id)).toBeFalsy();
  });

  test('validate returns canonical IDs, current diagnostics, and disabled/never-evaluated warnings', async ({ page }) => {
    const disabled = await createChild(page, uniq('composite_disabled'), (payload) => {
      payload.enabled = false;
    });
    const neverEvaluated = await createChild(page, uniq('composite_never'), (payload) => {
      payload.enabled = false;
    });
    const condition = compositeAlert('draft', [disabled, neverEvaluated]).composite_condition;

    const response = await validateComposite(page, {
      composite_condition: condition,
      folder_id: 'default',
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();

    expect(body.valid).toBe(true);
    expect(body.canonical_expression).toContain(`{${disabled}}`);
    expect(body.children.map((child) => child.alert_id)).toEqual([disabled, neverEvaluated]);
    expect(body.children.every((child) => child.enabled === false)).toBe(true);
    expect(body.children.every((child) => child.stale === true)).toBe(true);
    expect(body.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['child_disabled', 'child_never_evaluated']),
    );
  });

  test('references endpoint and delete 409 return visible parents plus only an opaque hidden count', async ({ page }) => {
    const first = await createChild(page, uniq('composite_ref_a'));
    const second = await createChild(page, uniq('composite_ref_b'));
    const parentName = uniq('composite_parent');
    const parent = await createComposite(page, parentName, [first, second]);

    const references = await getCompositeReferences(page, first);
    expect(references.status(), await references.text()).toBe(200);
    expect(await references.json()).toMatchObject({
      references: [expect.objectContaining({ alert_id: parent, name: parentName })],
    });

    const conflict = await api(page, 'delete', `${urls().v2}/alerts/${first}?folder=default`);
    expect(conflict.status()).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe('child_referenced');
    expect(body.references).toEqual([
      expect.objectContaining({ alert_id: parent, name: parentName }),
    ]);
    expect(body).toHaveProperty('hidden_reference_count');
    expect(body).not.toHaveProperty('has_hidden_references');
  });

  const invalidDrafts = [
    ['invalid expression', () => ({ expression: '{bad id} && {also-bad}' }), 400, 'composite_invalid_expression'],
    ['duplicate operand', (ids) => ({ expression: `{${ids[0]}} && {${ids[0]}}` }), 400, 'composite_duplicate_child'],
    ['one child', (ids) => ({ expression: `{${ids[0]}}` }), 400, 'composite_child_count'],
  ];

  for (const [label, expressionFor, status, expectedCode] of invalidDrafts) {
    test(`validate rejects ${label} with a stable error`, async ({ page }) => {
      const first = await createChild(page, uniq('composite_invalid_a'));
      const second = await createChild(page, uniq('composite_invalid_b'));
      const response = await validateComposite(page, {
        composite_condition: {
          ...compositeAlert('draft', [first, second]).composite_condition,
          ...expressionFor([first, second]),
        },
        folder_id: 'default',
      });

      expect(response.status()).toBe(status);
      const body = await response.json();
      expect(body.code).toBe(expectedCode);
      expect(body.message).toBeTruthy();
    });
  }

  test('a readable but ineligible realtime child is distinguished from inaccessible IDs', async ({ page }) => {
    const realtimeName = uniq('composite_realtime');
    const realtimeResponse = await createAlert(page, realtimeAlert(realtimeName));
    expect(realtimeResponse.status(), await realtimeResponse.text()).toBe(200);
    const realtime = await findAlertId(page, realtimeName);
    created.push(realtime);
    const ordinary = await createChild(page, uniq('composite_eligible'));

    const response = await validateComposite(page, {
      composite_condition: compositeAlert('draft', [realtime, ordinary]).composite_condition,
      folder_id: 'default',
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe('child_not_eligible');
  });

  test('a syntactically valid missing ID returns the non-disclosing child-not-accessible schema', async ({ page }) => {
    const ordinary = await createChild(page, uniq('composite_accessible'));
    const missing = `${ordinary.slice(0, -1)}${ordinary.endsWith('A') ? 'B' : 'A'}`;
    const response = await validateComposite(page, {
      composite_condition: compositeAlert('draft', [ordinary, missing]).composite_condition,
      folder_id: 'default',
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'child_not_accessible' });
    expect(body).not.toHaveProperty('child_type');
    expect(body).not.toHaveProperty('child_name');
  });
});
