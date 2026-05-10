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
 * Helper — drive a single (current-window) KPI fetchKPIInto callback.
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
    expect(isRef(api.kpiPrev)).toBe(true);
    expect(isRef(api.sparklines)).toBe(true);
    expect(isRef(api.loading)).toBe(true);
    expect(isRef(api.error)).toBe(true);
    expect(isRef(api.hasLoadedOnce)).toBe(true);
    expect(isRef(api.availableStreams)).toBe(true);
    expect(isRef(api.streamsLoaded)).toBe(true);
    // Methods
    expect(typeof api.fetchAll).toBe("function");
    expect(typeof api.cancelAll).toBe("function");
  });

  it("starts with empty KPI / sparkline / streams state", () => {
    const { kpi, kpiPrev, sparklines, availableStreams, streamsLoaded, hasLoadedOnce, loading, error } =
      useLLMInsights();
    expect(kpi.value).toEqual({
      requestCount: 0,
      traceCount: 0,
      errorCount: 0,
      totalTokens: 0,
      totalCost: 0,
      avgDurationMicros: 0,
      p95DurationMicros: 0,
    });
    expect(kpiPrev.value).toEqual(kpi.value);
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

describe("useLLMInsights — fetchAll fires 3 parallel queries", () => {
  it("kicks off KPI(current) + KPI(prev) + sparklines in parallel", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);
    // KPI cur, KPI prev, sparklines = 3 calls
    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(3);
  });

  // The "previous" window is computed as the same-length window
  // immediately preceding the current one — drives the "% vs prev" trend.
  it("derives the previous window as immediately preceding (same length)", () => {
    const { fetchAll } = useLLMInsights();
    // current window: [1000, 1100] (length 100)
    // prev window:    [900, 1000]  (length 100)
    fetchAll("default", 1000, 1100);

    const calls = mockFetchQueryDataWithHttpStream.mock.calls;
    const queryWindows = calls.map(([payload]: any) => ({
      start: payload.queryReq.query.start_time,
      end: payload.queryReq.query.end_time,
    }));

    // One of the calls is the prev window:
    expect(queryWindows).toContainEqual({ start: 900, end: 1000 });
    // And one is the current window:
    expect(queryWindows).toContainEqual({ start: 1000, end: 1100 });
  });

  // The sparkline query references `histogram(_timestamp, '<interval>')`
  // — the interval must be picked from the window duration.
  it("chooses the histogram interval based on window duration", () => {
    const { fetchAll } = useLLMInsights();
    // 12 hour window → "15 minutes" per pickInterval table.
    // Start must be non-zero — fetchAll's guard treats 0 as falsy.
    const start = 1_000_000;
    const end = start + 12 * 60 * 60 * 1_000_000;
    fetchAll("default", start, end);

    const calls = mockFetchQueryDataWithHttpStream.mock.calls;
    const sparklineCall = calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    expect(sparklineCall).toBeTruthy();
    expect(sparklineCall![0].queryReq.query.sql).toContain("'15 minutes'");
  });
});

