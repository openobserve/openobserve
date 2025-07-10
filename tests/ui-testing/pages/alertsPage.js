import { expect } from '@playwright/test';

import{ dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator } from '../pages/CommonLocator.js';
import DashboardFolder from "./dashboardPages/dashboard-folder.js";

export  class AlertsPage {
    constructor(page) {
      this.page = page;
      this.alertMenu = this.page.locator('[data-test="menu-link-\\/alerts-item"]');
      this.addAlertButton = this.page.locator('[data-test="alert-list-add-alert-btn"]');
      this.sqlOption = this.page.getByText('SQL');
      this.addTimeRangeButton = this.page.locator('[data-test="multi-time-range-alerts-add-btn"]');

    
      this.dateTimeButton = dateTimeButtonLocator;
      this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
      this.absoluteTab = absoluteTabLocator;

    

    this.profileButton = page.locator('button').filter({ hasText: (process.env["ZO_ROOT_USER_EMAIL"]) });
    this.signOutButton = page.getByText('Sign Out');
    this.dashboardFolders = new DashboardFolder(page);
  }

  async navigateToAlerts() {
    await this.alertMenu.click();
    await expect(this.page.locator('[data-test="alerts-list-title"]')).toContainText('Alerts');
  }

  async alertsPageDefaultMultiOrg() {
    await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();    
    await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
}

async alertsPageURLValidation() {
 await expect(this.page).toHaveURL(/defaulttestmulti/);
}

async alertsURLValidation() {
  await expect(this.page).toHaveURL(/alerts/);
}

