// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — composite alert trigger timestamps & status timeline (#14308)
 *
 * Fixed by #14340: composite list now shows real Last Triggered/Last Satisfied
 * timestamps, child detail shows each child's Last-computed level_at, and a
 * status timeline was added to the composite detail page.
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
    await pm.compositeAlertsPage.listCompositeTab().click();
    await expect(pm.compositeAlertsPage.listNameCell(composite.name)).toBeVisible();

    await expect(pm.compositeAlertsPage.listLastTriggeredCell(composite.name)).not.toContainText('Never');
    await expect(pm.compositeAlertsPage.listLastSatisfiedCell(composite.name)).not.toContainText('Never');
  });

  test('composite list shows Never when no scheduler trigger data exists', async ({ page }) => {
    const first = await createChild(page, uniq('composite_never_a'));
    const second = await createChild(page, uniq('composite_never_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await pm.compositeAlertsPage.listCompositeTab().click();
    await expect(pm.compositeAlertsPage.listNameCell(composite.name)).toBeVisible();

    await expect(pm.compositeAlertsPage.listLastTriggeredCell(composite.name)).toContainText('Never');
    await expect(pm.compositeAlertsPage.listLastSatisfiedCell(composite.name)).toContainText('Never');
  });

  test('composite form preview surfaces the real validation-error message', async ({ page }) => {
    const first = await createChild(page, uniq('composite_err_a'));
    const second = await createChild(page, uniq('composite_err_b'));

    await page.route('**/api/v2/*/alerts/composites/validate', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'child_cycle_detected' }),
      });
    });

    await pm.compositeAlertsPage.openCreate();
    await pm.compositeAlertsPage.chooseCompositeType();
    await pm.compositeAlertsPage.searchAndSelect(first.name, first.id);
    await pm.compositeAlertsPage.searchAndSelect(second.name, second.id);

    await expect(pm.compositeAlertsPage.previewError('child_cycle_detected')).toBeVisible();
    await expect(pm.compositeAlertsPage.previewError('child_cycle_detected')).toContainText('child_cycle_detected');
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

  test('composite detail renders the status timeline with per-child lanes and current-level badges', async ({ page }) => {
    const first = await createChild(page, uniq('composite_tl_a'));
    const second = await createChild(page, uniq('composite_tl_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route('**/api/v2/*/alerts/*/composite-timeline*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          from: 1000000000000000,
          to: 1000001000000000,
          children: [
            { alert_id: first.id, slot: 0, name: first.name, accessible: true, current_level: 'critical', level_since: 1000000500000000, transitions: [] },
            { alert_id: second.id, slot: 1, name: second.name, accessible: true, current_level: 'warning', level_since: 1000000600000000, transitions: [] },
          ],
          result: { alert_id: composite.id, slot: null, name: composite.name, accessible: true, current_level: 'critical', level_since: 1000000500000000, transitions: [] },
        }),
      });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);

    await expect(pm.compositeAlertsPage.timeline()).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineLevel(first.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineLevel(second.id)).toBeVisible();
  });

  test('timeline window toggle re-fetches for 1h and 1d', async ({ page }) => {
    const first = await createChild(page, uniq('composite_win_a'));
    const second = await createChild(page, uniq('composite_win_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    let timelineRequests = 0;
    await page.route('**/api/v2/*/alerts/*/composite-timeline*', async (route) => {
      timelineRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          from: 1000000000000000,
          to: 1000001000000000,
          children: [
            { alert_id: first.id, slot: 0, name: first.name, accessible: true, current_level: 'critical', level_since: 1000000500000000, transitions: [] },
          ],
          result: { alert_id: composite.id, slot: null, name: composite.name, accessible: true, current_level: 'critical', level_since: 1000000500000000, transitions: [] },
        }),
      });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);
    await expect(pm.compositeAlertsPage.timeline()).toBeVisible();
    await expect.poll(() => timelineRequests).toBe(1);

    await pm.compositeAlertsPage.timelineWindow('1h').click();
    await expect(pm.compositeAlertsPage.timelineWindow('1h')).toHaveAttribute('data-state', 'on');
    await expect.poll(() => timelineRequests).toBe(2);

    await pm.compositeAlertsPage.timelineWindow('1d').click();
    await expect(pm.compositeAlertsPage.timelineWindow('1d')).toHaveAttribute('data-state', 'on');
    await expect.poll(() => timelineRequests).toBe(3);
  });

  test('timeline shows the empty state when the fetch fails', async ({ page }) => {
    const first = await createChild(page, uniq('composite_empty_a'));
    const second = await createChild(page, uniq('composite_empty_b'));
    const composite = await createCompositeFixture(page, [first, second]);

    await page.route('**/api/v2/*/alerts/*/composite-timeline*', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    await pm.compositeAlertsPage.openDetail(composite.id);

    await expect(pm.compositeAlertsPage.timelineEmpty()).toBeVisible();
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
