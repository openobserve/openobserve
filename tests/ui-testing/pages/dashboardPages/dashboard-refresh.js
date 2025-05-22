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
    this.absTime = page.locator('[data-test="date-time-absolute-tab"]');
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
    await this.timeTab.click();
    await this.relativeTime.waitFor({ state: "visible" });
    await this.relativeTime.click();
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`).waitFor({
      state: "visible",
    });
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
    await this.applyBtn.click();
  }

  // Absolute time selection
  async setAbsolute(date) {
    await this.timeTab.click();
    await this.absTime.click();
    await this.page
      .locator(`[data-test="date-time-absolute-${date}-btn"]`)
      .dblclick();
    await this.applyBtn.click();
  }

  //Refresh Button with time selection manuall
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
