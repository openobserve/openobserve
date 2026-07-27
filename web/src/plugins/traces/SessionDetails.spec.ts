// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
// ---------------------------------------------------------------------------

const mockFetchSession = vi.fn();
const mockFetchTurnDetail = vi.fn();
const mockFetchSessionSpans = vi.fn();
const mockRouterPush = vi.fn();

// Mutable route state — tests set these to drive computed values
const mockRouteQuery = {
  session_id: "sess-abc",
  stream: "test-stream",
  from: "1700000000000000",
  to: "1700001000000000",
  org_identifier: "default",
};

vi.mock("./composables/useSessions", () => ({
  useSessions: vi.fn(() => ({
    fetchSession: mockFetchSession,
    fetchTurnDetail: mockFetchTurnDetail,
    fetchSessionSpans: mockFetchSessionSpans,
  })),
}));

vi.mock("./TurnPreviewCard.vue", () => ({
  default: {
    name: "TurnPreviewCard",
    props: ["turn", "index", "cachePct", "side"],
    template: `<span data-test="turn-preview-stub"><slot /></span>`,
  },
}));

vi.mock("./SessionRibbon.vue", () => ({
  default: {
    name: "SessionRibbon",
    props: ["traces", "cachePct"],
    emits: ["jump"],
    template: `<div data-test="session-ribbon-stub" />`,
  },
}));

vi.mock("./ThreadView.vue", () => ({
  default: {
    name: "ThreadView",
    props: ["spans", "showSummary", "condenseTurns"],
    emits: ["spanSelected"],
    template: `<div data-test="thread-view-stub" />`,
  },
}));

vi.mock("./ThreadToolCalls.vue", () => ({
  default: {
    name: "ThreadToolCalls",
    props: ["toolCalls"],
    emits: ["spanSelected"],
    template: `<div data-test="thread-tool-calls-stub" />`,
  },
}));

vi.mock("vue-router", () => ({
  useRoute: vi.fn(() => ({ query: mockRouteQuery })),
  useRouter: vi.fn(() => ({ push: mockRouterPush })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { selectedOrganization: { identifier: "test-org" } },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) return key + JSON.stringify(params);
      return key;
    },
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((s: string) => `b64(${s})`),
}));

vi.mock("@/composables/useTraces", () => ({
  default: vi.fn(() => ({
    searchObj: {
      meta: { searchMode: "sessions" },
    },
  })),
}));

vi.mock("@/lib/core/Button/OButton.vue", () => ({
  default: {
    name: "OButton",
    props: ["variant", "size"],
    emits: ["click"],
    template: `<button class="o-button" @click="$emit('click')"><slot /></button>`,
  },
}));

