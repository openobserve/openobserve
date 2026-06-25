// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
// ---------------------------------------------------------------------------

import { ref } from "vue";

// Reactive state that tests can mutate to drive component rendering
const mockSessions = ref<any[]>([]);
const mockTotal = ref(0);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockHasLoadedOnce = ref(false);
const mockFetchPage = vi.fn();
const mockCancelAll = vi.fn();
const mockListAgents = vi.fn();
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn(() => Promise.resolve());
let mockRouteQuery: Record<string, any> = {};

vi.mock("./composables/useSessions", () => ({
  useSessions: vi.fn(() => ({
    sessions: mockSessions,
    total: mockTotal,
    loading: mockLoading,
    error: mockError,
    hasLoadedOnce: mockHasLoadedOnce,
    fetchPage: mockFetchPage,
    cancelAll: mockCancelAll,
  })),
}));

const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStreams: mockGetStreams,
  })),
}));

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    listAgents: (...args: any[]) => mockListAgents(...args),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  })),
  useRoute: vi.fn(() => ({ query: mockRouteQuery })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) {
        // Simple interpolation for count pill and other keys
        return key + JSON.stringify(params);
      }
      return key;
    },
  })),
}));

// The component now renders sessions through the design-system OTable
// (props: `data`/`columns`/`loading`, emits `row-click`, cell slots receive
// `{ row }`). The mock mirrors just that contract.
vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: [
      "data",
      "columns",
      "loading",
      "rowKey",
      "totalCount",
      "footerTitle",
    ],
    emits: ["row-click"],
    // Mirrors the OTable contract the component relies on: a loading state, one
    // row per item, the `#empty` slot when there are no rows, and a footer that
    // surfaces the server-side total (the old count pill now lives here).
    template: `
      <div class="otable-mock">
        <div data-test="sessions-list-toolbar">
          <slot name="toolbar" />
        </div>
        <div v-if="loading" data-test="sessions-list-loading" class="otable-loading" />
        <template v-else>
          <div
            v-for="row in data"
            :key="row.sessionId"
            class="table-row"
            :data-session-id="row.sessionId"
            @click="$emit('row-click', row)"
          >
            <slot name="cell-sessionId" :row="row">{{ row.sessionId }}</slot>
            <slot name="cell-firstSeenNanos" :row="row">{{ row.firstSeenNanos }}</slot>
            <slot name="cell-turns" :row="row">{{ row.turns }}</slot>
            <slot name="cell-durationNanos" :row="row">{{ row.durationNanos }}</slot>
            <span data-test="sessions-list-token-cell">
              <slot name="cell-tokens" :row="row">{{ row.inputTokens }} → {{ row.outputTokens }} = {{ row.tokens }}</slot>
            </span>
            <slot name="cell-cost" :row="row">{{ row.cost }}</slot>
            <slot name="cell-status" :row="row">{{ row.status }}</slot>
          </div>
          <div v-if="!data || data.length === 0" class="otable-empty">
            <slot name="empty" />
          </div>
        </template>
        <div data-test="sessions-list-footer" class="otable-footer">
          {{ footerTitle }} {{ totalCount }}
        </div>
      </div>
    `,
  },
}));

vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    emits: ["update:model-value"],
    template: `
      <div class="o-select" :data-label="label">
        <button
          v-for="option in options"
          :key="option.value || option"
          type="button"
          class="o-select-option"
          @click="$emit('update:model-value', option.value ?? option)"
        >
          {{ option.label ?? option }}
        </button>
      </div>
    `,
  },
}));

vi.mock("@/lib/core/ToggleGroup/OToggleGroup.vue", () => ({
  default: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:model-value"],
    template: `<div data-test="sessions-list-filter-mode" :data-value="modelValue"><slot /></div>`,
  },
}));

