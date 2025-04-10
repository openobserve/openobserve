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
}
