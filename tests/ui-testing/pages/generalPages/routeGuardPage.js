import { expect } from '@playwright/test';

/**
 * Routes that should not be reachable: internal demo pages, and enterprise-only
 * pages on an opensource build.
 */
export class RouteGuardPage {
    constructor(page) {
        this.page = page;
        // The removed demo rendered its own heading; the URL alone is not the tell.
        this.emptyStateDemoHeading = page.getByText('Empty states', { exact: false });
        this.notFoundHeading = page.getByText('Page not found', { exact: false });
    }

    /** Navigate to an app route under /web, carrying the org identifier. */
    async gotoAppRoute(routePath, orgIdentifier) {
        const org = orgIdentifier || process.env.ORGNAME || 'default';
        const base = process.env.ZO_BASE_URL.replace(/\/$/, '');
        await this.page.goto(`${base}/web/${routePath}?org_identifier=${org}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    /** build_type as the server reports it, so an edition-specific guard can be skipped elsewhere. */
    async getBuildType() {
        const base = process.env.ZO_BASE_URL.replace(/\/$/, '');
        return await this.page.evaluate(async (url) => {
            try {
                const r = await fetch(`${url}/config`, { credentials: 'include' });
                return (await r.json()).build_type || 'unknown';
            } catch {
                return 'unknown';
            }
        }, base);
    }

    async expectEmptyStateDemoNotRendered() {
        await expect(this.emptyStateDemoHeading).toHaveCount(0, { timeout: 10000 });
    }

    /** A removed route falls through to the 404 view rather than changing the URL. */
    async expectNotFoundRendered() {
        await expect(this.notFoundHeading.first()).toBeVisible({ timeout: 15000 });
    }

    currentUrl() {
        return this.page.url();
    }
}
