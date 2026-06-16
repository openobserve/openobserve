// testDemoPage.js - Page Object for the Test Demo page
import { expect } from '@playwright/test';

export class TestDemoPage {
    constructor(page) {
        this.page = page;

        // ===== PAGE-LEVEL SELECTORS =====
        this.pageRoot = page.locator('[data-test="test-demo-page"]');
        this.pageTitle = page.locator('[data-test="test-demo-title"]');
        this.pageSubtitle = page.locator('[data-test="test-demo-subtitle"]');

        // ===== FRUIT CARD SELECTORS =====
        this.fruitCard = page.locator('[data-test="test-demo-fruit-card"]');
        this.fruitTrigger = page.locator('[data-test="test-demo-fruit-select-trigger"]');
        this.fruitOutput = page.locator('[data-test="test-demo-fruit-output"]');
        this.fruitPopover = page.locator('[data-test="test-demo-fruit-select-popover"]');

        // ===== LOCATION CARD SELECTORS =====
        this.locationCard = page.locator('[data-test="test-demo-location-card"]');
        this.locationOutput = page.locator('[data-test="test-demo-location-output"]');
        this.countryTrigger = page.locator('[data-test="test-demo-country-select-trigger"]');
        this.cityTrigger = page.locator('[data-test="test-demo-city-select-trigger"]');

        // ===== MODE CARD SELECTORS =====
        this.modeCard = page.locator('[data-test="test-demo-mode-card"]');
        this.modeOutput = page.locator('[data-test="test-demo-mode-output"]');
        this.modeOptionBasic = page.locator('[data-test="test-demo-mode-option-basic"]');
        this.modeOptionAdvanced = page.locator('[data-test="test-demo-mode-option-advanced"]');
        this.advancedPanel = page.locator('[data-test="test-demo-advanced-panel"]');
        this.priorityTrigger = page.locator('[data-test="test-demo-priority-select-trigger"]');
        this.priorityOutput = page.locator('[data-test="test-demo-priority-output"]');
        this.combinedBanner = page.locator('[data-test="test-demo-combined-banner"]');
        this.combinedBannerIcon = page.locator('[data-test="test-demo-combined-banner"] [data-destructive-icon="true"]');
        this.priorityPopover = page.locator('[data-test="test-demo-priority-select-popover"]');
    }

    // ===== PARAMETERIZED LOCATORS =====
    getFruitOption(value) {
        return this.page.locator(`[data-test="test-demo-fruit-select-option"][data-test-value="${value}"]`);
    }

    getCountryOption(value) {
        return this.page.locator(`[data-test="test-demo-country-select-option"][data-test-value="${value}"]`);
    }

    getCityOption(value) {
        return this.page.locator(`[data-test="test-demo-city-select-option"][data-test-value="${value}"]`);
    }

    getPriorityOption(value) {
        return this.page.locator(`[data-test="test-demo-priority-select-option"][data-test-value="${value}"]`);
    }

    getAllFruitOptions() {
        return this.page.locator('[data-test="test-demo-fruit-select-option"]');
    }

    getAllCityOptions() {
        return this.page.locator('[data-test="test-demo-city-select-option"]');
    }

    // ===== NAVIGATION =====
    async navigateToTestDemo() {
        await this.page.goto(`/test-demo?org_identifier=${process.env["ORGNAME"]}`);
        await this.pageRoot.waitFor({ state: 'visible', timeout: 10000 });
    }

    // ===== PAGE-LEVEL EXPECT METHODS =====
    async expectPageVisible() {
        await expect(this.pageRoot).toBeVisible();
    }

    async expectTitleVisible() {
        await expect(this.pageTitle).toBeVisible();
        await expect(this.pageTitle).toContainText('TEST — Demo Page');
    }

    async expectAllCardsVisible() {
        await expect(this.fruitCard).toBeVisible();
        await expect(this.locationCard).toBeVisible();
        await expect(this.modeCard).toBeVisible();
    }

    // ===== FRUIT METHODS =====
    async openFruitDropdown() {
        await this.fruitTrigger.click();
        await this.fruitPopover.waitFor({ state: 'visible', timeout: 5000 });
    }

    async selectFruitOption(value) {
        await this.openFruitDropdown();
        await this.getFruitOption(value).click();
    }

    async expectFruitOutputText(expectedText) {
        await expect(this.fruitOutput).toContainText(expectedText);
    }

    async expectFruitTriggerPlaceholder(expectedPlaceholder) {
        await expect(this.fruitTrigger).toContainText(expectedPlaceholder);
    }

    async expectFruitTriggerShowsLabel(expectedLabel) {
        await expect(this.fruitTrigger).toContainText(expectedLabel);
    }

