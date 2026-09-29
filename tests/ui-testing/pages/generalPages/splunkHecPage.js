import { expect } from '@playwright/test';

// Splunk HEC is a static documentation page: no data dependency, no forms. Every
// section/banner is rendered unconditionally and carries a data-test attribute
// (verified in web/src/components/ingestion/logs/SplunkHec.vue).
export class SplunkHecPage {
    constructor(page) {
        this.page = page;

        // Page-loaded marker + the three warning banners (OBanner warning -> role=alert).
        this.intro = page.locator('[data-test="ingestion-logs-splunkhec-intro"]');
        this.windowNote = page.locator('[data-test="ingestion-logs-splunkhec-window-note"]');
        this.edgeProcessorNote = page.locator('[data-test="ingestion-logs-splunkhec-edge-processor-note"]');
        this.tlsNote = page.locator('[data-test="ingestion-logs-splunkhec-tls-note"]');
        this.tokensLink = page.locator('[data-test="ingestion-logs-splunkhec-tokens-link"]');

        // Copyable snippet text (CopyContent exposes rum-content-text) and its buttons.
        this.endpointContent = page.locator('[data-test="ingestion-logs-splunkhec-endpoint"] [data-test="rum-content-text"]');
        this.payloadContent = page.locator('[data-test="ingestion-logs-splunkhec-payload"] [data-test="rum-content-text"]');
        this.curlContent = page.locator('[data-test="ingestion-logs-splunkhec-example"] [data-test="rum-content-text"]');
        this.copyButtons = page.locator('[data-test="rum-copy-btn"]');

        // Copy feedback toast (global success notification), kept local so this
        // spec does not depend on another page object's toast helper.
        this.successToast = page.locator('[data-test-variant="success"]');
        this.successToastMessage = page.locator('[data-test-variant="success"] [data-test="o-toast-message"]');
    }

    // ==================== Navigation ====================

    async navigateToSplunkHec(orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web/ingestion/custom/logs/splunkhec?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        // The intro paragraph is the page-loaded marker (no async data on this page).
        await expect(this.intro).toBeVisible({ timeout: 10000 });
    }

    async getOrigin() {
        return await this.page.evaluate(() => window.location.origin);
    }

    // ==================== Window Warning Banner ====================

    async expectWindowNoteVisible() {
        await expect(this.windowNote).toBeVisible({ timeout: 10000 });
    }

    async getWindowNoteRole() {
        return await this.windowNote.getAttribute('role');
    }

    async getWindowNoteText() {
        return (await this.windowNote.textContent()) ?? '';
    }

    // ==================== Other Warning Banners ====================

    async expectAllBannersVisible() {
        await expect(this.windowNote).toBeVisible({ timeout: 10000 });
        await expect(this.edgeProcessorNote).toBeVisible({ timeout: 10000 });
        await expect(this.tlsNote).toBeVisible({ timeout: 10000 });
    }

    async getEdgeProcessorNoteText() {
        return (await this.edgeProcessorNote.textContent()) ?? '';
    }

    async getTlsNoteText() {
        return (await this.tlsNote.textContent()) ?? '';
    }

    // ==================== Copyable Snippet Content ====================

    async getEndpointContent() {
        return ((await this.endpointContent.textContent()) ?? '').trim();
    }

    async getPayloadContent() {
        return ((await this.payloadContent.textContent()) ?? '').trim();
    }

    async getCurlContent() {
        return ((await this.curlContent.textContent()) ?? '').trim();
    }

    async getPayloadJson() {
        return JSON.parse(await this.getPayloadContent());
    }

    async getCurlDataJson() {
        const curl = await this.getCurlContent();
        const match = curl.match(/-d '([^']*)'/);
        expect(match, 'curl example carries a -d JSON payload').toBeTruthy();
        return JSON.parse(match[1]);
    }

    // ==================== Copy Buttons ====================

    async getCopyButtonCount() {
        return await this.copyButtons.count();
    }

    async clickCopyButton(index) {
        await this.copyButtons.nth(index).click();
    }

    async expectCopyToast(expectedText = 'Copied Successfully', timeout = 5000) {
        await expect(this.successToast.first()).toBeVisible({ timeout });
        const text = await this.successToastMessage.first().textContent();
        expect(text).toContain(expectedText);
    }

    async waitForCopyToastToHide(timeout = 7000) {
        await expect(this.successToast.first()).toBeHidden({ timeout });
    }

    // ==================== Tokens Link ====================

    async clickTokensLink() {
        await this.tokensLink.click();
    }

    async expectIngestionTokensUrl(orgId) {
        await expect(this.page).toHaveURL(/ingestionTokens/, { timeout: 10000 });
        const url = this.page.url();
        expect(url).toContain(`org_identifier=${orgId}`);
    }
}
