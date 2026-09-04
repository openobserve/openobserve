// rumSourcemapsPage.js — RUM Source Maps list page + delete flow.
// The UPLOAD FORM has its own page object (generalPages/rumFormValidationPage.js,
// registered as pm.rumFormValidation) — reuse that for form interactions.
import { expect } from '@playwright/test';

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

    /** Toast / inline message shown by the upload page (error or success). */
    async expectUploadMessage(textOrRegex, timeoutMs = 15000) {
        await expect(this.page.getByText(textOrRegex).first()).toBeVisible({
            timeout: timeoutMs,
        });
    }
}
