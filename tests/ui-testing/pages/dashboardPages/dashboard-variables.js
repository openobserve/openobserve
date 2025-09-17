//dashboard variables page object
//methods: addDashboardVariable, selectValueFromVariableDropDown
import { expect } from "@playwright/test";

export default class DashboardVariables {
  constructor(page) {
    this.page = page;
  }

  // Method to add a dashboard variable
  // Parameters: name, streamtype, streamName, field
  async addDashboardVariable(
    name,
    streamtype,
    streamName,
    field,
    customValueSearch = false // it is used only when we want to search custom value from variable dropdown
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

    // Save Variable and Close Settings (skip if customValueSearch is true)
    if (!customValueSearch) {
      await this.page
        .locator('[data-test="dashboard-variable-save-btn"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-settings-close-btn"]')
        .click();
    }

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

      // Save Variable and Close Settings
      await this.page
        .locator('[data-test="dashboard-variable-save-btn"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-settings-close-btn"]')
        .click();
    }
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
