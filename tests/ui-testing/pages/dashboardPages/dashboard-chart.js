// pages/chartTypeSelector.js
// Methods : selectChartType, selectStreamType, searchAndAddField,  selectStream

const { expect } = require("@playwright/test");
const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class ChartTypeSelector {
  constructor(page) {
    this.page = page;

    // Raw query / DynamicFunctionPopUp selectors
    this.rawQueryTextarea = page.locator('[data-test="dashboard-raw-query-textarea-field"]');
    this.popupTabs = page.locator('[data-test="dynamic-function-popup-tabs"]');
    this.buildTab = page.locator('[data-test="dynamic-function-popup-tab-build"]');
    this.rawTab = page.locator('[data-test="dynamic-function-popup-tab-raw"]');

    // Field property checkboxes (visible on table chart type)
    this.treatAsNonTimestampCheckbox = page.locator('[data-test="dynamic-function-popup-treat-as-non-timestamp"]');
    this.showFieldAsJsonCheckbox = page.locator('[data-test="dynamic-function-popup-show-field-as-json"]');

    // Query type selectors
    this.sqlQueryTypeBtn = page.locator('[data-test="dashboard-sql-query-type"]');
    this.customQueryTypeBtn = page.locator('[data-test="dashboard-custom-query-type"]');
    this.builderQueryTypeBtn = page.locator('[data-test="dashboard-builder-query-type"]');

    // Custom query editor
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');

    // JSON renderer locators (source-defined data-tests in JsonFieldRenderer.vue)
    this.jsonFieldRenderer = page.locator('[data-test="json-field-renderer"]');
    this.jsonKey = page.locator('[data-test="json-key"]');
    this.jsonValue = page.locator('[data-test="json-value"]');
  }

  // Chart Type select
  async selectChartType(chartType) {
    // Wait for panel editor to be ready - could be full page or dialog
    // Look for either the Apply button or any chart type selector
    const panelEditorIndicator = this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    );

    // Wait for panel editor to be visible with retry
    try {
      await panelEditorIndicator.first().waitFor({ state: "visible", timeout: 15000 });
    } catch (e) {
      // Panel editor may take extra time to load, wait for network idle and retry
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await panelEditorIndicator.first().waitFor({ state: "visible", timeout: 10000 });
    }

    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible", timeout: 15000 });
    await chartOption.scrollIntoViewIfNeeded();
    await chartOption.click();
  }

  //  Stream Type select - waits for stream list to load after selection
  async selectStreamType(type) {
    // Click the dropdown trigger
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();

    // Wait for popover, then pick option by text (OSelect uses o-select-option data-test)
    const streamTypePopover = this.page.locator('[data-test="index-dropdown-stream_type-popover"]');
    await streamTypePopover.waitFor({ state: "visible", timeout: 10000 });
    await streamTypePopover.getByText(type, { exact: true }).first().click();

    // CRITICAL: Wait for stream list API call to complete after changing type
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await this.page.locator('[data-test="index-dropdown-stream"]').waitFor({ state: "visible", timeout: 10000 });
  }

  // Stream select with retry mechanism (no page reload to preserve context)
  async selectStream(streamName, maxRetries = 3) {
    const streamInput = this.page.locator(
      '[data-test="index-dropdown-stream"]'
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Close any open dropdown first — click outside (ODropdown closes on outside click)
        await this.page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});

        await streamInput.waitFor({ state: "visible", timeout: 5000 });
        await streamInput.click();

        // Wait for popover to open, then type via keyboard (OSelect wrapper div doesn't accept fill directly)
        const popover = this.page.locator('[data-test="index-dropdown-stream-popover"]');
        await popover.waitFor({ state: "visible", timeout: 10000 });
        await this.page.keyboard.press("Control+a");
        await this.page.keyboard.type(streamName);

        // Log available options after filtering
        const allOptions = await this.page
          .locator('[data-test="index-dropdown-stream-popover"] [data-test="index-dropdown-stream-option"]')
          .allTextContents();
        testLogger.debug(`Attempt ${attempt}: Looking for "${streamName}". Available options (${allOptions.length}): ${allOptions.slice(0, 10).join(', ')}`);

        const streamOption = this.page
          .locator('[data-test="index-dropdown-stream-option"]', { hasText: streamName })
          .first();

        await streamOption.waitFor({ state: "visible", timeout: 15000 });
        await streamOption.click();
        return; // Success
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt: log full diagnostic info
          const finalOptions = await this.page
            .locator('[data-test="index-dropdown-stream-popover"] [data-test="index-dropdown-stream-option"]')
            .allTextContents()
            .catch(() => []);
          testLogger.error(`FAILED after ${maxRetries} attempts. Final options: ${finalOptions.join(', ')}`);
          throw error;
        }
        // Close dropdown and wait for network before retry (don't reload - loses context!)
        await this.page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
        await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      }
    }
  }

  // Search field and added for X, Y,Breakdown etc.

  async searchAndAddField(fieldName, target) {
    // o-field-list-search is a div wrapper — scope fill to its inner input
    const searchInput = this.page.locator('[data-test="o-field-list-search"] input');
    await searchInput.click();
    await searchInput.fill(fieldName);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      p: "dashboard-add-p-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
      source: "dashboard-add-source-data",
      target: "dashboard-add-target-data",
      sankeyvalue: "dashboard-add-value-data",
    };

    const buttonTestId = buttonSelectors[target];

    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    // New data-test format: o-field-list-row-{fieldName}
    const fieldItem = this.page.locator(`[data-test="o-field-list-row-${fieldName}"]`);
    await fieldItem.first().waitFor({ state: "visible", timeout: 10000 });

    // hover() auto-scrolls into view — scrollIntoViewIfNeeded() is not needed.
    // Retry for DOM stability: Vue re-renders the field list multiple times after
    // search input changes (debounce / virtual scroll), which detaches the element
    // between waitFor and the action. Re-waiting after each detachment lets the
    // list settle before the next attempt.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fieldItem.first().hover({ timeout: 5000 });
        break;
      } catch (e) {
        if (attempt === maxAttempts) throw e;
        await fieldItem.first().waitFor({ state: "visible", timeout: 5000 });
      }
    }

    // Now locate and click the button within the field item.
    // Use .first() — in join panels the same field name can appear multiple times
    // (once per joined stream), which would cause a strict mode violation.
    const button = fieldItem.first().locator(`[data-test="${buttonTestId}"]`);
    await button.waitFor({ state: "visible", timeout: 5000 });
    await button.click();
    await searchInput.fill(""); // Clear the search input
  }

  /**
   * Search for a field by name without adding it to any axis.
   * Useful for checking +P / +X button visibility after searching.
   * @param {string} fieldName
   */
  async searchField(fieldName) {
    const searchInput = this.page.locator('[data-test="o-field-list-search"] input');
    await searchInput.click();
    await searchInput.fill(fieldName);
  }

  /**
   * Clear the field search input.
   */
  async clearFieldSearch() {
    const searchInput = this.page.locator('[data-test="o-field-list-search"] input');
    await searchInput.click();
    await searchInput.fill('');
  }

  //remove fields from the dashboard
  // Remove field by type (x, y, breakdown, etc.)
  // @param alias - The field alias (e.g., "x_axis_1", "y_axis_1", "breakdown_1")
  // @param target - The target type (x, y, b, filter, etc.)
  async removeField(alias, target) {
    const removeSelectors = {
      x: "dashboard-x-item",
      y: "dashboard-y-item",
      b: "dashboard-b-item",
      filter: "dashboard-filter-item",
      latitude: "dashboard-latitude-item",
      longitude: "dashboard-longitude-item",
      weight: "dashboard-weight-item",
      z: "dashboard-z-item",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
      source: "dashboard-source-item",
      target: "dashboard-target-item",
      sankeyvalue: "dashboard-value-item",
    };

    const baseTestId = removeSelectors[target];
    if (!baseTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const removeButton = this.page.locator(
      `[data-test="${baseTestId}-${alias}-remove"]`
    );

    await removeButton.waitFor({ state: "visible", timeout: 10000 });
    await removeButton.click();
  }

  // Helper function to wait for table data to load completely
  async waitForTableDataLoad() {
    // Wait for table to be visible
    await this.page.waitForSelector('[data-test="dashboard-panel-table"]', {
      timeout: 10000,
    });

    // Wait for table to have data (non-empty tbody)
    await this.page.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-test="dashboard-panel-table"]'
        );
        const rows = table?.querySelectorAll("tbody tr");
        return (
          rows &&
          rows.length > 0 &&
          Array.from(rows).some((row) =>
            Array.from(row.querySelectorAll("td")).some(
              (cell) => cell.textContent.trim() !== ""
            )
          )
        );
      },
      { timeout: 15000 }
    );
  }

  // ===== Y-AXIS FUNCTION CONFIGURATION METHODS =====

  /**
   * Open the Y-axis function configuration popup
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1", "y_axis_2")
   */
  async openYAxisFunctionPopup(alias) {
    const yAxisItem = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    await yAxisItem.waitFor({ state: "visible", timeout: 10000 });
    await yAxisItem.click();

    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Select a function from the function dropdown
   * @param {string} functionName - The function to select (e.g., "count", "sum", "avg", "min", "max", "Distinct")
   */
  async selectFunction(functionName) {
    const dropdown = this.page.locator('[data-test="dashboard-function-dropdown"]').first();
    await dropdown.waitFor({ state: "visible", timeout: 10000 });
    await dropdown.click();

    await this.page.locator('[data-test="dashboard-function-dropdown-popover"]').waitFor({ state: "visible", timeout: 5000 });
    await this.page.keyboard.type(functionName);

    // Use case-insensitive contains match — OSelect forwards parent data-test to options.
    const option = this.page
      .locator('[data-test="dashboard-function-dropdown-option"]', { hasText: new RegExp(functionName, 'i') })
      .first();
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
  }

  /**
   * Verify Y-axis label contains expected function name
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} expectedFunction - The expected function name in the label
   * @param {Function} expect - Playwright expect function
   */
  async verifyYAxisLabel(alias, expectedFunction, expect) {
    const yAxisLabel = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    const labelText = await yAxisLabel.textContent();
    expect(labelText.toLowerCase()).toContain(expectedFunction.toLowerCase());
    return labelText;
  }

  /**
   * Configure a Y-axis field with a function in one method
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} functionName - The function to apply (e.g., "count", "sum")
   */
  async configureYAxisFunction(alias, functionName) {
    await this.openYAxisFunctionPopup(alias);
    await this.selectFunction(functionName);
    await this.page.locator('body').click({ position: { x: 10, y: 10 } });
    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  // ===== RAW QUERY CONFIGURATION METHODS =====

  /**
   * Switch to the Raw tab in the DynamicFunctionPopUp
   * Requires the Y-axis popup to already be open (call openYAxisFunctionPopup first)
   */
  async switchToRawTab() {
    await this.rawTab.waitFor({ state: "visible", timeout: 10000 });
    await this.rawTab.click();
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    testLogger.debug('Switched to Raw tab');
  }

  /**
   * Switch to the Build tab in the DynamicFunctionPopUp
   * Requires the Y-axis popup to already be open
   */
  async switchToBuildTab() {
    await this.buildTab.waitFor({ state: "visible", timeout: 10000 });
    await this.buildTab.click();
    // Wait for Build tab content to render (function dropdown becomes visible)
    await this.page.locator('[data-test="dashboard-function-dropdown"]').first().waitFor({ state: "visible", timeout: 10000 });
    testLogger.debug('Switched to Build tab');
  }

  /**
   * Enter a raw SQL query in the Raw tab textarea
   * Requires the Raw tab to be active
   * @param {string} query - The raw SQL query to enter
   */
  async enterRawQuery(query) {
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    await this.rawQueryTextarea.click();
    await this.rawQueryTextarea.fill(query);
    testLogger.debug('Entered raw query', { query });
  }

  /**
   * Get the current value of the raw query textarea
   * Requires the Raw tab to be active
   * @returns {Promise<string>} The raw query text
   */
  async getRawQueryValue() {
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    return await this.rawQueryTextarea.inputValue();
  }

  /**
   * Verify the raw query textarea is visible
   * @param {Function} expect - Playwright expect function
   */
  async verifyRawTextareaVisible(expect) {
    await expect(this.rawQueryTextarea).toBeVisible({ timeout: 10000 });
  }

  /**
   * Configure a Y-axis field with a raw query in one method
   * Opens the popup, switches to Raw tab, enters query, and closes popup
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} query - The raw SQL query to enter
   */
  async configureYAxisRawQuery(alias, query) {
    await this.openYAxisFunctionPopup(alias);
    await this.switchToRawTab();
    await this.enterRawQuery(query);
    await this.page.locator('body').click({ position: { x: 10, y: 10 } });
    // Wait for popup to close
    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "hidden", timeout: 10000 });
    testLogger.info('Configured Y-axis raw query', { alias, query });
  }

  /**
   * Verify the Build/Raw tabs are visible in the popup
   * Requires the Y-axis popup to already be open
   * @param {Function} expect - Playwright expect function
   */
  async verifyBuildRawTabsVisible(expect) {
    await expect(this.popupTabs).toBeVisible({ timeout: 10000 });
    await expect(this.buildTab).toBeVisible();
    await expect(this.rawTab).toBeVisible();
  }

  /**
   * Verify the Build/Raw tabs are NOT visible (e.g., in custom query mode)
   * @param {Function} expect - Playwright expect function
   */
  async verifyBuildRawTabsNotVisible(expect) {
    await expect(this.popupTabs).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Open field property popup by clicking on an axis item
   * @param {string} alias - The axis alias (e.g., "x_axis_1", "y_axis_1")
   * @param {string} axis - The axis type ("x" or "y")
   */
  async openFieldPropertyPopup(alias, axis = "x") {
    const itemLocator = this.page.locator(`[data-test="dashboard-${axis}-item-${alias}"]`);
    await itemLocator.waitFor({ state: "visible", timeout: 10000 });

    // The popup is an ODropdown anchored to the axis item. When opened
    // immediately after the panel's first render, a late re-render of the
    // field list can re-mount the trigger and auto-dismiss the popup within
    // a few hundred ms — so a single click + visibility check races against
    // the popup vanishing. Open it, then confirm it STAYS open; re-open if it
    // auto-closed. Click only when the popup isn't already open (the trigger
    // toggles, so clicking an open popup would close it).
    const popupRoot = this.page.locator('[data-test="dynamic-function-popup-root"]');
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!(await popupRoot.isVisible().catch(() => false))) {
        await itemLocator.click();
      }
      const opened = await popupRoot
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (opened) {
        // Confirm the popup is still open after the window in which the
        // post-render re-render would have dismissed it.
        await this.page.waitForTimeout(700);
        if (await popupRoot.isVisible().catch(() => false)) {
          testLogger.debug('Opened field property popup', { alias, axis, attempt });
          return;
        }
      }
      // Auto-closed (or never opened) — wait briefly for the panel to settle,
      // then retry the open.
      await this.page.waitForTimeout(500);
    }
    throw new Error(
      `Field property popup for ${axis}-item-${alias} did not stay open after ${maxAttempts} attempts`,
    );
  }

  /**
   * Toggle "Mark this field as non-timestamp" checkbox
   */
  async toggleTreatAsNonTimestamp() {
    await this.treatAsNonTimestampCheckbox.waitFor({ state: "visible", timeout: 10000 });
    await this.treatAsNonTimestampCheckbox.click();
    testLogger.debug('Toggled treat as non-timestamp checkbox');
  }

  /**
   * Toggle "Render Data as JSON / Array" checkbox.
   * Waits for `isChecked()` to flip so the underlying field model
   * (fields.showFieldAsJson) is guaranteed propagated before Apply.
   * (`isChecked()` works on Radix-style OCheckbox via the role="checkbox"
   * descendant, so this stays selector-policy compliant.)
   */
  async toggleShowFieldAsJson() {
    await this.showFieldAsJsonCheckbox.waitFor({
      state: "visible",
      timeout: 10000,
    });
    const beforeChecked = await this.showFieldAsJsonCheckbox.isChecked();
    await this.showFieldAsJsonCheckbox.click();
    // Poll isChecked() until it flips, confirming the v-model update
    // propagated to the parent panel before any subsequent Apply.
    await expect
      .poll(
        async () => await this.showFieldAsJsonCheckbox.isChecked(),
        { timeout: 5000 },
      )
      .toBe(!beforeChecked);
    testLogger.debug("Toggled show field as JSON checkbox");
  }

  /**
   * Switch to Custom query mode
   */
  async switchToCustomQueryMode() {
    await this.customQueryTypeBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.customQueryTypeBtn.click();
    testLogger.debug('Switched to custom query mode');
  }

  /**
   * Wait for a field to appear in the field list (e.g. after SQL parsing).
   * @param {string} fieldName - The field name to wait for
   * @param {number} timeout - Max wait time in ms (default 10000)
   */
  async waitForFieldListRow(fieldName, timeout = 10000) {
    const fieldRow = this.page.locator(`[data-test="o-field-list-row-${fieldName}"]`).first();
    await fieldRow.waitFor({ state: "visible", timeout });
  }

  /**
   * Enter a custom SQL query in the Monaco editor.
   * Clicks the editor wrapper (data-test) then types via the page keyboard,
   * avoiding class/role selectors that violate the PO selector policy.
   * @param {string} query - The SQL query to enter
   */
  async enterCustomSQL(query) {
    await this.queryEditor.waitFor({ state: "visible", timeout: 10000 });
    await this.queryEditor.click();
    await this.page.keyboard.press("Escape"); // dismiss any open Monaco suggestion
    await this.page.keyboard.press("Control+a");
    await this.page.keyboard.press("Delete");
    // Use insertText (single input event) instead of type (per-character keydown events)
    // to prevent Monaco's autocomplete from accepting suggestions mid-input and
    // mangling the SQL (e.g. replacing table names with function calls).
    await this.page.keyboard.insertText(query);
    await this.page.keyboard.press("Escape"); // dismiss any suggestion triggered at end
    testLogger.debug('Entered custom SQL query', { query });
  }

  /**
   * End-to-end helper: switch to SQL → Custom query mode and enter the query.
   * @param {string} query - The SQL query to enter
   */
  async setCustomSQL(query) {
    await this.sqlQueryTypeBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.sqlQueryTypeBtn.click();
    await this.customQueryTypeBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.customQueryTypeBtn.click();
    await this.enterCustomSQL(query);
  }

  /**
   * Dismiss the field property popup (ODropdown portal) by pressing Escape.
   * Waits for the JSON-toggle checkbox (which only renders inside the open popup)
   * to detach so the menu is guaranteed gone before subsequent actions.
   */
  async dismissFieldPropertyPopup() {
    await this.page.keyboard.press('Escape');
    await this.showFieldAsJsonCheckbox
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
    testLogger.debug('Dismissed field property popup');
  }

  /**
   * Verify the JSON renderer element is visible after JSON-rendering is enabled.
   * Waits up to 60s for the renderer to attach + become visible; the panel
   * re-renders asynchronously after Apply, so we poll on attach first to
   * ride out the column-meta hydration that triggers JsonFieldRenderer.
   */
  async verifyJsonRendererVisible() {
    // Wait for at least one renderer to attach (mount) — this rides out
    // the panel-schema → TenstackTable column-meta → JsonFieldRenderer
    // hydration cycle that happens just after Apply.
    await expect
      .poll(
        async () => await this.jsonFieldRenderer.count(),
        { timeout: 60000 },
      )
      .toBeGreaterThan(0);
    // TenstackTable virtualises rows — the FIRST renderer in DOM order may be
    // a buffered (off-viewport) row reporting `hidden` per Playwright's
    // visibility test even though it's mounted and laid out. Poll for ANY
    // attached `json-field-renderer` to have a non-zero bounding box, which
    // matches the spec's downstream `verifyJsonContainsKey/Value` calls that
    // succeed when even one renderer has rendered content.
    await expect
      .poll(
        async () =>
          await this.page.evaluate(() => {
            const nodes = document.querySelectorAll(
              '[data-test="json-field-renderer"]',
            );
            return Array.from(nodes).some((n) => {
              const r = n.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
          }),
        { timeout: 30000 },
      )
      .toBe(true);
  }

  /**
   * Get the count of attached json-field-renderer elements (may be in overflow)
   * @returns {Promise<number>} count of JSON renderer elements
   */
  async getJsonRendererCount() {
    await this.jsonFieldRenderer.first().waitFor({ state: 'attached', timeout: 30000 });
    return await this.jsonFieldRenderer.count();
  }

  /**
   * Verify that at least one JSON key element contains the expected key text.
   * Uses page.evaluate against data-test="json-key" elements (no text=/has-text selectors).
   * @param {string} expectedKey - The JSON key to find (e.g., "domain")
   */
  async verifyJsonContainsKey(expectedKey) {
    await this.jsonKey.first().waitFor({ state: 'attached', timeout: 30000 });
    const found = await this.page.evaluate((key) => {
      const nodes = document.querySelectorAll('[data-test="json-key"]');
      return Array.from(nodes).some((n) => (n.textContent || '').trim() === key);
    }, expectedKey);
    if (!found) {
      throw new Error(`Expected JSON key "${expectedKey}" was not rendered`);
    }
  }

  /**
   * Verify that at least one JSON value element contains the expected value text.
   * Uses page.evaluate against data-test="json-value" elements (no text=/has-text selectors).
   * @param {string} expectedValue - The JSON value substring to find (e.g., "service.local")
   */
  async verifyJsonContainsValue(expectedValue) {
    await this.jsonValue.first().waitFor({ state: 'attached', timeout: 30000 });
    const found = await this.page.evaluate((val) => {
      const nodes = document.querySelectorAll('[data-test="json-value"]');
      return Array.from(nodes).some((n) => (n.textContent || '').includes(val));
    }, expectedValue);
    if (!found) {
      throw new Error(`Expected JSON value "${expectedValue}" was not rendered`);
    }
  }
}
