export default class StreamSettingsPage {
  constructor(page) {
    this.page = page;

    // Global locators
    this.searchInput = page.getByPlaceholder("Search Stream");
    this.streamDetailButton = page.getByRole("button", {
      name: "Stream Detail",
    });
    this.maxQueryInput = page.locator(
      '[data-test="stream-details-max-query-range-input"]'
    );
    this.saveButton = page.locator(
      '[data-test="schema-update-settings-button"]'
    );
    this.closeButton = page.locator("button", { hasText: "close" });
  }

  async updateStreamMaxQueryRange(streamName, newValue) {
    // Open Stream Details
    // Search for the stream
    await this.searchInput.click();
    await this.searchInput.fill(streamName);
    await this.page.waitForTimeout(3000);

    // Wait for stream details to appear and click

    await this.streamDetailButton.waitFor({ state: "visible", timeout: 5000 });
    await this.streamDetailButton.click();

    // Wait and update max query range input
    await this.maxQueryInput.waitFor({ state: "visible", timeout: 15000 });
    await this.maxQueryInput.click();
    await this.maxQueryInput.fill(newValue);

    // Save the changes
    await this.saveButton.waitFor({ state: "visible", timeout: 15000 });
    await this.saveButton.click();

    // Close the modal
    await this.closeButton.waitFor({ state: "visible", timeout: 15000 });
    await this.closeButton.click();
  }
}
