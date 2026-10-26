/**
 * Dashboard panel editor — "unsaved changes" guard (PR #14806, issue #7454).
 *
 * The editor used to flag ANY deep mutation of dashboardPanelData.data after
 * mount as a user edit, so load-time effects (defaults, stream auto-select)
 * produced a confirm dialog on leave even when nothing was touched. It now
 * snapshots a baseline on the user's FIRST pointer/key event and compares
 * against it on leave, so pre-input mutations and reverted edits do not warn.
 *
 * Leaving with real edits opens the in-app "Leave with unsaved changes?" dialog
 * (Save / Keep draft / Discard). Edits are also autosaved as a browser draft,
 * which the editor offers back in its "Unsaved panel draft" dialog.
 *
 * Each test owns its dashboard and deletes it in afterEach.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
import PageManager from "../../pages/page-manager.js";
import {
  PANEL_DRAFT_RESTORE_DIALOG,
  answerPanelDraftRestore,
  answerPanelLeaveIfShown,
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

const uniqueSuffix = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Record every native dialog raised while the returned watcher is installed.
 * Dismissing (the default) makes a regression fail twice over: the message is
 * recorded AND the cancelled confirm blocks the navigation the test awaits.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{accept?: boolean}} options
 */
function captureDialogs(page, { accept = false } = {}) {
  const messages = [];
  const handler = (dialog) => {
    messages.push(dialog.message());
    (accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
  };
  page.on("dialog", handler);
  return { messages, dispose: () => page.off("dialog", handler) };
}

/**
 * Wait until the panel editor has finished its own load-time work. Interacting
 * before this settles would arm the baseline mid-load, which is precisely the
 * state the fix classifies as "not a user edit".
 */
async function waitForEditorSettled(page, pm) {
  await pm.dashboardPanelActions
    .getPanelSaveBtn()
    .waitFor({ state: "visible", timeout: 30000 });
  await pm.dashboardPanelActions
    .getFieldListSearchInput()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  await safeWaitForNetworkIdle(page, { timeout: 10000 });
}

/** Create a dashboard holding one saved line panel, ending on the dashboard view. */
async function createDashboardWithPanel(page, pm, panelName) {
  const dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
  await setupTestDashboard(page, pm, dashboardName);
  await addSimplePanel(pm, panelName);
  await pm.dashboardPanelActions
    .getPanelBar()
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  return dashboardName;
}

/** Reopen a saved panel in edit mode and wait for the editor to settle. */
async function openSavedPanelEditor(page, pm, panelName) {
  await pm.dashboardPanelEdit.editPanel(panelName);
  await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
  await waitForEditorSettled(page, pm);
}

/** Click Discard and assert the editor closed without ever asking to confirm. */
async function expectDiscardWithoutPrompt(page, pm) {
  const watcher = captureDialogs(page);
  try {
    await pm.dashboardPanelActions.getPanelDiscardBtn().click();
    await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });
  } finally {
    watcher.dispose();
  }
  expect(
    watcher.messages,
    "leaving the panel editor must not warn about changes the user did not make"
  ).toEqual([]);
}

/** Click Discard, answer the in-app leave dialog, and assert no native dialog fired. */
async function expectDiscardAsksInApp(page, pm, choice = "discard") {
  const watcher = captureDialogs(page);
  let asked;
  try {
    await pm.dashboardPanelActions.getPanelDiscardBtn().click();
    asked = await settlePanelLeave(page, { choice });
  } finally {
    watcher.dispose();
  }
  expect(asked, "a real edit must open the in-app leave dialog").toBe(true);
  expect(watcher.messages, "the panel editor never asks natively on in-app navigation").toEqual([]);
}

/** Build a new panel without saving it, ending in the editor with edits. */
async function startNewPanelWithEdits(page, pm, panelName) {
  await addSimplePanel(pm, panelName, { save: false });
  await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
}

/** Leave the editor through Discard → "Keep draft". */
async function keepNewPanelAsDraft(page, pm) {
  await expectDiscardAsksInApp(page, pm, "keep");
}

/** Open Add Panel from the dashboard view and wait for the editor to settle. */
async function openAddPanel(page, pm, { hasPanels = false } = {}) {
  if (hasPanels) await pm.dashboardCreate.addPanelToExistingDashboard();
  else await pm.dashboardCreate.addPanel();
  await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
  await waitForEditorSettled(page, pm);
}

/** Return to the dashboard list and delete the test dashboard. */
async function removeDashboard(page, dashboardName) {
  page.once("dialog", (dialog) => dialog.accept().catch(() => {}));
  const org = (process.env.ORGNAME || "").trim();
  await page
    .goto(`${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}`, {
      timeout: 30000,
    })
    .catch(() => {});
  await waitForDashboardPage(page).catch(() => {});
  await deleteDashboard(page, dashboardName);
}

/**
 * Best-effort teardown under a hard budget. A stalled deployment must not fail
 * a test whose assertions already passed, so an overrun is logged and dropped
 * rather than left to burn the whole afterEach timeout.
 */
async function cleanupDashboard(page, dashboardName) {
  if (!dashboardName) return;
  const warn = (error) =>
    testLogger.warn("Cleanup failed for test dashboard", { dashboardName, error });

  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => {
      warn(`exceeded the ${CLEANUP_BUDGET_MS}ms cleanup budget`);
      resolve();
    }, CLEANUP_BUDGET_MS);
  });

  await Promise.race([
    removeDashboard(page, dashboardName).catch((e) => warn(e.message)),
    budget,
  ]);
  clearTimeout(timer);
}

