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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";


// ---------------------------------------------------------------------------
// Mock search service
// ---------------------------------------------------------------------------
const mockSearchFn = vi.fn().mockResolvedValue({ data: {} });
vi.mock("@/services/search", () => ({
  default: {
    search: (...args: any[]) => mockSearchFn(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock stream service
// ---------------------------------------------------------------------------
const mockStreamSchema = vi.fn().mockResolvedValue({ data: { schema: [] } });
vi.mock("@/services/stream", () => ({
  default: {
    schema: (...args: any[]) => mockStreamSchema(...args),
  },
}));

// ---------------------------------------------------------------------------
// Shared reactive searchObj
// ---------------------------------------------------------------------------
const now = Date.now();
const mockSearchObj = reactive({
  organizationIdentifier: "test-org",
  runQuery: false,
  loading: false,
  loadingStream: false,
  meta: {
    refreshInterval: 0,
    refreshIntervalLabel: "Off",
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    showTraceDetails: false,
    sqlMode: false,
    searchMode: "services-catalog" as string,
    serviceColors: {} as Record<string, string>,
    redirectedFromLogs: false,
    searchApplied: false,
    metricsRangeFilters: new Map<
      string,
      { panelTitle: string; start: number; end: number }
    >(),
    queryEditorPlaceholderFlag: true,
    liveMode: false,
    serviceGraphVisualizationType: "tree" as "tree" | "graph",
    serviceGraphLayoutType: "horizontal",
    resultGrid: {
      wrapCells: false,
      manualRemoveFields: false,
      rowsPerPage: 25,
      showPagination: false,
      sortBy: "start_time" as string,
      sortOrder: "desc" as "asc" | "desc",
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: { currentRowIndex: 0 },
    },
    scrollInfo: {},
  },
  data: {
    query: "",
    advanceFiltersQuery: "",
    parsedQuery: {},
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "default", value: "default" },
      selectedStreamFields: [],
      selectedFields: [],
      filterField: "",
      addToFilter: "",
      removeFilterField: "",
      functions: [],
      filters: [],
      fieldValues: {},
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 0,
      columns: [],
    },
    queryPayload: {},
    transforms: [],
    queryResults: [],
    sortedQueryResults: [],
    streamResults: [],
    histogram: {},
    editorValue: "",
    datetime: {
      startTime: now - 3600000,
      endTime: now,
      relativeTimePeriod: "15m",
      type: "relative" as "relative" | "absolute",
    },
    searchAround: {
      indexTimestamp: 0,
      size: 10,
      histogramHide: false,
    },
    traceDetails: {
      selectedTrace: null,
      traceId: "",
      spanList: [],
      isLoadingTraceMeta: false,
      isLoadingTraceDetails: false,
      selectedSpanId: "",
      expandedSpans: [],
      showSpanDetails: false,
      selectedLogStreams: [],
    },
  },
});

// ---------------------------------------------------------------------------
// Mock useTraces composable
// ---------------------------------------------------------------------------
const mockGetOrSetServiceColor = vi.fn(
  (serviceName: string) =>
    mockSearchObj.meta.serviceColors[serviceName] ?? "#9e9e9e",
);

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    getOrSetServiceColor: mockGetOrSetServiceColor,
  }),
}));

// ---------------------------------------------------------------------------
// Mock useHttpStreaming composable
// ---------------------------------------------------------------------------
const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCancelStreamQueryBasedOnRequestId = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
  }),
}));

// ---------------------------------------------------------------------------
// Mock useStreams composable
// ---------------------------------------------------------------------------
const mockGetStreams = vi.fn().mockResolvedValue({ list: [] });
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

// ---------------------------------------------------------------------------
// Mock vue-router
// ---------------------------------------------------------------------------
const mockRouterPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual: any = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({
      push: mockRouterPush,
      currentRoute: { value: { query: {} } },
    }),
  };
});

// ---------------------------------------------------------------------------
// Import the component (must come after all vi.mock calls so hoisting applies)
// ---------------------------------------------------------------------------
import ServicesCatalog from "./ServicesCatalog.vue";

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------
function createMockStore(overrides: Record<string, any> = {}) {
  return createStore({
    state: {
      theme: "dark",
      timezone: "UTC",
      selectedOrganization: {
        identifier: "test-org",
        label: "Test Org",
        id: 1,
        user_email: "test@example.com",
        subscription_type: "",
      },
      organizationData: {
        organizationSettings: {
          trace_id_field_name: "trace_id",
          span_id_field_name: "span_id",
        },
        streams: {},
      },
      ...overrides,
    },
    mutations: {
      setStreams: vi.fn(),
    },
  });
}

// ---------------------------------------------------------------------------
// Mock service data
// ---------------------------------------------------------------------------
interface ServiceRow {
  service_name: string;
  status: "healthy" | "degraded" | "warning" | "critical";
  total_requests: number;
  error_count: number;
  error_rate: number;
  avg_duration_ns: number;
  max_duration_ns: number;
  p50_latency_ns: number;
  p95_latency_ns: number;
  p99_latency_ns: number;
}

