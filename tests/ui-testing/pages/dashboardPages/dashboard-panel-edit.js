//dashboard panel edit page
// Methods: Duplicate panel, Edit panel, Delete panel, Download json, Download csv, Move to another tab, Fullscreen panel, Refresh panel, Edit layout, Go to logs
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
    this.deleteConfirmBtn = page.locator('[data-test="confirm-button"]');
    this.fullscreen = page.locator(
      '[data-test="dashboard-panel-fullscreen-btn"]'
    );
    this.refreshBtn = page.locator(
      '[data-test="dashboard-panel-refresh-panel-btn"]'
    );
    this.editLayout = page.locator('[data-test="dashboard-edit-layout"]');
    this.panelHeight = page.locator(
      '[data-test="panel-layout-settings-height-input"]'
    );
    this.saveLayout = page.locator('[data-test="panel-layout-settings-save"]');
    this.cancelLayout = page.locator(
      '[data-test="panel-layout-settings-cancel"]'
    );
    this.goToLogs = page.locator('[data-test="dashboard-move-to-logs-module"]');
    this.queryInspector = page.locator(
      '[data-test="dashboard-query-inspector-panel"]'
    );
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
    await this.deleteConfirmBtn.waitFor({ state: "visible" });
    await this.deleteConfirmBtn.click();
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

  //fullscreen panel
  async fullscreenPanel() {
    await this.page.locator('[data-test="dashboard-panel-container"]').hover();
    await this.fullscreen.waitFor({ state: "visible" });
    await this.fullscreen.click();
    await this.page.waitForSelector(
      '[data-test="dashboard-viewpanel-close-btn"]',
      { state: "visible" }
    );
    await this.page
      .locator('[data-test="dashboard-viewpanel-close-btn"]')
      .click();
  }

  //refresh panel
  async refreshPanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.refreshBtn.waitFor({ state: "visible" });
    await this.refreshBtn.click();
  }

  //edit layout
  async editLayoutPanel(panelName, height) {
    // await this.page
    //   .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
    //   .waitFor({ state: "visible" });
    // await this.page
    //   .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
    //   .click();
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .waitFor({ state: "visible" })
      .click();
    await this.editLayout.waitFor({ state: "visible" });
    await this.editLayout.click();
    await this.panelHeight.waitFor({ state: "visible" });
    await this.panelHeight.click();
    await this.panelHeight.fill(height);
    await this.saveLayout.click();
  }

  //Edit Panel: Go to logs
  async goToLogsPanel(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.goToLogs.waitFor({ state: "visible" });
    await this.goToLogs.click();
  }

  //open Query inspector

  async openQueryInspector(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.queryInspector.waitFor({ state: "visible" });
    await this.queryInspector.click();
  }
}
