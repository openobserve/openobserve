// Copyright 2026 OpenObserve Inc.

import { expect } from "@playwright/test";
import { setupTestDashboard } from "./dashCreation.js";

// INGESTION_URL first: when the UI runs on its own dev server only that host serves the API.
const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || "").replace(/\/$/, "");
const STREAM_TYPE = "enrichment_tables";
const WEEK_MS = 7 * 24 * 3600 * 1000;

const orgId = () => process.env["ORGNAME"];

const authHeader = () =>
  `Basic ${Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`,
  ).toString("base64")}`;

export const generateDashboardName = () =>
  `Dashboard_Enrich_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export async function uploadEnrichmentTable(page, name, csv) {
  const upload = () =>
    page.request.post(`${BASE}/api/${orgId()}/enrichment_tables/${name}?append=false`, {
      headers: { Authorization: authHeader() },
      multipart: { file: { name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
  let res = await upload();
  for (let attempt = 1; attempt <= 4 && res.status() === 503; attempt++) {
    await page.waitForTimeout(1500 * attempt);
    res = await upload();
  }
  expect(res.status(), `enrichment table ${name} must upload`).toBe(200);
}

export async function waitForRowCount(page, name, rowCount) {
  const now = Date.now() * 1000;
  await expect
    .poll(
      async () => {
        const res = await page.request.post(`${BASE}/api/${orgId()}/_search?type=${STREAM_TYPE}`, {
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          data: {
            query: {
              sql: `SELECT count(*) AS c FROM "${name}"`,
              start_time: now - 24 * 3600 * 1_000_000,
              end_time: now + 3600 * 1_000_000,
              from: 0,
              size: 1,
            },
          },
        });
        if (res.status() !== 200) return -1;
        return (await res.json())?.hits?.[0]?.c ?? -1;
      },
      { timeout: 90000, intervals: [1000, 2000, 3000] },
    )
    .toBe(rowCount);
}

export async function deleteEnrichmentTable(page, name) {
  await page.request
    .delete(`${BASE}/api/${orgId()}/streams/${name}?type=${STREAM_TYPE}`, {
      headers: { Authorization: authHeader() },
    })
    .catch(() => {});
}

export async function waitForTablePanelWithData(page, timeout = 30000) {
  await page.locator('[data-test="dashboard-panel-table"]').first().waitFor({ state: "visible", timeout });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-test="dashboard-panel-table"] tbody td')).some(
        (cell) => cell.offsetParent !== null && cell.textContent.trim().length > 0,
      ),
    null,
    { timeout },
  );
}

// Cells carry a copy button whose icon ligature would leak into textContent.
async function firstColumn(page) {
  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-test="dashboard-panel-table"] tbody tr')).map((row) => {
      const cell = row.querySelector("td")?.cloneNode(true);
      cell?.querySelectorAll(".q-btn").forEach((btn) => btn.remove());
      return (cell?.textContent ?? "").trim();
    }),
  );
  return cells.filter(Boolean).sort();
}

export async function expectFirstColumn(page, values) {
  await expect.poll(() => firstColumn(page), { timeout: 30000 }).toEqual([...values].sort());
}

// The picker shows last week, so requests ending now prove the panel searched the table's own span.
export async function openOnLastWeek(page, tableName) {
  const from = Date.now() - 2 * WEEK_MS;
  const to = Date.now() - WEEK_MS;
  const url = new URL(page.url());
  url.searchParams.delete("period");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  const panelRequests = [];
  const onRequest = (req) => {
    if (req.url().includes("/_search_stream") && (req.postData() || "").includes(tableName)) panelRequests.push(req);
  };
  page.on("request", onRequest);
  await page.goto(url.toString());
  const refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
  await refreshBtn.waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  // A reload can paint the panel from its cache without a query, so refresh to force one.
  if (panelRequests.length === 0) await refreshBtn.click();
  await expect.poll(() => panelRequests.length, { timeout: 30000 }).toBeGreaterThan(0);
  page.off("request", onRequest);
  for (const req of panelRequests) {
    expect(req.postDataJSON().query.end_time).toBeGreaterThan((Date.now() - 5 * 60000) * 1000);
  }
}

export async function expectPlottedCount(pm, count) {
  const plotted = async () =>
    (await pm.dashboardPanelActions.getChartSeries())
      .flatMap((series) => series.values)
      .filter((value) => value !== null && value !== undefined && value !== "-")
      .reduce((sum, value) => sum + Number(value), 0);
  await expect.poll(plotted, { timeout: 30000 }).toBe(count);
}

// v0.40 keeps the builder's histogram x item in custom mode and maps no axes, so both are set by hand.
export async function setCustomSQL(page, pm, query) {
  await pm.chartTypeSelector.removeField("x_axis_1", "x");
  await page.locator('[data-test="dashboard-custom-query-type"]').click();
  await pm.chartTypeSelector.enterCustomSQL(query);
  await page.keyboard.press("Escape");
  await pm.chartTypeSelector.searchAndAddField("x_axis_1", "x");
  await pm.chartTypeSelector.searchAndAddField("y_axis_1", "y");
}

// A result_schema call that resolves the table as a logs stream answers 400.
export function trackResultSchemaRequests(page) {
  const requests = [];
  page.on("request", (req) => {
    if (req.url().includes("/result_schema")) requests.push(req);
  });
  return async () => {
    const failed = [];
    for (const req of requests) {
      const res = await req.response();
      if (res && res.status() >= 400 && res.status() < 500) failed.push(`${res.status()} ${req.url()}`);
    }
    expect(failed, "no result_schema request may fail").toEqual([]);
  };
}

export async function waitForCustomQueryAxes(page, xAlias, yAlias) {
  await page.locator(`[data-test="dashboard-x-item-${xAlias}"]`).first().waitFor({ state: "attached", timeout: 15000 });
  await page.locator(`[data-test="dashboard-y-item-${yAlias}"]`).first().waitFor({ state: "attached", timeout: 15000 });
}

// v0.40 seeds only the histogram x-axis, so add the count(_timestamp) y-axis that later releases seed by default.
export async function addCountYAxis(pm) {
  await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
}

export async function addEnrichmentPanel(page, pm, dashboardName, tableName, chartType) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType(STREAM_TYPE);
  await pm.chartTypeSelector.selectStream(tableName);
}
