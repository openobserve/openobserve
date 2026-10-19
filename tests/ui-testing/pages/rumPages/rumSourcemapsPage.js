// rumSourcemapsPage.js — RUM Source Maps list page + delete flow.
// The UPLOAD FORM has its own page object (generalPages/rumFormValidationPage.js,
// registered as pm.rumFormValidation) — reuse that for form interactions.
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { rumTestContext, basicAuthHeader } = require('../../playwright-tests/utils/rum-env.js');

export class RumSourcemapsPage {
    constructor(page) {
        this.page = page;

        // Locators
        this.tableRow = page.locator('[data-test^="o2-table-row-"]');
        this.fileItem = page.locator('[data-test="source-maps-file-item"]');
        this.deleteDialog = page.locator('[data-test="delete-source-maps-dialog"]');
        this.deleteDialogConfirm = this.deleteDialog.getByRole('button', {
            name: /delete|confirm|ok/i,
        });
        this.toastMessage = page.locator('[data-test="o-toast-message"]');
        // The list's filters carry no data-test and their label is not tied to the trigger, so the label's wrapper finds it.
        this.serviceFilter = page.locator('div:has(> label:text-is("Service")) [role="combobox"]');
        this.filterOptions = page.getByRole('option');
        this.applyFiltersBtn = page.getByRole('button', { name: 'Apply Filters' });
        this.uploadPageBtn = page.getByRole('button', { name: 'Upload Source Maps' });
        this.uploadCancelBtn = page.locator('[data-test="rum-upload-source-maps-cancel-btn"]');
        this.versionCells = page.locator('[data-test="o2-table-cell-version"]');
        this.pageSizeTrigger = page.locator('[data-test="o2-table-page-size-select-trigger"]');
        this.sourceMapsTab = page.locator('[data-test="rum-tab-source-maps"]');
        this.rumMenuLink = page.locator('[data-test="nav-group-experience"] [data-test="menu-link-/rum-item"]');
    }

    sortTrigger(column) {
        return this.page.locator(`[data-test="o2-table-th-${column}"] [data-test="o2-table-th-sort-trigger"]`);
    }

    sortIcon(column) {
        return this.page.locator(`[data-test="o2-table-th-${column}"] [data-test^="o2-table-sort-icon-"]`);
    }

    /** Picks one uploaded service in the Service filter and applies it. */
    async filterByService(service) {
        await this.serviceFilter.click();
        // The list ignores typed values it does not offer, so the service is picked from the offered options.
        await this.page.keyboard.type(service);
        await this.filterOptions.filter({ hasText: service }).click();
        await expect(this.serviceFilter).toHaveAttribute('data-test-selected-value', service);
        const listed = this.page.waitForResponse(
            (r) => r.request().method() === 'GET' && /\/sourcemaps\?/.test(r.url()) && r.url().includes(`service=${encodeURIComponent(service)}`),
        );
        await this.applyFiltersBtn.click();
        expect((await listed).status()).toBe(200);
    }

    /** Clicks a column's sort control until the list is sorted that way. */
    async sortBy(column, direction) {
        const icon = this.sortIcon(column);
        for (let i = 0; i < 3 && (await icon.getAttribute('data-test-sort-direction')) !== direction; i++) {
            const before = await icon.getAttribute('data-test-sort-direction');
            await this.sortTrigger(column).click();
            await expect(icon).not.toHaveAttribute('data-test-sort-direction', before);
        }
        await expect(icon).toHaveAttribute('data-test-sort-direction', direction);
    }

    async setPageSize(size) {
        await this.pageSizeTrigger.click();
        await this.page.locator(`[data-test="o2-table-page-size-select-option"][data-test-value="${size}"]`).click();
        await expect(this.pageSizeTrigger).toHaveText(String(size));
    }

    /** Opens the Upload page from the list and cancels back to the list. */
    async openUploadAndCancel() {
        await this.uploadPageBtn.click();
        await this.expectOnUploadPage();
        await this.uploadCancelBtn.click();
        await this.expectOnListPage();
    }

