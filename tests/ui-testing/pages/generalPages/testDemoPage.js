// testDemoPage.js - Page Object for the throwaway Test Demo page (/test-demo)
// Purpose: E2E Council test-generation pipeline exercise surface.
// Backend-free — all outputs are pure functions of the selections.
import { expect } from '@playwright/test';

export class TestDemoPage {
    constructor(page) {
        this.page = page;

        // ── Base URL ──
        this.url = '/web/test-demo';

        // ── Page shell ──
        this.pageContainer = page.locator('[data-test="test-demo-page"]');
        this.pageTitle = page.locator('[data-test="test-demo-title"]');
        this.pageSubtitle = page.locator('[data-test="test-demo-subtitle"]');

        // ── Section 1: Fruit ──
        this.fruitCard = page.locator('[data-test="test-demo-fruit-card"]');
        this.fruitSelectWrapper = page.locator('[data-test="test-demo-fruit-select"]');
        this.fruitOutput = page.locator('[data-test="test-demo-fruit-output"]');

        // ── Section 2: Cascading location ──
        this.locationCard = page.locator('[data-test="test-demo-location-card"]');
        this.countrySelectWrapper = page.locator('[data-test="test-demo-country-select"]');
        this.citySelectWrapper = page.locator('[data-test="test-demo-city-select"]');
        this.locationOutput = page.locator('[data-test="test-demo-location-output"]');

        // ── Section 3: Mode + Priority + Banner ──
        this.modeCard = page.locator('[data-test="test-demo-mode-card"]');
        this.modeToggle = page.locator('[data-test="test-demo-mode-toggle"]');
        this.modeOptionBasic = page.locator('[data-test="test-demo-mode-option-basic"]');
        this.modeOptionAdvanced = page.locator('[data-test="test-demo-mode-option-advanced"]');
        this.modeOutput = page.locator('[data-test="test-demo-mode-output"]');
        this.advancedPanel = page.locator('[data-test="test-demo-advanced-panel"]');
        this.prioritySelectWrapper = page.locator('[data-test="test-demo-priority-select"]');
        this.priorityOutput = page.locator('[data-test="test-demo-priority-output"]');
        this.combinedBanner = page.locator('[data-test="test-demo-combined-banner"]');
    }

    // ═══════════════════════════════════════════════════
    // Navigation
    // ═══════════════════════════════════════════════════

