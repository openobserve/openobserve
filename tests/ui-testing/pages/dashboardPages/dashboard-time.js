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
  }
  // set relative time range
  async setRelativeTimeRange(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M

    await this.page.waitForSelector(
      '[data-test="date-time-btn"]:not([disabled])',
      {
        timeout: 15000,
      }
    );
    await this.timePickerBtn.click();

    await this.page
      .locator(`[data-test="date-time-relative-${rangeCode}-btn"]`)
      .click();
    await this.applyTimeBtn.click();
  }
}
