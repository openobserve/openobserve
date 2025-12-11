// tracesPage.js
import { expect } from '@playwright/test';

import { dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator, Past30SecondsValue } from '../commonActions.js';


export
  class TracesPage {
  constructor(page) {
    this.page = page;
    this.tracesMenuItem = page.locator('[data-test="menu-link-\\/traces-item"]');

    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;


    this.profileButton = page.locator('button').filter({ hasText: (process.env["ZO_ROOT_USER_EMAIL"]) });
    this.signOutButton = page.getByText('Sign Out');

    // ==========================================
    // Traces Analyze Feature Locators (ENTERPRISE)
    // ==========================================

    // RED Metrics Dashboard
    this.errorOnlyToggle = '[data-test="error-only-toggle"]';
    this.rangeFilterChip = '[data-test="range-filter-chip"]';
    this.analyzeButton = '[data-test="analyze-dimensions-button"]';

    // Analysis Dashboard
    this.analysisDashboardClose = '[data-test="analysis-dashboard-close"]';
    this.dimensionSelectorButton = '[data-test="dimension-selector-button"]';
    this.percentileRefreshButton = '[data-test="percentile-refresh-button"]';

    // Analysis Dashboard Tabs
    // Quasar q-tabs renders tabs with role="tab"
    // Tab labels from i18n: Rate (volume), Latency, Errors
    this.volumeTab = '[role="tab"]:has-text("Rate")';
    this.latencyTab = '[role="tab"]:has-text("Latency")';
    this.errorTab = '[role="tab"]:has-text("Errors")';

    // Run Query button (shared with logs)
    this.runQueryButton = '[data-test="logs-search-bar-refresh-btn"]';

    // Stream selector
    this.streamSelector = '[data-test="log-search-index-list"]';

    // RED Metrics toggle (traces uses different selector than logs)
    this.metricsToggle = '[data-test="traces-search-bar-show-metrics-toggle-btn"]';

  }

  async navigateToTraces() {
    await this.tracesMenuItem.click();
    // Wait for page to load
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2000);
  }

  /**
   * Navigate to traces with page refresh to ensure RED metrics load properly
   * Use this when RED metrics are not appearing on initial load
   */
  async navigateToTracesWithRefresh() {
    await this.tracesMenuItem.click();
    // Wait for initial page load
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2000);

    // Refresh the page to ensure proper loading
    await this.page.reload({ waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);
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


  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.page.locator(this.dateTimeButton).click();
    await this.relative30SecondsButton.click();
  }

  async setTimeToPast15Minutes() {
    // Set the time filter to the last 15 minutes
    await this.page.locator(this.dateTimeButton).click();
    await this.page.locator('[data-test="date-time-relative-15-m-btn"]').click();
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

  // ==========================================
  // Traces Analyze Feature Methods (ENTERPRISE)
  // ==========================================

  /**
   * Check if analyze button is visible
   */
  async isAnalyzeButtonVisible() {
    return await this.page.locator(this.analyzeButton).isVisible();
  }

  /**
   * Click the analyze dimensions button
   */
  async clickAnalyzeButton() {
    await this.page.locator(this.analyzeButton).click();
    // Wait for analysis dashboard to appear
    await this.page.waitForTimeout(1000);
  }

  /**
   * Close the analysis dashboard
   */
  async closeAnalysisDashboard() {
    await this.page.locator(this.analysisDashboardClose).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if analysis dashboard is open
   */
  async isAnalysisDashboardOpen() {
    return await this.page.locator(this.analysisDashboardClose).isVisible();
  }

  /**
   * Click on Volume tab in analysis dashboard
   */
  async clickVolumeTab() {
    await this.page.locator(this.volumeTab).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on Latency tab in analysis dashboard
   */
  async clickLatencyTab() {
    await this.page.locator(this.latencyTab).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on Error tab in analysis dashboard
   */
  async clickErrorTab() {
    await this.page.locator(this.errorTab).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if a specific tab is active (has selected class)
   */
  async isTabActive(tabName) {
    const tabSelector = tabName === 'volume' ? this.volumeTab :
                        tabName === 'latency' ? this.latencyTab :
                        this.errorTab;
    const tab = this.page.locator(tabSelector);
    const classes = await tab.getAttribute('class');
    return classes?.includes('q-tab--active') || false;
  }

  /**
   * Click the dimension selector button
   */
  async clickDimensionSelector() {
    await this.page.locator(this.dimensionSelectorButton).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if dimension selector button is visible
   */
  async isDimensionSelectorVisible() {
    return await this.page.locator(this.dimensionSelectorButton).isVisible();
  }

  /**
   * Click the percentile refresh button
   */
  async clickPercentileRefresh() {
    await this.page.locator(this.percentileRefreshButton).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if percentile refresh button is visible
   */
  async isPercentileRefreshVisible() {
    return await this.page.locator(this.percentileRefreshButton).isVisible();
  }

  /**
   * Toggle error only filter
   */
  async toggleErrorOnly() {
    await this.page.locator(this.errorOnlyToggle).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if range filter chip is visible
   */
  async isRangeFilterChipVisible() {
    return await this.page.locator(this.rangeFilterChip).first().isVisible();
  }

  /**
   * Remove range filter by clicking close icon on chip
   */
  async removeRangeFilter() {
    const chip = this.page.locator(this.rangeFilterChip).first();
    await chip.locator('.chip-close-icon, [name="close"]').click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Ensure RED metrics dashboard is visible and loaded
   */
  async ensureMetricsVisible() {
    const toggle = this.page.locator(this.metricsToggle);
    // Wait for toggle to be visible first
    await toggle.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    if (await toggle.isVisible()) {
      const ariaPressed = await toggle.getAttribute('aria-pressed');
      if (ariaPressed !== 'true') {
        await toggle.click();
        await this.page.waitForTimeout(2000);
      }
    }
  }

  /**
   * Wait for RED metrics charts to be fully loaded
   */
  async waitForREDMetricsLoaded() {
    // First wait for the traces search result container to appear
    await this.page.waitForSelector('[data-test="traces-search-result"]', { state: 'visible', timeout: 9000 }).catch(() => {});

    // Wait for the page to be stable
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

    // Wait for canvas elements (charts) to be rendered - indicating RED metrics panels are loaded
    await this.page.waitForSelector('canvas', { state: 'visible', timeout: 3000 }).catch(() => {});

    // Wait for any loading spinners to disappear
    await this.page.waitForSelector('.q-spinner', { state: 'hidden', timeout: 30000 }).catch(() => {});

    // Additional wait for charts to fully render
    await this.page.waitForTimeout(3000);
  }

  /**
   * Alias for backward compatibility
   */
  async ensureHistogramVisible() {
    await this.ensureMetricsVisible();
  }

  /**
   * Run query on traces page
   */
  async runQuery() {
    await this.page.locator(this.runQueryButton).click();
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2000);
  }

  /**
   * Make a brush selection on a chart panel by dispatching DOM mouse events
   * This triggers ECharts' internal brush/dataZoom handler which updates Vue state
   * @param {string} panelTitle - 'Rate', 'Duration', or 'Errors'
   */
  async makeBrushSelection(panelTitle = 'Rate') {
    const success = await this.page.evaluate(async (panelTitle) => {
      // Find the panel by looking for dashboard-panel-container with matching title
      const panelContainers = document.querySelectorAll('[data-test="dashboard-panel-container"]');
      let chartContainer = null;

      for (const panel of panelContainers) {
        // Check if this panel has a header with the title
        const header = panel.querySelector('.panelHeader');
        const panelTitleText = header?.textContent?.trim();

        if (panelTitleText === panelTitle) {
          // Found the panel, now find chart-renderer inside it
          chartContainer = panel.querySelector('[data-test="chart-renderer"]');
          if (chartContainer) {
            break;
          }
        }
      }

      if (!chartContainer) {
        return false;
      }

      // Find the canvas element where ECharts renders
      const canvas = chartContainer.querySelector('canvas');
      if (!canvas) {
        return false;
      }

      const rect = canvas.getBoundingClientRect();

      // Calculate coordinates for a brush selection (middle 50% of chart)
      const startX = rect.left + rect.width * 0.25;
      const endX = rect.left + rect.width * 0.75;
      const centerY = rect.top + rect.height * 0.5;

      // Create and dispatch mouse events to simulate brush selection
      // ECharts listens to these events via zrender

      // 1. Mouse down to start selection
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: startX,
        clientY: centerY,
        button: 0
      });

      // 2. Mouse move to create selection area
      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: endX,
        clientY: centerY,
        button: 0
      });

      // 3. Mouse up to complete selection
      const mouseUpEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: endX,
        clientY: centerY,
        button: 0
      });

      canvas.dispatchEvent(mouseDownEvent);
      await new Promise(resolve => setTimeout(resolve, 100));
      canvas.dispatchEvent(mouseMoveEvent);
      await new Promise(resolve => setTimeout(resolve, 100));
      canvas.dispatchEvent(mouseUpEvent);

      return true;
    }, panelTitle);

    // Wait for Vue to react to the state change
    await this.page.waitForTimeout(2000);

    return success;
  }

  /**
   * Wait for analysis dashboard to load charts
   */
  async waitForAnalysisDashboardLoaded() {
    // Wait for loading spinner to disappear
    await this.page.waitForSelector('.q-spinner-hourglass', { state: 'hidden', timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get the dashboard title text (to verify which analysis type is active)
   */
  async getAnalysisDashboardTitle() {
    const titleElement = this.page.locator('.analysis-header .tw-text-lg').first();
    if (await titleElement.isVisible()) {
      return await titleElement.textContent();
    }
    return null;
  }

}


