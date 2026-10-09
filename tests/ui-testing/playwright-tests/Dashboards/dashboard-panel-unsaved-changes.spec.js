/**
 * Dashboard panel editor — "unsaved changes" guard (PR #14806, issue #7454).
 *
 * The editor used to flag ANY deep mutation of dashboardPanelData.data after
 * mount as a user edit, so load-time effects (defaults, stream auto-select)
 * produced a confirm dialog on leave even when nothing was touched. It now
 * snapshots a baseline on the user's FIRST pointer/key event and compares
 * against it on leave, so pre-input mutations and reverted edits do not warn.
 *
 * Each test owns its dashboard and deletes it in afterEach.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
import PageManager from "../../pages/page-manager.js";
import { ingestion } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
  addSimplePanel,
  setupTestDashboard,
} from "./utils/dashCreation.js";

const LEAVE_TITLE = "Leave without saving?";

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

const leaveDialog = (page) => page.locator('[data-test="confirm-dialog"]');

/** Click Back and assert the editor closed without the leave dialog or a native confirm. */
async function expectLeaveWithoutPrompt(page) {
  const watcher = captureDialogs(page);
  try {
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });
  } finally {
    watcher.dispose();
  }
  expect(
    watcher.messages,
    "leaving the panel editor must not warn about changes the user did not make"
  ).toEqual([]);
}

/** Click Back, answer the O2 leave dialog with Leave, and return any native dialog messages. */
async function expectLeavePrompts(page) {
  const watcher = captureDialogs(page);
  try {
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await expect(leaveDialog(page)).toBeVisible({ timeout: 15000 });
    await expect(leaveDialog(page)).toContainText(LEAVE_TITLE);
    await leaveDialog(page).locator('[data-test="o-dialog-primary-btn"]').click();
    await page.waitForURL((url) => !url.pathname.includes("add_panel"), { timeout: 30000 });
  } finally {
    watcher.dispose();
  }
  return watcher.messages;
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
    "reopening a saved panel and leaving without edits does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await expectLeaveWithoutPrompt(page);
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

      await expectLeaveWithoutPrompt(page);
      testLogger.info("Non-mutating interaction did not arm the unsaved warning");
    }
  );

  test(
    "leaving after a real edit asks with the O2 dialog, never window.confirm, and leaves on Leave",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "b");

      const messages = await expectLeavePrompts(page);
      expect(messages, "the leave prompt is the O2 ConfirmDialog, not window.confirm").toEqual([]);
      testLogger.info("Real edit raised the leave dialog");
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

      await expectLeaveWithoutPrompt(page);
      testLogger.info("Reverted edit did not raise the unsaved-changes confirm");
    }
  );

  test(
    "opening a brand-new panel editor and leaving immediately does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P1"] },
    async ({ page }) => {
      dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
      await setupTestDashboard(page, pm, dashboardName);

      await pm.dashboardCreate.addPanel();
      await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
      await waitForEditorSettled(page, pm);

      await expectLeaveWithoutPrompt(page);
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
});
