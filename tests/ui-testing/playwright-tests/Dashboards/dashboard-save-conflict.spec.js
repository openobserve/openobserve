// Dashboard save conflicts (PR #15272, o2-enterprise#2875): a save that loses to another user's save must not lose either edit.
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
const {
  createConflictDashboard,
  getServerDashboard,
  otherUserSaves,
  removePanelOnServer,
  panelTitlesOf,
  tabNamesOf,
} = require("./utils/saveConflictApi.js");

test.describe.configure({ mode: "parallel" });

const PANELS = ["Errors", "Latency", "Disk"];

const uniqueTitle = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

test.describe("Dashboard save conflict", () => {
  let pm;
  let dashboardId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    dashboardId = null;
  });

  test.afterEach(async () => {
    if (dashboardId) await pm.apiCleanup.deleteDashboard(dashboardId, "default");
  });

  const serverPanels = async () => panelTitlesOf((await getServerDashboard(pm.apiCleanup, dashboardId)).dashboard);

  test(
    "deleting a panel after someone else saved opens the conflict dialog and keeps the edit when closed",
    { tag: ["@dashboardSaveConflict", "@smoke", "@P0", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await removePanelOnServer(pm.apiCleanup, dashboardId, "Latency");

      await conflict.deletePanel("Errors");
      await conflict.waitForDialog();
      await expect(conflict.myChange).toContainText("Errors");
      await expect(conflict.changeRow("panel", "removed")).toContainText("Latency");
      await expect(conflict.savedBy).toBeVisible();

      await conflict.close();
      await expect(conflict.unsavedBanner).toBeVisible();
      await expect(conflict.unsavedBanner).toContainText("Errors");
      expect(await conflict.visiblePanelTitles()).toEqual(["Latency", "Disk"]);
      expect(await serverPanels()).toEqual(["Errors", "Disk"]);

      await conflict.resolveFromBanner();
      await expect(conflict.myChange).toContainText("Errors");
    },
  );

  test(
    "Reload discards my edit, loads their version, and the next save succeeds",
    { tag: ["@dashboardSaveConflict", "@P0", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await removePanelOnServer(pm.apiCleanup, dashboardId, "Latency");

      await conflict.deletePanel("Errors");
      await conflict.waitForDialog();
      await conflict.reload();

      await expect(conflict.unsavedBanner).toBeHidden();
      await expect.poll(() => conflict.visiblePanelTitles()).toEqual(["Errors", "Disk"]);
      expect(await serverPanels()).toEqual(["Errors", "Disk"]);

      await conflict.deletePanel("Errors");
      await expect.poll(serverPanels, { timeout: 15000 }).toEqual(["Disk"]);
      await expect(conflict.dialog).toBeHidden();
    },
  );

  test(
    "Overwrite asks for confirmation and replaces their save with mine",
    { tag: ["@dashboardSaveConflict", "@P0", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await removePanelOnServer(pm.apiCleanup, dashboardId, "Latency");

      await conflict.deletePanel("Errors");
      await conflict.waitForDialog();
      const confirmText = await conflict.startOverwrite();
      expect(confirmText).toContain("Latency");

      await conflict.confirmOverwrite();
      await expect(conflict.unsavedBanner).toBeHidden();
      expect(await serverPanels()).toEqual(["Latency", "Disk"]);
      await expect.poll(() => conflict.visiblePanelTitles()).toEqual(["Latency", "Disk"]);
    },
  );

  test(
    "closing the dialog and deleting a second panel keeps both deletes on Overwrite (o2-enterprise#2875)",
    { tag: ["@dashboardSaveConflict", "@regression", "@P1", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await removePanelOnServer(pm.apiCleanup, dashboardId, "Latency");

      await conflict.deletePanel("Errors");
      await conflict.waitForDialog();
      await conflict.close();
      expect(await conflict.visiblePanelTitles()).toEqual(["Latency", "Disk"]);

      await conflict.deletePanel("Latency");
      await conflict.waitForDialog();
      await expect(conflict.stillUnresolvedNotice).toBeVisible();
      await expect(conflict.myChange).toContainText("Errors");
      await expect(conflict.myChange).toContainText("Latency");

      const confirmText = await conflict.startOverwrite();
      // Before the fix this promised to restore Latency, which I had just deleted.
      expect(confirmText).not.toContain("Latency");

      await conflict.confirmOverwrite();
      expect(await serverPanels()).toEqual(["Disk"]);
      await expect.poll(() => conflict.visiblePanelTitles()).toEqual(["Disk"]);
    },
  );

  test(
    "closing the dialog and adding a second tab keeps both tabs, and the confirmation matches what is saved (o2-enterprise#2875)",
    { tag: ["@dashboardSaveConflict", "@regression", "@P1", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS, {
        description: "original",
      });
      await conflict.openDashboard(dashboardId);

      await otherUserSaves(pm.apiCleanup, dashboardId, (d) => {
        d.description = "changed by B";
      });

      await conflict.addTab("TabA");
      await conflict.waitForDialog();
      await expect(conflict.changeRow("settings")).toBeVisible();
      await conflict.close();
      // Left open, its Save would add TabA a second time.
      await expect(conflict.addTabDialog).toBeHidden();
      await expect(conflict.unsavedBanner).toBeVisible();

      await conflict.addTab("TabB");
      await conflict.waitForDialog();
      await expect(conflict.myChange).toContainText("TabA");
      await expect(conflict.myChange).toContainText("TabB");

      const confirmText = await conflict.startOverwrite();
      expect(confirmText).toContain("description");
      await conflict.confirmOverwrite();

      const { dashboard } = await getServerDashboard(pm.apiCleanup, dashboardId);
      expect(tabNamesOf(dashboard)).toEqual(["Overview", "TabA", "TabB"]);
      expect(dashboard.description).toBe("original");
    },
  );

  test(
    "Merge from the panel editor keeps my panel edit and their changes to other panels",
    { tag: ["@dashboardSaveConflict", "@P1", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await conflict.openPanelEditor("Errors");

      await otherUserSaves(pm.apiCleanup, dashboardId, (d) => {
        d.tabs[0].panels.find((p) => p.title === "Disk").title = "Disk-B";
        d.variables.list.push({ name: "region", type: "constant", label: "region", value: "us", query_data: {}, options: [] });
      });

      await pm.dashboardPanelActions.addPanelName("Errors-mine");
      await conflict.clickPanelSave();
      await conflict.waitForDialog();
      await expect(conflict.panelUntouched).toBeVisible();
      await expect(conflict.changeRow("panel", "changed")).toContainText("Disk-B");
      await expect(conflict.changeRow("variable", "added")).toContainText("region");

      await conflict.merge();
      await expect(conflict.mergeReview).toContainText("Errors-mine");
      await expect(conflict.mergeReview).toContainText("Disk-B");
      await conflict.saveMerged();

      const { dashboard } = await getServerDashboard(pm.apiCleanup, dashboardId);
      expect(panelTitlesOf(dashboard)).toEqual(["Errors-mine", "Latency", "Disk-B"]);
      expect(dashboard.variables.list.map((v) => v.name)).toContain("region");
    },
  );

  test(
    "Merge is not offered when the other user changed the same panel",
    { tag: ["@dashboardSaveConflict", "@P1", "@all"] },
    async () => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);
      await conflict.openDashboard(dashboardId);

      await conflict.openPanelEditor("Errors");

      await otherUserSaves(pm.apiCleanup, dashboardId, (d) => {
        d.tabs[0].panels.find((p) => p.title === "Errors").title = "Errors-B";
      });

      await pm.dashboardPanelActions.addPanelName("Errors-mine");
      await conflict.clickPanelSave();
      await conflict.waitForDialog();
      await expect(conflict.panelTouched).toBeVisible();
      await expect(conflict.mergeBtn).toHaveCount(0);

      await conflict.reload();
      expect(await serverPanels()).toEqual(["Errors-B", "Latency", "Disk"]);
    },
  );

  test(
    "two users in separate browsers: the second user's Overwrite after closing the dialog saves exactly their screen",
    { tag: ["@dashboardSaveConflict", "@regression", "@P1", "@all"] },
    async ({ page, browser }) => {
      const conflict = pm.dashboardSaveConflict;
      dashboardId = await createConflictDashboard(pm.apiCleanup, uniqueTitle("SaveConflict"), PANELS);

      const contextB = await browser.newContext({
        storageState: await page.context().storageState(),
        viewport: { width: 1500, height: 1024 },
      });
      try {
        const pageB = await contextB.newPage();
        const conflictB = new PageManager(pageB).dashboardSaveConflict;
        await conflict.openDashboard(dashboardId);
        await conflictB.openDashboard(dashboardId);

        await conflictB.deletePanel("Latency");
        await expect.poll(serverPanels, { timeout: 15000 }).toEqual(["Errors", "Disk"]);

        await conflict.deletePanel("Errors");
        await conflict.waitForDialog();
        await conflict.close();
        await conflict.deletePanel("Latency");
        await conflict.waitForDialog();
        await conflict.startOverwrite();
        await conflict.confirmOverwrite();

        expect(await serverPanels()).toEqual(["Disk"]);
        await pageB.reload();
        await conflictB.waitForPanels();
        expect(await conflictB.visiblePanelTitles()).toEqual(["Disk"]);
      } finally {
        await contextB.close();
      }
    },
  );
});
