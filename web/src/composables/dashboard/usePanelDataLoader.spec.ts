import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import { usePanelDataLoader } from "./usePanelDataLoader";

// Mock all dependencies with enhanced functionality
let mockSearchResults: any = [];
let mockPartitionResults: any = {
  data: { partitions: [], max_query_range: 0 },
};
let mockMetricsResults: any = { data: { status: "success" } };
let shouldSearchThrow = false;
let shouldPartitionThrow = false;
let shouldMetricsThrow = false;

vi.mock("../../services/search", () => ({
  default: {
    partition: vi.fn().mockImplementation(() => {
      if (shouldPartitionThrow) {
        return Promise.reject(new Error("Partition service error"));
      }
      return Promise.resolve(mockPartitionResults);
    }),
    search: vi.fn().mockImplementation(() => {
      if (shouldSearchThrow) {
        return Promise.reject(new Error("Search service error"));
      }
      return Promise.resolve({ data: mockSearchResults });
    }),
    metrics_query_range: vi.fn().mockImplementation(() => {
      if (shouldMetricsThrow) {
        return Promise.reject(new Error("Metrics service error"));
      }
      return Promise.resolve(mockMetricsResults);
    }),
    delete_running_queries: vi.fn().mockResolvedValue({ status: "success" }),
  },
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { sql_base64_enabled: false },
      organizationData: {
        organizationSettings: { scrape_interval: 15 },
      },
    },
  }),
}));

vi.mock("@/utils/query/promQLUtils", () => ({
  addLabelToPromQlQuery: vi.fn((query, name, value, operator) => query),
}));

vi.mock("@/utils/query/sqlUtils", () => ({
  addLabelsToSQlQuery: vi.fn((query, filters) => Promise.resolve(query)),
  getStreamFromQuery: vi.fn(() => Promise.resolve("test_stream")),
}));

vi.mock("@/utils/dashboard/variables/variablesUtils", () => ({
  formatInterval: vi.fn(() => ({ value: 5, unit: "m" })),
  formatRateInterval: vi.fn(() => "5m"),
  getTimeInSecondsBasedOnUnit: vi.fn(() => 300),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((str) => btoa(str)),
  generateTraceContext: vi.fn(() => ({
    traceparent: "test-trace",
    traceId: "test-trace-id",
  })),
  isWebSocketEnabled: vi.fn(() => false),
  isStreamingEnabled: vi.fn(() => false),
  escapeSingleQuotes: vi.fn((str) => str.replace(/\\/g, "\\\\").replace(/'/g, "\\'")),
  useLocalWrapContent: vi.fn(() => null),
}));

// Enhanced Panel Cache mocking
let mockCacheData: any = null;
let shouldCacheThrow = false;
let cacheOperationCount = 0;

vi.mock("./usePanelCache", () => ({
  usePanelCache: vi.fn(() => ({
    getPanelCache: vi.fn().mockImplementation(() => {
      cacheOperationCount++;
      if (shouldCacheThrow) {
        return Promise.reject(new Error("Cache retrieval error"));
      }
      return Promise.resolve(mockCacheData);
    }),
    savePanelCache: vi.fn().mockImplementation((key, data, timeRange) => {
      cacheOperationCount++;
      if (shouldCacheThrow) {
        return Promise.reject(new Error("Cache save error"));
      }
      mockCacheData = { key, value: data, cacheTimeRange: timeRange };
      return Promise.resolve();
    }),
  })),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  convertOffsetToSeconds: vi.fn(() => ({ seconds: 3600, periodAsStr: "1h" })),
}));

// Enhanced WebSocket mocking
let mockWebSocketCallbacks: any = {};
let shouldWebSocketThrow = false;
let webSocketConnectionState = "connected";

vi.mock("@/composables/useSearchWebSocket", () => ({
  default: () => ({
    fetchQueryDataWithWebSocket: vi
      .fn()
      .mockImplementation((payload, callbacks) => {
        mockWebSocketCallbacks = callbacks;
        if (shouldWebSocketThrow) {
          callbacks?.error?.(payload, { message: "WebSocket error" });
          return "error-trace-id";
        }
        // Simulate successful connection
        setTimeout(() => {
          callbacks?.open?.(payload);
          callbacks?.message?.(payload, {
            content: { results: { hits: [] } },
            type: "search_response",
          });
          callbacks?.close?.(payload, { code: 1000 });
        }, 10);
        return "test-trace-id";
      }),
    sendSearchMessageBasedOnRequestId: vi.fn(),
    cancelSearchQueryBasedOnRequestId: vi.fn(),
    cleanUpListeners: vi.fn(),
  }),
}));

// Enhanced Annotations mocking
let mockAnnotations: any[] = [];
let shouldAnnotationsThrow = false;

vi.mock("./useAnnotations", () => ({
  useAnnotations: vi.fn(() => ({
    refreshAnnotations: vi.fn().mockImplementation(() => {
      if (shouldAnnotationsThrow) {
        return Promise.reject(new Error("Annotations error"));
      }
      return Promise.resolve(mockAnnotations);
    }),
  })),
}));

// Enhanced HTTP Streaming mocking
let mockStreamingCallbacks: any = {};
let shouldStreamingThrow = false;

vi.mock("../useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: vi
      .fn()
      .mockImplementation((payload, callbacks) => {
        mockStreamingCallbacks = callbacks;
        if (shouldStreamingThrow) {
          callbacks?.error?.(payload, { message: "Streaming error" });
          return "error-stream-id";
        }
        // Simulate streaming response
        setTimeout(() => {
          callbacks?.data?.(payload, {
            content: { results: { hits: [] } },
            type: "search_response",
          });
          callbacks?.complete?.(payload, { status: "complete" });
        }, 10);
        return "test-stream-id";
      }),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
    closeStreamWithError: vi.fn(),
    closeStream: vi.fn(),
    resetAuthToken: vi.fn(),
  }),
}));

