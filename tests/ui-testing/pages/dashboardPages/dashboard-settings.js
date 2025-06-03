// Dashboard Setting Page Object
// This class contains methods to interact with the dashboard settings page in OpenObserve.
// This includes changing the dashboard name, adding tabs, managing variables, and more.
export default class DashboardSetting {
  constructor(page) {
    this.page = page;
    this.setting = page.locator('[data-test="dashboard-setting-btn"]');
    this.general = page.locator('[data-test="dashboard-settings-general-tab"]');
    this.variables = page.locator(
      '[data-test="dashboard-settings-variable-tab"]'
    );
    this.tab = page.locator('[data-test="dashboard-settings-tab-tab"]');
    this.addtab = page.locator('[data-test="dashboard-tab-settings-add-tab"]');
    this.time = page.locator('[data-test="date-time-btn"]');
    this.dynamicFilter = page.locator(
      '[data-test="dashboard-general-setting-dynamic-filter"]'
    );
    this.newName = page.locator('[data-test="dashboard-general-setting-name"]');
    this.saveSettingBtn = page.locator(
      '[data-test="dashboard-general-setting-save-btn"]'
    );
    this.cancelBtn = page.locator('[data-test="cancel-button"]');
    this.deletebtn = page.locator(
      '[data-test="dashboard-tab-settings-tab-delete-btn"]'
    );
    this.editBtn = page.locator(
      '[data-test="dashboard-tab-settings-tab-edit-btn"]'
    );
    this.deleteconfirmBtn = page.locator('[data-test="confirm-button"]');
    this.editName = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    this.fullScreen = page.locator('[data-test="dashboard-fullscreen-btn"]');
    this.tabName = page.locator('[data-test="dashboard-add-tab-name"]');
    this.saveTab = page.locator('[data-test="dashboard-add-tab-submit"]');
    this.closeSetting = page.locator(
      '[data-test="dashboard-settings-close-btn"]'
    );
    this.timeBtn = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');

    this.addTabCancel = page.locator('[dashboard-add-cancel"]');
    this.EditSave = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit-save"]'
    );
  }

  //Dashboard Settings//
  //Generate unique dashboard name
  generateUniqueDashboardnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Open Dashboard Setting//
  async openSetting() {
    await this.page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    await this.setting.click();
  }
  //General Setting//
  //Change Dashboard Name//
  async dashboardNameChange(name) {
    await this.general.waitFor({ state: "visible" });
    await this.newName.waitFor({ state: "visible" });
    await this.newName.click();
    await this.newName.fill(name);
  }

  //Time Setting//
  async relativeTimeSelection(date, time) {
    await this.page
      .locator(
        '[data-test="dashboard-general-setting-datetime-picker"] [data-test="date-time-btn"]'
      )
      .click();

    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
  }

  //Save Setting//
  async saveSetting() {
    await this.saveSettingBtn.waitFor({ state: "visible" });
    await this.saveSettingBtn.click();
  }

  //Cancel dashboard changes//
  async cancelSettingDashboard() {
    await this.cancelBtn.waitFor({ state: "visible" });
    await this.cancelBtn.click();
  }
  //close setting dashboard//
  async closeSettingDashboard() {
    await this.closeSetting.waitFor({ state: "visible" });
    await this.closeSetting.click();
  }

  //show dynamic filter//
  async showDynamicFilter() {
    await this.dynamicFilter.waitFor({ state: "visible" });
    await this.dynamicFilter.click();
  }
  //Add Tabs//
  generateUniqueTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Tab Settings//

  //Add new tab//
  async addTabSetting(tabnewName) {
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    await this.addtab.click();
    await this.tabName.fill(tabnewName);
  }

  //save new tab setting//
  async saveTabSetting() {
    await this.saveTab.click();
  }

  //Edit tab in settings//
  editTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Full screen//
  async fullScreenSettings() {
    await this.fullScreen.waitFor({ state: "visible" });
    await this.fullScreen.click();
  }

  //cancel changes
  async cancelTabwithoutSave() {
    await this.page.locator('[data-test="dashboard-add-cancel"]').click();
  }

  //Cabcel edit tab name//
  async cancelEditedtab() {
    await this.page
      .locator('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]')
      .click();
  }

  //Veribales Settings//
  //Open Variables tab

  async openVariables() {
    await this.page
      .locator('[data-test="dashboard-settings-variable-tab"]')
      .click();
  }

  //Generate unique variable name
  variableName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //variable type: Query Values
  async addVariable(type, variableName, streamType, Stream, field) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page
      .locator('[data-test="dashboard-variable-stream-type-select"]')
      .click();
    await this.page.getByRole("option", { name: streamType }).click();
    await this.page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .click();
    await this.page.getByRole("option", { name: Stream }).click();
    await this.page
      .locator('[data-test="dashboard-variable-field-select"]')
      .click();
    await this.page.getByRole("option", { name: field }).click();
  }

  //select Constant type
  async selectConstantType(type, variableName, value) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page
      .locator('[data-test="dashboard-variable-constant-value"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-constant-value"]')
      .fill(value);
  }

  //select Textbox type
  async selectTextType(type, variableName) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
  }

  //select Custom type
  async selectCustomType(type, variableName, label, value) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page.getByRole("button", { name: "Add Option" }).click();

    await this.page
      .locator('[data-test="dashboard-custom-variable-0-label"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-label"]')
      .fill(label);
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-value"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-value"]')
      .fill(value);
  }
  //add max record size
  async addMaxRecord(value) {
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .fill(value);
  }

  //enable multi select
  async enableMultiSelect() {
    await this.page
      .locator('[data-test="dashboard-query_values-show_multiple_values"]')
      .click();
  }

  //enable default value
  async addCustomValue(value) {
    await this.page;
    '[data-test="dashboard-multi-select-default-value-toggle-custom"]'.click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .fill(value);
  }

  //save variable
  async saveVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-save-btn"]')
      .click();
  }

  //Cancel variable
  async cancelVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-cancel-btn"]')
      .click();
  }

  //hide variable
  async hideVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-hide_on_dashboard"]')
      .click();
  }

  //close setting window
  async closeSettingWindow() {
    await this.page
      .locator('[data-test="dashboard-settings-close-btn"]')
      .click();
  }

  // Update tab name in edit tab options//
  async updateDashboardTabName(oldTabName, updatedTabName) {
    const page = this.page;

    // Open Settings tab
    await page
      .locator('[data-test="dashboard-settings-tab-tab"]')
      .waitFor({ state: "visible" });

    // Locate the tab to be edited based on oldTabName
    const tabLocator = page
      .locator('[data-test="dashboard-tab-settings-drag"] div')
      .filter({ hasText: oldTabName });

    // Click Edit button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-edit-btn"]')
      .click();

    // Click to enable name editing
    const nameEditLocator = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    await nameEditLocator.click();

    // Fill new tab name
    await nameEditLocator.fill(updatedTabName);

    // Save changes
    // await page
    //   .locator('[data-test="dashboard-tab-settings-tab-name-edit-save"]')
    //   .click();
  }

  // Delete tab in edit tab options//

  async deleteTab(oldTabName) {
    const page = this.page;

    // Open Settings tab
    await page
      .locator('[data-test="dashboard-settings-tab-tab"]')
      .waitFor({ state: "visible" });

    // Locate the tab to be deleted based on oldTabName
    const tabLocator = page
      .locator('[data-test="dashboard-tab-settings-drag"] div')
      .filter({ hasText: oldTabName });

    // Click delete button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-delete-btn"]')
      .click();

    // Confirm deletion
    await page
      .locator('[data-test="confirm-button"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="confirm-button"]').click();
  }
}
