// searchJobInspectorPage.js
import { expect } from '@playwright/test';

const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * Page Object Model for Search Job Inspector
 * Handles the Inspector page at /web/logs/inspector
 * Enterprise-only feature for viewing search query execution profiles
 *
 * IMPORTANT: Selectors must match actual data-test attributes in Vue components
 */
export class SearchJobInspectorPage {
  constructor(page) {
    this.page = page;

    // Inspector Page URL
    this.inspectorPath = '/web/logs/inspector';

    // ===== SEARCH BAR SELECTORS (SearchBar.vue) =====
    this.utilitiesMenuBtn = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.moreOptionsMenuBtn = '[data-test="logs-search-bar-more-options-btn"]';
    this.searchHistoryItemBtn = '[data-test="search-history-item-btn"]';
    this.searchInspectBtn = '[data-test="search-inspect-btn"]';
    this.refreshBtn = '[data-test="logs-search-bar-refresh-btn"]';
    this.showQueryToggleBtn = '[data-test="logs-search-bar-show-query-toggle-btn"]';

    // ===== SEARCH INSPECT DIALOG SELECTORS (SearchBar.vue) =====
    this.traceIdInput = '[data-test="search-inspect-trace-id-input"]';
    this.inspectSubmitBtn = '[data-test="search-inspect-submit-btn"]';

    // ===== SEARCH HISTORY SELECTORS (SearchHistory.vue) =====
    // Note: History rows use dynamic data-test with trace_id
    this.searchHistoryRow = '[data-test^="stream-association-table-"]';

    // ===== INSPECTOR PAGE SELECTORS (SearchJobInspector.vue) =====
    this.inspectorTitle = '[data-test="inspector-title"]';
    this.inspectorCloseBtn = '[data-test="inspector-close-button"]';
    this.inspectorErrorBanner = '[data-test="inspector-error-banner"]';
    this.inspectorEventsTable = '[data-test="inspector-events-table"]';
    this.inspectorCopySqlBtn = '[data-test="inspector-copy-sql-btn"]';

    // ===== TEXT-BASED SELECTORS (for elements without data-test) =====
    // These are fallbacks for elements that don't have data-test attributes
    this.inspectorPageTitleText = 'text=Search Job Inspector';
    this.resultsTileText = 'text=Results';
    this.eventsTileText = 'text=Events';
    this.timeTakenTileText = 'text=Time Taken';
    this.traceIdTileText = 'text=Trace ID';
    this.viewQueryBtnText = 'text=View Query';
    this.noEventsText = 'text=No events found';
    this.inspectBtnText = 'button:has-text("Inspect")';

    // ===== SEARCH RESULTS (Index.vue) =====
    this.searchResultText = '[data-test="logs-search-search-result"]';
  }

  // ===== NAVIGATION METHODS =====

