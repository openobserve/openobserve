// methods: createDashboard, searchDashboard, AddPanel, applyButton

export default class DashboardCreate {
  /**
   * Constructor for the DashboardCreate object
   * @param {Page} page - The page object to interact with
   */
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

  //Create Dashboard
  async createDashboard(dashboardName) {
    // Wait for the dashboards list API to complete loading before clicking
    await this.page.waitForResponse(
      response => {
        const url = response.url();
        return url.includes('/api/') &&
               url.includes('/dashboards') &&
               url.includes('page_num=0') &&
               response.status() === 200;
      },
      { timeout: 50000 }
    );

    await this.dashCreateBtn.waitFor({ state: "visible", timeout: 50000 });
    await this.dashCreateBtn.click();

    await this.dashName.waitFor({ state: "visible", timeout: 50000 });
    await this.dashName.click();
    await this.dashName.fill(dashboardName);

    await this.submitBtn.waitFor({ state: "visible", timeout: 50000 });
    await this.submitBtn.click();
  }

  //back to dashboard list
  async backToDashboardList() {
    await this.backBtn.waitFor({ state: "visible", timeout: 50000 });
    await this.backBtn.click();
  }

  //Search the Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.click();
    await this.searchDash.fill(dashboardName);
  }

  //Delete Dashboard
  async deleteDashboard() {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    const dashboardRow = this.page.locator('[data-test="dashboard-table"]');
    await dashboardRow.waitFor({ state: "visible" });
    await dashboardRow.locator('[data-test="dashboard-delete"]').first().click();
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
    await this.addPanelIfEmptyBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.addPanelIfEmptyBtn.click();
  }

  //Apply dashboard button
  async applyButton() {
    await this.applyQueryBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.applyQueryBtn.click();
  }
}
