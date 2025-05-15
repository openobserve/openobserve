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

  generateUniqueDashboardnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  async openSetting() {
    await this.page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    await this.setting.click();
  }
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
  async cancelSettingDashboard() {
    await this.cancelBtn.waitFor({ state: "visible" });
    await this.cancelBtn.click();
  }
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
  async saveTabSetting() {
    await this.saveTab.click();
  }

  //Delete tab
  async deleteTabSetting() {
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    await this.deletebtn.waitFor({ state: "visible" });
    await this.deletebtn.click();
    await this.deleteconfirmBtn.waitFor({ state: "visible" });
    await this.deleteconfirmBtn.click();
  }

  //Edit tab
  editTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  async editTabName(newName) {
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    await this.page
      .locator('[data-test="dashboard-tab-settings-drag"] div')
      .filter({ hasText: "drag_indicatortestedit" });

    await this.editBtn.waitFor({ state: "visible" });
    await this.editBtn.click();
    await this.editName.click();
    await this.editName.fill(newName);
  }

  //Full screen//
  async fullScreenSettings() {
    await this.fullScreen.waitFor({ state: "visible" });
    await this.fullScreen.click();
  }
  async cancelTabwithoutSave() {
    await this.page.locator('[data-test="dashboard-add-cancel"]').click();
  }

  async saveEditedtab() {
    await this.page
      .locator('[data-test="dashboard-tab-settings-tab-name-edit-save"]')
      .click();
  }

  async cancelEditedtab() {
    await page
      .locator('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]')
      .click();
  }
  async deleteTab() {
    await this.page.locator('[data-test="confirm-button"]').click();
  }
  async openVariables() {
    await this.page
      .locator('[data-test="dashboard-settings-variable-tab"]')
      .click();
  }

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

  //select Constand type
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

  async addMaxRecord(value) {
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .fill(value);
  }

  async enableMultiSelect() {
    await this.page
      .locator('[data-test="dashboard-query_values-show_multiple_values"]')
      .click();
  }

  // async addDefaultValue() {
  //   await this.page.locator('[data-test="dashboard-multi-select-default-value-toggle-first-value"]').click();
  //   await this.page.locator('[data-test="dashboard-multi-select-default-value-toggle-first-value"]').fill(value);
  // }
  async addCustomValue(value) {
    await this.page
      .locator(
        '[data-test="dashboard-multi-select-default-value-toggle-custom"]'
      )
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .fill(value);
  }
  async saveVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-save-btn"]')
      .click();
  }

  async cancelVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-cancel-btn"]')
      .click();
  }

  async hideVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-hide_on_dashboard"]')
      .click();
  }
  async closeSettingWindow() {
    await this.page
      .locator('[data-test="dashboard-settings-close-btn"]')
      .click();
  }
}
