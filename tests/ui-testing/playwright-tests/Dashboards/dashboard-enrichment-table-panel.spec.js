// Copyright 2026 OpenObserve Inc.

// Enrichment rows carry their upload time, so a panel must show them on any dashboard range (#15875).

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import { readColumnCells } from "../../pages/dashboardPages/dashboard-table-helpers.js";
const { getAuthHeaders, getOrgIdentifier } = require("../utils/cloud-auth.js");

// INGESTION_URL first: when the UI runs on its own dev server only that host serves the API.
const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || "").replace(/\/$/, "");
const STREAM_TYPE = "enrichment_tables";
const INITIAL_CSV = "country,city,population\nIndia,Bengaluru,13\nUSA,Austin,1\nGermany,Berlin,4";
const REPLACED_CSV = "country,city,population\nJapan,Tokyo,14\nBrazil,Recife,2";
const WEEK_MS = 7 * 24 * 3600 * 1000;

test.describe.configure({ mode: "parallel" });

async function uploadEnrichmentTable(page, name, csv) {
  const upload = () =>
    page.request.post(`${BASE}/api/${getOrgIdentifier()}/enrichment_tables/${name}?append=false`, {
      headers: { Authorization: getAuthHeaders().Authorization },
      multipart: { file: { name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
  let res = await upload();
  for (let attempt = 1; attempt <= 4 && res.status() === 503; attempt++) {
    await page.waitForTimeout(1500 * attempt);
    res = await upload();
  }
  expect(res.status(), `enrichment table ${name} must upload`).toBe(200);
}

async function waitForRowCount(page, name, rowCount) {
  const now = Date.now() * 1000;
  await expect
    .poll(
      async () => {
        const res = await page.request.post(
          `${BASE}/api/${getOrgIdentifier()}/_search?type=${STREAM_TYPE}`,
          {
            headers: getAuthHeaders(),
            data: {
              query: {
                sql: `SELECT count(*) AS c FROM "${name}"`,
                start_time: now - 24 * 3600 * 1_000_000,
                end_time: now + 3600 * 1_000_000,
                from: 0,
                size: 1,
              },
            },
          },
        );
        if (res.status() !== 200) return -1;
        return (await res.json())?.hits?.[0]?.c ?? -1;
      },
      { timeout: 90000, intervals: [1000, 2000, 3000] },
    )
    .toBe(rowCount);
}

async function deleteEnrichmentTable(page, name) {
  await page.request
    .delete(`${BASE}/api/${getOrgIdentifier()}/streams/${name}?type=${STREAM_TYPE}`, {
      headers: getAuthHeaders(),
    })
    .catch(() => {});
}

async function firstColumn(page) {
  return (await readColumnCells(page, 0, 20)).map((cell) => cell.text).sort();
}

async function expectFirstColumn(page, values) {
  await expect.poll(() => firstColumn(page), { timeout: 30000 }).toEqual([...values].sort());
}

// The panel request's own range proves the dashboard ran on last week, not on a restored default.
async function openOnLastWeek(page, tableName) {
  const from = Date.now() - 2 * WEEK_MS;
  const to = Date.now() - WEEK_MS;
  const url = new URL(page.url());
  url.searchParams.delete("period");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  const panelRequest = page.waitForRequest(
    (req) => req.url().includes("/_search_stream") && (req.postData() || "").includes(tableName),
    { timeout: 30000 },
  );
  await page.goto(url.toString());
  const { query } = (await panelRequest).postDataJSON();
  expect(query.start_time).toBeGreaterThanOrEqual((from - 60000) * 1000);
  expect(query.end_time).toBeLessThanOrEqual((to + 60000) * 1000);
}

async function expectPlottedCount(pm, count) {
  const plotted = async () =>
    (await pm.dashboardPanelActions.getChartSeries())
      .flatMap((series) => series.values)
      .filter((value) => value !== null && value !== undefined && value !== "-")
      .reduce((sum, value) => sum + Number(value), 0);
  await expect.poll(plotted, { timeout: 30000 }).toBe(count);
}

async function addEnrichmentPanel(page, pm, dashboardName, tableName, chartType) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType(STREAM_TYPE);
  await pm.chartTypeSelector.selectStream(tableName);
}

test.describe("Dashboard panel on an enrichment table", () => {
  let tableName;

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    tableName = `e2e_enrich_panel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await uploadEnrichmentTable(page, tableName, INITIAL_CSV);
    await waitForRowCount(page, tableName, 3);
  });

  test.afterEach(async ({ page }) => {
    await deleteEnrichmentTable(page, tableName);
  });

  test(
    "TC-ENR-001: builder table panel shows every row and keeps them on a range before the upload",
    { tag: ["@dashboard-enrichment-table", "@smoke", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "x");
      await pm.dashboardPanelActions.addPanelName("Countries");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);

      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);

      await openOnLastWeek(page, tableName);
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);
      testLogger.info("Enrichment table panel renders on a range before the upload");

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-002: custom SQL panel on an enrichment table",
    { tag: ["@dashboard-enrichment-table", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.setCustomSQL(
        `SELECT city AS x_axis_1, count(_timestamp) AS y_axis_1 FROM "${tableName}" GROUP BY x_axis_1`,
      );
      await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");
      await pm.dashboardPanelActions.addPanelName("Cities");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Austin", "Bengaluru", "Berlin"]);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-003: builder bar chart with the default fields renders, also on a range before the upload",
    { tag: ["@dashboard-enrichment-table", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "bar");
      await pm.dashboardPanelActions.addPanelName("Uploads");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await expect(pm.dashboardPanelActions.getNoDataLocator()).toBeHidden({ timeout: 30000 });
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expectPlottedCount(pm, 3);

      await pm.dashboardPanelActions.savePanel();
      await openOnLastWeek(page, tableName);
      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await expectPlottedCount(pm, 3);

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-004: re-uploading the table replaces the rows the panel shows",
    { tag: ["@dashboard-enrichment-table", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "x");
      await pm.dashboardPanelActions.addPanelName("Countries");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);

      await uploadEnrichmentTable(page, tableName, REPLACED_CSV);
      await waitForRowCount(page, tableName, 2);
      await pm.dashboardAutoRun.clickRefresh();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Brazil", "Japan"]);

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );
});