vi.mock("./llmInsightsDashboard.utils", () => ({
  splitNumberWithUnit: vi.fn((n: number) => ({ value: n, unit: "" })),
  splitDuration: vi.fn((n: number) => ({ value: n, unit: "ns" })),
  splitCost: vi.fn((n: number) => ({ value: `$${n}`, unit: "" })),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SessionDetails from "./SessionDetails.vue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetail(overrides: Record<string, any> = {}) {
  return {
    sessionId: "sess-abc",
    userId: null,
    serviceName: "my-service",
    firstSeenMicros: 1700000000000000,
    durationNanos: 1000000000,
    turns: 2,
    inputTokens: 100,
    outputTokens: 200,
    tokens: 300,
    cost: 0.005,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputCost: 0,
    cacheCreationInputCost: 0,
    estimatedCostWithoutCache: 0,
    cacheReadSavings: 0,
    netCacheImpact: 0,
    errorCount: 0,
    status: "ok" as const,
    ...overrides,
  };
}

function makeTrace(overrides: Record<string, any> = {}) {
  return {
    traceId: "trace-xyz",
    startTimeMicros: 1700000001000000000,
    durationNanos: 500000000,
    spanCount: 5,
    inputTokens: 50,
    outputTokens: 100,
    tokens: 150,
    cost: 0.0025,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputCost: 0,
    cacheCreationInputCost: 0,
    estimatedCostWithoutCache: 0,
    cacheReadSavings: 0,
    netCacheImpact: 0,
    errorCount: 0,
    status: "ok" as const,
    model: "gpt-4",
    models: [] as string[],
    ...overrides,
  };
}

function makeSpan(overrides: Record<string, any> = {}) {
  return {
    trace_id: "trace-xyz",
    span_id: "span-1",
    start_time: 1700000001000000000,
    duration: 500000000,
    gen_ai_operation_name: "chat",
    gen_ai_input_messages: JSON.stringify([{ role: "user", content: "Hello" }]),
    gen_ai_output_messages: JSON.stringify([{ role: "assistant", content: "Hi there" }]),
    gen_ai_response_model: "gpt-4",
    ...overrides,
  };
}

const turnRowSelector = (traceId = "trace-xyz") => `[data-test="session-turn-row-${traceId}"]`;
const turnHeaderSelector = (traceId = "trace-xyz") =>
  `[data-test="session-turn-header-${traceId}"]`;
const turnBodySelector = (traceId = "trace-xyz") => `[data-test="session-turn-body-${traceId}"]`;

const globalStubs = {
  OIcon: {
    template: '<span :data-name="name"><slot /></span>',
    props: ["name", "size"],
  },
  OTooltip: {
    template: '<div><slot /><span><slot name="content" /></span></div>',
    props: ["content", "maxWidth"],
  },
  OSkeleton: {
    template: '<div class="o-skeleton-stub" />',
    props: ["type", "width", "height"],
  },
  OBadge: {
    template: '<span class="o-badge"><slot /></span>',
    props: ["size", "variant"],
  },
  OProgressBar: {
    template: '<div class="o-progress-bar" />',
    props: ["value", "variant", "size"],
  },
  OSearchInput: {
    template: '<input class="o-search-input" />',
    props: ["modelValue", "placeholder", "clearable", "debounce", "size"],
    emits: ["update:modelValue"],
  },
  OSelect: {
    template: '<div class="o-select">{{ label }}</div>',
    props: ["modelValue", "label", "labelPosition", "options"],
    emits: ["update:modelValue"],
  },
  OToggleGroup: {
    template: '<div class="o-toggle-group"><slot /></div>',
    props: ["modelValue"],
    emits: ["update:modelValue"],
  },
  OToggleGroupItem: {
    template: '<button class="o-toggle-group-item"><slot /></button>',
    props: ["value", "size"],
  },
};

async function mountComponent() {
  const wrapper = mount(SessionDetails, {
    global: {
      stubs: globalStubs,
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default route query
  mockRouteQuery.session_id = "sess-abc";
  mockRouteQuery.stream = "test-stream";
  mockRouteQuery.from = "1700000000000000";
  mockRouteQuery.to = "1700001000000000";

  // Default: successful fetch with detail + one trace
  mockFetchSession.mockResolvedValue({
    detail: makeDetail(),
    traces: [makeTrace()],
  });
  mockFetchTurnDetail.mockResolvedValue({
    traceId: "trace-xyz",
    userMessage: { role: "user", content: "Hello" },
    assistantMessage: { role: "assistant", content: "Hi there" },
    model: "gpt-4",
  });
  mockFetchSessionSpans.mockResolvedValue([makeSpan()]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionDetails — loading state", () => {
  it("shows loading skeleton while fetch is in progress", async () => {
    // fetchSession never resolves during this test
    let resolveSession: (val: any) => void = () => {};
    mockFetchSession.mockReturnValue(
      new Promise((res) => {
        resolveSession = res;
      }),
    );

    const wrapper = mount(SessionDetails, {
      global: { stubs: globalStubs },
    });

    // onMounted fires load() which sets loading=true synchronously.
    // We need one tick to let onMounted execute.
    await wrapper.vm.$nextTick();

    // Before flushPromises — loading=true so the skeleton should be present
    const skeleton = wrapper.find("[data-test='session-detail-skeleton']");
    expect(skeleton.exists()).toBe(true);

    // Clean up
    resolveSession({ detail: makeDetail(), traces: [] });
    await flushPromises();
  });
});

describe("SessionDetails — error state", () => {
  it("shows 'failed to load' message when fetchSession throws", async () => {
    mockFetchSession.mockRejectedValue(new Error("network error"));

    const wrapper = await mountComponent();
    expect(wrapper.text()).toContain("traces.sessionDetail.failedToLoad");
    expect(wrapper.text()).toContain("network error");
  });

  it("shows a Retry button when error is set", async () => {
    mockFetchSession.mockRejectedValue(new Error("server error"));

    const wrapper = await mountComponent();
    // There are multiple .o-button elements (back button + retry); find the retry one
    const buttons = wrapper.findAll(".o-button");
    const retryBtn = buttons.find((b) => b.text().includes("traces.sessionDetail.retry"));
    expect(retryBtn).toBeTruthy();
    expect(retryBtn!.text()).toContain("traces.sessionDetail.retry");
  });

  it("clicking Retry calls load again", async () => {
    mockFetchSession.mockRejectedValueOnce(new Error("fail"));
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [],
    });

    const wrapper = await mountComponent();
    // Should show error first
    expect(wrapper.text()).toContain("traces.sessionDetail.failedToLoad");

    const buttons = wrapper.findAll(".o-button");
    const retryBtn = buttons.find((b) => b.text().includes("traces.sessionDetail.retry"));
    expect(retryBtn).toBeTruthy();
    await retryBtn!.trigger("click");
    await flushPromises();

    // After retry, fetchSession is called again
    expect(mockFetchSession).toHaveBeenCalledTimes(2);
  });
});

describe("SessionDetails — not found state", () => {
  it("shows 'session not found' when detail=null after load", async () => {
    mockFetchSession.mockResolvedValue({ detail: null, traces: [] });

    const wrapper = await mountComponent();
    expect(wrapper.text()).toContain("traces.sessionDetail.sessionNotFound");
  });
});

describe("SessionDetails — KPI strip", () => {
  it("renders KPI strip with Turns value", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail({ turns: 5 }),
      traces: [],
    });

    const wrapper = await mountComponent();
    const kpiStrip = wrapper.find("[data-test='session-detail-kpis']");
    expect(kpiStrip.exists()).toBe(true);
    const turnsKpi = wrapper.find("[data-test='session-detail-kpi-turns']");
    expect(turnsKpi.text()).toContain("traces.sessionDetail.kpi.turns");
    expect(turnsKpi.text()).toContain("5");
  });

  it("renders KPI strip with Duration label", async () => {
    const wrapper = await mountComponent();
    const latencyKpi = wrapper.find("[data-test='session-detail-kpi-latency']");
    expect(latencyKpi.text()).toContain("traces.sessionDetail.kpi.duration");
  });

  it("renders KPI strip with Tokens label", async () => {
    const wrapper = await mountComponent();
    const tokensKpi = wrapper.find("[data-test='session-detail-kpi-tokens']");
    expect(tokensKpi.text()).toContain("traces.sessionDetail.kpi.tokens");
  });

  it("renders KPI strip with Cost label", async () => {
    const wrapper = await mountComponent();
    const costKpi = wrapper.find("[data-test='session-detail-kpi-cost']");
    expect(costKpi.text()).toContain("traces.sessionDetail.kpi.cost");
  });

  it("renders session cost KPI with four decimal places", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail({ cost: 0.0069 }),
      traces: [makeTrace({ cost: 0.0069 })],
    });

    const wrapper = await mountComponent();
    const costKpi = wrapper.find("[data-test='session-detail-kpi-cost']");

    expect(costKpi.text()).toContain("$0.0069");
    expect(costKpi.text()).not.toContain("$0.01");
  });

  it("renders net cache impact with cost breakdown from session cache fields", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail({
        inputTokens: 1000,
        cost: 0.2,
        cacheReadInputTokens: 250,
        cacheCreationInputCost: 0.01,
        estimatedCostWithoutCache: 0.3,
        cacheReadSavings: 0.1234,
        netCacheImpact: 0.1,
      }),
      traces: [],
    });

    const wrapper = await mountComponent();
    const cacheKpi = wrapper.find("[data-test='session-detail-kpi-cacheImpact']");
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpi.cacheImpact");
    expect(cacheKpi.text()).toContain("$0.1000");
    expect(cacheKpi.text()).toContain(
      'traces.sessionDetail.kpiSub.cacheImpact{"ratio":25,"tokens":"250"}',
    );
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpiSub.actualCost");
    expect(cacheKpi.text()).toContain("$0.2000");
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpiSub.estimatedWithoutCache");
    expect(cacheKpi.text()).toContain("$0.3000");
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpiSub.grossCacheReadSavings");
    expect(cacheKpi.text()).toContain("$0.1234");
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpiSub.cacheCreationCost");
    expect(cacheKpi.text()).toContain("$0.0100");
    expect(cacheKpi.text()).toContain("traces.sessionDetail.kpiSub.netCacheImpact");
  });

  it("uses total prompt context for cache percentage when input excludes cache tokens", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail({
        inputTokens: 13_890,
        outputTokens: 381,
        tokens: 64_191,
        cacheReadInputTokens: 49_920,
        estimatedCostWithoutCache: 0.02808882,
        cacheReadSavings: 0.02153424,
        netCacheImpact: 0.02153424,
      }),
      traces: [],
    });

    const wrapper = await mountComponent();
    const cacheKpi = wrapper.find("[data-test='session-detail-kpi-cacheImpact']");
    expect(cacheKpi.text()).toContain(
      'traces.sessionDetail.kpiSub.cacheImpact{"ratio":78,"tokens":"49920"}',
    );
  });
});

