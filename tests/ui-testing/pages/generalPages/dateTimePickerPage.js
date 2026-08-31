import { expect } from '@playwright/test';

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

        // Tab pair — absent when the host passes `disable-relative`.
        this.relativeTab = page.locator('[data-test="date-time-relative-tab"]');
        this.absoluteTab = page.locator('[data-test="date-time-absolute-tab"]');

        // Copy / paste controls — added by PR #13374.
        this.copyBtn = page.locator('[data-test="date-time-copy-btn"]');
        this.pasteBtn = page.locator('[data-test="date-time-paste-btn"]');

        // Absolute panel fields. OTime renders the data-test on a role=group
        // wrapper; the value lives on the descendant input[type=time].
        this.startTimeInput = page.locator('[data-test="datetime-start-time"] input');
        this.endTimeInput = page.locator('[data-test="datetime-end-time"] input');

        // OTabPanels is used without `keep-alive`, so the inactive panel is
        // unmounted (v-if). Presence of these is therefore a reliable signal of
        // which tab is active — more robust than reading variant-driven classes.
        // OTime stamps the forwarded data-test on BOTH its outer wrapper and its
        // inner role=group element, so scope to the first to stay strict-mode safe.
        this.absolutePanelMarker = page.locator('[data-test="datetime-start-time"]').first();
        this.relativePanelMarker = page.locator('[data-test="date-time-relative-15-m-btn"]');

        // Apply button — rendered only when the host sets autoApply=false.
        this.applyBtn = page.locator('[data-test="date-time-apply-btn"]');

        // ==================== Expected toast messages ====================
        // Values of common.dateRangeCopied / dateRangePasted / dateRangePasteError
        // in web/src/locales/languages/en-US.json.
        this.copiedToastMessage = 'Date range copied';
        this.pastedToastMessage = 'Date range pasted';
        this.pasteErrorToastMessage = 'Could not parse date range';
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

    // ==================== Tabs ====================

    async selectRelativePeriod(suffix) {
        const btn = this.relativePeriodBtn(suffix);
        await expect(btn).toBeVisible();
        await btn.click();
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
