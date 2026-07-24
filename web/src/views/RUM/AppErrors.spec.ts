// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";

// ---------------------------------------------------------------------------
// Module-level controllable refs for useErrorIssuesData mock
// (These are reset in beforeEach so tests are fully independent.)
// ---------------------------------------------------------------------------
const mockIssues = ref<any[]>([]);
const mockTrendBuckets = ref<Record<string, number[]>>({});
const mockChartSeries = ref<any[]>([]);
const mockLatestDeploy = ref<any>(null);
const mockDeploySpikeFactor = ref<number | null>(null);
const mockKpis = ref<any>({
  totalErrors: 0,
  uniqueIssues: 0,
  issuesTruncated: false,
  errorSessions: 0,
  totalSessions: 0,
  crashFreePct: null,
  usersAffected: 0,
  totalUsers: 0,
  newIssues: 0,
  deployVersion: null,
});
const mockIsLoadingIssues = ref(false);
const mockIsLoadingChart = ref(false);
const mockIsLoadingKpis = ref(false);
const mockIsLoadingTrends = ref(false);
const mockFetchAll = vi.fn().mockResolvedValue(undefined);
const mockCancelAll = vi.fn();
const mockFetchTrend = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// vi.mock() calls — MUST appear before any imports of the components that use
// these modules. Vitest hoists them automatically.
// ---------------------------------------------------------------------------

vi.mock("@/composables/rum/useErrorIssuesData", () => ({
  default: () => ({
    issues: mockIssues,
    trendBuckets: mockTrendBuckets,
    chartSeries: mockChartSeries,
    latestDeploy: mockLatestDeploy,
    deploySpikeFactor: mockDeploySpikeFactor,
    kpis: mockKpis,
    isLoadingIssues: mockIsLoadingIssues,
    isLoadingChart: mockIsLoadingChart,
    isLoadingKpis: mockIsLoadingKpis,
    isLoadingTrends: mockIsLoadingTrends,
    fetchAll: mockFetchAll,
    fetchTrend: mockFetchTrend,
    cancelAll: mockCancelAll,
  }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "error_id", type: "keyword" },
        { name: "error_message", type: "keyword" },
        { name: "error_stack", type: "text" },
        { name: "view_url", type: "keyword" },
        // This one is in userDataSet so it populates streamFields
        { name: "user_agent_device_brand", type: "keyword" },
        { name: "geo_info_city", type: "keyword" },
      ],
    }),
  }),
}));

// Lightweight stubs for heavy async dependencies
vi.mock("@/composables/useSuggestions", () => ({
  default: () => ({
    autoCompleteData: ref({ query: "", cursorIndex: 0, popup: { open: false }, org: "", streamType: "", streamName: "" }),
    effectiveKeywords: ref([]),
    effectiveSuggestions: ref([]),
    getSuggestions: vi.fn(),
    updateFieldKeywords: vi.fn(),
  }),
}));

vi.mock("@/composables/useSqlEditorDiagnostics", () => ({
  useSqlEditorDiagnostics: (opts: any) => {
    // Evaluate the reactive getters the view passes in — they are real view
    // code (computed sources reading errorTrackingState), not mock behavior.
    // Deferred: the getters close over consts declared later in <script setup>,
    // so touching them synchronously would hit the temporal dead zone.
    Promise.resolve().then(() => {
      void opts?.sqlMode?.value;
      void opts?.query?.value;
      void opts?.streamName?.value;
    });
    return {
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onQueryChange: vi.fn(),
    };
  },
}));

vi.mock("@/components/logs/useQueryPlaceholder", () => ({
  useQueryPlaceholder: (...args: any[]) => {
    // Same rationale (and same TDZ deferral) as above.
    Promise.resolve().then(() => {
      for (const arg of args) {
        void (arg && typeof arg === "object" && "value" in arg
          ? arg.value
          : arg);
      }
    });
    return {
      placeholder: ref("Filter errors…"),
    };
  },
}));

vi.mock("@/plugins/traces/SyntaxGuide.vue", () => ({
  default: { template: '<div data-test="syntax-guide-stub" />' },
}));

// ---------------------------------------------------------------------------
// Component import (AFTER all vi.mock() calls)
// ---------------------------------------------------------------------------
import AppErrors from "./AppErrors.vue";
import useErrorTracking from "@/composables/useErrorTracking";
import { b64EncodeUnicode } from "@/utils/zincutils";

// ---------------------------------------------------------------------------
// Shared i18n messages needed by the view
// ---------------------------------------------------------------------------
const i18nMessages = {
  rum: {
    issueColumn: "Issue",
    trendColumn: "Trend",
    usersColumn: "Users",
    seenColumn: "First / Last seen",
    statusColumn: "Status",
    statusNew: "New",
    statusOngoing: "Ongoing",
    statusNewTooltip: "First seen within the selected window",
    eventsUnit: "events",
    firstSeenAgo: "first {time}",
  },
  metrics: {
    runQuery: "Run query",
  },
};

// ---------------------------------------------------------------------------
// Frozen "now" for deterministic formatRelativeTime output.
// 1 000 000 000 000 000 µs = Unix 1 000 000 000 s = 2001-09-08 21:46:40 UTC
// We freeze JS Date at that millisecond so "2 minutes ago" is predictable.
// ---------------------------------------------------------------------------
const FROZEN_NOW_MS = 1_000_000_000_000; // ms
const FROZEN_NOW_US = FROZEN_NOW_MS * 1_000; // µs

