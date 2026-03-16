import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePanelSearchHandlers } from "./usePanelSearchHandlers";

// Mock Vue to avoid issues with markRaw/toRaw in test env
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    markRaw: (v: any) => v,
    toRaw: (v: any) => v,
  };
});

const makeState = () => ({
  data: [] as any[],
  resultMetaData: [] as any[],
  loading: false,
  loadingTotal: 0,
  loadingCompleted: 0,
  loadingProgressPercentage: 0,
  isPartialData: false,
  isOperationCancelled: false,
  errorDetail: { message: "", code: "" },
});

const makeHandlers = (stateOverride?: any) => {
  const state = stateOverride ?? makeState();
  const processApiError = vi.fn();
  const saveCurrentStateToCache = vi.fn();
  const loadData = vi.fn();
  const removeTraceId = vi.fn();

  const handlers = usePanelSearchHandlers({
    state,
    processApiError,
    saveCurrentStateToCache,
    loadData,
    removeTraceId,
  });

  return { state, processApiError, saveCurrentStateToCache, loadData, removeTraceId, handlers };
};

// ─── handleHistogramResponse ──────────────────────────────────────────────────

describe("handleHistogramResponse", () => {
  it("clears errorDetail", async () => {
    const { state, handlers } = makeHandlers();
    state.errorDetail = { message: "old error", code: "500" };
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [], order_by: "desc" } } },
    );

    expect(state.errorDetail.message).toBe("");
    expect(state.errorDetail.code).toBe("");
  });

  it("initializes data array for query index if missing", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } } },
    );

    expect(Array.isArray(state.data[0])).toBe(true);
  });

  it("replaces data when streaming_aggs is true", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: true,
          results: { hits: [{ id: 1 }, { id: 2 }], order_by: "desc" },
        },
      },
    );

    expect(state.data[0]).toHaveLength(2);
    expect(state.data[0][0].id).toBe(1);
  });

  it("prepends hits for ascending order", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 10 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: { hits: [{ id: 1 }], order_by: "ASC" },
        },
      },
    );

    // prepend: new hit first
    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("appends hits for descending order (default)", async () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 1 }];
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        content: {
          streaming_aggs: false,
          results: { hits: [{ id: 2 }], order_by: "desc" },
        },
      },
    );

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(2);
  });

  it("pushes result metadata", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [], order_by: "desc", total: 5 } } },
    );

    expect(state.resultMetaData[0]).toHaveLength(1);
    expect(state.resultMetaData[0][0].total).toBe(5);
  });

  it("sets isPartialData to false when data has items and loading is complete", async () => {
    const state = makeState();
    state.loading = false;
    state.isPartialData = true;
    state.resultMetaData[0] = [];
    const { handlers } = makeHandlers(state);

    await handlers.handleHistogramResponse(
      { meta: { currentQueryIndex: 0 } },
      { content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } } },
    );

    expect(state.isPartialData).toBe(false);
  });
});

// ─── handleStreamingHistogramMetadata ─────────────────────────────────────────

describe("handleStreamingHistogramMetadata", () => {
  it("initializes resultMetaData array if missing for query index", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 1 } },
      { content: { total: 42, results: { took: 10 } } },
    );

    expect(Array.isArray(state.resultMetaData[1])).toBe(true);
    expect(state.resultMetaData[1]).toHaveLength(1);
  });

  it("merges content and results into pushed metadata", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 42, results: { took: 10 } } },
    );

    expect(state.resultMetaData[0][0].total).toBe(42);
    expect(state.resultMetaData[0][0].took).toBe(10);
  });

  it("appends multiple metadata entries on successive calls", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 10, results: {} } },
    );
    handlers.handleStreamingHistogramMetadata(
      { meta: { currentQueryIndex: 0 } },
      { content: { total: 20, results: {} } },
    );

    expect(state.resultMetaData[0]).toHaveLength(2);
  });
});

// ─── handleStreamingHistogramHits ─────────────────────────────────────────────

describe("handleStreamingHistogramHits", () => {
  it("clears errorDetail", () => {
    const { state, handlers } = makeHandlers();
    state.errorDetail = { message: "old", code: "500" };
    state.resultMetaData[0] = [{ streaming_aggs: false }];
    state.data[0] = [];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    expect(state.errorDetail.message).toBe("");
  });

  it("replaces data when streaming_aggs is true and hits are non-empty", () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [{ streaming_aggs: true }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }, { id: 2 }] } } },
    );

    expect(state.data[0]).toHaveLength(2);
    expect(state.data[0][0].id).toBe(1);
  });

  it("does not replace data when streaming_aggs is true but hits are empty", () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 99 }];
    state.resultMetaData[0] = [{ streaming_aggs: true }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [] } } },
    );

    expect(state.data[0][0].id).toBe(99);
  });

  it("prepends hits for asc order_by", () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 10 }];
    state.resultMetaData[0] = [{ streaming_aggs: false, order_by: "ASC" }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 1 }] } } },
    );

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(10);
  });

  it("appends hits for non-asc order_by", () => {
    const { state, handlers } = makeHandlers();
    state.data[0] = [{ id: 1 }];
    state.resultMetaData[0] = [{ streaming_aggs: false, order_by: "desc" }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 2 }] } } },
    );

    expect(state.data[0][0].id).toBe(1);
    expect(state.data[0][1].id).toBe(2);
  });

  it("initializes data array if missing for query index", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [{ streaming_aggs: false }];

    handlers.handleStreamingHistogramHits(
      { meta: { currentQueryIndex: 0 } },
      { content: { results: { hits: [{ id: 5 }] } } },
    );

    expect(Array.isArray(state.data[0])).toBe(true);
  });
});

// ─── handleSearchResponse ─────────────────────────────────────────────────────

