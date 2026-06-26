import { expect } from '@playwright/test';

export class AlertHistoryPage {
  constructor(page) {
    this.page = page;

    // Page container
    this.pageContainer = '[data-test="alert-history-page"]';
    this.pageTitle = '[data-test="alerts-history-title"]';

    // Controls
    this.backBtn = '[data-test="alert-history-back-btn"]';
    this.datePicker = '[data-test="alert-history-date-picker"]';
    this.searchSelect = '[data-test="alert-history-search-select"]';
    this.manualSearchBtn = '[data-test="alert-history-manual-search-btn"]';
    this.refreshBtn = '[data-test="alert-history-refresh-btn"]';

    // Results
    this.table = '[data-test="alert-history-table"]';
    this.viewDetailsBtn = '[data-test="alert-history-view-details"]';
    this.alertDetailsDialog = '.alert-details-dialog';
    this.emptyState = '.q-table__bottom';
  }

  async navigate() {
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/alerts/history?org_identifier=${process.env["ORGNAME"]}`,
      { waitUntil: 'domcontentloaded' }
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.page.locator(this.pageContainer)).toBeVisible({ timeout: 15000 });
  }

  async expectPageTitleVisible() {
    await expect(this.page.locator(this.pageTitle)).toContainText('Alert History');
  }

  async selectAlert(alertName) {
    // q-select with use-input + @filter: the inner input has width:0 when the
    // dropdown is closed, so waiting for it to be "visible" before the popup
    // opens always times out. Click first, wait for the Quasar popup (.q-menu),
    // THEN fill the input to trigger @filter.
    await this.page.locator(this.searchSelect).click();
    await this.page.locator('.q-menu').waitFor({ state: 'visible', timeout: 5000 });
    const input = this.page.locator(`${this.searchSelect} input`);
    await input.fill(alertName);
    await this.page.waitForTimeout(300);
    const option = this.page.getByRole('option', { name: alertName });
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
    await this.page.locator('.q-menu').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickManualSearch() {
    await this.page.locator(this.manualSearchBtn).click();
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async clickRefresh() {
    await this.page.locator(this.refreshBtn).click();
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async clickBack() {
    await this.page.locator(this.backBtn).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async expectTableVisible() {
    await expect(this.page.locator(this.table)).toBeVisible({ timeout: 10000 });
  }

  async expectTableHasRows() {
    const rows = this.page.locator(`${this.table} tbody tr`);
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  }

  async getTableRowCount() {
    const rows = this.page.locator(`${this.table} tbody tr`);
    return await rows.count();
  }

  async clickViewDetails(index = 0) {
    const btns = this.page.locator(this.viewDetailsBtn);
    const btn = btns.nth(index);
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true });
  }

  async expectViewDetailsBtnVisible() {
    await expect(this.page.locator(this.viewDetailsBtn).first()).toBeVisible({ timeout: 5000 });
  }

  async expectBackBtnVisible() {
    await expect(this.page.locator(this.backBtn)).toBeVisible({ timeout: 5000 });
  }

  async expectSearchSelectVisible() {
    await expect(this.page.locator(this.searchSelect)).toBeVisible({ timeout: 5000 });
  }

  async expectManualSearchBtnVisible() {
    await expect(this.page.locator(this.manualSearchBtn)).toBeVisible({ timeout: 5000 });
  }

  async expectRefreshBtnVisible() {
    await expect(this.page.locator(this.refreshBtn)).toBeVisible({ timeout: 5000 });
  }

  async expectDatePickerVisible() {
    await expect(this.page.locator(this.datePicker)).toBeVisible({ timeout: 5000 });
  }

  async expectDetailsDialogVisible() {
    await expect(this.page.locator(this.alertDetailsDialog)).toBeVisible({ timeout: 15000 });
  }

  async expectTableOrEmptyStateVisible() {
    const [tableVisible, emptyVisible] = await Promise.all([
      this.page.locator(this.table).isVisible({ timeout: 10000 }).catch(() => false),
      this.page.locator(this.emptyState).isVisible({ timeout: 3000 }).catch(() => false),
    ]);
    if (!tableVisible && !emptyVisible) {
      throw new Error('Expected either the history table or an empty-state to be visible after search');
    }
  }

  async expectEmptyStateVisible() {
    await expect(this.page.locator(this.emptyState)).toBeVisible({ timeout: 5000 });
  }
}
