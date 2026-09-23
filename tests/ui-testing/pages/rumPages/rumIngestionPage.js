// rumIngestionPage.js — Ingestion → Frontend Monitoring onboarding page (RUM token reset control + copy-ready snippets).
import { expect } from '@playwright/test';

export class RumIngestionPage {
    constructor(page) {
        this.page = page;

        // FrontendRumConfig passes data-test="rum-web-setup-card" to the card, and Vue attribute fallthrough lands it on the root div; the card mounts only when a RUM token exists (v-if="rumToken"), so its presence == page loaded.
        this.titleText = page.locator('[data-test="rum-web-setup-card"]');
        this.resetTokenButton = page.locator('[data-test="ingestion-reset-token-btn"]');
        // Code blocks: first = npm install command, second = SDK init config.
        this.contentBlocks = page.locator('[data-test="ai-code"]');
        this.copyButtons = page.locator('[data-test="ai-code-copy-btn"]');
        // Variant toggles — install + init share the "pkg" group, so either step's toggle switches both; `.first()` disambiguates the 2 matches.
        this.variantCdnButton = page.locator('[data-test="ai-variant-cdn"]').first();
        this.variantNpmButton = page.locator('[data-test="ai-variant-npm"]').first();
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

    async switchToCdnVariant() {
        await expect(this.variantCdnButton).toBeVisible();
        await this.variantCdnButton.click();
        // Guard: the shared "pkg" group flips both steps together, so wait for the CDN loader to land before trusting a downstream assertion.
        await expect(this.contentBlocks.first()).toContainText('O2_RUM');
    }

    async switchToNpmVariant() {
        await expect(this.variantNpmButton).toBeVisible();
        await this.variantNpmButton.click();
        // Guard: confirm the default NPM install command is restored.
        await expect(this.contentBlocks.first()).toContainText('npm i @openobserve/browser-rum');
    }

    /** The first CopyContent block (install step) holds the install snippet. */
    async expectInstallSnippetContains(text) {
        await expect(this.contentBlocks.first()).toContainText(text);
    }

    /** Negative regression guard: the whole card must not contain `text`. */
    async expectCardDoesNotContain(text) {
        await expect(this.titleText).not.toContainText(text);
    }
}
