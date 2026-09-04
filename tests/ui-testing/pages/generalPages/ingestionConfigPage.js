import { expect } from '@playwright/test';

export class IngestionConfigPage {
    constructor(page) {
        this.page = page;

        // Global ingestion search (moved from Recommended page to Ingestion parent — Ingestion.vue carries this attr)
        this.globalSearchInputSelector = '[data-test="recommended-list-search-input"]';
        this.globalSearchInput = page.locator(this.globalSearchInputSelector);
        // The OInput wrapper renders an inner native input with the -field suffix
        this.globalSearchInputField = page.locator('[data-test="recommended-list-search-input-field"]');

        // Recommended page tabs container
        this.recommendedTabsContainerSelector = '[data-test="data-sources-recommended-tabs"]';
        this.recommendedTabsContainer = page.locator(this.recommendedTabsContainerSelector);

        // Configuration content selectors. Legacy integrations render CopyContent
        // (rum-* selectors); migrated data sources (e.g. Postgres, SQL Server)
        // render the rich DataSourceSetupCard with OCodeBlock copy buttons. A page
        // only ever renders one of the two, so the combined selectors are safe.
        this.copyButton = page
          .locator('[data-test="rum-copy-btn"], [data-test="ai-code-copy-btn"]')
          .first();
        this.contentText = page
          .locator('[data-test="rum-content-text"], [data-test="data-source-setup-card"]')
          .first();

        // Notification selector — OToast variant=success carries the data-test we target.
        // 'o-toast-success' fires for both the Fluentd and Prometheus copy paths.
        this.successToast = page.locator('[data-test-variant="success"]');
        this.successToastMessage = page.locator('[data-test-variant="success"] [data-test="o-toast-message"]');

        // Top-level Custom-page tabs (Logs / Metrics / Traces)
        this.customMetricsTab = page.locator('[data-test="ingestion-custom-tab-ingestMetrics"]');
        this.customLogsTab = page.locator('[data-test="ingestion-custom-tab-ingestLogs"]');

        // Inner tabs used as page-loaded markers
        this.logsCurlTab = page.locator('[data-test="ingestion-logs-tab-curl"]');
        this.logsFluentdTab = page.locator('[data-test="ingestion-logs-tab-fluentd"]');
        this.metricsPrometheusTab = page.locator('[data-test="ingestion-metrics-tab-prometheus"]');

        // Recommended Kubernetes tab marker (default tab on Recommended page)
        this.recommendedKubernetesTab = page.locator('[data-test="ingestion-recommended-tab-ingestFromKubernetes"]');

        // Count of integration route tabs in Recommended view (scoped to its container)
        this.recommendedRouteTabs = page.locator('[data-test="data-sources-recommended-tabs"] [data-test^="ingestion-recommended-tab-"]');
    }

    // ==================== Navigation ====================

