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

// `buildMetricsUrl` is pure (real registry + real base64). `openMetricsDeepLink`
// is network + window.open glue (external I/O) and is left to e2e coverage.
import { describe, it, expect } from "vitest";
import { buildMetricsUrl } from "./buildMetricsUrl";
import { b64EncodeUnicode } from "@/utils/zincutils";

const BASE = "https://o2.example/web";
const build = (intent: any) =>
  buildMetricsUrl({ orgId: "default", baseUrl: BASE, ...intent });

describe("buildMetricsUrl", () => {
  it("targets /metrics under the given base and sets org_identifier", () => {
    const url = build({});
    expect(url.pathname).toBe("/web/metrics");
    expect(url.searchParams.get("org_identifier")).toBe("default");
  });

  it("emits the metrics_data base blob when provided", () => {
    expect(build({ base: "BLOB" }).searchParams.get("metrics_data")).toBe(
      "BLOB",
    );
  });

  it("emits a relative period", () => {
    expect(
      build({ time: { period: "15m" } }).searchParams.get("period"),
    ).toBe("15m");
  });

  it("emits absolute from/to", () => {
    const sp = build({ time: { from: 1000, to: 2000 } }).searchParams;
    expect(sp.get("from")).toBe("1000");
    expect(sp.get("to")).toBe("2000");
  });

  it("emits refresh", () => {
    expect(build({ refresh: "30s" }).searchParams.get("refresh")).toBe("30s");
  });

  it("emits chart_type and query_type", () => {
    const sp = build({ chartType: "bar", queryType: "sql" }).searchParams;
    expect(sp.get("chart_type")).toBe("bar");
    expect(sp.get("query_type")).toBe("sql");
  });

  it("emits a single query with bare keys (index 0) and base64-encodes the query", () => {
    const sp = build({
      queries: [{ stream: "cpu", query: "rate(cpu[5m])" }],
    }).searchParams;
    expect(sp.get("stream_name")).toBe("cpu");
    expect(sp.has("stream_name.0")).toBe(false);
    expect(sp.get("query")).toBe(b64EncodeUnicode("rate(cpu[5m])"));
    expect(sp.get("query")).not.toBe("rate(cpu[5m])");
  });

  it("emits multiple queries (bare for q0, .1 for q1)", () => {
    const sp = build({
      queries: [
        { stream: "cpu", query: "a" },
        { stream: "mem", query: "b" },
      ],
    }).searchParams;
    expect(sp.get("stream_name")).toBe("cpu");
    expect(sp.get("stream_name.1")).toBe("mem");
    expect(sp.get("query")).toBe(b64EncodeUnicode("a"));
    expect(sp.get("query.1")).toBe(b64EncodeUnicode("b"));
  });

  it("emits no per-query params when there are no queries", () => {
    const sp = build({ chartType: "line" }).searchParams;
    expect(sp.has("stream_name")).toBe(false);
    expect(sp.has("query")).toBe(false);
  });

  it("round-trips through toString()/new URL()", () => {
    const url = build({ chartType: "bar", queries: [{ stream: "cpu" }] });
    const reparsed = new URL(url.toString());
    expect(reparsed.searchParams.get("chart_type")).toBe("bar");
    expect(reparsed.searchParams.get("stream_name")).toBe("cpu");
  });
});
