// cloudLoginPage.js - Cloud Login & Sanity Page Object for Alpha1
// On cloud, authentication is handled by global setup (Dex email OIDC).
// The browser context already has session cookies from storageState.
// These methods provide the same interface as LoginPage but verify
// that auth state is valid rather than performing a login flow.
const { expect } = require('@playwright/test');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

class CloudLoginPage {
    constructor(page) {
        this.page = page;

        // ===== NAVIGATION MENU SELECTORS =====
        this.homePageMenu = page.locator('[data-test="menu-link-\\/-item"]');
        // Mounts with the SPA on a valid session — present before /config resolves.
        this.appShell = page.locator('[data-test="navbar-main-nav"]');
    }

    // ===== ASSERTION METHODS =====

    /**
     * The nav rail is gated on GET /config, not on auth.
     *
     * MainLayout.vue holds `navLinks` at [] until `menuReady` flips, which happens
     * only once `zoConfig.version` is populated — so ONavbar renders no MenuLink
     * items and this element is ABSENT from the DOM, not hidden. Asserting the app
     * shell first separates "not logged in" from "config still loading"; the 90s
     * budget on the rail matches enhanced-baseFixtures.verifyAuthentication and
     * covers a backend serving 13 shards booting at once.
     */
    async expectHomePageMenuVisible(timeout = 90000) {
        await expect(this.appShell).toBeVisible({ timeout: 30000 });
        await expect(this.homePageMenu).toBeVisible({ timeout });
    }

    async expectOnWebPage(timeout = 15000) {
        await expect(this.page).toHaveURL(/web/, { timeout });
    }

    async expectOnLogsPage(timeout = 15000) {
        await expect(this.page).toHaveURL(/logs/, { timeout });
    }

    async expectNotOnAuthPages(timeout = 5000) {
        await expect(this.page).not.toHaveURL(/\/login|\/dex\/|\/error|\/unauthorized/, { timeout });
    }

    // ===== NAVIGATION METHODS =====

    /**
     * The active org is derived from the `org_identifier` QUERY PARAM on every
     * page load — it is NOT part of the session.
     *
     * MainLayout.vue resolves it in onBeforeMount from
     * `url.searchParams.get("org_identifier")`, and the only store behind it
     * (`useLocalOrganization` in utils/storage.ts) is an in-memory module ref, so
     * nothing about the active org survives a reload and `storageState` cannot
     * carry it. Navigating to a bare `/web/...` therefore silently lands on the
     * USER'S DEFAULT org, not this shard's.
     *
     * That was harmless while every shard used one org. Now that the alpha1 matrix
     * spreads 13 shards over 6 orgs, a bare navigation puts the test in the wrong
     * org entirely — which is how this suite failed on run 30531452187 with the
     * org selector reading `Dash_automation` and no side nav at all.
     */
    orgParam() {
        const org = process.env['ORGNAME'] || getOrgIdentifier();
        return org ? `?org_identifier=${encodeURIComponent(org)}` : '';
    }

    async gotoHomePage() {
        await this.page.goto(`/web/${this.orgParam()}`);
        await this.page.waitForLoadState('domcontentloaded');
    }

    async gotoLogsPage() {
        await this.page.goto(`/web/logs${this.orgParam()}`);
        await this.page.waitForLoadState('domcontentloaded');
    }

    // ===== LOGIN PAGE INTERFACE (cloud-compatible) =====

    async gotoLoginPage() {
        const baseUrl = process.env["ZO_BASE_URL"];
        await this.page.goto(`${baseUrl}/web/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
    }

    async loginAsInternalUser() {
        // No-op on cloud - no "Login as internal user" concept
        await this.page.waitForLoadState('domcontentloaded');
    }

    async login() {
        // On cloud, auth is already established via storageState cookies.
        // Navigate to the app and verify we're authenticated.
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();
        await this.page.goto(`${baseUrl}/web/?org_identifier=${orgName}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await this.expectHomePageMenuVisible(15000);
    }

    async gotoLoginPageSC() {
        await this.page.waitForLoadState('domcontentloaded');
    }

    async loginAsInternalUserSC() {
        await this.page.waitForLoadState('domcontentloaded');
    }

    async loginSC() {
        await this.page.waitForLoadState('domcontentloaded');
    }
}

module.exports = { CloudLoginPage };
