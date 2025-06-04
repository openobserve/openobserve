//Methods: Duplicate dashboard, Move dashboard, Menu Items(dashboards)

import { expect } from "@playwright/test";
import { deleteDashboard } from "../../playwright-tests/utils/dashCreation";

export default class DashboardListPage {
  constructor(page) {
    this.page = page;
  }

  // Duplicate dashboard
  async duplicateDashboard(dashboardName) {
     await this.page.locator('[data-test="dashboard-duplicate"]').click();
    
  }
 

  // Move dashboard
  async moveDashboardToAnotherFolder(folder) {
    await this.page.locator('[data-test="dashboard-move-to-another-folder"]').click();
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();
    await this.page.getByRole('option', { name: folder }).click();
    await this.page.locator('[data-test="dashboard-folder-move"]').click();
  }

  
  // Menu Items
  async menuItem(item) {
    const MenuItem = this.page.locator(`[data-test="menu-link-\\/${item}"]`);
    await MenuItem.click();
  }
}
