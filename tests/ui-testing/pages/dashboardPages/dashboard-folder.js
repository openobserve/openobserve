import { expect } from "@playwright/test";

export default class DashboardFolder {
  constructor(page) {
    this.page = page;
    this.folderSearchInput = page.locator('[data-test="folder-search"]');
  }
  generateUniqueFolderName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  getFolderCardByName(folderName) {
    return this.page.getByRole("row", { name: new RegExp(`.*${folderName}`) });
  }

  //Dashboard folder search
  async searchFolder(folderName) {
    await this.folderSearchInput.click();
    await this.folderSearchInput.fill(folderName);
  }

  // Create folder
  async createFolder(folderName) {
    await this.page.locator('[data-test="dashboard-new-folder-btn"]').click();
    await this.page.locator('[data-test="dashboard-folder-add-name"]').click();
    await this.page
      .locator('[data-test="dashboard-folder-add-name"]')
      .fill(folderName);
    await this.page.locator('[data-test="dashboard-folder-add-save"]').click();
  }

  // Delete folder
  async deleteFolder(folderName) {
    const { page } = this;

    // Locate the folder card
    const folderCard = page.locator('[data-test^="dashboard-folder-tab-"]', {
      hasText: folderName,
    });

    // Ensure visible
    await folderCard.waitFor({ state: "visible", timeout: 10000 });
    await folderCard.scrollIntoViewIfNeeded();
    await folderCard.click();
    await page.waitForTimeout(200); // Slight pause to allow hover
    await folderCard.click();
    await folderCard.hover();

    // Click the more (3 dots) icon
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.click();

    // Click delete icon
    const deleteIcon = page.locator(
      '[data-test="dashboard-delete-folder-icon"]'
    );
    await deleteIcon.click();

    // Confirm deletion
    const confirmButton = page.locator('[data-test="confirm-button"]');
    await confirmButton.click();
  }

  // Edit folder name
  async editFolderName(oldName, newName) {
    const { page } = this;

    // Locate the folder card using the current name
    const folderCard = page.locator('[data-test^="dashboard-folder-tab-"]', {
      hasText: oldName,
    });
    // Make sure it's visible
    await folderCard.waitFor({ state: "visible", timeout: 10000 });
    await folderCard.scrollIntoViewIfNeeded();
    await folderCard.click();
    await folderCard.click();
    await folderCard.hover();

    // Click the more (3-dots) icon
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.waitFor({ state: "visible", timeout: 3000 });
    await moreIcon.click();

    // Click edit folder
    await page.locator('[data-test="dashboard-edit-folder-icon"]').click();
    await page.locator('[data-test="dashboard-folder-add-name"]').click();

    // Clear existing name
    const nameInput = await page.locator(
      '[data-test="dashboard-folder-add-name"]'
    );
    await nameInput.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    await nameInput.fill(newName);

    // Save
    await page.locator('[data-test="dashboard-folder-add-save"]').click();
  }
}
