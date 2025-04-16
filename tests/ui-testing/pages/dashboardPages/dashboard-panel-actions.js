// Dashboard actions page
// Methods : AddPanelName, SavePanel, ApplyDashboardBtn

export default class DashboardactionPage {
  constructor(page) {
    this.page = page;

    this.panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.applydashbaord = page.locator('[data-test="dashboard-apply"]');
  }

  // Add panel name
  async AddPanelName(panelName) {
    await this.panelNameInput.click();
    await this.panelNameInput.fill(panelName);
    await this.panelSaveBtn.click();
  }

  // Save panel button

  async SavePanel() {
    await this.panelSaveBtn.click();
  }

  //Apply dashboard button
  async ApplyDashboardBtn() {
    await this.applydashbaord.click();
  }
}
