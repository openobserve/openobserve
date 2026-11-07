const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the Absolute tab's typed range bar on an auto-apply host (Logs).
 *
 * Instants are read from the trigger's data-start-us / data-end-us, and the expected
 * values are built from the wall clock the fields show plus the offset the summary
 * names, so the assertions do not depend on the runner's timezone.
 */

const MICROS_PER_SECOND = 1_000_000;
const DAY_MS = 86_400_000;

/** `UTC+05:30` → +330 minutes; `UTC` → 0. */
const offsetMinutes = (label) => {
  // The zone link reads `Asia/Calcutta (UTC+05:30)`, or just `UTC`.
  const match = label.match(/UTC(?:([+-])(\d{2}):(\d{2}))?\)?\s*$/);
  if (!match || !match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

/** Microseconds of a wall-clock date and time at a fixed UTC offset. */
const wallToMicros = (date, time, offset) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return (Date.UTC(y, m - 1, d, hh, mm, ss) - offset * 60_000) * 1000;
};

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

test.describe("DateTime picker range bar", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.absoluteTab.click();
    await pm.dateTimePickerPage.expectAbsolutePanelActive();
  });

  test("applies a typed Start day when Run query closes the panel", {
    tag: ['@datetime-picker', '@all', '@P0']
  }, async ({ page }) => {
    const picker = pm.dateTimePickerPage;
    const endDate = await picker.endDateInput.inputValue();
    const startTime = await picker.startTimeInput.inputValue();
    const offset = offsetMinutes(await page.locator('[data-test="date-time-range-tz"]').innerText());
    const startDate = isoDay(Date.parse(`${endDate}T00:00:00Z`) - DAY_MS);

    await picker.startDateInput.fill(startDate);
    await expect(page.locator('[data-test="date-time-range-draft"]')).toBeVisible();

    await page.locator("[data-test='logs-search-bar-refresh-btn']").first().click();
    await picker.expectPickerClosed();

    const range = await picker.getTriggerRangeUs();
    expect(range.start_date).toBe(wallToMicros(startDate, startTime, offset));
    testLogger.info('Typed Start day applied before the query ran', { range });
  });

  test("sends End of day as the next midnight when Enter applies it", {
    tag: ['@datetime-picker', '@all', '@P0']
  }, async ({ page }) => {
    const picker = pm.dateTimePickerPage;
    const offset = offsetMinutes(await page.locator('[data-test="date-time-range-tz"]').innerText());
    const endDate = await picker.endDateInput.inputValue();
    const startDate = isoDay(Date.parse(`${endDate}T00:00:00Z`) - DAY_MS);

    await picker.startDateInput.fill(startDate);
    await picker.endOfDayChip.click();
    await expect(picker.endTimeInput).toHaveValue('23:59:59');
    await picker.endTimeInput.focus();
    await page.keyboard.press('Enter');
    await picker.expectPickerClosed();

    const range = await picker.getTriggerRangeUs();
    const nextMidnight = isoDay(Date.parse(`${endDate}T00:00:00Z`) + DAY_MS);
    expect(range.end_date).toBe(wallToMicros(nextMidnight, '00:00:00', offset));
    expect(range.end_date % MICROS_PER_SECOND).toBe(0);
  });

  test("describes an applied range in a two-line tooltip on the trigger", {
    tag: ['@datetime-picker', '@all', '@P1']
  }, async ({ page }) => {
    const picker = pm.dateTimePickerPage;
    const endDate = await picker.endDateInput.inputValue();
    await picker.startDateInput.fill(isoDay(Date.parse(`${endDate}T00:00:00Z`) - DAY_MS));
    await picker.clickApply();
    await picker.expectPickerClosed();

    await picker.triggerBtn.hover();
    const tooltip = page.locator('[data-test="o-tooltip-content"]').filter({ hasText: ' – ' });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} – \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    await expect(tooltip).toContainText(/1d .*·/);
  });
});
