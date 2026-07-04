// Copyright 2026 OpenObserve Inc.
//
// Tests for the LLM Insights fetch orchestrator composable.
// We mock the streaming search backend and the vuex store so the
// callbacks (`data`, `error`, `complete`) can be driven directly from
// each test, isolating the composable's transformation/state logic.

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() must be hoisted above all imports.
// ---------------------------------------------------------------------------

const mockCancelStreamQuery = vi.fn();
const mockFetchQueryDataWithHttpStream = vi.fn();
const mockStoreState = {
  selectedOrganization: { identifier: "test-org" },
  zoConfig: { sql_base64_enabled: false },
};

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQuery,
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: mockStoreState })),
}));

// Predictable trace IDs make the cancel-by-id tests deterministic. We
// increment a counter so each generated id is unique within a test.
let traceIdCounter = 0;
vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceId: `trace-${++traceIdCounter}`,
  })),
  b64EncodeUnicode: vi.fn((s: string) => `b64(${s})`),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isRef } from "vue";
import { useLLMInsights } from "./useLLMInsights";

beforeEach(() => {
  vi.clearAllMocks();
  traceIdCounter = 0;
  mockStoreState.zoConfig.sql_base64_enabled = false;
});

/**
 * Helper — drive a single-row response into a query's callbacks.
 * Matches the shape returned by the real streaming endpoint.
 */
