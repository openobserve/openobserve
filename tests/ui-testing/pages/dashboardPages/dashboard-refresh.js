//Dahboard time refresh
// Methods: Set relative time selection, Set absolute time selection, Auto refresh interval, Refresh dashboard manual
export default class DashboardTimeRefresh {
  constructor(page) {
    this.page = page;
    this.dashboardsMenuItem = page.locator(
      '[data-test="menu-link-\\/dashboards-item"]'
    );
    this.defaultTab = page.locator(
      '[data-test="dashboard-folder-tab-default"]'
    );
    this.timeTab = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');
    this.absolutetimeTime = page.locator(
      '[data-test="date-time-absolute-tab"]'
    );
    this.applyBtn = page.locator('[data-test="date-time-apply-btn"]');
    this.selectTime = page.locator('[data-test="date-time-relative-10-m-btn"]');
    this.refreshBtnManual = page.locator(
      '[data-test="logs-search-bar-refresh-interval-btn-dropdown"]'
    );
    this.offBtn = page.locator(
      '[data-test="logs-search-off-refresh-interval"]'
    );
    this.refresh = page.locator('[data-test="dashboard-refresh-btn"]');
  }

  //relative time selection
  async setRelative(date, time) {
    await this.timeTab.waitFor({ state: "attached" });
    await this.timeTab.click();

    await this.relativeTime.click();
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .waitFor({
        state: "visible",
      });
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
    await this.applyBtn.click();
  }

  // Set absolute time selection with dynamic start and end days
  async selectAbsolutetime(startDay, endDay) {
    // Open the date-time picker
    await this.timeTab.click();

    // Switch to the absolute tab
    await this.absolutetimeTime.click();

    // Click the left chevron button (if needed)
    await this.page
      .locator("button")
      .filter({ hasText: "chevron_left" })
      .first()
      .click();

    // Select the start and end days dynamically
    await this.page
      .getByRole("button", { name: String(startDay) })
      .last()
      .click();
    await this.page
      .getByRole("button", { name: String(endDay) })
      .last()
      .click();

    // Optionally, click the apply button to confirm the selection
    await this.applyBtn.click();
  }

  //Refresh Button with time selection manual
  async autoRefreshInterval(time) {
    await this.refreshBtnManual.waitFor({ state: "visible" });
    await this.refreshBtnManual.click();
    await this.page
      .locator(`[data-test="logs-search-bar-refresh-time-${time}"]`)
      .click();
    await this.offBtn.click();
  }

  //Refresh dashboard
  async refreshDashboard() {
    await this.refresh.click();
  }
}