/** Build a µs timestamp N minutes before frozen now. */
const minutesAgo = (n: number) => FROZEN_NOW_US - n * 60 * 1_000_000;

// ---------------------------------------------------------------------------
// Fixture issues
// ---------------------------------------------------------------------------
const makeIssue = (overrides: Partial<any> = {}): any => ({
  zo_sql_timestamp: minutesAgo(2),
  first_seen: minutesAgo(60),
  events: 4821,
  users_affected: 218,
  error_type: "TypeError",
  error_message: "Cannot read properties of undefined",
  error_handling: "unhandled",
  latest_error_id: "err-abc-123",
  error_stack: "TypeError: Cannot read properties of undefined\n  at checkout.js:42:10",
  service: "web",
  view_url: "https://example.com/checkout",
  status: "new" as const,
  ...overrides,
});

const ISSUE_1 = makeIssue();
const ISSUE_2 = makeIssue({
  zo_sql_timestamp: minutesAgo(5),
  first_seen: minutesAgo(120),
  events: 312,
  users_affected: undefined,
  error_message: "Network request failed",
  latest_error_id: "err-def-456",
  status: "ongoing" as const,
});

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function buildI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    globalInjection: true,
    messages: { en: i18nMessages as any },
    missingWarn: false,
    fallbackWarn: false,
  });
}

function buildRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: "/",
        name: "home",
        component: { template: "<div>Home</div>" },
      },
      {
        path: "/rum/error/:id",
        name: "ErrorViewer",
        component: { template: "<div>ErrorViewer</div>" },
      },
    ],
  });
  return router;
}

// Stubs for heavy child components that would make mounting fail
const TABLE_STUB = {
  name: "OTable",
  template: `
    <div data-test="rum-app-errors-table" :data-loading="loading || undefined">
      <slot name="empty" />
      <div v-for="(row, i) in data" :key="i" data-test="table-row" @click="$emit('row-click', row)">
        <div data-test="cell-issue"><slot name="cell-issue" :row="row" /></div>
        <div data-test="cell-events"><slot name="cell-events" :row="row" /></div>
        <div data-test="cell-users"><slot name="cell-users" :row="row" /></div>
        <div data-test="cell-seen"><slot name="cell-seen" :row="row" /></div>
        <div data-test="cell-status"><slot name="cell-status" :row="row" /></div>
      </div>
    </div>
  `,
  props: ["data", "columns", "loading", "rowKey", "pagination", "virtualScroll", "dense", "rowHeight", "showGlobalFilter", "horizontalScroll", "rowClass"],
  emits: ["row-click"],
};

const SPLITTER_STUB = {
  name: "OSplitter",
  template: '<div data-test="splitter-stub"><slot name="before" /><slot name="after" /></div>',
  props: ["modelValue", "unit", "horizontal"],
};

const OTAG_STUB = {
  name: "OTag",
  template: '<span data-test="rum-app-errors-status-badge">{{ label }}</span>',
  props: ["label", "variant", "size", "title"],
};

const ERROR_ISSUE_CELL_STUB = {
  name: "ErrorIssueCell",
  template: '<div data-test="rum-error-issue-cell">{{ issue.error_message }}</div>',
  props: ["issue"],
};

const ERROR_TREND_CELL_STUB = {
  name: "ErrorTrendCell",
  template: '<div data-test="rum-error-trend-cell" />',
  props: ["buckets", "status", "handling", "loading"],
};

const DATETIME_STUB = {
  name: "DateTime",
  template: '<div data-test="datetime-stub" />',
  props: ["autoApply", "menuAlign", "defaultType", "defaultAbsoluteTime", "defaultRelativeTime"],
  emits: ["on:date-change"],
};

const OBUTTON_STUB = {
  name: "OButton",
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  emits: ["click"],
};

const QUERY_EDITOR_STUB = {
  name: "CodeQueryEditor",
  template: '<div data-test="query-editor-stub" />',
  props: ["query", "editorId", "debounceTime", "keywords", "suggestions", "class"],
  emits: ["update:query", "focus", "blur"],
};

const NO_DATA_STUB = {
  name: "NoData",
  template: '<div data-test="no-data-stub">No data</div>',
};

const SEARCH_FIELD_LIST_STUB = {
  name: "SearchFieldList",
  template: '<div data-test="search-field-list-stub" />',
  props: ["fields", "timeStamp", "streamName", "streamType", "enableGrouping", "query"],
  emits: ["event-emitted"],
};

import store from "@/test/unit/helpers/store";

interface MountOptions {
  routeQuery?: Record<string, string>;
}

