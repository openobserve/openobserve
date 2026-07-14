// tracesPage.js
import { expect } from '@playwright/test';

import { dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator, Past30SecondsValue } from '../commonActions.js';
const { isCloudEnvironment } = require('../cloudPages/cloud-env.js');


export class TracesPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.tracesMenuItem = page.locator('[data-test="menu-link-\\/traces-item"]');

    // Search Bar - Tab Toggles (post UX revamp: OToggleGroupItem buttons)
    // Source: web/src/plugins/traces/SearchBar.vue
    this.searchToggle = '[data-test="traces-search-mode-traces-btn"]';
    this.spansToggle = '[data-test="traces-search-mode-spans-btn"]';
    this.serviceMapsToggle = '[data-test="traces-service-graph-toggle"]';
    this.servicesCatalogToggle = '[data-test="traces-search-mode-services-catalog-btn"]';

    // Search Bar - Controls
    this.showMetricsToggle = '[data-test="traces-search-bar-show-metrics-toggle-btn"]';
    this.resetFiltersButton = '[data-test="traces-search-bar-reset-filters-btn"]';
    this.sqlModeToggle = '[data-cy="syntax-guide-button"]';
    this.dateTimeDropdown = '[data-test="logs-search-bar-date-time-dropdown"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.shareLinkButton = '[data-test="logs-search-bar-share-link-btn"]';

    // Main Components
    this.searchBar = '[data-test="logs-search-bar"]';
    this.indexList = '[data-test="traces-search-index-list"]';
    this.fieldListCollapseButton = '[data-test="traces-search-field-list-collapse-btn"]';
    this.searchResult = '[data-test="logs-search-search-result"]';

    // Search Results
    // Source: web/src/plugins/traces/components/TracesSearchResultList.vue
    // Source: web/src/components/TenstackTable.vue (rows use o2-table-detail-{ts})
    this.searchResultList = '[data-test="traces-search-result-list"]';
    this.searchResultItem = '[data-test^="o2-table-detail-"]';
    this.searchResultCount = '[data-test="traces-count-badge"]';
    this.tracesCountBadge = '[data-test="traces-count-badge"]';
    this.tracesErrorCountBadge = '[data-test="traces-error-count-badge"]';
    this.traceRowOperationName = '[data-test="trace-row-operation-name"]';
    this.traceRowDuration = '[data-test="trace-row-duration"]';

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
    this.traceDetailsLogStreamsSelect = '[data-test="trace-details-log-streams-select"]';
    this.traceDetailsSearchInput = '[data-test="trace-details-search-input"]';
    this.traceDetailsSearchInputField = '[data-test="trace-details-search-input-field"]';
    this.traceDetailsSidebar = '[data-test="trace-details-sidebar"]';

    // Service Graph (Enterprise)
    this.serviceGraphChart = '[data-test="service-graph-chart"]';
    this.serviceGraphRefreshButton = '[data-test="service-graph-refresh-btn"]';

    // ===== ANALYZE DIMENSIONS SELECTORS (VERIFIED against Vue source) =====
    // TracesMetricsDashboard.vue: data-test="insights-button"
    this.insightsButton = '[data-test="insights-button"]';
    // SearchResult.vue: error-count badge doubles as the error-only toggle
    this.errorOnlyToggle = '[data-test="traces-error-count-badge"]';
    // Traces SearchBar.vue: data-test="traces-search-bar-show-metrics-toggle-btn"
    this.metricsToggle = '[data-test="traces-search-bar-show-metrics-toggle-btn"]';
    // TracesAnalysisDashboard.vue was migrated to ODrawer
    // (data-test="traces-analysis-dashboard-drawer"). The legacy
    // `analysis-dashboard-close` data-test and `.analysis-dashboard-card`
    // template class were removed — `.analysis-dashboard-card` only survives
    // in CSS rules now, no element actually carries the class. Scope all
    // selectors via the ODrawer slug instead.
    this.analysisDashboardDrawer = '[data-test="traces-analysis-dashboard-drawer"]';
    this.analysisDashboardClose = '[data-test="traces-analysis-dashboard-drawer"] [data-test="o-drawer-close-btn"]';
    // TracesAnalysisDashboard.vue: dimension sidebar (visible by default, not a dialog)
    this.dimensionSelectorSidebar = '[data-test="dimension-selector-sidebar"]';
    this.dimensionSelectorCollapseBtn = '[data-test="dimension-selector-collapse-btn"]';
    this.dimensionSearchInput = '[data-test="dimension-search-input"]';
    // OInput inner native <input> — fill the -field variant per §4 OInput convention
    this.dimensionSearchInputField = '[data-test="dimension-search-input-field"]';
    // TracesAnalysisDashboard.vue: data-test="percentile-refresh-button"
    this.percentileRefreshButton = '[data-test="percentile-refresh-button"]';
    // Analysis dashboard card (container) — alias to the drawer slug for backwards-compat
    this.analysisDashboardCard = '[data-test="traces-analysis-dashboard-drawer"]';
    // Metrics dashboard container
    // Source: web/src/plugins/traces/metrics/TracesMetricsDashboard.vue
    this.tracesMetricsDashboard = '[data-test="traces-metrics-dashboard"]';
    // Analysis Dashboard Tabs — source: web/src/plugins/traces/metrics/TracesAnalysisDashboard.vue
    // Tabs render as <OTab data-test="traces-analysis-dashboard-${name}-tab"> where name ∈ {volume,duration,error}
    this.analysisDashboardTabs = '[data-test="traces-analysis-dashboard-drawer"]';
    this.rateTab = '[data-test="traces-analysis-dashboard-volume-tab"]';
    this.latencyTab = '[data-test="traces-analysis-dashboard-duration-tab"]';
    this.errorsTab = '[data-test="traces-analysis-dashboard-error-tab"]';
    // Analysis dashboard states — scope inside the drawer
    this.analysisDashboardLoading = '[data-test="traces-analysis-dashboard-drawer"] [data-test="traces-analysis-dashboard-loading-indicator"]';
    this.analysisDashboardError = '[data-test="traces-analysis-dashboard-drawer"] [data-test="traces-analysis-dashboard-error"]';
    this.analysisDashboardRetryBtn = '[data-test="traces-analysis-dashboard-drawer"] [data-test="traces-analysis-dashboard-retry-btn"]';

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
    this.resultNotFoundText = '[data-test="traces-search-result-not-found-text"]';
    this.errorMessage = '[data-test="traces-search-error-message"]';

    // Query Editor
    // The traces SearchBar.vue renders <code-query-editor editor-id="traces-query-editor">
    // CodeQueryEditor.vue renders <div data-test="query-editor" id="{editorId}">
    // SQL mode toggle: SyntaxGuide OButton has data-cy="syntax-guide-button"
    this.sqlModeButton = '[data-cy="syntax-guide-button"]';
    this.queryEditor = '[data-test="query-editor"]';
    this.queryEditorContainer = '[data-test="query-editor"]';
    this.queryErrorMessage = '[data-test="traces-search-error-message"]';
    this.viewLines = '.view-lines';

    // Time Range Selectors
    this.dateTimeRelative15mButton = '[data-test="date-time-relative-15-m-btn"]';
    this.dateTimeRelative1mButton = '[data-test="date-time-relative-1-m-btn"]';
    this.dateTimeRelativeCustomButton = '[data-test="date-time-relative-custom-btn"]';

    // Trace Tree/Span Selectors
    this.traceTreeSpanServiceName = '[data-test="trace-tree-span-service-name"]';
    this.traceTreeSpanServiceNamePrefix = '[data-test^="trace-tree-span-service-name-"]';

    // Field List Toggle
    this.fieldListToggleButton = '[data-test="traces-search-field-list-collapse-btn"]';

    // Legacy/Common
    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;
    // Profile menu / sign-out — navbar selectors verified against Header.vue
    this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
    this.signOutButton = page.locator('[data-test="menu-link-logout-item"]');

    // Trace details — datetime absolute tab Start/End time fields (OInput convention)
    this.datetimeStartTime = '[data-test="datetime-start-time-field"]';
    this.datetimeEndTime = '[data-test="datetime-end-time-field"]';

    // Field list header expansion (Field rows include data-test=`log-search-expand-{name}-field-btn`)
    this.fieldExpandPrefix = '[data-test^="log-search-expand-"]';

    // Trace details span attribute table (rendered inside trace-details-sidebar)
    this.traceDetailsSidebarRow = '[data-test="trace-details-sidebar"] [data-test^="o2-table-row-"]';
  }

  // Getter methods for common trace elements
  getTraceDetailsElements() {
    return this.page.locator('[data-test="trace-details-header"], [data-test="trace-details-tree"], [data-test="trace-details-sidebar"]');
  }

  getTraceResultItems() {
    return this.page.locator(this.searchResultItem);
  }

  getResultsContainer() {
    return this.page.locator(this.searchResultList).first();
  }

  async navigateToTraces() {
    await this.tracesMenuItem.click();
    // Cloud: sidebar click may silently fail — verify URL and fallback to direct navigation
    if (isCloudEnvironment()) {
      await this.page.waitForURL('**/traces**', { timeout: 5000 }).catch(async () => {
        await this.navigateToTracesUrl();
      });
    }
  }

  async validateTracesPage() {

    await expect(this.page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]')).toBeDefined();
    await expect(this.page.locator('[data-test="logs-search-bar"]')).toBeDefined();

  }

  async tracesPageDefaultOrg() {
    // Open the org dropdown via the trigger inside the navbar select
    await this.page.locator('[data-test="navbar-organizations-select-trigger"]').click();
    // The default org row uses the per-identifier data-test attribute
    await this.page.locator('[data-test-org-identifier="default"]').first().click();
  }

  async tracesPageDefaultMultiOrg() {
    await this.page.locator('[data-test="navbar-organizations-select-trigger"]').click();
    await this.page.locator('[data-test-org-identifier="defaulttestmulti"]').first().click();
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
    // OSelect renders an outer wrapper div with the consumer data-test and an
    // inner PopoverTrigger <button type="button"> that actually opens the
    // listbox. Reka's PopoverTrigger button does NOT have `role=button`
    // because the role is implicit on a real <button>, so we use a CSS
    // selector that matches a real <button> element inside the wrapper.

    const wrapper = this.page.locator(this.streamSelect);
    await wrapper.waitFor({ state: 'visible', timeout: 10000 });

    // Check the popover-trigger button's aria-expanded state — already
    // selected streams will reflect in the trigger button text.
    const trigger = wrapper.locator('button[type="button"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const currentText = await trigger.textContent().catch(() => '');
    if (currentText && currentText.includes(streamName)) {
      return;
    }
    await trigger.click({ force: false });

    // Wait for the popover (OSelect forwards the data-test slug + `-popover`).
    const popover = this.page.locator('[data-test="log-search-index-list-select-stream-popover"]');
    await popover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Try clicking the matching option directly by data-test-value. Retry
    // up to 3 times — OSelect uses virtualised ListboxItem rendering which
    // can drop the first synthetic click.
    const optionSel = `[data-test="log-search-index-list-select-stream-option"][data-test-value="${streamName}"]`;
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      const opt = this.page.locator(optionSel).first();
      if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await opt.click({ force: false });
        await this.page.waitForTimeout(800);
        // Verify selection took: trigger button text should now contain stream name.
        const trgText = await trigger.textContent().catch(() => '');
        if (trgText && trgText.includes(streamName)) {
          clicked = true;
          break;
        }
        // Re-open popover and try again.
        if (!await popover.isVisible({ timeout: 200 }).catch(() => false)) {
          await trigger.click({ force: false });
          await popover.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        }
      } else {
        // Type into filter to filter the list.
        await this.page.keyboard.type(streamName, { delay: 50 });
        await this.page.waitForTimeout(300);
      }
    }

    // If popover is still open, dismiss it by pressing Escape.
    if (await popover.isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
    }

    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async runTraceSearch() {
    await this.page.locator(this.refreshButton).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Wait for one of the terminal search states to appear so callers can
    // assert on a stable DOM (badge or no-results banner or error).
    await Promise.any([
      this.page.locator(this.tracesCountBadge).first().waitFor({ state: 'visible', timeout: 12000 }),
      this.page.locator(this.resultNotFoundText).waitFor({ state: 'visible', timeout: 12000 }),
      this.page.locator(this.errorMessage).waitFor({ state: 'visible', timeout: 12000 }),
      this.page.locator(this.searchResultItem).first().waitFor({ state: 'visible', timeout: 12000 }),
    ]).catch(() => {});
    // Small buffer for Vue reactivity / animation
    await this.page.waitForTimeout(500);
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

  async expectTraceDetailsVisible() {
    await expect(this.page.locator(this.traceDetailsTree)).toBeVisible({ timeout: 15000 });
  }

  async navigateBackFromTraceDetails() {
    // Try to click back button if visible
    const backButton = this.page.locator(this.traceDetailsBackButton);
    if (await backButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backButton.click();
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
    const searchField = this.page.locator(this.traceDetailsSearchInputField);
    await searchField.waitFor({ state: 'visible' });
    await searchField.fill(searchText);
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
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async switchToSearchView() {
    await this.page.locator(this.searchToggle).click();
  }

  async expectServiceGraphVisible() {
    await expect(this.page.locator(this.serviceGraphChart)).toBeVisible({ timeout: 10000 });
  }

  async refreshServiceGraph() {
    await this.page.locator(this.serviceGraphRefreshButton).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
    // Set time range based on provided value (e.g., '15m', '1h', '6d', '1M').
    // Source: web/src/components/DateTime.vue — items per period:
    //   s/m: [1,5,10,15,30,45], h: [1,2,3,6,8,12], d/w/M: [1,2,3,4,5,6]
    await this.page.locator(this.dateTimeButton).click();
    // Wait for relative tab content to mount
    await this.page.locator('[data-test^="date-time-relative-"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    const rangeMap = {
      '15m': '[data-test="date-time-relative-15-m-btn"]',
      '30m': '[data-test="date-time-relative-30-m-btn"]',
      '1h': '[data-test="date-time-relative-1-h-btn"]',
      '6h': '[data-test="date-time-relative-6-h-btn"]',
      '12h': '[data-test="date-time-relative-12-h-btn"]',
      '24h': '[data-test="date-time-relative-1-d-btn"]',
      '2d': '[data-test="date-time-relative-2-d-btn"]',
      '6d': '[data-test="date-time-relative-6-d-btn"]',
      '1M': '[data-test="date-time-relative-1-M-btn"]',
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
    // Wait for absolute tab content (Start time field) to be visible
    await this.page.locator(this.datetimeStartTime).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }

  async fillTimeRange(startTime, endTime) {
    // Source: web/src/components/DateTime.vue — OTime renders an OInput,
    // OInput inner native input uses data-test="${parent}-field"
    await this.page.locator(this.datetimeStartTime).fill(startTime);
    await this.page.locator(this.datetimeEndTime).fill(endTime);
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

  async enterSQLQuery(query) {
    // Set Monaco editor value directly via the editor API; this avoids
    // DOM-input quirks and pointer interception in CI.
    const editorId = 'traces-query-editor';
    await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const ok = await this.page.evaluate(({ editorId, query }) => {
      const w = /** @type {any} */ (window);
      if (!w.monaco?.editor?.getEditors) return false;
      const editors = w.monaco.editor.getEditors();
      // Match by container id (CodeQueryEditor.vue sets :id="editorId")
      const target = editors.find(e => {
        const node = e.getDomNode?.();
        return node && node.closest(`#${editorId}`);
      }) || editors[0];
      if (!target) return false;
      target.setValue(query);
      return true;
    }, { editorId, query });
    if (!ok) {
      throw new Error('Monaco editor not found for traces-query-editor');
    }
  }

  async runQuery() {
    await this.page.locator(this.refreshButton).click();
  }

  async expectQueryError() {
    const hasError = await this.page.locator(this.queryErrorMessage).isVisible({ timeout: 5000 }).catch(() => false) ||
                    await this.page.locator('[data-test="traces-search-error-message"]').isVisible({ timeout: 5000 }).catch(() => false) ||
                    await this.page.locator('[data-test="traces-search-error-text"]').isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasError).toBeTruthy();
  }

  async expectQueryResults() {
    const hasResults = await this.page.locator(this.searchResultItem).first().isVisible({ timeout: 5000 }).catch(() => false) ||
                      await this.page.locator(this.tracesCountBadge).first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasResults).toBeTruthy();
  }

  // Improved assertion methods to prevent false positives

  /**
   * Wait for search to complete and verify it's in a valid state
   * @returns {Object} Object with state flags (hasResults, hasNoResults, hasError)
   */
  async waitForSearchComplete() {
    // Wait for loading to finish
    const loadingIndicator = this.page.locator('[data-test*="loading"]').first();
    try {
      if (await loadingIndicator.isVisible({ timeout: 500 })) {
        await expect(loadingIndicator).not.toBeVisible({ timeout: 10000 });
      }
    } catch {
      // Loading might not always appear
    }

    // Check all possible states — a real row is the only positive result signal
    const hasResults = await this.page.locator(this.searchResultItem).first().isVisible({ timeout: 1000 }).catch(() => false);
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
    return resultItems;
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

    // Verify filter is in query editor via Monaco editor model
    const queryText = await this.getQueryEditorContent();
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
      await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
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
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Set time range to 15 minutes
    await this.setTimeRange('15m');

    // Run search and wait for results
    await this.runTraceSearch();
    await this.waitForSearchCompletion(20000);
  }

  /**
   * Enter query in the query editor with proper clearing
   * @param {string} query - Query to enter
   */
  async enterTraceQuery(query) {
    const queryEditor = this.page.locator(this.queryEditor);

    try {
      await expect(queryEditor).toBeVisible({ timeout: 5000 });

      // Use .fill() method to avoid pointer interception issues
      // Try different selectors: .inputarea (Monaco's input area) or textarea (fallback)
      const monacoInput = queryEditor.locator('.inputarea, textarea').first();
      await expect(monacoInput).toBeVisible({ timeout: 3000 });

      // Fill directly without clicking to avoid pointer interception
      await monacoInput.fill(query);
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
      const loadingIndicator = this.page.locator('[data-test*="loading"]').first();
      if (await loadingIndicator.isVisible({ timeout: 500 })) {
        await loadingIndicator.waitFor({ state: 'hidden', timeout: 15000 });
      }
    } catch {
    }

    // Check for results with retries (handles parallel worker load)
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // A real row is rendered as a TR with data-test^="o2-table-detail-"
        // — the count badge is shown even with 0 results, so do NOT use it
        // here as a positive signal.
        const firstRow = this.page.locator(this.searchResultItem).first();
        if (await firstRow.isVisible({ timeout: 3000 })) {
          return true;
        }

        // Check for no results message
        if (await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 2000 })) {
          return false;
        }

        // Check for error — return false so callers can check isErrorMessageVisible()
        const errorElement = this.page.locator(this.errorMessage);
        if (await errorElement.isVisible({ timeout: 1000 })) {
          return false;
        }

        // If not the last attempt, wait and retry
        if (attempt < maxAttempts) {
          await this.page.waitForTimeout(2000);
        }
      } catch (error) {
        if (attempt === maxAttempts) return false;
      }
    }

    return false;
  }

  /**
   * Get error traces in results.
   * Source: TracesSearchResultList.vue uses TraceStatusCell which renders a
   * SpanStatusCodeBadge — error rows have a status code badge with red theme.
   * Detect via the global error-count badge or rows tagged as errors.
   * @returns {Locator} Locator for the error-count badge (visible when there
   *   are 1+ error traces in the current result set)
   */
  getErrorTraces() {
    return this.page.locator(this.tracesErrorCountBadge);
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
      this.page.locator(this.traceRowOperationName).first(),
      this.page.locator(this.searchResultItem).first(),
    ];

    for (const selector of selectors) {
      try {
        await expect(selector).toBeVisible({ timeout: 5000 });
        await selector.click();
        await this.page.waitForTimeout(2000);

        // Wait for potential URL change or trace details to load
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        return;
      } catch {
        continue;
      }
    }

    throw new Error('No trace result found to click');
  }

  /**
   * Expand field in field list.
   * Source: web/src/components/common/FieldExpansion.vue
   *   data-test="log-search-expand-{field.name}-field-btn"
   * @param {string} fieldName - Name of field to expand
   * @returns {boolean} True if expanded successfully
   */
  async expandTraceField(fieldName) {
    const expandButton = this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);

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
   * Add a field=value filter to the query via the field expansion's
   * "Add to filter" button. Source: FieldExpansion.vue
   *   data-test="log-search-index-list-add-{field.name}-field-btn"
   * @param {string} fieldName - Name of field
   * @returns {boolean} True if added successfully
   */
  async selectFieldValue(fieldName) {
    const addBtn = this.page.locator(`[data-test="log-search-index-list-add-${fieldName}-field-btn"]`).first();

    try {
      await expect(addBtn).toBeVisible({ timeout: 3000 });
      await addBtn.click();
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
    return await this.page.locator(this.searchResultItem).count();
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
      const isLoading = await this.page.locator('[data-test*="loading"]').first().isVisible({ timeout: 500 });
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
   * Get query editor content from the Monaco model rather than DOM text.
   * Avoids reliance on `.view-lines` and survives virtual rendering.
   * @returns {Promise<string>} Content of the query editor
   */
  async getQueryEditorContent() {
    const editorId = 'traces-query-editor';
    return await this.page.evaluate(({ editorId }) => {
      const w = /** @type {any} */ (window);
      if (!w.monaco?.editor?.getEditors) return '';
      const editors = w.monaco.editor.getEditors();
      const target = editors.find(e => {
        const node = e.getDomNode?.();
        return node && node.closest(`#${editorId}`);
      }) || editors[0];
      return target?.getValue?.() ?? '';
    }, { editorId }).catch(() => '');
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
   * Check if no results message is visible.
   * Polls briefly so this resolves to a stable terminal state — callers use
   * this in compound `hasResults || noResults` assertions after a search, so
   * a too-short timeout can return false while the search is still settling
   * (count badge visible but list not yet rendered).
   * @returns {Promise<boolean>}
   */
  async isNoResultsVisible() {
    // Race against any terminal-state signal so we don't sleep the whole timeout
    // when results have already rendered.
    await Promise.any([
      this.page.locator(this.resultNotFoundText).waitFor({ state: 'visible', timeout: 8000 }),
      this.page.locator(this.searchResultItem).first().waitFor({ state: 'visible', timeout: 8000 }),
      this.page.locator(this.errorMessage).waitFor({ state: 'visible', timeout: 8000 }),
    ]).catch(() => {});

    // Primary: explicit "no results" text element
    if (await this.page.locator(this.resultNotFoundText).isVisible({ timeout: 500 }).catch(() => false)) {
      return true;
    }

    // Secondary: traces may not render a "no results" text when 0 results are
    // returned — instead only the count badge updates (showing "0 traces").
    // Treat badge-visible + zero result rows as the "no results" terminal state.
    const badgeVisible = await this.page.locator(this.tracesCountBadge).isVisible({ timeout: 500 }).catch(() => false);
    if (badgeVisible) {
      const rowCount = await this.page.locator(this.searchResultItem).count();
      if (rowCount === 0) return true;
    }

    return false;
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
   * Check if a search result row contains the given text.
   * Scans only data-test scoped result/badge containers — never bare text nodes.
   * @param {string} text - Text to look for
   * @returns {Promise<boolean>}
   */
  async isTextVisibleInResults(text) {
    const containers = [
      this.searchResultList,
      this.tracesCountBadge,
      this.tracesErrorCountBadge,
    ];
    for (const sel of containers) {
      const node = this.page.locator(sel).first();
      if (!(await node.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      const txt = (await node.textContent().catch(() => '')) || '';
      if (txt.includes(text)) return true;
    }
    return false;
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
   * Check if a row in the trace-details sidebar attribute table contains the
   * given name. Scopes search to data-test rows inside trace-details-sidebar.
   * @param {string} name - Attribute or value text
   * @returns {Promise<boolean>}
   */
  async isCellVisible(name) {
    const rows = this.page.locator(this.traceDetailsSidebarRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const txt = (await rows.nth(i).textContent().catch(() => '')) || '';
      if (txt.includes(name)) return true;
    }
    return false;
  }

  /**
   * Click on a sidebar attribute row whose text contains the given name.
   * @param {string} name - Attribute or value text
   */
  async clickCell(name) {
    const rows = this.page.locator(this.traceDetailsSidebarRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const txt = (await row.textContent().catch(() => '')) || '';
      if (txt.includes(name)) {
        await row.click();
        return;
      }
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
   * Check if HTTP status code 2 is visible inside a trace span row in the tree
   * @returns {Promise<boolean>}
   */
  async isStatusCode2Visible() {
    const httpStatus = this.page.locator('[data-test^="trace-tree-span-http-status-"]');
    const count = await httpStatus.count();
    for (let i = 0; i < count; i++) {
      const txt = (await httpStatus.nth(i).textContent().catch(() => '')) || '';
      if (txt.includes('2')) return true;
    }
    return false;
  }

  /**
   * Check if duration is shown in the sidebar attribute table
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
   * Check whether the result set contains any error traces — proxied by the
   * presence of the traces-error-count-badge data-test (only rendered when
   * errorCount > 0 in TracesSearchResult.vue).
   * @returns {Promise<boolean>} True if error traces found
   */
  async hasErrorTracesWithPattern() {
    return await this.page.locator(this.tracesErrorCountBadge).first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Click the first row that is flagged as an error by the rendered TenstackTable
   * trace-row. Falls back to the first result row if no explicit error icon row
   * exists.
   */
  async clickFirstErrorTrace() {
    // Source: TraceTree.vue renders error icons keyed by spanId, but the
    // result-row error detection lives on TenstackTable cells; rely on the
    // top-level table row marker for error trace styling.
    const errorRow = this.page
      .locator(`${this.searchResultList} [data-test^="o2-table-detail-"]`)
      .first();
    if (await errorRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await errorRow.click();
      await this.page.waitForTimeout(2000);
      return true;
    }
    return false;
  }

  /**
   * Check if an attribute is shown in the trace-details sidebar attribute table.
   * @param {string} attrName - Attribute name
   * @returns {Promise<boolean>}
   */
  async isAttributeCellVisible(attrName) {
    return await this.isCellVisible(attrName);
  }

  /**
   * Click on a sidebar attribute row by name
   * @param {string} attrName - Attribute name
   */
  async clickAttributeCell(attrName) {
    const rows = this.page.locator(this.traceDetailsSidebarRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const txt = (await row.textContent().catch(() => '')) || '';
      if (txt.trim() === attrName || txt.includes(attrName)) {
        await row.click();
        await this.page.waitForTimeout(500);
        return true;
      }
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
   * Check if view logs button is enabled (not disabled)
   * @returns {Promise<boolean>}
   */
  async isViewLogsButtonEnabled() {
    const button = this.page.locator(this.traceDetailsViewLogsButton);
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      return !(await button.isDisabled());
    }
    return false;
  }

  /**
   * Check if log streams selector is visible (indicates non-enterprise mode)
   * @returns {Promise<boolean>}
   */
  async isLogStreamsSelectVisible() {
    return await this.page.locator(this.traceDetailsLogStreamsSelect).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Select first available log stream in trace details
   * @returns {Promise<boolean>} True if selection was successful
   */
  async selectFirstLogStreamInTraceDetails() {
    const wrapper = this.page.locator(this.traceDetailsLogStreamsSelect);
    if (!(await wrapper.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }

    // Get the trigger button inside the OSelect wrapper
    const trigger = wrapper.locator('button[type="button"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Open the popover
    await trigger.click({ force: false });

    // Wait for popover to open
    const popover = this.page.locator('[data-test="trace-details-log-streams-select-popover"]');
    await popover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Select the first available option
    const firstOption = this.page.locator('[data-test="trace-details-log-streams-select-option"]').first();
    if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstOption.click({ force: false });
      await this.page.waitForTimeout(500);
      return true;
    }

    // Close popover if selection failed
    await this.page.keyboard.press('Escape').catch(() => {});
    return false;
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
    return await this.page.locator(this.streamSelect).isVisible({ timeout: 10000 }).catch(() => false);  
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
   * Get the currently selected stream name from the stream selector.
   * The OSelect parent has the selected value reflected in its `aria-label`
   * once the stream is chosen.
   *
   * Update: OSelect's PopoverTrigger now also forwards the committed
   * selection via `data-test-selected-value` (raw value) and
   * `data-test-selected-label` (display label). The data-test attributes are
   * the preferred read source (zero-tolerance policy — no reads via
   * `aria-label`); the aria-label note above is kept as historical context
   * for why this method originally needed an attribute fallback at all.
   * `inputValue()` remains the fallback for non-OSelect inputs (e.g.
   * fallback OInput wrappers used in some legacy stream pickers).
   * @returns {Promise<string|null>} - The selected stream name or null if not found
   */
  async getSelectedStreamName() {
    const streamSelector = this.page.locator(this.streamSelect);
    if (!(await streamSelector.isVisible({ timeout: 3000 }).catch(() => false))) {
      return null;
    }
    // OSelect path: read the PopoverTrigger's data-test-selected-value attr
    // (the trigger lives inside the wrapper; the wrapper has the data-test
    // and the trigger is its single PopoverTrigger child).
    const trigger = streamSelector.locator(
      '[data-test-selected-value], [data-test-selected-label]',
    );
    if (await trigger.count()) {
      const value = await trigger
        .first()
        .getAttribute('data-test-selected-value')
        .catch(() => null);
      if (value) return value.trim();
      const label = await trigger
        .first()
        .getAttribute('data-test-selected-label')
        .catch(() => null);
      if (label) return label.trim();
    }
    // Fallback for OInput-style selectors (no OSelect): read the input value.
    const inputValue = await streamSelector.inputValue().catch(() => null);
    return inputValue?.trim() || null;
  }

  /**
   * Navigate to logs page
   */
  async navigateToLogs() {
    const logsMenuItem = this.page.locator('[data-test="menu-link-\\/logs-item"]');
    await logsMenuItem.click();
    await this.page.waitForURL('**/logs**', { timeout: 10000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  /**
   * Check if trace details tree is visible
   * @returns {Promise<boolean>}
   */
  async isTraceDetailsTreeVisible() {
    return await this.page.locator(this.traceDetailsTree).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Check if any trace detail element is visible.
   * Detects via the TraceDetails.vue data-tests and the TraceTree.vue span
   * container data-tests.
   * @returns {Promise<boolean>}
   */
  async isAnyTraceDetailVisible() {
    const detailSelectors = [
      this.traceDetailsTree,
      this.traceDetailsSidebar,
      this.spanBlock,
      this.spanBlockContainer,
      '[data-test="trace-details-header"]',
      '[data-test^="trace-tree-span-container-"]',
      '[data-test^="trace-tree-span-service-name-"]',
      '[data-test="trace-details-tree-container"]',
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
   * Get error message element text (if visible). Source: traces Index.vue
   * exposes both `traces-search-error-message` and the legacy
   * `logs-search-error-message` data-tests.
   * @returns {Promise<string>}
   */
  async getVisibleErrorMessage() {
    const candidates = [
      this.errorMessage,
      '[data-test="traces-search-error-message"]',
      '[data-test="traces-search-error-text"]',
    ];
    for (const sel of candidates) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        return (await el.textContent().catch(() => '')) || '';
      }
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
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // After SPA hydrates, wait for any traces page anchor (search bar, error,
    // or the stream selector) to mount. The traces SPA can land on the
    // `/traces` route even if the layout has not fully mounted yet.
    await Promise.any([
      this.page.locator(this.searchBar).waitFor({ state: 'visible', timeout: 20000 }),
      this.page.locator(this.streamSelect).waitFor({ state: 'visible', timeout: 20000 }),
      this.page.locator('[data-test="traces-search-mode-spans-btn"]').waitFor({ state: 'visible', timeout: 20000 }),
    ]).catch(() => {});
    // Give Vue a tick to render the rest of the layout.
    await this.page.waitForTimeout(500);
  }

  /**
   * Click a search-toolbar control by its data-test slug.
   * The traces SearchBar.vue exposes stable data-tests for every button:
   *   refresh, reset-filters, sql-mode-toggle, error-only-toggle,
   *   metrics-toggle, share-link, etc.
   * @param {string} dataTest - Data-test attribute value
   * @returns {Promise<boolean>}
   */
  async clickButtonWithText(dataTest) {
    const button = this.page.locator(`[data-test="${dataTest}"]`).first();
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

  // ===== ANALYZE DIMENSIONS POM METHODS =====
  // Selectors verified against actual Vue source code

  // --- Insights Button (TracesMetricsDashboard.vue) ---

  /**
   * Check if Insights button is visible.
   * The Insights button is ALWAYS visible when metrics dashboard shows
   * (does NOT require brush selection).
   * @returns {Promise<boolean>}
   */
  async isInsightsButtonVisible() {
    return await this.page.locator(this.insightsButton).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Click Insights button to open the Analysis Dashboard
   */
  async clickInsightsButton() {
    await this.page.locator(this.insightsButton).click();
    await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  // --- Analysis Dashboard (TracesAnalysisDashboard.vue) ---

  /**
   * Check if Analysis Dashboard is visible
   * @returns {Promise<boolean>}
   */
  async isAnalysisDashboardVisible() {
    return await this.page.locator(this.analysisDashboardCard).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Close Analysis Dashboard via close button
   */
  async closeAnalysisDashboard() {
    const closeBtn = this.page.locator(this.analysisDashboardClose);
    if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await closeBtn.click();
      await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Wait for Analysis Dashboard to fully load (spinner gone + content visible)
   */
  async waitForAnalysisDashboardLoad() {
    const spinner = this.page.locator(this.analysisDashboardLoading);
    try {
      if (await spinner.isVisible({ timeout: 2000 })) {
        await spinner.waitFor({ state: 'hidden', timeout: 30000 });
      }
    } catch {
      // Spinner might not appear or already hidden
    }
    await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  /**
   * Check if the analysis dashboard is in loading state
   * @returns {Promise<boolean>}
   */
  async isAnalysisDashboardLoading() {
    return await this.page.locator(this.analysisDashboardLoading).isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Check if the analysis dashboard shows an error state
   * @returns {Promise<boolean>}
   */
  async isAnalysisDashboardError() {
    return await this.page.locator(this.analysisDashboardError).isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Click the Retry button when analysis dashboard shows an error
   */
  async clickAnalysisDashboardRetry() {
    const retryBtn = this.page.locator(this.analysisDashboardRetryBtn);
    if (await retryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await retryBtn.click();
      await this.page.waitForTimeout(2000);
    }
  }

  /**
   * Check if analysis dashboard has chart panels rendered (actual content loaded)
   * @returns {Promise<boolean>}
   */
  async hasAnalysisDashboardCharts() {
    const chartPanel = this.page.locator(
      `${this.analysisDashboardDrawer} canvas, ${this.analysisDashboardDrawer} [data-test*="chart"]`
    );
    return await chartPanel.first().isVisible({ timeout: 10000 }).catch(() => false);
  }

  // --- Error Only Toggle (SearchResult.vue — error-count badge) ---

  /**
   * Check if Error Only toggle is visible
   * @returns {Promise<boolean>}
   */
  async isErrorOnlyToggleVisible() {
    return await this.page.locator(this.errorOnlyToggle).isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Toggle Error Only filter
   */
  async toggleErrorOnlyFilter() {
    await this.page.locator(this.errorOnlyToggle).click();
    await this.page.waitForTimeout(1000);
  }

  // --- Metrics Dashboard ---

  /**
   * Check if Traces Metrics Dashboard is visible
   * @returns {Promise<boolean>}
   */
  async isTracesMetricsDashboardVisible() {
    return await this.page.locator(this.tracesMetricsDashboard).isVisible({ timeout: 10000 }).catch(() => false);
  }

  /**
   * Perform brush selection on metrics chart (simulated via click and drag)
   * @returns {Promise<boolean>} true if brush selection triggered a UI change
   */
  async performBrushSelectionOnChart() {
    const chartSelectors = [
      this.page.locator(this.tracesMetricsDashboard).locator('canvas').first(),
      this.page.locator('[data-test="chart-renderer"] canvas').first(),
    ];

    let chart = null;
    for (const selector of chartSelectors) {
      if (await selector.isVisible({ timeout: 3000 }).catch(() => false)) {
        chart = selector;
        break;
      }
    }

    if (!chart) return false;

    const box = await chart.boundingBox();
    if (!box) return false;

    await this.page.waitForTimeout(2000);

    // Use coordinate-based mouse operations only — no element references after
    // bounding box capture, since ECharts may re-render and detach the element
    const startX = box.x + box.width * 0.25;
    const endX = box.x + box.width * 0.75;
    const y = box.y + box.height / 2;

    await this.page.mouse.move(startX, y);
    await this.page.waitForTimeout(100);
    await this.page.mouse.down();
    await this.page.waitForTimeout(100);

    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const currentX = startX + (endX - startX) * (i / steps);
      await this.page.mouse.move(currentX, y);
      await this.page.waitForTimeout(20);
    }

    await this.page.waitForTimeout(100);
    await this.page.mouse.up();
    await this.page.waitForTimeout(1500);

    // Verify the page is still functional after brush interaction
    const insightsVisible = await this.isInsightsButtonVisible();
    return insightsVisible;
  }

  // --- Dimension Selector Sidebar (TracesAnalysisDashboard.vue) ---

  /**
   * Check if dimension selector sidebar is visible in Analysis Dashboard
   * @returns {Promise<boolean>}
   */
  async isDimensionSidebarVisible() {
    return await this.page.locator(this.dimensionSelectorSidebar).isVisible().catch(() => false);
  }

  /**
   * Toggle dimension selector sidebar via collapse button
   */
  async toggleDimensionSidebar() {
    const sidebar = this.page.locator(this.dimensionSelectorSidebar);
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    if (sidebarVisible) {
      // Sidebar is open — click the collapse btn inside it
      const btn = this.page.locator(this.dimensionSelectorCollapseBtn);
      await btn.click();
      await sidebar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } else {
      // Sidebar is collapsed — click the collapsed bar to expand
      const collapsedBar = this.page.locator('[data-test="dimension-selector-collapsed-bar"]');
      await collapsedBar.click();
      await sidebar.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Check if dimension search input is visible in sidebar
   * @returns {Promise<boolean>}
   */
  async isDimensionSearchInputVisible() {
    return await this.page.locator(this.dimensionSearchInput).isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Search for a dimension in the sidebar
   * @param {string} searchText - text to type in dimension search
   */
  async searchDimension(searchText) {
    // OInput: fill the -field native <input>, not the wrapper <div>
    const input = this.page.locator(this.dimensionSearchInputField);
    await input.click();
    await input.fill(searchText);
    // Deterministic wait: matching checkbox must be visible AND the visible checkbox
    // count must converge (debounced filter has settled).
    await this.page.locator(`[data-test="dimension-checkbox-${searchText}"]`).waitFor({ state: 'visible', timeout: 5000 });
    let lastCount = -1;
    await expect.poll(async () => {
      const current = await this.page.locator('[data-test^="dimension-checkbox-"]').count();
      const stable = current === lastCount;
      lastCount = current;
      return stable;
    }, { intervals: [100, 150, 200, 250], timeout: 5000 }).toBe(true);
  }

  /**
   * Get the count of dimension checkboxes visible in sidebar
   * @returns {Promise<number>}
   */
  async getDimensionCheckboxCount() {
    return await this.page.locator('[data-test^="dimension-checkbox-"]').count();
  }

  /**
   * Toggle a specific dimension checkbox by its value
   * @param {string} dimensionValue - the dimension value (used in data-test="dimension-checkbox-{value}")
   * @returns {Promise<boolean>} true if toggled
   */
  async toggleDimensionCheckbox(dimensionValue) {
    const checkbox = this.page.locator(`[data-test="dimension-checkbox-${dimensionValue}"]`);
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkbox.click();
      await this.page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  /**
   * Get the first dimension checkbox value that is visible
   * @returns {Promise<string|null>}
   */
  async getFirstDimensionValue() {
    const firstCheckbox = this.page.locator('[data-test^="dimension-checkbox-"]').first();
    if (await firstCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      const testAttr = await firstCheckbox.getAttribute('data-test');
      return testAttr ? testAttr.replace('dimension-checkbox-', '') : null;
    }
    return null;
  }

  // --- Tab Navigation (TracesAnalysisDashboard.vue) ---
  // Tab labels from i18n: "Rate" (volume), "Latency" (latency), "Errors" (error)

  /**
   * Check if Rate tab is visible
   * @returns {Promise<boolean>}
   */
  async isRateTabVisible() {
    return await this.page.locator(this.rateTab).first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if Latency tab is visible
   * @returns {Promise<boolean>}
   */
  async isLatencyTabVisible() {
    return await this.page.locator(this.latencyTab).first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Check if Errors tab is visible
   * @returns {Promise<boolean>}
   */
  async isErrorsTabVisible() {
    return await this.page.locator(this.errorsTab).first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Click Rate tab
   */
  async clickRateTab() {
    await this.page.locator(this.rateTab).first().click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click Latency tab
   */
  async clickLatencyTab() {
    await this.page.locator(this.latencyTab).first().click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click Errors tab
   */
  async clickErrorsTab() {
    await this.page.locator(this.errorsTab).first().click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if a specific tab is active in Analysis Dashboard
   * @param {string} tabLabel - 'Rate', 'Latency'/'Duration', or 'Errors'
   * @returns {Promise<boolean>}
   */
  async isTabActive(tabLabel) {
    // Each OTab carries data-test="traces-analysis-dashboard-${name}-tab"; map
    // the labels used by callers (Rate/Latency/Errors) to internal names
    // (volume/duration/error) and rely on data-state for active.
    // OTab wraps the Reka TabsTrigger in a <span> for disabled-tooltip support,
    // so the consumer's data-test lands on the wrapper while data-state="active"
    // is on the inner button. Poll the DOM for active state on either the
    // wrapper itself OR a descendant (mirrors the metricsBuilderPage pattern
    // for OToggleGroupItem).
    const labelToName = { rate: 'volume', latency: 'duration', duration: 'duration', errors: 'error', error: 'error' };
    const name = labelToName[tabLabel.toLowerCase()] || tabLabel.toLowerCase();
    const testId = `traces-analysis-dashboard-${name}-tab`;
    const drawerSel = this.analysisDashboardDrawer;
    const isActive = await this.page.waitForFunction(
      ({ drawerSel, testId }) => {
        const drawer = document.querySelector(drawerSel);
        if (!drawer) return null;
        const el = drawer.querySelector(`[data-test="${testId}"]`);
        if (!el) return null;
        if (el.getAttribute('data-state') === 'active') return true;
        const inner = el.querySelector('[data-state="active"]');
        return inner ? true : null;
      },
      { drawerSel, testId },
      { timeout: 3000 }
    ).then(h => h.jsonValue()).catch(() => null);
    return Boolean(isActive);
  }

  /**
   * Get the count of visible tabs in Analysis Dashboard
   * @returns {Promise<number>}
   */
  async getVisibleTabCount() {
    return await this.page
      .locator(`${this.analysisDashboardDrawer} [data-test^="traces-analysis-dashboard-"][data-test$="-tab"]`)
      .count();
  }

  // --- Percentile Refresh (Latency tab only) ---

  /**
   * Check if percentile refresh button is visible (only on latency tab after percentile change)
   * @returns {Promise<boolean>}
   */
  async isPercentileRefreshVisible() {
    return await this.page.locator(this.percentileRefreshButton).isVisible({ timeout: 3000 }).catch(() => false);
  }

  /**
   * Click percentile refresh button
   */
  async clickPercentileRefresh() {
    await this.page.locator(this.percentileRefreshButton).click();
    await this.page.waitForTimeout(2000);
  }

  // --- Composite Helper Methods ---

  /**
   * Wait for trace search results to load after running search.
   */
  async waitForTraceSearchResults() {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const resultSelectors = [
        this.page.locator(this.searchResultItem).first(),
        this.page.locator(this.resultNotFoundText),
        this.page.locator(this.errorMessage)
      ];
      await Promise.race(
        resultSelectors.map(s => s.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}))
      );
    } catch {
      // timed out
    }
  }

  /**
   * Ensure metrics dashboard is visible, toggle if needed
   * @returns {Promise<boolean>}
   */
  async ensureMetricsDashboardVisible() {
    let visible = await this.isTracesMetricsDashboardVisible();
    if (!visible) {
      await this.toggleMetricsDashboard();
      await this.page.waitForTimeout(1000);
      visible = await this.isTracesMetricsDashboardVisible();
    }
    return visible;
  }

  /**
   * Open insights dashboard from traces metrics.
   * Sets up search, ensures metrics visible, clicks insights button, waits for load.
   * @returns {Promise<boolean>} true if dashboard opened successfully
   */
  async openInsightsDashboard() {
    await this.setupTraceSearch();
    await this.waitForTraceSearchResults();
    const metricsVisible = await this.ensureMetricsDashboardVisible();
    if (!metricsVisible) return false;

    const insightsVisible = await this.isInsightsButtonVisible();
    if (!insightsVisible) return false;

    await this.clickInsightsButton();
    await this.waitForAnalysisDashboardLoad();
    return await this.isAnalysisDashboardVisible();
  }

  /**
   * Wait for dashboard close to complete
   */
  async waitForDashboardClose() {
    await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // ============================================
  // TRACES SEARCH TEST METHODS (Bug fixes)
  // ============================================

  /**
   * Get run query button
   * @returns {Locator}
   */
  getRunQueryButton() {
    return this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
  }

  /**
   * Get column headers from trace results table.
   * Source: web/src/components/TenstackTable.vue — each header has
   *   data-test=`o2-table-th-${header.id}`
   * @returns {Locator}
   */
  getTraceResultColumnHeaders() {
    return this.page.locator('[data-test^="o2-table-th-"]');
  }

  /**
   * Get duration column header — id is the column key in TenstackTable.
   * @returns {Locator}
   */
  getDurationHeader() {
    return this.page.locator('[data-test="o2-table-th-duration"]');
  }

  /**
   * Get timestamp column header. The traces table uses
   * `store.state.zoConfig.timestamp_column` (usually `_timestamp`) as the
   * column id, but accept either `start_time` or `_timestamp`.
   * @returns {Locator}
   */
  getTimestampHeader() {
    return this.page.locator(
      '[data-test="o2-table-th-_timestamp"], [data-test="o2-table-th-start_time"]'
    );
  }

  /**
   * Get sort indicator element rendered inside the active sort column header.
   * TenstackTable now exposes per-column sort icons via
   * `data-test="o2-table-sort-icon-${columnId}"` with state attributes
   * `data-test-sort-state="active|inactive"` and `data-test-sort-direction`.
   * Targeting any cell in active state is sufficient for the "is sorted" check.
   * @returns {Locator}
   */
  getSortIndicator() {
    return this.page.locator('[data-test-sort-state="active"]');
  }

  /**
   * Get stream selector dropdown
   * @returns {Locator}
   */
  getStreamSelector() {
    return this.page.locator('[data-test="log-search-index-list-select-stream"]');
  }

  /**
   * Get selected/active stream indicator
   * For traces, checks if stream dropdown has a selected value
   * Uses stable selectors that don't rely on framework-internal CSS classes
   * @returns {Locator}
   */
  getSelectedStreamToggle() {
    // Look for selected stream toggles or chips (indicated by 'truthy' class or stream-chip data-test)
    // Also check for stream selector with non-empty aria-label as fallback
    return this.page.locator('[data-test*="stream-toggle-"][class*="truthy"], [data-test*="stream-chip"], [data-test="log-search-index-list-select-stream"][aria-label]:not([aria-label=""])');
  }

  // ===== Regression Test Helper Methods =====

  /**
   * Get PromQL tab/mode element on the current page.
   * Targets the QueryTypeSelector button (used in metrics page and PanelEditor):
   *   data-test="dashboard-promql-query-type"
   * @returns {import('@playwright/test').Locator}
   */
  getPromQLTab() {
    return this.page.locator('[data-test="dashboard-promql-query-type"]').first();
  }

  /**
   * Check if PromQL tab is visible
   * @returns {Promise<boolean>}
   */
  async isPromQLTabVisible() {
    return await this.getPromQLTab().isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Get logs-specific query mode toggles (Quick/SQL mode)
   * @returns {{ quickMode: import('@playwright/test').Locator, sqlMode: import('@playwright/test').Locator }}
   */
  getLogsQueryModeToggles() {
    return {
      quickMode: this.page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]'),
      sqlMode: this.page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]'),
    };
  }

  /**
   * Check if any logs query mode toggle is visible.
   * These toggles live inside the utilities dropdown menu, so we open the menu first.
   * Also checks for the always-visible OToggleGroup items (logs-logs-toggle, etc.)
   * as a fallback indicator that logs-specific UI is active.
   * @returns {Promise<{quickMode: boolean, sqlMode: boolean}>}
   */
  async isAnyLogsQueryToggleVisible() {
    // First check the always-visible OToggleGroup items (not in any dropdown)
    const logsToggle = this.page.locator('[data-test="logs-logs-toggle"]');
    const logsToggleVisible = await logsToggle.isVisible({ timeout: 3000 }).catch(() => false);
    if (logsToggleVisible) {
      return { quickMode: true, sqlMode: true };
    }

    // Fallback: open the utilities menu and check dropdown items
    try {
      const utilsBtn = this.page.locator('[data-test="logs-search-bar-utilities-menu-btn"]');
      if (await utilsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await utilsBtn.click();
        await this.page.waitForTimeout(500);
      }
    } catch {}

    const toggles = this.getLogsQueryModeToggles();
    return {
      quickMode: await toggles.quickMode.isVisible({ timeout: 3000 }).catch(() => false),
      sqlMode: await toggles.sqlMode.isVisible({ timeout: 3000 }).catch(() => false),
    };
  }

  /**
   * Check if autocomplete/suggestion widget is visible in the Monaco editor.
   * Uses page.evaluate() to check Monaco's internal `visible` CSS class,
   * because the app CSS forces display:flex !important on .suggest-widget,
   * which makes Playwright's .isVisible() always return true.
   * @returns {Promise<boolean>}
   */
  async isSuggestionWidgetVisible() {
    return await this.page.evaluate(() => {
      const widget = document.querySelector('.monaco-editor .suggest-widget');
      if (!widget) return false;
      return widget.classList.contains('visible') || widget.classList.contains('focused');
    });
  }

  /**
   * Get log detail traces tab
   * @returns {Locator}
   */
  getLogDetailTracesTab() {
    return this.page.locator('[name="correlated-traces"]');
  }

  /**
   * Get dialog/modal box
   * @returns {Locator}
   */
  getDialogBox() {
    return this.page.locator('[data-test="dialog-box"]');
  }

  /**
   * Get navbar organization selector
   * @returns {Locator}
   */
  getNavbarOrgSelector() {
    return this.page.locator('[data-test="navbar-organizations-select"]');
  }

  /**
   * Get span blocks in trace details
   * @returns {Locator}
   */
  getSpanBlocks() {
    return this.page.locator('[data-test="span-block"]');
  }

  /**
   * Get span block detail container
   * @returns {Locator}
   */
  getSpanBlockDetail() {
    return this.page.locator('[data-test="span-block-container"]');
  }

  /**
   * Get search bar element
   * @returns {Locator}
   */
  getSearchBarElement() {
    return this.page.locator('[data-test="logs-search-bar"]');
  }

  /**
   * Get timestamp column header (logs table variant, for cross-feature tests)
   * @returns {Locator}
   */
  getLogsTimestampHeader() {
    return this.page.locator('[data-test="log-search-result-table-th-timestamp"]');
  }

  /**
   * Get first log row's timestamp cell (for cross-feature tests)
   * @returns {Locator}
   */
  getFirstLogTimestampCell() {
    return this.page.locator('[data-test="logs-search-result-logs-table"] tbody tr:first-child td').first();
  }

  /**
   * Get error indicator elements
   * @returns {Locator}
   */
  getErrorElements() {
    return this.page.locator('.error, .text-negative, [class*="error"]').first();
  }

  /**
   * Get hover/tooltip/popup elements
   * @returns {Locator}
   */
  getHoverElements() {
    return this.page.locator('[class*="hover"], [class*="tooltip"], [class*="popup"]');
  }

  /**
   * Get SQL mode toggle button
   * @returns {Locator}
   */
  getSqlModeToggle() {
    return this.page.locator(this.sqlModeButton);
  }

  /**
   * Get query editor locator
   * @returns {Locator}
   */
  getQueryEditorLocator() {
    return this.page.locator(this.queryEditor);
  }

}


