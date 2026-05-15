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
      '[data-test="logs-search-bar-refresh-interval-btn"]'
    );
    this.offBtn = page.locator(
      '[data-test="logs-search-off-refresh-interval"]'
    );
    this.refresh = page.locator('[data-test="dashboard-refresh-btn"]');
  }

  //relative time selection
  async setRelative(date, time) {
    // Wait until the trigger is visible (not just attached). attached only
    // checks DOM presence, but in CI the button can be in the DOM before its
    // q-menu is ready to open — clicking too early opens nothing and the
    // subsequent relativeTime.click() waits forever.
    await this.timeTab.waitFor({ state: "visible" });

    // Click the trigger and verify the menu actually opened. If the relative
    // tab doesn't show within a short window, click again — the first click
    // sometimes lands while the chart is re-rendering and gets swallowed.
    await this.timeTab.click();
    try {
      await this.relativeTime.waitFor({ state: "visible", timeout: 5000 });
    } catch (e) {
      await this.timeTab.click();
      await this.relativeTime.waitFor({ state: "visible", timeout: 10000 });
    }

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

    // Click the left chevron button within the QDate component to navigate to previous month.
    // Scope to .q-date to avoid clicking unrelated chevron_left buttons on the page.
    const qDate = this.page.locator(".q-date").first();
    await qDate.waitFor({ state: "visible" });
    await qDate
      .locator("button")
      .filter({ hasText: "chevron_left" })
      .first()
      .click();
    await this.page.waitForTimeout(500);

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