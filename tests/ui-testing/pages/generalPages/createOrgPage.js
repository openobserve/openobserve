
const { expect } = require('@playwright/test');

export class CreateOrgPage {
    constructor(page) {
        this.page = page;

        // ── IAM navigation ────────────────────────────────────────────────
        this.iamMenuLink = page.locator('[data-test="menu-link-\\/iam-item"]');
        this.iamOrganizationsTab = page.locator('[data-test="iam-organizations-tab"]');
        this.iamPage = page.locator('[data-test="iam-page"]');

        // ── Add / Edit drawer ─────────────────────────────────────────────
        this.addOrgButton = page.locator('[data-test="Add Organization"]');
        this.addUpdateDialog = page.locator('[data-test="add-update-organization-dialog"]');

        // OInput wrapper carries `org-name`; the native input is `org-name-field`.
        this.orgNameWrapper = page.locator('[data-test="org-name"]');
        this.orgNameInput = page.locator('[data-test="org-name-field"]');
        this.orgNameError = page.locator('[data-test="org-name-error"]');

        // ODrawer footer buttons exposed via o-drawer-{primary|secondary}-btn,
        // scoped under the dialog wrapper data-test for uniqueness.
        this.saveOrgButton = page.locator(
            '[data-test="add-update-organization-dialog"] [data-test="o-dialog-primary-btn"]'
        );
        this.cancelOrgButton = page.locator(
            '[data-test="add-update-organization-dialog"] [data-test="o-dialog-secondary-btn"]'
        );

        // ── Search input ──────────────────────────────────────────────────
        // OInput wrapper data-test="organizations-search-input"; native input
        // resolves to data-test="organizations-search-input-field".
        this.searchOrgInput = page.locator('[data-test="organizations-search-input-field"]');

        // ── Table / rows ──────────────────────────────────────────────────
        this.tableRows = page.locator('[data-test^="o2-table-row-"]');
        this.firstTableRow = this.tableRows.first();
        this.tableCells = page.locator('[data-test^="o2-table-cell-"]');

        // Edit action exposed per row in ListOrganizations.vue (#cell-actions).
        // The current UI does NOT expose a delete button — used only for
        // UI-deletion-attempt diagnostics.
        this.orgEditButtons = page.locator('[data-test="organization-name-edit"]');
    }

    /**
     * Returns the row locator whose name-cell text matches the given org name.
     * Uses the o2-table-cell-name column (per OTable convention) plus an
     * ancestor-axis jump back to the row container — no element-tag XPath.
     */
    getOrgRowByName(orgName) {
        // Escape regex special chars in the org name for the XPath text comparison.
        const safe = orgName.replace(/'/g, "\\'");
        return this.page.locator(
            `xpath=//*[@data-test="o2-table-cell-name" and normalize-space()='${safe}']/ancestor::*[starts-with(@data-test,'o2-table-row-')]`
        );
    }

    getOrgIdentifierCell(orgName) {
        const safe = orgName.replace(/'/g, "\\'");
        return this.page.locator(
            `xpath=//*[@data-test="o2-table-cell-name" and normalize-space()='${safe}']/ancestor::*[starts-with(@data-test,'o2-table-row-')]//*[@data-test="o2-table-cell-identifier"]`
        );
    }

    async createOrg(newOrgName) {
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        let newOrgBody = {
            "name": newOrgName,
        }

        const fetchResponse = await fetch(
            `${process.env.INGESTION_URL}/api/organizations`,
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify(newOrgBody),
            }
        );
        try {
            const response = await fetchResponse;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const jsonData = await response.json();
                console.log(response.status);
                console.log(jsonData);
                return jsonData.identifier;
                // Process JSON data here
            } else {
                const textData = await response.text();
                console.log("Response is not JSON:", textData);
                return textData;
                // Handle the non-JSON response here
            }
        } catch (error) {
            console.error("Failed to parse JSON response:", error);
            return "";
        }
    }

    async navigateToOrg() {
        await this.iamMenuLink.click();
        await this.iamOrganizationsTab.click();
    }


    async clickAddOrg() {
        // The parent ListOrganizations.vue toggles the drawer via the router query
        // ?action=add. Its watcher only fires when the value CHANGES, so if the
        // drawer was closed via Cancel (which leaves the query alone), a second
        // click on "Add Organization" pushes the same query and the watcher does
        // not re-open the drawer. Guard against that by waiting for the org-name
        // input to be visible, and if it never appears, re-navigate to clear the
        // route query and try once more.
        await this.addOrgButton.click();
        try {
            await this.orgNameWrapper.waitFor({ state: 'visible', timeout: 5000 });
        } catch {
            await this.navigateToOrg();
            await this.addOrgButton.waitFor({ state: 'visible' });
            await this.addOrgButton.click();
            await this.orgNameWrapper.waitFor({ state: 'visible', timeout: 10000 });
        }
    }

    async fillOrgName(orgName) {
        //check if element is visible before filling
        await this.orgNameInput.waitFor({ state: 'visible' });
        await this.orgNameInput.fill(orgName);
    }

    async clearOrgName() {
        await this.orgNameInput.waitFor({ state: 'visible' });
        await this.orgNameInput.fill('');
    }

