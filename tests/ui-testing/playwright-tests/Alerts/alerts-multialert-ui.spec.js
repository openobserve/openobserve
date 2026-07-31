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
 * Coverage: create-form happy path, MA-01 (toggle), DET-01/03 (detail page).
 * Selectors verified live against the branch build.
 * Shared API plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  BASE, STREAM, DEST, uniq, urls, api,
  multiAlert, createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

/** Open a reka OSelect by clicking its -trigger until aria-expanded, then pick an option by value. */
async function pickOption(page, dropdown, value) {
  const trigger = page.locator(`[data-test="${dropdown}-trigger"]`).first();
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    if ((await trigger.getAttribute('aria-expanded')) === 'true') break;
    await trigger.click();
    await page.waitForTimeout(300);
  }
  await page.locator(`[data-test="${dropdown}-option"][data-test-value="${value}"]`).first().click();
}

/** Create a multi-alert through the API and return its id (asserts the create succeeded). */
async function createMultiViaApi(page, name) {
  const r = await createAlert(page, multiAlert(name));
  expect(r.status(), await r.text()).toBe(200);
  return findAlertId(page, name);
}

test.describe('Alerts 4.0 — multi-alert UI', {
  tag: ['@alerts', '@alerts-multialert', '@P0'],
}, () => {
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
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
    await page.locator('[data-test="alert-list-add-alert-btn"]').click();
    await page.locator('[data-test="add-alert-name-input-field"]').fill(name);
    // Stream type defaults to logs; pick the seeded stream, then a destination.
    await pickOption(page, 'add-alert-stream-name-select-dropdown', STREAM);
    await pickOption(page, 'alert-destinations-select', `dest:${DEST}`);
    await page.keyboard.press('Escape');

    const savePromise = page
      .waitForResponse((r) => r.url().includes('/alerts') && r.request().method() === 'POST', { timeout: 30000 })
      .catch(() => null);
    // The submit button sits in a scroll container that can clip it — DOM-click bypasses that.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-test="add-alert-submit-btn"]');
      if (btn) btn.click();
    });
    const resp = await savePromise;
    expect(resp && resp.ok(), 'alert save must reach the API and succeed').toBeTruthy();

    const row = page.locator('tbody tr').filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    testLogger.info('Create-form round trip verified on the list', { name });

    created.push(await findAlertId(page, name));
  });

  test('MA-01 — the Simple/Multi toggle shows "Multi alert" selected when editing a multi-alert', async ({ page }) => {
    const name = uniq('p0ui_multi');
    const id = await createMultiViaApi(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}&action=update&alert_id=${id}&folder=default`);
    const choice = page.locator('[data-test="alerts-alertmultitoggle-choice"]');
    await expect(choice).toBeVisible({ timeout: 15000 });

    // Options render as <button role="radio" data-test-value="true|false"> carrying aria-checked
    // (reka-ui — NOT native input.checked). The multi-alert must load with "Multi alert" (value "true") checked.
    await expect(choice.locator('[role="radio"][data-test-value="true"]')).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
    await expect(choice.locator('[role="radio"][data-test-value="false"]')).toHaveAttribute('aria-checked', 'false');
  });

  test('DET-01/03 — the multi-alert detail page shows the multi badge, stat strip and group table', async ({ page }) => {
    const name = uniq('p0ui_det');
    const id = await createMultiViaApi(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    await page.goto(`${BASE}/web/alerts/detail/${id}?org_identifier=${getOrgIdentifier()}&folder=default`);
    await expect(page.locator('[data-test="alerts-alertdetail-title"]')).toContainText(name, { timeout: 15000 });
    await expect(page.locator('[data-test="alerts-alertdetail-multi-badge"]')).toBeVisible();
    await expect(page.locator('[data-test="alerts-alertdetail-group-stats"]')).toBeVisible();
    await expect(page.locator('[data-test="alerts-alertdetail-tab-groups"]')).toBeVisible();
    await expect(page.locator('[data-test="alerts-alertgroupstable-table"]')).toBeVisible();
  });
});
