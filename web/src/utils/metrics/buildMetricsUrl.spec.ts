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
import { applyDeepLinkOverrides } from "@/composables/metrics/metricsUrlState";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import store from "@/stores";

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

  it("emits a full link (base + time + refresh + types + multi-query) together", () => {
    const sp = build({
      base: "BLOB",
      time: { from: 100, to: 200 },
      refresh: "30s",
      chartType: "bar",
      queryType: "promql",
      queries: [
        { stream: "cpu", query: "a" },
        { stream: "mem", query: "b" },
      ],
    }).searchParams;
    expect(sp.get("org_identifier")).toBe("default");
    expect(sp.get("metrics_data")).toBe("BLOB");
    expect(sp.get("from")).toBe("100");
    expect(sp.get("to")).toBe("200");
    expect(sp.get("refresh")).toBe("30s");
    expect(sp.get("chart_type")).toBe("bar");
    expect(sp.get("query_type")).toBe("promql");
    expect(sp.get("stream_name")).toBe("cpu");
    expect(sp.get("stream_name.1")).toBe("mem");
    expect(sp.get("query")).toBe(b64EncodeUnicode("a"));
    expect(sp.get("query.1")).toBe(b64EncodeUnicode("b"));
  });
});

// End-to-end: a link produced by buildMetricsUrl must reconstruct the same
// intent when consumed by applyDeepLinkOverrides (build <-> apply round-trip).
describe("buildMetricsUrl <-> applyDeepLinkOverrides round-trip", () => {
  const toQueryObject = (url: URL) => {
    const q: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (q[k] = v));
    return q;
  };

  it("reconstructs a multi-query intent (chart type, query type, streams, queries)", () => {
    const url = buildMetricsUrl({
      orgId: "default",
      baseUrl: BASE,
      chartType: "bar",
      queryType: "promql",
      queries: [
        { stream: "cpu", query: "rate(cpu[5m])" },
        { stream: "mem", query: "rate(mem[5m])" },
      ],
    });
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(toQueryObject(url), dpd);

    expect(dpd.data.type).toBe("bar");
    expect(dpd.data.queryType).toBe("promql");
    expect(dpd.data.queries).toHaveLength(2);
    expect(dpd.data.queries[0].fields.stream).toBe("cpu");
    expect(dpd.data.queries[0].query).toBe("rate(cpu[5m])");
    expect(dpd.data.queries[0].customQuery).toBe(true);
    expect(dpd.data.queries[1].fields.stream).toBe("mem");
    expect(dpd.data.queries[1].query).toBe("rate(mem[5m])");
  });

  it("reconstructs a builder-mode single-query intent (stream only)", () => {
    const url = buildMetricsUrl({
      orgId: "default",
      baseUrl: BASE,
      queries: [{ stream: "cpu" }],
    });
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(toQueryObject(url), dpd);

    expect(dpd.data.queries[0].fields.stream).toBe("cpu");
    expect(dpd.data.queries[0].customQuery).toBe(false); // builder, no query
  });

  it("survives a query with PromQL special chars through base64", () => {
    const raw = 'sum(rate(http_requests_total{job="api",code="500"}[5m]))';
    const url = buildMetricsUrl({
      orgId: "default",
      baseUrl: BASE,
      queries: [{ query: raw }],
    });
    const dpd = getDefaultDashboardPanelData(store);
    applyDeepLinkOverrides(toQueryObject(url), dpd);
    expect(dpd.data.queries[0].query).toBe(raw);
  });
});
