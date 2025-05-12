// pages/chartTypeSelector.js
// Methods : selectChartType, selectStreamType, searchAndAddField,  selectStream

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

  //  Stream Type select
  async selectStreamType(type) {
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
    await streamInput.press("Control+a");
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
    console.log(`Adding field: ${fieldName} to: ${target}`);
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.click();
    await searchInput.fill(fieldName);

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

    const button = this.page.locator(`[data-test="${buttonTestId}"]`);

    // Click the button
    console.log(`Clicking button: ${buttonTestId}`);
    console.log("before click button", button);

    await button.click();
    console.log("after click");
  }

  // Add filter condition
  async addFilterCondition(initialFieldName, newFieldName, operator, value) {
    // Step 1: Click the existing field if provided
    if (initialFieldName) {
      await this.page
        .locator(
          `[data-test="dashboard-add-condition-label-0-${initialFieldName}"]`
        )
        .click();
    }

    // Step 2: Change field if newFieldName is provided
    if (newFieldName) {
      const fieldDropdown = this.page.locator(
        '[data-test="dashboard-add-condition-column-0\\}"]'
      );

      await fieldDropdown.click();
      await fieldDropdown.fill(newFieldName);

      await this.page
        .getByRole("option", { name: newFieldName, exact: true })
        .first()
        .click();
    }

    const selectedField = newFieldName || initialFieldName;

    // Step 3: Open the condition configuration if operator or value is being handled
    if (operator || value) {
      await this.page
        .locator('[data-test="dashboard-add-condition-list-0"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-add-condition-condition-0"]')
        .click();
    }

    // Step 4: Select operator if provided
    if (operator) {
      await this.page
        .locator('[data-test="dashboard-add-condition-operator"]')
        .click();
      await this.page
        .getByRole("option", { name: operator, exact: true })
        .nth(0)
        .click();
    }

    // Step 5: Enter value if provided
    if (value) {
      const valueInput = this.page.locator(
        '[data-test="common-auto-complete"]'
      );
      await valueInput.click();
      await valueInput.fill(value);
    } else if (operator && selectedField) {
      // Step 6: Assert dynamic error message for missing value
      const expectedError = `Filter: ${selectedField}: Condition value required`;
      const errorMessageLocator = this.page
        .locator("div")
        .filter({ hasText: expectedError })
        .first();
      // await expect(errorMessageLocator).toBeVisible();
    }
  }

  //remove fields

  // Remove field by type (x, y, breakdown, etc.)
  async removeField(fieldName, target) {
    console.log(`Removing field: ${fieldName} from: ${target}`);

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
      `[data-test="${baseTestId}-${fieldName}-remove"]`
    );

    await removeButton.waitFor({ state: "visible", timeout: 5000 });
    await removeButton.click();
    console.log(`Removed field: ${fieldName} from ${target}`);
  }

  //drag and drop fields
}