    async goto(orgIdentifier) {
        const org = orgIdentifier || process.env['ORGNAME'];
        await this.page.goto(`${this.url}?org_identifier=${org}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ═══════════════════════════════════════════════════
    // Expect helpers (page elements)
    // ═══════════════════════════════════════════════════

    async expectPageVisible() {
        await expect(this.pageContainer).toBeVisible({ timeout: 10000 });
        await expect(this.pageTitle).toBeVisible();
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

    async expectFruitOutputText(expectedText) {
        await expect(this.fruitOutput).toContainText(expectedText);
    }

    async expectLocationOutputText(expectedText) {
        await expect(this.locationOutput).toContainText(expectedText);
    }

    async expectModeOutputText(expectedText) {
        await expect(this.modeOutput).toContainText(expectedText);
    }

    // ═══════════════════════════════════════════════════
    // OSelect helper (generic — works on any OSelect by data-test parent)
    // OSelect renders: outer wrapper div[data-test], inner PopoverTrigger button,
    // popover div[data-test="<parent>-popover"], option div[data-test="<parent>-option"][data-test-value="..."]
    // ═══════════════════════════════════════════════════

    /**
     * Select an option in an OSelect component.
     * @param {import('@playwright/test').Locator} wrapperLocator - data-test locator on the OSelect wrapper
     * @param {string} value - the option's data-test-value
     * @param {string} parentDataTest - the data-test string used as prefix for popover/option
     */
    async _selectOSelectOption(wrapperLocator, value, parentDataTest) {
        const wrapper = wrapperLocator;
        await wrapper.waitFor({ state: 'visible', timeout: 10000 });

        // The trigger button is the inner <button type="button"> inside the wrapper
        const trigger = wrapper.locator('button[type="button"]').first();
        await trigger.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        // Open the popover
        await trigger.click({ force: false });

        // Wait for the popover
        const popover = this.page.locator(`[data-test="${parentDataTest}-popover"]`);
        await popover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        // Click the option by data-test-value
        const option = this.page.locator(`[data-test="${parentDataTest}-option"][data-test-value="${value}"]`);
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click({ force: false });

        // Dismiss popover
        await this.page.keyboard.press('Escape').catch(() => {});
        await popover.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }

    // ═══════════════════════════════════════════════════
    // Section 1: Fruit
    // ═══════════════════════════════════════════════════

    async selectFruit(value) {
        await this._selectOSelectOption(this.fruitSelectWrapper, value, 'test-demo-fruit-select');
    }

    async getFruitOutputText() {
        return await this.fruitOutput.textContent();
    }

    // ═══════════════════════════════════════════════════
    // Section 2: Country & City (cascading)
    // ═══════════════════════════════════════════════════

    async selectCountry(value) {
        await this._selectOSelectOption(this.countrySelectWrapper, value, 'test-demo-country-select');
    }

    async selectCity(value) {
        await this._selectOSelectOption(this.citySelectWrapper, value, 'test-demo-city-select');
    }

    async isCitySelectDisabled() {
        // The wrapper div of a disabled OSelect has a `data-disabled` attribute
        return await this.citySelectWrapper.getAttribute('data-disabled').catch(() => null);
    }

    async expectCitySelectEnabled() {
        // After selecting a country, the city select should become interactive.
        // Poll until aria-disabled is not "true" on the inner trigger button, or
        // the wrapper lacks a data-disabled attribute.
        const trigger = this.citySelectWrapper.locator('button[type="button"]').first();
        await expect(trigger).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
    }

    async getLocationOutputText() {
        return await this.locationOutput.textContent();
    }

    // ═══════════════════════════════════════════════════
    // Section 3: Mode toggle
    // ═══════════════════════════════════════════════════

    async clickModeBasic() {
        await this.modeOptionBasic.waitFor({ state: 'visible', timeout: 5000 });
        await this.modeOptionBasic.click();
    }

    async clickModeAdvanced() {
        await this.modeOptionAdvanced.waitFor({ state: 'visible', timeout: 5000 });
        await this.modeOptionAdvanced.click();
    }

    async expectModeBasicActive() {
        // OToggleGroupItem signals active via data-state="on" on the Reka inner button
        await expect(this.modeOptionBasic).toHaveAttribute('data-state', 'on', { timeout: 5000 });
    }

    async expectModeAdvancedActive() {
        await expect(this.modeOptionAdvanced).toHaveAttribute('data-state', 'on', { timeout: 5000 });
    }

    async expectAdvancedPanelVisible() {
        await expect(this.advancedPanel).toBeVisible({ timeout: 5000 });
    }

    async expectAdvancedPanelHidden() {
        await expect(this.advancedPanel).not.toBeVisible({ timeout: 5000 });
    }

    // ═══════════════════════════════════════════════════
    // Section 3: Priority (only visible in Advanced mode)
    // ═══════════════════════════════════════════════════

    async selectPriority(value) {
        await this._selectOSelectOption(this.prioritySelectWrapper, value, 'test-demo-priority-select');
    }

    async getPriorityOutputText() {
        return await this.priorityOutput.textContent();
    }

    async expectPriorityOutputText(expectedText) {
        await expect(this.priorityOutput).toContainText(expectedText);
    }

    // ═══════════════════════════════════════════════════
    // Section 3: Combined banner (Cherry + Advanced + High)
    // ═══════════════════════════════════════════════════

    async expectCombinedBannerVisible() {
        await expect(this.combinedBanner).toBeVisible({ timeout: 5000 });
    }

    async expectCombinedBannerHidden() {
        await expect(this.combinedBanner).not.toBeVisible({ timeout: 5000 });
    }

    async expectCombinedBannerContainsText(expectedText) {
        await expect(this.combinedBanner).toContainText(expectedText);
    }

    // ═══════════════════════════════════════════════════
    // Page-level text getters (for assertion composition)
    // ═══════════════════════════════════════════════════

    async getPageTitleText() {
        return await this.pageTitle.textContent();
    }

    async getPageSubtitleText() {
        return await this.pageSubtitle.textContent();
    }

    async getModeOutputText() {
        return await this.modeOutput.textContent();
    }
}
