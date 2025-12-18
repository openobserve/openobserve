// homePage.js - Landing Page Object for OpenObserve
import { expect } from '@playwright/test';

export class HomePage {
    constructor(page) {
        this.page = page;

        // ===== NAVIGATION MENU SELECTORS (VERIFIED) =====
        this.homePageMenu = page.locator('[data-test="menu-link-\\/-item"]');
        this.logsMenu = page.locator('[data-test="menu-link-\\/logs-item"]');
        this.metricsMenu = page.locator('[data-test="menu-link-\\/metrics-item"]');
        this.tracesMenu = page.locator('[data-test="menu-link-\\/traces-item"]');
        this.rumMenu = page.locator('[data-test="menu-link-\\/rum-item"]');
        this.dashboardsMenu = page.locator('[data-test="menu-link-\\/dashboards-item"]');
        this.streamsMenu = page.locator('[data-test="menu-link-\\/streams-item"]');
        this.alertsMenu = page.locator('[data-test="menu-link-\\/alerts-item"]');
        this.ingestionMenu = page.locator('[data-test="menu-link-\\/ingestion-item"]');
        this.iamMenu = page.locator('[data-test="menu-link-\\/iam-item"]');
        this.reportsMenu = page.locator('[data-test="menu-link-\\/reports-item"]');

        // ===== HEADER SELECTORS (VERIFIED) =====
        this.orgSelector = page.locator('[data-test="navbar-organizations-select"]');
        this.orgMenuList = page.locator('[data-test="organization-menu-list"]');
        this.orgSearchInput = page.locator('[data-test="organization-search-input"]');
        this.orgMenuItemLabel = page.locator('[data-test="organization-menu-item-label-item-label"]');
        this.orgNoData = page.locator('[data-test="organization-menu-no-data"]');

        this.slackButton = page.locator('[data-test="menu-link-slack-item"]');
        this.helpButton = page.locator('[data-test="menu-link-help-item"]');
        this.aboutLink = page.locator('[data-test="menu-link-about-item"]');
        this.settingsButton = page.locator('[data-test="menu-link-settings-item"]');
        this.profileIcon = page.locator('[data-test="header-my-account-profile-icon"]');
        this.languageDropdown = page.locator('[data-test="language-dropdown-item"]');
        this.themeManager = page.locator('[data-test="menu-link-predefined-themes-item"]');
        this.logoutButton = page.locator('[data-test="menu-link-logout-item"]');
        this.aiChatButton = page.locator('[data-test="menu-link-ai-item"]');

        // ===== THEME SWITCHER SELECTORS =====
        // Note: ThemeSwitcher component doesn't have data-test attribute
        // Using tooltip-based identification
        this.themeSwitcherButton = page.getByRole('button', { name: /Switch to (Dark|Light) Mode/i });
        this.themeSwitcherByTooltipDark = page.locator('button').filter({ has: page.locator('[class*="header-icon"]') }).filter({ has: page.getByText('Switch to Dark Mode') });
        this.themeSwitcherByTooltipLight = page.locator('button').filter({ has: page.locator('[class*="header-icon"]') }).filter({ has: page.getByText('Switch to Light Mode') });

        // ===== HOME PAGE CONTENT SELECTORS (CSS-based) =====
        this.mainContent = page.getByRole('main');
        this.streamsSection = page.locator('.section-header:has-text("Streams")');
        this.noDataCard = page.locator('.my-card');
        this.ingestionButton = page.getByRole('button', { name: 'Find Ingestion' });

        // Logo
        this.logo = page.locator('.openobserve-logo');

        // ===== PAGE LOAD INDICATORS (for verifying navigation completed) =====
        this.logsPageIndicator = page.locator('[data-test="logs-search-bar-refresh-btn"]').or(page.locator('[data-test="log-table-column-0-source"]')).first();
        this.streamsPageIndicator = page.locator('[data-test="streams-search-stream-input"]').or(page.locator('[data-test="stream-add-stream-btn"]')).first();
        this.dashboardsPageIndicator = page.locator('[data-test="dashboard-add"]').or(page.getByText('Dashboards')).first();
        this.alertsPageIndicator = page.locator('[data-test="alerts-page"]').or(page.getByRole('tab', { name: 'Alerts' })).first();
        this.metricsPageIndicator = page.locator('[data-test="metrics-search-bar-refresh-btn"]').or(page.getByText('Query')).first();
        this.tracesPageIndicator = page.locator('[data-test="traces-search-bar-refresh-btn"]').or(page.getByText('Query')).first();
        this.ingestionPageIndicator = page.locator('[data-test="ingestion-page"]').or(page.getByText('Custom')).or(page.getByText('Logs')).first();
        this.settingsPageIndicator = page.locator('[data-test="settings-page"]').or(page.getByText('General Settings')).first();

        // ===== ADDITIONAL PAGE INDICATORS =====
        this.rumPageIndicator = page.locator('[data-test="rum-tabs"]').or(page.getByText('Web Vitals')).or(page.getByText('Sessions')).first();
        this.reportsPageIndicator = page.locator('[data-test="report-list-add-report-btn"]').or(page.getByText('Scheduled')).first();
        this.iamPageIndicator = page.locator('[data-test="iam-users-tab"]').or(page.getByRole('tab', { name: 'Users' })).first();
        this.pipelinesPageIndicator = page.locator('[data-test="function-list-add-function-btn"]').or(page.getByText('Functions')).first();
        this.homePageIndicator = page.locator('.home-page').or(page.getByText('Streams')).first();
    }

