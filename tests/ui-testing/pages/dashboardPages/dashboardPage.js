import { expect } from '@playwright/test';
import {
  dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator,
  Past30SecondsValue
} from '../commonActions.js';
export class DashboardPage {
  constructor(page) {
    this.page = page;
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 10000);
    this.dashboardName = `dash${timestamp}${randomSuffix}`;
    this.panelName = `p${timestamp}${randomSuffix}`;
    this.dashboardsMenuItem = page.locator('[data-test="menu-link-\\/dashboards-item"]');
    this.addDashboardButton = page.locator('[data-test="dashboard-add"]');
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardSubmitButton = page.locator('[data-test="dashboard-add-submit"]');
    this.savePanelButton = page.locator('[data-test="dashboard-panel-save"]');
    this.dashboardPanelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;
    this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
    this.signOutButton = page.getByText('Sign Out');
  }
  async navigateToDashboards() {
    await this.page.waitForSelector('[data-test="menu-link-\\/dashboards-item"]');
    await this.dashboardsMenuItem.click();
    await this.page.waitForTimeout(5000);
    await expect(this.page.getByRole('main')).toContainText('Dashboards');
  }
  async createDashboard() {
    await this.page.waitForSelector('[data-test="dashboard-add"]');
    await this.addDashboardButton.click();
    await this.page.waitForTimeout(5000);
    await this.dashboardNameInput.fill(this.dashboardName);
    await this.page.waitForSelector('[data-test="dashboard-add-submit"]');
    await this.dashboardSubmitButton.click();
    await this.page.waitForTimeout(2000);
    await this.page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .click();
    await this.page.waitForTimeout(3000);
    await this.page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    // Refine the locator for 'e2e_automate'
    await this.page
      .locator("span")
      .filter({ hasText: /^e2e_automate$/ })
      .click();
    await this.page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await this.page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await this.page.waitForSelector('[data-test="dashboard-panel-name"]');
    await this.page.locator('[data-test="dashboard-panel-name"]').click();
    await this.page.locator('[data-test="dashboard-panel-name"]').fill(this.panelName);
    await this.page.locator('[data-test="dashboard-panel-name"]').press('Enter');
    await expect(this.page.locator('[data-test="dashboard-apply"]')).toBeVisible();
    await this.page.locator('[data-test="dashboard-apply"]').click();
    await this.page.waitForTimeout(5000);
  }
  async deleteDashboard() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(5000);
    
    // Search for the dashboard before deleting
    await this.page.locator('[data-test="dashboard-search"]').fill(this.dashboardName);
    await this.page.waitForTimeout(2000);
    
    await this.page.locator('[data-test="dashboard-delete"]').click({ force: true });
    await this.page.waitForTimeout(2000);
    await this.page.locator('[data-test="confirm-button"]:visible').click();
    await expect(this.page.getByRole('alert')).toContainText('Dashboard deleted successfully.');
  }

  async deleteSearchedDashboard(dashboardName) {
    // First search for the dashboard
    await this.page.locator('[data-test="dashboard-search"]').click();
    await this.page.locator('[data-test="dashboard-search"]').fill(dashboardName);
    await this.page.waitForTimeout(1000);
    
    // Find the dashboard row and click the delete button
    const dashboardRow = this.page.getByRole("row", { name: new RegExp(`.*${dashboardName}`) });
    await dashboardRow.locator('[data-test="dashboard-delete"]').click();
    
    // Confirm deletion
    await this.page.locator('[data-test="confirm-button"]').click();
    await expect(this.page.getByRole('alert')).toContainText('Dashboard deleted successfully.');
  }

  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.page.locator(this.dateTimeButton).click();
    await this.relative30SecondsButton.click();
  }
  async verifyTimeSetTo30Seconds() {
    // Verify that the time filter displays "Past 30 Seconds"
    await expect(this.page.locator(this.dateTimeButton)).toContainText(Past30SecondsValue);
  }
  async verifyShareDashboardLink(randomDashboardName){
    await this.page.locator('[data-test="dashboard-share-btn"]').click();
    await expect(this.page.getByText('Link copied successfully')).toBeVisible();
    const copiedUrl = await this.page.evaluate(() => navigator.clipboard.readText());
    await this.page.goto(copiedUrl);
    await expect(this.page.getByText(randomDashboardName)).toBeVisible();
  }
  async setDateTime() {
    await expect(this.page.locator(this.dateTimeButton)).toBeVisible();
    await this.page.locator(this.dateTimeButton).click();
    await this.page.locator(this.absoluteTab).click();
    await this.page.waitForTimeout(2000);
  }
  async fillTimeRange(startTime, endTime) {
    await this.page.getByRole('button', { name: '1', exact: true }).click();
    await this.page.getByLabel('access_time').first().fill(startTime);
    await this.page.getByRole('button', { name: '1', exact: true }).click();
    await this.page.getByLabel('access_time').nth(1).fill(endTime);
  }
  async verifyDateTime(startTime, endTime) {
    await expect(this.page.locator(this.dateTimeButton)).toContainText(`${startTime} - ${endTime}`);
  }

  async dashboardPageDefaultMultiOrg() {
    await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
    await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
  }

  async dashboardPageURLValidation() {
    // TODO: Fix this test
    // await expect(this.page).not.toHaveURL(/default/);
  }

  async dashboardURLValidation() {
    await expect(this.page).toHaveURL(/dashboard/);
  }

  async signOut() {
    await this.profileButton.click();
    await this.signOutButton.click();
  }


  async loggedOut() {
    // Click on the profile icon
    await this.page.locator('[data-test="header-my-account-profile-icon"]').click({ force: true });

    // Wait for the logout menu item to be attached to the DOM with shorter timeout
    const logoutItem = this.page.locator('[data-test="menu-link-logout-item"]');
    
    // Wait for the logout item to be present in the DOM with reasonable timeout
    await logoutItem.waitFor({ state: 'attached', timeout: 10000 });

    // Wait for element to be visible instead of hard wait
    await logoutItem.waitFor({ state: 'visible', timeout: 5000 });

    // Now click the logout item
    await logoutItem.click({ force: true });
}

