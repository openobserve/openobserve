// searchInspectorPage.js
import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Page Object Model for the Search Inspector permission gating.
 *
 * The Search Inspect entry point (search-inspect-btn) is rendered only when the
 * build is enterprise non-cloud AND the caller is granted the search_inspector
 * module. The backend reports that per-user decision as the
 * `search_inspector_enabled` flag on the full /api/{org}/config response, and
 * MainLayout refetches that config when the selected organization changes.
 */
export class SearchInspectorPage {
  constructor(page) {
    this.page = page;

    // Search bar "more options" menu and its items.
    this.moreOptionsBtn = '[data-test="logs-search-bar-more-options-btn"]';
    // Always-present menu item used as a "menu is open" signal before asserting
    // on the gated Search Inspect entry point.
    this.searchHistoryItemBtn = '[data-test="search-history-item-btn"]';
    // The gated Search Inspect entry point (SearchBar.vue:803).
    this.searchInspectBtn = '[data-test="search-inspect-btn"]';
  }

  /**
   * Open the search bar's "more options" menu and wait for a non-gated item so
   * downstream presence/absence assertions run against an open menu.
   */
  async openMoreOptionsMenu() {
    const menuBtn = this.page.locator(this.moreOptionsBtn);
    await menuBtn.waitFor({ state: 'visible', timeout: 15000 });
    await menuBtn.click();
    await this.page
      .locator(this.searchHistoryItemBtn)
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Assert the Search Inspect entry point is absent from the open menu.
   */
  async expectSearchInspectEntryHidden() {
    await expect(this.page.locator(this.searchInspectBtn)).toHaveCount(0);
  }

  /**
   * Set up a promise that resolves when the full UI config request for the given
   * organization fires. Call before the org switch and await after it.
   * @param {string} orgIdentifier
   */
  waitForConfigRequest(orgIdentifier) {
    return this.page.waitForRequest(
      (req) => req.url().includes(`/api/${orgIdentifier}/config`),
      { timeout: 30000 },
    );
  }

  /**
   * Reload the page and capture the full UI config JSON (the authenticated,
   * org-scoped /api/{org}/config response, not the unauthenticated /config
   * bootstrap).
   * @returns {Promise<object>}
   */
  async captureConfigOnReload() {
    const responsePromise = this.page.waitForResponse(
      (res) => {
        const pathname = new URL(res.url()).pathname;
        return pathname.includes('/api/') && pathname.endsWith('/config');
      },
      { timeout: 30000 },
    );
    await this.page.reload();
    const response = await responsePromise;
    testLogger.info(`Captured full UI config response (${response.status()})`);
    return await response.json();
  }
}

export default SearchInspectorPage;
