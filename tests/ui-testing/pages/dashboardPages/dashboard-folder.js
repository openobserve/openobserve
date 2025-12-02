//Methods: Create folder, Search folder, Add folder Name, Edit folder name, Delete folder
import { expect } from "@playwright/test";

export default class DashboardFolder {
  constructor(page) {
    this.page = page;
    this.folderSearchInput = page.locator('[data-test="folder-search"]');
  }
  // Generate a unique folder name with a prefix
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

  // Verify folder is visible after search
  async verifyFolderVisible(folderName) {
    await expect(this.page.locator(`text=${folderName}`)).toBeVisible();
  }

  // Wait for folder dialog to be fully stable
  async waitForFolderDialogStable() {
    // Wait for dialog to be visible
    const dialog = this.page.locator('.q-dialog__inner');
    await dialog.waitFor({ state: "visible", timeout: 50000 });

    // Wait for name input to be visible
    const nameInput = this.page.locator('[data-test="dashboard-folder-add-name"]');
    await nameInput.waitFor({ state: "visible", timeout: 15000 });

    // Wait for save button to be visible
    const saveBtn = this.page.locator('[data-test="dashboard-folder-add-save"]');
    await saveBtn.waitFor({ state: "visible", timeout: 5000 });

    // Wait for animations to complete
    await this.page.waitForTimeout(1000);
  }

  // Wait for Update Folder dialog to be fully stable
  async waitForUpdateFolderDialogStable() {
    // Wait for dialog inner container to be visible
    const dialogInner = this.page.locator('.q-dialog__inner');
    await dialogInner.waitFor({ state: "visible", timeout: 15000 });

    // Wait for the card container with "Update Folder" title
    const updateFolderCard = this.page.locator('.q-card').filter({ hasText: 'Update Folder' });
    await updateFolderCard.waitFor({ state: "visible", timeout: 10000 });

    // Wait for name input field to be visible and attached
    const nameInput = this.page.locator('[data-test="dashboard-folder-add-name"]');
    await nameInput.waitFor({ state: "visible", timeout: 15000 });
    await nameInput.waitFor({ state: "attached", timeout: 5000 });

    // Wait for description field to be visible (ensures form is fully loaded)
    const descriptionInput = this.page.locator('[data-test="dashboard-folder-add-description"]');
    await descriptionInput.waitFor({ state: "visible", timeout: 5000 });

    // Wait for cancel button in the form to be visible
    const cancelBtn = this.page.locator('[data-test="dashboard-folder-add-cancel"]').last();
    await cancelBtn.waitFor({ state: "visible", timeout: 5000 });

    // Wait for save button to be visible
    const saveBtn = this.page.locator('[data-test="dashboard-folder-add-save"]');
    await saveBtn.waitFor({ state: "visible", timeout: 5000 });

    // Wait for all animations and DOM updates to complete
    await this.page.waitForTimeout(1500);
  }

  // Create folder
  async createFolder(folderName) {
    const newFolderBtn = this.page.locator('[data-test="dashboard-new-folder-btn"]');
    await newFolderBtn.waitFor({ state: "visible", timeout: 5000 });
    await newFolderBtn.click();
    // Wait for dialog to be stable
    await this.waitForFolderDialogStable();

    // Fill folder name (fill automatically handles focus)
    const nameInput = this.page.locator('[data-test="dashboard-folder-add-name"]');
    await nameInput.waitFor({ state: "visible", timeout: 5000 });
    await nameInput.fill(folderName);

    // Click save
    const saveBtn = this.page.locator('[data-test="dashboard-folder-add-save"]');
    await saveBtn.click();

    // Wait for dialog to close
    await this.page.locator('.q-dialog__inner').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
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
    await folderCard.hover();
    await page.waitForTimeout(300);

    // Click the more (3 dots) icon
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.waitFor({ state: "visible", timeout: 5000 });
    await moreIcon.click();

    // Click delete icon
    const deleteIcon = page.locator('[data-test="dashboard-delete-folder-icon"]');
    await deleteIcon.waitFor({ state: "visible", timeout: 5000 });
    await deleteIcon.click();

    // Confirm deletion
    const confirmButton = page.locator('[data-test="confirm-button"]');
    await confirmButton.waitFor({ state: "visible", timeout: 5000 });
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
    await folderCard.hover();
    await page.waitForTimeout(300);

    // Click the more (3-dots) icon
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.waitFor({ state: "visible", timeout: 5000 });
    await moreIcon.click();

    // Click edit folder icon
    const editIcon = page.locator('[data-test="dashboard-edit-folder-icon"]');
    await editIcon.waitFor({ state: "visible", timeout: 5000 });
    await editIcon.click();

    // Wait for dialog to be visible first
    const dialog = page.locator('.q-dialog__inner');
    await dialog.waitFor({ state: "visible", timeout: 5000 });

    // Wait for the form container to be visible and stable
    const formContainer = page.locator('form.q-form');
    await formContainer.waitFor({ state: "visible", timeout: 5000 });

    // Wait for name input to be visible and attached
    const nameInput = page.locator('[data-test="dashboard-folder-add-name"]');
    await nameInput.waitFor({ state: "visible", timeout: 5000 });
    await nameInput.waitFor({ state: "attached", timeout: 5000 });

    // Wait for initial form render to complete
    await page.waitForTimeout(1000);

    // Clear and fill the new name using fill (which is more reliable than type)
    await nameInput.click();
    await nameInput.fill('');
    await page.waitForTimeout(200);
    await nameInput.fill(newName);

    // Verify the input has the correct value
    await expect(nameInput).toHaveValue(newName, { timeout: 5000 });

    // Wait for validation to complete
    await page.waitForTimeout(500);

    // Ensure dialog is still visible before clicking save
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Locate save button and wait for it to be ready
    const saveBtn = formContainer.locator('[data-test="dashboard-folder-add-save"]');
    await saveBtn.waitFor({ state: "visible", timeout: 5000 });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });

    // Set up a promise to wait for the API response/request
    const responsePromise = page.waitForResponse(
      response => response.url().includes('folder') && (response.status() === 200 || response.status() === 201),
      { timeout: 10000 }
    ).catch(() => null);

    // Click the save button - try multiple approaches
    try {
      await saveBtn.click({ timeout: 5000 });
    } catch (error) {
      // If normal click fails, try with force
      await saveBtn.click({ force: true, timeout: 5000 });
    }

    // Wait for the API call to complete
    await responsePromise;

    // Wait for dialog to close
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});

    // Wait for UI to update after save
    await page.waitForTimeout(1000);
  }
}

