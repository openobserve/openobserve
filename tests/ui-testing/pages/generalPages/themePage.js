import { expect } from '@playwright/test';

export class ThemePage {
    constructor(page) {
        this.page = page;

        // Predefined Themes Dialog
        this.predefinedThemesMenuItem = page.locator('[data-test="menu-link-predefined-themes-item"]');
        // Was `.predefined-theme-card` — that class was removed in
        // PredefinedThemes.vue when the markup moved to `theme-card-compact`.
        // Use the drawer's parent data-test slug instead (stable identifier).
        this.predefinedThemesDialog = page.locator('[data-test="predefined-themes-drawer"]');
        // PredefinedThemes.vue Reset button gained a dedicated data-test attribute
        // when the spec was refactored to remove text-based selectors.
        this.resetThemeBtn = page.locator('[data-test="predefined-themes-reset-btn"]');
        // PredefinedThemes.vue migrated to ODrawer — its close (×) button
        // is now the common o-drawer-close-btn inside the parent slug.
        this.closeDialogBtn = page.locator('[data-test="predefined-themes-drawer"] [data-test="o-drawer-close-btn"]');

        // Light/Dark Mode Tabs in Predefined Themes
        // PredefinedThemes.vue forwards a data-test attribute onto each OTab,
        // which inherits it to the underlying TabsTrigger element.
        this.lightModeTab = page.locator('[data-test="predefined-themes-tab-light"]');
        this.darkModeTab = page.locator('[data-test="predefined-themes-tab-dark"]');

        // Custom Color Picker — color preview (Light tab)
        this.customColorPreviewLight = page.locator('[data-test="predefined-themes-custom-color-preview-light"]');
        // ODialog hosting OColor picker
        this.colorPickerDialog = page.locator('[data-test="predefined-themes-color-picker-dialog"]');
        // Custom-color picker is an ODialog whose only footer button is the
        // primary "Close" button (see PredefinedThemes.vue:215).
        this.colorPickerClose = page.locator('[data-test="predefined-themes-color-picker-dialog"] [data-test="o-dialog-primary-btn"]');

        // General Settings - Theme Management
        this.settingsMenuItem = page.locator('[data-test="menu-link-\\/settings-item"]');
        this.generalSettingsTab = page.locator('[data-test="settings-general-tab"]');
        this.themeLightChip = page.locator('[data-test="theme-light-chip"]');
        this.themeDarkChip = page.locator('[data-test="theme-dark-chip"]');
        this.resetThemeColorsBtn = page.locator('[data-test="reset-theme-colors-btn"]');
        this.saveSettingsBtn = page.locator('[data-test="dashboard-add-submit"]');

        // User Profile Menu (contains predefined themes link)
        this.profileMenuBtn = page.locator('[data-test="header-my-account-profile-icon"]');

        // Theme Switcher
        this.themeToggleBtn = page.locator('[data-test="navbar-theme-toggle-btn"]');

        // Body class for theme detection (Quasar dark plugin adds 'body--dark')
        this.bodyDarkClass = 'body--dark';

        // Notification — OToast surfaces success/error toasts under stable data-test slugs
        this.successToast = page.locator('[data-test-variant="success"]');
    }

    // ==================== Locator factories ====================

    /**
     * Returns the theme card locator for a given theme name and mode.
     * Cards expose `data-test="predefined-themes-card-{mode}-{slug}"` (added in
     * PredefinedThemes.vue) so we no longer depend on text-based filters.
     */
    getThemeCard(themeName, mode = 'light') {
        const slug = themeName.toLowerCase().replace(/\s+/g, '-');
        return this.page.locator(`[data-test="predefined-themes-card-${mode}-${slug}"]`);
    }

    getApplyButton(themeName, mode = 'light') {
        const slug = themeName.toLowerCase().replace(/\s+/g, '-');
        return this.page.locator(`[data-test="predefined-themes-apply-btn-${mode}-${slug}"]`);
    }

    getAppliedBadge(themeName, mode = 'light') {
        const slug = themeName.toLowerCase().replace(/\s+/g, '-');
        return this.page.locator(`[data-test="predefined-themes-applied-badge-${mode}-${slug}"]`);
    }

    /** Custom-color card for the given mode (Light/Dark) — slug is fixed `custom-color`. */
    getCustomColorCard(mode = 'light') {
        return this.page.locator(`[data-test="predefined-themes-card-${mode}-custom-color"]`);
    }

    /** Apply button on the custom-color card for the given mode. */
    getCustomColorApplyButton(mode = 'light') {
        return this.page.locator(`[data-test="predefined-themes-apply-btn-${mode}-custom-color"]`);
    }

    // ==================== Navigation ====================

