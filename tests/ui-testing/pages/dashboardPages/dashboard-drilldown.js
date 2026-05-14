// Page object for Dashboard Panel Drilldown configuration
// Covers: Logs, URL, byDashboard drilldown types + chart-click trigger

export default class DashboardDrilldownPage {
  constructor(page) {
    this.page = page;

    // Config sidebar — drilldown section
    this.addButton = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
    this.popup = page.locator('[data-test="dashboard-drilldown-popup"]');
    this.nameInput = page.locator('[data-test="dashboard-config-panel-drilldown-name"]');
    this.logsButton = page.locator('[data-test="dashboard-drilldown-by-logs-btn"]');
    this.urlButton = page.locator('[data-test="dashboard-drilldown-by-url-btn"]');
    this.urlTextarea = page.locator('[data-test="dashboard-drilldown-url-textarea"]');
    this.urlErrorMessage = page.locator('[data-test="dashboard-drilldown-url-error-message"]');
    this.newTabToggle = page.locator('[data-test="dashboard-drilldown-open-in-new-tab"]');
    this.folderSelect = page.locator('[data-test="dashboard-drilldown-folder-select"]');
    this.dashboardSelect = page.locator('[data-test="dashboard-drilldown-dashboard-select"]');
    this.tabSelect = page.locator('[data-test="dashboard-drilldown-tab-select"]');
    this.confirmButton = page.locator(
      '[data-test="dashboard-drilldown-popup"] [data-test="o-dialog-primary-btn"]'
    );

    // Dashboard view — drilldown trigger overlay
    this.drilldownMenu = page.locator('[data-test="drilldown-menu"]');
    this.drilldownMenuFirstItem = page.locator('[data-test="drilldown-menu-item"]').first();
  }

  generateUniqueDrilldownName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  // Backward-compatible alias for dashboard.spec.js (old signature: folderName, drilldownName, dashboardName, tabName)
  async addDrilldownDashboard(folderName, drilldownName, dashboardName, tabName) {
    return this.addDrilldownByDashboard(drilldownName, folderName, dashboardName, tabName);
  }

  /**
   * Scroll the drilldown Add button into view inside the config sidebar,
   * then open the popup and fill the drilldown name.
   */
  async openPopup(name) {
    await this.addButton.scrollIntoViewIfNeeded();
    await this.addButton.click();
    await this.popup.waitFor({ state: 'visible', timeout: 10000 });
    await this.nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.nameInput.fill(name);
  }

  /**
   * Add a Logs drilldown and save it.
   * @param {string} name
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByLogs(name, { openInNewTab = false } = {}) {
    await this.openPopup(name);
    await this.logsButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.logsButton.click();
    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }
    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Open popup and switch to URL type without saving.
   * Use this when you need to assert URL validation state before saving.
   */
  async openURLPopup(name) {
    await this.openPopup(name);
    await this.urlButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.urlButton.click();
    await this.urlTextarea.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Add a URL drilldown and save it.
   * @param {string} name
   * @param {string} url
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByURL(name, url, { openInNewTab = false } = {}) {
    await this.openURLPopup(name);
    await this.urlTextarea.fill(url);
    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }
    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Add a byDashboard drilldown.
   * @param {string} name
   * @param {string} folderName - Folder name (e.g. "default")
   * @param {string} dashboardTitle - Destination dashboard title
   * @param {string|null} [tabName=null] - Tab to select by exact name; null selects first available
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByDashboard(name, folderName, dashboardTitle, tabName = null, { openInNewTab = false } = {}) {
    await this.openPopup(name);
    // byDashboard is the default drilldown type
    await this.folderSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.folderSelect.click();
    await this.page.getByRole('option', { name: folderName, exact: true }).click();

    await this.dashboardSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardSelect.click();
    await this.page.getByRole('option', { name: dashboardTitle, exact: true }).click();

    await this.tabSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.tabSelect.click();
    if (tabName) {
      await this.page.getByRole('option', { name: tabName, exact: true }).click();
    } else {
      await this.page.getByRole('option').first().click();
    }

    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }

    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Click the first data row of a table panel (dashboard view) to open
   * the drilldown popup overlay. Returns the drilldown menu locator.
   * Table panels use DOM row-click events which are reliable in CI.
   */
  async triggerDrilldownFromTable() {
    // Ensure we're on the dashboard view page (savePanel may still be navigating)
    await this.page.waitForURL(url => !url.toString().includes('/add_panel'), { timeout: 15000 });

    // Scroll the table panel into the viewport so virtual-scroll renders rows
    const tablePanel = this.page.locator('[data-test="dashboard-panel-table"]').first();
    await tablePanel.waitFor({ state: 'attached', timeout: 20000 });
    await tablePanel.scrollIntoViewIfNeeded();

    // TanStack table (dashboard mode) renders rows directly in tbody with data-test="dashboard-data-row".
    // Click the first data row to trigger the @click:dataRow event (emitted as row-click).
    const tableRow = tablePanel.locator('[data-test="dashboard-data-row"]').first();
    await tableRow.waitFor({ state: 'visible', timeout: 30000 });
    await tableRow.click();
    await this.page.waitForTimeout(500);
    return this.drilldownMenu;
  }

  /**
   * Returns locator for the drilldown item at the given index in the config list.
   */
  drilldownItemAt(index) {
    return this.page.locator(`[data-test="dashboard-addpanel-config-drilldown-name-${index}"]`);
  }

  /**
   * Returns locator for the remove button at the given index in the config list.
   */
  removeButtonAt(index) {
    return this.page.locator(`[data-test="dashboard-addpanel-config-drilldown-remove-${index}"]`);
  }
}
