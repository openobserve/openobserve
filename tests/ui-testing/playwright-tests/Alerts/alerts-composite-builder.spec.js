// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts — child selector, expression builder, settings
 * (plan areas B, C and E).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The builder keeps TWO representations of the same expression in sync: the
 * lettered form the user types ("A && B") and the `{alert_id}` form that is
 * stored and sent. Slot position is what binds them — index 0 is A — so any
 * change to the child list has to rewrite the expression in lockstep.
 *
 * That rewrite is where the sharp edges are. Removing a child has to drop its
 * operand AND any negation applied to it, then collapse whatever residue that
 * leaves (empty groups, dangling operators); removing from the backend's nested
 * canonical form can leave the parens unbalanced, in which case the component
 * deliberately falls back to a flat AND join rather than block Save on an
 * expression the user never typed.
 *
 * None of that is observable from a unit test of the helper alone, because the
 * fallback only triggers on shapes the SERVER produces. These drive the real
 * form against real saved alerts.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, createChildAlerts, createCompositeAlert,
  deleteAlertsCascade, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

test.describe('Composite alerts — builder', {
  tag: ['@alerts', '@alerts-composite', '@P0'],
}, () => {
  let pm;
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    created = [];
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlertsCascade(page, created);
  });

  async function children(page, prefix, count) {
    const made = await createChildAlerts(page, prefix, count);
    created.push(...made.map((c) => c.id));
    return made;
  }

  /** Open the wizard in composite mode with `ids` already in slots A, B, … */
  async function openBuilderWith(page, ids) {
    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    for (const id of ids) await pm.compositeAlertsPage.addChildById(id);
  }

  // ===================== B · child selector =====================

  test('B1/B2 · composite type tab is offered and starts with an empty slot list', async ({ page }) => {
    await pm.compositeAlertsPage.openCreate();
    await expect(pm.compositeAlertsPage.typeTab()).toBeVisible();

    await pm.compositeAlertsPage.chooseCompositeType();
    await expect(pm.compositeAlertsPage.childEmpty()).toBeVisible();
    await expect(pm.compositeAlertsPage.childCap()).toContainText('0');
    // Two children are the minimum, so an empty form can never be saved.
    await expect(pm.compositeAlertsPage.save()).toBeDisabled();
  });

  test('B3/B4 · adding children fills lettered slots in order', async ({ page }) => {
    const [a, b] = await children(page, 'b3', 2);
    await openBuilderWith(page, [a.id, b.id]);

    await expect(pm.compositeAlertsPage.selectedChild(a.id)).toContainText('A');
    await expect(pm.compositeAlertsPage.selectedChild(b.id)).toContainText('B');
    await expect(pm.compositeAlertsPage.childEmpty()).toHaveCount(0);
    await expect(pm.compositeAlertsPage.childCap()).toContainText('2');
  });

  test('B6 · a slot never offers a child that is already selected elsewhere', async ({ page }) => {
    const [a, b, c] = await children(page, 'b6', 3);
    await openBuilderWith(page, [a.id, b.id]);

    const options = await pm.compositeAlertsPage.optionIdsFor(a.id);
    expect(options).toContain(a.id); // its own value stays selectable
    expect(options).toContain(c.id);
    expect(options).not.toContain(b.id);
  });

  test('B7 · replacing a child keeps the slot position and its letter', async ({ page }) => {
    const [a, b, c] = await children(page, 'b7', 3);
    await openBuilderWith(page, [a.id, b.id]);

    await pm.compositeAlertsPage.replaceChild(a.id, c.id);

    await expect(pm.compositeAlertsPage.selectedChild(c.id)).toContainText('A');
    await expect(pm.compositeAlertsPage.selectedChild(b.id)).toContainText('B');
    await expect(pm.compositeAlertsPage.selectedChild(a.id)).toHaveCount(0);
    // Slot A still reads as A in the expression, so the lettering is unchanged.
    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/A.*B/);
  });

  test('B5 · the cap stops at ten children', async ({ page }) => {
    const made = await children(page, 'b5', 11);
    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();

    for (let i = 0; i < 10; i += 1) await pm.compositeAlertsPage.addChild();

    await expect(pm.compositeAlertsPage.childCap()).toContainText('10');
    await expect(pm.compositeAlertsPage.selectedChildRows()).toHaveCount(10);
    await expect(pm.compositeAlertsPage.childAdd()).toBeDisabled();
    expect(made).toHaveLength(11); // an eleventh exists and still cannot be added
  });

  test('B8 · removing a child also removes its operand from the expression', async ({ page }) => {
    const [a, b, c] = await children(page, 'b8', 3);
    await openBuilderWith(page, [a.id, b.id, c.id]);
    await pm.compositeAlertsPage.fillExpression('A && B && C');

    await pm.compositeAlertsPage.removeChild(b.id);

    // B is gone and C has been relettered into the freed slot.
    const expression = await pm.compositeAlertsPage.expressionInput().inputValue();
    expect(expression).toMatch(/^\s*A\s*&&\s*B\s*$/);
    await expect(pm.compositeAlertsPage.selectedChild(c.id)).toContainText('B');
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
  });

  test('B9 · removing a negated operand drops the NOT with it', async ({ page }) => {
    const [a, b, c] = await children(page, 'b9', 3);
    await openBuilderWith(page, [a.id, b.id, c.id]);
    await pm.compositeAlertsPage.fillExpression('A && !B && C');

    await pm.compositeAlertsPage.removeChild(b.id);

    // A dangling "!" would make the draft unparseable and block Save.
    const expression = await pm.compositeAlertsPage.expressionInput().inputValue();
    expect(expression).not.toContain('!');
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
  });

  // ===================== C · expression builder =====================

  test('C1 · two children auto-apply the default AND expression', async ({ page }) => {
    const [a, b] = await children(page, 'c1', 2);
    await openBuilderWith(page, [a.id, b.id]);

    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/A\s*&&\s*B/);
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
    await expect(pm.compositeAlertsPage.expressionLive()).toBeVisible();
  });

  test('C3/C4 · palette buttons append operators and operands', async ({ page }) => {
    const [a, b] = await children(page, 'c3', 2);
    await openBuilderWith(page, [a.id, b.id]);
    await pm.compositeAlertsPage.fillExpression('');

    await pm.compositeAlertsPage.expressionInsert(a.id).click();
    await pm.compositeAlertsPage.expressionOr().click();
    await pm.compositeAlertsPage.expressionNot().click();
    await pm.compositeAlertsPage.expressionInsert(b.id).click();

    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue('A || ! B');
  });

  test('C3b · group buttons append parentheses', async ({ page }) => {
    const [a, b, c] = await children(page, 'c3b', 3);
    await openBuilderWith(page, [a.id, b.id, c.id]);
    await pm.compositeAlertsPage.fillExpression('A &&');

    await pm.compositeAlertsPage.expressionOpenGroup().click();
    await pm.compositeAlertsPage.expressionInsert(b.id).click();
    await pm.compositeAlertsPage.expressionOr().click();
    await pm.compositeAlertsPage.expressionInsert(c.id).click();
    await pm.compositeAlertsPage.expressionCloseGroup().click();

    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue('A && ( B || C )');
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
  });

  test('C5 · the lettered form round-trips to the stored id form', async ({ page }) => {
    const [a, b] = await children(page, 'c5', 2);
    await openBuilderWith(page, [a.id, b.id]);
    await pm.compositeAlertsPage.fillExpression('B || A');

    await pm.compositeAlertsPage.openAdvanced();

    // The advanced textarea is the same expression in `{id}` form, operands in
    // the order typed — proof the letters are bound to slots, not to sort order.
    const raw = await pm.compositeAlertsPage.advancedField().inputValue();
    expect(raw).toBe(`{${b.id}} || {${a.id}}`);
  });

  test('C6 · editing the advanced form updates the lettered form', async ({ page }) => {
    const [a, b] = await children(page, 'c6', 2);
    await openBuilderWith(page, [a.id, b.id]);

    await pm.compositeAlertsPage.fillAdvancedExpression(`{${a.id}} || {${b.id}}`);

    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/A\s*\|\|\s*B/);
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
  });

  test('C7 · unbalanced parentheses invalidate the draft and disable Save', async ({ page }) => {
    const [a, b] = await children(page, 'c7', 2);
    await openBuilderWith(page, [a.id, b.id]);

    await pm.compositeAlertsPage.fillExpression('( A && B');

    await expect(pm.compositeAlertsPage.expressionError()).toBeVisible();
    await expect(pm.compositeAlertsPage.save()).toBeDisabled();
  });

  test('C8 · an unused child is offered in the tray and places on click', async ({ page }) => {
    const [a, b, c] = await children(page, 'c8', 3);
    await openBuilderWith(page, [a.id, b.id, c.id]);

    await pm.compositeAlertsPage.fillExpression('A && B');

    await expect(pm.compositeAlertsPage.expressionUnused()).toBeVisible();
    await expect(pm.compositeAlertsPage.operandTray(c.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.save()).toBeDisabled();

    await pm.compositeAlertsPage.operandTray(c.id).click();

    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/C/);
    await expect(pm.compositeAlertsPage.expressionUnused()).toHaveCount(0);
  });

  test('C9 · a duplicated operand invalidates the draft', async ({ page }) => {
    const [a, b] = await children(page, 'c9', 2);
    await openBuilderWith(page, [a.id, b.id]);

    await pm.compositeAlertsPage.fillExpression('A && A');

    // B is now unused AND A is used twice; either alone is enough to block Save.
    await expect(pm.compositeAlertsPage.expressionError()).toBeVisible();
    await expect(pm.compositeAlertsPage.save()).toBeDisabled();
  });

  test('C13 · every operator control carries an accessible name', async ({ page }) => {
    const [a, b] = await children(page, 'c13', 2);
    await openBuilderWith(page, [a.id, b.id]);

    for (const control of [
      pm.compositeAlertsPage.expressionAnd(),
      pm.compositeAlertsPage.expressionOr(),
      pm.compositeAlertsPage.expressionNot(),
      pm.compositeAlertsPage.expressionOpenGroup(),
      pm.compositeAlertsPage.expressionCloseGroup(),
      pm.compositeAlertsPage.expressionInsert(a.id),
      pm.compositeAlertsPage.childRemove(b.id),
    ]) {
      await expect(control).toHaveAccessibleName(/.+/);
    }
  });

  // ===================== E · settings =====================

  test('E2/E3 · stale policy offers three options and explains the active one', async ({ page }) => {
    const [a, b] = await children(page, 'e2', 2);
    await openBuilderWith(page, [a.id, b.id]);

    expect(await pm.compositeAlertsPage.stalePolicyValue()).toBe('use_last_state');
    const initialHelp = await pm.compositeAlertsPage.stalePolicyHelp().textContent();

    await pm.compositeAlertsPage.selectStalePolicy('treat_as_false');
    expect(await pm.compositeAlertsPage.stalePolicyValue()).toBe('treat_as_false');
    await expect(pm.compositeAlertsPage.stalePolicyHelp()).not.toHaveText(initialHelp);

    await pm.compositeAlertsPage.selectStalePolicy('treat_as_true');
    expect(await pm.compositeAlertsPage.stalePolicyValue()).toBe('treat_as_true');
  });

  test('E5 · changing a setting re-runs validation against the server', async ({ page }) => {
    const [a, b] = await children(page, 'e5', 2);
    await openBuilderWith(page, [a.id, b.id]);
    await expect(pm.compositeAlertsPage.preview()).toBeVisible();

    const validations = [];
    await page.route('**/alerts/composites/validate', async (route) => {
      validations.push(route.request().postDataJSON());
      await route.continue();
    });

    await pm.compositeAlertsPage.selectStalePolicy('treat_as_true');

    await expect
      .poll(() => validations.at(-1)?.composite_condition?.stale_child_policy)
      .toBe('treat_as_true');
  });

  // ===================== F · edit round-trip =====================

  test('F3 · editing an existing composite reloads its children and expression', async ({ page }) => {
    const [a, b] = await children(page, 'f3', 2);
    const parent = await createCompositeAlert(page, uniq('f3_parent'), [a.id, b.id]);
    created.push(parent.id);

    await pm.compositeAlertsPage.openEdit(parent.id);

    await expect(pm.compositeAlertsPage.selectedChild(a.id)).toContainText('A');
    await expect(pm.compositeAlertsPage.selectedChild(b.id)).toContainText('B');
    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/A\s*&&\s*B/);
    await expect(pm.compositeAlertsPage.expressionError()).toHaveCount(0);
  });

  test('F4 · saving an edit submits operand ids, never display names', async ({ page }) => {
    const [a, b] = await children(page, 'f4', 2);
    const parent = await createCompositeAlert(page, uniq('f4_parent'), [a.id, b.id]);
    created.push(parent.id);

    let submitted;
    await page.route(`**/api/v2/*/alerts/${parent.id}*`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await pm.compositeAlertsPage.openEdit(parent.id);
    await expect(pm.compositeAlertsPage.expressionInput()).toHaveValue(/A\s*&&\s*B/);
    await pm.compositeAlertsPage.save().click();

    await expect.poll(() => submitted).toBeTruthy();
    const expression = submitted.composite_condition.expression;
    expect(expression).toContain(`{${a.id}}`);
    expect(expression).toContain(`{${b.id}}`);
    expect(expression).not.toMatch(/\b[A-J]\b/); // no lettered form leaks to the API
    expect(JSON.stringify(submitted)).not.toContain(a.name);
  });
});
