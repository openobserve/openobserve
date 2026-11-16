import { expect } from '@playwright/test';
import { pickRelativePeriodCode } from './relativePeriod.js';

/**
 * Page object for the shared DateTime picker (web/src/components/DateTime.vue),
 * focused on the Copy / Paste controls added in PR #13374.
 *
 * The same component backs Logs, Traces, Metrics, Dashboards and RUM. It renders
 * in two modes:
 *   - autoApply=true  (Logs, Traces, RUM) — a selection commits immediately, no Apply button.
 *   - autoApply=false (Metrics, Dashboards) — a selection stays pending until Apply is pressed.
 *
 * Clipboard note: `navigator.clipboard` needs a secure context. http://localhost and
 * https:// origins qualify; a plain-HTTP remote host does not, and paste has no
 * execCommand fallback (unlike copy). Both playwright configs already grant the
 * clipboard-read / clipboard-write permissions.
 */
export class DateTimePickerPage {
    constructor(page) {
        this.page = page;

        // ==================== Locators ====================

        // Trigger button — DateTime.vue's `dataTestName` prop, which defaults to
        // "date-time-btn". Logs/Metrics/Dashboards all leave the default in place.
        this.triggerBtn = page.locator('[data-test="date-time-btn"]').first();

        // Picker panel — an id, not a data-test, in the component source.
        this.panel = page.locator('#date-time-menu');

        // Relative and Absolute share one view; Live is enabled only while the selection is absolute.
        this.liveBtn = page.locator('[data-test="date-time-live-btn"]');
        this.zoomOutBtn = page.locator('[data-test="date-time-zoom-out-btn"]');
        this.textInput = page.locator('[data-test="date-time-input-field"]');
        this.inputError = page.locator('[data-test="date-time-input-error"]');
        this.resolvedLine = page.locator('[data-test="date-time-resolved"]');
        // The as-UTC toggle sits at the top of the zone menu, so open the zone select first.
        this.timezoneSelect = page.locator('[data-test="datetime-timezone-select"]');
        this.timezoneDivider = page.locator('[data-test="datetime-timezone-divider"]');
        this.asUtcToggle = page.locator('[data-test="date-time-as-utc-toggle"]');

        // Copy / paste controls. Copy swaps its id to -done (check icon, no toast) for 1.5 s.
        this.copyBtn = page.locator('[data-test="date-time-copy-btn"], [data-test="date-time-copy-btn-done"]');
        this.copyDoneBtn = page.locator('[data-test="date-time-copy-btn-done"]');
        this.pasteBtn = page.locator('[data-test="date-time-paste-btn"]');

        // Shift buttons — Previous / Next flank the trigger (rendered when
        // hideRangeShift is false, the default). PR #14683 caps the forward
        // shift at "now", so Next is disabled in Relative mode and whenever
        // the absolute window's end is within one second of the present.
        this.prevShiftBtn = page.locator('[data-test="date-time-prev-btn"]');
        this.nextShiftBtn = page.locator('[data-test="date-time-next-btn"]');

        // Calendar Start / End fields: OInput text fields (e.g. "Jul 23 10:00"); a bare clock time keeps the field's day.
        this.startTimeInput = page.locator('[data-test="datetime-start-time"] input');
        this.endTimeInput = page.locator('[data-test="datetime-end-time"] input');


        // Apply button — rendered only when the host sets autoApply=false.
        this.applyBtn = page.locator('[data-test="date-time-apply-btn"]');

        // What Enter would apply, or why it cannot, while text is typed in the bar.
        this.previewNote = page.locator('[data-test="date-time-preview-note"]');
        this.tooltipContent = page.locator('[data-test="o-tooltip-content"]');

        // common.dateRangePasteEmpty in web/src/locales/languages/en-US.json; the only paste toast left.
        this.pasteEmptyToastMessage = 'Clipboard is empty. Copy a date range first.';
    }

    // ==================== Locator factories ====================

    /** OToast stamps the rendered message onto data-test-message. */
    toastByMessage(message) {
        return this.page.locator(`[data-test-message="${message}"]`);
    }

    /** The chip for a "15-m" style code; only 15m 1h 4h 24h 7d 30d have one. */
    relativePeriodBtn(suffix) {
        return this.page.locator(`[data-test="date-time-chip-${String(suffix).replace('-', '')}"]`);
    }

    /** A calendar row of the list, e.g. "yesterday" -> date-time-list-calendar-yesterday. */
    calendarRow(id) {
        return this.page.locator(`[data-test="date-time-list-calendar-${id}"]`);
    }

    // ==================== Panel open / close ====================

    async openPicker() {
        await expect(this.triggerBtn).toBeVisible();
        await this.triggerBtn.click();
        await expect(this.panel).toBeVisible();
    }

