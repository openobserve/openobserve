// Dashboard Multi-SQL Query Page Object
// Encapsulates selectors and actions for multi-query tab management

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardMultiSQL {
  constructor(page) {
    this.page = page;

    // Query tab selectors
    this.addQueryBtn = page.locator('[data-test="dashboard-panel-query-tab-add"]');
    this.warningBanner = page.locator(".dashboard-multi-query-warning");
    this.trellisDropdown = page.locator('[data-test="dashboard-trellis-chart"]');
    this.queryInspectorBtn = page.locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]');
    // QueryInspector is an <ODialog data-test="query-inspector">; ODialog
    // forwards its data-test to the dialog panel and exposes the close
    // button as data-test="o-dialog-close-btn" (see ODialog.vue:397).
    this.queryInspectorClose = page.locator(
      '[data-test="query-inspector"] [data-test="o-dialog-close-btn"]',
    );
    this.customQueryBtn = page.locator('[data-test="dashboard-custom-query-type"]');
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    this.discardBtn = page.locator('[data-test="dashboard-panel-discard"]');
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

  /** Locator for the rename input at given index.
   * The OInput wrapper carries the `...-input-${index}` data-test; the actual
   * <input> element is the inner `...-field` node (OInput convention), which is
   * what fill()/press() must target. */
  queryTabNameInput(index) {
    return this.page.locator(`[data-test="dashboard-panel-query-tab-name-input-${index}-field"]`);
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

  /** Locator for the config legend (per-query label) input at given index.
   * The OInput wrapper carries the `dashboard-config-legend-${index}` data-test;
   * the editable <input> is the inner `...-field` node (OInput convention). */
  configLegend(index) {
    return this.page.locator(`[data-test="dashboard-config-legend-${index}-field"]`);
  }

  /**
   * Locator for the trellis-chart OSelect when it is disabled.
   * OSelect renders an inner trigger button that carries the same
   * `data-test` as the wrapper, plus the standard `disabled` attribute
   * when the prop is set. The legacy disabled class no longer exists
   * after the v1 UX revamp.
   */
  trellisDisabled() {
    return this.page.locator(
      '[data-test="dashboard-trellis-chart"][disabled], [data-test="dashboard-trellis-chart"] [disabled]',
    );
  }

  /** Locator for the query name label shown inside the query inspector at given index */
  queryInspectorQueryName(index) {
    return this.page.locator(`[data-test="query-inspector-query-name-${index}"]`);
  }

  /**
   * Locator for the X-axis alias inconsistency warning icon.
   * Rendered by PanelErrorButtons.vue inside the panel editor header (reactive,
   * no Apply needed — updates as fields are added/removed).
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
    // The newly-added tab becomes the active tab synchronously (currentQueryIndex
    // is set to the new index). Wait for that deterministic state instead of a
    // fixed sleep, so the sidebar reflects the new query before it is configured.
    await this.waitForActiveQueryTab(expectedTabIndex);
    testLogger.debug("Added query tab", { expectedTabIndex });
  }

  /**
   * Wait until the query tab at the given index is the ACTIVE tab.
   * Reka UI's TabsTrigger marks the active tab with data-state="active"
   * (and aria-selected="true") on the same button that carries the data-test.
   * This is the deterministic replacement for fixed "settle" sleeps.
   * @param {number} index
   * @param {number} timeout
   */
  async waitForActiveQueryTab(index, timeout = 15000) {
    await this.page
      .locator(`[data-test="dashboard-panel-query-tab-${index}"][data-state="active"]`)
      .waitFor({ state: "visible", timeout });
  }

  /**
   * Switch to the query tab at given index.
   * @param {number} index
   */
  async switchToQueryTab(index) {
    await this.queryTab(index).click();
    // Wait for the clicked tab to actually become active (its fields/editor are
    // rendered for that query) instead of a fixed sleep.
    await this.waitForActiveQueryTab(index, 10000);
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
    // Wait deterministically for Monaco to reflect the typed SQL (debounce flush)
    // instead of a fixed sleep — mirrors the no-timeout VRL editor pattern.
    const snippet = sql.trim().substring(0, 12);
    if (snippet) {
      await this.page.waitForFunction(
        ({ sel, text }) => {
          const el = document.querySelector(sel);
          return !!el && (el.textContent || "").includes(text);
        },
        { sel: '[data-test="dashboard-panel-query-editor"]', text: snippet },
        { timeout: 10000 },
      );
    }
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
        await this.waitForActiveQueryTab(0, 10000).catch(() => {});
      }
      await pm.dashboardPanelActions.applyDashboardBtn();
      // Wait for the apply/query cycle to finish (apply button re-enabled)
      // instead of a fixed sleep before saving.
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await pm.dashboardPanelActions.savePanel();
      // Wait for navigation away from add_panel page after save
      await this.page.waitForURL((url) => !url.pathname.includes("add_panel"), {
        timeout: 30000,
      }).catch(() => {
        testLogger.warn("applyAndSave: did not navigate away from add_panel within timeout");
      });
    } finally {
      this.page.off("dialog", dialogHandler);
    }
  }

  /**
   * Discard the current panel and return to the dashboard view page.
   * Use this for teardown when the panel intentionally contains an
   * incomplete/invalid query (which cannot pass save validation) or when the
   * test does not need to persist the panel. Discarding an edited panel fires a
   * native window.confirm — Playwright auto-dismisses dialogs by default, which
   * would cancel navigation and leave the page on add_panel — so accept it.
   */
  async discardPanel() {
    const dialogHandler = (dialog) => dialog.accept();
    this.page.on("dialog", dialogHandler);
    try {
      await this.discardBtn.waitFor({ state: "visible", timeout: 15000 });
      await this.discardBtn.click();
      // Discard navigates to the dashboard view page (/dashboards/view).
      await this.page.waitForURL((url) => !url.pathname.includes("add_panel"), {
        timeout: 30000,
      });
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
    // Gate on the inspector CONTENT (first query name), NOT the ODialog wrapper:
    // the wrapper's data-test is a teleported/zero-size anchor that never reports
    // "visible", so waiting on it times out. The rendered query name is reliable.
    await this.queryInspectorQueryName(0).waitFor({
      state: "visible",
      timeout: 15000,
    });
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
