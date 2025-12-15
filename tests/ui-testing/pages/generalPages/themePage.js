import { expect } from '@playwright/test';

export class ThemePage {
    constructor(page) {
        this.page = page;

        // Theme Switcher (header toggle button)
        this.themeSwitcherBtn = '.header-icon'; // Light/Dark mode toggle in header
        this.darkModeIcon = 'text=dark_mode';
        this.lightModeIcon = 'text=light_mode';

        // Predefined Themes Dialog
        this.predefinedThemesMenuItem = '[data-test="menu-link-predefined-themes-item"]';
        this.predefinedThemesDialog = '.predefined-theme-card';
        this.predefinedThemesTitle = 'text=Predefined Themes';
        this.resetThemeBtn = 'button:has-text("Reset")';
        this.closeDialogBtn = '.predefined-theme-card .q-btn--round.q-btn--flat';

        // Light/Dark Mode Tabs in Predefined Themes
        this.lightModeTab = '.q-tab:has-text("Light Mode")';
        this.darkModeTab = '.q-tab:has-text("Dark Mode")';

        // Theme Cards
        this.themeCard = '.theme-card-compact';
        this.applyThemeBtn = 'button:has-text("Apply")';
        this.appliedBadge = '.q-badge:has-text("Applied")';

        // Custom Color Picker
        this.customColorCard = '.theme-card-compact:has-text("Custom Color")';
        this.customColorPreview = '.theme-card-compact:has-text("Custom Color") .color-preview-small.clickable';
        this.colorPickerDialog = '.q-color-picker, .q-color';
        // The color picker Close button is the rectangle-styled button, not the round X button
        this.colorPickerClose = '.q-dialog .q-btn--rectangle:has-text("Close")';

        // General Settings - Theme Management
        this.settingsMenuItem = '[data-test="menu-link-\\/settings-item"]';
        this.generalSettingsTab = '[data-test="settings-general-tab"]';
        this.themeLightChip = '[data-test="theme-light-chip"]';
        this.themeDarkChip = '[data-test="theme-dark-chip"]';
        this.resetThemeColorsBtn = '[data-test="reset-theme-colors-btn"]';
        this.saveSettingsBtn = '[data-test="dashboard-add-submit"]';

        // User Profile Menu (contains predefined themes link)
        this.profileMenuBtn = '[data-test="header-my-account-profile-icon"]';

        // Body class for theme detection
        this.bodyDarkClass = 'body--dark';

        // Notification
        this.notification = '.q-notification__message';
    }

    // ==================== Navigation ====================

