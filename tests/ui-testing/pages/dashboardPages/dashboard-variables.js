//dashboard variables page object
//methods: addDashboardVariable, selectValueFromVariableDropDown
import { expect } from "@playwright/test";

export default class DashboardVariables {
  constructor(page) {
    this.page = page;
  }

  // Method to add a dashboard variable
  // Parameters: name, streamtype, streamName, field, customValueSearch, filterConfig
  async addDashboardVariable(
    name,
    streamtype,
    streamName,
    field,
    customValueSearch = false, // it is used only when we want to search custom value from variable dropdown
    filterConfig = null // optional filter configuration { filterName, operator, value }
  ) {
    // Open Variable Tab
    await this.page
      .locator('[data-test="dashboard-settings-variable-tab"]')
      .click();

    // Add Variable
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    // Select Stream Type
    await this.page
      .locator(
        'div.row label:has-text("Stream Type") >> [data-test="dashboard-variable-stream-type-select"]'
      )
      .click();

    await this.page
      .getByRole("option", { name: streamtype, exact: true })
      .locator("div")
      .nth(2)
      .click();

    // Stream Select
    const streamSelect = this.page.locator(
      '[data-test="dashboard-variable-stream-select"]'
    );
    await streamSelect.click();
    await streamSelect.fill(streamName);
    await this.page
      .getByRole("option", { name: streamName, exact: true })
      .click();

    // Select Field
    await this.page
      .locator('[data-test="dashboard-variable-field-select"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill(field);
    await this.page.getByText(field).click();

    // Add Filter Configuration if provided
    if (filterConfig) {
      await this.page.waitForTimeout(2000);

      await this.page.locator('[data-test="dashboard-add-filter-btn"]').click();
      await this.page.waitForTimeout(2000);
      await this.page
        .locator('[data-test="dashboard-query-values-filter-name-selector"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-query-values-filter-name-selector"]')
        .fill(filterConfig.filterName);

      await this.page
        .getByRole("option", { name: filterConfig.filterName })
        .click();

      await this.page
        .locator(
          '[data-test="dashboard-query-values-filter-operator-selector"]'
        )
        .click();
      await this.page
        .getByRole("option", { name: filterConfig.operator, exact: true })
        .locator("div")
        .nth(2)
        .click();
      await this.page.locator('[data-test="common-auto-complete"]').click();
      await this.page
        .locator('[data-test="common-auto-complete"]')
        .fill(filterConfig.value);
      await this.page.waitForTimeout(2000);
      // await this.page
      //   .locator('[data-test="common-auto-complete-option"]')
      //   .getByText(filterConfig.value, { exact: true })
      //   .click();
    }

    await this.page.waitForTimeout(2000);

    // Custom Value Search if want to search custom value from variable dropdown
    if (customValueSearch) {
      await this.page
        .locator(
          '[data-test="dashboard-query_values-show_multiple_values"] div'
        )
        .nth(2)
        .click();
      await this.page
        .locator(
          '[data-test="dashboard-multi-select-default-value-toggle-custom"]'
        )
        .click();
      await this.page
        .locator('[data-test="dashboard-add-custom-value-btn"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-variable-custom-value-0"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-variable-custom-value-0"]')
        .fill("test");
    }

    // Save Variable and Close Settings (skip if customValueSearch is true)
    // if (!customValueSearch) {
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for the save action to complete and DOM to stabilize
    await this.page.waitForTimeout(3000);

    // Use JavaScript evaluation to click the close button to avoid DOM instability issues
    await this.page.evaluate(() => {
      const closeBtn = document.querySelector('[data-test="dashboard-settings-close-btn"]');
      if (closeBtn) closeBtn.click();
    });
    // }
  }

  // Dynamic function to fill input by label
  // Usage: this function is used for select the variable value from dropdown
  // Dynamically fill input and select the same value from dropdown
  async selectValueFromVariableDropDown(label, value) {
    const input = this.page.getByLabel(label, { exact: true });
    await input.waitFor({ state: "visible", timeout: 10000 });
    await input.click();
    await input.fill(value);

    const option = this.page.getByRole("option", { name: value });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
  }
}
