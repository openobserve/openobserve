import { expect } from "../../playwright-tests/baseFixtures";
export default class StreamSettingsPage {
  constructor(page) {
    this.page = page;

    // Global locators
    this.searchInput = page.getByPlaceholder("Search Stream");
    // Select the first "Stream Detail" button to avoid strict mode violations
    this.streamDetailButton = page
      .getByRole("button", { name: "Stream Detail" })
      .first();
    this.maxQueryInput = page.locator(
      '[data-test="stream-details-max-query-range-input"]'
    );
    this.saveButton = page.locator(
      '[data-test="schema-update-settings-button"]'
    );
    this.closeButton = page.locator('[data-test="schema-cancel-button"]');
    this.configurationTab = page.getByRole('tab', { name: 'Configuration' })
  }

  async updateStreamMaxQueryRange(streamName, newValue) {
    // Open Stream Details
    // Search for the stream
    await this.searchInput.click();
    await this.searchInput.fill(streamName);
    // await this.page.waitForTimeout(2000);

    // Click on the Stream Detail button for the specific stream
    await this.page
      .getByRole("cell", { name: streamName })
      .first()
      .locator("..")
      .getByRole("button", { name: "Stream Detail" })
      .click();

    // Wait for stream details to appear and click

    await this.streamDetailButton.waitFor({ state: "visible", timeout: 2000 });
    await this.streamDetailButton.click();
    //before clicking for max query range input we need to go to configuration tab due to schema UI layout change
    await this.configurationTab.waitFor({ state: "visible", timeout: 2000 });
    await this.configurationTab.click();
    // Wait and update max query range input
    await this.maxQueryInput.waitFor({ state: "visible", timeout: 15000 });
    await this.maxQueryInput.click();
    await this.maxQueryInput.fill(newValue);

    // Save the changes
    await this.saveButton.waitFor({ state: "visible", timeout: 15000 });
    await this.saveButton.click();

    // await this.page.waitForTimeout(3000);

    // Wait for the text and assert it's visible
    const successMessage = this.page.getByText("Stream settings updated");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Close the modal
    // await this.closeButton.waitFor({ state: "visible", timeout: 15000 });
    await this.closeButton.click();
  }
}
