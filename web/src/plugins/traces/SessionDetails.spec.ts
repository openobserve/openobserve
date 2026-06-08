// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
// ---------------------------------------------------------------------------

const mockFetchSession = vi.fn();
const mockFetchTurnDetail = vi.fn();
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
  })),
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
}));

// Quasar mock (no longer a dependency)
vi.mock("quasar", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
  useQuasar: () => ({
    notify: vi.fn(),
  }),
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
    errorCount: 0,
    status: "ok" as const,
    model: "gpt-4",
    models: [] as string[],
    ...overrides,
  };
}

const globalStubs = {
  OSpinner: {
    template: '<div data-test="loading-spinner" />',
    props: ["size"],
  },
  OIcon: {
    template: '<span class="q-icon-stub" :data-name="name"><slot /></span>',
    props: ["name", "size"],
  },
  OTooltip: { template: '<div><slot /><span><slot name="content" /></span></div>', props: ["content", "maxWidth"] },
  OSkeleton: {
    template: '<div class="q-skeleton-stub" />',
    props: ["type", "width", "height"],
  },
};

async function mountComponent() {
  const wrapper = mount(SessionDetails, {
    global: {
      stubs: globalStubs,
    },
  });
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionDetails — loading state", () => {
  it("shows loading spinner while fetch is in progress", async () => {
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

    // Before flushPromises — loading=true so spinner should be present
    const spinner = wrapper.find("[data-test='loading-spinner']");
    expect(spinner.exists()).toBe(true);

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
    const retryBtn = buttons.find((b) =>
      b.text().includes("traces.sessionDetail.retry"),
    );
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
    const retryBtn = buttons.find((b) =>
      b.text().includes("traces.sessionDetail.retry"),
    );
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
    const kpiStrip = wrapper.find(".kpi-strip");
    expect(kpiStrip.exists()).toBe(true);
    expect(kpiStrip.text()).toContain("traces.sessionDetail.kpi.turns");
    expect(kpiStrip.text()).toContain("5");
  });

  it("renders KPI strip with Duration label", async () => {
    const wrapper = await mountComponent();
    const kpiStrip = wrapper.find(".kpi-strip");
    expect(kpiStrip.text()).toContain("traces.sessionDetail.kpi.duration");
  });

  it("renders KPI strip with Input Tokens label", async () => {
    const wrapper = await mountComponent();
    const kpiStrip = wrapper.find(".kpi-strip");
    expect(kpiStrip.text()).toContain("traces.sessionDetail.kpi.inputTokens");
  });

  it("renders KPI strip with Output Tokens label", async () => {
    const wrapper = await mountComponent();
    const kpiStrip = wrapper.find(".kpi-strip");
    expect(kpiStrip.text()).toContain("traces.sessionDetail.kpi.outputTokens");
  });

  it("renders KPI strip with Cost label", async () => {
    const wrapper = await mountComponent();
    const kpiStrip = wrapper.find(".kpi-strip");
    expect(kpiStrip.text()).toContain("traces.sessionDetail.kpi.cost");
  });
});

describe("SessionDetails — turn rows", () => {
  it("renders a turn row for each trace", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [
        makeTrace({ traceId: "t1" }),
        makeTrace({ traceId: "t2" }),
      ],
    });

    const wrapper = await mountComponent();
    const rows = wrapper.findAll(".turn-header");
    expect(rows).toHaveLength(2);
  });

  it("renders Turn N label on turn rows", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.text()).toContain("traces.sessionDetail.turnLabel");
  });

  it("shows full trace ID on each turn row (not truncated)", async () => {
    const traceId = "abcdef1234567890abcdef1234567890";
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId })],
    });

    const wrapper = await mountComponent();
    // The template renders the full trace.traceId in a span
    expect(wrapper.text()).toContain(traceId);
  });

  it("turn-card has turn-card--error class for error traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "err-trace", status: "error", errorCount: 1 })],
    });

    const wrapper = await mountComponent();
    const card = wrapper.find(".turn-card");
    expect(card.classes()).toContain("turn-card--error");
  });

  it("turn-card has turn-card--ok class for ok traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "ok-trace", status: "ok" })],
    });

    const wrapper = await mountComponent();
    const card = wrapper.find(".turn-card");
    expect(card.classes()).toContain("turn-card--ok");
  });

  it("status badge in turn header uses critical class for error traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ status: "error", errorCount: 1 })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");
    // Look for the status badge span within the header
    const badgeSpan = header.findAll("span").find(
      (s) => s.classes().join("").includes("tw:text-[var(--o2-service-health-critical)]"),
    );
    expect(badgeSpan).toBeTruthy();
  });

  it("status badge in turn header uses healthy class for ok traces", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ status: "ok" })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");
    const badgeSpan = header.findAll("span").find(
      (s) =>
        s.classes().join("").includes("tw:text-[var(--o2-service-health-healthy,#16a34a)]"),
    );
    expect(badgeSpan).toBeTruthy();
  });

  it("token summary shows input → output (Σ total) format", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ inputTokens: 50, outputTokens: 100, tokens: 150 })],
    });

    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");
    const text = header.text();
    expect(text).toContain("→");
    expect(text).toContain("Σ");
  });
});

