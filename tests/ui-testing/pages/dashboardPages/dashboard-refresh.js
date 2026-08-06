//Dahboard time refresh
// Methods: Set relative time selection, Set absolute time selection, Auto refresh interval, Refresh dashboard manual
export default class DashboardTimeRefresh {
  constructor(page) {
    this.page = page;
    this.dashboardsMenuItem = page.locator(
      '[data-test="menu-link-\\/dashboards-item"]'
    );
    this.defaultTab = page.locator(
      'button[data-test="dashboard-folder-tab-default"]'
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
    // menu is ready to open — clicking too early opens nothing and the
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
    // Open the date-time picker — wait for the trigger to be visible first.
    await this.timeTab.waitFor({ state: "visible" });
    await this.timeTab.click();

    // Wait for the picker dropdown to render its tabs (relative + absolute).
    // The dropdown animates in, so give the absolute tab enough time to
    // become visible. If the very first click is swallowed mid-animation,
    // a follow-up click on timeTab is unsafe (it would close the dropdown),
    // so we rely on the visibility wait alone.
    await this.absolutetimeTime.waitFor({ state: "visible", timeout: 15000 });

    // Switch to the absolute tab via dispatchEvent so overlay/transition
    // races never block the action. The handler is bound on the OButton
    // element itself, so a synthetic click is enough to flip selectedType.
    await this.absolutetimeTime.evaluate((el) => el.click());

    // Wait for the absolute-tab calendar (daterangecalendar-root) to mount
    // AND for cell triggers to be rendered. Without this, the subsequent
    // prevBtn click can land while Reka UI is still rendering.
    await this.page
      .locator('[data-test="daterangecalendar-root"]')
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await this.page
      .locator(
        '[data-test="daterangecalendar-root"] [data-reka-calendar-cell-trigger]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 10000 });

    // Click the prev button in the new Reka UI date range calendar to navigate to previous month.
    const prevBtn = this.page.locator('[data-test="daterangecalendar-prev"]').first();
    await prevBtn.waitFor({ state: "visible" });
    await prevBtn.evaluate((el) => el.click());
    await this.page.waitForTimeout(500);

    // Each visible cell carries a `data-test="daterangecalendar-cell-YYYY-MM-DD"`
    // (see web/src/lib/forms/DateTimeRange/ODateRangeCalendar.vue). Read the
    // first visible heading (e.g. "April 2026") to compute exact ISO dates so
    // we can target cells by data-test only — no class/text/role selectors.
    const headingText = await this.page
      .locator('[data-test="daterangecalendar-heading"]')
      .first()
      .textContent();
    const monthMap = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
    };
    const headingMatch = String(headingText || "")
      .trim()
      .match(/([A-Za-z]+)\s+(\d{4})/);
    if (!headingMatch) {
      throw new Error(
        `selectAbsolutetime: could not parse calendar heading: "${headingText}"`,
      );
    }
    const monthIdx = monthMap[headingMatch[1]];
    const year = Number(headingMatch[2]);
    const pad = (n) => String(n).padStart(2, "0");
    const isoForDay = (day) =>
      `${year}-${pad(monthIdx + 1)}-${pad(Number(day))}`;
    const startCell = this.page.locator(
      `[data-test="daterangecalendar-cell-${isoForDay(startDay)}"]`,
    );
    const endCell = this.page.locator(
      `[data-test="daterangecalendar-cell-${isoForDay(endDay)}"]`,
    );

    // JS clicks: calendar cells re-render between clicks (Reka UI updates the
    // grid as the range changes), so the second click can target a detached
    // element with regular .click(). evaluate(el => el.click()) sidesteps the
    // stability check entirely.
    await startCell.waitFor({ state: "attached" });
    await startCell.evaluate((el) => el.click());
    await endCell.waitFor({ state: "attached" });
    await endCell.evaluate((el) => el.click());

    // Click the apply button to confirm the selection — JS click matches
    // setRelative() and avoids viewport-clipped action errors.
    await this.applyBtn.evaluate((el) => el.click());

    // Wait for the date picker dropdown to fully close. If the dropdown
    // remains open it overlays the panel's primary buttons (e.g.
    // dashboard-apply) and downstream clicks time out.
    try {
      await this.applyBtn.waitFor({ state: "hidden", timeout: 5000 });
    } catch {
      // Fallback: press Escape to dismiss any lingering portal.
      await this.page.keyboard.press("Escape");
      await this.applyBtn.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }
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