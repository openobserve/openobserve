// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — composite alert trigger timestamps (#14308)
 *
 * Fixed by #14340: composite list now shows real Last Triggered/Last Satisfied
 * timestamps, and child detail shows each child's Last-computed level_at.
 *
 * The status timeline this fix also introduced is covered by the H1-H5 tests
 * in Alerts/alerts-composite-detail.spec.js — not duplicated here.
 *
 * Includes an intentional test.fixme: the composite evaluation timestamp
 * (evaluated_at) is not actually rendered anywhere in CompositeAlertDetail.vue
 * — a real, separate, undocumented gap this suite surfaced while covering the
 * fixed behavior above.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const {
  uniq, urls, api, simpleAlert, compositeAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../../utils/alerts-api-helpers.js');

test.describe('Composite alert trigger timestamps & status timeline', {
  tag: ['@alerts', '@alerts-composite', '@composite-alert-trigger-timestamps', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
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
    const name = uniq('composite_ts');
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

  test('composite list shows populated Last Triggered and Last Satisfied timestamps', async ({ page }) => {
    const first = await createChild(page, uniq('composite_ts_a'));
    const second = await createChild(page, uniq('composite_ts_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route(/\/api\/v2\/[^/]+\/alerts\?/, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      body.list = (body.list || []).map((item) => (
        item.name === composite.name
          ? { ...item, last_triggered_at: 1786500000000000, last_satisfied_at: 1786500015000000 }
          : item
      ));
      await route.fulfill({ response, json: body });
    });

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await pm.compositeAlertsPage.openListTab('composite');
    await expect(pm.compositeAlertsPage.listNameCell(composite.name)).toBeVisible();

    await expect(pm.compositeAlertsPage.listLastTriggeredCell(composite.name)).not.toContainText('Never');
    await expect(pm.compositeAlertsPage.listLastSatisfiedCell(composite.name)).not.toContainText('Never');
  });

  test('composite list shows Never when no scheduler trigger data exists', async ({ page }) => {
    const first = await createChild(page, uniq('composite_never_a'));
    const second = await createChild(page, uniq('composite_never_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await pm.compositeAlertsPage.openListTab('composite');
    await expect(pm.compositeAlertsPage.listNameCell(composite.name)).toBeVisible();

    await expect(pm.compositeAlertsPage.listLastTriggeredCell(composite.name)).toContainText('Never');
    await expect(pm.compositeAlertsPage.listLastSatisfiedCell(composite.name)).toContainText('Never');
  });

  test('composite detail renders each child Last computed level_at timestamp', async ({ page }) => {
    const first = await createChild(page, uniq('composite_level_a'));
    const second = await createChild(page, uniq('composite_level_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.children = (body.children || []).map((child) => (
        child.alert_id === first.id ? { ...child, level_at: 1786500000000000 } : child
      ));
      await route.fulfill({ response, json: body });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);

    await expect(pm.compositeAlertsPage.detailLevelAt(first.id)).toContainText(/\d/);
    await expect(pm.compositeAlertsPage.detailLevelAt(second.id)).toContainText('—');
  });

  test('inaccessible child renders only the raw alert_id without a link or timestamp', async ({ page }) => {
    const first = await createChild(page, uniq('composite_mask_a'));
    const second = await createChild(page, uniq('composite_mask_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.children = (body.children || []).map((child) => (
        child.alert_id === first.id ? { alert_id: first.id, accessible: false, name: null } : child
      ));
      await route.fulfill({ response, json: body });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);

    await expect(pm.compositeAlertsPage.detailChild(first.id)).toContainText(first.id);
    await expect(pm.compositeAlertsPage.detailChildLink(first.id)).toHaveCount(0);
    await expect(pm.compositeAlertsPage.detailLevelAt(first.id)).toHaveCount(0);
  });

  test.fixme('composite evaluation timestamp evaluated_at is not rendered — not wired: CompositeAlertDetail.vue binds only evaluation.result/evaluation.level', async ({ page }) => {
    const first = await createChild(page, uniq('composite_eval_a'));
    const second = await createChild(page, uniq('composite_eval_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.evaluation = { result: true, level: 'critical', evaluated_at: 1786500015000000 };
      await route.fulfill({ response, json: body });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);
    await expect(pm.compositeAlertsPage.detailEvaluationTimestamp()).toContainText(/\d/);
  });
});
