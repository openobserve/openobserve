const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupNamespacePiePanelWithConfig,
  setupPromQLRegionPiePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

// The seeded cpu_usage is an integer in 25–75, so a region's instant sum can never be the single-sample count of 1.
const MIN_SEEDED_CPU = 25;
const AGG_LAST = "Last (most recent value)";
const AGG_COUNT = "Count (number of data points)";

test.describe("Pie & Donut legend values — SQL", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("TC-LV-001: legend values control offers Value and Percent, both off by default — legend shows names only", {
    tag: ["@pieLegendValues", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.expectLegendValuesVisible(true);
    await pm.dashboardPanelConfigs.expectLegendValuesSelected([]);

    const entries = await pm.dashboardPanelActions.waitForPieLegendEntries((e) => e.length > 1);
    testLogger.info("Default pie legend entries", { entries });
    pm.dashboardPanelActions.expectPieLegendNamesOnly(entries);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-002: Value + Percent on a right plain legend — each entry shows its slice value and share", {
    tag: ["@pieLegendValues", "@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.legendPosition("Right");
    await pm.dashboardPanelConfigs.selectLegendsType("Plain");
    await pm.dashboardPanelConfigs.setLegendValues(["value", "percent"]);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    const entries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(2);
    testLogger.info("Pie legend with value and percent", { entries });
    await pm.dashboardPanelActions.expectPieLegendValueAndPercent(entries, 2);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-003: Percent only — persists after save, in dashboard view and on reopen", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.setLegendValues(["percent"]);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Saved pie panel with Percent-only legend values");

    const viewEntries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(1);
    pm.dashboardPanelActions.expectPieLegendPercentOnly(viewEntries, 2);

    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expectLegendValuesSelected(["percent"]);
    const editorEntries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(1);
    pm.dashboardPanelActions.expectPieLegendPercentOnly(editorEntries, 2);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-004: donut with Value only — legend shows the slice value and no percent", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName, { chartType: "donut" });

    await pm.dashboardPanelConfigs.setLegendValues(["value"]);
    await pm.dashboardPanelActions.applyDashboardBtn();

    const entries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(1);
    testLogger.info("Donut legend with value only", { entries });
    pm.dashboardPanelActions.expectPieLegendValueOnly(entries, 2);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-005: panel Decimals 0 — legend values and percents drop their decimals", {
    tag: ["@pieLegendValues", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.selectDecimals("0");
    await pm.dashboardPanelConfigs.setLegendValues(["value", "percent"]);
    await pm.dashboardPanelActions.applyDashboardBtn();

    const entries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(2);
    testLogger.info("Pie legend with decimals 0", { entries });
    await pm.dashboardPanelActions.expectPieLegendValueAndPercent(entries, 0);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-006: control shows only for a pie with legends on — hidden when legends are off or the chart is a bar, kept on return", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupNamespacePiePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.setLegendValues(["value", "percent"]);

    await pm.dashboardPanelConfigs.toggleShowLegends();
    await pm.dashboardPanelConfigs.expectLegendValuesVisible(false);
    testLogger.info("Legend values hidden with Show Legends off");

    await pm.dashboardPanelConfigs.toggleShowLegends();
    await pm.dashboardPanelConfigs.expectLegendValuesVisible(true);

    await pm.chartTypeSelector.selectChartType("bar");
    await pm.dashboardPanelConfigs.expectLegendValuesVisible(false);
    testLogger.info("Legend values hidden for bar chart");

    await pm.chartTypeSelector.selectChartType("pie");
    await pm.dashboardPanelConfigs.expectLegendValuesSelected(["value", "percent"]);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});

test.describe("PromQL pie — legend values and instant reducer", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test("TC-LV-101: Aggregation selector shows for a Range query and hides for an Instant one", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLRegionPiePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.expectAggregationVisible(true);

    await pm.dashboardPromQLEditor.selectQueryType("Instant");
    await pm.dashboardPanelConfigs.expectAggregationVisible(false);
    testLogger.info("Aggregation hidden for Instant query");

    await pm.dashboardPromQLEditor.selectQueryType("Range");
    await pm.dashboardPanelConfigs.expectAggregationVisible(true);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-102: Instant query ignores a saved Count aggregation — slices show the instant sample", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLRegionPiePanelWithConfig(page, pm, dashboardName);

    // Apply first redraws the previous data under the new config, so each read waits for its own query to finish.
    await pm.dashboardPanelConfigs.selectConfigOption("dashboard-config-aggregation", AGG_LAST);
    await pm.dashboardPanelActions.applyAndWaitForPromQLQuery();
    const lastEntries = await pm.dashboardPanelActions.waitForPieLegendEntries((e) => e.length > 0);

    await pm.dashboardPanelConfigs.selectConfigOption("dashboard-config-aggregation", AGG_COUNT);
    await pm.dashboardPanelActions.applyAndWaitForPromQLQuery();
    const lastByName = Object.fromEntries(lastEntries.map((e) => [e.name, e.value]));
    const countEntries = await pm.dashboardPanelActions.waitForPieLegendEntries(
      (e) => e.some((entry) => entry.value !== lastByName[entry.name])
    );
    testLogger.info("Range slices under Last and Count", { lastEntries, countEntries });

    await pm.dashboardPromQLEditor.selectQueryType("Instant");
    await pm.dashboardPanelConfigs.expectAggregationVisible(false);
    // An instant query is sent to query_range with start equal to end.
    const instantResponse = await pm.dashboardPanelActions.applyAndWaitForPromQLQuery(
      (url) => url.searchParams.get("start") !== null && url.searchParams.get("start") === url.searchParams.get("end")
    );
    const instantSamples = await pm.dashboardPanelActions.promqlSampleValues(instantResponse);
    testLogger.info("Instant query samples", { instantSamples });
    expect(instantSamples.length, "instant query returned samples").toBeGreaterThan(0);

    // The final render lands after the query completes, so wait until the slices carry exactly this response's samples.
    const instantEntries = await pm.dashboardPanelActions.waitForPieLegendEntries((e) => {
      const values = e.map((entry) => entry.value).sort((a, b) => a - b);
      return values.length === instantSamples.length && values.every((v, i) => Math.abs(v - instantSamples[i]) < 1e-9);
    });
    testLogger.info("Instant slices with Count still saved", { instantEntries });
    for (const entry of instantEntries) {
      expect(entry.value, `instant slice ${entry.name} must not be reduced by the saved Count`).toBeGreaterThanOrEqual(MIN_SEEDED_CPU);
    }

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-103: mixed queries — Aggregation shows while a visible query is Range, hides once only Instant ones are visible", {
    tag: ["@pieLegendValues", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLRegionPiePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPromQLEditor.selectQueryType("Instant");
    await pm.dashboardPanelConfigs.expectAggregationVisible(false);

    await pm.dashboardMultiSQL.addQueryTab(1);
    await pm.dashboardPanelConfigs.expectAggregationVisible(true);
    testLogger.info("Aggregation visible with a Range second query");

    await pm.dashboardMultiSQL.toggleQueryVisibility(1);
    await pm.dashboardPanelConfigs.expectAggregationVisible(false);
    testLogger.info("Aggregation hidden once the Range query is hidden");

    await pm.dashboardMultiSQL.toggleQueryVisibility(1);
    await pm.dashboardPanelConfigs.expectAggregationVisible(true);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-LV-104: PromQL pie with Value + Percent — legend matches each series value and share", {
    tag: ["@pieLegendValues", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLRegionPiePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPromQLEditor.selectQueryType("Instant");
    await pm.dashboardPanelConfigs.setLegendValues(["value", "percent"]);
    await pm.dashboardPanelActions.applyDashboardBtn();

    const entries = await pm.dashboardPanelActions.waitForPieLegendTokenCount(2);
    testLogger.info("PromQL pie legend with value and percent", { entries });
    await pm.dashboardPanelActions.expectPieLegendValueAndPercent(entries, 2);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
