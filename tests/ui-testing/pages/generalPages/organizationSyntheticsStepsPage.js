const { expect } = require('@playwright/test');

export class OrganizationSyntheticsStepsPage {
    constructor(page) {
        this.page = page;

        // ── Org management list ────────────────────────────────────────────
        this.orgManagementListTable = page.locator('[data-test="org-management-list-table"]');
        this.orgSearchInput = page.locator('[data-test="org-management-search-input-field"]');

        // ── Usage Allowance dialog ──────────────────────────────────────────
        this.usageLimitsDialog = page.locator('[data-test="organization-management-usage-limits-dialog"]');
        this.aiCreditsTab = page.locator('[data-test="org-management-set-ai-credits-btn"]');
        this.browserStepsTab = page.locator('[data-test="org-management-set-synthetics-browser-steps-btn"]');
        this.protocolStepsTab = page.locator('[data-test="org-management-set-synthetics-protocol-steps-btn"]');
        this.aiCreditsInput = page.locator('[data-test="ai-credits-limit-input-field"]');
        this.stepsInput = page.locator('[data-test="synthetics-steps-limit-input-field"]');
        this.stepsInputError = page.locator('[data-test="synthetics-steps-limit-input-error"]');
        this.stepsInputLabel = page.locator('[data-test="synthetics-steps-limit-input"] label');
        this.dialogPrimaryBtn = page.locator(
            '[data-test="organization-management-usage-limits-dialog"] [data-test="o-dialog-primary-btn"]'
        );
        this.dialogSecondaryBtn = page.locator(
            '[data-test="organization-management-usage-limits-dialog"] [data-test="o-dialog-secondary-btn"]'
        );
    }

    // Hard-navigate to the _meta org management page and wait for the list.
    // The preceding org switch can still be redirecting, so retry the goto until
    // the URL sticks and the table has rendered (mirror openMetaGeneralSettings).
    async openOrganizationManagement() {
        const url = process.env["ZO_BASE_URL"] + "/web/settings/organization_management?org_identifier=_meta";
        await expect(async () => {
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            await expect(this.page).toHaveURL(/settings\/organization_management\?org_identifier=_meta/, { timeout: 5000 });
            await this.orgManagementListTable.waitFor({ state: 'visible', timeout: 10000 });
        }).toPass({ timeout: 45000 });
    }

    // Filter the list to a single org so its row is guaranteed to be rendered
    // (the list can be long and OTable only renders the visible window).
    async searchOrg(orgName) {
        await this.orgSearchInput.waitFor({ state: 'visible' });
        await this.orgSearchInput.fill(orgName);
        await this.getOrgRowByName(orgName).waitFor({ state: 'visible', timeout: 10000 });
    }

    // Row locator whose name-cell text matches, using the OTable row ancestor
    // jump (same XPath pattern as createOrgPage.getOrgRowByName).
    getOrgRowByName(orgName) {
        const safe = orgName.replace(/'/g, "\\'");
        return this.page.locator(
            `xpath=//*[@data-test="o2-table-cell-name" and normalize-space()='${safe}']/ancestor::*[starts-with(@data-test,'o2-table-row-')]`
        );
    }

    getStepsTotalCell(orgName, pool) {
        const cellTest = pool === 'browser' ? 'o2-table-cell-browser_steps_total' : 'o2-table-cell-protocol_steps_total';
        return this.getOrgRowByName(orgName).locator(`[data-test="${cellTest}"]`);
    }

    async expectStepsTotalCell(orgName, pool, expectedText) {
        await this.searchOrg(orgName);
        await expect(this.getStepsTotalCell(orgName, pool)).toHaveText(expectedText);
    }

    async getStepsTotalCellText(orgName, pool) {
        await this.searchOrg(orgName);
        return (await this.getStepsTotalCell(orgName, pool).textContent())?.trim() ?? '';
    }

    async openUsageLimitsDialog(orgName) {
        await this.searchOrg(orgName);
        const row = this.getOrgRowByName(orgName);
        await row.locator('[data-test="org-management-set-usage-limits-btn"]').click();
        await expect(this.usageLimitsDialog).toBeVisible({ timeout: 10000 });
    }

    async expectAiCreditsInputVisible() {
        await expect(this.aiCreditsInput).toBeVisible();
    }

    async expectStepsInputNotPresent() {
        await expect(this.stepsInput).toHaveCount(0);
    }

    async selectBrowserStepsTab() {
        await this.browserStepsTab.click();
        await expect(this.stepsInput).toBeVisible({ timeout: 10000 });
    }

    async selectProtocolStepsTab() {
        await this.protocolStepsTab.click();
        await expect(this.stepsInput).toBeVisible({ timeout: 10000 });
    }

    async expectStepsFormLabel(expectedLabel) {
        await expect(this.stepsInputLabel).toContainText(expectedLabel);
    }

    async fillStepsLimit(value) {
        await this.stepsInput.waitFor({ state: 'visible' });
        await this.stepsInput.fill(String(value));
    }

    async expectStepsInputError(errorText) {
        await expect(this.stepsInputError).toHaveText(errorText);
    }

    async expectDialogStillOpen() {
        await expect(this.usageLimitsDialog).toBeVisible();
    }

    async clickSaveButton() {
        await this.dialogPrimaryBtn.click();
    }

    async saveUsageLimit() {
        await this.dialogPrimaryBtn.click();
        await expect(this.usageLimitsDialog).toBeHidden({ timeout: 15000 });
    }

    async cancelUsageLimit() {
        await this.dialogSecondaryBtn.click();
        await expect(this.usageLimitsDialog).toBeHidden({ timeout: 15000 });
    }

    // Read the current ceiling for one pool of one org via the admin org list.
    // The envelope is { data: [...] } (not .list) — see org.rs AllOrganizationResponse.
    async getOrgQuota(pool, orgId) {
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const response = await fetch(
            `${process.env.INGESTION_URL}/api/_meta/organizations?page_size=1000000`,
            { method: "GET", headers }
        );

        const status = response.status;
        let body = null;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            body = await response.json();
        }

        if (status !== 200 || !body || !Array.isArray(body.data)) return null;

        const org = body.data.find((o) => o.identifier === orgId);
        if (!org) return null;

        const field = {
            'synthetics_browser_steps': 'browser_steps_limit',
            'synthetics_protocol_steps': 'protocol_steps_limit',
            'ai_credits': 'credits_limit',
        }[pool];
        return Number(org[field] ?? 0);
    }

    // PUT /api/{pathOrg}/quota/{pool}/usage_limit — `limit` is the new ceiling,
    // not an increment. pathOrg is `_meta` for the happy path; tests override it
    // to exercise the non-meta 401 path.
    async setQuotaUsageLimit(pool, orgId, limit, pathOrg = '_meta') {
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const response = await fetch(
            `${process.env.INGESTION_URL}/api/${pathOrg}/quota/${pool}/usage_limit`,
            {
                method: "PUT",
                headers,
                body: JSON.stringify({ org_id: orgId, limit }),
            }
        );

        const status = response.status;
        const contentType = response.headers.get("content-type");
        let data = null;
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        return { status, data };
    }
}
