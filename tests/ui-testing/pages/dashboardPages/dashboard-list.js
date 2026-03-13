//Methods: Duplicate dashboard, Delete duplicate dashboard, Move dashboard, Menu Items(dashboards)

import { expect } from "@playwright/test";
// import { deleteDashboard } from "../../playwright-tests/Dashboards/utils/dashCreation.js";

export default class DashboardListPage {
  constructor(page) {
    this.page = page;
  }

  // Duplicate dashboard
  async duplicateDashboard() {
    await this.page.locator('[data-test="dashboard-duplicate"]').click();
  }

  //Delete duplicate dashboard
  async deleteDuplicateDashboard(page, dashboardName) {
    const dashboardRow = page.locator(`//tr[.//div[@title="${dashboardName}"]]`);
    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');
    await deleteButton.click();

    // Wait for the confirmation popup and confirm deletion
    const confirmButton = page.locator('[data-test="confirm-button"]');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Ensure the dashboard is removed
    await expect(
      page.getByText("Dashboard deleted successfully").first()
    ).toBeVisible();
  } // ...existing code...

  //Delete duplicate dashboard
  async deleteDuplicateDashboard(dashboardName) {
    const dashboardRow = this.page.locator(
      `//tr[.//div[@title="${dashboardName}"]]`
    );
    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');
    await deleteButton.click();

    // Wait for the confirmation popup and confirm deletion
    const confirmButton = this.page.locator('[data-test="confirm-button"]');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Ensure the dashboard is removed
    await expect(
      this.page.getByText("Dashboard deleted successfully").first()
    ).toBeVisible();
  }
  // Move dashboard
  async moveDashboardToAnotherFolder(folder) {
    await this.page
      .locator('[data-test="dashboard-move-to-another-folder"]')
      .click();
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();
    await this.page.getByRole("option", { name: folder }).click();
    await this.page.locator('[data-test="dashboard-folder-move"]').click();
  }

  // Menu Items
  async menuItem(item) {
    const MenuItem = this.page.locator(`[data-test="menu-link-\\/${item}"]`);
    await MenuItem.click();
  }

  // Click on a dashboard by name to open it
  async clickOnDashboard(dashboardName) {
    // Find the dashboard row by title and click on it
    const dashboardRow = this.page.locator(`//tr[.//div[@title="${dashboardName}"]]`);
    await dashboardRow.waitFor({ state: "visible", timeout: 10000 });
    // Click on the dashboard name/title area to open it
    const dashboardTitle = dashboardRow.locator(`div[title="${dashboardName}"]`);
    await dashboardTitle.click();
  }
}
