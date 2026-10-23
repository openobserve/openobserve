// Create Alert From Source confirm-dialog page object.
// The shared "create an alert from here" confirmation step (app-root mounted via
// CreateAlertDialogProvider in App.vue). Every section renders off the prefill,
// so this owns the dialog shell + the conditional sections the specs assert on.
import { expect } from "@playwright/test";

export default class CreateAlertFromSourceDialogPage {
  constructor(page) {
    this.page = page;

    // Dialog shell + gating visibility (continue/cancel are ODialog buttons inside it).
    this.dialog = page.locator('[data-test="create-alert-from-source-dialog"]');
    this.continueBtn = page.locator(
      '[data-test="create-alert-from-source-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.cancelBtn = page.locator(
      '[data-test="create-alert-from-source-dialog"] [data-test="o-dialog-secondary-btn"]'
    );

    // Query-picker mode (pickQueryOnly): "pick which query" + choice OSelect + picked text.
    this.queryPickerIntro = page.locator('[data-test="create-alert-query-picker-intro"]');
    this.queryPicker = page.locator('[data-test="create-alert-query-picker"]');
    this.queryPickerTrigger = page.locator('[data-test="create-alert-query-picker-trigger"]');
    this.queryPickerOption = page.locator('[data-test="create-alert-query-picker-option"]');
    this.pickedQuery = page.locator('[data-test="create-alert-picked-query"]');
    this.pickedQueryText = page.locator('[data-test="create-alert-picked-query-text"]');

    // Sections suppressed while pickQueryOnly is active (multi-query panel).
    this.thresholdShape = page.locator('[data-test="create-alert-threshold-shape"]');
    this.window = page.locator('[data-test="create-alert-window"]');
    this.queryPreview = page.locator('[data-test="create-alert-query-preview"]');
  }

  async expectDialogVisible() {
    await expect(this.dialog).toBeVisible({ timeout: 15000 });
  }

  async expectDialogHidden() {
    await expect(this.dialog).toBeHidden({ timeout: 15000 });
  }

  async expectQueryPickerVisible() {
    await expect(this.queryPicker).toBeVisible({ timeout: 10000 });
  }

  async expectPickedQueryTextVisible() {
    await expect(this.pickedQueryText).toBeVisible({ timeout: 10000 });
  }

  /** The picked-query text (colorized SQL), trimmed; empty while unset. */
  async getPickedQueryText() {
    await this.pickedQueryText.waitFor({ state: "visible", timeout: 10000 });
    return (await this.pickedQueryText.textContent())?.trim() ?? "";
  }

  async expectThresholdShapeHidden() {
    await expect(this.thresholdShape).toHaveCount(0);
  }

  async expectWindowHidden() {
    await expect(this.window).toHaveCount(0);
  }

  async expectQueryPreviewHidden() {
    await expect(this.queryPreview).toHaveCount(0);
  }

  /** Open the query picker and choose the query at the given (0-based) index. */
  async selectQuery(index) {
    await this.queryPickerTrigger.click();
    await this.queryPickerOption
      .nth(index)
      .waitFor({ state: "visible", timeout: 10000 });
    await this.queryPickerOption.nth(index).click();
  }

  async clickContinue() {
    await this.continueBtn.click();
  }

  async clickCancel() {
    await this.cancelBtn.click();
  }

  async expectContinueDisabled() {
    await expect(this.continueBtn).toBeDisabled();
  }

  async expectWarningVisible(key) {
    await expect(
      this.page.locator(`[data-test="create-alert-warning-${key}"]`)
    ).toBeVisible({ timeout: 10000 });
  }
}
