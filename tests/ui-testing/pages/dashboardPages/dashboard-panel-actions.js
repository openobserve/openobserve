// Dashboard actions page
// Methods : AddPanelName, SavePanel, ApplyDashboardBtn

export default class DashboardactionPage {
  constructor(page) {
    this.page = page;

    this.panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.applyDashboard = page.locator('[data-test="dashboard-apply"]');
  }

  // Generate a unique panel name
  generateUniquePanelName(prefix = "panel") {
    const randomStr = Math.random().toString(36).substr(2, 5);
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
}
