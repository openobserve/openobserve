// Panel draft flows (PR #15384) that dashboard-panel-unsaved-changes.spec.js does not cover.

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
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
  waitForDashboardPage,
  deleteDashboard,
  addSimplePanel,
  setupTestDashboard,
} from "./utils/dashCreation.js";

const CLEANUP_BUDGET_MS = 90000;
const EDIT_FIELD = "kubernetes_namespace_name";

const uniqueSuffix = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const inEditor = (url) => url.pathname.includes("add_panel");

/** Wait until the panel editor has finished its load-time work, so the next input is a real edit. */
async function waitForEditorSettled(page, pm) {
  await pm.dashboardPanelActions.getPanelSaveBtn().waitFor({ state: "visible", timeout: 30000 });
  await pm.dashboardPanelActions
    .getFieldListSearchInput()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  await safeWaitForNetworkIdle(page, { timeout: 10000 });
}

/** Create a dashboard holding one saved line panel, ending on the dashboard view. */
async function createDashboardWithPanel(page, pm, panelName) {
  const name = `Dashboard_Drafts_${uniqueSuffix()}`;
  await setupTestDashboard(page, pm, name);
  await addSimplePanel(pm, panelName);
  await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
    timeout: 30000,
  });
  return name;
}

/** Open a saved panel's editor; answers nothing, so a restore dialog stays up. */
async function openSavedPanelEditor(page, pm, panelName) {
  await pm.dashboardPanelEdit.editPanel(panelName);
  await page.waitForURL(inEditor, { timeout: 30000 });
}

/** Open a saved panel, add a breakdown field, and wait for autosave to store the draft. */
async function editSavedPanel(page, pm, panelName) {
  await openSavedPanelEditor(page, pm, panelName);
  await waitForEditorSettled(page, pm);
  await pm.chartTypeSelector.searchAndAddField(EDIT_FIELD, "b");
  await expect.poll(() => countStoredPanelDrafts(page), { timeout: 15000 }).toBe(1);
}

/** Click Discard and finish leaving with the given leave-dialog choice. */
async function leaveEditor(page, pm, choice) {
  await pm.dashboardPanelActions.getPanelDiscardBtn().click();
  const asked = await settlePanelLeave(page, { choice });
  expect(asked, "leaving with edits opens the in-app leave dialog").toBe(true);
}

/** Return to the dashboard list and delete the test dashboard. */
async function removeDashboard(page, name) {
  page.once("dialog", (dialog) => dialog.accept().catch(() => {}));
  const org = (process.env.ORGNAME || "").trim();
  await page
    .goto(`${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}`, { timeout: 30000 })
    .catch(() => {});
  await waitForDashboardPage(page).catch(() => {});
  await deleteDashboard(page, name);
}

/** Best-effort teardown under a hard budget, so a slow deployment cannot fail a passed test. */
async function cleanupDashboard(page, name) {
  if (!name) return;
  const warn = (error) => testLogger.warn("Cleanup failed for test dashboard", { name, error });
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => {
      warn(`exceeded the ${CLEANUP_BUDGET_MS}ms cleanup budget`);
      resolve();
    }, CLEANUP_BUDGET_MS);
  });
  await Promise.race([removeDashboard(page, name).catch((e) => warn(e.message)), budget]);
  clearTimeout(timer);
}

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
    await cleanupDashboard(page, dashboardName);
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
      await page.waitForURL((url) => !inEditor(url), { timeout: 30000 });
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
      dashboardName = `Dashboard_Drafts_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("leavesave");

      await addSimplePanel(pm, panelName, { save: false });
      await page.waitForURL(inEditor, { timeout: 30000 });
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
      await waitForEditorSettled(page, pm);
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
      dashboardName = `Dashboard_Drafts_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("shortcut");

      await addSimplePanel(pm, panelName, { save: false });
      await page.waitForURL(inEditor, { timeout: 30000 });
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
