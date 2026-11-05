import { expect } from '@playwright/test';

export class EmptyPagesPage {
    constructor(page) {
        this.page = page;
        this.panel = page.locator('[data-test="first-data-panel"]');
        this.codeBlock = page.locator('[data-test="first-data-panel-code-block"]');
        this.openGuideBtn = page.locator('[data-test="first-data-panel-open-guide-btn"]');
        this.changeSourceLink = page.locator('[data-test="first-data-panel-change-source-link"]');
        this.copyBtn = page.locator('[data-test="first-data-panel-copy-btn"]');
        this.arrived = page.locator('[data-test="first-data-panel-arrived"]');
        this.status = page.locator('[data-test="first-event-status"]');
        this.logsNoData = page.locator('[data-test="logs-search-no-streams-in-org-text"]');
        this.logsCurlCard = page.locator('[data-test="logs-no-data-curl-card"]');
        this.logsResultRows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]');
        this.redirectionBanner = page.getByText('data ingestion must be initiated within the current organization');
        this.visitedUrls = [];
        this.loads = 0;
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) this.visitedUrls.push(frame.url());
        });
        page.on('load', () => {
            this.loads += 1;
        });
    }

    base() {
        return process.env.ZO_BASE_URL.replace(/\/$/, '');
    }

    /** Stores the Get started pick the panel reads, before the app boots. */
    async setPick(orgId, sourceId) {
        await this.page.addInitScript(
            ([key, value]) => window.localStorage.setItem(key, value),
            [`o2.onboarding.firstSource.${orgId}`, sourceId],
        );
    }

    async open(path, orgId) {
        await this.page.goto(`${this.base()}/web/${path}?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    }

    /** The restricted-routes flag as the backend reports it to the UI. */
    async restrictedRoutesOn(orgId) {
        return await this.page.evaluate(async ([url, org]) => {
            try {
                const r = await fetch(`${url}/api/${org}/config`, { credentials: 'include' });
                return (await r.json()).restricted_routes_on_empty_data === true;
            } catch {
                return false;
            }
        }, [this.base(), orgId]);
    }

    ingestionRedirects() {
        return this.visitedUrls.filter((u) => new URL(u).pathname.includes('/ingestion'));
    }

    panelFor(signal) {
        return this.page.locator(`[data-test="first-data-panel"][data-signal="${signal}"]`);
    }

    async expectNoRedirect(path) {
        await expect(this.page).toHaveURL(new RegExp(`/web/${path}`), { timeout: 15000 });
        expect(this.ingestionRedirects()).toEqual([]);
    }

    async expectLogsRows(min = 1, timeout = 30000) {
        await expect.poll(() => this.logsResultRows.count(), { timeout }).toBeGreaterThanOrEqual(min);
    }
}
