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

// Engine tests use the REAL metrics registry + REAL base64 helpers (no mocks)
// so encode/decode and descriptor apply/read are exercised exactly as in prod.
import { describe, it, expect } from "vitest";
import {
  indexedKey,
  readIndexed,
  parseQueryIndices,
  hasAnyDeepLinkParam,
  buildUrlFromRegistry,
  applyOverridesFromRegistry,
} from "./deepLinkParams";
import { METRICS_PARAMS, defaultMetricsQuery } from "@/utils/metrics/metricsParamRegistry";
import { b64EncodeUnicode } from "@/utils/zincutils";

const PERQ = METRICS_PARAMS.filter((d) => d.scope === "perQuery");
const enc = (s: string) => b64EncodeUnicode(s) as string;

const mkState = (queries: any[] = [defaultMetricsQuery()]) => ({
  data: { type: "line", queryType: "promql", queries },
  layout: { currentQueryIndex: 3 },
});

describe("deepLinkParams · indexedKey", () => {
  it("returns the bare key for index 0 (the alias)", () => {
    expect(indexedKey("query", 0)).toBe("query");
  });
  it("returns key.i for index >= 1", () => {
    expect(indexedKey("query", 1)).toBe("query.1");
    expect(indexedKey("stream_name", 5)).toBe("stream_name.5");
  });
});

describe("deepLinkParams · readIndexed", () => {
  it("treats the bare key as index 0", () => {
    expect(readIndexed({ query: "a" }, "query", 0)).toBe("a");
  });
  it("reads the explicit .i key", () => {
    expect(readIndexed({ "query.1": "b" }, "query", 1)).toBe("b");
  });
  it("prefers the explicit .0 over the bare key (.0 wins)", () => {
    expect(readIndexed({ query: "bare", "query.0": "dot0" }, "query", 0)).toBe("dot0");
  });
  it("does NOT treat the bare key as index >= 1", () => {
    expect(readIndexed({ query: "a" }, "query", 1)).toBeUndefined();
  });
  it("returns undefined when the key is absent", () => {
    expect(readIndexed({}, "query", 0)).toBeUndefined();
    expect(readIndexed({ other: "x" }, "query", 2)).toBeUndefined();
  });
});

describe("deepLinkParams · parseQueryIndices", () => {
  it("treats the bare key as index 0", () => {
    expect(parseQueryIndices({ query: "a" }, PERQ)).toEqual([0]);
  });
  it("treats .0 as index 0", () => {
    expect(parseQueryIndices({ "query.0": "a" }, PERQ)).toEqual([0]);
  });
  it("collects contiguous indices 0,1,2", () => {
    expect(parseQueryIndices({ query: "a", "query.1": "b", "query.2": "c" }, PERQ)).toEqual([
      0, 1, 2,
    ]);
  });
  it("collects non-contiguous indices (gaps preserved here, compacted at apply)", () => {
    expect(parseQueryIndices({ "query.2": "c" }, PERQ)).toEqual([2]);
    expect(parseQueryIndices({ "query.1": "b", "query.3": "d" }, PERQ)).toEqual([1, 3]);
  });
  it("unions indices across descriptors and dedupes", () => {
    expect(parseQueryIndices({ stream_name: "s", "query.1": "q" }, PERQ)).toEqual([0, 1]);
    expect(parseQueryIndices({ "stream_name.1": "s", "query.1": "q" }, PERQ)).toEqual([1]);
  });
  it("returns a sorted result regardless of key order", () => {
    expect(parseQueryIndices({ "query.2": "c", query: "a", "query.1": "b" }, PERQ)).toEqual([
      0, 1, 2,
    ]);
  });
  it("returns [] when no per-query params are present", () => {
    expect(parseQueryIndices({ chart_type: "bar" }, PERQ)).toEqual([]);
  });
});

describe("deepLinkParams · hasAnyDeepLinkParam", () => {
  it("is true when a panel param is present", () => {
    expect(hasAnyDeepLinkParam({ chart_type: "bar" }, METRICS_PARAMS)).toBe(true);
  });
  it("is true when a bare per-query param is present", () => {
    expect(hasAnyDeepLinkParam({ stream_name: "cpu" }, METRICS_PARAMS)).toBe(true);
  });
  it("is true when an indexed per-query param is present", () => {
    expect(hasAnyDeepLinkParam({ "query.1": "x" }, METRICS_PARAMS)).toBe(true);
  });
  it("is false for an empty query", () => {
    expect(hasAnyDeepLinkParam({}, METRICS_PARAMS)).toBe(false);
  });
  it("is false when only unrelated params are present", () => {
    expect(
      hasAnyDeepLinkParam({ org_identifier: "x", refresh: "30s", period: "15m" }, METRICS_PARAMS),
    ).toBe(false);
  });
});

