const { expect } = require('@playwright/test');
const { reauthenticateAlpha1 } = require('../../playwright-tests/utils/reauth-alpha1.js');

export class OrganizationManagementPage {
    constructor(page) {
        this.page = page;

        // ── Org list table (OTable header/cell data-tests are hardcoded deep
        //    inside OTable's sub-components, so they render regardless of the
        //    consumer's data-test fallthrough on the OTable root). ───────────
        this.statusStepsUsedHeader = page.locator('[data-test="o2-table-th-status_steps_used"]');
        this.statusStepsTotalHeader = page.locator('[data-test="o2-table-th-status_steps_total"]');
        this.firstOrgNameCell = page.locator('[data-test="o2-table-cell-name"]').first();

        // ── Usage-limits dialog ─────────────────────────────────────────────
        this.usageLimitsDialog = page.locator('[data-test="organization-management-usage-limits-dialog"]');
        this.aiCreditsTab = page.locator('[data-test="org-management-set-ai-credits-btn"]');
        this.protocolStepsTab = page.locator('[data-test="org-management-set-synthetics-protocol-steps-btn"]');
        this.statusStepsTab = page.locator('[data-test="org-management-set-synthetics-status-steps-btn"]');
        this.syntheticsStepsInput = page.locator('[data-test="synthetics-steps-limit-input-field"]');
        this.syntheticsStepsError = page.locator('[data-test="synthetics-steps-limit-input-error"]');
        this.dialogPrimaryBtn = page.locator(
            '[data-test="organization-management-usage-limits-dialog"] [data-test="o-dialog-primary-btn"]',
        );

        // ── Toast ───────────────────────────────────────────────────────────
        this.toastMessage = page.locator('[data-test="o-toast-message"]');
    }

    // Hard-navigate to the _meta organization-management page and confirm we
    // stayed there. The preceding org switch can still be redirecting to /web/,
    // so a bare goto races that redirect. Retry until the URL sticks and the
    // status-steps header column has rendered.
    async navigateToOrganizationManagement() {
        const url = process.env["ZO_BASE_URL"] + "/web/settings/organization_management?org_identifier=_meta";
        await expect(async () => {
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            if (/\/dex\/|\/web\/login/.test(this.page.url())) {
                await reauthenticateAlpha1(this.page);
                await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            }
            await expect(this.page).toHaveURL(/organization_management\?org_identifier=_meta/, { timeout: 5000 });
            await this.statusStepsUsedHeader.waitFor({ state: 'visible', timeout: 10000 });
        }).toPass({ timeout: 45000 });
    }

    // Returns the row locator whose name-cell text matches the given org name.
    getOrgRowByName(orgName) {
        const safe = orgName.replace(/'/g, "\\'");
        return this.page.locator(
            `xpath=//*[@data-test="o2-table-cell-name" and normalize-space()='${safe}']/ancestor::*[starts-with(@data-test,'o2-table-row-')]`,
        );
    }

    getStatusStepsUsedCell(orgName) {
        return this.getOrgRowByName(orgName).locator('[data-test="o2-table-cell-status_steps_used"]');
    }

    getStatusStepsTotalCell(orgName) {
        return this.getOrgRowByName(orgName).locator('[data-test="o2-table-cell-status_steps_total"]');
    }

    async getFirstOrgName() {
        await this.firstOrgNameCell.waitFor({ state: 'visible', timeout: 15000 });
        return (await this.firstOrgNameCell.textContent()).trim();
    }

    async getStatusStepsUsedText(orgName) {
        return (await this.getStatusStepsUsedCell(orgName).textContent()).trim();
    }

    async getStatusStepsTotalText(orgName) {
        return (await this.getStatusStepsTotalCell(orgName).textContent()).trim();
    }

    async openUsageLimitsForOrg(orgName) {
        await this.getOrgRowByName(orgName)
            .locator('[data-test="org-management-set-usage-limits-btn"]')
            .click();
        await expect(this.usageLimitsDialog).toBeVisible({ timeout: 10000 });
    }

    async selectProtocolStepsTab() {
        await this.protocolStepsTab.click();
        await expect(this.syntheticsStepsInput).toBeVisible({ timeout: 10000 });
    }

    async selectStatusStepsTab() {
        await this.statusStepsTab.click();
        await expect(this.syntheticsStepsInput).toBeVisible({ timeout: 10000 });
    }

    async fillStatusStepsLimit(value) {
        await this.syntheticsStepsInput.fill(String(value));
    }

    async saveUsageLimits() {
        await this.dialogPrimaryBtn.click();
    }

    // ── Assertions ─────────────────────────────────────────────────────────
    async expectStatusStepsColumnsVisible() {
        await expect(this.statusStepsUsedHeader).toBeVisible();
        await expect(this.statusStepsTotalHeader).toBeVisible();
        await expect(this.statusStepsUsedHeader).toContainText('Status Steps Used');
        await expect(this.statusStepsTotalHeader).toContainText('Status Steps Total');
    }

    async expectStatusStepsCellsNumeric(orgName) {
        const used = await this.getStatusStepsUsedText(orgName);
        const total = await this.getStatusStepsTotalText(orgName);
        expect(used).toMatch(/^[\d,]+$/);
        expect(total).toMatch(/^[\d,]+$/);
    }

    async expectAiCreditsTabActive() {
        await expect(this.aiCreditsTab).toHaveAttribute('data-state', 'active');
    }

    async expectProtocolStepsWording(orgName) {
        await expect(this.usageLimitsDialog).toContainText(`Set Protocol Steps for ${orgName}`);
    }

    async expectStatusStepsWording(orgName, usedText) {
        await expect(this.usageLimitsDialog).toContainText(`Set Status Steps for ${orgName}`);
        await expect(this.usageLimitsDialog).not.toContainText('Set Protocol Steps for');
        await expect(this.usageLimitsDialog).toContainText('resets each month');
        await expect(this.usageLimitsDialog).toContainText('Total Status Steps');
        await expect(this.usageLimitsDialog).toContainText(`Currently used: ${usedText} steps`);
    }

    async expectStatusStepsInputValue(value) {
        await expect(this.syntheticsStepsInput).toHaveValue(String(value), { timeout: 10000 });
    }

    async expectStatusStepsUpdatedToast() {
        await expect(
            this.toastMessage.filter({ hasText: /Synthetics steps updated successfully/i }).first(),
        ).toBeVisible({ timeout: 30000 });
    }

    async expectUsageLimitsDialogVisible() {
        await expect(this.usageLimitsDialog).toBeVisible();
    }

    async expectUsageLimitsDialogClosed() {
        await expect(this.usageLimitsDialog).toBeHidden({ timeout: 10000 });
    }

    async expectStatusStepsValidationError(text) {
        await expect(this.syntheticsStepsError).toBeVisible({ timeout: 10000 });
        await expect(this.syntheticsStepsError).toContainText(text);
    }

    async expectStatusStepsTotalCellEquals(orgName, expectedNumber) {
        await expect
            .poll(
                async () => {
                    const text = (await this.getStatusStepsTotalCell(orgName).textContent()).trim();
                    return Number(text.replace(/[^\d-]/g, ''));
                },
                { timeout: 10000 },
            )
            .toBe(expectedNumber);
    }
}
