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
const mockHasMore = ref(false);
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockHasLoadedOnce = ref(false);
// These refs are module-scoped in useSessions (survive remount) — the
// component reads/mutates them directly, so the mock must supply real refs.
const mockLastRunAt = ref<number | null>(null);
const mockLoadedOrg = ref<string | null>(null);
const mockCurrentPage = ref(1);
const mockRowsPerPage = ref(20);
const mockSortBy = ref("end_time");
const mockSortOrder = ref<"asc" | "desc">("desc");
// Applied search term — module-scoped in the real composable, like the pagination.
const mockSearchKeyword = ref("");
const mockAgents = ref<any[]>([]);
const mockAgentsLoaded = ref(false);
const mockFetchPage = vi.fn();
const mockCancelAll = vi.fn();
const mockListAgents = vi.fn();
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn(() => Promise.resolve());
let mockRouteQuery: Record<string, any> = {};

// The real module pulls in the streaming-search stack (vuex store et al), so
// the term helper the component imports is mirrored here instead of pulled
// from `importOriginal`.
vi.mock("./composables/useSessions", () => ({
  SESSION_SEARCH_MAX_LEN: 256,
  normalizeSearchTerm: (raw: string) =>
    String(raw ?? "")
      .trim()
      .slice(0, 256),
  useSessions: vi.fn(() => ({
    sessions: mockSessions,
    total: mockTotal,
    hasMore: mockHasMore,
    loading: mockLoading,
    error: mockError,
    hasLoadedOnce: mockHasLoadedOnce,
    lastRunAt: mockLastRunAt,
    loadedOrg: mockLoadedOrg,
    currentPage: mockCurrentPage,
    rowsPerPage: mockRowsPerPage,
    searchKeyword: mockSearchKeyword,
    sortBy: mockSortBy,
    sortOrder: mockSortOrder,
    agents: mockAgents,
    agentsLoaded: mockAgentsLoaded,
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

// This file's default subject is Agent mode — enterprise-only — independent
// of whatever a developer's local .env happens to set. OSS-forced-stream
// behavior gets its own explicit tests further down, overriding this mock.
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "false",
  },
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
      "totalCountExact",
      "footerTitle",
      "sorting",
      "sortBy",
      "sortOrder",
      "sortFieldMap",
    ],
    emits: ["row-click", "sort-change"],
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
            <slot name="cell-lastSeenNanos" :row="row">{{ row.lastSeenNanos }}</slot>
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SessionsList from "./SessionsList.vue";
import AgentScopeCascade from "@/enterprise/components/AIObservability/AgentScopeCascade.vue";
import config from "@/aws-exports";

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSessions.value = [];
  mockTotal.value = 0;
  mockHasMore.value = false;
  mockLoading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = false;
  mockLastRunAt.value = null;
  mockLoadedOrg.value = null;
  mockCurrentPage.value = 1;
  mockRowsPerPage.value = 20;
  mockSearchKeyword.value = "";
  mockSortBy.value = "end_time";
  mockSortOrder.value = "desc";
  mockAgents.value = [];
  mockAgentsLoaded.value = false;
  mockRouteQuery = {};

  // Default: streams load fine
  mockGetStreams.mockResolvedValue({
    list: [{ name: "test-stream", settings: { is_llm_stream: true } }],
  });
  mockListAgents.mockResolvedValue({ agents: [] });
  mockFetchPage.mockImplementation(async () => {
    mockHasLoadedOnce.value = true;
    mockLoading.value = false;
  });
});

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

// `agents`/`hasLoadedOnce`/etc. are module-scoped mock singletons (mirroring
// the real useSessions), shared across every mount in this file. A wrapper
// left mounted keeps its own reactive watchers alive against those shared
// refs, so it can react to a LATER test's state changes — unmounting after
// each test (below) is what makes that safe.
const mountedWrappers: ReturnType<typeof mount>[] = [];

async function mountComponent(props = defaultProps) {
  const wrapper = mount(SessionsList, {
    props,
    global: {
      stubs: {},
    },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function refreshComponent(wrapper: any, startTime?: number, endTime?: number) {
  await wrapper.vm.refresh(startTime, endTime);
  await flushPromises();
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
    expect(wrapper.find("[data-test='sessions-empty-no-streams']").exists()).toBe(true);
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
    expect(text).toContain("Failed to load sessions");
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
    expect(retryBtn.text()).toContain("Retry");
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
    expect(wrapper.find("[data-test='sessions-list-loading']").exists()).toBe(true);
  });
});

describe("SessionsList — sessions table", () => {
  it("uses the session end time for the Last activity column", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession()];

    const wrapper = await mountComponent();
    const table = wrapper.findComponent({ name: "OTable" });
    const column = (table.props("columns") as any[]).find((item) => item.id === "lastSeenNanos");

    // setupTests installs the real en-US catalogue, so `t()` resolves here
    // rather than echoing the key.
    expect(column.header).toBe("Last activity");
    expect(column.accessorKey).toBe("lastSeenNanos");
    expect(wrapper.text()).toContain("2023-11-14 22:30:00");
    expect(wrapper.text()).not.toContain("2023-11-14 22:13:20");
  });

  it("uses server sorting and reloads the first page with the selected field", async () => {
    mockRouteQuery = { type: "stream" };
    mockCurrentPage.value = 3;
    const wrapper = await mountComponent();
    const table = wrapper.findComponent({ name: "OTable" });

    expect(table.props("sorting")).toBe("server");
    expect(table.props("sortBy")).toBe("end_time");
    expect(table.props("sortOrder")).toBe("desc");
    expect(table.props("sortFieldMap")).toMatchObject({
      turns: "trace_count",
      durationNanos: "duration",
      tokens: "gen_ai_usage_total_tokens",
      lastSeenNanos: "end_time",
    });

    mockFetchPage.mockClear();
    table.vm.$emit("sort-change", { column: "trace_count", order: "asc" });
    await flushPromises();

    expect(mockSortBy.value).toBe("trace_count");
    expect(mockSortOrder.value).toBe("asc");
    expect(mockCurrentPage.value).toBe(1);
    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", undefined);
  });

  it("cycles a descending server sort back to ascending instead of clearing it", async () => {
    mockRouteQuery = { type: "stream" };
    mockSortBy.value = "gen_ai_usage_cost";
    mockSortOrder.value = "desc";
    const wrapper = await mountComponent();
    const table = wrapper.findComponent({ name: "OTable" });

    mockFetchPage.mockClear();
    table.vm.$emit("sort-change", { column: "", order: "asc" });
    await flushPromises();

    expect(mockSortBy.value).toBe("gen_ai_usage_cost");
    expect(mockSortOrder.value).toBe("asc");
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });

  it("should fetch stream sessions with no agent filter when in stream mode", async () => {
    // Default scope is "agent" now — stream mode is opted into ONLY via the URL
    // `?type=stream` param (a stale saved preference must not land on stream).
    mockRouteQuery = { type: "stream" };
    const wrapper = await mountComponent();
    await refreshComponent(wrapper);

    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", undefined);
  });

  it("should not load agents while refreshing when in stream mode", async () => {
    mockRouteQuery = { type: "stream" };
    const wrapper = await mountComponent();
    await refreshComponent(wrapper);

    expect(mockListAgents).not.toHaveBeenCalled();
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

  it("derives lower-bound count metadata from has-more", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession()];
    mockTotal.value = 21;
    mockHasMore.value = true;

    const wrapper = await mountComponent();
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("totalCount")).toBe(21);
    expect(table.props("totalCountExact")).toBe(false);
  });

  it("status badge shows 'ok' status for ok sessions", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession({ sessionId: "sess-ok", status: "ok" })];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    const statusCell = wrapper.find('[data-test="sessions-list-status-sess-ok"]');
    expect(statusCell.exists()).toBe(true);
    // Migrated to <OTag type="sessionStatus">: registry label + success-soft variant.
    expect(statusCell.text()).toContain("Ok");
    expect(statusCell.classes().join(" ")).toContain("badge-success");
  });

  it("status badge shows 'error' status for error sessions", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession({ sessionId: "sess-err", status: "error", errorCount: 1 })];
    mockTotal.value = 1;

    const wrapper = await mountComponent();
    const statusCell = wrapper.find('[data-test="sessions-list-status-sess-err"]');
    expect(statusCell.exists()).toBe(true);
    // Migrated to <OTag type="sessionStatus">: registry label + error-soft variant.
    expect(statusCell.text()).toContain("Error");
    expect(statusCell.classes().join(" ")).toContain("badge-error");
  });

  it("token column renders input → output (Σ total) format", async () => {
    mockHasLoadedOnce.value = true;
    mockSessions.value = [makeSession({ inputTokens: 10, outputTokens: 20, tokens: 30 })];
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

    const wrapper = await mountComponent({ streamName: "", startTime: 1000, endTime: 2000 });
    await refreshComponent(wrapper);

    expect(mockFetchPage).toHaveBeenCalledWith(
      "agent-stream",
      1000,
      2000,
      0,
      20,
      `gen_ai_agent_id = 'agent-1'`,
      undefined,
    );
  });

  it("shows the no-agents state and skips session fetch when Agent mode has no agents", async () => {
    mockRouteQuery = { type: "agent" };
    mockGetStreams.mockResolvedValue({
      list: [{ name: "test-stream", settings: { is_llm_stream: true } }],
    });
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = await mountComponent();
    await refreshComponent(wrapper);

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
    await refreshComponent(wrapper);
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

describe("SessionsList — agent selection survives a back-navigation remount", () => {
  const agentA = {
    name: "agent-a",
    id: "agent-a-id",
    source_stream: "stream-a",
    source_stream_type: "traces",
    env: "prod",
    version: "v1",
  };
  const agentB = {
    name: "agent-b",
    id: "agent-b-id",
    source_stream: "stream-b",
    source_stream_type: "traces",
    env: "prod",
    version: "v1",
  };
  // Same NAME as agentB, different env — proves restore uses the exact
  // (env, name, version) triple rather than picking the first name match.
  const agentBStaging = {
    name: "agent-b",
    id: "agent-b-staging-id",
    source_stream: "stream-b-staging",
    source_stream_type: "traces",
    env: "staging",
    version: "v1",
  };

  it("restores the previously-picked agent instead of defaulting to the first one", async () => {
    // Simulates returning from a session detail: the list was already loaded
    // (module-scoped state survives the unmount/remount), and the user had
    // picked "agent-b" last time — persisted to localStorage since the `Back`
    // navigation doesn't always round-trip it via the URL.
    localStorage.setItem("sessionsList_agentFilter", "agent-b");
    localStorage.setItem("sessionsList_envFilter", "prod");
    localStorage.setItem("sessionsList_versionFilter", "v1");
    mockAgents.value = [agentA, agentB];
    mockAgentsLoaded.value = true;
    mockHasLoadedOnce.value = true;
    mockLoadedOrg.value = "test-org";
    mockError.value = null;

    const wrapper = await mountComponent({ streamName: "", startTime: 1000, endTime: 2000 });
    // Mirrors SessionsPage's mount-replay call after the DateTime fires its
    // programmatic window replay on remount (force=false, unlike a real date
    // change or explicit refresh).
    await wrapper.vm.refresh(1000, 2000, false);
    await flushPromises();

    expect(wrapper.findComponent(AgentScopeCascade).props("selectedAgentName")).toBe("agent-b");
    // Restoring the selection must not defeat the point of the cache guard.
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it("restores the exact env, not just a same-named agent under a different one", async () => {
    localStorage.setItem("sessionsList_agentFilter", "agent-b");
    localStorage.setItem("sessionsList_envFilter", "staging");
    localStorage.setItem("sessionsList_versionFilter", "v1");
    // "agent-b" exists under BOTH prod and staging — agentB (prod) comes
    // first in the list, so a name-only restore would wrongly land on it.
    mockAgents.value = [agentA, agentB, agentBStaging];
    mockAgentsLoaded.value = true;
    mockHasLoadedOnce.value = true;
    mockLoadedOrg.value = "test-org";
    mockError.value = null;

    const wrapper = await mountComponent({ streamName: "", startTime: 1000, endTime: 2000 });
    await wrapper.vm.refresh(1000, 2000, false);
    await flushPromises();

    const cascadeProps = wrapper.findComponent(AgentScopeCascade).props();
    expect(cascadeProps.selectedAgentName).toBe("agent-b");
    expect(cascadeProps.selectedEnv).toBe("staging");
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

describe("SessionsList — OSS builds (neither isEnterprise nor isCloud is 'true')", () => {
  afterEach(() => {
    // Every other describe block in this file assumes enterprise mode (see
    // the module-level @/aws-exports mock) — restore it so later tests aren't
    // affected by mutating the shared mock object here.
    config.isEnterprise = "true";
    config.isCloud = "false";
  });

  it("hides the Stream/Agent toggle — Agent mode needs the enterprise-only agent-mapping API", async () => {
    config.isEnterprise = "false";
    const wrapper = await mountComponent();
    expect(wrapper.find("[data-test='sessions-list-filter-mode']").exists()).toBe(false);
  });

  it("forces Stream mode even when the URL asks for Agent mode", async () => {
    config.isEnterprise = "false";
    mockRouteQuery = { type: "agent" };
    const wrapper = await mountComponent();
    await flushPromises();
    // With no toggle, the stream selector is always visible.
    expect(wrapper.find("[data-test='sessions-list-stream-selector']").exists()).toBe(true);
    expect(wrapper.findComponent(AgentScopeCascade).exists()).toBe(false);
  });

  it("still shows the toggle on a cloud build (isCloud true) even with isEnterprise false — cloud registers the same enterprise route/backend", async () => {
    config.isEnterprise = "false";
    config.isCloud = "true";
    const wrapper = await mountComponent();
    expect(wrapper.find("[data-test='sessions-list-filter-mode']").exists()).toBe(true);
  });

  it("defaults to Agent mode on a cloud build, same as enterprise", async () => {
    config.isEnterprise = "false";
    config.isCloud = "true";
    const wrapper = await mountComponent();
    await flushPromises();
    expect(wrapper.findComponent(AgentScopeCascade).exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// List search
// ---------------------------------------------------------------------------

describe("SessionsList — search", () => {
  const SEARCH = "[data-test='sessions-list-search-field']";
  const value = (wrapper: any, sel: string) =>
    (wrapper.find(sel).element as HTMLInputElement).value;
  const NO_SEARCH = ["test-stream", 1000, 2000, 0, 20, "", undefined] as const;

  async function mountInStreamMode() {
    mockRouteQuery = { type: "stream", ...mockRouteQuery };
    const wrapper = await mountComponent();
    await refreshComponent(wrapper);
    mockFetchPage.mockClear();
    mockRouterReplace.mockClear();
    return wrapper;
  }

  it("renders one full-width search box on the scope row, matched against the user id or the message", async () => {
    const wrapper = await mountInStreamMode();
    expect(wrapper.find(SEARCH).attributes("placeholder")).toBe("Search by user or message");
  });

  // Live search, same as LogStream.vue's Streams search: the box's own
  // `:debounce="300"` settles typing into one value before it ever reaches
  // `searchKeyword` — no Enter/Escape affordance. Setting the mocked
  // composable's ref directly is the same instance the component's `watch`
  // observes, so it exercises the exact re-fetch path without fighting a real
  // setTimeout in the test.
  it("a settled term re-fetches page 1", async () => {
    mockCurrentPage.value = 3;
    const wrapper = await mountInStreamMode();
    mockSearchKeyword.value = "luis";
    await flushPromises();
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", {
      keyword: "luis",
    });
    expect(mockCurrentPage.value).toBe(1);
    expect(value(wrapper, SEARCH)).toBe("luis");
  });

  it("debounces real typing in the box — no fetch until the input settles", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountInStreamMode();
      await wrapper.find(SEARCH).setValue("luis");
      expect(mockFetchPage).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", {
        keyword: "luis",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the clear control drops the term and re-fetches unfiltered", async () => {
    mockSearchKeyword.value = "luis";
    const wrapper = await mountInStreamMode();
    expect(value(wrapper, SEARCH)).toBe("luis");

    await wrapper.find("[data-test='sessions-list-search-clear']").trigger("click");
    await flushPromises();
    expect(mockSearchKeyword.value).toBe("");
    expect(mockFetchPage).toHaveBeenCalledWith(...NO_SEARCH);
  });

  it("writes the applied term to the URL and removes it when cleared", async () => {
    const wrapper = await mountInStreamMode();
    mockSearchKeyword.value = "luis";
    await flushPromises();
    expect(mockRouterReplace).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ type: "stream", keyword: "luis" }),
    });

    await wrapper.find("[data-test='sessions-list-search-clear']").trigger("click");
    await flushPromises();
    const query = mockRouterReplace.mock.lastCall?.[0].query;
    expect(query).not.toHaveProperty("keyword");
  });

  it("applies the term from the URL before the first fetch", async () => {
    mockRouteQuery = { type: "stream", keyword: "luis" };
    const wrapper = await mountComponent();
    await refreshComponent(wrapper);
    expect(value(wrapper, SEARCH)).toBe("luis");
    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", {
      keyword: "luis",
    });
  });

  it("a URL term that differs from the cached list bypasses the mount cache", async () => {
    // Cached rows were fetched without a search; the pasted link carries one.
    mockHasLoadedOnce.value = true;
    mockLoadedOrg.value = "test-org";
    mockRouteQuery = { type: "stream", keyword: "luis" };
    const wrapper = await mountComponent();
    // Non-forced mount replay — normally served from the cache.
    await wrapper.vm.refresh(1000, 2000, false);
    await flushPromises();
    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", {
      keyword: "luis",
    });
  });

  it("back navigation restores the filtered rows and the term from the singleton", async () => {
    mockHasLoadedOnce.value = true;
    mockLoadedOrg.value = "test-org";
    mockSearchKeyword.value = "luis";
    mockSessions.value = [makeSession({ sessionId: "sess-luis", userId: "luis@example.com" })];
    mockTotal.value = 1;
    mockRouteQuery = { type: "stream", keyword: "luis" };

    const wrapper = await mountComponent();
    await wrapper.vm.refresh(1000, 2000, false);
    await flushPromises();

    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(wrapper.find("[data-session-id='sess-luis']").exists()).toBe(true);
    expect(value(wrapper, SEARCH)).toBe("luis");
  });

  it("shows the filtered empty state, not the first-run screen, and its Clear action re-fetches", async () => {
    mockHasLoadedOnce.value = true;
    mockSearchKeyword.value = "nobody";
    const wrapper = await mountInStreamMode();

    expect(wrapper.find("[data-test='sessions-empty-search']").exists()).toBe(true);
    expect(wrapper.find("[data-test='sessions-empty']").exists()).toBe(false);
    expect(wrapper.text()).toContain("No sessions match your search");

    await wrapper.find("[data-test='sessions-empty-search'] button").trigger("click");
    await flushPromises();
    expect(mockSearchKeyword.value).toBe("");
    expect(value(wrapper, SEARCH)).toBe("");
    expect(mockFetchPage).toHaveBeenCalledWith(...NO_SEARCH);
  });

  it("keeps the term across an explicit refresh", async () => {
    mockSearchKeyword.value = "luis";
    const wrapper = await mountInStreamMode();
    await refreshComponent(wrapper);
    expect(mockSearchKeyword.value).toBe("luis");
    expect(mockFetchPage).toHaveBeenCalledWith("test-stream", 1000, 2000, 0, 20, "", {
      keyword: "luis",
    });
  });
});
