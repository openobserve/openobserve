import { expect } from "@playwright/test";

//methods : setRelativeTimeRange

export default class DateTimeHelper {
  constructor(page) {
    this.page = page;
    this.applyQueryBtn = page.locator('[data-test="dashboard-apply"]');
    this.timePickerBtn = page.locator('[data-test="date-time-btn"]');
    this.applyTimeBtn = page.locator('[data-test="date-time-apply-btn"]');
  }
  // set relative time range
  async setRelativeTimeRange(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M
    await this.applyQueryBtn.click();

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
