import { expect } from '@playwright/test';

export class LogsQueryPage {
  constructor(page) {
    this.page = page;
    this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
    this.dateTimeButton = '[data-test="date-time-btn"]';
    this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.errorMessage = '[data-test="logs-search-error-message"]';
    this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
    this.noDataFoundText = 'warning No data found for';
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
    await this.page.locator(this.resetFiltersButton).click();
  }

  async clickNoDataFound() {
    const noDataFoundLocator = this.page.getByText(this.noDataFoundText);
    await expect(noDataFoundLocator).toBeVisible({ timeout: 10000 });
    await noDataFoundLocator.click();
  }

  async clickResultDetail() {
    await this.page.locator(this.resultDetail).click();
  }

  async waitForTimeout(milliseconds) {
    await this.page.waitForTimeout(milliseconds);
  }

  async toggleHistogram() {
    await this.page.waitForSelector(this.histogramToggle);
    await this.page.locator(`${this.histogramToggle} div`).nth(2).click();
  }

  async isHistogramOn() {
    const histogramToggle = this.page.locator(this.histogramToggle);
    return await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
  }

  async ensureHistogramState(desiredState) {
    const isOn = await this.isHistogramOn();
    if (isOn !== desiredState) {
      await this.toggleHistogram();
    }
  }
} 