    async navigateToSettings() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(500);
    }

    async openPredefinedThemesDialog() {
        // Click user profile menu first
        await this.page.locator(this.profileMenuBtn).click();
        await this.page.waitForTimeout(500);

        // Click predefined themes menu item ("Manage Theme")
        await this.page.locator(this.predefinedThemesMenuItem).click();
        await this.page.waitForTimeout(500);

        // Wait for dialog to appear
        await expect(this.page.locator(this.predefinedThemesDialog)).toBeVisible({ timeout: 5000 });
    }

    async closePredefinedThemesDialog() {
        await this.page.locator(this.closeDialogBtn).click();
        await this.page.waitForTimeout(300);
    }

    // ==================== Theme Switcher (Header) ====================

    async toggleThemeMode() {
        // Find and click the theme switcher button in header (has tooltip with "Switch to")
        const themeSwitcher = this.page.locator('button.q-btn--rounded.q-btn--flat').filter({
            has: this.page.locator('.q-icon.header-icon')
        }).first();
        await themeSwitcher.click();
        await this.page.waitForTimeout(1000);
    }

    async isDarkMode() {
        return await this.page.evaluate(() => document.body.classList.contains('body--dark'));
    }

    async isLightMode() {
        const isDark = await this.isDarkMode();
        return !isDark;
    }

    async switchToLightMode() {
        if (await this.isDarkMode()) {
            await this.toggleThemeMode();
        }
    }

    async switchToDarkMode() {
        if (await this.isLightMode()) {
            await this.toggleThemeMode();
        }
    }

    // ==================== Predefined Themes Dialog ====================

    async selectLightModeTab() {
        await this.page.locator(this.lightModeTab).click();
        await this.page.waitForTimeout(300);
    }

    async selectDarkModeTab() {
        await this.page.locator(this.darkModeTab).click();
        await this.page.waitForTimeout(300);
    }

    async getThemeCards() {
        return this.page.locator(this.themeCard).all();
    }

    async applyThemeByName(themeName) {
        const themeCard = this.page.locator(this.themeCard).filter({ hasText: themeName });
        await themeCard.locator(this.applyThemeBtn).click();
        await this.page.waitForTimeout(500);
    }

    async isThemeApplied(themeName) {
        const themeCard = this.page.locator(this.themeCard).filter({ hasText: themeName });
        const badge = themeCard.locator(this.appliedBadge);
        return await badge.isVisible();
    }

    async resetToDefaultTheme() {
        await this.page.locator(this.resetThemeBtn).click();
        await this.page.waitForTimeout(500);
    }

    // ==================== Custom Color Picker ====================

    async openCustomColorPicker() {
        // Ensure we're on the Light Mode tab where Custom Color is visible
        await this.selectLightModeTab();
        await this.page.waitForTimeout(500);

        // Click the color preview to open color picker dialog
        const colorPreview = this.page.locator(this.customColorPreview);
        await expect(colorPreview).toBeVisible({ timeout: 5000 });
        await colorPreview.click();
        await this.page.waitForTimeout(500);

        // Wait for color picker dialog to be visible
        await expect(this.page.locator(this.colorPickerDialog).first()).toBeVisible({ timeout: 10000 });
    }

    async closeColorPicker() {
        await this.page.locator(this.colorPickerClose).click();
        await this.page.waitForTimeout(300);
    }

    async applyCustomColor() {
        // Ensure we're on the Light Mode tab
        await this.selectLightModeTab();
        await this.page.waitForTimeout(500);

        // Find the custom color card and click Apply
        const customCard = this.page.locator(this.customColorCard);
        await expect(customCard).toBeVisible({ timeout: 5000 });
        await customCard.locator(this.applyThemeBtn).click();
        await this.page.waitForTimeout(500);
    }

    // ==================== General Settings ====================

    async clickLightThemeChip() {
        await this.page.locator(this.themeLightChip).click();
        await this.page.waitForTimeout(300);
    }

    async clickDarkThemeChip() {
        await this.page.locator(this.themeDarkChip).click();
        await this.page.waitForTimeout(300);
    }

    async resetThemeColorsInSettings() {
        await this.page.locator(this.resetThemeColorsBtn).click();
        await this.page.waitForTimeout(300);
    }

    async saveSettings() {
        await this.page.locator(this.saveSettingsBtn).click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(500);
    }

    async getLightThemeColor() {
        const chip = this.page.locator(this.themeLightChip);
        const colorText = await chip.locator('.chip-value').textContent();
        return colorText;
    }

    async getDarkThemeColor() {
        const chip = this.page.locator(this.themeDarkChip);
        const colorText = await chip.locator('.chip-value').textContent();
        return colorText;
    }

    // ==================== Assertions ====================

    async expectPredefinedThemesDialogVisible() {
        await expect(this.page.locator(this.predefinedThemesDialog)).toBeVisible();
    }

    async expectPredefinedThemesDialogHidden() {
        await expect(this.page.locator(this.predefinedThemesDialog)).not.toBeVisible();
    }

    async expectDarkMode() {
        const isDark = await this.isDarkMode();
        expect(isDark).toBe(true);
    }

    async expectLightMode() {
        const isLight = await this.isLightMode();
        expect(isLight).toBe(true);
    }

    async expectNotificationContains(text) {
        await expect(this.page.locator(this.notification)).toContainText(text, { timeout: 5000 });
    }

    async expectThemeLightChipVisible() {
        await expect(this.page.locator(this.themeLightChip)).toBeVisible();
    }

    async expectThemeDarkChipVisible() {
        await expect(this.page.locator(this.themeDarkChip)).toBeVisible();
    }

    // ==================== CSS Variable Checks ====================

    async getThemeColor() {
        return await this.page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--q-primary').trim();
        });
    }

    async getBackgroundColor() {
        return await this.page.evaluate(() => {
            return getComputedStyle(document.body).backgroundColor;
        });
    }
}
