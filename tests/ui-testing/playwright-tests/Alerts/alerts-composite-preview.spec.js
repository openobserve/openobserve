// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts — live preview (plan area D).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The preview is the only place a user learns that a composite they are about
 * to save will not behave as it reads: a child that is disabled, has never been
 * evaluated, or whose last state is stale all produce an expression that is
 * syntactically perfect and operationally wrong.
 *
 * MOCKING POLICY
 * --------------
 * The validate CONTRACT is asserted live in alerts-composite-api.spec.js. This
 * file asserts the RENDER, and mocks only the states that cannot be HELD long
 * enough to drive a form: staleness needs a freshness deadline to pass, a
 * validation outage needs a server that is down, and "never evaluated" survives
 * only until the scheduler reaches the child — seconds, on a live env.
 *
 * A disabled child IS stable, so D3 runs fully live. The two files never mock
 * the same side of the same assertion.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, simpleAlert, createAlert, findAlertId, createChildAlerts,
  deleteAlertsCascade, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

const VALIDATE_ROUTE = '**/alerts/composites/validate';

test.describe('Composite alerts — live preview', {
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

  async function disabledChild(page, prefix) {
    const name = uniq(prefix);
    await createAlert(page, { ...simpleAlert(name), enabled: false });
    const id = await findAlertId(page, name);
    created.push(id);
    return { id, name };
  }

  async function openBuilderWith(page, picks) {
    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    for (const child of picks) await pm.compositeAlertsPage.addChildById(child);
  }

  /** A validate response shaped like the server's, with `children` overridden. */
  const validationBody = (expression, kids, extra = {}) => ({
    valid: true,
    canonical_expression: expression,
    result: false,
    result_level: 'ok',
    warnings: [],
    errors: [],
    children: kids,
    ...extra,
  });

  test('D1/D5/D6 · a valid draft renders a verdict and a step per operand', async ({ page }) => {
    const [a, b] = await children(page, 'd1', 2);
    await openBuilderWith(page, [a, b]);

    await expect(pm.compositeAlertsPage.preview()).toBeVisible();
    await expect(pm.compositeAlertsPage.previewResult()).toBeVisible();
    await expect(pm.compositeAlertsPage.previewResult()).toHaveAttribute('aria-live', 'polite');

    // One step per operand plus the result row.
    const steps = pm.compositeAlertsPage.previewStepRows();
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText(a.name);
    await expect(steps.nth(1)).toContainText(b.name);
    await expect(steps.nth(2)).toContainText('A && B');
  });

  test('D2 · a never-evaluated child raises its warning', async ({ page }) => {
    const [a, b] = await children(page, 'd2', 2);

    // Mocked, not live: a fresh alert IS never-evaluated, but only until the
    // scheduler reaches it — on this env that is a few seconds, well inside the
    // time it takes to drive the form. Asserting it live races the scheduler and
    // loses. The contract that the server emits this code lives in
    // alerts-composite-api.spec.js (J4b).
    await page.route(VALIDATE_ROUTE, async (route) => {
      const expression = `{${a.id}} && {${b.id}}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(validationBody(expression, [
          {
            alert_id: a.id, accessible: true, name: a.name, alert_type: 'scheduled',
            folder_id: 'default', enabled: true, level: null, level_at: null,
            stale: true, truth: false,
          },
          {
            alert_id: b.id, accessible: true, name: b.name, alert_type: 'scheduled',
            folder_id: 'default', enabled: true, level: 'ok', stale: false, truth: false,
          },
        ], {
          warnings: [{ code: 'child_never_evaluated', child_alert_id: a.id }],
        })),
      });
    });

    await openBuilderWith(page, [a, b]);

    await expect(pm.compositeAlertsPage.previewWarning('child_never_evaluated')).toBeVisible();
  });

  test('D3 · a disabled child raises its warning', async ({ page }) => {
    const [a] = await children(page, 'd3', 1);
    const off = await disabledChild(page, 'd3_disabled');
    await openBuilderWith(page, [a, off]);

    await expect(pm.compositeAlertsPage.previewWarning('child_disabled')).toBeVisible();
  });

  test('D4 · a stale child under use-last-state names the child and the level it kept', async ({ page }) => {
    const [a, b] = await children(page, 'd4', 2);

    await page.route(VALIDATE_ROUTE, async (route) => {
      const expression = `{${a.id}} && {${b.id}}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(validationBody(expression, [
          {
            alert_id: a.id, accessible: true, name: a.name, alert_type: 'scheduled',
            folder_id: 'default', enabled: true, level: 'critical', stale: true, truth: true,
            stale_reason: 'freshness_expired', policy_decision: 'used_last_state',
          },
          {
            alert_id: b.id, accessible: true, name: b.name, alert_type: 'scheduled',
            folder_id: 'default', enabled: true, level: 'ok', stale: false, truth: false,
          },
        ])),
      });
    });

    await openBuilderWith(page, [a, b]);

    const banner = pm.compositeAlertsPage.previewStale(a.id);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(a.name);
    await expect(banner).toContainText(/critical/i);
  });

  test('D7 · a validation failure surfaces as an error banner', async ({ page }) => {
    const [a, b] = await children(page, 'd7', 2);

    await page.route(VALIDATE_ROUTE, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'validation_unavailable' }),
      });
    });

    await openBuilderWith(page, [a, b]);

    // The component turns a thrown request into a synthetic invalid preview
    // rather than leaving the last good result on screen.
    await expect(pm.compositeAlertsPage.previewError('validation_unavailable')).toBeVisible();
    await expect(pm.compositeAlertsPage.save()).toBeDisabled();
  });

  test('D8 · a slow validation never overwrites a newer one', async ({ page }) => {
    const [a, b, c] = await children(page, 'd8', 3);
    let seen = 0;

    await page.route(VALIDATE_ROUTE, async (route) => {
      seen += 1;
      const mine = seen;
      const body = validationBody(`{${a.id}} && {${b.id}}`, [
        {
          alert_id: a.id, accessible: true, name: a.name, alert_type: 'scheduled',
          folder_id: 'default', enabled: true, level: 'ok', stale: false, truth: false,
        },
        {
          alert_id: b.id, accessible: true, name: b.name, alert_type: 'scheduled',
          folder_id: 'default', enabled: true, level: 'ok', stale: false, truth: false,
        },
      ], {
        // The FIRST response is slow and claims the draft is invalid. If the
        // component applied responses in arrival order it would clobber the
        // newer, valid result and wrongly disable Save.
        valid: mine !== 1,
        errors: mine === 1 ? [{ code: 'stale_response_should_be_ignored' }] : [],
      });
      if (mine === 1) await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await openBuilderWith(page, [a, b]);
    // Force a second validation while the first is still in flight.
    await pm.compositeAlertsPage.addChildById(c);
    await pm.compositeAlertsPage.fillExpression('A && B');

    await expect.poll(() => seen, { timeout: 30000 }).toBeGreaterThan(1);
    await expect(pm.compositeAlertsPage.previewError('stale_response_should_be_ignored'))
      .toHaveCount(0);
  });
});