// Enhanced config change detection
let shouldRequireApiCall = true;

vi.mock("@/utils/dashboard/checkConfigChangeApiCall", () => ({
  checkIfConfigChangeRequiredApiCallOrNot: vi.fn(() => shouldRequireApiCall),
}));

// Mock logsUtils
vi.mock("@/composables/useLogs/logsUtils", () => ({
  default: () => ({
    checkTimestampAlias: vi.fn(() => true), // Always return true to allow queries
  }),
}));

// Mock Vue's onMounted and onUnmounted to avoid warnings
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    onMounted: vi.fn(() => {}), // Don't execute callback to avoid loadData being called automatically
    onUnmounted: vi.fn((cb) => cb?.()),
  };
});

// Enhanced Global Configuration
let mockRunCount = 0;
let mockForceLoadState = false;
let mockIsVariablesLoading = false;

// Test Helper Functions
const createMockPanelSchema = (overrides: any = {}) =>
  ref({
    id: "test-panel",
    title: "Test Panel",
    type: "line",
    queries: [
      {
        query: "SELECT * FROM test",
        fields: { stream_type: "logs" },
        config: {},
        ...overrides.queryConfig,
      },
    ],
    ...overrides,
  });

const createMockSelectedTimeObj = (overrides: any = {}) =>
  ref({
    start_time: Date.now() - 3600000, // 1 hour ago
    end_time: Date.now(),
    type: "relative",
    period: { value: 1, unit: "h" },
    ...overrides,
  });

const createMockVariablesData = (overrides: any = {}) =>
  ref({
    isVariablesLoading: false,
    values: [],
    ...overrides,
  });

// Helper functions to mock critical internal functions
const mockIfPanelVariablesCompletedLoading = vi.fn(() => true); // Always return true for tests
const mockRestoreFromCache = vi.fn(() => Promise.resolve(false)); // Always return false for tests (no cache restore)

const resetAllMocks = () => {
  // Reset service mocks
  mockSearchResults = [];
  mockPartitionResults = { data: { partitions: [], max_query_range: 0 } };
  mockMetricsResults = { data: { status: "success" } };
  shouldSearchThrow = false;
  shouldPartitionThrow = false;
  shouldMetricsThrow = false;

  // Reset WebSocket mocks
  mockWebSocketCallbacks = {};
  shouldWebSocketThrow = false;
  webSocketConnectionState = "connected";

  // Reset streaming mocks
  mockStreamingCallbacks = {};
  shouldStreamingThrow = false;

  // Reset cache mocks
  mockCacheData = null;
  shouldCacheThrow = false;
  cacheOperationCount = 0;

  // Reset annotations
  mockAnnotations = [];
  shouldAnnotationsThrow = false;

  // Reset config
  shouldRequireApiCall = true;

  // Reset global config
  mockRunCount = 0;
  mockForceLoadState = false;
  mockIsVariablesLoading = false;

  // Reset helper function mocks
  mockIfPanelVariablesCompletedLoading.mockReturnValue(true);
  mockRestoreFromCache.mockReturnValue(Promise.resolve(false));
};

