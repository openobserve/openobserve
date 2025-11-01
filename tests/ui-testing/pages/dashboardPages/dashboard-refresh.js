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

    // Wait for the date-time picker to be visible
    await this.page.waitForTimeout(500);

    // Wait for relative time tab to be visible before clicking
    await this.relativeTime.waitFor({ state: "visible", timeout: 10000 });
    await this.relativeTime.click();

    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .waitFor({
        state: "visible",
        timeout: 10000,
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

    // Wait for picker to open
    await this.page.waitForTimeout(500);

    // Switch to the absolute tab
    await this.absolutetimeTime.waitFor({ state: 'visible', timeout: 10000 });
    await this.absolutetimeTime.click();

    // Wait for date picker to be visible
    await this.page.waitForSelector('.q-date', { state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(1000);

    // Helper function to find and click a date, navigating if needed
    const clickDateWithNavigation = async (day) => {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        const dayButtons = this.page.getByRole("button", { name: String(day), exact: true });
        const count = await dayButtons.count();

        if (count > 0) {
          // Find a button that's not disabled
          for (let i = 0; i < count; i++) {
            const button = dayButtons.nth(i);
            const isDisabled = await button.getAttribute('disabled');
            if (!isDisabled) {
              await button.click();
              await this.page.waitForTimeout(300);
              return true;
            }
          }
        }

        // If date not found or all disabled, try navigating to next month
        attempts++;
        if (attempts < maxAttempts) {
          const nextButton = this.page.locator("button").filter({ hasText: "chevron_right" }).first();
          await nextButton.click();
          await this.page.waitForTimeout(500);
        }
      }

      throw new Error(`Day ${day} not found after ${maxAttempts} attempts`);
    };

    try {
      // Click start day
      await clickDateWithNavigation(startDay);

      // Click end day
      await clickDateWithNavigation(endDay);

    } catch (error) {
      console.error(`Error selecting dates: ${error.message}`);
      // Take screenshot for debugging
      await this.page.screenshot({ path: 'date-picker-error.png' });
      throw error;
    }

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
