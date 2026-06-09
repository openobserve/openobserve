//Methods: Create folder, Search folder, Add folder Name, Edit folder name, Delete folder
import { expect } from "@playwright/test";

export default class DashboardFolder {
  constructor(page) {
    this.page = page;
    // OInput renders a wrapper with [data-test="folder-search"] and the actual
    // <input> carries the auto-forwarded `-field` data-test. Target the input
    // so .fill() succeeds without resorting to body/element selectors.
    this.folderSearchInput = page.locator('[data-test="folder-search-field"]');
    // Folder create / edit dialog locators — hoisted to class members so
    // method bodies never call `page.locator(...)` inline (POM strict policy).
    this.newFolderBtn = page.locator('[data-test="dashboard-new-folder-btn"]');
    this.folderNameInput = page.locator(
      '[data-test="dashboard-folder-add-name-field"]'
    );
    this.folderDialogSaveBtn = page.locator(
      '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    // More-icon and the post-menu actions live on the global page surface
    // (rendered into a Reka portal in the menu case). The folder-card scoped
    // more-icon is built via the per-folder factory helper to keep its scope
    // tied to the row.
    this.moreIconSelector = '[data-test="dashboard-more-icon"]';
    this.deleteFolderIcon = page.locator(
      '[data-test="dashboard-delete-folder-icon"]'
    );
    this.editFolderIcon = page.locator(
      '[data-test="dashboard-edit-folder-icon"]'
    );
    this.confirmDeleteFolderBtn = page.locator(
      '[data-test="dashboard-confirm-delete-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
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
    await this.newFolderBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.newFolderBtn.click();

    await this.folderNameInput.waitFor({ state: "visible", timeout: 5000 });
    await this.folderNameInput.click();
    await this.folderNameInput.fill(folderName);

    await this.folderDialogSaveBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.folderDialogSaveBtn.click();
    // Wait for the dialog to fully close before any subsequent interactions.
    // Reka UI sets aria-hidden="true" on the overlay during the close animation
    // (data-state stays "open"), so waitFor({ state: "hidden" }) resolves too early
    // while the overlay still intercepts pointer events.
    // Wait for the overlay to be detached from the DOM instead.
    await this.page.locator('[data-test="o-dialog-overlay"]').waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }

  // Delete folder
  async deleteFolder(folderName) {
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
    // the CSS visibility gate while still resolving by data-test. Scoping
    // the icon to the row via the per-folder card keeps the action tied to
    // the right folder.
    const moreIcon = folderCard.locator(this.moreIconSelector);
    await moreIcon.click({ force: true });

    // Click delete icon and confirm via class-member locators.
    await this.deleteFolderIcon.click();
    await this.confirmDeleteFolderBtn.click();
  }

  // Edit folder name
  async editFolderName(oldName, newName) {
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
    const moreIcon = folderCard.locator(this.moreIconSelector);
    await moreIcon.click({ force: true });

    // Click edit folder via the class-member icon locator.
    await this.editFolderIcon.click();

    // Clear existing name — target the actual <input> (data-test="...-field")
    // because the wrapper div carries the bare `dashboard-folder-add-name`.
    await this.folderNameInput.waitFor({ state: "visible", timeout: 5000 });
    await this.folderNameInput.click();
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");

    await this.folderNameInput.fill(newName);

    // Save via the class-member dialog primary button.
    await this.folderDialogSaveBtn.click();
  }
}

