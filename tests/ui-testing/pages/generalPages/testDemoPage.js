// testDemoPage.js - Page Object for the Test Demo surface (throwaway E2E Council test target)
import { expect } from '@playwright/test';

export class TestDemoPage {
    constructor(page) {
        this.page = page;

        // ===== PAGE ROOT & HEADER =====
        this.pageRoot = page.locator('[data-test="test-demo-page"]');
        this.pageTitle = page.locator('[data-test="test-demo-title"]');
        this.pageSubtitle = page.locator('[data-test="test-demo-subtitle"]');

        // ===== SECTION 1: FRUIT SELECT =====
        this.fruitCard = page.locator('[data-test="test-demo-fruit-card"]');
        this.fruitSelectTrigger = page.locator('[data-test="test-demo-fruit-select"]');
        this.fruitOutput = page.locator('[data-test="test-demo-fruit-output"]');

        // ===== SECTION 2: CASCADING COUNTRY→CITY =====
        this.locationCard = page.locator('[data-test="test-demo-location-card"]');
        this.countrySelectTrigger = page.locator('[data-test="test-demo-country-select"]');
        this.citySelectTrigger = page.locator('[data-test="test-demo-city-select-trigger"]');
        this.locationOutput = page.locator('[data-test="test-demo-location-output"]');

        // ===== SECTION 3: MODE TOGGLE + ADVANCED =====
        this.modeCard = page.locator('[data-test="test-demo-mode-card"]');
        this.modeToggle = page.locator('[data-test="test-demo-mode-toggle"]');
        this.modeOptionBasic = page.locator('[data-test="test-demo-mode-option-basic"]');
        this.modeOptionAdvanced = page.locator('[data-test="test-demo-mode-option-advanced"]');
        this.modeOutput = page.locator('[data-test="test-demo-mode-output"]');
        this.advancedPanel = page.locator('[data-test="test-demo-advanced-panel"]');
        this.prioritySelectTrigger = page.locator('[data-test="test-demo-priority-select"]');
        this.priorityOutput = page.locator('[data-test="test-demo-priority-output"]');
        this.combinedBanner = page.locator('[data-test="test-demo-combined-banner"]');
    }

    // ===== NAVIGATION =====

    async navigateToPage() {
        await this.page.goto('/web/test-demo');
        await this.expectPageLoaded();
    }

    async waitForPageLoad() {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ===== EXPECT METHODS (assertions) =====

    async expectPageLoaded() {
        await expect(this.pageRoot).toBeVisible({ timeout: 10000 });
    }

    async expectTitleVisible() {
        await expect(this.pageTitle).toBeVisible();
    }

    async expectTitleContains(text) {
        await expect(this.pageTitle).toContainText(text);
    }

    async expectSubtitleVisible() {
        await expect(this.pageSubtitle).toBeVisible();
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

    // ---- Fruit Section ----

    async expectFruitOutputText(text) {
        await expect(this.fruitOutput).toContainText(text);
    }

    // ---- Location Section ----

    async expectLocationOutput(text) {
        await expect(this.locationOutput).toContainText(text);
    }

    async expectCitySelectDisabled() {
        await expect(this.citySelectTrigger).toBeDisabled();
    }

    async expectCitySelectEnabled() {
        await expect(this.citySelectTrigger).toBeEnabled();
    }

    // ---- Mode Section ----

    async expectModeOutput(text) {
        await expect(this.modeOutput).toContainText(text);
    }

    async expectAdvancedPanelNotInDOM() {
        await expect(this.advancedPanel).toHaveCount(0);
    }

    async expectAdvancedPanelVisible() {
        await expect(this.advancedPanel).toBeVisible();
    }

    async expectPriorityOutput(text) {
        await expect(this.priorityOutput).toContainText(text);
    }

    async expectCombinedBannerVisible() {
        await expect(this.combinedBanner).toBeVisible();
    }

    async expectCombinedBannerNotVisible() {
        await expect(this.combinedBanner).not.toBeVisible();
    }

    async expectCombinedBannerContainsText(text) {
        await expect(this.combinedBanner).toContainText(text);
    }

    // ===== ACTIONS =====

    // ---- Generic OSelect option click ----
    // OSelect renders popover options with: [data-test="<parentDataTest>-option"][data-test-value="<value>"]
    // This helper: clicks the trigger, waits for the option in the popover, clicks it.
    async _selectOption(triggerLocator, parentDataTest, optionDataTestValue) {
        // Click trigger to open popover
        await triggerLocator.click();
        // Build the option locator using the known parent data-test
        const optionLocator = this.page.locator(`[data-test="${parentDataTest}-option"][data-test-value="${optionDataTestValue}"]`);
        await optionLocator.waitFor({ state: 'visible', timeout: 5000 });
        await optionLocator.click();
    }

    // ---- Fruit actions ----

    async selectFruit(value) {
        await this._selectOption(this.fruitSelectTrigger, 'test-demo-fruit-select', value);
    }

    async getFruitOutputText() {
        return await this.fruitOutput.textContent();
    }

    // ---- Country/City cascading actions ----

    async selectCountry(value) {
        await this._selectOption(this.countrySelectTrigger, 'test-demo-country-select', value);
    }

    async selectCity(value) {
        await this._selectOption(this.citySelectTrigger, 'test-demo-city-select', value);
    }

    async getLocationOutputText() {
        return await this.locationOutput.textContent();
    }

    // ---- Mode toggle actions ----

    async switchToBasic() {
        await this.modeOptionBasic.click();
    }

    async switchToAdvanced() {
        await this.modeOptionAdvanced.click();
    }

    async getModeOutputText() {
        return await this.modeOutput.textContent();
    }

    // ---- Priority actions ----

    async selectPriority(value) {
        await this._selectOption(this.prioritySelectTrigger, 'test-demo-priority-select', value);
    }

    async getPriorityOutputText() {
        return await this.priorityOutput.textContent();
    }

    // ---- Combined banner ----

    async getCombinedBannerText() {
        return await this.combinedBanner.textContent();
    }
}
