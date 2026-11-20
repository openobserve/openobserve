const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const {
  ingestLogRowsAndWaitForCount,
  treemapPanelQuery,
  createTreemapDashboard,
  deleteDashboardQuietly,
  deleteStreamQuietly,
} = require("../../utils/regression-seed-api.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const RUN = `${Date.now().toString(36)}_${process.pid.toString(36)}`;
const STREAM = `e2e_treemap_${RUN}`;

// [region, service, host, bytes]; us-east has a negative and a zero row; missing and empty regions are separate tiles.
const ROWS = [
  ["us-east", "api", "h1", 120],
  ["us-east", "api", "h2", 80],
  ["us-east", "db", "h3", 180],
  ["us-east", "db", "h4", 120],
  ["us-east", "neg", "h5", -50],
  ["us-east", "zero", "h6", 0],
  ["eu-west", "api", "h7", 120],
  ["eu-west", "db", "h8", 80],
  ["ap-south", "api", "h9", 60],
  [null, "api", "h10", 5],
  [null, "api", "h11", 5],
  [null, "db", "h12", 10],
  [null, "db", "h13", 10],
  ["", "api", "h14", 10],
  ["", "api", "h15", 10],
  ["", "db", "h16", 20],
];
const POSITIVE_SUM_BY_REGION = [
  { name: "us-east", value: 500 },
  { name: "eu-west", value: 200 },
  { name: "ap-south", value: 60 },
  { name: "(empty)", value: 40 },
  { name: "(null)", value: 30 },
];
const COUNT_BY_REGION = [
  { name: "us-east", value: 6 },
  { name: "(null)", value: 4 },
  { name: "(empty)", value: 3 },
  { name: "eu-west", value: 2 },
  { name: "ap-south", value: 1 },
];
const ONE_QUERY_ERROR =
  "Treemap draws one measure, so it takes one visible query. Remove or hide the other queries.";

const created = { dashboards: [], streams: [] };

test.describe(
  "Treemap totals, defaults and query count (#16935)",
  {
    tag: [
      "@bug-16935",
      "@P2",
      "@regression",
      "@dashboardRegression",
      "@treemap",
    ],
  },
  () => {
    test.describe.configure({ mode: "serial" });
    let pm;

    test.beforeAll(async () => {
      const now = Date.now() * 1000;
      const records = ROWS.map(([region, service, host, bytes], i) => ({
        _timestamp: now - i * 1000,
        ...(region === null ? {} : { region }),
        service,
        host,
        bytes,
      }));
      await ingestLogRowsAndWaitForCount(STREAM, records);
      created.streams.push(STREAM);
    });

    test.afterAll(async () => {
      for (const id of created.dashboards) await deleteDashboardQuietly(id);
      for (const stream of created.streams)
        await deleteStreamQuietly(stream, "logs");
    });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    test("tiles total only the positive rows and the panel says how many rows it left out", async ({
      page,
    }) => {
      const id = await createTreemapDashboard(`tm_sum_${RUN}`, "tm_sum", [
        treemapPanelQuery(STREAM, ["region", "service"], "sum"),
      ]);
      created.dashboards.push(id);
      await pm.dashboardTreemap.openDashboard(id);
      await pm.dashboardTreemap.waitForTiles(expect, "p_treemap");
      const { nodes } = await pm.dashboardTreemap.snapshot("p_treemap");
      expect(nodes.map(({ name, value }) => ({ name, value }))).toEqual(
        POSITIVE_SUM_BY_REGION,
      );
      await expect(pm.dashboardTreemap.skippedRowsChip("p_treemap")).toHaveText(
        /^\s*\S*\s*2 rows skipped\s*$/,
        { timeout: 15000 },
      );
    });

    test("a treemap with two queries draws only the first query's measure and the editor refuses the second", async ({
      page,
    }) => {
      const id = await createTreemapDashboard(
        `tm_two_queries_${RUN}`,
        "tm_two_queries",
        [
          treemapPanelQuery(STREAM, ["region"], "count"),
          treemapPanelQuery(STREAM, ["region"], "sum"),
        ],
      );
      created.dashboards.push(id);
      await pm.dashboardTreemap.openDashboard(id);
      await pm.dashboardTreemap.waitForTiles(expect, "p_treemap");
      const { nodes } = await pm.dashboardTreemap.snapshot("p_treemap");
      expect(nodes.map(({ name, value }) => ({ name, value }))).toEqual(
        COUNT_BY_REGION,
      );

      await pm.dashboardTreemap.openPanelEditor(id, "p_treemap");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await expect(
        pm.dashboardTreemap.editorError(ONE_QUERY_ERROR),
      ).toBeVisible({ timeout: 15000 });
    });

    test("a new treemap does not start grouped by the time bucket", async ({
      page,
    }) => {
      const id = await createTreemapDashboard(`tm_new_${RUN}`, "tm_new", [
        treemapPanelQuery(STREAM, ["region"], "sum"),
      ]);
      created.dashboards.push(id);
      await pm.dashboardTreemap.openPanelEditor(id);
      await pm.chartTypeSelector.selectChartType("treemap");
      await pm.chartTypeSelector.selectStream(STREAM);
      await expect(pm.dashboardTreemap.firstSizeField()).toBeVisible({
        timeout: 15000,
      });
      expect(
        await pm.dashboardTreemap.groupFieldLabels().allTextContents(),
      ).toEqual([]);
    });
  },
);
