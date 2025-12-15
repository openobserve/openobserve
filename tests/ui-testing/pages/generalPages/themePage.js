import { expect } from '@playwright/test';

export class ThemePage {
    constructor(page) {
        this.page = page;

        // Predefined Themes Dialog
        this.predefinedThemesMenuItem = '[data-test="menu-link-predefined-themes-item"]';
        this.predefinedThemesDialog = '.predefined-theme-card';
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
    }

    async openPredefinedThemesDialog() {
        // Click user profile menu first
        await this.page.locator(this.profileMenuBtn).click();

        // Wait for menu item to be visible and click it
        const menuItem = this.page.locator(this.predefinedThemesMenuItem);
        await expect(menuItem).toBeVisible({ timeout: 5000 });
        await menuItem.click();

        // Wait for dialog to appear
        await expect(this.page.locator(this.predefinedThemesDialog)).toBeVisible({ timeout: 5000 });
    }

    async closePredefinedThemesDialog() {
        await this.page.locator(this.closeDialogBtn).click();
        await expect(this.page.locator(this.predefinedThemesDialog)).not.toBeVisible({ timeout: 3000 });
    }

    // ==================== Theme Switcher (Header) ====================

    async toggleThemeMode() {
        // Get current theme state before toggle
        const wasDark = await this.isDarkMode();

        // Find and click the theme switcher button in header
        const themeSwitcher = this.page.locator('button.q-btn--rounded.q-btn--flat').filter({
            has: this.page.locator('.q-icon.header-icon')
        }).first();
        await themeSwitcher.click();

        // Wait for theme to actually change by polling body class
        const bodyDarkClass = this.bodyDarkClass;
        await this.page.waitForFunction(
            ([darkClass, expectedDark]) => {
                const isDark = document.body.classList.contains(darkClass);
                return isDark !== expectedDark;
            },
            [bodyDarkClass, wasDark],
            { timeout: 5000 }
        );
    }

    async isDarkMode() {
        const bodyDarkClass = this.bodyDarkClass;
        return await this.page.evaluate((darkClass) => document.body.classList.contains(darkClass), bodyDarkClass);
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
        const tab = this.page.locator(this.lightModeTab);
        await tab.click();
        // Wait for tab to become active
        await expect(tab).toHaveClass(/q-tab--active/, { timeout: 3000 });
    }

    async selectDarkModeTab() {
        const tab = this.page.locator(this.darkModeTab);
        await tab.click();
        // Wait for tab to become active
        await expect(tab).toHaveClass(/q-tab--active/, { timeout: 3000 });
    }

    async getThemeCards() {
        return this.page.locator(this.themeCard).all();
    }

    async applyThemeByName(themeName) {
        const themeCard = this.page.locator(this.themeCard).filter({ hasText: themeName });
        await themeCard.locator(this.applyThemeBtn).click();
        // Wait for Applied badge to appear on this theme card
        await expect(themeCard.locator(this.appliedBadge)).toBeVisible({ timeout: 5000 });
    }

    async isThemeApplied(themeName) {
        const themeCard = this.page.locator(this.themeCard).filter({ hasText: themeName });
        const badge = themeCard.locator(this.appliedBadge);
        return await badge.isVisible();
    }

    async resetToDefaultTheme() {
        await this.page.locator(this.resetThemeBtn).click();
        // Wait for reset notification (filter by text as multiple notifications may exist)
        await expect(this.page.locator(this.notification).filter({ hasText: 'reset' })).toBeVisible({ timeout: 5000 });
    }

    // ==================== Custom Color Picker ====================

    async openCustomColorPicker() {
        // Ensure we're on the Light Mode tab where Custom Color is visible
        await this.selectLightModeTab();

        // Click the color preview to open color picker dialog
        const colorPreview = this.page.locator(this.customColorPreview);
        await expect(colorPreview).toBeVisible({ timeout: 5000 });
        await colorPreview.click();

        // Wait for color picker dialog to be visible
        await expect(this.page.locator(this.colorPickerDialog).first()).toBeVisible({ timeout: 10000 });
    }

    async closeColorPicker() {
        await this.page.locator(this.colorPickerClose).click();
        // Wait for color picker dialog to close
        await expect(this.page.locator(this.colorPickerDialog).first()).not.toBeVisible({ timeout: 3000 });
    }

    async applyCustomColor() {
        // Ensure we're on the Light Mode tab
        await this.selectLightModeTab();

        // Find the custom color card and click Apply
        const customCard = this.page.locator(this.customColorCard);
        await expect(customCard).toBeVisible({ timeout: 5000 });
        await customCard.locator(this.applyThemeBtn).click();
        // Wait for notification to confirm application (filter by text as multiple notifications may exist)
        await expect(this.page.locator(this.notification).filter({ hasText: 'Custom' })).toBeVisible({ timeout: 5000 });
    }

    // ==================== General Settings ====================

    async clickLightThemeChip() {
        await this.page.locator(this.themeLightChip).click();
    }

    async clickDarkThemeChip() {
        await this.page.locator(this.themeDarkChip).click();
    }

    async resetThemeColorsInSettings() {
        await this.page.locator(this.resetThemeColorsBtn).click();
    }

    async saveSettings() {
        await this.page.locator(this.saveSettingsBtn).click();
        await this.page.waitForLoadState('domcontentloaded');
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
        // Filter to get notification containing the expected text (multiple notifications may be present)
        await expect(this.page.locator(this.notification).filter({ hasText: text })).toBeVisible({ timeout: 5000 });
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