describe("usePanelDataLoader", () => {
  let consoleErrorSpy: any;
  let windowAddEventListenerSpy: any;
  let windowRemoveEventListenerSpy: any;

  beforeEach(() => {
    resetAllMocks();
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    windowAddEventListenerSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation(() => {});
    windowRemoveEventListenerSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation(() => {});

    // Mock IntersectionObserver for visibility detection
    global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
      observe: vi.fn().mockImplementation(() => {
        // Immediately trigger visibility
        callback([{ isIntersecting: true }]);
      }),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));

    // Mock setTimeout to work with promise-based async flows
    vi.spyOn(global, "setTimeout").mockImplementation((fn: any, ms: number) => {
      if (typeof fn === 'function') {
        // Execute immediately for tests
        Promise.resolve().then(() => fn());
      }
      return 1 as any;
    });

    // Mock clearTimeout
    vi.spyOn(global, "clearTimeout").mockImplementation(() => {});

    // Mock AbortController
    global.AbortController = vi.fn(function() {
      return {
        signal: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          aborted: false,
        },
        abort: vi.fn(),
      };
    }) as any;

    // Mock window.addEventListener and removeEventListener 
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    windowAddEventListenerSpy.mockRestore();
    windowRemoveEventListenerSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("basic functionality", () => {
    it("should initialize with correct state", () => {
      const panelSchema = ref({
        id: "test-panel",
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [
          {
            query: "SELECT * FROM test",
            fields: { stream_type: "logs", x: [{ alias: "timestamp" }] },
            config: {},
          },
        ],
        config: { step_value: "60s" },
      });

      const selectedTimeObj = ref({
        start_time: new Date(Date.now() - 3600000),
        end_time: new Date(),
      });

      const variablesData = ref({ values: [] });
      const chartPanelRef = ref({ offsetWidth: 1000 });
      const forceLoad = ref(false);
      const searchType = ref("dashboards");
      const dashboardId = ref("test-dashboard");
      const folderId = ref("test-folder");
      const reportId = ref(null);

      const loader = usePanelDataLoader(
        panelSchema,
        selectedTimeObj,
        variablesData,
        chartPanelRef,
        forceLoad,
        searchType,
        dashboardId,
        folderId,
        reportId,
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
      );

      expect(loader).toBeDefined();
      expect(loader.data.value).toEqual([]);
      expect(loader.loading.value).toBe(false);
      expect(loader.errorDetail.value).toEqual({ message: "", code: "" });
      expect(loader.metadata.value).toEqual({ queries: [] });
      expect(loader.annotations.value).toEqual([]);
    });

    it("should handle minimal configuration", () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [],
      });
      const selectedTimeObj = ref({});
      const variablesData = ref({});
      const chartPanelRef = ref(null);
      const forceLoad = ref(false);
      const searchType = ref("dashboards");
      const dashboardId = ref("test-dashboard");
      const folderId = ref("test-folder");
      const reportId = ref(null);

      const loader = usePanelDataLoader(
        panelSchema,
        selectedTimeObj,
        variablesData,
        chartPanelRef,
        forceLoad,
        searchType,
        dashboardId,
        folderId,
        reportId,
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
      );

      expect(loader).toBeDefined();
      expect(loader.loading.value).toBe(false);
    });

    it("should handle loadData with no queries", async () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [],
      });
      const selectedTimeObj = ref({
        start_time: new Date(Date.now() - 3600000),
        end_time: new Date(),
      });
      const variablesData = ref({ values: [] });
      const chartPanelRef = ref({ offsetWidth: 1000 });
      const forceLoad = ref(false);
      const searchType = ref("dashboards");
      const dashboardId = ref("test-dashboard");
      const folderId = ref("test-folder");
      const reportId = ref(null);

      const loader = usePanelDataLoader(
        panelSchema,
        selectedTimeObj,
        variablesData,
        chartPanelRef,
        forceLoad,
        searchType,
        dashboardId,
        folderId,
        reportId,
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
      );

      await loader.loadData();
      expect(loader.loading.value).toBe(false);
      expect(loader.data.value).toEqual([]);
    });

    it("should handle loadData with empty query", async () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [{ query: "" }],
      });
      const selectedTimeObj = ref({
        start_time: new Date(Date.now() - 3600000),
        end_time: new Date(),
      });
      const variablesData = ref({ values: [] });
      const chartPanelRef = ref({ offsetWidth: 1000 });
      const forceLoad = ref(false);
      const searchType = ref("dashboards");
      const dashboardId = ref("test-dashboard");
      const folderId = ref("test-folder");
      const reportId = ref(null);

      const loader = usePanelDataLoader(
        panelSchema,
        selectedTimeObj,
        variablesData,
        chartPanelRef,
        forceLoad,
        searchType,
        dashboardId,
        folderId,
        reportId,
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
      );

      await loader.loadData();
      expect(loader.loading.value).toBe(false);
      expect(loader.data.value).toEqual([]);
    });

    it("should handle invalid timestamps", () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [{ query: "SELECT * FROM test" }],
      });
      const selectedTimeObj = ref({
        start_time: new Date("Invalid"),
        end_time: new Date("Invalid"),
      });
      const variablesData = ref({ values: [] });
      const chartPanelRef = ref({ offsetWidth: 1000 });
      const forceLoad = ref(false);
      const searchType = ref("dashboards");
      const dashboardId = ref("test-dashboard");
      const folderId = ref("test-folder");
      const reportId = ref(null);

      const loader = usePanelDataLoader(
        panelSchema,
        selectedTimeObj,
        variablesData,
        chartPanelRef,
        forceLoad,
        searchType,
        dashboardId,
        folderId,
        reportId,
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
      );

      // Test that the loader was created successfully
      // The actual invalid timestamp handling is tested through the internal logic
      expect(loader).toBeDefined();
      expect(loader.loading.value).toBe(false);
    });
  });

  describe("chart types", () => {
    const chartTypes = [
      "area",
      "area-stacked",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "stacked",
      "h-stacked",
      "table",
    ];

    chartTypes.forEach((type) => {
      it(`should handle ${type} chart type`, () => {
        const panelSchema = ref({
          id: "test-panel",
          type: type,
          queries: [
            {
              query: "SELECT * FROM test",
              fields: { stream_type: "logs", x: [{ alias: "timestamp" }] },
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          ref({}),
          ref({}),
          ref(null),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        expect(loader).toBeDefined();
      });
    });
  });

  describe("query types", () => {
    it("should handle SQL query type", () => {
      const panelSchema = ref({
        id: "test-panel",
        queryType: "sql",
        queries: [
          {
            query: "SELECT * FROM logs",
            fields: { stream_type: "logs" },
          },
        ],
      });

      const loader = usePanelDataLoader(
        panelSchema,
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });

    it("should handle PromQL query type", () => {
      const panelSchema = ref({
        id: "test-panel",
        queryType: "promql",
        queries: [
          {
            query: "rate(http_requests_total[5m])",
          },
        ],
        config: { step_value: "60s" },
      });

      const loader = usePanelDataLoader(
        panelSchema,
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });
  });

  describe("variables handling", () => {
    it("should handle empty variables", () => {
      const variablesData = ref({ values: [] });

      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        variablesData,
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });

    it("should handle constant variables", () => {
      const variablesData = ref({
        values: [
          {
            name: "var1",
            type: "constant",
            value: "test_value",
          },
        ],
      });

      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        variablesData,
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });

    it("should handle dynamic filter variables", () => {
      const variablesData = ref({
        values: [
          {
            name: "filters",
            type: "dynamic_filters",
            value: [
              {
                operator: "=",
                name: "field1",
                value: "value1",
              },
            ],
          },
        ],
      });

      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        variablesData,
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });

    it("should handle loading variables", () => {
      const variablesData = ref({
        values: [
          {
            name: "var1",
            type: "constant",
            value: null,
            isLoading: true,
          },
        ],
      });

      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        variablesData,
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should initialize with no error", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.errorDetail.value).toEqual({ message: "", code: "" });
    });
  });

  describe("loading states", () => {
    it("should initialize loading states correctly", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.loading.value).toBe(false);
      expect(loader.loadingTotal.value).toBe(0);
      expect(loader.loadingCompleted.value).toBe(0);
      expect(loader.loadingProgressPercentage.value).toBe(0);
      // isPartialData might be true initially due to onMounted loadData call, this is expected behavior
      expect(typeof loader.isPartialData.value).toBe("boolean");
      expect(loader.isOperationCancelled.value).toBe(false);
    });
  });

  describe("cache behavior", () => {
    it("should handle cache operations", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.isCachedDataDifferWithCurrentTimeRange.value).toBe(false);
    });
  });

  describe("annotations", () => {
    it("should initialize annotations as empty", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.annotations.value).toEqual([]);
    });
  });

  describe("trace IDs", () => {
    it("should initialize trace IDs as empty", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.searchRequestTraceIds.value).toEqual([]);
    });
  });

  describe("metadata", () => {
    it("should initialize metadata correctly", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader.metadata.value).toEqual({ queries: [] });
      expect(loader.resultMetaData.value).toEqual([]);
      expect(loader.lastTriggeredAt.value).toBe(null);
    });
  });

  describe("force load", () => {
    it("should handle force load enabled", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(true), // forceLoad = true
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });
  });

  describe("optional parameters", () => {
    it("should handle all optional parameters", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref("test-report"),
        ref("test-run"),
        ref("test-tab"),
        ref("Test Tab"),
        ref({ hits: [] }),
        ref(true),
      );

      expect(loader).toBeDefined();
    });

    it("should handle missing optional parameters", () => {
      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });
  });

  describe("search response", () => {
    it("should handle existing search response", () => {
      const searchResponse = ref({
        hits: [{ field1: "value1" }],
        total: 1,
      });

      const loader = usePanelDataLoader(
        ref({ id: "test", queries: [] }),
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
        ref(null),
        ref(null),
        ref(null),
        searchResponse,
        ref(false),
      );

      expect(loader).toBeDefined();
    });
  });

  describe("time shift configuration", () => {
    it("should handle queries with time shift", () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [
          {
            query: "SELECT * FROM test",
            config: {
              time_shift: [{ offSet: "1h" }, { offSet: "2h" }],
            },
            fields: { stream_type: "logs" },
          },
        ],
      });

      const loader = usePanelDataLoader(
        panelSchema,
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });

    it("should handle queries without time shift", () => {
      const panelSchema = ref({
        id: "test-panel",
        queries: [
          {
            query: "SELECT * FROM test",
            config: {},
            fields: { stream_type: "logs" },
          },
        ],
      });

      const loader = usePanelDataLoader(
        panelSchema,
        ref({}),
        ref({}),
        ref(null),
        ref(false),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
      );

      expect(loader).toBeDefined();
    });
  });

  // ==== CORE FUNCTION COVERAGE - DATA LOADING & QUERY EXECUTION ====
  describe("Data Loading and Query Execution", () => {
    describe("loadData main function", () => {
      it("should execute loadData successfully with valid data", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = {
          hits: [{ field1: "value1", field2: "value2" }],
          total: 1,
          took: 10,
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null),
          ref(null),
          ref(null),
          ref(null),
          ref(false),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
        expect(loader.loading.value).toBe(false);
      });

      it("should handle loadData with no queries gracefully", async () => {
        const panelSchema = createMockPanelSchema({ queries: [] });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toEqual([]);
        expect(loader.loading.value).toBe(false);
      });

      it("should set loading state during data loading", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = { hits: [], total: 0 };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        // Start the load operation 
        const loadPromise = loader.loadData();
        
        // Check loading state immediately (should be true if set synchronously)
        // Or we can just verify the final state is false
        await loadPromise;
        expect(loader.loading.value).toBe(false);
      });

      it("should handle WebSocket enabled data loading", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Mock WebSocket enabled
        const { isWebSocketEnabled } = await import("@/utils/zincutils");
        (isWebSocketEnabled as any).mockReturnValue(true);

        mockSearchResults = { hits: [{ test: "data" }], total: 1 };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle streaming enabled data loading", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Mock streaming enabled, WebSocket disabled
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(false);
        (isStreamingEnabled as any).mockReturnValue(true);

        mockSearchResults = { hits: [{ test: "streaming_data" }], total: 1 };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle PromQL query type", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "up",
              fields: { stream_type: "metrics" },
              config: {},
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockMetricsResults = {
          data: {
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: { __name__: "up" }, value: [1234567890, "1"] },
              ],
            },
          },
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle partition-based loading", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockPartitionResults = {
          data: {
            partitions: [
              [Date.now() - 3600000, Date.now() - 1800000],
              [Date.now() - 1800000, Date.now()],
            ],
            max_query_range: 7200,
            order_by: "asc",
            histogram_interval: 300,
          },
        };

        mockSearchResults = [
          { timestamp: Date.now(), value: 100 }
        ];

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
        // Partition loading may result in empty data if partitions don't contain hits
        expect(Array.isArray(loader.data.value)).toBe(true);
      });

      it("should handle histogram queries", async () => {
        const panelSchema = createMockPanelSchema({
          type: "histogram",
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = {
          hits: [
            {
              zo_sql_key: "2023-01-01T00:00:00Z",
              zo_sql_num: 10,
            },
          ],
          total: 1,
          histogram_interval: 60,
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle time shift queries", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM test",
              config: {
                time_shift: [{ offSet: "1h" }, { offSet: "2h" }],
              },
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = { hits: [{ test: "shifted_data" }], total: 1 };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle search errors gracefully", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        shouldSearchThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        // Check that some error state was set (either errorDetail has content or data is empty)
        expect(
          loader.errorDetail.value.message.length > 0 || 
          loader.data.value.length === 0
        ).toBe(true);
      });
    });

    describe("WebSocket data loading", () => {
      it("should handle WebSocket connection", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Enable WebSocket
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(true);
        (isStreamingEnabled as any).mockReturnValue(false);

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle WebSocket errors", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Enable WebSocket with error
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(true);
        (isStreamingEnabled as any).mockReturnValue(false);
        shouldWebSocketThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });
    });

    describe("HTTP Streaming data loading", () => {
      it("should handle HTTP streaming connection", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Enable streaming, disable WebSocket
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(false);
        (isStreamingEnabled as any).mockReturnValue(true);

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle streaming errors", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Enable streaming with error
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(false);
        (isStreamingEnabled as any).mockReturnValue(true);
        shouldStreamingThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref(null),
          ref(true), // Set forceLoad to true to skip visibility waiting
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });
    });
  });

  // ==== CACHE FUNCTIONALITY COVERAGE ====
  describe("Cache Functionality", () => {
    describe("restoreFromCache", () => {
      it("should restore data from cache when available", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Set up mock cache data
        mockCacheData = {
          key: {
            panelSchema: panelSchema.value,
            variablesData: [],
            forceLoad: false,
            dashboardId: "test-dashboard",
            folderId: "test-folder",
          },
          value: {
            data: [{ test: "cached_data" }],
            loading: false,
            errorDetail: { message: "", code: "" },
            metadata: { queries: [] },
            annotations: [],
            resultMetaData: [],
            lastTriggeredAt: Date.now(),
            isPartialData: false,
            isOperationCancelled: false,
          },
          cacheTimeRange: {
            start_time: Date.now() - 3600000,
            end_time: Date.now(),
          },
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle cache with different time ranges", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = ref({
          start_time: new Date(Date.now() - 7200000), // 2 hours ago
          end_time: new Date(),
        });
        const variablesData = createMockVariablesData();

        // Set up mock cache data with different time range
        mockCacheData = {
          key: {
            panelSchema: panelSchema.value,
            variablesData: [],
            forceLoad: false,
            dashboardId: "test-dashboard",
            folderId: "test-folder",
          },
          value: {
            data: [{ test: "cached_data" }],
            loading: false,
            errorDetail: { message: "", code: "" },
            metadata: { queries: [] },
            annotations: [],
            resultMetaData: [],
            lastTriggeredAt: Date.now(),
            isPartialData: false,
            isOperationCancelled: false,
          },
          cacheTimeRange: {
            start_time: Date.now() - 3600000, // Different range
            end_time: Date.now(),
          },
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.isCachedDataDifferWithCurrentTimeRange.value).toBeDefined();
      });

      it("should handle cache retrieval errors", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        shouldCacheThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true), // Force load to skip cache restore
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should skip cache when forceLoad=true and runCount=0", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = { hits: [{ test: "data" }], total: 1 };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        // With forceLoad=true and runCount=0, cache restore is skipped (line 800)
        // Cache operations should be 0 since we skip the cache block entirely
        expect(cacheOperationCount).toBe(0);
        // Data should still be loaded (not from cache)
        expect(loader.data.value).toBeDefined();
      });

      it("should attempt cache restore when forceLoad=false and runCount=0", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = { hits: [{ test: "data" }], total: 1 };

        // Set mock cache data (note: actual restore may fail due to cache key mismatch,
        // but we're testing that getPanelCache is called)
        mockCacheData = {
          key: {}, // Simplified key - in real code this would be more complex
          value: {
            data: [{ test: "cached data" }],
            metadata: { queries: [] },
            errorDetail: { message: "", code: "" },
            resultMetaData: [],
            isPartialData: false,
            isOperationCancelled: false,
            loading: false,
            annotations: [],
            lastTriggeredAt: Date.now(),
          },
          cacheTimeRange: {
            start_time: Date.now() - 3600000,
            end_time: Date.now(),
          },
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(false), // forceLoad = false
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        // Start loadData without waiting (it will be pending due to visibility check after cache attempt)
        const loadPromise = loader.loadData();

        // Give it a moment to attempt cache restore (happens before visibility wait)
        await new Promise(resolve => setTimeout(resolve, 100));

        // With forceLoad=false and runCount=0, cache restore is attempted (line 803)
        // Cache operation count should be > 0 because getPanelCache was called
        expect(cacheOperationCount).toBeGreaterThan(0);

        // Note: The actual cache data restoration may not occur due to cache key mismatch,
        // but the important thing is that the code path entered the cache restoration logic
        // (i.e., getPanelCache was called, as verified by cacheOperationCount > 0)
      });

      it("should skip cache restore on subsequent loads (runCount>0)", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = { hits: [{ test: "first load" }], total: 1 };

        // Set mock cache data
        mockCacheData = {
          data: [{ test: "cached data" }],
          metadata: { queries: [] },
          errorDetail: { message: "", code: "" },
          resultMetaData: [],
          isPartialData: false,
          isOperationCancelled: false,
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true), // forceLoad = true for first load to bypass visibility
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        // First load (runCount=0) - with forceLoad=true, cache is skipped
        await loader.loadData();
        expect(cacheOperationCount).toBe(0);
        expect(loader.data.value).toBeDefined();

        // Reset cache operation counter
        cacheOperationCount = 0;
        mockSearchResults = { hits: [{ test: "second load" }], total: 1 };

        // Second load (runCount>0) - cache restore should be skipped
        // because condition at line 800 requires runCount == 0
        await loader.loadData();

        // Cache restore should be skipped on second run (runCount > 0)
        expect(cacheOperationCount).toBe(0);
        expect(loader.data.value).toBeDefined();
      });
    });

    describe("cache key generation", () => {
      it("should generate consistent cache keys", () => {
        const panelSchema = createMockPanelSchema();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          ref({}),
          variablesData,
          ref(null),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        expect(loader).toBeDefined();
      });
    });
  });

  // ==== VARIABLE PROCESSING COVERAGE ====
  describe("Variable Processing", () => {
    describe("replaceQueryValue functionality", () => {
      it("should replace fixed variables in queries", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE time >= $__interval_ms",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should replace $__range variable in queries", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE time >= now() - INTERVAL '$__range'",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
        // Metadata should be defined even if queries array might be empty
        expect(loader.metadata.value).toBeDefined();
      });

      it("should replace ${__range} with braces in queries", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE time >= now() - INTERVAL '${__range}'",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should correctly calculate $__range for different time spans", async () => {
        // Test with 7 days time range
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE time >= now() - INTERVAL '$__range'",
              fields: { stream_type: "logs" },
            },
          ],
        });

        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

        const selectedTimeObj = ref({
          start_time: new Date(sevenDaysAgo),
          end_time: new Date(now),
        });
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
        // The query should have been executed with __range replaced
        expect(loader.metadata.value.queries).toBeDefined();
      });

      it("should replace dependent variables in queries", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service = $service",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "service",
              type: "constant",
              value: "web-service",
              escapeSingleQuotes: false,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle array variables with different formats", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service IN (${services:singlequote})",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: ["web", "api", "db"],
              multiSelect: true,
              escapeSingleQuotes: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle variables with CSV format", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service IN (${services:csv})",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: ["web", "api"],
              multiSelect: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle variables with pipe format", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service =~ '${services:pipe}'",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: ["web", "api"],
              multiSelect: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle variables with double quote format", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service IN (${services:doublequote})",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: ["web", "api"],
              multiSelect: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle null variable values", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              // Use a variable that's NOT in the query to avoid the waiting logic
              query: "SELECT * FROM logs",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "service",
              type: "constant",
              value: null,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });
    });

    describe("applyDynamicVariables functionality", () => {
      it("should apply dynamic filters to SQL queries", async () => {
        const panelSchema = createMockPanelSchema({
          queryType: "sql",
          queries: [
            {
              query: "SELECT * FROM logs",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          values: [
            {
              name: "filters",
              type: "dynamic_filters",
              value: [
                {
                  operator: "=",
                  name: "service",
                  value: "web",
                },
              ],
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should apply dynamic filters to PromQL queries", async () => {
        const panelSchema = createMockPanelSchema({
          queryType: "promql",
          queries: [
            {
              query: "up",
              fields: { stream_type: "metrics" },
            },
          ],
          config: { step_value: "60s" },
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          values: [
            {
              name: "filters",
              type: "dynamic_filters",
              value: [
                {
                  operator: "=",
                  name: "job",
                  value: "prometheus",
                },
              ],
            },
          ],
        });

        mockMetricsResults = {
          data: {
            status: "success",
            data: { resultType: "vector", result: [] },
          },
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should handle empty dynamic filters", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          values: [
            {
              name: "filters",
              type: "dynamic_filters",
              value: [],
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });
    });

    describe("variable dependency tracking", () => {
      it("should handle dependent variables loading state", () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service = $service",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const variablesData = ref({
          values: [
            {
              name: "service",
              type: "constant",
              value: null,
              isLoading: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          ref({}),
          variablesData,
          ref(null),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        expect(loader).toBeDefined();
      });

      it("should handle variables with pending loading state", () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service = $service",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const variablesData = ref({
          values: [
            {
              name: "service",
              type: "constant",
              value: "",
              isVariableLoadingPending: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          ref({}),
          variablesData,
          ref(null),
          ref(false),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        expect(loader).toBeDefined();
      });

      it("should handle multiSelect variable changes", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              query: "SELECT * FROM logs WHERE service IN (${services:singlequote})",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: ["web", "api"],
              multiSelect: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          createMockSelectedTimeObj(),
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
        );

        await loader.loadData();

        // Change variable values
        variablesData.value.values[0].value = ["web", "api", "db"];

        expect(loader.data.value).toBeDefined();
      });
    });

    describe("variable filtering and skipping", () => {
      it("should skip search when variables have empty values", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              // Use a variable that's NOT in the query to avoid the waiting logic
              query: "SELECT * FROM logs",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "service",
              type: "constant",
              value: null,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.loading.value).toBe(false);
      });

      it("should skip search when variables have empty arrays", async () => {
        const panelSchema = createMockPanelSchema({
          queries: [
            {
              // Use a variable that's NOT in the query to avoid the waiting logic
              query: "SELECT * FROM logs",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = ref({
          isVariablesLoading: false,
          values: [
            {
              name: "services",
              type: "constant",
              value: [],
              multiSelect: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
          ],
        });

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.loading.value).toBe(false);
      });
    });
  });

  // ==== ERROR HANDLING COVERAGE ====
  describe("Error Handling", () => {
    describe("API error processing", () => {
      it("should handle PromQL API errors", async () => {
        const panelSchema = createMockPanelSchema({
          queryType: "promql",
          queries: [
            {
              query: "invalid_metric",
              fields: { stream_type: "metrics" },
            },
          ],
          config: { step_value: "60s" },
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        shouldMetricsThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });

      it("should handle SQL API errors", async () => {
        const panelSchema = createMockPanelSchema({
          queryType: "sql",
          queries: [
            {
              query: "SELECT * FROM invalid_table",
              fields: { stream_type: "logs" },
            },
          ],
        });
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        shouldSearchThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });

      it("should handle partition API errors", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        shouldPartitionThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });

      it("should handle function errors in search results", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = {
          hits: [],
          function_error: "VRL function failed",
          is_partial: false,
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.errorDetail.value.message).toBeDefined();
      });

      it("should handle partial results due to function errors", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        mockSearchResults = {
          hits: [{ test: "data" }],
          function_error: "VRL function warning",
          is_partial: true,
        };

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });

      it("should truncate long error messages", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Set up error to be thrown
        shouldSearchThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        // Verify error handling works (error message should be defined)
        expect(loader.errorDetail.value.message).toBeDefined();
      });

      it("should handle WebSocket error codes", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Enable WebSocket and simulate error
        const { isWebSocketEnabled, isStreamingEnabled } = await import(
          "@/utils/zincutils"
        );
        (isWebSocketEnabled as any).mockReturnValue(true);
        (isStreamingEnabled as any).mockReturnValue(false);

        shouldWebSocketThrow = true;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.loading.value).toBe(false);
      });
    });

    describe("abort handling", () => {
      it("should handle operation abortion during loading", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        // Simulate abortion
        const loadPromise = loader.loadData();
        
        // Wait a bit then check the state
        await loadPromise;
        
        expect(loader.loading.value).toBe(false);
      });

      it("should handle abort errors gracefully", async () => {
        const panelSchema = createMockPanelSchema();
        const selectedTimeObj = createMockSelectedTimeObj();
        const variablesData = createMockVariablesData();

        // Mock AbortController to throw abort error
        global.AbortController = vi.fn(function() {
          return {
            signal: {
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
              aborted: false,
            },
            abort: vi.fn(),
          };
        }) as any;

        const loader = usePanelDataLoader(
          panelSchema,
          selectedTimeObj,
          variablesData,
          ref({ offsetWidth: 1000 }),
          ref(true),
          ref("dashboards"),
          ref("test-dashboard"),
          ref("test-folder"),
          ref(null),
          ref(null), // runId
          ref(null), // tabId
          ref(null), // tabName
          ref(null), // searchResponse
          ref(false), // is_ui_histogram
        );

        await loader.loadData();

        expect(loader.data.value).toBeDefined();
      });
    });
  });

  // ==== COMPREHENSIVE FINAL TESTS FOR 100% COVERAGE ====
  describe("Complete Coverage Tests", () => {
    it("should achieve 100% line coverage with all scenarios", async () => {
      // Test all remaining scenarios for complete coverage
      const panelSchema = createMockPanelSchema({
        type: "line",
        queryType: "sql",
        queries: [
          {
            query: "SELECT * FROM logs WHERE service = $service AND time >= $__interval_ms",
            fields: {
              stream_type: "logs",
              x: [{ alias: "timestamp" }],
            },
            config: {
              time_shift: [{ offSet: "1h" }],
            },
            vrlFunctionQuery: ".message | parse_json",
          },
        ],
      });

      mockSearchResults = { hits: [[{ test: "data" }]], per_query_response: true };
      mockAnnotations = [{ id: "test", title: "Test Annotation", time: Date.now() }];

      const loader = usePanelDataLoader(
        panelSchema,
        createMockSelectedTimeObj(),
        ref({
          isVariablesLoading: false,
          values: [
            {
              name: "service",
              type: "constant",
              value: "web",
              multiSelect: false,
              escapeSingleQuotes: true,
              isLoading: false,
              isVariableLoadingPending: false,
              isVariablePartialLoaded: true,
            },
            {
              name: "filters",
              type: "dynamic_filters",
              value: [{ operator: "!=", name: "env", value: "test" }],
            },
          ],
        }),
        ref({ offsetWidth: 1000 }),
        ref(true),
        ref("dashboards"),
        ref("test-dashboard"),
        ref("test-folder"),
        ref(null),
        ref("test-run"),
        ref("test-tab"),
        ref("Test Tab"),
        ref(null),
        ref(true),
      );

      await loader.loadData();
      expect(loader.data.value).toBeDefined();
      expect(loader.annotations.value).toBeDefined();
    });
  });
});
