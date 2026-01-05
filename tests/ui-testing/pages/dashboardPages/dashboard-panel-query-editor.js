const { expect } = require("@playwright/test");

/**
 * DashboardPanelQueryEditor - Page Object for multi-query editor UI
 * Handles query tab interactions, Monaco editor, and query management
 */
class DashboardPanelQueryEditor {
  constructor(page) {
    this.page = page;

    // Locators - All selectors must be defined here at the top
    this.panelSearchbar = '[data-test="dashboard-panel-searchbar"]';
    this.queryTab = (index) => `[data-test="dashboard-panel-query-tab-${index}"]`;
    this.queryTabAdd = '[data-test="dashboard-panel-query-tab-add"]';
    this.queryTabRemove = (index) =>
      `[data-test="dashboard-panel-query-tab-remove-${index}"]`;
    this.queryTabVisibility = (index) =>
      `[data-test="dashboard-panel-query-tab-visibility-${index}"]`;
    this.monacoEditorLine = ".view-line";
    this.monacoInputArea = '[data-test="dashboard-panel-query-editor"] .inputarea';
  }

  /**
   * Wait for query editor UI to be fully loaded
   */
  async waitForQueryEditorLoad() {
    await this.page.waitForSelector(this.panelSearchbar, { timeout: 10000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Wait for specific query tab to appear
   * @param {number} index - Query tab index (0-based)
   * @param {number} timeout - Timeout in milliseconds
   */
  async waitForQueryTab(index, timeout = 5000) {
    await this.page.waitForSelector(this.queryTab(index), { timeout });
  }

  /**
   * Expect query tab to be visible
   * @param {number} index - Query tab index
   * @param {number} timeout - Timeout in milliseconds
   */
  async expectQueryTabVisible(index, timeout = 5000) {
    await expect(this.page.locator(this.queryTab(index))).toBeVisible({
      timeout,
    });
  }

  /**
   * Expect query tab to NOT be visible
   * @param {number} index - Query tab index
   */
  async expectQueryTabNotVisible(index) {
    await expect(this.page.locator(this.queryTab(index))).not.toBeVisible();
  }

  /**
   * Expect query tab to contain specific text
   * @param {number} index - Query tab index
   * @param {string} text - Expected text content
   */
  async expectQueryTabContainsText(index, text) {
    await expect(this.page.locator(this.queryTab(index))).toContainText(text);
  }

  /**
   * Expect add query button to be visible
   * @param {number} timeout - Timeout in milliseconds
   */
  async expectAddQueryButtonVisible(timeout = 5000) {
    await expect(this.page.locator(this.queryTabAdd)).toBeVisible({ timeout });
  }

  /**
   * Click add query button to create new query tab
   */
  async clickAddQueryTab() {
    await this.page.locator(this.queryTabAdd).click();
  }

  /**
   * Click specific query tab to switch to it
   * @param {number} index - Query tab index
   */
  async clickQueryTab(index) {
    await this.page.locator(this.queryTab(index)).click();
  }

  /**
   * Click remove button on specific query tab
   * @param {number} index - Query tab index
   */
  async clickRemoveQueryTab(index) {
    await this.page.locator(this.queryTabRemove(index)).click();
  }

  /**
   * Click visibility toggle (eye icon) for specific query
   * @param {number} index - Query tab index
   */
  async clickQueryTabVisibility(index) {
    await this.page.locator(this.queryTabVisibility(index)).click();
  }

  /**
   * Enter custom SQL query in Monaco editor
   * @param {string} sqlQuery - SQL query string
   */
  async enterCustomSQL(sqlQuery) {
    await this.page.locator(this.monacoEditorLine).first().click();
    await this.page.locator(this.monacoInputArea).fill(sqlQuery);
  }

  /**
   * Get visibility icon element for checking state
   * @param {number} index - Query tab index
   * @returns {Locator} Playwright locator for the visibility icon
   */
  getVisibilityIcon(index) {
    return this.page.locator(this.queryTabVisibility(index));
  }

  /**
   * Check if remove button is visible for specific query
   * @param {number} index - Query tab index
   * @returns {Promise<boolean>} True if visible, false otherwise
   */
  async isRemoveButtonVisible(index) {
    return await this.page.locator(this.queryTabRemove(index)).isVisible();
  }

  /**
   * Expect visibility icon to be visible
   * @param {number} index - Query tab index
   */
  async expectVisibilityIconVisible(index) {
    await expect(this.getVisibilityIcon(index)).toBeVisible();
  }
}

module.exports = DashboardPanelQueryEditor;
