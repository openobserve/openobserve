// pages/chartTypeSelector.js
// methods: createDashboard, searchDashboard, AddPanel, applyButton

export default class DashboardCreate {
  constructor(page) {
    this.page = page;
    this.dashCreateBtn = this.page.locator('[data-test="dashboard-add"]');
    this.dashName = this.page.locator('[data-test="add-dashboard-name"]');
    this.submitBtn = this.page.locator('[data-test="dashboard-add-submit"]');
    this.deleteIcon = this.page.locator('[data-test="dashboard-delete"]');
    this.confirmDelete = this.page.locator('[data-test="confirm-button"]');
    this.searchDash = this.page.locator('[data-test="dashboard-search"]');
    this.addPanelIfEmptyBtn = this.page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.applyQueryBtn = this.page.locator('[data-test="dashboard-apply"]');
    this.backBtn = this.page.locator('[data-test="dashboard-back-btn"]');
  }

  async createDashboard(dashboardName) {
    await this.dashCreateBtn.waitFor({ state: "visible" });
    await this.dashCreateBtn.click();
    await this.dashName.waitFor({ state: "visible" });
    await this.dashName.click();
    await this.dashName.fill(dashboardName);
    await this.submitBtn.click();
  }

  //back to dashboard list
  async backToDashboardList() {
    await this.backBtn.waitFor({ state: "visible" });
    await this.backBtn.click();
  }

  //Search Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.click();
    await this.searchDash.fill(dashboardName);
  }

  //Delete Dashboard
  async deleteDashboard(dashboardName) {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    const dashboardRow = this.page.locator('[data-test="dashboard-table"]');
    await dashboardRow.waitFor({ state: "visible" });
    await dashboardRow.locator('[data-test="dashboard-delete"]').click();
    const confirmDialog = this.page.locator(
      '[data-test="dashboard-confirm-dialog"]'
    );
    await confirmDialog.waitFor({ state: "visible" });
    const confirmDeleteButton = confirmDialog.locator(
      '[data-test="confirm-button"]'
    );
    await confirmDeleteButton.waitFor({ state: "visible" });
    await confirmDeleteButton.click();
  }

  //Add Panel to dashboard
  async addPanel() {
    await this.addPanelIfEmptyBtn.waitFor({ state: "visible" });
    await this.addPanelIfEmptyBtn.click();
  }

  async applyButton() {
    await this.applyQueryBtn.click();
  }
}