describe("SessionDetails — turn rows", () => {
  it("renders a turn row for each trace", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "t1" }), makeTrace({ traceId: "t2" })],
    });

    const wrapper = await mountComponent();
    const rows = wrapper.findAll("[data-test^='session-turn-row-']");
    expect(rows).toHaveLength(2);
  });

  it("renders turn numbers on turn rows", async () => {
    const wrapper = await mountComponent();
    const row = wrapper.find(turnRowSelector());
    expect(row.text()).toContain("1");
  });

  it("uses the full trace ID in the row test hook", async () => {
    const traceId = "abcdef1234567890abcdef1234567890";
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId })],
    });

    const wrapper = await mountComponent();
    expect(wrapper.find(turnRowSelector(traceId)).exists()).toBe(true);
  });

  it("turn row uses critical surface tint for error traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "err-trace", status: "error", errorCount: 1 })],
    });

    const wrapper = await mountComponent();
    const row = wrapper.find(turnRowSelector("err-trace"));
    expect(row.classes()).toContain(
      "bg-[color-mix(in_srgb,var(--color-error-500)_5%,var(--color-surface-base))]",
    );
  });

  it("turn row uses default surface for ok traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "ok-trace", status: "ok" })],
    });

    const wrapper = await mountComponent();
    const row = wrapper.find(turnRowSelector("ok-trace"));
    expect(row.classes()).toContain("bg-surface-base");
  });

  it("status badge in turn header uses critical class for error traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ status: "error", errorCount: 1 })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(turnHeaderSelector());
    // Look for the status badge span within the header
    const badgeSpan = header
      .findAll("span")
      .find((s) => s.classes().join("").includes("text-error-500"));
    expect(badgeSpan).toBeTruthy();
  });

  it("status badge in turn header uses healthy class for ok traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ status: "ok" })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(turnHeaderSelector());
    const badgeSpan = header
      .findAll("span")
      .find((s) => s.classes().join("").includes("text-text-secondary"));
    expect(badgeSpan).toBeTruthy();
  });

  it("token metric column shows total tokens", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ inputTokens: 50, outputTokens: 100, tokens: 150 })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(turnHeaderSelector());
    expect(header.text()).toContain("150");
  });
});

