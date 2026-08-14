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

import { describe, it, expect } from "vitest";
import { sanitizeChartType, defaultMetricsQuery, METRICS_PARAMS } from "./metricsParamRegistry";
import { b64EncodeUnicode } from "@/utils/zincutils";
import type { ParamDescriptor } from "@/utils/url/deepLinkParams";
import {
  METRICS_EDITOR_PARAM_KEYS,
  hasMetricsEditorParams,
} from "@/utils/metrics/metricsEditorParams";

const byKey = (key: string) => METRICS_PARAMS.find((d) => d.key === key) as ParamDescriptor;

describe("metricsParamRegistry · sanitizeChartType", () => {
  it.each(["line", "bar", "area", "scatter", "table", "gauge", "h-bar"])(
    "accepts the valid chart type %s",
    (t) => {
      expect(sanitizeChartType(t)).toBe(t);
    },
  );
  it("rejects an unknown chart type", () => {
    expect(sanitizeChartType("not-a-chart")).toBeNull();
  });
  it("rejects an empty string", () => {
    expect(sanitizeChartType("")).toBeNull();
  });
});

describe("metricsParamRegistry · defaultMetricsQuery", () => {
  it("forces stream_type to metrics (not the logs default)", () => {
    expect(defaultMetricsQuery().fields.stream_type).toBe("metrics");
  });
  it("has the expected query slot shape", () => {
    const q = defaultMetricsQuery();
    expect(q).toHaveProperty("query");
    expect(q).toHaveProperty("customQuery");
    expect(q).toHaveProperty("fields");
    expect(q).toHaveProperty("config");
  });
  it("returns a fresh clone each call (no shared reference)", () => {
    const a = defaultMetricsQuery();
    const b = defaultMetricsQuery();
    expect(a).not.toBe(b);
    a.fields.stream = "mutated";
    expect(b.fields.stream).not.toBe("mutated");
  });
});

describe("metricsParamRegistry · chart_type descriptor", () => {
  const d = byKey("chart_type");
  it("is panel-scoped", () => expect(d.scope).toBe("panel"));
  it("applies a valid type to data.type", () => {
    const dpd: any = { data: { type: "line" } };
    d.apply(dpd, "bar", {});
    expect(dpd.data.type).toBe("bar");
  });
  it("ignores an invalid type (keeps base)", () => {
    const dpd: any = { data: { type: "line" } };
    d.apply(dpd, "nope", {});
    expect(dpd.data.type).toBe("line");
  });
  it("reads chartType from the intent", () => {
    expect(d.read?.({ chartType: "area" })).toBe("area");
  });
});

describe("metricsParamRegistry · query_type descriptor", () => {
  const d = byKey("query_type");
  it("is panel-scoped", () => expect(d.scope).toBe("panel"));
  it("maps 'sql' to sql", () => {
    const dpd: any = { data: { queryType: "promql" } };
    d.apply(dpd, "sql", {});
    expect(dpd.data.queryType).toBe("sql");
  });
  it("maps any non-sql value to promql", () => {
    const dpd: any = { data: { queryType: "sql" } };
    d.apply(dpd, "whatever", {});
    expect(dpd.data.queryType).toBe("promql");
  });
  it("reads queryType from the intent", () => {
    expect(d.read?.({ queryType: "sql" })).toBe("sql");
  });
});

describe("metricsParamRegistry · stream_name descriptor", () => {
  const d = byKey("stream_name");
  it("is per-query-scoped", () => expect(d.scope).toBe("perQuery"));
  it("sets fields.stream and forces stream_type=metrics", () => {
    const slot: any = { fields: { stream: "", stream_type: "logs" } };
    d.apply(slot, "cpu", {});
    expect(slot.fields.stream).toBe("cpu");
    expect(slot.fields.stream_type).toBe("metrics");
  });
  it("creates the fields object if missing", () => {
    const slot: any = {};
    d.apply(slot, "cpu", {});
    expect(slot.fields.stream).toBe("cpu");
  });
  it("reads stream from the per-query intent", () => {
    expect(d.read?.({ stream: "mem" })).toBe("mem");
  });
});

describe("metricsParamRegistry · query descriptor", () => {
  const d = byKey("query");
  it("is per-query-scoped", () => expect(d.scope).toBe("perQuery"));
  it("base64-decodes and marks the slot custom", () => {
    const slot: any = { query: "", customQuery: false };
    d.apply(slot, d.decode?.(b64EncodeUnicode("rate(cpu[5m])") as string), {});
    expect(slot.query).toBe("rate(cpu[5m])");
    expect(slot.customQuery).toBe(true);
  });
  it("encode/decode round-trips a query string", () => {
    const raw = 'sum(rate(http_requests_total{job="api"}[5m]))';
    expect(d.decode?.(d.encode?.(raw) as string)).toBe(raw);
  });
  it("decodes invalid base64 to an empty string (never throws)", () => {
    expect(d.decode?.("!!!not-base64!!!")).toBe("");
  });
  it("reads query from the per-query intent", () => {
    expect(d.read?.({ query: "up" })).toBe("up");
  });
});

describe("metricsEditorParams stays in sync with the registry", () => {
  it("covers every registry key and alias", () => {
    // The router guard cannot import METRICS_PARAMS (that would pull the Vuex
    // store into the router's module graph), so it uses a standalone key list.
    // If a param is added to the registry and not to that list, a deep link
    // carrying it would land on the explorer instead of the editor.
    const registryKeys = METRICS_PARAMS.flatMap((p: any) => [p.key, ...(p.aliases ?? [])]);

    for (const key of registryKeys) {
      expect(METRICS_EDITOR_PARAM_KEYS).toContain(key);
    }
  });

  it("detects the whole-panel blob and indexed per-query params", () => {
    expect(hasMetricsEditorParams({ metrics_data: "abc" })).toBe(true);
    expect(hasMetricsEditorParams({ stream_name: "cpu" })).toBe(true);
    // perQuery params are indexed; a multi-query shared link must still be
    // recognized as an editor deep link.
    expect(hasMetricsEditorParams({ "query.1": "x" })).toBe(true);
    expect(hasMetricsEditorParams({ org_identifier: "o", period: "15m" })).toBe(false);
    expect(hasMetricsEditorParams({})).toBe(false);
    expect(hasMetricsEditorParams(undefined)).toBe(false);
  });
});