    async navigateToRecommended(orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web/ingestion/recommended?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    async navigateToCustom(orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web/ingestion/custom?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        // Wait for Curl tab to be visible (custom page auto-loads logs/curl)
        await this.logsCurlTab.waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToIntegration(integrationPath, orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web${integrationPath}?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    // ==================== Tab Interactions ====================

    async clickMetricsTab() {
        await expect(this.customMetricsTab).toBeVisible({ timeout: 10000 });
        await this.customMetricsTab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        // Wait for Prometheus tab to be visible (first metrics integration)
        await this.metricsPrometheusTab.waitFor({ state: 'visible', timeout: 5000 });
    }

    // ==================== Copy Functionality ====================

    async clickCopyButton() {
        await this.copyButton.click();
    }

    async getContentText() {
        return await this.contentText.textContent();
    }

    async verifyCopyButtonVisible(timeout = 10000) {
        await expect(this.copyButton).toBeVisible({ timeout });
    }

    async verifyContentVisible() {
        await expect(this.contentText).toBeVisible();
    }

    async verifyNotificationVisible(expectedText = null, timeout = 5000) {
        await expect(this.successToast.first()).toBeVisible({ timeout });

        if (expectedText) {
            const text = await this.successToastMessage.first().textContent();
            expect(text).toContain(expectedText);
        }
    }

    // ==================== Search Functionality ====================

    async getSearchInput() {
        return this.globalSearchInput;
    }

    async verifySearchInputVisible() {
        await expect(this.globalSearchInput).toBeVisible();
    }

    async fillSearchInput(searchText) {
        await this.globalSearchInputField.fill(searchText);
        // Wait for search/navigation to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async clearSearchInput() {
        await this.globalSearchInputField.clear();
        // Wait for search reset/navigation to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async waitForRecommendedTabs() {
        // Wait for the first integration tab (Kubernetes) to be visible
        // This ensures the redirect and tab rendering is complete
        await this.recommendedKubernetesTab.waitFor({ state: 'visible', timeout: 10000 });
    }

    async getRouteTabCount() {
        // Ensure tabs are rendered before counting
        await this.waitForRecommendedTabs();
        // Count only the integration tabs within the data-sources-recommended-tabs container
        return await this.recommendedRouteTabs.count();
    }

    // ==================== Assertions ====================

    async expectRecommendedPageLoaded() {
        // Recommended page loads with the sidebar tabs container and Kubernetes as the default tab
        await expect(this.recommendedTabsContainer).toBeVisible({ timeout: 10000 });
        await this.recommendedKubernetesTab.waitFor({ state: 'visible', timeout: 10000 });
    }

    async expectLogsPageLoaded() {
        await expect(this.logsFluentdTab).toBeVisible({ timeout: 10000 });
        await expect(this.logsCurlTab).toBeVisible({ timeout: 5000 });
    }

    async expectMetricsPageLoaded() {
        await expect(this.metricsPrometheusTab).toBeVisible({ timeout: 10000 });
    }

    async expectContentLength(minLength) {
        const content = await this.getContentText();
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(minLength);
    }

    async expectContentContainsOrgId(orgId) {
        const content = await this.getContentText();
        return content.includes('default') || content.includes(orgId);
    }

    // ==================== Scrolling and Content Display ====================

    async scrollContentToBottom() {
        await this.contentText.evaluate(el => el.scrollTop = el.scrollHeight);
    }

    async getContentScrollHeight() {
        return await this.contentText.evaluate(el => el.scrollHeight);
    }

    async getContentClientHeight() {
        return await this.contentText.evaluate(el => el.clientHeight);
    }

    async isContentScrollable() {
        const scrollHeight = await this.getContentScrollHeight();
        const clientHeight = await this.getContentClientHeight();
        return scrollHeight > clientHeight;
    }

    // ==================== Link Verification ====================

    /**
     * Returns hrefs from all external documentation links via in-page evaluate.
     * Using evaluate(...) is the approved pattern for scraping content the spec needs
     * without exposing element-only Playwright locators ($('a[target="_blank"]')).
     */
    async getDocumentationLinkHrefs() {
        return await this.page.evaluate(() => {
            const anchors = document.querySelectorAll('a[target="_blank"]');
            return Array.from(anchors)
                .map(a => a.getAttribute('href'))
                .filter(h => !!h);
        });
    }

    async getDocumentationLinkCount() {
        const hrefs = await this.getDocumentationLinkHrefs();
        return hrefs.length;
    }

    async verifyDocumentationLinksExist() {
        const linkCount = await this.getDocumentationLinkCount();
        expect(linkCount).toBeGreaterThan(0);
        return linkCount;
    }

    async verifyDocumentationLinkHref(index = 0) {
        const hrefs = await this.getDocumentationLinkHrefs();
        if (hrefs.length > index) {
            const href = hrefs[index];
            expect(href).toBeTruthy();
            expect(href).toMatch(/^https?:\/\//); // Verify it's a valid URL
            return href;
        }
        return null;
    }

    async verifyDocumentationLinkAccessible(index = 0) {
        const hrefs = await this.getDocumentationLinkHrefs();
        if (hrefs.length > index) {
            const href = hrefs[index];

            // Make HEAD request to check if link is accessible (5s timeout)
            const response = await this.page.request.head(href, { timeout: 5000 });
            const status = response.status();

            return {
                url: href,
                status: status,
                ok: response.ok()
            };
        }
        return null;
    }

    async getAllDocumentationLinksStatus(skipUrls = []) {
        const hrefs = await this.getDocumentationLinkHrefs();
        const results = [];

        for (let i = 0; i < hrefs.length; i++) {
            const href = hrefs[i];

            // Skip URLs that are known to work but cause timeouts
            if (skipUrls.some(skipUrl => href.includes(skipUrl))) {
                results.push({
                    index: i,
                    url: href,
                    status: 'SKIPPED',
                    ok: true,
                    skipped: true
                });
                continue;
            }

            try {
                // 5 second timeout to prevent hanging
                const response = await this.page.request.head(href, { timeout: 5000 });
                results.push({
                    index: i,
                    url: href,
                    status: response.status(),
                    ok: response.ok()
                });
            } catch (error) {
                results.push({
                    index: i,
                    url: href,
                    status: 'ERROR',
                    ok: false,
                    error: error.message
                });
            }
        }

        return results;
    }
}
