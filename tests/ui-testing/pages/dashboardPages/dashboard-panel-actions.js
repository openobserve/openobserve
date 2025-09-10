// Dashboard actions page
// Methods : AddPanelName, SavePanel, ApplyDashboardBtn

export default class DashboardactionPage {
  constructor(page) {
    this.page = page;

    this.panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.applyDashboard = page.locator('[data-test="dashboard-apply"]');
    this.visualizeRefreshBtn = page.locator(
      '[data-test="logs-search-bar-visualize-refresh-btn"]'
    );
  }

  // Add panel name
  async addPanelName(panelName) {
    await this.panelNameInput.click();
    await this.panelNameInput.fill(panelName);
  }

  // Save panel button
  async savePanel() {
    await this.panelSaveBtn.click();
  }

  //Apply dashboard button
  async applyDashboardBtn() {
    await this.applyDashboard.click();
  }

  // Wait for chart to render

  async waitForChartToRender() {
    // Wait for it to go back to bg-secondary (render complete)
    await this.page.waitForFunction(() => {
      const btn = document.querySelector('[data-test="dashboard-apply"]');
      return btn && btn.classList.contains("bg-secondary");
    });
  }
}