    async expectPickerClosed() {
        await expect(this.panel).toBeHidden();
    }

    /** Closes the panel without applying — Escape leaves any pending selection uncommitted. */
    async closePickerWithEscape() {
        await this.page.keyboard.press('Escape');
        await expect(this.panel).toBeHidden();
    }

    // ==================== Relative periods ====================

    async selectRelativePeriod(suffix) {
        await pickRelativePeriodCode(this.page, suffix);
        // An auto-apply picker closes on a chip pick; reopen it so the panel controls stay reachable.
        const closed = await this.panel.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false);
        if (closed) await this.openPicker();
    }

    /** The selection is absolute: Live can turn it back into a rolling period. */
    async expectAbsolutePanelActive() {
        await expect(this.liveBtn).toBeEnabled();
    }

    /** The selection is relative: Live has nothing to do. */
    async expectRelativePanelActive() {
        await expect(this.liveBtn).toBeDisabled();
    }

    // ==================== Copy / paste controls ====================

    async expectCopyPasteControlsVisible() {
        await expect(this.copyBtn).toBeVisible();
        await expect(this.pasteBtn).toBeVisible();
    }

    async expectCopyPasteAriaLabels() {
        await expect(this.copyBtn).toHaveAttribute('aria-label', 'Copy time range to clipboard');
        await expect(this.pasteBtn).toHaveAttribute('aria-label', 'Paste time range');
    }

    async clickCopy() {
        await expect(this.copyBtn).toBeVisible();
        await this.copyBtn.click();
    }

    async clickPaste() {
        await expect(this.pasteBtn).toBeVisible();
        await this.pasteBtn.click();
    }

    // ==================== Shift buttons (Previous / Next) ====================

    async expectShiftButtonsVisible() {
        await expect(this.prevShiftBtn).toBeVisible();
        await expect(this.nextShiftBtn).toBeVisible();
    }

    async expectShiftAriaLabels() {
        // Labels name the step: "Previous 15m", "Back one hour", "Next 15m", "Already at now".
        await expect(this.prevShiftBtn).toHaveAttribute('aria-label', /^(Previous|Back one) \S.*$/);
        await expect(this.nextShiftBtn).toHaveAttribute(
            'aria-label',
            /^((Next|Forward one|Back to) \S.*|Already at now)$/,
        );
    }

    async expectNextEnabled() {
        await expect(this.nextShiftBtn).toBeEnabled();
    }

    async expectNextDisabled() {
        await expect(this.nextShiftBtn).toBeDisabled();
    }

    async expectPrevEnabled() {
        await expect(this.prevShiftBtn).toBeEnabled();
    }

    async clickNext() {
        await expect(this.nextShiftBtn).toBeEnabled();
        await this.nextShiftBtn.click();
    }

    async clickPrev() {
        await expect(this.prevShiftBtn).toBeEnabled();
        await this.prevShiftBtn.click();
    }

    // ==================== Clipboard helpers ====================

    /**
     * Seeds the clipboard from inside the page. Chromium's clipboard API refuses
     * to run against an unfocused document, so bring the tab forward first.
     */
    async seedClipboard(text) {
        await this.page.bringToFront();
        await this.page.evaluate((value) => navigator.clipboard.writeText(value), text);
    }

    async readClipboard() {
        await this.page.bringToFront();
        return await this.page.evaluate(() => navigator.clipboard.readText());
    }

    /**
     * Reads the text Copy writes, `[name (]YYYY-MM-DD HH:MM[:SS[.mmm]] – [YYYY-MM-DD ]HH:MM… UTC±hh:mm[)]`,
     * into epoch micros. Each stamp carries its zone offset, so this is exact in any runner timezone.
     */
    async readCopiedRange() {
        const text = await this.readClipboard();
        const parsed = parseCopyText(text);
        expect(parsed, `Clipboard did not hold a copied range. Got: ${text}`).not.toBeNull();
        return parsed;
    }

    /** Pastes `text`, applies it with Enter, and returns the applied range read back through Copy. */
    async pasteAndReadBackRange(text) {
        await this.seedClipboard(text);
        await this.clickPaste();
        await this.applyPaste();
        await this.expectAbsolutePanelActive();
        await this.clickCopy();
        return await this.readCopiedRange();
    }

    // ==================== Paste and copy states ====================

    /** Copy confirms in place: the button shows a check under date-time-copy-btn-done. */
    async expectCopyConfirmed() {
        await expect(this.copyDoneBtn).toBeVisible();
    }

    /** A paste only fills the bar and previews it; Enter applies, and a panel that closes is reopened. */
    async applyPaste() {
        await expect(this.resolvedLine).toHaveAttribute('data-preview', 'true');
        await this.textInput.press('Enter');
        const closed = await this.panel.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false);
        if (closed) await this.openPicker();
    }

    /** Pasted text that reads as no range shows the bar's error and applies nothing. */
    async expectPasteUnreadable() {
        await expect(this.inputError).toBeVisible();
    }

    async expectPasteEmptyToast() {
        await expect(this.toastByMessage(this.pasteEmptyToastMessage)).toBeVisible();
    }

    /** Escape backs out of typed text one step at a time before it closes the panel. */
    async closePickerDiscardingInput() {
        for (let i = 0; i < 4 && await this.panel.isVisible(); i++) {
            await this.page.keyboard.press('Escape');
        }
        await expect(this.panel).toBeHidden();
    }

    // ==================== Value readers ====================

    async getStartTimeValue() {
        return await this.startTimeInput.inputValue();
    }

    async getEndTimeValue() {
        return await this.endTimeInput.inputValue();
    }

    /** Matches the clock part of each field; the field drops ":00" seconds and leads with the day. */
    async expectAbsoluteTimeFields(expectedStart, expectedEnd) {
        await expect(this.startTimeInput).toHaveValue(clockTail(expectedStart));
        await expect(this.endTimeInput).toHaveValue(clockTail(expectedEnd));
    }

    async getTriggerLabel() {
        return (await this.triggerBtn.innerText()).trim();
    }

    // ==================== Typed input and range limits ====================

    /** Types text into the bar and presses Enter, which applies a readable range. */
    async typeAndEnter(text) {
        await expect(this.textInput).toBeVisible();
        await this.textInput.fill(text);
        await this.textInput.press('Enter');
    }

    async typeText(text) {
        await expect(this.textInput).toBeVisible();
        await this.textInput.fill(text);
    }

    /** Escape clears typed text before it closes the panel, so empty the bar first. */
    async clearInputAndClose() {
        await this.textInput.fill('');
        await this.closePickerWithEscape();
    }

    async expectInputError() {
        await expect(this.inputError).toBeVisible();
    }

    async expectPreviewNote(pattern) {
        await expect(this.previewNote).toContainText(pattern);
    }

    async expectPresetDisabled(suffix) {
        await expect(this.relativePeriodBtn(suffix)).toBeDisabled();
    }

    async expectPresetEnabled(suffix) {
        await expect(this.relativePeriodBtn(suffix)).toBeEnabled();
    }

    /** A disabled chip explains itself only in a tooltip, bound to its wrapper (a disabled button gets no hover). */
    async expectPresetReason(suffix, pattern) {
        await this.relativePeriodBtn(suffix).locator('xpath=..').hover();
        await expect(this.tooltipContent.filter({ hasText: pattern }).first()).toBeVisible();
    }

    /** An over-limit list row is disabled and carries the reason as its own visible text. */
    async expectCalendarRowDisabledWithReason(id, pattern) {
        const row = this.calendarRow(id);
        await expect(row).toHaveAttribute('aria-disabled', 'true');
        await expect(row).toContainText(pattern);
    }

    // ==================== Manual-apply mode ====================

    async expectApplyButtonVisible() {
        await expect(this.applyBtn).toBeVisible();
    }

    async clickApply() {
        await expect(this.applyBtn).toBeVisible();
        await this.applyBtn.click();
    }
}