    // ===== NAVIGATION METHODS =====

    async gotoHomePage() {
        await this.homePageMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.homePageMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToLogs() {
        await this.logsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.logsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToMetrics() {
        await this.metricsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.metricsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToTraces() {
        await this.tracesMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.tracesMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToDashboards() {
        await this.dashboardsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.dashboardsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToStreams() {
        await this.streamsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.streamsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToAlerts() {
        await this.alertsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.alertsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToIngestion() {
        await this.ingestionMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.ingestionMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToSettings() {
        await this.settingsButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.settingsButton.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToRum() {
        await this.rumMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.rumMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToReports() {
        await this.reportsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.reportsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToIam() {
        await this.iamMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.iamMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ===== VALIDATION METHODS =====

    async homePageValidation() {
        await expect(this.mainContent).toContainText('Streams');
        await expect(this.mainContent).toContainText('Function');
        await expect(this.mainContent).toContainText('Scheduled');
    }

    async validateNavigationMenuVisible() {
        await expect(this.homePageMenu).toBeVisible();
        await expect(this.logsMenu).toBeVisible();
        await expect(this.metricsMenu).toBeVisible();
        await expect(this.tracesMenu).toBeVisible();
        await expect(this.dashboardsMenu).toBeVisible();
        await expect(this.streamsMenu).toBeVisible();
        await expect(this.alertsMenu).toBeVisible();
        await expect(this.ingestionMenu).toBeVisible();
    }

    async validateHeaderElementsVisible() {
        await expect(this.orgSelector).toBeVisible();
        await expect(this.slackButton).toBeVisible();
        await expect(this.helpButton).toBeVisible();
        await expect(this.settingsButton).toBeVisible();
        await expect(this.profileIcon).toBeVisible();
    }

    async validateHomeDashboardElements() {
        // Wait for page to load
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Check if we have data or no-data state
        const noDataVisible = await this.noDataCard.isVisible().catch(() => false);

        if (noDataVisible) {
            // No data state
            await expect(this.mainContent).toContainText('No data');
            await expect(this.ingestionButton).toBeVisible();
        } else {
            // Data state - validate tiles
            await expect(this.mainContent).toContainText('Streams');
            await expect(this.mainContent).toContainText('Events');
            await expect(this.mainContent).toContainText('Function');
            await expect(this.mainContent).toContainText('Dashboard');
        }
    }

    async validateLogoVisible() {
        await expect(this.logo).toBeVisible();
    }

    // ===== ORGANIZATION METHODS =====

    async openOrgSelector() {
        await this.orgSelector.click();
        await this.page.waitForTimeout(500);
    }

    async selectOrganization(orgName) {
        await this.openOrgSelector();

        // Search for the organization
        await this.orgSearchInput.fill(orgName);
        await this.page.waitForTimeout(1000);

        // Click the first matching organization
        await this.orgMenuItemLabel.first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async homePageDefaultOrg() {
        await this.orgSelector.getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
    }

    async homePageURLValidationDefaultOrg() {
        await expect(this.page).toHaveURL(/default/);
    }

    async homePageDefaultMultiOrg() {
        await this.page.waitForTimeout(5000);
        await this.page.reload();
        await this.orgSelector.getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(5000);
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async homePageURLValidation() {
        await expect(this.page).not.toHaveURL(/default/);
    }

    async homePageOrg(orgName) {
        await this.page.waitForTimeout(5000);
        await this.page.reload();
        await this.orgSelector.getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(5000);

        // Search for the organization
        await this.orgSearchInput.fill(orgName);
        await this.page.waitForTimeout(2000);

        // Click the organization from search results
        await this.orgMenuItemLabel.first().click();
    }

    async homeURLContains(orgNameIdentifier) {
        const expectedURLPart = `org_identifier=${orgNameIdentifier}`;
        const currentURL = this.page.url();
        await expect(currentURL).toContain(expectedURLPart);
    }

    async clickDefaultOrg() {
        await this.page.getByText('arrow_drop_down').first().click();

        const optionsSelector = '[data-test="organization-menu-item-label-item-label"]';
        try {
            await this.page.waitForSelector(optionsSelector, { state: 'visible', timeout: 60000 });
        } catch (error) {
            console.error('Dropdown options did not become visible:', error);
            return;
        }

        const optionsCount = await this.page.locator(optionsSelector).count();
        console.log(`Number of options visible: ${optionsCount}`);

        const defaultOption = this.page.locator(optionsSelector).filter({ hasText: 'default' }).first();

        try {
            await defaultOption.waitFor({ state: 'visible', timeout: 60000 });
            await defaultOption.click();
            console.log('Clicked the default option successfully.');
        } catch (error) {
            console.error('Default option is not visible or clickable:', error);
            return;
        }

        await this.page.getByText('arrow_drop_down').first().click();
    }

    // ===== HELP MENU METHODS =====

    async openHelpMenu() {
        await this.helpButton.click();
        await this.page.waitForTimeout(500);
    }

    async navigateToAbout() {
        await this.openHelpMenu();
        await this.aboutLink.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ===== PROFILE MENU METHODS =====

    async openProfileMenu() {
        await this.profileIcon.click();
        await this.page.waitForTimeout(500);
    }

    async logout() {
        await this.openProfileMenu();
        await this.logoutButton.click();
    }

    async openThemeManager() {
        await this.openProfileMenu();
        await this.themeManager.click();
    }

    // ===== CLICK METHODS FOR EXTERNAL LINKS =====

    async clickSlackButton() {
        // Slack opens in new tab, so we need to handle the popup
        const [newPage] = await Promise.all([
            this.page.context().waitForEvent('page'),
            this.slackButton.click()
        ]);
        return newPage;
    }

    // ===== LANGUAGE SELECTION METHODS =====

    /**
     * Get locator for a specific language option by language code
     * The data-test attribute is on q-item-section, so we need to find the parent clickable q-item
     * @param {string} langCode - Language code (e.g., 'en-gb', 'de', 'es', 'fr', etc.)
     * @returns {Locator} - Playwright locator for the language option
     */
    getLanguageOption(langCode) {
        // The data-test is on q-item-section, find the parent q-item that's clickable
        return this.page.locator(`[data-test="language-dropdown-item-${langCode}"]`).locator('xpath=ancestor::div[contains(@class, "q-item")]').first();
    }

    /**
     * Get the language menu item row in the profile dropdown
     * This is the row that shows "Language" with an arrow to open the submenu
     */
    getLanguageMenuItem() {
        // Find the q-item that contains "Language" text
        // This item has the language text and the selected-lang-label showing current language
        return this.page.locator('.q-item').filter({ hasText: 'Language' }).filter({ has: this.page.locator('.selected-lang-label') }).first();
    }

    /**
     * Opens the language selection submenu
     * Steps: Click profile icon -> Click on language item to open submenu
     * Note: Quasar menus require click, not hover, to open nested menus
     */
    async openLanguageMenu() {
        await this.openProfileMenu();
        await this.page.waitForTimeout(500);

        // Click on the language menu item to open the submenu
        const languageMenuItem = this.getLanguageMenuItem();
        await languageMenuItem.waitFor({ state: 'visible', timeout: 5000 });
        await languageMenuItem.click();
        await this.page.waitForTimeout(500);

        // Wait for a language option to be visible (confirming submenu opened)
        const firstLangOption = this.page.locator('[data-test^="language-dropdown-item-"]').first();
        await firstLangOption.waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Change the application language
     * @param {string} langCode - Language code to switch to
     * Valid codes: 'en-gb', 'tr-turk', 'zh-cn', 'fr', 'es', 'de', 'it', 'ja', 'ko', 'nl', 'pt'
     */
    async changeLanguage(langCode) {
        await this.openLanguageMenu();

        // Click directly on the element with data-test, or its parent q-item
        const langOption = this.page.locator(`[data-test="language-dropdown-item-${langCode}"]`);
        await langOption.waitFor({ state: 'visible', timeout: 5000 });

        // Click on the parent clickable item
        await langOption.click();

        // Page will reload after language change
        await this.page.waitForLoadState('load', { timeout: 30000 });
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    /**
     * Get the currently selected language label from the header
     * @returns {Promise<string>} - The current language label (e.g., 'English', 'Deutsch')
     */
    async getCurrentLanguageLabel() {
        await this.openProfileMenu();
        await this.page.waitForTimeout(500);

        const selectedLangLabel = this.page.locator('.selected-lang-label');
        await selectedLangLabel.waitFor({ state: 'visible', timeout: 5000 });
        const text = await selectedLangLabel.textContent();
        await this.page.keyboard.press('Escape');
        return text?.trim() || '';
    }

    /**
     * Check if a specific language option is visible in the language submenu
     * @param {string} langCode - Language code to check
     * @returns {Promise<boolean>} - Whether the language option is visible
     */
    async isLanguageOptionVisible(langCode) {
        const langOption = this.getLanguageOptionLocator(langCode);
        return await langOption.isVisible();
    }

    /**
     * Get locator for a specific language option (simple, direct locator)
     * @param {string} langCode - Language code (e.g., 'en-gb', 'de', 'es', 'fr', etc.)
     * @returns {Locator} - Playwright locator for the language option
     */
    getLanguageOptionLocator(langCode) {
        return this.page.locator(`[data-test="language-dropdown-item-${langCode}"]`);
    }

    /**
     * Verify specific language options are visible in the submenu
     * @param {string[]} langCodes - Array of language codes to verify
     */
    async verifyLanguageOptionsVisible(langCodes) {
        for (const langCode of langCodes) {
            const langOption = this.getLanguageOptionLocator(langCode);
            await expect(langOption).toBeVisible({ timeout: 3000 });
        }
    }

    /**
     * Verify that text on the page matches expected language
     * @param {string} expectedText - Text expected to be found on page in the target language
     */
    async verifyLanguageText(expectedText) {
        await expect(this.page.locator('body')).toContainText(expectedText, { timeout: 10000 });
    }

    /**
     * Available language codes mapped to their labels
     */
    static LANGUAGES = {
        'en-gb': { label: 'English', menuText: 'Home' },
        'de': { label: 'Deutsch', menuText: 'Startseite' },
        'es': { label: 'Español', menuText: 'Inicio' },
        'fr': { label: 'Français', menuText: 'Accueil' },
        'it': { label: 'Italiano', menuText: 'Home' },
        'ja': { label: '日本語', menuText: 'ホーム' },
        'ko': { label: '한국어', menuText: '홈' },
        'nl': { label: 'Nederlands', menuText: 'Home' },
        'pt': { label: 'Português', menuText: 'Início' },
        'tr-turk': { label: 'Türkçe', menuText: 'Ana Sayfa' },
        'zh-cn': { label: '简体中文', menuText: '首页' }
    };

    // ===== THEME SWITCHING METHODS =====

    /**
     * Check if the application is currently in dark mode
     * @returns {Promise<boolean>} - True if dark mode is active
     */
    async isDarkMode() {
        const bodyClass = await this.page.locator('body').getAttribute('class');
        return bodyClass?.includes('body--dark') ?? false;
    }

    /**
     * Get the current theme from localStorage
     * @returns {Promise<string>} - 'light' or 'dark'
     */
    async getCurrentThemeFromStorage() {
        return await this.page.evaluate(() => localStorage.getItem('theme') || 'light');
    }

    /**
     * Click the theme switcher button in the header
     * The button is located between org selector and Slack button
     */
    async clickThemeSwitcher() {
        // Wait for the header to be loaded
        await this.page.waitForLoadState('domcontentloaded');

        // Find the theme switcher button by its position in header
        // It's a button with a header-icon that shows light_mode or dark_mode icon
        const themeSwitcher = this.page.locator('.q-toolbar button').filter({
            has: this.page.locator('.header-icon')
        }).nth(0); // First button with header-icon after toolbar title

        // Alternative: Find by the icon name in the button
        const lightModeBtn = this.page.locator('button:has(.header-icon)').filter({
            has: this.page.locator('i.q-icon')
        });

        // Try to find the theme switcher using multiple strategies
        // Strategy 1: Look for the button near the Slack button
        const slackBtn = this.page.locator('[data-test="menu-link-slack-item"]');
        await slackBtn.waitFor({ state: 'visible', timeout: 10000 });

        // The theme switcher is the button immediately before Slack button
        // Find all buttons in header-menu and get the one before Slack
        const headerButtons = this.page.locator('.header-menu button, .header-menu .q-btn');
        const buttonCount = await headerButtons.count();

        // Find Slack button index and click the button before it
        for (let i = 0; i < buttonCount; i++) {
            const btn = headerButtons.nth(i);
            const dataTest = await btn.getAttribute('data-test');
            if (dataTest === 'menu-link-slack-item') {
                // Theme switcher is the button before Slack (i-1)
                if (i > 0) {
                    const themeSwitcherBtn = headerButtons.nth(i - 1);
                    await themeSwitcherBtn.click();
                    return;
                }
            }
        }

        // Fallback: try clicking by tooltip role
        const themeBtn = this.page.getByRole('button').filter({
            hasText: /light_mode|dark_mode/i
        }).first();

        if (await themeBtn.isVisible()) {
            await themeBtn.click();
        }
    }

    /**
     * Toggle theme from light to dark or vice versa
     * @returns {Promise<string>} - The new theme after toggle ('light' or 'dark')
     */
    async toggleTheme() {
        const currentTheme = await this.isDarkMode();
        await this.clickThemeSwitcher();

        // Wait for theme to change
        await this.page.waitForTimeout(500);

        const newTheme = await this.isDarkMode();
        return newTheme ? 'dark' : 'light';
    }

    /**
     * Switch to dark mode (if not already in dark mode)
     */
    async switchToDarkMode() {
        const isDark = await this.isDarkMode();
        if (!isDark) {
            await this.clickThemeSwitcher();
            await this.page.waitForTimeout(500);
        }
        await expect(this.page.locator('body')).toHaveClass(/body--dark/);
    }

    /**
     * Switch to light mode (if not already in light mode)
     */
    async switchToLightMode() {
        const isDark = await this.isDarkMode();
        if (isDark) {
            await this.clickThemeSwitcher();
            await this.page.waitForTimeout(500);
        }
        await expect(this.page.locator('body')).not.toHaveClass(/body--dark/);
    }

    /**
     * Verify theme is correctly applied
     * @param {string} expectedTheme - 'light' or 'dark'
     */
    async verifyTheme(expectedTheme) {
        if (expectedTheme === 'dark') {
            await expect(this.page.locator('body')).toHaveClass(/body--dark/);
        } else {
            await expect(this.page.locator('body')).not.toHaveClass(/body--dark/);
        }

        // Also verify localStorage
        const storageTheme = await this.getCurrentThemeFromStorage();
        await expect(storageTheme).toBe(expectedTheme);
    }

    /**
     * Set theme to a specific mode
     * @param {string} theme - 'light' or 'dark'
     */
    async setTheme(theme) {
        if (theme === 'dark') {
            await this.switchToDarkMode();
        } else {
            await this.switchToLightMode();
        }
    }
}
