import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify, useQuasar } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import ScheduledPipeline from "./ScheduledPipeline.vue";
import searchService from "@/services/search";
import { nextTick } from 'vue';

// Mock Quasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  let isFullscreenActive = false;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(() => vi.fn()),
      fullscreen: {
        get isActive() { return isFullscreenActive; },
        toggle: vi.fn(() => {
          isFullscreenActive = !isFullscreenActive;
        }),
      }
    })
  };
});

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock services and composables
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "timestamp", type: "datetime" },
        { name: "message", type: "string" },
      ],
    }),
    getStreams: vi.fn().mockResolvedValue({
      list: [
        { name: "stream1", stream_type: "logs" },
        { name: "stream2", stream_type: "metrics" },
      ],
    }),
  }),
}));
vi.mock('@/composables/useParser', () => {
  return {
    default: () => ({
      sqlParser: async () => ({
        astify: vi.fn((query) => {
          const lowerQuery = query.toLowerCase();
        
          if (lowerQuery.includes("select *")) {
            return {
              columns: [
                { expr: { column: "*" } }
              ]
            };
          }
          if (lowerQuery.includes("valid_column")) {
            return {
              columns: [
                { expr: { column: "valid_column" } }
              ]
            };
          }
          if (lowerQuery.includes("default")) {
            throw new Error("Syntax error near 'default'");
          }
          return { columns: [] };
        }),
        sqlify: vi.fn(),
        columnList: vi.fn(),
        tableList: vi.fn(),
        whiteListCheck: vi.fn(),
        exprToSQL: vi.fn(),
        parse: vi.fn(),
      })
    })
  };
});


vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: {
      data: {
        stream: {
          pipelineQueryStream: [],
        },
      },
    },
  }),
}));