function clockTail(time) {
    const shown = String(time).replace(/^(\d{1,2}:\d{2}):00$/, '$1');
    return new RegExp(`(^|\\s)${shown.replace(/[.]/g, '\\.')}$`);
}

const STAMP = '(\\d{4}-\\d{2}-\\d{2})';
const CLOCK = '(\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{3})?)?)';
const OFFSET = '(UTC(?:[+-]\\d{2}:\\d{2})?)';
const COPY_TEXT = new RegExp(
    `^(?:(.+) \\()?${STAMP} ${CLOCK}(?: ${OFFSET})? – (?:${STAMP} )?${CLOCK} ${OFFSET}\\)?$`,
);

const stampMicros = (date, clock, offset) => {
    const time = clock.length === 5 ? `${clock}:00` : clock;
    const zone = offset === 'UTC' ? 'Z' : offset.slice(3);
    return Date.parse(`${date}T${time}${zone}`) * 1000;
};

/** The copied text as `{ name, start_date, end_date, text }` in epoch micros, or null when it is not one. */
export function parseCopyText(text) {
    const m = COPY_TEXT.exec(String(text).trim());
    if (!m) return null;
    const [, name, startDate, startClock, startOffset, endDate, endClock, endOffset] = m;
    return {
        name: name ?? null,
        start_date: stampMicros(startDate, startClock, startOffset ?? endOffset),
        end_date: stampMicros(endDate ?? startDate, endClock, endOffset),
        text,
    };
}

export default DateTimePickerPage;
