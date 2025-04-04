const { expect } = require("@playwright/test");
import { randomDashboardName } from "../../playwright-tests/dashboards/dashboard-aggregation.spec.js.spec.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../../playwright-tests/utils/dashCreation.js";

export class Dashboard{
  constructor(page) {
    this.page = page;

     // Dashboard Locators
     this.dashboardMenuLink = page.locator('[data-test="menu-link-\\/dashboards-item"]');
     this.addDashboardButton = page.locator('[data-test="dashboard-add"]');
     this.dashboardNameField = page.locator('[data-test="add-dashboard-name"]');
     this.submitDashboardButton = page.locator('[data-test="dashboard-add-submit"]');
     this.addPanelButton = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');


     // Panel Configuration Locators
     this.streamDropdown = page.locator("label").filter({ hasText: "Streamarrow_drop_down" }).locator("i");
     this.streamOption = page.getByRole("option", { name: "e2e_automate" });


    // Date-Time Filters
     this.waitforEnable = page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
        timeout: 15000});
        this.dateTimeButton = page.locator('[data-test="date-time-btn"]');
        this.relativeTimeButton = page.locator('[data-test="date-time-relative-6-w-btn"]');

        this.applyTimeButton = page.locator('[data-test="date-time-apply-btn"]');
        this.dashboardApplyButton = page.locator('[data-test="dashboard-apply"]');

    // Apply button
    this.dashboardApplyButton = page.locator('[data-test="dashboard-apply"]'); 


    // Panel Save
    this.panelNameField = page.locator('[data-test="dashboard-panel-name"]');
    this.panelSaveButton = page.locator('[data-test="dashboard-panel-save"]');


    // Dashboard Navigation
    this.backButton = page.locator('[data-test="dashboard-back-btn"]');
    this.dashbaorBackbutton = page.locator('[data-test="dashboard-back-btn"]');
  }

  async createDashboard() {
    await this.dashboardMenuLink.click();
    await waitForDashboardPage(this.page);
    await this.addDashboardButton.click();
    await this.dashboardNameField.click();
    await this.dashboardNameField.fill(randomDashboardName);
    await this.submitDashboardButton.click();
    await this.addPanelButton.click();
  }
async streamSelect(page){
  await this.streamDropdown.click();
  await this.streamOption.click();
}
async setDateFilter() {
    await this.waitforEnable;
    await this.dateTimeButton.click();
    await this.relativeTimeButton.click();
    await this.applyTimeButton.click();
    // await this.dashboardApplyButton.click();
}

async clickApplyButton() {
    await this.dashboardApplyButton.waitFor({ timeout: 15000 });
    await this.dashboardApplyButton.click();
}

  async savePanel(Dashboard_panel) {
        await this.panelNameField.click();
        await this.panelNameField.fill("Dashboard_panel");
        await this.panelSaveButton.click();
    }

    async deleteDashboard(){
      await this.dashbaorBackbutton.click();
      await deleteDashboard(this.page, randomDashboardName);
  }
}