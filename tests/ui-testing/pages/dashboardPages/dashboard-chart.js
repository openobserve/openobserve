// pages/chartTypeSelector.js
// Methods : selectChartType, selectStreamType, searchAndAddField,  selectStream

const testLogger = require("../../playwright-tests/utils/test-logger.js");

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
    await chartOption.click();
  }

  //  Stream Type select - waits for stream list to load after selection
  async selectStreamType(type) {
    // Click the dropdown
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();

    await this.page
      .getByRole("option", { name: type })
      .locator("div")
      .nth(2)
      .click();

    // CRITICAL: Wait for stream list API call to complete after changing type
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(1000);
  }

  // Stream select with retry mechanism (no page reload to preserve context)
  async selectStream(streamName, maxRetries = 3) {
    const streamInput = this.page.locator(
      '[data-test="index-dropdown-stream"]'
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Close any open dropdown first
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(500);

        await streamInput.click();
        await this.page.waitForTimeout(500);

        // Log all available options in dropdown for debugging
        const allOptions = await this.page.locator('[role="listbox"] [role="option"]').allTextContents();
        testLogger.debug(`Attempt ${attempt}: Looking for "${streamName}". Available options (${allOptions.length}): ${allOptions.slice(0, 10).join(', ')}`);

        await streamInput.press("Control+a");
        await streamInput.fill(streamName);
        await this.page.waitForTimeout(1500);

        const streamOption = this.page
          .getByRole("option", { name: streamName, exact: true })
          .locator("div")
          .nth(2);

        await streamOption.waitFor({ state: "visible", timeout: 15000 });
        await streamOption.click();
        return; // Success
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt: log full diagnostic info
          const finalOptions = await this.page.locator('[role="listbox"] [role="option"]').allTextContents().catch(() => []);
          testLogger.error(`FAILED after ${maxRetries} attempts. Final options: ${finalOptions.join(', ')}`);
          throw error;
        }
        // Close dropdown and wait before retry (don't reload - loses context!)
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(3000);
      }
    }
  }

  // Search field and added for X, Y,Breakdown etc.

  async searchAndAddField(fieldName, target) {
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.click();
    await searchInput.fill(fieldName);

    await this.page.waitForTimeout(1000);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const buttonTestId = buttonSelectors[target];

    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    // Locate the specific field item container using the exact field name in the data-test attribute
    // The format is: field-list-item-{streamType}-{streamName}-{fieldName}
    // We combine ^= (starts with) and $= (ends with) to ensure exact match
    // Use .first() to handle self-join scenarios where the same field appears twice
    const fieldItem = this.page.locator(`[data-test^="field-list-item-"][data-test$="-${fieldName}"]`).first();

    // Now locate the button within that field item
    const button = fieldItem.locator(`[data-test="${buttonTestId}"]`);

    // Click the button
    await button.waitFor({ state: "visible", timeout: 5000 });
    await button.click();
    await searchInput.fill(""); // Clear the search input
  }

  //remove fields from the dashboard
  // Remove field by type (x, y, breakdown, etc.)
  // @param alias - The field alias (e.g., "x_axis_1", "y_axis_1", "breakdown_1")
  // @param target - The target type (x, y, b, filter, etc.)
  async removeField(alias, target) {
    const removeSelectors = {
      x: "dashboard-x-item",
      y: "dashboard-y-item",
      b: "dashboard-b-item",
      filter: "dashboard-filter-item",
      latitude: "dashboard-latitude-item",
      longitude: "dashboard-longitude-item",
      weight: "dashboard-weight-item",
      z: "dashboard-z-item",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const baseTestId = removeSelectors[target];
    if (!baseTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const removeButton = this.page.locator(
      `[data-test="${baseTestId}-${alias}-remove"]`
    );

    await removeButton.waitFor({ state: "visible", timeout: 10000 });
    await removeButton.click();
  }

  // Helper function to wait for table data to load completely
  async waitForTableDataLoad() {
    // Wait for table to be visible
    await this.page.waitForSelector('[data-test="dashboard-panel-table"]', {
      timeout: 10000,
    });

    // Wait for table to have data (non-empty tbody)
    await this.page.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-test="dashboard-panel-table"]'
        );
        const rows = table?.querySelectorAll("tbody tr");
        return (
          rows &&
          rows.length > 0 &&
          Array.from(rows).some((row) =>
            Array.from(row.querySelectorAll("td")).some(
              (cell) => cell.textContent.trim() !== ""
            )
          )
        );
      },
      { timeout: 15000 }
    );
  }

  // ===== Y-AXIS FUNCTION CONFIGURATION METHODS =====

  /**
   * Open the Y-axis function configuration popup
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1", "y_axis_2")
   */
  async openYAxisFunctionPopup(alias) {
    const yAxisItem = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    await yAxisItem.waitFor({ state: "visible", timeout: 10000 });
    await yAxisItem.click();

    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "visible", timeout: 10000 });
    await this.page.waitForTimeout(500);
  }

  /**
   * Select a function from the function dropdown
   * @param {string} functionName - The function to select (e.g., "count", "sum", "avg", "min", "max", "Distinct")
   */
  async selectFunction(functionName) {
    const dropdown = this.page.locator('[data-test="dashboard-function-dropdown"]').first();
    await dropdown.waitFor({ state: "visible", timeout: 10000 });
    await dropdown.click();
    await this.page.waitForTimeout(300);

    await this.page.keyboard.type(functionName);
    await this.page.waitForTimeout(500);

    // Use case-insensitive contains match - filtering by typing already narrows options
    const option = this.page.getByRole("option", { name: new RegExp(functionName, 'i') }).first();
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Verify Y-axis label contains expected function name
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} expectedFunction - The expected function name in the label
   * @param {Function} expect - Playwright expect function
   */
  async verifyYAxisLabel(alias, expectedFunction, expect) {
    const yAxisLabel = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    const labelText = await yAxisLabel.textContent();
    expect(labelText.toLowerCase()).toContain(expectedFunction.toLowerCase());
    return labelText;
  }

  /**
   * Configure a Y-axis field with a function in one method
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} functionName - The function to apply (e.g., "count", "sum")
   */
  async configureYAxisFunction(alias, functionName) {
    await this.openYAxisFunctionPopup(alias);
    await this.selectFunction(functionName);
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(500);
  }
}