vi.mock("@/lib/core/ToggleGroup/OToggleGroupItem.vue", () => ({
  default: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: `<button type="button" :data-test="'sessions-list-filter-mode-' + value"><slot /></button>`,
  },
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

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SessionsList from "./SessionsList.vue";


const defaultProps = {
  streamName: "test-stream",
  startTime: 1000,
  endTime: 2000,
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    sessionId: "sess-123",
    firstSeenNanos: 1700000000000000000,
    lastSeenNanos: 1700001000000000000,
    durationNanos: 1000000000,
    turns: 3,
    inputTokens: 100,
    outputTokens: 200,
    tokens: 300,
    cost: 0.0042,
    errorCount: 0,
    status: "ok" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSessions.value = [];
  mockTotal.value = 0;
  mockLoading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = false;
  mockRouteQuery = {};

  // Default: streams load fine
  mockGetStreams.mockResolvedValue({
    list: [
      { name: "test-stream", settings: { is_llm_stream: true } },
    ],
  });
  mockListAgents.mockResolvedValue({ agents: [] });
  mockFetchPage.mockResolvedValue(undefined);
});

async function mountComponent(props = defaultProps) {
  const wrapper = mount(SessionsList, {
    props,
    global: {
      stubs: {
        QSelect: { template: '<div class="q-select-stub"><slot /></div>' },
        QPagination: { template: '<div class="q-pagination-stub" />' },
        QIcon: { template: '<span class="q-icon-stub"><slot /></span>' },
        QTooltip: { template: '<div class="q-tooltip-stub"><slot /></div>' },
        QSpinnerHourglass: { template: '<div class="q-spinner-stub" />' },
        QSkeleton: { template: '<div class="q-skeleton-stub" />' },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionsList — no LLM streams", () => {
  it("shows the empty state when streamsLoaded and availableStreams is empty", async () => {
    mockGetStreams.mockResolvedValue({ list: [] });
    const wrapper = await mountComponent();

    // With no LLM streams at all, the dedicated first-run empty state renders
    // on its own — the table (and its `#empty` slot) is not mounted.
    expect(
      wrapper.find("[data-test='sessions-empty-no-streams']").exists(),
    ).toBe(true);
  });
});

describe("SessionsList — error state", () => {
  it("shows 'failed to load' message when error is set and hasLoadedOnce=true", async () => {
    mockGetStreams.mockResolvedValue({
      list: [{ name: "test-stream", settings: { is_llm_stream: true } }],
    });
    mockError.value = "Connection refused";
    mockHasLoadedOnce.value = true;

    const wrapper = await mountComponent();
    const text = wrapper.text();
    expect(text).toContain("traces.sessionsList.failedToLoad");
    expect(text).toContain("Connection refused");
  });

  it("shows a Retry button when error is set and hasLoadedOnce=true", async () => {
    mockGetStreams.mockResolvedValue({
      list: [{ name: "test-stream", settings: { is_llm_stream: true } }],
    });
    mockError.value = "Server error";
    mockHasLoadedOnce.value = true;

    const wrapper = await mountComponent();
    const retryBtn = wrapper.find(".o-button");
    expect(retryBtn.exists()).toBe(true);
    expect(retryBtn.text()).toContain("traces.sessionsList.retry");
  });
});

describe("SessionsList — empty sessions", () => {
  it("shows the empty state when hasLoadedOnce=true, not loading, sessions=[]", async () => {
    mockHasLoadedOnce.value = true;
    mockLoading.value = false;
    mockSessions.value = [];

    const wrapper = await mountComponent();
    expect(wrapper.find("[data-test='sessions-empty']").exists()).toBe(true);
  });
});

describe("SessionsList — loading state", () => {
  it("renders loading slot content when loading=true", async () => {
    mockLoading.value = true;
    mockSessions.value = [];
    mockHasLoadedOnce.value = false;

    const wrapper = await mountComponent();
    // The TenstackTable mock renders the loading slot when loading=true
    expect(wrapper.find("[data-test='sessions-list-loading']").exists()).toBe(
      true,
    );
  });
});

describe("SessionsList — sessions table", () => {
  it("fetches stream sessions with no agent filter by default", async () => {
    await mountComponent();

    expect(mockFetchPage).toHaveBeenCalledWith(
      "test-stream",
      1000,
      2000,
      0,
      25,
      "",
    );
  });

  it("loads agents in stream mode so the Agent tab can be opened", async () => {
    await mountComponent();

    expect(mockListAgents).toHaveBeenCalledWith("test-org", 1000, 2000);
  });

  it("renders session rows when sessions data is present", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [
      makeSession({ sessionId: "sess-aaa" }),
      makeSession({ sessionId: "sess-bbb" }),
    ];
    mockTotal.value = 2;

    const wrapper = await mountComponent();
    const rows = wrapper.findAll(".table-row");
    expect(rows).toHaveLength(2);
  });

  it("surfaces the server-side sessions count via the table footer", async () => {
    mockHasLoadedOnce.value = true;
    mockLoading.value = false;
    mockSessions.value = [makeSession()];
    mockTotal.value = 42;

    const wrapper = await mountComponent();
    // The standalone count pill was removed; the total now flows to OTable's
    // footer via `:total-count`.
    const footer = wrapper.find("[data-test='sessions-list-footer']");
    expect(footer.exists()).toBe(true);
    expect(footer.text()).toContain("42");
  });

  it("status badge shows 'ok' status for ok sessions", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession({ sessionId: "sess-ok", status: "ok" })];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    const statusCell = wrapper.find('[data-test="sessions-list-status-sess-ok"]');
    expect(statusCell.exists()).toBe(true);
    expect(statusCell.text()).toContain("ok");
    // ok status uses healthy (green) CSS classes
    expect(statusCell.classes().join(" ")).toContain(
      "tw:text-[var(--o2-service-health-healthy,#16a34a)]",
    );
  });

  it("status badge shows 'error' status for error sessions", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [
      makeSession({ sessionId: "sess-err", status: "error", errorCount: 1 }),
    ];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    const statusCell = wrapper.find(
      '[data-test="sessions-list-status-sess-err"]',
    );
    expect(statusCell.exists()).toBe(true);
    expect(statusCell.text()).toContain("error");
    // error status uses critical CSS class
    expect(statusCell.classes().join(" ")).toContain(
      "tw:text-[var(--o2-service-health-critical)]",
    );
  });

  it("token column renders input → output (Σ total) format", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [
      makeSession({ inputTokens: 10, outputTokens: 20, tokens: 30 }),
    ];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    // Find the tokens cell slot content
    const tokensCell = wrapper.find("[data-test='sessions-list-token-cell']");
    expect(tokensCell.exists()).toBe(true);
    const text = tokensCell.text();
    expect(text).toContain("→");
    expect(text).toContain("=");
  });
});

