// Methods: toggle favorite, open the Favorites rail entry, assert favorite
// state, bulk-select and bulk-delete rows, assert toast outcomes.
//
// Backs dashboard-favorites.spec.js. Favorites are a per-user setting rendered
// through a `__favorites__` pseudo-folder in the folder rail — it is not a real
// backend folder, which is what made delete-from-Favorites regress before.

import { expect } from "@playwright/test";

// Mirrors FAVORITES_FOLDER_ID in web/src/composables/useFavoriteDashboards.ts.
const FAVORITES_FOLDER_ID = "__favorites__";

export default class DashboardFavorites {
  constructor(page) {
    this.page = page;

    // Folder rail — the Favorites entry is keyed by the pseudo-folder id.
    this.favoritesFolderTab = page.locator(
      `[data-test="dashboard-folder-tab-${FAVORITES_FOLDER_ID}"]`
    );

    // Dashboard list surface.
    this.dashboardTable = page.locator('[data-test="dashboard-table"]');
    this.searchInput = page.locator('[data-test="dashboard-search-field"]');
    this.refreshBtn = page.locator('[data-test="dashboard-list-refresh"]');

    // Bulk action bar (only rendered once at least one row is selected).
    this.bulkDeleteBtn = page.locator(
      '[data-test="dashboard-list-delete-dashboards-btn"]'
    );
    this.bulkDeleteConfirmBtn = page.locator(
      '[data-test="dashboard-confirm-bulk-delete-dialog"] [data-test="o-dialog-primary-btn"]'
    );

    // Single-row delete confirmation.
    this.deleteConfirmBtn = page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]'
    );

    // OToast stamps the variant on the root, so success and error are
    // distinguishable without reading message text.
    this.errorToast = page.locator('[data-test-variant="error"]');
    this.successToast = page.locator('[data-test-variant="success"]');
  }

  // ── Per-row factories ──────────────────────────────────────────────────
  // Name cells and heart toggles are keyed by the dashboard's display name.

  getNameCell(dashboardName) {
    return this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`
    );
  }

  getFavoriteToggle(dashboardName) {
    return this.page.locator(
      `[data-test="dashboard-favorite-toggle-${dashboardName}"]`
    );
  }

  // Walk from the name cell up to the enclosing OTable row so row-scoped
  // controls (checkbox, delete) resolve against the right dashboard. Same
  // ancestor-axis pattern used by dashboard-list.js.
  getRow(dashboardName) {
    return this.getNameCell(dashboardName).locator(
      "xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]"
    );
  }

  // The row checkbox is keyed by row id (the dashboard id, per row-key="id"),
  // which tests don't know — resolve it by prefix inside the row instead.
  // Must be scoped to the <label> (OTableSelectCheckbox), not the enclosing
  // <td data-test="o2-table-select-cell">, whose own data-test also matches
  // the "o2-table-select-" prefix and would trip strict mode.
  getRowCheckbox(dashboardName) {
    return this.getRow(dashboardName).locator(
      'label[data-test^="o2-table-select-"]'
    );
  }

  getRowDeleteBtn(dashboardName) {
    return this.getRow(dashboardName).locator('[data-test="dashboard-delete"]');
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  async openFavoritesFolder() {
    await this.favoritesFolderTab.waitFor({ state: "visible", timeout: 15000 });
    await this.favoritesFolderTab.click();
    // The rail pushes ?folder=__favorites__ once the view switches.
    await this.page
      .waitForURL(new RegExp(`folder=${FAVORITES_FOLDER_ID}`), {
        timeout: 15000,
      })
      .catch(() => {});
  }

  // Narrow the paginated list to a single row. The list is 20-per-page with no
  // newest-first sort, so a freshly created dashboard can land on page 2+.
  async searchDashboard(dashboardName) {
    await this.searchInput.waitFor({ state: "visible", timeout: 15000 });
    await this.searchInput.fill(dashboardName);
    await this.getNameCell(dashboardName)
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
  }

  // ── Favorite toggling ──────────────────────────────────────────────────

  async addToFavorites(dashboardName) {
    const toggle = this.getFavoriteToggle(dashboardName);
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    await toggle.click();
    await this.verifyIsFavorite(dashboardName);
  }

  async removeFromFavorites(dashboardName) {
    const toggle = this.getFavoriteToggle(dashboardName);
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    await toggle.click();
    // Unfavoriting drops the row entirely when viewed from the Favorites
    // pseudo-folder, but only flips the icon class when viewed from the
    // dashboard's real folder — the toggle element itself disappears in
    // the former case, so assert whichever the row actually did. Callers
    // assert the specific outcome right after.
    await expect(async () => {
      // count() checks the DOM once with no actionability wait, unlike
      // getAttribute() — which blocks retrying for the element to attach
      // and would hang past toPass's own budget once the row is gone.
      if ((await toggle.count()) === 0) return;
      const classAttr = (await toggle.getAttribute("class")) ?? "";
      expect(classAttr).not.toMatch(/text-favorite/);
    }).toPass({ timeout: 15000 });
  }

  // Favorited rows render the filled `favorite` icon and carry the rose
  // `text-favorite` class; unfavorited ones use the `favorite-border` outline.
  // Asserting on the class keeps this independent of icon-name internals.
  async verifyIsFavorite(dashboardName) {
    await expect(this.getFavoriteToggle(dashboardName)).toHaveClass(
      /text-favorite/,
      { timeout: 15000 }
    );
  }

  async verifyIsNotFavorite(dashboardName) {
    await expect(this.getFavoriteToggle(dashboardName)).not.toHaveClass(
      /text-favorite/,
      { timeout: 15000 }
    );
  }

  // ── Presence assertions ────────────────────────────────────────────────

  async verifyDashboardVisible(dashboardName) {
    await expect(this.getNameCell(dashboardName)).toBeVisible({
      timeout: 15000,
    });
  }

  async verifyDashboardNotPresent(dashboardName) {
    await expect(this.getNameCell(dashboardName)).toHaveCount(0, {
      timeout: 15000,
    });
  }

  // ── Deletion ───────────────────────────────────────────────────────────

  async deleteDashboardFromRow(dashboardName) {
    await this.getRowDeleteBtn(dashboardName).click();
    await this.deleteConfirmBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.deleteConfirmBtn.click();
    // Wait for the dialog to actually close before the caller asserts on
    // the resulting list state, instead of racing the close animation.
    await this.page
      .locator('[data-test="dashboard-confirm-dialog"]')
      .waitFor({ state: "detached", timeout: 10000 })
      .catch(() => {});
  }

  async selectDashboard(dashboardName) {
    const checkbox = this.getRowCheckbox(dashboardName);
    await checkbox.waitFor({ state: "visible", timeout: 15000 });
    await checkbox.click();
  }

  async bulkDeleteSelected() {
    await this.bulkDeleteBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.bulkDeleteBtn.click();
    await this.bulkDeleteConfirmBtn.waitFor({
      state: "visible",
      timeout: 15000,
    });
    await this.bulkDeleteConfirmBtn.click();
  }

  // Regression guard: bulk delete used to send `__favorites__` as the ?folder=
  // query param, which the backend rejects with a 404.
  async verifyNoErrorToast() {
    await expect(this.errorToast).toHaveCount(0, { timeout: 10000 });
  }

  async verifySuccessToast() {
    await expect(this.successToast.first()).toBeVisible({ timeout: 15000 });
  }
}
