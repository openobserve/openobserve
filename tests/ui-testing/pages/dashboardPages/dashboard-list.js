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

  // Delete a dashboard from the list by name — uses the same data-test name
  // cell as `clickOnDashboard` so the row is resolved without any XPath /
  // element / title-attribute fallback.
  async deleteDuplicateDashboard(dashboardName) {
    const nameCell = this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`,
    );
    // Narrow the paginated list via the search input if the row isn't on the
    // first page (Dashboards.vue's TenstackTable doesn't sort newest-first).
    if (!(await nameCell.isVisible().catch(() => false))) {
      const searchInput = this.page.locator(
        '[data-test="dashboard-search-field"]',
      );
      if (await searchInput.count()) {
        await searchInput.first().fill(dashboardName);
        await this.page.waitForTimeout(800);
      }
    }
    await nameCell.waitFor({ state: "visible", timeout: 15000 });
    // OTable stamps each row with `data-test="o2-table-row-{N}"`; walk from
    // the matched name cell up to its enclosing row via XPath ancestor axis
    // on the data-test attribute (no element-tag predicate).
    const dashboardRow = nameCell.locator(
      "xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]",
    );
    await dashboardRow.locator('[data-test="dashboard-delete"]').click();

    // Confirm the deletion dialog.
    const confirmButton = this.page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    );
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // OToast surfaces the success message via `data-test="o-toast-message"`.
    await expect(
      this.page.locator('[data-test="o-toast-message"]').first(),
    ).toBeVisible();
  }

  // Move dashboard — OSelect listbox items expose `data-test-value="<value>"`
  // (see OSelect.vue) so target the folder option by value instead of role.
  async moveDashboardToAnotherFolder(folder) {
    await this.page
      .locator('[data-test="dashboard-move-to-another-folder"]')
      .click();
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();
    await this.page
      .locator(
        `[data-test="index-dropdown-stream_type-option"][data-test-value="${folder}"]`,
      )
      .first()
      .click();
    await this.page.locator('[data-test="dashboard-folder-move"]').click();
  }

  // Menu Items — menu-link data-test contains a literal "/" (route prefix);
  // CSS attribute selectors accept "/" verbatim, no escape needed.
  async menuItem(item) {
    const menuItem = this.page.locator(`[data-test="menu-link-/${item}"]`);
    await menuItem.click();
    await this.page.waitForURL(`**/${item.replace('-item', '')}**`, { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');
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
