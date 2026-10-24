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

        this.toolbar = page.locator('[data-test="rum-performance-toolbar"]');
        this.tabsDropdownBtn = page.locator('[data-test="rum-performance-tabs-dropdown-btn"]');
        this.shareLinkBtn = page.locator('[data-test="rum-performance-share-link-btn"]');
        this.shareLinkToast = page.locator(
            '[data-test-variant="success"][data-test-message*="Link Copied"]',
        );
        this.refreshOptionsBtn = page.locator('[data-test="rum-performance-refresh-options-btn"]');
        this.autoRunToggleBtn = page.locator('[data-test="rum-performance-auto-run-toggle-btn"]');

        this.overviewSchemaLoading = page.locator(
            '[data-test="performance-summary-schema-loading"]',
        );
        this.overviewEmpty = page.locator('[data-test="performance-summary-empty"]');
        this.dashboardPanels = page.locator('[data-test="dashboard-panel-container"]');
        this.errorsDashboard = page.locator('[data-test="performance-error-dashboard"]');
        this.errorsSchemaLoading = page.locator('[data-test="errors-dashboard-schema-loading"]');
        this.errorsEmpty = page.locator('[data-test="errors-dashboard-empty"]');
        this.apiDashboard = page.locator('[data-test="api-performance-dashboards"]');
        this.apiSchemaLoading = page.locator('[data-test="api-dashboard-schema-loading"]');
        this.apiEmpty = page.locator('[data-test="api-dashboard-empty"]');
        this.webVitalsSchemaLoading = page.locator(
            '[data-test="web-vitals-dashboard-schema-loading"]',
        );
        this.webVitalsEmpty = page.locator(
            '[data-test="web-vitals-dashboard-browser-only-empty"]',
        );
        this.learnWebVitalsLink = page.locator('[data-test="learn-web-vitals-link"]');
    }

    async gotoPerformance() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/performance?org_identifier=${org}`);
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
    }

    async gotoPerformancePath(path) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/performance/${path}?org_identifier=${org}`);
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
    }

    async clickRefresh() {
        await this.refreshButton.click();
    }

    async clickRefreshAndExpectSearch(timeoutMs = 15000) {
        const isSearch = (req) => req.method() === 'POST' && /\/api\/[^/]+\/_search/.test(req.url());
        let seen = 0;
        const countSearch = (req) => {
            if (isSearch(req)) seen += 1;
        };
        this.page.on('request', countSearch);
        // Panels lazy-load their queries, so wait for 2s with no new search before attributing one to the click.
        let previous = -1;
        await expect
            .poll(
                () => {
                    const quiet = seen === previous;
                    previous = seen;
                    return quiet;
                },
                { intervals: [2000], timeout: 30000 },
            )
            .toBe(true);
        this.page.off('request', countSearch);
        const search = this.page.waitForRequest(isSearch, { timeout: timeoutMs });
        await this.refreshButton.click();
        await search;
    }

    /** The loading indicator must resolve (not hang) after refresh. */
    async expectSummaryLoadingResolved(timeoutMs = 30000) {
        await expect(this.summaryLoadingIndicator).toBeHidden({ timeout: timeoutMs });
    }

    tabLocator(value) {
        return this.page.locator(`[data-test="rum-performance-tab-${value}"]`);
    }

    async clickTab(value) {
        await this.tabLocator(value).click();
    }

    async expectActiveTab(value, timeoutMs = 10000) {
        await expect(this.tabLocator(value)).toHaveAttribute('data-state', 'on', {
            timeout: timeoutMs,
        });
    }

    async expectInactiveTab(value, timeoutMs = 10000) {
        await expect(this.tabLocator(value)).toHaveAttribute('data-state', 'off', {
            timeout: timeoutMs,
        });
    }

    async expectToolbarVisible(timeoutMs = 15000) {
        await expect(this.toolbar).toBeVisible({ timeout: timeoutMs });
    }

    async expectTabVisible(value, timeoutMs = 15000) {
        await expect(this.tabLocator(value)).toBeVisible({ timeout: timeoutMs });
    }

    async expectOverviewResolved(timeoutMs = 30000) {
        await expect(this.overviewSchemaLoading).toBeHidden({ timeout: timeoutMs });
        await expect(this.overviewEmpty.or(this.dashboardPanels).first()).toBeVisible({
            timeout: timeoutMs,
        });
    }

    async expectErrorsDashboardMounted(timeoutMs = 30000) {
        await expect(this.errorsDashboard).toBeVisible({ timeout: timeoutMs });
        await expect(this.errorsSchemaLoading).toBeHidden({ timeout: timeoutMs });
        await expect(
            this.errorsEmpty.or(this.errorsDashboard.locator(this.dashboardPanels)).first(),
        ).toBeVisible({ timeout: timeoutMs });
    }

    async expectApiDashboardMounted(timeoutMs = 30000) {
        await expect(this.apiDashboard).toBeVisible({ timeout: timeoutMs });
        await expect(this.apiSchemaLoading).toBeHidden({ timeout: timeoutMs });
        await expect(
            this.apiEmpty.or(this.apiDashboard.locator(this.dashboardPanels)).first(),
        ).toBeVisible({ timeout: timeoutMs });
    }

    async expectWebVitalsMounted(timeoutMs = 30000) {
        await expect(this.webVitalsSchemaLoading).toBeHidden({ timeout: timeoutMs });
        await expect(this.webVitalsEmpty.or(this.learnWebVitalsLink).first()).toBeVisible({
            timeout: timeoutMs,
        });
    }

    async expectTabsDropdownBtnVisible(timeoutMs = 15000) {
        await expect(this.tabsDropdownBtn).toBeVisible({ timeout: timeoutMs });
    }

    async clickMobileTab(value) {
        await this.tabsDropdownBtn.click();
        await this.page.locator(`[data-test="rum-performance-tab-${value}-item"]`).click();
    }

    async expectShareLinkBtnVisible(timeoutMs = 15000) {
        await expect(this.shareLinkBtn).toBeVisible({ timeout: timeoutMs });
    }

    async getConfiguredWebUrl() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        return await this.page.evaluate(async (url) => {
            const res = await fetch(url, { credentials: 'include' });
            return (await res.json()).web_url || '';
        }, `${base}/api/${org}/config`);
    }

    async expectShareLinkBtnEnabled(timeoutMs = 15000) {
        await expect(this.shareLinkBtn).toBeEnabled({ timeout: timeoutMs });
    }

    async clickShareLink() {
        await this.shareLinkBtn.click();
    }

    async expectLinkCopiedToast(timeoutMs = 15000) {
        await expect(this.shareLinkToast).toBeVisible({ timeout: timeoutMs });
    }

    /** Returns the original URL behind the copied short link, via the lookup the /web/short route uses. */
    async resolveCopiedShortUrl(timeoutMs = 15000) {
        let copied = '';
        await expect
            .poll(
                async () => {
                    copied = await this.page
                        .evaluate(() => navigator.clipboard.readText())
                        .catch(() => '');
                    return copied;
                },
                { timeout: timeoutMs },
            )
            .toMatch(/\/short\/[^/?#]+/);
        const id = copied.match(/\/short\/([^/?#]+)/)[1];
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        return await this.page.evaluate(async (url) => {
            const res = await fetch(url, { credentials: 'include' });
            return await res.json();
        }, `${base}/api/${org}/short/${id}?type=ui`);
    }

    async openRefreshOptions() {
        await this.refreshOptionsBtn.click();
    }

    async clickAutoRunToggle() {
        await this.autoRunToggleBtn.click();
    }

    async getAutoRunStorageValue() {
        return this.page.evaluate(() => localStorage.getItem('oo_toggle_auto_run'));
    }

    async expectAutoRunStorageChanged(from, timeoutMs = 10000) {
        await expect
            .poll(() => this.page.evaluate(() => localStorage.getItem('oo_toggle_auto_run')), {
                timeout: timeoutMs,
            })
            .not.toBe(from);
    }
}