    /** Re-enters RUM from the Experience menu and opens its Source Maps tab, as a user coming back from another module would. */
    async returnViaRumMenu() {
        await this.rumMenuLink.click();
        await expect(this.page).toHaveURL(/\/rum\//, { timeout: 30000 });
        await this.sourceMapsTab.click();
        await this.expectOnListPage();
    }

    /** The list shows the service filter, the sort, the page size and exactly these versions in this order. */
    async expectListState({ service, column, direction, pageSize, versions }) {
        await expect(this.serviceFilter).toHaveAttribute('data-test-selected-value', service, { timeout: 15000 });
        await expect(this.sortIcon(column)).toHaveAttribute('data-test-sort-direction', direction);
        await expect(this.pageSizeTrigger).toHaveText(String(pageSize));
        await expect(this.versionCells).toHaveText(versions, { timeout: 15000 });
    }

    groupRow(service) {
        return this.tableRow.filter({ hasText: service });
    }

    deleteButtonFor(service) {
        return this.page.locator(`[data-test="source-maps-${service}-delete"]`);
    }

    /**
     * Open the Source Maps list. Waits for DOM readiness only — the full
     * "load" event is flaky on slow runners; callers assert on rows next,
     * which is the real readiness signal.
     */
    async gotoSourceMapsList() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/source-maps?org_identifier=${org}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
    }

    async expectOnUploadPage() {
        await expect(this.page).toHaveURL(/upload-source-maps/);
    }

    async expectOnListPage(timeoutMs = 15000) {
        await expect(this.page).toHaveURL(/\/rum\/source-maps/, { timeout: timeoutMs });
    }

    async expectGroupRowVisible(service, timeoutMs = 15000) {
        await expect(this.groupRow(service).first()).toBeVisible({ timeout: timeoutMs });
    }

    async expectGroupRowContains(service, texts = []) {
        const row = this.groupRow(service).first();
        for (const text of texts) {
            await expect(row).toContainText(text);
        }
    }

    /** Expanding the row lists the actual files extracted from the zip. */
    async expandGroupRow(service) {
        await this.groupRow(service).first().click();
    }

    async expectFileItemVisible(fileName, timeoutMs = 10000) {
        const item = this.fileItem.filter({ hasText: fileName });
        await expect(item.first()).toBeVisible({ timeout: timeoutMs });
        return item.first();
    }

    async expectFileItemContains(fileName, text) {
        const item = this.fileItem.filter({ hasText: fileName });
        await expect(item.first()).toContainText(text);
    }

    /**
     * Delete a sourcemaps group through the real UI flow and wait for the
     * backing DELETE request to succeed. Confirming fires the DELETE
     * asynchronously and closes the dialog immediately — navigating away
     * before the request lands ABORTS it and the group survives, so this
     * waits for the API response, then for the row removal (the UI drops the
     * row only after the API succeeds).
     */
    async deleteGroupAndExpectRemoved(service) {
        await this.deleteButtonFor(service).click();
        await expect(this.deleteDialog).toBeVisible({ timeout: 10000 });

        const deleteResponse = this.page.waitForResponse(
            (r) => r.request().method() === 'DELETE' && r.url().includes('/sourcemaps'),
            { timeout: 15000 },
        );
        await this.deleteDialogConfirm.click();
        expect((await deleteResponse).status(), 'sourcemaps DELETE should succeed').toBe(200);

        await expect(this.groupRow(service)).toHaveCount(0, { timeout: 15000 });
    }

    /** Calls the org's source-maps API as the RUM test user. */
    async sourceMapsApi(method, query, options = {}) {
        const { orgId, baseUrl, email, password } = rumTestContext();
        return this.page.request[method](`${baseUrl}/api/${orgId}/sourcemaps${query}`, {
            ...options,
            headers: { Authorization: basicAuthHeader(email, password) },
        });
    }

    /** Uploads a zip as one service@version source-map group through the API. */
    async uploadGroupViaApi(service, version, env, { name, buffer }) {
        const res = await this.sourceMapsApi('post', '', {
            multipart: { service, version, env, file: { name, mimeType: 'application/zip', buffer } },
        });
        expect(res.ok(), `upload ${service}@${version}: ${res.status()} ${await res.text()}`).toBe(true);
    }

    // Cleanup only: a failed delete is logged, never thrown, so it cannot replace the test's own result.
    async deleteGroupViaApi(service, version, env) {
        const res = await this.sourceMapsApi('delete', `?${new URLSearchParams({ service, version, env })}`).catch(() => null);
        if (!res?.ok()) testLogger.warn('Cleanup delete failed', { service, version, status: res?.status() });
    }

    /** Toast / inline message shown by the upload page (error or success). */
    async expectUploadMessage(textOrRegex, timeoutMs = 15000) {
        await expect(this.page.getByText(textOrRegex).first()).toBeVisible({
            timeout: timeoutMs,
        });
    }
}
