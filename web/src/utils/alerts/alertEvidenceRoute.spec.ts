// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import {
  alertEvidenceFilter,
  alertEvidencePage,
  alertEvidenceRoute,
  alertEvidenceWindow,
  alertStoredSql,
} from "@/utils/alerts/alertEvidenceRoute";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";

const sqlAlert = {
  stream_type: "logs",
  stream_name: "nginx_access",
  alert_type: "scheduled",
  query_condition: {
    type: "sql",
    sql: "SELECT count(*) as cnt FROM nginx_access WHERE status >= 500",
  },
  trigger_condition: { period: 10 },
};

const decoded = (route: any) => b64DecodeUnicodeSafe(route.query.query, "");

describe("alertEvidencePage", () => {
  it("maps each stream type to its explorer", () => {
    expect(alertEvidencePage(sqlAlert)).toBe("logs");
    expect(alertEvidencePage({ ...sqlAlert, stream_type: "traces" })).toBe("traces");
    expect(alertEvidencePage({ ...sqlAlert, stream_type: "metrics" })).toBe("metrics");
  });

  it("has no explorer for families without one stream query", () => {
    expect(alertEvidencePage({ ...sqlAlert, alert_type: "composite" })).toBeNull();
    expect(alertEvidencePage({ ...sqlAlert, alert_type: "anomaly_detection" })).toBeNull();
    expect(alertEvidencePage({ ...sqlAlert, query_condition: { type: "slo" } })).toBeNull();
    expect(alertEvidencePage({ ...sqlAlert, stream_name: "" })).toBeNull();
    expect(alertEvidencePage({ ...sqlAlert, stream_type: "enrichment_tables" })).toBeNull();
  });
});

describe("alertEvidenceWindow", () => {
  it("opens a firing one look-back before it started, up to now", () => {
    expect(alertEvidenceWindow(10, 1_000_000_000, 2_000_000_000)).toEqual({
      fromUs: 1_000_000_000 - 600_000_000,
      toUs: 2_000_000_000,
    });
  });

  it("opens the look-back that ends now when nothing fires", () => {
    expect(alertEvidenceWindow(10, null, 5)).toEqual({ period: "10m" });
    expect(alertEvidenceWindow(undefined, null, 5)).toEqual({ period: "15m" });
  });
});

describe("alertEvidenceFilter", () => {
  it("takes the WHERE clause out of an aggregate query, so the rows show", async () => {
    const filter = await alertEvidenceFilter(sqlAlert, alertStoredSql(sqlAlert));
    expect(filter?.kind).toBe("where");
    expect(filter?.kind === "where" && filter.where).toMatch(/status"?\s*>=\s*500/);
  });

  it("opens the stream unfiltered when the query has no WHERE", async () => {
    expect(await alertEvidenceFilter(sqlAlert, "SELECT count(*) FROM nginx_access")).toEqual({
      kind: "where",
      where: "",
    });
  });

  it("falls back to the whole query when the parser cannot read it", async () => {
    const sql = "SELECT count(*) FROM t WHERE ((((";
    expect(await alertEvidenceFilter(sqlAlert, sql)).toEqual({ kind: "sql", sql });
  });

  it("uses a PromQL alert's expression", async () => {
    const alert = { ...sqlAlert, query_condition: { type: "promql", promql: "up == 0" } };
    expect(await alertEvidenceFilter(alert, "")).toEqual({ kind: "promql", promql: "up == 0" });
  });
});

describe("alertEvidenceRoute", () => {
  const window = { fromUs: 1_000_000, toUs: 9_000_000 };

  it("opens logs in Builder mode on the stream, filter and window", () => {
    const route: any = alertEvidenceRoute({
      page: "logs",
      stream: "nginx_access",
      filter: { kind: "where", where: "status >= 500" },
      window,
      org: "default",
    });
    expect(route.path).toBe("/logs");
    expect(route.query).toMatchObject({
      stream_type: "logs",
      stream: "nginx_access",
      from: "1000000",
      to: "9000000",
      sql_mode: "false",
      quick_mode: "false",
      org_identifier: "default",
    });
    expect(decoded(route)).toBe("status >= 500");
  });

  it("opens logs in SQL mode when only the whole query is known", () => {
    const route: any = alertEvidenceRoute({
      page: "logs",
      stream: "s",
      filter: { kind: "sql", sql: "SELECT * FROM s" },
      window: { period: "10m" },
      org: "o",
    });
    expect(route.query.sql_mode).toBe("true");
    expect(route.query.period).toBe("10m");
    expect(route.query.from).toBeUndefined();
    expect(decoded(route)).toBe("SELECT * FROM s");
  });

  it("opens traces with the filter in the editor", () => {
    const route: any = alertEvidenceRoute({
      page: "traces",
      stream: "default",
      filter: { kind: "where", where: "duration > 1000" },
      window,
      org: "o",
    });
    expect(route.name).toBe("traces");
    expect(route.query).toMatchObject({ stream: "default", from: "1000000", tab: "traces" });
    expect(decoded(route)).toBe("duration > 1000");
  });

  it("opens metrics in milliseconds, with the PromQL when there is one", () => {
    const route: any = alertEvidenceRoute({
      page: "metrics",
      stream: "cpu",
      filter: { kind: "promql", promql: "up == 0" },
      window,
      org: "o",
    });
    expect(route.query).toMatchObject({ query_type: "promql", from: "1000", to: "9000" });
    expect(decoded(route)).toBe("up == 0");
    const plain: any = alertEvidenceRoute({
      page: "metrics",
      stream: "cpu",
      filter: null,
      window: { period: "10m" },
      org: "o",
    });
    expect(plain.query).toEqual({ org_identifier: "o", metric: "cpu", period: "10m" });
  });
});