    async isDrawerOpen() {
        return await this.orgNameWrapper.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async clickSaveOrg() {
        await this.saveOrgButton.click();
    }

    /**
     * Click Save and wait until either the drawer closes (successful create
     * / update) or the org-name field still shows — meaning onSubmit() bailed
     * because the value failed isValidOrgName. Use this when the spec needs
     * deterministic settling after a Save click instead of a fixed timeout.
     */
    async clickSaveOrgAndWaitForResult({ timeout = 10000 } = {}) {
        await this.saveOrgButton.click();
        await Promise.race([
            this.orgNameWrapper.waitFor({ state: 'hidden', timeout }).catch(() => {}),
            this.orgNameError.waitFor({ state: 'visible', timeout }).catch(() => {}),
        ]);
    }

    async checkSaveEnabled() {
        // Check if the button is enabled
        const isEnabled = await this.saveOrgButton.isEnabled();

        if (!isEnabled) {
            console.error('The "Add Organization" button is not enabled.');
            return false; // Return false to indicate the button is not enabled
        }

        return true; // Return true if the button is enabled
    }

    async clickCancelButton() {
        // Check if the button is visible and enabled before clicking
        const isVisible = await this.cancelOrgButton.isVisible();
        const isEnabled = await this.cancelOrgButton.isEnabled();

        if (isVisible && isEnabled) {
            await this.cancelOrgButton.click();
        } else {
            console.error('The "Cancel" button is not visible or enabled.');
            throw new Error('Attempted to click "Cancel" button, but it is not visible or enabled.');
        }
    }


    async searchOrg(orgName) {
        await this.searchOrgInput.click();
        await this.searchOrgInput.fill(orgName);
        // Wait for the table to settle after the global-filter change: either
        // a matching row is rendered, or the "No data available" empty state
        // appears. Whichever resolves first is fine — we just don't want to
        // race the OTable's client-side filter.
        await Promise.race([
            this.firstTableRow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
            this.page.locator('[data-test="o2-empty-state"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
        ]);
    }

    async clearSearchOrg() {
        await this.searchOrgInput.fill('');
        await expect(this.firstTableRow).toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    async verifyOrgNotExists() {
        await expect(this.page.locator('[data-test="o2-empty-state"]')).toBeVisible();
    }

    async verifyOrgExists(orgName) {
        await expect(this.getOrgRowByName(orgName)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Returns the locator of the validation error message rendered by OInput
     * for the org-name field. Use this for assertions in the spec rather than
     * scraping by text — the data-test is derived from the parent's data-test.
     */
    getOrgNameError() {
        return this.orgNameError;
    }

    async getAdminOrgs(orgId = '_meta') {
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const fetchResponse = await fetch(
            `${process.env.INGESTION_URL}/api/${orgId}/organizations?page_size=1000000`,
            {
                method: "GET",
                headers: headers,
            }
        );

        const status = fetchResponse.status;
        const contentType = fetchResponse.headers.get("content-type");
        let data = null;

        if (contentType && contentType.includes("application/json")) {
            data = await fetchResponse.json();
        } else {
            data = await fetchResponse.text();
        }

        return { status, data };
    }

    async deleteOrgViaAPI(orgIdentifier) {
        console.log(`⚠️  WARNING: Organization deletion may not be supported in this environment`);

        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        try {
            const fetchResponse = await fetch(
                `${process.env.INGESTION_URL}/api/organizations/${orgIdentifier}`,
                {
                    method: "DELETE",
                    headers: headers,
                }
            );

            console.log(`Delete org API response - Status: ${fetchResponse.status}`);
            const responseText = await fetchResponse.text();
            console.log(`Delete org API response - Body: ${responseText}`);

            if (fetchResponse.ok) {
                console.log(`✓ Organization ${orgIdentifier} deletion API call succeeded`);
                return true;
            } else if (fetchResponse.status === 403) {
                console.log(`✗ Organization deletion forbidden (403) - deletion not allowed in this environment`);
                return false;
            } else if (fetchResponse.status === 404) {
                console.log(`ℹ Organization ${orgIdentifier} not found (404) - may already be deleted`);
                return true; // Consider 404 as success since org doesn't exist
            } else {
                console.log(`✗ Failed to delete organization ${orgIdentifier}: Status ${fetchResponse.status} - ${responseText}`);
                return false;
            }
        } catch (error) {
            console.error(`✗ Error during organization deletion API call:`, error);
            return false;
        }
    }

    async deleteOrgViaUI(orgName) {
        console.log(`⚠️  WARNING: UI deletion may not be supported - delete buttons might not exist`);

        try {
            // Search for the organization first
            await this.searchOrg(orgName);

            // The current ListOrganizations.vue exposes only an edit action
            // (data-test="organization-name-edit") — there is no delete button
            // in the rendered row. So we report unsupported and bail out.
            const editCount = await this.orgEditButtons.count();
            console.log(`Found ${editCount} edit buttons in the organization table`);

            console.log(`✗ Delete action is not exposed in the organization table UI`);
            return false;
        } catch (error) {
            console.error(`✗ Failed to delete organization ${orgName} via UI:`, error);
            return false;
        }
    }

    async getOrgIdentifierFromTable(orgName) {
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempting to get identifier for ${orgName} (attempt ${attempt}/${maxRetries})`);

                // Ensure we search for the organization first to make it visible
                await this.searchOrg(orgName);
                await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

                // Wait for table to be stable
                const row = this.getOrgRowByName(orgName);
                if (!(await row.isVisible({ timeout: 5000 }))) {
                    console.log(`Organization row not visible for ${orgName} on attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                        continue;
                    }
                    return null;
                }

                const identifierCell = this.getOrgIdentifierCell(orgName);
                const identifier = (await identifierCell.textContent({ timeout: 3000 }).catch(() => null))?.trim();

                if (identifier && /^[a-zA-Z0-9]{8,64}$/.test(identifier)) {
                    console.log(`Found identifier via column cell: ${identifier}`);
                    return identifier;
                }

                console.log(`No suitable identifier found for ${orgName} on attempt ${attempt}`);

            } catch (error) {
                console.error(`Error getting identifier for ${orgName} on attempt ${attempt}:`, error.message);
            }
        }

        console.warn(`Failed to get identifier for ${orgName} after ${maxRetries} attempts`);
        return null;
    }

}
