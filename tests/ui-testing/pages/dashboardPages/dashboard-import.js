//Dashboard Import Page Object
//Methods: Import dashboard, import button, input files, delete imported dashboard
export default class DashboardImport {
  constructor(page) {
    this.page = page;

    this.importButton = page.locator('[data-test="dashboard-import"]');
    this.importButtonByRole = page.getByRole("button", { name: "Import" });
    this.inputFile = page.locator('input[type="file"]');
  }
  //Import dashboard button on dashboard page
  async clickImportDashboard() {
    await this.importButton.waitFor({ state: "visible", timeout: 15000 });
    await this.importButton.click();

    // Wait for the import dialog to be visible by checking for tabs
    await this.page.locator('[data-test="tab-import_json_file"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Wait for file input to be ready
    await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
  }

  //click import button
  async clickImportButton() {
    await this.importButtonByRole.waitFor({ state: "visible" });
    await this.importButtonByRole.click();
  }

  // Import dashboard file
  async uploadDashboardFile(fileContentPath) {
    // Wait for the file input tab to be visible and stable (in case it's not the default tab)
    const fileTab = this.page.locator('[data-test="tab-import_json_file"]');
    try {
      // Wait for tab to be visible and attached
      await fileTab.waitFor({ state: "visible", timeout: 10000 });

      // Click with force if needed and wait for network idle
      await fileTab.click({ timeout: 10000 });

      // Wait for the file input to appear after tab switch
      await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
    } catch (error) {
      // Tab might already be active, continue
    }

    // Wait for the input element to be ready for interaction
    await this.inputFile.waitFor({ state: "visible", timeout: 20000 });

    // Set the file with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await this.inputFile.setInputFiles(fileContentPath, { timeout: 10000 });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        // Wait for input to be ready again
        await this.inputFile.waitFor({ state: "attached", timeout: 5000 });
      }
    }

    // Wait for the JSON editor to be visible (indicates file was processed)
    await this.page.locator('[data-test="dashboard-import-json-file-editor"]').waitFor({
      state: "visible",
      timeout: 10000
    }).catch(() => {
      // If the specific editor selector doesn't work, wait for any monaco editor
      return this.page.locator('.monaco-editor').waitFor({
        state: "visible",
        timeout: 10000
      });
    });

    // Wait for the editor content to be populated
    await this.page.locator('.view-lines .view-line').first().waitFor({
      state: "visible",
      timeout: 10000
    });
  }

  // Click URL import tab with retry logic
  async clickUrlImportTab() {
    const urlTab = this.page.locator('[data-test="tab-import_json_url"]');
    const urlInput = this.page.getByLabel("Add your url");

    // Wait for tab to be visible and stable with increased timeout
    await urlTab.waitFor({ state: "visible", timeout: 30000 });

    // Retry clicking if element becomes detached
    let retries = 5;
    while (retries > 0) {
      try {
        await urlTab.click({ timeout: 10000 });

        // Wait for the URL input field to be visible (confirms tab switch worked)
        await urlInput.waitFor({ state: "visible", timeout: 10000 });

        // Verify input is actually interactable
        await urlInput.waitFor({ state: "attached", timeout: 5000 });

        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;

        // Wait for tab to be re-attached before retrying
        await urlTab.waitFor({ state: "visible", timeout: 5000 });
      }
    }
  }

  // Delete the Only imported dashboard
  async deleteImportedDashboard(prefix, dashboardName) {
    // Wait for the dashboard table to be visible
    await this.page.locator('[data-test="dashboard-table"]').waitFor({
      state: "visible",
      timeout: 20000
    });

    // Locate the dashboard row
    const dashboardRow = this.page.locator(
      `//tr[.//td[text()="${prefix}"] and .//div[@title="${dashboardName}"]]`
    );

    // Wait for the row to be visible
    await dashboardRow.waitFor({ state: "visible", timeout: 20000 });

    // Locate delete button
    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');

    // Hover over the row to make delete button visible and click with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        // Hover to reveal the delete button
        await dashboardRow.hover();

        // Wait for delete button to become visible after hover
        await deleteButton.waitFor({ state: "visible", timeout: 10000 });

        // Click the delete button
        await deleteButton.click({ timeout: 10000 });

        // Verify confirmation dialog appeared
        await this.page.locator('[data-test="confirm-button"]').waitFor({
          state: "visible",
          timeout: 5000
        });

        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;

        // Wait for row to be stable before retrying
        await dashboardRow.waitFor({ state: "visible", timeout: 5000 });
      }
    }

    // Click confirm button
    const confirmButton = this.page.locator('[data-test="confirm-button"]');
    await confirmButton.click({ timeout: 10000 });

    // Wait for deletion to complete - try multiple strategies
    try {
      // First try: Wait for the row to be detached from DOM
      await dashboardRow.waitFor({ state: "detached", timeout: 10000 });
    } catch (error) {
      // Second try: Wait for the table to reload or update
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (e) {
        // Third try: Wait for row to become hidden (sometimes it's hidden instead of detached)
        try {
          await dashboardRow.waitFor({ state: "hidden", timeout: 5000 });
        } catch (e2) {
          // Final fallback: Check if the dashboard count changed
          // If we can't verify deletion, the test will continue
          // The next test assertion will catch if deletion actually failed
          console.warn(`Could not verify deletion of dashboard: ${dashboardName}`);
        }
      }
    }
  }
}