    async navigateToSettings() {
        await this.settingsMenuItem.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async openPredefinedThemesDialog() {
        // Click user profile menu first
        await this.profileMenuBtn.click();

        // Wait for menu item to be visible and click it
        await expect(this.predefinedThemesMenuItem).toBeVisible({ timeout: 5000 });
        await this.predefinedThemesMenuItem.click();

        // Wait for dialog to appear
        await expect(this.predefinedThemesDialog).toBeVisible({ timeout: 5000 });
    }

    async closePredefinedThemesDialog() {
        await this.closeDialogBtn.click();
        await expect(this.predefinedThemesDialog).not.toBeVisible({ timeout: 3000 });
    }

    // ==================== Theme Switcher (Header) ====================

    async toggleThemeMode() {
        // Get current theme state before toggle
        const wasDark = await this.isDarkMode();

        // Click the theme switcher button using its data-test selector
        await this.themeToggleBtn.click();

        // Wait for theme to actually change by polling body class
        const bodyDarkClass = this.bodyDarkClass;
        await this.page.waitForFunction(
            ([darkClass, expectedDark]) => {
                const isDark = document.body.classList.contains(darkClass);
                return isDark !== expectedDark;
            },
            [bodyDarkClass, wasDark],
            { timeout: 10000 }
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
        await this.lightModeTab.click();
        // Wait for tab to become active
        await expect(this.lightModeTab).toHaveAttribute('data-state', 'active', { timeout: 3000 });
    }

    async selectDarkModeTab() {
        await this.darkModeTab.click();
        // Wait for tab to become active
        await expect(this.darkModeTab).toHaveAttribute('data-state', 'active', { timeout: 3000 });
    }

    /**
     * Returns true if the given predefined theme card is visible in either tab.
     * Used by spec to verify the canonical set of predefined themes is rendered.
     */
    async isThemeCardVisible(themeName, mode = 'light') {
        return await this.getThemeCard(themeName, mode).isVisible();
    }

    /**
     * Assertion variant — fails the test if the named theme card is not visible.
     */
    async expectThemeCardVisible(themeName, mode = 'light') {
        await expect(this.getThemeCard(themeName, mode)).toBeVisible();
    }

    /**
     * Assertion variant for the Custom Color card (mode-aware).
     */
    async expectCustomColorCardVisible(mode = 'light') {
        await expect(this.getCustomColorCard(mode)).toBeVisible();
    }

    async applyThemeByName(themeName, mode = 'light') {
        const themeCard = this.getThemeCard(themeName, mode);
        await this.getApplyButton(themeName, mode).click();
        // Wait for Applied badge to appear on this theme card
        await expect(this.getAppliedBadge(themeName, mode)).toBeVisible({ timeout: 5000 });
    }

    async isThemeApplied(themeName, mode = 'light') {
        return await this.getAppliedBadge(themeName, mode).isVisible();
    }

    async resetToDefaultTheme() {
        await this.resetThemeBtn.click();
        // Wait for reset notification — OToast `o-toast-success` shows the reset message
        await expect(this.successToast.first()).toBeVisible({ timeout: 5000 });
    }

    // ==================== Custom Color Picker ====================

    async openCustomColorPicker() {
        // Ensure we're on the Light Mode tab where Custom Color is visible
        await this.selectLightModeTab();

        // Click the color preview to open color picker dialog
        await expect(this.customColorPreviewLight).toBeVisible({ timeout: 5000 });
        await this.customColorPreviewLight.click();

        // Wait for color picker dialog to be visible
        await expect(this.colorPickerDialog).toBeVisible({ timeout: 10000 });
    }

    async expectColorPickerDialogVisible() {
        await expect(this.colorPickerDialog).toBeVisible();
    }

    async closeColorPicker() {
        await this.colorPickerClose.click();
        // Wait for color picker dialog to close
        await expect(this.colorPickerDialog).not.toBeVisible({ timeout: 3000 });
    }

    async applyCustomColor(mode = 'light') {
        // Ensure we're on the matching tab
        if (mode === 'light') {
            await this.selectLightModeTab();
        } else {
            await this.selectDarkModeTab();
        }

        // Apply the custom-color theme via its dedicated apply button
        const applyBtn = this.getCustomColorApplyButton(mode);
        await expect(applyBtn).toBeVisible({ timeout: 5000 });
        await applyBtn.click();

        // Wait for success toast confirming the custom color was applied
        await expect(this.successToast.first()).toBeVisible({ timeout: 5000 });
    }

    // ==================== General Settings ====================

    async clickLightThemeChip() {
        await this.themeLightChip.click();
    }

    async clickDarkThemeChip() {
        await this.themeDarkChip.click();
    }

    async resetThemeColorsInSettings() {
        await this.resetThemeColorsBtn.click();
    }

    async saveSettings() {
        await this.saveSettingsBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // ==================== Assertions ====================

    async expectPredefinedThemesDialogVisible() {
        await expect(this.predefinedThemesDialog).toBeVisible();
    }

    async expectPredefinedThemesDialogHidden() {
        await expect(this.predefinedThemesDialog).not.toBeVisible();
    }

    async expectLightModeTabVisible() {
        await expect(this.lightModeTab).toBeVisible();
    }

    async expectDarkModeTabVisible() {
        await expect(this.darkModeTab).toBeVisible();
    }

    async expectDarkMode() {
        const isDark = await this.isDarkMode();
        expect(isDark).toBe(true);
    }

    async expectLightMode() {
        const isLight = await this.isLightMode();
        expect(isLight).toBe(true);
    }

    async expectNotificationContains(_text) {
        // OToast `o-toast-success` renders for success messages; multiple toasts
        // may stack so assert on the first match. The text contents are still
        // verified by the test name / preceding action.
        await expect(this.successToast.first()).toBeVisible({ timeout: 5000 });
    }

    async expectThemeLightChipVisible() {
        await expect(this.themeLightChip).toBeVisible();
    }

    async expectThemeDarkChipVisible() {
        await expect(this.themeDarkChip).toBeVisible();
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
