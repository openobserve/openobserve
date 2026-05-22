//Methods: Create folder, Search folder, Add folder Name, Edit folder name, Delete folder
import { expect } from "@playwright/test";

export default class DashboardFolder {
  constructor(page) {
    this.page = page;
    // OInput renders a wrapper with [data-test="folder-search"] and the actual
    // <input> carries the auto-forwarded `-field` data-test. Target the input
    // so .fill() succeeds without resorting to body/element selectors.
    this.folderSearchInput = page.locator('[data-test="folder-search-field"]');
  }
  // Generate a unique folder name with a prefix
  generateUniqueFolderName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  // Locate the folder card (clickable row) by its display name. Resolves via
  // the per-folder data-test attribute on Dashboards.vue
  // (`dashboard-folder-tab-name-{name}`), which is a stable, unique hook.
  getFolderCardByName(folderName) {
    return this.page.locator(
      `[data-test="dashboard-folder-tab-name-${folderName}"]`
    );
  }

  // Locate the folder title span by name (`dashboard-folder-name-{name}`).
  getFolderTitleByName(folderName) {
    return this.page.locator(
      `[data-test="dashboard-folder-name-${folderName}"]`
    );
  }

  //Dashboard folder search
  async searchFolder(folderName) {
    await this.folderSearchInput.click();
    await this.folderSearchInput.fill(folderName);
  }

  // Verify folder is visible after search (by the per-folder data-test span)
  async verifyFolderVisible(folderName) {
    await expect(this.getFolderTitleByName(folderName)).toBeVisible();
  }

  // Verify folder is NOT present after deletion
  async verifyFolderNotPresent(folderName) {
    await expect(this.getFolderTitleByName(folderName)).toHaveCount(0);
  }

  // Click on a folder row by name to open it
  async openFolderByName(folderName) {
    const folderCard = this.getFolderCardByName(folderName);
    await folderCard.waitFor({ state: "visible", timeout: 10000 });
    await folderCard.click();
  }

  // Create folder
  async createFolder(folderName) {
    const newFolderBtn = this.page.locator('[data-test="dashboard-new-folder-btn"]');
    // OFormInput exposes data-test="<name>" on its wrapper; the real <input>
    // carries the auto-forwarded `<name>-field` data-test (OInput.vue).
    const nameInput = this.page.locator('[data-test="dashboard-folder-add-name-field"]');
    const saveBtn = this.page.locator('[data-test="dashboard-folder-dialog"] [data-test="o-drawer-primary-btn"]');

    await newFolderBtn.waitFor({ state: "visible", timeout: 5000 });
    await newFolderBtn.click();

    await nameInput.waitFor({ state: "visible", timeout: 5000 });
    await nameInput.click();
    await nameInput.fill(folderName);

    await saveBtn.waitFor({ state: "visible", timeout: 5000 });
    await saveBtn.click();
  }

  // Delete folder
  async deleteFolder(folderName) {
    const { page } = this;

    // Re-search for the folder so the list is filtered to a deterministic
    // single-row state before we try to open its action menu.
    await this.searchFolder(folderName);

    // Locate the folder card via its per-folder data-test row
    const folderCard = this.getFolderCardByName(folderName);

    // Ensure visible
    await folderCard.waitFor({ state: "visible", timeout: 10000 });
    await folderCard.scrollIntoViewIfNeeded();
    await folderCard.hover();

    // The more icon lives inside a hover-only container. force-click bypasses
    // the CSS visibility gate while still resolving by data-test.
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.click({ force: true });

    // Click delete icon
    const deleteIcon = page.locator(
      '[data-test="dashboard-delete-folder-icon"]'
    );
    await deleteIcon.click();

    // Confirm deletion
    const confirmButton = page.locator(
      '[data-test="dashboard-confirm-delete-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    await confirmButton.click();
  }

  // Edit folder name
  async editFolderName(oldName, newName) {
    const { page } = this;

    // Re-search to filter the folder list down to this row before opening
    // its action menu — keeps the more-icon visibility deterministic.
    await this.searchFolder(oldName);

    // Locate the folder card via its per-folder data-test row
    const folderCard = this.getFolderCardByName(oldName);
    // Make sure it's visible
    await folderCard.waitFor({ state: "visible", timeout: 10000 });
    await folderCard.scrollIntoViewIfNeeded();
    await folderCard.hover();

    // The more icon lives inside a hover-only container. force-click bypasses
    // the CSS visibility gate while still resolving by data-test.
    const moreIcon = folderCard.locator('[data-test="dashboard-more-icon"]');
    await moreIcon.click({ force: true });

    // Click edit folder
    await page.locator('[data-test="dashboard-edit-folder-icon"]').click();

    // Clear existing name — target the actual <input> (data-test="...-field")
    // because the wrapper div carries the bare `dashboard-folder-add-name`.
    const nameInput = page.locator(
      '[data-test="dashboard-folder-add-name-field"]'
    );
    await nameInput.waitFor({ state: "visible", timeout: 5000 });
    await nameInput.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    await nameInput.fill(newName);

    // Save
    await page.locator('[data-test="dashboard-folder-dialog"] [data-test="o-drawer-primary-btn"]').click();
  }
}

