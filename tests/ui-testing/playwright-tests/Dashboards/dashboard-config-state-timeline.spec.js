const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupStateTimelinePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

// ConfigPanel's sentinel for an option left unset, which the select reports as its value.
const DEFAULT_VALUE = "__auto__";
// "Last 15 minutes" buckets by 10 s, and the seeded samples sit one bucket apart.
const BUCKET_MS = 10_000;
// The seeded stream has one row per host (st-host-a, st-host-b).
const HOST_ROWS = 2;

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — State Timeline Display", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test("display, sort and tooltip lead with a Default that names its value", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await setupStateTimelinePanelWithConfig(page, pm, dashboardName);
    await actions.waitForChartToRender();
    await actions.waitForStateTimelineLayout(HOST_ROWS);

    await configs.scrollSidebarToElement(configs.stateTimelineDisplay);
    await expect(configs.stateTimelineDisplay).toBeVisible();
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.stateTimelineRowSortTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.stateTimelineTooltipModeTrigger, DEFAULT_VALUE);
    await configs.expectStateValueAlign(DEFAULT_VALUE);

    expect(await configs.getStateTimelineDisplayOptionLabels()).toEqual([
      "Default (Bands)",
      "Bands",
      "Cells",
    ]);
    expect(await configs.getStateTimelineRowSortOptionLabels()).toEqual([
      "Default (Name)",
      "Name",
      "Most time outside the main state",
    ]);
    expect(await configs.getStateTimelineTooltipModeOptionLabels()).toEqual([
      "Default (This segment)",
      "This segment",
      "Rows in view at this time",
    ]);
    expect(await configs.getStateValueAlignOptionLabels()).toEqual([
      "Default (Left)",
      "Left",
      "Center",
      "Right",
    ]);

    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("cells draw one cell per sample where bands join equal states, and persist after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await setupStateTimelinePanelWithConfig(page, pm, dashboardName);
    await actions.waitForChartToRender();
    const bandsLayout = await actions.waitForStateTimelineLayout(HOST_ROWS);
    testLogger.info("Default display layout", { rows: bandsLayout.rows.map((r) => r.length), samples: bandsLayout.sampleTimes });
    actions.expectStateTimelineBands(bandsLayout, BUCKET_MS);

    await configs.selectStateTimelineDisplay("Cells");
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, "cells");
    const cellsLayout = await actions.applyAndGetStateTimelineLayout(HOST_ROWS);
    testLogger.info("Cells display layout", { rows: cellsLayout.rows.map((r) => r.length), samples: cellsLayout.sampleTimes });
    actions.expectStateTimelineCells(cellsLayout, BUCKET_MS);

    // Cells centre their text by default, and the Default item says so.
    expect((await configs.getStateValueAlignOptionLabels())[0]).toBe("Default (Center)");

    await configs.selectStateTimelineDisplay("Bands");
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, "bands");
    actions.expectStateTimelineBands(await actions.applyAndGetStateTimelineLayout(HOST_ROWS), BUCKET_MS);
    expect((await configs.getStateValueAlignOptionLabels())[0]).toBe("Default (Left)");

    await configs.selectStateTimelineDisplay("Cells");
    await actions.applyAndGetStateTimelineLayout(HOST_ROWS);
    await actions.savePanel();

    testLogger.info("Verifying Cells display persists after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, "cells");
    await actions.waitForChartToRender();
    actions.expectStateTimelineCells(await actions.waitForStateTimelineLayout(HOST_ROWS), BUCKET_MS);
    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Default resets a saved display, sort, tooltip and alignment back to unset", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await setupStateTimelinePanelWithConfig(page, pm, dashboardName);
    await configs.selectStateTimelineDisplay("Cells");
    await configs.selectStateTimelineRowSort("Most time outside the main state");
    await configs.selectStateTimelineTooltipMode("Rows in view at this time");
    await configs.selectStateValueAlign("Right", "right");
    await configs.setConfigToggle(configs.stateTimelineShowStateText, false);
    actions.expectStateTimelineCells(await actions.applyAndGetStateTimelineLayout(HOST_ROWS), BUCKET_MS);
    await actions.savePanel();

    testLogger.info("Verifying the chosen state timeline options persist after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, "cells");
    await configs.expectConfigSelectValue(configs.stateTimelineRowSortTrigger, "non_ok_time");
    await configs.expectConfigSelectValue(configs.stateTimelineTooltipModeTrigger, "all_rows");
    await configs.expectStateValueAlign("right");
    await configs.expectConfigToggle(configs.stateTimelineShowStateText, false);

    await configs.selectStateTimelineDisplay("Default (Bands)");
    await configs.selectStateTimelineRowSort("Default (Name)");
    await configs.selectStateTimelineTooltipMode("Default (This segment)");
    await configs.selectStateValueAlign("Default (Left)", DEFAULT_VALUE);
    actions.expectStateTimelineBands(await actions.applyAndGetStateTimelineLayout(HOST_ROWS), BUCKET_MS);
    await actions.savePanel();

    testLogger.info("Verifying Default selections persist as unset after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.stateTimelineDisplayTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.stateTimelineRowSortTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.stateTimelineTooltipModeTrigger, DEFAULT_VALUE);
    await configs.expectStateValueAlign(DEFAULT_VALUE);
    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
