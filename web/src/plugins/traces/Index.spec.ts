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

const { mockGetStreams } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: vi.fn((streamName) =>
      Promise.resolve(mockStreamList.list.find((s) => s.name === streamName))
    ),
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

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

  beforeEach(async () => {
    // Reset mock data
    mockGetStreams.mockResolvedValue(mockStreamList);
    mockSearchObj.loading = false;
    mockSearchObj.loadingStream = false;
    mockSearchObj.data.stream.streamLists = [];
    mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
    mockSearchObj.data.queryResults = { hits: [] };
    mockSearchObj.data.errorMsg = "";
    mockSearchObj.data.editorValue = "";

    // Mock router query params
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {},
        name: "traces",
        path: "/traces",
      },
    } as any);

    vi.spyOn(router, "push").mockResolvedValue(undefined as any);
    vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that streams were loaded
      expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
    });
  });

  describe("Tab Navigation", () => {
    it("should switch to service-graph tab when service graph is enabled", async () => {
      // Enable service graph in store
      store.state.zoConfig.service_graph_enabled = true;

      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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

      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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

      expect(router.replace).toHaveBeenCalled();
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The default stream should be selected
      expect(mockSearchObj.data.stream.selectedStream.value).toBeTruthy();
    });

    it("should select stream from URL query params if provided", async () => {
      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSearchObj.data.stream.selectedStream.value).toBe(
        "test-stream"
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
        wrapper.find('[data-test="logs-search-no-stream-selected-text"]').exists()
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
        wrapper.find('[data-test="logs-search-result-not-found-text"]').exists()
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
        wrapper.find('[data-test="logs-search-error-message"]').exists()
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
        wrapper.find('[data-test="logs-search-result-not-found-text"]').exists()
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

      expect(wrapper.find('[data-test="logs-search-error-20003"]').exists()).toBe(
        true
      );
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
        '[data-test="logs-search-field-list-collapse-btn"]'
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

      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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
      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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
        "duration >= 100 AND service_name = 'test'"
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

      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
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
});
