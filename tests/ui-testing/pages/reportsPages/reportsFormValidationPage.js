// Copyright 2026 OpenObserve Inc.

import { openNavFlyoutChild } from '../commonActions.js';

export class ReportsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ───────────────────────────────────────────────────────
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
        // DateTime component uses dataTestName prop defaulting to "date-time-btn".
        // CreateReport passes data-test attr (not the dataTestName prop), so the actual button is date-time-btn.
        this.timerangeDropdown = '[data-test="add-report-timerange-select"] [data-test="date-time-btn"]';
        this.dateTimeAbsoluteTab = '[data-test="date-time-absolute-tab"]';
        // DateTime.vue renders OTime with data-test="datetime-start-time" / "datetime-end-time"
        this.dateTimeAbsoluteStartField = '[data-test="datetime-start-time"]';
        this.dateTimeAbsoluteEndField = '[data-test="datetime-end-time"]';

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
        await openNavFlyoutChild(this.page, 'reports');
        await this.page.locator(this.reportsListTitle).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(this.scheduledTab).click({ force: true });
    }

    async openCreateReportForm() {
        await this.page.locator(this.addReportBtn).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.addReportBtn).click();
        await this.page.locator(this.addReportSection).waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Opens the Create Report form via direct URL **without** a `?folder=` query
     * param. The Add-Report button always navigates with `folder=<activeFolder>`
     * (defaults to "default"), which makes CreateReport.vue auto-pre-fill the
     * dashboard folder once `getDashboaordFolders()` resolves in onBeforeMount.
     * That pre-fill races the test: locally the save fires before folders load
     * (folder still empty → error shows), but on a fast CI backend folders load
     * first (folder pre-filled → folder-required error never fires → flake).
     *
     * Landing here without a folder param keeps the folder deterministically
     * empty, so the folder-required validation is reachable on every run. This
     * is the legitimate entry point a user hits when no folder is pre-scoped.
     */
    async openCreateReportFormDirect() {
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(
            `${process.env.ZO_BASE_URL}/web/reports/create?org_identifier=${org}`
        );
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.locator(this.addReportSection).waitFor({ state: 'visible', timeout: 15000 });
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
        const folderTrigger = this.page.locator('[data-test="add-report-dashboard-folder-select-trigger"]');
        await folderTrigger.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        const anyOpt = this.page.locator('[data-test^="add-report-dashboard-folder-select-option"]').first();
        let optionsReady = false;

        // folderOptions is fetched async in onBeforeMount — if the API hasn't resolved by the
        // time we click, OSelect renders 0 items. Close and reopen to let data load.
        for (let attempt = 0; attempt < 3; attempt++) {
            await folderTrigger.click();
            await this.page.locator(this.dashboardFolderPopover).waitFor({ state: 'visible', timeout: 10000 });
            optionsReady = await anyOpt.waitFor({ state: 'attached', timeout: 8000 }).then(() => true).catch(() => false);
            if (optionsReady) break;
            await this.page.keyboard.press('Escape').catch(() => {});
            await this.page.locator(this.dashboardFolderPopover).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
        }

        if (!optionsReady) throw new Error('Dashboard folder options failed to appear after 3 attempts');

        const defaultOpt = this.page.locator(`[data-test="add-report-dashboard-folder-select-option"][data-test-value="default"]`);
        const hasDefault = await defaultOpt.waitFor({ state: 'attached', timeout: 3000 }).then(() => true).catch(() => false);
        await (hasDefault ? defaultOpt : anyOpt).click({ force: true });
        await this.page.locator(this.dashboardFolderPopover).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    async selectFirstDashboard() {
        // OSelect trigger: use -trigger data-test, regular click (force:true bypasses Reka UI pointer events)
        const trigger = this.page.locator('[data-test="add-report-dashboard-name-select-trigger"]');
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
        await this.page.locator(this.dashboardNamePopover).waitFor({ state: 'visible', timeout: 10000 });
        const firstOption = this.page.locator('[data-test^="add-report-dashboard-name-select-option"]').first();
        await firstOption.waitFor({ state: 'attached', timeout: 15000 });
        await firstOption.click({ force: true });
        await this.page.locator(this.dashboardNamePopover).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    async selectFirstDashboardTab() {
        // OSelect trigger: use -trigger data-test, regular click
        const trigger = this.page.locator('[data-test="add-report-dashboard-tab-select-trigger"]');
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
        await this.page.locator(this.dashboardTabPopover).waitFor({ state: 'visible', timeout: 10000 });
        // Select "default" tab specifically (always present)
        const defaultOpt = this.page.locator(`[data-test="add-report-dashboard-tab-select-option"][data-test-value="default"]`);
        const defaultTabAttached = await defaultOpt.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
        if (defaultTabAttached) {
            await defaultOpt.click({ force: true });
        } else {
            const firstOption = this.page.locator('[data-test^="add-report-dashboard-tab-select-option"]').first();
            await firstOption.waitFor({ state: 'attached', timeout: 10000 });
            await firstOption.click({ force: true });
        }
        await this.page.locator(this.dashboardTabPopover).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        // The absolute date fields (datetime-start-time / datetime-end-time) start empty by
        // default (selectedDate.from === "" in DateTime.vue), so no action needed.
        // This method exists to make the test intent explicit.
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
        // OSelect trigger: use -trigger data-test, regular click
        const trigger = this.page.locator('[data-test="add-report-schedule-start-timezone-select-trigger"]');
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
        await this.page.locator(this.timezonePopover).waitFor({ state: 'visible', timeout: 10000 });
        const firstOption = this.page.locator('[data-test^="add-report-schedule-start-timezone-select-option"]').first();
        await firstOption.waitFor({ state: 'attached', timeout: 10000 });
        await firstOption.click({ force: true });
        await this.page.locator(this.timezonePopover).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const btn = this.page.locator(this.saveBtn);
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
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
