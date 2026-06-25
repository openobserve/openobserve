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
    await this.page.locator(this.searchSelect).click();
    const option = this.page.getByRole('option', { name: alertName });
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
    } else {
      const input = this.page.locator(`${this.searchSelect} input`);
      await input.waitFor({ state: 'visible', timeout: 3000 });
      await input.fill(alertName);
      await this.page.getByRole('option', { name: alertName }).waitFor({ state: 'visible', timeout: 5000 });
      await this.page.getByRole('option', { name: alertName }).click();
    }
    await this.page.getByRole('listbox').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
    await btns.nth(index).click();
    await this.page.locator(this.alertDetailsDialog).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
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
    await expect(this.page.locator(this.alertDetailsDialog)).toBeVisible({ timeout: 8000 });
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
