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
  chartWindow,
  filterSql,
  logsSql,
  pickErrorField,
  toSeries,
  tracesSql,
  unitOf,
  valueOf,
} from "./serviceChartSql";

const FILTERS = { service_name: "svc-b" };
const NOW = Date.UTC(2026, 10, 6, 12, 7, 30);
const MIN = 60_000;

describe("filterSql", () => {
  it("escapes values and strips double quotes from field names", () => {
    expect(filterSql({ k8s_namespace_name: "ns'a", service_name: "svc-c" })).toBe(
      `"k8s_namespace_name" = 'ns''a' AND "service_name" = 'svc-c'`,
    );
    expect(filterSql({ 'svc"name': "x" })).toBe(`"svcname" = 'x'`);
  });

  it("gives nothing to filter on, never an always-true clause, when there are no filters", () => {
    expect(filterSql({})).toBe("");
    expect(filterSql(undefined)).toBe("");
  });
});

describe("tracesSql", () => {
  it("asks one statement for requests, errors and p95, scoped to the service, on 15-minute buckets at 24h", () => {
    const sql = tracesSql("app_traces", FILTERS, "24h", { errors: true, latency: true });
    expect(sql).toBe(
      `SELECT histogram(_timestamp, '15 minute') AS t, count(*) AS n, ` +
        `count(*) FILTER (WHERE span_status = 'ERROR') AS e, ` +
        `approx_percentile_cont(duration, 0.95) AS p95 ` +
        `FROM "app_traces" WHERE "service_name" = 'svc-b' GROUP BY t ORDER BY t`,
    );
    expect(sql).not.toContain("_search");
    expect(sql).not.toMatch(/_timestamp\s*[<>]=?/);
  });

  it("uses the range's bucket and leaves out the columns a stream has no field for", () => {
    expect(tracesSql("s", FILTERS, "1h", { errors: false, latency: false })).toBe(
      `SELECT histogram(_timestamp, '1 minute') AS t, count(*) AS n FROM "s" WHERE "service_name" = 'svc-b' GROUP BY t ORDER BY t`,
    );
    expect(tracesSql("s", FILTERS, "7d", { errors: true, latency: false })).toContain(
      "histogram(_timestamp, '1 hour')",
    );
  });
});

describe("pickErrorField and logsSql", () => {
  const fields = (entries: [string, string][]) => new Map(entries);

  it("takes the first text level field, lowered, in rule order", () => {
    expect(pickErrorField(fields([["level", "Utf8"]]))).toEqual({ kind: "level", field: "level" });
    expect(
      pickErrorField(
        fields([
          ["severity", "Utf8"],
          ["severity_text", "Utf8"],
        ]),
      ),
    ).toEqual({ kind: "level", field: "severity_text" });
    const sql = logsSql("k8s_app_logs", FILTERS, "24h", { kind: "level", field: "level" });
    expect(sql).toContain(
      `count(*) FILTER (WHERE lower("level") IN ('error', 'fatal', 'critical', 'err', 'crit', 'alert', 'emerg', 'emergency')) AS e`,
    );
    expect(sql).toContain(`WHERE "service_name" = 'svc-b'`);
  });

  it("skips a numeric level field, which lower() would fail on", () => {
    expect(pickErrorField(fields([["severity", "Int64"]]))).toBeNull();
    expect(
      pickErrorField(
        fields([
          ["severity", "Int64"],
          ["log_level", "Utf8"],
        ]),
      ),
    ).toEqual({ kind: "level", field: "log_level" });
  });

  it("falls back to stderr, then to nothing", () => {
    expect(pickErrorField(fields([["log_iostream", "Utf8"]]))).toEqual({ kind: "stderr" });
    expect(logsSql("s", FILTERS, "1h", { kind: "stderr" })).toContain(
      `count(*) FILTER (WHERE "log_iostream" = 'stderr') AS e`,
    );
    expect(pickErrorField(fields([["body", "Utf8"]]))).toBeNull();
    expect(logsSql("s", FILTERS, "1h", null)).toBe(
      `SELECT histogram(_timestamp, '1 minute') AS t, count(*) AS n FROM "s" WHERE "service_name" = 'svc-b' GROUP BY t ORDER BY t`,
    );
  });
});