describe("handleSearchResponse", () => {
  it("delegates search_response_metadata to handleStreamingHistogramMetadata", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      { type: "search_response_metadata", content: { total: 5, results: {} } },
    );

    expect(Array.isArray(state.resultMetaData[0])).toBe(true);
  });

  it("delegates search_response_hits to handleStreamingHistogramHits", () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [{ streaming_aggs: false }];

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      { type: "search_response_hits", content: { results: { hits: [{ id: 1 }] } } },
    );

    expect(state.data[0]).toBeDefined();
  });

  it("delegates search_response to handleHistogramResponse", async () => {
    const { state, handlers } = makeHandlers();
    state.resultMetaData[0] = [];

    handlers.handleSearchResponse(
      { meta: { currentQueryIndex: 0 } },
      {
        type: "search_response",
        content: { streaming_aggs: false, results: { hits: [{ id: 1 }], order_by: "desc" } },
      },
    );

    // state.data[0] should be populated (async handler)
    expect(state.data[0]).toBeDefined();
  });

  it("sets loading=false and calls processApiError on error type", () => {
    const { state, handlers, processApiError } = makeHandlers();
    state.loading = true;

    handlers.handleSearchResponse(
      {},
      { type: "error", content: { message: "bad query" } },
    );

    expect(state.loading).toBe(false);
    expect(state.loadingProgressPercentage).toBe(0);
    expect(processApiError).toHaveBeenCalledWith({ message: "bad query" }, "sql");
  });

  it("sets loading=false and calls saveCurrentStateToCache on end type", () => {
    const { state, handlers, saveCurrentStateToCache } = makeHandlers();
    state.loading = true;

    handlers.handleSearchResponse({}, { type: "end" });

    expect(state.loading).toBe(false);
    expect(state.loadingProgressPercentage).toBe(100);
    expect(state.isPartialData).toBe(false);
    expect(saveCurrentStateToCache).toHaveBeenCalled();
  });

  it("updates loadingProgressPercentage on event_progress", () => {
    const { state, handlers } = makeHandlers();

    handlers.handleSearchResponse(
      {},
      { type: "event_progress", content: { percent: 55 } },
    );

    expect(state.loadingProgressPercentage).toBe(55);
    expect(state.isPartialData).toBe(true);
  });

  it("handles unknown type gracefully (no-op)", () => {
    const { state, handlers } = makeHandlers();
    // Unknown type should not throw or mutate state
    expect(() => {
      handlers.handleSearchResponse({}, { type: "unknown_type" });
    }).not.toThrow();
    expect(state.loading).toBe(false);
  });
});

// ─── handleSearchClose ────────────────────────────────────────────────────────

describe("handleSearchClose", () => {
  it("calls removeTraceId with payload traceId", () => {
    const { handlers, removeTraceId } = makeHandlers();

    handlers.handleSearchClose({ traceId: "abc-123" }, { type: "normal", code: 1000 });

    expect(removeTraceId).toHaveBeenCalledWith("abc-123");
  });

  it("calls processApiError when response type is error", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "error", content: { message: "ws error" } },
    );

    expect(processApiError).toHaveBeenCalledWith({ message: "ws error" }, "sql");
  });

  it("calls handleSearchError for WebSocket error codes", () => {
    // handleSearchClose internally calls handleSearchError which is returned by the composable
    // We verify processApiError is called via the chain
    const { handlers, processApiError } = makeHandlers();

    // Code 1006 = abnormal closure
    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "normal", code: 1006 },
    );

    expect(processApiError).toHaveBeenCalled();
  });

  it("does not call processApiError for clean close (code 1000)", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchClose(
      { traceId: "t1" },
      { type: "normal", code: 1000 },
    );

    expect(processApiError).not.toHaveBeenCalled();
  });

  it("sets loading=false and calls saveCurrentStateToCache", () => {
    const { state, handlers, saveCurrentStateToCache } = makeHandlers();
    state.loading = true;

    handlers.handleSearchClose({ traceId: "t1" }, { type: "normal", code: 1000 });

    expect(state.loading).toBe(false);
    expect(saveCurrentStateToCache).toHaveBeenCalled();
  });
});

// ─── handleSearchError ────────────────────────────────────────────────────────

describe("handleSearchError", () => {
  it("calls removeTraceId with payload.traceId", () => {
    const { handlers, removeTraceId } = makeHandlers();

    handlers.handleSearchError(
      { traceId: "err-trace" },
      { content: { message: "err" } },
    );

    expect(removeTraceId).toHaveBeenCalledWith("err-trace");
  });

  it("sets loading=false and resets counters", () => {
    const { state, handlers } = makeHandlers();
    state.loading = true;
    state.loadingTotal = 5;
    state.loadingCompleted = 3;

    handlers.handleSearchError({ traceId: "t" }, { content: { message: "err" } });

    expect(state.loading).toBe(false);
    expect(state.loadingTotal).toBe(0);
    expect(state.loadingCompleted).toBe(0);
    expect(state.loadingProgressPercentage).toBe(0);
  });

  it("calls processApiError with response content", () => {
    const { handlers, processApiError } = makeHandlers();

    handlers.handleSearchError({ traceId: "t" }, { content: { message: "query failed" } });

    expect(processApiError).toHaveBeenCalledWith({ message: "query failed" }, "sql");
  });
});

// ─── handleSearchReset ────────────────────────────────────────────────────────

describe("handleSearchReset", () => {
  it("calls saveCurrentStateToCache and loadData", () => {
    const { handlers, saveCurrentStateToCache, loadData } = makeHandlers();

    handlers.handleSearchReset({}, "trace-id");

    expect(saveCurrentStateToCache).toHaveBeenCalled();
    expect(loadData).toHaveBeenCalled();
  });
});