describe("deepLinkParams · buildUrlFromRegistry (real METRICS_PARAMS)", () => {
  const build = (intent: any) =>
    buildUrlFromRegistry(new URL("https://o2.dev/metrics"), METRICS_PARAMS, intent).searchParams;

  it("emits panel params via read()", () => {
    const sp = build({ chartType: "bar", queryType: "sql" });
    expect(sp.get("chart_type")).toBe("bar");
    expect(sp.get("query_type")).toBe("sql");
  });
  it("skips panel params that are null/empty", () => {
    expect(build({ chartType: "" }).has("chart_type")).toBe(false);
    expect(build({}).has("chart_type")).toBe(false);
  });
  it("emits the first query with the BARE key (index 0)", () => {
    const sp = build({ queries: [{ stream: "cpu", query: "rate(cpu[5m])" }] });
    expect(sp.get("stream_name")).toBe("cpu");
    expect(sp.has("stream_name.0")).toBe(false);
  });
  it("emits subsequent queries as .1, .2", () => {
    const sp = build({
      queries: [{ stream: "cpu" }, { stream: "mem" }, { stream: "disk" }],
    });
    expect(sp.get("stream_name")).toBe("cpu");
    expect(sp.get("stream_name.1")).toBe("mem");
    expect(sp.get("stream_name.2")).toBe("disk");
  });
  it("base64-encodes the query value", () => {
    const sp = build({ queries: [{ query: "rate(cpu[5m])" }] });
    expect(sp.get("query")).toBe(enc("rate(cpu[5m])"));
    expect(sp.get("query")).not.toBe("rate(cpu[5m])");
  });
  it("skips per-query values that are absent", () => {
    const sp = build({ queries: [{ stream: "cpu" }] });
    expect(sp.has("query")).toBe(false);
  });
});

describe("deepLinkParams · applyOverridesFromRegistry · panel (real)", () => {
  it("applies a valid chart_type to data.type", () => {
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { chart_type: "bar" }, state);
    expect(state.data.type).toBe("bar");
  });
  it("ignores an invalid chart_type (keeps base)", () => {
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { chart_type: "not-a-chart" }, state);
    expect(state.data.type).toBe("line");
  });
  it("maps query_type sql/promql", () => {
    const s1 = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { query_type: "sql" }, s1);
    expect(s1.data.queryType).toBe("sql");
    const s2 = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { query_type: "anything" }, s2);
    expect(s2.data.queryType).toBe("promql"); // non-sql -> promql
  });
});

describe("deepLinkParams · applyOverridesFromRegistry · per-query literal index (real)", () => {
  it("overrides queries[i] IN PLACE when the base has it (surgical)", () => {
    const base = [defaultMetricsQuery(), defaultMetricsQuery(), defaultMetricsQuery()];
    base[0].query = "q0";
    base[1].query = "q1";
    base[2].query = "q2";
    const state = mkState(base);
    const ref0 = state.data.queries[0];
    applyOverridesFromRegistry(METRICS_PARAMS, { "query.1": enc("OVERRIDDEN") }, state);
    expect(state.data.queries).toHaveLength(3);
    expect(state.data.queries[0]).toBe(ref0); // same ref, untouched
    expect(state.data.queries[0].query).toBe("q0");
    expect(state.data.queries[1].query).toBe("OVERRIDDEN");
    expect(state.data.queries[1].customQuery).toBe(true);
    expect(state.data.queries[2].query).toBe("q2");
  });

  it("appends a cloned default beyond the base length", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(METRICS_PARAMS, { query: enc("A"), "query.1": enc("B") }, state, {
      makeDefaultQuery: defaultMetricsQuery,
    });
    expect(state.data.queries).toHaveLength(2);
    expect(state.data.queries[0].query).toBe("A");
    expect(state.data.queries[1].query).toBe("B");
  });

  it("base64-decodes the query and marks it custom", () => {
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { query: enc("rate(cpu[5m])") }, state);
    expect(state.data.queries[0].query).toBe("rate(cpu[5m])");
    expect(state.data.queries[0].customQuery).toBe(true);
  });

  it("applies stream_name to fields.stream and forces stream_type=metrics", () => {
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { stream_name: "cpu" }, state);
    expect(state.data.queries[0].fields.stream).toBe("cpu");
    expect(state.data.queries[0].fields.stream_type).toBe("metrics");
  });

  it("honors '.0 wins over bare' when applying index 0", () => {
    const state = mkState();
    applyOverridesFromRegistry(
      METRICS_PARAMS,
      { query: enc("bare"), "query.0": enc("dot0") },
      state,
    );
    expect(state.data.queries[0].query).toBe("dot0");
  });

  it("resets layout.currentQueryIndex to 0", () => {
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { stream_name: "cpu" }, state);
    expect(state.layout.currentQueryIndex).toBe(0);
  });

  it("invokes onIndexApplied once per addressed index", () => {
    const calls: number[] = [];
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(
      METRICS_PARAMS,
      { stream_name: "cpu", "stream_name.1": "mem" },
      state,
      {
        makeDefaultQuery: defaultMetricsQuery,
        onIndexApplied: (_slot, index) => calls.push(index),
      },
    );
    expect(calls).toEqual([0, 1]);
  });

  it("leaves queries untouched when no per-query params are present", () => {
    const state = mkState([defaultMetricsQuery()]);
    state.data.queries[0].query = "keep";
    applyOverridesFromRegistry(METRICS_PARAMS, { chart_type: "bar" }, state);
    expect(state.data.queries).toHaveLength(1);
    expect(state.data.queries[0].query).toBe("keep");
  });

  it("does not crash when state has no layout", () => {
    const state: any = { data: { queries: [defaultMetricsQuery()] } };
    expect(() =>
      applyOverridesFromRegistry(METRICS_PARAMS, { stream_name: "cpu" }, state),
    ).not.toThrow();
    expect(state.data.queries[0].fields.stream).toBe("cpu");
  });
});

