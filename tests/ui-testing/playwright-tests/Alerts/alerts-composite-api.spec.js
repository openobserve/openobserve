// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts — API contract (plan area J).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The composite UI is a thin renderer over three endpoints: `composites/validate`
 * drives the live preview, `composite-references` drives the references drawer,
 * and the delete conflict is the only thing standing between a user and a
 * composite whose children have silently vanished.
 *
 * Asserting those contracts through the DOM is slow and conflates two failure
 * modes — a render bug and a contract change look identical from a screenshot.
 * These run headless against the live API so a backend change breaks here,
 * loudly, before any UI spec starts flaking.
 *
 * The integrity cases (J8-J11) are the reason this file leads the suite: nothing
 * in the UI prevents a user from building a self-referencing or cyclic composite,
 * so the backend refusing them is the only guard that exists.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, urls, api, compositeAlert, createAlert, getAlert,
  validateComposite, getCompositeReferences, getCompositeTimeline,
  createChildAlerts, createCompositeAlert, listAlerts,
  deleteAlertsCascade, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

const STALE_POLICY = 'use_last_state';

/** The condition block the validate endpoint expects, with sane defaults. */
const condition = (expression) => ({
  expression,
  warning_counts_as_firing: true,
  stale_child_policy: STALE_POLICY,
});

const validateExpr = (page, expression) =>
  validateComposite(page, { composite_condition: condition(expression), folder_id: 'default' });

