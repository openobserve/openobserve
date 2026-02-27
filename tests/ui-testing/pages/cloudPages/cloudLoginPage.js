// cloudLoginPage.js - Cloud Login & Sanity Page Object for Alpha1
import { expect } from '@playwright/test';

export class CloudLoginPage {
    constructor(page) {
        this.page = page;

        // ===== NAVIGATION MENU SELECTORS =====
        this.homePageMenu = page.locator('[data-test="menu-link-\\/-item"]');
        this.logsMenu = page.locator('[data-test="menu-link-\\/logs-item"]');
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
        await expect(this.page).not.toHaveURL(/login|dex|error|unauthorized/, { timeout });
    }

    // ===== NAVIGATION METHODS =====

    async gotoHomePage(baseUrl) {
        await this.page.goto(`${baseUrl}/web/`);
        await this.page.waitForLoadState('networkidle');
    }

    async gotoLogsPage(baseUrl) {
        await this.page.goto(`${baseUrl}/web/logs`);
        await this.page.waitForLoadState('domcontentloaded');
    }
}