async notAvailableDashboard() {
  // Wait for the dashboard add button to be visible
  await this.page.waitForSelector('[data-test="dashboard-add"]');

  // Click on the search input
  await this.page.locator('[data-test="dashboard-search"]').click();

  // Fill the search input with the dashboard name
  await this.page.locator('[data-test="dashboard-search"]').fill(this.dashboardName);

  // Check that the dashboard table contains the text 'No data available'
  await expect(this.page.locator('[data-test="dashboard-table"]')).toContainText('No data available');

  // Click on the toggle for searching across folders
  await this.page.locator('[data-test="dashboard-search-across-folders-toggle"] div').nth(2).click();

  // Check again that the dashboard table contains the text 'No data available'
  await expect(this.page.locator('[data-test="dashboard-table"]')).toContainText('No data available');

  // Click on the toggle again
  await this.page.locator('[data-test="dashboard-search-across-folders-toggle"] div').nth(2).click();

  // Final check that the dashboard table still contains the text 'No data available'
  await expect(this.page.locator('[data-test="dashboard-table"]')).toContainText('No data available');
}

async addCustomChart(page, pictorialJSON) {
  await this.page.waitForSelector('[data-test="menu-link-\/dashboards-item"]');
  await this.page.locator('[data-test="menu-link-\/dashboards-item"]').click();

  await this.page.waitForSelector('[data-test="dashboard-add"]');
  await this.page.waitForTimeout(2000);
  await this.page.locator('[data-test="dashboard-add"]').click();
  await this.page.waitForTimeout(2000);
  await this.page.locator('[data-test="add-dashboard-name"]').fill("Customcharts");
  await this.page.locator('[data-test="dashboard-add-submit"]').click();

  await this.page.waitForSelector('[data-test="dashboard-if-no-panel-add-panel-btn"]');
  await this.page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
  await this.page.waitForSelector('[data-test="selected-chart-custom_chart-item"]');
  await this.page.locator('[data-test="selected-chart-custom_chart-item"]').click();
  
  await this.page.waitForSelector('[data-test="dashboard-markdown-editor-query-editor"] .monaco-editor');

  await this.page.locator('[data-test="dashboard-markdown-editor-query-editor"] .monaco-editor').click();

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await this.page.keyboard.press(`${modifier}+A`);
  
  await this.page.keyboard.press("Backspace");
  
  console.log("Pictorial JSON", pictorialJSON);
  
  // First clear any existing content
  await this.page.waitForSelector('[data-test="dashboard-markdown-editor-query-editor"]');
  await this.page.locator('[data-test="dashboard-markdown-editor-query-editor"]').click();
  await this.page.keyboard.press(`${modifier}+A`);
  await this.page.keyboard.press('Delete');
}


}


