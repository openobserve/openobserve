// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const {
  uniq, urls, api, simpleAlert, compositeAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

test.describe('Composite alerts — UI scenarios', {
  tag: ['@alerts', '@alerts-composite', '@P0'],
}, () => {
  let pm;
  let created = [];

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    created = [];
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, [...created].reverse());
  });

  async function createChild(page, name, enabled = false) {
    const payload = simpleAlert(name);
    payload.enabled = enabled;
    const response = await createAlert(page, payload);
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);
    return { id, name };
  }

  async function createCompositeFixture(page, children, overrides = {}) {
    const name = uniq('composite_ui');
    const response = await createAlert(
      page,
      compositeAlert(name, children.map((child) => child.id), overrides),
    );
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push(id);
    return { id, name };
  }

  test('list exposes Composite filter, badge, expression, child count, and reference count', async ({ page }) => {
    const first = await createChild(page, uniq('composite_list_a'));
    const second = await createChild(page, uniq('composite_list_b'));
    const childComposite = await createCompositeFixture(page, [first, second]);
    const parent = await createCompositeFixture(page, [
      { id: childComposite.id, name: childComposite.name },
      first,
    ]);

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await page.locator(pm.compositeAlertsPage.locators.listCompositeTab).click();

    await expect(page.locator(pm.compositeAlertsPage.locators.listBadge(parent.id))).toBeVisible();
    await expect(page.locator(pm.compositeAlertsPage.locators.listChildCount(parent.id))).toContainText('2');
    await expect(page.locator(pm.compositeAlertsPage.locators.listReferenceCount(childComposite.id))).toContainText('1');
    await expect(page.getByText(first.name, { exact: false })).toBeVisible();
  });

  test('child search enforces the ten-child cap and does not append to a custom expression', async ({ page }) => {
    const children = [];
    for (let index = 0; index < 11; index += 1) {
      children.push(await createChild(page, uniq(`composite_cap_${index}`)));
    }

    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    for (const child of children.slice(0, 2)) {
      await pm.compositeAlertsPage.searchAndSelect(child.name, child.id);
    }
    await expect(page.locator(pm.compositeAlertsPage.locators.expressionSummary)).toContainText('AND');

    await page.locator(pm.compositeAlertsPage.locators.advancedExpression).fill(
      `{${children[0].id}} || ({${children[1].id}} && !{${children[2].id}})`,
    );
    await expect(page.locator(pm.compositeAlertsPage.locators.expressionSummary)).toContainText(/OR.*\(.*AND.*NOT/s);

    for (const child of children.slice(2, 10)) {
      await pm.compositeAlertsPage.searchAndSelect(child.name, child.id);
    }
    await page.locator(pm.compositeAlertsPage.locators.childSearch).fill(children[10].name);
    await expect(page.locator(pm.compositeAlertsPage.locators.childOption(children[10].id))).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator(pm.compositeAlertsPage.locators.childCap)).toContainText('10');
    await expect(page.locator(pm.compositeAlertsPage.locators.expressionUnused)).toBeVisible();
    await expect(page.locator(pm.compositeAlertsPage.locators.save)).toBeDisabled();
  });

  test('live preview explains Warning, stale use-last-state, disabled, and never evaluated children', async ({ page }) => {
    const children = [];
    for (let index = 0; index < 4; index += 1) {
      children.push(await createChild(page, uniq(`composite_preview_${index}`)));
    }
    await page.route('**/api/v2/*/alerts/composites/validate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          canonical_expression: children.map((child) => `{${child.id}}`).join(' && '),
          result: false,
          result_level: 'ok',
          warnings: [
            { code: 'child_disabled', child_alert_id: children[2].id },
            { code: 'child_never_evaluated', child_alert_id: children[3].id },
          ],
          errors: [],
          children: [
            { alert_id: children[0].id, name: children[0].name, accessible: true, enabled: true, level: 'warning', stale: false, truth: true },
            { alert_id: children[1].id, name: children[1].name, accessible: true, enabled: true, level: 'critical', stale: true, truth: true, stale_reason: 'freshness_expired', policy_decision: 'used_last_state' },
            { alert_id: children[2].id, name: children[2].name, accessible: true, enabled: false, level: 'ok', stale: false, truth: false },
            { alert_id: children[3].id, name: children[3].name, accessible: true, enabled: true, level: null, level_at: null, stale: true, truth: false },
          ],
        }),
      });
    });

    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    for (const child of children) {
      await pm.compositeAlertsPage.searchAndSelect(child.name, child.id);
    }

    await pm.compositeAlertsPage.expectPreviewChild(children[0].id, /warning.*true/i);
    await pm.compositeAlertsPage.expectPreviewChild(children[1].id, /freshness.*expired.*last.*critical/i);
    await pm.compositeAlertsPage.expectPreviewChild(children[2].id, /disabled/i);
    await pm.compositeAlertsPage.expectPreviewChild(children[3].id, /never.*evaluated/i);
  });

  test('edit round-trip displays renamed children but submits the same operand IDs', async ({ page }) => {
    const first = await createChild(page, uniq('composite_identity_a'));
    const second = await createChild(page, uniq('composite_identity_b'));
    const composite = await createCompositeFixture(page, [first, second]);
    let submitted;

    await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
      if (route.request().method() === 'PUT') {
        submitted = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      body.children[0].name = 'Renamed child with a very long display name';
      body.children[0].folder_id = 'moved-folder';
      await route.fulfill({ response, json: body });
    });

    await pm.compositeAlertsPage.openEdit(composite.id);
    await expect(page.getByText('Renamed child with a very long display name')).toBeVisible();
    await page.locator(pm.compositeAlertsPage.locators.save).click();

    await expect.poll(() => submitted).toBeTruthy();
    expect(submitted.composite_condition.expression).toContain(`{${first.id}}`);
    expect(submitted.composite_condition.expression).toContain(`{${second.id}}`);
    expect(JSON.stringify(submitted)).not.toContain('Renamed child with a very long display name');
  });

  test('detail why-firing view shows links, explicit stale policy, and enabled-only job warning', async ({ page }) => {
    const longName = `checkout_${'regional_database_failover_'.repeat(8)}`;
    const first = await createChild(page, longName);
    const second = await createChild(page, uniq('composite_detail_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.enabled = true;
      body.scheduler_job_present = false;
      body.evaluation = { result: true, level: 'critical', evaluated_at: 1786500015000000 };
      body.children[0] = { ...body.children[0], level: 'critical', last_outcome: 'firing', stale: true, truth: true, stale_reason: 'freshness_expired', policy_decision: 'used_last_state' };
      await route.fulfill({ response, json: body });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);
    await expect(page.locator(pm.compositeAlertsPage.locators.detailResult)).toContainText(/critical/i);
    await expect(page.locator(pm.compositeAlertsPage.locators.detailExpression)).toContainText(longName);
    await expect(page.locator(pm.compositeAlertsPage.locators.detailChildren)).toBeVisible();
    await expect(page.locator(pm.compositeAlertsPage.locators.detailChild(first.id))).toContainText(/freshness.*expired.*last.*critical/i);
    await expect(page.locator(pm.compositeAlertsPage.locators.detailChild(first.id)).getByRole('link')).toHaveAttribute('href', new RegExp(first.id));
    await expect(page.locator(pm.compositeAlertsPage.locators.missingJob)).toBeVisible();

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.locator(pm.compositeAlertsPage.locators.detailChildren)).toBeVisible();
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBeTruthy();
  });

  test('reference chip and delete 409 open the same navigable parent list', async ({ page }) => {
    const first = await createChild(page, uniq('composite_delete_a'));
    const second = await createChild(page, uniq('composite_delete_b'));
    const parent = await createCompositeFixture(page, [first, second]);

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await pm.alertsPage.searchAlert(first.name);
    await page.locator(pm.compositeAlertsPage.locators.referenceChip).click();
    await expect(page.locator(pm.compositeAlertsPage.locators.referenceParent(parent.id))).toBeVisible();
    await expect(page.locator('[data-test="alerts-composite-reference-close"]')).toBeFocused();

    await pm.alertsPage.deleteAlertByRow(first.name);
    await expect(page.locator(pm.compositeAlertsPage.locators.referenceConflict)).toBeVisible();
    await page.locator(pm.compositeAlertsPage.locators.referenceParent(parent.id)).click();
    await expect(page).toHaveURL(new RegExp(`/alerts/detail/${parent.id}`));
  });

  test('builder controls are keyboard reachable and screen-reader labelled', async ({ page }) => {
    const first = await createChild(page, uniq('composite_a11y_a'));
    const second = await createChild(page, uniq('composite_a11y_b'));
    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    await pm.compositeAlertsPage.searchAndSelect(first.name, first.id);
    await pm.compositeAlertsPage.searchAndSelect(second.name, second.id);

    for (const selector of [
      pm.compositeAlertsPage.locators.expressionAnd,
      pm.compositeAlertsPage.locators.expressionOr,
      pm.compositeAlertsPage.locators.expressionNot,
      pm.compositeAlertsPage.locators.expressionOpenGroup,
      pm.compositeAlertsPage.locators.expressionCloseGroup,
    ]) {
      await expect(page.locator(selector)).toHaveAccessibleName(/.+/);
    }
    await page.locator(pm.compositeAlertsPage.locators.expressionAnd).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(pm.compositeAlertsPage.locators.expressionOr)).toBeFocused();
    await expect(page.locator(pm.compositeAlertsPage.locators.previewResult)).toHaveAttribute('aria-live', 'polite');
  });
});
