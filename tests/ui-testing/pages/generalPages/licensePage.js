// licensePage.js - License management page object for OpenObserve
import { expect } from '@playwright/test';

export class LicensePage {

    constructor(page) {
        this.page = page;

        // ===== SETTINGS NAVIGATION =====
        this.settingsMenu = page.locator('[data-test="menu-link-settings-item"]');
        this.settingsPageIndicator = page.getByText('General Settings').first();

        // ===== LICENSE TAB SELECTOR =====
        this.licenseTab = page.locator('[data-test="license-tab"]');

        // ===== ACTIVE LICENSE STATE SELECTORS =====
        this.refreshLicenseLimitsBtn = page.locator('[data-test="refresh-license-limits-btn"]');
        this.requestNewLicenseBtn = page.locator('[data-test="request-new-license-btn"]');
        this.addLicenseKeyBtn = page.locator('[data-test="add-license-key-btn"]');

        // ===== NO-LICENSE STATE SELECTORS =====
        this.noLicenseGetLicenseBtn = page.locator('[data-test="no-license-get-license-btn"]');
        this.noLicenseKeyInput = page.locator('[data-test="no-license-key-input"]');

        // ===== NOTIFICATION SELECTORS =====
        this.successNotification = page.locator('.q-notification.bg-positive');
        this.errorNotification = page.locator('.q-notification.bg-negative');
        this.alert = page.getByRole('alert').first();

        // ===== USAGE REPORT BANNER SELECTORS =====
        this.usageReportContainer = page.locator('.usage-report-container');
        this.usageReportWarning = page.locator('.usage-report-warning');
        this.usageReportError = page.locator('.usage-report-error');
        this.usageMessage = page.locator('.o2-usage-message');
        this.usageSubtitle = page.locator('.o2-usage-subtitle');
    }

    // ===== NAVIGATION METHODS =====

    /**
     * Navigate to the License tab within Settings.
     * Opens Settings menu, then clicks the License tab, and waits for the page to settle.
     */
    async navigateToLicenseTab() {
        await this.settingsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.settingsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        // Wait for the license tab to be visible (enterprise-gated, may not always appear)
        await this.licenseTab.waitFor({ state: 'visible', timeout: 10000 });
        await this.licenseTab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        // Wait for either active-license or no-license state to settle
        await Promise.race([
            this.refreshLicenseLimitsBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
            this.noLicenseGetLicenseBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
        ]);
    }

    // ===== ACTIVE LICENSE METHODS =====

    /**
     * Click the "Refresh License Limits" button.
     */
    async clickRefreshLicenseLimits() {
        await this.refreshLicenseLimitsBtn.waitFor({ state: 'visible', timeout: 10000 });
        await this.refreshLicenseLimitsBtn.click();
    }

    /**
     * Returns whether the Refresh License Limits button is visible.
     */
    async isRefreshButtonVisible() {
        return await this.refreshLicenseLimitsBtn.isVisible().catch(() => false);
    }

    // ===== NO-LICENSE STATE METHODS =====

    /**
     * Returns whether the UI is in no-license state.
     */
    async isNoLicenseState() {
        return await this.noLicenseGetLicenseBtn.isVisible().catch(() => false);
    }

    /**
     * Assert the no-license "Get License" button is visible.
     */
    async expectNoLicenseButtonVisible() {
        await expect(this.noLicenseGetLicenseBtn).toBeVisible({ timeout: 10000 });
    }

    /**
     * Assert the Refresh License Limits button is NOT visible.
     */
    async expectRefreshButtonNotVisible() {
        await expect(this.refreshLicenseLimitsBtn).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Assert the Refresh License Limits button IS visible.
     */
    async expectRefreshButtonVisible() {
        await expect(this.refreshLicenseLimitsBtn).toBeVisible({ timeout: 10000 });
    }

    // ===== NOTIFICATION METHODS =====

    /**
     * Wait for and assert a success notification containing the expected text.
     * @param {string} expectedText - The text to look for in the success notification.
     */
    async expectSuccessNotification(expectedText) {
        await this.successNotification.first().waitFor({ state: 'visible', timeout: 15000 });
        await expect(this.successNotification.first()).toContainText(expectedText, { timeout: 10000 });
    }

    /**
     * Wait for and assert an error notification containing the expected text.
     * @param {string} expectedText - The text to look for in the error notification.
     */
    async expectErrorNotification(expectedText) {
        await this.errorNotification.first().waitFor({ state: 'visible', timeout: 15000 });
        await expect(this.errorNotification.first()).toContainText(expectedText, { timeout: 10000 });
    }

    // ===== BUTTON ORDER METHODS =====

    /**
     * Returns an array of data-test values for the buttons in the active-license button row,
     * in DOM order.
     */
    async getButtonOrder() {
        const buttons = this.page.locator('[data-test="request-new-license-btn"], [data-test="add-license-key-btn"], [data-test="refresh-license-limits-btn"]');
        const count = await buttons.count();
        const order = [];
        for (let i = 0; i < count; i++) {
            const dt = await buttons.nth(i).getAttribute('data-test');
            order.push(dt);
        }
        return order;
    }

    // ===== USAGE REPORT BANNER METHODS =====

    /**
     * Check if the usage report banner container is visible.
     */
    async isUsageBannerVisible() {
        return await this.usageReportContainer.isVisible().catch(() => false);
    }

    /**
     * Wait for the usage report banner to be visible.
     */
    async waitForUsageBannerVisible() {
        await this.usageReportContainer.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }

    /**
     * Assert the usage report banner is not visible.
     */
    async expectUsageBannerNotVisible() {
        await expect(this.usageReportContainer).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Assert the usage report banner is visible.
     */
    async expectUsageBannerVisible() {
        await expect(this.usageReportContainer).toBeVisible({ timeout: 5000 });
    }

    // ===== NETWORK INTERCEPTION =====

    /**
     * Intercept POST /api/license/refresh and respond with a custom status and body.
     * @param {number} status - HTTP status code to return.
     * @param {object} body - JSON body to return.
     */
    async interceptRefreshEndpoint(status, body) {
        await this.page.route('**/api/license/refresh', async (route) => {
            await route.fulfill({
                status: status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        });
    }
}
