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
    await this.page.locator('[data-test="tab-import_json_file"]').waitFor({ state: "visible", timeout: 10000 });
    await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
  }

  //click import button
  async clickImportButton() {
    await this.importButtonByRole.waitFor({ state: "visible" });
    await this.importButtonByRole.click();
  }

  // Import dashboard file
  async uploadDashboardFile(fileContentPath) {
    const fileTab = this.page.locator('[data-test="tab-import_json_file"]');
    try {
      await fileTab.waitFor({ state: "visible", timeout: 10000 });
      await fileTab.click({ timeout: 10000 });
      await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
    } catch (error) {
      // Tab might already be active, continue
    }

    await this.inputFile.waitFor({ state: "visible", timeout: 20000 });

    // Retry file upload
    let retries = 3;
    while (retries > 0) {
      try {
        await this.inputFile.setInputFiles(fileContentPath, { timeout: 10000 });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await this.inputFile.waitFor({ state: "attached", timeout: 5000 });
      }
    }

    // Wait for JSON editor
    await this.page.locator('[data-test="dashboard-import-json-file-editor"]')
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => this.page.locator('.monaco-editor').waitFor({ state: "visible", timeout: 10000 }));

    await this.page.locator('.view-lines .view-line').first().waitFor({ state: "visible", timeout: 10000 });
  }

  // Click URL import tab with retry logic
  async clickUrlImportTab() {
    const urlTab = this.page.locator('[data-test="tab-import_json_url"]');
    const urlInput = this.page.getByLabel("Add your url");
    await urlTab.waitFor({ state: "visible", timeout: 30000 });

    let retries = 5;
    while (retries > 0) {
      try {
        await urlTab.click({ timeout: 10000 });
        await urlInput.waitFor({ state: "visible", timeout: 10000 });
        await urlInput.waitFor({ state: "attached", timeout: 5000 });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await urlTab.waitFor({ state: "visible", timeout: 5000 });
      }
    }
  }

  // Delete the Only imported dashboard
  async deleteImportedDashboard(prefix, dashboardName) {
    await this.page.locator('[data-test="dashboard-table"]').waitFor({ state: "visible", timeout: 20000 });
    await this.page.locator('[data-test="dashboard-table"] tbody tr').first().waitFor({ state: "visible", timeout: 15000 });

    const dashboardRow = this.page.locator(`//tr[.//td[text()="${prefix}"] and .//div[@title="${dashboardName}"]]`);

    // Wait for row with retry
    let rowRetries = 5;
    while (rowRetries > 0) {
      try {
        await dashboardRow.waitFor({ state: "visible", timeout: 4000 });
        break;
      } catch (error) {
        rowRetries--;
        if (rowRetries === 0) {
          // Fallback: use cell-based selector
          const alternateRow = this.page.getByRole("cell", { name: dashboardName });
          await alternateRow.first().waitFor({ state: "visible", timeout: 5000 });
          await alternateRow.first().click();
          await this.page.locator('[data-test="dashboard-delete"]').first().waitFor({ state: "visible", timeout: 5000 });
          await this.page.locator('[data-test="dashboard-delete"]').first().click();
          await this.page.locator('[data-test="confirm-button"]').click();
          return;
        }
        await this.page.waitForLoadState('domcontentloaded');
      }
    }

    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');

    // Hover and delete with retry
    let deleteRetries = 3;
    while (deleteRetries > 0) {
      try {
        await dashboardRow.hover();
        await deleteButton.waitFor({ state: "visible", timeout: 10000 });
        await deleteButton.click({ timeout: 10000 });
        await this.page.locator('[data-test="confirm-button"]').waitFor({ state: "visible", timeout: 5000 });
        break;
      } catch (error) {
        deleteRetries--;
        if (deleteRetries === 0) throw error;
        await dashboardRow.waitFor({ state: "visible", timeout: 5000 });
      }
    }

    await this.page.locator('[data-test="confirm-button"]').click({ timeout: 10000 });

    // Verify deletion
    try {
      await dashboardRow.waitFor({ state: "detached", timeout: 10000 });
    } catch {
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        try {
          await dashboardRow.waitFor({ state: "hidden", timeout: 5000 });
        } catch {
          console.warn(`Could not verify deletion of dashboard: ${dashboardName}`);
        }
      }
    }
  }
}
