import { expect } from '@playwright/test';

const PREFIX = 'logs-search-bar-menu-saved-views';

export class LogsSavedViewsMenuPage {
  constructor(page) {
    this.page = page;
    this.applyRow = (id) => `[data-test="${PREFIX}-apply-${id}"]`;
    this.favoriteToggle = (id) => `[data-test="${PREFIX}-favorite-${id}"]`;
    this.updateBtn = (id) => `[data-test="${PREFIX}-update-${id}"]`;
    this.deleteBtn = (id) => `[data-test="${PREFIX}-delete-${id}"]`;
    this.favoritesGroup = `[data-test="${PREFIX}-favorites-group"]`;
    this.allGroup = `[data-test="${PREFIX}-all-group"]`;
    this.confirmDialog = '[data-test="confirm-dialog"]';
    this.confirmPrimaryBtn = '[data-test="o-dialog-primary-btn"]';
  }

  async expectRowVisible(id, timeout = 10000) {
    await expect(this.page.locator(this.applyRow(id))).toBeVisible({ timeout });
  }

  async expectRowAbsent(id) {
    await expect(this.page.locator(this.applyRow(id))).toHaveCount(0);
  }

  async toggleFavorite(id) {
    await this.page.locator(this.favoriteToggle(id)).click();
  }

  async expectInFavorites(id, timeout = 10000) {
    await expect(this.page.locator(this.favoritesGroup).locator(this.applyRow(id))).toBeVisible({ timeout });
  }

  async expectNotInFavorites(id) {
    await expect(this.page.locator(this.favoritesGroup).locator(this.applyRow(id))).toHaveCount(0);
  }

  async expectNotInAllGroup(id) {
    await expect(this.page.locator(this.allGroup).locator(this.applyRow(id))).toHaveCount(0);
  }

  async expectFavoritesGroupGone() {
    await expect(this.page.locator(this.favoritesGroup)).toHaveCount(0);
  }

  /** Clicks the row action, confirms the dialog naming the view, and returns the API response. */
  async confirmRowAction(action, id, viewName, method) {
    const btn = action === 'update' ? this.updateBtn(id) : this.deleteBtn(id);
    const responsePromise = this.page.waitForResponse(
      (r) => r.request().method() === method && r.url().includes(`/savedviews/${id}`),
      { timeout: 15000 },
    );
    await this.page.locator(btn).click();
    const confirm = this.page.locator(this.confirmDialog).filter({ hasText: viewName });
    await expect(confirm).toBeVisible({ timeout: 10000 });
    await confirm.locator(this.confirmPrimaryBtn).click();
    return responsePromise;
  }
}

export default LogsSavedViewsMenuPage;