async function expandTurn(wrapper: any, traceId = "trace-xyz") {
  const header = wrapper.find(turnHeaderSelector(traceId));
  expect(header.exists()).toBe(true);
  await header.trigger("click");
  await flushPromises();
}

describe("SessionDetails — turn expand/collapse", () => {
  it("shows skeleton while turn detail is loading", async () => {
    let resolveSpans: (val: any[]) => void = () => {};
    mockFetchSessionSpans.mockReturnValue(
      new Promise((res) => {
        resolveSpans = res;
      }),
    );

    const wrapper = await mountComponent();

    // Click the turn header to expand
    await expandTurn(wrapper);
    await wrapper.vm.$nextTick();

    // While loading, skeleton should be shown (turn-body with loading state)
    const turnBody = wrapper.find(turnBodySelector());
    expect(turnBody.exists()).toBe(true);
    const skeletons = wrapper.findAll(".o-skeleton-stub");
    expect(skeletons.length).toBeGreaterThan(0);

    // Clean up
    resolveSpans([makeSpan()]);
    await flushPromises();
  });

  it("shows user and assistant message blocks after turn detail loads", async () => {
    const wrapper = await mountComponent();

    // Click the turn header to expand
    await expandTurn(wrapper);

    const body = wrapper.find(turnBodySelector());
    expect(body.exists()).toBe(true);
    const text = body.text();
    expect(text).toContain("traces.sessionDetail.roles.user");
    expect(text).toContain("traces.sessionDetail.roles.assistant");
  });

  it("shows user message content when expanded", async () => {
    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).toContain("Hello");
  });

  it("shows assistant message content when expanded", async () => {
    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).toContain("Hi there");
  });

  it("collapses turn body when header is clicked again", async () => {
    const wrapper = await mountComponent();
    const header = wrapper.find(turnHeaderSelector());

    // Expand
    await header.trigger("click");
    await flushPromises();
    expect(wrapper.find(turnBodySelector()).exists()).toBe(true);

    // Collapse
    await header.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(turnBodySelector()).exists()).toBe(false);
  });
});

