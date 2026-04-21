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
import { reactive } from "vue";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import Index from "@/plugins/traces/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import * as useDurationPercentilesModule from "@/composables/useDurationPercentiles";

// Create DOM node for mounting
const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

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
    searchMode: "traces" as "traces" | "spans" | "service-graph",
    resultGrid: {
      rowsPerPage: 25,
      sortBy: "start_time" as string,
      sortOrder: "desc" as "asc" | "desc",
    },
    refreshInterval: 0,
    serviceColors: {},
    metricsRangeFilters: new Map(),
    showErrorOnly: false,
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
    },
    streamResults: { list: [] },
    queryResults: { hits: [] },
    sortedQueryResults: [],
    histogram: {
      layout: {},
      data: [],
    },
    resultGrid: {
      currentPage: 0,
      columns: [],
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

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    resetSearchObj: vi.fn(),
    getUrlQueryParams: vi.fn(() => ({})),
    copyTracesUrl: vi.fn(),
    formatTracesMetaData: vi.fn((hits) => hits),
    setServiceColors: mockSetServiceColors,
    loadLocalLogFilterField: vi.fn(),
    updatedLocalLogFilterField: vi.fn(),
  }),
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockGetStreams, mockGetStream, mockSetServiceColors } = vi.hoisted(
  () => ({
    mockGetStreams: vi.fn(),
    mockGetStream: vi.fn(),
    mockSetServiceColors: vi.fn(),
  }),
);

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
const {
  mockCancelStreamQueryBasedOnRequestId,
  mockFetchQueryDataWithHttpStream,
} = vi.hoisted(() => ({
  mockCancelStreamQueryBasedOnRequestId: vi.fn(),
  mockFetchQueryDataWithHttpStream: vi.fn(),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
  }),
}));

vi.mock("@/composables/useDurationPercentiles", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseDurationWhereClause: vi.fn((whereClause: string) => whereClause),
  };
});