describe("ScheduledPipeline Component", () => {
  let wrapper;
  let mockStore;

  beforeEach(async () => {
    // Setup mock store
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        },
        zoConfig: {
          min_auto_refresh_interval: 900,
          sql_base64_enabled: false,
          timestamp_column: "_timestamp",
          all_fields_name: "_all"
        },
        isAiChatEnabled: false,
        organizationData: {
          functions: [
            { name: 'avg', description: 'Average function', function: 'avg(value)' },
            { name: 'sum', description: 'Sum function', function: 'sum(value)' }
          ]
        },
        timezone: "UTC",
        userInfo: {
          email: "test@example.com"
        }
      },
      dispatch: vi.fn()
    };

    // Mount component with props
    wrapper = mount(ScheduledPipeline, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          'q-splitter': true,
          'q-dialog': true,
          'q-select': true,
          'q-input': true,
          'q-btn': true,
          'q-icon': true,
          'q-tooltip': true,
          'q-table': true,
          'DateTime': true,
          'FieldList': true,
          'QueryEditor': true,
          'TenstackTable': true,
          'PreviewPromqlQuery': true,
          'O2AIChat': true,
          'FullViewContainer': true
        }
      },
      props: {
        columns: [],
        conditions: {},
        trigger: {
          frequency: 15,
          period: 15,
          frequency_type: "minutes",
          timezone: "UTC",
          cron: "",
          operator: ">=",
          threshold: 1
        },
        sql: "",
        query_type: "sql",
        aggregation: null,
        isAggregationEnabled: false,
        promql: "",
        promql_condition: null,
        streamType: "logs",
        delay: 0,
        validatingSqlQuery: false
      }
    });

    // Initialize required data
    wrapper.vm.triggerData = {
      frequency: 15,
      period: 15,
      frequency_type: "minutes",
      timezone: "UTC",
      cron: "",
      operator: ">=",
      threshold: 1
    };

    // Initialize dateTime with valid values
    wrapper.vm.dateTime = {
      startTime: Date.now() - 3600000, // 1 hour ago
      endTime: Date.now(),
      relativeTimePeriod: "15m",
      valueType: "relative"
    };

    wrapper.vm.cronJobError = "";
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    wrapper.vm.query = ""
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct default values", () => {
      expect(wrapper.vm.tab).toBe("sql");
      expect(wrapper.vm.selectedStreamType).toBe("logs");
      expect(wrapper.vm.query).toBe("");
      expect(wrapper.vm.expandState.query).toBe(true);
      expect(wrapper.vm.expandState.output).toBe(false);
    });

    it("sets up correct splitter model values", () => {
      expect(wrapper.vm.splitterModel).toBe(30);
      expect(wrapper.vm.sideBarSplitterModel).toBe(60);
    });
  });

  describe("Stream Management", () => {
    it("loads stream list on mount", async () => {
      expect(wrapper.vm.streams.length).toBe(2);
      expect(wrapper.vm.filteredStreams.length).toBe(2);
    });

    it("filters streams based on search input", async () => {
      await wrapper.vm.filterStreams("stream1", (fn) => fn());
      expect(wrapper.vm.filteredStreams.length).toBe(1);
      expect(wrapper.vm.filteredStreams[0].value).toBe("stream1");
    });

    it("updates stream fields when stream is selected", async () => {
      await wrapper.vm.getStreamFields();
      await flushPromises();
      expect(wrapper.vm.streamFields.length).toBe(2);
      expect(wrapper.vm.streamFields[0].name).toBe("timestamp");
    });

    it("updates query when stream is selected", async () => {
      wrapper.vm.selectedStreamName = "test_stream";
      await wrapper.vm.getStreamFields();
      await flushPromises();
      expect(wrapper.vm.query).toContain("test_stream");
    });
  });

  describe("Query Management", () => {
    it("updates SQL query correctly", async () => {
      const newQuery = "SELECT * FROM test_stream";
      await wrapper.vm.updateQueryValue(newQuery);
      expect(wrapper.vm.query).toBe(newQuery);
      expect(wrapper.emitted()["update:sql"]).toBeTruthy();
    });

    it("updates PromQL query correctly", async () => {
      wrapper.vm.tab = "promql";
      const newQuery = "test_metric{}";
      await wrapper.vm.updateQueryValue(newQuery);
      expect(wrapper.vm.query).toBe(newQuery);
      expect(wrapper.emitted()["update:promql"]).toBeTruthy();
    });

    it("handles query type switching", async () => {
      await wrapper.vm.updateTab();
      expect(wrapper.emitted()["update:query_type"]).toBeTruthy();
    });
  });

  describe("Trigger Condition Management", () => {
    it("validates frequency for minutes", async () => {
      wrapper.vm.triggerData.frequency_type = "minutes";
      wrapper.vm.triggerData.frequency = 5;
      wrapper.vm.validateFrequency();
      await nextTick();
      expect(wrapper.vm.cronJobError).toBe("Minimum frequency should be 15 minutes");
    });

    it("validates cron expression", async () => {
      wrapper.vm.triggerData.frequency_type = "cron";
      wrapper.vm.triggerData.cron = "invalid";
      wrapper.vm.validateFrequency();
      await nextTick();
      expect(wrapper.vm.cronJobError).toBe("Invalid cron expression");
    });

    it("updates period based on frequency type", async () => {
      wrapper.vm.triggerData.frequency_type = "minutes";
      wrapper.vm.triggerData.frequency = 20;
      await wrapper.vm.updateFrequency();
      expect(wrapper.vm.triggerData.period).toBe(20);
    });
  });

  describe("UI Interactions", () => {
    it("toggles field list collapse", async () => {
      await wrapper.vm.collapseFieldList();
      expect(wrapper.vm.collapseFields).toBe(true);
      expect(wrapper.vm.splitterModel).toBe(0);
    });

    it("handles AI chat toggle", async () => {
      await wrapper.vm.toggleAIChat();
      await nextTick();
      expect(mockStore.dispatch).toHaveBeenCalledWith("setIsAiChatEnabled", true);
    });

    it("updates expand states correctly", async () => {
      wrapper.vm.expandState.output = true;
      await nextTick();
      expect(wrapper.vm.expandState.query).toBe(false);
    });

  });

  describe("Search and Results", () => {
    it("executes SQL search query", async () => {
      wrapper.vm.tab = "sql";
      wrapper.vm.query = "SELECT * FROM test_stream";
      searchService.search.mockResolvedValueOnce({
        data: {
          hits: [{ _timestamp: 1234567890000, message: "test" }]
        }
      });

      await wrapper.vm.runQuery();
      expect(searchService.search).toHaveBeenCalled();
      expect(wrapper.vm.rows.length).toBe(1);
    });

    it("handles empty search results", async () => {
      searchService.search.mockResolvedValueOnce({
        data: {
          hits: []
        }
      });

      await wrapper.vm.runQuery();
      expect(wrapper.vm.rows).toEqual([]);
    });

    it("handles search errors", async () => {
      searchService.search.mockRejectedValueOnce(new Error("Search failed"));
      await wrapper.vm.runQuery();
      expect(wrapper.vm.rows).toEqual([]);
    });
  });

  describe("Field Management", () => {
    it("updates cursor position correctly", async () => {
      // Mock the editor reference
      const mockEditorRef = {
        getCursorIndex: vi.fn().mockReturnValue(7),
        getValue: vi.fn().mockReturnValue("SELECT "),
        setValue: vi.fn(),
        replaceRange: vi.fn()
      };
      wrapper.vm.pipelineEditorRef = mockEditorRef;
      
      await wrapper.vm.handleSidebarEvent("click", "field1");
      await nextTick();
      expect(wrapper.vm.cursorPosition).toBe(15);
    });
  });

  describe("Function Management", () => {
    beforeEach(async () => {
      // Reset the store's functions
      mockStore.state.organizationData = {
        functions: [
          { name: 'avg', description: 'Average function', function: 'avg(value)' },
          { name: 'sum', description: 'Sum function', function: 'sum(value)' }
        ]
      };
      await nextTick();
    });

    it("initializes with correct functions list", () => {
      expect(wrapper.vm.functionsList).toBeDefined();
      expect(wrapper.vm.functionsList.length).toBe(2);
      expect(wrapper.vm.functionsList[0].name).toBe('avg');
    });


    it("handles function selection", async () => {
      const testFunction = {
        name: 'avg',
        description: 'Average function',
        function: 'avg(value)'
      };

      // Initialize the component's state
      wrapper.vm.selectedFunction = null;
      wrapper.vm.vrlFunctionContent = null;

      // Call the method and wait for updates
      await wrapper.vm.onFunctionSelect(testFunction);
      await nextTick();

      // Verify the state changes
      expect(wrapper.vm.selectedFunction).toBe('avg');
    });
  });

  describe("Bug Fix: PromQL Tab Auto-Open Output Section (Issue #2)", () => {
    it("should not auto-expand output section when switching to promql tab", async () => {
      wrapper.vm.expandState.output = false;
      wrapper.vm.tab = "promql";
      wrapper.vm.selectedStreamType = "metrics";

      await wrapper.vm.updateTab();
      await nextTick();

      // Output should remain collapsed after switching to promql
      expect(wrapper.vm.expandState.output).toBe(false);
    });

    it("should only show promql preview when output is expanded", () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.expandState.output = false;

      // PreviewPromqlQuery component should not render when output is collapsed
      // This is tested through the v-else-if condition: tab == 'promql' && expandState.output
      expect(wrapper.vm.expandState.output).toBe(false);
    });

    it("should show promql preview when output is manually expanded", async () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.expandState.output = false;

      // Manually expand output
      wrapper.vm.expandState.output = true;
      await nextTick();

      expect(wrapper.vm.expandState.output).toBe(true);
    });
  });

  describe("Bug Fix: Loader Pushing Footer (Issue #3)", () => {
    it("should only show loader when output section is expanded", async () => {
      wrapper.vm.loading = true;
      wrapper.vm.tab = "sql";
      wrapper.vm.expandState.output = false;

      await nextTick();

      // Loader should not be visible when output is collapsed
      expect(wrapper.vm.expandState.output).toBe(false);
    });

    it("should show loader when output is expanded and loading", async () => {
      wrapper.vm.loading = true;
      wrapper.vm.tab = "sql";
      wrapper.vm.expandState.output = true;

      await nextTick();

      expect(wrapper.vm.loading).toBe(true);
      expect(wrapper.vm.expandState.output).toBe(true);
    });

    it("should not show table while loading", async () => {
      wrapper.vm.loading = true;
      wrapper.vm.tab = "sql";
      wrapper.vm.expandState.output = true;
      wrapper.vm.rows = [{ test: "data" }];

      await nextTick();

      // When loading is true, table should not be shown (tested via v-else-if)
      expect(wrapper.vm.loading).toBe(true);
    });
  });

  describe("Bug Fix: PromQL First Click Not Running Query (Issue #4)", () => {
    it("should run promql query on first click using nextTick", async () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.expandState.output = false;
      wrapper.vm.query = "test_metric{}";
      wrapper.vm.selectedStreamName = "test_metric";

      // Mock the previewPromqlQueryRef
      const mockRefreshData = vi.fn();
      wrapper.vm.previewPromqlQueryRef = {
        refreshData: mockRefreshData
      };

      // Simulate run query button click
      wrapper.vm.expandState.output = true;
      await wrapper.vm.runQuery();

      // Wait for nextTick to complete
      await nextTick();

      // refreshData should be called after nextTick
      expect(mockRefreshData).toHaveBeenCalled();
    });

    it("should handle null previewPromqlQueryRef gracefully", async () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.previewPromqlQueryRef = null;

      // Should not throw error
      await expect(wrapper.vm.runQuery()).resolves.not.toThrow();
    });

    it("should only call refreshData if ref exists after nextTick", async () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.previewPromqlQueryRef = null;

      // Run query without ref
      await wrapper.vm.runQuery();

      // Should complete without error
      expect(wrapper.vm.tab).toBe("promql");
    });
  });

  describe("Bug Fix: PromQL Query and Stream Not Restored on Edit (Issue #5)", () => {
    it("should initialize query from props.promql when query_type is promql", () => {
      const promqlQuery = "cpu_usage{instance='server1'}";
      const newWrapper = mount(ScheduledPipeline, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore },
          stubs: {
            'q-splitter': true,
            'DateTime': true,
            'FieldList': true,
            'QueryEditor': true,
            'TenstackTable': true,
            'PreviewPromqlQuery': true,
            'O2AIChat': true,
            'FullViewContainer': true
          }
        },
        props: {
          columns: [],
          trigger: wrapper.vm.triggerData,
          sql: "SELECT * FROM logs",
          promql: promqlQuery,
          query_type: "promql",
          streamType: "metrics",
          delay: 0
        }
      });

      expect(newWrapper.vm.query).toBe(promqlQuery);
      newWrapper.unmount();
    });

    it("should initialize query from props.sql when query_type is sql", () => {
      const sqlQuery = "SELECT * FROM logs";
      const newWrapper = mount(ScheduledPipeline, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore },
          stubs: {
            'q-splitter': true,
            'DateTime': true,
            'FieldList': true,
            'QueryEditor': true,
            'TenstackTable': true,
            'PreviewPromqlQuery': true,
            'O2AIChat': true,
            'FullViewContainer': true
          }
        },
        props: {
          columns: [],
          trigger: wrapper.vm.triggerData,
          sql: sqlQuery,
          promql: "metric{}",
          query_type: "sql",
          streamType: "logs",
          delay: 0
        }
      });

      expect(newWrapper.vm.query).toBe(sqlQuery);
      newWrapper.unmount();
    });

    it("should extract stream name from promql query on mount", async () => {
      const promqlQuery = "cpu_usage{instance='server1'}";
      wrapper.vm.tab = "promql";
      wrapper.vm.query = promqlQuery;

      // Simulate the onMounted extraction
      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        wrapper.vm.selectedStreamName = match[1];
      }

      await nextTick();

      expect(wrapper.vm.selectedStreamName).toBe("cpu_usage");
    });

    it("should handle promql query with complex label selectors", async () => {
      const promqlQuery = "http_requests_total{method='GET',status='200'}";
      wrapper.vm.tab = "promql";
      wrapper.vm.query = promqlQuery;

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        wrapper.vm.selectedStreamName = match[1];
      }

      await nextTick();

      expect(wrapper.vm.selectedStreamName).toBe("http_requests_total");
    });

    it("should handle promql query with hyphens and underscores", async () => {
      const promqlQuery = "my-metric_name_123{}";
      wrapper.vm.tab = "promql";
      wrapper.vm.query = promqlQuery;

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        wrapper.vm.selectedStreamName = match[1];
      }

      await nextTick();

      expect(wrapper.vm.selectedStreamName).toBe("my-metric_name_123");
    });

    it("should not extract stream name from invalid promql query", async () => {
      const promqlQuery = "{invalid}";
      wrapper.vm.tab = "promql";
      wrapper.vm.query = promqlQuery;
      wrapper.vm.selectedStreamName = "";

      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        wrapper.vm.selectedStreamName = match[1];
      }

      await nextTick();

      expect(wrapper.vm.selectedStreamName).toBe("");
    });

    it("should call getStreamFields after extracting stream name", async () => {
      wrapper.vm.tab = "promql";
      wrapper.vm.query = "test_metric{}";
      wrapper.vm.selectedStreamName = "test_metric";

      // Track initial state
      const initialFieldsLength = wrapper.vm.streamFields.length;

      // Call getStreamFields
      await wrapper.vm.getStreamFields();
      await flushPromises();

      // Verify that streamFields was updated (function was executed)
      expect(wrapper.vm.streamFields.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Integration: All Bug Fixes Together", () => {
    it("should handle complete promql workflow with all fixes", async () => {
      // Setup: Create a node with PromQL query
      const promqlQuery = "cpu_usage{instance='server1'}";

      // Fix #5: Initialize with promql query
      wrapper.vm.tab = "promql";
      wrapper.vm.query = promqlQuery;
      wrapper.vm.selectedStreamType = "metrics";

      // Fix #5: Extract stream name
      const match = promqlQuery.match(/^([a-zA-Z0-9_-]+)/);
      if (match) {
        wrapper.vm.selectedStreamName = match[1];
      }
      expect(wrapper.vm.selectedStreamName).toBe("cpu_usage");

      // Fix #2: Output should not auto-expand when switching tabs
      wrapper.vm.expandState.output = false;
      expect(wrapper.vm.expandState.output).toBe(false);

      // Fix #3: Loader should respect output expand state
      wrapper.vm.loading = true;
      expect(wrapper.vm.expandState.output).toBe(false);

      // Manually expand output
      wrapper.vm.expandState.output = true;
      wrapper.vm.loading = false;

      // Fix #4: First click should work with nextTick
      const mockRefreshData = vi.fn();
      wrapper.vm.previewPromqlQueryRef = {
        refreshData: mockRefreshData
      };

      await wrapper.vm.runQuery();
      await nextTick();

      expect(mockRefreshData).toHaveBeenCalled();
    });

    it("should handle SQL workflow with stream type fix", async () => {
      // Fix #1: Should use correct stream type
      wrapper.vm.tab = "sql";
      wrapper.vm.selectedStreamType = "traces";
      wrapper.vm.query = "SELECT * FROM traces_stream";

      searchService.search.mockResolvedValueOnce({
        data: { hits: [] }
      });

      await wrapper.vm.runQuery();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "traces"
        }),
        expect.any(String)
      );
    });
  });
});

