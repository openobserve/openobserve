import { expect } from '@playwright/test';
import { setRelative } from '../commonActions.js';

/**
 * Page object for the shared DateTime picker (web/src/components/DateTime.vue),
 * focused on the Copy / Paste controls added in PR #13374.
 *
 * The same component backs Logs, Traces, Metrics, Dashboards and RUM. The panel has a
 * range field (type or paste) over a resolved line, then Quick ranges beside Custom range.
 *   - autoApply=true  (Logs, Traces, RUM) — a chip commits and closes; a paste or field edit
 *     commits on Enter, Apply, or an outside click.
 *   - autoApply=false (Metrics, Dashboards) — every pick stays a draft until Apply.
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

        // The panel has no tabs: the section headings stand in where a spec used to pick one.
        this.relativeTab = page.locator('[data-test="date-time-quick-ranges"] h3');
        this.absoluteTab = page.locator('[data-test="date-time-custom-range"] h3');

        // Range field and the resolved line under it.
        this.rangeInput = page.locator('#date-time-menu [data-test="date-time-range-input"] input');
        this.lineSummary = page.locator('[data-test="date-time-range-summary"]');

        // Copy / paste controls — added by PR #13374.
        this.copyBtn = page.locator('[data-test="date-time-copy-btn"]');
        this.pasteBtn = page.locator('[data-test="date-time-paste-btn"]');

        // Shift buttons — Previous / Next flank the trigger (rendered when
        // hideRangeShift is false, the default). PR #14683 caps the forward
        // shift at "now", so Next is disabled in Relative mode and whenever
        // the absolute window's end is within one second of the present.
        this.prevShiftBtn = page.locator('[data-test="date-time-prev-btn"]');
        this.nextShiftBtn = page.locator('[data-test="date-time-next-btn"]');

        // Absolute panel fields: each time part is one segmented text input whose
        // DOM value is the shown text (24h `HH:mm:ss` by default).
        this.startTimeInput = page.locator('[data-test="datetime-start-time"] input');
        this.endTimeInput = page.locator('[data-test="datetime-end-time"] input');

        this.startDateInput = page.locator('[data-test="date-time-range-start-date"] input');
        this.endDateInput = page.locator('[data-test="date-time-range-end-date"] input');
        this.rangeSummary = page.locator('[data-test="date-time-range-summary-range"]');
        this.rangeNote = page.locator('[data-test="date-time-range-note"]');
        this.rangeNoteUndo = page.locator('[data-test="date-time-range-note-undo"]');
        this.endOfDayChip = page.locator('[data-test="date-time-range-end-eod"]');

        // Both sections are always shown; these mark that each is on screen.
        this.absolutePanelMarker = page.locator('[data-test="datetime-start-time"]').first();
        this.relativePanelMarker = page.locator('[data-test="date-time-relative-15-m-btn"]');

        // Apply sits at the bottom of Custom range on every host, off until there is a draft.
        this.applyBtn = page.locator('[data-test="date-time-apply-btn"]');

        // ==================== Expected messages ====================
        // Copy still toasts (common.dateRangeCopied); paste reports in the panel's note line.
        this.copiedToastMessage = 'Date range copied';
        this.pasteEmptyNoteMessage = 'Clipboard is empty. Copy a date range first.';
    }

    // ==================== Locator factories ====================

    /** OToast stamps the rendered message onto data-test-message. */
    toastByMessage(message) {
        return this.page.locator(`[data-test-message="${message}"]`);
    }

    relativePeriodBtn(suffix) {
        return this.page.locator(`[data-test="date-time-relative-${suffix}-btn"]`);
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

    // ==================== Quick ranges ====================

    /** Picks a relative window, then reopens the panel an applying host closed, so the next step finds it. */
    async selectRelativePeriod(suffix) {
        const [, amount, unit] = suffix.match(/^(\d+)-([smhdwM])$/);
        await setRelative(this.page, Number(amount), unit);
        // An applying host closes over ~100 ms, so wait for that close rather than sampling a closing panel.
        const closed = await this.panel
            .waitFor({ state: 'hidden', timeout: 2000 })
            .then(() => true)
            .catch(() => false);
        if (closed) await this.openPicker();
    }

    async expectAbsolutePanelActive() {
        await expect(this.absolutePanelMarker).toBeVisible();
    }

    async expectRelativePanelActive() {
        await expect(this.relativePanelMarker).toBeVisible();
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
     * Reads the ISO 8601 interval Copy writes (`<start>/<end>` with offsets, to the second)
     * as epoch microseconds. Fails loudly if the clipboard holds anything else.
     */
    async readCopiedRange() {
        const raw = await this.readClipboard();
        const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))$/);
        if (!match) throw new Error(`Clipboard did not hold an ISO 8601 interval. Got: ${raw}`);
        return { start_date: Date.parse(match[1]) * 1000, end_date: Date.parse(match[2]) * 1000 };
    }

    /**
     * Pastes `text`, applies the draft it fills, and returns the applied range in
     * microseconds from the trigger's data attributes, which do not depend on the
     * runner's timezone.
     */
    async pasteAndReadBackRange(text) {
        await this.seedClipboard(text);
        await this.clickPaste();
        await this.expectPasteReadNote();
        await this.expectAbsolutePanelActive();
        await this.clickApply();
        return await this.getTriggerRangeUs();
    }

    // ==================== Toast and note assertions ====================

    async expectCopySuccessToast() {
        await expect(this.toastByMessage(this.copiedToastMessage)).toBeVisible();
    }

    /** A paste fills the draft and says how it read the text; nothing applies until Enter or Apply. */
    async expectPasteReadNote() {
        await expect(this.rangeNote).toHaveAttribute('data-kind', 'info');
        // Zone-less text names the zone it was read in instead of its format.
        await expect(this.rangeNote).toContainText(/Read (as|in) /);
    }

    async expectPasteErrorNote(reason) {
        await expect(this.rangeNote).toHaveAttribute('data-kind', 'error');
        if (reason) await expect(this.rangeNote).toHaveAttribute('data-reason', reason);
    }

    async expectPasteEmptyNote() {
        await this.expectPasteErrorNote('empty');
        await expect(this.rangeNote).toContainText(this.pasteEmptyNoteMessage);
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

    /** The applied absolute range, read from the trigger's data attributes; null while relative. */
    async getTriggerRangeUs() {
        const start = await this.triggerBtn.getAttribute('data-start-us');
        const end = await this.triggerBtn.getAttribute('data-end-us');
        if (start === null || end === null) return null;
        return { start_date: Number(start), end_date: Number(end) };
    }

    /** The draft range as the panel summary writes it, e.g. `Jul 23, 10:00:00 – 11:00:00`. */
    async getRangeSummary() {
        return (await this.rangeSummary.innerText()).replace(/\s+/g, ' ').trim();
    }

    // ==================== Range field ====================

    /** Types into the range field by hand; an outside click drops it, Enter applies it. */
    async typeRange(text) {
        await expect(this.rangeInput).toBeVisible();
        await this.rangeInput.fill(text);
    }

    async submitRange() {
        await this.rangeInput.press('Enter');
    }

    async expectRangeInputValue(expected) {
        await expect(this.rangeInput).toHaveValue(expected);
    }

    /** The line's mode: applied, read-as, preview, instant or runs. */
    async expectLineMode(mode) {
        await expect(this.lineSummary).toHaveAttribute('data-mode', mode);
    }

    async expectNoteContains(text) {
        await expect(this.rangeNote).toContainText(text);
    }

    async expectPresetDisabled(suffix) {
        await expect(this.relativePeriodBtn(suffix)).toBeDisabled();
    }

    /** The range field is ready; a stream's query-range limit only clamps what is read from it. */
    async waitForNoRestriction() {
        await expect(this.rangeInput).toBeVisible();
    }

    // ==================== Manual-apply mode ====================

    async expectApplyButtonVisible() {
        await expect(this.applyBtn).toBeVisible();
    }

    async clickApply() {
        await expect(this.applyBtn).toBeEnabled();
        await this.applyBtn.click();
    }
}

export default DateTimePickerPage;
