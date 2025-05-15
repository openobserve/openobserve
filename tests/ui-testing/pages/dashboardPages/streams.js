export default class StreamSettingsPage {
  constructor(page) {
    this.page = page;
  }

  async updateStreamMaxQueryRange(streamName, newValue) {
    const page = this.page;

    // Open Stream Details
    const searchInput = page.getByPlaceholder("Search Stream");
    await searchInput.click();
    await searchInput.fill(streamName);
    await page.waitForTimeout(5000); // Replace with auto-wait logic if needed

    const streamDetailButton = await page.getByRole("button", {
      name: "Stream Detail",
    });
    await streamDetailButton.waitFor({ state: "visible", timeout: 5000 });
    await streamDetailButton.click();

    await page.waitForTimeout(3000);

    // Edit Max Query Range
    const maxQueryInput = page.locator(
      '[data-test="stream-details-max-query-range-input"]'
    );
    await maxQueryInput.waitFor({ state: "visible", timeout: 15000 });
    await maxQueryInput.click();
    await maxQueryInput.fill(newValue);

    // Save changes
    const saveButton = page.locator(
      '[data-test="schema-update-settings-button"]'
    );
    await saveButton.waitFor({ state: "visible", timeout: 5000 });
    await saveButton.click();

    await page.waitForTimeout(3000);

    // Close the modal
    const closeButton = page.locator("button", { hasText: "close" });
    await closeButton.waitFor({ state: "visible", timeout: 5000 });
    await closeButton.click();
  }
}
