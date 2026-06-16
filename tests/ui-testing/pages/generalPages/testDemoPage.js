import { expect } from '@playwright/test';

export class TestDemoPage {
    constructor(page) {
        this.page = page;

        // ============================
        // Page-level selectors
        // ============================
        this.pageRoot = page.locator('[data-test="test-demo-page"]');
        this.pageTitle = page.locator('[data-test="test-demo-title"]');
        this.pageSubtitle = page.locator('[data-test="test-demo-subtitle"]');

        // ============================
        // Section 1 — Fruit
        // ============================
        this.fruitCard = page.locator('[data-test="test-demo-fruit-card"]');
        this.fruitSelectTrigger = page.locator('[data-test="test-demo-fruit-select-trigger"]');
        this.fruitSelectPopover = page.locator('[data-test="test-demo-fruit-select-popover"]');
        this.fruitOutput = page.locator('[data-test="test-demo-fruit-output"]');

        // ============================
        // Section 2 — Cascading Location
        // ============================
        this.locationCard = page.locator('[data-test="test-demo-location-card"]');
        this.countrySelectTrigger = page.locator('[data-test="test-demo-country-select-trigger"]');
        this.countrySelectPopover = page.locator('[data-test="test-demo-country-select-popover"]');
        this.citySelectTrigger = page.locator('[data-test="test-demo-city-select-trigger"]');
        this.citySelectPopover = page.locator('[data-test="test-demo-city-select-popover"]');
        this.locationOutput = page.locator('[data-test="test-demo-location-output"]');

        // ============================
        // Section 3 — Mode + Priority
        // ============================
        this.modeCard = page.locator('[data-test="test-demo-mode-card"]');
        this.modeToggle = page.locator('[data-test="test-demo-mode-toggle"]');
        this.modeOptionBasic = page.locator('[data-test="test-demo-mode-option-basic"]');
        this.modeOptionAdvanced = page.locator('[data-test="test-demo-mode-option-advanced"]');
        this.modeOutput = page.locator('[data-test="test-demo-mode-output"]');
        this.advancedPanel = page.locator('[data-test="test-demo-advanced-panel"]');
        this.prioritySelectTrigger = page.locator('[data-test="test-demo-priority-select-trigger"]');
        this.prioritySelectPopover = page.locator('[data-test="test-demo-priority-select-popover"]');
        this.priorityOutput = page.locator('[data-test="test-demo-priority-output"]');
        this.combinedBanner = page.locator('[data-test="test-demo-combined-banner"]');
    }

    // ============================
    // Locator factories
    // ============================

    /** Returns locator for a specific fruit option by its data-test-label. */
    getFruitOption(label) {
        return this.page.locator(`[data-test="test-demo-fruit-select-option"][data-test-label="${label}"]`);
    }

    /** Returns locator for a specific country option by its data-test-label. */
    getCountryOption(label) {
        return this.page.locator(`[data-test="test-demo-country-select-option"][data-test-label="${label}"]`);
    }

    /** Returns locator for a specific city option by its data-test-label. */
    getCityOption(label) {
        return this.page.locator(`[data-test="test-demo-city-select-option"][data-test-label="${label}"]`);
    }

    /** Returns locator for a specific priority option by its data-test-label. */
    getPriorityOption(label) {
        return this.page.locator(`[data-test="test-demo-priority-select-option"][data-test-label="${label}"]`);
    }

    // ============================
    // Navigation
    // ============================

