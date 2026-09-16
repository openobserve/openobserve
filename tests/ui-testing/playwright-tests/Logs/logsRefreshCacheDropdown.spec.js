const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// GH #14488 — "Refresh Cache & Run Query" visibility must be consistent
// between the Logs tab and the Visualize tab, independent of the
// auto_query_enabled flag (which only gates Live Mode) and independent of
// enterprise vs OSS build (the backend supports clear_cache in both —
// src/config/src/meta/search.rs, src/api/search/src/search/mod.rs).
//
// Before the fix, the Logs tab hid the whole dropdown unless
// auto_query_enabled was true, and hid the menu item unless the build was
// enterprise; the Visualize tab always showed it. These tests run against
// whatever build/config this shard actually is, so they can't flip those
// flags — instead they pin down the two things #14488 actually asked for:
// (1) the item is visible on the Logs tab in this build, matching Visualize,
// and (2) clicking it issues a request with clear_cache=true, matching the
// backend's meta::search::Request contract.
// ============================================================================

async function ingestTestData(page) {
  await _ingestData(page);
}

test.describe('Logs — Refresh Cache & Run Query dropdown (GH #14488)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    testLogger.info('Test setup completed');
  });

  test(
    'shows Refresh Cache & Run Query on the Logs tab and it bypasses the cache',
    { tag: ['@logs-refresh-cache', '@all', '@logs', '@P0'] },
    async ({ page }) => {
      await pm.logsPage.openRefreshCacheDropdown();

      const item = pm.logsPage.getRefreshCacheAndRunQueryMenuItem();
      await expect(item, 'Refresh Cache & Run Query must be visible on the Logs tab').toBeVisible();
      await expect(item).toBeEnabled();

      // Close this menu before driving the click through the helper below,
      // which reopens it — Reka UI dropdowns close on an outside click.
      await page.keyboard.press('Escape');

      const requestUrl = await pm.logsPage.clickRefreshCacheAndRunQuery();
      expect(
        requestUrl.searchParams.get('clear_cache'),
        'clicking Refresh Cache & Run Query must bypass the cache (clear_cache=true), matching the backend contract'
      ).toBe('true');
    }
  );

  test(
    'shows the same Refresh Cache & Run Query item on the Visualize tab as on the Logs tab',
    { tag: ['@logs-refresh-cache', '@all', '@logs', '@P1'] },
    async ({ page }) => {
      // Logs tab first.
      await pm.logsPage.openRefreshCacheDropdown();
      await expect(pm.logsPage.getRefreshCacheAndRunQueryMenuItem()).toBeVisible();
      await page.keyboard.press('Escape');

      // Same dropdown, same item, on the Visualize tab — GH #14488's core ask
      // is that a user sees the same option regardless of which tab they're on.
      await pm.logsVisualise.openVisualiseTab();
      await pm.logsPage.openRefreshCacheDropdown();
      await expect(
        pm.logsPage.getRefreshCacheAndRunQueryMenuItem(),
        'Refresh Cache & Run Query must also be visible on the Visualize tab'
      ).toBeVisible();
    }
  );
});
