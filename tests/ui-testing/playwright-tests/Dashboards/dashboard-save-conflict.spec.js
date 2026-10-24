/**
 * Dashboard save-conflict resolution (HTTP 409) — the shared app-level dialog
 * (`DashboardSaveConflictDialog`) offering Reload, Overwrite and (panel-editor
 * only) Merge, plus the "Not saved" banner that stays after an unresolved close.
 *
 * The "second actor" is a dashboard PUT that carries the current hash (see
 * `utils/dashboardConflictHelpers.js`), which advances the server version so the
 * first actor's stale-hash save returns 409.
 *
 * Each test owns its dashboard and deletes it via API in afterEach.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import PageManager from "../../pages/page-manager.js";
import { ingestion } from "./utils/dashIngestion.js";
import { setupTestDashboard, addSimplePanel } from "./utils/dashCreation.js";
import {
  getDashboardFromUrl,
  secondActorRenameTitle,
  secondActorTouchPanel,
  triggerPanelEditorConflict,
  uniqueSuffix,
} from "./utils/dashboardConflictHelpers.js";

const SECOND_ACTOR_TITLE = "Conflict_SecondActor";

test.describe("Dashboard save conflict resolution", () => {
  test.describe.configure({ mode: "parallel" });
  test.describe.configure({ retries: 1 });

  let pm;
  let dashboardRef;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    dashboardRef = null;
  });

  test.afterEach(async () => {
    if (!pm || !dashboardRef?.dashboardId) return;
    await pm.apiCleanup
      .deleteDashboard(dashboardRef.dashboardId, dashboardRef.folder || "default")
      .catch(() => {});
  });

  test(
    "save conflict opens the dialog and Reload discards my edit",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;
      await triggerPanelEditorConflict(page, pm, {
        panelName,
        renamedName: `${panelName}_edited`,
        secondActor: () => secondActorRenameTitle(pm.apiCleanup, dashboardId, folder, SECOND_ACTOR_TITLE),
      });

      await conflict.expectDialogVisible();
      await conflict.expectMainStepVisible();
      await conflict.clickReload();

      await conflict.expectDialogHidden();
      await expect(pm.dashboardPage.dashboardNameTitle).toContainText(SECOND_ACTOR_TITLE, {
        timeout: 30000,
      });
      // The pending edit was a panel rename that was never saved: after Reload
      // the panel still carries its original name and the edited name is gone.
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
        timeout: 30000,
      });
      await expect(
        pm.dashboardPanelActions.getEditPanelDropdown(`${panelName}_edited`)
      ).toBeHidden({ timeout: 15000 });
      await conflict.expectUnsavedBannerHidden();
      testLogger.info("Reload discarded the pending edit and adopted the latest version");
    }
  );

  test(
    "Overwrite replaces their change after the impact confirmation",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;
      const renamed = `${panelName}_overwritten`;
      await triggerPanelEditorConflict(page, pm, {
        panelName,
        renamedName: renamed,
        secondActor: () => secondActorRenameTitle(pm.apiCleanup, dashboardId, folder, SECOND_ACTOR_TITLE),
      });

      await conflict.expectMainStepVisible();
      await conflict.clickOverwrite();
      await conflict.expectConfirmStepVisible();
      await conflict.clickConfirmOverwrite();

      await conflict.expectDialogHidden();
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(renamed)).toBeVisible({
        timeout: 30000,
      });
      await expect(pm.dashboardPage.dashboardNameTitle).toContainText(dashboardName, {
        timeout: 30000,
      });
      await conflict.expectUnsavedBannerHidden();
      testLogger.info("Overwrite persisted my edit and reverted the second actor's title change");
    }
  );

  test(
    "Merge applies my panel onto their latest version when the panel was untouched",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;
      const renamed = `${panelName}_merged`;
      await triggerPanelEditorConflict(page, pm, {
        panelName,
        renamedName: renamed,
        secondActor: () => secondActorRenameTitle(pm.apiCleanup, dashboardId, folder, SECOND_ACTOR_TITLE),
      });

      await conflict.expectMainStepVisible();
      await conflict.expectPanelUntouchedVisible();
      await conflict.expectMergeVisible();
      await conflict.clickMerge();
      await conflict.expectReviewStepVisible();
      await conflict.expectMergedRowsVisible();
      await conflict.clickSaveMerged();

      await conflict.expectDialogHidden();
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(renamed)).toBeVisible({
        timeout: 30000,
      });
      await expect(pm.dashboardPage.dashboardNameTitle).toContainText(SECOND_ACTOR_TITLE, {
        timeout: 30000,
      });
      testLogger.info("Merge applied my panel edit onto the second actor's latest version");
    }
  );

  test(
    "closing without resolving leaves the Not saved banner and Resolve reopens the dialog",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;

      // The banner only renders on the dashboard view, so trigger the conflict from the layout-edit save that stays on it.
      await pm.dashboardPanelActions.enterLayoutEdit();
      await pm.dashboardPanelActions.applyPanelHeight(panelName, 14);
      await secondActorRenameTitle(pm.apiCleanup, dashboardId, folder, SECOND_ACTOR_TITLE);
      await pm.dashboardPanelActions.layoutEditSaveBtn.click();

      await conflict.expectMainStepVisible();
      await conflict.close();
      await conflict.expectDialogHidden();
      await conflict.expectUnsavedBannerVisible();
      await conflict.clickResolve();

      await conflict.expectDialogVisible();
      await conflict.expectMainStepVisible();
      await conflict.expectReloadVisible();
      await conflict.expectOverwriteVisible();
      testLogger.info("Closing left the banner; Resolve reopened the dialog with the same choices");
    }
  );

  test(
    "Merge is hidden and a compare grid shows when the other actor touched my panel",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P2"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;
      const renamed = `${panelName}_touched`;

      await pm.dashboardPanelEdit.editPanel(panelName);
      await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
      const panelId = getDashboardFromUrl(page).panelId;
      await pm.dashboardPanelActions.addPanelName(renamed);

      await secondActorTouchPanel(pm.apiCleanup, dashboardId, folder, panelId, (panel) => {
        panel.title = `${panelName}_theirs`;
      });
      await pm.dashboardPanelActions.getPanelSaveBtn().click();

      await conflict.expectMainStepVisible();
      await conflict.expectPanelTouchedVisible();
      await conflict.expectPanelCompareVisible();
      await conflict.expectMergeHidden();
      testLogger.info("Same-panel conflict hid Merge and showed the compare grid");
    }
  );

  test(
    "a non-panel save offers only Reload and Overwrite with no Merge",
    { tag: ["@dashboard-save-conflict", "@all", "@dashboards", "@P2"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      const dashboardName = `save_conflict_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, panelName);
      dashboardRef = getDashboardFromUrl(page);
      const { dashboardId, folder } = dashboardRef;

      const conflict = pm.dashboardSaveConflict;

      await pm.dashboardPanelActions.enterLayoutEdit();
      await pm.dashboardPanelActions.applyPanelHeight(panelName, 14);

      await secondActorRenameTitle(pm.apiCleanup, dashboardId, folder, SECOND_ACTOR_TITLE);

      await pm.dashboardPanelActions.layoutEditSaveBtn.click();

      await conflict.expectMainStepVisible();
      await conflict.expectMergeHidden();
      await conflict.expectReloadVisible();
      await conflict.expectOverwriteVisible();
      testLogger.info("Non-panel save offered only Reload/Overwrite");
    }
  );
});
