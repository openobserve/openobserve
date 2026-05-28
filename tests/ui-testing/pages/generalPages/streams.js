import { expect } from "../../playwright-tests/baseFixtures";
export default class StreamSettingsPage {
  constructor(page) {
    this.page = page;

    // Global locators — strict data-test only
    // OInput wrapper for the streams search input — fill the `-field` inner input
    this.searchInputField = page.locator(
      '[data-test="streams-search-stream-input-field"]'
    );
    // The first stream-detail button — scoped to the first o2-table row to avoid strict-mode collisions
    this.firstStreamDetailButton = page
      .locator('[data-test="o2-table-row-0"] [data-test="log-stream-schema-btn"]');
    this.maxQueryInput = page.locator(
      '[data-test="stream-details-max-query-range-input-field"]'
    );
    this.saveButton = page.locator(
      '[data-test="schema-update-settings-button"]'
    );
    this.closeButton = page.locator('[data-test="schema-cancel-button"]').first();
    this.configurationTab = page.locator(
      '[data-test="schema-configuration-tab"]'
    );
    this.successToast = page.locator('[data-test="o-toast-message"]');
  }

  // Scoped helper: returns the "Stream Detail" button inside the row that contains the named cell
  // (case-insensitive — OpenObserve normalizes stream names server-side)
  getStreamDetailButtonForRow(streamName) {
    return this.page
      .locator(`[data-test="log-stream-name-cell-${streamName}"]`)
      .locator("xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]")
      .locator('[data-test="log-stream-schema-btn"]');
  }

  async updateStreamMaxQueryRange(streamName, newValue) {
    // Search for the stream
    await this.searchInputField.click();
    await this.searchInputField.fill(streamName);
    await this.page.waitForTimeout(1500);

    // Click the Stream Detail button for the searched row
    const rowDetailBtn = this.getStreamDetailButtonForRow(streamName);
    await rowDetailBtn.first().waitFor({ state: "visible", timeout: 5000 });
    await rowDetailBtn.first().click();

    // Switch to Configuration tab where max-query-range input lives
    await this.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await this.configurationTab.click();

    // Wait and update max query range input
    await this.maxQueryInput.waitFor({ state: "visible", timeout: 15000 });
    await this.maxQueryInput.click();
    await this.maxQueryInput.fill(newValue);

    // Save the changes
    await this.saveButton.waitFor({ state: "visible", timeout: 15000 });
    await this.saveButton.click();

    // Verify success toast
    await expect(this.successToast.first()).toBeVisible({ timeout: 10000 });

    // Close the schema panel
    await this.closeButton.click();
  }
}
