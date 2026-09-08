// searchHistoryPage.js
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Page Object Model for the standalone Search History page (/web/logs/search-history).
 *
 * Search History is backed by usage reporting, so rows only appear once the usage
 * batch has been published — every read here polls the refresh button rather than
 * assuming the row is present on first paint.
 */
export class SearchHistoryPage {
  constructor(page) {
    this.page = page;

    this.searchHistoryPath = '/web/logs/search-history';

    // ===== ENTRY POINT (SearchBar.vue) =====
    this.utilitiesMenuBtn = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.searchHistoryItemBtn = '[data-test="search-history-item-btn"]';

    // ===== SEARCH HISTORY PAGE (SearchHistory.vue) =====
    this.refreshHistoryBtn = '[data-test="search-history-get-history-btn"]';
    this.goToLogsBtn = '[data-test="search-history-go-to-logs-btn"]';
    this.colorizedSql = '[data-test="search-history-sql-colorized"]';
  }

  /** Opens Search History through the logs search-bar menu, as a user would. */
  async openFromLogs() {
    await this.page.locator(this.utilitiesMenuBtn).click();
    await this.page.locator(this.searchHistoryItemBtn).click();
    await this.page.waitForURL(/\/logs\/search-history/, { timeout: 30000 });
    await this.page.locator(this.refreshHistoryBtn).waitFor({ state: 'visible', timeout: 30000 });
    testLogger.info('Search History page opened');
  }

  rowContaining(sqlFragment) {
    return this.page.locator('tr').filter({ hasText: sqlFragment }).first();
  }

  /**
   * Usage rows are published asynchronously, so refresh until the query shows up.
   */
  async waitForQueryRow(sqlFragment, { attempts = 20, intervalMs = 5000 } = {}) {
    const row = this.rowContaining(sqlFragment);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (await row.count()) {
        testLogger.info(`Search History row found on attempt ${attempt}`, { sqlFragment });
        return row;
      }
      await this.page.locator(this.refreshHistoryBtn).click();
      await this.page.waitForTimeout(intervalMs);
    }

    throw new Error(`Search History never listed a query containing "${sqlFragment}"`);
  }

  /** Expands the row for the given query and re-applies it on the logs page. */
  async reApplyQuery(sqlFragment) {
    const row = await this.waitForQueryRow(sqlFragment);

    // The table expands on row click (expand-on-row-click), which reveals Go to Logs.
    await row.click();
    const goToLogs = this.page.locator(this.goToLogsBtn).first();
    await goToLogs.waitFor({ state: 'visible', timeout: 15000 });

    const reAppliedSql = (await this.page.locator(this.colorizedSql).first().innerText()).trim();

    await goToLogs.click();
    await this.page.waitForURL(/\/logs(\?|$)/, { timeout: 30000 });
    testLogger.info('Re-applied query from Search History', { reAppliedSql });

    return reAppliedSql;
  }
}

export default SearchHistoryPage;
