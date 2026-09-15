// splunkHecPage.js — Page object for the Ingestion > Logs > Splunk HEC documentation page.
// The page is fully static (no fetch, no mutation): six sections + two warning banners.
import { expect } from '@playwright/test';

export class SplunkHecPage {
    constructor(page) {
        this.page = page;

        this.intro = page.locator('[data-test="ingestion-logs-splunkhec-intro"]');
        this.endpointSection = page.locator('[data-test="ingestion-logs-splunkhec-endpoint"]');
        this.authSection = page.locator('[data-test="ingestion-logs-splunkhec-auth"]');
        this.tokensLink = page.locator('[data-test="ingestion-logs-splunkhec-tokens-link"]');
        this.exampleSection = page.locator('[data-test="ingestion-logs-splunkhec-example"]');
        this.payloadSection = page.locator('[data-test="ingestion-logs-splunkhec-payload"]');
        this.healthSection = page.locator('[data-test="ingestion-logs-splunkhec-health"]');
        this.edgeProcessorBanner = page.locator('[data-test="ingestion-logs-splunkhec-edge-processor-note"]');
        this.tlsBanner = page.locator('[data-test="ingestion-logs-splunkhec-tls-note"]');

        this.toastMessages = page.locator('[data-test="o-toast-message"]');
    }

    // ----- navigation -----

    async gotoSplunkHec(orgId) {
        await this.page.goto(
            `${process.env.ZO_BASE_URL}/web/ingestion/custom/logs/splunkhec?org_identifier=${orgId}`,
        );
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await this.intro.waitFor({ state: 'visible', timeout: 10000 });
    }

    // ----- documentation assertions -----

    async verifyDocumentationRendered() {
        await expect(this.intro).toBeVisible();
        await expect(this.endpointSection).toBeVisible();
        await expect(this.authSection).toBeVisible();
        await expect(this.exampleSection).toBeVisible();
        await expect(this.payloadSection).toBeVisible();
        await expect(this.healthSection).toBeVisible();
        await expect(this.edgeProcessorBanner).toBeVisible();
        await expect(this.tlsBanner).toBeVisible();
    }

    // ----- copy blocks (CopyContent reuses the shared rum-* data-test attrs) -----

    async getSectionCopyText(sectionLocator) {
        return await sectionLocator.locator('[data-test="rum-content-text"]').textContent();
    }

    async clickSectionCopyButton(sectionLocator) {
        await sectionLocator.locator('[data-test="rum-copy-btn"]').click();
    }

    async expectCopyToast() {
        await expect
            .poll(async () => {
                const texts = await this.toastMessages.allTextContents();
                return texts.some((text) => /copied/i.test(text));
            }, { timeout: 10000 })
            .toBe(true);
    }

    // ----- navigation link -----

    async clickTokensLink() {
        await this.tokensLink.click();
    }
}
