import { expect } from "@playwright/test";
import { deleteDashboard } from "../../playwright-tests/utils/dashCreation";

export default class DashboardListPage {
  constructor(page) {
    this.page = page;
  }

  // Duplicate dashboard
  async duplicateDashboard(dashboardName) {
    const duplicateBtn = this.page
      .getByRole("row", { name: new RegExp(`.*${dashboardName}`) })
      .locator('[data-test="dashboard-duplicate"]');
    await duplicateBtn.click();
  }

  // Move dashboard
  async moveDashboardToAnotherFolder(dashboardName) {
    const moveBtn = this.page
      .getByRole("row", { name: new RegExp(`.*${dashboardName}`) })
      .locator('[data-test="dashboard-move-to-another-folder"]');
    await moveBtn.click();
  }
  // Menu Items
  async menuItem(item) {
    const MenuItem = this.page.locator(`[data-test="menu-link-\\/${item}"]`);
    await MenuItem.click();
  }
}
