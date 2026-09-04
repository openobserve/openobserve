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
    // ODialog forwards data-test to DialogContent via parentDataTest computed;
    // [role="dialog"] is the ARIA fallback but the forwarded attr is more specific.
    this.alertDetailsDialog = '[data-test="alert-history-details-dialog"]';
    this.emptyState = '[data-test="o2-table-empty"]';
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
    // alert-history-search-select is OSelect in listbox mode (searchable defaults to true).
    // The ListboxFilter input is rendered in a PopoverPortal — it is NOT a DOM child of
    // the OSelect wrapper, so `[data-test="...search-select"] input` never matches.
    // Use the forwarded data-test sub-keys instead: -trigger, -popover, -search, -option.
    const trigger = this.page.locator('[data-test="alert-history-search-select-trigger"]');
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    await trigger.click();

    const popover = this.page.locator('[data-test="alert-history-search-select-popover"]');
    await popover.waitFor({ state: 'visible', timeout: 5000 });

    // Type the alert name to filter — avoids virtualiser rendering only visible rows
    const searchInput = this.page.locator('[data-test="alert-history-search-select-search"]');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await searchInput.fill(alertName);
    await this.page.waitForTimeout(300);

    const option = this.page.locator(`[data-test="alert-history-search-select-option"][data-test-label="${alertName}"]`);
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();

    await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
    // Exclude OTableLoading skeleton tbody to avoid false positives before real data loads
    const rows = this.page.locator(`${this.table} tbody:not([data-test="o2-table-skeleton-body"]) tr`);
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  }

  async getTableRowCount() {
    // Exclude OTableLoading skeleton tbody rows
    const rows = this.page.locator(`${this.table} tbody:not([data-test="o2-table-skeleton-body"]) tr`);
    return await rows.count();
  }

  async clickViewDetails(index = 0) {
    // Wait for the skeleton to finish and OTable to complete loading
    await this.page.locator('[data-test="o2-table-skeleton-body"]')
      .waitFor({ state: 'hidden', timeout: 15000 })
      .catch(() => {});
    await this.page.locator('[data-test="o2-table"][data-test-loading="false"]')
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => {});

    // If the details dialog already opened (from a prior click attempt), skip re-clicking.
    const alreadyOpen = await this.page.locator(this.alertDetailsDialog)
      .isVisible({ timeout: 300 }).catch(() => false);
    if (alreadyOpen) return;

    // Dismiss any stale ODialog overlay blocking pointer events before clicking.
    const overlay = this.page.locator('[data-test="o-dialog-overlay"]');
    if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await overlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    const byDataTest = this.page.locator(this.viewDetailsBtn);
    const byCell = this.page.locator('[data-test="o2-table-cell-actions"]').nth(index).locator('button').first();
    const btn = (await byDataTest.count() > 0) ? byDataTest.nth(index) : byCell;
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
    // Primary: forwarded data-test on ODialog's DialogContent.
    // Fallback: data-o2-dialog is a static attribute always present on DialogContent,
    // used when $attrs["data-test"] forwarding hasn't propagated yet in CI.
    const byDataTest = this.page.locator(this.alertDetailsDialog);
    const byStaticAttr = this.page.locator('[data-o2-dialog]');
    const found = await byDataTest.isVisible({ timeout: 20000 }).catch(() => false)
      || await byStaticAttr.isVisible({ timeout: 2000 }).catch(() => false);
    if (!found) {
      await expect(byDataTest).toBeVisible({ timeout: 1000 });
    }
  }

  async expectTableOrEmptyStateVisible() {
    // Check for data rows OR the OTable empty-state panel
    const [rowsVisible, emptyVisible] = await Promise.all([
      this.page.locator(`${this.table} tbody tr`).first().isVisible({ timeout: 10000 }).catch(() => false),
      this.page.locator(this.emptyState).isVisible({ timeout: 5000 }).catch(() => false),
    ]);
    if (!rowsVisible && !emptyVisible) {
      throw new Error('Expected either history table rows or the empty-state to be visible after search');
    }
  }

  async expectEmptyStateVisible() {
    await expect(this.page.locator(this.emptyState)).toBeVisible({ timeout: 5000 });
  }
}
