import { expect } from "@playwright/test";

// pages/chartTypeSelector.js
export default class ChartTypeSelector {
  constructor(page) {
    this.page = page;
  }

  // Chart Type select
  async selectChartType(chartType) {
    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible", timeout: 5000 });
    console.log(`Selecting chart type: ${chartType}`);
    await chartOption.click();
  }

  // Strem Type select
  async selectStreamType(type) {
    console.log(`Selecting stream type: ${type}`);

    // Click the dropdown
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();

    await this.page
      .getByRole("option", { name: type })
      .locator("div")
      .nth(2)
      .click();
  }

  // Stream select
  async selectStream(streamName) {
    const streamInput = this.page.locator(
      '[data-test="index-dropdown-stream"]'
    );
    await streamInput.click();
    await streamInput.press("Control+a"); // Use 'Meta+a' for Mac
    await streamInput.fill(streamName);

    const streamOption = this.page
      .getByRole("option", { name: streamName, exact: true })
      .locator("div")
      .nth(2);

    await streamOption.waitFor({ state: "visible", timeout: 5000 });
    await streamOption.click();
  }

  // Search field and added for X, Y,Breakdown etc.
  async searchAndAddField(fieldName, target) {
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.click();
    await searchInput.fill(fieldName);

    // await this.page.waitForSelector(
    //   `[data-test="index-field-item"]:has-text("${fieldName}")`
    // );

    const buttonSelectors = {
      x: '[data-test="dashboard-add-x-data"]',
      y: '[data-test="dashboard-add-y-data"]',
      b: '[data-test="dashboard-add-b-data"]',
      filter: '[data-test="dashboard-add-filter-data"]',
    };

    const buttonSelector = buttonSelectors[target];

    if (!buttonSelector) {
      throw new Error(`Invalid target type: ${target}`);
    }

    await this.page.locator(buttonSelector).click();
  }
}
