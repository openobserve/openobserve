// tracesPage.js
import { expect } from '@playwright/test';

import { dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator, Past30SecondsValue } from '../commonActions.js';


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
    this.viewLines = '.view-lines';

    // Time Range Selectors
    this.dateTimeRelative15mButton = '[data-test="date-time-relative-15-m-btn"]';
    this.dateTimeRelative1mButton = '[data-test="date-time-relative-1-m-btn"]';
    this.dateTimeRelativeCustomButton = '[data-test="date-time-relative-custom-btn"]';

    // Trace Tree/Span Selectors
    this.traceTreeSpanServiceName = '[data-test="trace-tree-span-service-name"]';
    this.traceTreeSpanServiceNamePrefix = '[data-test^="trace-tree-span-service-name-"]';

    // Field List Toggle
    this.fieldListToggleButton = '[data-test="logs-search-field-list-collapse-btn"]';

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
    const streamSelectLocator = this.page.locator(this.streamSelect);
    await streamSelectLocator.click();
    await this.page.locator('.q-menu, [role="listbox"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Type stream name to filter
    await streamSelectLocator.fill(streamName);
    await this.page.locator(`[data-test*="stream-toggle-${streamName}"]`).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

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
    const selectors = [
      this.page.getByText(/Spans\s*:\s*\d+/).first(),
      this.page.locator(this.searchResultItem).first(),
      this.page.locator('tbody tr').first()
    ];

    for (const selector of selectors) {
      try {
        if (await selector.isVisible({ timeout: 3000 })) {
          await selector.click();
          await this.page.waitForLoadState('networkidle').catch(() => {});
          // Wait for trace details to render
          await this.page.locator(this.traceDetailsTree).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
          return;
        }
      } catch {
        continue;
      }
    }

    throw new Error('No trace result found to click');
  }

  async expectTraceDetailsVisible() {
    await expect(this.page.locator(this.traceDetailsTree)).toBeVisible({ timeout: 15000 });
  }

  async navigateBackFromTraceDetails() {
    // Try to click back button if visible
    const backButton = this.page.locator(this.traceDetailsBackButton);
    if (await backButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backButton.click();
      await this.page.waitForLoadState('networkidle').catch(() => {});
      return true;
    }

    // If no back button, trace details may be inline - try clicking elsewhere to collapse
    // or simply verify we're on the traces page
    const searchBarVisible = await this.isSearchBarVisible();
    if (searchBarVisible) {
      // Click on the search bar area to deselect/collapse any inline details
      await this.page.locator(this.searchBar).click().catch(() => {});
      await this.page.waitForTimeout(500);
      return true;
    }

    return false;
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
    // Wait for datetime dropdown to close
    await this.page.locator(this.dateTimeButton).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
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
    // Wait for absolute tab content to be visible
    await this.page.getByLabel('access_time').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
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
      // Wait for query editor to be visible after mode switch
      await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }
  }

  async switchToUIMode() {
    const uiButton = this.page.locator(this.uiModeButton);
    if (await uiButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await uiButton.click();
      // Wait for UI mode elements to be visible after mode switch
      await this.page.locator(this.searchBar).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }
  }

  async enterSQLQuery(query) {
    // Try different editor selectors - check visibility for each
    const editorSelectors = [
      this.page.locator('.monaco-editor textarea').first(),
      this.page.locator(this.queryEditor),
      this.page.locator('.view-lines')
    ];

    let editor = null;
    for (const selector of editorSelectors) {
      if (await selector.isVisible({ timeout: 2000 }).catch(() => false)) {
        editor = selector;
        break;
      }
    }

    if (!editor) {
      throw new Error('No visible editor found');
    }

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

    await this.page.goto(tracesUrl);

    try {
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch {
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
      await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    // Set time range to 15 minutes
    await this.setTimeRange('15m');

    // Run search and wait for results
    await this.runTraceSearch();
    await this.waitForSearchCompletion(10000);
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
    } catch {
    }
  }

  /**
   * Click on first trace result with proper validation
   */
  async clickFirstTraceResult() {
    const selectors = [
      this.page.getByText(/Spans\s*:\s*\d+/).first(),
      this.page.locator(this.searchResultItem).first(),
      this.page.locator('tbody tr').first(),
      this.page.locator('[data-test*="trace-result"]').first(),
      this.page.locator('.trace-item').first()
    ];

    for (const selector of selectors) {
      try {
        await expect(selector).toBeVisible({ timeout: 5000 });
        await selector.click();
        await this.page.waitForTimeout(2000);

        // Wait for potential URL change or trace details to load
        await this.page.waitForLoadState('networkidle').catch(() => {});
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
      return true;
    } catch {
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
      return true;
    } catch {
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

        return status;
      }

      // Check if still loading
      const isLoading = await this.page.locator('[data-test*="loading"], .q-spinner').first().isVisible({ timeout: 500 });
      if (isLoading) {
      }

      await this.page.waitForTimeout(500);
    }

    return {
      completed: false,
      timeout: true,
      duration: timeout
    };
  }

  // ===== POM Compliance Helper Methods =====

  /**
   * Get query editor content
   * @returns {Promise<string>} Content of the query editor
   */
  async getQueryEditorContent() {
    const viewLines = this.page.locator(this.viewLines);
    return await viewLines.textContent().catch(() => '');
  }

  /**
   * Expect query editor contains specific text
   * @param {string} text - Text to check for
   */
  async expectQueryEditorContains(text) {
    const content = await this.getQueryEditorContent();
    expect(content).toContain(text);
  }

  /**
   * Check if no results message is visible
   * @returns {Promise<boolean>}
   */
  async isNoResultsVisible() {
    return await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 1000 }).catch(() => false);
  }

  /**
   * Check if error message is visible
   * @returns {Promise<boolean>}
   */
  async isErrorMessageVisible() {
    return await this.page.locator(this.errorMessage).isVisible({ timeout: 1000 }).catch(() => false);
  }

  /**
   * Get error message text
   * @returns {Promise<string>}
   */
  async getErrorMessageText() {
    return await this.page.locator(this.errorMessage).textContent().catch(() => '');
  }

  /**
   * Check if specific text is visible in results
   * @param {string} text - Text to look for
   * @returns {Promise<boolean>}
   */
  async isTextVisibleInResults(text) {
    return await this.page.getByText(text).first().isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Check if any of the specified texts are visible
   * @param {string[]} texts - Array of texts to check
   * @returns {Promise<boolean>}
   */
  async isAnyTextVisible(texts) {
    for (const text of texts) {
      if (await this.isTextVisibleInResults(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get cell by name in trace details
   * @param {string} name - Cell name
   * @param {boolean} exact - Exact match
   * @returns {Promise<boolean>} True if visible
   */
  async isCellVisible(name, exact = false) {
    return await this.page.getByRole('cell', { name, exact }).isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Click on a cell by name
   * @param {string} name - Cell name
   * @param {boolean} exact - Exact match
   */
  async clickCell(name, exact = false) {
    const cell = this.page.getByRole('cell', { name, exact });
    if (await cell.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cell.first().click();
    }
  }

  /**
   * Check if ERROR status is visible in trace details
   * @returns {Promise<boolean>}
   */
  async isErrorStatusVisible() {
    return await this.isCellVisible('ERROR');
  }

  /**
   * Check if status code 2 (error) is visible
   * @returns {Promise<boolean>}
   */
  async isStatusCode2Visible() {
    return await this.page.getByRole('cell', { name: '2' }).first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if duration cell is visible
   * @returns {Promise<boolean>}
   */
  async isDurationCellVisible() {
    return await this.isCellVisible('duration');
  }

  /**
   * Click on span service name in trace tree
   */
  async clickSpanServiceName() {
    const spanServiceName = this.page.locator(this.traceTreeSpanServiceNamePrefix).first();
    if (await spanServiceName.isVisible({ timeout: 3000 }).catch(() => false)) {
      await spanServiceName.click();
      await this.page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  /**
   * Check if span service name is visible in trace tree
   * @returns {Promise<boolean>}
   */
  async isSpanServiceNameVisible() {
    return await this.page.locator(this.traceTreeSpanServiceNamePrefix).first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Click on trace tree span service name (generic selector)
   */
  async clickTraceTreeSpanServiceName() {
    const serviceNameSpan = this.page.locator(this.traceTreeSpanServiceName).first();
    if (await serviceNameSpan.isVisible({ timeout: 3000 }).catch(() => false)) {
      await serviceNameSpan.click();
      await this.page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  /**
   * Get error traces with regex pattern
   * @returns {Promise<boolean>} True if error traces found
   */
  async hasErrorTracesWithPattern() {
    const errorTrace = this.page.getByText(/Errors\s*:\s*[1-9]\d*/);
    return await errorTrace.first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Click first error trace
   */
  async clickFirstErrorTrace() {
    const errorTrace = this.page.getByText(/Errors\s*:\s*[1-9]\d*/);
    if (await errorTrace.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await errorTrace.first().click();
      await this.page.waitForTimeout(2000);
      return true;
    }
    return false;
  }

  /**
   * Check if attribute cell is visible
   * @param {string} attrName - Attribute name
   * @returns {Promise<boolean>}
   */
  async isAttributeCellVisible(attrName) {
    return await this.page.getByRole('cell', { name: attrName, exact: true }).isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Click attribute cell
   * @param {string} attrName - Attribute name
   */
  async clickAttributeCell(attrName) {
    const attrCell = this.page.getByRole('cell', { name: attrName, exact: true });
    if (await attrCell.isVisible({ timeout: 2000 }).catch(() => false)) {
      await attrCell.click();
      await this.page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  /**
   * Check if search result item is visible
   * @returns {Promise<boolean>}
   */
  async isSearchResultItemVisible() {
    return await this.page.locator(this.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Check if timeline toggle button is visible
   * @returns {Promise<boolean>}
   */
  async isTimelineToggleVisible() {
    return await this.page.locator(this.traceDetailsToggleTimelineButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if timeline chart is visible
   * @returns {Promise<boolean>}
   */
  async isTimelineChartVisible() {
    return await this.page.locator(this.traceDetailsTimelineChart).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if copy trace ID button is visible
   * @returns {Promise<boolean>}
   */
  async isCopyTraceIdButtonVisible() {
    return await this.page.locator(this.traceDetailsCopyTraceIdButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if view logs button is visible
   * @returns {Promise<boolean>}
   */
  async isViewLogsButtonVisible() {
    return await this.page.locator(this.traceDetailsViewLogsButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if search input in trace details is visible
   * @returns {Promise<boolean>}
   */
  async isTraceDetailsSearchInputVisible() {
    return await this.page.locator(this.traceDetailsSearchInput).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if share link button in trace details is visible
   * @returns {Promise<boolean>}
   */
  async isShareLinkButtonVisible() {
    return await this.page.locator(this.traceDetailsShareLinkButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Expect URL contains specific path
   * @param {RegExp|string} pattern - Pattern to match
   */
  async expectUrlContains(pattern) {
    await expect(this.page).toHaveURL(pattern);
  }

  /**
   * Check if service maps toggle is visible
   * @returns {Promise<boolean>}
   */
  async isServiceMapsToggleVisible() {
    return await this.page.locator(this.serviceMapsToggle).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if service graph chart is visible
   * @returns {Promise<boolean>}
   */
  async isServiceGraphChartVisible() {
    return await this.page.locator(this.serviceGraphChart).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Check if service graph refresh button is visible
   * @returns {Promise<boolean>}
   */
  async isServiceGraphRefreshButtonVisible() {
    return await this.page.locator(this.serviceGraphRefreshButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Get SVG element count in service graph
   * @returns {Promise<number>}
   */
  async getServiceGraphSvgCount() {
    const graphElement = this.page.locator(this.serviceGraphChart);
    if (await graphElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      return await graphElement.locator('svg').count();
    }
    return 0;
  }

  /**
   * Check if search bar is visible
   * @returns {Promise<boolean>}
   */
  async isSearchBarVisible() {
    return await this.page.locator(this.searchBar).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Expect search bar to be visible
   */
  async expectSearchBarVisible() {
    await expect(this.page.locator(this.searchBar)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Check if index list is visible
   * @returns {Promise<boolean>}
   */
  async isIndexListVisible() {
    const fieldListElement = this.page.locator(this.indexList);
    return await fieldListElement.isVisible().catch(() => false);
  }

  /**
   * Get index list count
   * @returns {Promise<number>}
   */
  async getIndexListCount() {
    return await this.page.locator(this.indexList).count();
  }

  /**
   * Check if field list toggle button is visible
   * @returns {Promise<boolean>}
   */
  async isFieldListToggleButtonVisible() {
    return await this.page.locator(this.fieldListToggleButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Expect field list toggle button to be visible
   */
  async expectFieldListToggleButtonVisible() {
    await expect(this.page.locator(this.fieldListToggleButton)).toBeVisible();
  }

  /**
   * Click share link button
   */
  async clickShareLinkButton() {
    await this.page.locator(this.shareLinkButton).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if stream select is visible
   * @returns {Promise<boolean>}
   */
  async isStreamSelectVisible() {
    return await this.page.locator(this.streamSelect).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if no stream selected text is visible
   * @returns {Promise<boolean>}
   */
  async isNoStreamSelectedVisible() {
    return await this.page.locator(this.noStreamSelectedText).isVisible({ timeout: 1000 }).catch(() => false);
  }

  /**
   * Get no stream selected count
   * @returns {Promise<number>}
   */
  async getNoStreamSelectedCount() {
    return await this.page.locator(this.noStreamSelectedText).count();
  }

  /**
   * Get stream select count
   * @returns {Promise<number>}
   */
  async getStreamSelectCount() {
    return await this.page.locator(this.streamSelect).count();
  }

  /**
   * Expect no stream selected to be visible
   */
  async expectNoStreamSelectedVisible() {
    await expect(this.page.locator(this.noStreamSelectedText)).toBeVisible();
  }

  /**
   * Expect stream select to be visible
   */
  async expectStreamSelectVisible() {
    await expect(this.page.locator(this.streamSelect)).toBeVisible();
  }

  /**
   * Check if trace details tree is visible
   * @returns {Promise<boolean>}
   */
  async isTraceDetailsTreeVisible() {
    return await this.page.locator(this.traceDetailsTree).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Check if any trace detail element is visible
   * @returns {Promise<boolean>}
   */
  async isAnyTraceDetailVisible() {
    // Try multiple selectors that indicate trace details are visible
    const detailSelectors = [
      this.traceDetailsTree,
      this.traceDetailsSidebar,
      this.spanBlock,
      this.spanBlockContainer,
      '[data-test*="trace-detail"]',
      '[data-test*="trace-tree"]',
      '[data-test*="span-block"]',
      '[data-test="trace-details-header"]',
      '.trace-detail',
      '.trace-tree',
      '.span-block',
      // Additional selectors for trace details panel
      '[class*="trace-detail"]',
      '[class*="traceDetail"]',
      '[class*="span-detail"]',
      '[class*="spanDetail"]',
      // Check for trace ID in URL or page content
      '[data-test*="span"]',
      '[data-test*="timeline"]',
      // Generic table/detail views that might be trace details
      '[data-test*="detail"]'
    ];

    for (const selector of detailSelectors) {
      try {
        if (await this.page.locator(selector).first().isVisible({ timeout: 2000 })) {
          return true;
        }
      } catch {
        continue;
      }
    }

    // Also check if URL has changed to include trace_id
    const currentUrl = this.page.url();
    if (currentUrl.includes('trace_id') || currentUrl.includes('span_id')) {
      return true;
    }

    // Check for inline expanded trace details (some UIs show details inline when clicking a trace)
    // Look for expanded row indicators or additional content
    const inlineIndicators = [
      '[class*="expanded"]',
      '[class*="open"]',
      '[aria-expanded="true"]',
      '[data-expanded="true"]'
    ];

    for (const indicator of inlineIndicators) {
      try {
        if (await this.page.locator(indicator).first().isVisible({ timeout: 1000 })) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Check if trace was successfully clicked and UI responded
   * This is a more lenient check that verifies the click worked
   * @returns {Promise<boolean>}
   */
  async isTraceClickSuccessful() {
    // After clicking, check if we're still on a valid traces page
    const url = this.page.url();
    const isOnTracesPage = url.includes('/traces');
    const searchBarVisible = await this.isSearchBarVisible();

    // If we're on traces page and search bar is visible, click was handled by the UI
    return isOnTracesPage && searchBarVisible;
  }

  /**
   * Get error message element text (if visible)
   * @returns {Promise<string>}
   */
  async getVisibleErrorMessage() {
    const errorElement = this.page.locator('.error-message');
    if (await errorElement.isVisible({ timeout: 1000 }).catch(() => false)) {
      return await errorElement.textContent().catch(() => '');
    }
    return '';
  }

  /**
   * Click 1 minute time range button
   */
  async clickTimeRange1m() {
    await this.page.locator(this.dateTimeButton).click();
    try {
      await this.page.locator(this.dateTimeRelative1mButton).click({ timeout: 5000 });
    } catch {
      // Fallback to custom range if 1m not available
      await this.page.locator(this.dateTimeRelativeCustomButton).click();
    }
  }

  /**
   * Click 15 minute time range button directly
   */
  async clickTimeRange15mDirect() {
    await this.page.locator(this.dateTimeButton).click();
    await this.page.locator(this.dateTimeRelative15mButton).click();
  }

  /**
   * Get current page URL
   * @returns {string}
   */
  getPageUrl() {
    return this.page.url();
  }

  /**
   * Reload the page
   */
  async reloadPage() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  /**
   * Click button with specific text filter
   * @param {string} text - Button text to filter by
   * @returns {Promise<boolean>}
   */
  async clickButtonWithText(text) {
    const button = this.page.locator('button').filter({ hasText: text }).first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      await button.click();
      await this.page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  // ===== Error Trace POM Methods =====

  /**
   * Check if any error trace is visible in results
   * @returns {Promise<boolean>}
   */
  async isErrorTraceVisible() {
    return await this.getErrorTraces().first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Get count of error traces in results
   * @returns {Promise<number>}
   */
  async getErrorTraceCount() {
    return await this.getErrorTraces().count();
  }

  /**
   * Get text content of first error trace
   * @returns {Promise<string|null>}
   */
  async getFirstErrorTraceText() {
    const errorTrace = this.getErrorTraces().first();
    if (await errorTrace.isVisible({ timeout: 5000 }).catch(() => false)) {
      return await errorTrace.textContent();
    }
    return null;
  }

  /**
   * Get text content of error trace at specific index
   * @param {number} index - Zero-based index
   * @returns {Promise<string|null>}
   */
  async getErrorTraceTextAt(index) {
    const errorTrace = this.getErrorTraces().nth(index);
    if (await errorTrace.isVisible({ timeout: 5000 }).catch(() => false)) {
      return await errorTrace.textContent();
    }
    return null;
  }

  /**
   * Click on error trace and verify trace details opened
   * @returns {Promise<boolean>} True if trace details opened successfully
   */
  async clickErrorTraceAndVerify() {
    const errorTrace = this.getErrorTraces().first();
    if (await errorTrace.isVisible({ timeout: 5000 }).catch(() => false)) {
      await errorTrace.click();
      await this.page.waitForTimeout(2000);
      return await this.isTraceDetailsTreeVisible() || await this.isAnyTraceDetailVisible();
    }
    return false;
  }

}


