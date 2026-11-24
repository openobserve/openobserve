const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  TracesRegressionPage,
  slantedLabelLegendOverlaps,
} = require("../../../pages/tracesPages/tracesRegressionPage.js");
const {
  uniqueTraceStream,
  ingestLogsAndWait,
  deleteTraceStream,
  drillDownLogRows,
} = require("../../../pages/tracesPages/tracesFixtures.js");

// Drill down is the Logs page's view of plugins/traces/metrics/TracesAnalysisDashboard.vue.
const ROWS = 40;
const FIELDS = ["level", "svc_name", "reason", "msg", "code"];
test.describe("Drill down dimensions and empty states (#16952)", () => {
  test.describe.configure({ mode: "serial" });
  const stream = uniqueTraceStream("16952");
  let tr;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await ingestLogsAndWait(request, stream, drillDownLogRows(ROWS));
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await deleteTraceStream(request, stream, "logs");
    await request.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    tr = new TracesRegressionPage(page);
    pm = new PageManager(page);
  });

  test(
    "clicking a dimension's name selects it and charts it, and clicking again removes it",
    {
      tag: ["@bug-16952", "@P2", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await tr.openLogs(stream);
      await tr.runLogsSearch();
      await tr.openDrillDown();
      await tr.waitForDrillDownDashboard();

      const selected = await tr.selectedDimensionNames();
      const field = FIELDS.find((f) => !selected.includes(f));
      expect(
        field,
        `Precondition: one seeded field must start unselected (selected: ${selected})`,
      ).toBeTruthy();

      const charted = tr.waitForSearchMentioning(field);
      await tr.clickDimensionName(field);
      await expect
        .poll(() => tr.isDimensionSelected(field), {
          message: `clicking the name "${field}" must select it`,
        })
        .toBe(true);
      expect(
        await charted,
        `selecting "${field}" by its name must query that dimension for its chart`,
      ).toBe(true);

      await tr.clickDimensionName(field);
      await expect
        .poll(() => tr.isDimensionSelected(field), {
          message: `clicking the name "${field}" again must unselect it`,
        })
        .toBe(false);
    },
  );

  test(
    "unselecting every dimension shows the illustrated empty state with its hint",
    {
      tag: ["@bug-16952", "@P2", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await tr.openLogs(stream);
      await tr.runLogsSearch();
      await tr.openDrillDown();
      await tr.waitForDrillDownDashboard();

      for (const field of await tr.selectedDimensionNames())
        await tr.dimensionCheckbox(field).click();
      await expect.poll(() => tr.selectedDimensionNames()).toEqual([]);

      const empty = pm.logsPage.drillDownNoDimensionsState();
      await expect(empty).toBeVisible();
      await expect(
        empty,
        "the empty state must say what to do next",
      ).toContainText("Tick a dimension on the left to compare its values");
    },
  );

  test(
    "Drill down with no results keeps the stream picker inside the Insights header",
    {
      tag: ["@bug-16952", "@P2", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await tr.openLogs(stream, "level = 'no_such_level'");
      await tr.runLogsSearch();
      await tr.openDrillDown();

      const row = pm.logsPage.drillDownStreamRow();
      await expect(
        row,
        "with no results the stream picker row is shown",
      ).toBeVisible({ timeout: 15000 });
      await expect(
        row,
        "the stream picker must sit in a titled Insights header, not alone in its own bar",
      ).toContainText("Insights");
    },
  );

  test(
    "slanted category labels on the comparison charts stay clear of the Baseline/Selected legend",
    {
      tag: ["@bug-16952", "@P2", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      // At 1600x900 each comparison panel is short enough for slanted labels to reach the legend.
      await page.setViewportSize({ width: 1600, height: 900 });
      await tr.recordCanvasText();
      await tr.openLogs(stream);
      await tr.runLogsSearch();
      await tr.untilSearchesSettle(() => tr.brushLogsHistogram(0.4, 0.7));
      await tr.openDrillDown();
      await tr.waitForDrillDownDashboard();
      await expect(
        pm.logsPage.drillDownSelectedRangeChip(),
        "Precondition: the brush opens Drill down as a Baseline/Selected comparison",
      ).toBeVisible();
      if (!(await tr.isDimensionSelected("reason")))
        await tr.untilSearchesSettle(() =>
          tr.dimensionCheckbox("reason").click(),
        );

      let charts = [];
      await expect
        .poll(
          async () => {
            charts = (await tr.canvasTextBoxes()).filter(
              (texts) =>
                texts.some((t) => t.text === "Baseline") &&
                texts.some((t) => t.rotated),
            );
            return charts.length;
          },
          {
            timeout: 30000,
            message:
              "Precondition: a comparison chart with slanted labels and its legend is drawn",
          },
        )
        .toBeGreaterThan(0);

      const overlaps = slantedLabelLegendOverlaps(charts);
      expect(
        overlaps,
        "no slanted category label may be drawn over the legend",
      ).toEqual([]);
    },
  );
});
