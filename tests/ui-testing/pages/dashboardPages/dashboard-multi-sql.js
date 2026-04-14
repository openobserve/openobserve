// Dashboard Multi-SQL Query Page Object
// Encapsulates selectors and actions for multi-query tab management

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardMultiSQL {
  constructor(page) {
    this.page = page;

    // Query tab selectors
    this.addQueryBtn = page.locator('[data-test*="dashboard-panel-query-tab-add"]');
    this.warningBanner = page.locator(".dashboard-multi-query-warning");
    this.trellisDropdown = page.locator('[data-test="dashboard-trellis-chart"]');
    this.queryInspectorBtn = page.locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]');
    this.queryInspectorClose = page.locator('[data-test="query-inspector-close-btn"]');
    this.customQueryBtn = page.locator('[data-test="dashboard-custom-query-type"]');
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
  }

  // ---------------------------------------------------------------------------
  // Dynamic locators (index-based)
  // ---------------------------------------------------------------------------

  /** Locator for the query tab at given index */
  queryTab(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-${index}"]`);
  }

  /**
   * Locator for the query tab name wrapper div at given index.
   * Uses the wrapper div with data-test attribute that holds the dblclick handler.
   */
  queryTabLabel(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-name-${index}"]`);
  }

  /** Locator for the rename input at given index */
  queryTabNameInput(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-name-input-${index}"]`);
  }

  /** Locator for the remove (close) icon at given index */
  queryTabRemove(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-remove-${index}"]`);
  }

  /** Locator for the visibility (eye) icon at given index */
  queryTabVisibility(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-visibility-${index}"]`);
  }

  /** Locator for the config panel query tab at given index */
  configQueryTab(index) {
    return this.page.locator(`[data-test="dashboard-config-query-tab-${index}"]`);
  }

  /** Locator for the config legend input at given index */
  configLegend(index) {
    return this.page.locator(`[data-test="dashboard-config-legend-${index}"]`);
  }

  /** Locator for trellis disabled state */
  trellisDisabled() {
    return this.page.locator(`.q-field--disabled:has([data-test="dashboard-trellis-chart"])`);
  }

  /** Locator for the query name label shown inside the query inspector at given index */
  queryInspectorQueryName(index) {
    return this.page.locator(`[data-test="query-inspector-query-name-${index}"]`);
  }

  /**
   * Locator for the X-axis alias inconsistency warning icon.
   * Rendered by PanelErrorButtons.vue inside the panel editor header (reactive,
   * no Apply needed ΓÇö updates as fields are added/removed).
   */
  get xAliasInconsistencyWarning() {
    return this.page.locator('[data-test="panel-x-alias-inconsistency-warning"]');
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Click the "+" button to add a new query tab and wait for it to appear.
   * @param {number} expectedTabIndex - Index of the new tab (1 for Q2, 2 for Q3)
   */
  async addQueryTab(expectedTabIndex = 1) {
    await this.addQueryBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.addQueryBtn.click();
    await this.queryTab(expectedTabIndex).waitFor({ state: "visible", timeout: 15000 });
    // Allow Vue reactivity and sidebar to settle
    await this.page.waitForTimeout(1500);
    testLogger.debug("Added query tab", { expectedTabIndex });
  }

  /**
   * Switch to the query tab at given index.
   * @param {number} index
   */
  async switchToQueryTab(index) {
    await this.queryTab(index).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Remove the query tab at given index.
   * @param {number} index
   */
  async removeQueryTab(index) {
    await this.queryTabRemove(index).click();
  }

  /**
   * Toggle the visibility (eye icon) of the query tab at given index.
   * @param {number} index
   */
  async toggleQueryVisibility(index) {
    await this.queryTabVisibility(index).click();
  }

  /**
   * Type a custom SQL query into the Monaco editor for the active query tab.
   * The tab must already be in custom-query mode.
   * @param {string} sql
   */
  async enterCustomSQL(sql) {
    await this.queryEditor.waitFor({ state: "visible", timeout: 10000 });
    const monacoCode = this.queryEditor.getByRole("code");
    await monacoCode.click({ clickCount: 3 });
    await this.page.keyboard.press("Control+a");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.type(sql, { delay: 20 });
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(2000); // allow Monaco debounce to sync
  }

  /**
   * Apply the current panel config then save.
   * Switches to Q1 tab first so validation uses Q1's valid fields.
   * Handles the "unsaved changes" dialog automatically.
   * @param {object} pm - PageManager instance
   */
  async applyAndSave(pm) {
    const dialogHandler = (dialog) => dialog.accept();
    this.page.on("dialog", dialogHandler);
    try {
      // Switch to first query tab so validation uses Q1's valid fields
      const firstTab = this.queryTab(0);
      if (await firstTab.isVisible().catch(() => false)) {
        await firstTab.click();
        await this.page.waitForTimeout(500);
      }
      await pm.dashboardPanelActions.applyDashboardBtn();
      await this.page.waitForTimeout(2000);
      await pm.dashboardPanelActions.savePanel();
      // Wait for navigation away from add_panel page after save
      await this.page.waitForURL((url) => !url.pathname.includes("add_panel"), {
        timeout: 30000,
      }).catch(() => {
        testLogger.warn("applyAndSave: did not navigate away from add_panel within timeout");
      });
      await this.page.waitForTimeout(1000);
    } finally {
      this.page.off("dialog", dialogHandler);
    }
  }

  /**
   * Open the query inspector and return the page content for assertions.
   * Closes the inspector when done.
   * @returns {Promise<string>} The page content HTML
   */
  async openQueryInspector() {
    await this.queryInspectorBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.queryInspectorBtn.click();
    await this.page.waitForTimeout(1000);
    return await this.page.content();
  }

  /**
   * Close the query inspector.
   */
  async closeQueryInspector() {
    if (await this.queryInspectorClose.isVisible()) {
      await this.queryInspectorClose.click();
    } else {
      await this.page.keyboard.press("Escape");
    }
  }
}
