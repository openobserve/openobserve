//logs visualise page object
//Methods: openLogs, openVisualiseTab, logsApplyQueryButton, Visualize run query button, setRelative, searchAndAddField, showQueryToggle, enableSQLMode, streamIndexList, logsSelectStream, logsToggle, selectChartType, removeField, chartRender, backToLogs, openQueryEditor, fillQueryEditor
import { expect } from "@playwright/test";
export default class LogsVisualise {
  constructor(page) {
    this.page = page;
    this.timeTab = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');
    this.indexListDropdown = page.locator(
      '[data-test="log-search-index-list-select-stream"]'
    );
    this.functionEditor = page.locator(
      '[data-test="logs-vrl-function-editor"]'
    );
    this.queryEditor = page
      .locator('[data-test="logs-vrl-function-editor"]')
      .locator(".inputarea")
      .first();

    // Dashboard locators
    this.addToDashboardBtn = page.locator('[data-test="panel-editor-add-to-dashboard-btn"]');
    this.newDashboardBtn = page.locator(
      '[data-test="dashboard-dashboard-new-add"]'
    );
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name-field"]');
    // Inner "New dashboard" ODrawer's Save action — the legacy
    // `dashboard-add-submit` button was removed when AddDashboard.vue was
    // migrated to ODrawer (SelectDashboardDropdown now hosts the form and
    // the footer primary button calls addDashboardRef?.submit()).
    this.dashboardSubmitBtn = page.locator(
      '[data-test="dashboard-dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.panelTitleInput = page.locator(
      '[data-test="metrics-new-dashboard-panel-title-field"]'
    );
    // Outer "Add to Dashboard" ODrawer's Add action — the legacy
    // `metrics-schema-update-settings-button` was removed when AddToDashboard.vue
    // migrated to ODrawer (parent slug: add-to-dashboard-dialog).
    this.updateSettingsBtn = page.locator(
      '[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-primary-btn"]'
    );

    // Query editor locators
    this.logsQueryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]');
    //Functions
  }
  async openLogs() {
    // Open Logs Page
    await this.page.locator('[data-test="menu-link-\\/logs-item"]').click();
  }

  async openVisualiseTab() {
    // Open Visualise Tab
    const visualizeToggle = this.page.locator('[data-test="logs-visualize-toggle"]');
    // Wait for the toggle to be enabled before clicking
    await visualizeToggle.waitFor({ state: "visible", timeout: 10000 });
    await visualizeToggle.click();

    // Wait for the panel editor container to load (async component)
    // It may be hidden if there's a query error, so wait for attached (in DOM)
    await this.page.locator('[data-test="panel-editor-container"]').waitFor({
      state: "attached",
      timeout: 30000,
    });
  }

  // Open visualise tab and ensure table chart is selected when VRL is present
  async openVisualiseTabWithVrl() {
    await this.openVisualiseTab();

    // Ensure table chart is selected (VRL only works with table chart type)
    const tableChartItem = this.page.locator('[data-test="selected-chart-table-item"]');
    await tableChartItem.waitFor({ state: "visible", timeout: 10000 });

    const isTableSelected = await tableChartItem.getAttribute("data-selected");
    if (isTableSelected !== "true") {
      await tableChartItem.click();
    }
  }

  //Apply: Logs
  async logsApplyQueryButton() {
    await this.page
      .locator('[data-test="logs-search-bar-refresh-btn"]')
      .click();
  }

  // Wait for logs query to fully complete (similar to waitForChartToRender for dashboard)
  async waitForLogsQueryToComplete(timeout = 30000) {
    const runBtn = this.page.locator('[data-test="logs-search-bar-refresh-btn"]');

    // Wait for button to be visible first
    await runBtn.waitFor({ state: "visible", timeout: 10000 });

    // Wait for query execution to complete by checking button state
    // When query is running, the button may change to cancel or show loading state
    // When complete, the Run query button should be enabled and visible again
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-test="logs-search-bar-refresh-btn"]');
        if (!btn) return false;

        // Check if button is not disabled and contains "Run query" text
        const isEnabled = !btn.disabled && !btn.classList.contains('disabled');
        const hasRunQueryText = btn.textContent?.includes('Run query');

        // Also check that no loading indicator is present
        const hasLoadingClass = btn.hasAttribute('disabled') || btn.getAttribute('aria-busy') === 'true';

        return isEnabled && hasRunQueryText && !hasLoadingClass;
      },
      { timeout }
    );

  }

  // Apply logs query and wait for completion
  async logsApplyQueryAndWait(timeout = 30000) {
    await this.logsApplyQueryButton();
    await this.waitForLogsQueryToComplete(timeout);
  }

  //set relative time selection
  async setRelative(date, time) {
    // Wait for the date-time button to be enabled before interacting
    await this.page.waitForSelector(
      '[data-test="date-time-btn"]:not([disabled])',
      { timeout: 15000 }
    );
    await this.timeTab.click();
    await this.relativeTime.click();
    const selector = `[data-test="date-time-relative-${date}-${time}-btn"]`;
    // Wait for the relative time button to be enabled (not just visible)
    await this.page.waitForSelector(`${selector}:not([disabled])`, {
      timeout: 15000,
    });
    await this.page.locator(selector).click();
  }

  //search and add fields
  async searchAndAddField(fieldName, target) {
    const searchInput = this.page.locator(
      '[data-test="o-field-list-search-field"]'
    );
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.click();
    await searchInput.fill(fieldName);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const buttonTestId = buttonSelectors[target];
    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const button = this.page.locator(`[data-test="${buttonTestId}"]`);

    // Ensure the button is visible before clicking
    await button.waitFor({ state: "visible", timeout: 5000 });
    await button.click();
  }

  //show query toggle
  async showQueryToggle() {
    await this.page
      .locator('[data-test="logs-search-bar-show-query-toggle-btn"] img')
      .click();
  }

  //enable SQL Mode
  async enableSQLMode() {
    // SQL mode toggle was removed from the UI. SQL mode is now auto-detected
    // from query content — entering a SELECT query enables it automatically.
    // This method is intentionally a no-op.
  }

  //stream index list
  async streamIndexList() {
    await this.page
      .locator('[data-test="panel-editor-field-list-collapsed-icon"]')
      .click();
  }
  //logs: Select stream
  async logsSelectStream(stream) {
    await this.page
      .locator('[data-test="log-search-index-list-select-stream"]')
      .click({ force: true });
    const popover = this.page.locator(
      '[data-test="log-search-index-list-select-stream-popover"]'
    );
    await popover.waitFor({ state: "visible", timeout: 10000 });
    // OSelect virtualises past 50 options, so a target stream further down the
    // list is not in the DOM at all — filter it in through the popover search.
    const popoverSearch = popover.locator("input").first();
    await popoverSearch.click();
    await popoverSearch.fill(stream);
    // OSelect forwards parent data-test to ListboxItems (`*-option`).
    await popover
      .locator('[data-test="log-search-index-list-select-stream-option"]', { hasText: stream })
      .first()
      .click();
  }

  //logs toggle
  async logsToggle() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
  }

  //select chart type
  async selectChartType(chartType) {
    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible" });
    await chartOption.click({ force: true });
  }

  //remove field
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

  //chart render
  async chartRender(x, y) {
    await this.page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: x,
          y: y,
        },
      });
  }

  //back to logs
  async backToLogs() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
  }

  //open query editor
  async openQueryEditor() {
    await this.page.locator('[data-test="logs-search-bar-query-editor"]').getByRole('code').click();
  }

  //fill query editor
  async fillQueryEditor(sqlQuery) {
    const queryEditor = this.page.locator('[data-test="logs-search-bar-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 5000 });
    await queryEditor.getByRole('code').click();
    await queryEditor.locator('.inputarea').fill(sqlQuery);
  }

  //fill logs query editor with SQL query
  async fillLogsQueryEditor(sqlQuery) {
    await this.logsQueryEditor.waitFor({ state: "visible", timeout: 5000 });
    await this.logsQueryEditor.getByRole('code').click();
    await this.logsQueryEditor.locator('.inputarea').fill(sqlQuery);
  }

  // Open the first VRL Function Editor
  async vrlFunctionEditor(vrl) {
    await this.functionEditor.first().click();
    await this.queryEditor.fill(vrl);
  }

  async runQueryAndWaitForCompletion() {
    const runBtn = this.page.locator(
      '[data-test="logs-search-bar-visualize-refresh-btn"]'
    );
    const cancelBtn = this.page.locator(
      '[data-test="logs-search-bar-visualize-cancel-btn"]'
    );
    await runBtn.waitFor({ state: "visible" });
    await runBtn.click();
    // Wait for query to start (cancel btn appears) then complete (cancel btn disappears)
    await cancelBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await cancelBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  }

  // Helper function to check for dashboard errors
  async checkDashboardErrors(page, chartTypeName) {
    const dashboardErrorContainer = page.locator(
      '[data-test="dashboard-error"]'
    );
    const errorContainerExists = await dashboardErrorContainer.count();

    if (errorContainerExists === 0) {
      return { hasErrors: false, errors: [], errorTextCount: 0, errorListCount: 0 };
    }

    const isErrorVisible = await dashboardErrorContainer.first().isVisible();
    if (!isErrorVisible) {
      return { hasErrors: false, errors: [], errorTextCount: 0, errorListCount: 0 };
    }

    const errors = [];

    // Check for error indicator text
    const errorText = page
      .locator('[data-test="dashboard-error"]')
      .getByText(/Errors \(\d+\)/);
    const errorTextCount = await errorText.count();

    if (errorTextCount > 0) {
      const errorTextContent = await errorText.first().textContent();
      errors.push(`Error indicator: ${errorTextContent}`);
    }

    // Check for error list items
    const errorListItems = page.locator('[data-test="dashboard-error"] ul li');
    const errorListCount = await errorListItems.count();

    if (errorListCount > 0) {
      for (let i = 0; i < errorListCount; i++) {
        const errorItem = errorListItems.nth(i);
        const errorItemText = await errorItem.textContent();
        if (errorItemText && errorItemText.trim().length > 0) {
          errors.push(`Error ${i + 1}: ${errorItemText.trim()}`);
        }
      }
    }

    return {
      hasErrors: errors.length > 0,
      errors,
      errorTextCount,
      errorListCount,
    };
  }

  async verifyChartRenders(page) {
    const chartRenderer = page.locator(
      '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
    );

    try {
      // Wait for chart renderer to be present and visible
      await chartRenderer.first().waitFor({
        state: "visible",
        timeout: 15000,
      });

      // Additional check to ensure the chart is actually rendered
      const chartExists = await chartRenderer.count();

      if (chartExists > 0) {
        // Double-check visibility after waiting
        const isVisible = await chartRenderer.first().isVisible();
        if (!isVisible) {
          // Wait for chart content to be rendered intelligently
          const chartContentReady = await this.waitForChartContent(page, 3000);

          if (!chartContentReady) {
            // Fallback: try waiting for chart renderer to be stable
            try {
              await chartRenderer.first().waitFor({
                state: "visible",
                timeout: 2000,
              });
            } catch (fallbackError) {
              throw new Error(
                `Chart renderer present but content failed to load after intelligent waiting. Error: ${fallbackError.message}`
              );
            }
          }

          // Final visibility check after intelligent waiting
          const isVisibleRetry = await chartRenderer.first().isVisible();
          if (!isVisibleRetry) {
            throw new Error(
              "Chart renderer is present but not visible after intelligent retry"
            );
          }
        }
      }

      return chartExists > 0;
    } catch (error) {
      // If waiting times out, check if element exists but is not visible
      const chartExists = await chartRenderer.count();
      if (chartExists > 0) {
        const isVisible = await chartRenderer.first().isVisible();
        throw new Error(
          `Chart renderer found (${chartExists} elements) but visibility check failed. Is visible: ${isVisible}. Original error: ${error.message}`
        );
      } else {
        throw new Error(
          `No chart renderer found. Original error: ${error.message}`
        );
      }
    }
  }

  // RECOMMENDED: Native browser function (fastest & most reliable)
  async waitForChartContent(page, timeout = 5000) {
    return page
      .waitForFunction(
        () =>
          document.querySelector(
            '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
          )?.offsetParent !== null,
        {},
        { timeout }
      )
      .then(() => true)
      .catch(() => false);
  }

  // Get quick mode toggle state using the most reliable method
  async getQuickModeToggleState() {
    // Open utilities dropdown to access the quick mode toggle
    const utilitiesBtn = this.page.locator(
      '[data-test="logs-search-bar-utilities-menu-btn"]'
    );
    await utilitiesBtn.waitFor({ state: "visible", timeout: 10000 });
    await utilitiesBtn.click();

    const quickModeSwitch = this.page.locator(
      '[data-test="logs-search-bar-quick-mode-switch"]'
    );
    await quickModeSwitch.waitFor({ state: "visible", timeout: 10000 });

    // OSwitch inner button carries aria-checked
    const switchBtn = quickModeSwitch.locator('[data-test$="-btn"]');
    const ariaChecked = await switchBtn.getAttribute("aria-checked");

    // Close dropdown
    await this.page.keyboard.press("Escape");

    return ariaChecked === "true";
  }

  // Verify quick mode toggle state
  async verifyQuickModeToggle(expectedState = true) {
    const isChecked = await this.getQuickModeToggleState();

    // Validate the toggle state matches expectation
    if (expectedState !== isChecked) {
      throw new Error(
        `Expected quick mode to be ${expectedState} but actual state is ${isChecked}`
      );
    }

    return isChecked;
  }

  // Toggle quick mode to specific state (enable/disable)
  async setQuickModeToggle(enableState) {
    const quickModeToggle = this.page.locator(
      '[data-test="logs-search-bar-quick-mode-toggle-btn"]'
    );

    await quickModeToggle.waitFor({ state: "visible", timeout: 10000 });

    const currentState = await this.getQuickModeToggleState();

    // Only click if we need to change the state
    if (currentState !== enableState) {
      await quickModeToggle.click();

      // Wait for state change to complete
      await this.page.waitForTimeout(500);

      // Verify the state actually changed
      const newState = await this.getQuickModeToggleState();
      if (newState !== enableState) {
        throw new Error(
          `Failed to set quick mode to ${enableState}. Current state: ${newState}`
        );
      }
    }

    return enableState;
  }

  // Enable quick mode if it's currently disabled
  async enableQuickModeIfDisabled() {
    return await this.setQuickModeToggle(true);
  }

  // Disable quick mode if it's currently enabled
  async disableQuickModeIfEnabled() {
    return await this.setQuickModeToggle(false);
  }

  // Helper function to verify chart type selection
  async verifyChartTypeSelected(page, chartType, shouldBeSelected = true) {
    const locator = page.locator(`[data-test="selected-chart-${chartType}-item"]`);

    if (shouldBeSelected) {
      await expect(locator).toHaveAttribute("data-selected", "true");
    } else {
      await expect(locator).toHaveAttribute("data-selected", "false");
    }
  }

  async addPanelToNewDashboard(randomDashboardName, panelName) {
    // Add to dashboard and submit it
    await this.addToDashboardBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.addToDashboardBtn.click();

    // Wait for the "Add to Dashboard" side panel to fully load. The old
    // `schema-title-text` element was removed when AddToDashboard.vue migrated
    // to ODrawer — use the drawer's parent slug instead.
    const sidePanelTitle = this.page.locator('[data-test="add-to-dashboard-dialog"]');
    await sidePanelTitle.waitFor({ state: "visible", timeout: 10000 });
    await sidePanelTitle.waitFor({ state: "attached", timeout: 5000 });

    // Wait for the "new dashboard" button to be visible and stable
    await this.newDashboardBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.newDashboardBtn.waitFor({ state: "attached", timeout: 5000 });
    // await this.page.waitForTimeout(500);

    // Click new dashboard option
    await this.newDashboardBtn.click();

    // Wait for the "New dashboard" dialog to open and stabilize
    await this.dashboardNameInput.waitFor({ state: "visible", timeout: 10000 });
    await this.dashboardNameInput.waitFor({ state: "attached", timeout: 5000 });
    // await this.page.waitForTimeout(500);

    // Fill dashboard name
    await this.dashboardNameInput.click();
    await this.dashboardNameInput.fill(randomDashboardName);

    // Submit dashboard creation
    await this.dashboardSubmitBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.dashboardSubmitBtn.click();

    // Wait for panel title input to be available (replacing hardcoded timeout)
    await this.panelTitleInput.waitFor({ state: "visible", timeout: 10000 });
    await this.panelTitleInput.click();
    await this.panelTitleInput.fill(panelName);

    // Submit panel settings
    await this.updateSettingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.updateSettingsBtn.click();
  }

  //wait for query inspector to be visible
  async waitForQueryInspector(page) {
    const queryInspectorCloseBtn = page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]');
    await queryInspectorCloseBtn.waitFor({ state: "visible", timeout: 10000 });
  }

  async closeQueryInspector() {
    const closeBtn = this.page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]');
    await closeBtn.click();
    await this.page.locator('[data-test="query-inspector-dialog"]').waitFor({ state: 'hidden', timeout: 5000 });
  }

  // Verify toast message is visible with expected text
  async verifyToastMessage(expectedText, timeout = 10000) {
    const toast = this.page.locator('[data-test="o-toast-message"]', { hasText: expectedText }).first();
    await expect(toast).toBeVisible({ timeout });
    return toast;
  }

  // Locator for a saved panel's dropdown menu trigger
  getPanelDropdown(panelName) {
    return this.page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`);
  }

  // ── VRL visualization locator getters (used by visualize-vrl spec) ──────────

  // Utilities menu button in the logs/visualize search bar (hosts the VRL toggle)
  getUtilitiesMenuBtn() {
    return this.page.locator('[data-test="logs-search-bar-utilities-menu-btn"]');
  }

  // VRL show-query toggle button rendered inside the utilities dropdown menu
  getVrlToggleMenuBtn() {
    return this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn-btn"]');
  }

  // Rendered dashboard table panel
  getTablePanel() {
    return this.page.locator('[data-test="dashboard-panel-table"]');
  }

  // Data rows inside the rendered dashboard table panel
  getTableRows() {
    return this.page.locator('[data-test="dashboard-panel-table"] tbody tr');
  }

  // Chart-type selector item by type (e.g. "table", "line", "bar", "h-bar")
  getChartTypeItem(chartType) {
    return this.page.locator(`[data-test="selected-chart-${chartType}-item"]`);
  }

  // "Edit panel" action button (from a panel dropdown menu)
  getEditPanelBtn() {
    return this.page.locator('[data-test="dashboard-edit-panel"]');
  }

  // VRL "only supported for table chart" warning banner
  getVrlWarningBanner() {
    return this.page.getByText("VRL function is only supported for table chart");
  }

  // VRL error notification (present only when VRL functions are active on non-table)
  getVrlErrorNotification() {
    return this.page.getByText(
      "VRL functions are present. Only table chart is supported when using VRL functions."
    );
  }

  // Toast message locator scoped to a given text
  getToastMessageByText(text) {
    return this.page
      .locator('[data-test="o-toast-message"]')
      .filter({ hasText: text });
  }

  // Dashboard back button locator (for waits; use clickDashboardBackBtn() to click)
  getDashboardBackBtn() {
    return this.page.locator('[data-test="dashboard-back-btn"]');
  }

  // Dialog primary (confirm) button locator
  getDialogPrimaryBtn() {
    return this.page.locator('[data-test="o-dialog-primary-btn"]');
  }

  // Sidebar/table field locator matched by Playwright text engine selector
  getFieldByTextSelector(textSelector) {
    return this.page.locator(textSelector);
  }

  // Open query inspector from a panel dropdown
  async openPanelQueryInspector(panelName) {
    // Wait for the dashboard view to fully load after panel save
    await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const dropdown = this.getPanelDropdown(panelName);
    await dropdown.waitFor({ state: "visible", timeout: 20000 });
    await dropdown.click();

    const inspectorBtn = this.page.locator('[data-test="dashboard-query-inspector-panel"]');
    await inspectorBtn.waitFor({ state: "visible", timeout: 10000 });
    await inspectorBtn.click();
    await this.waitForQueryInspector(this.page);
  }

  // Verify executed query in query inspector contains expected text
  async verifyExecutedQueryContains(expectedTexts, queryIndex = 0) {
    const executedQuery = this.page.locator(`[data-test="query-inspector-executed-query-${queryIndex}"]`);
    await expect(executedQuery).toBeVisible({ timeout: 10000 });
    for (const text of expectedTexts) {
      await expect(executedQuery).toContainText(text);
    }
  }

  // Click the dashboard back button
  async clickDashboardBackBtn() {
    await this.page.locator('[data-test="dashboard-back-btn"]').click();

    // Both the panel-editor and dashboard-view page render an element with
    // the same data-test="dashboard-back-btn" — a click right after saving
    // can land on a stale instance mid page-transition and silently no-op.
    // Verify the URL actually changed and retry once if not.
    try {
      await this.page.waitForURL(/\/dashboards(?:\?|$)/, { timeout: 8000 });
    } catch (e) {
      await this.page.locator('[data-test="dashboard-back-btn"]').click();
      await this.page.waitForURL(/\/dashboards(?:\?|$)/, { timeout: 15000 });
    }
  }

  // Get chart renderer canvas locator
  getChartRendererCanvas() {
    return this.page.locator('[data-test="chart-renderer"] canvas');
  }

  // Get dashboard error locator
  getDashboardErrorLocator() {
    return this.page.locator('[data-test="dashboard-error"]');
  }

  // Verify no dashboard errors are present
  async verifyNoDashboardErrors() {
    const errorLocator = this.getDashboardErrorLocator();
    await expect(errorLocator).toHaveCount(0);
  }

  // Get connect null values toggle button locator
  getConnectNullValuesToggle() {
    return this.page.locator(
      '[data-test="dashboard-config-connect-null-values"] [data-test$="-btn"]'
    );
  }
}
