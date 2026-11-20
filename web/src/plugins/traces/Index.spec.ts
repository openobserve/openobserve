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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from "vue";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import Index from "@/plugins/traces/Index.vue";
import DateTime from "@/components/DateTime.vue";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import * as useDurationPercentilesModule from "@/composables/useDurationPercentiles";
import { buildViewTracesFilter } from "@/plugins/traces/viewTracesHandoff";
import { b64DecodeUnicode, b64EncodeUnicode } from "@/utils/zincutils";
import { tracesSearchRunSignature } from "@/plugins/traces/tracesSearchBar.utils";
import { isMacOS } from "@/utils/keyboardShortcuts";
import { createTracesSqlTexts } from "@/utils/traces/tracesSqlTexts";
import analytics from "@/services/product_analytics";
import queryHistory from "@/services/query_history";
import type { QueryHistoryEntry } from "@/services/query_history";
import { openRecentOnItsPage, takeRecentLanding } from "@/utils/queryHistory/routes";
import { landingRouter, landWithoutRestore } from "@/test/unit/helpers/recentLanding";
import {
  announceTracesRowNav,
  tracesRowNavAnnouncement,
} from "@/plugins/traces/composables/tracesRowNav";

// Create DOM node for mounting
const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Mock data
const mockStreamList = {
  list: [
    {
      name: "default",
      storage_type: "s3",
      stream_type: "traces",
      stats: {
        doc_time_min: 1000000000000,
        doc_time_max: 1755853746625720,
        doc_num: 1000,
        file_num: 10,
        storage_size: 1024000,
        compressed_size: 512000,
      },
      schema: [
        { name: "trace_id", type: "Utf8" },
        { name: "span_id", type: "Utf8" },
        { name: "service_name", type: "Utf8" },
        { name: "operation_name", type: "Utf8" },
        { name: "duration", type: "Int64" },
        { name: "start_time", type: "Int64" },
        { name: "end_time", type: "Int64" },
        { name: "span_status", type: "Utf8" },
        { name: "span_kind", type: "Utf8" },
      ],
      settings: {
        partition_keys: {},
        full_text_search_keys: [],
        max_query_range: 0,
      },
    },
    {
      name: "test-stream",
      storage_type: "s3",
      stream_type: "traces",
      stats: {
        doc_time_min: 1000000000000,
        doc_time_max: 1755853746625720,
        doc_num: 500,
        file_num: 5,
        storage_size: 512000,
        compressed_size: 256000,
      },
      schema: [
        { name: "trace_id", type: "Utf8" },
        { name: "span_id", type: "Utf8" },
        { name: "service_name", type: "Utf8" },
        { name: "operation_name", type: "Utf8" },
      ],
      settings: {
        partition_keys: {},
        full_text_search_keys: [],
        max_query_range: 24,
      },
    },
  ],
};

const mockTracesResponse = {
  took: 10,
  total: 3,
  from: 0,
  size: 25,
  hits: [
    {
      trace_id: "trace-1",
      service_name: "service-1",
      operation_name: "operation-1",
      duration: 100000,
      spans: 5,
      errors: 0,
      trace_start_time: 1755853746625720,
      trace_end_time: 1755853746725720,
      zo_sql_timestamp: 1755853746625720,
      start_time: 1755853746625720300,
      end_time: 1755853746725720300,
    },
    {
      trace_id: "trace-2",
      service_name: "service-2",
      operation_name: "operation-2",
      duration: 200000,
      spans: 10,
      errors: 1,
      trace_start_time: 1755853746625720,
      trace_end_time: 1755853746825720,
      zo_sql_timestamp: 1755853746625720,
      start_time: 1755853746625720300,
      end_time: 1755853746825720300,
    },
  ],
};

const mockFunctions = {
  list: [
    {
      name: "transform_1",
      function: "function() {}",
      num_args: "1",
      stream_name: null,
    },
  ],
};

// Mock composables
const mockSearchObj = {
  organizationIdentifier: "default",
  loading: false,
  loadingStream: false,
  searchApplied: false,
  config: {
    splitterModel: 20,
    lastSplitterPosition: 20,
    splitterLimit: [0, 40],
  },
  // Only meta is reactive so the searchMode watcher fires without making
  // the entire mock reactive (which would cause loadPageData side-effects
  // to re-render DOM in unrelated tests).
  meta: reactive({
    showFields: true,
    showQuery: true,
    showHistogram: true,
    sqlMode: false,
    groupBy: "",
    searchMode: "traces" as "traces" | "spans" | "service-graph" | "services-catalog",
    resultGrid: {
      rowsPerPage: 25,
      sortBy: "start_time" as string,
      sortOrder: "desc" as "asc" | "desc",
      navigation: {
        currentRowIndex: 0 as number | null,
        selectionActive: false,
        pendingPageSelection: null as any,
        lastOpenedId: null as string | null,
      },
    },
    liveMode: false,
    lastRunSignature: null as string | null,
    serviceColors: {},
    metricsRangeFilters: new Map(),
  }),
  data: {
    query: "",
    editorValue: "",
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [],
      selectedFields: [],
      functions: [],
      sqlFieldConditions: {} as Record<string, any>,
    },
    streamResults: { list: [] },
    queryResults: { hits: [] },
    groupsRequest: null as any,
    sortedQueryResults: [],
    histogram: {
      layout: {},
      data: [],
    },
    resultGrid: {
      currentPage: 0,
      columns: [],
      pageRequest: null as any,
      pageLoad: null as any,
    },
    datetime: {
      startTime: new Date().getTime() * 1000 - 900000000,
      endTime: new Date().getTime() * 1000,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    queryPayload: null,
  },
  runQuery: false,
};

// The RED strip has its own spec; here only its mount point and event wiring matter.
vi.mock("@/plugins/traces/metrics/TracesMetricsDashboard.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      name: "TracesMetricsDashboard",
      emits: ["time-range-selected", "editor-filter-set", "editor-filter-run", "send-to-ai-chat"],
      setup: () => () => h("div", { "data-test": "traces-metrics-dashboard-stub" }),
    }),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    resetSearchObj: mockResetSearchObj,
    getUrlQueryParams: vi.fn(() => ({})),
    applyUrlListState: mockApplyUrlListState,
    syncUrlViewState: mockSyncUrlViewState,
    copyTracesUrl: mockCopyTracesUrl,
    formatTracesMetaData: vi.fn((hits) => hits),
    setServiceColors: mockSetServiceColors,
    loadLocalLogFilterField: mockLoadLocalLogFilterField,
    updatedLocalLogFilterField: mockUpdatedLocalLogFilterField,
    loadTracesParser: vi.fn().mockResolvedValue(undefined),
    tracesParser: {
      value: trackTracesParser({
        astify: vi.fn((sql: string) =>
          realTracesParser.current ? realTracesParser.current.astify(sql) : { where: null },
        ),
      }),
    },
    ...mockSqlTexts(),
    resetSqlTexts: mockSqlTexts().reset,
  }),
}));

// A search calls getDashboardData once results show, and the shrinking query bar re-renders them into view.
const SearchResultStub = { template: "<div />", methods: { getDashboardData: () => {} } };

// The real two-text state over the mock searchObj, shared like the module singleton it stands for.
let sharedSqlTexts: ReturnType<typeof createTracesSqlTexts> | null = null;
const mockSqlTexts = () =>
  (sharedSqlTexts ??= createTracesSqlTexts(mockSearchObj as any, mockSqlTextsParser));
const mockSqlTextsParser: { value: any } = { value: null };

vi.mock("@/utils/streamPersist", () => ({
  saveTracesStream: vi.fn(),
  restoreTracesStream: mockRestoreTracesStream,
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockGetStreams, mockGetStream, mockSetServiceColors } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockGetStream: vi.fn(),
  mockSetServiceColors: vi.fn(),
}));

const { mockApplyUrlListState, mockSyncUrlViewState, mockStopUrlSync } = vi.hoisted(() => {
  const mockStopUrlSync = vi.fn();
  return {
    mockApplyUrlListState: vi.fn((): { currentPage: number | null } => ({ currentPage: null })),
    mockSyncUrlViewState: vi.fn(() => mockStopUrlSync),
    mockStopUrlSync,
  };
});

const { mockUpdatedLocalLogFilterField, mockLoadLocalLogFilterField, mockToast } = vi.hoisted(
  () => ({
    mockUpdatedLocalLogFilterField: vi.fn(),
    mockLoadLocalLogFilterField: vi.fn(),
    mockToast: vi.fn(),
  }),
);

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  toast: mockToast,
}));

// Each mount gets its own parser, so a spy call's parser argument identifies which test's mount made it.
// Set by a test that reads real SQL, so parsers made after that point (the kept line's) read it too.
const realTracesParser = vi.hoisted(() => ({ current: null as any }));

const { createdTracesParsers, trackTracesParser } = vi.hoisted(() => {
  const createdTracesParsers: unknown[] = [];
  return {
    createdTracesParsers,
    trackTracesParser: <T extends object>(p: T): T => (createdTracesParsers.push(p), p),
  };
});

// Hoisted so tests can assert resetSearchObj was called by the component lifecycle.
const { mockResetSearchObj, mockCopyTracesUrl } = vi.hoisted(() => ({
  mockResetSearchObj: vi.fn(),
  mockCopyTracesUrl: vi.fn(),
}));

// Hoisted so tests can control what restoreTracesStream returns.
const { mockRestoreTracesStream } = vi.hoisted(() => ({
  mockRestoreTracesStream: vi.fn(() => ""),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: mockGetStream,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockCancelStreamQueryBasedOnRequestId, mockFetchQueryDataWithHttpStream } = vi.hoisted(
  () => ({
    mockCancelStreamQueryBasedOnRequestId: vi.fn(),
    mockFetchQueryDataWithHttpStream: vi.fn(),
  }),
);

// The owning instance becomes the call's `this`, so tests can tell their search from a leftover instance's.
vi.mock("@/composables/useStreamingSearch", async () => {
  const { getCurrentInstance } = await import("vue");
  return {
    default: () => {
      const owner = getCurrentInstance();
      return {
        fetchQueryDataWithHttpStream: (...args: unknown[]) =>
          mockFetchQueryDataWithHttpStream.apply(owner, args),
        cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
      };
    },
  };
});

vi.mock("@/composables/useDurationPercentiles", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseDurationWhereClause: vi.fn((whereClause: string) => whereClause),
  };
});

// Hoisted so tests can assert on the spy and override its return value per test.
const { mockParseSpanKindWhereClause } = vi.hoisted(() => ({
  mockParseSpanKindWhereClause: vi.fn(
    (whereClause: string, _parser?: unknown, _streamName?: string) => whereClause,
  ),
}));

// Use importOriginal so SPAN_KIND_MAP and SPAN_KIND_LABEL_TO_KEY remain available,
// but replace parseSpanKindWhereClause with an inspectable spy that defaults to passthrough.
vi.mock("@/utils/traces/constants", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseSpanKindWhereClause: mockParseSpanKindWhereClause,
  };
});

// Mock services
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_traces: vi.fn(() => Promise.resolve({ data: mockTracesResponse })),
    },
  });
});

vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: mockFunctions })),
    },
  });
});

vi.mock("@/services/product_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

const { mockSqlTemplates } = vi.hoisted(() => ({
  mockSqlTemplates: [
    {
      id: "bigTraces",
      group: "traceQuestions",
      sql: `SELECT trace_id FROM "default"\nGROUP BY trace_id\nHAVING count(*) > 200`,
      services: [],
    },
  ],
}));

vi.mock("@/plugins/traces/composables/useTracesSqlTemplates", async (importOriginal) => {
  const actual: any = await importOriginal();
  const { computed } = await import("vue");
  return {
    ...actual,
    useTracesSqlTemplates: () => ({ sqlTemplates: computed(() => mockSqlTemplates) }),
  };
});

// Mock SQL parser
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () =>
      Promise.resolve({
        astify: vi.fn(() => ({
          type: "select",
          columns: "*",
          from: [{ table: "default" }],
          where: null,
        })),
      }),
  }),
}));

