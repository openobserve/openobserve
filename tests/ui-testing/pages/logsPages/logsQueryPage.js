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
    this.sqlModeSwitch = { role: 'switch', name: 'SQL Mode' };
    this.autoRunDropdownBtn = '[data-test="logs-search-bar-refresh-btn"] ~ button';
    this.autoRunToggleItem = '[data-test="logs-search-bar-live-mode-toggle-btn"]';
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
    await expect(this.page.locator(this.errorMessage)).toBeVisible({ timeout: 30000 });
    await this.page.locator(this.errorMessage).click();
  }

  async clickResetFilters() {
    // Reset filters button is now directly on the toolbar
    await this.page.locator(this.resetFiltersButton).click();
  }

  async clickNoDataFound() {
    // Page-level search — the "No data" text may be in:
    //   SearchResult.vue  histogram-empty span (warning icon + "No data found for histogram.")
    //   Index.vue         h6[data-test="logs-search-error-message"] (info icon + "No events found…")
    //   Index.vue         div[data-test="logs-search-result-not-found-text"] ("Result not found.")
    // Use specific enough substrings to avoid matching unrelated empty-states.
    const patterns = [
      'No data found for',
      'No events found',
      'Result not found',
      'No data found',
    ];
    for (const pattern of patterns) {
      const locator = this.page.getByText(pattern).first();
      try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        await locator.click({ force: true });
        return;
      } catch (e) {
        continue;
      }
    }
    const fallback = this.page.getByText('No data').first();
    await fallback.waitFor({ state: 'visible', timeout: 20000 });
    await fallback.click({ force: true });
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

  async isSQLModeOn() {
    const sw = this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name });
    return await sw.isChecked();
  }

  async ensureSQLMode() {
    if (!(await this.isSQLModeOn())) {
      await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).click();
      await this.page.waitForTimeout(500);
    }
  }

  async ensureFTSMode() {
    if (await this.isSQLModeOn()) {
      await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).click();
      await this.page.waitForTimeout(500);
    }
  }

  async disableAutoRun() {
    await this.page.locator(this.autoRunDropdownBtn).click();
    const toggle = this.page.locator(this.autoRunToggleItem);
    if ((await toggle.textContent()).includes('Turn off')) {
      await toggle.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(300);
  }

  async enableAutoRun() {
    await this.page.locator(this.autoRunDropdownBtn).click();
    const toggle = this.page.locator(this.autoRunToggleItem);
    if ((await toggle.textContent()).includes('Turn on')) {
      await toggle.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(300);
  }
} 