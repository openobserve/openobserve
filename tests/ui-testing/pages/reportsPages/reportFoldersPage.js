import { expect } from '@playwright/test';

export class ReportFoldersPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.reportsMenu = '[data-test="menu-link-\\/reports-item"]';

    // Folder sidebar
    this.addFolderBtn = '[data-test="dashboard-new-folder-btn"]';
    this.folderSearchInput = '[data-test="folder-search"]';
    this.folderTabsContainer = '[data-test="dashboards-folder-tabs"]';
    this.moreIcon = '[data-test="dashboard-more-icon"]';
    this.editFolderIcon = '[data-test="dashboard-edit-folder-icon"]';
    this.deleteFolderIcon = '[data-test="dashboard-delete-folder-icon"]';

    // Add/Edit folder dialog
    this.folderDialog = '[data-test="dashboard-folder-dialog"]';
    this.folderNameInput = '[data-test="dashboard-folder-add-name"]';
    this.folderDescInput = '[data-test="dashboard-folder-add-description"]';
    this.folderSaveBtn = '[data-test="dashboard-folder-add-save"]';
    this.folderCancelBtn = '[data-test="dashboard-folder-add-cancel"]';

    // Delete confirmation dialog
    this.confirmDeleteDialog = '[data-test="dashboard-confirm-delete-folder-dialog"]';
    this.confirmButton = '[data-test="confirm-button"]';

    // Move dialog
    this.moveDialogHeader = '[data-test="reports-folder-move-header"]';
    this.moveFolderSelect = '[data-test="reports-index-dropdown-stream_type"]';
    this.moveSubmitBtn = '[data-test="reports-folder-move"]';
    this.moveCancelBtn = '[data-test="reports-folder-move-cancel"]';

    // Report list
    this.reportSearchInput = '[data-test="report-list-search-input"]';
    this.allFoldersToggle = '[data-test="report-list-search-across-folders-toggle"]';
    this.moveReportBtn = (name) => `[data-test="report-list-${name}-move-report"]`;

    // Bulk operations (visible only when reports are selected)
    this.reportTable = '[data-test="report-list-table"]';
    this.bulkMoveBtn = '[data-test="report-list-move-reports-btn"]';
    this.bulkPauseBtn = '[data-test="report-list-pause-reports-btn"]';
    this.bulkResumeBtn = '[data-test="report-list-resume-reports-btn"]';
    this.bulkDeleteBtn = '[data-test="report-list-delete-reports-btn"]';
    this.bulkDeleteConfirmDialog = '[data-test="dialog-box"]';
    this.bulkDeleteConfirmBtn = '[data-test="confirm-button"]';
    this.bulkDeleteCancelBtn = '[data-test="cancel-button"]';

    // Page title
    this.pageTitle = '[data-test="report-list-title"]';
  }

  getTabByName(folderName) {
    return this.page.locator(`${this.folderTabsContainer} [role="tab"]`).filter({ hasText: folderName });
  }

  async navigateToReports() {
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/reports?org_identifier=${process.env["ORGNAME"]}`,
      { waitUntil: 'domcontentloaded' }
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      console.warn('navigateToReports: networkidle timed out, continuing');
    });
    await expect(this.page.locator(this.pageTitle)).toContainText('Reports');
    await this.page.locator(this.folderTabsContainer).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.warn('navigateToReports: folderTabsContainer not visible, continuing');
    });
  }

  async clickAddFolder() {
    await this.page.locator(this.addFolderBtn).click();
    await expect(this.page.locator(this.folderNameInput)).toBeVisible({ timeout: 5000 });
  }

  async fillFolderName(name) {
    await this.page.locator(this.folderNameInput).fill(name);
  }

  async fillFolderDescription(desc) {
    await this.page.locator(this.folderDescInput).fill(desc);
  }

  async clickSaveFolder() {
    await this.page.locator(this.folderSaveBtn).click();
  }

  async clickCancelFolder() {
    await this.page.locator(this.folderCancelBtn).click();
  }

  async createFolder(name, description = '') {
    await this.clickAddFolder();
    await this.fillFolderName(name);
    if (description) {
      await this.fillFolderDescription(description);
    }
    await this.clickSaveFolder();
    // Wait for the dialog to close after save
    await this.page.locator(this.folderDialog).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async expectFolderTabVisible(folderName) {
    await expect(this.getTabByName(folderName)).toBeVisible({ timeout: 10000 });
  }

  async expectFolderTabNotVisible(folderName) {
    await expect(this.getTabByName(folderName)).not.toBeVisible({ timeout: 5000 });
  }

  async clickFolderTab(folderName) {
    await this.getTabByName(folderName).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickMoreIcon(folderName) {
    const tab = this.getTabByName(folderName);
    await tab.hover();
    const moreBtn = tab.locator(this.moreIcon);
    await moreBtn.waitFor({ state: 'visible', timeout: 3000 });
    await moreBtn.click();
  }

  async clickEditFolder(folderName) {
    await this.clickMoreIcon(folderName);
    await this.page.locator(this.editFolderIcon).click({ force: true });
    await expect(this.page.locator(this.folderNameInput)).toBeVisible({ timeout: 5000 });
  }

  async clickDeleteFolder(folderName) {
    await this.clickMoreIcon(folderName);
    await this.page.locator(this.deleteFolderIcon).click({ force: true });
    await expect(this.page.locator(this.confirmDeleteDialog)).toBeVisible({ timeout: 5000 });
  }

  async confirmDelete() {
    const btn = this.page.locator(this.confirmButton);
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click({ force: true });
    await this.page.locator(this.confirmDeleteDialog).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async searchFolders(query) {
    await this.page.locator(this.folderSearchInput).fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async clearFolderSearch() {
    await this.page.locator(this.folderSearchInput).clear();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async expectFolderSaveDisabled() {
    await expect(this.page.locator(this.folderSaveBtn)).toBeDisabled();
  }

  async expectFolderSaveEnabled() {
    await expect(this.page.locator(this.folderSaveBtn)).toBeEnabled();
  }

  async openMoveDialog(reportName) {
    await this.page.locator(this.moveReportBtn(reportName)).click({ force: true });
    await expect(this.page.locator(this.moveDialogHeader)).toBeVisible({ timeout: 5000 });
  }

  async expectMoveButtonDisabled() {
    await expect(this.page.locator(this.moveSubmitBtn)).toBeDisabled();
  }

  async expectMoveButtonEnabled() {
    await expect(this.page.locator(this.moveSubmitBtn)).toBeEnabled();
  }

  async selectMoveDestination(folderName) {
    await this.page.locator(this.moveFolderSelect).click();
    // Quasar q-select popup — wait for the target option to appear
    await this.page.getByRole('option', { name: folderName }).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.getByRole('option', { name: folderName }).click();
    // Wait for the q-select popup to close
    await this.page.getByRole('listbox').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async clickMove() {
    await this.page.locator(this.moveSubmitBtn).click();
    await this.page.locator(this.moveDialogHeader).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async cancelMove() {
    await this.page.locator(this.moveCancelBtn).first().click();
    await this.page.locator(this.moveDialogHeader).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async expectDefaultFolderExists() {
    await expect(this.getTabByName('default')).toBeVisible({ timeout: 10000 });
  }

  async expectMoreIconNotVisible(folderName) {
    const tab = this.getTabByName(folderName);
    await tab.hover();
    await expect(tab.locator(this.moreIcon)).not.toBeVisible({ timeout: 3000 });
  }

  async expectMoreIconVisible(folderName) {
    const tab = this.getTabByName(folderName);
    await tab.hover();
    await expect(tab.locator(this.moreIcon)).toBeVisible({ timeout: 3000 });
  }

  async toggleAllFolders() {
    await this.page.locator(this.allFoldersToggle).click();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async searchReports(query) {
    await this.page.locator(this.reportSearchInput).fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async clearReportSearch() {
    await this.page.locator(this.reportSearchInput).clear();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async expectReportVisibleInTable(reportName) {
    await expect(
      this.page.locator(`[data-test="report-list-${reportName}-pause-start-report"]`)
    ).toBeVisible({ timeout: 10000 });
  }

  async expectReportNotVisibleInTable(reportName) {
    await expect(
      this.page.locator(`[data-test="report-list-${reportName}-pause-start-report"]`)
    ).not.toBeVisible({ timeout: 5000 });
  }

  async getFolderCount() {
    return await this.page.locator(`${this.folderTabsContainer} [role="tab"]`).count();
  }

  async getFirstReportWithMoveButton() {
    const btn = this.page.locator('[data-test*="-move-report"]').first();
    const testId = await btn.getAttribute('data-test');
    if (!testId) return null;
    return testId.replace('report-list-', '').replace('-move-report', '');
  }

  async expectAllFoldersToggleVisible() {
    await expect(this.page.locator(this.allFoldersToggle)).toBeVisible();
  }

  async isFolderTabPresent(folderName) {
    return await this.getTabByName(folderName).isVisible({ timeout: 2000 }).catch(() => false);
  }

  async deleteFolderIfExists(folderName) {
    if (await this.isFolderTabPresent(folderName)) {
      await this.clickDeleteFolder(folderName);
      await this.confirmDelete();
      return true;
    }
    return false;
  }

  // ===== BULK OPERATION METHODS =====

  async selectAllReports() {
    const headerCheckbox = this.page.locator(`${this.reportTable} thead .q-checkbox`).first();
    await headerCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    await headerCheckbox.click();
    await this.page.waitForTimeout(300);
  }

  async expectBulkButtonsVisible() {
    await expect(this.page.locator(this.bulkMoveBtn)).toBeVisible({ timeout: 5000 });
    await expect(this.page.locator(this.bulkPauseBtn)).toBeVisible({ timeout: 5000 });
    await expect(this.page.locator(this.bulkDeleteBtn)).toBeVisible({ timeout: 5000 });
  }

  async expectBulkButtonsHidden() {
    await expect(this.page.locator(this.bulkMoveBtn)).not.toBeVisible({ timeout: 3000 });
  }

  async clickBulkMove() {
    await this.page.locator(this.bulkMoveBtn).click();
    await expect(this.page.locator(this.moveDialogHeader)).toBeVisible({ timeout: 5000 });
  }

  async clickBulkPause() {
    await this.page.locator(this.bulkPauseBtn).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickBulkResume() {
    await this.page.locator(this.bulkResumeBtn).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickBulkDelete() {
    await this.page.locator(this.bulkDeleteBtn).click();
    await expect(this.page.locator(this.bulkDeleteConfirmDialog)).toBeVisible({ timeout: 5000 });
  }

  async confirmBulkDelete() {
    await this.page.locator(this.bulkDeleteConfirmBtn).click();
    await this.page.locator(this.bulkDeleteConfirmDialog).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async cancelBulkDelete() {
    await this.page.locator(this.bulkDeleteCancelBtn).click();
    await this.page.locator(this.bulkDeleteConfirmDialog).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async getSelectedReportCount() {
    const rows = this.page.locator(`${this.reportTable} tbody tr.selected`);
    return await rows.count();
  }

  async isBulkResumeBtnVisible() {
    return await this.page.locator(this.bulkResumeBtn).isVisible({ timeout: 2000 }).catch(() => false);
  }
}
