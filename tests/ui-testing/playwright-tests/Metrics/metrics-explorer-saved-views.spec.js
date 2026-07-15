// Metrics Explorer — Saved Views (Phase 3)
//
// Drives the new Metrics EXPLORER (/web/metrics, MetricsExplorer.vue) — the
// browse-grid redesign — NOT the legacy editor (/web/metrics/editor). Verifies
// the Saved Views control: save the current filters+pins as a named view, list
// it, apply it (restores filters), and delete it.
//
// Requires a backend that serves this branch's UI AND the /savedviews API (a
// local rust server with the built UI, or a deployment of this branch). Against
// a backend without the new UI these will fail fast on the mode-toggle locator.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');

const ORG = process.env.ORGNAME || 'default';

async function gotoExplorer(page) {
  await navigateToBase(page);
  await page.goto(`${process.env.ZO_BASE_URL}/web/metrics?org_identifier=${ORG}`);
  await page.waitForLoadState('domcontentloaded');
  // The explorer's root marks the new page.
  await expect(page.locator('[data-test="metrics-explorer"]')).toBeVisible({ timeout: 30000 });
}

test.describe('Metrics Explorer — Saved Views', () => {
  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the explorer renders with the Explore/Visualize toggle and Saved Views control', {
    tag: ['@metrics', '@explorer', '@saved-views', '@P1'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await gotoExplorer(page);

    await expect(page.locator('[data-test="metrics-explorer-mode-explore"]')).toBeVisible();
    await expect(page.locator('[data-test="metrics-explorer-mode-visualize"]')).toBeVisible();
    await expect(page.locator('[data-test="metrics-saved-views"]')).toBeVisible();
  });

  test('save the current view, see it listed, apply it, then delete it', {
    tag: ['@metrics', '@explorer', '@saved-views', '@P1'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await gotoExplorer(page);

    const viewName = `pw-view-${Date.now()}`;

    // Narrow the grid a little so the saved snapshot has something to restore.
    await page.locator('[data-test="metrics-explorer-search"] input').first().fill('cpu');

    // Save current view.
    await page.locator('[data-test="metrics-saved-views-create-btn"]').click();
    await expect(page.locator('[data-test="metrics-saved-views-form-dialog"]')).toBeVisible();
    await page.locator('[data-test="metrics-saved-views-name-input"] input').fill(viewName);
    await page.getByRole('button', { name: /save/i }).click();

    // Open the list — the new view is there.
    await page.locator('[data-test="metrics-saved-views-list-btn"]').click();
    await expect(page.locator('[data-test="metrics-saved-views-list-dialog"]')).toBeVisible();
    await expect(page.locator(`[data-test="metrics-saved-views-apply-${viewName}"]`)).toBeVisible();

    // Apply it — the dialog closes and the search term is restored.
    await page.locator(`[data-test="metrics-saved-views-apply-${viewName}"]`).click();
    await expect(page.locator('[data-test="metrics-explorer-search"] input').first()).toHaveValue('cpu');

    // Delete it (via confirm).
    await page.locator('[data-test="metrics-saved-views-list-btn"]').click();
    await page.locator(`[data-test="metrics-saved-views-delete-${viewName}"]`).click();
    await expect(page.locator('[data-test="metrics-saved-views-delete-confirm"]')).toBeVisible();
    await page.getByRole('button', { name: /ok|confirm|delete/i }).first().click();
    await expect(page.locator(`[data-test="metrics-saved-views-apply-${viewName}"]`)).toHaveCount(0);
  });
});
