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

const UNSAVED_MESSAGE = "You have unsaved changes. Are you sure you want to leave?";

const CLEANUP_BUDGET_MS = 90000;

const FIELD_SEARCH_INPUT = '[data-test="o-field-list-search-field"]';
const DRILLDOWN_INFO_ICON = '[data-test="dashboard-addpanel-config-drilldown-info"]';
const TOOLTIP_CONTENT = '[data-test="o-tooltip-content"]';

const uniqueSuffix = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// PanelEditor.vue mounts ConfigPanel and the field list twice (one branch per
// layout), so every data-test inside them matches 2 nodes and a bare locator
// trips strict mode. Only the branch for the current breakpoint is visible.
const visibleFirst = (page, selector) =>
  page.locator(`${selector} >> visible=true`).first();

/**
 * Hover whichever copy of `selector` actually produces a tooltip. The dormant
 * layout branch still satisfies `visible=true` but is parked off-viewport, so
 * hovering it silently never opens the bubble — only the rendered bubble proves
 * the right copy was hit.
 */
async function hoverForTooltip(page, selector) {
  const candidates = page.locator(selector);
  const total = await candidates.count();
  for (let i = 0; i < total; i++) {
    try {
      await candidates.nth(i).hover({ timeout: 5000 });
      const tooltip = visibleFirst(page, TOOLTIP_CONTENT);
      await tooltip.waitFor({ state: "visible", timeout: 5000 });
      return tooltip;
    } catch {
      // Dormant layout branch — try the next copy.
    }
  }
  throw new Error(
    `hoverForTooltip("${selector}"): none of the ${total} matches opened a tooltip`
  );
}

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
  await visibleFirst(page, FIELD_SEARCH_INPUT)
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  await safeWaitForNetworkIdle(page, { timeout: 10000 });
}

/** Create a dashboard holding one saved line panel, ending on the dashboard view. */
async function createDashboardWithPanel(page, pm, panelName) {
  const dashboardName = `Dashboard_Unsaved_${uniqueSuffix()}`;
  await setupTestDashboard(page, pm, dashboardName);
  await addSimplePanel(pm, panelName);
  await page
    .locator('[data-test="dashboard-panel-bar"]')
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
async function discardExpectingNoPrompt(page, pm) {
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

/** Click Discard, accept the expected confirm, and return the dialog messages. */
async function discardExpectingPrompt(page, pm) {
  const watcher = captureDialogs(page, { accept: true });
  try {
    await pm.dashboardPanelActions.getPanelDiscardBtn().click();
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
    "reopening a saved panel and discarding without edits does not warn",
    { tag: ["@dashboard-panel-unsaved-changes", "@all", "@dashboards", "@P0"] },
    async ({ page }) => {
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("unsaved");
      dashboardName = await createDashboardWithPanel(page, pm, panelName);

      await openSavedPanelEditor(page, pm, panelName);
      await discardExpectingNoPrompt(page, pm);
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
      const fieldSearch = visibleFirst(page, FIELD_SEARCH_INPUT);
      await fieldSearch.click();
      await fieldSearch.fill("kubernetes");
      await fieldSearch.fill("");

      await discardExpectingNoPrompt(page, pm);
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

      const messages = await discardExpectingPrompt(page, pm);
      expect(
        messages,
        "an actual panel edit must still raise the unsaved-changes confirm"
      ).toContain(UNSAVED_MESSAGE);
      testLogger.info("Real edit raised the unsaved-changes confirm");
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

      await discardExpectingNoPrompt(page, pm);
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

      await discardExpectingNoPrompt(page, pm);
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
        page.locator(`[data-test="dashboard-edit-panel-${renamed}-dropdown"]`)
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

      const tooltip = await hoverForTooltip(page, DRILLDOWN_INFO_ICON);
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