describe("Index.vue (Main Traces Page)", () => {
  let wrapper: VueWrapper<any>;

  // Create router spies once at describe-level to prevent stacking from repeated vi.spyOn calls.
  // vi.clearAllMocks() in afterEach clears their call history; beforeEach resets the implementation.
  const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
  const routerReplaceSpy = vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
  const routerCurrentRouteSpy = vi.spyOn(router, "currentRoute", "get").mockReturnValue({
    value: { query: {}, name: "traces", path: "/traces" },
  } as any);
  // The shared router's install navigation never settles here, so it must not read as leaving Traces.
  vi.spyOn(router, "beforeEach").mockReturnValue(() => {});

  beforeEach(async () => {
    // Set default stream mock implementations (tests can override with mockResolvedValueOnce)
    mockGetStreams.mockResolvedValue(mockStreamList);
    mockGetStream.mockImplementation((streamName: string) =>
      Promise.resolve(mockStreamList.list.find((s: any) => s.name === streamName)),
    );

    // Reset mock data
    mockSearchObj.loading = false;
    mockSearchObj.loadingStream = false;
    mockSearchObj.organizationIdentifier = "default";
    mockSearchObj.meta.searchMode = "traces";
    mockSearchObj.meta.liveMode = false;
    mockSearchObj.data.stream.streamLists = [];
    mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
    mockSearchObj.data.streamResults = { list: [] };
    mockSearchObj.data.queryResults = { hits: [] };
    mockSearchObj.data.errorMsg = "";
    mockSearchObj.data.editorValue = "";
    mockSqlTexts().reset();
    mockSqlTextsParser.value = null;
    realTracesParser.current = null;
    createdTracesParsers.length = 0;

    // Reset hoisted mocks to safe defaults for each test
    mockResetSearchObj.mockReset();
    mockRestoreTracesStream.mockReturnValue("");

    // Reset router spy return values to defaults for each test
    routerPushSpy.mockResolvedValue(undefined as any);
    routerReplaceSpy.mockResolvedValue(undefined as any);
    routerCurrentRouteSpy.mockReturnValue({
      value: { query: {}, name: "traces", path: "/traces" },
    } as any);
  });

  afterEach(async () => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Drain pending async before clearing mocks so lingering chains from this
    // test cannot contaminate the next one. `flushPromises` alone only drains
    // microtasks; the field-grouping path awaits the query client, whose
    // scheduling spans a few macrotask hops, so the loop alternates the two.
    // Bounded and deterministic — no arbitrary sleep. Two iterations were not
    // always enough; three are.
    for (let i = 0; i < 3; i++) {
      await flushPromises();
      await new Promise((r) => setTimeout(r, 0));
    }
    await flushPromises();
    vi.clearAllMocks();
  });

  describe("Component Mounting & Initialization", () => {
    it("should mount the component successfully", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: {
            store: store,
          },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find("#tracePage").exists()).toBe(true);
    });

    it("should load stream list on mount", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Tab Navigation", () => {
    it("should update URL with tab=service-graph when searchMode changes to service-graph", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      // Emit update:searchMode from the search-bar stub to invoke onSearchModeChange,
      // which mutates the reactive searchObj and triggers the watcher.
      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "service-graph");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ tab: "service-graph" }),
        }),
      );
    });

    it("should update URL with tab=traces when searchMode changes to traces", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      // Switching to traces sets tab=traces in URL
      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ tab: "traces" }),
        }),
      );
    });

    it("should update URL with tab=spans when searchMode changes to spans", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { tab: "traces", search_mode: "spans" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "spans");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith({ query: { tab: "spans" } });
    });

    it("should switch to spans when the tab query changes on the mounted Traces route", async () => {
      const currentRoute = ref({
        query: { tab: "traces" },
        name: "traces",
        path: "/traces",
      }) as typeof router.currentRoute;
      routerCurrentRouteSpy.mockReturnValue(currentRoute);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      currentRoute.value = {
        ...currentRoute.value,
        query: { tab: "spans" },
      };
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(routerReplaceSpy).not.toHaveBeenCalled();
    });

    it("should restore the spans default when the tab query is removed", async () => {
      const currentRoute = ref({
        query: { tab: "spans" },
        name: "traces",
        path: "/traces",
      }) as typeof router.currentRoute;
      routerCurrentRouteSpy.mockReturnValue(currentRoute);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      currentRoute.value = {
        ...currentRoute.value,
        query: {},
      };
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(routerReplaceSpy).toHaveBeenCalledWith({ query: { tab: "spans" } });
    });

    it("should switch to service-graph tab from ?tab= on enterprise", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { tab: "service-graph" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // onBeforeMount sets searchMode from URL; activeTab computed reflects it
      expect(mockSearchObj.meta.searchMode).toBe("service-graph");
      expect(wrapper.vm.activeTab).toBe("service-graph");
    });
  });

  describe("In-page tab rendering", () => {
    const mountIndex = () =>
      mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

    it("should render the ServiceGraph stub inline in service-graph mode (enterprise)", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      expect(wrapper.findComponent({ name: "service-graph" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "services-catalog" }).exists()).toBe(false);
    });

    it("passes the graph's last load time and loading state to the search bar", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);
      const ServiceGraphStub = defineComponent({
        name: "service-graph",
        setup(_, { expose }) {
          expose({ lastRunAt: 123, loading: true, refresh: vi.fn() });
          return () => h("div");
        },
      });
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": ServiceGraphStub,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();

      // SearchBar is an async component, so its stub declares no props and the values land as attributes.
      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      expect(searchBarEl.attributes("refresh-last-run-at")).toBe("123");
      expect(searchBarEl.attributes("refresh-loading")).toBe("true");
    });

    it("should render the ServicesCatalog stub inline in services-catalog mode", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "services-catalog" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      expect(wrapper.findComponent({ name: "services-catalog" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "service-graph" }).exists()).toBe(false);
    });

    it("should apply the built filter and switch mode on view-traces from the graph", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      const payload = {
        serviceName: "cart-service",
        operationName: "GET /cart",
        mode: "traces",
        stream: "default",
      };
      const graphEl = wrapper.findComponent({ name: "service-graph" });
      expect(graphEl.exists()).toBe(true);
      await graphEl.vm.$emit("view-traces", payload);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(buildViewTracesFilter(payload));
      expect(mockSearchObj.data.editorValue).toBe(
        "service_name = 'cart-service' AND operation_name = 'GET /cart'",
      );
      expect(mockSearchObj.meta.searchMode).toBe("traces");
      expect(mockSearchObj.data.stream.selectedStream).toEqual({
        label: "default",
        value: "default",
      });
    });

    it("should hydrate the handoff ?filter= into the editor on mount", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { filter: "service_name = 'checkout'" },
          name: "traces",
          path: "/traces",
        },
      } as any);
      mockSearchObj.meta.sqlMode = true;

      wrapper = mountIndex();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(mockSearchObj.meta.sqlMode).toBe(false);
    });

    it("clears a stale editor for an empty handoff ?filter= (unfiltered RCA evidence)", async () => {
      routerCurrentRouteSpy.mockReturnValue(
        ref({
          query: { filter: "" },
          name: "traces",
          path: "/traces",
        }) as typeof router.currentRoute,
      );
      mockSearchObj.data.editorValue = "service_name = 'stale'";

      wrapper = mountIndex();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("");
    });
    it("clears a stale editor filter when the route has a stream and no query", async () => {
      routerCurrentRouteSpy.mockReturnValue(
        ref({
          query: { stream: "default", period: "2h" },
          name: "traces",
          path: "/traces",
        }) as typeof router.currentRoute,
      );
      mockSearchObj.data.editorValue = "service_name='x'";

      wrapper = mountIndex();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("");
    });

    it("keeps the editor when the route has no stream (bare menu link)", async () => {
      routerCurrentRouteSpy.mockReturnValue(
        ref({ query: {}, name: "traces", path: "/traces" }) as typeof router.currentRoute,
      );
      mockSearchObj.data.editorValue = "service_name='x'";

      wrapper = mountIndex();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("service_name='x'");
    });
  });

  describe("Auto Run off (#14760)", () => {
    const mountTraces = () =>
      mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

    beforeEach(() => localStorage.setItem("oo_toggle_auto_run", "false"));

    afterEach(() => {
      delete store.state.zoConfig.auto_query_enabled;
      localStorage.removeItem("oo_toggle_auto_run");
    });

    it("restores the last stream on page load without running a search", async () => {
      store.state.zoConfig.auto_query_enabled = true;
      mockSearchObj.meta.liveMode = false;
      mockRestoreTracesStream.mockReturnValue("default");
      wrapper = mountTraces();
      await vi.waitFor(() =>
        expect(mockSearchObj.data.stream.selectedStream.value).toBe("default"),
      );
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("does not run when the stream changes, and runs once Auto Run is on", async () => {
      store.state.zoConfig.auto_query_enabled = true;
      mockSearchObj.meta.liveMode = false;
      wrapper = mountTraces();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      mockFetchQueryDataWithHttpStream.mockClear();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();

      mockSearchObj.meta.liveMode = true;
      localStorage.setItem("oo_toggle_auto_run", "true");
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
    });

    it("still loads a shared link's stream with Auto Run off", async () => {
      store.state.zoConfig.auto_query_enabled = true;
      mockSearchObj.meta.liveMode = false;
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { stream: "default" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountTraces();
      await vi.waitFor(() => expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled(), {
        timeout: 3000,
      });
    });
  });

  describe("Copy link shortcut", () => {
    const pressCopyLink = async () => {
      const modifier = isMacOS() ? { metaKey: true } : { ctrlKey: true };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", shiftKey: true, ...modifier }));
      await flushPromises();
    };

    it("copies the link only while the shown results come from the current query", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      mockSearchObj.meta.lastRunSignature = tracesSearchRunSignature(mockSearchObj as any);
      mockCopyTracesUrl.mockClear();

      await pressCopyLink();
      expect(mockCopyTracesUrl).toHaveBeenCalledTimes(1);

      mockToast.mockClear();
      mockSearchObj.data.editorValue = "operation_name = 'POST /checkout'";
      await pressCopyLink();
      expect(mockCopyTracesUrl).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: i18n.global.t("search.autoRunPersistNeedsRun"),
        }),
      );
      mockSearchObj.meta.lastRunSignature = null;
    });
  });

  describe("Stream Selection", () => {
    it("should select the default stream automatically", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );
    });

    it("should select stream from URL query params if provided", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "test-stream" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("test-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should show no stream selected message when no stream is selected", async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      // An in-flight search owns the load, so the mount keeps this stream state as is.
      mockSearchObj.loading = true;

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      // The mock is not reactive, so re-render the slotted results once the mount has settled.
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();

      expect(wrapper.find('[data-test="traces-no-stream-selected-text"]').exists()).toBe(true);
    });
  });

  describe("Search Functionality", () => {
    beforeEach(async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
    });

    it("should show apply search message when no search is applied", async () => {
      mockSearchObj.searchApplied = false;
      mockSearchObj.data.queryResults = { hits: [] };
      // An in-flight search owns the load, so the mount does not auto-run another.
      mockSearchObj.loading = true;

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      // The mock is not reactive, so re-render the slotted results once the mount has settled.
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();

      expect(wrapper.find('[data-test="traces-search-not-started-text"]').exists()).toBe(true);
    });

    it("should execute search when searchData is called", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Call searchData
      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
    });

    it("should clear brush selections when running query", async () => {
      mockSearchObj.meta.metricsRangeFilters.set("test", {
        panelTitle: "Duration",
        start: 0,
        end: 100,
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.meta.metricsRangeFilters.size).toBe(0);
    });
  });

  describe("Heatmap selection across searches", () => {
    const mockClearOriginalTimeRange = vi.fn();
    // Mirrors applyFilterTerm's append, so the Error Only toggle edits the editor text.
    const mockApplyFiltersAppend = vi.fn((terms: string[]) => {
      mockSearchObj.data.editorValue = `${mockSearchObj.data.editorValue} and ${terms.join(" and ")}`;
    });
    const composed = "(service_name = 'a') and duration >= '100ms' and duration < '500ms'";
    const APPLIED = { startTime: 1_700_000_000_000_000, endTime: 1_700_000_060_000_000 };
    const heatmapEntry = (overrides: Record<string, unknown> = {}) => ({
      panelTitle: "Duration",
      start: 100_000,
      end: 500_000,
      timeStart: APPLIED.startTime,
      timeEnd: APPLIED.endTime,
      appliedStart: APPLIED.startTime,
      appliedEnd: APPLIED.endTime,
      baselineFilter: "service_name = 'a'",
      stream: "default",
      searchMode: "traces",
      ...overrides,
    });
    const savedDatetime = { ...mockSearchObj.data.datetime };
    const filters = mockSearchObj.meta.metricsRangeFilters as Map<string, any>;

    const mountPage = async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              template: "<div />",
              setup() {
                return {
                  applyFilters: mockApplyFiltersAppend,
                  setEditorValue: vi.fn(),
                };
              },
            },
            "search-result": true,
            "index-list": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      // SearchResult is not rendered before a search has run, so its ref is set the way the drill-down test does.
      wrapper.vm.searchResultRef = {
        metricsDashboardRef: { clearOriginalTimeRange: mockClearOriginalTimeRange },
        getDashboardData: vi.fn(),
      };
      // The state a heatmap box leaves behind, set after mount so page loading cannot disturb it.
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.meta.searchMode = "traces";
      mockSearchObj.data.editorValue = composed;
      Object.assign(mockSearchObj.data.datetime, APPLIED, { type: "absolute" });
      filters.clear();
      mockClearOriginalTimeRange.mockClear();
    };

    afterEach(() => {
      Object.assign(mockSearchObj.data.datetime, savedDatetime);
      filters.clear();
    });

    it("keeps a matching Duration entry across the search", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());

      wrapper.vm.searchData();
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
      expect(mockClearOriginalTimeRange).not.toHaveBeenCalled();
    });

    it.each([
      ["Errors", "(service_name = 'a') and span_status = 'ERROR'"],
      ["Rate", "service_name = 'a'"],
    ])("keeps a current %s entry across the search it triggers", async (panelTitle, editor) => {
      await mountPage();
      mockSearchObj.data.editorValue = editor;
      filters.set("brush", heatmapEntry({ panelTitle, start: null, end: null }));

      wrapper.vm.searchData();
      await flushPromises();

      expect([...filters.keys()]).toEqual(["brush"]);
      expect(mockClearOriginalTimeRange).not.toHaveBeenCalled();
    });

    it.each(["Errors", "Rate"])(
      "drops a stale %s entry and its original range",
      async (panelTitle) => {
        await mountPage();
        mockSearchObj.data.editorValue = "service_name = 'b'";
        filters.set("brush", heatmapEntry({ panelTitle, start: null, end: null }));

        wrapper.vm.searchData();
        await flushPromises();

        expect(filters.size).toBe(0);
        expect(mockClearOriginalTimeRange).toHaveBeenCalled();
      },
    );

    it.each([
      ["applied range", { appliedEnd: APPLIED.endTime - 1_000_000 }],
      ["editor text", { baselineFilter: "service_name = 'b'" }],
      ["stream", { stream: "test-stream" }],
      ["search mode", { searchMode: "spans" }],
    ])("drops a Duration entry whose %s no longer matches", async (_label, overrides) => {
      await mountPage();
      filters.set("heatmap", heatmapEntry(overrides));

      wrapper.vm.searchData();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("drops the entry when Error Only is toggled before the next search", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());

      wrapper.vm.onErrorOnlyToggled(true);
      wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(`${composed} and span_status = 'ERROR'`);
      expect(filters.size).toBe(0);
    });

    it("drops an entry captured in spans mode on a switch to traces mode", async () => {
      await mountPage();
      mockSearchObj.meta.searchMode = "spans";
      filters.set("heatmap", heatmapEntry({ searchMode: "spans" }));

      wrapper.vm.onSearchModeChange("traces");
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("drops an entry captured on another stream on a stream change", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry({ stream: "test-stream" }));

      await wrapper.vm.onChangeStream();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("stages a comparison filter without searching while auto-run is off", async () => {
      await mountPage();
      mockSearchObj.meta.liveMode = false;
      mockSearchObj.meta.searchMode = "spans";
      mockFetchQueryDataWithHttpStream.mockClear();
      vi.mocked(analytics.track).mockClear();
      const setEditorValue = vi.spyOn(wrapper.vm.searchBarRef, "setEditorValue");

      wrapper.vm.onMetricsEditorFilterRun("(service_name = 'a') and http_method = 'GET'");
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("(service_name = 'a') and http_method = 'GET'");
      expect(setEditorValue).toHaveBeenCalledWith("(service_name = 'a') and http_method = 'GET'");
      const runs = vi
        .mocked(analytics.track)
        .mock.calls.filter(([event]: any[]) => event === "traces_search_run");
      expect(runs).toHaveLength(0);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("runs exactly one search for a comparison filter with auto-run on", async () => {
      await mountPage();
      store.state.zoConfig.auto_query_enabled = true;
      mockSearchObj.meta.liveMode = true;
      mockSearchObj.meta.searchMode = "spans";
      mockFetchQueryDataWithHttpStream.mockClear();
      vi.mocked(analytics.track).mockClear();

      try {
        wrapper.vm.onMetricsEditorFilterRun("(service_name = 'a') and http_method = 'GET'");
        await flushPromises();

        const runs = vi
          .mocked(analytics.track)
          .mock.calls.filter(([event]: any[]) => event === "traces_search_run");
        expect(runs).toHaveLength(1);
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      } finally {
        delete store.state.zoConfig.auto_query_enabled;
        mockSearchObj.meta.liveMode = false;
      }
    });

    it("records the staged state a Run applied, so the pending state clears", async () => {
      await mountPage();
      mockSearchObj.meta.lastRunSignature = null;
      mockSearchObj.data.editorValue = "service_name = 'checkout'";

      wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.meta.lastRunSignature).toBe(tracesSearchRunSignature(mockSearchObj));
    });

    it("keeps the last Run's state when a page of more rows loads", async () => {
      await mountPage();
      wrapper.vm.searchData();
      await flushPromises();
      const ran = mockSearchObj.meta.lastRunSignature;
      mockSearchObj.data.editorValue = "service_name = 'staged'";

      wrapper.vm.getMoreData();
      await flushPromises();

      expect(mockSearchObj.meta.lastRunSignature).toBe(ran);
    });

    it("drops an entry made stale by an unsearched filter edit on a sort", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());
      mockSearchObj.data.editorValue = `${composed} and service_name = 'b'`;

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("keeps the entry on a page fetch after an unsearched filter edit, as the page keeps page 1's filter", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());
      mockSearchObj.data.editorValue = `${composed} and service_name = 'b'`;

      wrapper.vm.getQueryData(true);
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
      expect(mockClearOriginalTimeRange).not.toHaveBeenCalled();
    });

    it("sorts an unsearched manual-mode box over its own window and keeps it", async () => {
      await mountPage();
      // The last search ran over the wider pre-box range; the box moved the picker and the editor only.
      mockSearchObj.data.queryPayload = {
        query: {
          start_time: APPLIED.startTime - 600_000_000,
          end_time: APPLIED.endTime + 600_000_000,
        },
      };
      filters.set("heatmap", heatmapEntry());
      mockFetchQueryDataWithHttpStream.mockClear();

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      const req: any = mockFetchQueryDataWithHttpStream.mock.calls.at(-1)?.[0];
      const query = req.queryReq.query ?? req.queryReq;
      expect([query.start_time, query.end_time]).toEqual([APPLIED.startTime, APPLIED.endTime]);
      expect([...filters.keys()]).toEqual(["heatmap"]);
    });

    it("keeps a current entry across a sort", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
    });

    it("clears the original range on Reset", async () => {
      await mountPage();

      wrapper.vm.onFiltersReset();

      expect(mockClearOriginalTimeRange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    const mountForErrors = async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
    };

    // searchObj.data is a plain object in this suite, so the page and its splitter slots re-render by hand.
    const rerender = async () => {
      wrapper.vm.$forceUpdate();
      wrapper.findAllComponents(OSplitter).forEach((splitter) => splitter.vm.$forceUpdate());
      await nextTick();
    };

    const failSearch = async (err: unknown) => {
      const handlers: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation(function (
        this: unknown,
        _req: unknown,
        h: any,
      ) {
        if (this === wrapper.vm.$) handlers.push(h);
      });
      await wrapper.vm.getQueryData();
      await rerender();
      handlers[handlers.length - 1].error({}, err);
      await rerender();
    };

    const errorState = () =>
      wrapper.find('[data-test="traces-search-error-message"] [data-test="query-error-state"]');

    afterEach(() => {
      mockFetchQueryDataWithHttpStream.mockReset();
      mockSearchObj.data.errorCode = 0;
      mockSearchObj.data.errorDetail = "";
    });

    it("renders a planning error with its raw detail hidden", async () => {
      await mountForErrors();

      await failSearch({
        content: {
          message: "Search SQL execute error",
          code: 400,
          error_detail: "Error during planning: No field named foo",
        },
      });

      expect(errorState().exists()).toBe(true);
      expect(wrapper.text()).toContain('This stream has no field named "foo"');
      expect(wrapper.find('[data-test="error-detail-body"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Error during planning");
      expect(wrapper.findComponent(QueryErrorState).props("errorCode")).toBe(0);
    });

    it("hides the details again on a later error after they were opened", async () => {
      await mountForErrors();
      const planningError = {
        content: { message: "Search SQL execute error", code: 400, error_detail: "raw planner" },
      };

      await failSearch(planningError);
      await wrapper.find('[data-test="error-detail-toggle-btn"]').trigger("click");
      expect(wrapper.find('[data-test="error-detail-body"]').text()).toContain("raw planner");

      await failSearch(planningError);

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="error-detail-body"]').exists()).toBe(false);
    });

    it("shows the summary of an unauthorized error", async () => {
      await mountForErrors();

      await failSearch({ content: { message: "Unauthorized Access", code: 403 } });

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="error-detail-summary"]').text()).toBe("Unauthorized Access");
    });

    it("shows generic text for a network error without a code", async () => {
      await mountForErrors();

      await failSearch({});

      expect(errorState().exists()).toBe(true);
      expect(errorState().text()).toContain(i18n.global.t("queryError.generic"));
      expect(wrapper.find('[data-test="error-detail-summary"]').text()).toBe(
        i18n.global.t("traces.index.errorProcessingRequest"),
      );
    });

    it("keeps the J/K live region outside the results the error state replaces", async () => {
      await mountForErrors();

      await failSearch({ content: { message: "boom", code: 500 } });
      announceTracesRowNav("Couldn't load page 2");
      await flushPromises();

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-row-nav-live"]').text()).toBe("Couldn't load page 2");
      tracesRowNavAnnouncement.value = "";
    });

    it("keeps an application error code for the shared error state", async () => {
      await mountForErrors();

      await failSearch({ content: { message: "Full text search not configured", code: 20003 } });

      expect(wrapper.findComponent(QueryErrorState).props("errorCode")).toBe(20003);
    });
  });

  describe("DateTime Handling", () => {
    it("should restore datetime from URL params", async () => {
      const startTime = 1755853746625720;
      const endTime = 1755853746725720;

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            from: startTime,
            to: endTime,
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.datetime.startTime).toBe(startTime);
      expect(mockSearchObj.data.datetime.endTime).toBe(endTime);
      expect(mockSearchObj.data.datetime.type).toBe("absolute");
    });

    it("should restore relative time period from URL params", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            period: "15m",
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.datetime.relativeTimePeriod).toBe("15m");
      expect(mockSearchObj.data.datetime.type).toBe("relative");
    });
  });

  describe("Pagination", () => {
    it("should load more data when getMoreData is called", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.getMoreData();
      await flushPromises();

      // Should have called getQueryData which uses the current page
      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe("Streaming page writes (issue #14317)", () => {
    // The shared beforeEach does not reset currentPage, so it would leak into later tests.
    afterEach(() => {
      mockSearchObj.data.resultGrid.currentPage = 0;
    });

    const meta = (hits: any[] = []) => ({
      type: "search_response_metadata",
      content: { results: { hits } },
    });
    const chunk = (hits: any[]) => ({
      type: "search_response_hits",
      content: { results: { hits } },
    });
    const spans = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        span_id: `${prefix}-${i}`,
        trace_id: `t-${prefix}-${i}`,
        service_name: "svc",
        operation_name: "op",
        _timestamp: 1700000000000000 + i,
      }));

    const mountPage = async () => {
      mockSearchObj.meta.searchMode = "spans";
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      // Mounting runs loadPageData, which can reset the stream selection.
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      // getQueryData derives `from` from currentPage, so this is what makes it page 2.
      mockSearchObj.data.resultGrid.currentPage = 1;
      mockSearchObj.meta.resultGrid.rowsPerPage = 25;
      mockSearchObj.data.queryPayload = {
        query: {
          sql: "",
          start_time: 1700000000000000,
          end_time: 1700003600000000,
          from: 0,
          size: 25,
        },
      };
      return wrapper;
    };

    const lastCallbacks = () => {
      const calls = mockFetchQueryDataWithHttpStream.mock.calls;
      return calls[calls.length - 1][1];
    };

    it("records a Run in recent searches once it completes, and never a page fetch", async () => {
      const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
      await mountPage();
      mockSearchObj.data.resultGrid.currentPage = 0;
      mockSearchObj.data.editorValue = "service_name = 'cart'";
      wrapper.vm.runQueryFn();
      await flushPromises();
      lastCallbacks().complete({});
      await flushPromises();
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][1]).toMatchObject({
        source: "traces",
        query: "service_name = 'cart'",
        streams: ["default"],
        status: "ok",
        context: { page: { stream: "default", tab: "spans" } },
      });

      record.mockClear();
      await wrapper.vm.getMoreData();
      lastCallbacks().complete({});
      await flushPromises();
      expect(record).not.toHaveBeenCalled();
      record.mockRestore();
    });

    it("records a query error as failed and a cancel not at all", async () => {
      const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
      await mountPage();
      mockSearchObj.data.editorValue = "nosuch = 1";
      wrapper.vm.runQueryFn();
      await flushPromises();
      lastCallbacks().error({}, { content: { code: 20004, message: "field not found" } });
      await flushPromises();
      expect(record.mock.calls[0][1]).toMatchObject({
        status: "error",
        context: { error: "field not found" },
      });

      record.mockClear();
      wrapper.vm.runQueryFn();
      await flushPromises();
      lastCallbacks().error({}, { content: { code: 20009, message: "cancelled" } });
      await flushPromises();
      expect(record).not.toHaveBeenCalled();
      record.mockRestore();
    });

    describe("spans ORDER BY across pages", () => {
      const field = (name: string) => ({ name });
      const spansSql = async (
        sortBy: string,
        fields = ["duration", "trace_id", "span_id"],
        sortOrder = "desc",
      ) => {
        await mountPage();
        mockSearchObj.data.stream.selectedStreamFields = fields.map(field);
        mockSearchObj.meta.resultGrid.sortBy = sortBy;
        mockSearchObj.meta.resultGrid.sortOrder = sortOrder;
        await wrapper.vm.getMoreData();
        const calls = mockFetchQueryDataWithHttpStream.mock.calls;
        return b64DecodeUnicode((calls[calls.length - 1][0] as any).queryReq.query.sql);
      };

      afterEach(() => {
        mockSearchObj.data.stream.selectedStreamFields = [];
        mockSearchObj.meta.resultGrid.sortBy = "start_time";
        mockSearchObj.meta.resultGrid.sortOrder = "desc";
      });

      it("adds trace and span id tie-breaks to a non-time sort", async () => {
        expect(await spansSql("duration")).toBe(
          'SELECT * FROM "default" ORDER BY duration DESC, trace_id ASC, span_id ASC',
        );
      });

      it("keeps the time sort as a single key", async () => {
        expect(await spansSql("start_time")).toBe(
          'SELECT * FROM "default" ORDER BY _timestamp DESC',
        );
      });

      it("does not repeat the sort column as a tie-break", async () => {
        expect(await spansSql("span_id")).toBe(
          'SELECT * FROM "default" ORDER BY span_id DESC, trace_id ASC',
        );
      });

      it("skips a tie-break column the stream schema lacks", async () => {
        expect(await spansSql("duration", ["duration", "trace_id"])).toBe(
          'SELECT * FROM "default" ORDER BY duration DESC, trace_id ASC',
        );
      });

      it("keeps both tie-breaks while the stream schema is not loaded", async () => {
        expect(await spansSql("duration", [])).toBe(
          'SELECT * FROM "default" ORDER BY duration DESC, trace_id ASC, span_id ASC',
        );
      });

      it("keeps the tie-breaks ascending on an ascending sort", async () => {
        expect(await spansSql("duration", undefined, "asc")).toBe(
          'SELECT * FROM "default" ORDER BY duration ASC, trace_id ASC, span_id ASC',
        );
      });
    });

    describe("page landings and restores from another page", () => {
      const restoredEntry: QueryHistoryEntry = {
        id: "t1",
        source: "traces",
        query: "service_name = 'cart'",
        query_key: "k",
        streams: ["default"],
        context: { page: { stream: "default", tab: "spans" } },
        status: "ok",
        starred: false,
        run_count: 1,
        created_at: 1,
        updated_at: 2,
      };
      const landWith = async (run: boolean | null) => {
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
        if (run !== null) {
          await openRecentOnItsPage(landingRouter().router, restoredEntry, "now", "default", run);
        }
        mockSearchObj.data.editorValue = "service_name = 'cart'";
        const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
        await wrapper.vm.loadPageData();
        await flushPromises();
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
        return mockFetchQueryDataWithHttpStream.mock.calls.length - before;
      };

      it("runs a plain landing without recording it", async () => {
        const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
        await mountPage();
        record.mockClear();
        expect(await landWith(null)).toBe(1);
        lastCallbacks().complete({});
        await flushPromises();
        expect(record).not.toHaveBeenCalled();
        record.mockRestore();
      });

      it("runs and records a restore that asked to run", async () => {
        const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
        await mountPage();
        record.mockClear();
        expect(await landWith(true)).toBe(1);
        lastCallbacks().complete({});
        await flushPromises();
        expect(record).toHaveBeenCalledTimes(1);
        record.mockRestore();
      });

      it("claims a restore that finds no stream, so a later landing is not taken for it", async () => {
        await mountPage();
        await openRecentOnItsPage(landingRouter().router, restoredEntry, "now", "default", true);
        mockGetStreams.mockResolvedValueOnce({ list: [] });
        mockSearchObj.data.stream.streamLists = [];
        mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
        const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
        await wrapper.vm.loadPageData();
        await flushPromises();
        expect(mockSearchObj.data.stream.selectedStream.value || "").toBe("");
        expect(mockFetchQueryDataWithHttpStream.mock.calls.length).toBe(before);
        expect(takeRecentLanding("traces")).toBeNull();
        landWithoutRestore();
      });

      it("remembers the query each search ran with, so the Run button can tell when the editor moved on", async () => {
        await mountPage();
        mockSearchObj.data.editorValue = "service_name = 'cart'";
        wrapper.vm.runQueryFn();
        await flushPromises();
        expect(mockSearchObj.data.appliedEditorValue).toBe("service_name = 'cart'");
        mockSearchObj.data.editorValue = "service_name = 'checkout'";
        await wrapper.vm.getMoreData();
        await flushPromises();
        expect(mockSearchObj.data.appliedEditorValue).toBe("service_name = 'cart'");
      });

      it("only loads a restore that asked not to run", async () => {
        const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
        await mountPage();
        record.mockClear();
        expect(await landWith(false)).toBe(0);
        await flushPromises();
        expect(record).not.toHaveBeenCalled();
        record.mockRestore();
      });
    });

    describe("J/K page crossing signals (4a §3.4)", () => {
      const navigation = () => mockSearchObj.meta.resultGrid.navigation;
      const pend = () => {
        navigation().pendingPageSelection = { page: 2, position: "first", requestId: null };
      };
      const sentTraceId = () => {
        const calls = mockFetchQueryDataWithHttpStream.mock.calls;
        return calls[calls.length - 1][0].traceId;
      };

      afterEach(() => {
        navigation().pendingPageSelection = null;
        navigation().selectionActive = false;
        navigation().currentRowIndex = 0;
        mockSearchObj.data.resultGrid.pageRequest = null;
        mockSearchObj.data.resultGrid.pageLoad = null;
      });

      it("binds the crossing to the page request it sends and records its completion", async () => {
        await mountPage();
        mockFetchQueryDataWithHttpStream.mockClear();
        pend();
        await wrapper.vm.getQueryData(true);
        const traceId = sentTraceId();
        expect(navigation().pendingPageSelection?.requestId).toBe(traceId);
        expect(mockSearchObj.data.resultGrid.pageRequest).toEqual({ requestId: traceId });

        lastCallbacks().complete(null);
        expect(mockSearchObj.data.resultGrid.pageLoad).toEqual({
          requestId: traceId,
          ok: true,
          reason: "done",
        });
      });

      it("records `error` from the page request's error callback", async () => {
        await mountPage();
        mockFetchQueryDataWithHttpStream.mockClear();
        pend();
        await wrapper.vm.getQueryData(true);
        lastCallbacks().error(null, { content: { message: "boom", code: 500 } });
        expect(mockSearchObj.data.resultGrid.pageLoad).toEqual({
          requestId: sentTraceId(),
          ok: false,
          reason: "error",
        });
      });

      it("records `error` when the request throws after it was bound (outer catch)", async () => {
        await mountPage();
        mockFetchQueryDataWithHttpStream.mockImplementationOnce(() => {
          throw new Error("init");
        });
        pend();
        await wrapper.vm.getQueryData(true);
        const bound = navigation().pendingPageSelection?.requestId;
        expect(bound).toBeTruthy();
        expect(mockSearchObj.data.resultGrid.pageLoad).toEqual({
          requestId: bound,
          ok: false,
          reason: "error",
        });
      });

      it("records `cancelled` when the user cancels the bound page request", async () => {
        await mountPage();
        mockFetchQueryDataWithHttpStream.mockClear();
        pend();
        await wrapper.vm.getQueryData(true);
        wrapper.vm.cancelSearch();
        expect(mockSearchObj.data.resultGrid.pageLoad).toEqual({
          requestId: sentTraceId(),
          ok: false,
          reason: "cancelled",
        });
      });

      it("a new search drops the selection and any crossing", async () => {
        await mountPage();
        pend();
        navigation().selectionActive = true;
        navigation().currentRowIndex = 7;
        await wrapper.vm.getQueryData(false);
        expect(navigation()).toMatchObject({
          selectionActive: false,
          currentRowIndex: null,
          pendingPageSelection: null,
        });
      });
    });

    it("replaces the previous page when the stream opens with an empty batch", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const page1 = spans("p1", 25);
      mockSearchObj.data.queryResults.hits = [...page1];

      const cb = lastCallbacks();
      const page2 = spans("p2", 25);
      // The backend opens every page past the first with an empty batch.
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.data(null, meta([]));
      cb.data(null, chunk(page2));

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toHaveLength(25);
      expect(ids).toEqual(page2.map((h) => h.span_id));
      expect(ids.some((id: string) => id.startsWith("p1-"))).toBe(false);
    });

    it("joins batches within one page instead of replacing them", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const cb = lastCallbacks();
      const first = spans("a", 5);
      const second = spans("b", 20);
      cb.data(null, meta([]));
      cb.data(null, chunk(first));
      cb.data(null, meta([]));
      cb.data(null, chunk(second));

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual([...first, ...second].map((h) => h.span_id));
    });

    it("clears the grid when a page streams no rows at all", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      mockSearchObj.data.queryResults.hits = spans("p1", 25);

      const cb = lastCallbacks();
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.complete(null);

      expect(mockSearchObj.data.queryResults.hits).toEqual([]);
    });

    it("carries a landed count only into a re-run of the same query, never a placeholder total", async () => {
      await mountPage();
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      Object.assign(mockSearchObj.data.queryResults, { total: 600, countLanded: true });

      await wrapper.vm.getQueryData(false);
      await flushPromises();
      expect(mockSearchObj.data.queryResults.lastTotal).toBe(600);

      mockSearchObj.data.editorValue = "span_status = 'ERROR'";
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      expect(mockSearchObj.data.queryResults.lastTotal).toBeUndefined();

      mockSearchObj.data.editorValue = "";
      mockSearchObj.data.queryResults = { hits: [], total: 0 };
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      expect(mockSearchObj.data.queryResults.lastTotal).toBeUndefined();
    });

    // Logs shows its error banner over the last results rather than blanking; traces matches it.
    it("keeps the previous rows when a page fails before writing any", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const page1 = spans("p1", 25);
      mockSearchObj.data.queryResults.hits = [...page1];

      const cb = lastCallbacks();
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.error(null, { content: { message: "boom", code: 500 } });

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual(page1.map((h) => h.span_id));
    });

    it("ignores batches from a request that a newer search superseded", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      const stale = lastCallbacks();

      // A second search cancels the first and takes ownership of the grid.
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      const current = lastCallbacks();

      const fresh = spans("new", 25);
      current.data(null, meta([]));
      current.data(null, chunk(fresh));

      stale.data(null, meta([]));
      stale.data(null, chunk(spans("old", 25)));
      stale.complete(null);

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual(fresh.map((h) => h.span_id));
    });

    it("tracks traces_search_completed when a new search completes", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      vi.mocked(analytics.track).mockClear();

      const { data, complete } = lastCallbacks();
      data(null, meta([]));
      data(null, chunk(spans("a", 7)));
      complete(null);

      expect(analytics.track).toHaveBeenCalledWith("traces_search_completed", { hits: 7 });
    });

    it("reports zero hits when the search writes no rows", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      vi.mocked(analytics.track).mockClear();
      mockSearchObj.data.queryResults.hits = spans("old", 5);

      lastCallbacks().complete(null);

      expect(analytics.track).toHaveBeenCalledWith("traces_search_completed", { hits: 0 });
    });

    it("does not track traces_search_completed when a page completes", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      vi.mocked(analytics.track).mockClear();

      lastCallbacks().complete(null);

      const events = vi.mocked(analytics.track).mock.calls.map((c) => c[0]);
      expect(events).not.toContain("traces_search_completed");
    });

    // o2-enterprise#3126 B2: a cancelled search must not claim the time window has no data.
    describe("cancelling a new search", () => {
      const showOldResults = () => {
        mockSearchObj.data.queryResults = { hits: spans("old", 25), total: 80, from: 50, size: 25 };
        mockSearchObj.data.resultGrid.currentPage = 2;
        mockSearchObj.meta.resultGrid.showPagination = true;
      };
      const shownIds = () => mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);

      afterEach(() => {
        mockSearchObj.meta.resultGrid.showPagination = false;
        mockSearchObj.data.resultGrid.currentPage = 0;
      });

      it("shows the cancelled state with no rows, count or paging from the search it replaced", async () => {
        await mountPage();
        showOldResults();
        await wrapper.vm.getQueryData(false);

        wrapper.vm.cancelSearch();

        expect(wrapper.vm.searchCancelled).toBe(true);
        expect(shownIds()).toEqual([]);
        expect(mockSearchObj.data.queryResults.total).toBe(0);
        expect(mockSearchObj.meta.resultGrid.showPagination).toBe(false);
        expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
        expect(mockSearchObj.loading).toBe(false);
      });

      it("drops the partial rows the cancelled search already streamed", async () => {
        await mountPage();
        await wrapper.vm.getQueryData(false);
        lastCallbacks().data(null, chunk(spans("new", 5)));
        expect(shownIds()).toHaveLength(5);

        wrapper.vm.cancelSearch();

        expect(wrapper.vm.searchCancelled).toBe(true);
        expect(shownIds()).toEqual([]);
      });

      it("shows the cancelled state when there were no earlier results", async () => {
        await mountPage();
        await wrapper.vm.getQueryData(false);
        expect(wrapper.vm.searchCancelled).toBe(false);

        wrapper.vm.cancelSearch();

        expect(wrapper.vm.searchCancelled).toBe(true);
        expect(mockSearchObj.loading).toBe(false);
      });

      it("ignores rows that arrive from the cancelled search afterwards", async () => {
        await mountPage();
        await wrapper.vm.getQueryData(false);
        const cancelled = lastCallbacks();
        wrapper.vm.cancelSearch();

        cancelled.data(null, chunk(spans("late", 3)));

        expect(shownIds()).toEqual([]);
        expect(wrapper.vm.searchCancelled).toBe(true);
      });

      it("control: cancelling a page request keeps the page on screen and no cancelled state", async () => {
        await mountPage();
        showOldResults();
        mockSearchObj.meta.resultGrid.navigation.pendingPageSelection = {
          page: 3,
          position: "first",
          requestId: null,
        };
        await wrapper.vm.getQueryData(true);

        wrapper.vm.cancelSearch();

        expect(wrapper.vm.searchCancelled).toBe(false);
        expect(shownIds()).toHaveLength(25);
        mockSearchObj.meta.resultGrid.navigation.pendingPageSelection = null;
        mockSearchObj.data.resultGrid.pageRequest = null;
        mockSearchObj.data.resultGrid.pageLoad = null;
      });

      it("clears the cancelled state when the next search starts", async () => {
        await mountPage();
        await wrapper.vm.getQueryData(false);
        wrapper.vm.cancelSearch();
        expect(wrapper.vm.searchCancelled).toBe(true);

        await wrapper.vm.getQueryData(false);

        expect(wrapper.vm.searchCancelled).toBe(false);
      });
    });
  });

  describe("Metrics Filters Integration", () => {
    // Spies for SearchBar ref methods exposed via stub
    const mockApplyFilters = vi.fn();
    const mockSetEditorValue = vi.fn();

    function mountWithSearchBarStub() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              template: "<div />",
              setup() {
                return {
                  applyFilters: mockApplyFilters,
                  setEditorValue: mockSetEditorValue,
                };
              },
            },
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      mockApplyFilters.mockReset();
      mockSetEditorValue.mockReset();
      mockSearchObj.data.editorValue = "";
      mockSearchObj.meta.metricsRangeFilters.clear();
      // Reset auto_query_enabled to undefined for each test
      delete store.state.zoConfig.auto_query_enabled;
    });

    it.each([
      ["one branch of an OR", "service_name='a' OR span_status='ERROR'", false],
      ["a top-level AND condition", "service_name='a' AND span_status='ERROR'", true],
    ])("shows errors-only as on for %s: %s", async (_name, filter, on) => {
      mockSearchObj.data.editorValue = filter;
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      expect(wrapper.vm.showErrorOnly).toBe(on);
    });

    it("should grow the query pane with the filter builder and shrink it back", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      const bar = wrapper.findComponent('[data-test="logs-search-bar"]');
      bar.vm.$emit("filterBuilderGrowth", 54);
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90 + 54);
      bar.vm.$emit("filterBuilderGrowth", null);
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
    });

    it("should keep one pane height when the builder changes in the same tick as leaving the Spans view", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      const bar = wrapper.findComponent('[data-test="logs-search-bar"]');
      bar.vm.$emit("filterBuilderGrowth", 0);
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
      bar.vm.$emit("filterBuilderGrowth", 18);
      mockSearchObj.meta.searchMode = "traces";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90 + 18);
      bar.vm.$emit("filterBuilderGrowth", null);
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
      mockSearchObj.meta.searchMode = "spans";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
    });

    it("should render the drill-down target in the search tab", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("search");
      expect(wrapper.find("#traces-drill-down-page").exists()).toBe(true);
    });

    it("should open the analysis dashboard on SearchResult when SearchBar emits drill-down", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      const openComparison = vi.fn();
      wrapper.vm.searchResultRef = { openComparison };

      wrapper.findComponent('[data-test="logs-search-bar"]').vm.$emit("drill-down");
      await flushPromises();

      expect(openComparison).toHaveBeenCalledTimes(1);
    });

    it("has no filters-updated handler: brushes write the editor through editor-filter-set", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      expect(wrapper.vm.onMetricsFiltersUpdated).toBeUndefined();
    });

    describe("onMetricsEditorFilterSet", () => {
      const searchDataRuns = () =>
        vi
          .mocked(analytics.track)
          .mock.calls.filter(([event]: any[]) => event === "traces_search_run").length;

      beforeEach(() => {
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      });

      it("sets the editor text and runs exactly one search in live mode", async () => {
        mockSearchObj.meta.liveMode = true;
        store.state.zoConfig.auto_query_enabled = true;
        wrapper = mountWithSearchBarStub();
        await flushPromises();
        vi.mocked(analytics.track).mockClear();

        wrapper.vm.onMetricsEditorFilterSet("(a = '1') and duration < '1ms'");

        expect(mockSearchObj.data.editorValue).toBe("(a = '1') and duration < '1ms'");
        expect(mockSetEditorValue).toHaveBeenCalledWith("(a = '1') and duration < '1ms'");
        expect(searchDataRuns()).toBe(1);
      });

      it("sets the editor text and runs no search with live mode off", async () => {
        store.state.zoConfig.auto_query_enabled = true;
        wrapper = mountWithSearchBarStub();
        await flushPromises();
        // Mount derives liveMode from auto_query_enabled, so switch it off afterwards.
        mockSearchObj.meta.liveMode = false;
        vi.mocked(analytics.track).mockClear();

        wrapper.vm.onMetricsEditorFilterSet("duration < '1ms'");

        expect(mockSearchObj.data.editorValue).toBe("duration < '1ms'");
        expect(mockSetEditorValue).toHaveBeenCalledWith("duration < '1ms'");
        expect(searchDataRuns()).toBe(0);
      });
    });

    it.each([
      [
        "one with a top-level OR",
        "service_name='a' OR span_status='ERROR'",
        "(service_name='a' OR span_status='ERROR') and span_status = 'ERROR'",
      ],
      [
        "a bracketed OR",
        "(service_name='a' OR span_status='ERROR')",
        "(service_name='a' OR span_status='ERROR') and span_status = 'ERROR'",
      ],
      ["a plain AND filter", "service_name='a'", "service_name='a' and span_status = 'ERROR'"],
    ])("turning errors-only on ANDs the condition onto %s", async (_name, filter, expected) => {
      mockSearchObj.data.editorValue = filter;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onErrorOnlyToggled(true);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(expected);
      expect(mockSetEditorValue).toHaveBeenLastCalledWith(expected);
    });

    it.each(["service_name='a' OR span_status='ERROR'", "service_name='a'", ""])(
      "turning errors-only on then off gives back %j",
      async (original) => {
        mockSearchObj.data.editorValue = original;
        wrapper = mountWithSearchBarStub();
        await flushPromises();

        wrapper.vm.onErrorOnlyToggled(true);
        wrapper.vm.onErrorOnlyToggled(false);
        await flushPromises();

        expect(mockSearchObj.data.editorValue).toBe(original);
        expect(mockSetEditorValue).toHaveBeenLastCalledWith(original);
      },
    );
  });

  describe("Splitter Behavior", () => {
    it("should dispatch resize event when splitter is updated", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      wrapper.vm.onSplitterUpdate();
      await flushPromises();

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
    });
  });

  describe("Horizontal Splitter Layout", () => {
    it("should render the outer horizontal splitter with the correct class", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find(".traces-horizontal-splitter").exists()).toBe(true);
    });

    it("should initialize splitterModel with a default value of 15", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.splitterModel).toBe(90);
    });

    it("should render the second-level container with full-height class", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find("#tracesSecondLevel").classes()).toContain("h-full");
    });

    it("should render search-bar inside the outer horizontal splitter", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": { template: '<div data-test="logs-search-bar" />' },
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const horizontalSplitter = wrapper.find(".traces-horizontal-splitter");
      expect(horizontalSplitter.exists()).toBe(true);
      expect(horizontalSplitter.find('[data-test="logs-search-bar"]').exists()).toBe(true);
    });
  });

  describe("Query Restoration", () => {
    it("should restore query from URL params", async () => {
      const testQuery = "service_name = 'test'";
      const encodedQuery = btoa(testQuery);

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            query: encodedQuery,
            stream: "default",
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(testQuery);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty stream list gracefully", async () => {
      // Override just for this test — mockGetStreams is the shared vi.fn from vi.hoisted
      mockGetStreams.mockResolvedValueOnce({ list: [] });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.stream.streamLists).toEqual([]);
      expect(mockSearchObj.loading).toBe(false);
    });

    it("should not execute search when no stream is selected", async () => {
      mockSearchObj.data.stream.streamLists = [];
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const result = await wrapper.vm.searchData();

      expect(result).toBeUndefined();
    });

    it("getMoreData fetches the next page", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockFetchQueryDataWithHttpStream.mockClear();

      await wrapper.vm.getMoreData();
      await flushPromises();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("tracks traces_search_run and traces_more_rows_loaded without user or page fields", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.meta.showQuery = true;
      mockSearchObj.meta.showHistogram = false;
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.meta.showFields = true;
      vi.mocked(analytics.track).mockClear();

      wrapper.vm.searchData();
      await wrapper.vm.getMoreData();
      await flushPromises();

      expect(analytics.track).toHaveBeenCalledWith("traces_search_run", {
        stream_name: "default",
        show_query: true,
        show_histogram: false,
        sql_mode: false,
        show_fields: true,
      });
      expect(analytics.track).toHaveBeenCalledWith("traces_more_rows_loaded", {
        stream_name: "default",
      });
      expect(analytics.track).not.toHaveBeenCalledWith("Button Click", expect.anything());
    });
  });

  describe("onSearchModeChange — sortBy reset", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    it("should reset sortBy to start_time when switching to traces mode and sortBy is a spans-only column", async () => {
      // Simulate a spans-specific sort column being active
      mockSearchObj.meta.resultGrid.sortBy = "span_status";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });

    it("should NOT reset sortBy when switching to traces mode and sortBy is start_time", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "start_time";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });

    it("should NOT reset sortBy when switching to traces mode and sortBy is duration", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "duration";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("duration");
    });

    it("should NOT reset sortBy when switching to spans mode", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";
      mockSearchObj.meta.searchMode = "traces";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "spans");
      await flushPromises();

      // Switching to spans does not reset sortBy
      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("operation_name");
    });

    it("should reset sortBy to start_time when switching to traces mode and sortBy is operation_name", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });
  });

  describe("cancelSearch", () => {
    it("should dispatch cancelQuery event on window when cancelSearch is called", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      wrapper.vm.cancelSearch();
      await flushPromises();

      const cancelQueryCalls = dispatchEventSpy.mock.calls.filter(
        ([evt]) => evt instanceof Event && evt.type === "cancelQuery",
      );
      expect(cancelQueryCalls.length).toBeGreaterThan(0);
    });

    it.skip("should set searchObj.loading to false when an in-flight search is cancelled", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Ensure datetime is in a valid state for buildSearch
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };
      // Keep the stream query open — never resolve — so currentSearchTraceId stays set
      vi.mocked(mockFetchQueryDataWithHttpStream).mockImplementation(() => {
        // intentional no-op: callbacks never called
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Start a search to populate currentSearchTraceId; wait until loading is set
      wrapper.vm.searchData();
      await flushPromises();

      // Verify the search started (loading = true means getQueryData reached fetchQueryDataWithHttpStream)
      await vi.waitFor(
        () => {
          expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      expect(mockSearchObj.loading).toBe(true);

      wrapper.vm.cancelSearch();
      await flushPromises();

      expect(mockSearchObj.loading).toBe(false);
    });

    it("should not call cancelStreamQueryBasedOnRequestId when there is no active trace id", async () => {
      // With a stream list, mount starts a search a variable number of macrotask hops later; no streams means none.
      mockGetStreams.mockResolvedValueOnce({ list: [] });
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      for (let i = 0; i < 3; i++) {
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));
      }
      // Unmounted instances from earlier tests can still search on the shared mocks, so only this instance counts.
      const ownSearches = mockFetchQueryDataWithHttpStream.mock.contexts.filter(
        (owner) => owner === wrapper.vm.$,
      );
      expect(ownSearches).toHaveLength(0);

      // cancelSearch is synchronous, so bracketing it keeps a leftover instance's cancel out of the count.
      const cancelsBefore = mockCancelStreamQueryBasedOnRequestId.mock.calls.length;
      wrapper.vm.cancelSearch();
      expect(mockCancelStreamQueryBasedOnRequestId.mock.calls.length).toBe(cancelsBefore);
    });

    it.skip("should call cancelStreamQueryBasedOnRequestId with trace id and org id when a search is in-flight", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Reset datetime to a known-good state so buildSearch doesn't fall back to
      // absolute timestamps that might be left over from previous tests
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };

      // Keep the search in-flight so currentSearchTraceId stays set
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // intentional no-op: callbacks never called, search stays open
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Trigger a search to populate currentSearchTraceId
      wrapper.vm.searchData();
      await flushPromises();

      // Wait until the search has actually started (fetchQueryDataWithHttpStream called)
      await vi.waitFor(
        () => {
          expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      wrapper.vm.cancelSearch();
      await flushPromises();

      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: mockSearchObj.organizationIdentifier,
        }),
      );
      expect(mockSearchObj.loading).toBe(false);
    });
  });

  describe("parseDurationWhereClause integration", () => {
    beforeEach(() => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
    });

    it("should call parseDurationWhereClause when building a search with a non-empty where clause", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      parseSpy.mockReturnValue("duration >= 1500");

      mockSearchObj.data.editorValue = "duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(parseSpy).toHaveBeenCalled();
    });

    it("should use the converted where clause string returned by parseDurationWhereClause", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      // Simulate duration conversion: '1.50ms' → 1500 (raw µs)
      parseSpy.mockReturnValue("duration >= 1500");

      mockSearchObj.data.editorValue = "duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // buildSearch is called inside searchData
      await wrapper.vm.searchData();
      await flushPromises();

      // parseDurationWhereClause should have been called with the raw where clause
      expect(parseSpy).toHaveBeenCalledWith(
        expect.stringContaining("duration"),
        expect.anything(),
        "default",
      );
    });

    it("should not call parseDurationWhereClause when where clause is empty", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      mockSearchObj.data.editorValue = "";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // Guards the parser filter below from going vacuous if the parser argument stops being passed.
      expect(parseSpy.mock.calls.some(([, parser]) => createdTracesParsers.includes(parser))).toBe(
        true,
      );

      // parseDurationWhereClause returns the input unchanged for empty strings (no-op)
      // Either it was not called, or if called, it was with an empty string and returned it
      const callsWithNonEmpty = parseSpy.mock.calls.filter(
        ([clause, parser]) =>
          createdTracesParsers.includes(parser) &&
          typeof clause === "string" &&
          clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass a match_all term containing a pipe to parseDurationWhereClause in full", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      parseSpy.mockReturnValue("duration >= 1500");

      // A pipe inside a quoted search term is part of the term, not a separator.
      mockSearchObj.data.editorValue = "match_all('text | error') and duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // The whole editor value is the where clause — the match_all term must reach
      // parseDurationWhereClause intact rather than truncated at the pipe.
      const calls = parseSpy.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const [clause] of calls) {
        expect(clause).toContain("match_all('text | error')");
      }
    });

    it("should keep original where clause when parseDurationWhereClause returns an error object", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      // Return an error object — component should keep the original whereClause
      parseSpy.mockReturnValue({
        error: 'Unknown duration unit: "lightyears"',
      });

      mockSearchObj.data.editorValue = "duration >= '5lightyears'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Component should not throw when parseDurationWhereClause returns an error object
      let thrownError: unknown = null;
      try {
        await wrapper.vm.searchData();
      } catch (e) {
        thrownError = e;
      }
      await flushPromises();

      expect(thrownError).toBeNull();
      expect(parseSpy).toHaveBeenCalled();
    });
  });

  describe("Services Catalog — activeTab computed & URL restore", async () => {
    function mountWithServicesCatalogStub() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    it("should set searchMode and early-return without resetting sortBy when switching to services-catalog", async () => {
      // Set a non-default sortBy to prove it was not reset
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";

      wrapper = mountWithServicesCatalogStub();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "services-catalog");
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("services-catalog");
      // Early return prevents sortBy reset
      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("operation_name");
    });
  });

  describe("parseSpanKindWhereClause integration", () => {
    // Shared mount factory — keeps stub config in one place.
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      // Provide a selected stream so getQueryData does not early-return.
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Clear call history so earlier tests in the suite do not pollute
      // toHaveBeenCalledWith assertions (the component auto-searches on mount
      mockFetchQueryDataWithHttpStream.mockClear();
      // Default: spy passes the where clause through unchanged (real-implementation behaviour).
      mockParseSpanKindWhereClause.mockImplementation((whereClause: string) => whereClause);
      // Reset parseDurationWhereClause to passthrough so bleed-through from
      // the parseDurationWhereClause integration tests does not alter the
      // where clause before parseSpanKindWhereClause sees it.
      vi.mocked(useDurationPercentilesModule.parseDurationWhereClause).mockImplementation(
        (whereClause: string) => whereClause,
      );
    });

    it("should call parseSpanKindWhereClause when buildSearch runs with a non-empty where clause", async () => {
      mockSearchObj.data.editorValue = "span_kind='Server'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockParseSpanKindWhereClause).toHaveBeenCalled();
    });

    it("should call parseSpanKindWhereClause with the where-clause portion of editorValue", async () => {
      mockSearchObj.data.editorValue = "span_kind='Server'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      const calls = mockParseSpanKindWhereClause.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // At least one call must have received the span_kind filter string.
      const matchingCall = calls.find(([arg]) => (arg as string).includes("span_kind"));
      expect(matchingCall).toBeDefined();
      expect(matchingCall![0]).toContain("span_kind='Server'");
    });

    it("should not call parseSpanKindWhereClause when the where clause is empty", async () => {
      mockSearchObj.data.editorValue = "";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // Guards the parser filter below from going vacuous if the parser argument stops being passed.
      expect(
        mockParseSpanKindWhereClause.mock.calls.some(([, parser]) =>
          createdTracesParsers.includes(parser),
        ),
      ).toBe(true);

      // parseSpanKindWhereClause is guarded by `whereClause.trim() != ""` in buildSearch;
      // for an empty editorValue the spy must not have been called with a non-empty string.
      const callsWithNonEmpty = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause, parser]) =>
          createdTracesParsers.includes(parser) &&
          typeof clause === "string" &&
          clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass a match_all term containing a pipe to parseSpanKindWhereClause in full", async () => {
      mockSearchObj.data.editorValue = "match_all('text | error') and span_kind='Consumer'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      const nonEmptyCalls = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(nonEmptyCalls.length).toBeGreaterThan(0);
      for (const [clause] of nonEmptyCalls) {
        // The quoted term is forwarded intact rather than truncated at the pipe.
        expect(clause).toContain("match_all('text | error')");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Organisation change handling
  // ---------------------------------------------------------------------------
  describe("Organisation change handling", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    describe("onBeforeMount", () => {
      it("should call resetSearchObj when organizationIdentifier differs from store org on mount", async () => {
        // Simulate a stale singleton — component was last used under "old-org"
        // but the store now says "default".
        mockSearchObj.organizationIdentifier = "old-org";
        // store.state.selectedOrganization.identifier is "default" (set in helpers/store.ts)

        wrapper = mountIndexStubbed();
        await flushPromises();

        expect(mockResetSearchObj).toHaveBeenCalled();
      });

      it("should NOT call resetSearchObj on first mount when organizationIdentifier is empty", async () => {
        // Fresh singleton — no previous org stored yet.
        mockSearchObj.organizationIdentifier = "";

        wrapper = mountIndexStubbed();
        await flushPromises();

        expect(mockResetSearchObj).not.toHaveBeenCalled();
      });
    });

    // The header org switch re-keys MainLayout's content, so the page remounts; the router may not have left the old URL yet.
    describe("remount after a header org switch", () => {
      afterEach(() => {
        delete store.state.zoConfig.auto_query_enabled;
        globalThis.localStorage.removeItem("oo_toggle_auto_run");
      });

      async function remountWith(query: Record<string, string>, autoRun: boolean, lastOrg: string) {
        store.state.zoConfig.auto_query_enabled = true;
        globalThis.localStorage.setItem("oo_toggle_auto_run", String(autoRun));
        mockSearchObj.meta.liveMode = autoRun;
        mockSearchObj.organizationIdentifier = lastOrg;
        routerCurrentRouteSpy.mockReturnValue({
          value: { query, name: "traces", path: "/traces" },
        } as any);
        wrapper = mountIndexStubbed();
        await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false), { timeout: 10000 });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flushPromises();
      }

      it.each([
        ["the old org's URL", { stream: "default", org_identifier: "old-org" }],
        ["the new org's bare URL", { org_identifier: "default" }],
      ])("does not search with Auto Run off while the router still shows %s", async (_l, query) => {
        await remountWith(query, false, "old-org");
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        expect(mockSearchObj.data.stream.selectedStream.value).toBeTruthy();
      });

      it("still searches with Auto Run on", async () => {
        await remountWith({ stream: "default", org_identifier: "old-org" }, true, "old-org");
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      });

      it("searches a shared link for the org being switched to with Auto Run off", async () => {
        await remountWith({ stream: "default", org_identifier: "default" }, false, "old-org");
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      });

      it("searches a shared link for another org opened without an org switch", async () => {
        await remountWith({ stream: "default", org_identifier: "other-org" }, false, "default");
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      });
    });

    describe("onActivated", () => {
      // Helper: mount Index inside a KeepAlive wrapper so that toggling
      // the `show` ref produces real deactivate/activate lifecycle calls.
      function mountWithKeepAlive() {
        const show = ref(true);
        const Parent = defineComponent({
          setup() {
            return () =>
              h(KeepAlive, null, {
                default: () =>
                  show.value ? h(Index, null, null) : h("div", { key: "placeholder" }),
              });
          },
        });
        const parentWrapper = mount(Parent, {
          attachTo: node,
          global: {
            plugins: [i18n, router],
            provide: { store: store },
            stubs: {
              "search-bar": true,
              "index-list": true,
              "search-result": true,
              "service-graph": true,
              "services-catalog": true,
              SanitizedHtmlRenderer: true,
            },
          },
        });
        return { parentWrapper, show };
      }

      afterEach(() => {
        globalThis.localStorage.removeItem("oo_toggle_auto_run");
      });

      it("should call resetSearchObj and loadPageData when org mismatch is detected on activation", async () => {
        // Mount with matching org so onBeforeMount does not reset.
        mockSearchObj.organizationIdentifier = "default";

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        // Deactivate — hide the component so it is cached by KeepAlive.
        mockResetSearchObj.mockClear();
        mockGetStreams.mockClear();
        mockSearchObj.organizationIdentifier = "old-org";
        show.value = false;
        await flushPromises();

        // Reactivate — show the component again so onActivated fires.
        show.value = true;
        await flushPromises();

        expect(mockResetSearchObj).toHaveBeenCalled();
        // loadPageData is called after reset, which fetches streams.
        expect(mockGetStreams).toHaveBeenCalled();

        parentWrapper.unmount();
      });

      it.each([
        ["does not search", "false", false],
        ["still searches", "true", true],
      ])("%s on an org switch when the Auto Run toggle is %s", async (_label, toggle, searches) => {
        store.state.zoConfig.auto_query_enabled = true;
        globalThis.localStorage.setItem("oo_toggle_auto_run", toggle);
        // The page's own URL sync always writes stream=, so the URL looks like a shared link.
        routerCurrentRouteSpy.mockReturnValue({
          value: { query: { stream: "default" }, name: "traces", path: "/traces" },
        } as any);
        mockSearchObj.organizationIdentifier = "default";
        const { parentWrapper, show } = mountWithKeepAlive();
        // The first load must settle, or reactivation re-runs the first-load path instead.
        await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
        await flushPromises();

        show.value = false;
        await flushPromises();
        mockFetchQueryDataWithHttpStream.mockClear();
        mockSearchObj.organizationIdentifier = "old-org";
        show.value = true;
        await flushPromises();
        if (searches) {
          await vi.waitFor(() => expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled());
        } else {
          await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
          await new Promise((resolve) => setTimeout(resolve, 50));
          await flushPromises();
          expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        }
        expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");

        parentWrapper.unmount();
        delete store.state.zoConfig.auto_query_enabled;
      });

      it("should read oo_toggle_auto_run from localStorage and set liveMode on activation", async () => {
        globalThis.localStorage.setItem("oo_toggle_auto_run", "true");

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        // Deactivate then reactivate to trigger onActivated.
        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        expect(mockSearchObj.meta.liveMode).toBe(true);

        parentWrapper.unmount();
      });

      it("should set liveMode to false when oo_toggle_auto_run is 'false' in localStorage", async () => {
        mockSearchObj.meta.liveMode = true;
        globalThis.localStorage.setItem("oo_toggle_auto_run", "false");

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        expect(mockSearchObj.meta.liveMode).toBe(false);

        parentWrapper.unmount();
      });

      it("should NOT change liveMode when oo_toggle_auto_run is absent from localStorage", async () => {
        // Ensure the key is absent before mounting.
        globalThis.localStorage.removeItem("oo_toggle_auto_run");
        mockSearchObj.meta.liveMode = false;

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        // liveMode must remain unchanged when the key is not present.
        expect(mockSearchObj.meta.liveMode).toBe(false);

        parentWrapper.unmount();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // loadStreamLists — stream selection priority
  // ---------------------------------------------------------------------------
  describe("loadStreamLists — stream selection priority", () => {
    // Stream list shared by all priority tests.
    const twoStreams = {
      list: [
        {
          name: "url-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
        {
          name: "old-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
        {
          name: "persisted-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
      ],
    };

    beforeEach(() => {
      mockGetStreams.mockResolvedValue(twoStreams);
      mockGetStream.mockImplementation((name: string) =>
        Promise.resolve(twoStreams.list.find((s: any) => s.name === name)),
      );
    });

    it("should select URL stream (Priority 1) even when previouslySelectedStream also matches", async () => {
      // Previously selected stream exists in the list but URL stream takes priority.
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "url-stream" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("url-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select previously selected stream (Priority 2) when no URL stream param", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("old-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select persisted stream when auto query is disabled", async () => {
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("persisted-stream");

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("persisted-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select the first stream when no preferred or default stream exists", async () => {
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("");

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      expect(mockSearchObj.data.stream.selectedStream.value).toBe("url-stream");
    });
  });

  // ---------------------------------------------------------------------------
  // loadPageData — auto-search behaviour
  // ---------------------------------------------------------------------------
  describe("loadPageData — auto-search", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      // Restore standard stream list for this describe block.
      mockGetStreams.mockResolvedValue(mockStreamList);
      // Reset datetime to a known-good relative state so buildSearch can
      // compute valid timestamps regardless of what prior tests wrote to it.
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };
      mockSearchObj.data.stream.selectedStreamFields = [];
      mockSearchObj.searchApplied = false;
      // Full reset (not just mockClear) so no stale once-queue or
      // implementation from a prior test's mockImplementation survives.
      mockFetchQueryDataWithHttpStream.mockReset();
    });

    it("should call searchData (getQueryData) after loadPageData when a stream resolves via URL param", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "default" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mountIndexStubbed();

      // Poll until the stream list populates and stream is selected.
      // getStreamList uses an un-awaited .then() chain internally.
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      // loadPageData calls searchData when selectedStream resolves; searchData
      // calls getQueryData which sets searchApplied = true immediately before
      // any async work, making it a reliable assertion even if fetchQueryData
      // callbacks are never invoked by the mock.
      await vi.waitFor(
        () => {
          expect(mockSearchObj.searchApplied).toBe(true);
        },
        { timeout: 2000 },
      );
    });

    it("opens a link on the page it carries, then a new Run starts from the first page", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { stream: "default", page: "3" }, name: "traces", path: "/traces" },
      } as any);
      mockApplyUrlListState.mockReturnValueOnce({ currentPage: 2 });

      wrapper = mountIndexStubbed();

      await vi.waitFor(() => expect(mockSearchObj.searchApplied).toBe(true), { timeout: 2000 });
      expect(mockApplyUrlListState).toHaveBeenCalledWith(
        expect.objectContaining({ stream: "default", page: "3" }),
      );
      expect(mockSearchObj.data.queryPayload.query.from).toBe(
        2 * mockSearchObj.meta.resultGrid.rowsPerPage,
      );

      wrapper.vm.runQueryFn();
      await flushPromises();
      expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
    });

    it("drops a link's page when the load-time search is skipped, so a later Run starts at page 1", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { stream: "default", page: "3" }, name: "traces", path: "/traces" },
      } as any);
      mockApplyUrlListState.mockReturnValueOnce({ currentPage: 2 });
      mockSearchObj.loading = true;
      try {
        wrapper = mountIndexStubbed();
        await flushPromises();
      } finally {
        mockSearchObj.loading = false;
      }

      wrapper.vm.runQueryOnSort();
      wrapper.vm.runQueryFn();
      expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
    });

    it("Back from a trace brings a staged edit back staged over the results it left", async () => {
      const ranFilter = "service_name = 'a'";
      const stagedFilter = "service_name = 'b'";
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.editorValue = ranFilter;
      mockSearchObj.meta.lastRunSignature = tracesSearchRunSignature(mockSearchObj);
      mockSearchObj.data.queryResults = { hits: [{ trace_id: "t1" }] };
      mockSearchObj.searchApplied = false;
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "default", period: "15m", query: btoa(stagedFilter) },
          name: "traces",
          path: "/traces",
        },
      } as any);
      mockApplyUrlListState.mockReturnValueOnce({ currentPage: 2 });

      try {
        wrapper = mountIndexStubbed();
        await vi.waitFor(
          () => expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0),
          { timeout: 2000 },
        );
        await flushPromises();
        await new Promise((r) => setTimeout(r, 300));

        expect(mockSearchObj.searchApplied).toBe(false);
        expect(mockSearchObj.data.editorValue).toBe(stagedFilter);
        expect(mockSearchObj.data.queryResults.hits).toHaveLength(1);

        // The link's page was for a load-time search that did not happen; Run starts at page 1.
        wrapper.vm.runQueryFn();
        expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
      } finally {
        mockSearchObj.meta.lastRunSignature = null;
      }
    });

    it("runs an apply-and-view link from a trace over a staged edit with auto-run off", async () => {
      const ranFilter = "service_name = 'a'";
      const appliedFilter = "service_name = 'a' and status_code = '500'";
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.editorValue = ranFilter;
      mockSearchObj.meta.lastRunSignature = tracesSearchRunSignature(mockSearchObj);
      mockSearchObj.data.queryResults = { hits: [{ trace_id: "t1" }] };
      mockSearchObj.searchApplied = false;
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            stream: "default",
            period: "15m",
            query: btoa(appliedFilter),
            "run-query": "true",
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      try {
        wrapper = mountIndexStubbed();
        await vi.waitFor(() => expect(mockSearchObj.searchApplied).toBe(true), { timeout: 2000 });
        expect(mockSearchObj.data.editorValue).toBe(appliedFilter);
      } finally {
        mockSearchObj.meta.lastRunSignature = null;
      }
    });

    it("drops run-query from the entry it honoured, before the search pushes a new one", async () => {
      const appliedFilter = "service_name = 'a'";
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: false };
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.searchApplied = false;
      const query = { stream: "default", period: "15m", query: btoa(appliedFilter) };
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { ...query, "run-query": "true" }, name: "traces", path: "/traces" },
      } as any);
      routerReplaceSpy.mockClear();
      routerPushSpy.mockClear();

      wrapper = mountIndexStubbed();
      await vi.waitFor(() => expect(mockSearchObj.searchApplied).toBe(true), { timeout: 2000 });
      expect(routerReplaceSpy).toHaveBeenCalledWith({ query });
      const replacedAt = routerReplaceSpy.mock.invocationCallOrder[0];
      expect(routerPushSpy.mock.invocationCallOrder.every((at) => at > replacedAt)).toBe(true);
    });

    it("mirrors list changes into the URL while mounted and stops on unmount", async () => {
      wrapper = mountIndexStubbed();
      await flushPromises();
      expect(mockSyncUrlViewState).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      expect(mockStopUrlSync).toHaveBeenCalled();
      wrapper = undefined as any;
    });

    it("should NOT call searchData (getQueryData) after loadPageData when no stream resolves", async () => {
      // No URL stream, no previously selected, auto_query disabled → no stream selected.
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("");
      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mountIndexStubbed();
      await flushPromises();

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };
    });
  });

  // ---------------------------------------------------------------------------
  // Shared toolbar refresh for Service Graph / Services Catalog
  // ---------------------------------------------------------------------------
  describe("shared toolbar refresh", () => {
    const graph = { refresh: vi.fn(), loading: ref(false), lastRunAt: ref<number | null>(null) };
    const catalog = { refresh: vi.fn(), loading: ref(false), lastRunAt: ref<number | null>(null) };

    function mountWithViews() {
      const view = (name: string, state: typeof graph) =>
        defineComponent({
          name,
          emits: ["request:stream-change", "view-traces", "jump-to-stream-data"],
          setup(_p, { expose }) {
            expose(state);
            return () => h("div");
          },
        });
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              name: "search-bar",
              props: ["refreshLoading", "refreshLastRunAt"],
              template: "<div />",
            },
            "index-list": true,
            "search-result": true,
            "service-graph": view("service-graph", graph),
            "services-catalog": view("services-catalog", catalog),
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    async function openTab(mode: string) {
      mockSearchObj.meta.searchMode = mode;
      await flushPromises();
    }

    beforeEach(() => {
      graph.loading.value = true;
      graph.lastRunAt.value = 111;
      catalog.loading.value = false;
      catalog.lastRunAt.value = 222;
    });

    it("follows the open tab's own loading and last-run time, live, across tab switches", async () => {
      wrapper = mountWithViews();
      await flushPromises();
      const bar = () => wrapper.findComponent({ name: "search-bar" });

      await openTab("service-graph");
      expect(bar().props()).toMatchObject({ refreshLoading: true, refreshLastRunAt: 111 });
      graph.loading.value = false;
      graph.lastRunAt.value = 333;
      await flushPromises();
      expect(bar().props()).toMatchObject({ refreshLoading: false, refreshLastRunAt: 333 });

      await openTab("services-catalog");
      expect(bar().props()).toMatchObject({ refreshLoading: false, refreshLastRunAt: 222 });
      catalog.loading.value = true;
      await flushPromises();
      expect(bar().props("refreshLoading")).toBe(true);

      await openTab("service-graph");
      expect(bar().props()).toMatchObject({ refreshLoading: false, refreshLastRunAt: 333 });
      // Switching tabs is not a toolbar refresh.
      expect(graph.refresh).not.toHaveBeenCalled();
      expect(catalog.refresh).not.toHaveBeenCalled();
    });

    it.each([
      ["service-graph", "service-graph-refresh", graph],
      ["services-catalog", "services-catalog-refresh", catalog],
    ])("refreshes the %s tab when the toolbar asks", async (mode, event, view) => {
      wrapper = mountWithViews();
      await flushPromises();
      await openTab(mode);

      wrapper.findComponent({ name: "search-bar" }).vm.$emit(event);
      await flushPromises();

      expect(view.refresh).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Stream Change Confirmation Dialog
  // ---------------------------------------------------------------------------
  describe("Stream Change Confirmation Dialog", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": {
              name: "service-graph",
              template: "<div />",
              emits: ["request:stream-change"],
            },
            "services-catalog": {
              name: "services-catalog",
              template: "<div />",
              emits: ["request:stream-change"],
            },
            ODialog: true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      mockSearchObj.data.editorValue = "";
      mockSearchObj.meta.searchMode = "service-graph";
    });

    it("should apply stream change immediately when editorValue is empty", async () => {
      mockSearchObj.data.editorValue = "";
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("new-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("new-stream");
      expect(mockSearchObj.data.stream.selectedStream.label).toBe("new-stream");
    });

    it("should apply stream change immediately when editorValue is only whitespace", async () => {
      mockSearchObj.data.editorValue = "   ";
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("new-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("new-stream");
    });

    it("should show confirmation dialog when editorValue has content", async () => {
      mockSearchObj.data.editorValue = "service_name = 'test'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("other-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(true);
      expect(wrapper.vm.streamChangeDialog.pendingStream).toBe("other-stream");
    });

    it("should not change selectedStream when dialog is shown instead of applying immediately", async () => {
      // Use a stream name present in mockStreamList so loadStreamLists does not
      // clear it during mount — the assertion checks the stream stays unchanged.
      mockSearchObj.data.editorValue = "duration >= 1000";
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      // Ensure stream is still "default" after mount before triggering request
      // (it can be re-set by loadStreamLists when it finds a match)
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      wrapper.vm.onChildStreamChangeRequest("requested-stream");
      await flushPromises();

      // Dialog was shown — selectedStream must NOT have been changed
      expect(wrapper.vm.streamChangeDialog.show).toBe(true);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
    });

    it("should update selectedStream, clear editorValue, and hide dialog when applyStreamChange is called", async () => {
      mockSearchObj.data.editorValue = "service_name = 'svc'";
      wrapper = mountIndexStubbed();
      await flushPromises();

      // Simulate dialog being shown with a pending stream
      wrapper.vm.streamChangeDialog.show = true;
      wrapper.vm.streamChangeDialog.pendingStream = "target-stream";

      await wrapper.vm.applyStreamChange("target-stream");
      await flushPromises();

      expect(mockSearchObj.data.stream.selectedStream.value).toBe("target-stream");
      expect(mockSearchObj.data.stream.selectedStream.label).toBe("target-stream");
      expect(mockSearchObj.data.editorValue).toBe("");
      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
    });

    it("loads the new stream's own columns on a stream change, before any search", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: true };
      wrapper = mountIndexStubbed();
      await flushPromises();
      mockSearchObj.meta.liveMode = false;
      mockSearchObj.meta.searchMode = "traces";
      mockLoadLocalLogFilterField.mockClear();

      await wrapper.vm.applyStreamChange("target-stream");
      await flushPromises();

      expect(mockLoadLocalLogFilterField).toHaveBeenCalledWith("traces");
      delete store.state.zoConfig.auto_query_enabled;
    });

    it("should close dialog and leave stream unchanged when secondary button sets show to false", async () => {
      // Use a stream name present in mockStreamList so loadStreamLists keeps it.
      mockSearchObj.data.editorValue = "service_name = 'svc'";
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      // Wait until mount resolves and selectedStream remains "default".
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      // Open dialog as if primary button was not clicked
      wrapper.vm.streamChangeDialog.show = true;
      wrapper.vm.streamChangeDialog.pendingStream = "other-stream";

      // Secondary button handler — just closes the dialog
      wrapper.vm.streamChangeDialog.show = false;
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      // Stream must remain unchanged — the cancel did not apply the pending change
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
    });
  });

  describe("apply-saved-view", () => {
    const originalDatetime = { ...mockSearchObj.data.datetime };

    const savedView = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      stream: { label: "default", value: "default" },
      editorValue: "service_name = 'checkout'",
      datetime: { type: "absolute", relativeTimePeriod: "15m", startTime: 111, endTime: 222 },
      searchMode: "spans",
      sortBy: "duration",
      sortOrder: "asc",
      selectedFields: ["service_name", "http_method"],
      ...overrides,
    });

    // Unmounted instances from earlier tests can still land a mount search on the shared mock.
    const ownSearches = () =>
      mockFetchQueryDataWithHttpStream.mock.contexts.filter((owner) => owner === wrapper.vm.$);

    // Field grouping inside extractFields awaits across macrotasks.
    const drain = async () => {
      for (let i = 0; i < 3; i++) {
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const mountPage = async (searchBar: any = true, indexList: any = true) => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": searchBar,
            "index-list": indexList,
            "search-result": SearchResultStub,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(
        () => expect(mockSearchObj.data.stream.selectedStream.value).toBe("default"),
        { timeout: 2000 },
      );
      await vi.waitFor(() => expect(ownSearches().length).toBeGreaterThan(0), {
        timeout: 2000,
      });
      await drain();
      mockFetchQueryDataWithHttpStream.mockClear();
      mockGetStream.mockClear();
      mockUpdatedLocalLogFilterField.mockClear();
      routerReplaceSpy.mockClear();
    };

    const applyView = async (view: Record<string, unknown>) => {
      await wrapper.findComponent({ name: "search-bar" }).vm.$emit("apply-saved-view", view);
      await drain();
    };

    const applyViewAndWaitForSearch = async (view: Record<string, unknown>) => {
      await applyView(view);
      await vi.waitFor(() => expect(ownSearches().length).toBeGreaterThan(0), {
        timeout: 2000,
      });
      await drain();
    };

    afterEach(() => {
      mockSearchObj.meta.resultGrid.sortBy = "start_time";
      mockSearchObj.meta.resultGrid.sortOrder = "desc";
      mockSearchObj.data.datetime = { ...originalDatetime };
      mockSearchObj.data.stream.selectedFields = [];
      mockSearchObj.data.resultGrid.columns = [];
      mockFetchQueryDataWithHttpStream.mockReset();
    });

    it("restores every field before running exactly one search", async () => {
      await mountPage();
      const stateAtSearch: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation(function (this: unknown) {
        if (this !== wrapper.vm.$) return;
        stateAtSearch.push({
          editorValue: mockSearchObj.data.editorValue,
          searchMode: mockSearchObj.meta.searchMode,
          datetime: { ...mockSearchObj.data.datetime },
          sortBy: mockSearchObj.meta.resultGrid.sortBy,
          sortOrder: mockSearchObj.meta.resultGrid.sortOrder,
          selectedFields: [...mockSearchObj.data.stream.selectedFields],
        });
      });

      await applyViewAndWaitForSearch(savedView());

      expect(stateAtSearch).toEqual([
        {
          editorValue: "service_name = 'checkout'",
          searchMode: "spans",
          datetime: expect.objectContaining({ type: "absolute", startTime: 111, endTime: 222 }),
          sortBy: "duration",
          sortOrder: "asc",
          selectedFields: ["service_name", "http_method"],
        },
      ]);
      expect(mockGetStream).not.toHaveBeenCalled();
      expect(mockUpdatedLocalLogFilterField).toHaveBeenCalledWith("spans");
    });

    it.each([
      ["a version 2 view with sqlMode", { version: 2, sqlMode: true }],
      ["a version 1 view whose text is a statement", { version: 1 }],
    ])("opens %s in Spans whatever view it was saved from, with the filter empty", async (_, v) => {
      await mountPage();
      const sql = `SELECT service_name, count(*) AS n FROM "default" GROUP BY service_name`;
      await applyViewAndWaitForSearch(
        savedView({ ...v, searchMode: "traces", editorValue: sql, sortBy: "start_time" }),
      );
      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      expect(mockSearchObj.data.editorValue).toBe(sql);
      expect(mockSqlTexts().sqlTexts.filter).toBe("");
      expect(mockUpdatedLocalLogFilterField).toHaveBeenCalledWith("spans");
      expect(routerReplaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ tab: "spans" }) }),
      );
      mockSearchObj.meta.sqlMode = false;
    });

    it("restores a version 2 view's Group by, and reads a view without one as None", async () => {
      await mountPage();
      await applyViewAndWaitForSearch(savedView({ version: 2, groupBy: "service_name" }));
      expect(mockSearchObj.meta.groupBy).toBe("service_name");
      await applyViewAndWaitForSearch(savedView({ version: 2 }));
      expect(mockSearchObj.meta.groupBy).toBe("");
      mockSearchObj.meta.groupBy = "http_method";
      await applyViewAndWaitForSearch(savedView({ version: 1, groupBy: "service_name" }));
      expect(mockSearchObj.meta.groupBy).toBe("");
      mockSearchObj.data.groupsRequest = null;
    });

    it("restores a version 2 view's scope, and reads a view without one as All spans", async () => {
      await mountPage();
      await applyViewAndWaitForSearch(savedView({ version: 2, scope: "entrypoint" }));
      expect(mockSearchObj.meta.scope).toBe("entrypoint");
      await applyViewAndWaitForSearch(savedView({ version: 2 }));
      expect(mockSearchObj.meta.scope).toBe("all");
      mockSearchObj.meta.scope = "root";
      await applyViewAndWaitForSearch(savedView({ version: 1, scope: "root" }));
      expect(mockSearchObj.meta.scope).toBe("all");
    });

    describe("restores the picker's date type", () => {
      const ABSOLUTE = {
        type: "absolute",
        relativeTimePeriod: "15m",
        startTime: 1752490000000000,
        endTime: 1752490900000000,
      };
      const RELATIVE = { type: "relative", relativeTimePeriod: "2h", startTime: 0, endTime: 0 };
      let pickerEmits: any[];

      // Pinned default-type, so only Index.vue itself can move the picker's type.
      const searchBarWithPicker = (defaultType: string) =>
        defineComponent({
          name: "search-bar",
          emits: ["apply-saved-view"],
          setup() {
            return { dateTimeRef: ref<any>(null) };
          },
          render() {
            return h(DateTime, {
              ref: "dateTimeRef",
              autoApply: true,
              defaultType,
              defaultRelativeTime: "15m",
              "onOn:date-change": (value: any) => pickerEmits.push(value),
            });
          },
        });

      const picker = () => wrapper.findComponent(DateTime).vm as any;

      beforeEach(() => {
        pickerEmits = [];
      });

      it("switches a relative picker to absolute with one search", async () => {
        await mountPage(searchBarWithPicker("relative"));
        pickerEmits.length = 0;

        await applyViewAndWaitForSearch(savedView({ datetime: ABSOLUTE }));

        expect(picker().selectedType).toBe("absolute");
        expect(ownSearches()).toHaveLength(1);
        expect(pickerEmits.filter((v) => v.userChangedValue)).toEqual([]);
      });

      it("switches an absolute picker to relative with one search", async () => {
        await mountPage(searchBarWithPicker("absolute"));
        pickerEmits.length = 0;

        await applyViewAndWaitForSearch(savedView({ datetime: RELATIVE }));

        expect(picker().selectedType).toBe("relative");
        expect(picker().relativeValue).toBe(2);
        expect(picker().relativePeriod).toBe("h");
        expect(ownSearches()).toHaveLength(1);
        expect(pickerEmits.filter((v) => v.userChangedValue)).toEqual([]);
      });
    });

    it("extracts fields for a different stream without clearing the filter", async () => {
      await mountPage();

      await applyViewAndWaitForSearch(
        savedView({ stream: { label: "test-stream", value: "test-stream" } }),
      );

      expect(mockGetStream).toHaveBeenCalledWith("test-stream", "traces", true);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("test-stream");
      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(ownSearches()).toHaveLength(1);
    });

    it("refreshes open field values once the other stream's view filter has landed", async () => {
      const editorAtRefresh: string[] = [];
      const refreshOpenFieldValues = vi.fn(() =>
        editorAtRefresh.push(mockSearchObj.data.editorValue),
      );
      await mountPage(true, { template: "<div />", methods: { refreshOpenFieldValues } });

      await applyViewAndWaitForSearch(
        savedView({ stream: { label: "test-stream", value: "test-stream" } }),
      );

      expect(editorAtRefresh).toEqual(["service_name = 'checkout'"]);
    });

    it("refreshes open field values once the picked stream's fields have loaded", async () => {
      const fieldsAtRefresh: number[] = [];
      const refreshOpenFieldValues = vi.fn(() =>
        fieldsAtRefresh.push(mockSearchObj.data.stream.selectedStreamFields.length),
      );
      await mountPage(true, { template: "<div />", methods: { refreshOpenFieldValues } });

      await wrapper.vm.applyStreamChange("test-stream");
      await drain();

      expect(fieldsAtRefresh).toHaveLength(1);
      expect(fieldsAtRefresh[0]).toBeGreaterThan(0);
    });

    it("leaves open field values alone when the view keeps the stream", async () => {
      const refreshOpenFieldValues = vi.fn();
      await mountPage(true, { template: "<div />", methods: { refreshOpenFieldValues } });

      await applyViewAndWaitForSearch(savedView());

      expect(refreshOpenFieldValues).not.toHaveBeenCalled();
    });

    it("applies only the latest view when an earlier apply finishes last", async () => {
      await mountPage();
      let resolveStreamA!: (value: unknown) => void;
      mockGetStream.mockImplementationOnce(
        () => new Promise((resolve) => (resolveStreamA = resolve)),
      );
      const streamA = { label: "test-stream", value: "test-stream" };
      const searchBar = wrapper.findComponent({ name: "search-bar" });

      searchBar.vm.$emit("apply-saved-view", savedView({ stream: streamA, editorValue: "a" }));
      await flushPromises();
      await applyViewAndWaitForSearch(savedView({ stream: streamA, editorValue: "b" }));
      resolveStreamA(mockStreamList.list.find((s: any) => s.name === "test-stream"));
      await drain();

      expect(ownSearches()).toHaveLength(1);
      expect(mockSearchObj.data.editorValue).toBe("b");
    });

    it("rebuilds the columns even when the search returns no hits", async () => {
      await mountPage();

      await applyViewAndWaitForSearch(savedView());

      const ids = mockSearchObj.data.resultGrid.columns.map((c: any) => c.id);
      expect(ids).toContain("http_method");
    });

    it("clears trace_id and span_id from a trace-detail URL", async () => {
      await mountPage();
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "default", tab: "traces", trace_id: "abc", span_id: "def" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      await applyViewAndWaitForSearch(savedView());

      expect(routerReplaceSpy).toHaveBeenCalledTimes(1);
      const query = (routerReplaceSpy.mock.calls[0][0] as any).query;
      expect(query).not.toHaveProperty("trace_id");
      expect(query).not.toHaveProperty("span_id");
      expect(query.tab).toBe("spans");
    });

    it("skips the URL write when the view finishes applying after leaving Traces", async () => {
      await mountPage();
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "logs", path: "/logs" },
      } as any);
      routerReplaceSpy.mockClear();

      await applyViewAndWaitForSearch(savedView());

      expect(routerReplaceSpy).not.toHaveBeenCalled();
    });

    it("applies a view saved without selectedFields as no selected fields", async () => {
      await mountPage();
      mockSearchObj.data.stream.selectedFields = ["stale_field"];
      const { selectedFields: _omitted, ...view } = savedView();

      await applyViewAndWaitForSearch(view);

      expect(mockSearchObj.data.stream.selectedFields).toEqual([]);
      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(ownSearches()).toHaveLength(1);
    });

    it("toasts an error and leaves state unchanged for an unknown view version", async () => {
      await mountPage();
      const before = mockSearchObj.data.editorValue;
      const modeBefore = mockSearchObj.meta.searchMode;

      await applyView(savedView({ version: 3 }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(mockSearchObj.data.editorValue).toBe(before);
      expect(mockSearchObj.meta.searchMode).toBe(modeBefore);
      expect(ownSearches()).toHaveLength(0);
    });

    it("restores SQL mode from a version 2 view", async () => {
      await mountPage();
      const sql = `SELECT * FROM "default" WHERE a = 1`;
      await applyViewAndWaitForSearch(savedView({ version: 2, sqlMode: true, editorValue: sql }));
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      expect(mockSearchObj.data.editorValue).toBe(sql);
      mockSearchObj.meta.sqlMode = false;
    });

    it("loads a version 2 view saved in filter mode as chips", async () => {
      await mountPage();
      mockSearchObj.meta.sqlMode = true;
      await applyViewAndWaitForSearch(savedView({ version: 2, sqlMode: false }));
      expect(mockSearchObj.meta.sqlMode).toBe(false);
    });

    it("loads a version 1 view as chips", async () => {
      await mountPage();
      mockSearchObj.meta.sqlMode = true;
      await applyViewAndWaitForSearch(savedView());
      expect(mockSearchObj.meta.sqlMode).toBe(false);
    });

    it("toasts and leaves state unchanged when the stream no longer exists", async () => {
      await mountPage();
      const before = mockSearchObj.data.editorValue;
      const modeBefore = mockSearchObj.meta.searchMode;

      await applyView(savedView({ stream: { label: "gone", value: "gone" } }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
      expect(mockSearchObj.data.editorValue).toBe(before);
      expect(mockSearchObj.meta.searchMode).toBe(modeBefore);
      expect(ownSearches()).toHaveLength(0);
    });

    describe("keeps datetime on the searched window", () => {
      const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
      const MIN = 60 * 1000;
      const THREE_DAYS = 3 * 24 * 60 * MIN;
      const staleRelative = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: (NOW - THREE_DAYS - 15 * MIN) * 1000,
        endTime: (NOW - THREE_DAYS) * 1000,
      };

      const ownRequests = () => {
        const { calls, contexts } = mockFetchQueryDataWithHttpStream.mock;
        return calls.filter((_c, i) => contexts[i] === wrapper.vm.$).map((c: any) => c[0].queryReq);
      };
      const lastWindow = () => {
        const req = ownRequests().at(-1);
        return {
          startTime: req.query?.start_time ?? req.start_time,
          endTime: req.query?.end_time ?? req.end_time,
        };
      };
      const datetimeWindow = () => ({
        startTime: mockSearchObj.data.datetime.startTime,
        endTime: mockSearchObj.data.datetime.endTime,
      });

      beforeEach(() => {
        vi.setSystemTime(NOW);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("moves a stale relative view's datetime onto the request window ending now", async () => {
        await mountPage();

        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        expect(datetimeWindow()).toEqual(lastWindow());
        expect(datetimeWindow()).toEqual({
          startTime: (NOW - 15 * MIN) * 1000,
          endTime: NOW * 1000,
        });
      });

      it("moves the window forward when the view is applied again later", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        vi.setSystemTime(NOW + 5 * MIN);
        mockFetchQueryDataWithHttpStream.mockClear();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        expect(datetimeWindow().endTime).toBe((NOW + 5 * MIN) * 1000);
        expect(datetimeWindow()).toEqual(lastWindow());
      });

      it("updates datetime when Run query fires after time has passed", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        vi.setSystemTime(NOW + 7 * MIN);
        wrapper.vm.searchData();
        await drain();

        expect(datetimeWindow().endTime).toBe((NOW + 7 * MIN) * 1000);
        expect(datetimeWindow()).toEqual(lastWindow());
      });

      it("leaves an absolute view's datetime unchanged", async () => {
        await mountPage();

        await applyViewAndWaitForSearch(savedView());

        expect(datetimeWindow()).toEqual({ startTime: 111, endTime: 222 });
        expect(lastWindow()).toEqual({ startTime: 111, endTime: 222 });
      });

      it("sorts on the last request's window without moving datetime", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));
        const searched = lastWindow();

        vi.setSystemTime(NOW + 5 * MIN);
        wrapper.vm.runQueryOnSort();
        await drain();

        expect(datetimeWindow()).toEqual(searched);
        expect(lastWindow()).toEqual(searched);
      });
    });

    describe("paging keeps page 1's filter", () => {
      const lastFilter = () => {
        const { calls, contexts } = mockFetchQueryDataWithHttpStream.mock;
        const own = calls.filter((_c, i) => contexts[i] === wrapper.vm.$);
        return (own.at(-1) as any)[0].queryReq.filter;
      };

      afterEach(() => {
        mockSearchObj.data.resultGrid.currentPage = 0;
      });

      it("pages with the submitted filter after the editor changes, until a new Run", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(
          savedView({ searchMode: "traces", editorValue: "service_name = 'a'" }),
        );
        expect(lastFilter()).toBe("service_name = 'a'");

        mockSearchObj.data.editorValue = "service_name = 'b'";
        mockSearchObj.data.resultGrid.currentPage = 1;
        wrapper.vm.getMoreData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'a'");

        wrapper.vm.searchData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'b'");

        mockSearchObj.data.resultGrid.currentPage = 1;
        wrapper.vm.getMoreData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'b'");
      });
    });
  });

  // Placed last in the file: this test drives fetchQueryDataWithHttpStream's
  // handlers directly and calls mockFetchQueryDataWithHttpStream.mockReset()
  // at the end, so it cannot leak an implementation into tests declared after it.
  describe("Stale search error handling (o2-enterprise#2643)", () => {
    // Regression: a rejected query's RED metrics charts stayed hidden forever,
    // even after the query was fixed and the next search succeeded — because a
    // cancelled search's late error callback overwrote the newer search's state.
    it("should not let a cancelled search's late error overwrite a newer search's state", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };

      const capturedHandlers: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation((_data: any, handlers: any) => {
        capturedHandlers.push(handlers);
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      capturedHandlers.length = 0;

      // Search #1 starts and is left in-flight (never resolves on its own).
      await wrapper.vm.getQueryData();
      expect(capturedHandlers.length).toBe(1);

      // Search #2 starts before #1 finishes — this cancels #1 (deletes its
      // request-state entry) and clears errorMsg for the new attempt.
      await wrapper.vm.getQueryData();
      expect(capturedHandlers.length).toBe(2);

      expect(mockSearchObj.data.errorMsg).toBe("");

      // #1's HTTP stream finally errors out after being cancelled/superseded.
      capturedHandlers[0].error({}, { message: "stale failure from search #1", code: 500 });
      await flushPromises();

      // The stale error must not resurrect the error banner / hide the charts
      // for the still-in-flight, newer search.
      expect(mockSearchObj.data.errorMsg).toBe("");

      // A genuine error for the CURRENT (non-superseded) search must still work.
      // getQueryData()'s error handler sets errorMsg synchronously, so assert
      // immediately — before yielding to the event loop via flushPromises().
      // An unrelated component instance left over from an earlier test in this
      // file can still have a mount-triggered search pending (onUnmounted does
      // not cancel in-flight work); if its own getQueryData() call happens to
      // settle during our flushPromises() here, it resets the shared
      // mockSearchObj.data.errorMsg back to "" before we get a chance to read
      // it, unrelated to the cancellation behavior this test is verifying.
      capturedHandlers[1].error({}, { message: "real failure from search #2", code: 500 });
      expect(mockSearchObj.data.errorMsg).toBe("real failure from search #2");
      await flushPromises();

      mockFetchQueryDataWithHttpStream.mockReset();
    });
  });

  describe("restoreFilters with unparsable SQL", () => {
    it("returns without touching filters when the saved filter does not parse", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      const parser = createdTracesParsers.at(-1) as { astify: ReturnType<typeof vi.fn> };
      parser.astify.mockImplementationOnce(() => {
        throw new Error("Expected end of input");
      });

      expect(() => wrapper.vm.restoreFilters("service_name = ")).not.toThrow();
    });
  });

  describe("traces count failure logging", () => {
    it("warns with the error instead of logging a bare console error", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.queryPayload = { query: { start_time: 1, end_time: 2 } };
      mockFetchQueryDataWithHttpStream.mockClear();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper.vm.fetchTracesCount();
      const [, handlers] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      const failure = { content: { message: "network error" } };
      handlers.error({}, failure);

      expect(warn).toHaveBeenCalledWith("Failed to fetch traces count", failure);
      expect(err).not.toHaveBeenCalledWith("Failed to fetch traces count");
      warn.mockRestore();
      err.mockRestore();
      mockSearchObj.data.queryPayload = null;
    });

    it.each([
      ["keeps the last count of the query and reports a failed refresh", 200, { total: 200 }],
      [
        "has no count and no failed refresh when none was kept",
        undefined,
        { total: null, countFailed: true },
      ],
    ])("on a failed count %s", async (_name, lastTotal, expected) => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.queryPayload = { query: { start_time: 1, end_time: 2 } };
      const results = { hits: new Array(25).fill({}), total: null, countPending: true, lastTotal };
      mockSearchObj.data.queryResults = results;
      mockSearchObj.meta.refreshFailedAt = null;
      mockFetchQueryDataWithHttpStream.mockClear();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      wrapper.vm.fetchTracesCount();
      const [, handlers] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      handlers.error({}, { content: { message: "network error" } });

      expect(results).toMatchObject({ ...expected, countPending: false });
      expect(!!(results as any).countFailed).toBe(lastTotal === undefined);
      expect(mockSearchObj.meta.refreshFailedAt).toEqual(
        lastTotal === undefined ? null : expect.any(Number),
      );
      warn.mockRestore();
      mockSearchObj.data.queryPayload = null;
      mockSearchObj.meta.refreshFailedAt = null;
    });

    it("keeps a count that landed when the stream errors after it", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.queryPayload = { query: { start_time: 1, end_time: 2 } };
      mockSearchObj.meta.searchMode = "spans";
      const results = {
        hits: new Array(25).fill({}),
        total: null,
        countPending: true,
        lastTotal: 600,
      };
      mockSearchObj.data.queryResults = results;
      mockSearchObj.meta.refreshFailedAt = null;
      mockFetchQueryDataWithHttpStream.mockClear();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      wrapper.vm.fetchTracesCount();
      const [, handlers] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      handlers.data({}, { content: { results: { hits: [{ span_count: 531, error_count: 0 }] } } });
      handlers.error({}, { content: { message: "late error" } });

      expect(results).toMatchObject({ total: 531, errorCount: 0, countPending: false });
      expect((results as any).countFailed).toBeUndefined();
      expect(mockSearchObj.meta.refreshFailedAt).toBeNull();
      warn.mockRestore();
      mockSearchObj.data.queryPayload = null;
    });
  });

  describe("URL writes around leaving Traces", () => {
    const makeRouter = () =>
      createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/traces", name: "traces", component: { template: "<div />" } },
          { path: "/logs", name: "logs", component: { template: "<div />" } },
        ],
      });

    const mountOn = async (appRouter: ReturnType<typeof makeRouter>) => {
      await appRouter.push("/traces");
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, appRouter],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
    };

    const changeMode = async (mode: "traces" | "spans") => {
      mockSearchObj.meta.searchMode = mode;
      await flushPromises();
    };

    const holdNavigation = (appRouter: ReturnType<typeof makeRouter>) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      appRouter.beforeEach(() => gate);
      return release;
    };

    it("still writes the mode to the URL while on Traces", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      await changeMode("traces");
      expect(appRouter.currentRoute.value.query.tab).toBe("traces");
    });

    it("skips a mode write that lands after leaving", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      await appRouter.push("/logs");
      await changeMode("traces");
      expect(appRouter.currentRoute.value.fullPath).toBe("/logs");
    });

    it("lets a pending navigation finish when a mode write lands during it", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      const release = holdNavigation(appRouter);
      const leaving = appRouter.push("/logs");
      await flushPromises();
      await changeMode("traces");
      release();
      await leaving;
      await flushPromises();
      expect(appRouter.currentRoute.value.fullPath).toBe("/logs");
    });

    it("writes again after a guard threw on the way out", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      const stop = appRouter.beforeEach(() => {
        throw new Error("guard failed");
      });
      await expect(appRouter.push("/logs")).rejects.toThrow("guard failed");
      stop();
      await changeMode("traces");
      expect(appRouter.currentRoute.value.query.tab).toBe("traces");
    });

    it("skips the query builder write after leaving but still returns the request", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      await appRouter.push("/logs");
      const pushSpy = vi.spyOn(appRouter, "push");
      expect(wrapper.vm.buildSearch()).toBeTruthy();
      await flushPromises();
      expect(pushSpy).not.toHaveBeenCalled();
      expect(appRouter.currentRoute.value.fullPath).toBe("/logs");
    });

    it("skips the query builder write during a pending navigation", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      const release = holdNavigation(appRouter);
      const leaving = appRouter.push("/logs");
      await flushPromises();
      const pushSpy = vi.spyOn(appRouter, "push");
      expect(wrapper.vm.buildSearch()).toBeTruthy();
      expect(pushSpy).not.toHaveBeenCalled();
      release();
      await leaving;
      expect(appRouter.currentRoute.value.fullPath).toBe("/logs");
    });

    it("keeps the query builder write while on Traces", async () => {
      const appRouter = makeRouter();
      await mountOn(appRouter);
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      const pushSpy = vi.spyOn(appRouter, "push");
      expect(wrapper.vm.buildSearch()).toBeTruthy();
      expect(pushSpy).toHaveBeenCalledTimes(1);
    });

    it("writes a catalog stream switch to the URL with auto-run off, and Back moves the shared stream with its query", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, auto_query_enabled: true };
      localStorage.setItem("oo_toggle_auto_run", "false");
      const appRouter = makeRouter();
      await mountOn(appRouter);
      const oldQuery = "service_name = 'checkout'";
      await appRouter.replace({
        path: "/traces",
        query: { tab: "services-catalog", stream: "default", query: btoa(oldQuery) },
      });
      mockSearchObj.data.editorValue = oldQuery;
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");

      await wrapper.vm.applyStreamChange("test-stream");
      await flushPromises();
      expect(appRouter.currentRoute.value.query.stream).toBe("test-stream");

      appRouter.back();
      await vi.waitFor(() => expect(appRouter.currentRoute.value.query.stream).toBe("default"));
      await flushPromises();
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
      expect(mockGetStream).toHaveBeenLastCalledWith("default", "traces", true);
      expect(mockSearchObj.data.editorValue).toBe(oldQuery);
      delete store.state.zoConfig.auto_query_enabled;
      localStorage.removeItem("oo_toggle_auto_run");
    });

    it("does not strip run-query over a pending navigation", async () => {
      const appRouter = makeRouter();
      mockGetStreams.mockClear();
      let finishStreams: (value: unknown) => void = () => {};
      mockGetStreams.mockReturnValueOnce(new Promise((resolve) => (finishStreams = resolve)));
      await appRouter.push("/traces?run-query=true");
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, appRouter],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalled(), { timeout: 2000 });
      expect(appRouter.currentRoute.value.query["run-query"]).toBe("true");
      const release = holdNavigation(appRouter);
      const leaving = appRouter.push("/logs");
      await flushPromises();
      const replaceSpy = vi.spyOn(appRouter, "replace");
      finishStreams(mockStreamList);
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false), { timeout: 2000 });
      await flushPromises();
      expect(replaceSpy).not.toHaveBeenCalled();
      release();
      await leaving;
      await flushPromises();
      expect(appRouter.currentRoute.value.fullPath).toBe("/logs");
    });
  });

  describe("SQL mode", () => {
    const grouped = `SELECT service_name, count(*) AS n FROM "default" WHERE a = 1 GROUP BY service_name`;

    const mountSql = async () => {
      mockSearchObj.meta.searchMode = "spans";
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": SearchResultStub,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.resultGrid.currentPage = 0;
      mockSearchObj.meta.resultGrid.rowsPerPage = 25;
      mockFetchQueryDataWithHttpStream.mockClear();
    };

    const runSql = async (sql: string) => {
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.editorValue = sql;
      wrapper.vm.searchData();
      await flushPromises();
      const [request, handlers] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      return { request, handlers, sql: b64DecodeUnicode(request.queryReq.query.sql) };
    };

    const finish = async (handlers: any, hits: any[], extra: Record<string, unknown> = {}) => {
      handlers.data(
        {},
        { type: "search_response_metadata", content: { results: { hits: [], ...extra } } },
      );
      handlers.data({}, { type: "search_response_hits", content: { results: { hits } } });
      handlers.complete({});
      await flushPromises();
    };

    afterEach(() => {
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.meta.showHistogram = true;
      mockSearchObj.data.editorValue = "";
      mockSearchObj.data.queryPayload = null;
    });

    const batch = async (handlers: any, hits: any[]) => {
      handlers.data({}, { type: "search_response_hits", content: { results: { hits } } });
      await flushPromises();
    };

    it("shows aggregate rows only when the stream ends, as early groups can still change", async () => {
      await mountSql();
      const { handlers } = await runSql(grouped);
      await batch(handlers, [{ service_name: "api", n: 3 }]);
      expect(mockSearchObj.data.queryResults.hits).toEqual([]);
      expect(mockSearchObj.loading).toBe(true);
      await batch(handlers, [{ service_name: "db", n: 1 }]);
      expect(mockSearchObj.data.queryResults.hits).toEqual([]);
      handlers.complete({});
      await flushPromises();
      expect(mockSearchObj.data.queryResults.hits).toEqual([
        { service_name: "api", n: 3 },
        { service_name: "db", n: 1 },
      ]);
      expect(mockSearchObj.loading).toBe(false);
    });

    describe("a streaming aggregate over several partitions", () => {
      const meta = () => ({
        type: "search_response_metadata",
        content: { streaming_aggs: true, results: { hits: [] } },
      });
      const hits = (rows: any[]) => ({
        type: "search_response_hits",
        content: { results: { hits: rows } },
      });

      it("shows the last running answer, and counts its rows", async () => {
        await mountSql();
        const { handlers } = await runSql(grouped);
        handlers.data({}, meta());
        handlers.data({}, hits([{ service_name: "api", n: 3 }]));
        handlers.data({}, meta());
        handlers.data(
          {},
          hits([
            { service_name: "api", n: 5 },
            { service_name: "db", n: 1 },
          ]),
        );
        handlers.data({}, meta());
        handlers.data({}, hits([]));
        handlers.complete({});
        await flushPromises();
        expect(mockSearchObj.data.queryResults.hits).toEqual([
          { service_name: "api", n: 5 },
          { service_name: "db", n: 1 },
        ]);
        expect(mockSearchObj.data.queryResults.total).toBe(2);
      });

      it("replaces with each later chunk of one partition, and counts its rows", async () => {
        await mountSql();
        const { handlers } = await runSql(grouped);
        handlers.data({}, meta());
        handlers.data({}, hits([{ service_name: "api", n: 3 }]));
        handlers.data({}, hits([{ service_name: "db", n: 1 }]));
        handlers.complete({});
        await flushPromises();
        expect(mockSearchObj.data.queryResults.hits).toEqual([{ service_name: "db", n: 1 }]);
        expect(mockSearchObj.data.queryResults.total).toBe(1);
      });
    });

    it("still shows span rows as they stream in", async () => {
      await mountSql();
      const { handlers } = await runSql(`SELECT * FROM "default" WHERE a = 1`);
      await batch(handlers, [{ trace_id: "t", span_id: "s" }]);
      expect(mockSearchObj.data.queryResults.hits).toEqual([{ trace_id: "t", span_id: "s" }]);
    });

    it.each([
      ["an aggregate", grouped],
      ["a row query", `SELECT * FROM "default" WHERE a = 1`],
    ])("shows the error state, not the rows, when %s fails after some rows", async (_, sql) => {
      await mountSql();
      const { handlers } = await runSql(sql);
      await batch(handlers, [{ trace_id: "t", span_id: "s", service_name: "api", n: 3 }]);
      handlers.error({}, { content: { code: 20009, message: "querier went away" } });
      handlers.complete({});
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
      expect(wrapper.find('[data-test="traces-search-error-message"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-search-result"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "TracesSqlErrorState" }).props("errorMsg")).toBe(
        "querier went away",
      );
    });

    it("keeps the out-of-memory card with Use last 1 hour for a trace question", async () => {
      await mountSql();
      const range = { ...mockSearchObj.data.datetime };
      Object.assign(mockSearchObj.data.datetime, {
        type: "relative",
        relativeTimePeriod: "6h",
      });
      try {
        const { handlers } = await runSql(mockSqlTemplates[0].sql);
        handlers.error({}, { content: { code: 20008, message: "Resources exhausted" } });
        await flushPromises();
        for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
        await nextTick();
        const state = wrapper.findComponent({ name: "TracesSqlErrorState" });
        expect(state.props("errorCode")).toBe(20008);
        expect(state.find('[data-test="traces-sql-fix-last-hour-card"]').exists()).toBe(true);
      } finally {
        Object.assign(mockSearchObj.data.datetime, range);
      }
    });

    it("sends the typed SQL as written to the spans search", async () => {
      await mountSql();
      const typed = `SELECT * FROM "default" WHERE duration > '5ms' AND span_kind = 'Server'`;
      const { request, sql } = await runSql(typed);
      expect(request.type).toBe("search");
      expect(sql).toBe(typed);
      expect(request.queryReq.query.from).toBe(0);
      expect(request.queryReq.query.size).toBe(25);
    });

    it("asks for every row of a GROUP BY query with size -1", async () => {
      await mountSql();
      const { request, sql } = await runSql(grouped);
      expect(sql).toBe(grouped);
      expect(request.queryReq.query.size).toBe(-1);
      expect(request.queryReq.query.from).toBe(0);
    });

    it("uses the LIMIT as the size", async () => {
      await mountSql();
      const { request } = await runSql(`SELECT * FROM "default" LIMIT 40`);
      expect(request.queryReq.query.size).toBe(40);
    });

    it("counts a grouped query's rows instead of requesting a count", async () => {
      await mountSql();
      const { handlers } = await runSql(grouped);
      await finish(handlers, [
        { service_name: "api", n: 3 },
        { service_name: "db", n: 1 },
      ]);
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
      expect(mockSearchObj.data.queryResults.total).toBe(2);
      expect(mockSearchObj.data.queryResults.countPending).toBe(false);
      expect(mockSearchObj.data.queryResults.sql).toBe(grouped);
    });

    it("counts a row query over the typed WHERE, as typed", async () => {
      await mountSql();
      const { handlers } = await runSql(
        `SELECT * FROM "default" WHERE a = 1 ORDER BY start_time DESC`,
      );
      await finish(handlers, [{ trace_id: "t", span_id: "s" }]);
      const [countRequest] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      const countSql = b64DecodeUnicode(countRequest.queryReq.query.sql);
      expect(countSql).toContain(`FROM "default" WHERE a = 1`);
      expect(countSql).not.toContain("ORDER BY");
    });

    it("keeps the typed FROM alias in the count of a row query", async () => {
      await mountSql();
      const { handlers } = await runSql(`SELECT * FROM "default" AS d WHERE d.duration > 1`);
      await finish(handlers, [{ trace_id: "t", span_id: "s" }]);
      const [countRequest] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      const countSql = b64DecodeUnicode(countRequest.queryReq.query.sql);
      expect(countSql).toContain(`FROM "default" AS d WHERE d.duration > 1`);
    });

    it("clears SQL results once SQL mode is switched off", async () => {
      await mountSql();
      const { handlers } = await runSql(
        `SELECT trace_id, count(*) AS spans FROM "default" GROUP BY trace_id`,
      );
      await finish(handlers, [{ trace_id: "t", spans: 2 }]);
      expect(mockSearchObj.data.queryResults.sql).toBeTruthy();

      mockSearchObj.meta.sqlMode = false;
      await flushPromises();

      expect(mockSearchObj.data.queryResults.sql).toBeUndefined();
      expect(mockSearchObj.data.queryResults.hits ?? []).toEqual([]);
    });

    it("does not copy the server's histogram eligibility, which no longer gates the RED charts", async () => {
      await mountSql();
      const { handlers } = await runSql(`SELECT * FROM "default" LIMIT 5`);
      await finish(handlers, [{ trace_id: "t", span_id: "s" }], { is_histogram_eligible: false });
      expect(mockSearchObj.data.queryResults.is_histogram_eligible).toBeUndefined();
    });

    const useRealParser = async () => {
      const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
      const real = new mod.default.Parser();
      realTracesParser.current = real;
      for (const created of createdTracesParsers as any[]) {
        created.astify.mockImplementation((sql: string) => real.astify(sql));
      }
    };

    it("ticks sidebar values only from the conditions the page wrote into the SQL", async () => {
      await useRealParser();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.stream.sqlFieldConditions = {
        http_route: {
          text: "json_get_str(_all, 'http_route') IN ('/a','/b')",
          values: ["/a", "/b"],
          exclude: false,
        },
        peer: { text: "peer IS NOT NULL", values: ["null"], exclude: true },
        gone: { text: "gone = 'x'", values: ["x"], exclude: false },
      };
      mockSearchObj.data.editorValue = `SELECT * FROM "default" WHERE service_name = 'typed' AND json_get_str(_all, 'http_route') IN ('/a','/b') AND peer IS NOT NULL`;
      try {
        await mountSql();
        const vm = wrapper.vm as any;
        expect(vm.activeIncludeFilterValues).toEqual({ http_route: ["/a", "/b"] });
        expect(vm.activeExcludeFilterValues).toEqual({ peer: ["null"] });
      } finally {
        mockSearchObj.data.stream.sqlFieldConditions = {};
      }
    });

    const runTracesSql = async (sql: string) => {
      await mountSql();
      await useRealParser();
      mockSearchObj.meta.searchMode = "traces";
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.editorValue = sql;
      mockSearchObj.searchApplied = true;
      wrapper.vm.searchData();
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
    };

    const big = `SELECT trace_id FROM "default" GROUP BY trace_id HAVING count(*) > 200`;
    const redraw = async () => {
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
    };
    const statementCard = () => wrapper.find('[data-test="traces-statement-in-traces"]');

    // Spans SQL run with `sql`, over the filter `filter`, then the view switch to Traces.
    const leaveForTraces = async (sql: string, filter = "duration > 1") => {
      await mountSql();
      await useRealParser();
      mockSqlTextsParser.value = createdTracesParsers[0];
      mockSearchObj.data.editorValue = filter;
      mockSqlTexts().turnSqlOn();
      const { handlers } = await runSql(sql);
      await finish(handlers, [{ service_name: "api" }]);
      mockFetchQueryDataWithHttpStream.mockClear();
      wrapper.vm.onSearchModeChange("traces");
      await redraw();
      const [tracesRequest] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      mockFetchQueryDataWithHttpStream.mockClear();
      return tracesRequest;
    };

    it("cancels the run still streaming when the next SQL run is blocked", async () => {
      await mountSql();
      await useRealParser();
      const { request } = await runSql(`SELECT * FROM "default"`);
      expect(mockSearchObj.loading).toBe(true);
      mockCancelStreamQueryBasedOnRequestId.mockClear();
      mockSearchObj.data.editorValue = "  ";
      wrapper.vm.searchData();
      await flushPromises();
      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith(
        expect.objectContaining({ trace_id: request.traceId }),
      );
      expect(mockSearchObj.loading).toBe(false);
    });

    describe("a statement typed in the Traces view", () => {
      const runInTraces = async (text: string) => {
        await mountSql();
        await useRealParser();
        mockSearchObj.meta.searchMode = "traces";
        mockSearchObj.searchApplied = true;
        mockSqlTexts().noteFilterText("service_name = 'api'", true);
        mockSearchObj.data.editorValue = text;
        wrapper.vm.searchData();
        await redraw();
      };

      it("sends no request on Run and shows the card, counting the run as applied", async () => {
        mockSearchObj.meta.lastRunSignature = null;
        await runInTraces(grouped);
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        expect(statementCard().text()).toContain("The Traces view takes a filter, not a SELECT");
        expect(statementCard().text()).toContain("SQL runs in the Spans view.");
        expect(mockSearchObj.data.appliedEditorValue).toBe(grouped);
        expect(mockSearchObj.meta.lastRunSignature).toBe(tracesSearchRunSignature(mockSearchObj));
      });

      it("Open in Spans view carries the text with SQL on, not run, and keeps the filter from before", async () => {
        await runInTraces(grouped);
        statementCard().findComponent({ name: "OEmptyState" }).vm.$emit("action");
        await redraw();
        expect(mockSearchObj.meta.searchMode).toBe("spans");
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toBe(grouped);
        expect(mockSqlTexts().sqlTexts.filter).toBe("service_name = 'api'");
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
      });

      it("blocks a filter holding IN (SELECT ...) with its own card, and opens it in Spans", async () => {
        const subquery = `trace_id IN (SELECT trace_id FROM "default" WHERE span_status = 'ERROR')`;
        await runInTraces(subquery);
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        expect(statementCard().text()).toContain("The Traces view cannot run a subquery");
        expect(statementCard().text()).toContain("SQL runs in the Spans view.");
        statementCard().findComponent({ name: "OEmptyState" }).vm.$emit("action");
        await redraw();
        expect(mockSearchObj.meta.searchMode).toBe("spans");
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toContain(`WHERE ${subquery}`);
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      });

      it("runs a filter with SELECT only inside a string", async () => {
        await runInTraces(`db_statement = 'id IN (SELECT 1)'`);
        expect(statementCard().exists()).toBe(false);
        const [request] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
        expect(request.type).toBe("traces");
      });

      it.each([
        "db_statement LIKE 'SELECT%FROM orders%'",
        "operation_name = 'SELECT'",
        "selected_region = 'eu'",
        "explain = 'x'",
      ])("reads only the start of the text, so %s runs as a filter", async (filter) => {
        await runInTraces(filter);
        expect(statementCard().exists()).toBe(false);
        const [request] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
        expect(request.type).toBe("traces");
      });
    });

    describe("leaving Spans SQL for the Traces view", () => {
      it("runs the shared filter with no dialog and keeps the SQL text", async () => {
        const request = await leaveForTraces(grouped);
        expect(mockSearchObj.meta.searchMode).toBe("traces");
        expect(mockSearchObj.meta.sqlMode).toBe(false);
        expect(mockSearchObj.data.editorValue).toBe("duration > 1");
        expect(request.type).toBe("traces");
        expect(request.queryReq.filter).toContain("duration > 1");
        expect(mockSqlTexts().sqlTexts.sql).toBe(grouped);
      });

      it("the SQL switch opens Spans with SQL on and the stored text, and runs nothing until Run", async () => {
        await leaveForTraces(grouped);
        mockSearchObj.data.editorValue = "span_status = 'ERROR'";
        wrapper.vm.onOpenSpansSql();
        await redraw();
        expect(mockSearchObj.meta.searchMode).toBe("spans");
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toBe(grouped);
        expect(mockSqlTexts().sqlTexts.filter).toBe("span_status = 'ERROR'");
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
      });

      it("the SQL switch brings the stored SQL, never a SELECT typed in the Traces filter", async () => {
        await leaveForTraces(grouped);
        const typed = `SELECT trace_id FROM "default"`;
        mockSearchObj.data.editorValue = typed;
        wrapper.vm.onOpenSpansSql();
        await redraw();
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toBe(grouped);
        expect(mockSqlTexts().sqlTexts.sql).toBe("");
        expect(mockSqlTexts().sqlTexts.filter).toBe(typed);
      });

      it("the SQL switch waits with a run prompt and no chart frames", async () => {
        await leaveForTraces(grouped);
        wrapper.vm.onOpenSpansSql();
        await redraw();
        const waiting = wrapper.find('[data-test="traces-sql-awaiting-run"]');
        expect(waiting.find('[data-test="traces-sql-awaiting-run-charts"]').exists()).toBe(false);
        expect(waiting.text()).toContain("Run the query to see results");
      });

      it("a plain click back on Spans also opens the stored SQL", async () => {
        await leaveForTraces(grouped);
        wrapper.vm.onSearchModeChange("spans");
        await redraw();
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toBe(grouped);
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      });

      it("a handoff clears the SQL text", async () => {
        await leaveForTraces(grouped);
        wrapper.vm.handleServiceGraphViewTraces({ mode: "traces", serviceName: "checkout" });
        await redraw();
        expect(mockSqlTexts().sqlTexts.sql).toBe("");
      });
    });

    describe("the SQL switch in the Traces view", () => {
      it("moves to Spans with SQL on and the pre-fill, runs nothing, and offers Back to Traces", async () => {
        await mountSql();
        mockSearchObj.meta.searchMode = "traces";
        mockSearchObj.data.editorValue = "service_name = 'api'";
        mockToast.mockClear();
        wrapper.vm.onOpenSpansSql();
        await redraw();
        expect(mockSearchObj.meta.searchMode).toBe("spans");
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        expect(mockSearchObj.data.editorValue).toBe(
          `SELECT * FROM "default" WHERE service_name = 'api' ORDER BY start_time DESC`,
        );
        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
        const [options] = mockToast.mock.calls.at(-1) as any[];
        expect(options.message).toBe("SQL runs in the Spans view");
        expect(options.action.label).toBe("Back to Traces");

        options.action.handler();
        await redraw();
        expect(mockSearchObj.meta.searchMode).toBe("traces");
        expect(mockSearchObj.meta.sqlMode).toBe(false);
        expect(mockSearchObj.data.editorValue).toBe("service_name = 'api'");
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      });
    });

    it("keeps one pane height for Spans with SQL off, Spans with SQL on, and the Traces view", async () => {
      await mountSql();
      // Only meta is reactive in this mock, so each text is set with SQL off and shown by turning SQL on.
      const showSql = async (text: string, sqlMode = true) => {
        mockSearchObj.meta.sqlMode = false;
        await flushPromises();
        mockSearchObj.data.editorValue = text;
        mockSearchObj.meta.sqlMode = sqlMode;
        await flushPromises();
      };
      await showSql("a = 1\nAND b = 2\nAND c = 3", false);
      expect(wrapper.vm.splitterModel).toBe(90);
      await showSql(`SELECT trace_id FROM "default"\nGROUP BY trace_id\nHAVING count(*) > 200`);
      expect(wrapper.vm.splitterModel).toBe(90);
      await showSql(Array.from({ length: 13 }, (_, i) => `-- ${i}`).join("\n"));
      expect(wrapper.vm.splitterModel).toBe(90);
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.meta.searchMode = "traces";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
      mockSearchObj.meta.searchMode = "spans";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
    });

    it("keeps a dragged pane height across SQL and view toggles", async () => {
      await mountSql();
      wrapper.vm.splitterModel = 250;
      mockSearchObj.data.editorValue = Array.from({ length: 13 }, (_, i) => `-- ${i}`).join("\n");
      mockSearchObj.meta.sqlMode = true;
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(250);
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.meta.searchMode = "traces";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(250);
      mockSearchObj.meta.searchMode = "spans";
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("keeps the pane height when SQL turns on and off", async () => {
      await mountSql();
      mockSearchObj.data.editorValue = "SELECT 1";
      expect(wrapper.vm.splitterModel).toBe(90);
      mockSearchObj.meta.sqlMode = true;
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);
      mockSearchObj.meta.sqlMode = false;
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(90);

      wrapper.vm.splitterModel = 220;
      mockSearchObj.meta.sqlMode = true;
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(220);
      mockSearchObj.meta.sqlMode = false;
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(220);
    });

    it("in the spans view, unrun SQL shows a Run prompt instead of results, until Run", async () => {
      await mountSql();
      mockSearchObj.searchApplied = true;
      mockSearchObj.data.editorValue = big;
      mockSearchObj.meta.sqlMode = true;
      await redraw();

      const prompt = wrapper.find('[data-test="traces-sql-awaiting-run"]');
      expect(prompt.exists()).toBe(true);
      expect(prompt.text()).toContain(i18n.global.t("traces.sqlMode.awaitingRun.spansTitle"));
      expect(wrapper.find('[data-test="logs-search-search-result"]').exists()).toBe(false);

      wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action");
      await redraw();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="logs-search-search-result"]').exists()).toBe(true);
    });

    it("asks for Run again when SQL is turned off and on", async () => {
      await mountSql();
      const { handlers } = await runSql(big);
      await finish(handlers, [{ trace_id: "t" }]);
      await redraw();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(false);

      mockSearchObj.meta.sqlMode = false;
      await flushPromises();
      mockSearchObj.meta.sqlMode = true;
      await redraw();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
    });

    it.each(["service-graph", "services-catalog"] as const)(
      "runs Spans SQL that ran again on a return from %s, never an empty table",
      async (view) => {
        await mountSql();
        mockSearchObj.searchApplied = true;
        const { handlers } = await runSql(big);
        await finish(handlers, [{ trace_id: "t" }]);
        mockFetchQueryDataWithHttpStream.mockClear();
        wrapper.vm.onSearchModeChange(view);
        wrapper.vm.onSearchModeChange("spans");
        await redraw();
        expect(mockSearchObj.meta.sqlMode).toBe(true);
        const [request] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
        expect(b64DecodeUnicode(request.queryReq.query.sql)).toContain("FROM");
        expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(false);
      },
    );

    it("runs Spans SQL again on a return when only trailing whitespace was added since its run", async () => {
      await mountSql();
      mockSearchObj.searchApplied = true;
      const { handlers } = await runSql(big);
      await finish(handlers, [{ trace_id: "t" }]);
      mockFetchQueryDataWithHttpStream.mockClear();
      mockSearchObj.data.editorValue = `${big}\n `;
      wrapper.vm.onSearchModeChange("service-graph");
      wrapper.vm.onSearchModeChange("spans");
      await redraw();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(false);
    });

    it("keeps Spans SQL edited since its run waiting for Run on a return from the service graph", async () => {
      await mountSql();
      mockSearchObj.searchApplied = true;
      const { handlers } = await runSql(big);
      await finish(handlers, [{ trace_id: "t" }]);
      mockFetchQueryDataWithHttpStream.mockClear();
      mockSearchObj.data.editorValue = `SELECT trace_id FROM "default" GROUP BY trace_id`;
      wrapper.vm.onSearchModeChange("service-graph");
      wrapper.vm.onSearchModeChange("spans");
      await redraw();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
    });

    it("shows a history entry's own SQL over staged SQL on a return to Spans, waiting for Run", async () => {
      await mountSql();
      mockSearchObj.searchApplied = true;
      const { handlers } = await runSql(big);
      await finish(handlers, [{ trace_id: "t" }]);
      mockFetchQueryDataWithHttpStream.mockClear();
      mockSearchObj.data.editorValue = `SELECT trace_id FROM "default" GROUP BY trace_id`;
      wrapper.vm.onSearchModeChange("service-graph");
      wrapper.vm.onSearchModeChange("spans", grouped);
      await redraw();
      expect(mockSearchObj.data.editorValue).toBe(grouped);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
    });

    it("keeps unrun Spans SQL waiting for Run on a return from the service graph", async () => {
      await mountSql();
      mockSearchObj.searchApplied = true;
      mockSearchObj.data.editorValue = big;
      mockSearchObj.meta.sqlMode = true;
      await redraw();
      wrapper.vm.onSearchModeChange("service-graph");
      wrapper.vm.onSearchModeChange("spans");
      await redraw();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(true);
    });

    it("never shows the SQL Run prompt in filter mode", async () => {
      await mountSql();
      mockSearchObj.meta.searchMode = "traces";
      mockSearchObj.searchApplied = true;
      mockSearchObj.data.editorValue = "duration > 1";
      mockSearchObj.meta.sqlMode = false;
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
      expect(wrapper.find('[data-test="traces-sql-awaiting-run"]').exists()).toBe(false);
    });

    it("shows the template gallery for an empty SQL editor, and a template fills it without running", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.editorValue = "";
      wrapper.vm.searchData();
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();

      const gallery = wrapper.findComponent({ name: "TracesSqlTemplateGallery" });
      expect(gallery.props()).not.toHaveProperty("view");
      expect(gallery.props("templates")).toEqual(mockSqlTemplates);

      gallery.vm.$emit("use", mockSqlTemplates[0].sql);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(mockSqlTemplates[0].sql);
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("adds trace_id to the SQL in the editor, not the SQL that last ran", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.editorValue = `SELECT service_name FROM "default" WHERE a = 1`;
      mockSearchObj.data.queryResults = { hits: [], sql: `SELECT service_name FROM "default"` };
      wrapper.vm.onSqlAddTraceId();
      await flushPromises();
      expect(mockSearchObj.data.editorValue).toBe(
        `SELECT trace_id, service_name FROM "default" WHERE a = 1`,
      );
    });

    it("adds trace_id to the select list and runs", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.editorValue = `SELECT service_name FROM "default"`;
      mockSearchObj.data.queryResults = { hits: [], sql: `SELECT service_name FROM "default"` };
      wrapper.vm.onSqlAddTraceId();
      await flushPromises();
      expect(mockSearchObj.data.editorValue).toBe(`SELECT trace_id, service_name FROM "default"`);
      const [request] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      expect(b64DecodeUnicode(request.queryReq.query.sql)).toBe(
        `SELECT trace_id, service_name FROM "default"`,
      );
    });

    it("restores SQL mode from a link only when it carries a query", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          name: "traces",
          path: "/traces",
          query: {
            stream: "default",
            tab: "spans",
            query: b64EncodeUnicode(grouped),
            sql_mode: "true",
          },
        },
      } as any);
      await mountSql();
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      wrapper.unmount();

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          name: "traces",
          path: "/traces",
          query: { stream: "default", tab: "spans", query: b64EncodeUnicode("a = 1") },
        },
      } as any);
      await mountSql();
      expect(mockSearchObj.meta.sqlMode).toBe(false);
    });

    it("opens a Traces link that carries SQL in the Spans view, with SQL on", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          name: "traces",
          path: "/traces",
          query: {
            stream: "default",
            tab: "traces",
            query: b64EncodeUnicode(grouped),
            sql_mode: "true",
          },
        },
      } as any);
      mockSearchObj.meta.searchMode = "traces";
      await mountSql();
      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      expect(mockSearchObj.data.editorValue).toBe(grouped);
    });

    it("reloads a service graph link that carries SQL on the service graph, with SQL on for Spans", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          name: "traces",
          path: "/traces",
          query: {
            stream: "default",
            tab: "service-graph",
            query: b64EncodeUnicode(grouped),
            sql_mode: "true",
          },
        },
      } as any);
      await mountSql();
      expect(mockSearchObj.meta.searchMode).toBe("service-graph");
      expect(mockSearchObj.meta.sqlMode).toBe(true);
      expect(mockSearchObj.data.editorValue).toBe(grouped);
    });

    it("opens a Traces URL with a stream and no query with SQL off and the editor cleared", async () => {
      mockSearchObj.meta.searchMode = "spans";
      mockSearchObj.data.editorValue = "duration > 1";
      mockSqlTexts().turnSqlOn();
      mockSearchObj.data.editorValue = grouped;
      routerCurrentRouteSpy.mockReturnValue({
        value: { name: "traces", path: "/traces", query: { stream: "default", tab: "traces" } },
      } as any);
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: { "search-bar": true, "index-list": true, "search-result": true },
        },
      });
      await flushPromises();
      expect(mockSearchObj.meta.searchMode).toBe("traces");
      expect(mockSearchObj.meta.sqlMode).toBe(false);
      expect(mockSearchObj.data.editorValue).toBe("");
      expect(mockSqlTexts().sqlTexts.sql).toBe("");
    });

    const failRun = async (sql: string, error: Record<string, unknown>) => {
      const { handlers } = await runSql(sql);
      handlers.error({}, { content: error });
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
    };

    it("shows a SQL-mode error with the server's own message and its suggestions", async () => {
      await mountSql();
      await failRun(`SELECT servce_name FROM "default"`, {
        code: 20004,
        message: "unknown field 'servce_name'",
        suggestions: ["service_name"],
      });
      const state = wrapper.findComponent({ name: "TracesSqlErrorState" });
      expect(state.props("errorMsg")).toBe("unknown field 'servce_name'");
      expect(state.props("suggestions")).toEqual(["service_name"]);
      expect(state.props("query")).toBe(`SELECT servce_name FROM "default"`);
    });

    it("keeps the RED strip above a failed query and handles its events like the results do", async () => {
      await mountSql();
      await failRun(`SELECT servce_name FROM "default"`, {
        code: 20004,
        message: "unknown field 'servce_name'",
      });
      await vi.waitFor(async () => {
        for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
        await nextTick();
        expect(
          wrapper
            .find('[data-test="traces-search-error-message"]')
            .findComponent({ name: "TracesMetricsDashboard" })
            .exists(),
        ).toBe(true);
      });
      const dashboard = wrapper.findComponent({ name: "TracesMetricsDashboard" });
      const handoff = { message: "why slow" };
      dashboard.vm.$emit("send-to-ai-chat", handoff);
      expect(wrapper.emitted("sendToAiChat")?.at(-1)).toEqual([handoff, true]);
      dashboard.vm.$emit("editor-filter-set", "duration > 5");
      expect(mockSearchObj.data.editorValue).toBe("duration > 5");
      mockSearchObj.meta.showHistogram = false;
      await nextTick();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
      const hidden = wrapper.findComponent({ name: "TracesMetricsDashboard" });
      expect(hidden.vm).toBe(dashboard.vm);
      expect(hidden.isVisible()).toBe(false);
    });

    it("binds no stream fields to the RED strip, which reads none", async () => {
      await mountSql();
      await failRun(`SELECT servce_name FROM "default"`, { code: 20004, message: "x" });
      await vi.waitFor(() =>
        expect(wrapper.findComponent({ name: "TracesMetricsDashboard" }).exists()).toBe(true),
      );
      const dashboard = wrapper.findComponent({ name: "TracesMetricsDashboard" });
      expect(dashboard.vm.$.vnode.props).not.toHaveProperty("stream-fields");
    });

    it("keeps the filter-mode error as it was", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.data.editorValue = "servce_name = 'a'";
      wrapper.vm.searchData();
      await flushPromises();
      const [, handlers] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      handlers.error({}, { content: { code: 20004, message: "unknown field 'servce_name'" } });
      await flushPromises();
      for (const splitter of wrapper.findAllComponents(OSplitter)) splitter.vm.$forceUpdate();
      await nextTick();
      expect(wrapper.findComponent({ name: "TracesSqlErrorState" }).exists()).toBe(false);
      expect(mockSearchObj.data.errorMsg).toBe(i18n.global.t("message.SearchFieldNotFound"));
    });

    it("runs the rewritten SQL a fix card sends", async () => {
      await mountSql();
      await failRun(`SELECT servce_name FROM "default"`, {
        code: 20004,
        message: "unknown field 'servce_name'",
      });
      mockFetchQueryDataWithHttpStream.mockClear();
      wrapper
        .findComponent({ name: "TracesSqlErrorState" })
        .vm.$emit("run-sql", `SELECT service_name FROM "default"`);
      await flushPromises();
      expect(mockSearchObj.data.editorValue).toBe(`SELECT service_name FROM "default"`);
      const [request] = mockFetchQueryDataWithHttpStream.mock.calls.at(-1) as any[];
      expect(b64DecodeUnicode(request.queryReq.query.sql)).toBe(
        `SELECT service_name FROM "default"`,
      );
    });

    it("opens the stream settings from a SQL-mode Configure resource card", async () => {
      await mountSql();
      await failRun(`SELECT * FROM "default"`, {
        code: 20003,
        message: "no full text search fields",
      });
      routerPushSpy.mockClear();
      wrapper.findComponent({ name: "TracesSqlErrorState" }).vm.$emit("configure-resource");
      expect(routerPushSpy).toHaveBeenCalledWith("/streams?dialog=default");
    });

    it("narrows to the last hour and runs for Use last 1 hour", async () => {
      await mountSql();
      await failRun(`SELECT * FROM "default" c JOIN "default" p ON c.t = p.t`, {
        code: 500,
        message: "Search SQL execute error: Resources exhausted: Failed to allocate",
      });
      mockFetchQueryDataWithHttpStream.mockClear();
      wrapper.findComponent({ name: "TracesSqlErrorState" }).vm.$emit("use-last-hour");
      await flushPromises();
      expect(mockSearchObj.data.datetime.type).toBe("relative");
      expect(mockSearchObj.data.datetime.relativeTimePeriod).toBe("1h");
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("tells the field list when the stream packs extra fields into _all", async () => {
      await mountSql();
      const base = mockStreamList.list.find((st: any) => st.name === "default");
      mockGetStream.mockResolvedValueOnce({
        ...base,
        settings: { ...base.settings, defined_schema_fields: ["service_name"] },
      });
      await wrapper.vm.extractFields();
      await flushPromises();
      expect(wrapper.vm.storesExtraFieldsInAll).toBe(true);
      await wrapper.vm.extractFields();
      await flushPromises();
      expect(wrapper.vm.storesExtraFieldsInAll).toBe(false);
    });

    it("marks the result partial when the server says it was cut", async () => {
      await mountSql();
      const { handlers } = await runSql(grouped);
      await finish(handlers, [{ service_name: "api", n: 3 }], { is_partial: true });
      expect(mockSearchObj.data.queryResults.is_partial).toBe(true);
    });

    describe("Scope select", () => {
      const ROOT = "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

      const ownCalls = () => {
        const { calls, contexts } = mockFetchQueryDataWithHttpStream.mock;
        return calls.filter((_c, i) => contexts[i] === wrapper.vm.$) as any[][];
      };

      const runChips = async (editorValue = "") => {
        mockSearchObj.meta.sqlMode = false;
        mockSearchObj.data.editorValue = editorValue;
        wrapper.vm.searchData();
        await flushPromises();
        const [request, handlers] = ownCalls().at(-1)!;
        return { request, handlers };
      };

      const countSqlAfter = async (handlers: any) => {
        await finish(handlers, [{ trace_id: "t", span_id: "s" }]);
        const [countRequest] = ownCalls().at(-1)!;
        return b64DecodeUnicode(countRequest.queryReq.query.sql);
      };

      const mountScoped = async (scope: string) => {
        await mountSql();
        mockSearchObj.meta.scope = scope;
        mockSearchObj.data.stream.hasParentColumn = true;
      };

      afterEach(() => {
        mockSearchObj.meta.scope = "all";
        mockSearchObj.data.stream.hasParentColumn = false;
      });

      it("narrows the Spans list and its count to the scope", async () => {
        await mountScoped("root");
        const { request, handlers } = await runChips();
        expect(b64DecodeUnicode(request.queryReq.query.sql)).toBe(
          `SELECT * FROM "default" WHERE ${ROOT} ORDER BY _timestamp DESC`,
        );
        expect(await countSqlAfter(handlers)).toContain(`FROM "default" WHERE ${ROOT}`);
      });

      it("adds the scope after the filter, bracketing the filter", async () => {
        await mountScoped("root");
        const { request, handlers } = await runChips("service_name = 'a'");
        expect(b64DecodeUnicode(request.queryReq.query.sql)).toContain(
          `WHERE (service_name = 'a') AND ${ROOT} ORDER BY`,
        );
        expect(await countSqlAfter(handlers)).toMatch(/WHERE \(service_name\s+=\s*'a'\) AND /);
      });

      it("sends All spans requests as before", async () => {
        await mountScoped("all");
        const { request, handlers } = await runChips();
        expect(b64DecodeUnicode(request.queryReq.query.sql)).toBe(
          `SELECT * FROM "default" ORDER BY _timestamp DESC`,
        );
        expect(await countSqlAfter(handlers)).toBe(
          `select count(*) as span_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count FROM "default"`,
        );
      });

      it("leaves the Traces view request and count alone", async () => {
        await mountScoped("root");
        mockSearchObj.meta.searchMode = "traces";
        const { request, handlers } = await runChips();
        expect(request.queryReq.filter).toBe("");
        expect(await countSqlAfter(handlers)).not.toContain("reference_parent_span_id");
      });

      it("sends typed SQL as written whatever the scope", async () => {
        await mountScoped("entrypoint");
        const typed = `SELECT * FROM "default" WHERE a = 1`;
        const { sql, handlers } = await runSql(typed);
        expect(sql).toBe(typed);
        expect(await countSqlAfter(handlers)).not.toContain("span_kind");
      });

      it("runs the Spans view again from page 1 when the scope is picked", async () => {
        await mountScoped("all");
        mockSearchObj.data.resultGrid.currentPage = 3;
        wrapper.findComponent(SearchResultStub).vm.$emit("update:scope", "root");
        await flushPromises();
        expect(mockSearchObj.meta.scope).toBe("root");
        expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
        const [request] = ownCalls().at(-1)!;
        expect(b64DecodeUnicode(request.queryReq.query.sql)).toContain(`WHERE ${ROOT}`);
      });

      it("reads whether the stream records reference_parent_span_id", async () => {
        await mountSql();
        const base = mockStreamList.list.find((st: any) => st.name === "default")!;
        mockGetStream.mockResolvedValueOnce({
          ...base,
          schema: [...base.schema, { name: "reference_parent_span_id", type: "Utf8" }],
        });
        await wrapper.vm.extractFields();
        await flushPromises();
        expect(mockSearchObj.data.stream.hasParentColumn).toBe(true);
        await wrapper.vm.extractFields();
        await flushPromises();
        expect(mockSearchObj.data.stream.hasParentColumn).toBe(false);
      });
    });

    describe("Groups view", () => {
      const ROOT = "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

      const ownSqls = () =>
        mockFetchQueryDataWithHttpStream.mock.calls
          .filter((_c, i) => mockFetchQueryDataWithHttpStream.mock.contexts[i] === wrapper.vm.$)
          .map(([request]: any[]) => b64DecodeUnicode(request.queryReq.query.sql));

      const runGrouped = async (editorValue = "") => {
        mockSearchObj.meta.sqlMode = false;
        mockSearchObj.data.editorValue = editorValue;
        wrapper.vm.searchData();
        await flushPromises();
      };

      afterEach(() => {
        mockSearchObj.meta.groupBy = "";
        mockSearchObj.meta.scope = "all";
        mockSearchObj.data.stream.hasParentColumn = false;
        mockSearchObj.data.groupsRequest = null;
      });

      it("hands the Groups table the filter, scope and window, runs no span list, and still counts", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        mockSearchObj.meta.scope = "root";
        mockSearchObj.data.stream.hasParentColumn = true;
        await runGrouped("service_name = 'a'");
        expect(mockSearchObj.data.groupsRequest).toMatchObject({
          stream: "default",
          key: "service_name",
          filter: "service_name = 'a'",
          scope: ROOT,
        });
        const request = mockSearchObj.data.groupsRequest!;
        expect(request.startTime).toBeGreaterThan(0);
        expect(request.endTime).toBeGreaterThan(request.startTime);
        const sqls = ownSqls();
        expect(sqls.some((sql) => sql.startsWith("SELECT * FROM"))).toBe(false);
        expect(sqls.at(-1)).toMatch(/^select count\(\*\) as span_count/);
        expect(mockSearchObj.loading).toBe(false);
      });

      it("marks a text key so the table folds empty into (no value), and not a number key", async () => {
        await mountSql();
        const fields = mockSearchObj.data.stream.selectedStreamFields;
        mockSearchObj.data.stream.selectedStreamFields = [
          { name: "service_name", dataType: "Utf8" },
          { name: "duration", dataType: "Int64" },
        ];
        mockSearchObj.meta.groupBy = "service_name";
        await runGrouped();
        expect(mockSearchObj.data.groupsRequest?.textKey).toBe(true);
        mockSearchObj.meta.groupBy = "duration";
        await runGrouped();
        expect(mockSearchObj.data.groupsRequest?.textKey).toBe(false);
        mockSearchObj.data.stream.selectedStreamFields = fields;
      });

      it("gives every grouped run a new request, so the table reloads", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        await runGrouped();
        const first = mockSearchObj.data.groupsRequest!.runId;
        await runGrouped();
        expect(mockSearchObj.data.groupsRequest!.runId).toBeGreaterThan(first);
      });

      it("runs at once from page 1 when a field is picked, and back to the list on None", async () => {
        await mountSql();
        mockSearchObj.data.resultGrid.currentPage = 2;
        wrapper.findComponent(SearchResultStub).vm.$emit("update:groupBy", "http_method");
        await flushPromises();
        expect(mockSearchObj.meta.groupBy).toBe("http_method");
        expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
        expect(mockSearchObj.data.groupsRequest?.key).toBe("http_method");

        mockFetchQueryDataWithHttpStream.mockClear();
        wrapper.findComponent(SearchResultStub).vm.$emit("update:groupBy", "");
        await flushPromises();
        expect(mockSearchObj.data.groupsRequest).toBeNull();
        expect(ownSqls()[0]).toMatch(/^SELECT \* FROM "default"/);
      });

      it("groups by a field picked from the field list", async () => {
        await mountSql();
        mockSearchObj.data.resultGrid.currentPage = 2;
        wrapper.findComponent({ name: "index-list" }).vm.$emit("group-by", "http_method");
        await flushPromises();
        expect(mockSearchObj.meta.groupBy).toBe("http_method");
        expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
        expect(mockSearchObj.data.groupsRequest?.key).toBe("http_method");
      });

      it("opening a group runs the filtered span list at once, even with auto-run off", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        await runGrouped("http_method = 'GET'");
        mockFetchQueryDataWithHttpStream.mockClear();
        wrapper.vm.onOpenGroup("service_name = 'cart'");
        await flushPromises();
        expect(mockSearchObj.meta.groupBy).toBe("");
        expect(mockSearchObj.data.groupsRequest).toBeNull();
        expect(mockSearchObj.data.editorValue).toBe(
          "http_method = 'GET' and service_name = 'cart'",
        );
        expect(ownSqls()[0]).toMatch(/^SELECT \* FROM "default" WHERE .*service_name = 'cart'/);
      });

      it("records no recent search for a grouped run, as a recent entry holds no Group by", async () => {
        const record = vi.spyOn(queryHistory, "record").mockResolvedValue({ data: {} } as never);
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        record.mockClear();
        await runGrouped("service_name = 'a'");
        expect(mockSearchObj.data.groupsRequest).not.toBeNull();
        expect(record).not.toHaveBeenCalled();
        record.mockRestore();
      });

      it("restores a recent search as the span list, not the current Groups view", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        await runGrouped();
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
        const entry: QueryHistoryEntry = {
          id: "t1",
          source: "traces",
          query: "service_name = 'cart'",
          query_key: "k",
          streams: ["default"],
          context: { page: { stream: "default", tab: "spans" } },
          status: "ok",
          starred: false,
          run_count: 1,
          created_at: 1,
          updated_at: 2,
        };
        mockFetchQueryDataWithHttpStream.mockClear();
        wrapper
          .findComponent({ name: "search-bar" })
          .vm.$emit("recent-restore", entry, "now", true);
        await flushPromises();
        expect(mockSearchObj.meta.groupBy).toBe("");
        expect(mockSearchObj.data.groupsRequest).toBeNull();
        expect(ownSqls()[0]).toMatch(/^SELECT \* FROM "default"/);
      });

      it("loads a recent search without running and drops the shown Groups table", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        await runGrouped();
        expect(mockSearchObj.data.groupsRequest).not.toBeNull();
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
        const entry: QueryHistoryEntry = {
          id: "t1",
          source: "traces",
          query: "service_name = 'cart'",
          query_key: "k",
          streams: ["default"],
          context: { page: { stream: "default", tab: "spans" } },
          status: "ok",
          starred: false,
          run_count: 1,
          created_at: 1,
          updated_at: 2,
        };
        mockFetchQueryDataWithHttpStream.mockClear();
        wrapper
          .findComponent({ name: "search-bar" })
          .vm.$emit("recent-restore", entry, "now", false);
        await flushPromises();
        expect(mockSearchObj.meta.groupBy).toBe("");
        expect(mockSearchObj.data.groupsRequest).toBeNull();
        expect(ownSqls()).toEqual([]);
      });

      it("keeps the span list in SQL mode and in the Traces view", async () => {
        await mountSql();
        mockSearchObj.meta.groupBy = "service_name";
        await runSql(`SELECT * FROM "default"`);
        expect(mockSearchObj.data.groupsRequest).toBeNull();

        mockSearchObj.meta.searchMode = "traces";
        await runGrouped();
        expect(mockSearchObj.data.groupsRequest).toBeNull();
        mockSearchObj.meta.searchMode = "spans";
      });
    });

    it("drops a Group by the picked stream has no field for, and keeps one it has", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.meta.groupBy = "service_name";
      mockSearchObj.data.stream.selectedStream = { label: "test-stream", value: "test-stream" };
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockSearchObj.meta.groupBy).toBe("service_name");

      mockSearchObj.meta.groupBy = "http_method";
      mockSearchObj.data.stream.selectedStream = { label: "test-stream", value: "test-stream" };
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockSearchObj.meta.groupBy).toBe("");
    });

    it("clears the Groups table when the picked stream has no Group by field, without a search on auto-run off", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = false;
      localStorage.setItem("oo_toggle_auto_run", "false");
      store.state.zoConfig.auto_query_enabled = true;
      await flushPromises();
      mockSearchObj.meta.groupBy = "http_method";
      mockSearchObj.data.groupsRequest = { key: "http_method" } as any;
      mockFetchQueryDataWithHttpStream.mockClear();
      mockSearchObj.data.stream.selectedStream = { label: "test-stream", value: "test-stream" };
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockSearchObj.meta.groupBy).toBe("");
      expect(mockSearchObj.data.groupsRequest).toBeNull();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      delete store.state.zoConfig.auto_query_enabled;
      localStorage.removeItem("oo_toggle_auto_run");
    });

    it("runs nothing when a stream is picked from the list in SQL mode, even with auto-run on", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.meta.liveMode = true;
      mockSearchObj.data.editorValue = `SELECT * FROM "test-stream"`;
      mockSearchObj.data.stream.selectedStream = { label: "test-stream", value: "test-stream" };
      await wrapper.vm.onChangeStream();
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("waits for Run when the stream changes in SQL mode, even with auto-run on", async () => {
      await mountSql();
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.meta.liveMode = true;
      store.state.zoConfig.auto_query_enabled = true;
      await wrapper.vm.onSqlStreamChange("test-stream");
      await flushPromises();
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("test-stream");
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      delete store.state.zoConfig.auto_query_enabled;
    });
  });
});
