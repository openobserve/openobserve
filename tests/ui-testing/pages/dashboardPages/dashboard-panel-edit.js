//dashboard panel edit page
// Methods: Duplicate panel, Edit panel, Delete panel, Download json, Download csv, Move to another tab, Fullscreen panel, Refresh panel, Edit layout, Go to logs, Create alert from panel
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

    // VERIFIED: Create Alert from Panel Menu (PanelContainer.vue:289)
    this.createAlertFromPanel = page.locator('[data-test="dashboard-create-alert-from-panel"]');

    // VERIFIED: Alert Context Menu selectors (AlertContextMenu.vue)
    this.alertContextMenu = page.locator('[data-test="alert-context-menu"]');
    this.alertContextMenuAbove = page.locator('[data-test="alert-context-menu-above"]');
    this.alertContextMenuBelow = page.locator('[data-test="alert-context-menu-below"]');

    // VERIFIED: Chart renderer (ChartRenderer.vue:19)
    this.chartRendererCanvas = page.locator('[data-test="chart-renderer"]');
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

  // Create Alert from panel dropdown menu
  async createAlertFromPanelMenu(panelName) {
    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.createAlertFromPanel.waitFor({ state: "visible" });
    await this.createAlertFromPanel.click();
  }

  // Right-click on chart to open alert context menu
  async rightClickChartForAlert() {
    const chartCanvas = this.chartRendererCanvas.first();
    await chartCanvas.waitFor({ state: "visible", timeout: 15000 });
    // Click center of the chart canvas with right-click
    await chartCanvas.click({ button: "right", position: { x: 200, y: 100 } });
  }

  // Verify alert context menu is visible
  async expectAlertContextMenuVisible() {
    const { expect } = require('@playwright/test');
    await expect(this.alertContextMenu).toBeVisible({ timeout: 10000 });
  }

  // Verify alert context menu is hidden
  async expectAlertContextMenuHidden() {
    const { expect } = require('@playwright/test');
    await expect(this.alertContextMenu).not.toBeVisible({ timeout: 5000 });
  }

  // Select "above threshold" from alert context menu
  // Uses dispatchEvent because the teleported context menu is covered by the app overlay
  // which intercepts pointer events - dispatchEvent fires directly on the DOM node
  async selectAlertAboveThreshold() {
    await this.alertContextMenuAbove.waitFor({ state: "visible" });
    await this.alertContextMenuAbove.dispatchEvent("click");
  }

  // Select "below threshold" from alert context menu
  // Uses dispatchEvent because the teleported context menu is covered by the app overlay
  // which intercepts pointer events - dispatchEvent fires directly on the DOM node
  async selectAlertBelowThreshold() {
    await this.alertContextMenuBelow.waitFor({ state: "visible" });
    await this.alertContextMenuBelow.dispatchEvent("click");
  }

  //open Query inspector

  async openQueryInspector(panelName) {
    const dropdownBtn = this.page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`);

    // Wait for dropdown button to be visible with retry
    await dropdownBtn.waitFor({ state: "visible", timeout: 15000 });
    await dropdownBtn.click();

    // Wait for query inspector option with retry
    try {
      await this.queryInspector.waitFor({ state: "visible", timeout: 10000 });
    } catch (e) {
      // Menu may not have opened, retry click
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
      await dropdownBtn.click();
      await this.queryInspector.waitFor({ state: "visible", timeout: 10000 });
    }
    await this.queryInspector.click();
  }
}