describe("useLLMInsights — fetchAll resolves and populates KPI on success", () => {
  it("populates kpi (current window) from the first KPI response", async () => {
    const { fetchAll, kpi, hasLoadedOnce, error } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    // The mock keeps every fetch's callbacks; complete each in turn.
    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );

    // KPI(current)
    driveKpiHits(allCallbacks[0], {
      request_count: 100,
      trace_count: 25,
      error_count: 3,
      total_tokens: 50_000,
      total_cost: 1.23,
      avg_duration: 4_000,
      p95_duration: 9_000,
    });
    allCallbacks[0].complete();

    // KPI(prev) — minimal
    driveKpiHits(allCallbacks[1], {
      request_count: 50,
      trace_count: 10,
      error_count: 1,
      total_tokens: 25_000,
      total_cost: 0.5,
      avg_duration: 2_000,
      p95_duration: 5_000,
    });
    allCallbacks[1].complete();

    // Sparklines — no rows
    allCallbacks[2].complete();

    await promise;

    expect(kpi.value).toEqual({
      requestCount: 100,
      traceCount: 25,
      errorCount: 3,
      totalTokens: 50_000,
      totalCost: 1.23,
      avgDurationMicros: 4_000,
      p95DurationMicros: 9_000,
    });
    expect(hasLoadedOnce.value).toBe(true);
    expect(error.value).toBeNull();
  });

  // Defensive: a row with missing/garbage numeric fields shouldn't crash
  // the page — the helper coerces with `Number(x) || 0`.
  it("coerces missing / NaN numeric fields to 0", async () => {
    const { fetchAll, kpi } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    driveKpiHits(allCallbacks[0], { request_count: "not-a-number" });
    allCallbacks[0].complete();
    allCallbacks[1].complete();
    allCallbacks[2].complete();

    await promise;
    expect(kpi.value.requestCount).toBe(0);
    expect(kpi.value.totalCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — error path
// ---------------------------------------------------------------------------

describe("useLLMInsights — fetchAll error path", () => {
  // A failure on ANY of the three queries should populate `error.value`
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
    allCallbacks[2].complete();

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
    allCallbacks[2].complete();

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
    allCallbacks[2].complete();

    await promise;
    expect(hasLoadedOnce.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — sparkline accumulation
// ---------------------------------------------------------------------------

describe("useLLMInsights — sparklines accumulation", () => {
  // Single-row response → 1-element series across all 5 metrics.
  it("populates 5 series from a single bucket row", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const allCallbacks = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, cbs]: any) => cbs,
    );
    allCallbacks[0].complete();
    allCallbacks[1].complete();
    // Sparkline row
    allCallbacks[2].data(null, {
      content: {
        results: {
          hits: [
            {
              ts: "2026-05-08T12:00:00Z",
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
    allCallbacks[2].complete();

    await promise;
    expect(sparklines.value.cost).toEqual([0.12]);
    expect(sparklines.value.tokens).toEqual([1234]);
    expect(sparklines.value.traces).toEqual([5]);
    expect(sparklines.value.p95Micros).toEqual([800]);
    // error rate = 1/10 = 10%
    expect(sparklines.value.errorRate).toEqual([10]);
  });

  // Multiple rows → series in row order, same length across all metrics.
  it("preserves bucket ordering across multiple rows", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].complete();
    cbs[1].complete();
    cbs[2].data(null, {
      content: {
        results: {
          hits: [
            { ts: "T1", request_count: 10, error_count: 2, total_tokens: 100, total_cost: 1, p95_duration: 1, trace_count: 1 },
            { ts: "T2", request_count: 20, error_count: 0, total_tokens: 200, total_cost: 2, p95_duration: 2, trace_count: 2 },
          ],
        },
      },
    });
    cbs[2].complete();

    await promise;
    expect(sparklines.value.tokens).toEqual([100, 200]);
    expect(sparklines.value.cost).toEqual([1, 2]);
    expect(sparklines.value.errorRate).toEqual([20, 0]); // 2/10*100, 0/20*100
  });

  // Defensive: a bucket with zero requests must not divide-by-zero
  // (would yield NaN / Infinity in the chart).
  it("emits errorRate=0 for buckets with zero requests", async () => {
    const { fetchAll, sparklines } = useLLMInsights();
    const promise = fetchAll("default", 100, 200);

    const cbs = mockFetchQueryDataWithHttpStream.mock.calls.map(
      ([, c]: any) => c,
    );
    cbs[0].complete();
    cbs[1].complete();
    cbs[2].data(null, {
      content: {
        results: {
          hits: [
            { ts: "T1", request_count: 0, error_count: 5, total_tokens: 0, total_cost: 0, p95_duration: 0, trace_count: 0 },
          ],
        },
      },
    });
    cbs[2].complete();

    await promise;
    expect(sparklines.value.errorRate).toEqual([0]);
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

  // After kicking off fetchAll, all 3 trace IDs are active. cancelAll
  // should cancel them all and pass the org ID for routing.
  it("cancels every in-flight trace ID with the current org ID", () => {
    const { fetchAll, cancelAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    cancelAll();
    expect(mockCancelStreamQuery).toHaveBeenCalledTimes(3);
    // Verify all three trace IDs were passed (order doesn't matter).
    const traceIds = mockCancelStreamQuery.mock.calls.map(
      (c) => (c[0] as any).trace_id,
    );
    expect(traceIds).toEqual(
      expect.arrayContaining(["trace-1", "trace-2", "trace-3"]),
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
    cbs[2].complete();

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
    cbs[2].complete();
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
    // Errors deliberately drop the gen_ai filter — see fetchKPIInto comment.
    expect(sql).toMatch(/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+span_status\s*=\s*'ERROR'\)/);
  });

  // Sparkline query bins by `histogram(_timestamp, ...)` and groups+orders
  // by ts. Verify both invariants — without ORDER BY, the chart x-axis
  // is arbitrary.
  it("sparkline query buckets by histogram(_timestamp) and orders by ts", () => {
    const { fetchAll } = useLLMInsights();
    fetchAll("default", 100, 200);

    const sparkCall = mockFetchQueryDataWithHttpStream.mock.calls.find(([p]: any) =>
      p.queryReq.query.sql.includes("GROUP BY ts"),
    );
    expect(sparkCall).toBeTruthy();
    const sql: string = (sparkCall as any)[0].queryReq.query.sql;
    expect(sql).toMatch(/histogram\(_timestamp,\s*'[^']+'\)/);
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
});