test.describe('Composite alerts — API contract', {
  tag: ['@alerts', '@alerts-composite', '@api', '@P0'],
}, () => {
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = [];
    await seedAlertFixturesOnce(page);
  });

  test.afterEach(async ({ page }) => {
    const leaked = await deleteAlertsCascade(page, created);
    expect(leaked, `fixtures left behind: ${leaked.join(', ')}`).toEqual([]);
  });

  /** Two plain children plus a composite over them — the baseline fixture. */
  async function seedPair(page, prefix) {
    const [a, b] = await createChildAlerts(page, prefix, 2);
    created.push(a.id, b.id);
    return { a, b };
  }

  async function seedComposite(page, prefix) {
    const { a, b } = await seedPair(page, prefix);
    const parent = await createCompositeAlert(page, uniq(`${prefix}_parent`), [a.id, b.id]);
    expect(parent.response.status(), await parent.response.text()).toBe(200);
    created.push(parent.id);
    return { a, b, parent };
  }

  // ===================== validate =====================

  test('J1 · validate rejects an empty expression', async ({ page }) => {
    const response = await validateExpr(page, '');
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe('composite_invalid_expression');
  });

  test('J2 · validate rejects fewer than two children', async ({ page }) => {
    const { a } = await seedPair(page, 'j2');
    const response = await validateExpr(page, `{${a.id}}`);
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('composite_invalid_expression');
    expect(body.message).toMatch(/at least 2 children/i);
  });

  test('J3 · validate rejects a malformed expression', async ({ page }) => {
    const { a, b } = await seedPair(page, 'j3');
    for (const expression of [
      `{${a.id}} && `,
      `{${a.id}} && ({${b.id}}`,
      `{${a.id}} &&& {${b.id}}`,
    ]) {
      const response = await validateExpr(page, expression);
      expect(response.status(), `expected 400 for "${expression}"`).toBe(400);
      expect((await response.json()).code).toBe('composite_invalid_expression');
    }
  });

  test('J4 · validate accepts a composite nested inside a composite', async ({ page }) => {
    const { b, parent } = await seedComposite(page, 'j4');
    const response = await validateExpr(page, `{${parent.id}} && {${b.id}}`);
    expect(response.status(), await response.text()).toBe(200);

    const body = await response.json();
    expect(body.valid).toBe(true);
    expect(body.canonical_expression).toContain(parent.id);
    const nested = body.children.find((child) => child.alert_id === parent.id);
    expect(nested.alert_type).toBe('composite');
  });

  test('J4b · validate reports child state the preview renders from', async ({ page }) => {
    const { a, b } = await seedPair(page, 'j4b');
    const response = await validateExpr(page, `{${a.id}} && {${b.id}}`);
    expect(response.status(), await response.text()).toBe(200);

    const body = await response.json();
    expect(body.valid).toBe(true);
    expect(body).toMatchObject({ result: expect.any(Boolean) });
    expect(body.children).toHaveLength(2);
    for (const child of body.children) {
      // The preview keys every row off these — a rename breaks the render silently.
      expect(child).toMatchObject({
        alert_id: expect.any(String),
        accessible: true,
        name: expect.any(String),
        enabled: expect.any(Boolean),
        truth: expect.any(Boolean),
      });
    }
    // Warnings are keyed by code and (optionally) by child, and the preview
    // renders known codes as prose and unknown ones verbatim. WHICH code comes
    // back is timing-dependent — a fresh alert is `child_never_evaluated` only
    // until the scheduler reaches it — so this pins the shape, not the verdict.
    for (const warning of body.warnings) {
      expect(warning.code).toEqual(expect.any(String));
      if (warning.child_alert_id) {
        expect(body.children.map((c) => c.alert_id)).toContain(warning.child_alert_id);
      }
    }
  });

  // ===================== references & delete conflict =====================

  test('J5 · deleting a referenced child is refused with its parent list', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'j5');

    const response = await api(page, 'delete', `${urls().v2}/alerts/${a.id}?folder=default`);
    expect(response.status()).toBe(409);

    const body = await response.json();
    expect(body.code).toBe('child_referenced');
    expect(body.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ alert_id: parent.id, name: parent.name })]),
    );

    // The refusal has to be total — a partially deleted child is worse than none.
    expect(await listAlerts(page)).toEqual(
      expect.arrayContaining([expect.objectContaining({ alert_id: a.id })]),
    );
  });

  test('J6 · references endpoint returns parents and a hidden count', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'j6');

    const response = await getCompositeReferences(page, a.id);
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.references).toEqual([
      expect.objectContaining({ alert_id: parent.id, name: parent.name, folder_id: 'default' }),
    ]);
    expect(body.hidden_reference_count).toBe(0);

    // An unreferenced alert reports empty, not an error.
    const orphan = await getCompositeReferences(page, b.id);
    expect((await orphan.json()).references).toHaveLength(1);

    const parentRefs = await getCompositeReferences(page, parent.id);
    expect((await parentRefs.json()).references).toHaveLength(0);
  });

  test('J7 · list carries child_count and referenced_by_composite_count', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'j7');
    const rows = await listAlerts(page);

    const parentRow = rows.find((r) => r.alert_id === parent.id);
    expect(parentRow.alert_type).toBe('composite');
    expect(parentRow.child_count).toBe(2);

    // The field the alert list drops on the floor (o2-enterprise#2619).
    const childRow = rows.find((r) => r.alert_id === a.id);
    expect(childRow.referenced_by_composite_count).toBe(1);
  });

  // ===================== integrity guards =====================

  test('J8 · a composite referencing itself is rejected', async ({ page }) => {
    const { b, parent } = await seedComposite(page, 'j8');

    // Self-reference is only expressible on update — on create there is no id yet.
    const current = await getAlert(page, parent.id);
    const response = await api(page, 'put', `${urls().v2}/alerts/${parent.id}?folder=default`, {
      ...current,
      composite_condition: condition(`{${parent.id}} && {${b.id}}`),
    });

    expect(response.status(), `self-reference accepted: ${await response.text()}`)
      .toBeGreaterThanOrEqual(400);
  });

  test('J9 · an A-to-B-to-A cycle is rejected', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'j9');

    const outer = await createCompositeAlert(page, uniq('j9_outer'), [parent.id, a.id]);
    expect(outer.response.status(), await outer.response.text()).toBe(200);
    created.push(outer.id);

    // Close the loop: the inner composite now points back at the outer one.
    const current = await getAlert(page, parent.id);
    const response = await api(page, 'put', `${urls().v2}/alerts/${parent.id}?folder=default`, {
      ...current,
      composite_condition: condition(`{${outer.id}} && {${b.id}}`),
    });

    expect(response.status(), `cycle accepted: ${await response.text()}`)
      .toBeGreaterThanOrEqual(400);
  });

  test('J11 · more than ten children is rejected server-side', async ({ page }) => {
    const children = await createChildAlerts(page, 'j11', 11);
    created.push(...children.map((c) => c.id));

    const expression = children.map((c) => `{${c.id}}`).join(' && ');
    const validation = await validateExpr(page, expression);
    expect(validation.status(), `11 children validated: ${await validation.text()}`).toBe(400);

    // The cap must hold on the write path too, not only on validate.
    const response = await createAlert(
      page,
      compositeAlert(uniq('j11_over_cap'), children.map((c) => c.id)),
    );
    expect(response.status(), `11 children saved: ${await response.text()}`)
      .toBeGreaterThanOrEqual(400);
  });

  // ===================== timeline =====================

  test('J12 · timeline returns child lanes plus a result lane', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'j12');

    const to = Date.now() * 1000;
    const from = to - 14_400_000_000;
    const response = await getCompositeTimeline(page, parent.id, from, to);
    expect(response.status(), await response.text()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ from: expect.any(Number), to: expect.any(Number) });
    expect(body.children.map((lane) => lane.alert_id).sort()).toEqual([a.id, b.id].sort());
    expect(body.result).toBeTruthy();
    expect(body.result.alert_id).toBe(parent.id);
  });
});
