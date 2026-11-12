import { expect } from "@playwright/test";
import { DATE_TIME_INPUT, isChipPeriod, periodChip, splitPeriodCode, typeRelativePeriod } from "../generalPages/relativePeriod.js";

//methods : setRelativeTimeRange

// Utility function to wait for date-time button to be enabled
export async function waitForDateTimeButtonToBeEnabled(page) {
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', { timeout: 15000 });
}

const WAITING_REFRESH_BUTTONS = [
  '[data-test="dashboard-viewpanel-refresh-data-btn"][data-o2-variant="pending"]',
  '[data-test="dashboard-panel-refresh-panel-btn"][data-o2-variant="ghost-warning"]',
  '[data-test="dashboard-refresh-btn"][data-o2-variant="pending"]',
];

/**
 * Applies the range just picked in the open date-time picker, with or without Auto Run.
 * A picker that still has Apply gets it clicked. Otherwise the picker is closed (which applies with
 * Auto Run on), then the panel editor's Apply runs it, or on a dashboard the Refresh it marked yellow.
 */
export async function applyPickedDateTime(page) {
  const pickerApply = page.locator('[data-test="date-time-apply-btn"]');
  if (await pickerApply.count()) {
    await pickerApply.first().evaluate((el) => el.click());
    return;
  }
  const menu = page.locator("#date-time-menu").first();
  // An Auto Run picker closes itself on the pick; Escape then would reach the dialog underneath.
  const closedItself = await menu.waitFor({ state: "hidden", timeout: 1500 }).then(() => true, () => false);
  if (!closedItself) await page.keyboard.press("Escape");
  await page.locator("#date-time-menu").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  const panelApply = page.locator('[data-test="dashboard-apply"]').first();
  if (await panelApply.count()) {
    await panelApply.click({ timeout: 10000 }).catch(() => panelApply.evaluate((el) => el.click()));
    return;
  }

  for (const selector of WAITING_REFRESH_BUTTONS) {
    const refreshBtn = page.locator(selector).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.evaluate((el) => el.click());
      return;
    }
  }
}

export default class DateTimeHelper {
  constructor(page) {
    this.page = page;
    this.timePickerBtn = page.locator('[data-test="date-time-btn"]');
  }
  // set relative time range
  async setRelativeTimeRange(rangeCode) {
    // Minutes= m	Hours= h	Days= d	Weeks= w	Months= M

    const [value, unit] = splitPeriodCode(rangeCode) ?? [];
    const isChip = isChipPeriod(value, unit);
    // A period without a chip is typed into the bar, so the bar is what to wait for.
    const relBtn = isChip
      ? periodChip(this.page, value, unit)
      : this.page.locator(`#date-time-menu ${DATE_TIME_INPUT}`);

    // ViewDashboard binds the picker's :disable to arePanelsLoading, so a click can land just after it goes disabled and silently never open the popover.
    await expect(async () => {
      if (!(await relBtn.isVisible())) {
        await this.timePickerBtn.click({ timeout: 5000 });
      }
      await expect(relBtn).toBeVisible({ timeout: 5000 });
    // Budget covers maxquery's deliberately slow panels holding arePanelsLoading true; the inner click stays short so a swallowed click is re-tried fast.
    }).toPass({ timeout: 45000, intervals: [250, 500, 1000, 2000] });

    // Use JS click — the dropdown can extend outside the viewport in the new layout
    if (isChip) await relBtn.evaluate((el) => el.click());
    else await typeRelativePeriod(this.page, value, unit);
    await applyPickedDateTime(this.page);
  }
}