  async createAlerts() {
    await this.addAlertButton.click();
    await this.sqlOption.click();
    await this.addTimeRangeButton.click();
    
  }

  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.page.locator(this.dateTimeButton).click();
    await this.relative30SecondsButton.click();
  }

  async verifyTimeSetTo30Seconds() {
    // Verify that the time filter displays "Past 30 Seconds"
   // await expect(this.page.locator(this.dateTimeButton)).toContainText(process.env["Past30SecondsValue"]);
    await expect(this.page.locator(this.dateTimeButton)).toContainText('schedule30 Seconds agoarrow_drop_down');
  }
 
 
  async signOut() {
    await this.profileButton.click();
    await this.signOutButton.click();
  }
  
  async createAlertTemplate(templateName) {
    await this.page.locator('[data-test="alert-templates-tab"]').waitFor();
    await this.page.locator('[data-test="alert-templates-tab"]').click();
    
    await this.page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/templates") && response.status() === 200
    );
    
    await this.page.locator('[data-test="alert-template-list-add-alert-btn"]').click();
    await this.page.locator('[data-test="add-template-name-input"]').waitFor();
    await this.page.locator('[data-test="add-template-name-input"]').fill(templateName);
    
    const jsonString = '{"text": "{alert_name} is active"}';
    await this.page.locator(".cm-line").click();
    await this.page.keyboard.type(jsonString);
    await this.page.waitForTimeout(500);
    
    await this.page.locator('[data-test="add-template-submit-btn"]').click();
    await expect(this.page.locator(".q-notification__message").getByText(/Template Saved Successfully/)).toBeVisible();
  }

  async createAlertDestination(destinationName, templateName) {
    await this.page.locator('[data-test="alert-destinations-tab"]').click();
    await this.page.waitForTimeout(2000);
    
    await this.page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
    await this.page.locator('[data-test="add-destination-name-input"]').waitFor();
    await this.page.locator('[data-test="add-destination-name-input"]').fill(destinationName);
    await this.page.waitForTimeout(500);
    
    await this.page.locator('[data-test="add-destination-template-select"]').click();
    await this.page.getByText(templateName).click();
    
    await this.page.locator('[data-test="add-destination-url-input"]').fill("sanity");
    await this.page.waitForTimeout(500);
    
    await this.page.locator('[data-test="add-destination-submit-btn"]').click();
    
    await this.page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/destinations") && response.status() === 200
    );
  }

  async createAlert(alertName, destinationName) {
    await this.page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await this.page.locator('[data-test="alert-list-add-alert-btn"]').click();
    await this.page.getByLabel("Name *").first().fill(alertName);
    await this.page.waitForTimeout(500);
    
    await this.page.locator('[data-test="add-alert-stream-type-select"]').click();
    await this.page.getByRole("option", { name: "logs" }).click();
    await this.page.getByLabel("Stream Name *").click();
    await this.page.getByLabel("Stream Name *").fill("e2e");
    await this.page.getByText("e2e_automate").click();
    await this.page.locator('[data-test="alert-conditions-delete-condition-btn"]').click();
    
    await this.page.locator('[data-test="add-alert-destination-select"]').click();
    await this.page.waitForTimeout(2000);
    await this.page.locator(`[data-test="add-alert-destination-${destinationName}-select-item"]`).click();
    await this.page.waitForTimeout(500);
    await this.page.locator('[data-test="chart-renderer"] div').first().click();
    await this.page.waitForTimeout(1000);
    
    await this.page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await this.page.locator('[data-test="add-alert-submit-btn"]').click({force:true});
    await this.page.waitForTimeout(1000);
  }

  async cloneAlert(alertName) {
    const clonedAlertName = `clone-${alertName}`;
    await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
    await this.page.locator('[data-test="to-be-clone-alert-name"]').fill(clonedAlertName);
    await this.page.waitForTimeout(500);
    
    await this.page.locator('[data-test="to-be-clone-stream-type"]').click();
    await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await this.page.locator('[data-test="to-be-clone-stream-name"]').click();
    await this.page.locator('[data-test="to-be-clone-stream-name"]').fill('e2e_automate');
    await this.page.waitForTimeout(2000);
    await this.page.getByRole('option', { name: 'e2e_automate' }).click({force:true});
    await this.page.waitForTimeout(2000);
    await this.page.locator('[data-test="clone-alert-submit-btn"]').click();
    await this.page.getByText('Alert Cloned Successfully').click();
    
    return clonedAlertName;
  }

  async deleteAlert(alertName) {
    await this.page.locator('[data-test="alert-list-search-input"]').fill(alertName);
    await this.page.waitForTimeout(500);
    await this.page.locator(`[data-test="alert-list-${alertName}-more-options"]`).click();
    await this.page.getByText('Delete',{exact:true}).click();
    await this.page.locator('[data-test="confirm-button"]').click();
  }

  async deleteDestination(destinationName) {
    await this.page.locator('[data-test="menu-link-settings-item"]').click();
    await this.page.locator('[data-test="alert-destinations-tab"]').click();
    await this.page.locator('[data-test="destination-list-search-input"]').fill(destinationName);
    await this.page.waitForTimeout(500);
    await this.page.locator(`[data-test="alert-destination-list-${destinationName}-delete-destination"]`).click();
    await this.page.locator('[data-test="confirm-button"]').click();
  }

  async deleteTemplate(templateName) {
    await this.page.locator('[data-test="alert-templates-tab"]').click();
    await this.page.locator('[data-test="template-list-search-input"]').fill(templateName);
    await this.page.waitForTimeout(500);
    await this.page.locator(`[data-test="alert-template-list-${templateName}-delete-template"]`).click();
    await this.page.locator('[data-test="confirm-button"]').click();
  }

  async createFolder(folderName) {
    await this.page.locator('[data-test="dashboard-new-folder-btn"]').click();
    await this.page.locator('[data-test="dashboard-folder-add-name"]').click();
    await this.page.locator('[data-test="dashboard-folder-add-name"]').fill(folderName);
    await this.page.locator('[data-test="dashboard-folder-add-save"]').click();
    await this.page.waitForTimeout(2000);
    return folderName;
  }

  async moveMultipleAlertsToFolder(alertNames, folderName) {
    await this.page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
    
    await this.page.locator('[data-test="alert-list-move-across-folders-btn"]').click();
    await this.page.locator('[data-test="alerts-index-dropdown-stream_type"]').click();
    await this.page.getByRole('option', { name: folderName }).click();
    await this.page.locator('[data-test="alerts-folder-move"]').click();
    await this.page.getByText('alerts Moved successfully').click();
  }

  async navigateToFolder(folderName) {
    await this.page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await this.page.getByText(folderName, { exact: true }).click();
    await this.page.waitForTimeout(2000);
  }
}