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

  // Helper function to check for dashboard errors
  async checkDashboardErrors() {
    const dashboardErrorContainer = this.page.locator(
      '[data-test="dashboard-error"]'
    );
    const errorContainerExists = await dashboardErrorContainer.count();

    if (errorContainerExists === 0) {
      return { hasErrors: false, errors: [] };
    }

    const isErrorVisible = await dashboardErrorContainer.first().isVisible();
    if (!isErrorVisible) {
      return { hasErrors: false, errors: [] };
    }

    const errors = [];

    // Check for error indicator text
    const errorText = this.page
      .locator('[data-test="dashboard-error"]')
      .getByText(/Errors \(\d+\)/);
    const errorTextCount = await errorText.count();

    if (errorTextCount > 0) {
      const errorTextContent = await errorText.first().textContent();
      errors.push(`Error indicator: ${errorTextContent}`);
    }

    // Check for error list items
    const errorListItems = this.page.locator(
      '[data-test="dashboard-error"] ul li'
    );
    const errorListCount = await errorListItems.count();

    if (errorListCount > 0) {
      for (let i = 0; i < errorListCount; i++) {
        const errorItem = errorListItems.nth(i);
        const errorItemText = await errorItem.textContent();
        if (errorItemText && errorItemText.trim().length > 0) {
          errors.push(`Error ${i + 1}: ${errorItemText.trim()}`);
        }
      }
    }

    return {
      hasErrors: errors.length > 0,
      errors,
      errorTextCount,
      errorListCount,
    };
  }
  // Helper function to verify chart renders successfully
  async verifyChartRenders() {
    const chartRenderer = this.page.locator(
      '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
    );
    const chartExists = await chartRenderer.count();

    if (chartExists > 0) {
      await expect(chartRenderer.first()).toBeVisible();
    }

    return chartExists > 0;
  }
  // Helper function to verify chart type selection
  async verifyChartTypeSelected(chartType, shouldBeSelected = true) {
    const selector = `[data-test="selected-chart-${chartType}-item"]`;
    const locator = this.page.locator(selector).locator("..");

    if (shouldBeSelected) {
      await expect(locator).toHaveClass(/bg-grey-[35]/);
    } else {
      await expect(locator).not.toHaveClass(/bg-grey-[35]/);
    }
  }
}
