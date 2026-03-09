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
    }

    // ===== ASSERTION METHODS =====

    async expectHomePageMenuVisible(timeout = 15000) {
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

    async gotoHomePage() {
        await this.page.goto('/web/');
        await this.page.waitForLoadState('domcontentloaded');
    }

    async gotoLogsPage() {
        await this.page.goto('/web/logs');
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
