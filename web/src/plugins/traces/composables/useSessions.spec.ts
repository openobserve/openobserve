// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
// ---------------------------------------------------------------------------

const mockSessionsList = vi.fn();
const mockSessionsDetails = vi.fn();
const mockExecuteQuery = vi.fn();
const mockCancelAll = vi.fn();
const mockStoreState = {
  selectedOrganization: { identifier: "test-org" },
  zoConfig: { sql_base64_enabled: false },
};

vi.mock("@/services/sessions", () => ({
  default: {
    list: (...args: any[]) => mockSessionsList(...args),
    details: (...args: any[]) => mockSessionsDetails(...args),
  },
}));

vi.mock("./useLLMStreamQuery", () => ({
  useLLMStreamQuery: vi.fn(() => ({
    executeQuery: mockExecuteQuery,
    cancelAll: mockCancelAll,
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: mockStoreState })),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((s: string) => `b64(${s})`),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessions } from "./useSessions";

beforeEach(() => {
  vi.clearAllMocks();
  // List state is a module-scoped singleton (it survives the component
  // unmount/remount cycle in the app). Reset it between tests so each starts
  // from a clean slate.
  const s = useSessions();
  s.sessions.value = [];
  s.total.value = 0;
  s.loading.value = false;
  s.error.value = null;
  s.hasLoadedOnce.value = false;
  s.lastRunAt.value = null;
  s.loadedOrg.value = null;
  s.currentPage.value = 1;
  s.rowsPerPage.value = 20;
  s.agents.value = [];
  s.agentsLoaded.value = false;
});

// ---------------------------------------------------------------------------
// fetchPage
// ---------------------------------------------------------------------------

describe("useSessions — fetchPage: loading state", () => {
  it("sets loading=true during fetch and false after", async () => {
    mockSessionsList.mockImplementation(() => {
      return Promise.resolve({ data: { hits: [], total: 0 } });
    });

    const { loading, fetchPage } = useSessions();
    const p = fetchPage("stream", 1000, 2000, 0, 25);
    // loading becomes true synchronously after the call starts
    expect(loading.value).toBe(true);
    await p;
    expect(loading.value).toBe(false);
  });
});

describe("useSessions — fetchPage: field mapping", () => {
  it("maps all API response fields to SessionRow correctly", async () => {
    const hit = {
      session_id: "sess-abc",
      start_time: "1700000000000000000",
      end_time: "1700001000000000000",
      duration: "1000000000",
      trace_count: "5",
      gen_ai_usage_input_tokens: "100",
      gen_ai_usage_output_tokens: "200",
      gen_ai_usage_total_tokens: "300",
      gen_ai_usage_cost: "0.0042",
      gen_ai_usage_cache_read_input_tokens: "70",
      gen_ai_usage_cache_creation_input_tokens: "10",
      gen_ai_usage_cost_cache_read_input: "0.00007",
      gen_ai_usage_cost_cache_creation_input: "0.00002",
      gen_ai_usage_cost_estimated_without_cache: "0.0012",
      gen_ai_usage_cost_cache_read_savings: "0.00063",
      gen_ai_usage_cost_net_cache_impact: "0.00061",
      error_count: "0",
    };
    mockSessionsList.mockResolvedValue({ data: { hits: [hit], total: 1 } });

    const { sessions, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(sessions.value).toHaveLength(1);
    const row = sessions.value[0];
    expect(row.sessionId).toBe("sess-abc");
    expect(row.firstSeenNanos).toBe(1700000000000000000);
    expect(row.durationNanos).toBe(1000000000);
    expect(row.turns).toBe(5);
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(200);
    expect(row.tokens).toBe(300);
    expect(row.cost).toBeCloseTo(0.0042);
    expect(row.cacheReadInputTokens).toBe(70);
    expect(row.cacheCreationInputTokens).toBe(10);
    expect(row.cacheReadInputCost).toBeCloseTo(0.00007);
    expect(row.cacheCreationInputCost).toBeCloseTo(0.00002);
    expect(row.estimatedCostWithoutCache).toBeCloseTo(0.0012);
    expect(row.cacheReadSavings).toBeCloseTo(0.00063);
    expect(row.netCacheImpact).toBeCloseTo(0.00061);
    expect(row.errorCount).toBe(0);
  });

  it("status='error' when error_count > 0", async () => {
    const hit = {
      session_id: "s1",
      start_time: 1000,
      end_time: 2000,
      duration: 1000,
      trace_count: 1,
      gen_ai_usage_input_tokens: 0,
      gen_ai_usage_output_tokens: 0,
      gen_ai_usage_total_tokens: 0,
      gen_ai_usage_cost: 0,
      error_count: 3,
    };
    mockSessionsList.mockResolvedValue({ data: { hits: [hit], total: 1 } });

    const { sessions, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(sessions.value[0].status).toBe("error");
    expect(sessions.value[0].errorCount).toBe(3);
  });

  it("status='ok' when error_count is 0", async () => {
    const hit = {
      session_id: "s2",
      start_time: 1000,
      end_time: 2000,
      duration: 1000,
      trace_count: 1,
      gen_ai_usage_input_tokens: 0,
      gen_ai_usage_output_tokens: 0,
      gen_ai_usage_total_tokens: 0,
      gen_ai_usage_cost: 0,
      error_count: 0,
    };
    mockSessionsList.mockResolvedValue({ data: { hits: [hit], total: 1 } });

    const { sessions, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(sessions.value[0].status).toBe("ok");
  });

  it("sets total from body.total", async () => {
    mockSessionsList.mockResolvedValue({ data: { hits: [], total: 42 } });

    const { total, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(total.value).toBe(42);
  });

  it("sets hasLoadedOnce=true after successful fetch", async () => {
    mockSessionsList.mockResolvedValue({ data: { hits: [], total: 0 } });

    const { hasLoadedOnce, fetchPage } = useSessions();
    expect(hasLoadedOnce.value).toBe(false);
    await fetchPage("stream", 1000, 2000, 0, 25);
    expect(hasLoadedOnce.value).toBe(true);
  });

  it("passes an empty filter to the list API by default", async () => {
    mockSessionsList.mockResolvedValue({ data: { hits: [], total: 0 } });

    const { fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(mockSessionsList).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "test-org",
        streamName: "stream",
        startTime: 1000,
        endTime: 2000,
        page: 0,
        pageSize: 25,
        filter: "",
      }),
    );
  });

  it("passes the supplied filter to the list API", async () => {
    mockSessionsList.mockResolvedValue({ data: { hits: [], total: 0 } });
    const filter = `gen_ai_agent_id = 'agent-1'`;

    const { fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25, filter);

    expect(mockSessionsList).toHaveBeenCalledWith(expect.objectContaining({ filter }));
  });
});

describe("useSessions — fetchPage: error handling", () => {
  it("sets error ref on API failure with server message", async () => {
    mockSessionsList.mockRejectedValue({
      response: { data: { message: "server error msg" } },
    });

    const { error, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(error.value).toBe("server error msg");
  });

  it("falls back to error field when message is missing", async () => {
    mockSessionsList.mockRejectedValue({
      response: { data: { error: "some error" } },
    });

    const { error, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(error.value).toBe("some error");
  });

  it("falls back to e.message when response data is empty", async () => {
    mockSessionsList.mockRejectedValue(new Error("network failure"));

    const { error, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(error.value).toBe("network failure");
  });

  it("loading is false after error", async () => {
    mockSessionsList.mockRejectedValue(new Error("fail"));

    const { loading, fetchPage } = useSessions();
    await fetchPage("stream", 1000, 2000, 0, 25);

    expect(loading.value).toBe(false);
  });
});

describe("useSessions — fetchPage: early return guards", () => {
  it("does nothing when streamName is empty", async () => {
    const { fetchPage } = useSessions();
    await fetchPage("", 1000, 2000, 0, 25);
    expect(mockSessionsList).not.toHaveBeenCalled();
  });

  it("does nothing when startTime is 0/falsy", async () => {
    const { fetchPage } = useSessions();
    await fetchPage("stream", 0, 2000, 0, 25);
    expect(mockSessionsList).not.toHaveBeenCalled();
  });

  it("does nothing when endTime is 0/falsy", async () => {
    const { fetchPage } = useSessions();
    await fetchPage("stream", 1000, 0, 0, 25);
    expect(mockSessionsList).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchSession
// ---------------------------------------------------------------------------

describe("useSessions — fetchSession: early return guards", () => {
  it("returns { detail: null, traces: [] } when streamName is missing", async () => {
    const { fetchSession } = useSessions();
    const result = await fetchSession("", "session-id", 1000, 2000);
    expect(result).toEqual({ detail: null, traces: [] });
    expect(mockSessionsDetails).not.toHaveBeenCalled();
  });

  it("returns { detail: null, traces: [] } when sessionId is missing", async () => {
    const { fetchSession } = useSessions();
    const result = await fetchSession("stream", "", 1000, 2000);
    expect(result).toEqual({ detail: null, traces: [] });
  });

  it("returns { detail: null, traces: [] } when startTime is 0", async () => {
    const { fetchSession } = useSessions();
    const result = await fetchSession("stream", "session-id", 0, 2000);
    expect(result).toEqual({ detail: null, traces: [] });
  });

  it("returns { detail: null, traces: [] } when endTime is 0", async () => {
    const { fetchSession } = useSessions();
    const result = await fetchSession("stream", "session-id", 1000, 0);
    expect(result).toEqual({ detail: null, traces: [] });
  });
});

describe("useSessions — fetchSession: empty API response", () => {
  it("returns { detail: null, traces: [] } when API returns no hits", async () => {
    mockSessionsDetails.mockResolvedValue({ data: { hits: [], total: 0 } });

    const { fetchSession } = useSessions();
    const result = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(result).toEqual({ detail: null, traces: [] });
  });

  it("calls the session details API with the session id and time range", async () => {
    mockSessionsDetails.mockResolvedValue({ data: { hits: [], total: 0 } });

    const { fetchSession } = useSessions();
    await fetchSession("stream", "sess-1", 1000, 2000);

    expect(mockSessionsDetails).toHaveBeenCalledWith({
      orgId: "test-org",
      streamName: "stream",
      sessionId: "sess-1",
      startTime: 1000,
      endTime: 2000,
      from: 0,
      size: 1000,
    });
  });
});

describe("useSessions — fetchSession: trace row mapping", () => {
  const makeStreamHit = (overrides: Record<string, any> = {}) => ({
    trace_id: "trace-abc",
    start_time: "1000000000",
    end_time: "2000000000",
    duration: "1000000",
    spans: [10, 0],
    service_name: [{ service_name: "my-service", count: 1, duration: 500 }],
    gen_ai_usage_input_tokens: "50",
    gen_ai_usage_output_tokens: "100",
    gen_ai_usage_total_tokens: "150",
    gen_ai_usage_cost: "0.001",
    gen_ai_response_model: "gpt-4",
    gen_ai_request_model: null,
    ...overrides,
  });

  function setupDetailsMock(hits: any[]) {
    mockSessionsDetails.mockResolvedValue({ data: { hits, total: hits.length } });
  }

  it("maps trace_id → traceId", async () => {
    setupDetailsMock([makeStreamHit()]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].traceId).toBe("trace-abc");
  });

  it("maps start_time → startTimeMicros (stored as nanos)", async () => {
    setupDetailsMock([makeStreamHit({ start_time: "5000000000" })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].startTimeMicros).toBe(5000000000);
  });

  it("maps gen_ai_usage_input_tokens → inputTokens", async () => {
    setupDetailsMock([makeStreamHit({ gen_ai_usage_input_tokens: "75" })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].inputTokens).toBe(75);
  });

  it("maps gen_ai_usage_output_tokens → outputTokens", async () => {
    setupDetailsMock([makeStreamHit({ gen_ai_usage_output_tokens: "125" })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].outputTokens).toBe(125);
  });

  it("maps gen_ai_usage_total_tokens → tokens", async () => {
    setupDetailsMock([makeStreamHit({ gen_ai_usage_total_tokens: "200" })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].tokens).toBe(200);
  });

  it("maps gen_ai_usage_cost → cost", async () => {
    setupDetailsMock([makeStreamHit({ gen_ai_usage_cost: "0.0099" })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].cost).toBeCloseTo(0.0099);
  });

  it("status='error' when spans[1] (error_count) > 0", async () => {
    setupDetailsMock([makeStreamHit({ spans: [5, 2] })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].status).toBe("error");
    expect(traces[0].errorCount).toBe(2);
  });

  it("status='ok' when spans[1] is 0", async () => {
    setupDetailsMock([makeStreamHit({ spans: [5, 0] })]);
    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);
    expect(traces[0].status).toBe("ok");
    expect(traces[0].errorCount).toBe(0);
  });
});

describe("useSessions — fetchSession: sorting", () => {
  it("sorts traces chronologically by start_time (oldest first)", async () => {
    const hits = [
      {
        trace_id: "newer",
        start_time: "3000000000",
        end_time: "4000000000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
      {
        trace_id: "older",
        start_time: "1000000000",
        end_time: "2000000000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
    ];

    mockSessionsDetails.mockResolvedValue({ data: { hits, total: hits.length } });

    const { fetchSession } = useSessions();
    const { traces } = await fetchSession("stream", "sess-1", 1000, 2000);

    expect(traces[0].traceId).toBe("older");
    expect(traces[1].traceId).toBe("newer");
  });
});

describe("useSessions — fetchSession: SessionDetail derivation", () => {
  function setupDetailsMock(hits: any[]) {
    mockSessionsDetails.mockResolvedValue({ data: { hits, total: hits.length } });
  }

  it("sums inputTokens, outputTokens, tokens, cost across traces", async () => {
    const hits = [
      {
        trace_id: "t1",
        start_time: "1000",
        end_time: "2000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 10,
        gen_ai_usage_output_tokens: 20,
        gen_ai_usage_total_tokens: 30,
        gen_ai_usage_cost: 0.001,
      },
      {
        trace_id: "t2",
        start_time: "2000",
        end_time: "3000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 5,
        gen_ai_usage_output_tokens: 15,
        gen_ai_usage_total_tokens: 20,
        gen_ai_usage_cost: 0.002,
      },
    ];
    setupDetailsMock(hits);

    const { fetchSession } = useSessions();
    const { detail } = await fetchSession("stream", "sess-1", 1000, 5000);

    expect(detail).not.toBeNull();
    expect(detail!.inputTokens).toBe(15);
    expect(detail!.outputTokens).toBe(35);
    expect(detail!.tokens).toBe(50);
    expect(detail!.cost).toBeCloseTo(0.003);
  });

  it("detail status='error' when any trace has errorCount > 0", async () => {
    const hits = [
      {
        trace_id: "t1",
        start_time: "1000",
        end_time: "2000",
        spans: [1, 2], // error
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
      {
        trace_id: "t2",
        start_time: "2000",
        end_time: "3000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
    ];
    setupDetailsMock(hits);

    const { fetchSession } = useSessions();
    const { detail } = await fetchSession("stream", "sess-1", 1000, 5000);

    expect(detail!.status).toBe("error");
    expect(detail!.errorCount).toBe(2);
  });

  it("detail status='ok' when no traces have errors", async () => {
    const hits = [
      {
        trace_id: "t1",
        start_time: "1000",
        end_time: "2000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
    ];
    setupDetailsMock(hits);

    const { fetchSession } = useSessions();
    const { detail } = await fetchSession("stream", "sess-1", 1000, 5000);

    expect(detail!.status).toBe("ok");
  });

  it("turns count equals number of trace rows", async () => {
    const hits = [
      {
        trace_id: "t1",
        start_time: "1000",
        end_time: "2000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
      {
        trace_id: "t2",
        start_time: "2000",
        end_time: "3000",
        spans: [1, 0],
        service_name: [],
        gen_ai_usage_input_tokens: 0,
        gen_ai_usage_output_tokens: 0,
        gen_ai_usage_total_tokens: 0,
        gen_ai_usage_cost: 0,
      },
    ];
    setupDetailsMock(hits);

    const { fetchSession } = useSessions();
    const { detail } = await fetchSession("stream", "sess-1", 1000, 5000);

    expect(detail!.turns).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cancelAll
// ---------------------------------------------------------------------------

describe("useSessions — cancelAll", () => {
  it("calls the underlying useLLMStreamQuery cancelAll", () => {
    const { cancelAll } = useSessions();
    cancelAll();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });
});
