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

    // Navigation & Menu locators
    this.dashboardsMenuItem = page.locator('[data-test="menu-link-\\/dashboards-item"]');
    this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
    this.signOutButton = page.getByText('Sign Out');
    this.logoutMenuItem = page.locator('[data-test="menu-link-logout-item"]');

    // Dashboard list locators
    this.addDashboardButton = page.locator('[data-test="dashboard-add"]');
    this.dashboardSearch = page.locator('[data-test="dashboard-search"]');
    this.dashboardTable = page.locator('[data-test="dashboard-table"]');
    this.dashboardDelete = page.locator('[data-test="dashboard-delete"]');
    this.confirmButton = page.locator('[data-test="confirm-button"]');
    this.searchAcrossFoldersToggle = page.locator('[data-test="dashboard-search-across-folders-toggle"] div').nth(2);

    // Dashboard create dialog locators
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardSubmitButton = page.locator('[data-test="dashboard-add-submit"]');

    // Dashboard view/edit locators
    this.addPanelBtn = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');
    this.dashboardPanelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.savePanelButton = page.locator('[data-test="dashboard-panel-save"]');
    this.applyButton = page.locator('[data-test="dashboard-apply"]');
    this.shareButton = page.locator('[data-test="dashboard-share-btn"]');

    // Stream & field selection locators
    this.streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
    this.fieldSearchInput = page.locator('[data-test="index-field-search-input"]');

    // Date/Time locators
    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;

    // Organization locators
    this.orgDropdown = page.locator('[data-test="navbar-organizations-select"]');

    // Custom chart locators
    this.customChartItem = page.locator('[data-test="selected-chart-custom_chart-item"]');
    this.markdownEditor = page.locator('[data-test="dashboard-markdown-editor-query-editor"]');
  }
  async navigateToDashboards() {
    await this.page.waitForSelector('[data-test="menu-link-\\/dashboards-item"]');
    await this.dashboardsMenuItem.click();
    // Wait for navigation to complete by checking URL
    await this.page.waitForURL('**/dashboards**', { timeout: 10000 });
    // Wait for the dashboard page to load by checking for a key element
    await this.page.waitForSelector('[data-test="dashboard-add"]', { timeout: 10000 });
  }
  async createDashboard() {
    // Wait for the dashboard page to be fully loaded
    await this.page.waitForSelector('[data-test="dashboard-add"]');
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await this.addDashboardButton.click();

    // Wait for dialog with retry mechanism
    let isNameFieldVisible = await this.dashboardNameInput.isVisible().catch(() => false);

    if (!isNameFieldVisible) {
      // First retry: click the button again
      await this.page.waitForTimeout(1000);
      await this.addDashboardButton.click();
      await this.page.waitForTimeout(2000);
      isNameFieldVisible = await this.dashboardNameInput.isVisible().catch(() => false);

      if (!isNameFieldVisible) {
        throw new Error('Dashboard name field is not visible after clicking the add dashboard button twice');
      }
    }

    // Wait for the input to be fully ready
    await this.dashboardNameInput.waitFor({ state: 'visible', timeout: 10000 });

    // Fill the dashboard name
    await this.dashboardNameInput.fill(this.dashboardName);

    // Wait for Vue to process the input and enable the button
    await this.page.waitForTimeout(1000);

    // Wait for submit button to be visible
    await this.dashboardSubmitButton.waitFor({ state: 'visible', timeout: 30000 });

    // Use Playwright's built-in expect to wait for button to be enabled
    await expect(this.dashboardSubmitButton).toBeEnabled({ timeout: 15000 });

    // Click submit button
    await this.dashboardSubmitButton.click();

    // Wait for the success notification to confirm dashboard was created
    await this.page.getByText('Dashboard added successfully.').waitFor({ state: 'visible', timeout: 15000 });

    // Wait for navigation to the new dashboard view page
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for Vue components to mount
    await this.page.waitForTimeout(2000);

    // Wait for and click the "Add Panel" button
    await this.addPanelBtn.waitFor({ state: 'visible', timeout: 15000 });
    await this.addPanelBtn.click();

    // Wait for panel configuration to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(3000);

    // Click on Stream dropdown - use data-test selector used in other dashboard tests
    await this.streamDropdown.click();
    await this.page.waitForTimeout(500);

    // Type stream name to filter
    await this.streamDropdown.press("Control+a");
    await this.streamDropdown.fill("e2e_automate");
    await this.page.waitForTimeout(1500);

    // Select e2e_automate stream option
    const streamOption = this.page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2);
    await streamOption.waitFor({ state: "visible", timeout: 15000 });
    await streamOption.click();

    // Use search to find fields - more reliable than scrolling
    await this.fieldSearchInput.waitFor({ state: 'visible', timeout: 10000 });

    // Search for kubernetes_container_hash and add to Y-axis
    await this.fieldSearchInput.click();
    await this.fieldSearchInput.fill('kubernetes_container_hash');
    await this.page.waitForTimeout(1000);

    const yFieldButton = this.page.locator('[data-test^="field-list-item-"][data-test$="-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').first();
    await yFieldButton.waitFor({ state: 'visible', timeout: 10000 });
    await yFieldButton.click();

    // Clear search and add kubernetes_container_image to B-axis (breakdown)
    await this.fieldSearchInput.fill('');
    await this.fieldSearchInput.fill('kubernetes_container_image');
    await this.page.waitForTimeout(1000);

    const bFieldButton = this.page.locator('[data-test^="field-list-item-"][data-test$="-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').first();
    await bFieldButton.waitFor({ state: 'visible', timeout: 10000 });
    await bFieldButton.click();

    // Clear search
    await this.fieldSearchInput.fill('');
    await this.dashboardPanelNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardPanelNameInput.click();
    await this.dashboardPanelNameInput.fill(this.panelName);
    await this.dashboardPanelNameInput.press('Enter');
    await expect(this.applyButton).toBeVisible();
    await this.applyButton.click();
    await this.page.waitForTimeout(5000);
  }
  async deleteDashboard() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(5000);

    // Search for the dashboard before deleting
    await this.dashboardSearch.fill(this.dashboardName);
    await this.page.waitForTimeout(2000);

    await this.dashboardDelete.click({ force: true });
    await this.page.waitForTimeout(2000);
    await this.confirmButton.filter({ has: this.page.locator(':visible') }).first().click();
    await expect(this.page.getByRole('alert')).toContainText('Dashboard deleted successfully.');
  }

  async deleteSearchedDashboard(dashboardName) {
    // First search for the dashboard
    await this.dashboardSearch.click();
    await this.dashboardSearch.fill(dashboardName);
    await this.page.waitForTimeout(1000);

    // Find the dashboard row and click the delete button
    const dashboardRow = this.page.getByRole("row", { name: new RegExp(`.*${dashboardName}`) });
    await dashboardRow.locator('[data-test="dashboard-delete"]').click();

    // Confirm deletion
    await this.confirmButton.click();
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
    await this.shareButton.click();
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
    await this.orgDropdown.getByText('arrow_drop_down').click();
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
    await this.profileButton.click({ force: true });

    // Wait for the logout menu item to be present in the DOM with reasonable timeout
    await this.logoutMenuItem.waitFor({ state: 'attached', timeout: 10000 });

    // Wait for element to be visible instead of hard wait
    await this.logoutMenuItem.waitFor({ state: 'visible', timeout: 5000 });

    // Now click the logout item
    await this.logoutMenuItem.click({ force: true });
  }

  async notAvailableDashboard() {
    // Wait for the dashboard add button to be visible
    await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });

    // Click on the search input
    await this.dashboardSearch.click();

    // Fill the search input with the dashboard name
    await this.dashboardSearch.fill(this.dashboardName);

    // Check that the dashboard table contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');

    // Click on the toggle for searching across folders
    await this.searchAcrossFoldersToggle.click();

    // Check again that the dashboard table contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');

    // Click on the toggle again
    await this.searchAcrossFoldersToggle.click();

    // Final check that the dashboard table still contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');
  }

  async addCustomChart() {
    await this.dashboardsMenuItem.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardsMenuItem.click();

    await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.addDashboardButton.click();

    // Wait for dialog and fill name
    await this.dashboardNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardNameInput.fill("Customcharts");

    // Wait for submit button to be enabled
    await expect(this.dashboardSubmitButton).toBeEnabled({ timeout: 15000 });
    await this.dashboardSubmitButton.click();

    // Wait for success and navigation
    await this.page.getByText('Dashboard added successfully.').waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Add panel and select custom chart
    await this.addPanelBtn.waitFor({ state: 'visible', timeout: 15000 });
    await this.addPanelBtn.click();
    await this.customChartItem.waitFor({ state: 'visible', timeout: 10000 });
    await this.customChartItem.click();

    // Clear Monaco editor content
    await this.markdownEditor.locator('.monaco-editor').waitFor({ state: 'visible', timeout: 10000 });
    await this.markdownEditor.locator('.monaco-editor').click();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+A`);
    await this.page.keyboard.press('Delete');
  }


}