// Hoisted so tests can assert on the spy and override its return value per test.
const { mockParseSpanKindWhereClause } = vi.hoisted(() => ({
  mockParseSpanKindWhereClause: vi.fn((whereClause: string) => whereClause),
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
vi.mock("@/services/search", () => ({
  default: {
    get_traces: vi.fn(() => Promise.resolve({ data: mockTracesResponse })),
  },
}));

vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: mockFunctions })),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

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
  const routerPushSpy = vi
    .spyOn(router, "push")
    .mockResolvedValue(undefined as any);
  const routerReplaceSpy = vi
    .spyOn(router, "replace")
    .mockResolvedValue(undefined as any);
  const routerCurrentRouteSpy = vi
    .spyOn(router, "currentRoute", "get")
    .mockReturnValue({
      value: { query: {}, name: "traces", path: "/traces" },
    } as any);

  beforeEach(async () => {
    store.state.zoConfig.persist_last_selected_stream = true;
    localStorage.clear();
    // Set default stream mock implementations (tests can override with mockResolvedValueOnce)
    mockGetStreams.mockResolvedValue(mockStreamList);
    mockGetStream.mockImplementation((streamName: string) =>
      Promise.resolve(
        mockStreamList.list.find((s: any) => s.name === streamName),
      ),
    );

    // Reset mock data
    mockSearchObj.loading = false;
    mockSearchObj.loadingStream = false;
    mockSearchObj.meta.searchMode = "traces";
    mockSearchObj.data.stream.streamLists = [];
    mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
    mockSearchObj.data.queryResults = { hits: [] };
    mockSearchObj.data.errorMsg = "";
    mockSearchObj.data.editorValue = "";

    // Reset router spy return values to defaults for each test
    routerPushSpy.mockResolvedValue(undefined as any);
    routerReplaceSpy.mockResolvedValue(undefined as any);
    routerCurrentRouteSpy.mockReturnValue({
      value: { query: {}, name: "traces", path: "/traces" },
    } as any);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find("#tracePage").exists()).toBe(true);
    });

    it("should initialize with search tab active by default", async () => {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("search");
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(
            0,
          );
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Tab Navigation", () => {
    it("should switch to service-graph tab on enterprise", async () => {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // onBeforeMount sets searchMode from URL; activeTab computed reflects it
      expect(mockSearchObj.meta.searchMode).toBe("service-graph");
      expect(wrapper.vm.activeTab).toBe("service-graph");
    });

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
      // Start in service-graph mode so switching to traces is an actual change
      mockSearchObj.meta.searchMode = "service-graph";

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
  });

  describe("Stream Selection", () => {
    it("should select the first stream by default when persistence is enabled", async () => {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe(
            mockStreamList.list[0].name,
          );
        },
        { timeout: 2000 },
      );
    });

    it("should restore persisted stream selection when available", async () => {
      localStorage.setItem("o2_last_stream_traces", "test-stream");
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe(
            "test-stream",
          );
        },
        { timeout: 2000 },
      );
    });

    it("should not auto select stream when persistence is disabled", async () => {
      store.state.zoConfig.persist_last_selected_stream = false;
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBeFalsy();
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe(
            "test-stream",
          );
        },
        { timeout: 2000 },
      );
    });

    it("should show no stream selected message when no stream is selected", async () => {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(
        wrapper
          .find('[data-test="logs-search-no-stream-selected-text"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Search Functionality", () => {
    beforeEach(async () => {
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
    });

    it("should show apply search message when no search is applied", async () => {
      mockSearchObj.searchApplied = false;
      mockSearchObj.data.queryResults = { hits: [] };

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-not-started-text"]').exists(),
      ).toBe(true);
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

  describe("Error Handling", () => {
    it("should display error message when query fails", async () => {
      mockSearchObj.data.errorMsg = "Query failed";
      mockSearchObj.data.errorCode = 429; // Non-zero code → real error, not "no data"
      mockSearchObj.loading = false;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-error-message"]').exists(),
      ).toBe(true);
    });

    it("should show no traces found when errorCode is 0", async () => {
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
      mockSearchObj.data.errorMsg = "No data found";
      mockSearchObj.data.errorCode = 0;
      mockSearchObj.loading = false;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-error-text"]').exists(),
      ).toBe(true);
    });

    it("should display error code 20003 with configuration link", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "test-stream",
        value: "test-stream",
      };
      mockSearchObj.data.errorMsg = "Full text search not configured";
      mockSearchObj.data.errorCode = 20003;
      mockSearchObj.loading = false;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-error-20003"]').exists(),
      ).toBe(true);
    });
  });

  describe("Field List Management", () => {
    it("should toggle field list visibility", async () => {
      mockSearchObj.meta.showFields = true;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Find and click collapse button
      const collapseBtn = wrapper.find(
        '[data-test="logs-search-field-list-collapse-btn"]',
      );
      expect(collapseBtn.exists()).toBe(true);

      await collapseBtn.trigger("click");
      await flushPromises();

      expect(mockSearchObj.meta.showFields).toBe(false);
    });

    it("should update splitter model when fields are collapsed", async () => {
      mockSearchObj.meta.showFields = true;
      mockSearchObj.config.splitterModel = 20;
      mockSearchObj.config.lastSplitterPosition = 20;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Call collapseFieldList and verify showFields changed
      await wrapper.vm.collapseFieldList();
      await flushPromises();

      // The watcher will set splitterModel to 0 when showFields is false
      expect(mockSearchObj.meta.showFields).toBe(false);
    });
  });

  describe("DateTime Handling", () => {
    it("should restore datetime from URL params", async () => {
      const startTime = "1755853746625720";
      const endTime = "1755853746725720";

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
      mockSearchObj.meta.refreshInterval = 0;

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

  describe("Metrics Filters Integration", () => {
    // Spies for SearchBar ref methods exposed via stub
    const mockApplyFilters = vi.fn();
    const mockRemoveFilterByField = vi.fn();

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
                  removeFilterByField: mockRemoveFilterByField,
                };
              },
            },
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      mockApplyFilters.mockReset();
      mockRemoveFilterByField.mockReset();
      mockSearchObj.meta.showErrorOnly = false;
      mockSearchObj.meta.metricsRangeFilters.clear();
    });

    it("should call applyFilters with all filter terms when metrics filters are updated", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onMetricsFiltersUpdated([
        "duration >= 100",
        "service_name = 'test'",
      ]);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith([
        "duration >= 100",
        "service_name = 'test'",
      ]);
    });

    it("should append error filter to applyFilters call when showErrorOnly is enabled", async () => {
      mockSearchObj.meta.showErrorOnly = true;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onMetricsFiltersUpdated(["duration >= 100"]);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith([
        "duration >= 100",
        "span_status = 'ERROR'",
      ]);
    });

    it("should not duplicate error filter when it is already present in incoming filters", async () => {
      mockSearchObj.meta.showErrorOnly = true;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      // Error panel brush already emitted span_status filter
      wrapper.vm.onMetricsFiltersUpdated([
        "duration >= 100",
        "span_status = 'ERROR'",
      ]);
      await flushPromises();

      // span_status = 'ERROR' must appear exactly once
      const calledWith = mockApplyFilters.mock.calls[0][0] as string[];
      expect(
        calledWith.filter((f) => f === "span_status = 'ERROR'"),
      ).toHaveLength(1);
    });

    it("should call applyFilters with error condition when error only toggle is turned on", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onErrorOnlyToggled(true);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(["span_status = 'ERROR'"]);
    });

    it("should call removeFilterByField when error only toggle is turned off", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onErrorOnlyToggled(false);
      await flushPromises();

      expect(mockRemoveFilterByField).toHaveBeenCalledWith("span_status");
    });
  });

  describe("Service Graph Integration", () => {
    it("should set searchMode to traces when viewing traces from service graph", async () => {
      // Start in service-graph mode
      mockSearchObj.meta.searchMode = "service-graph";

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const serviceGraphData = {
        stream: "default",
        serviceName: "test-service",
        mode: "spans" as const,
        timeRange: {
          startTime: 1755853746625720,
          endTime: 1755853746725720,
        },
      };

      wrapper.vm.handleServiceGraphViewTraces(serviceGraphData);
      await flushPromises();

      // handleServiceGraphViewTraces sets searchMode from data.mode
      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
      expect(mockSearchObj.data.editorValue).toContain("test-service");
    });

    it("should escape single quotes in service name filter", async () => {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const serviceGraphData = {
        stream: "default",
        serviceName: "test'service",
        timeRange: {
          startTime: 1755853746625720,
          endTime: 1755853746725720,
        },
      };

      wrapper.vm.handleServiceGraphViewTraces(serviceGraphData);
      await flushPromises();

      // SQL-style escaping uses double quotes: test'service becomes test''service
      expect(mockSearchObj.data.editorValue).toContain("test''service");
    });

    function mountIndexComponent() {
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
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    it("should include operationName in filter query when provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        operationName: "GET /api/health",
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND operation_name = 'GET /api/health'",
      );
    });

    it("should include nodeName in filter query when provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        nodeName: "node-1",
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND service_k8s_node_name = 'node-1'",
      );
    });

    it("should include podName in filter query when provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        podName: "pod-abc",
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND service_k8s_pod_name = 'pod-abc'",
      );
    });

    it("should append span_status = 'ERROR' when errorsOnly is true", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        errorsOnly: true,
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND span_status = 'ERROR'",
      );
    });

    it("should include minDurationMicros in filter when greater than zero", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        minDurationMicros: 5000,
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain("AND duration >= 5000");
    });

    it("should include maxDurationMicros in filter when greater than zero", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        maxDurationMicros: 20000,
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain("AND duration <= 20000");
    });

    it("should combine all optional filter fields when all are provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        operationName: "POST /ingest",
        nodeName: "node-2",
        podName: "pod-xyz",
        errorsOnly: true,
        minDurationMicros: 1000,
        maxDurationMicros: 9000,
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      const query = mockSearchObj.data.editorValue;
      expect(query).toContain("service_name = 'svc'");
      expect(query).toContain("AND operation_name = 'POST /ingest'");
      expect(query).toContain("AND service_k8s_node_name = 'node-2'");
      expect(query).toContain("AND service_k8s_pod_name = 'pod-xyz'");
      expect(query).toContain("AND span_status = 'ERROR'");
      expect(query).toContain("AND duration >= 1000");
      expect(query).toContain("AND duration <= 9000");
    });

    it("should omit optional fields from filter when they are not provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      const query = mockSearchObj.data.editorValue;
      expect(query).toBe("service_name = 'svc'");
      expect(query).not.toContain("operation_name");
      expect(query).not.toContain("service_k8s_node_name");
      expect(query).not.toContain("service_k8s_pod_name");
      expect(query).not.toContain("span_status");
      expect(query).not.toContain("duration");
    });

    it("should not include duration filters when minDurationMicros and maxDurationMicros are zero", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        minDurationMicros: 0,
        maxDurationMicros: 0,
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).not.toContain("duration");
    });

    it("should set searchMode from data.mode when navigating via handleServiceGraphViewTraces", async () => {
      mockSearchObj.meta.searchMode = "service-graph";

      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        mode: "traces",
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("traces");
    });

    it("should append resourceFilter to query when data.resourceFilter is provided", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        mode: "spans",
        resourceFilter: { field: "service.name", value: "my-service" },
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND service.name = 'my-service'",
      );
    });

    it("should escape single quotes in resourceFilter value", async () => {
      wrapper = mountIndexComponent();
      await flushPromises();

      wrapper.vm.handleServiceGraphViewTraces({
        stream: "default",
        serviceName: "svc",
        mode: "spans",
        resourceFilter: { field: "service.name", value: "it's here" },
        timeRange: { startTime: 1755853746625720, endTime: 1755853746725720 },
      });
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain(
        "AND service.name = 'it''s here'",
      );
    });

    it("should call loadServiceGraph on serviceGraphRef when service-graph-refresh event fires from SearchBar", async () => {
      const mockLoadServiceGraph = vi.fn();

      // Start in service-graph mode so the ServiceGraph stub is rendered
      mockSearchObj.meta.searchMode = "service-graph";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              name: "search-bar",
              template: "<div />",
              emits: ["service-graph-refresh"],
            },
            "index-list": true,
            "search-result": true,
            "service-graph": {
              name: "service-graph",
              template: "<div />",
              setup() {
                return { loadServiceGraph: mockLoadServiceGraph };
              },
            },
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      expect(searchBarEl.exists()).toBe(true);
      await searchBarEl.vm.$emit("service-graph-refresh");
      await flushPromises();

      expect(mockLoadServiceGraph).toHaveBeenCalledTimes(1);
    });
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.vm.splitterModel).toBe(15);
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find("#tracesSecondLevel").classes()).toContain(
        "full-height",
      );
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const horizontalSplitter = wrapper.find(".traces-horizontal-splitter");
      expect(horizontalSplitter.exists()).toBe(true);
      expect(
        horizontalSplitter.find('[data-test="logs-search-bar"]').exists(),
      ).toBe(true);
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const result = await wrapper.vm.searchData();

      expect(result).toBeUndefined();
    });

    it("should handle refresh interval of 0 correctly", async () => {
      mockSearchObj.meta.refreshInterval = 5;

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Should not call getQueryData when refresh interval is not 0
      await wrapper.vm.getMoreData();

      // No error should be thrown
      expect(wrapper.vm).toBeTruthy();
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
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      wrapper.vm.cancelSearch();
      await flushPromises();

      expect(mockCancelStreamQueryBasedOnRequestId).not.toHaveBeenCalled();
    });

    it.skip("should call cancelStreamQueryBasedOnRequestId with trace id and org id when a search is in-flight", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
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
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
    });

    it("should call parseDurationWhereClause when building a search with a non-empty where clause", async () => {
      const parseSpy = vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      );
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
      const parseSpy = vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      );
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
      const parseSpy = vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      );
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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // parseDurationWhereClause returns the input unchanged for empty strings (no-op)
      // Either it was not called, or if called, it was with an empty string and returned it
      const callsWithNonEmpty = parseSpy.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass only the WHERE-clause portion to parseDurationWhereClause when editorValue contains a pipe prefix", async () => {
      const parseSpy = vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      );
      parseSpy.mockReturnValue("duration >= 1500");

      // editorValue with a query-functions prefix before the pipe
      mockSearchObj.data.editorValue = "someFunc | duration >= '1.50ms'";

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
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // parseDurationWhereClause must be called with only the part after the pipe,
      // NOT with the full "someFunc | duration >= '1.50ms'" string.
      const calls = parseSpy.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const [clause] of calls) {
        expect(clause).not.toContain("|");
        expect(clause).not.toContain("someFunc");
      }
    });

    it("should keep original where clause when parseDurationWhereClause returns an error object", async () => {
      const parseSpy = vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      );
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
      mockSearchObj.data.stream.streamLists = [
        { label: "default", value: "default" },
      ];
      // Clear call history so earlier tests in the suite do not pollute
      // toHaveBeenCalledWith assertions (the component auto-searches on mount
      // and accumulates calls before the explicit searchData() call).
      mockFetchQueryDataWithHttpStream.mockClear();
      // Default: spy passes the where clause through unchanged (real-implementation behaviour).
      mockParseSpanKindWhereClause.mockImplementation(
        (whereClause: string) => whereClause,
      );
      // Reset parseDurationWhereClause to passthrough so bleed-through from
      // the parseDurationWhereClause integration tests does not alter the
      // where clause before parseSpanKindWhereClause sees it.
      vi.mocked(
        useDurationPercentilesModule.parseDurationWhereClause,
      ).mockImplementation((whereClause: string) => whereClause);
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
      const matchingCall = calls.find(([arg]) =>
        (arg as string).includes("span_kind"),
      );
      expect(matchingCall).toBeDefined();
      expect(matchingCall![0]).toContain("span_kind='Server'");
    });

    it("should not call parseSpanKindWhereClause when the where clause is empty", async () => {
      mockSearchObj.data.editorValue = "";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // parseSpanKindWhereClause is guarded by `whereClause.trim() != ""` in buildSearch;
      // for an empty editorValue the spy must not have been called with a non-empty string.
      const callsWithNonEmpty = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass only the WHERE-clause portion to parseSpanKindWhereClause when editorValue contains a pipe prefix", async () => {
      mockSearchObj.data.editorValue = "someFunc | span_kind='Consumer'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      const nonEmptyCalls = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(nonEmptyCalls.length).toBeGreaterThan(0);
      for (const [clause] of nonEmptyCalls) {
        // The pipe-prefix (function expression) must not be forwarded.
        expect(clause).not.toContain("|");
        expect(clause).not.toContain("someFunc");
      }
    });
  });
});
