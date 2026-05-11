// searchJobInspectorPage.js
import { expect } from '@playwright/test';

const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

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

    // ===== SEARCH INSPECT DIALOG SELECTORS (SearchBar.vue) =====
    this.traceIdInput = '[data-test="search-inspect-trace-id-input"]';
    this.inspectSubmitBtn = '[data-test="search-inspect-submit-btn"]';

    // ===== SEARCH HISTORY SELECTORS (SearchHistory.vue) =====
    // Note: History rows use dynamic data-test with trace_id
    this.searchHistoryRow = '[data-test*="stream-association-table-"]';
    this.expandedListTabs = '[data-test="expanded-list-tabs"]';

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
    this.noEventsText = 'text=No data';
    // Exclude the search bar inspect button (data-test="logs-inspect-button")
    this.inspectBtnText = 'button[data-o2-btn]:has-text("Inspect"):not([data-test="logs-inspect-button"])';

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
    // Wait for page to finish loading (stats tiles load asynchronously)
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for inspector data to be loaded (tiles show values or error state)
   */
  async waitForInspectorDataLoaded() {
    // Wait for either the Results tile text or error banner to be visible
    // This indicates the API call has completed
    await Promise.race([
      this.page.locator(this.resultsTileText).waitFor({ state: 'visible', timeout: 15000 }),
      this.page.locator(this.inspectorErrorBanner).waitFor({ state: 'visible', timeout: 15000 })
    ]);
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
    await this.assertTraceIdInputVisible();
    await this.fillTraceIdInput(traceId);
    await this.clickInspectSubmitBtn();
    await this.waitForInspectorPage();
  }

  /**
   * Assert trace ID input is visible in dialog
   */
  async assertTraceIdInputVisible() {
    await expect(this.page.locator(this.traceIdInput)).toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert inspect submit button is visible in dialog
   */
  async assertInspectSubmitBtnVisible() {
    await expect(this.page.locator(this.inspectSubmitBtn)).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill the trace ID input field
   * @param {string} traceId - The trace ID to enter
   */
  async fillTraceIdInput(traceId) {
    await this.page.locator(this.traceIdInput).fill(traceId);
  }

  /**
   * Click the inspect submit button in dialog
   */
  async clickInspectSubmitBtn() {
    await this.page.locator(this.inspectSubmitBtn).click();
  }

  // ===== SEARCH HISTORY METHODS =====

  /**
   * Open Search History via more options menu
   */
  async openSearchHistory() {
    await this.openMoreOptionsMenu();
    await expect(this.page.locator(this.searchHistoryItemBtn)).toBeVisible({ timeout: 5000 });
    await this.page.locator(this.searchHistoryItemBtn).click();
    await this.page.waitForLoadState('networkidle');
    // Wait for history rows to load
    await this.page.locator(this.searchHistoryRow).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  /**
   * Expand the first history row to reveal Inspect button
   */
  async expandFirstHistoryRow() {
    const firstRow = this.page.locator(this.searchHistoryRow).first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();
    // Wait for expanded section to appear
    await expect(this.page.locator(this.expandedListTabs).first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Click Inspect button on a history row
   * Must expand row first to reveal the Inspect button
   */
  async inspectFromHistory() {
    await this.expandFirstHistoryRow();
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
    try {
      // Wait for history rows to load (they may take time to appear)
      await this.page.locator(this.searchHistoryRow).first().waitFor({ state: 'visible', timeout: 15000 });

      // Check if any history rows exist
      const rowCount = await this.page.locator(this.searchHistoryRow).count();
      testLogger.info(`Search history rows found: ${rowCount}`);
      if (rowCount === 0) {
        testLogger.info('No search history rows found');
        return false;
      }

      // Check if Inspect button exists in DOM
      const inspectCount = await this.page.locator(this.inspectBtnText).count();
      testLogger.info(`Inspect button elements found: ${inspectCount}`);

      // If we have rows and inspect buttons exist, the feature is available
      return inspectCount > 0;
    } catch (e) {
      testLogger.info(`hasHistoryInspectButtons error: ${e.message}`);
      return false;
    }
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
    // Wait for SQL content element to be visible (primary selector)
    const sqlContent = this.page.locator('[data-test="inspector-sql-query-content"]');
    await sqlContent.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Check if View Query button is visible
   * @returns {Promise<boolean>}
   */
  async isViewQueryVisible() {
    // Wait for View Query button to appear (loaded via async API call)
    try {
      await this.page.locator(this.viewQueryBtnText).waitFor({ state: 'visible', timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get SQL query content from dialog
   * @returns {Promise<string>}
   */
  async getSqlQueryContent() {
    // Wait for the SQL content element using data-test attribute
    const sqlLocator = this.page.locator('[data-test="inspector-sql-query-content"]');
    await sqlLocator.waitFor({ state: 'visible', timeout: 10000 });

    const content = await sqlLocator.textContent() || '';
    // Return empty string if showing fallback message (no SQL data available)
    if (content === 'No SQL query available') {
      return '';
    }
    return content;
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
    // Wait for page to stabilize after API response
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for at least one tile to appear
    await this.page.locator(this.resultsTileText).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    return {
      results: await this.page.locator(this.resultsTileText).isVisible({ timeout: 5000 }).catch(() => false),
      events: await this.page.locator(this.eventsTileText).isVisible({ timeout: 5000 }).catch(() => false),
      timeTaken: await this.page.locator(this.timeTakenTileText).isVisible({ timeout: 5000 }).catch(() => false),
      traceId: await this.page.locator(this.traceIdTileText).isVisible({ timeout: 5000 }).catch(() => false)
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

  // ===== ADDITIONAL METHODS FOR RESTORED TESTS =====

  /**
   * Check if Inspect button is visible in search results
   * @returns {Promise<boolean>}
   */
  async isInspectButtonVisible() {
    return await this.page.locator('[data-test="logs-inspect-button"]').isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Click the Inspect button in search results
   */
  async clickInspectButton() {
    await this.page.locator('[data-test="logs-inspect-button"]').click();
    await this.waitForInspectorPage();
  }

  /**
   * Assert Inspect button is visible
   */
  async assertInspectButtonVisible() {
    await expect(this.page.locator('[data-test="logs-inspect-button"]')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Select relative time range - Past 15 Minutes
   */
  async selectRelative15Minutes() {
    await this.page.locator('[data-test="date-time-btn"]').click();
    await this.page.waitForTimeout(500);
    await this.page.locator('[data-test="date-time-relative-15-m-btn"]').click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Select relative time range - Past 1 Hour
   */
  async selectRelative1Hour() {
    await this.page.locator('[data-test="date-time-btn"]').click();
    await this.page.waitForTimeout(500);
    await this.page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if History Inspect button is visible
   * @returns {Promise<boolean>}
   */
  async isHistoryInspectBtnVisible() {
    return await this.hasHistoryInspectButtons();
  }

  /**
   * Click History Inspect button
   */
  async clickHistoryInspectBtn() {
    await this.inspectFromHistory();
  }

  /**
   * Check if Results tile is visible
   * @returns {Promise<boolean>}
   */
  async isResultsTileVisible() {
    return await this.page.locator(this.resultsTileText).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if Events tile is visible
   * @returns {Promise<boolean>}
   */
  async isEventsTileVisible() {
    return await this.page.locator(this.eventsTileText).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if Time Taken tile is visible
   * @returns {Promise<boolean>}
   */
  async isTimeTakenTileVisible() {
    return await this.page.locator(this.timeTakenTileText).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if Trace ID tile is visible
   * @returns {Promise<boolean>}
   */
  async isTraceIdTileVisible() {
    return await this.page.locator(this.traceIdTileText).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if View Query button is visible
   * @returns {Promise<boolean>}
   */
  async isViewQueryBtnVisible() {
    return await this.isViewQueryVisible();
  }

  /**
   * Click View Query button
   */
  async clickViewQueryBtn() {
    await this.openViewQueryDialog();
  }

  /**
   * Get event row count from inspector table
   * @returns {Promise<number>}
   */
  async getEventRowCount() {
    return await this.page.locator(`${this.inspectorEventsTable} tr`).count();
  }

  /**
   * Check if events table has expandable rows
   * @returns {Promise<boolean>}
   */
  async hasExpandableRows() {
    return await this.page.locator(`${this.inspectorEventsTable} .q-expansion-item`).count() > 0;
  }

  /**
   * Expand first event row in inspector table
   */
  async expandFirstEventRow() {
    const expandBtn = this.page.locator(`${this.inspectorEventsTable} .q-expansion-item`).first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Check if duration bars exist in inspector
   * @returns {Promise<boolean>}
   */
  async hasDurationBars() {
    return await this.page.locator('.duration-bar, [class*="duration"]').count() > 0;
  }

  /**
   * Get duration bar colors/info
   * @returns {Promise<object[]>}
   */
  async getDurationBarColors() {
    const bars = this.page.locator('.duration-bar, [class*="duration"]');
    const count = await bars.count();
    const colors = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
      const bar = bars.nth(i);
      const style = await bar.getAttribute('style').catch(() => '');
      colors.push({ index: i, style });
    }
    return colors;
  }

  /**
   * Click close button
   */
  async clickCloseBtn() {
    await this.closeInspector();
  }

  /**
   * Click trace ID to copy to clipboard
   */
  async clickTraceIdToCopy() {
    const traceIdTile = this.page.locator(this.traceIdTileText).locator('..');
    await traceIdTile.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if copy success notification appeared
   * @returns {Promise<boolean>}
   */
  async hasCopySuccessNotification() {
    return await this.page.locator('text=Copied').isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if time range badge is visible
   * @returns {Promise<boolean>}
   */
  async isTimeRangeBadgeVisible() {
    return await this.page.locator('[data-test*="time-range"], .time-range-badge').isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Get time range badge text
   * @returns {Promise<string>}
   */
  async getTimeRangeBadgeText() {
    const badge = this.page.locator('[data-test*="time-range"], .time-range-badge').first();
    return await badge.textContent().catch(() => '');
  }

  /**
   * Check if timezone is displayed
   * @returns {Promise<boolean>}
   */
  async hasTimezoneDisplay() {
    return await this.page.locator('text=/UTC|GMT|[+-]\\d{2}:\\d{2}/').isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if SQL dialog is visible
   * @returns {Promise<boolean>}
   */
  async isSqlDialogVisible() {
    return await this.page.locator('pre, code, .q-dialog').isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if SQL content has expected keywords
   * @param {string} content - SQL content
   * @returns {boolean}
   */
  hasSqlKeywords(content) {
    const keywords = ['SELECT', 'FROM', 'WHERE', 'select', 'from', 'where'];
    return keywords.some(kw => content.includes(kw));
  }
}

export default SearchJobInspectorPage;
