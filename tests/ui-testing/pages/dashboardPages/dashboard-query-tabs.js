// Dashboard Query Tabs Page Object
// Purpose: Handle multi-query tab operations for metrics/PromQL panels
// Methods: switchQueryTab, addQueryTab, removeQueryTab, getQueryEditorValue,
//          setQueryEditorValue, toggleQueryVisibility, getActiveQueryIndex

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardQueryTabs {
  constructor(page) {
    this.page = page;

    // Selectors (VERIFIED from FieldList.vue and DashboardQueryEditor.vue)
    this.queryTabsContainer = '[data-test="dashboard-panel-query-tab"]';
    this.addTabButton = '[data-test="dashboard-panel-query-tab-add"]';
    this.queryEditor = '[data-test="dashboard-panel-query-editor"]';

    // Dynamic selectors (parameterized)
    this.queryTab = (index) => `[data-test="dashboard-panel-query-tab-${index}"]`;
    this.removeTabButton = (index) => `[data-test="dashboard-panel-query-tab-remove-${index}"]`;
    this.visibilityToggle = (index) => `[data-test="dashboard-panel-query-tab-visibility-${index}"]`;
  }

  /**
   * Verify query tabs are visible (for PromQL mode)
   */
  async expectQueryTabsVisible() {
    testLogger.info('Verifying query tabs are visible');
    await this.page.locator(this.queryTabsContainer).waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Switch to a specific query tab by index
   * @param {number} index - Zero-based query tab index (0 for Query 1, 1 for Query 2, etc.)
   */
  async switchQueryTab(index) {
    testLogger.info(`Switching to query tab ${index + 1}`);
    const tab = this.page.locator(this.queryTab(index));
    await tab.waitFor({ state: 'visible', timeout: 5000 });
    await tab.click();

    // Wait for tab switch to complete
    await this.page.waitForTimeout(500);
    testLogger.debug(`Switched to query tab ${index + 1}`);
  }

  /**
   * Add a new query tab
   * @returns {number} - Index of the newly created tab
   */
  async addQueryTab() {
    testLogger.info('Adding new query tab');

    // Count existing tabs before adding
    const tabsBefore = await this.page.locator('[data-test^="dashboard-panel-query-tab-"][data-test$="]').count();

    const addButton = this.page.locator(this.addTabButton);
    await addButton.waitFor({ state: 'visible', timeout: 5000 });
    await addButton.click();

    // Wait for new tab to appear
    await this.page.waitForTimeout(1000);

    const tabsAfter = await this.page.locator('[data-test^="dashboard-panel-query-tab-"][data-test$="]').count();
    const newTabIndex = tabsAfter - 1;

    testLogger.info(`New query tab created at index ${newTabIndex}`);
    return newTabIndex;
  }

  /**
   * Remove a query tab by index
   * @param {number} index - Zero-based query tab index to remove
   */
  async removeQueryTab(index) {
    testLogger.info(`Removing query tab ${index + 1}`);
    const removeButton = this.page.locator(this.removeTabButton(index));
    await removeButton.waitFor({ state: 'visible', timeout: 5000 });
    await removeButton.click();

    // Wait for tab removal to complete
    await this.page.waitForTimeout(500);
    testLogger.debug(`Removed query tab ${index + 1}`);
  }

  /**
   * Get the current value of the query editor (Monaco editor)
   * @returns {Promise<string>} - Query editor content
   */
  async getQueryEditorValue() {
    testLogger.debug('Getting query editor value');

    // Monaco editor requires special handling - get the model value
    const queryValue = await this.page.evaluate(() => {
      const editor = document.querySelector('[data-test="dashboard-panel-query-editor"]');
      if (!editor) return null;

      // Try to get Monaco editor instance
      const monacoEditor = editor.__vueParentComponent?.ctx?.editorRef;
      if (monacoEditor) {
        return monacoEditor.getValue();
      }

      // Fallback: try to get from textarea or input
      const textarea = editor.querySelector('textarea');
      if (textarea) return textarea.value;

      return null;
    });

    testLogger.debug(`Query editor value: ${queryValue?.substring(0, 50)}...`);
    return queryValue;
  }

  /**
   * Set the value of the query editor
   * @param {string} queryText - Query text to set
   */
  async setQueryEditorValue(queryText) {
    testLogger.info(`Setting query editor value to: ${queryText.substring(0, 50)}...`);

    // Focus the editor first
    await this.page.locator(this.queryEditor).click();
    await this.page.waitForTimeout(500);

    // Select all and replace
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.type(queryText);

    // Wait for editor to update
    await this.page.waitForTimeout(500);
    testLogger.debug('Query editor value set');
  }

  /**
   * Toggle query visibility (PromQL mode only)
   * @param {number} index - Zero-based query tab index
   */
  async toggleQueryVisibility(index) {
    testLogger.info(`Toggling visibility for query tab ${index + 1}`);
    const visibilityIcon = this.page.locator(this.visibilityToggle(index));
    await visibilityIcon.waitFor({ state: 'visible', timeout: 5000 });
    await visibilityIcon.click();
    await this.page.waitForTimeout(500);
    testLogger.debug(`Toggled visibility for query tab ${index + 1}`);
  }

  /**
   * Get the currently active query tab index
   * @returns {Promise<number>} - Zero-based index of active tab
   */
  async getActiveQueryIndex() {
    testLogger.debug('Getting active query index');

    // Find the tab with aria-selected="true"
    const activeTabs = await this.page.locator('[data-test^="dashboard-panel-query-tab-"][aria-selected="true"]').count();

    if (activeTabs === 0) {
      testLogger.warn('No active query tab found, defaulting to 0');
      return 0;
    }

    // Get the data-test attribute of the active tab
    const activeTabDataTest = await this.page.locator('[data-test^="dashboard-panel-query-tab-"][aria-selected="true"]').first().getAttribute('data-test');
    const match = activeTabDataTest.match(/dashboard-panel-query-tab-(\d+)/);

    if (match) {
      const index = parseInt(match[1], 10);
      testLogger.debug(`Active query index: ${index}`);
      return index;
    }

    return 0;
  }

  /**
   * Wait for query editor to be ready
   */
  async waitForQueryEditorReady() {
    testLogger.debug('Waiting for query editor to be ready');
    await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(1000); // Wait for Monaco to initialize
  }

  /**
   * Verify a specific query tab exists
   * @param {number} index - Zero-based query tab index
   * @returns {Promise<boolean>} - True if tab exists
   */
  async queryTabExists(index) {
    const tab = this.page.locator(this.queryTab(index));
    const count = await tab.count();
    return count > 0;
  }

  /**
   * Get the label text of a query tab
   * @param {number} index - Zero-based query tab index
   * @returns {Promise<string>} - Tab label (e.g., "Query 1")
   */
  async getQueryTabLabel(index) {
    const tab = this.page.locator(this.queryTab(index));
    await tab.waitFor({ state: 'visible', timeout: 5000 });
    const label = await tab.textContent();
    return label.trim();
  }
}
