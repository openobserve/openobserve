const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  TracesRegressionPage,
} = require("../../../pages/tracesPages/tracesRegressionPage.js");
const { decodedSqlOf } = require("../../../pages/tracesPages/tracesPage.js");
const {
  uniqueTraceStream,
  ingestLogsAndWait,
  deleteTraceStream,
} = require("../../../pages/tracesPages/tracesFixtures.js");

// Drill down is the Logs page's view of plugins/traces/metrics/TracesAnalysisDashboard.vue.
const ROWS = 40;
const FIELDS = ["level", "svc_name", "reason", "msg", "code"];
// Long enough to be cut and slanted under the comparison bars.
const REASONS = [
  "notify_failed_downstream",
  "checkout_pending_review",
  "payment_gateway_timeout",
  "inventory_sync_failed",
];

// Separating-axis test for two convex polygons given as [[x, y], ...].
function polygonsIntersect(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = x1 - x2;
      const project = (p) => p.map(([x, y]) => x * nx + y * ny);
      const pa = project(a);
      const pb = project(b);
      if (
        Math.max(...pa) <= Math.min(...pb) ||
        Math.max(...pb) <= Math.min(...pa)
      )
        return false;
    }
  }
  return true;
}

function seedRows() {
  const now = Date.now();
  return Array.from({ length: ROWS }, (_, i) => ({
    // Spread over five hours so a brush across the histogram's middle selects a subset.
    _timestamp: (now - (ROWS - i) * 450000) * 1000,
    level: ["info", "error", "warn"][i % 3],
    svc_name: ["alpha", "beta", "gamma"][i % 3 === 0 ? 0 : i % 2 ? 1 : 2],
    reason: REASONS[i % 4],
    msg: `message number ${i % 10}`,
    code: 200 + (i % 5),
  }));
}

test.describe("Drill down dimensions and empty states (#16952)", () => {
  test.describe.configure({ mode: "serial" });
  const stream = uniqueTraceStream("16952");
  let tr;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await ingestLogsAndWait(request, stream, seedRows());
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

      const charted = page
        .waitForRequest((r) => (decodedSqlOf(r)?.sql || "").includes(field), {
          timeout: 30000,
        })
        .then(() => true)
        .catch(() => false);
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

      const overlaps = charts.flatMap((texts) => {
        const legend = texts.filter(
          (t) => t.text === "Baseline" || t.text === "Selected",
        );
        return texts
          .filter((t) => t.rotated)
          .flatMap((label) =>
            legend
              .filter((l) => polygonsIntersect(label.corners, l.corners))
              .map((l) => `${label.text} over ${l.text}`),
          );
      });
      expect(
        overlaps,
        "no slanted category label may be drawn over the legend",
      ).toEqual([]);
    },
  );
});
