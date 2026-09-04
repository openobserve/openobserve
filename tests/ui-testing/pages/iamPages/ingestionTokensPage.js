// ingestionTokensPage.js — Page object for IAM > Ingestion Tokens page.
// PR #11691: Org-level ingestion tokens (prefix o2oi_).
import { expect } from '@playwright/test';

export class IngestionTokensPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // IAM navigation
        // ============================================================
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');
        this.ingestionTokensTab = page.locator('[data-test="iam-ingestion-tokens-tab"]');

        // ============================================================
        // Token list page
        // ============================================================
        this.titleHeading = page.locator('[data-test="ingestion-tokens-title-text"]');
        this.createTokenButton = page.locator('[data-test="add-ingestion-token"]');
        this.searchInput = page.locator('[data-test="ingestion-tokens-search-input-field"]');

        // ============================================================
        // Create Token dialog (ODialog — no custom data-test, uses ODialog built-ins)
        // ============================================================
        this.dialogPrimaryBtn = page.locator('[data-test="o-dialog-primary-btn"]');
        this.dialogSecondaryBtn = page.locator('[data-test="o-dialog-secondary-btn"]');
        this.dialogCloseBtn = page.locator('[data-test="o-dialog-close-btn"]');
        this.nameInputError = page.locator('[data-test="ingestion-token-name-input-error"]');

        // "Manage Tokens" entry point (rendered on the Ingestion page)
        this.manageTokensButton = page.getByRole('button', { name: /Manage Tokens/i });

        // ============================================================
        // Toast notifications (OToast)
        // ============================================================
        this.toastMessages = page.locator('[data-test="o-toast-message"]');

        // ============================================================
        // Per-row runtime factories — resolved by token name.
        // ============================================================
        this.tokenToggleByName = (name) =>
            page.locator(`[data-test="ingestion-token-${name}-toggle"]`);
        this.tokenCellByName = (name) =>
            page.locator(`[data-test="o2-table-row-${name}"]`);

        // ============================================================
        // Table
        // ============================================================
        this.tokenTable = page.locator('table');
        this.tokenTableRows = page.locator('table tbody tr');

        // ============================================================
        // Revealed token dialog
        // ============================================================
        // The <code> block now shows the ready-to-use "Basic base64(name:token)"
        // credential (not the raw token).
        this.revealedTokenCode = page.locator('[role="dialog"] code');
    }

    // ----- navigation -----

    async gotoIamPage() {
        await this.iamPageMenu.click();
    }

    async gotoIngestionTokensTab() {
        await this.ingestionTokensTab.click();
        await this.titleHeading.waitFor({ state: 'visible', timeout: 10000 });
    }

    async clickManageTokens() {
        await this.manageTokensButton.click();
    }

    // ----- create token -----

    async clickCreateToken() {
        await this.createTokenButton.click();
    }

    async fillTokenName(name) {
        // Migration: the label now uses the `required` prop (the `*` is
        // aria-hidden), so the input's accessible name is "Name" not "Name *".
        // Target it by data-test instead of role-name.
        await this.page.locator('[data-test="ingestion-token-name-input"] input').fill(name);
    }

    async fillTokenDescription(desc) {
        await this.page.locator('[data-test="ingestion-token-description-input"] input').fill(desc);
    }

    async clickCreate() {
        await this.dialogPrimaryBtn.click();
    }

    async clickCancel() {
        await this.dialogSecondaryBtn.click();
    }

    // ----- revealed token dialog -----

    async closeRevealedDialog() {
        // Click the "Close" button in the currently open dialog.
        // ODialog renders a secondary button labelled "Close" via :secondary-button-label.
        // Scope by the visible dialog heading to avoid stale dialogs.
        const dialog = this.page.locator('[role="dialog"]').last();
        await dialog.locator('button[data-test="o-dialog-secondary-btn"]').click();
        await this.page.waitForTimeout(500);
    }

    // Copies the ready-to-use "Basic base64(name:token)" credential (primary btn).
    async clickCopyToken() {
        await this.page
            .getByRole('button', { name: 'Copy Authorization header' })
            .click();
    }

    // Copies the raw o2oi_ token (secondary btn).
    async clickCopyRawToken() {
        await this.page.getByRole('button', { name: 'Copy raw token' }).click();
    }

    // ----- toggle -----

    async toggleToken(name) {
        const toggle = this.tokenToggleByName(name);
        // Token list loads async after reload and is client-paginated (20/page); re-apply the name filter until the row surfaces so a slow list load or search re-mount can't leave the toggle off-page.
        await expect.poll(async () => {
            await this.searchInput.fill(name);
            return await toggle.isVisible().catch(() => false);
        }, { timeout: 20000, intervals: [500, 1000, 1500, 2000, 3000] }).toBe(true);
        await toggle.click();
    }

    // ----- assertions -----

    async verifySuccessMessage(expectedMessage) {
        await expect
            .poll(async () => {
                const texts = await this.toastMessages.allTextContents();
                return texts.some((text) => text.includes(expectedMessage));
            }, { timeout: 15000 })
            .toBe(true);
    }

    async verifyTokenExists(name) {
        await expect(this.tokenToggleByName(name)).toBeVisible({ timeout: 10000 });
    }

    async verifyTokenNotExists(name) {
        await expect(this.tokenToggleByName(name)).not.toBeVisible({ timeout: 5000 });
    }

    async verifyTitleVisible() {
        await expect(this.titleHeading).toBeVisible({ timeout: 10000 });
    }
}
