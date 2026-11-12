import { expect } from '@playwright/test';

/**
 * Page object for the Reports Run History feature (org-wide History tab and
 * the per-report History tab). Selectors are declared at the top as data-test
 * only; specs interact exclusively through these methods.
 */
export class ReportHistoryPage {
  constructor(page) {
    this.page = page;

    // Navigation / report-list
    this.reportSearchInput = page.locator('[data-test="report-list-search-input"] input');
    this.tabHistory = page.locator('[data-test="tab-history"]');

    // Report detail page (per-report history)
    this.reportDetailTitle = page.locator('[data-test="reports-reportdetail-title"]');
    this.reportDetailRunNow = page.locator('[data-test="reports-reportdetail-run-now"]');
    this.runNowConfirmBtn = page.locator('[data-test="o-dialog-primary-btn"]');

    // History stat-strip tiles + row status chip
    this.statusChip = page.locator('[data-test="reports-reportrunhistory-status"]');
    this.tileCached = page.locator('[data-test="reports-reportrunhistory-tile-cached"]');
    this.tileSkipped = page.locator('[data-test="reports-reportrunhistory-tile-skipped"]');
    this.triggerSourceCell = page.locator(
      '[data-test="reports-reportrunhistory-table"] [data-test="o2-table-cell-trigger_source"]'
    );

    // Org-wide History panel + tiles
    this.orgHistoryPanel = page.locator('[data-test="reports-reporthistory"]');
    this.orgHistoryTileAll = page.locator('[data-test="reports-reportrunhistory-tile-all"]');

    // Empty states
    this.emptyState = page.locator('[data-test="reports-reportrunhistory-empty"]');
    this.emptyRangeState = page.locator('[data-test="reports-reportrunhistory-empty-range"]');
    this.disabledState = page.locator('[data-test="reports-reportrunhistory-disabled"]');
    // The only button inside the empty / empty-range states is its primary action.
    this.emptyStateRunNowBtn = page.locator('[data-test="reports-reportrunhistory-empty"] button');
    this.widenRangeBtn = page.locator('[data-test="reports-reportrunhistory-empty-range"] button');

    // Trigger-source filter (items carry no per-value data-test; OToggleGroupItem
    // exposes its value via the stable data-otoggle-value attribute).
    this.triggerScheduled = page.locator(
      '[data-test="reports-reportrunhistory-trigger"] [data-otoggle-value="scheduled"]'
    );

    // Linked-run banner + drawer
    this.linkedRunMessage = page.locator('[data-test="reports-reportrunhistory-linked-run-message"]');
    this.drawerOutcome = page.locator('[data-test="reports-reportrundrawer-outcome"]');
    this.drawerEditRecipients = page.locator('[data-test="reports-reportrundrawer-edit-recipients"]');
  }

  reportNameCell(reportName) {
    return this.page.locator(`[data-test="report-list-name-cell-${reportName}"]`);
  }

  async navigateToOrgHistory(runParam) {
    let url = `${process.env["ZO_BASE_URL"]}/web/reports?org_identifier=${process.env["ORGNAME"]}&tab=history`;
    if (runParam) url += `&run=${encodeURIComponent(runParam)}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async clickHistoryTab() {
    await this.tabHistory.click();
  }

  async expectHistoryTabActive() {
    await expect(this.page).toHaveURL(/[?&]tab=history/);
  }

  async expectOrgHistoryPanelVisible() {
    await expect(this.orgHistoryPanel).toBeVisible();
  }

  async expectOrgHistoryTileAllVisible() {
    await expect(this.orgHistoryTileAll).toBeVisible();
  }

  async openReportDetail(reportName) {
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/reports?org_identifier=${process.env["ORGNAME"]}&tab=cached`,
      { waitUntil: 'domcontentloaded' }
    );
    await this.reportSearchInput.fill(reportName);
    const nameCell = this.reportNameCell(reportName);
    await expect(nameCell).toBeVisible({ timeout: 30000 });
    await nameCell.click();
    await expect(this.reportDetailTitle).toContainText(reportName);
  }

  async runNow() {
    await this.reportDetailRunNow.click();
    await this.runNowConfirmBtn.click();
  }

  async expectStatusChipVisible() {
    await expect(this.statusChip.first()).toBeVisible({ timeout: 120000 });
  }

  async expectFirstTriggerSourceManual() {
    await expect(this.triggerSourceCell.first()).toContainText('Manual');
  }

  async openRunDrawer() {
    await this.statusChip.first().click();
  }

  async expectDrawerOutcomeVisible() {
    await expect(this.drawerOutcome).toBeVisible();
  }

  async expectRunDeepLink() {
    await expect(this.page).toHaveURL(/[?&]run=/);
  }

  async expectEditRecipientsHidden() {
    await expect(this.drawerEditRecipients).not.toBeVisible();
  }

  async expectCachedTileVisible() {
    await expect(this.tileCached).toBeVisible();
  }

  async expectEmptyStateVisible() {
    await expect(this.emptyState).toBeVisible();
  }

  async expectEmptyStateRunNowVisible() {
    await expect(this.emptyStateRunNowBtn).toBeVisible();
  }

  async clickSkippedTile() {
    await this.tileSkipped.click();
  }

  async expectEmptyRangeVisible() {
    await expect(this.emptyRangeState).toBeVisible();
  }

  async expectEmptyRangeHidden() {
    await expect(this.emptyRangeState).not.toBeVisible();
  }

  async clickWidenRange() {
    await this.widenRangeBtn.click();
  }

  async clickScheduledTrigger() {
    await this.triggerScheduled.click();
  }

  async expectLinkedRunMessage(text) {
    await expect(this.linkedRunMessage).toBeVisible();
    await expect(this.linkedRunMessage).toContainText(text);
  }

  async expectDisabledStateVisible() {
    await expect(this.disabledState).toBeVisible();
  }
}