describe("SessionDetails — session span derived counts", () => {
  it("shows LLM and tool call counts from session spans", async () => {
    mockFetchSessionSpans.mockResolvedValue([
      makeSpan({ span_id: "llm-1" }),
      makeSpan({ span_id: "tool-1", gen_ai_operation_name: "execute_tool" }),
      makeSpan({ span_id: "tool-2", gen_ai_operation_name: "execute_tool" }),
    ]);

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    const body = wrapper.find(turnBodySelector());
    expect(body.text()).toContain("1 traces.sessionDetail.stats.llmCalls");
    expect(body.text()).toContain("2 traces.sessionDetail.stats.toolCalls");
  });

  it("omits span counts when no session spans are available for the turn", async () => {
    mockFetchSessionSpans.mockResolvedValue([]);

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    const body = wrapper.find(turnBodySelector());
    expect(body.text()).not.toContain("traces.sessionDetail.stats.llmCalls");
    expect(body.text()).not.toContain("traces.sessionDetail.stats.toolCalls");
  });
});

describe("SessionDetails — navigation", () => {
  it("'open in trace explorer' button opens the selected trace", async () => {
    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    // Find the "open in trace explorer" button in the expanded turn body.
    const buttons = wrapper.findAll(".o-button");
    const explorerBtn = buttons.find(
      (b) =>
        b.text().includes("traces.sessionDetail.openInTraceExplorer") ||
        b.text().includes("openInTraceExplorer"),
    );
    expect(explorerBtn).toBeTruthy();
    await explorerBtn!.trigger("click");

    expect(mockRouterPush).toHaveBeenCalled();
    const pushArg = mockRouterPush.mock.calls[0][0];
    expect(pushArg.name).toBe("traceDetails");
    expect(pushArg.query.trace_id).toBe("trace-xyz");
  });

  it("back button returns to the traces sessions tab", async () => {
    const wrapper = await mountComponent();

    await wrapper.find("[data-test='session-detail-back-btn']").trigger("click");

    expect(mockRouterPush).toHaveBeenCalled();
    const pushArg = mockRouterPush.mock.calls[0][0];
    expect(pushArg.name).toBe("traces");
    expect(pushArg.query.tab).toBe("sessions");
  });
});
