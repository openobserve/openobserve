import { expect } from '@playwright/test';

import { dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator } from '../pages/CommonLocator.js';
import DashboardFolder from "./dashboardPages/dashboard-folder.js";
import { CommonActions } from './commonActions';

export class AlertsPage {
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

    this.alertImportButton = '[data-test="alert-import"]';
    this.alertImportCancelButton = '[data-test="alert-import-cancel-btn"]';
    this.alertImportJsonButton = '[data-test="alert-import-json-btn"]';

    this.alertImportUrlInput = '[data-test="alert-import-url-input"]';  
    this.alertImportUrlTab = '[data-test="tab-import_json_url"]';

    this.alertImportError00Input = '[data-test="alert-import-error-0-0"] [data-test="alert-import-name-input"]';
    this.alertImportError01Input = '[data-test="alert-import-error-0-1"] [data-test="alert-import-org-id-input"]';
    this.alertImportError02Input = '[data-test="alert-import-error-0-2"] [data-test="alert-import-stream-name-input"]';
    this.alertImportError03Input = '[data-test="alert-import-error-0-3"] [data-test="alert-import-destination-name-input"]';

    this.alertImportError10Input = '[data-test="alert-import-error-1-0"] [data-test="alert-import-name-input"]';
    this.alertImportError11Input = '[data-test="alert-import-error-1-1"] [data-test="alert-import-org-id-input"]';
    this.alertImportError12Input = '[data-test="alert-import-error-1-2"] [data-test="alert-import-stream-name-input"]';
    this.alertImportError13Input = '[data-test="alert-import-error-1-3"] [data-test="alert-import-destination-name-input"]';
    this.alertImportFileInput = '[data-test="alert-import-json-file-input"]';
    
    this.commonActions = new CommonActions(page);
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
    // TODO: Make sure the url contains the id of the selected org
    // await expect(this.page).not.toHaveURL(/default/);
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
    await this.page.locator(".view-line").click();
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
    
    // Use the common scroll function for destination selection
    await this.commonActions.scrollAndFindOption(destinationName, 'template');
    
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

  async importAlertButton() {
    await this.page.waitForSelector(this.alertImportButton);
    await this.page.locator(this.alertImportButton).click();
}

async ClickAlertImportJsonButton() {
    await this.page.waitForSelector(this.alertImportJsonButton);
    await this.page.locator(this.alertImportJsonButton).click();
}

async ClickAlertImportCancelButton() {
    await this.page.waitForSelector(this.alertImportCancelButton);
    await this.page.locator(this.alertImportCancelButton).click();
}

async importAlertFromUrl(url) {
  await this.page.waitForSelector(this.alertImportUrlTab);
  await this.page.locator(this.alertImportUrlTab).click();
  await this.page.waitForSelector(this.alertImportUrlInput);
  await this.page.locator(this.alertImportUrlInput).click();
  await this.page.locator(this.alertImportUrlInput).fill(url);    
}

async ClickAlertImportError00NameInput(alertName) {
  await this.page.waitForSelector(this.alertImportError00Input);
  await this.page.locator(this.alertImportError00Input).click();
  await this.page.locator(this.alertImportError00Input).fill(alertName);
}

async ClickAlertImportError01Input(orgName) {
  await this.page.waitForSelector(this.alertImportError01Input);
  await this.page.locator(this.alertImportError01Input).click();
  await this.page.getByRole('option', { name: orgName }).locator('div').nth(2).click();
}

  async ClickAlertImportError02Input(streamName) {
  await this.page.waitForTimeout(2000);
  console.log(streamName);
  await this.page.waitForSelector(this.alertImportError02Input);
  await this.page.locator(this.alertImportError02Input).click();
  await this.page.getByRole('option', { name: streamName }).locator('div').nth(2).click();
  await this.page.waitForTimeout(2000);
}

async ClickAlertImportError03Input(destinationName) {
  await this.page.waitForSelector(this.alertImportError03Input);
  await this.page.locator(this.alertImportError03Input).click();
  await this.page.locator(`[data-test="add-alert-destination-${destinationName}-select-item"] [data-test="alert-import-destination-label"]`).click();
}


async ClickAlertImportError10Input(alertName) {
  await this.page.waitForSelector(this.alertImportError10Input);
  await this.page.locator(this.alertImportError10Input).click();
  await this.page.locator(this.alertImportError10Input).fill(alertName);
} 

async ClickAlertImportError11Input(orgName) {
  await this.page.waitForSelector(this.alertImportError11Input);
  await this.page.locator(this.alertImportError11Input).click();
  await this.page.getByRole('option', { name: orgName }).locator('div').nth(2).click();
}

async ClickAlertImportError12Input(streamName) {
  await this.page.waitForTimeout(2000);
  console.log(streamName);
  await this.page.waitForSelector(this.alertImportError12Input);
  await this.page.locator(this.alertImportError12Input).click();
  await this.page.getByRole('option', { name: streamName }).locator('div').nth(2).click();
  await this.page.waitForTimeout(2000);
} 

async ClickAlertImportError13Input(destinationName) {
  await this.page.waitForSelector(this.alertImportError13Input);
  await this.page.locator(this.alertImportError13Input).click();
  await this.page.locator(`[data-test="add-alert-destination-${destinationName}-select-item"] [data-test="alert-import-destination-label"]`).click();
}

async uploadAlertFile(filePath) {
  await this.page.waitForSelector(this.alertImportFileInput);
  await this.page.locator(this.alertImportFileInput).click();
  await this.page.locator(this.alertImportFileInput).setInputFiles(filePath);
  await this.page.waitForTimeout(5000);
}


  
}