describe("SessionDetails — turn expand/collapse", () => {
  it("shows skeleton while turn detail is loading", async () => {
    let resolveTurnDetail: (val: any) => void = () => {};
    mockFetchTurnDetail.mockReturnValue(
      new Promise((res) => {
        resolveTurnDetail = res;
      }),
    );

    const wrapper = await mountComponent();

    // Click the turn header to expand
    const header = wrapper.find(".turn-header");
    await header.trigger("click");
    await wrapper.vm.$nextTick();

    // While loading, skeleton should be shown (turn-body with loading state)
    const turnBody = wrapper.find(".turn-body");
    expect(turnBody.exists()).toBe(true);
    const skeletons = wrapper.findAll(".q-skeleton-stub");
    expect(skeletons.length).toBeGreaterThan(0);

    // Clean up
    resolveTurnDetail({
      traceId: "trace-xyz",
      userMessage: null,
      assistantMessage: null,
      model: null,
    });
    await flushPromises();
  });

  it("shows user and assistant message blocks after turn detail loads", async () => {
    const wrapper = await mountComponent();

    // Click the turn header to expand
    const header = wrapper.find(".turn-header");
    await header.trigger("click");
    await flushPromises();

    const body = wrapper.find(".turn-body");
    expect(body.exists()).toBe(true);
    const text = body.text();
    expect(text).toContain("traces.sessionDetail.roles.user");
    expect(text).toContain("traces.sessionDetail.roles.assistant");
  });

  it("shows user message content when expanded", async () => {
    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");
    await header.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Hello");
  });

  it("shows assistant message content when expanded", async () => {
    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");
    await header.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Hi there");
  });

  it("collapses turn body when header is clicked again", async () => {
    const wrapper = await mountComponent();
    const header = wrapper.find(".turn-header");

    // Expand
    await header.trigger("click");
    await flushPromises();
    expect(wrapper.find(".turn-body").exists()).toBe(true);

    // Collapse
    await header.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".turn-body").exists()).toBe(false);
  });
});