describe("SessionsList — agent filter", () => {
  const supportAgent = {
    name: "support-agent",
    id: "agent-1",
    source_stream: "agent-stream",
    source_stream_type: "traces",
  };

  it("resolves a URL agent and fetches sessions from the agent source stream", async () => {
    mockRouteQuery = { type: "agent", agent: "support-agent" };
    mockGetStreams.mockResolvedValue({
      list: [{ name: "agent-stream", settings: { is_llm_stream: true } }],
    });
    mockListAgents.mockResolvedValue({ agents: [supportAgent] });

    await mountComponent({ streamName: "", startTime: 1000, endTime: 2000 });

    expect(mockFetchPage).toHaveBeenCalledWith(
      "agent-stream",
      1000,
      2000,
      0,
      25,
      `gen_ai_conversation_id IN (SELECT gen_ai_conversation_id FROM "agent-stream" WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != '' AND trace_id IN (SELECT trace_id FROM "agent-stream" WHERE gen_ai_agent_id = 'agent-1' GROUP BY trace_id) GROUP BY gen_ai_conversation_id)`,
    );
  });

  it("shows the no-agents state and skips session fetch when Agent mode has no agents", async () => {
    mockRouteQuery = { type: "agent" };
    mockGetStreams.mockResolvedValue({
      list: [{ name: "test-stream", settings: { is_llm_stream: true } }],
    });
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = await mountComponent();

    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(wrapper.find("[data-test='sessions-empty-no-agents']").exists()).toBe(true);
  });

  it("routes session details with the selected agent source stream", async () => {
    mockRouteQuery = { type: "agent", agent: "support-agent" };
    mockGetStreams.mockResolvedValue({
      list: [{ name: "agent-stream", settings: { is_llm_stream: true } }],
    });
    mockListAgents.mockResolvedValue({ agents: [supportAgent] });
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession({ sessionId: "sess-agent", userId: "u-1" })];
    mockTotal.value = 1;

    const wrapper = await mountComponent({ streamName: "", startTime: 1000, endTime: 2000 });
    await wrapper.find(".table-row").trigger("click");

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "sessionDetails",
      query: expect.objectContaining({
        stream: "agent-stream",
        session_id: "sess-agent",
        from: 1000,
        to: 2000,
        org_identifier: "test-org",
        user_id: "u-1",
      }),
    });
  });
});

describe("SessionsList — row click", () => {
  it("emits sessionSelected with the row data when a row is clicked", async () => {
    const session = makeSession({ sessionId: "sess-click" });
    mockHasLoadedOnce.value = true;
    mockSessions.value = [session];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    const row = wrapper.find(".table-row");
    expect(row.exists()).toBe(true);
    await row.trigger("click");

    const emitted = wrapper.emitted("sessionSelected");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toMatchObject({ sessionId: "sess-click" });
  });
});