  /**
   * Navigate directly to inspector page with a trace ID
   * @param {string} traceId - The trace ID to inspect
   * @param {object} options - Additional options (startTime, endTime)
   */
  async navigateToInspector(traceId, options = {}) {
    const orgId = getOrgIdentifier();
    const baseUrl = process.env["ZO_BASE_URL"];

    let url = `${baseUrl}/web/logs/inspector?trace_id=${traceId}&org_identifier=${orgId}`;

    if (options.startTime) {
      url += `&start_time=${options.startTime}`;
    }
    if (options.endTime) {
      url += `&end_time=${options.endTime}`;
    }

    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for inspector page to load
   */
  async waitForInspectorPage() {
    await expect(this.page.locator(this.inspectorTitle)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if on inspector page
   * @returns {Promise<boolean>}
   */
  async isOnInspectorPage() {
    return await this.page.locator(this.inspectorTitle).isVisible({ timeout: 5000 }).catch(() => false);
  }

  // ===== OVERFLOW MENU METHODS =====

  /**
   * Open the more options menu (three dots)
   */
  async openMoreOptionsMenu() {
    await this.page.locator(this.moreOptionsMenuBtn).click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click Search Inspect option in menu (for Enterprise)
   */
  async clickSearchInspectOption() {
    await this.openMoreOptionsMenu();
    await expect(this.page.locator(this.searchInspectBtn)).toBeVisible({ timeout: 5000 });
    await this.page.locator(this.searchInspectBtn).click();
  }

  /**
   * Check if Search Inspect button is visible (Enterprise feature)
   * @returns {Promise<boolean>}
   */
  async isSearchInspectVisible() {
    await this.openMoreOptionsMenu();
    const visible = await this.page.locator(this.searchInspectBtn).isVisible({ timeout: 3000 }).catch(() => false);
    await this.page.keyboard.press('Escape'); // Close menu
    return visible;
  }

  /**
   * Open Search Inspect dialog and enter a trace ID
   * @param {string} traceId - The trace ID to inspect
   */
  async inspectViaDialog(traceId) {
    await this.clickSearchInspectOption();
    await expect(this.page.locator(this.traceIdInput)).toBeVisible({ timeout: 5000 });
    await this.page.locator(this.traceIdInput).fill(traceId);
    await this.page.locator(this.inspectSubmitBtn).click();
    await this.waitForInspectorPage();
  }

  // ===== SEARCH HISTORY METHODS =====

  /**
   * Open Search History via more options menu
   */
  async openSearchHistory() {
    await this.openMoreOptionsMenu();
    await expect(this.page.locator(this.searchHistoryItemBtn)).toBeVisible({ timeout: 5000 });
    await this.page.locator(this.searchHistoryItemBtn).click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click Inspect button on a history row
   * Uses text-based selector since history rows don't have dedicated inspect buttons
   */
  async inspectFromHistory() {
    const inspectBtn = this.page.locator(this.inspectBtnText).first();
    await expect(inspectBtn).toBeVisible({ timeout: 5000 });
    await inspectBtn.click();
    await this.waitForInspectorPage();
  }

  /**
   * Check if history has Inspect buttons available
   * @returns {Promise<boolean>}
   */
  async hasHistoryInspectButtons() {
    return await this.page.locator(this.inspectBtnText).first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  // ===== SEARCH RESULTS PARSING =====

  /**
   * Get search results text (e.g., "Showing 1 to 50 out of X events in Y ms")
   * @returns {Promise<string>}
   */
  async getSearchResultsText() {
    const resultLocator = this.page.locator(this.searchResultText);
    if (await resultLocator.isVisible({ timeout: 5000 }).catch(() => false)) {
      return await resultLocator.textContent() || '';
    }
    return '';
  }

  /**
   * Parse search results to extract events count and time
   * @returns {Promise<{eventsCount: string, timeMs: string}>}
   */
  async parseSearchResults() {
    const text = await this.getSearchResultsText();

    const eventsMatch = text.match(/out of ([\d,]+) events/);
    const timeMatch = text.match(/in (\d+) ms/);

    return {
      eventsCount: eventsMatch ? eventsMatch[1].replace(/,/g, '') : 'N/A',
      timeMs: timeMatch ? timeMatch[1] : 'N/A'
    };
  }

  // ===== INSPECTOR PAGE METHODS =====

  /**
   * Get inspector stats values using text-based locators
   * @returns {Promise<{results: string, events: string, timeTaken: string, traceId: string}>}
   */
  async getInspectorStats() {
    const stats = {
      results: 'N/A',
      events: 'N/A',
      timeTaken: 'N/A',
      traceId: 'N/A'
    };

    // Get values adjacent to label text
    const tiles = [
      { label: 'Results', key: 'results' },
      { label: 'Events', key: 'events' },
      { label: 'Time Taken', key: 'timeTaken' },
      { label: 'Trace ID', key: 'traceId' }
    ];

    for (const tile of tiles) {
      try {
        const labelLocator = this.page.locator(`text=${tile.label}`).first();
        if (await labelLocator.isVisible({ timeout: 2000 })) {
          // Get parent container and find the value
          const parent = labelLocator.locator('xpath=..');
          const valueText = await parent.textContent();
          // Extract numeric value or ID
          const value = valueText?.replace(tile.label, '').trim() || 'N/A';
          stats[tile.key] = value;
        }
      } catch { /* continue */ }
    }

    return stats;
  }

  /**
   * Click View Query button to open SQL dialog
   */
  async openViewQueryDialog() {
    const viewQueryBtn = this.page.locator(this.viewQueryBtnText);
    await expect(viewQueryBtn).toBeVisible({ timeout: 5000 });
    await viewQueryBtn.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Check if View Query button is visible
   * @returns {Promise<boolean>}
   */
  async isViewQueryVisible() {
    return await this.page.locator(this.viewQueryBtnText).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Get SQL query content from dialog
   * @returns {Promise<string>}
   */
  async getSqlQueryContent() {
    // Look for SQL content in dialog (pre/code elements or SQL keywords)
    const sqlLocators = [
      this.page.locator('pre').first(),
      this.page.locator('code').first(),
      this.page.locator('text=/SELECT.*FROM/i').first()
    ];

    for (const locator of sqlLocators) {
      if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
        return await locator.textContent() || '';
      }
    }
    return '';
  }

  /**
   * Close SQL query dialog
   */
  async closeSqlDialog() {
    // Try pressing Escape to close any dialog
    await this.page.keyboard.press('Escape');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Close the inspector page
   */
  async closeInspector() {
    const closeBtn = this.page.locator(this.inspectorCloseBtn);
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Check if close button is visible
   * @returns {Promise<boolean>}
   */
  async isCloseBtnVisible() {
    return await this.page.locator(this.inspectorCloseBtn).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if events table is visible
   * @returns {Promise<boolean>}
   */
  async isEventsTableVisible() {
    return await this.page.locator(this.inspectorEventsTable).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if no events message is displayed
   * @returns {Promise<boolean>}
   */
  async hasNoEventsMessage() {
    return await this.page.locator(this.noEventsText).isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if error banner is displayed
   * @returns {Promise<boolean>}
   */
  async hasError() {
    return await this.page.locator(this.inspectorErrorBanner).isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if inspector tiles are visible
   * @returns {Promise<{results: boolean, events: boolean, timeTaken: boolean, traceId: boolean}>}
   */
  async getTilesVisibility() {
    return {
      results: await this.page.locator(this.resultsTileText).isVisible({ timeout: 3000 }).catch(() => false),
      events: await this.page.locator(this.eventsTileText).isVisible({ timeout: 3000 }).catch(() => false),
      timeTaken: await this.page.locator(this.timeTakenTileText).isVisible({ timeout: 3000 }).catch(() => false),
      traceId: await this.page.locator(this.traceIdTileText).isVisible({ timeout: 3000 }).catch(() => false)
    };
  }

  /**
   * Run search by clicking refresh button
   */
  async runSearch() {
    await this.page.locator(this.refreshBtn).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get current URL
   * @returns {Promise<string>}
   */
  async getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Take a screenshot
   * @param {string} name - Screenshot name
   */
  async takeScreenshot(name) {
    await this.page.screenshot({ path: `test-results/${name}.png` });
  }

  // ===== ASSERTION HELPERS =====

  /**
   * Assert Inspector page is visible
   */
  async assertInspectorPageVisible() {
    await expect(this.page.locator(this.inspectorTitle)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert URL contains trace_id
   */
  async assertUrlHasTraceId() {
    await expect(this.page).toHaveURL(/trace_id=/, { timeout: 10000 });
  }

  /**
   * Assert events count matches between search and inspector
   * @param {number} searchEvents - Events count from search results
   * @param {number} inspectorEvents - Events count from inspector
   */
  assertEventsCountMatch(searchEvents, inspectorEvents) {
    expect(searchEvents).toBe(inspectorEvents);
  }

  /**
   * Assert time taken is within tolerance
   * @param {number} searchTimeMs - Time from search results
   * @param {number} inspectorTimeMs - Time from inspector
   * @param {number} tolerancePercent - Tolerance percentage (default 20%)
   */
  assertTimeWithinTolerance(searchTimeMs, inspectorTimeMs, tolerancePercent = 20) {
    const tolerance = searchTimeMs * (tolerancePercent / 100);
    const diff = Math.abs(searchTimeMs - inspectorTimeMs);
    expect(diff).toBeLessThanOrEqual(tolerance);
  }
}

export default SearchJobInspectorPage;
