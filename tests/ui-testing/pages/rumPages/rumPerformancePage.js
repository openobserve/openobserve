// rumPerformancePage.js — RUM Performance summary page
import { expect } from '@playwright/test';

export class RumPerformancePage {
    constructor(page) {
        this.page = page;

        // Locators
        this.refreshButton = page.locator('[data-test="rum-performance-refresh"]');
        this.summaryLoadingIndicator = page.locator(
            '[data-test="performance-summary-loading-indicator"]',
        );
    }

    async gotoPerformance() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/performance?org_identifier=${org}`);
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
    }

    async clickRefresh() {
        await this.refreshButton.click();
    }

    /** The loading indicator must resolve (not hang) after refresh. */
    async expectSummaryLoadingResolved(timeoutMs = 30000) {
        await expect(this.summaryLoadingIndicator).toBeHidden({ timeout: timeoutMs });
    }
}
