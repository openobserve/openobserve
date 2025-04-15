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
      latitude: '[data-test="dashboard-add-latitude-data"]',
      longitude: '[data-test="dashboard-add-longitude-data"]',
      weight: '[data-test="dashboard-add-weight-data"]',
      z: '[data-test="dashboard-add-z-data"]',
    };

    const buttonSelector = buttonSelectors[target];

    if (!buttonSelector) {
      throw new Error(`Invalid target type: ${target}`);
    }

    await this.page.locator(buttonSelector).click();
  }

  // async addFilterCondition(fieldName, operator, value) {
  //   // Step 1: Click to add condition on existing filter field
  //   await this.page
  //     .locator(`[data-test="dashboard-add-condition-label-0-${fieldName}"]`)
  //     .click();

  //   // Step 2: Click on 'Filters on Field' dropdown
  //   await this.page.getByText("Filters on Fieldarrow_drop_down").click();

  //   // Step 3: Select the field from dropdown
  //   await this.page.getByRole("option", { name: fieldName }).click();

  //   // Step 4: Switch to 'Condition' tab
  //   await this.page
  //     .locator('[data-test="dashboard-add-condition-list-0"]')
  //     .click();
  //   await this.page
  //     .locator('[data-test="dashboard-add-condition-condition-0"]')
  //     .click();

  //   // Step 5: Select operator
  //   await this.page
  //     .locator('[data-test="dashboard-add-condition-operator"]')
  //     .click();
  //   await this.page.getByRole("option", { name: operator }).click();

  //   // Step 6: Enter value
  //   const valueInput = this.page.locator('[data-test="common-auto-complete"]');
  //   await valueInput.click();
  //   await valueInput.fill(value);
  // }

  //Add filter conditions

  async addFilterCondition1(initialFieldName, newFieldName, operator, value) {
    // Step 1: Click to open condition config for the initially added field
    await this.page
      .locator(
        `[data-test="dashboard-add-condition-label-0-${initialFieldName}"]`
      )
      .click();

    // Step 2: Change field from dropdown
    await this.page.getByText("Filters on Fieldarrow_drop_down").click();
    await this.page
      .getByText("Filters on Fieldarrow_drop_down")
      .fill(newFieldName);

    // await this.page;
    // await this.page.getByRole("option", { name: newFieldName }).click();

    // Step 3: Switch to 'Condition' tab
    await this.page
      .locator('[data-test="dashboard-add-condition-list-0"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();

    // Step 4: Select operator
    await this.page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await this.page.getByRole("option", { name: operator }).click();

    // Step 5: Enter value
    const valueInput = this.page.locator('[data-test="common-auto-complete"]');
    await valueInput.click();
    await valueInput.fill(value);
  }
}
