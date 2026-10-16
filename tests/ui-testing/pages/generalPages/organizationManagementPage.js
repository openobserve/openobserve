const { expect } = require('@playwright/test');
const { reauthenticateAlpha1 } = require('../../playwright-tests/utils/reauth-alpha1.js');

const META_ORG = '_meta';
const STATUS_STEPS_POOL = 'synthetics_status_protocol';

export class OrganizationManagementPage {
    constructor(page) {
        this.page = page;

        this.statusStepsUsedHeader = page.locator('[data-test="o2-table-th-status_steps_used"]');
        this.statusStepsTotalHeader = page.locator('[data-test="o2-table-th-status_steps_total"]');
        this.orgRows = page.locator('tr[data-test^="o2-table-row-"]');

        this.usageLimitsDialog = page.locator('[data-test="organization-management-usage-limits-dialog"]');
        this.aiCreditsTab = page.locator('[data-test="org-management-set-ai-credits-btn"]');
        this.protocolStepsTab = page.locator('[data-test="org-management-set-synthetics-protocol-steps-btn"]');
        this.statusStepsTab = page.locator('[data-test="org-management-set-synthetics-status-steps-btn"]');
        this.syntheticsStepsInput = page.locator('[data-test="synthetics-steps-limit-input-field"]');
        this.syntheticsStepsError = page.locator('[data-test="synthetics-steps-limit-input-error"]');
        this.dialogPrimaryBtn = page.locator(
            '[data-test="organization-management-usage-limits-dialog"] [data-test="o-dialog-primary-btn"]',
        );

        this.toastMessage = page.locator('[data-test="o-toast-message"]');
    }

    // The preceding org switch can still be redirecting to /web/, so a bare goto races it.
    async navigateToOrganizationManagement() {
        const url = process.env["ZO_BASE_URL"] + `/web/settings/organization_management?org_identifier=${META_ORG}`;
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

    // Rows are keyed by identifier because org display names are not unique.
    getOrgRow(orgIdentifier) {
        const escaped = orgIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.orgRows.filter({
            has: this.page.locator('[data-test="o2-table-cell-identifier"]', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }),
        });
    }

    getStatusStepsUsedCell(orgIdentifier) {
        return this.getOrgRow(orgIdentifier).locator('[data-test="o2-table-cell-status_steps_used"]');
    }

    getStatusStepsTotalCell(orgIdentifier) {
        return this.getOrgRow(orgIdentifier).locator('[data-test="o2-table-cell-status_steps_total"]');
    }

    async getFirstOrg() {
        const firstRow = this.orgRows.first();
        const identifierCell = firstRow.locator('[data-test="o2-table-cell-identifier"]');
        await identifierCell.waitFor({ state: 'visible', timeout: 15000 });
        const identifier = (await identifierCell.textContent()).trim();
        const name = (await firstRow.locator('[data-test="o2-table-cell-name"]').textContent()).trim();
        return { identifier, name };
    }

    async getStatusStepsUsedText(orgIdentifier) {
        return (await this.getStatusStepsUsedCell(orgIdentifier).textContent()).trim();
    }

    async getStatusStepsTotalText(orgIdentifier) {
        return (await this.getStatusStepsTotalCell(orgIdentifier).textContent()).trim();
    }

    async openUsageLimitsForOrg(orgIdentifier) {
        await this.getOrgRow(orgIdentifier)
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

    // Uses the page's cookie session, as the dialog does; cloud has no root basic-auth user.
    async setStatusStepsLimitViaApi(orgIdentifier, limit) {
        return this.page.evaluate(async ({ metaOrg, pool, body }) => {
            const resp = await fetch(`/api/${metaOrg}/quota/${pool}/usage_limit`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return resp.status;
        }, { metaOrg: META_ORG, pool: STATUS_STEPS_POOL, body: { org_id: orgIdentifier, limit } });
    }

    async getAdminOrgsViaSession() {
        return this.page.evaluate(async (metaOrg) => {
            const resp = await fetch(`/api/${metaOrg}/organizations?page_size=1000000`, { credentials: 'include' });
            const isJson = (resp.headers.get('content-type') || '').includes('application/json');
            return { status: resp.status, data: isJson ? await resp.json() : await resp.text() };
        }, META_ORG);
    }

    async expectStatusStepsColumnsVisible() {
        await expect(this.statusStepsUsedHeader).toBeVisible();
        await expect(this.statusStepsTotalHeader).toBeVisible();
        await expect(this.statusStepsUsedHeader).toContainText('Status Steps Used');
        await expect(this.statusStepsTotalHeader).toContainText('Status Steps Total');
    }

    async expectStatusStepsCellsNumeric(orgIdentifier) {
        const used = await this.getStatusStepsUsedText(orgIdentifier);
        const total = await this.getStatusStepsTotalText(orgIdentifier);
        expect(used).toMatch(/^[\d,]+$/);
        expect(total).toMatch(/^[\d,]+$/);
    }

    async expectAiCreditsTabActive() {
        await expect(this.aiCreditsTab).toHaveAttribute('data-state', 'active');
    }

    async expectStatusStepsTabActive(orgName) {
        await expect(this.statusStepsTab).toHaveAttribute('data-state', 'active');
        await expect(this.usageLimitsDialog).toContainText(`Set Status Steps for ${orgName}`);
        await expect(this.usageLimitsDialog).toContainText('Total Status Steps');
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

    async expectStatusStepsTotalCellEquals(orgIdentifier, expectedNumber) {
        await expect
            .poll(
                async () => {
                    const text = (await this.getStatusStepsTotalCell(orgIdentifier).textContent()).trim();
                    return Number(text.replace(/[^\d-]/g, ''));
                },
                { timeout: 10000 },
            )
            .toBe(expectedNumber);
    }
}
