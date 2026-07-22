import { test as base, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

export const test = base;

test.describe.configure({ mode: "parallel" });

// Favorites are a per-user setting surfaced through a `__favorites__`
// pseudo-folder in the rail — not a real backend folder. These tests cover the
// add/remove round trip plus the three regressions that came out of it:
//   1. bulk delete sent `__favorites__` as ?folder=, which the backend 404s on
//   2. deleting a dashboard left a ghost row behind in Favorites
//   3. bulk-deleting from Favorites left a ghost row in the source folder
//      (folder navigation is cache-first)
test.describe("dashboard favorites testcases", () => {
  // Each test seeds its own folder + dashboard so shards can run in parallel
  // without contending over shared favorites state (favorites are per-user,
  // and the suite logs in as the same user).
  let pm;
  let folderName;
  let dashboardName;

  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await page.waitForTimeout(1000);
    // Favorites tests never query the ingested stream (no panels/search
    // involved), so there's no need to wait out log-indexing lag here —
    // ingestion() itself already awaits the POST response.
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    pm = new PageManager(page);
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    folderName = pm.dashboardFolder.generateUniqueFolderName("fav");
    dashboardName = "Dash_" + Date.now();

    await pm.dashboardFolder.createFolder(folderName);
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.openFolderByName(folderName);
    // No fixed settle wait needed — createDashboard() below already waits
    // for the "New Dashboard" button to be visible before acting.

    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.backToDashboardList();
    await waitForDashboardPage(page);
  });

  test("should add a dashboard to favorites and show it in the Favorites folder", async ({
    page,
  }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    // The favorited dashboard is reachable from the rail's Favorites entry
    // regardless of which folder it actually lives in.
    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.verifyDashboardVisible(dashboardName);
    await pm.dashboardFavorites.verifyIsFavorite(dashboardName);
  });

  test("should remove a dashboard from favorites and drop it from the Favorites folder", async ({
    page,
  }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.verifyDashboardVisible(dashboardName);

    // Unfavoriting from inside the Favorites view removes the row from it...
    await pm.dashboardFavorites.removeFromFavorites(dashboardName);
    await pm.dashboardFavorites.verifyDashboardNotPresent(dashboardName);

    // ...but must not delete the dashboard itself.
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.openFolderByName(folderName);
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.verifyDashboardVisible(dashboardName);
    await pm.dashboardFavorites.verifyIsNotFavorite(dashboardName);
  });

  test("should persist the favorite across a page reload", async ({ page }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    // Favorites live in a user setting, not local component state.
    await page.reload();
    await waitForDashboardPage(page);

    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.verifyDashboardVisible(dashboardName);
  });

  // Regression: the bulk delete request used activeFolderId as ?folder=, which
  // in the Favorites view is the `__favorites__` pseudo-folder id. The backend
  // has no such folder, so every bulk delete from Favorites 404'd.
  test("should bulk delete a favorited dashboard from the Favorites folder without a 404", async ({
    page,
  }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.verifyDashboardVisible(dashboardName);

    await pm.dashboardFavorites.selectDashboard(dashboardName);
    await pm.dashboardFavorites.bulkDeleteSelected();

    // Positive check: the delete actually succeeded server-side, not just
    // that the row disappeared from an optimistic UI update.
    await pm.dashboardFavorites.verifySuccessToast();
    await pm.dashboardFavorites.verifyNoErrorToast();
    await pm.dashboardFavorites.verifyDashboardNotPresent(dashboardName);
  });

  // Regression: nothing pruned the favorites setting on delete, so the row kept
  // rendering from its stored label and any action on it hit a dead id.
  test("should drop a deleted dashboard from Favorites automatically", async ({
    page,
  }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    // Delete it from the folder it actually lives in.
    await pm.dashboardFavorites.deleteDashboardFromRow(dashboardName);
    await pm.dashboardFavorites.verifySuccessToast();
    await pm.dashboardFavorites.verifyDashboardNotPresent(dashboardName);

    // Favorites must not keep a ghost row for it.
    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.verifyDashboardNotPresent(dashboardName);
  });

  // Regression: bulk delete never updated the cached folder lists, and folder
  // navigation is cache-first, so the deleted dashboard reappeared in its
  // source folder until a manual refresh.
  test("should not leave a deleted dashboard in its source folder after a bulk delete from Favorites", async ({
    page,
  }) => {
    await pm.dashboardFavorites.searchDashboard(dashboardName);
    await pm.dashboardFavorites.addToFavorites(dashboardName);

    await pm.dashboardFavorites.openFavoritesFolder();
    await pm.dashboardFavorites.selectDashboard(dashboardName);
    await pm.dashboardFavorites.bulkDeleteSelected();
    await pm.dashboardFavorites.verifySuccessToast();
    await pm.dashboardFavorites.verifyNoErrorToast();

    // Navigate back to the source folder WITHOUT reloading — a reload would
    // refetch and mask the stale-cache bug this test exists to catch.
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.openFolderByName(folderName);
    await pm.dashboardFavorites.verifyDashboardNotPresent(dashboardName);
  });

  test.afterEach(async ({ page }) => {
    // Best-effort cleanup: the folder may already be gone if the test deleted
    // its dashboard, and a failing test should surface its own error rather
    // than a teardown error.
    await pm.dashboardFolder.deleteFolder(folderName).catch(() => {});
  });
});
