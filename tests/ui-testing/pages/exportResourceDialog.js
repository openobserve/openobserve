/**
 * ExportResourceDialog — page object for the shared "Export Resource" dialog
 * (web/src/components/common/ExportResourceDialog.vue).
 *
 * The dialog is mounted by two callers: the alerts list (`alert-export-dialog`)
 * and the SLO list (`slos-slolist-export-dialog`). Every selector is derived from
 * the caller's `data-test` value (`this.d`), so the same methods serve both areas.
 *
 * It owns the two-format viewer (JSON / Terraform tabs) and the copy/download
 * actions. Reading the code goes through the Monaco editor the dialog embeds, not
 * the DOM text, so soft-wrapping and virtualized lines never lose content.
 */

import { expect } from '@playwright/test';
const testLogger = require('../playwright-tests/utils/test-logger.js');

export class ExportResourceDialog {
    /**
     * @param {import('@playwright/test').Page} page
     * @param {string} [dataTest] - the caller's `data-test` value (default: alert-export-dialog)
     */
    constructor(page, dataTest = 'alert-export-dialog') {
        this.page = page;
        this.d = dataTest;
        this.locators = {
            dialog: `[data-test="${dataTest}"]`,
            jsonTab: `[data-test="${dataTest}-json-tab"]`,
            terraformTab: `[data-test="${dataTest}-terraform-tab"]`,
            copyBtn: `[data-test="${dataTest}-copy-btn"]`,
            terraformDropped: `[data-test="${dataTest}-terraform-dropped"]`,
            // The editor-id is rendered as the DOM `id` of the Monaco mount point.
            editorId: `${dataTest}-editor`,
            primaryBtn: '[data-test="o-dialog-primary-btn"]',
            neutralBtn: '[data-test="o-dialog-neutral-btn"]',
        };
    }

    /** The dialog root is visible. */
    async expectOpen() {
        await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 15000 });
        testLogger.info('Export dialog open', { dataTest: this.d });
    }

    /** The dialog root is gone (closed via download, close, or Esc). */
    async expectClosed() {
        await expect(this.page.locator(this.locators.dialog)).toBeHidden({ timeout: 15000 });
        testLogger.info('Export dialog closed', { dataTest: this.d });
    }

    async expectJsonTabActive() {
        await expect(this.page.locator(this.locators.jsonTab)).toHaveAttribute('data-state', 'active', { timeout: 15000 });
    }

    async expectTerraformTabActive() {
        await expect(this.page.locator(this.locators.terraformTab)).toHaveAttribute('data-state', 'active', { timeout: 15000 });
    }

    /**
     * Switch to the Terraform tab and wait until the editor is mounted. Asserts
     * the tab is active first so a silently-failed click can't false-green.
     */
    async switchToTerraform() {
        await this.page.locator(this.locators.terraformTab).click();
        await this.expectTerraformTabActive();
        await this.waitForEditor();
        testLogger.info('Switched export dialog to Terraform tab');
    }

    /** Wait for the dialog's Monaco editor to be mounted and hydrated. */
    async waitForEditor() {
        await this.page.waitForFunction(
            (editorId) => {
                const container = document.getElementById(editorId);
                if (!container) return false;
                const monaco = window.monaco;
                if (!monaco?.editor?.getEditors) return false;
                const editors = monaco.editor.getEditors();
                return editors.some((ed) => container.contains(ed.getDomNode()));
            },
            this.locators.editorId,
            { timeout: 15000 },
        );
    }

    /**
     * Poll the editor until its content contains `substring`, then return the full
     * content. Absorbs the async model update after a tab switch (JSON <-> HCL).
     * @param {string} substring
     * @param {number} [timeout]
     * @returns {Promise<string>}
     */
    async waitForCodeContaining(substring, timeout = 15000) {
        return this.page.waitForFunction(
            ({ editorId, substr }) => {
                const container = document.getElementById(editorId);
                const monaco = window.monaco;
                if (!monaco?.editor?.getEditors) return null;
                const editors = monaco.editor.getEditors();
                const target =
                    editors.find((ed) => container && container.contains(ed.getDomNode())) ||
                    editors[editors.length - 1];
                if (!target) return null;
                const value = target.getValue();
                return value.includes(substr) ? value : null;
            },
            { editorId: this.locators.editorId, substr: substring },
            { timeout },
        );
    }

    /** Copy the current tab's code to the clipboard. */
    async copy() {
        await this.page.locator(this.locators.copyBtn).click();
        testLogger.info('Clicked copy in export dialog');
    }

    /**
     * Click Download and capture the artifact. The app writes files via
     * `URL.createObjectURL` + `<a download>.click()` (not a native download
     * event), so both are patched here — the same technique as
     * `alertsPage.exportAlerts()` — to capture the file name and content.
     * @returns {Promise<{fileName: string, content: string}>}
     */
    async download() {
        await this.page.evaluate(() => {
            window.__capturedBlobData = null;
            window.__capturedFileName = null;
            const origCreateObjectURL = URL.createObjectURL;
            URL.createObjectURL = function (blob) {
                if (blob instanceof Blob) {
                    blob.text().then((text) => {
                        window.__capturedBlobData = text;
                    });
                }
                return origCreateObjectURL.call(URL, blob);
            };
            const origAnchorClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                if (this.download) window.__capturedFileName = this.download;
                return origAnchorClick.call(this);
            };
        });

        await this.page.locator(this.locators.primaryBtn).click();
        await this.page.waitForFunction(() => window.__capturedBlobData !== null, null, { timeout: 10000 });
        return this.page.evaluate(() => ({
            fileName: window.__capturedFileName,
            content: window.__capturedBlobData,
        }));
    }

    /** Close via the neutral (Close) button. */
    async close() {
        await this.page.locator(this.locators.neutralBtn).click();
        await this.expectClosed();
    }

    /** Assert a success-variant toast appears, optionally matching `hasText`. */
    async expectSuccessToast(hasText) {
        let toast = this.page.locator('[data-test-variant="success"] [data-test="o-toast-message"]');
        if (hasText) toast = toast.filter({ hasText });
        await expect(toast.first()).toBeVisible({ timeout: 30000 });
        testLogger.info('Success toast visible', { hasText });
    }

    /** Assert the dropped-fields info banner is visible and lists every given field. */
    async expectDroppedBanner(fields) {
        const banner = this.page.locator(this.locators.terraformDropped);
        await expect(banner).toBeVisible({ timeout: 10000 });
        for (const field of fields) {
            await expect(banner).toContainText(field);
        }
    }

    /** Read the system clipboard (requires clipboard-read permission, granted in config). */
    async readClipboard() {
        return this.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    }

    /**
     * Poll the clipboard until it contains `substring` (the async write resolves
     * just before the success toast), then return the final clipboard text.
     * @param {string} substring
     * @param {number} [timeout]
     */
    async waitForClipboardContaining(substring, timeout = 10000) {
        await expect
            .poll(
                () => this.page.evaluate(() => navigator.clipboard.readText().catch(() => '')),
                { timeout },
            )
            .toContain(substring);
        return this.readClipboard();
    }
}
