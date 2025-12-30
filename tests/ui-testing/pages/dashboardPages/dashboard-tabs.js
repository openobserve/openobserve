// dashboard tabs page object
// methods: addTab, switchTab, deleteTab, renameTab
import { expect } from "@playwright/test";

export default class DashboardTabs {
  constructor(page) {
    this.page = page;
  }

  // Method to add a new tab
  async addTab(name) {
    // Click 'Add Tab' button in the tab list
    const addBtn = this.page.locator('[data-test="dashboard-tab-add-btn"]');
    await addBtn.waitFor({ state: "visible", timeout: 5000 });
    await addBtn.click();

    // Fill tab name
    const nameInput = this.page.locator('[data-test="dashboard-add-tab-name"]');
    await nameInput.waitFor({ state: "visible" });
    await nameInput.fill(name);

    // Save
    await this.page.locator('[data-test="dashboard-add-tab-submit"]').click();
    
    // Wait for tab to appear
    await this.page.locator(`[data-test^="dashboard-tab-"][data-test$="-name"]:has-text("${name}")`).waitFor({ state: "visible" });
  }

  // Method to switch to a tab by name
  async switchTab(name) {
    const tab = this.page.locator(`[data-test^="dashboard-tab-"]:has-text("${name}")`).first();
    await tab.click();
    // Verification: URL should contain tab ID or name should be active
    // Quasar active tab usually has a specific class or we can just trust the click
  }

  // Method to delete a tab
  async deleteTab(name) {
    // Tabs must be deleted via Settings -> Tabs
    const settingsBtn = this.page.locator('[data-test="dashboard-setting-btn"]');
    await settingsBtn.click();
    
    await this.page.locator('[data-test="dashboard-settings-tab-tab"]').click();
    
    // Find the row with the tab name and click delete
    const tabRow = this.page.locator(`[data-test="dashboard-tab-settings-draggable-row"]:has-text("${name}")`);
    await tabRow.locator('[data-test="dashboard-tab-settings-tab-delete-btn"]').click();
    
    // Confirm delete
    await this.page.locator('[data-test="confirm-button"]').click();
    
    // Close settings
    await this.page.locator('[data-test="dashboard-settings-close-btn"]').click();
  }

  // Method to check if a tab is active
  async checkTabActive(name) {
    const tab = this.page.locator(`[data-test^="dashboard-tab-"][data-test$="-name"]:has-text("${name}")`).first();
    const qTab = tab.locator('xpath=ancestor::div[contains(@class, "q-tab")]');
    await expect(qTab).toHaveClass(/q-tab--active/);
  }
}
