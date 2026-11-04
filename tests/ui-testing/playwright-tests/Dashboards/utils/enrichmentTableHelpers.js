// Copyright 2026 OpenObserve Inc.

import { expect } from "@playwright/test";
import { setupTestDashboard } from "./dashCreation.js";
import { readColumnCells } from "../../../pages/dashboardPages/dashboard-table-helpers.js";
const { getAuthHeaders, getOrgIdentifier } = require("../../utils/cloud-auth.js");

// INGESTION_URL first: when the UI runs on its own dev server only that host serves the API.
const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || "").replace(/\/$/, "");
const STREAM_TYPE = "enrichment_tables";
const WEEK_MS = 7 * 24 * 3600 * 1000;

export async function uploadEnrichmentTable(page, name, csv) {
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

export async function waitForRowCount(page, name, rowCount) {
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

export async function deleteEnrichmentTable(page, name) {
  await page.request
    .delete(`${BASE}/api/${getOrgIdentifier()}/streams/${name}?type=${STREAM_TYPE}`, {
      headers: getAuthHeaders(),
    })
    .catch(() => {});
}

async function firstColumn(page) {
  return (await readColumnCells(page, 0, 20)).map((cell) => cell.text).sort();
}

export async function expectFirstColumn(page, values) {
  await expect.poll(() => firstColumn(page), { timeout: 30000 }).toEqual([...values].sort());
}

// The picker shows last week, so a request ending now proves the panel searched the table's own span.
export async function openOnLastWeek(page, tableName) {
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
  expect(query.end_time).toBeGreaterThan((Date.now() - 5 * 60000) * 1000);
}

export async function expectPlottedCount(pm, count) {
  const plotted = async () =>
    (await pm.dashboardPanelActions.getChartSeries())
      .flatMap((series) => series.values)
      .filter((value) => value !== null && value !== undefined && value !== "-")
      .reduce((sum, value) => sum + Number(value), 0);
  await expect.poll(plotted, { timeout: 30000 }).toBe(count);
}

export async function addEnrichmentPanel(page, pm, dashboardName, tableName, chartType) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType(STREAM_TYPE);
  await pm.chartTypeSelector.selectStream(tableName);
}
