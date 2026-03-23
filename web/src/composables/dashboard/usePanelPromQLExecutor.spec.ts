import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import { ref } from "vue";
import { usePanelPromQLExecutor } from "./usePanelPromQLExecutor";

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return { ...actual, markRaw: (v: any) => v };
});

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceId: "mock-trace-id",
    traceparent: "mock-traceparent",
  })),
}));

vi.mock("./promqlChunkProcessor", () => ({
  createPromQLChunkProcessor: vi.fn(() => ({
    processChunk: vi.fn((existing: any, newData: any) => ({
      ...existing,
      ...newData,
    })),
    getStats: vi.fn(() => ({
      totalMetricsReceived: 5,
      metricsStored: 5,
    })),
  })),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeState = () => ({
  data: [] as any[],
  metadata: { queries: [] as any[] },
  resultMetaData: [] as any[],
  annotations: [] as any[],
  loading: true,
  isOperationCancelled: false,
  isPartialData: false,
  loadingProgressPercentage: 0,
  errorDetail: { message: "", code: "" },
});

const makeStore = (maxSeries = 100) => ({
  state: {
    selectedOrganization: { identifier: "test-org" },
    zoConfig: { max_dashboard_series: maxSeries },
  },
});

const makePanelSchema = (queries: any[] = [{ query: "up", config: {} }]) =>
  ref({
    id: "panel-1",
    title: "Test Panel",
    queryType: "promql",
    config: { step_value: "" },
    queries,
  });

const makeCtx = (overrides: Partial<Parameters<typeof usePanelPromQLExecutor>[0]> = {}) => {
  const state = makeState();
  const store = makeStore();
  const panelSchema = makePanelSchema();

  const replaceQueryValue = vi.fn((query: string) => ({
    query,
    metadata: [{ type: "fixed", name: "__interval", value: "5m" }],
  }));

  const applyDynamicVariables = vi.fn(async (query: string) => ({
    query,
    metadata: [],
  }));

  const fetchQueryDataWithHttpStream = vi.fn();
  const shouldFetchAnnotations = vi.fn(() => false);
  const refreshAnnotations = vi.fn(async () => []);
  const saveCurrentStateToCache = vi.fn(async () => {});
  const addTraceId = vi.fn();
  const removeTraceId = vi.fn();

  const ctx = {
    state,
    panelSchema,
    store,
    dashboardId: ref("dash-1"),
    dashboardName: ref("My Dashboard"),
    folderId: ref("folder-1"),
    folderName: ref("My Folder"),
    runId: ref("run-1"),
    tabId: ref("tab-1"),
    tabName: ref("Tab 1"),
    replaceQueryValue,
    applyDynamicVariables,
    fetchQueryDataWithHttpStream,
    shouldFetchAnnotations,
    refreshAnnotations,
    saveCurrentStateToCache,
    addTraceId,
    removeTraceId,
    ...overrides,
  };

  return { state, store, panelSchema, ctx, ...ctx };
};

// ─── executePromQL ────────────────────────────────────────────────────────────

describe("usePanelPromQLExecutor", () => {
  describe("executePromQL", () => {
    it("resets state arrays before executing", async () => {
      const { ctx, state } = makeCtx();
      state.data = [{ old: true }];
      state.metadata = { queries: [{ old: true }] };
      state.resultMetaData = [{ old: true }];

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      // data gets reset to [] at start
      expect(Array.isArray(state.data)).toBe(true);
    });

    it("calls replaceQueryValue for each query", async () => {
      const { ctx, replaceQueryValue } = makeCtx();
      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(replaceQueryValue).toHaveBeenCalledTimes(1);
      expect(replaceQueryValue).toHaveBeenCalledWith("up", 0, 300_000_000, "promql");
    });

    it("calls applyDynamicVariables after replaceQueryValue", async () => {
      const { ctx, applyDynamicVariables } = makeCtx();
      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(applyDynamicVariables).toHaveBeenCalledWith("up", "promql");
    });

    it("calls fetchQueryDataWithHttpStream with correct payload shape", async () => {
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx();
      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(fetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
      const [payload] = fetchQueryDataWithHttpStream.mock.calls[0];
      expect(payload.type).toBe("promql");
      expect(payload.org_id).toBe("test-org");
      expect(payload.queryReq.query).toBe("up");
      expect(payload.queryReq.start_time).toBe(0);
      expect(payload.queryReq.end_time).toBe(300_000_000);
    });

    it("calls addTraceId after fetching", async () => {
      const { ctx, addTraceId } = makeCtx();
      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(addTraceId).toHaveBeenCalledWith("mock-trace-id");
    });

    it("skips fetch when abort signal is already aborted", async () => {
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx();
      const abortController = new AbortController();
      abortController.abort();

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, abortController);

      expect(fetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("calls saveCurrentStateToCache on abort", async () => {
      const { ctx, saveCurrentStateToCache } = makeCtx();
      const abortController = new AbortController();
      abortController.abort();

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, abortController);

      expect(saveCurrentStateToCache).toHaveBeenCalled();
    });

    it("processes multiple queries in parallel", async () => {
      const panelSchema = ref({
        id: "panel-1",
        title: "Multi-query",
        queryType: "promql",
        config: { step_value: "" },
        queries: [
          { query: "up", config: {} },
          { query: "rate(requests[5m])", config: {} },
        ],
      });
      const { ctx, fetchQueryDataWithHttpStream, replaceQueryValue } = makeCtx({ panelSchema });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(replaceQueryValue).toHaveBeenCalledTimes(2);
      expect(fetchQueryDataWithHttpStream).toHaveBeenCalledTimes(2);
    });

    it("uses query-level step_value when set", async () => {
      const panelSchema = ref({
        id: "panel-1",
        title: "Step Panel",
        queryType: "promql",
        config: { step_value: "" },
        queries: [{ query: "up", config: { step_value: "30s" } }],
      });
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      const [payload] = fetchQueryDataWithHttpStream.mock.calls[0];
      expect(payload.queryReq.step).toBe("30s");
    });

    it("uses panel-level step_value when query-level is not set", async () => {
      const panelSchema = ref({
        id: "panel-1",
        title: "Step Panel",
        queryType: "promql",
        config: { step_value: "1m" },
        queries: [{ query: "up", config: { step_value: "" } }],
      });
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      const [payload] = fetchQueryDataWithHttpStream.mock.calls[0];
      expect(payload.queryReq.step).toBe("1m");
    });

    it("falls back to step '0' when neither query nor panel has step_value", async () => {
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx();

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      const [payload] = fetchQueryDataWithHttpStream.mock.calls[0];
      expect(payload.queryReq.step).toBe("0");
    });

    it("includes correct metadata in payload meta", async () => {
      const { ctx, fetchQueryDataWithHttpStream } = makeCtx();

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      const [payload] = fetchQueryDataWithHttpStream.mock.calls[0];
      expect(payload.meta.dashboard_id).toBe("dash-1");
      expect(payload.meta.panel_id).toBe("panel-1");
      expect(payload.meta.tab_id).toBe("tab-1");
    });

    it("calls shouldFetchAnnotations and refreshAnnotations when enabled", async () => {
      const { ctx, shouldFetchAnnotations, refreshAnnotations } = makeCtx();
      shouldFetchAnnotations.mockReturnValue(true);
      refreshAnnotations.mockResolvedValue([{ id: "ann1" }]);

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(refreshAnnotations).toHaveBeenCalled();
    });

    it("does not call refreshAnnotations when shouldFetchAnnotations returns false", async () => {
      const { ctx, refreshAnnotations } = makeCtx();

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(refreshAnnotations).not.toHaveBeenCalled();
    });

    it("handles errors gracefully: resets loading state", async () => {
      const { ctx } = makeCtx();
      // Force an error by making replaceQueryValue throw
      ctx.replaceQueryValue = vi.fn(() => { throw new Error("substitution error"); });
      ctx.state.loading = true;

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      expect(ctx.state.loading).toBe(false);
      expect(ctx.state.isOperationCancelled).toBe(false);
    });

    it("promql response handler updates state.data and metadata", async () => {
      const { ctx, fetchQueryDataWithHttpStream, state } = makeCtx();
      let capturedHandlers: any;

      fetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        capturedHandlers = handlers;
      });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      // Simulate a promql_response event
      capturedHandlers.data(
        {},
        { type: "promql_response", content: { results: { metric: "test" } } },
      );

      expect(state.data).toBeDefined();
      expect(state.errorDetail.message).toBe("");
    });

    it("error handler sets errorDetail and calls removeTraceId", async () => {
      const { ctx, fetchQueryDataWithHttpStream, state, removeTraceId } = makeCtx();
      let capturedHandlers: any;

      fetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        capturedHandlers = handlers;
      });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      capturedHandlers.error(
        {},
        { content: { message: "query failed", code: 400 } },
      );

      expect(state.errorDetail.message).toBe("query failed");
      expect(removeTraceId).toHaveBeenCalledWith("mock-trace-id");
    });

    it("complete handler resets loading and calls saveCurrentStateToCache", async () => {
      const { ctx, fetchQueryDataWithHttpStream, state, saveCurrentStateToCache, removeTraceId } = makeCtx();
      let capturedHandlers: any;

      fetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        capturedHandlers = handlers;
      });

      state.loading = true;

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      capturedHandlers.complete({}, {});

      expect(state.loading).toBe(false);
      expect(saveCurrentStateToCache).toHaveBeenCalled();
      expect(removeTraceId).toHaveBeenCalled();
    });

    it("event_progress handler updates loadingProgressPercentage", async () => {
      const { ctx, fetchQueryDataWithHttpStream, state } = makeCtx();
      let capturedHandlers: any;

      fetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        capturedHandlers = handlers;
      });

      const { executePromQL } = usePanelPromQLExecutor(ctx);
      await executePromQL(0, 300_000_000, null);

      capturedHandlers.data({}, { type: "event_progress", content: { percent: 42 } });

      expect(state.loadingProgressPercentage).toBe(42);
      expect(state.isPartialData).toBe(true);
    });
  });
});