function driveKpiHits(callbacks: any, row: Record<string, number>) {
  callbacks.data(null, { content: { results: { hits: [row] } } });
}

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe("useLLMInsights — return shape", () => {
  it("exposes the documented refs and methods", () => {
    const api = useLLMInsights();
    // Refs
    expect(isRef(api.kpi)).toBe(true);
    expect(isRef(api.sparklines)).toBe(true);
    expect(isRef(api.loading)).toBe(true);
    expect(isRef(api.p95Loading)).toBe(true);
    expect(isRef(api.error)).toBe(true);
    expect(isRef(api.hasLoadedOnce)).toBe(true);
    expect(isRef(api.availableStreams)).toBe(true);
    expect(isRef(api.streamsLoaded)).toBe(true);
    // Methods
    expect(typeof api.fetchAll).toBe("function");
    expect(typeof api.cancelAll).toBe("function");
  });

  it("starts with empty KPI / sparkline / streams state", () => {
    const { kpi, sparklines, availableStreams, streamsLoaded, hasLoadedOnce, loading, error } =
      useLLMInsights();
    expect(kpi.value).toEqual({
      requestCount: 0,
      traceCount: 0,
      errorCount: 0,
      totalTokens: 0,
      totalCost: 0,
      p95DurationMicros: 0,
    });
    expect(sparklines.value).toEqual({
      cost: [],
      tokens: [],
      traces: [],
      p95Micros: [],
      errorRate: [],
    });
    expect(availableStreams.value).toEqual([]);
    expect(streamsLoaded.value).toBe(false);
    expect(hasLoadedOnce.value).toBe(false);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  // Refs are per-mount (no module-level singleton state) — two consumers
  // get independent buckets. Enforced by code review + this test.
  it("returns independent state for separate composable instances", () => {
    const a = useLLMInsights();
    const b = useLLMInsights();
    a.kpi.value.totalCost = 42;
    expect(b.kpi.value.totalCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — early returns
// ---------------------------------------------------------------------------

describe("useLLMInsights — fetchAll early returns", () => {
  // The dashboard's onMounted fires before stream selection / time
  // resolution finishes. Bail without firing any network call so we
  // don't hit the server with empty params.
  it("returns immediately when streamName is empty", async () => {
    const { fetchAll } = useLLMInsights();
    await fetchAll("", 1, 2);
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("returns immediately when startTime is 0", async () => {
    const { fetchAll } = useLLMInsights();
    await fetchAll("default", 0, 100);
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("returns immediately when endTime is 0", async () => {
    const { fetchAll } = useLLMInsights();
    await fetchAll("default", 100, 0);
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("does not flip loading=true on a no-op call", async () => {
    const { fetchAll, loading } = useLLMInsights();
    await fetchAll("", 1, 2);
    expect(loading.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — happy path
// ---------------------------------------------------------------------------

describe("useLLMInsights — fetchAll fires 2 parallel queries", () => {
  it("kicks off histogram summary + P95 in parallel", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);
    // histogram (summary + sparklines), whole-window P95 = 2 calls
    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(2);
  });

  // The histogram interval is intentionally NOT passed — the backend
  // picks an appropriate bucket width for the query window. We assert
  // `histogram(_timestamp)` with no second argument.
  it("does not pass an explicit interval to histogram()", () => {
    const { fetchAll } = useLLMInsights();
    const start = 1_000_000;
    const end = start + 12 * 60 * 60 * 1_000_000;
    fetchAll("default", start, end);

    const calls = mockFetchQueryDataWithHttpStream.mock.calls;
    const sparklineCall = calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    expect(sparklineCall).toBeTruthy();
    const sql: string = sparklineCall![0].queryReq.query.sql;
    expect(sql).toContain("histogram(_timestamp)");
    // No interval literal like histogram(_timestamp, '15 minutes').
    expect(sql).not.toMatch(/histogram\(_timestamp,/);
  });
});

describe("useLLMInsights — fetchAll resolves and populates KPI on success", () => {
  // The additive KPI totals (requests/traces/errors/tokens/cost) are
  // SUMMED across the histogram buckets; P95 comes from its own
  // whole-window query. call 0 = histogram, call 1 = P95.
  it("sums histogram buckets for totals and takes P95 from its own query", async () => {
    const { fetchAll, kpi, hasLoadedOnce, error } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    // The mock keeps every fetch's callbacks; complete each in turn.
    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );

    // Histogram — two buckets that sum to the whole-window totals.
    allCallbacks[0].data(null, {
      content: {
        results: {
          hits: [
            { ts: "1970-01-01T00:00:00", request_count: 60, trace_count: 15, error_count: 2, total_tokens: 30_000, total_cost: 0.73, p95_duration: 8_000 },
            { ts: "1970-01-01T00:00:10", request_count: 40, trace_count: 10, error_count: 1, total_tokens: 20_000, total_cost: 0.5, p95_duration: 9_000 },
          ],
        },
      },
    });
    allCallbacks[0].complete();

    // P95 — the one whole-window aggregate.
    driveKpiHits(allCallbacks[1], { p95_duration: 9_000 });
    allCallbacks[1].complete();

    await promise;

    expect(kpi.value).toEqual({
      requestCount: 100,
      traceCount: 25,
      errorCount: 3,
      totalTokens: 50_000,
      totalCost: 1.23,
      p95DurationMicros: 9_000,
    });
    expect(hasLoadedOnce.value).toBe(true);
    expect(error.value).toBeNull();
  });

  // The strip must NOT wait on the (slower) P95 query. `loading` clears the
  // moment the histogram lands, while `p95Loading` stays true until P95 does.
  it("clears `loading` when the histogram lands but keeps `p95Loading` until P95 resolves", async () => {
    const { fetchAll, loading, p95Loading, kpi, hasLoadedOnce } =
      useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    expect(loading.value).toBe(true);
    expect(p95Loading.value).toBe(true);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );

    // Histogram lands first — strip is ready, P95 still in flight.
    allCallbacks[0].data(null, {
      content: {
        results: {
          hits: [
            { ts: "1970-01-01T00:00:00", request_count: 5, trace_count: 3, error_count: 0, total_tokens: 100, total_cost: 0.5, p95_duration: 0 },
          ],
        },
      },
    });
    allCallbacks[0].complete();
    // Flush the summary promise chain (executeQuery → .then → .finally).
    await new Promise((r) => setTimeout(r));

    expect(loading.value).toBe(false);
    expect(hasLoadedOnce.value).toBe(true);
    expect(kpi.value.totalCost).toBe(0.5);
    // P95 hasn't resolved yet → its loader is still up.
    expect(p95Loading.value).toBe(true);

    // Now P95 resolves.
    driveKpiHits(allCallbacks[1], { p95_duration: 7_000 });
    allCallbacks[1].complete();
    await promise;

    expect(p95Loading.value).toBe(false);
    expect(kpi.value.p95DurationMicros).toBe(7_000);
  });

  // A P95 failure degrades that card to 0 without failing the whole strip.
  it("degrades P95 to 0 and leaves the strip intact when the P95 query fails", async () => {
    const { fetchAll, kpi, error, p95Loading, hasLoadedOnce } =
      useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );

    // Histogram succeeds.
    allCallbacks[0].data(null, {
      content: {
        results: {
          hits: [
            { ts: "1970-01-01T00:00:00", request_count: 5, trace_count: 3, error_count: 0, total_tokens: 100, total_cost: 0.5, p95_duration: 0 },
          ],
        },
      },
    });
    allCallbacks[0].complete();
    // P95 fails.
    allCallbacks[1].error({ message: "boom" });
    await promise;

    expect(kpi.value.totalCost).toBe(0.5);
    expect(kpi.value.p95DurationMicros).toBe(0);
    expect(p95Loading.value).toBe(false);
    expect(hasLoadedOnce.value).toBe(true);
    // Strip survives — the P95 failure is not surfaced as a page error.
    expect(error.value).toBeNull();
  });

  // Defensive: a row with missing/garbage numeric fields shouldn't crash
  // the page — every field coerces with `Number(x) || 0`.
  it("coerces missing / NaN numeric fields to 0", async () => {
    const { fetchAll, kpi } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    // Histogram bucket with garbage.
    driveKpiHits(allCallbacks[0], { request_count: "not-a-number" } as any);
    allCallbacks[0].complete();
    // P95 with garbage.
    driveKpiHits(allCallbacks[1], { p95_duration: "nope" } as any);
    allCallbacks[1].complete();

    await promise;
    expect(kpi.value.requestCount).toBe(0);
    expect(kpi.value.totalCost).toBe(0);
    expect(kpi.value.p95DurationMicros).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — error path
// ---------------------------------------------------------------------------

describe("useLLMInsights — fetchAll error path", () => {
  // A failure on ANY of the two queries should populate `error.value`
  // and the dashboard renders its error state. We catch internally so
  // callers don't need a try/catch.
  it("captures error message and clears loading on rejection", async () => {
    const { fetchAll, error, loading } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    allCallbacks[0].error({ message: "schema error" });
    allCallbacks[1].complete();

    await promise;
    expect(error.value).toBe("schema error");
    expect(loading.value).toBe(false);
  });

  // Falls back to a generic message when the error response has no
  // recognizable text — ensures the UI never shows undefined.
  it("falls back to generic message when error response has no text", async () => {
    const { fetchAll, error } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    allCallbacks[0].error({});
    allCallbacks[1].complete();

    await promise;
    // message picked up by executeQuery's "Failed to fetch query data"
    // fallback, which is what fetchAll surfaces as `error.value`.
    expect(error.value).toBe("Failed to fetch query data");
  });

  // hasLoadedOnce must NOT flip true on a failed fetch — the dashboard
  // uses it to gate the empty-state ("we tried and got nothing"). A
  // failed first fetch should still show the error block instead.
  it("does not set hasLoadedOnce on failure", async () => {
    const { fetchAll, hasLoadedOnce } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    allCallbacks[0].error({ message: "x" });
    allCallbacks[1].complete();

    await promise;
    expect(hasLoadedOnce.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — sparkline accumulation
// ---------------------------------------------------------------------------

describe("useLLMInsights — sparklines accumulation", () => {
  // Single-row response → 1-element series across all 5 metrics.
  // Window 100→200µs falls into the "10 seconds" bucket; the pre-built
  // grid produces a single key "1970-01-01T00:00:00", so the row's ts
  // must match it for the data to land in the series.
  it("populates 5 series from a single bucket row", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    // Sparkline row (histogram = call 0)
    allCallbacks[0].data(null, {
      content: {
        results: {
          hits: [
            {
              ts: "1970-01-01T00:00:00",
              request_count: 10,
              trace_count: 5,
              error_count: 1,
              total_tokens: 1234,
              total_cost: 0.12,
              p95_duration: 800,
            },
          ],
        },
      },
    });
    allCallbacks[0].complete();
    // P95 = call 1
    allCallbacks[1].complete();

    await promise;
    expect(sparklines.value.cost).toEqual([0.12]);
    expect(sparklines.value.tokens).toEqual([1234]);
    expect(sparklines.value.traces).toEqual([5]);
    expect(sparklines.value.p95Micros).toEqual([800]);
    // error rate = error_count / trace_count = 1/5 = 20%
    expect(sparklines.value.errorRate).toEqual([20]);
  });

  // Multiple rows → series in grid order, same length across all metrics.
  // Window 1µs→20s (in µs) at "10 seconds" interval = grid of 2 keys:
  //   "1970-01-01T00:00:00" and "1970-01-01T00:00:10".
  // Start must be non-zero — `fetchAll` bails on `!startTime`.
  it("preserves bucket ordering across multiple rows", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 1, 20_000_000);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].data(null, {
      content: {
        results: {
          hits: [
            { ts: "1970-01-01T00:00:00", request_count: 10, error_count: 2, total_tokens: 100, total_cost: 1, p95_duration: 1, trace_count: 10 },
            { ts: "1970-01-01T00:00:10", request_count: 20, error_count: 0, total_tokens: 200, total_cost: 2, p95_duration: 2, trace_count: 20 },
          ],
        },
      },
    });
    cbs[0].complete();
    cbs[1].complete();

    await promise;
    expect(sparklines.value.tokens).toEqual([100, 200]);
    expect(sparklines.value.cost).toEqual([1, 2]);
    // error rate = error_count / trace_count: 2/10*100=20, 0/20*100=0
    expect(sparklines.value.errorRate).toEqual([20, 0]);
  });

  // Defensive: a bucket with zero requests must not divide-by-zero
  // (would yield NaN / Infinity in the chart).
  it("emits errorRate=0 for buckets with zero requests", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].data(null, {
      content: {
        results: {
          hits: [
            // trace_count=0 → no traces in window → errorRate must be 0 (not NaN/Infinity)
            { ts: "1970-01-01T00:00:00", request_count: 0, error_count: 0, total_tokens: 0, total_cost: 0, p95_duration: 0, trace_count: 0 },
          ],
        },
      },
    });
    cbs[0].complete();
    cbs[1].complete();

    await promise;
    expect(sparklines.value.errorRate).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// Error rate — regression tests for the > 100% bug
// ---------------------------------------------------------------------------

describe("useLLMInsights — error rate is always [0%, 100%]", () => {
  // Regression: previously error_count = COUNT(*) FILTER (WHERE span_status='ERROR')
  // counted ALL spans (including non-LLM tool/infra spans), while request_count
  // only counted LLM spans. On real workloads this produced values like 104350%.
  // Fix: error_count = approx_distinct(trace_id) FILTER (WHERE span_status='ERROR'),
  // denominator = approx_distinct(trace_id).
  // Since error_count ≤ trace_count by definition, rate is always ≤ 100%.

  it("sparkline errorRate never exceeds 100 even when error_count equals trace_count", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(([, c]: any) => c);
    cbs[0].data(null, {
      content: {
        results: {
          hits: [
            // All traces errored → 100%
            { ts: "1970-01-01T00:00:00", request_count: 5, trace_count: 10, error_count: 10, total_tokens: 0, total_cost: 0, p95_duration: 0 },
          ],
        },
      },
    });
    cbs[0].complete();
    cbs[1].complete();

    await promise;
    expect(sparklines.value.errorRate[0]).toBe(100);
  });

  it("sparkline errorRate is 0 when there are no error traces", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(([, c]: any) => c);
    cbs[0].data(null, {
      content: {
        results: {
          hits: [
            { ts: "1970-01-01T00:00:00", request_count: 50, trace_count: 50, error_count: 0, total_tokens: 0, total_cost: 0, p95_duration: 0 },
          ],
        },
      },
    });
    cbs[0].complete();
    cbs[1].complete();

    await promise;
    expect(sparklines.value.errorRate[0]).toBe(0);
  });

  it("KPI SQL uses approx_distinct(trace_id) FILTER for error_count (not COUNT(*))", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const kpiCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("approx_percentile_cont(duration, 0.95)"),
    );
    const sql: string = (kpiCall as any)[0].queryReq.query.sql;

    // Must NOT use COUNT(*) FILTER for errors — that counted all spans and
    // produced error rates of thousands of percent on real environments.
    expect(sql).not.toMatch(/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
    // Must use trace-level distinct count instead.
    expect(sql).toMatch(/approx_distinct\(trace_id\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
  });

  it("sparkline SQL uses approx_distinct(trace_id) FILTER for error_count", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const sparkCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    const sql: string = (sparkCall as any)[0].queryReq.query.sql;

    expect(sql).not.toMatch(/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
    expect(sql).toMatch(/approx_distinct\(trace_id\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
  });

  it("whole-window P95 SQL is a lean, LLM-scoped query (no histogram)", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    // The P95 card comes from its own whole-window query — the one that
    // has approx_percentile but is NOT the bucketed histogram.
    const p95Call = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("approx_percentile_cont(duration, 0.95)") &&
      !p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    expect(p95Call).toBeTruthy();
    const sql: string = (p95Call as any)[0].queryReq.query.sql;

    // Latency must be LLM-only — otherwise fast child/tool spans drag the tail
    // down. Scoped via FILTER (not a top-level WHERE).
    expect(sql).toMatch(
      /approx_percentile_cont\(duration, 0\.95\)\s+FILTER\s*\(WHERE\s+gen_ai_operation_name\s+IS\s+NOT\s+NULL\)/,
    );
    // It's a dedicated query — no bucketing, no token/cost rollups.
    expect(sql).not.toContain("histogram(");
    expect(sql).not.toContain("gen_ai_usage_cost");
  });

  it("sparkline SQL scopes p95 latency to LLM calls via per-aggregate FILTER", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const sparkCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    const sql: string = (sparkCall as any)[0].queryReq.query.sql;

    expect(sql).toMatch(
      /approx_percentile_cont\(duration, 0\.95\)\s+FILTER\s*\(WHERE\s+gen_ai_operation_name\s+IS\s+NOT\s+NULL\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// cancelAll
// ---------------------------------------------------------------------------

describe("useLLMInsights — cancelAll", () => {
  // Idle composable: nothing to cancel.
  it("does nothing when no queries are in flight", () => {
    const { cancelAll } = useLLMInsights();
    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });

  // After kicking off fetchAll, both trace IDs are active. cancelAll
  // should cancel them all and pass the org ID for routing.
  it("cancels every in-flight trace ID with the current org ID", () => {
    const { fetchAll, cancelAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    cancelAll();
    expect(mockCancelStreamQuery).toHaveBeenCalledTimes(2);
    // Verify both trace IDs were passed (order doesn't matter).
    const traceIds = mockCancelStreamQuery.mock.calls.map(
      (c) => (c[0] as any).trace_id,
    );
    expect(traceIds).toEqual(
      expect.arrayContaining(["trace-1", "trace-2"]),
    );
    // Every cancel includes the org id from the (mocked) store.
    for (const [arg] of mockCancelStreamQuery.mock.calls) {
      expect((arg as any).org_id).toBe("test-org");
    }
  });

  // Once a query completes, its trace ID is removed from the active list.
  it("does not cancel queries that already completed", () => {
    const { fetchAll, cancelAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].complete();
    cbs[1].complete();

    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });

  // Errored queries are also removed from the active list (the `error`
  // callback filters the trace ID out before rejecting).
  it("does not cancel queries that already errored", async () => {
    const { fetchAll, cancelAll } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].error({ message: "x" });
    cbs[1].complete();
    await promise;

    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SQL surface — light pinning
// ---------------------------------------------------------------------------

describe("useLLMInsights — SQL surface", () => {
  // Pin the column names the queries reference. A future schema rename
  // (e.g. dropping `gen_ai_*`) needs to update these together with the
  // backend, and the test failure here will point that out immediately.
  it("KPI query references the OTEL gen_ai_* fields", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const kpiCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("approx_percentile_cont(duration, 0.95)"),
    );
    expect(kpiCall).toBeTruthy();
    const sql: string = (kpiCall as any)[0].queryReq.query.sql;
    expect(sql).toContain("gen_ai_operation_name");
    expect(sql).toContain("gen_ai_usage_total_tokens");
    expect(sql).toContain("gen_ai_usage_cost");
    expect(sql).toContain("approx_distinct(trace_id)");
    // Error count is trace-level: approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR').
    // Using COUNT(*) FILTER on all spans while dividing by LLM-only request_count
    // produced values >> 100% (e.g. 104350%) on real workloads.
    expect(sql).toMatch(/approx_distinct\(trace_id\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
  });

  // Sparkline query bins by `histogram(_timestamp)` (no explicit interval —
  // the backend picks the bucket width) and groups+orders by ts. Without
  // ORDER BY, the chart x-axis is arbitrary.
  it("sparkline query buckets by histogram(_timestamp) with no interval and orders by ts", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const sparkCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    expect(sparkCall).toBeTruthy();
    const sql: string = (sparkCall as any)[0].queryReq.query.sql;
    expect(sql).toContain("histogram(_timestamp)");
    // No interval literal — backend handles bucket width.
    expect(sql).not.toMatch(/histogram\(_timestamp,/);
    expect(sql).toContain("ORDER BY ts");
  });

  // Both queries quote the stream name — important for streams whose
  // names contain hyphens, dots, or other identifier-unsafe chars.
  it("quotes the stream name in both KPI and sparkline queries", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("my-stream.test", 100, 200);

    const sqls = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([p]: any) => p.queryReq.query.sql,
    );
    for (const sql of sqls) {
      expect(sql).toContain(`FROM "my-stream.test"`);
    }
  });

  it("agent-scoped KPI and sparkline queries use direct canonical agent predicates", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("agent-stream", 100, 200, {
      name: "support-agent",
      id: "agent-123",
      source_stream: "agent-stream",
      source_stream_type: "traces",
    });

    const sqls = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([p]: any) => p.queryReq.query.sql,
    );
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) {
      expect(sql).toContain(`gen_ai_agent_id = 'agent-123'`);
      expect(sql).not.toContain("trace_id IN (SELECT trace_id");
    }
  });
});
