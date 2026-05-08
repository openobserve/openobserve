// Copyright 2026 OpenObserve Inc.
//
// Tests for the thin SQL query runner used by LLM Insights panels.
// We mock the underlying streaming search (`useStreamingSearch`) so we
// can drive `data`/`error`/`complete` callbacks directly from each test
// and verify the resulting promise resolution + accumulation behaviour.

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
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

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({ traceId: "trace-fixed-id" })),
  b64EncodeUnicode: vi.fn((s: string) => `b64(${s})`),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLLMStreamQuery } from "./useLLMStreamQuery";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset config to default for every test
  mockStoreState.zoConfig.sql_base64_enabled = false;
});

describe("useLLMStreamQuery — return shape", () => {
  it("exposes executeQuery and cancelAll", () => {
    const api = useLLMStreamQuery();
    expect(typeof api.executeQuery).toBe("function");
    expect(typeof api.cancelAll).toBe("function");
  });
});

describe("useLLMStreamQuery — executeQuery: request envelope", () => {
  // The endpoint expects a specific shape (queryReq.query.{sql,start_time,end_time,from,size}).
  // Pin the exact field names so a future API rename forces a test update.
  it("sends the SQL with start/end timestamps in queryReq.query", () => {
    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT 1", 100, 200);

    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.queryReq.query.sql).toBe("SELECT 1");
    expect(payload.queryReq.query.start_time).toBe(100);
    expect(payload.queryReq.query.end_time).toBe(200);
    // The runner uses page-zero with a generous size so a single panel
    // query rarely needs more than one streamed page.
    expect(payload.queryReq.query.from).toBe(0);
    expect(payload.queryReq.query.size).toBe(1000);
  });

  // Without sql_base64_enabled, the SQL goes through verbatim.
  it("sends plain SQL when sql_base64_enabled is false (default)", () => {
    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT * FROM x", 1, 2);

    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.queryReq.query.sql).toBe("SELECT * FROM x");
    // No `encoding` field on plain SQL path.
    expect(payload.queryReq.encoding).toBeUndefined();
  });

  // sql_base64_enabled=true triggers base64 encoding + an explicit
  // `encoding: "base64"` flag on the request.
  it("base64-encodes SQL when sql_base64_enabled is true", () => {
    mockStoreState.zoConfig.sql_base64_enabled = true;

    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT 42", 1, 2);

    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.queryReq.query.sql).toBe("b64(SELECT 42)");
    expect(payload.queryReq.encoding).toBe("base64");
  });

  // The runner is hard-wired to the traces stream — these tags drive
  // server-side analytics and request routing.
  it("tags the request as type=search, pageType=traces, searchType=ui", () => {
    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT 1", 1, 2);

    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.type).toBe("search");
    expect(payload.pageType).toBe("traces");
    expect(payload.searchType).toBe("ui");
  });

  // The org id is read from the (mocked) store at call time. Cancel
  // requests later use the same org id.
  it("includes the org identifier from the vuex store", () => {
    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT 1", 1, 2);

    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.org_id).toBe("test-org");
  });

  // Each request gets a fresh trace ID — used to correlate cancel calls.
  it("generates a traceId for the request", () => {
    const { executeQuery } = useLLMStreamQuery();
    executeQuery("SELECT 1", 1, 2);

    const [payload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    expect(payload.traceId).toBe("trace-fixed-id");
  });
});

