// searchJobInspectorPage.js
import { expect } from '@playwright/test';

const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * Page Object Model for Search Job Inspector
 * Handles the Inspector page at /web/logs/inspector
 * Enterprise-only feature for viewing search query execution profiles
 */
export class SearchJobInspectorPage {
  constructor(page) {
    this.page = page;

    // Inspector Page URL
    this.inspectorPath = '/web/logs/inspector';

    // ===== INSPECT BUTTON SELECTORS (SearchResult.vue) =====
    this.inspectButton = '[data-test="logs-search-result-inspect-btn"]';
    this.searchResultText = '[data-test="logs-search-search-result"]';

    // ===== OVERFLOW MENU SELECTORS (SearchBar.vue) =====
    this.overflowMenuBtn = '[data-test="logs-search-bar-overflow-menu-btn"]';
    this.searchInspectMenuBtn = '[data-test="logs-search-bar-search-inspect-btn"]';

    // ===== SEARCH INSPECT DIALOG SELECTORS =====
    this.searchInspectDialog = '[data-test="search-inspect-dialog"]';
    this.traceIdInput = '[data-test="search-inspect-trace-id-input"]';
    this.inspectSubmitBtn = '[data-test="search-inspect-submit-btn"]';
    this.inspectCancelBtn = '[data-test="search-inspect-cancel-btn"]';

    // ===== UTILITIES MENU SELECTORS =====
    this.utilitiesMenuBtn = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.historyOption = 'text=History';

    // ===== SEARCH HISTORY SELECTORS (SearchHistory.vue) =====
    this.searchHistoryPanel = '[data-test="search-history-panel"]';
    this.historyInspectBtn = '[data-test="search-history-inspect-btn"]';

    // ===== INSPECTOR PAGE SELECTORS (SearchJobInspector.vue) =====
    this.inspectorPageTitle = 'text=Search Job Inspector';
    this.inspectorCloseBtn = '[data-test="search-inspector-close-btn"]';

    // Stats tiles
    this.resultsTile = '[data-test="search-inspector-results-tile"]';
    this.eventsTile = '[data-test="search-inspector-events-tile"]';
    this.timeTakenTile = '[data-test="search-inspector-time-taken-tile"]';
    this.traceIdTile = '[data-test="search-inspector-trace-id-tile"]';
    this.viewQueryBtn = '[data-test="search-inspector-view-query-btn"]';

    // Events table
    this.eventsTable = '[data-test="search-inspector-events-table"]';
    this.eventsTableRow = '[data-test="search-inspector-event-row"]';

    // SQL Query Dialog
    this.sqlQueryDialog = '[data-test="search-inspector-sql-dialog"]';
    this.sqlQueryContent = '[data-test="search-inspector-sql-content"]';
    this.sqlDialogCloseBtn = '[data-test="search-inspector-sql-close-btn"]';

    // Error states
    this.noEventsMessage = 'text=No events found';
    this.errorBanner = '[data-test="search-inspector-error"]';

    // Time range badge
    this.timeRangeBadge = '[data-test="search-inspector-time-range"]';

    // ===== DATE TIME SELECTORS (shared with LogsPage) =====
    this.dateTimeBtn = '[data-test="date-time-btn"]';
    this.relative15MinBtn = '[data-test="date-time-relative-15-m-btn"]';
    this.relative1HourBtn = '[data-test="date-time-relative-1-h-btn"]';

    // ===== INSPECTOR PAGE CONTENT SELECTORS =====
    this.resultsTileText = 'text=Results';
    this.eventsTileText = 'text=Events';
    this.timeTakenTileText = 'text=Time Taken';
    this.traceIdTileText = 'text=Trace ID';
    this.viewQueryBtnText = 'text=View Query';
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
    await this.page.waitForTimeout(3000);
  }

