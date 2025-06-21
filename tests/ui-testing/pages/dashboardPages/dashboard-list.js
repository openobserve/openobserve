//Methods: Duplicate dashboard, Delete duplicate dashboard, Move dashboard, Menu Items(dashboards)

import { expect } from "@playwright/test";
import {
  deleteDashboard,
  waitForDashboardPage,
} from "../../playwright-tests/utils/dashCreation";

export default class DashboardListPage {
  constructor(page) {
    this.page = page;
  }

  // Duplicate dashboard
  async duplicateDashboard(dashboardName) {
    await this.page.locator('[data-test="dashboard-duplicate"]').click();
  }

  //Delete duplicate dashboard
  async deleteDuplicateDashboard(page, dashboardName) {
    console.log(`Deleting dashboard with name: ${dashboardName}`);

    const dashboardRow = page.locator(`//tr[.//td[text()="${dashboardName}"]]`);
    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');
    await deleteButton.click();

    // Wait for the confirmation popup and confirm deletion
    const confirmButton = page.locator('[data-test="confirm-button"]');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Ensure the dashboard is removed
    await expect(
      page.getByText("Dashboard deleted successfully")
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
}
