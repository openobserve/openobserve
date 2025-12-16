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

}


