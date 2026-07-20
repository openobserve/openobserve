// homePage.js - Landing Page Object for OpenObserve
import { expect } from '@playwright/test';
import { openNavFlyoutChild, gotoMetricsEditor } from '../commonActions.js';

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
        this.iamMenu = page.locator('[data-test="menu-link-\\/iam-item"]');

        // ===== HEADER SELECTORS (VERIFIED) =====
        this.orgSelector = page.locator('[data-test="navbar-organizations-select"]');
        this.orgMenuList = page.locator('[data-test="organization-menu-list"]');
        // OInput wrapper resolves to <div>; fill the inner native input via -field suffix (§4).
        this.orgSearchInput = page.locator('[data-test="organization-search-input-field"]');
        this.orgSearchInputWrapper = page.locator('[data-test="organization-search-input"]');
        this.orgMenuItemLabel = page.locator('[data-test="organization-menu-item-label-item-label"]');
        this.orgNoData = page.locator('[data-test="organization-menu-no-data"]');
        // Per-identifier org row — exposed by Header.vue as `:data-test-org-identifier`.
        // Use this to deterministically click the freshly-created org instead of
        // relying on `.first()` racing against the OInput debounce + OTable filter.
        this.getOrgMenuItemByIdentifier = (identifier) =>
            page.locator(`[data-test-org-identifier="${identifier}"]`);

        this.slackButton = page.locator('[data-test="menu-link-slack-item"]');
        this.helpButton = page.locator('[data-test="menu-link-help-item"]');
        this.aboutLink = page.locator('[data-test="menu-link-about-item"]');
        this.settingsButton = page.locator('[data-test="menu-link-/settings-item"]');
        this.profileIcon = page.locator('[data-test="header-my-account-profile-icon"]');
        this.languageDropdown = page.locator('[data-test="language-dropdown-item"]');
        this.themeManager = page.locator('[data-test="menu-link-predefined-themes-item"]');
        this.logoutButton = page.locator('[data-test="menu-link-logout-item"]');
        this.aiChatButton = page.locator('[data-test="menu-link-ai-item"]');

        // ===== THEME SWITCHER SELECTORS =====
        // ThemeSwitcher button lives in the header toolbar. The OButton renders as a
        // native <button> with data-test forwarded — use the dedicated data-test.
        this.themeSwitcherButton = page.locator('[data-test="navbar-theme-toggle-btn"]');

        // ===== HOME PAGE CONTENT SELECTORS =====
        this.mainContent = page.locator('[data-test="main-content"]');

        // Logo (data-test attribute in Header.vue)
        this.logo = page.locator('[data-test="header-openobserve-logo"]').first();

        // ===== PAGE LOAD INDICATORS (for verifying navigation completed) =====
        this.logsPageIndicator = page.locator('[data-test="logs-search-bar-refresh-btn"]').or(page.locator('[data-test="log-table-column-0-source"]')).first();
        this.streamsPageIndicator = page.locator('[data-test="streams-search-stream-input"]').or(page.locator('[data-test="stream-add-stream-btn"]')).first();
        this.dashboardsPageIndicator = page.locator('[data-test="dashboard-new"]').or(page.locator('[data-test="dashboard-table"]')).first();
        this.alertsPageIndicator = page.locator('[data-test="alert-list-page"]').or(page.locator('[data-test="alerts-page"]')).first();
        this.metricsPageIndicator = page.locator('[data-test="metrics-page"]').or(page.locator('[data-test="metrics-apply"]')).first();
        this.tracesPageIndicator = page.locator('[data-test="traces-search-bar-refresh-btn"]').or(page.locator('[data-test="logs-search-bar-refresh-btn"]')).first();
        this.ingestionPageIndicator = page.locator('[data-test="ingestion-page"]').or(page.locator('[data-test="recommended-list-search-input"]')).first();
        this.settingsPageIndicator = page.locator('[data-test="settings-general-page-title"]').or(page.locator('button[data-test="general-settings-tab"]')).first();

        // ===== ADDITIONAL PAGE INDICATORS =====
        this.rumPageIndicator = page.locator('[data-test="rum-tabs"]').first();
        this.reportsPageIndicator = page.locator('[data-test="report-list-add-report-btn"]').first();
        this.iamPageIndicator = page.locator('[data-test="iam-users-tab"]').first();
        this.pipelinesPageIndicator = page.locator('[data-test="function-list-add-function-btn"]').first();
        this.homePageIndicator = page.locator('[data-test="home-page"]').first();

        // ===== FAVICON SELECTOR (Bug #9217) =====
        this.faviconLink = page.locator('link#favicon');
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

    /**
     * Clicks the sidebar's Metrics item — which is what this page object's
     * callers are testing — and then continues into the panel EDITOR, whose
     * controls `validateMetricsPageElements` asserts on.
     *
     * The sidebar now lands on the Metrics Explorer browse grid (`/metrics`);
     * the editor moved to `/metrics/editor`. Both hops are kept so the sidebar
     * link itself stays covered rather than being bypassed by a direct goto.
     */
    async navigateToMetrics() {
        await this.metricsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.metricsMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await gotoMetricsEditor(this.page);
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
        await openNavFlyoutChild(this.page, 'ingestion');
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
        await openNavFlyoutChild(this.page, 'reports');
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToIam() {
        await this.iamMenu.waitFor({ state: 'visible', timeout: 10000 });
        await this.iamMenu.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ===== VALIDATION METHODS =====

    async homePageValidation() {
        await expect(this.homePageIndicator).toBeVisible({ timeout: 10000 });
    }

    async validateNavigationMenuVisible() {
        await expect(this.homePageMenu).toBeVisible();
        await expect(this.logsMenu).toBeVisible();
        await expect(this.metricsMenu).toBeVisible();
        await expect(this.tracesMenu).toBeVisible();
        await expect(this.dashboardsMenu).toBeVisible();
        await expect(this.streamsMenu).toBeVisible();
        await expect(this.alertsMenu).toBeVisible();
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
        await expect(this.homePageIndicator).toBeVisible({ timeout: 10000 });
    }

    async validateLogoVisible() {
        await expect(this.logo).toBeVisible();
    }

    // ===== ORGANIZATION METHODS =====

    async openOrgSelector() {
        await this.orgSelector.click();
        // Wait for the org menu list to be visible — confirms the popover is open.
        await this.orgMenuList.waitFor({ state: 'visible', timeout: 5000 });
    }

    async selectOrganization(orgName) {
        await this.openOrgSelector();

        // Search for the organization
        await this.orgSearchInput.fill(orgName);
        // Wait for the result row to render before clicking.
        await this.orgMenuItemLabel.first().waitFor({ state: 'visible', timeout: 5000 });

        // Click the first matching organization
        await this.orgMenuItemLabel.first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async homePageDefaultOrg() {
        await this.orgSelector.click();
        await this.orgMenuList.waitFor({ state: 'visible', timeout: 10000 });
        // Find the "default" row by its label cell text using a data-test scoped lookup.
        await this.orgSearchInput.fill('default');
        await this.orgMenuItemLabel.first().waitFor({ state: 'visible', timeout: 10000 });
        await this.orgMenuItemLabel.first().click();
    }

    async homePageURLValidationDefaultOrg() {
        await expect(this.page).toHaveURL(/default/);
    }

    async homePageDefaultMultiOrg() {
        await this.page.reload();
        await this.orgSelector.waitFor({ state: 'visible', timeout: 10000 });
        await this.orgSelector.click();
        await this.orgMenuList.waitFor({ state: 'visible', timeout: 10000 });
        await this.orgSearchInput.fill('defaulttestmulti');
        await this.orgMenuItemLabel.first().waitFor({ state: 'visible', timeout: 10000 });
        await this.orgMenuItemLabel.first().click();
    }

    async homePageURLValidation() {
        await expect(this.page).not.toHaveURL(/default/);
    }

    async homePageOrg(orgName, orgIdentifier) {
        await this.page.reload();
        await this.orgSelector.waitFor({ state: 'visible', timeout: 10000 });
        await this.orgSelector.click();
        await this.orgMenuList.waitFor({ state: 'visible', timeout: 10000 });

        // Search for the organization
        await this.orgSearchInput.fill(orgName);

        // When a specific identifier is available, target that row directly so
        // we don't race against the OInput debounce / OTable filter and end up
        // clicking the previously-first row (often "default").
        if (orgIdentifier) {
            const targetRow = this.getOrgMenuItemByIdentifier(orgIdentifier);
            await targetRow.waitFor({ state: 'visible', timeout: 10000 });
            await targetRow.click();
            // Wait for the router push to land — the URL should now carry the
            // new org identifier.
            await this.page.waitForURL(new RegExp(`org_identifier=${orgIdentifier}`), {
                timeout: 10000,
            }).catch(() => {});
            return;
        }

        await this.orgMenuItemLabel.first().waitFor({ state: 'visible', timeout: 10000 });

        // Click the organization from search results
        await this.orgMenuItemLabel.first().click();
    }

    async homeURLContains(orgNameIdentifier) {
        const expectedURLPart = `org_identifier=${orgNameIdentifier}`;
        const currentURL = this.page.url();
        await expect(currentURL).toContain(expectedURLPart);
    }

    async clickDefaultOrg() {
        await this.orgSelector.click();

        const optionsSelector = '[data-test="organization-menu-item-label-item-label"]';
        try {
            await this.page.waitForSelector(optionsSelector, { state: 'visible', timeout: 60000 });
        } catch (error) {
            console.error('Dropdown options did not become visible:', error);
            return;
        }

        const optionsCount = await this.page.locator(optionsSelector).count();
        console.log(`Number of options visible: ${optionsCount}`);

        // Filter the org list via the search input — data-test-only, no hasText filter.
        await this.orgSearchInput.fill('default');
        const defaultOption = this.orgMenuItemLabel.first();

        try {
            await defaultOption.waitFor({ state: 'visible', timeout: 60000 });
            await defaultOption.click();
            console.log('Clicked the default option successfully.');
        } catch (error) {
            console.error('Default option is not visible or clickable:', error);
            return;
        }

        await this.orgSelector.click();
    }

    // ===== HELP MENU METHODS =====

    async openHelpMenu() {
        await this.helpButton.click();
        // Wait for the About link inside the help dropdown to be visible — confirms popover open.
        await this.aboutLink.waitFor({ state: 'visible', timeout: 5000 });
    }

    async navigateToAbout() {
        await this.openHelpMenu();
        await this.aboutLink.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ===== PROFILE MENU METHODS =====

    async openProfileMenu() {
        await this.profileIcon.click();
        // Wait for the logout button inside the profile dropdown to confirm popover open.
        await this.logoutButton.waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Dismiss any open overlay/popover by pressing Escape.
     * Use instead of body-click hacks to close ODropdown / OPopover overlays.
     */
    async pressEscape() {
        await this.page.keyboard.press('Escape');
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
     * Get locator for a specific language option by language code.
     * After Header.vue migration the user profile menu is an ODropdown
     * ([role="menuitem"]) but the language sub-menu was kept in-place (not
     * supported by ODropdown nesting). The data-test attribute is preserved
     * either on a q-item-section or directly on a menuitem (ODropdown),
     * so target the element with data-test and walk up to its clickable ancestor.
     * @param {string} langCode - Language code (e.g., 'en-us', 'de', 'es', 'fr', etc.)
     * @returns {Locator} - Playwright locator for the language option
     */
    getLanguageOption(langCode) {
        // Try ODropdown menuitem first (post-migration), fall back to q-item ancestor.
        return this.page
            .locator(`[data-test="language-dropdown-item-${langCode}"]`)
            .locator('xpath=ancestor-or-self::*[@role="menuitem" or contains(@class, "q-item")][1]')
            .first();
    }

    /**
     * Get the language menu item row in the profile dropdown
     * This is the row that shows "Language" with an arrow to open the submenu.
     * After Header.vue migration the row is now a dedicated submenu trigger
     * with data-test="header-language-submenu-trigger".
     */
    getLanguageMenuItem() {
        return this.page.locator('[data-test="header-language-submenu-trigger"]').first();
    }

    /**
     * Opens the language selection submenu
     * Steps: Click profile icon -> Click on language item to open submenu
     * Note: menus require click, not hover, to open nested menus
     */
    async openLanguageMenu() {
        await this.openProfileMenu();

        // Click on the language menu item to open the submenu
        const languageMenuItem = this.getLanguageMenuItem();
        await languageMenuItem.waitFor({ state: 'visible', timeout: 5000 });
        await languageMenuItem.click();

        // Wait for a language option to be visible (confirming submenu opened)
        const firstLangOption = this.page.locator('[data-test^="language-dropdown-item-"]').first();
        await firstLangOption.waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Change the application language
     * @param {string} langCode - Language code to switch to
     * Valid codes: 'en-us', 'tr-turk', 'zh-cn', 'fr', 'es', 'de', 'it', 'ja', 'ko', 'nl', 'pt'
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

        // The language submenu trigger row exposes the currently selected language label as
        // its visible text — read it directly via the existing data-test member instead of
        // scraping the deprecated `.selected-lang-label` CSS class.
        const trigger = this.getLanguageMenuItem();
        await trigger.waitFor({ state: 'visible', timeout: 5000 });
        const text = await trigger.textContent();
        await this.pressEscape();
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
     * @param {string} langCode - Language code (e.g., 'en-us', 'de', 'es', 'fr', etc.)
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
        // Verify the translated label appears on the home/logs sidebar menu — the
        // sidebar always shows the current navigation labels in the active locale.
        await expect(this.mainContent).toContainText(expectedText, { timeout: 10000 });
    }

    /**
     * Available language codes mapped to their labels
     */
    static LANGUAGES = {
        'en-us': { label: 'English', menuText: 'Home' },
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
        // Read the body class via page.evaluate (the dark-theme class lives on
        // document.body and is not addressable via a data-test attribute).
        return await this.page.evaluate(() => document.body.classList.contains('body--dark'));
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
     * The button is located between org selector and Slack button.
     * Uses the canonical data-test attribute on the ThemeSwitcher OButton.
     */
    async clickThemeSwitcher() {
        // Wait for the header to be loaded
        await this.page.waitForLoadState('domcontentloaded');
        await this.themeSwitcherButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.themeSwitcherButton.click();
    }

    /**
     * Toggle theme from light to dark or vice versa
     * @returns {Promise<string>} - The new theme after toggle ('light' or 'dark')
     */
    async toggleTheme() {
        const currentTheme = await this.isDarkMode();
        await this.clickThemeSwitcher();

        // Poll until the body class actually flips — replaces the prior fixed sleep.
        await expect.poll(async () => await this.isDarkMode(), {
            timeout: 5000,
            intervals: [50, 100, 200],
        }).toBe(!currentTheme);

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
            await expect.poll(async () => await this.isDarkMode(), {
                timeout: 5000,
                intervals: [50, 100, 200],
            }).toBe(true);
        }
        await expect.poll(async () => await this.isDarkMode(), { timeout: 5000 }).toBe(true);
    }

    /**
     * Switch to light mode (if not already in light mode)
     */
    async switchToLightMode() {
        const isDark = await this.isDarkMode();
        if (isDark) {
            await this.clickThemeSwitcher();
            await expect.poll(async () => await this.isDarkMode(), {
                timeout: 5000,
                intervals: [50, 100, 200],
            }).toBe(false);
        }
        await expect.poll(async () => await this.isDarkMode(), { timeout: 5000 }).toBe(false);
    }

    /**
     * Verify theme is correctly applied
     * @param {string} expectedTheme - 'light' or 'dark'
     */
    async verifyTheme(expectedTheme) {
        if (expectedTheme === 'dark') {
            await expect.poll(async () => await this.isDarkMode(), { timeout: 5000 }).toBe(true);
        } else {
            await expect.poll(async () => await this.isDarkMode(), { timeout: 5000 }).toBe(false);
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

    // ============================================================================
    // LANDING PAGE VALIDATION METHODS
    // ============================================================================

    /**
     * Get logs results table locator
     */
    getLogsResultsTable() {
        return this.page.locator('[data-test="logs-search-result-logs-table"]');
    }

    /**
     * Get query editor locator
     */
    getQueryEditor() {
        // Target the wrapper by data-test — Monaco's `.view-lines` internals are out of scope.
        return this.page.locator('[data-test="logs-search-bar-query-editor"]');
    }

    /**
     * Get refresh button locator
     */
    getRefreshButton() {
        return this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
    }

    /**
     * Get logs menu sidebar item
     */
    getLogsMenuItem() {
        return this.page.locator('[data-test="menu-link-\\/logs-item"]');
    }

    /**
     * Click refresh button to run query
     */
    async clickRefresh() {
        await this.getRefreshButton().waitFor({ state: 'visible', timeout: 10000 });
        await this.getRefreshButton().click();
    }

    /**
     * Click logs menu to navigate to logs page
     */
    async clickLogsMenu() {
        await this.getLogsMenuItem().waitFor({ state: 'visible', timeout: 10000 });
        await this.getLogsMenuItem().click();
    }

    /**
     * Validate Home page UI elements
     */
    async validateHomePageElements() {
        await expect(this.homePageIndicator).toBeVisible({ timeout: 10000 });
    }

    /**
     * Validate Metrics page UI elements
     */
    async validateMetricsPageElements() {
        await expect(this.page.locator('[data-test="metrics-apply"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="metrics-date-picker"]')).toBeVisible({ timeout: 5000 });
        await expect(this.page.locator('[data-test="metrics-page"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Validate Traces page UI elements
     */
    async validateTracesPageElements() {
        await expect(this.page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="date-time-btn"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Validate Dashboards page UI elements
     */
    async validateDashboardsPageElements() {
        await expect(this.page.locator('[data-test="dashboard-new"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="dashboard-search"]')).toBeVisible({ timeout: 5000 });
        await expect(this.page.locator('[data-test="dashboard-import"]')).toBeVisible({ timeout: 5000 });
        await expect(this.page.locator('[data-test="dashboard-table"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Validate Streams page UI elements
     */
    async validateStreamsPageElements() {
        await expect(this.page.locator('[data-test="streams-search-stream-input"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="log-stream-title-text"]')).toBeVisible({ timeout: 5000 });
        await expect(this.page.locator('[data-test="log-stream-refresh-stats-btn"]')).toBeVisible({ timeout: 5000 });
        await expect(this.page.locator('[data-test="log-stream-table"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Validate Alerts page UI elements
     */
    async validateAlertsPageElements() {
        // Wait deterministically on the alerts page wrapper instead of a fixed delay.
        await expect(this.alertsPageIndicator).toBeVisible({ timeout: 15000 });
        await expect(this.page.locator('[data-test="alert-list-add-alert-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Validate Ingestion page UI elements
     */
    async validateIngestionPageElements() {
        await expect(this.ingestionPageIndicator).toBeVisible({ timeout: 10000 });
        await expect(this.page.getByRole('button', { name: /Manage Tokens/i })).toBeVisible({ timeout: 5000 });
    }

    /**
     * Validate Settings - General page UI elements
     */
    async validateSettingsGeneralPageElements() {
        await expect(this.page.locator('[data-test="settings-general-page-title"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="dashboard-add-submit"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Navigate to Organization Parameters tab in Settings
     */
    async navigateToOrganizationParameters() {
        await this.navigateToSettings();
        const orgTab = this.page.locator('[data-test="organization-settings-tab"]');
        await orgTab.waitFor({ state: 'visible', timeout: 10000 });
        await orgTab.click();
    }

    /**
     * Validate Settings - Organization Parameters page UI elements
     */
    async validateSettingsOrganizationPageElements() {
        await expect(this.page.locator('[data-test="add-alert-submit-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Navigate to Alert Destinations tab in Settings
     */
    async navigateToAlertDestinations() {
        await this.navigateToSettings();
        await this.page.locator('[data-test="alert-destinations-tab"]').waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator('[data-test="alert-destinations-tab"]').click();
    }

    /**
     * Validate Settings - Alert Destinations page UI elements
     */
    async validateSettingsAlertDestinationsPageElements() {
        await expect(this.page.locator('[data-test="alert-destination-list-add-alert-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Navigate to Pipeline Destinations tab in Settings (Enterprise only)
     * @returns {boolean} true if navigated, false if not available
     */
    async navigateToPipelineDestinations() {
        await this.navigateToSettings();
        const pipelineTab = this.page.locator('button[data-test="pipeline-destinations-tab"]');
        if (!(await pipelineTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            return false;
        }
        await pipelineTab.click();
        return true;
    }

    /**
     * Validate Settings - Pipeline Destinations page UI elements
     */
    async validateSettingsPipelineDestinationsPageElements() {
        await expect(this.page.locator('[data-test="pipeline-destination-list-add-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Navigate to Templates tab in Settings
     */
    async navigateToTemplates() {
        await this.navigateToSettings();
        await this.page.locator('[data-test="alert-templates-tab"]').waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator('[data-test="alert-templates-tab"]').click();
    }

    /**
     * Validate Settings - Templates page UI elements
     */
    async validateSettingsTemplatesPageElements() {
        await expect(this.page.locator('[data-test="template-list-add-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Navigate to Cipher Keys tab in Settings (Enterprise only)
     * @returns {boolean} true if navigated, false if not available
     */
    async navigateToCipherKeys() {
        await this.navigateToSettings();
        const cipherTab = this.page.locator('[data-test="management-cipher-key-tab"]');
        if (!(await cipherTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            return false;
        }
        await cipherTab.click();
        return true;
    }

    /**
     * Validate Settings - Cipher Keys page UI elements
     */
    async validateSettingsCipherKeysPageElements() {
        await expect(this.page.locator('[data-test="cipher-keys-add-btn"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Navigate to Sensitive Data Redaction tab in Settings (Enterprise only)
     * @returns {boolean} true if navigated, false if not available
     */
    async navigateToSensitiveDataRedaction() {
        await this.navigateToSettings();
        const regexTab = this.page.locator('[data-test="regex-patterns-tab"]');
        if (!(await regexTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            return false;
        }
        await regexTab.click();
        return true;
    }

    /**
     * Validate Settings - Sensitive Data Redaction page UI elements
     */
    async validateSettingsSensitiveDataRedactionPageElements() {
        await expect(this.page.locator('[data-test="regex-pattern-list-table"]')).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator('[data-test="regex-pattern-list-add-pattern-btn"]')).toBeVisible({ timeout: 5000 });
    }

    // ===== FAVICON METHODS (Bug #9217) =====

    /**
     * Verify favicon is present and loads correctly
     * Bug #9217: Favicon icon was missing on main branch
     * @returns {Object} { domValid: boolean, resourceLoads: boolean, faviconHref: string }
     */
    async verifyFavicon() {
        const result = {
            domValid: false,
            resourceLoads: false,
            faviconHref: null
        };

        // Check favicon link in DOM
        // Note: href may be '/favicon.ico' or './favicon.ico' depending on server config
        const faviconHref = await this.faviconLink.getAttribute('href');
        result.faviconHref = faviconHref;
        result.domValid = Boolean(faviconHref) && faviconHref.includes('favicon.ico');

        // Verify favicon resource loads via fetch inside page context
        if (faviconHref) {
            const fetchResult = await this.page.evaluate(async (href) => {
                try {
                    const response = await fetch(href);
                    return { status: response.status, ok: response.ok };
                } catch (error) {
                    return { status: 0, ok: false, error: error.message };
                }
            }, faviconHref);

            result.resourceLoads = fetchResult.ok && fetchResult.status === 200;
        }

        return result;
    }
}
