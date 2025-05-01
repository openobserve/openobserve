export default class DashboardShareExportPage {
  constructor(page) {
    this.page = page;
    this.shareBtn = page.locator('[data-test="dashboard-share-btn"]');
  }

  //share dashboard
  async shareDashboard() {
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await this.shareBtn.click();
  }

  //Export dashboard
  async exportDashboard() {
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await page.getByRole("button").filter({ hasText: "download" }).click();
  }
}
