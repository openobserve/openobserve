// Copyright 2026 OpenObserve Inc.
// o2-enterprise#3127: pressing `x` while the Public links drawer had focus exported the dashboard behind it.
const { test, expect, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
import PageManager from "../../../pages/page-manager.js";
import { setupTestDashboard, cleanupTestDashboard } from "../../Dashboards/utils/dashCreation.js";
const testLogger = require("../../utils/test-logger.js");

test.describe("Dashboard page shortcuts behind a drawer (#3127)", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let dashboardName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    dashboardName = `e2e_3127_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await setupTestDashboard(page, pm, dashboardName);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await pm.dashboardShareExport.closePublicLinksPanel();
    await cleanupTestDashboard(page, pm, dashboardName);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("x does nothing while the Public links drawer has focus, and still exports once it closes", {
    tag: ["@bug-ent3127", "@P3", "@regression", "@dashboardRegression"],
  }, async ({ page }) => {
    await pm.dashboardShareExport.trackExportClicks();
    await pm.dashboardShareExport.openPublicLinksPanel();
    await pm.dashboardShareExport.focusPublicLinksPanelHeader();
    await expect.poll(() => pm.dashboardShareExport.isFocusOnPublicLinksPanelChrome(), {
      message: "precondition: focus must rest inside the drawer, not in a text field",
    }).toBe(true);

    await pm.dashboardShareExport.pressExportShortcut();
    expect(await pm.dashboardShareExport.getExportClickCount()).toBe(0);

    await pm.dashboardShareExport.closePublicLinksPanel();
    const download = page.waitForEvent("download", { timeout: 15000 });
    await pm.dashboardShareExport.pressExportShortcut();
    expect((await download).suggestedFilename()).toContain(dashboardName);
    expect(await pm.dashboardShareExport.getExportClickCount()).toBe(1);
  });
});
