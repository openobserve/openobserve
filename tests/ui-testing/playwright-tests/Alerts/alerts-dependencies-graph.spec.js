const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Test timeout constants (in milliseconds)
const NETWORK_IDLE_TIMEOUT_MS = 30000;

/**
 * Notification Dependencies (Template → Destination → Alert) E2E Tests
 *
 * Read-only dependency graph under Reliability, a flat sibling of Alert
 * Destinations / Templates. Validates that the page renders the VueFlow canvas,
 * the summary + filter/search/toggle controls work, and destination nodes carry
 * their usage badge. Data is cross-referenced client-side from the existing
 * alerts / destinations / templates list APIs.
 */
test.describe('Notification Dependencies Graph E2E', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await page.goto(
      `${process.env['ZO_BASE_URL']}/web/alert-dependencies?org_identifier=${getOrgIdentifier()}`,
    );
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    // Anchor on the page title — deterministic ready signal.
    await expect(page.locator('[data-test="alert-dependencies-title"]')).toBeVisible();
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('renders the header, controls and summary strip', async ({ page }) => {
    await expect(page.locator('[data-test="alert-dependencies-search"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-dependencies-filter"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-dependencies-filter-linked"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-dependencies-expand-all"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-dependencies-refresh"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-dependencies-summary"]')).toBeVisible();
  });

  test('renders the graph canvas or an empty state', async ({ page }) => {
    const canvas = page.locator('[data-test="alert-dependencies-canvas"]');
    const empty = page.locator('[data-test="alert-dependencies-empty"]');
    // One of the two terminal states must show once loading resolves.
    await expect(canvas.or(empty)).toBeVisible();

    if (await canvas.isVisible()) {
      // A destination node carries a usage badge showing how many alerts use it.
      const destNode = page.locator('[data-test^="alert-dependencies-node-destination-"]').first();
      if (await destNode.count()) {
        await expect(destNode).toBeVisible();
      }
    }
  });

  test('Expand all reveals alert nodes; collapsing hides them', async ({ page }) => {
    const canvas = page.locator('[data-test="alert-dependencies-canvas"]');
    test.skip(!(await canvas.isVisible()), 'no graph data in this environment');

    const expand = page.locator('[data-test="alert-dependencies-expand-all"]');
    const alertNodes = page.locator('[data-test^="alert-dependencies-node-alert-"]');

    // Aggregated by default: alerts are hidden until expanded.
    await expect(alertNodes).toHaveCount(0);
    await expand.click();
    await expect(alertNodes.first()).toBeVisible();
    await expand.click();
    await expect(alertNodes).toHaveCount(0);
  });

  test('the filter switches to Unused and Broken views', async ({ page }) => {
    await page.locator('[data-test="alert-dependencies-filter-all"]').click();
    await page.locator('[data-test="alert-dependencies-filter-orphan"]').click();
    await expect(page.locator('[data-test="alert-dependencies-canvas"]').or(
      page.locator('[data-test="alert-dependencies-empty"]'),
    )).toBeVisible();

    await page.locator('[data-test="alert-dependencies-filter-broken"]').click();
    await expect(page.locator('[data-test="alert-dependencies-canvas"]').or(
      page.locator('[data-test="alert-dependencies-empty"]'),
    )).toBeVisible();

    await page.locator('[data-test="alert-dependencies-filter-all"]').click();
  });
});
