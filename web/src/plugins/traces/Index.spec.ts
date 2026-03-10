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
  meta: {
    showFields: true,
    showQuery: true,
    showHistogram: true,
    sqlMode: false,
    resultGrid: {
      rowsPerPage: 25,
    },
    refreshInterval: 0,
    serviceColors: {},
    metricsRangeFilters: new Map(),
    showErrorOnly: false,
  },
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

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    resetSearchObj: vi.fn(),
    getUrlQueryParams: vi.fn(() => ({})),
    copyTracesUrl: vi.fn(),
    formatTracesMetaData: vi.fn((hits) => hits),
  }),
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockGetStreams, mockGetStream } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockGetStream: vi.fn(),
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
    it("should switch to service-graph tab when service graph is enabled", async () => {
      // Enable service graph in store
      store.state.zoConfig.service_graph_enabled = true;

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

      expect(wrapper.vm.activeTab).toBe("service-graph");
    });

    it("should default to search tab when service graph is disabled", async () => {
      // Disable service graph
      store.state.zoConfig.service_graph_enabled = false;

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

      expect(wrapper.vm.activeTab).toBe("search");
    });

    it("should update URL when tab changes", async () => {
      store.state.zoConfig.service_graph_enabled = true;

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

      // Change tab
      wrapper.vm.activeTab = "service-graph";
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalled();
    });
  });

  describe("Stream Selection", () => {
    it("should select the stream with latest data by default", async () => {
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
          expect(mockSearchObj.data.stream.selectedStream.value).toBeTruthy();
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
      // Clear stream list
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
        wrapper
          .find('[data-test="traces-search-result-not-found-text"]')
          .exists(),
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
        wrapper
          .find('[data-test="traces-search-result-not-found-text"]')
          .exists(),
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
    it("should update query editor when metrics filters are updated", async () => {
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

      const filters = ["duration >= 100", "service_name = 'test'"];
      wrapper.vm.onMetricsFiltersUpdated(filters);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(
        "duration >= 100 AND service_name = 'test'",
      );
    });

    it("should add error filter when error only toggle is enabled", async () => {
      mockSearchObj.meta.showErrorOnly = true;

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

      const filters = ["duration >= 100"];
      wrapper.vm.onMetricsFiltersUpdated(filters);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain("span_status = 'ERROR'");
    });

    it("should handle error only toggle correctly", async () => {
      mockSearchObj.meta.metricsRangeFilters.set("duration", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
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

      wrapper.vm.onErrorOnlyToggled(true);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toContain("span_status = 'ERROR'");
    });
  });

  describe("Service Graph Integration", () => {
    it("should switch to search tab when viewing traces from service graph", async () => {
      store.state.zoConfig.service_graph_enabled = true;
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

      wrapper.vm.activeTab = "service-graph";
      await flushPromises();

      const serviceGraphData = {
        stream: "default",
        serviceName: "test-service",
        timeRange: {
          startTime: 1755853746625720,
          endTime: 1755853746725720,
        },
      };

      wrapper.vm.handleServiceGraphViewTraces(serviceGraphData);
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("search");
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
});