  /**
   * Check if the Inspect button is visible in search results
   * @returns {Promise<boolean>}
   */
  async isInspectButtonVisible() {
    try {
      const button = this.page.locator(this.inspectButton);
      return await button.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  /**
   * Click the Inspect button in search results to navigate to inspector
   */
  async clickInspectButton() {
    await this.page.locator(this.inspectButton).click();
    await this.page.waitForTimeout(3000);
  }

  // ===== SEARCH RESULTS PARSING =====

  /**
   * Get search results text (e.g., "Showing 1 to 50 out of X events in Y ms")
   * @returns {Promise<string>}
   */
  async getSearchResultsText() {
    try {
      const resultText = await this.page.locator('text=/Showing.*events.*ms/').textContent();
      return resultText || '';
    } catch {
      return '';
    }
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

  // ===== OVERFLOW MENU METHODS =====

  /**
   * Open the overflow menu (three dots)
   */
  async openOverflowMenu() {
    const menuBtn = this.page.locator(this.overflowMenuBtn);
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Click Search Inspect option in overflow menu
   */
  async clickSearchInspectOption() {
    await this.openOverflowMenu();
    const inspectOption = this.page.locator(this.searchInspectMenuBtn);
    if (await inspectOption.isVisible()) {
      await inspectOption.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Open Search Inspect dialog and enter a trace ID
   * @param {string} traceId - The trace ID to inspect
   */
  async inspectViaDialog(traceId) {
    await this.clickSearchInspectOption();

    const input = this.page.locator(this.traceIdInput);
    await input.fill(traceId);

    await this.page.locator(this.inspectSubmitBtn).click();
    await this.page.waitForTimeout(3000);
  }

  // ===== SEARCH HISTORY METHODS =====

  /**
   * Open Search History panel via utilities menu
   */
  async openSearchHistory() {
    const utilitiesBtn = this.page.locator(this.utilitiesMenuBtn);
    if (await utilitiesBtn.isVisible()) {
      await utilitiesBtn.click();
      await this.page.waitForTimeout(1000);

      const historyOption = this.page.locator(this.historyOption).first();
      if (await historyOption.isVisible()) {
        await historyOption.click();
        await this.page.waitForTimeout(2000);
      }
    }
  }

  /**
   * Click Inspect button on a history row
   * @param {number} rowIndex - The row index (0-based)
   */
  async inspectFromHistory(rowIndex = 0) {
    const inspectBtn = this.page.locator(this.historyInspectBtn).nth(rowIndex);
    if (await inspectBtn.isVisible()) {
      await inspectBtn.click();
      await this.page.waitForTimeout(3000);
    }
  }

  // ===== INSPECTOR PAGE METHODS =====

  /**
   * Check if on inspector page
   * @returns {Promise<boolean>}
   */
  async isOnInspectorPage() {
    try {
      const title = this.page.locator(this.inspectorPageTitle);
      return await title.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  /**
   * Get inspector stats values
   * @returns {Promise<{results: string, events: string, timeTaken: string, traceId: string}>}
   */
  async getInspectorStats() {
    const stats = {
      results: 'N/A',
      events: 'N/A',
      timeTaken: 'N/A',
      traceId: 'N/A'
    };

    try {
      // Get Results value
      const resultsLocator = this.page.locator('text=Results').locator('..').locator('text=/^\\d+$/').first();
      if (await resultsLocator.isVisible({ timeout: 3000 })) {
        stats.results = await resultsLocator.textContent();
      }
    } catch { /* continue */ }

    try {
      // Get Events value (format: X,XXX)
      const eventsLocator = this.page.locator('text=Events').locator('..').locator('text=/^[\\d,]+$/').first();
      if (await eventsLocator.isVisible({ timeout: 3000 })) {
        stats.events = await eventsLocator.textContent();
      }
    } catch { /* continue */ }

    try {
      // Get Time Taken value (format: Xms)
      const timeLocator = this.page.locator('text=Time Taken').locator('..').locator('text=/\\d+ms/').first();
      if (await timeLocator.isVisible({ timeout: 3000 })) {
        stats.timeTaken = await timeLocator.textContent();
      }
    } catch { /* continue */ }

    try {
      // Get Trace ID
      const traceIdLocator = this.page.locator('text=Trace ID').locator('..').locator('text=/[a-zA-Z0-9-]+/').first();
      if (await traceIdLocator.isVisible({ timeout: 3000 })) {
        stats.traceId = await traceIdLocator.textContent();
      }
    } catch { /* continue */ }

    return stats;
  }

  /**
   * Parse inspector stats to extract numeric values
   * @returns {Promise<{results: number, events: number, timeMs: number}>}
   */
  async parseInspectorStats() {
    const stats = await this.getInspectorStats();

    return {
      results: stats.results !== 'N/A' ? parseInt(stats.results.replace(/,/g, ''), 10) : null,
      events: stats.events !== 'N/A' ? parseInt(stats.events.replace(/,/g, ''), 10) : null,
      timeMs: stats.timeTaken !== 'N/A' ? parseInt(stats.timeTaken.replace('ms', ''), 10) : null
    };
  }

  /**
   * Compare search results with inspector stats
   * @returns {Promise<{eventsMatch: boolean, timeMatch: boolean, searchEvents: number, inspectorEvents: number, searchTimeMs: number, inspectorTimeMs: number}>}
   */
  async compareSearchAndInspectorStats() {
    // First get search results (should be called before navigating to inspector)
    const searchResults = await this.parseSearchResults();

    // Navigate to inspector and get stats
    await this.clickInspectButton();
    const inspectorStats = await this.parseInspectorStats();

    const searchEvents = parseInt(searchResults.eventsCount, 10);
    const searchTimeMs = parseInt(searchResults.timeMs, 10);
    const inspectorEvents = inspectorStats.events;
    const inspectorTimeMs = inspectorStats.timeMs;

    // Allow 20% tolerance for time comparison
    const timeTolerance = 0.2;
    const timeMatch = Math.abs(searchTimeMs - inspectorTimeMs) / searchTimeMs <= timeTolerance;

    return {
      eventsMatch: searchEvents === inspectorEvents,
      timeMatch,
      searchEvents,
      inspectorEvents,
      searchTimeMs,
      inspectorTimeMs
    };
  }

  /**
   * Click View Query button to open SQL dialog
   */
  async openSqlQueryDialog() {
    await this.page.locator(this.viewQueryBtn).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get SQL query from dialog
   * @returns {Promise<string>}
   */
  async getSqlQuery() {
    try {
      const sqlContent = this.page.locator(this.sqlQueryContent);
      if (await sqlContent.isVisible()) {
        return await sqlContent.textContent();
      }
    } catch { /* continue */ }
    return '';
  }

  /**
   * Close the inspector page
   */
  async closeInspector() {
    const closeBtn = this.page.locator(this.inspectorCloseBtn);
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Check if no events message is displayed
   * @returns {Promise<boolean>}
   */
  async hasNoEventsMessage() {
    try {
      const message = this.page.locator(this.noEventsMessage);
      return await message.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  /**
   * Check if error banner is displayed
   * @returns {Promise<boolean>}
   */
  async hasError() {
    try {
      const error = this.page.locator(this.errorBanner);
      return await error.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  // ===== DATE TIME METHODS =====

  /**
   * Click the date time button
   */
  async clickDateTimeBtn() {
    await this.page.locator(this.dateTimeBtn).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Select relative 15 minutes time range
   */
  async selectRelative15Minutes() {
    await this.clickDateTimeBtn();
    const btn = this.page.locator(this.relative15MinBtn);
    if (await btn.isVisible()) {
      await btn.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Select relative 1 hour time range
   */
  async selectRelative1Hour() {
    await this.clickDateTimeBtn();
    const btn = this.page.locator(this.relative1HourBtn);
    if (await btn.isVisible()) {
      await btn.click();
      await this.page.waitForTimeout(500);
    }
  }

  // ===== INSPECTOR TILE VERIFICATION METHODS =====

  /**
   * Check if Results tile is visible
   * @returns {Promise<boolean>}
   */
  async isResultsTileVisible() {
    return await this.page.locator(this.resultsTileText).isVisible().catch(() => false);
  }

  /**
   * Check if Events tile is visible
   * @returns {Promise<boolean>}
   */
  async isEventsTileVisible() {
    return await this.page.locator(this.eventsTileText).isVisible().catch(() => false);
  }

  /**
   * Check if Time Taken tile is visible
   * @returns {Promise<boolean>}
   */
  async isTimeTakenTileVisible() {
    return await this.page.locator(this.timeTakenTileText).isVisible().catch(() => false);
  }

  /**
   * Check if Trace ID tile is visible
   * @returns {Promise<boolean>}
   */
  async isTraceIdTileVisible() {
    return await this.page.locator(this.traceIdTileText).isVisible().catch(() => false);
  }

  /**
   * Check if View Query button is visible
   * @returns {Promise<boolean>}
   */
  async isViewQueryBtnVisible() {
    return await this.page.locator(this.viewQueryBtnText).isVisible().catch(() => false);
  }

  /**
   * Click View Query button (text-based)
   */
  async clickViewQueryBtn() {
    await this.page.locator(this.viewQueryBtnText).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if Search Inspect option is visible in overflow menu
   * @returns {Promise<boolean>}
   */
  async isSearchInspectOptionVisible() {
    return await this.page.locator(this.searchInspectMenuBtn).isVisible().catch(() => false);
  }

  /**
   * Check if Search Inspect dialog is visible
   * @returns {Promise<boolean>}
   */
  async isSearchInspectDialogVisible() {
    return await this.page.locator(this.searchInspectDialog).isVisible().catch(() => false);
  }

  /**
   * Click Search Inspect option and open dialog
   */
  async clickSearchInspectMenuOption() {
    await this.page.locator(this.searchInspectMenuBtn).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if History Inspect button is visible
   * @returns {Promise<boolean>}
   */
  async isHistoryInspectBtnVisible() {
    const btn = this.page.locator('[data-test*="inspect"], button:has-text("Inspect")').first();
    return await btn.isVisible().catch(() => false);
  }

  /**
   * Click History Inspect button
   */
  async clickHistoryInspectBtn() {
    const btn = this.page.locator('[data-test*="inspect"], button:has-text("Inspect")').first();
    await btn.click();
    await this.page.waitForTimeout(3000);
  }

  // ===== EVENTS TABLE METHODS =====

  /**
   * Check if events table is visible
   * @returns {Promise<boolean>}
   */
  async isEventsTableVisible() {
    return await this.page.locator(this.eventsTable).isVisible().catch(() => false);
  }

  /**
   * Get count of event rows in the table
   * @returns {Promise<number>}
   */
  async getEventRowCount() {
    try {
      const rows = this.page.locator(this.eventsTableRow);
      return await rows.count();
    } catch {
      return 0;
    }
  }

  /**
   * Check if any expandable rows exist in events table
   * @returns {Promise<boolean>}
   */
  async hasExpandableRows() {
    try {
      const expandIcons = this.page.locator('[data-test*="expand"], .q-expansion-item, [class*="expand"]');
      return (await expandIcons.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Click first expandable row to expand it
   */
  async expandFirstEventRow() {
    const expandIcon = this.page.locator('[data-test*="expand"], .q-expansion-item__toggle, [class*="expand-icon"]').first();
    if (await expandIcon.isVisible()) {
      await expandIcon.click();
      await this.page.waitForTimeout(500);
    }
  }

  // ===== DURATION BARS METHODS =====

  /**
   * Check if duration bars are visible
   * @returns {Promise<boolean>}
   */
  async hasDurationBars() {
    try {
      const bars = this.page.locator('[class*="duration"], [class*="progress"], [data-test*="duration-bar"]');
      return (await bars.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get duration bar colors (checks for color classes)
   * @returns {Promise<string[]>}
   */
  async getDurationBarColors() {
    const colors = [];
    try {
      const bars = this.page.locator('[class*="duration"], [class*="progress"]');
      const count = await bars.count();
      for (let i = 0; i < Math.min(count, 5); i++) {
        const bar = bars.nth(i);
        const className = await bar.getAttribute('class') || '';
        const style = await bar.getAttribute('style') || '';
        colors.push({ className, style });
      }
    } catch { /* continue */ }
    return colors;
  }

  // ===== CLOSE BUTTON METHODS =====

  /**
   * Check if close button is visible
   * @returns {Promise<boolean>}
   */
  async isCloseBtnVisible() {
    return await this.page.locator(this.inspectorCloseBtn).isVisible().catch(() => false);
  }

  /**
   * Click close button to go back
   */
  async clickCloseBtn() {
    const closeBtn = this.page.locator(this.inspectorCloseBtn);
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Get current URL before closing
   * @returns {Promise<string>}
   */
  async getCurrentUrl() {
    return this.page.url();
  }

  // ===== COPY TRACE ID METHODS =====

  /**
   * Click on trace ID tile to copy
   */
  async clickTraceIdToCopy() {
    const traceIdTile = this.page.locator(this.traceIdTileText).locator('..');
    if (await traceIdTile.isVisible()) {
      await traceIdTile.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Check if copy success notification appears
   * @returns {Promise<boolean>}
   */
  async hasCopySuccessNotification() {
    try {
      const notification = this.page.locator('text=/copied|clipboard/i, .q-notification');
      return await notification.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  // ===== TIME RANGE BADGE METHODS =====

  /**
   * Check if time range badge is visible
   * @returns {Promise<boolean>}
   */
  async isTimeRangeBadgeVisible() {
    return await this.page.locator(this.timeRangeBadge).isVisible().catch(() => false);
  }

  /**
   * Get time range badge text
   * @returns {Promise<string>}
   */
  async getTimeRangeBadgeText() {
    try {
      const badge = this.page.locator(this.timeRangeBadge);
      if (await badge.isVisible()) {
        return await badge.textContent();
      }
    } catch { /* continue */ }
    return '';
  }

  /**
   * Check if timezone is displayed
   * @returns {Promise<boolean>}
   */
  async hasTimezoneDisplay() {
    try {
      // Look for common timezone patterns like UTC, GMT, Asia/Kolkata, etc.
      const timezoneText = this.page.locator('text=/UTC|GMT|Asia|America|Europe|Pacific/');
      return await timezoneText.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  // ===== SQL QUERY DIALOG METHODS =====

  /**
   * Check if SQL query dialog is visible
   * @returns {Promise<boolean>}
   */
  async isSqlDialogVisible() {
    try {
      // Try data-test selector first, then fallback to text-based detection
      const dialog = this.page.locator(this.sqlQueryDialog);
      if (await dialog.isVisible({ timeout: 2000 })) {
        return true;
      }
      // Fallback: look for SQL content or dialog with SQL text
      const sqlText = this.page.locator('text=/SELECT|FROM|WHERE/i').first();
      return await sqlText.isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Get SQL query content from dialog
   * @returns {Promise<string>}
   */
  async getSqlQueryContent() {
    try {
      // Try data-test selector first
      const content = this.page.locator(this.sqlQueryContent);
      if (await content.isVisible({ timeout: 2000 })) {
        return await content.textContent();
      }
      // Fallback: look for pre/code element containing SQL
      const sqlCode = this.page.locator('pre, code, .sql-content, [class*="sql"]').first();
      if (await sqlCode.isVisible({ timeout: 2000 })) {
        return await sqlCode.textContent();
      }
    } catch { /* continue */ }
    return '';
  }

  /**
   * Close SQL query dialog
   */
  async closeSqlDialog() {
    try {
      // Try data-test close button first
      const closeBtn = this.page.locator(this.sqlDialogCloseBtn);
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        await this.page.waitForTimeout(500);
        return;
      }
      // Fallback: look for close button in dialog
      const fallbackClose = this.page.locator('.q-dialog button:has-text("Close"), .q-dialog .q-btn--flat').first();
      if (await fallbackClose.isVisible({ timeout: 2000 })) {
        await fallbackClose.click();
        await this.page.waitForTimeout(500);
        return;
      }
      // Last resort: press Escape
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    } catch { /* continue */ }
  }

  /**
   * Check if SQL content contains expected keywords
   * @param {string} sqlContent - The SQL content to check
   * @returns {boolean}
   */
  hasSqlKeywords(sqlContent) {
    const keywords = ['SELECT', 'FROM', 'WHERE'];
    const upperContent = sqlContent.toUpperCase();
    return keywords.some(keyword => upperContent.includes(keyword));
  }

  // ===== SCREENSHOT METHODS =====

  /**
   * Take a screenshot of the current page
   * @param {string} name - Screenshot name
   */
  async takeScreenshot(name) {
    await this.page.screenshot({ path: `test-results/${name}.png` });
  }

  // ===== ASSERTION HELPERS =====

  /**
   * Assert Inspector page title is visible
   */
  async assertInspectorPageVisible() {
    const title = this.page.locator(this.inspectorPageTitle);
    await expect(title).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert Inspect button is visible
   */
  async assertInspectButtonVisible() {
    const button = this.page.locator(this.inspectButton);
    await expect(button).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert events count matches between search and inspector
   * @param {number} searchEvents - Events count from search results
   * @param {number} inspectorEvents - Events count from inspector
   */
  async assertEventsCountMatch(searchEvents, inspectorEvents) {
    expect(searchEvents).toBe(inspectorEvents);
  }

  /**
   * Assert time taken is within tolerance
   * @param {number} searchTimeMs - Time from search results
   * @param {number} inspectorTimeMs - Time from inspector
   * @param {number} tolerancePercent - Tolerance percentage (default 20%)
   */
  async assertTimeWithinTolerance(searchTimeMs, inspectorTimeMs, tolerancePercent = 20) {
    const tolerance = searchTimeMs * (tolerancePercent / 100);
    const diff = Math.abs(searchTimeMs - inspectorTimeMs);
    expect(diff).toBeLessThanOrEqual(tolerance);
  }
}

export default SearchJobInspectorPage;