    async navigate() {
        // Navigate client-side with Vue Router to avoid a full page reload
        // (which would hit the backend's auth middleware and return 401).
        // The SPA is already authenticated by navigateToBase.
        await this.page.evaluate(() => {
            // Use the Vue Router instance injected on the app by the framework
            const app = (window as any).__vue_app__;
            if (app && app.config.globalProperties.$router) {
                app.config.globalProperties.$router.push('/test-demo');
            } else {
                // Fallback: pushState + dispatch popstate to trigger the router
                window.history.pushState({}, '', '/test-demo');
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        });
        await expect(this.pageRoot).toBeVisible({ timeout: 15000 });
    }

    // ============================
    // Fruit section
    // ============================

    async selectFruit(fruitName) {
        await this.fruitSelectTrigger.click();
        await expect(this.fruitSelectPopover).toBeVisible({ timeout: 5000 });
        const option = this.getFruitOption(fruitName);
        await expect(option).toBeVisible({ timeout: 3000 });
        await option.click();
        // Wait for popover to close
        await expect(this.fruitSelectPopover).not.toBeVisible({ timeout: 5000 });
    }

    // ============================
    // Location section
    // ============================

    async selectCountry(countryName) {
        await this.countrySelectTrigger.click();
        await expect(this.countrySelectPopover).toBeVisible({ timeout: 5000 });
        const option = this.getCountryOption(countryName);
        await expect(option).toBeVisible({ timeout: 3000 });
        await option.click();
        await expect(this.countrySelectPopover).not.toBeVisible({ timeout: 5000 });
    }

    async selectCity(cityName) {
        await this.citySelectTrigger.click();
        await expect(this.citySelectPopover).toBeVisible({ timeout: 5000 });
        const option = this.getCityOption(cityName);
        await expect(option).toBeVisible({ timeout: 3000 });
        await option.click();
        await expect(this.citySelectPopover).not.toBeVisible({ timeout: 5000 });
    }

    // ============================
    // Mode section
    // ============================

    async clickModeBasic() {
        await this.modeOptionBasic.click();
        // Wait for the DOM to reflect mode change
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }

    async clickModeAdvanced() {
        await this.modeOptionAdvanced.click();
        // Wait for the advanced panel to appear
        await expect(this.advancedPanel).toBeVisible({ timeout: 5000 });
    }

    // ============================
    // Priority section
    // ============================

    async selectPriority(priorityName) {
        await this.prioritySelectTrigger.click();
        await expect(this.prioritySelectPopover).toBeVisible({ timeout: 5000 });
        const option = this.getPriorityOption(priorityName);
        await expect(option).toBeVisible({ timeout: 3000 });
        await option.click();
        await expect(this.prioritySelectPopover).not.toBeVisible({ timeout: 5000 });
    }

    // ============================
    // Assertion helpers
    // ============================

    async expectPageVisible() {
        await expect(this.pageRoot).toBeVisible();
    }

    async expectTitleContains(text) {
        await expect(this.pageTitle).toBeVisible();
        await expect(this.pageTitle).toContainText(text);
    }

    async expectFruitCardVisible() {
        await expect(this.fruitCard).toBeVisible();
    }

    async expectLocationCardVisible() {
        await expect(this.locationCard).toBeVisible();
    }

    async expectModeCardVisible() {
        await expect(this.modeCard).toBeVisible();
    }

    async expectFruitOutputContains(text) {
        await expect(this.fruitOutput).toBeVisible();
        await expect(this.fruitOutput).toContainText(text);
    }

    async expectLocationOutputContains(text) {
        await expect(this.locationOutput).toBeVisible();
        await expect(this.locationOutput).toContainText(text);
    }

    async expectModeOutputContains(text) {
        await expect(this.modeOutput).toBeVisible();
        await expect(this.modeOutput).toContainText(text);
    }

    async expectPriorityOutputContains(text) {
        await expect(this.priorityOutput).toBeVisible();
        await expect(this.priorityOutput).toContainText(text);
    }

    async expectCityTriggerDisabled() {
        await expect(this.citySelectTrigger).toBeDisabled();
    }

    async expectCityTriggerEnabled() {
        await expect(this.citySelectTrigger).toBeEnabled();
    }

    async expectAdvancedPanelVisible() {
        await expect(this.advancedPanel).toBeVisible();
    }

    async expectAdvancedPanelHidden() {
        await expect(this.advancedPanel).not.toBeVisible();
    }

    async expectAdvancedPanelNotInDOM() {
        await expect(this.advancedPanel).toHaveCount(0);
    }

    async expectCombinedBannerVisible() {
        await expect(this.combinedBanner).toBeVisible();
    }

    async expectCombinedBannerHidden() {
        await expect(this.combinedBanner).not.toBeVisible();
    }

    async expectCombinedBannerContains(text) {
        await expect(this.combinedBanner).toBeVisible();
        await expect(this.combinedBanner).toContainText(text);
    }

    async expectFruitPopoverVisible() {
        await expect(this.fruitSelectPopover).toBeVisible();
    }

    async expectFruitPopoverHidden() {
        await expect(this.fruitSelectPopover).not.toBeVisible();
    }

    async expectCountryPopoverVisible() {
        await expect(this.countrySelectPopover).toBeVisible();
    }

    async expectCountryPopoverHidden() {
        await expect(this.countrySelectPopover).not.toBeVisible();
    }

    async expectPriorityPopoverHidden() {
        await expect(this.prioritySelectPopover).not.toBeVisible();
    }
}
