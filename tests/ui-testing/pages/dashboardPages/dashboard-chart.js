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

    // Locate the specific field item container that contains the field name
    const fieldItem = this.page.locator(`[data-test^="field-list-item-"]`, {
      hasText: fieldName,
    });

    // Now locate the button within that field item
    const button = fieldItem.locator(`[data-test="${buttonTestId}"]`);
    // await button.waitFor({ state: "enabled" });

    // Click the button
    await button.click();
    //    // Clear the search input after adding the field
    await this.page.waitForTimeout(2000); // Wait for any UI updates
    await this.page.getByLabel("Clear").click();
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
  // Add filter condition its working
  async addFilterCondition(
    index,
    initialFieldName,
    newFieldName,
    operator,
    value
  ) {
    const idx = String(index);

    // Step 1: Click on the initial field name if provided
    if (initialFieldName) {
      await this.page
        .locator(
          `[data-test="dashboard-add-condition-label-${idx}-${initialFieldName}"]`
        )
        .click();
    }

    // Step 2: Select the new field from dropdown
    if (newFieldName) {
      const fieldDropdown = this.page.locator(
        `[data-test="dashboard-add-condition-column-${idx}}"]`
      );
      await fieldDropdown.click();
      await fieldDropdown.fill(newFieldName);
      await this.page
        .getByRole("option", { name: newFieldName, exact: true })
        .first()
        .click();
    }

    // Step 3: Open the condition selector
    if (operator || value) {
      const conditionLocator = this.page.locator(
        `[data-test="dashboard-add-condition-condition-${idx}"]`
      );
      await conditionLocator.click();
      await conditionLocator.click(); // double click for stability
    }

    // Step 4: Operator dropdown
    if (operator) {
      const operatorLocator =
        index === 0
          ? this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .first()
          : this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .last();

      await operatorLocator.click();
      await this.page
        .getByRole("option", { name: operator, exact: true })
        .first()
        .click();
    }

    // Step 5: Enter value (if required)
    if (value) {
      const valueInput =
        index === 0
          ? this.page.locator('[data-test="common-auto-complete"]').first()
          : this.page.locator('[data-test="common-auto-complete"]').last();

      // await expect(valueInput).toBeVisible({ timeout: 10000 });
      await valueInput.click();
      await valueInput.fill(value);

      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();
      // await expect(suggestion).toBeVisible({ timeout: 10000 });
      await suggestion.click();
    } else if (operator && (newFieldName || initialFieldName)) {
      const selectedField = newFieldName || initialFieldName;
      const expectedError = `Filter: ${selectedField}: Condition value required`;

      const errorMessage = this.page
        .locator("div")
        .filter({ hasText: expectedError })
        .first();
    }
  }

  // Select List Filter Items in the test case we have to slect the itesm pass in Array
  //eg   ["ingress-nginx", "kube-system"]

  async selectListFilterItems(index, fieldName, values) {
    // console.log("Selecting list filter items", values);

    const idx = String(index);

    const labelLocator = this.page.locator(
      `[data-test="dashboard-add-condition-label-${idx}-${fieldName}"]`
    );
    await labelLocator.waitFor({ state: "visible" });
    await labelLocator.click();

    const listTab = this.page.locator(
      '[data-test="dashboard-add-condition-list-tab"]'
    );
    await listTab.waitFor({ state: "visible" });
    await listTab.click();

    await this.page
      .locator('[data-test="dashboard-add-condition-list-item"]')
      .first()
      .waitFor({ state: "visible" });

    for (const val of values) {
      // console.log(`Selecting option: ${val}`, values);

      const option = this.page
        .getByRole("option", { name: val, exact: true })
        .locator('[data-test="dashboard-add-condition-list-item"]');
      // console.log(`Selecting option: ${val}`, option);

      await option.waitFor({ state: "visible" });
      await option.click();
    }
  }
}
