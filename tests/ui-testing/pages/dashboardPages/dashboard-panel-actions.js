// Dashboard actions page
// Methods : AddPanelName, SavePanel, ApplyDashboardBtn, AddNextPanel, GetTableRowCount, VerifyChartRenders

export default class DashboardactionPage {
  constructor(page) {
    this.page = page;

    this.panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.applyDashboard = page.locator('[data-test="dashboard-apply"]');
    this.addPanelBtn = page.locator('[data-test="dashboard-panel-add"]');
    this.dashboardTable = page.locator('[data-test="dashboard-panel-table"]');
    this.chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
    this.noDataElement = page.locator('[data-test="no-data"]');
    this.dashboardSearchInput = page.locator('[data-test="dashboard-search"]');
  }

  // Generate a unique panel name
  generateUniquePanelName(prefix = "panel") {
    const randomStr = Math.random().toString(36).substring(2, 7);
    return `${prefix}_${Date.now()}_${randomStr}`;
  }

  // Add panel name
  async addPanelName(panelName) {
    await this.panelNameInput.click();
    await this.panelNameInput.fill(panelName);
  }

  // Save panel button
  async savePanel() {
    await this.panelSaveBtn.waitFor({ state: "visible" });
    await this.panelSaveBtn.click();

    // Wait for save to complete
    // await this.page.waitForLoadState("networkidle");
  }

  //Apply dashboard button
  async applyDashboardBtn() {
    await this.applyDashboard.click();
  }

  // Wait for chart to render

  async waitForChartToRender() {
    // Wait for button or parent to have light button class (render complete)
    // The parent div.q-btn-group has classes o2-primary-button and o2-secondary-button-light
    await this.page.waitForFunction(() => {
      const btn = document.querySelector('[data-test="dashboard-apply"]');
      if (!btn) return false;

      // Check button itself
      if (btn.classList.contains("o2-primary-button-light") ||
          btn.classList.contains("o2-secondary-button-light")) {
        return true;
      }

      // Check immediate parent (button group container)
      const parent = btn.parentElement;
      if (parent &&
          (parent.classList.contains("o2-primary-button-light") ||
           parent.classList.contains("o2-secondary-button-light"))) {
        return true;
      }

      // Check if parent has both o2-primary-button AND o2-secondary-button-light
      // (which indicates the button group is in the rendered state)
      if (parent &&
          parent.classList.contains("o2-primary-button") &&
          parent.classList.contains("o2-secondary-button-light")) {
        return true;
      }

      return false;
    }, { timeout: 30000 });
  }

  //Dashboard panel actions(Edit, Layout, Duplicate, Inspector, Move, Delete)

  async selectPanelAction(panelName, action) {
    const actionDataTestIds = {
      Edit: "dashboard-edit-panel",
      Layout: "dashboard-edit-layout",
      Duplicate: "dashboard-duplicate-panel",
      Inspector: "dashboard-query-inspector-panel",
      Move: "dashboard-move-to-another-panel",
      Delete: "dashboard-delete-panel",
    };

    const actionTestId = actionDataTestIds[action];
    if (!actionTestId) throw new Error(`Unknown action: ${action}`);

    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.page.locator(`[data-test="${actionTestId}"]`).click();
  }

  /**
   * Click the add panel button to add a new panel after saving the previous one
   * Waits for UI to stabilize before clicking
   */
  async addNextPanel() {
    await this.page.waitForTimeout(2000);
    await this.addPanelBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.addPanelBtn.click();
  }

  /**
   * Get the count of data rows in the dashboard panel table
   * Excludes empty header/footer rows within tbody
   * @returns {Promise<number>} Number of data rows
   */
  async getTableRowCount() {
    await this.page.waitForTimeout(2000);
    const rows = this.dashboardTable.locator('tbody tr');
    const totalRows = await rows.count();

    let dataRowCount = 0;
    for (let i = 0; i < totalRows; i++) {
      const firstCell = rows.nth(i).locator('td').first();
      const cellText = await firstCell.textContent().catch((err) => {
        // Cell may be detached or empty - return empty string to skip counting
        return '';
      });
      if (cellText && cellText.trim() !== '') {
        dataRowCount++;
      }
    }
    return dataRowCount;
  }

  /**
   * Verify that the chart or table renders successfully
   * @param {Function} expect - Playwright expect function
   */
  async verifyChartRenders(expect) {
    await expect(this.chartRenderer.first()).toBeVisible({ timeout: 15000 });
  }

  /**
   * Verify no data element is hidden (data is present)
   * @param {Function} expect - Playwright expect function
   */
  async verifyNoErrors(expect) {
    const noErrors = await this.noDataElement.isHidden();
    expect(noErrors).toBeTruthy();
  }

  /**
   * Wait for the dashboard search input to be visible
   */
  async waitForDashboardSearchVisible() {
    await this.dashboardSearchInput.waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get a dashboard row by name for clicking
   * @param {string} dashboardName - Name of the dashboard
   * @returns {Locator} The dashboard row locator
   */
  getDashboardRow(dashboardName) {
    return this.page.getByRole("row", { name: new RegExp(`.*${dashboardName}`) });
  }
}
