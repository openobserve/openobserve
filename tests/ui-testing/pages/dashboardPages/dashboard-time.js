import { expect } from "@playwright/test";

//methods : setRelativeTimeRange

export default class DateTimeHelper {
  constructor(page) {
    this.page = page;
    this.applyQueryBtn = page.locator('[data-test="dashboard-apply"]');
    this.timePickerBtn = page.locator('[data-test="date-time-btn"]');
    this.applyTimeBtn = page.locator('[data-test="date-time-apply-btn"]');
    this.logsRefreshBtn = page.locator(
      '[data-test="logs-search-bar-refresh-btn"]'
    );
  }

  async waitForDateTimeButtonToBeEnabled() {
    return await this.page.waitForSelector(
      '[data-test="date-time-btn"]:not([disabled])',
      { timeout: 15000 }
    );
  }
  // set relative time range for dashboard
  async setRelativeTimeRange(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M
    await this.applyQueryBtn.click();
    await this.waitForDateTimeButtonToBeEnabled();
    await this.timePickerBtn.click();
    await this.page
      .locator(`[data-test="date-time-relative-${rangeCode}-btn"]`)
      .click();
    await this.applyTimeBtn.click();
  }

  // set relative time range for logs
  async setRelativeTimeRangeForLogs(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M
    await this.waitForDateTimeButtonToBeEnabled();
    await this.timePickerBtn.click();
    await this.page
      .locator(`[data-test="date-time-relative-${rangeCode}-btn"]`)
      .click();
  }
  async clickLogsRefreshBtn() {
    await this.logsRefreshBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.logsRefreshBtn.click();
  }
}
