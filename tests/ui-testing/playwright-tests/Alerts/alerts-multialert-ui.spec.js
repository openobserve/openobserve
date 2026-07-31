// Copyright 2026 OpenObserve Inc.

/**
 * Alerts 4.0 (multi-alerts) — UI surfaces  [P0]
 *
 * Complements alerts-multialert-api.spec.js (which owns the API contract) by
 * asserting the rendering the API cannot: the create form saves end-to-end, the
 * Simple/Multi toggle reflects a stored multi-alert, and the new Alert Detail
 * page shows the multi layout. Multi cases are created via the API and then
 * *asserted* through the UI — this keeps the assertions on the render surface
 * (deterministic) instead of racing the scheduler's evaluation cadence.
 *
 * All UI selectors live in page objects (pm.alertsPage / pm.alertDetailPage);
 * shared API plumbing lives in ../utils/alerts-api-helpers.js.
 *
 * Coverage: create-form happy path, MA-01 (toggle), DET-01/03 (detail page).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  BASE, STREAM, DEST, uniq,
  multiAlert, createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

/** Create a multi-alert through the API and return its id (asserts the create succeeded). */
async function createMultiViaApi(page, name) {
  const r = await createAlert(page, multiAlert(name));
  expect(r.status(), await r.text()).toBe(200);
  return findAlertId(page, name);
}

test.describe('Alerts 4.0 — multi-alert UI', {
  tag: ['@alerts', '@alerts-multialert', '@P0'],
}, () => {
  let pm;
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
    created.length = 0;
  });

  test('create-form happy path — a simple scheduled alert saves and lands on the list', async ({ page }) => {
    const name = uniq('p0ui_simple');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(name);
    await pm.alertsPage.selectStreamType('logs');
    await pm.alertsPage.selectStreamByName(STREAM);
    await pm.alertsPage.selectDestinationByName(DEST);

    const savePromise = page
      .waitForResponse((r) => r.url().includes('/alerts') && r.request().method() === 'POST', { timeout: 30000 })
      .catch(() => null);
    await pm.alertsPage.submitAlertForm();
    const resp = await savePromise;
    expect(resp && resp.ok(), 'alert save must reach the API and succeed').toBeTruthy();

    await pm.alertsPage.expectAlertVisibleInList(name);
    created.push(await findAlertId(page, name));
  });

  test('MA-01 — the Simple/Multi toggle shows "Multi alert" selected when editing a multi-alert', async ({ page }) => {
    const name = uniq('p0ui_multi');
    const id = await createMultiViaApi(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}&action=update&alert_id=${id}&folder=default`);
    await pm.alertsPage.expectMultiAlertSelected();
  });

  test('DET-01/03 — the multi-alert detail page shows the multi badge, stat strip and group table', async ({ page }) => {
    const name = uniq('p0ui_det');
    const id = await createMultiViaApi(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    await pm.alertDetailPage.open(id);
    await pm.alertDetailPage.expectTitle(name);
    await pm.alertDetailPage.expectMultiLayoutVisible();
  });
});
