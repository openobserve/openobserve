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

    // Dashboard list surface. OTable mirrors its `loading` prop onto the inner
    // root as data-test-loading, which is the only settled-list signal exposed.
    this.dashboardTable = page.locator('[data-test="dashboard-table"]');
    this.tableSettled = page.locator(
      '[data-test="o2-table"][data-test-loading="false"]'
    );
    this.searchInput = page.locator('[data-test="dashboard-search-field"]');
    this.refreshBtn = page.locator('[data-test="dashboard-list-refresh"]');

    // Search scope toggle + clear button. OInput derives the clear button's
    // hook from the consumer's data-test (`${parent}-clear`), and only renders
    // it while the field is non-empty — so its absence is a real signal, not a
    // timing artifact.
    this.searchScopeAllFolders = page.locator(
      '[data-test="dashboard-search-across-folders-toggle"]'
    );
    this.searchScopeCurrentFolder = page.locator(
      '[data-test="dashboard-search-scope-current"]'
    );
    this.searchClearBtn = page.locator('[data-test="dashboard-search-clear"]');

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

  // Dashboards.vue picks its landing folder in onMounted only AFTER awaiting the
  // folders and favorites fetches, and that decision overwrites activeFolderId —
  // so a rail click landing between the rail rendering and that decision is
  // silently discarded and no route is ever pushed. Retry once instead of
  // failing: the landing commits at most once, so the clobber cannot recur.
  // The wait is not swallowed — if the switch never happens, every later
  // assertion would be made against the wrong folder, and failing here names
  // the real cause instead of surfacing as a confusing missing row.
  async openFavoritesFolder() {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.favoritesFolderTab.waitFor({
        state: "visible",
        timeout: 15000,
      });
      await this.favoritesFolderTab.click();
      try {
        await this.page.waitForURL(
          (url) =>
            new URL(url).searchParams.get("folder") === FAVORITES_FOLDER_ID,
          { timeout: 15000 }
        );
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }

  // Folder navigation is cache-first: `loading` never flips for an
  // already-cached folder, so the table can still be showing the Favorites rows
  // with data-test-loading="false" and a settled-list wait would pass against
  // them. The route is pushed only once the switch commits, so leaving
  // ?folder=__favorites__ is the honest gate when returning to a real folder.
  async waitForFavoritesViewExited() {
    await this.page.waitForURL(
      (url) => new URL(url).searchParams.get("folder") !== FAVORITES_FOLDER_ID,
      { timeout: 15000 }
    );
  }

  async waitForListSettled() {
    await this.tableSettled.waitFor({ state: "visible", timeout: 15000 });
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

  // Switch the scope toggle to "All folders" and search. In the Favorites view
  // this is the path fixed by #13437: the rows computed used to short-circuit
  // to the stored favorites whenever the Favorites pseudo-folder was active,
  // so cross-folder hits could never render. Filling the field triggers a
  // 600ms-debounced list call, so callers assert with the standard 15s
  // web-first timeout rather than sleeping here.
  async searchAcrossFolders(query) {
    await this.searchScopeAllFolders.waitFor({
      state: "visible",
      timeout: 15000,
    });
    await this.searchScopeAllFolders.click();
    // The activeFolderId watcher resets searchAcrossFolders to false when a
    // folder view settles, silently undoing a click that landed just before it
    // — the query would then filter the current folder instead. OToggleGroupItem
    // exposes the committed scope as data-state, so assert it actually stuck.
    await expect(this.searchScopeAllFolders).toHaveAttribute(
      "data-state",
      "on",
      { timeout: 15000 }
    );
    await this.searchInput.waitFor({ state: "visible", timeout: 15000 });
    await this.searchInput.fill(query);
  }

  // ── Search clearing ────────────────────────────────────────────────────

  async clearSearch() {
    await this.searchClearBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.searchClearBtn.click();
  }

  // Regression guard for the `:clearable="searchAcrossFolders"` → `clearable`
  // change: before it, the clear button only ever rendered while the "All
  // folders" scope was active, leaving current-folder searches with no way to
  // reset the field from the UI.
  async verifySearchClearButtonVisible() {
    await expect(this.searchClearBtn).toBeVisible({ timeout: 15000 });
  }

  async verifySearchInputEmpty() {
    await expect(this.searchInput).toHaveValue("", { timeout: 15000 });
  }

  // ── Favorite toggling ──────────────────────────────────────────────────

  // Toggling a favorite updates the UI optimistically, then fires a
  // fire-and-forget POST to persist it (useFavoriteDashboards.ts). A test that
  // reloads right after addToFavorites() can otherwise race the page teardown
  // against that still-in-flight request and lose the favorite server-side
  // while the DOM already looked correct. Wait for the response so callers
  // get a genuinely persisted state, not just the optimistic one.
  //
  // The settings/v2/user/{userId} endpoint is keyed only by user, not by
  // which setting is being saved — setting_key travels in the POST body, not
  // the URL. Matching on URL alone can resolve on an unrelated user-setting
  // save (e.g. home_dashboard) that happens to land in the same window,
  // letting a caller proceed before the favorites save actually completed.
  // Check the request body's setting_key so this only resolves on the right
  // save.
  async waitForFavoritesPersisted(action) {
    await Promise.all([
      this.page.waitForResponse((response) => {
        if (!/\/settings\/v2\/user\//.test(response.url())) return false;
        if (response.status() !== 200) return false;
        const body = response.request().postDataJSON();
        return body?.setting_key === "favorite_dashboards";
      }),
      action(),
    ]);
  }

  async addToFavorites(dashboardName) {
    const toggle = this.getFavoriteToggle(dashboardName);
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    await this.waitForFavoritesPersisted(() => toggle.click());
    await this.verifyIsFavorite(dashboardName);
  }

  async removeFromFavorites(dashboardName) {
    const toggle = this.getFavoriteToggle(dashboardName);
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    await this.waitForFavoritesPersisted(() => toggle.click());
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

  // Favorited rows render the filled `star` icon and carry the `text-favorite`
  // class; unfavorited ones use the `star-outline` icon. Asserting on the class
  // keeps this independent of icon-name internals.
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

  // Teardown helper: un-favorite if (and only if) still favorited, without
  // throwing if the dashboard is already gone. Deleting a folder does not
  // prune favorites for the dashboards inside it (a real app bug, tracked
  // separately) — every test that favorites a dashboard but doesn't itself
  // delete it would otherwise leave a ghost favorite behind forever on the
  // shared test account. Call this before deleteFolder in afterEach.
  async unfavoriteIfFavorited(dashboardName) {
    const toggle = this.getFavoriteToggle(dashboardName);
    if ((await toggle.count()) === 0) return;
    const classAttr = (await toggle.getAttribute("class")) ?? "";
    if (/text-favorite/.test(classAttr)) {
      // Fire-and-forget POST — without waiting, the context closes at test end
      // and the un-favorite is lost, leaving exactly the ghost this prevents.
      await this.waitForFavoritesPersisted(() => toggle.click());
    }
  }

  // ── Presence assertions ────────────────────────────────────────────────

  async verifyDashboardVisible(dashboardName) {
    await expect(this.getNameCell(dashboardName)).toBeVisible({
      timeout: 15000,
    });
  }

  // toHaveCount(0) is trivially true while the list is still loading, so a
  // ghost row would pass as absent. Gate on the rendered list first.
  async verifyDashboardNotPresent(dashboardName) {
    await this.waitForListSettled();
    await expect(this.getNameCell(dashboardName)).toHaveCount(0, {
      timeout: 15000,
    });
  }

  // ── Deletion ───────────────────────────────────────────────────────────

  async deleteDashboardFromRow(dashboardName) {
    await this.getRowDeleteBtn(dashboardName).click();
    await this.deleteConfirmBtn.waitFor({ state: "visible", timeout: 15000 });
    // Negative lookahead keeps this off the /dashboards/bulk endpoint.
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.request().method() === "DELETE" &&
          /\/dashboards\/(?!bulk)[^/?]+/.test(r.url()),
        { timeout: 30000 }
      ),
      this.deleteConfirmBtn.click(),
    ]);
    expect(
      response.ok(),
      `delete responded ${response.status()} for ${response.url()}`
    ).toBe(true);
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
    // The regression this guards was a 404 from sending `__favorites__` as
    // ?folder=; the response status is the direct signal, the toast its shadow.
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.request().method() === "DELETE" && /\/dashboards\/bulk/.test(r.url()),
        { timeout: 30000 }
      ),
      this.bulkDeleteConfirmBtn.click(),
    ]);
    expect(
      response.ok(),
      `bulk delete responded ${response.status()} for ${response.url()}`
    ).toBe(true);
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
