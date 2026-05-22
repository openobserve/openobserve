//Dashboard Share and Export Page Object
//Methods: Share dashboard, Export dashboard

const { expect } = require("@playwright/test");

export default class DashboardShareExportPage {
  constructor(page) {
    this.page = page;
    this.shareBtn = page.locator('[data-test="dashboard-share-btn"]');
    this.exportBtn = page.locator('[data-test="dashboard-download-btn"]');
    this.backBtn = page.locator('[data-test="dashboard-back-btn"]');
    this.addPanelEmptyBtn = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.dashboardNameTitle = page.locator('[data-test="dashboard-name-title"]');
    this.toastSuccess = page.locator('[data-test="o-toast-success"]');
    this.toastMessage = page.locator('[data-test="o-toast-message"]');
    this.dateTimeBtn = page.locator('[data-test="date-time-btn"]');
    this.absoluteTab = page.locator('[data-test="date-time-absolute-tab"]');
    this.settingBtn = page.locator('[data-test="dashboard-setting-btn"]');
    this.settingsTabTab = page.locator('[data-test="dashboard-settings-tab-tab"]');
    this.tabListContainer = page.locator(
      '[data-test="dashboard-tab-list-container"]'
    );
  }

  //share dashboard
  async shareDashboard() {
    await this.backBtn.waitFor({
      state: "visible",
    });
    await this.shareBtn.click();
  }

  //Wait for share success toast (Link copied successfully)
  async waitForShareSuccess(timeout = 10000) {
    await expect(this.toastSuccess).toBeVisible({ timeout });
  }

  //Returns the share success toast locator for assertion in specs
  getShareSuccessToast() {
    return this.toastSuccess;
  }

  //Read the short URL copied to clipboard after share
  //Polls clipboard until it contains "/short/" (share button is async)
  async getCopiedUrl(page, timeout = 15000) {
    const target = page || this.page;
    const start = Date.now();
    let lastValue = "";
    while (Date.now() - start < timeout) {
      lastValue = await target.evaluate(() => navigator.clipboard.readText());
      if (lastValue && lastValue.includes("/short/")) {
        return lastValue;
      }
      await target.waitForTimeout(250);
    }
    return lastValue;
  }

  //Wait for the dashboard view page to be fully loaded
  async waitForDashboardViewLoaded(page, timeout = 15000) {
    const target = page || this.page;
    await target
      .locator('[data-test="dashboard-back-btn"]')
      .waitFor({ state: "visible", timeout });
  }

  //Wait for dashboard add panel button to be visible (empty dashboard view)
  async waitForEmptyDashboardView(timeout = 15000) {
    await this.addPanelEmptyBtn.waitFor({ state: "visible", timeout });
  }

  //Verify the dashboard title is visible with the given name
  async verifyDashboardNameVisible(name, page, timeout = 10000) {
    const target = page || this.page;
    const title = target.locator('[data-test="dashboard-name-title"]');
    await expect(title).toBeVisible({ timeout });
    await expect(title).toHaveText(name, { timeout });
  }

  //Click share button directly (idempotent variant used inside tests after settings)
  async clickShareButton() {
    await this.shareBtn.waitFor({ state: "visible" });
    await this.shareBtn.click();
  }

  //Open the date-time picker and switch to the Absolute tab
  async openAbsoluteDateTime() {
    await this.dateTimeBtn.click();
    await this.absoluteTab.click();
  }

  //Open settings drawer and switch to the Tab section
  async openSettingsTabSection() {
    await this.settingBtn.click();
    await this.settingsTabTab.waitFor({ state: "visible" });
    await this.settingsTabTab.click();
  }

  //Click a dashboard tab by its name (uses data-test-tab-name attribute)
  async clickTabByName(tabName, timeout = 15000) {
    const tab = this.page.locator(
      `[data-test-tab-name="${tabName}"]`
    );
    await tab.waitFor({ state: "visible", timeout });
    await tab.click();
  }

  //Navigate to a URL using a separate playwright page (new tab context)
  async openInNewPage(url) {
    const context = this.page.context();
    const newPage = await context.newPage();
    await newPage.goto(url);
    return newPage;
  }

  //Export dashboard
  async exportDashboard() {
    await this.backBtn.waitFor({
      state: "visible",
    });
    await this.exportBtn.click();
  }
}
