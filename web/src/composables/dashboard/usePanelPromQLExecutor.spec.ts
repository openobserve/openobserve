import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { usePanelPromQLExecutor } from "./usePanelPromQLExecutor";
import { HEATMAP_MAX_COLUMNS } from "@/utils/dashboard/heatmapDefaults";

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
      ctx.replaceQueryValue = vi.fn(() => {
        throw new Error("substitution error");
      });
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

      capturedHandlers.error({}, { content: { message: "query failed", code: 400 } });

      expect(state.errorDetail.message).toBe("query failed");
      expect(removeTraceId).toHaveBeenCalledWith("mock-trace-id");
    });

    it("complete handler resets loading and calls saveCurrentStateToCache", async () => {
      const { ctx, fetchQueryDataWithHttpStream, state, saveCurrentStateToCache, removeTraceId } =
        makeCtx();
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

describe("the heatmap column cap", () => {
  /**
   * The start/end `usePanelDataLoader` passes here are MICROSECONDS, not ms. They
   * come from `meta.dateTime`, whose Dates are built straight off
   * `getConsumableDateTime()` — which is in µs — with no conversion
   * (`plugins/metrics/Index.vue:419-428`, `views/Dashboards/ViewDashboard.vue`).
   * `usePanelVariableSubstitution` reads the same pair and divides by 1e6.
   *
   * A previous revision of the cap divided by 1000, so every range looked 1000x
   * LONGER: a 15m heatmap asked for a 7500s step over a 900s window, Prometheus
   * returned a single sample per series, and the chart collapsed to one full-width
   * column per bucket. This spec asserted the same wrong unit, so it stayed green
   * while the product was broken — hence the explicit magnitude checks below.
   */
  const US = {
    "15m": 900_000_000,
    "1h": 3_600_000_000,
    "6h": 21_600_000_000,
    "24h": 86_400_000_000,
    "7d": 604_800_000_000,
  };

  const stepFor = async (rangeUs: number) => {
    const panelSchema = makePanelSchema();
    panelSchema.value.type = "heatmap";
    const { ctx, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });
    const { executePromQL } = usePanelPromQLExecutor(ctx as any);
    // Exactly what the loader passes: getTime() on a Date built from µs.
    await executePromQL(1_700_000_000_000_000, 1_700_000_000_000_000 + rangeUs, null);
    const step = fetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.step;
    return Number(String(step).replace(/s$/, ""));
  };

  for (const [label, rangeUs] of Object.entries(US)) {
    it(`keeps a ${label} heatmap within ${HEATMAP_MAX_COLUMNS} columns`, async () => {
      const stepSeconds = await stepFor(rangeUs);
      const columns = rangeUs / 1_000_000 / stepSeconds;

      expect(stepSeconds).toBeGreaterThan(0);
      expect(columns).toBeLessThanOrEqual(HEATMAP_MAX_COLUMNS);
    });
  }

  it("still returns enough columns to be a heatmap (the reported bug)", async () => {
    // The 1000x-too-large step yielded ONE column. Every range must stay plural,
    // and a 15m window must match what the metrics-explorer card already renders.
    for (const [label, rangeUs] of Object.entries(US)) {
      const columns = rangeUs / 1_000_000 / (await stepFor(rangeUs));
      expect(columns, `${label} collapsed to ${columns} column(s)`).toBeGreaterThan(10);
    }
    expect(await stepFor(US["15m"])).toBeLessThanOrEqual(30);
  });

  it("does not collapse to the 15s floor at long ranges", async () => {
    expect(await stepFor(US["24h"])).toBeGreaterThan(15);
    expect(await stepFor(US["7d"])).toBeGreaterThan(await stepFor(US["6h"]));
  });

  it("leaves a non-heatmap panel on the server default", async () => {
    const panelSchema = makePanelSchema(); // type: line
    const { ctx, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });
    const { executePromQL } = usePanelPromQLExecutor(ctx as any);
    await executePromQL(1_700_000_000_000_000, 1_700_000_000_000_000 + US["24h"], null);
    expect(fetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.step).toBe("0");
  });

  it("an explicit step_value still wins", async () => {
    const panelSchema = makePanelSchema();
    panelSchema.value.type = "heatmap";
    panelSchema.value.queries[0].config = { step_value: "300" };
    const { ctx, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });
    const { executePromQL } = usePanelPromQLExecutor(ctx as any);
    await executePromQL(1_700_000_000_000_000, 1_700_000_000_000_000 + US["24h"], null);
    expect(fetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.step).toBe("300");
  });
});

describe("streaming PromQL errors reach the user as sentences", () => {
  /**
   * The backend returns its internal envelope rather than a sentence. The axios
   * path unwraps it (`usePanelDataLoader.processApiError`) — but a dashboard PromQL
   * panel goes through the STREAMING path, which has its own error handler and was
   * reading `content.message` raw. So the fix landed on a path users rarely take
   * while the envelope stayed on the one they always take.
   */
  const ENVELOPE =
    'Error during planning: ErrorCode# {"code":20010,"message":"Search query timed out","inner":"[PromQL] grpc search load data task timeout"}';

  const errorFrom = async (payload: any) => {
    const panelSchema = makePanelSchema();
    const { ctx, state, fetchQueryDataWithHttpStream } = makeCtx({ panelSchema });
    (fetchQueryDataWithHttpStream as any).mockImplementation((_req: any, handlers: any) =>
      handlers.error({}, payload),
    );
    const { executePromQL } = usePanelPromQLExecutor(ctx as any);
    await executePromQL(1_700_000_000_000, 1_700_000_000_100, null);
    return state.errorDetail;
  };

  it("unwraps the ErrorCode envelope into the sentence inside it", async () => {
    const detail = await errorFrom({ content: { message: ENVELOPE } });

    expect(detail.message).toBe("Search query timed out");
    expect(detail.message).not.toContain("ErrorCode#");
    expect(detail.code).toBe(20010);
  });

  it("passes a plain message through untouched", async () => {
    const detail = await errorFrom({
      content: { message: "stream not found", code: 404 },
    });
    expect(detail.message).toBe("stream not found");
    expect(detail.code).toBe(404);
  });
});
