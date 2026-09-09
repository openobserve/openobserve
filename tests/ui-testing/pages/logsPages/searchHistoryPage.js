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
    this.logsPath = '/web/logs';

    // ===== ENTRY POINT (SearchBar.vue) =====
    // Search History lives in the more-options (hamburger) menu, not the "More" utilities one.
    this.moreOptionsMenuBtn = '[data-test="logs-search-bar-more-options-btn"]';
    this.searchHistoryItemBtn = '[data-test="search-history-item-btn"]';

    // ===== SEARCH HISTORY PAGE (SearchHistory.vue) =====
    this.tableRow = '[data-test^="o2-table-row-"]';
    this.refreshHistoryBtn = '[data-test="search-history-get-history-btn"]';
    this.goToLogsBtn = '[data-test="search-history-go-to-logs-btn"]';
    this.colorizedSql = '[data-test="search-history-sql-colorized"]';
  }

  /** Opens Search History through the logs search-bar menu, as a user would. */
  async openFromLogs() {
    await this.page.locator(this.moreOptionsMenuBtn).click();
    const historyItem = this.page.locator(this.searchHistoryItemBtn);
    await historyItem.waitFor({ state: 'visible', timeout: 15000 });
    await historyItem.click();
    await this.page.waitForURL(/\/logs\/search-history/, { timeout: 30000 });
    await this.page.locator(this.refreshHistoryBtn).waitFor({ state: 'visible', timeout: 30000 });
    testLogger.info('Search History page opened');
  }

  rowContaining(sqlFragment) {
    // Body rows only — the expansion panel is a separate <tr> carrying the same text.
    return this.page.locator(this.tableRow).filter({ hasText: sqlFragment }).first();
  }

  /**
   * Usage rows are published asynchronously, so refresh until the query shows up.
   */
  async waitForQueryRow(sqlFragment, { attempts = 12, intervalMs = 5000 } = {}) {
    const row = this.rowContaining(sqlFragment);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (await row.count()) {
        testLogger.info(`Search History row found on attempt ${attempt}`, { sqlFragment });
        return row;
      }
      await this.page.locator(this.refreshHistoryBtn).click();
      await this.page.waitForTimeout(intervalMs);
    }

    throw new Error(
      `Search History never listed a query containing "${sqlFragment}" after ${attempts} refreshes — ` +
        'usage reporting is most likely disabled or not publishing on this environment.',
    );
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

  /**
   * URL-safe base64 that matches web/src/utils/formatters.ts b64EncodeUnicode, so the
   * deep link we build decodes with the same alphabet the frontend's b64DecodeUnicode
   * expects (- + / _ = .).
   */
  b64EncodeUnicode(str) {
    const percentEncoded = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16)),
    );
    return Buffer.from(percentEncoded, 'latin1')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '.');
  }

  /**
   * Builds the exact deep-link URL goToLogs constructs (SearchHistory.vue:663-689) for a
   * re-applied query, so a test can exercise the fresh-mount re-apply path deterministically
   * without waiting on the async usage-publish round-trip.
   */
  buildReApplyUrl(query, { stream = 'e2e_automate', org = process.env['ORGNAME'] } = {}) {
    const queryObject = {
      stream_type: 'logs',
      stream,
      period: '15m',
      refresh: '0',
      sql_mode: 'true',
      query: this.b64EncodeUnicode(query),
      defined_schemas: 'user_defined_schema',
      org_identifier: org,
      quick_mode: 'false',
      show_histogram: 'true',
      type: 'search_history_re_apply',
      fn_editor: 'false',
    };
    return `${this.logsPath}?${new URLSearchParams(queryObject).toString()}`;
  }
}

export default SearchHistoryPage;
