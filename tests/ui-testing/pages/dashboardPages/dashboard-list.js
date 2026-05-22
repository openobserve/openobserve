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
    const confirmButton = page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]'
    );
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
    const confirmButton = this.page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]'
    );
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

  // Menu Items — menu-link data-test contains a literal "/" (route prefix);
  // CSS attribute selectors accept "/" verbatim, no escape needed.
  async menuItem(item) {
    const menuItem = this.page.locator(`[data-test="menu-link-/${item}"]`);
    await menuItem.click();
  }

  // Click on a dashboard by name to open it. The dashboard list table
  // exposes `data-test="dashboard-name-cell-<name>"` on each name cell
  // (Dashboards.vue), so we resolve the target via that data-test directly
  // — no XPath, no element selectors, no title-attribute matching.
  //
  // The list is paginated (20 per page) with no default newest-first sort,
  // so a freshly-created dashboard can land on page 2+ and not be visible.
  // Type into the dashboard-search input first to narrow the table to the
  // single matching row before clicking.
  async clickOnDashboard(dashboardName) {
    const nameCell = this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`,
    );
    if (!(await nameCell.isVisible().catch(() => false))) {
      // OInput exposes its inner native input as `<parent>-field`.
      const searchInput = this.page.locator(
        '[data-test="dashboard-search-field"]',
      );
      if (await searchInput.count()) {
        await searchInput.first().fill(dashboardName);
        await this.page.waitForTimeout(800);
      }
    }
    await nameCell.waitFor({ state: "visible", timeout: 15000 });
    await nameCell.click();
  }
}
