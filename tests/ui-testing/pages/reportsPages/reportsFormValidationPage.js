// Copyright 2026 OpenObserve Inc.

export class ReportsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ───────────────────────────────────────────────────────
        this.reportsMenuLink = '[data-test="menu-link-\\/reports-item"]';
        this.reportsListTitle = '[data-test="report-list-title"]';
        this.addReportBtn = '[data-test="report-list-add-report-btn"]';
        this.scheduledTab = '[data-test="tab-shared"]';

        // ── Create-report page container ─────────────────────────────────────
        this.addReportSection = '[data-test="add-report-section"]';

        // ── Step 1 — Report name ─────────────────────────────────────────────
        // OInput data-test="add-report-name-input" → -field (native <input>), -error (message span)
        this.reportNameInput = '[data-test="add-report-name-input-field"]';
        this.reportNameError = '[data-test="add-report-name-input-error"]';

        // ── Step 1 — Dashboard folder (OSelect) ──────────────────────────────
        // OSelect data-test="add-report-dashboard-folder-select" → -popover, -error
        this.dashboardFolderSelect = '[data-test="add-report-dashboard-folder-select"]';
        this.dashboardFolderPopover = '[data-test="add-report-dashboard-folder-select-popover"]';
        this.dashboardFolderError = '[data-test="add-report-dashboard-folder-select-error"]';

        // ── Step 1 — Dashboard name (OSelect) ────────────────────────────────
        this.dashboardNameSelect = '[data-test="add-report-dashboard-name-select"]';
        this.dashboardNamePopover = '[data-test="add-report-dashboard-name-select-popover"]';
        this.dashboardNameError = '[data-test="add-report-dashboard-name-select-error"]';

        // ── Step 1 — Dashboard tab (OSelect) ─────────────────────────────────
        this.dashboardTabSelect = '[data-test="add-report-dashboard-tab-select"]';
        this.dashboardTabPopover = '[data-test="add-report-dashboard-tab-select-popover"]';
        this.dashboardTabError = '[data-test="add-report-dashboard-tab-select-error"]';

        // ── Step 1 — Time range ───────────────────────────────────────────────
        this.timerangeDropdown = '[data-test="add-report-timerange-dropdown"]';
        this.dateTimeAbsoluteTab = '[data-test="date-time-absolute-tab"]';
        this.dateTimeAbsoluteStartField = '[data-test="date-time-absolute-start-time-field"]';
        this.dateTimeAbsoluteEndField = '[data-test="date-time-absolute-end-time-field"]';

        // ── Step 1 — Continue button ──────────────────────────────────────────
        this.continueStep1Btn = '[data-test="add-report-step1-continue-btn"]';

        // ── Step 2 — Schedule frequency ──────────────────────────────────────
        this.frequencyOnceBtn = '[data-test="add-report-schedule-frequency-once-btn"]';
        this.frequencyHoursBtn = '[data-test="add-report-schedule-frequency-hours-btn"]';
        this.scheduleLaterBtn = '[data-test="add-report-schedule-scheduleLater-btn"]';
        this.scheduleStartDateField = '[data-test="add-report-schedule-start-date-field-group"]';
        this.scheduleStartTimeField = '[data-test="add-report-schedule-start-time-field"][role="group"]';
        this.timezoneSelect = '[data-test="add-report-schedule-start-timezone-select"]';
        this.timezonePopover = '[data-test="add-report-schedule-start-timezone-select-popover"]';
        this.timezoneError = '[data-test="add-report-schedule-start-timezone-select-error"]';

        // ── Step 2 — Continue button ──────────────────────────────────────────
        this.continueStep2Btn = '[data-test="add-report-step2-continue-btn"]';

        // ── Step 3 — Share: title & recipients ───────────────────────────────
        // OInput data-test="add-report-share-title-input" → -field, -error
        this.shareTitleInput = '[data-test="add-report-share-title-input-field"]';
        this.shareTitleError = '[data-test="add-report-share-title-input-error"]';
        // OInput data-test="add-report-share-recipients-input" → -field, -error
        this.shareRecipientsInput = '[data-test="add-report-share-recipients-input-field"]';
        this.shareRecipientsError = '[data-test="add-report-share-recipients-input-error"]';

        // ── Save / Cancel ─────────────────────────────────────────────────────
        this.saveBtn = '[data-test="add-report-save-btn"]';
        this.cancelBtn = '[data-test="add-report-cancel-btn"]';

        // ── Toast ─────────────────────────────────────────────────────────────
        this.toastSuccess = '[data-test-variant="success"]';
        this.toastError = '[data-test-variant="error"]';
        this.toastMessage = '[data-test="o-toast-message"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async navigateToReports() {
        await this.page.locator(this.reportsMenuLink).click();
        await this.page.locator(this.reportsListTitle).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(this.scheduledTab).click({ force: true });
    }

    async openCreateReportForm() {
        await this.page.locator(this.addReportBtn).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.addReportBtn).click();
        await this.page.locator(this.addReportSection).waitFor({ state: 'visible', timeout: 10000 });
    }

    // ── Step 1 actions ────────────────────────────────────────────────────────

    async fillReportName(name) {
        await this.page.locator(this.reportNameInput).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator(this.reportNameInput).fill(name);
    }

    async clearReportName() {
        await this.page.locator(this.reportNameInput).clear();
    }

    async clickContinueStep1() {
        await this.page.locator(this.continueStep1Btn).click();
    }

    async selectDashboardFolderOption(value) {
        await this.page.locator(this.dashboardFolderSelect).click();
        await this.page.locator(this.dashboardFolderPopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator(`[data-test="add-report-dashboard-folder-select-option"][data-test-value="${value}"]`).click();
    }

    async selectFirstDashboardFolder() {
        await this.page.locator(this.dashboardFolderSelect).click();
        await this.page.locator(this.dashboardFolderPopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator('[data-test^="add-report-dashboard-folder-select-option"]').first().click();
    }

    async selectFirstDashboard() {
        await this.page.locator(this.dashboardNameSelect).click();
        await this.page.locator(this.dashboardNamePopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator('[data-test^="add-report-dashboard-name-select-option"]').first().click();
    }

    async selectFirstDashboardTab() {
        await this.page.locator(this.dashboardTabSelect).click();
        await this.page.locator(this.dashboardTabPopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator('[data-test^="add-report-dashboard-tab-select-option"]').first().click();
    }

    async openTimerangeDropdown() {
        const el = this.page.locator(this.timerangeDropdown);
        await el.waitFor({ state: 'visible', timeout: 8000 });
        await el.click();
    }

    async switchToAbsoluteTimerange() {
        const tab = this.page.locator(this.dateTimeAbsoluteTab);
        await tab.waitFor({ state: 'visible', timeout: 6000 });
        await tab.click();
    }

    async clearAbsoluteTimerangeFields() {
        const startField = this.page.locator(this.dateTimeAbsoluteStartField);
        const endField = this.page.locator(this.dateTimeAbsoluteEndField);
        await startField.waitFor({ state: 'visible', timeout: 6000 });
        await startField.fill('');
        await endField.fill('');
    }

    async dismissTimerangePicker() {
        await this.page.keyboard.press('Escape');
    }

    getTimerangeDropdownLocator()        { return this.page.locator(this.timerangeDropdown); }
    getDateTimeAbsoluteTabLocator()      { return this.page.locator(this.dateTimeAbsoluteTab); }
    getDateTimeAbsoluteStartLocator()    { return this.page.locator(this.dateTimeAbsoluteStartField); }
    getDateTimeAbsoluteEndLocator()      { return this.page.locator(this.dateTimeAbsoluteEndField); }

    // ── Step 2 actions ────────────────────────────────────────────────────────

    async clickContinueStep2() {
        await this.page.locator(this.continueStep2Btn).click();
    }

    async selectFirstTimezone() {
        await this.page.locator(this.timezoneSelect).click();
        await this.page.locator(this.timezonePopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.page.locator('[data-test^="add-report-schedule-start-timezone-select-option"]').first().click();
    }

    // ── Step 3 actions ────────────────────────────────────────────────────────

    async fillShareTitle(title) {
        await this.page.locator(this.shareTitleInput).fill(title);
    }

    async fillShareRecipients(emails) {
        await this.page.locator(this.shareRecipientsInput).fill(emails);
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    async clickSave() {
        await this.page.locator(this.saveBtn).click();
    }

    // ── Locator getters for assertions ────────────────────────────────────────

    getReportNameErrorLocator()     { return this.page.locator(this.reportNameError); }
    getDashboardFolderErrorLocator() { return this.page.locator(this.dashboardFolderError); }
    getDashboardNameErrorLocator()  { return this.page.locator(this.dashboardNameError); }
    getDashboardTabErrorLocator()   { return this.page.locator(this.dashboardTabError); }
    getTimezoneErrorLocator()       { return this.page.locator(this.timezoneError); }
    getShareTitleErrorLocator()     { return this.page.locator(this.shareTitleError); }
    getShareRecipientsErrorLocator() { return this.page.locator(this.shareRecipientsError); }
    getSaveBtnLocator()             { return this.page.locator(this.saveBtn); }
    getToastSuccessLocator()        { return this.page.locator(this.toastSuccess); }
    getToastMessageLocator()        { return this.page.locator(this.toastMessage); }
    getAddReportSectionLocator()    { return this.page.locator(this.addReportSection); }
}
