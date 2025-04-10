import { expect } from "@playwright/test";

// pages/chartTypeSelector.js
export default class ChartTypeSelector {
  constructor(page) {
    this.page = page;
  }

  // Dynamically select a chart type by its type name
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
}
