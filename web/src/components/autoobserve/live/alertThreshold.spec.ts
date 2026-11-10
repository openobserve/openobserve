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
import { chartThreshold } from "./alertThreshold";

describe("chartThreshold (G7: the threshold line on the service charts)", () => {
  it("reads a traces p95 alert written in microseconds as milliseconds", () => {
    const sql = `SELECT approx_percentile_cont("duration", 0.95) AS p95 FROM "app_traces" WHERE "service_name" = 'svc-a' HAVING approx_percentile_cont("duration", 0.95) > 34000`;
    expect(chartThreshold("latency", "ms", [{ sql, streamType: "traces" }])).toBe(34);
  });

  it("reads a p95 the query already divided into milliseconds as is", () => {
    const sql = `SELECT approx_percentile_cont("duration", 0.95) / 1000 AS p95_ms FROM "t" HAVING approx_percentile_cont("duration", 0.95) / 1000 > 840`;
    expect(chartThreshold("latency", "ms", [{ sql, streamType: "traces" }])).toBe(840);
  });

  it("turns an errors count over its period into the per-minute rate the chart draws", () => {
    const sql = `SELECT count(*) AS errors FROM "app_logs" WHERE "service_name" = 'svc-e' HAVING count(*) > 30`;
    expect(chartThreshold("errors", "perMin", [{ sql, period: 60, streamType: "logs" }])).toBe(0.5);
  });

  it("draws no line it can't place: an errors percent chart, or a query it can't read", () => {
    const sql = `SELECT count(*) AS errors FROM "t" HAVING count(*) > 30`;
    expect(chartThreshold("errors", "percent", [{ sql, period: 60 }])).toBeNull();
    expect(chartThreshold("latency", "ms", [{ sql: "SELECT * FROM t" }])).toBeNull();
    expect(chartThreshold("latency", "ms", [])).toBeNull();
  });

  it("takes the lowest of several alerts, where the first one fires", () => {
    const at = (n: number) =>
      `SELECT 1 HAVING approx_percentile_cont("duration", 0.95) / 1000 > ${n}`;
    expect(chartThreshold("latency", "ms", [{ sql: at(900) }, { sql: at(300) }])).toBe(300);
  });
});

describe("the threshold label reads as a number, not 0 (G7)", () => {
  it("keeps enough digits for a rate under 1/min", async () => {
    const { formatValue } = await import("../coverageSeries");
    const def = { signal: "errors", titleKey: "x", unit: "perMin", base: 0, spread: 0 } as never;
    expect(formatValue(def, 1 / 60)).toBe("0.017/min");
    expect(formatValue(def, 0.5)).toBe("0.5/min");
    expect(formatValue(def, 3.7)).toBe("3.7/min");
    expect(formatValue(def, 0)).toBe("0/min");
  });
});