describe("deepLinkParams · applyOverridesFromRegistry · compactIndices (real)", () => {
  const opts = { makeDefaultQuery: defaultMetricsQuery, compactIndices: true };

  it("compacts a leading gap: query.1 only -> one query at slot 0", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(METRICS_PARAMS, { "query.1": enc("B") }, state, opts);
    expect(state.data.queries).toHaveLength(1);
    expect(state.data.queries[0].query).toBe("B");
  });

  it("compacts a double gap: query.2 + query.5 -> slots 0,1", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(
      METRICS_PARAMS,
      { "query.2": enc("X"), "query.5": enc("Y") },
      state,
      opts,
    );
    expect(state.data.queries).toHaveLength(2);
    expect(state.data.queries[0].query).toBe("X");
    expect(state.data.queries[1].query).toBe("Y");
  });

  it("keeps contiguous query.0 + query.1 as two queries", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(
      METRICS_PARAMS,
      { "query.0": enc("A"), "query.1": enc("B") },
      state,
      opts,
    );
    expect(state.data.queries).toHaveLength(2);
    expect(state.data.queries[0].query).toBe("A");
    expect(state.data.queries[1].query).toBe("B");
  });

  it("does NOT compact when compactIndices is false (leaves an empty base slot)", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(METRICS_PARAMS, { "query.1": enc("B") }, state, {
      makeDefaultQuery: defaultMetricsQuery,
    });
    expect(state.data.queries).toHaveLength(2);
    expect(state.data.queries[0].query).toBe(""); // untouched base default
    expect(state.data.queries[1].query).toBe("B");
  });
});

describe("deepLinkParams · query honored verbatim (custom) vs builder mode", () => {
  it("honors a provided query VERBATIM and marks it custom (no decomposition)", () => {
    const state = mkState();
    const raw = 'sum(rate(http_requests_total{job="api",code="500"}[5m]))';
    applyOverridesFromRegistry(METRICS_PARAMS, { query: enc(raw) }, state);
    expect(state.data.queries[0].query).toBe(raw); // exact text, untouched
    expect(state.data.queries[0].customQuery).toBe(true);
  });

  it("keeps a stream_name-only slot in BUILDER mode (customQuery stays false)", () => {
    const state = mkState(); // default slot: customQuery = false
    applyOverridesFromRegistry(METRICS_PARAMS, { stream_name: "cpu" }, state);
    expect(state.data.queries[0].fields.stream).toBe("cpu");
    expect(state.data.queries[0].customQuery).toBe(false); // still builder
    expect(state.data.queries[0].query).toBe(""); // no query seeded by overrides
  });

  it("stream_name + query together: the query wins and stays custom/verbatim", () => {
    const state = mkState();
    const raw = "rate(node_cpu_seconds_total[5m])";
    applyOverridesFromRegistry(METRICS_PARAMS, { stream_name: "cpu", query: enc(raw) }, state);
    expect(state.data.queries[0].fields.stream).toBe("cpu");
    expect(state.data.queries[0].query).toBe(raw); // authoritative, verbatim
    expect(state.data.queries[0].customQuery).toBe(true); // custom, not decomposed
  });

  it("derives custom vs builder PER INDEX (q0 custom, q1 builder)", () => {
    const state = mkState([defaultMetricsQuery()]);
    applyOverridesFromRegistry(
      METRICS_PARAMS,
      { query: enc("up"), "stream_name.1": "mem" },
      state,
      { makeDefaultQuery: defaultMetricsQuery },
    );
    expect(state.data.queries[0].customQuery).toBe(true); // has query -> custom
    expect(state.data.queries[0].query).toBe("up");
    expect(state.data.queries[1].customQuery).toBe(false); // stream only -> builder
    expect(state.data.queries[1].fields.stream).toBe("mem");
    expect(state.data.queries[1].query).toBe("");
  });

  it("there is no separate `custom` param — customQuery is derived from query presence", () => {
    // a bare custom flag is meaningless; only the presence of `query` flips it
    const state = mkState();
    applyOverridesFromRegistry(METRICS_PARAMS, { custom: "false", query: enc("up") } as any, state);
    expect(state.data.queries[0].customQuery).toBe(true); // query presence wins
  });
});
