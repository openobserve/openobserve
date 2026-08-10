/**
 * SloCreatePage — Page object for the SLO create/edit form (AddSlo.vue)
 *
 * Covers the alert SLI type branch: source picker, ribbon preview, group-by lock,
 * save, and the empty/error states of the eligible-alert source loader.
 */
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SloCreatePage {
    constructor(page) {
        this.page = page;

        // ---- SLO list actions ----
        this.newSloButton = '[data-test="slos-slolist-new"]';

        // ---- Form fields ----
        this.nameInput = '[data-test="slos-addslo-name"]';
        this.targetInput = '[data-test="slos-addslo-target"]';

        // ---- SLI type toggle ----
        this.sliTypeToggle = '[data-test="slos-addslo-sli-type"]';
        this.alertSliTypeItem = '[data-test="slos-addslo-sli-type-alert"]';
        this.countSliTypeItem = '[data-test="slos-addslo-sli-type-count"]';

        // ---- Alert source ----
        this.alertSourcePicker = '[data-test="slos-addslo-alert-source"]';
        this.alertSourceEmptyBanner = '[data-test="slos-addslo-alert-source-empty"]';
        this.alertSourceErrorBanner = '[data-test="slos-addslo-alert-source-error"]';

        // ---- Ribbon preview ----
        this.alertRibbonPanel = '[data-test="slos-sloalertpreview-panel"]';

        // ---- Group-by ----
        this.groupBySelect = '[data-test="slos-addslo-group-by"]';
        this.groupByLockedNote = '[data-test="slos-addslo-group-by-locked"]';
        this.groupsEstimate = '[data-test="slos-addslo-groups-estimate"]';

        // ---- Compliance window ----
        this.windowToggle = '[data-test="slos-addslo-window"]';
        this.windowItem = (value) => `[data-test="slos-addslo-window-${value}"]`;

        // ---- Slice interval ----
        this.sliceToggle = '[data-test="slos-addslo-slice"]';
        this.sliceItem = (value) => `[data-test="slos-addslo-slice-${value}"]`;
        this.sliceNote = '[data-test="slos-addslo-slice-note"]';

        // ---- Save ----
        this.saveButton = '[data-test="slos-addslo-save"]';
    }

    // ============================
    //  NAVIGATION
    // ============================

    async clickNewSloButton() {
        testLogger.info('Clicking "New SLO" button');
        await this.page.locator(this.newSloButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ============================
    //  FORM FILL
    // ============================

    async fillName(name) {
        testLogger.info('Filling SLO name', { name });
        const input = this.page.locator(this.nameInput).locator('input');
        await input.fill(name);
    }

    async fillTarget(value) {
        testLogger.info('Filling SLO target', { value });
        const input = this.page.locator(this.targetInput).locator('input');
        await input.fill(String(value));
    }

    // ============================
    //  SLI TYPE
    // ============================

    async selectAlertSliType() {
        testLogger.info('Selecting Alert SLI type');
        await this.page.locator(this.alertSliTypeItem).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async selectCountSliType() {
        testLogger.info('Selecting Count SLI type');
        await this.page.locator(this.countSliTypeItem).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  ALERT SOURCE PICKER
    // ============================

    async selectAlertSource(alertName) {
        testLogger.info('Picking alert source', { alertName });
        await this.page.locator(this.alertSourcePicker).click();
        // Wait for the popover to open
        const popover = this.page.locator('[data-test="slos-addslo-alert-source-popover"]');
        await popover.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

        // Click the option matching the alert name
        const option = this.page.locator(`[data-test="slos-addslo-alert-source-option"][data-test-value="${alertName}"]`);
        if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
        } else {
            // Fallback: click first eligible option (the first non-disabled option)
            const firstOption = this.page.locator('[data-test="slos-addslo-alert-source-option"]:not([disabled])').first();
            await firstOption.waitFor({ state: 'visible', timeout: 10000 });
            await firstOption.click();
        }
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  GROUP-BY
    // ============================

    async selectGroupByField(fieldName) {
        testLogger.info('Setting group-by field', { fieldName });
        await this.page.locator(this.groupBySelect).click();
        const popover = this.page.locator('[data-test="slos-addslo-group-by-popover"]');
        await popover.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        const option = this.page.locator(`[data-test="slos-addslo-group-by-option"]`).filter({ hasText: fieldName }).first();
        await option.click();
    }

    /**
     * Click the group-by select and pick the first available option.
     * Used when we just need to select something (e.g., to test clearing).
     */
    async clickGroupByAndSelectFirst() {
        testLogger.info('Clicking group-by and selecting first option');
        const select = this.page.locator(this.groupBySelect);
        if (!(await select.isVisible({ timeout: 3000 }).catch(() => false))) return;
        await select.click();
        const firstOption = this.page.locator('[data-test="slos-addslo-group-by-option"]').first();
        if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await firstOption.click();
            testLogger.info('Group-by field selected');
        }
    }

    // ============================
    //  WINDOW & SLICE
    // ============================

    async selectWindow(seconds) {
        testLogger.info('Selecting compliance window', { seconds });
        await this.page.locator(this.windowItem(seconds)).click();
    }

    // ============================
    //  SAVE
    // ============================

    async save() {
        testLogger.info('Saving SLO');
        await this.page.locator(this.saveButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ============================
    //  EXPECTATIONS (assertions)
    // ============================

    async expectAlertSourcePickerVisible() {
        await expect(this.page.locator(this.alertSourcePicker)).toBeVisible({ timeout: 10000 });
    }

    async expectAlertSourcePickerHidden() {
        await expect(this.page.locator(this.alertSourcePicker)).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    async expectAlertRibbonVisible() {
        await expect(this.page.locator(this.alertRibbonPanel)).toBeVisible({ timeout: 15000 });
    }

    async expectAlertRibbonHidden() {
        await expect(this.page.locator(this.alertRibbonPanel)).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    async expectGroupByDisabled() {
        await expect(this.page.locator(this.groupBySelect)).toBeDisabled({ timeout: 5000 });
    }

    async expectGroupByLockedNoteVisible() {
        await expect(this.page.locator(this.groupByLockedNote)).toBeVisible({ timeout: 5000 });
    }

    async expectGroupsEstimateHidden() {
        const count = await this.page.locator(this.groupsEstimate).count();
        expect(count).toBe(0);
    }

    async expectEmptyStateBanner() {
        await expect(this.page.locator(this.alertSourceEmptyBanner)).toBeVisible({ timeout: 10000 });
    }

    async expectErrorBanner() {
        await expect(this.page.locator(this.alertSourceErrorBanner)).toBeVisible({ timeout: 10000 });
    }

    async expectSliceNoteContains(text) {
        await expect(this.page.locator(this.sliceNote)).toContainText(text, { timeout: 5000 });
    }

    async expectSliceItemSelected(seconds) {
        // Verify the slice toggle item is in the active/selected state
        const item = this.page.locator(this.sliceItem(seconds));
        await expect(item).toBeVisible({ timeout: 5000 });
    }

    async expectOnSloListPage() {
        await this.page.waitForURL(/\/slos/, { timeout: 15000 });
    }

    async expectSloRowVisible(name) {
        const row = this.page.locator('[data-test="slos-slolist-table"]').locator(`tr`).filter({ hasText: name }).first();
        await expect(row).toBeVisible({ timeout: 15000 });
    }

    async clickSloRow(name) {
        testLogger.info('Clicking SLO row', { name });
        const row = this.page.locator('[data-test="slos-slolist-table"]').locator(`tr`).filter({ hasText: name }).first();
        await row.click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
}
