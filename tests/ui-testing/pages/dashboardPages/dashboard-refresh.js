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
    const relBtn = this.page.locator(`[data-test="date-time-relative-${date}-${time}-btn"]`);
    await relBtn.waitFor({ state: "attached" });
    // Use JS click — the dropdown can extend outside the viewport in the new layout
    await relBtn.evaluate((el) => el.click());
    await this.applyBtn.evaluate((el) => el.click());
  }

  // Set absolute time selection with dynamic start and end days
  async selectAbsolutetime(startDay, endDay) {
    // Open the date-time picker
    await this.timeTab.click();

    // Switch to the absolute tab
    await this.absolutetimeTime.click();

    // Click the prev button in the new Reka UI date range calendar to navigate to previous month.
    const prevBtn = this.page.locator('[data-test="daterangecalendar-prev"]').first();
    await prevBtn.waitFor({ state: "visible" });
    await prevBtn.click();
    await this.page.waitForTimeout(500);

    // Select the start and end days dynamically.
    // Scope to the calendar root and exclude outside-view / disabled cells
    // so day "1" resolves to the visible month's cell, not a disabled neighbour.
    const visibleCell = (day) =>
      this.page
        .locator(
          '[data-test="daterangecalendar-root"] [data-reka-calendar-cell-trigger]:not([data-outside-view]):not([data-disabled])'
        )
        .filter({ hasText: new RegExp(`^${String(day)}$`) })
        .first();

    await visibleCell(startDay).click();
    await visibleCell(endDay).click();

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