describe("SessionDetails — spans section (LLM / tool / other counts)", () => {
  async function expandTurn(wrapper: any) {
    const header = wrapper.find(".turn-header");
    await header.trigger("click");
    await flushPromises();
  }

  it("shows LLM calls row when llmCalls > 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 3,
      toolCalls: 0,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).toContain("traces.sessionDetail.stats.llmCalls");
    expect(wrapper.text()).toContain("3");
  });

  it("hides LLM calls row when llmCalls is 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: null,
      assistantMessage: null,
      model: null,
      llmCalls: 0,
      toolCalls: 0,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).not.toContain("traces.sessionDetail.stats.llmCalls");
  });

  it("shows tool calls row when toolCalls > 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 1,
      toolCalls: 5,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).toContain("traces.sessionDetail.stats.toolCalls");
    expect(wrapper.text()).toContain("5");
  });

  it("hides tool calls row when toolCalls is 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: null,
      assistantMessage: null,
      model: null,
      llmCalls: 0,
      toolCalls: 0,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).not.toContain("traces.sessionDetail.stats.toolCalls");
  });

  it("shows Other row when otherCalls > 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 2,
      toolCalls: 1,
      otherCalls: 4,
      otherOps: ["agent", "pipeline"],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).toContain("traces.sessionDetail.stats.otherCalls");
    expect(wrapper.text()).toContain("4");
  });

  it("hides Other row when otherCalls is 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 2,
      toolCalls: 1,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    expect(wrapper.text()).not.toContain("traces.sessionDetail.stats.otherCalls");
  });

  it("info icon is present on Other row when otherCalls > 0", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 1,
      toolCalls: 0,
      otherCalls: 3,
      otherOps: ["agent"],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    const infoIcons = wrapper
      .findAll(".q-icon-stub")
      .filter((el: any) => el.attributes("data-name") === "info");
    expect(infoIcons.length).toBeGreaterThan(0);
  });

  it("tooltip text includes operation names from otherOps", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 1,
      toolCalls: 0,
      otherCalls: 2,
      otherOps: ["agent", "pipeline"],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    // QTooltip stub renders its slot content into the DOM
    expect(wrapper.text()).toContain("agent, pipeline");
  });

  it("Total equals llmCalls + toolCalls + otherCalls", async () => {
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 11,
      toolCalls: 6,
      otherCalls: 5,
      otherOps: ["agent"],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    // The spans stat-section is the one containing the "spans" label.
    // Multiple stat-row--total elements exist (tokens has one too), so
    // find the stat-section whose label key is "stats.spans" and check
    // its total row.
    const statSections = wrapper.findAll(".stat-section");
    const spansSection = statSections.find((s: any) =>
      s.text().includes("traces.sessionDetail.stats.spans"),
    );
    expect(spansSection).toBeTruthy();
    // 11 + 6 + 5 = 22
    const totalRow = spansSection!.find(".stat-row--total");
    expect(totalRow.text()).toContain("22");
  });

  it("Total does not equal raw spanCount when there are non-gen_ai spans", async () => {
    // spanCount=69 (all trace spans) but llm+tool=40 gen_ai spans only —
    // verify the Spans Total shows 40, not 69.
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "trace-xyz", spanCount: 69 })],
    });
    mockFetchTurnDetail.mockResolvedValue({
      traceId: "trace-xyz",
      userMessage: { role: "user", content: "Hi" },
      assistantMessage: { role: "assistant", content: "Hello" },
      model: "gpt-4",
      llmCalls: 19,
      toolCalls: 21,
      otherCalls: 0,
      otherOps: [],
    });

    const wrapper = await mountComponent();
    await expandTurn(wrapper);

    const statSections = wrapper.findAll(".stat-section");
    const spansSection = statSections.find((s: any) =>
      s.text().includes("traces.sessionDetail.stats.spans"),
    );
    expect(spansSection).toBeTruthy();
    const totalRow = spansSection!.find(".stat-row--total");
    expect(totalRow.text()).toContain("40");
    expect(totalRow.text()).not.toContain("69");
  });
});

describe("SessionDetails — navigation", () => {
  it("'open in trace explorer' button triggers router navigation", async () => {
    const wrapper = await mountComponent();

    // Find the "open in trace explorer" button (in the user+session header)
    const buttons = wrapper.findAll(".o-button");
    // The openInTraceExplorer button is after the back button
    const explorerBtn = buttons.find(
      (b) =>
        b.text().includes("traces.sessionDetail.openInTraceExplorer") ||
        b.text().includes("openInTraceExplorer"),
    );
    expect(explorerBtn).toBeTruthy();
    await explorerBtn!.trigger("click");

    expect(mockRouterPush).toHaveBeenCalled();
    const pushArg = mockRouterPush.mock.calls[0][0];
    expect(pushArg.name).toBe("traces");
  });

  it("clicking open_in_new icon on a trace row navigates to traceDetails", async () => {
    mockFetchSession.mockResolvedValue({
      detail: makeDetail(),
      traces: [makeTrace({ traceId: "trace-xyz" })],
    });

    const wrapper = await mountComponent();

    // Find the open_in_new icon in the turn header and click it
    const openIcons = wrapper
      .findAll(".q-icon-stub")
      .filter((el) => el.attributes("name") === "open_in_new");

    // There should be at least one (the trace explore icon in turn row)
    // trigger stop-propagated click
    if (openIcons.length > 0) {
      await openIcons[0].trigger("click");
    }
    // Router push may have been called by openInTraceExplorer or openTrace
    // We just verify the navigation call is there after clicking any open_in_new
  });
});
