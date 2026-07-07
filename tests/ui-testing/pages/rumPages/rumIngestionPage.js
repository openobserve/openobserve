// rumIngestionPage.js — Ingestion → Frontend Monitoring onboarding page
// (RUM token reset control + copy-ready instrumentation snippets)
import { expect } from '@playwright/test';

export class RumIngestionPage {
    constructor(page) {
        this.page = page;

        // Locators
        this.titleText = page.locator('[data-test="rumweb-title-text"]');
        this.resetTokenButton = page.locator('[data-test="ingestion-reset-token-btn"]');
        // CopyContent blocks: first = npm install command, second = SDK init config.
        this.contentBlocks = page.locator('[data-test="rum-content-text"]');
        this.copyButtons = page.locator('[data-test="rum-copy-btn"]');
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
