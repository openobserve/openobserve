import { expect } from "@playwright/test";

// pages/chartTypeSelector.js
// methods: createDashboard, searchDashboard, AddPanel, applyButton

export default class DashboardCreate {
  constructor(page) {
    this.page = page;
    this.dashCreateBtn = page.locator('[data-test="dashboard-add"]');
    this.dashName = page.locator('[data-test="add-dashboard-name"]');
    this.submitBtn = page.locator('[data-test="dashboard-add-submit"]');
    this.deleteIcon = page.locator('[data-test="dashboard-delete"]');
    this.confirmDelete = page.locator('[data-test="confirm-button"]');
    this.searchDash = page.locator('[data-test="dashboard-search"]');
    this.addPanelIfEmptyBtn = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.applyQueryBtn = page.locator('[data-test="dashboard-apply"]');
  }
  async createDashboard(dashboardName) {
    await this.dashCreateBtn.click();
    await this.dashName.click();
    await this.dashName.fill(dashboardName);
    await this.submitBtn.click();
  }

  //Search Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.click();
    await this.searchDash.fill(dashboardName);
  }

  //Add Panel to dashboard
  async addPanel() {
    await expect(this.addPanelIfEmptyBtn).toBeVisible({ timeout: 5000 });
    await this.addPanelIfEmptyBtn.click();
  }

  async applyButton() {
    await this.applyQueryBtn.click();
  }
}
