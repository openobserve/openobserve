import { expect } from '@playwright/test';

export class LogsQueryPage {
  constructor(page) {
    this.page = page;
    this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
    this.dateTimeButton = '[data-test="date-time-btn"]';
    this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.errorMessage = '[data-test="logs-search-error-message"]';
    this.utilitiesMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
    // Quasar q-icon renders icon name as text content (e.g. "warning"),
    // concatenated with the label text. Use partial match.
    this.noDataFoundText = 'No data found for';
    this.resultDetail = '[data-test="logs-search-result-detail-undefined"]';
    this.histogramToggle = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
  }

  async setDateTimeFilter() {
    await this.page.locator(this.dateTimeButton).click({ force: true });
    await this.page.locator(this.relative15MinButton).click({ force: true });
  }

  async typeQuery(query) {
    const queryEditor = this.page.locator(this.queryEditor);
    await expect(queryEditor).toBeVisible();
    await queryEditor.locator(".inputarea").fill(query);
  }

  async clickRefresh() {
    await this.page.locator(this.refreshButton).click();
  }

  async clickErrorMessage() {
    // Wait longer for error message to appear in deployed environments
    await expect(this.page.locator(this.errorMessage).getByText('No events found')).toBeVisible({ timeout: 30000 });
    await this.page.locator(this.errorMessage).click();
  }

  async clickResetFilters() {
    // Reset filters button is now directly on the toolbar
    await this.page.locator(this.resetFiltersButton).click();
  }

  async clickNoDataFound() {
    // Try multiple text patterns — the warning banner text varies across environments
    const patterns = [
      'No data found for',
      'No data found',
      'No results found',
      'No data',
    ];
    let found = false;
    for (const pattern of patterns) {
      const locator = this.page.getByText(pattern).first();
      try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        await locator.click({ force: true });
        found = true;
        break;
      } catch (e) {
        continue;
      }
    }
    if (!found) {
      // Last attempt — wait longer for any "No data" text
      const fallback = this.page.getByText('No data').first();
      await fallback.waitFor({ state: 'visible', timeout: 20000 });
      await fallback.click({ force: true });
    }
  }

  async clickResultDetail() {
    await this.page.locator(this.resultDetail).click();
  }

  async waitForTimeout(milliseconds) {
    await this.page.waitForTimeout(milliseconds);
  }

  async toggleHistogram() {
    // Histogram toggle is now directly visible in the toolbar (moved out of utilities menu)
    await this.page.locator(this.histogramToggle).click();
  }

  async isHistogramOn() {
    // Histogram toggle is now directly visible in the toolbar (moved out of utilities menu)
    const histogramToggle = this.page.locator(this.histogramToggle);
    const isChecked = await histogramToggle.getAttribute('aria-checked');
    return isChecked === 'true';
  }

  async ensureHistogramState(desiredState) {
    const isOn = await this.isHistogramOn();
    if (isOn !== desiredState) {
      await this.toggleHistogram();
    }
  }
} 