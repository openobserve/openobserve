// methods: createDashboard, searchDashboard, AddPanel, applyButton

export default class DashboardCreate {
  /**
   * Constructor for the DashboardCreate object
   * @param {Page} page - The page object to interact with
   */
  constructor(page) {
    this.page = page;
    this.dashCreateBtn = this.page.locator('[data-test="dashboard-add"]');
    this.dashName = this.page.locator('[data-test="add-dashboard-name"]');
    this.submitBtn = this.page.locator('[data-test="dashboard-add-submit"]');
    this.deleteIcon = this.page.locator('[data-test="dashboard-delete"]');
    this.confirmDelete = this.page.locator('[data-test="confirm-button"]');
    this.searchDash = this.page.locator('[data-test="dashboard-search"]');
    this.addPanelIfEmptyBtn = this.page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.applyQueryBtn = this.page.locator('[data-test="dashboard-apply"]');
    this.backBtn = this.page.locator('[data-test="dashboard-back-btn"]');
  }

  // Wait for dashboard UI to be fully stable before any interaction
  async waitForDashboardUIStable() {
    // Wait for search input to be stable
    await this.searchDash.waitFor({ state: "visible", timeout: 30000 });
    await this.searchDash.waitFor({ state: "attached", timeout: 5000 });

    // Wait for "New Dashboard" button to be stable
    await this.dashCreateBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.dashCreateBtn.waitFor({ state: "attached", timeout: 5000 });

    // Wait for the import button to also be stable (confirms full header is loaded)
    const importBtn = this.page.locator('[data-test="dashboard-import"]');
    await importBtn.waitFor({ state: "visible", timeout: 10000 });
    await importBtn.waitFor({ state: "attached", timeout: 5000 });

    // Small wait for any animations to complete
    await this.page.waitForTimeout(500);
  }

  //Create Dashboard
  async createDashboard(dashboardName) {
    // Wait for the dashboard page to be fully loaded by checking for the search input
    await this.searchDash.waitFor({ state: "visible", timeout: 30000 });

    // Wait for the "New Dashboard" button to be ready and enabled
    await this.dashCreateBtn.waitFor({ state: "visible", timeout: 30000 });

    // Wait for network idle to ensure page is fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // Ignore timeout - continue anyway
    });

    // Click the "New Dashboard" button
    await this.dashCreateBtn.click();

    // Wait for the dialog to appear by checking for the input field to be attached
    await this.dashName.waitFor({ state: "attached", timeout: 30000 });

    // Wait for the input to be visible and editable
    await this.dashName.waitFor({ state: "visible", timeout: 30000 });

    // Wait for the input to be enabled (not disabled)
    await this.page.waitForFunction(
      (selector) => {
        const element = document.querySelector(selector);
        return element && !element.disabled && element.offsetParent !== null;
      },
      '[data-test="add-dashboard-name"]',
      { timeout: 10000 }
    );

    // Fill the dashboard name
    await this.dashName.fill(dashboardName);

    // Wait for and click the submit button
    await this.submitBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.submitBtn.click();

    // Wait for the success notification to confirm dashboard was created
    await this.page.getByText('Dashboard added successfully.').waitFor({ state: 'visible', timeout: 15000 });

    // Wait for navigation to the new dashboard view page
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      // Ignore timeout - continue anyway
    });

    // Additional wait for Vue components to mount
    await this.page.waitForTimeout(2000);
  }

  //back to dashboard list
  async backToDashboardList() {
    await this.backBtn.waitFor({ state: "visible", timeout: 50000 });
    await this.backBtn.click();
  }

  //Search the Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.click();
    await this.searchDash.fill(dashboardName);
  }

  //Delete Dashboard
  async deleteDashboard() {
    await this.page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    const dashboardRow = this.page.locator('[data-test="dashboard-table"]');
    await dashboardRow.waitFor({ state: "visible" });
    await dashboardRow.locator('[data-test="dashboard-delete"]').first().click();
    const confirmDialog = this.page.locator(
      '[data-test="dashboard-confirm-dialog"]'
    );
    await confirmDialog.waitFor({ state: "visible" });
    const confirmDeleteButton = confirmDialog.locator(
      '[data-test="confirm-button"]'
    );
    await confirmDeleteButton.waitFor({ state: "visible" });
    await confirmDeleteButton.click();
  }

  //Add Panel to dashboard (when dashboard is empty)
  async addPanel() {
    await this.addPanelIfEmptyBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.addPanelIfEmptyBtn.click();
  }

  //Add Panel to dashboard (when dashboard already has panels)
  async addPanelToExistingDashboard() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');
    await addPanelBtn.waitFor({ state: "visible", timeout: 15000 });
    await addPanelBtn.click();
  }

  //Add Panel - works for both empty and non-empty dashboards
  async addPanelSmart() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');
    const addPanelIfEmptyBtn = this.addPanelIfEmptyBtn;

    // Try the "add panel" button first (for dashboards with panels)
    const addBtnVisible = await addPanelBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (addBtnVisible) {
      await addPanelBtn.click();
      return;
    }

    // Fall back to "add panel if empty" button
    await addPanelIfEmptyBtn.waitFor({ state: "visible", timeout: 15000 });
    await addPanelIfEmptyBtn.click();
  }

  //Apply dashboard button
  async applyButton() {
    await this.applyQueryBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.applyQueryBtn.click();
  }
}
