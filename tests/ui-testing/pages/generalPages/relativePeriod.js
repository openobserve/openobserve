// Shared helpers for the DateTime picker panel (web/src/components/DateTime.vue).

export const DATE_TIME_PANEL = '#date-time-menu';
export const DATE_TIME_INPUT = '[data-test="date-time-input-field"]';

// The picker's chips (TIME_RANGE_CHIPS); every other period is typed into the bar.
const CHIP_PERIODS = new Set(['15-m', '1-h', '4-h', '24-h', '7-d', '30-d']);

/** Splits a "6-d" style code into ["6", "d"], or returns null. */
export function splitPeriodCode(code) {
    const match = String(code).match(/^(\d+)-([smhdwM])$/);
    return match ? [match[1], match[2]] : null;
}

export function isChipPeriod(value, unit) {
    return CHIP_PERIODS.has(`${value}-${unit}`);
}

/** The chip for a period, e.g. ("15", "m") -> date-time-chip-15m. */
export function periodChip(page, value, unit) {
    return page.locator(`${DATE_TIME_PANEL} [data-test="date-time-chip-${value}${unit}"]`).first();
}

/** Relative and Absolute share one panel, so a former tab click only waits for the open panel. */
export async function waitForDateTimePanel(page, timeout = 10000) {
    await page.locator(DATE_TIME_PANEL).first().waitFor({ state: 'visible', timeout });
}

/** Opens the picker's calendar (the former Absolute tab), which holds the Start and End fields. */
export async function openDateFields(page, timeout = 10000) {
    await waitForDateTimePanel(page, timeout);
    const pickDates = page.locator(`${DATE_TIME_PANEL} [data-test="date-time-pick-dates-btn"]`).first();
    // A picker with relative ranges disabled opens straight on the calendar, without the button.
    if (await pickDates.isVisible().catch(() => false)) await pickDates.click();
    await page.locator('[data-test="datetime-start-time"]').first().waitFor({ state: 'visible', timeout });
}

/** Types a period's shorthand (e.g. "6d") into the open picker's bar and applies it with Enter. */
export async function typeRelativePeriod(page, value, unit) {
    const panel = page.locator(DATE_TIME_PANEL).first();
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    const input = panel.locator(DATE_TIME_INPUT).first();
    await input.fill(`${value}${unit}`);
    await input.press('Enter');
    // Ambiguous text (e.g. "3M") first shows its readings; a second Enter applies the preferred one.
    const closed = await panel.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false);
    if (!closed && (await input.isVisible().catch(() => false))) await input.press('Enter');
}

/** Picks a period in the open picker: a chip when one matches, else the typed shorthand. Both apply and close. */
export async function pickRelativePeriod(page, value, unit, { clickOptions = {} } = {}) {
    if (isChipPeriod(value, unit)) {
        await periodChip(page, value, unit).click(clickOptions);
        return;
    }
    await typeRelativePeriod(page, value, unit);
}

/** Same as pickRelativePeriod, for a "6-d" style code. */
export async function pickRelativePeriodCode(page, code, options = {}) {
    const parts = splitPeriodCode(code);
    if (!parts) throw new Error(`Not a relative period code: ${code}`);
    await pickRelativePeriod(page, parts[0], parts[1], options);
}
