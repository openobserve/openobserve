import { expect } from "@playwright/test";

//methods : setRelativeTimeRange

// Utility function to wait for date-time button to be enabled
export async function waitForDateTimeButtonToBeEnabled(page) {
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', { timeout: 15000 });
}

export default class DateTimeHelper {
  constructor(page) {
    this.page = page;
    this.timePickerBtn = page.locator('[data-test="date-time-btn"]');
    this.applyTimeBtn = page.locator('[data-test="date-time-apply-btn"]');
    this.globalPicker = page.locator('[data-test="dashboard-global-date-time-picker"]');
    this.globalTimeBtn = this.globalPicker.locator('[data-test="date-time-btn"]');
    this.globalTimeLabel = this.globalPicker.locator(".date-time-label");
    this.globalPrevBtn = this.globalPicker.locator('[data-test="date-time-prev-btn"]');
    this.globalNextBtn = this.globalPicker.locator('[data-test="date-time-next-btn"]');
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
  }

  // Day row chips are today/yesterday; This and Last rows are week/month/quarter/year.
  calendarPeriodBtn(chip, row) {
    return this.page.locator(`[data-test="date-time-relative-${chip}-${row}-btn"]`);
  }

  // Picks a Day/This/Last chip in the dashboard header picker and applies it.
  async setCalendarPeriod(chip, row) {
    const chipBtn = this.calendarPeriodBtn(chip, row);
    // Same swallowed-click guard as setRelativeTimeRange: the picker disables while panels load.
    await expect(async () => {
      if (!(await chipBtn.isVisible())) {
        await this.globalTimeBtn.click({ timeout: 5000 });
      }
      await expect(chipBtn).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 45000, intervals: [250, 500, 1000, 2000] });

    await chipBtn.evaluate((el) => el.click());
    await this.applyTimeBtn.evaluate((el) => el.click());
  }

  async expectGlobalTimeLabel(expected) {
    await expect(this.globalTimeLabel).toHaveText(expected);
  }

  async expectPeriodInURL(token) {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.get("period"), { timeout: 15000 })
      .toBe(token);
  }

  async clickGlobalPrev() {
    await expect(this.globalPrevBtn).toBeEnabled({ timeout: 15000 });
    await this.globalPrevBtn.click();
  }

  async clickGlobalNext() {
    await expect(this.globalNextBtn).toBeEnabled({ timeout: 15000 });
    await this.globalNextBtn.click();
  }

  async expectGlobalNextDisabled() {
    await expect(this.globalNextBtn).toBeDisabled();
  }

  // The tooltip is the absolute range plus the picker timezone, e.g. "2026/10/01 00:00:00 - 2026/10/08 08:30:00 (UTC)".
  async expectGlobalTimeTooltip(pattern) {
    await this.globalTimeBtn.hover();
    await expect(this.tooltip.filter({ hasText: pattern })).toBeVisible({ timeout: 5000 });
    await this.page.mouse.move(0, 0);
  }
  // set relative time range
  async setRelativeTimeRange(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M

    const relBtn = this.page.locator(`[data-test="date-time-relative-${rangeCode}-btn"]`);

    // ViewDashboard binds the picker's :disable to arePanelsLoading, so a click can land just after it goes disabled and silently never open the popover.
    await expect(async () => {
      if (!(await relBtn.isVisible())) {
        await this.timePickerBtn.click({ timeout: 5000 });
      }
      await expect(relBtn).toBeVisible({ timeout: 5000 });
    // Budget covers maxquery's deliberately slow panels holding arePanelsLoading true; the inner click stays short so a swallowed click is re-tried fast.
    }).toPass({ timeout: 45000, intervals: [250, 500, 1000, 2000] });

    // Use JS click — the dropdown can extend outside the viewport in the new layout
    await relBtn.evaluate((el) => el.click());
    await this.applyTimeBtn.evaluate((el) => el.click());
  }
}