describe("useLLMStreamQuery — executeQuery: hits accumulation", () => {
  // The streaming endpoint may deliver hits across multiple `data`
  // callbacks. The runner must concatenate all of them and return the
  // full list when `complete` fires.
  it("accumulates hits across multiple data callbacks", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("SELECT *", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.data(null, { content: { results: { hits: [{ a: 1 }] } } });
    callbacks.data(null, { content: { results: { hits: [{ a: 2 }] } } });
    callbacks.complete();

    await expect(promise).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  // An empty `data` payload (e.g. server pinging keepalive) shouldn't
  // contaminate the result.
  it("ignores data callbacks that carry zero hits", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("SELECT *", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.data(null, { content: { results: { hits: [] } } });
    callbacks.data(null, { content: { results: { hits: [{ a: 1 }] } } });
    callbacks.complete();

    await expect(promise).resolves.toEqual([{ a: 1 }]);
  });

  // Defensive: malformed responses (no `content` / `results`) shouldn't
  // throw — the runner just treats them as zero hits.
  it("treats malformed responses (missing content/results) as zero hits", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("SELECT *", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.data(null, {}); // no content
    callbacks.data(null, { content: {} }); // no results
    callbacks.complete();

    await expect(promise).resolves.toEqual([]);
  });

  // No data at all → empty array, not a rejection.
  it("resolves with empty array when no hits ever arrive", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("SELECT *", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.complete();

    await expect(promise).resolves.toEqual([]);
  });
});

describe("useLLMStreamQuery — executeQuery: error handling", () => {
  // Error message follows the precedence: message → error → error_detail
  // → fallback string. This matches the streaming endpoint's variable
  // payload shapes.
  it("rejects with `message` field when present", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("BAD", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.error({ message: "syntax error", status: 400, code: 42 });

    await expect(promise).rejects.toThrow("syntax error");
  });

  it("falls back to `error` field when message is missing", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("BAD", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.error({ error: "internal" });

    await expect(promise).rejects.toThrow("internal");
  });

  it("falls back to `error_detail` field when message and error are missing", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("BAD", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.error({ error_detail: "detail" });

    await expect(promise).rejects.toThrow("detail");
  });

  it("uses generic fallback when all error fields are missing", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("BAD", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.error({});

    await expect(promise).rejects.toThrow("Failed to fetch query data");
  });

  // The thrown Error preserves `.status`, `.code`, `.raw` so callers
  // can branch on them (e.g. detect schema-error vs network failure).
  it("attaches status / code / raw to the thrown Error", async () => {
    const { executeQuery } = useLLMStreamQuery();
    const promise = executeQuery("BAD", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    const raw = { message: "x", status: 500, code: 99, error_detail: "boom" };
    callbacks.error(raw);

    try {
      await promise;
    } catch (e: any) {
      expect(e.status).toBe(500);
      expect(e.code).toBe(99);
      expect(e.raw).toBe(raw);
    }
  });
});

describe("useLLMStreamQuery — cancelAll", () => {
  // cancelAll fires `cancelStreamQueryBasedOnRequestId` for every
  // currently-active trace ID; an idle composable cancels nothing.
  it("does nothing when no queries are in flight", () => {
    const { cancelAll } = useLLMStreamQuery();
    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });

  // After kicking off a query (but before complete), cancelAll should
  // signal cancellation with the trace ID generated for that query.
  it("cancels the in-flight query by trace ID", () => {
    const { executeQuery, cancelAll } = useLLMStreamQuery();
    executeQuery("SELECT 1", 1, 2);

    cancelAll();
    expect(mockCancelStreamQuery).toHaveBeenCalledWith({
      trace_id: "trace-fixed-id",
      org_id: "test-org",
    });
  });

  // Once a query completes, its trace ID is removed from the active set —
  // a subsequent cancelAll shouldn't try to cancel it again.
  it("does not cancel queries that already completed", () => {
    const { executeQuery, cancelAll } = useLLMStreamQuery();
    executeQuery("SELECT 1", 1, 2);

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.complete();

    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });

  // An errored query is also removed from the active set — same reason.
  it("does not cancel queries that already errored", () => {
    const { executeQuery, cancelAll } = useLLMStreamQuery();
    executeQuery("BAD", 1, 2).catch(() => {});

    const [, callbacks] = mockFetchQueryDataWithHttpStream.mock.calls[0];
    callbacks.error({ message: "x" });

    cancelAll();
    expect(mockCancelStreamQuery).not.toHaveBeenCalled();
  });
});