test.describe("Dashboard panel editor unsaved-changes guard", () => {
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
    "reopening a saved panel and discarding without edits does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Editor closed with no confirm after a no-op edit session");
    }
  );

  test(
    "interacting without changing panel data does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);

      // Searching the field list arms the baseline (pointerdown + keydown) while
      // leaving dashboardPanelData.data untouched.
      const fieldSearch = pm.dashboardPanelActions.getFieldListSearchInput();
      await fieldSearch.click();
      await fieldSearch.fill("kubernetes");
      await fieldSearch.fill("");

      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Non-mutating interaction did not arm the unsaved warning");
    }
  );

  test(
    "discarding a real edit still warns and leaves the editor on accept",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "b");

      await expectDiscardAsksInApp(page, pm);
      testLogger.info("Real edit opened the in-app leave dialog");
    }
  );

  test(
    "reverting an edit back to its original value does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await pm.dashboardPanelActions.addPanelName(`${panelName}_edited`);
      await pm.dashboardPanelActions.addPanelName(panelName);
      await expect(pm.dashboardPanelActions.panelNameInput).toHaveValue(panelName);

      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Reverted edit did not raise the unsaved-changes confirm");
    }
  );

  test(
    "opening a brand-new panel editor and discarding immediately does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);

      await pm.dashboardCreate.addPanel();
      await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
      await waitForEditorSettled(page, pm);

      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Fresh editor closed without a confirm");
    }
  );

  test(
    "saving an edited panel leaves the editor without warning",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      const renamed = `${panelName}_saved`;
      await pm.dashboardPanelActions.addPanelName(renamed);

      const watcher = captureDialogs(page);
      try {
        await pm.dashboardPanelActions.savePanel();
        await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });
      } finally {
        watcher.dispose();
      }

      expect(
        watcher.messages,
        "saving commits the edit, so leaving the editor must not warn"
      ).toEqual([]);
      await expect(
        pm.dashboardPanelActions.getEditPanelDropdown(renamed)
      ).toBeVisible({ timeout: 30000 });
      testLogger.info("Save navigated away with no confirm", { renamed });
    }
  );

  test(
    "drilldown config tooltip reads 'Navigate to another dashboard'",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P2"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await pm.dashboardPanelConfigs.openConfigPanel();

      const tooltip = await pm.dashboardPanelConfigs.hoverDrilldownInfoForTooltip();
      await expect(tooltip).toContainText("Navigate to another dashboard");
      expect(
        await tooltip.innerText(),
        "the drilldown tooltip must not regress to the 'a another' typo"
      ).not.toContain("a another");

      await pm.dashboardPanelActions.discardPanel();
      testLogger.info("Drilldown tooltip copy verified");
    }
  );

  test(
    "a new panel kept as a draft is offered back and saves after Continue",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("draft");

      await startNewPanelWithEdits(page, pm, panelName);
      await keepNewPanelAsDraft(page, pm);
      await expect(page.locator('[data-test="dashboard-panel-add-draft-dot"]')).toBeVisible({
        timeout: 15000,
      });

      await openAddPanel(page, pm);
      await expect(page.locator(PANEL_DRAFT_RESTORE_DIALOG)).toContainText(
        "You have unsaved changes from",
        { timeout: 15000 }
      );
      expect(await answerPanelDraftRestore(page, { choice: "continue" })).toBe(true);

      await pm.dashboardPanelActions.savePanel();
      await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
        timeout: 30000,
      });
      await expect(page.locator('[data-test="dashboard-panel-add-draft-dot"]')).toHaveCount(0);

      // Saving cleared the draft, so the next Add Panel starts clean.
      await openAddPanel(page, pm, { hasPanels: true });
      await expect(page.locator(PANEL_DRAFT_RESTORE_DIALOG)).toHaveCount(0);
      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Draft kept, continued and saved", { panelName });
    }
  );

  test(
    "Start fresh deletes the kept draft",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("draft");

      await startNewPanelWithEdits(page, pm, panelName);
      await keepNewPanelAsDraft(page, pm);

      await openAddPanel(page, pm);
      expect(await answerPanelDraftRestore(page, { choice: "fresh" })).toBe(true);
      await expectDiscardWithoutPrompt(page, pm);

      await openAddPanel(page, pm);
      await expect(page.locator(PANEL_DRAFT_RESTORE_DIALOG)).toHaveCount(0);
      await expectDiscardWithoutPrompt(page, pm);
      testLogger.info("Start fresh removed the draft");
    }
  );

  test(
    "browser Back with edits asks in-app before leaving",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("draft");

      await startNewPanelWithEdits(page, pm, panelName);

      const watcher = captureDialogs(page);
      let asked;
      try {
        await page.goBack();
        // The URL already shows the dashboard while the guard awaits the dialog, so wait on the dialog, not the URL.
        asked = await answerPanelLeaveIfShown(page, { choice: "discard", timeout: 15000 });
      } finally {
        watcher.dispose();
      }
      expect(asked, "browser Back with edits opens the leave dialog").toBe(true);
      expect(watcher.messages, "browser Back never raises a native confirm").toEqual([]);
      await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });

      await openAddPanel(page, pm);
      await expect(page.locator(PANEL_DRAFT_RESTORE_DIALOG)).toHaveCount(0);
      testLogger.info("Browser Back asked in-app and Discard left no draft");
    }
  );

  test(
    "Save and keep editing saves a new panel and stays in the editor",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("stay");

      await startNewPanelWithEdits(page, pm, panelName);
      await pm.dashboardPanelActions.saveAndKeepEditing();
      await expect(page).toHaveURL(/add_panel/);

      // Saved and unchanged since, so leaving does not ask.
      await expectDiscardWithoutPrompt(page, pm);
      await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
        timeout: 30000,
      });
      testLogger.info("Save and keep editing stayed in the editor", { panelName });
    }
  );
});
