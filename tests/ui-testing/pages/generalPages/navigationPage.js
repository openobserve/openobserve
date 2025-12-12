const { expect } = require("@playwright/test");

/**
 * NavigationPage - Page Object for sidebar menu navigation
 *
 * Handles all menu navigation items and URL validation
 * Selectors extracted from MenuLink.vue component
 */
export class NavigationPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ===== CORE MENU SELECTORS (Always Visible) =====
    // Verified selectors from MenuLink.vue: data-test="menu-link-${link}-item"
    this.homeMenu = '[data-test="menu-link-/-item"]';
    this.logsMenu = '[data-test="menu-link-/logs-item"]';
    this.metricsMenu = '[data-test="menu-link-/metrics-item"]';
    this.tracesMenu = '[data-test="menu-link-/traces-item"]';
    this.rumMenu = '[data-test="menu-link-/rum-item"]';
    this.dashboardsMenu = '[data-test="menu-link-/dashboards-item"]';
    this.streamsMenu = '[data-test="menu-link-/streams-item"]';
    this.alertsMenu = '[data-test="menu-link-/alerts-item"]';
    this.ingestionMenu = '[data-test="menu-link-/ingestion-item"]';

    // ===== CONDITIONAL MENU SELECTORS =====
    this.iamMenu = '[data-test="menu-link-/iam-item"]'; // Admin only
    this.reportsMenu = '[data-test="menu-link-/reports-item"]'; // OSS only
    this.actionsMenu = '[data-test="menu-link-/actions-item"]'; // If feature enabled

    // ===== CORE MENU DEFINITIONS =====
    // Used for iterative testing
    // NOTE: Application uses /web/ prefix for all routes
    this.coreMenuItems = [
      { name: 'Home', path: '/web/', selector: this.homeMenu },
      { name: 'Logs', path: '/web/logs', selector: this.logsMenu },
      { name: 'Metrics', path: '/web/metrics', selector: this.metricsMenu },
      { name: 'Traces', path: '/web/traces', selector: this.tracesMenu },
      { name: 'RUM', path: '/web/rum', selector: this.rumMenu },
      { name: 'Dashboards', path: '/web/dashboards', selector: this.dashboardsMenu },
      { name: 'Streams', path: '/web/streams', selector: this.streamsMenu },
      { name: 'Alerts', path: '/web/alerts', selector: this.alertsMenu },
      { name: 'Ingestion', path: '/web/ingestion', selector: this.ingestionMenu }
    ];
  }

  // ===== NAVIGATION ACTIONS =====

  /**
   * Click Home menu item
   */
  async clickHome() {
    // Wait for page to be fully stable first
    await this.page.waitForLoadState('networkidle');

    const menu = this.page.locator(this.homeMenu);
    await menu.waitFor({ state: 'visible', timeout: 5000 });

    // Small delay for menu to be fully interactive
    await this.page.waitForTimeout(500);

    await menu.click();
    await this.page.waitForURL('**/web/', { waitUntil: 'networkidle', timeout: 10000 });
  }

  /**
   * Click Logs menu item
   */
  async clickLogs() {
    await Promise.all([
      this.page.waitForURL('**/logs**', { timeout: 5000 }),
      this.page.locator(this.logsMenu).click()
    ]);
  }

  /**
   * Click Metrics menu item
   */
  async clickMetrics() {
    await Promise.all([
      this.page.waitForURL('**/metrics**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.metricsMenu).click()
    ]);
  }

  /**
   * Click Traces menu item
   */
  async clickTraces() {
    await Promise.all([
      this.page.waitForURL('**/traces**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.tracesMenu).click()
    ]);
  }

  /**
   * Click RUM menu item
   */
  async clickRUM() {
    await Promise.all([
      this.page.waitForURL('**/rum**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.rumMenu).click()
    ]);
  }

  /**
   * Click Dashboards menu item
   */
  async clickDashboards() {
    await this.page.locator(this.dashboardsMenu).click();
    await this.page.waitForURL('**/dashboards**', { waitUntil: 'networkidle', timeout: 10000 });
  }

  /**
   * Click Streams menu item
   */
  async clickStreams() {
    // Wait for page to be fully stable first (important after navigating from other pages like Alerts)
    await this.page.waitForLoadState('networkidle');

    // Ensure menu is visible and attached to DOM
    const menu = this.page.locator(this.streamsMenu);
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    await menu.waitFor({ state: 'attached', timeout: 5000 });

    // Longer delay to ensure menu is fully interactive and any router guards have completed
    await this.page.waitForTimeout(1000);

    await menu.click();
    await this.page.waitForURL('**/streams**', { waitUntil: 'networkidle', timeout: 10000 });
  }

  /**
   * Click Alerts menu item
   */
  async clickAlerts() {
    await this.page.locator(this.alertsMenu).click();
    await this.page.waitForURL('**/alerts**', { waitUntil: 'networkidle', timeout: 15000 });
  }

  /**
   * Click Ingestion menu item
   */
  async clickIngestion() {
    await Promise.all([
      this.page.waitForURL('**/ingestion**', { waitUntil: 'networkidle', timeout: 15000 }),
      this.page.locator(this.ingestionMenu).click()
    ]);
  }

  /**
   * Click IAM menu item (admin only)
   */
  async clickIAM() {
    await Promise.all([
      this.page.waitForURL('**/iam**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.iamMenu).click()
    ]);
  }

  /**
   * Click Reports menu item (OSS only)
   */
  async clickReports() {
    await Promise.all([
      this.page.waitForURL('**/reports**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.reportsMenu).click()
    ]);
  }

  /**
   * Click Actions menu item (if enabled)
   */
  async clickActions() {
    await Promise.all([
      this.page.waitForURL('**/actions**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(this.actionsMenu).click()
    ]);
  }

  /**
   * Click a menu item by selector
   * @param {string} selector - Menu item selector
   */
  async clickMenuItem(selector) {
    // Wait for navigation to complete after click
    await Promise.all([
      this.page.waitForURL('**/web/**', { waitUntil: 'networkidle', timeout: 10000 }),
      this.page.locator(selector).click()
    ]);
  }

  // ===== VISIBILITY CHECKS =====

  /**
   * Check if Home menu is visible
   * @returns {Promise<boolean>}
   */
  async isHomeVisible() {
    return await this.page.locator(this.homeMenu).isVisible();
  }

  /**
   * Check if IAM menu is visible (admin only)
   * @returns {Promise<boolean>}
   */
  async isIAMVisible() {
    try {
      return await this.page.locator(this.iamMenu).isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Check if Reports menu is visible (OSS only)
   * @returns {Promise<boolean>}
   */
  async isReportsVisible() {
    try {
      return await this.page.locator(this.reportsMenu).isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Check if Actions menu is visible
   * @returns {Promise<boolean>}
   */
  async isActionsVisible() {
    try {
      return await this.page.locator(this.actionsMenu).isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Check if a menu item is visible
   * @param {string} selector - Menu item selector
   * @returns {Promise<boolean>}
   */
  async isMenuItemVisible(selector) {
    try {
      return await this.page.locator(selector).isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  // ===== URL VALIDATION =====

  /**
   * Get the org_identifier from the current URL
   * @returns {Promise<string|null>} - Organization identifier or null if not present
   */
  async getOrgIdentifierFromURL() {
    const url = new URL(this.page.url());
    return url.searchParams.get('org_identifier');
  }

  /**
   * Validate that URL contains org_identifier
   * @param {string} expectedOrgId - Expected organization identifier
   * @throws {Error} If org_identifier is missing or doesn't match
   */
  async validateOrgIdentifierInURL(expectedOrgId) {
    const actualOrgId = await this.getOrgIdentifierFromURL();

    if (!actualOrgId) {
      throw new Error(`URL does not contain org_identifier query parameter. URL: ${this.page.url()}`);
    }

    if (actualOrgId !== expectedOrgId) {
      throw new Error(`org_identifier mismatch. Expected: ${expectedOrgId}, Got: ${actualOrgId}`);
    }
  }

  /**
   * Get the current path from URL (without query params)
   * @returns {Promise<string>} - Current path
   */
  async getCurrentPath() {
    const url = new URL(this.page.url());
    return url.pathname;
  }

  /**
   * Validate current path matches expected path
   * @param {string} expectedPath - Expected URL path (e.g., '/logs')
   */
  async validatePath(expectedPath) {
    const actualPath = await this.getCurrentPath();
    expect(actualPath).toBe(expectedPath);
  }

  /**
   * Validate both path and org_identifier in URL
   * @param {string} expectedPath - Expected URL path
   * @param {string} expectedOrgId - Expected organization identifier
   */
  async validateURLWithOrg(expectedPath, expectedOrgId) {
    await this.validatePath(expectedPath);
    await this.validateOrgIdentifierInURL(expectedOrgId);
  }

  // ===== COMBINED ACTIONS =====

  /**
   * Click menu item and validate navigation with org_identifier
   * @param {string} menuSelector - Menu item selector
   * @param {string} expectedPath - Expected URL path after navigation
   * @param {string} expectedOrgId - Expected organization identifier
   */
  async clickAndValidateNavigation(menuSelector, expectedPath, expectedOrgId) {
    await this.clickMenuItem(menuSelector);
    await this.page.waitForTimeout(500); // Small wait for URL update
    await this.validateURLWithOrg(expectedPath, expectedOrgId);
  }

  /**
   * Iterate through all core menu items and validate org_identifier
   * @param {string} expectedOrgId - Expected organization identifier
   * @returns {Promise<Array>} - Array of test results
   */
  async validateAllCoreMenusHaveOrgIdentifier(expectedOrgId) {
    const results = [];

    for (const menuItem of this.coreMenuItems) {
      try {
        // Check if menu item is visible
        const isVisible = await this.isMenuItemVisible(menuItem.selector);

        if (!isVisible) {
          results.push({
            name: menuItem.name,
            path: menuItem.path,
            success: false,
            error: 'Menu item not visible',
            skipped: true
          });
          continue;
        }

         // Click menu item and wait for specific path
        const urlPattern = menuItem.path === '/web/' ? '**/web/' : `**${menuItem.path}**`;
        await Promise.all([
          this.page.waitForURL(urlPattern, { waitUntil: 'networkidle', timeout: 15000 }),
          this.page.locator(menuItem.selector).click()
        ]);

        // Validate URL after page loads
        const actualOrgId = await this.getOrgIdentifierFromURL();
        const actualPath = await this.getCurrentPath();

        // Ingestion page redirects to subpages, so check if path starts with expected path
        const pathMatches = menuItem.name === 'Ingestion'
          ? actualPath.startsWith(menuItem.path)
          : actualPath === menuItem.path;
        const orgMatches = actualOrgId === expectedOrgId;
        const success = pathMatches && orgMatches;

        // Build detailed error message showing both path and org mismatches
        let errorMsg = null;
        if (!success) {
          const errors = [];
          if (!pathMatches) {
            errors.push(`Path: expected "${menuItem.path}", got "${actualPath}"`);
          }
          if (!orgMatches) {
            errors.push(`Org: expected "${expectedOrgId}", got "${actualOrgId}"`);
          }
          errorMsg = errors.join('; ');
        }

        results.push({
          name: menuItem.name,
          path: menuItem.path,
          expectedPath: menuItem.path,
          actualPath: actualPath,
          expectedOrgId: expectedOrgId,
          actualOrgId: actualOrgId,
          success: success,
          error: errorMsg,
          skipped: false
        });
      } catch (error) {
        results.push({
          name: menuItem.name,
          path: menuItem.path,
          success: false,
          error: error.message,
          skipped: false
        });
      }
    }

    return results;
  }

  /**
   * Wait for URL to stabilize with expected path and org_identifier
   * @param {string} expectedPath - Expected URL path
   * @param {string} expectedOrgId - Expected organization identifier
   * @param {number} timeout - Timeout in milliseconds (default: 15000)
   */
  async waitForURLWithOrg(expectedPath, expectedOrgId, timeout = 15000) {
    await this.page.waitForFunction(
      ({ path, orgId }) => {
        const url = new URL(window.location.href);
        const actualPath = url.pathname;
        const actualOrgId = url.searchParams.get('org_identifier');
        return actualPath === path && actualOrgId === orgId;
      },
      { path: expectedPath, orgId: expectedOrgId },
      { timeout }
    );
  }

  // ===== EXPECTATIONS/ASSERTIONS =====

  /**
   * Expect org_identifier to be present in URL
   * @param {string} expectedOrgId - Expected organization identifier
   */
  async expectOrgIdentifierInURL(expectedOrgId) {
    const actualOrgId = await this.getOrgIdentifierFromURL();
    expect(actualOrgId, `org_identifier should be "${expectedOrgId}" in URL: ${this.page.url()}`).toBe(expectedOrgId);
  }

  /**
   * Expect current path to match expected path
   * @param {string} expectedPath - Expected URL path
   */
  async expectPath(expectedPath) {
    const actualPath = await this.getCurrentPath();
    expect(actualPath, `URL path should be "${expectedPath}" but got "${actualPath}"`).toBe(expectedPath);
  }

  /**
   * Expect menu item to be visible
   * @param {string} selector - Menu item selector
   */
  async expectMenuItemVisible(selector) {
    await expect(this.page.locator(selector), `Menu item ${selector} should be visible`).toBeVisible();
  }

  /**
   * Expect menu item to NOT be visible
   * @param {string} selector - Menu item selector
   */
  async expectMenuItemNotVisible(selector) {
    const isVisible = await this.isMenuItemVisible(selector);
    expect(isVisible, `Menu item ${selector} should NOT be visible`).toBe(false);
  }
}
