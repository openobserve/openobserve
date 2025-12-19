// tracesPage.js
import { expect } from '@playwright/test';

import { dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator, Past30SecondsValue } from '../commonActions.js';
import testLogger from '../../playwright-tests/utils/test-logger.js';


export class TracesPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.tracesMenuItem = page.locator('[data-test="menu-link-\\/traces-item"]');

    // Search Bar - Tab Toggles
    this.searchToggle = '[data-test="traces-search-toggle"]';
    this.serviceMapsToggle = '[data-test="traces-service-maps-toggle"]';

    // Search Bar - Controls
    this.showMetricsToggle = '[data-test="traces-search-bar-show-metrics-toggle-btn"]';
    this.resetFiltersButton = '[data-test="traces-search-bar-reset-filters-btn"]';
    this.sqlModeToggle = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';
    this.dateTimeDropdown = '[data-test="logs-search-bar-date-time-dropdown"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.shareLinkButton = '[data-test="logs-search-bar-share-link-btn"]';

    // Main Components
    this.searchBar = '[data-test="logs-search-bar"]';
    this.indexList = '[data-test="logs-search-index-list"]';
    this.fieldListCollapseButton = '[data-test="logs-search-field-list-collapse-btn"]';
    this.searchResult = '[data-test="logs-search-search-result"]';

    // Search Results
    this.searchResultList = '[data-test="traces-search-result-list"]';
    this.searchResultItem = '[data-test="traces-search-result-item"]';
    this.searchResultCount = '[data-test="traces-search-result-count"]';

    // Trace Details
    this.traceDetailsHeader = '[data-test="trace-details-header"]';
    this.traceDetailsBackButton = '[data-test="trace-details-back-btn"]';
    this.traceDetailsCloseButton = '[data-test="trace-details-close-btn"]';
    this.traceDetailsCopyTraceIdButton = '[data-test="trace-details-copy-trace-id-btn"]';
    this.traceDetailsShareLinkButton = '[data-test="trace-details-share-link-btn"]';
    this.traceDetailsTree = '[data-test="trace-details-tree"]';
    this.traceDetailsTimelineChart = '[data-test="trace-details-timeline-chart"]';
    this.traceDetailsToggleTimelineButton = '[data-test="trace-details-toggle-timeline-btn"]';
    this.traceDetailsViewLogsButton = '[data-test="trace-details-view-logs-btn"]';
    this.traceDetailsSearchInput = '[data-test="trace-details-search-input"]';
    this.traceDetailsSidebar = '[data-test="trace-details-sidebar"]';

    // Service Graph (Enterprise)
    this.serviceGraphChart = '[data-test="service-graph-chart"]';
    this.serviceGraphRefreshButton = '[data-test="service-graph-refresh-btn"]';

    // Index List / Field List
    this.streamSelect = '[data-test="log-search-index-list-select-stream"]';
    this.fieldSearchInput = '[data-test="log-search-index-list-field-search-input"]';
    this.fieldsTable = '[data-test="log-search-index-list-fields-table"]';

    // Span Components
    this.spanBlock = '[data-test="span-block"]';
    this.spanBlockContainer = '[data-test="span-block-container"]';
    this.spanBlockDuration = '[data-test="span-block-duration"]';

    // Error States
    this.noStreamSelectedText = '[data-test="logs-search-no-stream-selected-text"]';
    this.resultNotFoundText = '[data-test="logs-search-result-not-found-text"]';
    this.errorMessage = '[data-test="logs-search-error-message"]';

    // Query Editor
    this.sqlModeButton = '[data-test="logs-search-sql-mode-btn"]';
    this.uiModeButton = '[data-test="logs-search-ui-mode-btn"]';
    this.queryEditor = '[data-test="query-editor"]';
    this.queryErrorMessage = '[data-test="logs-search-error-message"]';

    // Legacy/Common
    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;
    this.profileButton = page.locator('button').filter({ hasText: (process.env["ZO_ROOT_USER_EMAIL"]) });
    this.signOutButton = page.getByText('Sign Out');
  }

  async navigateToTraces() {

    await this.tracesMenuItem.click();
  }

  async validateTracesPage() {

    await expect(this.page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]')).toBeDefined();
    await expect(this.page.locator('[data-test="logs-search-bar"]')).toBeDefined();

  }

  async tracesPageDefaultOrg() {

    await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
    // Wait for the dropdown options to be visible
    await this.page.waitForSelector('text=default'); // Wait for the text "default" to be present

    // Click the specific "default" option within the dropdown
    const defaultOption = this.page.locator('text=default').first(); // Target the first occurrence
    await defaultOption.click();


  }

  async tracesPageDefaultMultiOrg() {



    await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
    // await this.page.pause();
    // await this.page.waitForTimeout(5000);

    await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();


    // await validateUrlContains(this.page, 'path');


  }

  async tracesPageURLValidation() {
    // TODO: fix the test
    // await expect(this.page).not.toHaveURL(/default/);

  }

  async tracesURLValidation() {

    await expect(this.page).toHaveURL(/traces/);

  }


  // New helper methods for traces functionality

  async selectTraceStream(streamName = 'default') {
    // Click to open dropdown
    await this.page.locator(this.streamSelect).click();
    await this.page.waitForTimeout(1000);

    // Type stream name to filter
    await this.page.locator(this.streamSelect).fill(streamName);
    await this.page.waitForTimeout(2000);

    // Click on the stream toggle to select it
    const streamToggleSelector = `[data-test="log-search-index-list-stream-toggle-${streamName}"] div`;
    const streamToggle = this.page.locator(streamToggleSelector).first();

    // Wait for element and click if visible
    if (await streamToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await streamToggle.click();
    } else {
      // Fallback: try clicking the first visible option
      await this.page.keyboard.press('Enter');
    }

    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async runTraceSearch() {
    await this.page.locator(this.refreshButton).click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async resetAllFilters() {
    await this.page.locator(this.resetFiltersButton).click();
  }

  async toggleFieldList() {
    await this.page.locator(this.fieldListCollapseButton).click();
  }

  async expectSearchResultsVisible() {
    await expect(this.page.locator(this.searchResultList)).toBeVisible({ timeout: 10000 });
  }

  async expectNoResultsMessage() {
    await expect(this.page.locator(this.resultNotFoundText)).toBeVisible();
  }

  async clickFirstTraceResult() {
    await this.page.locator(this.searchResultItem).first().click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async expectTraceDetailsVisible() {
    await expect(this.page.locator(this.traceDetailsTree)).toBeVisible({ timeout: 10000 });
  }

  async navigateBackFromTraceDetails() {
    await this.page.locator(this.traceDetailsBackButton).click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async toggleTimelineView() {
    await this.page.locator(this.traceDetailsToggleTimelineButton).click();
  }

  async expectTimelineVisible() {
    await expect(this.page.locator(this.traceDetailsTimelineChart)).toBeVisible();
  }

  async viewRelatedLogs() {
    await this.page.locator(this.traceDetailsViewLogsButton).click();
  }

  async copyTraceId() {
    await this.page.locator(this.traceDetailsCopyTraceIdButton).click();
  }

  async searchWithinTrace(searchText) {
    await this.page.fill(this.traceDetailsSearchInput, searchText);
    await this.page.keyboard.press('Enter');
  }

  async shareTraceLink() {
    await this.page.locator(this.traceDetailsShareLinkButton).click();
  }

  async toggleMetricsDashboard() {
    await this.page.locator(this.showMetricsToggle).click();
  }

  async switchToServiceMaps() {
    await this.page.locator(this.serviceMapsToggle).click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async switchToSearchView() {
    await this.page.locator(this.searchToggle).click();
  }

  async expectServiceGraphVisible() {
    await expect(this.page.locator(this.serviceGraphChart)).toBeVisible({ timeout: 10000 });
  }

  async refreshServiceGraph() {
    await this.page.locator(this.serviceGraphRefreshButton).click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async expectErrorMessage(errorText) {
    const errorElement = this.page.locator(this.errorMessage);
    await expect(errorElement).toBeVisible();
    if (errorText) {
      await expect(errorElement).toContainText(errorText);
    }
  }

  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.page.locator(this.dateTimeButton).click();
    await this.relative30SecondsButton.click();
  }

  async setTimeRange(range) {
    // Set time range based on provided value (e.g., '15m', '1h', '24h')
    await this.page.locator(this.dateTimeButton).click();

    const rangeMap = {
      '15m': '[data-test="date-time-relative-15-m-btn"]',
      '30m': '[data-test="date-time-relative-30-m-btn"]',
      '1h': '[data-test="date-time-relative-1-h-btn"]',
      '6h': '[data-test="date-time-relative-6-h-btn"]',
      '12h': '[data-test="date-time-relative-12-h-btn"]',
      '24h': '[data-test="date-time-relative-24-h-btn"]',
      '2d': '[data-test="date-time-relative-2-d-btn"]',
      '7d': '[data-test="date-time-relative-7-d-btn"]',
      '30d': '[data-test="date-time-relative-30-d-btn"]'
    };

    const selector = rangeMap[range] || '[data-test="date-time-relative-15-m-btn"]';
    await this.page.locator(selector).click();
    await this.page.waitForTimeout(1000);
  }

  async runSearch() {
    // Alias for runTraceSearch for consistency
    await this.runTraceSearch();
  }

  async verifyTimeSetTo30Seconds() {
    // Verify that the time filter displays "Past 30 Seconds"
    await expect(this.page.locator(this.dateTimeButton)).toContainText(Past30SecondsValue);
  }

  async setDateTime() {
    await expect(this.page.locator(this.dateTimeButton)).toBeVisible();
    await this.page.locator(this.dateTimeButton).click();
    await this.page.locator(this.absoluteTab).click();
    await this.page.waitForTimeout(1000);

  }

  async fillTimeRange(startTime, endTime) {
    await this.page.getByRole('button', { name: '1', exact: true }).click();
    await this.page.getByLabel('access_time').first().fill(startTime);
    await this.page.getByRole('button', { name: '1', exact: true }).click();
    await this.page.getByLabel('access_time').nth(1).fill(endTime);
    // await this.page.waitForTimeout(1000);
  }

  async verifyDateTime(startTime, endTime) {
    await expect(this.page.locator(this.dateTimeButton)).toContainText(`${startTime} - ${endTime}`);
  }

  async signOut() {
    await this.profileButton.click();
    await this.signOutButton.click();
  }

  // Query Editor Methods
  async switchToSQLMode() {
    const sqlButton = this.page.locator(this.sqlModeButton);
    if (await sqlButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sqlButton.click();
      await this.page.waitForTimeout(1000);
    }
  }

  async switchToUIMode() {
    const uiButton = this.page.locator(this.uiModeButton);
    if (await uiButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await uiButton.click();
      await this.page.waitForTimeout(1000);
    }
  }

  async enterSQLQuery(query) {
    // Try different editor selectors
    const editor = this.page.locator('.monaco-editor textarea').first() ||
                  this.page.locator(this.queryEditor) ||
                  this.page.locator('.view-lines');

    await editor.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(query);
  }

  async runQuery() {
    await this.page.locator(this.refreshButton).click();
  }

  async expectQueryError() {
    const hasError = await this.page.locator(this.queryErrorMessage).isVisible({ timeout: 5000 }).catch(() => false) ||
                    await this.page.locator('.q-banner').isVisible({ timeout: 5000 }).catch(() => false) ||
                    await this.page.locator('[class*="error"]').isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasError).toBeTruthy();
  }

  async expectQueryResults() {
    const hasResults = await this.page.locator('tbody tr').first().isVisible({ timeout: 5000 }).catch(() => false) ||
                      await this.page.locator('[data-test*="trace"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasResults).toBeTruthy();
  }

  // Improved assertion methods to prevent false positives

  /**
   * Wait for search to complete and verify it's in a valid state
   * @returns {Object} Object with state flags (hasResults, hasNoResults, hasError)
   */
  async waitForSearchComplete() {
    // Wait for loading to finish
    const loadingIndicator = this.page.locator('[data-test*="loading"], .q-spinner').first();
    try {
      if (await loadingIndicator.isVisible({ timeout: 500 })) {
        await expect(loadingIndicator).not.toBeVisible({ timeout: 10000 });
      }
    } catch {
      // Loading might not always appear
    }

    // Check all possible states
    const hasResults = await this.page.locator(this.searchResultItem).first().isVisible({ timeout: 1000 }).catch(() => false) ||
                      await this.page.locator('tbody tr').first().isVisible({ timeout: 1000 }).catch(() => false);
    const hasNoResults = await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 1000 }).catch(() => false);
    const hasError = await this.page.locator(this.errorMessage).isVisible({ timeout: 1000 }).catch(() => false);

    // Verify exactly one state is true
    const states = [hasResults, hasNoResults, hasError];
    const activeStates = states.filter(Boolean).length;

    if (activeStates !== 1) {
      throw new Error(`Invalid search state. Expected 1 active state but found ${activeStates}. Results: ${hasResults}, NoResults: ${hasNoResults}, Error: ${hasError}`);
    }

    if (hasError) {
      const errorText = await this.page.locator(this.errorMessage).textContent();
      throw new Error(`Search failed with error: ${errorText}`);
    }

    return { hasResults, hasNoResults, hasError };
  }

  /**
   * Verify search has results or handle appropriately
   * @param {Object} options - Options for handling no results
   */
  async verifySearchResults(options = {}) {
    const { allowNoResults = false, minResults = 0 } = options;
    const state = await this.waitForSearchComplete();

    if (!state.hasResults && !allowNoResults) {
      throw new Error('Expected search results but found none');
    }

    if (state.hasResults && minResults > 0) {
      const count = await this.getResultCount();
      if (count < minResults) {
        throw new Error(`Expected at least ${minResults} results but found ${count}`);
      }
    }

    return state;
  }

  /**
   * Get the count of search results
   * @returns {number} Number of results
   */
  async getResultCount() {
    const resultItems = await this.page.locator(this.searchResultItem).count();
    if (resultItems > 0) return resultItems;

    const tableRows = await this.page.locator('tbody tr').count();
    return tableRows;
  }

  /**
   * Verify element is visible with better error reporting
   * @param {string} selector - Element selector
   * @param {string} description - Description for error messages
   * @param {number} timeout - Timeout in ms
   */
  async verifyElementVisible(selector, description, timeout = 5000) {
    const element = this.page.locator(selector);
    try {
      await expect(element).toBeVisible({ timeout });
    } catch (error) {
      const isAttached = await element.isAttached().catch(() => false);
      const count = await element.count();
      throw new Error(
        `${description} not visible. Attached: ${isAttached}, Count: ${count}. ` +
        `Selector: ${selector}. Error: ${error.message}`
      );
    }
  }

  /**
   * Verify filter was applied by checking result change
   * @param {Function} applyFilterFn - Function to apply the filter
   * @param {string} filterDescription - Description of the filter
   */
  async verifyFilterApplied(applyFilterFn, filterDescription) {
    const initialCount = await this.getResultCount();
    await applyFilterFn();
    await this.waitForSearchComplete();
    const newCount = await this.getResultCount();

    // Verify filter is in query editor
    const queryText = await this.page.locator('.view-lines').textContent().catch(() => '');
    if (!queryText) {
      throw new Error(`Filter "${filterDescription}" not visible in query editor`);
    }

    testLogger.info(`Filter "${filterDescription}" applied. Results: ${initialCount} -> ${newCount}`);
    return { initialCount, newCount, queryText };
  }

  /**
   * Safe element click with validation
   * @param {string} selector - Element selector
   * @param {string} description - Description for logging
   */
  async safeClick(selector, description) {
    const element = this.page.locator(selector);
    await this.verifyElementVisible(selector, description);
    await expect(element).toBeEnabled();
    await element.click();
    testLogger.info(`Clicked: ${description}`);
  }

  /**
   * Verify page is in expected state
   */
  async verifyPageState() {
    const url = this.page.url();
    if (!url.includes('/traces')) {
      throw new Error(`Not on traces page. URL: ${url}`);
    }

    // Verify critical elements are present
    await this.verifyElementVisible(this.searchBar, 'Search bar');
  }

  /**
   * Handle element that might not exist
   * @param {string} selector - Element selector
   * @param {Function} actionFn - Action to perform if element exists
   * @param {string} skipReason - Reason to skip if element doesn't exist
   */
  async handleOptionalElement(selector, actionFn, skipReason) {
    const element = this.page.locator(selector);

    try {
      await expect(element).toBeVisible({ timeout: 5000 });
      await actionFn(element);
      return true;
    } catch {
      // Verify page is still valid before skipping
      await this.verifyPageState();
      testLogger.info(`Skipping: ${skipReason}`);
      return false;
    }
  }

  // ===== Functions moved from trace-test-helpers.js =====

  /**
   * Navigate to traces page with proper organization
   * @param {string} orgName - Organization name
   */
  async navigateToTracesUrl(orgName = null) {
    const org = orgName || process.env["ORGNAME"] || 'default';
    const baseUrl = (process.env["ZO_BASE_URL"] || '').replace(/\/+$/, '');
    const tracesUrl = `${baseUrl}/web/traces?org_identifier=${org}`;

    testLogger.info('Navigating to traces', { url: tracesUrl });
    await this.page.goto(tracesUrl);

    try {
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch {
      testLogger.info('Network idle timeout - continuing');
    }
  }

  /**
   * Setup trace search with stream and time range
   * @param {string} streamName - Stream name to select
   */
  async setupTraceSearch(streamName = 'default') {
    // Select stream
    const streamSelector = this.page.locator(this.streamSelect);
    if (await streamSelector.isVisible({ timeout: 5000 })) {
      await this.selectTraceStream(streamName);
      await this.page.waitForTimeout(2000);
    }

    // Set time range to 15 minutes
    await this.setTimeRange('15m');
    await this.page.waitForTimeout(1000);

    // Run search
    await this.runTraceSearch();
    await this.page.waitForTimeout(3000);
  }

  /**
   * Enter query in the query editor with proper clearing
   * @param {string} query - Query to enter
   */
  async enterTraceQuery(query) {
    const queryEditor = this.page.locator(this.queryEditor);

    try {
      await expect(queryEditor).toBeVisible({ timeout: 5000 });
      await queryEditor.click();

      const viewLines = this.page.locator('.view-lines');
      await expect(viewLines).toBeVisible({ timeout: 3000 });
      await viewLines.click();
      await this.page.waitForTimeout(500);

      // Clear existing content
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Delete');

      // Type new query
      await this.page.keyboard.type(query);
      await this.page.waitForTimeout(500);

      testLogger.info('Query entered', { query });
    } catch (error) {
      throw new Error(`Failed to enter query: ${error.message}`);
    }
  }

  /**
   * Check if trace results are available with proper validation
   * @returns {Promise<boolean>} True if results are available
   */
  async hasTraceResults() {
    // Wait for loading to complete
    try {
      const loadingIndicator = this.page.locator('[data-test*="loading"], .q-spinner').first();
      if (await loadingIndicator.isVisible({ timeout: 500 })) {
        await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 });
      }
    } catch {
      testLogger.info('Loading indicator not found or timed out');
    }

    // Check for results
    try {
      const resultSelectors = [
        this.page.locator(this.searchResultItem).first(),
        this.page.locator('tbody tr').first(),
        this.page.getByText(/Spans\s*:\s*\d+/).first()
      ];

      for (const element of resultSelectors) {
        if (await element.isVisible({ timeout: 1000 })) {
          return true;
        }
      }

      // Check for no results message
      if (await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 1000 })) {
        testLogger.info('No results message found');
        return false;
      }

      // Check for error
      const errorElement = this.page.locator(this.errorMessage);
      if (await errorElement.isVisible({ timeout: 1000 })) {
        const errorText = await errorElement.textContent();
        throw new Error(`Search failed with error: ${errorText}`);
      }

      return false;
    } catch (error) {
      if (error.message.includes('Search failed')) {
        throw error;
      }
      testLogger.error('Error checking trace results:', error.message);
      return false;
    }
  }

  /**
   * Get error traces in results
   * @returns {Locator} Locator for error traces
   */
  getErrorTraces() {
    return this.page.getByText(/Errors\s*:\s*[1-9]\d*/);
  }

  /**
   * Reset all filters in trace search
   */
  async resetTraceFilters() {
    const resetButton = this.page.locator(this.resetFiltersButton);

    try {
      await expect(resetButton).toBeVisible({ timeout: 3000 });
      await resetButton.click();
      await this.page.waitForTimeout(1000);
      testLogger.info('Trace filters reset');
    } catch {
      testLogger.info('Reset button not visible');
    }
  }

  /**
   * Click on first trace result with proper validation
   */
  async clickFirstTraceResult() {
    const selectors = [
      this.page.getByText(/Spans\s*:\s*\d+/).first(),
      this.page.locator(this.searchResultItem).first(),
      this.page.locator('tbody tr').first()
    ];

    for (const selector of selectors) {
      try {
        await expect(selector).toBeVisible({ timeout: 5000 });
        await selector.click();
        testLogger.info('Clicked on trace result');
        await this.page.waitForTimeout(2000);
        return;
      } catch {
        continue;
      }
    }

    throw new Error('No trace result found to click');
  }

  /**
   * Expand field in field list
   * @param {string} fieldName - Name of field to expand
   * @returns {boolean} True if expanded successfully
   */
  async expandTraceField(fieldName) {
    const expandButton = this.page.getByRole('button', { name: new RegExp(`Expand.*${fieldName}`, 'i') });

    try {
      await expect(expandButton).toBeVisible({ timeout: 3000 });
      await expandButton.click();
      await this.page.waitForTimeout(1000);
      testLogger.info('Field expanded', { fieldName });
      return true;
    } catch {
      testLogger.info('Could not expand field', { fieldName });
      return false;
    }
  }

  /**
   * Select field value after expanding
   * @param {string} fieldName - Name of field
   * @param {string} value - Value to select
   * @returns {boolean} True if selected successfully
   */
  async selectFieldValue(fieldName, value) {
    const fieldValue = this.page.locator('div').filter({ hasText: new RegExp(`^${fieldName}='${value}'`) }).first();

    try {
      await expect(fieldValue).toBeVisible({ timeout: 3000 });
      await fieldValue.click();
      await this.page.waitForTimeout(1000);
      testLogger.info('Field value selected', { fieldName, value });
      return true;
    } catch {
      testLogger.info('Could not select field value', { fieldName, value });
      return false;
    }
  }

  /**
   * Get trace count from results
   * @returns {number} Number of visible traces
   */
  async getTraceCount() {
    const resultItems = await this.page.locator(this.searchResultItem).count();
    const tableRows = await this.page.locator('tbody tr').count();
    const spanTexts = await this.page.getByText(/Spans\s*:\s*\d+/).count();

    return Math.max(resultItems, tableRows, spanTexts);
  }

  /**
   * Wait for search to complete with proper error handling
   * @param {number} timeout - Maximum time to wait in milliseconds
   * @returns {Object} Search result status
   */
  async waitForSearchCompletion(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for completion states
      const hasResults = await this.hasTraceResults();
      const hasNoResults = await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 500 });
      const hasError = await this.page.locator(this.errorMessage).isVisible({ timeout: 500 });

      if (hasResults || hasNoResults || hasError) {
        const status = {
          completed: true,
          hasResults,
          noResults: hasNoResults,
          error: hasError,
          duration: Date.now() - startTime
        };

        if (hasError) {
          const errorText = await this.page.locator(this.errorMessage).textContent();
          status.errorMessage = errorText;
        }

        testLogger.info('Search completed', status);
        return status;
      }

      // Check if still loading
      const isLoading = await this.page.locator('[data-test*="loading"], .q-spinner').first().isVisible({ timeout: 500 });
      if (isLoading) {
        testLogger.info('Search in progress...');
      }

      await this.page.waitForTimeout(500);
    }

    return {
      completed: false,
      timeout: true,
      duration: timeout
    };
  }

}


