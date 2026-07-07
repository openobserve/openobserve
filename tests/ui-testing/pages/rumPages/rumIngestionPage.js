// rumIngestionPage.js — Ingestion → Frontend Monitoring onboarding page
// (RUM token reset control + copy-ready instrumentation snippets)
import { expect } from '@playwright/test';

export class RumIngestionPage {
    constructor(page) {
        this.page = page;

        // Locators — the page now renders the shared rich setup card
        // (SetupCardRenderer), so RUM-specific selectors were replaced by the
        // card's data-test attributes. The card only mounts once a RUM token
        // exists (v-if="rumToken"), so its presence == page loaded.
        // FrontendRumConfig passes data-test="rum-web-setup-card" to the
        // renderer; Vue attribute fallthrough puts it on the card's root div
        // (it overrides the renderer's own "ai-rich-setup-card"), so that is
        // the selector that actually lands in the DOM.
        this.titleText = page.locator('[data-test="rum-web-setup-card"]');
        this.resetTokenButton = page.locator('[data-test="ingestion-reset-token-btn"]');
        // Code blocks: first = npm install command, second = SDK init config.
        this.contentBlocks = page.locator('[data-test="ai-code"]');
        this.copyButtons = page.locator('[data-test="ai-code-copy-btn"]');
    }

    async gotoFrontendMonitoring() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(
            `${base}/web/ingestion/recommended/frontend-monitoring?org_identifier=${org}`,
        );
    }

    async expectPageLoaded(timeoutMs = 15000) {
        await expect(this.titleText).toBeVisible({ timeout: timeoutMs });
    }

    async expectResetTokenButtonVisible(timeoutMs = 15000) {
        await expect(this.resetTokenButton).toBeVisible({ timeout: timeoutMs });
    }

    /** The first CopyContent block holds the npm install command. */
    async expectNpmSnippetContains(text) {
        await expect(this.contentBlocks.first()).toContainText(text);
    }

    /** The init-config block is the second CopyContent (after the npm command). */
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
