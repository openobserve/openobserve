//Methods: Drilldown Name, Drilldown by dashboard, Drilldown by URL, Drilldown by logs

export default class DashboardDrilldownPage {
  constructor(page) {
    this.page = page;
    this.addDrilldownButton = page.locator(
      '[data-test="dashboard-addpanel-config-drilldown-add-btn"]'
    );
    this.drilldownNameInput = page.locator(
      '[data-test="dashboard-config-panel-drilldown-name"]'
    );
    this.folderSelect = page.locator(
      '[data-test="dashboard-drilldown-folder-select"]'
    );
    this.dashboardSelect = page.locator(
      '[data-test="dashboard-drilldown-dashboard-select"]'
    );
    this.tabSelect = page.locator(
      '[data-test="dashboard-drilldown-tab-select"]'
    );
    this.addBtn = page.locator('[data-test="confirm-button"]');
    this.newtabOpen = page.locator(
      '[data-test="dashboard-drilldown-open-in-new-tab"]'
    );
    this.urlBtn = page.locator('[data-test="dashboard-drilldown-by-url-btn"]');
    this.urlInput = page.locator(
      '[data-test="dashboard-drilldown-url-textarea"]'
    );
    this.logBtn = page.locator('[data-test="dashboard-drilldown-by-logs-btn"]');
  }

  generateUniqueDrilldownName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  // Generate a unique dashboard name
  generateDashboardName(prefix = "dashboard") {
    return `${prefix}_${Date.now()}`;
  }

  //Add Drilldown by Dashboard
  async addDrilldownDashboard(
    folderName,
    drilldownName,
    dashboardName,
    tabName
  ) {
    await this.addDrilldownButton.waitFor({ state: "visible" });
    await this.addDrilldownButton.click();
    await this.drilldownNameInput.waitFor({ state: "visible" });
    await this.drilldownNameInput.fill(drilldownName);
    await this.folderSelect.waitFor({ state: "visible" });
    await this.folderSelect.click();
    await this.page.getByRole("option", { name: folderName }).click();
    await this.dashboardSelect.click();
    await this.page.getByRole("option", { name: dashboardName }).click();
    await this.tabSelect.click();
    await this.page.getByRole("option", { name: tabName }).click();
    await this.addBtn.click();
  }

  //Add addDrilldownByURL
  async addDrilldownByURL(drilldownName, url) {
    await this.addDrilldownButton.waitFor({ state: "visible" });
    await this.addDrilldownButton.click();
    await this.drilldownNameInput.waitFor({ state: "visible" });
    await this.drilldownNameInput.fill(drilldownName);
    await this.urlBtn.click();
    await this.urlInput.fill(url);
    await this.newtabOpen.click();
    await this.addBtn.click();
  }

  // AddDrilldown by logs
  async addDrilldownByLogs(drilldownName) {
    await this.addDrilldownButton.waitFor({ state: "visible" });
    await this.addDrilldownButton.click();
    await this.drilldownNameInput.waitFor({ state: "visible" });
    await this.drilldownNameInput.fill(drilldownName);
    await this.logBtn.click();
    await this.newtabOpen.click();
    await this.addBtn.click();
  }
}
