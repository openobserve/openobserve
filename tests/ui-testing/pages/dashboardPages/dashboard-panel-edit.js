export default class DashboardPanel {
  constructor(page) {
    this.page = page;

    this.editArrow = page.locator(
      '[data-test="dashboard-edit-panel-area-test-dropdown"]'
    );
    this.duplicate = page.locator('[data-test="dashboard-duplicate-panel"]');
    this.dashboardsMenuItem = page.locator(
      '[data-test="menu-link-/dashboards-item"]'
    );
    this.applyBtn = page.locator('[data-test="dashboard-apply"]');
    this.namepanel = page.locator('[data-test="dashboard-panel-name"]');
    this.saveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.edit = page.locator('[data-test="dashboard-edit-panel"]');
    this.delete = page.locator('[data-test="dashboard-delete-panel"]');
    this.downloadJson = page.locator(
      '[data-test="dashboard-panel-download-as-json-btn"]'
    );
    this.downloadCsv = page.locator(
      '[data-test="dashboard-panel-download-as-csv-btn"]'
    );
    this.moveTab = page.locator(
      '[data-test="dashboard-move-to-another-panel"]'
    );
    this.deleteconfrimBtn = page.locator('[data-test="confirm-button"]');
  }

  // Duplicate panel
  async duplicatePanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.duplicate.waitFor({ state: "visible" });
    await this.duplicate.click();
  }

  //Edit panel

  async editPanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.edit.waitFor({ state: "visible" });
    await this.edit.click();
  }

  //Delete panel
  async deletePanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.delete.waitFor({ state: "visible" });
    await this.delete.click();
    await this.deleteconfrimBtn.waitFor({ state: "visible" });
    await this.page.locator(this.deleteconfrimBtn).click();
  }

  //Download json
  async downloadJsonPanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.downloadJson.waitFor({ state: "visible" });
    await this.downloadJson.click();
  }

  //Download csv
  async downloadCsvPanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.downloadCsv.waitFor({ state: "visible" });
    await this.downloadCsv.click();
  }

  //move to another tab
  async movePanelToAnotherTab() {
    await this.editArrow.click();
    await this.moveTab.waitFor({ state: "visible" });
    await this.moveTab.click();
  }
}
