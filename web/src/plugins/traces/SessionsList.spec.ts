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

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
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

vi.mock("@/components/TenstackTable.vue", () => ({
  default: {
    name: "TenstackTable",
    props: ["rows", "columns", "loading", "rowHeight"],
    emits: ["click:dataRow"],
    template: `
      <div class="tenstack-table-mock">
        <slot v-if="loading" name="loading" />
        <slot v-else-if="!rows || rows.length === 0" name="empty" />
        <template v-else>
          <div
            v-for="row in rows"
            :key="row.sessionId"
            class="table-row"
            :data-session-id="row.sessionId"
            @click="$emit('click:dataRow', row)"
          >
            <slot name="cell-sessionId" :item="row">{{ row.sessionId }}</slot>
            <slot name="cell-firstSeenNanos" :item="row">{{ row.firstSeenNanos }}</slot>
            <slot name="cell-turns" :item="row">{{ row.turns }}</slot>
            <slot name="cell-durationNanos" :item="row">{{ row.durationNanos }}</slot>
            <slot name="cell-tokens" :item="row">{{ row.inputTokens }} → {{ row.outputTokens }} (Σ {{ row.tokens }})</slot>
            <slot name="cell-cost" :item="row">{{ row.cost }}</slot>
            <slot name="cell-status" :item="row">{{ row.status }}</slot>
          </div>
        </template>
      </div>
    `,
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import SessionsList from "./SessionsList.vue";

installQuasar({ plugins: [quasar.Notify] });

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
  mockSessions.value = [];
  mockTotal.value = 0;
  mockLoading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = false;

  // Default: streams load fine
  mockGetStreams.mockResolvedValue({
    list: [
      { name: "test-stream", settings: { is_llm_stream: true } },
    ],
  });
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
  it("shows 'no streams found' message when streamsLoaded and availableStreams is empty", async () => {
    mockGetStreams.mockResolvedValue({ list: [] });
    const wrapper = await mountComponent();

    const text = wrapper.text();
    expect(text).toContain("traces.sessionsList.noStreamsFound");
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
  it("shows 'no sessions found' when hasLoadedOnce=true, not loading, sessions=[]", async () => {
    mockHasLoadedOnce.value = true;
    mockLoading.value = false;
    mockSessions.value = [];

    const wrapper = await mountComponent();
    expect(wrapper.text()).toContain("traces.sessionsList.noSessionsFound");
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

  it("count pill shows sessions count text when sessions present", async () => {
    mockHasLoadedOnce.value = true;
    mockLoading.value = false;
    mockSessions.value = [makeSession()];
    mockTotal.value = 42;

    const wrapper = await mountComponent();
    const pill = wrapper.find("[data-test='sessions-list-count-pill']");
    expect(pill.exists()).toBe(true);
    // The t() mock returns key+params — just verify the count pill is rendered
    expect(pill.text()).toContain("traces.sessionsList.countPill");
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
    const tokensCell = wrapper.find(".tw\\:tabular-nums");
    expect(tokensCell.exists()).toBe(true);
    const text = tokensCell.text();
    expect(text).toContain("→");
    expect(text).toContain("Σ");
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
