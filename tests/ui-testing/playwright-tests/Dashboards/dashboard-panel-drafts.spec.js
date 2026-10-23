// Panel draft flows (PR #15384) that dashboard-panel-unsaved-changes.spec.js does not cover.

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import PageManager from "../../pages/page-manager.js";
import {
  answerPanelDraftRestore,
  countStoredPanelDrafts,
  dismissPanelDraftRestore,
  dismissPanelLeave,
  getAddPanelDraftDot,
  getEditPanelDraftDot,
  getPanelDraftChangedOnServerBanner,
  getPanelDraftDot,
  getPanelDraftRestoreDialog,
  getPanelLeaveDialog,
  markStoredDraftsAsStale,
  settlePanelLeave,
} from "../../pages/dashboardPages/panel-leave-dialog.js";
import { ingestion } from "./utils/dashIngestion.js";
import {
  cleanupDashboardWithinBudget,
  waitForPanelEditorSettled,
  addSimplePanel,
  setupTestDashboard,
} from "./utils/dashCreation.js";
import {
  createDashboardWithPanel,
  editSavedPanel,
  isInPanelEditor,
  leaveEditor,
  openSavedPanelEditor,
  uniqueDashboardName,
} from "./utils/dashPanelDrafts.js";

test.describe("Dashboard panel drafts", () => {
  test.describe.configure({ mode: "parallel" });
  test.describe.configure({ retries: 1 });

  let pm;
  let dashboardName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    dashboardName = null;
  });

  test.afterEach(async ({ page }) => {
    await cleanupDashboardWithinBudget(page, dashboardName);
  });

  test(
    "a saved panel's kept draft shows its dots and Continue restores the edit",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("draft");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);
      await leaveEditor(page, pm, "keep");

      await expect(getPanelDraftDot(page)).toBeVisible({ timeout: 15000 });
      await expect(getAddPanelDraftDot(page)).toHaveCount(0);
      await pm.dashboardPanelActions.getEditPanelDropdown(panelName).click();
      await expect(getEditPanelDraftDot(page)).toBeVisible({ timeout: 10000 });
      await page.keyboard.press("Escape");

      await openSavedPanelEditor(page, pm, panelName);
      await expect(getPanelDraftRestoreDialog(page)).toContainText("You have unsaved changes from", {
        timeout: 15000,
      });
      await expect(getPanelDraftChangedOnServerBanner(page)).toHaveCount(0);
      expect(await answerPanelDraftRestore(page, { choice: "continue" })).toBe(true);
      await expect(pm.chartTypeSelector.getBreakdownItem(1).first()).toBeAttached({
        timeout: 15000,
      });

      await pm.dashboardPanelActions.savePanel();
      await page.waitForURL((url) => !isInPanelEditor(url), { timeout: 30000 });
      await expect(getPanelDraftDot(page)).toHaveCount(0);
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Saved-panel draft continued and saved", { panelName });
    }
  );

  test(
    "an autosaved draft survives a page reload",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("reload");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);

      // Reload still raises the browser's beforeunload prompt; accepting it lets the reload go through.
      const acceptUnload = (dialog) => dialog.accept().catch(() => {});
      page.on("dialog", acceptUnload);
      try {
        await page.reload();
      } finally {
        page.off("dialog", acceptUnload);
      }

      await expect(getPanelDraftRestoreDialog(page)).toBeVisible({ timeout: 30000 });
      expect(await answerPanelDraftRestore(page, { choice: "continue" })).toBe(true);
      await expect(pm.chartTypeSelector.getBreakdownItem(1).first()).toBeAttached({
        timeout: 15000,
      });

      await leaveEditor(page, pm, "discard");
      await expect(getPanelDraftDot(page)).toHaveCount(0);
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Autosaved draft was offered after reload", { panelName });
    }
  );

  test(
    "Save in the leave dialog saves a new panel and leaves no draft",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = uniqueDashboardName("Dashboard_Drafts");
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("leavesave");

      await addSimplePanel(pm, panelName, { save: false });
      await page.waitForURL(isInPanelEditor, { timeout: 30000 });
      await leaveEditor(page, pm, "save");

      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
        timeout: 30000,
      });
      await expect(getAddPanelDraftDot(page)).toHaveCount(0);
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Leave dialog Save persisted the panel", { panelName });
    }
  );

  test(
    "Escape on the leave dialog keeps the editor open with its edits",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("stay");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);
      await pm.dashboardPanelActions.getPanelDiscardBtn().click();
      await dismissPanelLeave(page);

      await expect(page).toHaveURL(/add_panel/);
      await expect(getPanelLeaveDialog(page)).toHaveCount(0);
      await expect(pm.chartTypeSelector.getBreakdownItem(1).first()).toBeAttached();

      await leaveEditor(page, pm, "discard");
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Escape on the leave dialog stayed in the editor", { panelName });
    }
  );

  test(
    "Escape on the restore dialog opens the editor fresh but keeps the draft",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("escape");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);
      await leaveEditor(page, pm, "keep");
      await expect(getPanelDraftDot(page)).toBeVisible({ timeout: 15000 });

      await openSavedPanelEditor(page, pm, panelName);
      await dismissPanelDraftRestore(page);
      await waitForPanelEditorSettled(page, pm);
      await expect(pm.chartTypeSelector.getBreakdownItem(1)).toHaveCount(0);

      // Nothing was edited this session, so leaving does not ask and the kept draft survives.
      await pm.dashboardPanelActions.getPanelDiscardBtn().click();
      expect(await settlePanelLeave(page)).toBe(false);
      await expect(getPanelDraftDot(page)).toBeVisible({ timeout: 15000 });
      expect(await countStoredPanelDrafts(page)).toBe(1);

      await openSavedPanelEditor(page, pm, panelName);
      expect(await answerPanelDraftRestore(page, { choice: "fresh" })).toBe(true);
      testLogger.info("Escape kept the stored draft", { panelName });
    }
  );

  test(
    "Ctrl/Cmd+S saves a new panel and keeps the editor open",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = uniqueDashboardName("Dashboard_Drafts");
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("shortcut");

      await addSimplePanel(pm, panelName, { save: false });
      await page.waitForURL(isInPanelEditor, { timeout: 30000 });
      await pm.dashboardPanelActions.saveAndKeepEditingWithShortcut();
      await expect(page).toHaveURL(/add_panel.*panelId=/);

      await pm.dashboardPanelActions.getPanelDiscardBtn().click();
      expect(await settlePanelLeave(page), "a just-saved panel leaves without asking").toBe(false);
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
        timeout: 30000,
      });
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Shortcut saved and stayed", { panelName });
    }
  );

  test(
    "the restore dialog warns when the panel changed after the draft",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P2"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("conflict");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);
      await leaveEditor(page, pm, "keep");
      expect(await markStoredDraftsAsStale(page)).toBe(1);

      await openSavedPanelEditor(page, pm, panelName);
      await expect(getPanelDraftChangedOnServerBanner(page)).toContainText(
        "This panel was changed after your draft was saved",
        { timeout: 15000 }
      );
      expect(await answerPanelDraftRestore(page, { choice: "fresh" })).toBe(true);
      expect(await countStoredPanelDrafts(page)).toBe(0);
      testLogger.info("Changed-on-server warning shown", { panelName });
    }
  );

  test(
    "deleting a panel removes its draft",
    { tag: ["@dashboard-panel-drafts", "@all", "@dashboards", "@P2"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("delete");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await editSavedPanel(page, pm, panelName);
      await leaveEditor(page, pm, "keep");
      await expect(getPanelDraftDot(page)).toBeVisible({ timeout: 15000 });

      await pm.dashboardPanelEdit.deletePanel(panelName);
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toHaveCount(0, {
        timeout: 15000,
      });
      await expect.poll(() => countStoredPanelDrafts(page), { timeout: 10000 }).toBe(0);
      testLogger.info("Panel delete cleared its draft", { panelName });
    }
  );
});
