// Copyright 2026 OpenObserve Inc.

export class SharedComponentsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── AddToDashboard dialog ─────────────────────────────────────────────
        // ODialog wrapper — data-test="add-to-dashboard-dialog"
        this.addToDashboardDialog = '[data-test="add-to-dashboard-dialog"]';

        // OFormInput data-test="metrics-new-dashboard-panel-title"
        // OFormInput generates -field (native <input>) and -error (error message)
        this.panelTitleInput = '[data-test="metrics-new-dashboard-panel-title-field"]';
        this.panelTitleError = '[data-test="metrics-new-dashboard-panel-title-error"]';

        // ODialog built-in buttons scoped to dialog
        this.addToDashboardSubmitBtn =
            '[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-primary-btn"]';
        this.addToDashboardCancelBtn =
            '[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── TimeRangeEditor dialog ────────────────────────────────────────────
        // ODialog wrapper — data-test="time-range-editor-dialog"
        this.timeRangeEditorDialog = '[data-test="time-range-editor-dialog"]';

        // Preset radio buttons
        this.window1min   = '[data-test="window-1min"]';
        this.window5min   = '[data-test="window-5min"]';
        this.window15min  = '[data-test="window-15min"]';
        this.window30min  = '[data-test="window-30min"]';
        this.window1hour  = '[data-test="window-1hour"]';
        this.windowCustom = '[data-test="window-custom"]';

        // Custom time inputs — OInput generates -field (native <input>) and -error
        this.customStartInput = '[data-test="custom-start-input-field"]';
        this.customStartError = '[data-test="custom-start-input-error"]';
        this.customEndInput   = '[data-test="custom-end-input-field"]';
        this.customEndError   = '[data-test="custom-end-input-error"]';

        // ODialog built-in buttons scoped to dialog
        this.timeRangeApplyBtn =
            '[data-test="time-range-editor-dialog"] [data-test="o-dialog-primary-btn"]';
        this.timeRangeCancelBtn =
            '[data-test="time-range-editor-dialog"] [data-test="o-dialog-secondary-btn"]';
        this.timeRangeResetBtn =
            '[data-test="time-range-editor-dialog"] [data-test="o-dialog-neutral-btn"]';

        // ── Metrics page navigation ───────────────────────────────────────────
        this.metricsMenuLink = '[data-test="menu-link-\\/metrics-item"]';
    }

    // ── AddToDashboard helpers ────────────────────────────────────────────────

    async navigateToMetrics() {
        await this.page.locator(this.metricsMenuLink).click();
        // Wait for metrics page to be visible
        await this.page
            .locator('[data-test="metrics-page"]')
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    async waitForAddToDashboardDialog() {
        await this.page
            .locator(this.addToDashboardDialog)
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillPanelTitle(title) {
        const input = this.page.locator(this.panelTitleInput);
        await input.waitFor({ state: 'visible' });
        await input.fill(title);
    }

    async clearPanelTitle() {
        const input = this.page.locator(this.panelTitleInput);
        await input.waitFor({ state: 'visible' });
        await input.fill('');
    }

    async clickAddToDashboardSubmit() {
        await this.page.locator(this.addToDashboardSubmitBtn).click();
    }

    async clickAddToDashboardCancel() {
        await this.page.locator(this.addToDashboardCancelBtn).click();
    }

    getAddToDashboardDialogLocator() {
        return this.page.locator(this.addToDashboardDialog);
    }

    getPanelTitleErrorLocator() {
        return this.page.locator(this.panelTitleError);
    }

    getAddToDashboardSubmitBtnLocator() {
        return this.page.locator(this.addToDashboardSubmitBtn);
    }

    // ── TimeRangeEditor helpers ───────────────────────────────────────────────

    async waitForTimeRangeEditorDialog() {
        await this.page
            .locator(this.timeRangeEditorDialog)
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    async selectCustomWindow() {
        await this.page.locator(this.windowCustom).click();
    }

    async selectPresetWindow(preset) {
        // preset: '1min' | '5min' | '15min' | '30min' | '1hour'
        await this.page.locator(`[data-test="window-${preset}"]`).click();
    }

    async fillCustomStartTime(datetimeLocal) {
        const input = this.page.locator(this.customStartInput);
        await input.waitFor({ state: 'visible' });
        await input.fill(datetimeLocal);
        // Trigger change event so validation runs
        await input.dispatchEvent('change');
    }

    async fillCustomEndTime(datetimeLocal) {
        const input = this.page.locator(this.customEndInput);
        await input.waitFor({ state: 'visible' });
        await input.fill(datetimeLocal);
        await input.dispatchEvent('change');
    }

    async clickTimeRangeApply() {
        await this.page.locator(this.timeRangeApplyBtn).click();
    }

    async clickTimeRangeCancel() {
        await this.page.locator(this.timeRangeCancelBtn).click();
    }

    async clickTimeRangeReset() {
        await this.page.locator(this.timeRangeResetBtn).click();
    }

    getTimeRangeEditorDialogLocator() {
        return this.page.locator(this.timeRangeEditorDialog);
    }

    getCustomStartErrorLocator() {
        return this.page.locator(this.customStartError);
    }

    getCustomEndErrorLocator() {
        return this.page.locator(this.customEndError);
    }

    getTimeRangeApplyBtnLocator() {
        return this.page.locator(this.timeRangeApplyBtn);
    }

    getWindow1minLocator() {
        return this.page.locator(this.window1min);
    }

    getWindow5minLocator() {
        return this.page.locator(this.window5min);
    }

    getWindow15minLocator() {
        return this.page.locator(this.window15min);
    }

    getWindow30minLocator() {
        return this.page.locator(this.window30min);
    }

    getWindow1hourLocator() {
        return this.page.locator(this.window1hour);
    }

    getWindowCustomLocator() {
        return this.page.locator(this.windowCustom);
    }

    getCustomStartInputLocator() {
        return this.page.locator(this.customStartInput);
    }

    getCustomEndInputLocator() {
        return this.page.locator(this.customEndInput);
    }

    // ── Navigation to Logs > Correlation tab ─────────────────────────────────

    get logsMenuLink() {
        return '[data-test="menu-link-\\/logs-item"]';
    }

    async navigateToLogsCorrelation() {
        await this.page.locator(this.logsMenuLink).click();
        // Wait for logs page then click the Correlation tab
        await this.page.locator('[data-test="logs-search-bar"]').waitFor({ state: 'visible', timeout: 15000 });
        const correlationTab = this.page.locator('[data-test="logs-correlation-tab"]');
        await correlationTab.waitFor({ state: 'visible', timeout: 10000 });
        await correlationTab.click();
    }

    async openTimeRangeEditorFromCorrelation() {
        // Click the time range editor trigger button in the Correlation tab
        const trigger = this.page.locator('[data-test="correlation-time-range-edit-btn"], [data-test="time-range-editor-trigger"]');
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
    }
}