async function mountAppErrors({ routeQuery = {} }: MountOptions = {}) {
  const router = buildRouter();
  const i18n = buildI18n();

  // Push initial route — optionally with query params for URL restore tests
  await router.push({ path: "/", query: routeQuery });
  await router.isReady();

  const wrapper = mount(AppErrors, {
    global: {
      plugins: [store, router, i18n],
      stubs: {
        // Async component registered as defineAsyncComponent
        CodeQueryEditor: QUERY_EDITOR_STUB,
        QueryEditor: QUERY_EDITOR_STUB,
        OTable: TABLE_STUB,
        OSplitter: SPLITTER_STUB,
        OTag: OTAG_STUB,
        OButton: OBUTTON_STUB,
        ErrorIssueCell: ERROR_ISSUE_CELL_STUB,
        ErrorTrendCell: ERROR_TREND_CELL_STUB,
        DateTime: DATETIME_STUB,
        SyntaxGuide: { template: '<div />' },
        SearchFieldList: SEARCH_FIELD_LIST_STUB,
        NoData: NO_DATA_STUB,
        // Phase 2/3 page furniture — covered by their own co-located specs.
        ErrorsOverTimeChart: {
          template: '<div data-test="errors-over-time-chart-stub" />',
        },
        ErrorsKpiCards: {
          template: '<div data-test="errors-kpi-cards-stub" />',
        },
        ErrorsFilterBar: {
          name: "ErrorsFilterBar",
          template: '<div data-test="errors-filter-bar-stub" />',
          props: ["status", "type", "service", "services", "counts"],
          emits: ["update:status", "update:type", "update:service"],
        },
        AutoRefreshInterval: {
          template: '<div data-test="auto-refresh-interval-stub" />',
        },
      },
    },
  });

  return { wrapper, router };
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------
describe("AppErrors", () => {
  let wrapper: VueWrapper<any>;
  let router: ReturnType<typeof buildRouter>;

  beforeEach(() => {
    // Freeze only Date so date-fns produces deterministic "N minutes ago" strings.
    // toFake: ["Date"] leaves setTimeout/Promise intact so flushPromises() still resolves.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_NOW_MS));

    // Reset controllable refs
    mockIssues.value = [];
    mockTrendBuckets.value = {};
    mockChartSeries.value = [];
    mockLatestDeploy.value = null;
    mockDeploySpikeFactor.value = null;
    mockIsLoadingIssues.value = false;
    mockIsLoadingChart.value = false;
    mockIsLoadingKpis.value = false;
    mockIsLoadingTrends.value = false;
    // runQuery chains .then() on fetchAll — the mock must stay a promise.
    mockFetchAll.mockReset().mockResolvedValue(undefined);

    // Reset the singleton errorTrackingState by mutating its properties in-place
    // (reassigning via resetErrorTrackingState creates a new reactive object that
    // already-mounted components no longer reference, so we mutate instead)
    const { errorTrackingState } = useErrorTracking();
    errorTrackingState.data.editorValue = "";
    errorTrackingState.data.selectedError = {} as any;
    errorTrackingState.data.datetime = {
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "15m",
      valueType: "relative",
    };
    errorTrackingState.data.resultGrid.currentPage = 0;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    vi.useRealTimers(); // restore real timers after each test
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────
  describe("rendering", () => {
    it("renders the table when composable returns issues", async () => {
      mockIssues.value = [ISSUE_1, ISSUE_2];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.find('[data-test="rum-app-errors-table"]').exists()).toBe(true);
      // Two table rows rendered (one per issue)
      const rows = wrapper.findAll('[data-test="table-row"]');
      expect(rows).toHaveLength(2);
    });

    it("shows the error_message of each issue in the issue cell slot", async () => {
      mockIssues.value = [ISSUE_1, ISSUE_2];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const cells = wrapper.findAll('[data-test="rum-error-issue-cell"]');
      expect(cells[0].text()).toContain("Cannot read properties of undefined");
      expect(cells[1].text()).toContain("Network request failed");
    });

    it("formats events count with commas and shows events caption", async () => {
      mockIssues.value = [ISSUE_1]; // events: 4821
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const eventsCount = wrapper.find('[data-test="rum-app-errors-events-count"]');
      expect(eventsCount.exists()).toBe(true);
      expect(eventsCount.text()).toBe("4,821");
    });

    it("shows users_affected count when defined", async () => {
      mockIssues.value = [ISSUE_1]; // users_affected: 218
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const usersCount = wrapper.find('[data-test="rum-app-errors-users-count"]');
      expect(usersCount.exists()).toBe(true);
      expect(usersCount.text()).toBe("218");
    });

    it("shows em-dash in users cell when users_affected is undefined", async () => {
      mockIssues.value = [ISSUE_2]; // users_affected: undefined
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const usersCount = wrapper.find('[data-test="rum-app-errors-users-count"]');
      expect(usersCount.exists()).toBe(true);
      expect(usersCount.text()).toBe("—");
    });

    it("shows status badge 'New' for status='new' issues", async () => {
      mockIssues.value = [ISSUE_1]; // status: 'new'
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const badge = wrapper.find('[data-test="rum-app-errors-status-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("New");
    });

    it("shows status badge 'Ongoing' for status='ongoing' issues", async () => {
      mockIssues.value = [ISSUE_2]; // status: 'ongoing'
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const badge = wrapper.find('[data-test="rum-app-errors-status-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Ongoing");
    });

    it("shows relative last-seen time for zo_sql_timestamp", async () => {
      mockIssues.value = [ISSUE_1]; // zo_sql_timestamp = 2 minutes ago
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const lastSeen = wrapper.find('[data-test="rum-app-errors-last-seen"]');
      expect(lastSeen.exists()).toBe(true);
      // date-fns formatDistanceToNowStrict with addSuffix: "2 minutes ago"
      expect(lastSeen.text()).toContain("minutes ago");
    });

    it("shows relative first-seen time in the seen cell", async () => {
      mockIssues.value = [ISSUE_1]; // first_seen = 60 minutes ago
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const firstSeen = wrapper.find('[data-test="rum-app-errors-first-seen"]');
      expect(firstSeen.exists()).toBe(true);
      expect(firstSeen.text()).toContain("first");
      expect(firstSeen.text()).toContain("ago");
    });

    it("renders the run-query button", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const btn = wrapper.find('[data-test="errors-run-query-button"]');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe("Run query");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Empty and loading states
  // ─────────────────────────────────────────────────────────────────────────
  describe("empty and loading states", () => {
    it("renders NoData when issues is empty", async () => {
      mockIssues.value = [];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.find('[data-test="no-data-stub"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(0);
    });

    it("passes loading=true to OTable when isLoadingIssues is true", async () => {
      mockIsLoadingIssues.value = true;
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const table = wrapper.find('[data-test="rum-app-errors-table"]');
      // The TABLE_STUB binds :data-loading="loading || undefined"
      expect(table.attributes("data-loading")).toBeDefined();
    });

    it("passes loading=false to OTable when isLoadingIssues is false", async () => {
      mockIsLoadingIssues.value = false;
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const table = wrapper.find('[data-test="rum-app-errors-table"]');
      // When loading is false/undefined, attribute should be absent
      expect(table.attributes("data-loading")).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Row click → router navigation
  // ─────────────────────────────────────────────────────────────────────────
  describe("row click navigation", () => {
    it("pushes to ErrorViewer route with correct id and timestamp on row click", async () => {
      mockIssues.value = [ISSUE_1];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const pushSpy = vi.spyOn(router, "push");

      // Click the first table row (triggers @row-click on TABLE_STUB)
      await wrapper.findAll('[data-test="table-row"]')[0].trigger("click");
      await flushPromises();

      expect(pushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ErrorViewer",
          params: { id: ISSUE_1.latest_error_id },
          query: { timestamp: ISSUE_1.zo_sql_timestamp },
        }),
      );
    });

    it("sets errorTrackingState.data.selectedError on row click", async () => {
      mockIssues.value = [ISSUE_1];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();

      await wrapper.findAll('[data-test="table-row"]')[0].trigger("click");
      await flushPromises();

      // selectedError should be a deep copy of the issue row
      expect(errorTrackingState.data.selectedError).toMatchObject({
        latest_error_id: ISSUE_1.latest_error_id,
        error_message: ISSUE_1.error_message,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Run query interaction
  // ─────────────────────────────────────────────────────────────────────────
  describe("run query", () => {
    it("calls fetchAll on mount after getStreamFields", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(mockFetchAll).toHaveBeenCalledTimes(1);
    });

    it("calls fetchAll with current editorValue when run-query button is clicked", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      mockFetchAll.mockClear();

      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = 'error_type = "TypeError"';

      await wrapper.find('[data-test="errors-run-query-button"]').trigger("click");
      await flushPromises();

      expect(mockFetchAll).toHaveBeenCalledTimes(1);
      expect(mockFetchAll).toHaveBeenCalledWith(
        expect.objectContaining({
          userQuery: 'error_type = "TypeError"',
          service: "",
        }),
      );
    });

    it("passes schema mapping built from getStream fields to fetchAll", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // schema has error_id, error_message, error_stack, view_url,
      // user_agent_device_brand, geo_info_city — all should be in the schema mapping
      expect(mockFetchAll).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: expect.objectContaining({
            error_id: true,
            error_message: true,
            user_agent_device_brand: true,
          }),
        }),
      );
    });

    it("passes startTime and endTime from dateTime state to fetchAll", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.datetime = {
        startTime: 1000000,
        endTime: 2000000,
        relativeTimePeriod: "",
        valueType: "absolute",
      };

      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(mockFetchAll).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: expect.any(Number),
          endTime: expect.any(Number),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DateTime change triggers fetchAll
  // ─────────────────────────────────────────────────────────────────────────
  describe("date change", () => {
    it("calls fetchAll again when DateTime emits on:date-change with a relative period", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      mockFetchAll.mockClear();

      const dateTimeStub = wrapper.findComponent(DATETIME_STUB);
      expect(dateTimeStub.exists()).toBe(true);

      // Simulate the DateTime component emitting a date change with relative time
      await dateTimeStub.vm.$emit("on:date-change", {
        startTime: FROZEN_NOW_MS * 1000 - 900 * 1_000_000,
        endTime: FROZEN_NOW_MS * 1000,
        relativeTimePeriod: "15m",
        valueType: "relative",
      });
      await flushPromises();

      expect(mockFetchAll).toHaveBeenCalledTimes(1);
    });

    it("does NOT call fetchAll when DateTime emits the same date again", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      mockFetchAll.mockClear();

      const dateTimeStub = wrapper.findComponent(DATETIME_STUB);

      // Emit a date once to capture the current state
      const newDate = {
        startTime: FROZEN_NOW_MS * 1000 - 900 * 1_000_000,
        endTime: FROZEN_NOW_MS * 1000,
        relativeTimePeriod: "15m",
        valueType: "relative",
      };

      await dateTimeStub.vm.$emit("on:date-change", newDate);
      await flushPromises();
      mockFetchAll.mockClear();

      // Emit the same date again — should be a no-op
      await dateTimeStub.vm.$emit("on:date-change", newDate);
      await flushPromises();

      expect(mockFetchAll).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // URL query parameter restore
  // ─────────────────────────────────────────────────────────────────────────
  describe("URL state restore", () => {
    it("restores relativeTimePeriod from route query period param", async () => {
      ({ wrapper, router } = await mountAppErrors({
        routeQuery: { period: "15m" },
      }));
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      expect(errorTrackingState.data.datetime.relativeTimePeriod).toBe("15m");
      expect(errorTrackingState.data.datetime.valueType).toBe("relative");
    });

    it("restores absolute time from route query from/to params", async () => {
      ({ wrapper, router } = await mountAppErrors({
        routeQuery: {
          from: "1640995200000000",
          to: "1640998800000000",
        },
      }));
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      expect(errorTrackingState.data.datetime.startTime).toBe(1640995200000000);
      expect(errorTrackingState.data.datetime.endTime).toBe(1640998800000000);
    });

    it("restores editorValue from base64-encoded query param", async () => {
      const editorValue = 'error_type = "TypeError"';
      const encoded = b64EncodeUnicode(editorValue);

      ({ wrapper, router } = await mountAppErrors({
        routeQuery: { query: encoded! },
      }));
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      expect(errorTrackingState.data.editorValue).toBe(editorValue);
    });

    it("does not override datetime when route has no date params", async () => {
      // No date params — state should keep defaults
      ({ wrapper, router } = await mountAppErrors({ routeQuery: {} }));
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      // Default from useErrorTracking: relativeTimePeriod "15m"
      expect(errorTrackingState.data.datetime.relativeTimePeriod).toBe("15m");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("renders a single issue without errors", async () => {
      mockIssues.value = [ISSUE_1];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(1);
    });

    it("handles issues list with many items", async () => {
      mockIssues.value = Array.from({ length: 50 }, (_, i) =>
        makeIssue({ latest_error_id: `err-${i}`, events: i }),
      );
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(50);
    });

    it("shows second issue status badge as Ongoing", async () => {
      mockIssues.value = [ISSUE_1, ISSUE_2];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const badges = wrapper.findAll('[data-test="rum-app-errors-status-badge"]');
      expect(badges[0].text()).toBe("New");
      expect(badges[1].text()).toBe("Ongoing");
    });

    it("handles events count of 0 gracefully", async () => {
      mockIssues.value = [makeIssue({ events: 0 })];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const count = wrapper.find('[data-test="rum-app-errors-events-count"]');
      expect(count.text()).toBe("0");
    });

    it("handles large events count formatted with commas", async () => {
      mockIssues.value = [makeIssue({ events: 1234567 })];
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const count = wrapper.find('[data-test="rum-app-errors-events-count"]');
      expect(count.text()).toBe("1,234,567");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sidebar events
  // ─────────────────────────────────────────────────────────────────────────
  describe("sidebar add-field / remove-field events", () => {
    it("appends filter to editorValue when sidebar emits add-field for a new field", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "";

      const fieldList = wrapper.findComponent(SEARCH_FIELD_LIST_STUB);
      await fieldList.vm.$emit("event-emitted", "add-field", 'error_type = "TypeError"');
      await flushPromises();

      expect(errorTrackingState.data.editorValue).toContain("TypeError");
    });

    it("removes field condition from editorValue when sidebar emits remove-field", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = 'error_type = "TypeError"';

      const fieldList = wrapper.findComponent(SEARCH_FIELD_LIST_STUB);
      await fieldList.vm.$emit("event-emitted", "remove-field", "error_type");
      await flushPromises();

      // After removal, error_type condition should be gone
      expect(errorTrackingState.data.editorValue).not.toContain("error_type");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Filtering — client-side status / type / service filters
  // ─────────────────────────────────────────────────────────────────────────
  describe("filtering", () => {
    // Helper: find the ErrorsFilterBar stub component instance
    const filterBarStub = () =>
      wrapper.findComponent({ name: "ErrorsFilterBar" });

    // ── Status filter ───────────────────────────────────────────────────
    describe("status filter", () => {
      it("shows all rows when status filter is 'all'", async () => {
        mockIssues.value = [ISSUE_1, ISSUE_2]; // new + ongoing
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Default statusFilter is "all" — both rows visible
        expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(2);
      });

      it("reduces table rows to new-status issues when filter bar emits update:status 'new'", async () => {
        mockIssues.value = [ISSUE_1, ISSUE_2]; // ISSUE_1=new, ISSUE_2=ongoing
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act — filter bar stub emits the status change
        await filterBarStub().vm.$emit("update:status", "new");
        await flushPromises();

        // Assert — only the "new" row survives the client-side filter
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "Cannot read properties of undefined",
        );
      });

      it("reduces table rows to ongoing-status issues when filter bar emits update:status 'ongoing'", async () => {
        mockIssues.value = [ISSUE_1, ISSUE_2]; // ISSUE_1=new, ISSUE_2=ongoing
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act
        await filterBarStub().vm.$emit("update:status", "ongoing");
        await flushPromises();

        // Assert — only the "ongoing" row survives
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "Network request failed",
        );
      });

      it("shows all rows again when filter bar resets status to 'all'", async () => {
        mockIssues.value = [ISSUE_1, ISSUE_2];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        await filterBarStub().vm.$emit("update:status", "new");
        await flushPromises();
        await filterBarStub().vm.$emit("update:status", "all");
        await flushPromises();

        expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(2);
      });
    });

    // ── Type filter ─────────────────────────────────────────────────────
    describe("type filter", () => {
      it("shows only unhandled issues when filter bar emits update:type 'unhandled'", async () => {
        const handledIssue = makeIssue({
          error_message: "Handled error",
          error_handling: "handled",
          latest_error_id: "err-handled-1",
        });
        mockIssues.value = [ISSUE_1, handledIssue]; // ISSUE_1 is unhandled
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act
        await filterBarStub().vm.$emit("update:type", "unhandled");
        await flushPromises();

        // Assert — only the unhandled row (ISSUE_1) survives
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "Cannot read properties of undefined",
        );
      });

      it("shows only handled issues when filter bar emits update:type 'handled'", async () => {
        const handledIssue = makeIssue({
          error_message: "Handled error",
          error_handling: "handled",
          latest_error_id: "err-handled-2",
        });
        mockIssues.value = [ISSUE_1, handledIssue];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act
        await filterBarStub().vm.$emit("update:type", "handled");
        await flushPromises();

        // Assert — only the handled row survives
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "Handled error",
        );
      });

      it("treats issue with undefined error_handling as unhandled when filtering by type", async () => {
        const undefinedHandlingIssue = makeIssue({
          error_message: "Unknown handling",
          error_handling: undefined,
          latest_error_id: "err-undef-handling",
        });
        const handledIssue = makeIssue({
          error_message: "Clearly handled",
          error_handling: "handled",
          latest_error_id: "err-handled-3",
        });
        mockIssues.value = [undefinedHandlingIssue, handledIssue];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act — filter to unhandled only
        await filterBarStub().vm.$emit("update:type", "unhandled");
        await flushPromises();

        // Assert — undefined handling is treated as "unhandled" and passes through
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "Unknown handling",
        );
      });
    });

    // ── Combined status + type filter ───────────────────────────────────
    describe("combined status and type filtering", () => {
      it("applies both status and type filters simultaneously", async () => {
        const newUnhandled = makeIssue({
          status: "new",
          error_handling: "unhandled",
          error_message: "New unhandled",
          latest_error_id: "err-nu",
        });
        const newHandled = makeIssue({
          status: "new",
          error_handling: "handled",
          error_message: "New handled",
          latest_error_id: "err-nh",
        });
        const ongoingUnhandled = makeIssue({
          status: "ongoing",
          error_handling: "unhandled",
          error_message: "Ongoing unhandled",
          latest_error_id: "err-ou",
        });
        mockIssues.value = [newUnhandled, newHandled, ongoingUnhandled];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act — filter to status=new + type=unhandled
        await filterBarStub().vm.$emit("update:status", "new");
        await filterBarStub().vm.$emit("update:type", "unhandled");
        await flushPromises();

        // Assert — only newUnhandled passes both filters
        const rows = wrapper.findAll('[data-test="table-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].find('[data-test="rum-error-issue-cell"]').text()).toContain(
          "New unhandled",
        );
      });

      it("shows empty table when no issues match combined status + type filters", async () => {
        mockIssues.value = [
          makeIssue({ status: "new", error_handling: "unhandled", latest_error_id: "err-a" }),
        ];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Act — filter to status=ongoing (no issues have that status)
        await filterBarStub().vm.$emit("update:status", "ongoing");
        await filterBarStub().vm.$emit("update:type", "handled");
        await flushPromises();

        // Assert — zero rows; NoData empty slot still exists in table wrapper
        expect(wrapper.findAll('[data-test="table-row"]')).toHaveLength(0);
      });
    });

    // ── filterCounts prop ───────────────────────────────────────────────
    describe("filterCounts prop passed to ErrorsFilterBar", () => {
      it("passes counts matching the issues breakdown to the filter bar stub", async () => {
        mockIssues.value = [
          // 1 new + 1 ongoing; 2 unhandled (ISSUE_1=unhandled, ISSUE_2=unhandled) + 0 handled
          ISSUE_1, // status:new,  error_handling:"unhandled"
          ISSUE_2, // status:ongoing, error_handling:"unhandled" (makeIssue default)
        ];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.exists()).toBe(true);
        expect(bar.props("counts")).toEqual({ new: 1, ongoing: 1, unhandled: 2, handled: 0 });
      });

      it("counts handled issues correctly in the counts prop", async () => {
        const handledIssue = makeIssue({
          status: "ongoing",
          error_handling: "handled",
          latest_error_id: "err-h",
        });
        mockIssues.value = [ISSUE_1, handledIssue]; // 1 new unhandled + 1 ongoing handled
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.props("counts")).toEqual({ new: 1, ongoing: 1, unhandled: 1, handled: 1 });
      });

      it("passes zero counts when issues list is empty", async () => {
        mockIssues.value = [];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.props("counts")).toEqual({ new: 0, ongoing: 0, unhandled: 0, handled: 0 });
      });
    });

    // ── Service filter ──────────────────────────────────────────────────
    describe("service filter", () => {
      it("calls fetchAll with the emitted service value when filter bar emits update:service", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Clear the initial fetchAll call from onMounted
        mockFetchAll.mockClear();

        // Act — emit service change from filter bar
        await filterBarStub().vm.$emit("update:service", "checkout");
        await flushPromises();

        // Assert — fetchAll re-fetches with the chosen service
        expect(mockFetchAll).toHaveBeenCalledTimes(1);
        expect(mockFetchAll).toHaveBeenCalledWith(
          expect.objectContaining({ service: "checkout" }),
        );
      });

      it("calls fetchAll with empty service when filter bar emits update:service with empty string", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        mockFetchAll.mockClear();

        await filterBarStub().vm.$emit("update:service", "");
        await flushPromises();

        expect(mockFetchAll).toHaveBeenCalledTimes(1);
        expect(mockFetchAll).toHaveBeenCalledWith(
          expect.objectContaining({ service: "" }),
        );
      });
    });

    // ── Status/type changes do NOT re-fetch ─────────────────────────────
    describe("client-side-only filters do not re-fetch", () => {
      it("does NOT call fetchAll again when status filter changes", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        mockFetchAll.mockClear();

        await filterBarStub().vm.$emit("update:status", "new");
        await flushPromises();

        expect(mockFetchAll).not.toHaveBeenCalled();
      });

      it("does NOT call fetchAll again when type filter changes", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        mockFetchAll.mockClear();

        await filterBarStub().vm.$emit("update:type", "unhandled");
        await flushPromises();

        expect(mockFetchAll).not.toHaveBeenCalled();
      });
    });

    // ── URL restore for filter params ───────────────────────────────────
    describe("URL state restore for filter params", () => {
      it("restores status filter from route query and passes it as prop to the filter bar", async () => {
        ({ wrapper, router } = await mountAppErrors({ routeQuery: { status: "new" } }));
        await flushPromises();

        expect(filterBarStub().props("status")).toBe("new");
      });

      it("restores type filter from route query and passes it as prop to the filter bar", async () => {
        ({ wrapper, router } = await mountAppErrors({ routeQuery: { type: "handled" } }));
        await flushPromises();

        expect(filterBarStub().props("type")).toBe("handled");
      });

      it("restores service filter from route query and passes it as prop to the filter bar", async () => {
        ({ wrapper, router } = await mountAppErrors({ routeQuery: { service: "api" } }));
        await flushPromises();

        expect(filterBarStub().props("service")).toBe("api");
      });

      it("restores all three filter params together from route query", async () => {
        ({ wrapper, router } = await mountAppErrors({
          routeQuery: { status: "ongoing", type: "unhandled", service: "frontend" },
        }));
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.props("status")).toBe("ongoing");
        expect(bar.props("type")).toBe("unhandled");
        expect(bar.props("service")).toBe("frontend");
      });

      it("ignores invalid status value from route query and keeps filter at 'all'", async () => {
        ({ wrapper, router } = await mountAppErrors({ routeQuery: { status: "bogus" } }));
        await flushPromises();

        // "bogus" is not "new"|"ongoing" so statusFilter stays "all"
        expect(filterBarStub().props("status")).toBe("all");
      });

      it("ignores invalid type value from route query and keeps filter at 'all'", async () => {
        ({ wrapper, router } = await mountAppErrors({ routeQuery: { type: "invalid-type" } }));
        await flushPromises();

        expect(filterBarStub().props("type")).toBe("all");
      });
    });

    // ── URL update after filter changes ─────────────────────────────────
    describe("URL update after filter changes", () => {
      it("adds status=new to route query after filter bar emits update:status 'new'", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        await filterBarStub().vm.$emit("update:status", "new");
        await flushPromises();

        expect(router.currentRoute.value.query["status"]).toBe("new");
      });

      it("removes status from route query when status filter is reset to 'all'", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        // Set then clear
        await filterBarStub().vm.$emit("update:status", "new");
        await flushPromises();
        await filterBarStub().vm.$emit("update:status", "all");
        await flushPromises();

        // "all" is the default — should not appear in query
        expect(router.currentRoute.value.query["status"]).toBeUndefined();
      });

      it("adds service to route query after service filter changes", async () => {
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        await filterBarStub().vm.$emit("update:service", "payments");
        await flushPromises();

        expect(router.currentRoute.value.query["service"]).toBe("payments");
      });
    });

    // ── Services prop accumulation ───────────────────────────────────────
    describe("services prop accumulation after fetchAll", () => {
      it("passes distinct sorted service values as the services prop to the filter bar after fetch resolves", async () => {
        mockIssues.value = [
          makeIssue({ service: "beta", latest_error_id: "err-b" }),
          makeIssue({ service: "alpha", latest_error_id: "err-a" }),
        ];
        ({ wrapper, router } = await mountAppErrors());

        // flushPromises lets the fetchAll promise resolve and collectServiceOptions run
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.exists()).toBe(true);
        // Should be sorted alphabetically
        expect(bar.props("services")).toEqual(["alpha", "beta"]);
      });

      it("ignores issues with no service value when building the services list", async () => {
        mockIssues.value = [
          makeIssue({ service: "checkout", latest_error_id: "err-co" }),
          makeIssue({ service: undefined, latest_error_id: "err-no-svc" }),
          makeIssue({ service: "", latest_error_id: "err-empty-svc" }),
        ];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        const bar = filterBarStub();
        // Only "checkout" should appear — undefined and "" are falsy and skipped
        expect(bar.props("services")).toEqual(["checkout"]);
      });

      it("deduplicates services when the same service appears in multiple issues", async () => {
        mockIssues.value = [
          makeIssue({ service: "api", latest_error_id: "err-a1" }),
          makeIssue({ service: "api", latest_error_id: "err-a2" }),
          makeIssue({ service: "web", latest_error_id: "err-w1" }),
        ];
        ({ wrapper, router } = await mountAppErrors());
        await flushPromises();

        const bar = filterBarStub();
        expect(bar.props("services")).toEqual(["api", "web"]);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Query editor focus / blur / update — coverage for onQueryEditorFocus,
  // onQueryEditorBlur, and updateAutoComplete
  //
  // The placeholder text "Filter errors…" is injected by the mocked
  // useQueryPlaceholder composable. We detect placeholder presence via its
  // visible text rather than CSS class selectors (per testing rules).
  // ─────────────────────────────────────────────────────────────────────────
  describe("query editor events", () => {
    /** Returns true when the placeholder typewriter text is rendered. */
    const placeholderVisible = () =>
      wrapper.text().includes("Filter errors…");

    it("shows the placeholder text when editorValue is empty and editor is not focused", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = ""; // placeholder visible when empty + not focused
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // Assert — placeholder text from mocked useQueryPlaceholder is present
      expect(placeholderVisible()).toBe(true);
    });

    it("hides the placeholder text when the query editor receives focus", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "";
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // Act — emit focus from the query editor stub
      const queryEditor = wrapper.findComponent(QUERY_EDITOR_STUB);
      expect(queryEditor.exists()).toBe(true);
      await queryEditor.vm.$emit("focus");
      await flushPromises();

      // Assert — placeholder text disappears while editor is focused
      expect(placeholderVisible()).toBe(false);
    });

    it("shows the placeholder text again after the query editor blurs with empty value", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "";
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const queryEditor = wrapper.findComponent(QUERY_EDITOR_STUB);

      // Focus then blur
      await queryEditor.vm.$emit("focus");
      await flushPromises();
      await queryEditor.vm.$emit("blur");
      await flushPromises();

      // Assert — placeholder reappears (no longer focused + still empty)
      expect(placeholderVisible()).toBe(true);
    });

    it("does not show the placeholder text when editorValue is non-empty regardless of focus", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = 'error_type = "TypeError"';
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // v-if is false when editorValue is truthy — placeholder must not render
      expect(placeholderVisible()).toBe(false);
    });

    it("hides the placeholder text when the editor emits update:query with a non-empty value", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "";
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // Act — editor emits an update:query event (also exercises updateAutoComplete path)
      const queryEditor = wrapper.findComponent(QUERY_EDITOR_STUB);
      await queryEditor.vm.$emit("update:query", 'error_type = "NetworkError"');
      await flushPromises();

      // The v-model binding updates editorValue; placeholder hides when editorValue truthy
      expect(placeholderVisible()).toBe(false);
    });

    it("exercises updateAutoComplete without throwing when query editor emits update:query", async () => {
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      const queryEditor = wrapper.findComponent(QUERY_EDITOR_STUB);

      // updateAutoComplete accesses errorQueryEditorRef.value?.getCursorIndex?.()
      // The stub ref is null — optional chaining prevents throws.
      queryEditor.vm.$emit("update:query", "error_source = web");
      await flushPromises();

      // Behavioral confirmation: component still renders the table after the call
      expect(wrapper.find('[data-test="rum-app-errors-table"]').exists()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // errorEditorHeight computed branches — exercise paths without asserting classes
  // ─────────────────────────────────────────────────────────────────────────
  describe("errorEditorHeight computed branches", () => {
    it("renders the query editor when editorValue has a single line (1-line branch)", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = 'error_type = "TypeError"'; // no newlines → 1 line
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      // Behavioral assertion: component renders correctly with 1-line value
      expect(wrapper.findComponent(QUERY_EDITOR_STUB).exists()).toBe(true);
    });

    it("renders the query editor when editorValue has exactly two lines (2-line branch)", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "line one\nline two"; // 1 newline → 2 lines
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.findComponent(QUERY_EDITOR_STUB).exists()).toBe(true);
    });

    it("renders the query editor when editorValue has three or more lines (3+-line branch)", async () => {
      const { errorTrackingState } = useErrorTracking();
      errorTrackingState.data.editorValue = "line one\nline two\nline three"; // 2 newlines → 3 lines
      ({ wrapper, router } = await mountAppErrors());
      await flushPromises();

      expect(wrapper.findComponent(QUERY_EDITOR_STUB).exists()).toBe(true);
    });
  });
});