const mockServices: ServiceRow[] = [
  {
    service_name: "api-gateway",
    status: "healthy",
    total_requests: 10000,
    error_count: 50,
    error_rate: 0.5,
    avg_duration_ns: 50000000,
    max_duration_ns: 200000000,
    p50_latency_ns: 45000000,
    p95_latency_ns: 150000000,
    p99_latency_ns: 180000000,
  },
  {
    service_name: "auth-service",
    status: "degraded",
    total_requests: 5000,
    error_count: 100,
    error_rate: 2.0,
    avg_duration_ns: 80000000,
    max_duration_ns: 300000000,
    p50_latency_ns: 75000000,
    p95_latency_ns: 250000000,
    p99_latency_ns: 290000000,
  },
  {
    service_name: "payment-service",
    status: "warning",
    total_requests: 2000,
    error_count: 140,
    error_rate: 7.0,
    avg_duration_ns: 120000000,
    max_duration_ns: 500000000,
    p50_latency_ns: 110000000,
    p95_latency_ns: 450000000,
    p99_latency_ns: 1200000000,
  },
  {
    service_name: "notification-service",
    status: "critical",
    total_requests: 800,
    error_count: 120,
    error_rate: 15.0,
    avg_duration_ns: 200000000,
    max_duration_ns: 1000000000,
    p50_latency_ns: 180000000,
    p95_latency_ns: 900000000,
    p99_latency_ns: 2500000000,
  },
  {
    service_name: "database-proxy",
    status: "healthy",
    total_requests: 20000,
    error_count: 10,
    error_rate: 0.05,
    avg_duration_ns: 30000000,
    max_duration_ns: 100000000,
    p50_latency_ns: 25000000,
    p95_latency_ns: 80000000,
    p99_latency_ns: 95000000,
  },
];

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function mountServicesCatalog(
  options: {
    storeOverrides?: Record<string, any>;
  } = {},
) {
  const mockStore = options.storeOverrides
    ? createMockStore(options.storeOverrides)
    : createMockStore();

  return mount(ServicesCatalog, {
    global: {
      plugins: [i18n, mockStore],
      provide: {
        store: mockStore,
      },
      stubs: {
        OTable: {
          // Mirrors the OTable contract the catalog now uses: `:data` (not
          // `:rows`), `row-click` (not `click:dataRow`), and `{ row }` cell
          // slots. The catalog feeds OTable the FULL sorted list; OTable owns
          // pagination + footer internally, so the stub just renders all rows.
          template: `
              <div data-test="services-catalog-table" :data-loading="loading">
                <template v-if="data.length > 0">
                  <div v-for="(row, idx) in data" :key="idx"
                    :data-test="'services-catalog-status-' + row.service_name"
                    :data-status="row.status"
                    @click="$emit('row-click', row, {})">
                    <span :data-test="'services-catalog-row-name-' + row.service_name">
                      {{ row.service_name }}
                    </span>
                    <span :data-test="'services-catalog-error-rate-' + row.service_name">
                      {{ row.error_rate }}
                    </span>
                    <span :data-test="'services-catalog-requests-' + row.service_name">
                      {{ row.total_requests }}
                    </span>
                    <span :data-test="'services-catalog-errors-' + row.service_name">
                      {{ row.error_count }}
                    </span>
                  </div>
                </template>
                <template v-else>
                  <div data-test="services-catalog-table-empty">No data</div>
                </template>
              </div>
            `,
          props: [
            "data",
            "columns",
            "loading",
            "sortBy",
            "sortOrder",
            "sorting",
            "pagination",
            "pageSize",
            "pageSizeOptions",
            "footerTitle",
            "frame",
            "defaultColumns",
            "rowKey",
            "tableId",
          ],
          emits: ["row-click", "sort-change"],
        },
        CellActions: {
          template: '<div data-test="services-catalog-cell-actions" />',
          props: [
            "column",
            "row",
            "selectedStreamFields",
            "hideSearchTermActions",
            "hideAi",
          ],
          emits: ["copy", "add-search-term"],
        },
        TraceServiceCell: {
          template: `
              <div :data-test="'services-catalog-service-link-' + item.service_name"
                @click="$emit('click', $event)">
                {{ item.service_name }}
              </div>
            `,
          props: ["item"],
          emits: ["click"],
        },
        ServiceGraphNodeSidePanel: {
          template: '<div data-test="services-catalog-node-side-panel" />',
          props: [
            "selectedNode",
            "graphData",
            "timeRange",
            "visible",
            "streamFilter",
          ],
          emits: ["close", "view-traces"],
        },
        "q-input": false,
        "q-btn": false,
        "OIcon": false,
        "q-tooltip": false,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ServicesCatalog", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("servicesCatalog_streamFilter");

    // Reset searchObj to baseline before each test
    mockSearchObj.data.datetime.startTime = now - 3600000;
    mockSearchObj.data.datetime.endTime = now;
    mockSearchObj.data.datetime.relativeTimePeriod = "15m";
    mockSearchObj.data.datetime.type = "relative";
    mockSearchObj.data.stream.selectedStream = {
      label: "default",
      value: "default",
    };
    mockSearchObj.meta.searchMode = "services-catalog";
    mockSearchObj.meta.serviceColors = {};

    // Default: fetch does nothing (no data, no complete call)
    mockFetchQueryDataWithHttpStream.mockReset();
    mockFetchQueryDataWithHttpStream.mockImplementation(() => {
      // No-op by default — tests override as needed
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------
  describe("empty state", () => {
    it("should show empty state when services array is empty and not loading", async () => {
      // Mock fetch to immediately call complete without any data, so
      // isLoading transitions back to false and the empty state renders.
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      const emptyDiv = wrapper.find('[data-test="services-catalog-empty"]');
      expect(emptyDiv.exists()).toBe(true);
    });

    it("should not show empty state when loading", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // Keep isLoading true — never calls complete
      });

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Manually set isLoading true since the mock above keeps it from
      // being set to false (complete never fires). We need to reach this
      // state through the component's own lifecycle: loadServicesCatalog
      // sets isLoading = true before awaiting fetchQueryDataWithHttpStream.
      const emptyDiv = wrapper.find('[data-test="services-catalog-empty"]');
      expect(emptyDiv.exists()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  describe("loading state", () => {
    it("should pass loading=true to TenstackTable when isLoading is true", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // Never calls complete, so isLoading stays true
      });

      wrapper = mountServicesCatalog();
      await flushPromises();

      // isLoading is set to true inside loadServicesCatalog before the
      // async call, and complete is never invoked, so it stays true.
      expect(wrapper.vm.isLoading).toBe(true);

      const table = wrapper.find('[data-test="services-catalog-table"]');
      expect(table.exists()).toBe(true);
      expect(table.attributes("data-loading")).toBe("true");
    });

    it("should pass loading=false to TenstackTable when data is loaded", async () => {
      // Mock fetch to call the data callback first (so the table has rows and
      // is shown via v-else), then call complete to set isLoading to false.
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.slice(0, 1).map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.isLoading).toBe(false);

      const table = wrapper.find('[data-test="services-catalog-table"]');
      expect(table.exists()).toBe(true);
      expect(table.attributes("data-loading")).toBe("false");
    });
  });

  // -----------------------------------------------------------------------
  // Table renders services
  // -----------------------------------------------------------------------
  describe("table renders services", () => {
    it("should render service rows when services array has items", async () => {
      // Mock fetch to call the data callback with mock hits and then complete
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Verify all services are rendered via their data-test attributes
      for (const service of mockServices) {
        const nameCell = wrapper.find(
          `[data-test="services-catalog-row-name-${service.service_name}"]`,
        );
        expect(nameCell.exists()).toBe(true);
        expect(nameCell.text()).toBe(service.service_name);
      }
    });

    it("should render the table component", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.slice(0, 1).map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      const table = wrapper.find('[data-test="services-catalog-table"]');
      expect(table.exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Filter input
  // -----------------------------------------------------------------------
  describe("filter input", () => {
    it("should filter the services list when text is entered", async () => {
      // Populate services via the streaming callback
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // All 5 services should be in filteredServices before filtering
      expect(wrapper.vm.filteredServices).toHaveLength(5);

      // Set filter text to match only "payment"
      wrapper.vm.filterText = "payment";
      await flushPromises();

      expect(wrapper.vm.filteredServices).toHaveLength(1);
      expect(wrapper.vm.filteredServices[0].service_name).toBe(
        "payment-service",
      );
    });

    it("should be case-insensitive when filtering", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Filter with uppercase
      wrapper.vm.filterText = "API";
      await flushPromises();

      expect(wrapper.vm.filteredServices).toHaveLength(1);
      expect(wrapper.vm.filteredServices[0].service_name).toBe("api-gateway");
    });

    it("should show all services when filter text is cleared", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // First filter
      wrapper.vm.filterText = "auth";
      await flushPromises();
      expect(wrapper.vm.filteredServices).toHaveLength(1);

      // Then clear
      wrapper.vm.filterText = "";
      await flushPromises();
      expect(wrapper.vm.filteredServices).toHaveLength(5);
    });

    it("should show an empty filtered list when no services match the filter", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.filterText = "nonexistent-service";
      await flushPromises();

      expect(wrapper.vm.filteredServices).toHaveLength(0);
    });

    it("should handle null/undefined filterText gracefully when filterText is not initialized", async () => {
      // Populate services via the streaming callback
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // All 5 services should be present before setting filterText to null
      expect(wrapper.vm.filteredServices).toHaveLength(5);

      // Set filterText to null — the optional chaining filterText?.value?.trim()
      // prevents a crash that would occur with filterText.value.trim()
      wrapper.vm.filterText = null;
      await flushPromises();

      // Should return all services (no crash, empty-filter fallback)
      expect(wrapper.vm.filteredServices).toHaveLength(5);

      // Set filterText to undefined — same null-safety applies
      wrapper.vm.filterText = undefined;
      await flushPromises();

      expect(wrapper.vm.filteredServices).toHaveLength(5);
    });
  });

  // -----------------------------------------------------------------------
  // Status bar
  // -----------------------------------------------------------------------
  describe("status bar", () => {
    beforeEach(() => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );
    });

    it("should show correct critical count", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // "notification-service" has status "critical" (error_rate 15.0 > 10)
      expect(wrapper.vm.statusCounts.critical).toBe(1);
    });

    it("should show correct warning count", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // "payment-service" has status "warning" (error_rate 7.0 > 5, <= 10)
      expect(wrapper.vm.statusCounts.warning).toBe(1);
    });

    it("should show correct degraded count", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // "auth-service" has status "degraded" (error_rate 2.0 > 1, <= 5)
      expect(wrapper.vm.statusCounts.degraded).toBe(1);
    });

    it("should render the pill with only total when all services are healthy", async () => {
      mockFetchQueryDataWithHttpStream.mockReset();
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = [
            {
              service_name: "svc-a",
              total_requests: 100,
              error_count: 0,
              error_rate: 0,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
          ];

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Entity total is shown in the type-filter tabs, not a separate pill.
      expect(wrapper.vm.statusCounts.critical).toBe(0);
    });

    it("should show individual status pills when non-healthy statuses exist", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // Individual status pills for non-zero counts
      expect(wrapper.find('[data-test="services-catalog-pill-critical"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="services-catalog-pill-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="services-catalog-pill-degraded"]').exists()).toBe(true);

      expect(wrapper.vm.statusCounts.critical).toBe(1);
      expect(wrapper.vm.statusCounts.warning).toBe(1);
      expect(wrapper.vm.statusCounts.degraded).toBe(1);
    });

    it("should only show relevant status counts", async () => {
      // Override: only healthy services (no critical)
      mockFetchQueryDataWithHttpStream.mockReset();
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = [
            {
              service_name: "svc-a",
              total_requests: 100,
              error_count: 0,
              error_rate: 0,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
          ];

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // No non-healthy statuses among the (Services) tab entities.
      expect(wrapper.vm.statusCounts.critical).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------
  describe("sorting", () => {
    beforeEach(() => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );
    });

    it("should default sortBy to 'status' and sortOrder to 'desc'", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.sortBy).toBe("status");
      expect(wrapper.vm.sortOrder).toBe("desc");
    });

    it("should sort by status in correct rank order when sortOrder is asc", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.sortBy = "status";
      wrapper.vm.sortOrder = "asc";
      await flushPromises();

      const names = wrapper.vm.sortedServices.map((s: any) => s.service_name);
      // healthy first (api-gateway, database-proxy), then degraded, warning, critical
      expect(names.slice(0, 2)).toEqual(
        expect.arrayContaining(["api-gateway", "database-proxy"]),
      );
      expect(names[2]).toBe("auth-service");
      expect(names[3]).toBe("payment-service");
      expect(names[4]).toBe("notification-service");
    });

    it("should sort by status in reverse when sortOrder is desc", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // desc is the default
      const names = wrapper.vm.sortedServices.map((s: any) => s.service_name);
      // critical first, then warning, degraded, healthy last
      expect(names[0]).toBe("notification-service");
      expect(names[1]).toBe("payment-service");
      expect(names[2]).toBe("auth-service");
      expect(names.slice(3, 5)).toEqual(
        expect.arrayContaining(["api-gateway", "database-proxy"]),
      );
    });

    it("should sort by numeric column correctly when sortOrder is asc", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.sortBy = "total_requests";
      wrapper.vm.sortOrder = "asc";
      await flushPromises();

      const counts = wrapper.vm.sortedServices.map(
        (s: any) => s.total_requests,
      );
      expect(counts).toEqual([800, 2000, 5000, 10000, 20000]);
    });

    it("should sort by string column alphabetically", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.sortBy = "service_name";
      wrapper.vm.sortOrder = "asc";
      await flushPromises();

      const names = wrapper.vm.sortedServices.map((s: any) => s.service_name);
      expect(names).toEqual([
        "api-gateway",
        "auth-service",
        "database-proxy",
        "notification-service",
        "payment-service",
      ]);
    });

    it("clicking a NEW column sorts it descending and resets currentPage", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.currentPage = 3;
      // A new column starts descending (worst/highest first). OTable's emitted
      // order is ignored — the catalog computes direction itself for a clean
      // 2-state toggle.
      wrapper.vm.handleSortChange("total_requests", "asc");

      expect(wrapper.vm.sortBy).toBe("total_requests");
      expect(wrapper.vm.sortOrder).toBe("desc");
      expect(wrapper.vm.currentPage).toBe(1);
    });

    it("clicking the SAME column flips the direction (2-state toggle)", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // Default: status / desc.
      expect(wrapper.vm.sortBy).toBe("status");
      expect(wrapper.vm.sortOrder).toBe("desc");

      // Re-click status → flips to asc.
      wrapper.vm.handleSortChange("status", "asc");
      expect(wrapper.vm.sortBy).toBe("status");
      expect(wrapper.vm.sortOrder).toBe("asc");

      // Re-click again → flips back to desc (never a "cleared" 3rd state).
      wrapper.vm.handleSortChange("status", "desc");
      expect(wrapper.vm.sortBy).toBe("status");
      expect(wrapper.vm.sortOrder).toBe("desc");
    });

    it("treats OTable's cleared-sort emit (empty column) as a flip of the current column", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // OTable's 3-state cycle emits column:"" on its clear step; the catalog
      // reinterprets that as re-clicking the current column → flip, so the table
      // is never left unsorted.
      expect(wrapper.vm.sortOrder).toBe("desc");
      wrapper.vm.handleSortChange("", "asc");
      expect(wrapper.vm.sortBy).toBe("status");
      expect(wrapper.vm.sortOrder).toBe("asc");
    });
  });

  // -----------------------------------------------------------------------
  // Status pills
  // -----------------------------------------------------------------------
  describe("status pills", () => {
    beforeEach(() => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );
    });

    it("should render critical pill when statusCounts.critical > 0", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      const pill = wrapper.find('[data-test="services-catalog-pill-critical"]');
      expect(pill.exists()).toBe(true);
      expect(pill.text()).toContain("1");
      expect(pill.text()).toContain("Critical");
    });

    it("should render warning pill when statusCounts.warning > 0", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      const pill = wrapper.find('[data-test="services-catalog-pill-warning"]');
      expect(pill.exists()).toBe(true);
      expect(pill.text()).toContain("1");
      expect(pill.text()).toContain("Warning");
    });

    it("should render degraded pill when statusCounts.degraded > 0", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      const pill = wrapper.find('[data-test="services-catalog-pill-degraded"]');
      expect(pill.exists()).toBe(true);
      expect(pill.text()).toContain("1");
      expect(pill.text()).toContain("Degraded");
    });

    it("should not render any status pills when all services are healthy", async () => {
      mockFetchQueryDataWithHttpStream.mockReset();
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = [
            {
              service_name: "svc-a",
              total_requests: 100,
              error_count: 0,
              error_rate: 0,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
          ];

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(
        wrapper.find('[data-test="services-catalog-pill-critical"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="services-catalog-pill-warning"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="services-catalog-pill-degraded"]').exists(),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Status legend
  // -----------------------------------------------------------------------
  describe.skip("status legend", () => {
    it("should render the status legend", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      const legend = wrapper.find(
        '[data-test="services-catalog-status-legend"]',
      );
      expect(legend.exists()).toBe(true);
    });

    it("should render all four legend items", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      const healthyLegend = wrapper.find(
        '[data-test="services-catalog-legend-healthy"]',
      );
      const degradedLegend = wrapper.find(
        '[data-test="services-catalog-legend-degraded"]',
      );
      const warningLegend = wrapper.find(
        '[data-test="services-catalog-legend-warning"]',
      );
      const criticalLegend = wrapper.find(
        '[data-test="services-catalog-legend-critical"]',
      );

      expect(healthyLegend.exists()).toBe(true);
      expect(degradedLegend.exists()).toBe(true);
      expect(warningLegend.exists()).toBe(true);
      expect(criticalLegend.exists()).toBe(true);
    });

    it("should render legend even when services array is empty", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      const legend = wrapper.find(
        '[data-test="services-catalog-status-legend"]',
      );
      // Legend is outside the v-if="!isLoading && services.length > 0" block,
      // so it always renders.
      expect(legend.exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Entity counts live in the type-filter tabs (no separate count pill)
  // -----------------------------------------------------------------------
  describe("type-filter tab counts", () => {
    function mockAllServices() {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));
          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );
    }

    it("shows the total on the All tab and the count on the Services tab", async () => {
      mockAllServices();
      wrapper = mountServicesCatalog();
      await flushPromises();

      // mockServices has no infer_service_type → all classified as Services.
      expect(wrapper.vm.categoryCounts.all).toBe(mockServices.length);
      expect(wrapper.vm.categoryCounts.service).toBe(mockServices.length);

      const allTab = wrapper.find('[data-test="services-catalog-type-all"]');
      expect(allTab.exists()).toBe(true);
      expect(allTab.text()).toContain(String(mockServices.length));
    });

    it("does not render a separate total count pill", async () => {
      mockAllServices();
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(
        wrapper.find('[data-test="services-catalog-status-pill"]').exists(),
      ).toBe(false);
    });

    it("does not render the type filter when loading", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // Keep loading — never calls complete
      });

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Type filter is inside v-if="!isLoading && services.length > 0".
      expect(
        wrapper.find('[data-test="services-catalog-type-filter"]').exists(),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Row click
  // -----------------------------------------------------------------------
  describe("row click", () => {
    it("should toggle side panel open when a row is clicked", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.slice(0, 1).map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // Initially side panel is closed
      expect(wrapper.vm.showSidePanel).toBe(false);

      // Click the first row via the TenstackTable stub
      const firstRow = wrapper.find(
        '[data-test="services-catalog-row-name-api-gateway"]',
      );
      await firstRow.trigger("click");

      expect(wrapper.vm.showSidePanel).toBe(true);
      expect(wrapper.vm.selectedServiceRow?.service_name).toBe("api-gateway");
    });

    it("should close side panel when same row is clicked again", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = mockServices.slice(0, 1).map((s) => ({
            service_name: s.service_name,
            total_requests: s.total_requests,
            error_count: s.error_count,
            error_rate: s.error_rate,
            avg_duration_ns: s.avg_duration_ns,
            max_duration_ns: s.max_duration_ns,
            p50_latency_ns: s.p50_latency_ns,
            p95_latency_ns: s.p95_latency_ns,
            p99_latency_ns: s.p99_latency_ns,
          }));

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      const firstRow = wrapper.find(
        '[data-test="services-catalog-row-name-api-gateway"]',
      );

      // First click opens
      await firstRow.trigger("click");
      expect(wrapper.vm.showSidePanel).toBe(true);

      // Second click on same row closes
      await firstRow.trigger("click");
      expect(wrapper.vm.showSidePanel).toBe(false);
      expect(wrapper.vm.selectedServiceRow).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Status badge classes per row
  // -----------------------------------------------------------------------
  describe("status badges", () => {

    it("should derive correct status from error rate", async () => {
      // Load services with known error rates and verify the derived status
      // per row matches the expected status.
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          const hits = [
            // 0.5% -> healthy
            {
              service_name: "svc-healthy",
              total_requests: 100,
              error_count: 0,
              error_rate: 0.5,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
            // 2% -> degraded
            {
              service_name: "svc-degraded",
              total_requests: 100,
              error_count: 2,
              error_rate: 2,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
            // 7% -> warning
            {
              service_name: "svc-warning",
              total_requests: 100,
              error_count: 7,
              error_rate: 7,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
            // 12% -> critical
            {
              service_name: "svc-critical",
              total_requests: 100,
              error_count: 12,
              error_rate: 12,
              avg_duration_ns: 1000,
              max_duration_ns: 2000,
              p50_latency_ns: 800,
              p95_latency_ns: 1500,
              p99_latency_ns: 1800,
            },
          ];

          if (callbacks?.data) {
            callbacks.data(null, {
              type: "search_response_hits",
              content: { results: { hits } },
            });
          }
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      // deriveStatus is exercised via statusCounts
      expect(wrapper.vm.statusCounts.critical).toBe(1);
      expect(wrapper.vm.statusCounts.warning).toBe(1);
      expect(wrapper.vm.statusCounts.degraded).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Error rate colors
  // -----------------------------------------------------------------------
  describe("error rate color classes", () => {
    it("should return correct class for critical error rate (>10%)", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.errorRateClass(15)).toContain("text-red-500");
    });

    it("should return correct class for warning error rate (5-10%)", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.errorRateClass(7)).toContain("text-orange-500");
    });

    it("should return correct class for degraded error rate (1-5%)", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.errorRateClass(2)).toContain("text-yellow-500");
    });

    it("should return empty string for healthy error rate (<=1%)", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.errorRateClass(0.5)).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // formatPercent utility
  // -----------------------------------------------------------------------
  describe("formatPercent", () => {
    it("should format a number with two decimal places and percent sign", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.formatPercent(5.5)).toBe("5.50%");
      expect(wrapper.vm.formatPercent(0.05)).toBe("0.05%");
      expect(wrapper.vm.formatPercent(100)).toBe("100.00%");
    });
  });

  // -----------------------------------------------------------------------
  // loadServicesCatalog
  // -----------------------------------------------------------------------
  describe("loadServicesCatalog", () => {
    it("should call fetch with default stream when both selectedStream and localStorage are empty", async () => {
      // Set both sources to empty so streamFilter cascades to "default"
      localStorage.removeItem("servicesCatalog_streamFilter");
      mockSearchObj.data.stream.selectedStream = {
        label: "",
        value: "",
      };

      wrapper = mountServicesCatalog();
      await flushPromises();

      // With the cascade "tracesStream || storedStreamFilter || 'default'",
      // streamFilter becomes "default" when both sources are empty.
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("should call fetchQueryDataWithHttpStream when stream is provided", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("should call fetchQueryDataWithHttpStream with correct organization identifier", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: "test-org",
        }),
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // P99 latency warning threshold
  // -----------------------------------------------------------------------
  describe("P99 warning threshold", () => {
    it("should have P99_WARN_NS set to 1 second (1,000,000,000 ns)", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_req: any, callbacks: any) => {
          if (callbacks?.complete) {
            callbacks.complete(null, {});
          }
        },
      );

      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.P99_WARN_NS).toBe(1_000_000_000);
    });
  });

  // -----------------------------------------------------------------------
  // defineExpose
  // -----------------------------------------------------------------------
  describe("defineExpose", () => {
    it("should expose loadServicesCatalog method", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(typeof wrapper.vm.loadServicesCatalog).toBe("function");
    });

    it("should expose streamFilter", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      expect(wrapper.vm.streamFilter).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Stream selection
  // -----------------------------------------------------------------------
  describe("stream selection", () => {
    describe("stream selector renders", () => {
      it("should render stream selector and populate availableStreams when streams are returned", async () => {
        mockGetStreams.mockResolvedValueOnce({
          list: [
            { name: "default" },
            { name: "production" },
            { name: "staging" },
          ],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        const selector = wrapper.find(
          '[data-test="services-catalog-stream-selector"]',
        );
        expect(selector.exists()).toBe(true);
        expect(wrapper.vm.availableStreams).toEqual([
          "default",
          "production",
          "staging",
        ]);
      });

      it("should render stream selector when no streams are available", async () => {
        mockGetStreams.mockResolvedValueOnce({ list: [] });

        wrapper = mountServicesCatalog();
        await flushPromises();

        const selector = wrapper.find(
          '[data-test="services-catalog-stream-selector"]',
        );
        expect(selector.exists()).toBe(true);
        expect(wrapper.vm.availableStreams).toEqual([]);
      });
    });

    describe("onStreamFilterChange — emits request:stream-change", () => {
      it("should emit request:stream-change with the new stream value when stream selection changes", async () => {
        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "default" }, { name: "production" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        mockFetchQueryDataWithHttpStream.mockClear();

        wrapper.vm.onStreamFilterChange("production");
        await flushPromises();

        const emitted = wrapper.emitted("request:stream-change");
        expect(emitted).toBeTruthy();
        expect(emitted![0]).toEqual(["production"]);
      });

      it("should NOT update streamFilter immediately when onStreamFilterChange is called", async () => {
        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "default" }, { name: "production" }],
        });

        // Ensure selectedStream starts as "default" so streamFilter initialises to "default"
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };

        wrapper = mountServicesCatalog();
        await flushPromises();

        expect(wrapper.vm.streamFilter).toBe("default");

        wrapper.vm.onStreamFilterChange("production");
        await flushPromises();

        // streamFilter must remain unchanged — only the watcher syncs it
        expect(wrapper.vm.streamFilter).toBe("default");
      });

      it("should NOT call loadServicesCatalog when onStreamFilterChange is called", async () => {
        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "default" }, { name: "production" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        // Clear the onMounted call so only subsequent calls are counted
        mockFetchQueryDataWithHttpStream.mockClear();

        wrapper.vm.onStreamFilterChange("production");
        await flushPromises();

        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      });
    });

    describe("global stream watch — syncs streamFilter from searchObj", () => {
      it("should update streamFilter when searchObj.data.stream.selectedStream.value changes externally", async () => {
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };

        wrapper = mountServicesCatalog();
        await flushPromises();

        expect(wrapper.vm.streamFilter).toBe("default");

        // Simulate external global stream change
        mockSearchObj.data.stream.selectedStream = {
          label: "production",
          value: "production",
        };
        await flushPromises();

        expect(wrapper.vm.streamFilter).toBe("production");
      });

      it("should call loadServicesCatalog when the global stream changes", async () => {
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };

        wrapper = mountServicesCatalog();
        await flushPromises();

        mockFetchQueryDataWithHttpStream.mockClear();

        mockSearchObj.data.stream.selectedStream = {
          label: "production",
          value: "production",
        };
        await flushPromises();

        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
      });

      it("should persist the new stream to localStorage when the global stream changes", async () => {
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };

        wrapper = mountServicesCatalog();
        await flushPromises();

        localStorage.removeItem("servicesCatalog_streamFilter");

        mockSearchObj.data.stream.selectedStream = {
          label: "production",
          value: "production",
        };
        await flushPromises();

        expect(localStorage.getItem("servicesCatalog_streamFilter")).toBe(
          "production",
        );
      });

      it("should NOT call loadServicesCatalog when the global stream value is unchanged", async () => {
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };

        wrapper = mountServicesCatalog();
        await flushPromises();

        mockFetchQueryDataWithHttpStream.mockClear();

        // Set to same value — watcher guard `newStream !== streamFilter.value` prevents reload
        mockSearchObj.data.stream.selectedStream = {
          label: "default",
          value: "default",
        };
        await flushPromises();

        expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      });
    });

    describe("stream selection persists from localStorage on init", () => {
      it("should use localStorage value when selectedStream is empty", async () => {
        localStorage.setItem("servicesCatalog_streamFilter", "staging");

        // Set selectedStream value to empty so it falls through to localStorage
        mockSearchObj.data.stream.selectedStream = {
          label: "",
          value: "",
        };

        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "staging" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        expect(wrapper.vm.streamFilter).toBe("staging");
      });

      it("should prefer selectedStream value over localStorage when both are set", async () => {
        localStorage.setItem("servicesCatalog_streamFilter", "staging");

        // selectedStream takes precedence
        mockSearchObj.data.stream.selectedStream = {
          label: "selected-stream",
          value: "selected-stream",
        };

        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "selected-stream" }, { name: "staging" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        expect(wrapper.vm.streamFilter).toBe("selected-stream");
      });
    });

    describe("loadServicesCatalog uses local streamFilter", () => {
      it("should construct SQL with streamFilter value instead of selectedStream", async () => {
        // Set selectedStream different from what we will use via streamFilter
        mockSearchObj.data.stream.selectedStream = {
          label: "different-stream",
          value: "different-stream",
        };

        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "production-stream" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        // streamFilter is initialized from selectedStream, so it starts as
        // "different-stream". Change it — the watcher fires and calls
        // loadServicesCatalog.  Flush, then clear so we only measure the
        // explicit call below.
        wrapper.vm.streamFilter = "production-stream";
        await flushPromises();

        mockFetchQueryDataWithHttpStream.mockClear();

        await wrapper.vm.loadServicesCatalog();

        // Verify the query uses production-stream, not different-stream
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
        const callArgs = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
        // b64EncodeUnicode uses URL-safe base64 (-, _, .), so reverse those
        // before calling atob.
        const urlSafeSql = callArgs.queryReq.query.sql;
        const decodedSql = atob(
          urlSafeSql
            .replace(/\-/g, "+")
            .replace(/\_/g, "/")
            .replace(/\./g, "="),
        );
        expect(decodedSql).toContain('FROM "production-stream"');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Entity-type classification & filter
  // -----------------------------------------------------------------------
  describe("entity-type classification & filter", () => {
    // A mixed inventory: instrumented services + inferred datastore/queue/external/rpc.
    const mixedRows = [
      { service_name: "backend-pos-web", infer_service_type: undefined },
      { service_name: "backend-tss-login", infer_service_type: undefined },
      { service_name: "redis-prod", infer_service_type: "database" },
      { service_name: "orders-db", infer_service_type: "database" },
      { service_name: "refund-order", infer_service_type: "queue" },
      { service_name: "google.com", infer_service_type: "external" },
      { service_name: "auth-rpc", infer_service_type: "rpc" },
    ].map((r) => ({
      status: "healthy",
      total_requests: 100,
      error_count: 0,
      error_rate: 0,
      avg_duration_ns: 0,
      max_duration_ns: 0,
      p50_latency_ns: 0,
      p95_latency_ns: 0,
      p99_latency_ns: 0,
      ...r,
    }));

    async function mountWithRows(rows: any[]) {
      const w = mountServicesCatalog();
      await flushPromises();
      w.vm.services = rows;
      // The default fetch mock never fires `complete`, so isLoading stays true
      // and the toolbar (type filter) stays hidden. Clear it so DOM assertions
      // on the tabs work; vm-level computed assertions don't need this.
      w.vm.isLoading = false;
      await flushPromises();
      return w;
    }

    it("defaults the type filter to Services", async () => {
      wrapper = await mountWithRows(mixedRows);
      expect(wrapper.vm.typeFilter).toBe("service");
    });

    it("shows only instrumented services under the default Services tab", async () => {
      wrapper = await mountWithRows(mixedRows);
      const names = wrapper.vm.filteredServices.map(
        (s: any) => s.service_name,
      );
      expect(names.sort()).toEqual(["backend-pos-web", "backend-tss-login"]);
    });

    it("counts entities per category from infer_service_type", async () => {
      wrapper = await mountWithRows(mixedRows);
      expect(wrapper.vm.categoryCounts).toEqual({
        all: 7,
        service: 2,
        datastore: 2,
        queue: 1,
        external: 1,
        rpc: 1,
      });
    });

    it("classifies a real service inferred as external back to Service (collision)", async () => {
      // email/quote emit their own spans (is_real_service=1) but were also
      // inferred as external because a caller reached them over HTTP.
      wrapper = await mountWithRows([
        {
          service_name: "email",
          infer_service_type: "external",
          is_real_service: 1,
          status: "healthy",
          total_requests: 1,
          error_count: 0,
          error_rate: 0,
          avg_duration_ns: 0,
          max_duration_ns: 0,
          p50_latency_ns: 0,
          p95_latency_ns: 0,
          p99_latency_ns: 0,
        },
        {
          // genuine external — no matching real service
          service_name: "metadata.google.internal.",
          infer_service_type: "external",
          is_real_service: 0,
          status: "healthy",
          total_requests: 1,
          error_count: 0,
          error_rate: 0,
          avg_duration_ns: 0,
          max_duration_ns: 0,
          p50_latency_ns: 0,
          p95_latency_ns: 0,
          p99_latency_ns: 0,
        },
      ]);
      // email → Service (collision), metadata → External (genuine).
      expect(wrapper.vm.categoryCounts.service).toBe(1);
      expect(wrapper.vm.categoryCounts.external).toBe(1);
    });

    it("switches the visible rows when the type filter changes", async () => {
      wrapper = await mountWithRows(mixedRows);

      wrapper.vm.onTypeFilterChange("datastore");
      await flushPromises();
      expect(
        wrapper.vm.filteredServices.map((s: any) => s.service_name).sort(),
      ).toEqual(["orders-db", "redis-prod"]);

      wrapper.vm.onTypeFilterChange("external");
      await flushPromises();
      expect(
        wrapper.vm.filteredServices.map((s: any) => s.service_name),
      ).toEqual(["google.com"]);
    });

    it("applies the text filter within the active type tab", async () => {
      wrapper = await mountWithRows(mixedRows);
      wrapper.vm.onTypeFilterChange("datastore");
      wrapper.vm.filterText = "redis";
      await flushPromises();
      expect(
        wrapper.vm.filteredServices.map((s: any) => s.service_name),
      ).toEqual(["redis-prod"]);
    });

    it("hides type tabs with no entities but always keeps Services", async () => {
      wrapper = await mountWithRows([
        {
          service_name: "svc-only",
          infer_service_type: undefined,
          status: "healthy",
          total_requests: 1,
          error_count: 0,
          error_rate: 0,
          avg_duration_ns: 0,
          max_duration_ns: 0,
          p50_latency_ns: 0,
          p95_latency_ns: 0,
          p99_latency_ns: 0,
        },
      ]);
      // "all" and Services are always present even on a services-only stream.
      expect(wrapper.vm.visibleTypeFilters).toEqual(["all", "service"]);
    });

    it("falls back to Services when the active tab disappears", async () => {
      wrapper = await mountWithRows(mixedRows);
      wrapper.vm.onTypeFilterChange("queue");
      await flushPromises();
      expect(wrapper.vm.typeFilter).toBe("queue");

      // Replace inventory with services only — the Queue tab vanishes.
      wrapper.vm.services = mixedRows.filter(
        (r) => !r.infer_service_type,
      );
      await flushPromises();
      expect(wrapper.vm.typeFilter).toBe("service");
    });

    it("treats database infer type as the Datastores category", async () => {
      wrapper = await mountWithRows(mixedRows);
      wrapper.vm.onTypeFilterChange("datastore");
      await flushPromises();
      // 'database' (infer_service_type) → 'datastore' (catalog category)
      expect(wrapper.vm.filteredServices).toHaveLength(2);
    });

    it("offers an 'all' tab first, then Services, then present categories", async () => {
      wrapper = await mountWithRows(mixedRows);
      expect(wrapper.vm.visibleTypeFilters).toEqual([
        "all",
        "service",
        "datastore",
        "queue",
        "external",
        "rpc",
      ]);
    });

    it("shows every entity type mixed under the 'all' tab", async () => {
      wrapper = await mountWithRows(mixedRows);
      wrapper.vm.onTypeFilterChange("all");
      await flushPromises();
      expect(wrapper.vm.filteredServices).toHaveLength(mixedRows.length);
    });

    it("applies the text filter across all types under 'all'", async () => {
      wrapper = await mountWithRows(mixedRows);
      wrapper.vm.onTypeFilterChange("all");
      wrapper.vm.filterText = "order"; // matches queue 'refund-order' + db 'orders-db'
      await flushPromises();
      expect(
        wrapper.vm.filteredServices.map((s: any) => s.service_name).sort(),
      ).toEqual(["orders-db", "refund-order"]);
    });

    describe("status counts scoped to the active type tab", () => {
      // Two datastores: one degraded, one healthy. One critical service.
      const statusRows = [
        { service_name: "svc-crit", infer_service_type: undefined, status: "critical", error_rate: 20 },
        { service_name: "db-degraded", infer_service_type: "database", status: "degraded", error_rate: 3 },
        { service_name: "db-ok", infer_service_type: "database", status: "healthy", error_rate: 0 },
      ].map((r) => ({
        total_requests: 100,
        error_count: 0,
        avg_duration_ns: 0,
        max_duration_ns: 0,
        p50_latency_ns: 0,
        p95_latency_ns: 0,
        p99_latency_ns: 0,
        ...r,
      }));

      it("counts only the active tab's entities (Datastores → 1 Degraded, 0 Critical)", async () => {
        wrapper = await mountWithRows(statusRows);
        wrapper.vm.onTypeFilterChange("datastore");
        await flushPromises();
        expect(wrapper.vm.statusCounts.degraded).toBe(1);
        expect(wrapper.vm.statusCounts.critical).toBe(0);
      });

      it("counts across all entities under the 'all' tab", async () => {
        wrapper = await mountWithRows(statusRows);
        wrapper.vm.onTypeFilterChange("all");
        await flushPromises();
        expect(wrapper.vm.statusCounts.critical).toBe(1);
        expect(wrapper.vm.statusCounts.degraded).toBe(1);
      });

      it("excludes other tabs' entities (Services → 1 Critical, 0 Degraded)", async () => {
        wrapper = await mountWithRows(statusRows);
        // default tab is Services
        expect(wrapper.vm.statusCounts.critical).toBe(1);
        expect(wrapper.vm.statusCounts.degraded).toBe(0);
      });
    });

    describe("unhealthy highlight & bracket count on tabs", () => {
      // db-degraded + db-ok (datastore), svc-crit (service), q-ok (queue).
      const healthRows = [
        { service_name: "svc-crit", infer_service_type: undefined, status: "critical" },
        { service_name: "db-degraded", infer_service_type: "database", status: "degraded" },
        { service_name: "db-ok", infer_service_type: "database", status: "healthy" },
        { service_name: "q-ok", infer_service_type: "queue", status: "healthy" },
      ].map((r) => ({
        total_requests: 100,
        error_count: 0,
        error_rate: 0,
        avg_duration_ns: 0,
        max_duration_ns: 0,
        p50_latency_ns: 0,
        p95_latency_ns: 0,
        p99_latency_ns: 0,
        ...r,
      }));

      it("reports the worst status per category", async () => {
        wrapper = await mountWithRows(healthRows);
        const worst = wrapper.vm.categoryWorstStatus;
        expect(worst.service).toBe("critical");
        expect(worst.datastore).toBe("degraded");
        expect(worst.queue).toBe("healthy");
        expect(worst.all).toBe("critical"); // worst across everything
      });

      it("counts unhealthy entities per category for the bracket", async () => {
        wrapper = await mountWithRows(healthRows);
        const unhealthy = wrapper.vm.categoryUnhealthyCounts;
        expect(unhealthy.service).toBe(1); // svc-crit
        expect(unhealthy.datastore).toBe(1); // db-degraded (db-ok excluded)
        expect(unhealthy.queue).toBe(0);
        expect(unhealthy.all).toBe(2); // svc-crit + db-degraded
      });

      it("conveys a tab's worst status via the badge fill, not a row-text tint", async () => {
        // The vertical rail (OTabs) owns the active-row tint, so worst-status is
        // signalled only by the colored unhealthy badge — there is no separate
        // whole-row text-color class (the old tabStatusClass helper was removed).
        wrapper = await mountWithRows(healthRows);
        expect(wrapper.vm.tabStatusClass).toBeUndefined();
        expect(wrapper.vm.tabStatusColorVar("service")).toContain("critical");
        expect(wrapper.vm.tabStatusColorVar("datastore")).toContain("degraded");
      });

      it("exposes a worst-status color var for the count badge fill", async () => {
        wrapper = await mountWithRows(healthRows);
        expect(wrapper.vm.tabStatusColorVar("service")).toContain("critical");
        expect(wrapper.vm.tabStatusColorVar("datastore")).toContain("degraded");
        expect(wrapper.vm.tabStatusColorVar("queue")).toBe(""); // healthy → no fill
      });

      it("renders the bracket count only for tabs with unhealthy entities", async () => {
        wrapper = await mountWithRows(healthRows);
        expect(
          wrapper
            .find('[data-test="services-catalog-type-unhealthy-datastore"]')
            .exists(),
        ).toBe(true);
        expect(
          wrapper
            .find('[data-test="services-catalog-type-unhealthy-queue"]')
            .exists(),
        ).toBe(false);
      });
    });
  });
});
