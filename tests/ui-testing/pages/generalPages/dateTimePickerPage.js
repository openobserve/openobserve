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
        this.asUtcToggle = page.locator('[data-test="date-time-as-utc-toggle"]');

        // Copy / paste controls — added by PR #13374.
        this.copyBtn = page.locator('[data-test="date-time-copy-btn"]');
        this.pasteBtn = page.locator('[data-test="date-time-paste-btn"]');

        // Shift buttons — Previous / Next flank the trigger (rendered when
        // hideRangeShift is false, the default). PR #14683 caps the forward
        // shift at "now", so Next is disabled in Relative mode and whenever
        // the absolute window's end is within one second of the present.
        this.prevShiftBtn = page.locator('[data-test="date-time-prev-btn"]');
        this.nextShiftBtn = page.locator('[data-test="date-time-next-btn"]');

        // Absolute panel fields. OTime renders the data-test on a role=group
        // wrapper; the value lives on the descendant input[type=time].
        this.startTimeInput = page.locator('[data-test="datetime-start-time"] input');
        this.endTimeInput = page.locator('[data-test="datetime-end-time"] input');


        // Apply button — rendered only when the host sets autoApply=false.
        this.applyBtn = page.locator('[data-test="date-time-apply-btn"]');

        // What Enter would apply, or why it cannot, while text is typed in the bar.
        this.previewNote = page.locator('[data-test="date-time-preview-note"]');
        this.tooltipContent = page.locator('[data-test="o-tooltip-content"]');

        // ==================== Expected toast messages ====================
        // Values of common.dateRangeCopied / dateRangePasted / dateRangePasteError / dateRangePasteEmpty
        // in web/src/locales/languages/en-US.json.
        this.copiedToastMessage = 'Date range copied';
        this.pastedToastMessage = 'Date range pasted';
        this.pasteErrorToastMessage = 'Could not parse date range';
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
        await expect(this.prevShiftBtn).toHaveAttribute('aria-label', 'Previous');
        await expect(this.nextShiftBtn).toHaveAttribute('aria-label', 'Next');
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
     * Reads the clipboard and parses the {"start_date":micros,"end_date":micros}
     * payload that Copy writes. Fails loudly if the payload is not that shape.
     */
    async readCopiedRange() {
        const raw = await this.readClipboard();
        let payload;
        try {
            payload = JSON.parse(raw);
        } catch {
            throw new Error(`Clipboard did not contain JSON. Got: ${raw}`);
        }
        expect(typeof payload.start_date, `start_date in ${raw}`).toBe('number');
        expect(typeof payload.end_date, `end_date in ${raw}`).toBe('number');
        return payload;
    }

    /**
     * Pastes `text` and returns the range the picker resolved it to, read back
     * through Copy. Copy resolves the selection through the picker's own timezone,
     * so this round-trip is exact for second-aligned epoch input and free of any
     * dependence on the runner's timezone.
     */
    async pasteAndReadBackRange(text) {
        await this.seedClipboard(text);
        await this.clickPaste();
        await this.expectPasteSuccessToast();
        await this.expectAbsolutePanelActive();
        await this.clickCopy();
        return await this.readCopiedRange();
    }

    // ==================== Toast assertions ====================

    async expectCopySuccessToast() {
        await expect(this.toastByMessage(this.copiedToastMessage)).toBeVisible();
    }

    async expectPasteSuccessToast() {
        await expect(this.toastByMessage(this.pastedToastMessage)).toBeVisible();
    }

    async expectPasteErrorToast() {
        await expect(this.toastByMessage(this.pasteErrorToastMessage)).toBeVisible();
    }

    async expectPasteEmptyToast() {
        await expect(this.toastByMessage(this.pasteEmptyToastMessage)).toBeVisible();
        await expect(this.toastByMessage(this.pasteErrorToastMessage)).toHaveCount(0);
    }

    // ==================== Value readers ====================

    async getStartTimeValue() {
        return await this.startTimeInput.inputValue();
    }

    async getEndTimeValue() {
        return await this.endTimeInput.inputValue();
    }

    async expectAbsoluteTimeFields(expectedStart, expectedEnd) {
        await expect(this.startTimeInput).toHaveValue(expectedStart);
        await expect(this.endTimeInput).toHaveValue(expectedEnd);
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

export default DateTimePickerPage;
