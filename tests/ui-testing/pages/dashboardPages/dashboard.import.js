export default class DashboardImport {
  constructor(page) {
    this.page = page;

    this.importButton = page.locator('[data-test="dashboard-import"]');
    this.importButtonByRole = page.getByRole("button", { name: "Import" });
    this.inputFile = page.locator('input[type="file"]');
  }
  //Import dashboard button on dashboard page
  async clickImportDashboard() {
    await this.importButton.click();
  }

  //click import button
  async clickImportButton() {
    await this.importButtonByRole.click();
  }

  async inputFiles1(fileContentPath) {
    await this.inputFile.setInputFiles(fileContentPath);
  }

  // Delet the Only imported dashboard
  async deleteImportedDashboard(prefix, dashboardName) {
    const fullRowName = `${prefix} ${dashboardName}`;
    await this.page
      .getByRole("row", { name: fullRowName })
      .locator('[data-test="dashboard-delete"]')
      .click();

    await this.page.locator('[data-test="confirm-button"]').click();
  }
}
