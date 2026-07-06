// rumIngestionPage.js — Ingestion → Frontend Monitoring onboarding page
// (RUM token reset control + copy-ready instrumentation snippets)
import { expect } from '@playwright/test';

export class RumIngestionPage {
    constructor(page) {
        this.page = page;

        // The Frontend Monitoring onboarding UI was refactored on main into the
        // shared SetupCardRenderer (data-test="ai-*"), replacing the bespoke
        // CopyContent markup (data-test="rum-*-text"/"rum-copy-btn"). These
        // selectors UNION both so the specs pass against binaries built before
        // AND after that refactor.

        // "Page loaded" anchor: the RUM setup card container.
        this.setupCard = page.locator(
            '[data-test="rum-web-setup-card"], [data-test="ai-rich-setup-card"], [data-test="rumweb-title-text"]',
        );
        this.resetTokenButton = page.locator('[data-test="ingestion-reset-token-btn"]');
        // Code/snippet blocks, in DOM order: [0] = install (npm command),
        // [1] = init (SDK config). New UI: one OCodeBlock per step (install,
        // init). Old UI: CopyContent blocks.
        this.contentBlocks = page.locator('[data-test="ai-code"], [data-test="rum-content-text"]');
        // Copy button: OCodeBlock renders `${dataTest}-copy-btn` (ai-code ->
        // ai-code-copy-btn); old UI used rum-copy-btn.
        this.copyButtons = page.locator('[data-test="ai-code-copy-btn"], [data-test="rum-copy-btn"]');
        // NPM/CDN variant toggle (new UI only). NPM is the default variant.
        this.npmVariantTab = page.locator('[data-test="ai-variant-npm"]');
    }

    async gotoFrontendMonitoring() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        // Wait for DOM parse only — the SPA holds streaming/XHR connections open
        // so the full `load` event is unreliable; expectPageLoaded() (element
        // visibility) is the real readiness signal.
        await this.page.goto(
            `${base}/web/ingestion/recommended/frontend-monitoring?org_identifier=${org}`,
            { waitUntil: 'domcontentloaded' },
        );
    }

    async expectPageLoaded(timeoutMs = 15000) {
        await expect(this.setupCard.first()).toBeVisible({ timeout: timeoutMs });
    }

    async expectResetTokenButtonVisible(timeoutMs = 15000) {
        await expect(this.resetTokenButton).toBeVisible({ timeout: timeoutMs });
    }

    /**
     * Ensure the NPM install/init variant is selected (new SetupCardRenderer
     * UI). Best-effort no-op on the old UI, which has no variant tabs and
     * shows the NPM snippets directly.
     */
    async ensureNpmVariant() {
        if (await this.npmVariantTab.count()) {
            await this.npmVariantTab.first().click().catch(() => {});
        }
    }

    /** The first code block holds the npm install command. */
    async expectNpmSnippetContains(text) {
        await expect(this.contentBlocks.first()).toContainText(text);
    }

    /** The init-config block is the second code block (after the npm command). */
    async expectInitSnippetContains(text) {
        await expect(this.contentBlocks.nth(1)).toContainText(text);
    }

    async getCopyButtonCount() {
        return this.copyButtons.count();
    }

    async expectCopyControlsPresent(minCount = 2) {
        expect(await this.copyButtons.count()).toBeGreaterThanOrEqual(minCount);
        await expect(this.copyButtons.nth(minCount - 1)).toBeVisible();
    }
}
