import { expect } from "@playwright/test";

//methods : setRelativeTimeRange

// Utility function to wait for date-time button to be enabled
export async function waitForDateTimeButtonToBeEnabled(page) {
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', { timeout: 15000 });
}

// The panel editor's picker has no Apply of its own; with Auto Run off its range waits for the panel's Apply.
export async function applyPickedDateTime(page) {
  const pickerApply = page.locator('[data-test="date-time-apply-btn"]');
  if (await pickerApply.count()) {
    await pickerApply.first().evaluate((el) => el.click());
    return;
  }
  await page.keyboard.press("Escape");
  await page.locator("#date-time-menu").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  const panelApply = page.locator('[data-test="dashboard-apply"]').first();
  if (!(await panelApply.count())) return;
  await panelApply.click({ timeout: 10000 }).catch(() => panelApply.evaluate((el) => el.click()));
}

export default class DateTimeHelper {
  constructor(page) {
    this.page = page;
    this.timePickerBtn = page.locator('[data-test="date-time-btn"]');
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
    await applyPickedDateTime(this.page);
  }
}