    async expectFruitTriggerSelectedValue(expectedValue) {
        await expect(this.fruitTrigger).toHaveAttribute('data-test-selected-value', expectedValue);
    }

    async expectFruitOptionsCount(expectedCount) {
        await expect(this.getAllFruitOptions()).toHaveCount(expectedCount);
    }

    // ===== LOCATION METHODS =====
    async openCountryDropdown() {
        await this.countryTrigger.click();
        // Wait for first option to become visible (dropdown portal)
        await this.getCountryOption('india').waitFor({ state: 'visible', timeout: 5000 });
    }

    async selectCountryOption(value) {
        await this.openCountryDropdown();
        await this.getCountryOption(value).click();
    }

    async openCityDropdown() {
        await this.cityTrigger.click();
        // Wait for at least one city option to render
        await this.getAllCityOptions().first().waitFor({ state: 'visible', timeout: 5000 });
    }

    async selectCityOption(value) {
        await this.openCityDropdown();
        await this.getCityOption(value).click();
    }

    async expectLocationOutputText(expectedText) {
        await expect(this.locationOutput).toContainText(expectedText);
    }

    async expectCountryTriggerPlaceholder(expectedPlaceholder) {
        await expect(this.countryTrigger).toContainText(expectedPlaceholder);
    }

    async expectCityTriggerDisabled() {
        await expect(this.cityTrigger).toHaveAttribute('data-disabled');
    }

    async expectCityTriggerEnabled() {
        await expect(this.cityTrigger).not.toHaveAttribute('data-disabled');
    }

    async expectCityTriggerPlaceholder(expectedPlaceholder) {
        await expect(this.cityTrigger).toContainText(expectedPlaceholder);
    }

    async expectCityTriggerShowsLabel(expectedLabel) {
        await expect(this.cityTrigger).toContainText(expectedLabel);
    }

    /**
     * Open city dropdown and verify specific city labels are present.
     * @param {string[]} labels - e.g. ["Bengaluru", "Mumbai"]
     */
    async expectCityOptionsVisible(labels) {
        await this.openCityDropdown();
        for (const label of labels) {
            await expect(
                this.page.locator(`[data-test="test-demo-city-select-option"][data-test-label="${label}"]`)
            ).toBeVisible();
        }
    }

    // ===== MODE METHODS =====
    async clickModeBasic() {
        await this.modeOptionBasic.click();
    }

    async clickModeAdvanced() {
        await this.modeOptionAdvanced.click();
    }

    async expectModeOutputText(expectedText) {
        await expect(this.modeOutput).toContainText(expectedText);
    }

    async expectBasicModeActive() {
        await expect(this.modeOptionBasic).toHaveAttribute('data-state', 'on');
        await expect(this.modeOptionAdvanced).toHaveAttribute('data-state', 'off');
    }

    async expectAdvancedModeActive() {
        await expect(this.modeOptionAdvanced).toHaveAttribute('data-state', 'on');
        await expect(this.modeOptionBasic).toHaveAttribute('data-state', 'off');
    }

    async expectAdvancedPanelVisible() {
        await expect(this.advancedPanel).toBeVisible();
    }

    async expectAdvancedPanelNotInDOM() {
        await expect(this.advancedPanel).toHaveCount(0);
    }

    // ===== PRIORITY METHODS =====
    async openPriorityDropdown() {
        await this.priorityTrigger.click();
        await this.priorityPopover.waitFor({ state: 'visible', timeout: 5000 });
    }

    async selectPriorityOption(value) {
        await this.openPriorityDropdown();
        await this.getPriorityOption(value).click();
    }

    async expectPriorityOutputText(expectedText) {
        await expect(this.priorityOutput).toContainText(expectedText);
    }

    async expectPriorityTriggerPlaceholder(expectedPlaceholder) {
        await expect(this.priorityTrigger).toContainText(expectedPlaceholder);
    }

    async expectPriorityTriggerShowsLabel(expectedLabel) {
        await expect(this.priorityTrigger).toContainText(expectedLabel);
    }

    // ===== COMBINED BANNER METHODS =====
    async expectCombinedBannerVisible() {
        await expect(this.combinedBanner).toBeVisible();
    }

    async expectCombinedBannerText(expectedText) {
        await expect(this.combinedBanner).toContainText(expectedText);
    }

    async expectCombinedBannerNotInDOM() {
        await expect(this.combinedBanner).toHaveCount(0);
    }

    async expectCombinedBannerIconVisible() {
        await expect(this.combinedBannerIcon).toBeVisible();
    }

    // ===== FRUIT POPOVER (for TC21 no-loading test) =====
    async expectFruitPopoverVisible() {
        await expect(this.fruitPopover).toBeVisible();
    }
}
