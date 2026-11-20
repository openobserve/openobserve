const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const {
  getAuthHeaders,
  getOrgIdentifier,
} = require("../../utils/cloud-auth.js");
const { ingestBase } = require("../../utils/ingest-url.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const BASE = (
  process.env.INGESTION_URL ||
  process.env.ZO_BASE_URL ||
  ""
).replace(/\/$/, "");
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || "default";
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

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/${ORG()}${path}`, {
    method,
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const field = (alias, column, functionName = null) => ({
  label: column,
  alias,
  column,
  color: null,
  functionName,
  args: [{ type: "field", value: { field: column, streamAlias: null } }],
  isDerived: false,
  sortBy: null,
});

function query(levels, value) {
  const x = levels.map((column, i) => field(`x_axis_${i + 1}`, column));
  const y =
    value === "count"
      ? field("y_axis_1", "_timestamp", "count")
      : field("y_axis_1", "bytes", "sum");
  const select = [
    ...x.map((f) => `${f.column} as "${f.alias}"`),
    value === "count"
      ? `count(_timestamp) as "y_axis_1"`
      : `sum(bytes) as "y_axis_1"`,
  ].join(", ");
  return {
    query: `SELECT ${select} FROM "${STREAM}" GROUP BY ${x.map((f) => f.alias).join(", ")}`,
    customQuery: false,
    fields: {
      stream: STREAM,
      stream_type: "logs",
      x,
      y: [y],
      z: [],
      breakdown: [],
      filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
    },
    config: {
      promql_legend: "",
      layer_type: "scatter",
      weight_fixed: 1,
      limit: 0,
      min: 0,
      max: 100,
    },
  };
}

async function createTreemapDashboard(name, queries) {
  const panel = {
    id: "p_treemap",
    type: "treemap",
    title: name,
    description: "",
    queryType: "sql",
    config: { show_legends: true, unit: "default", decimals: 0 },
    queries,
    layout: { x: 0, y: 0, w: 96, h: 20, i: 1 },
  };
  const result = await api("POST", "/dashboards?folder=default", {
    version: 8,
    title: `${name}_${RUN}`,
    description: "treemap e2e",
    tabs: [{ tabId: "default", name: "Default", panels: [panel] }],
  });
  const inner = result[`v${result.version}`] || result;
  const id = inner.dashboardId || inner.dashboard_id;
  created.dashboards.push(id);
  return id;
}

const openDashboard = (page, id) =>
  page.goto(
    `/web/dashboards/view?org_identifier=${ORG()}&dashboard=${id}&folder=default&period=1h`,
  );

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
      const res = await fetch(
        `${ingestBase(BASE)}/api/${ORG()}/${STREAM}/_json`,
        {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(records),
        },
      );
      expect(res.ok, `Precondition: ingest ${STREAM} -> ${res.status}`).toBe(
        true,
      );
      created.streams.push(STREAM);
      // Rows are searchable only after the WAL flush, so wait until the stream reports them all.
      await expect
        .poll(
          async () => {
            const body = await api("POST", "/_search?type=logs", {
              query: {
                sql: `SELECT count(*) as c FROM "${STREAM}"`,
                start_time: now - 3_600_000_000,
                end_time: now + 60_000_000,
                from: 0,
                size: 1,
              },
            }).catch(() => null);
            return body?.hits?.[0]?.c ?? 0;
          },
          { timeout: 60000 },
        )
        .toBe(ROWS.length);
    });

    test.afterAll(async () => {
      for (const id of created.dashboards) {
        await api("DELETE", `/dashboards/${id}?folder=default`).catch((e) =>
          testLogger.warn(`dashboard cleanup: ${e.message}`),
        );
      }
      for (const stream of created.streams) {
        await api(
          "DELETE",
          `/streams/${stream}?type=logs&delete_all=true`,
        ).catch((e) => testLogger.warn(`stream cleanup: ${e.message}`));
      }
    });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    test("tiles total only the positive rows and the panel says how many rows it left out", async ({
      page,
    }) => {
      const id = await createTreemapDashboard("tm_sum", [
        query(["region", "service"], "sum"),
      ]);
      await openDashboard(page, id);
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
      const id = await createTreemapDashboard("tm_two_queries", [
        query(["region"], "count"),
        query(["region"], "sum"),
      ]);
      await openDashboard(page, id);
      await pm.dashboardTreemap.waitForTiles(expect, "p_treemap");
      const { nodes } = await pm.dashboardTreemap.snapshot("p_treemap");
      expect(nodes.map(({ name, value }) => ({ name, value }))).toEqual(
        COUNT_BY_REGION,
      );

      await page.goto(
        `/web/dashboards/add_panel?org_identifier=${ORG()}&dashboard=${id}&panelId=p_treemap&folder=default&tab=default`,
      );
      await pm.dashboardPanelActions.applyDashboardBtn();
      await expect(
        pm.dashboardTreemap.editorError(ONE_QUERY_ERROR),
      ).toBeVisible({ timeout: 15000 });
    });

    test("a new treemap does not start grouped by the time bucket", async ({
      page,
    }) => {
      const id = await createTreemapDashboard("tm_new", [
        query(["region"], "sum"),
      ]);
      await page.goto(
        `/web/dashboards/add_panel?org_identifier=${ORG()}&dashboard=${id}&folder=default&tab=default`,
      );
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
