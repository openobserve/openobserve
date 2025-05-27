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
  }
  generateUniqueDashboardnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  async dashboardNameChange(name) {
    await this.setting.click();
    await this.general.waitFor({ state: "visible" });
    await this.newName.click();
    await this.newName.fill(name);
    await this.saveSettingBtn.click();
  }

  //Add Tabs//
  generateUniqueTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Tab Settings//

  //Add new tab//
  async addTabSetting(tabnewName) {
    await this.setting.waitFor({ state: "visible" });
    await this.setting.click();
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    await this.addtab.click();
    await this.tabName.fill(tabnewName);
    await this.saveTab.click();
  }

  //Delete tab
  async deleteTabSetting() {
    await this.setting.waitFor({ state: "visible" });
    await this.setting.click();
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
    await this.setting.waitFor({ state: "visible" });
    await this.setting.click();
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
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
}
