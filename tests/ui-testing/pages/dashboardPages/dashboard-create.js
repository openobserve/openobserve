// methods: createDashboard, searchDashboard, AddPanel, applyButton

export default class DashboardCreate {
  /**
   * Constructor for the DashboardCreate object
   * @param {Page} page - The page object to interact with
   */
  constructor(page) {
    this.page = page;
    this.dashCreateBtn = this.page.locator('[data-test="dashboard-new"]');
    this.dashName = this.page.locator('[data-test="add-dashboard-name"] input');
    this.submitBtn = this.page.locator(
      '[data-test="dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.deleteIcon = this.page.locator('[data-test="dashboard-delete"]');
    this.confirmDelete = this.page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.searchDash = this.page.locator('[data-test="dashboard-search"]');
    this.addPanelIfEmptyBtn = this.page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.applyQueryBtn = this.page.locator('[data-test="dashboard-apply"]');
    this.backBtn = this.page.locator('[data-test="dashboard-back-btn"]');
    this.defaultFolderTab = this.page.locator(
      'button[data-test="dashboard-folder-tab-default"]'
    );
  }

  // Wait for the default folder tab on the dashboard list to be visible
  async waitForDefaultFolderTabVisible() {
    await this.defaultFolderTab.waitFor({ state: "visible" });
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
      '[data-test="add-dashboard-name"] input',
      { timeout: 10000 }
    );

    // Fill the dashboard name
    await this.dashName.fill(dashboardName);

    // Wait for and click the submit button
    await this.submitBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.submitBtn.click();

    // Wait for the success notification to confirm dashboard was created
    // OToast root carries both data-test="o-toast-success" and data-test-message="<text>"
    // so we can assert type + content in one selector (getByText is banned per selector policy)
    await this.page.locator('[data-test-variant="success"][data-test-message="Dashboard added successfully."]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      // Toast may have appeared and disappeared before waitFor evaluated — the
      // waitForURL check below is the real gate for whether creation succeeded.
    });

    // Wait for navigation to the new dashboard view page
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      // Ignore timeout - continue anyway
    });

    // Wait for Vue components to mount — use deterministic check on panel editor or back button
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({ state: 'visible', timeout: 15000 });
  }

  //back to dashboard list
  async backToDashboardList() {
    await this.backBtn.waitFor({ state: "visible", timeout: 50000 });
    await this.backBtn.click();
  }

  //wait for back button to be visible (no click)
  async waitForBackBtnVisible() {
    await this.backBtn.waitFor({ state: "visible" });
  }

  //Search the Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('button[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.locator('input').click();
    await this.searchDash.locator('input').fill(dashboardName);
  }

  //Delete Dashboard
  async deleteDashboard() {
    await this.page
      .locator('button[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    const dashboardRow = this.page.locator('[data-test="dashboard-table"]');
    await dashboardRow.waitFor({ state: "visible" });
    await dashboardRow.locator('[data-test="dashboard-delete"]').first().click();
    const confirmDialog = this.page.locator(
      '[data-test="dashboard-confirm-dialog"]'
    );
    await confirmDialog.waitFor({ state: "visible" });
    const confirmDeleteButton = confirmDialog.locator(
      '[data-test="o-dialog-primary-btn"]'
    );
    await confirmDeleteButton.waitFor({ state: "visible" });
    await confirmDeleteButton.click();
  }

  //Add Panel to dashboard (when dashboard is empty)
  async addPanel() {
    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.addPanelIfEmptyBtn.waitFor({ state: "visible", timeout: 15000 });
      await this.addPanelIfEmptyBtn.scrollIntoViewIfNeeded();

      // Click the button
      await this.addPanelIfEmptyBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanel: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Add Panel to dashboard (when dashboard already has panels)
  async addPanelToExistingDashboard() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');

    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await addPanelBtn.waitFor({ state: "visible", timeout: 15000 });
      await addPanelBtn.scrollIntoViewIfNeeded();

      // Click the button
      await addPanelBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanelToExistingDashboard: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Add Panel - works for both empty and non-empty dashboards
  async addPanelSmart() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');
    const addPanelIfEmptyBtn = this.addPanelIfEmptyBtn;

    // Determine which button to click
    const addBtnVisible = await addPanelBtn.isVisible({ timeout: 2000 }).catch(() => false);
    const targetBtn = addBtnVisible ? addPanelBtn : addPanelIfEmptyBtn;

    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await targetBtn.waitFor({ state: "visible", timeout: 15000 });
      await targetBtn.scrollIntoViewIfNeeded();

      // Click the button
      await targetBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanelSmart: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Apply dashboard button
  async applyButton() {
    await this.applyQueryBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.applyQueryBtn.click();
  }
}
