import { expect } from "@playwright/test";

/**
 * Page object for the app-level dashboard save-conflict dialog
 * (`DashboardSaveConflictDialog`) and the "Not saved" banner on the dashboard
 * view (`ViewDashboard`). Every selector lives here; the spec only calls these
 * methods so it stays free of raw locators.
 */
export class DashboardSaveConflictPage {
  constructor(page) {
    this.page = page;

    this.dialog = page.locator('[data-test="dashboard-save-conflict-dialog"]');
    this.savedBy = page.locator('[data-test="dashboard-save-conflict-saved-by"]');
    this.changes = page.locator('[data-test="dashboard-save-conflict-changes"]');
    this.panelTouched = page.locator('[data-test="dashboard-save-conflict-panel-touched"]');
    this.panelUntouched = page.locator('[data-test="dashboard-save-conflict-panel-untouched"]');
    this.panelCompare = page.locator('[data-test="dashboard-save-conflict-panel-compare"]');
    this.reloadBtn = page.locator('[data-test="dashboard-save-conflict-reload"]');
    this.overwriteBtn = page.locator('[data-test="dashboard-save-conflict-overwrite"]');
    this.mergeBtn = page.locator('[data-test="dashboard-save-conflict-merge"]');
    this.confirmStep = page.locator('[data-test="dashboard-save-conflict-confirm"]');
    this.confirmSavedBy = page.locator('[data-test="dashboard-save-conflict-confirm-saved-by"]');
    this.confirmOverwriteBtn = page.locator('[data-test="dashboard-save-conflict-confirm-overwrite"]');
    this.reviewStep = page.locator('[data-test="dashboard-save-conflict-review"]');
    this.mergedRows = page.locator('[data-test^="dashboard-save-conflict-merged-"]');
    this.saveMergedBtn = page.locator('[data-test="dashboard-save-conflict-save-merged"]');
    this.unsavedBanner = page.locator('[data-test="dashboard-unsaved-conflict-banner"]');
    this.resolveBtn = page.locator('[data-test="dashboard-unsaved-conflict-resolve"]');
  }

  async expectDialogVisible() {
    await expect(this.dialog).toBeVisible({ timeout: 30000 });
  }

  async expectMainStepVisible() {
    await expect(this.savedBy).toBeVisible({ timeout: 30000 });
    await expect(this.changes).toBeVisible({ timeout: 30000 });
  }

  async expectDialogHidden() {
    await expect(this.dialog).toBeHidden({ timeout: 15000 });
  }

  async expectUnsavedBannerVisible() {
    await expect(this.unsavedBanner).toBeVisible({ timeout: 15000 });
  }

  async expectUnsavedBannerHidden() {
    await expect(this.unsavedBanner).toBeHidden({ timeout: 15000 });
  }

  async clickReload() {
    await this.reloadBtn.waitFor({ state: "visible" });
    await this.reloadBtn.click();
  }

  async clickOverwrite() {
    await this.overwriteBtn.waitFor({ state: "visible" });
    await this.overwriteBtn.click();
  }

  async expectConfirmStepVisible() {
    await expect(this.confirmStep).toBeVisible({ timeout: 15000 });
    await expect(this.confirmSavedBy).toBeVisible({ timeout: 15000 });
  }

  async clickConfirmOverwrite() {
    await this.confirmOverwriteBtn.waitFor({ state: "visible" });
    await this.confirmOverwriteBtn.click();
  }

  async expectPanelUntouchedVisible() {
    await expect(this.panelUntouched).toBeVisible({ timeout: 15000 });
  }

  async expectPanelTouchedVisible() {
    await expect(this.panelTouched).toBeVisible({ timeout: 15000 });
  }

  async expectPanelCompareVisible() {
    await expect(this.panelCompare).toBeVisible({ timeout: 15000 });
  }

  async expectMergeVisible() {
    await expect(this.mergeBtn).toBeVisible({ timeout: 15000 });
  }

  async expectMergeHidden() {
    await expect(this.mergeBtn).toBeHidden({ timeout: 15000 });
  }

  async expectReloadVisible() {
    await expect(this.reloadBtn).toBeVisible({ timeout: 15000 });
  }

  async expectOverwriteVisible() {
    await expect(this.overwriteBtn).toBeVisible({ timeout: 15000 });
  }

  async clickMerge() {
    await this.mergeBtn.waitFor({ state: "visible" });
    await this.mergeBtn.click();
  }

  async expectReviewStepVisible() {
    await expect(this.reviewStep).toBeVisible({ timeout: 15000 });
  }

  async expectMergedRowsVisible() {
    await expect(this.mergedRows.first()).toBeVisible({ timeout: 15000 });
  }

  async clickSaveMerged() {
    await this.saveMergedBtn.waitFor({ state: "visible" });
    await this.saveMergedBtn.click();
  }

  async close() {
    await this.page.keyboard.press("Escape");
  }

  async clickResolve() {
    await this.resolveBtn.waitFor({ state: "visible" });
    await this.resolveBtn.click();
  }
}
