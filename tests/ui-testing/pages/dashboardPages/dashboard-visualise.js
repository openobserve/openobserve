import { expect } from "@playwright/test";

export default class LogstoVisualise {
  constructor(page) {
    this.page = page;

    // Dashboard locators
    this.addToDashboardBtn = page.getByRole("button", {
      name: "Add To Dashboard",
    });
    this.newDashboardBtn = page.locator(
      '[data-test="dashboard-dashboard-new-add"]'
    );
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardSubmitBtn = page.locator(
      '[data-test="dashboard-add-submit"]'
    );
    this.panelTitleInput = page.locator(
      '[data-test="metrics-new-dashboard-panel-title"]'
    );
    this.updateSettingsBtn = page.locator(
      '[data-test="metrics-schema-update-settings-button"]'
    );
  }
  async addPanelToNewDashboard(randomDashboardName, panelName) {
    // Add to dashboard and submit it
    await this.addToDashboardBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.addToDashboardBtn.click();

    // Wait for and click new dashboard option
    await this.newDashboardBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.newDashboardBtn.click();

    // Fill dashboard name
    await this.dashboardNameInput.waitFor({ state: "visible", timeout: 5000 });
    await this.dashboardNameInput.click();
    await this.dashboardNameInput.fill(randomDashboardName);

    // Submit dashboard creation
    await this.dashboardSubmitBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.dashboardSubmitBtn.click();

    // Wait for panel title input to be available (replacing hardcoded timeout)
    await this.panelTitleInput.waitFor({ state: "visible", timeout: 10000 });
    await this.panelTitleInput.click();
    await this.panelTitleInput.fill(panelName);

    // Submit panel settings
    await this.updateSettingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.updateSettingsBtn.click();
  }
}