describe("toSeries", () => {
  const win = chartWindow("24h", NOW);
  const step = 15 * MIN;
  const at = (i: number) => new Date(win.start + i * step).toISOString().slice(0, 19);

  it("ends on the last full bucket and spans the range's step count", () => {
    expect(win.end).toBe(Date.UTC(2026, 10, 6, 12, 0));
    expect(win.last).toBe(win.end - step);
    expect(win.start).toBe(win.end - 96 * step);
    expect(chartWindow("1h", NOW).start).toBe(Date.UTC(2026, 10, 6, 11, 7));
    expect(chartWindow("7d", NOW).end).toBe(Date.UTC(2026, 10, 6, 12, 0));
  });

  it("fills 96 points at 24h: missing buckets are 0 for counts and a gap for latency", () => {
    const hits = [
      { t: at(0), n: 150, e: 3, p95: 120_000 },
      { t: at(10), n: 300, e: 0, p95: 80_000 },
      { t: at(95), n: 450, e: 9, p95: null },
    ];
    const requests = toSeries(hits, "24h", NOW, valueOf("requests", "traces", "24h"), 0);
    expect(requests.series.points).toHaveLength(96);
    expect(requests.series.points[0]).toEqual([win.start, 10]);
    expect(requests.series.points[1]).toEqual([win.start + step, 0]);
    expect(requests.series.points[95]).toEqual([win.last, 30]);
    expect(requests.facts).toEqual({
      current: 30,
      usual: 20,
      peak: 30,
      peakAt: win.last,
      missingField: null,
    });
    expect(requests.hasData).toBe(true);

    const errors = toSeries(hits, "24h", NOW, valueOf("errors", "traces", "24h"), 0);
    expect(errors.series.points[0][1]).toBe(2);
    expect(errors.series.points[1][1]).toBe(0);

    const latency = toSeries(hits, "24h", NOW, valueOf("latency", "traces", "24h"), null);
    expect(latency.series.points[0][1]).toBe(120);
    expect(latency.series.points[1][1]).toBeNull();
    expect(latency.series.points[95][1]).toBeNull();
    expect(latency.facts).toMatchObject({
      current: null,
      usual: 100,
      peak: 120,
      peakAt: win.start,
    });
  });

  it("never shows an older latency as now: an unmeasured newest or oldest bucket stays null", () => {
    const hits = [
      { t: at(1), n: 150, e: 0, p95: 120_000 },
      { t: at(10), n: 300, e: 0, p95: 80_000 },
      { t: at(95), n: 450, e: 0, p95: null },
    ];
    const latency = toSeries(hits, "24h", NOW, valueOf("latency", "traces", "24h"), null);
    expect(latency.series.current).toBeNull();
    expect(latency.series.previous).toBeNull();
    expect(latency.facts.current).toBeNull();
    const requests = toSeries(hits, "24h", NOW, valueOf("requests", "traces", "24h"), 0);
    expect(requests.series.current).toBe(30);
    expect(requests.series.previous).toBe(0);
  });

  it("reads epoch-microsecond buckets too, and drops buckets outside the window", () => {
    const hits = [
      { t: (win.start + step) * 1000, n: 15 },
      { t: (win.end + step) * 1000, n: 999 },
    ];
    const { series, facts } = toSeries(hits, "24h", NOW, valueOf("requests", "logs", "24h"), 0);
    expect(series.points[1][1]).toBe(1);
    expect(facts.peak).toBe(1);
  });

  it("has no data when no bucket came back", () => {
    const { hasData, facts } = toSeries([], "1h", NOW, valueOf("latency", "traces", "1h"), null);
    expect(hasData).toBe(false);
    expect(facts).toEqual({
      current: null,
      usual: null,
      peak: null,
      peakAt: null,
      missingField: null,
    });
  });
});

describe("units", () => {
  it("charts error share from spans and error rows per minute from logs", () => {
    expect(unitOf("errors", "traces")).toBe("percent");
    expect(unitOf("errors", "logs")).toBe("perMin");
    expect(unitOf("requests", "logs")).toBe("perMin");
    expect(unitOf("latency", "traces")).toBe("ms");
  });
});
