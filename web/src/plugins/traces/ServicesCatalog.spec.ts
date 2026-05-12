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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

installQuasar();

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
    showErrorOnly: false,
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
        TenstackTable: {
          template: `
              <div data-test="services-catalog-table" :data-loading="loading">
                <template v-if="rows.length > 0">
                  <div v-for="(row, idx) in rows" :key="idx"
                    :data-test="'services-catalog-status-' + row.service_name"
                    :data-status="row.status"
                    @click="$emit('click:dataRow', row)">
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
            "rows",
            "columns",
            "loading",
            "sortBy",
            "sortOrder",
            "rowHeight",
            "enableColumnReorder",
            "enableRowExpand",
            "enableTextHighlight",
            "enableStatusBar",
            "defaultColumns",
          ],
          emits: ["click:dataRow", "sort-change"],
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
        "q-icon": false,
        "q-tooltip": false,
        "q-spinner-hourglass": false,
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

      const pill = wrapper.find('[data-test="services-catalog-status-pill"]');
      expect(pill.exists()).toBe(true);
      // Just the total — no colored status dots
      expect(pill.text()).toContain("1 service");
      expect(wrapper.vm.statusCounts.critical).toBe(0);
    });

    it("should show individual status pills when non-healthy statuses exist", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      // Total count pill
      const totalPill = wrapper.find('[data-test="services-catalog-status-pill"]');
      expect(totalPill.exists()).toBe(true);
      expect(totalPill.text()).toContain("5");
      expect(totalPill.text()).toContain("services");

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

      const pill = wrapper.find('[data-test="services-catalog-status-pill"]');
      expect(pill.exists()).toBe(true);
      // No non-healthy statuses, so pill only shows total
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

    it("should update sortBy, sortOrder, and reset currentPage on handleSortChange", async () => {
      wrapper = mountServicesCatalog();
      await flushPromises();

      wrapper.vm.currentPage = 3;
      wrapper.vm.handleSortChange("total_requests", "asc");

      expect(wrapper.vm.sortBy).toBe("total_requests");
      expect(wrapper.vm.sortOrder).toBe("asc");
      expect(wrapper.vm.currentPage).toBe(1);
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

      // Total pill should still be visible
      expect(
        wrapper.find('[data-test="services-catalog-status-pill"]').exists(),
      ).toBe(true);
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
  // Service count badge
  // -----------------------------------------------------------------------
  describe("service count badge", () => {
    it("should show total count when no filter is active", async () => {
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

      const badge = wrapper.find('[data-test="services-catalog-status-pill"]');
      expect(badge.exists()).toBe(true);
      // Without filter, shows just the total
      expect(badge.text()).toContain("5");
    });

    it("should show filtered / total when filter is active", async () => {
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

      wrapper.vm.filterText = "gateway";
      await flushPromises();

      const badge = wrapper.find('[data-test="services-catalog-status-pill"]');
      expect(badge.exists()).toBe(true);
      // With filter, shows "filtered / total"
      expect(badge.text()).toContain("1");
      expect(badge.text()).toContain("5");
      expect(badge.text()).toContain("/");
    });

    it("should not render the count badge when loading", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // Keep loading — never calls complete
      });

      wrapper = mountServicesCatalog();
      await flushPromises();

      const badge = wrapper.find('[data-test="services-catalog-status-pill"]');
      // The badge is inside v-if="!isLoading && services.length > 0"
      expect(badge.exists()).toBe(false);
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
    it("should apply correct badge class for healthy status", () => {
      expect(wrapper?.vm?.statusBadgeClass("healthy")).toBe(
        "o2-status-badge--success",
      );
    });

    it("should apply correct badge class for degraded status", () => {
      expect(wrapper?.vm?.statusBadgeClass("degraded")).toBe(
        "o2-status-badge--degraded",
      );
    });

    it("should apply correct badge class for warning status", () => {
      expect(wrapper?.vm?.statusBadgeClass("warning")).toBe(
        "o2-status-badge--warning",
      );
    });

    it("should apply correct badge class for critical status", () => {
      expect(wrapper?.vm?.statusBadgeClass("critical")).toBe(
        "o2-status-badge--error",
      );
    });

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

      expect(wrapper.vm.errorRateClass(15)).toContain("tw:text-red-500");
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

      expect(wrapper.vm.errorRateClass(7)).toContain("tw:text-orange-500");
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

      expect(wrapper.vm.errorRateClass(2)).toContain("tw:text-yellow-500");
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

    describe("changing stream triggers data reload", () => {
      it("should update streamFilter, persist to localStorage, and trigger reload", async () => {
        mockGetStreams.mockResolvedValueOnce({
          list: [{ name: "default" }, { name: "production" }],
        });

        wrapper = mountServicesCatalog();
        await flushPromises();

        // Clear the call from onMounted so we can assert the reload call
        mockFetchQueryDataWithHttpStream.mockClear();

        wrapper.vm.streamFilter = "production";
        wrapper.vm.onStreamFilterChange("production");
        await flushPromises();

        expect(localStorage.getItem("servicesCatalog_streamFilter")).toBe(
          "production",
        );
        expect(wrapper.vm.streamFilter).toBe("production");
        expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
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
});
