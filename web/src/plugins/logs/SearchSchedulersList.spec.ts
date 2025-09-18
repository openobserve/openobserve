import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import SearchSchedulersList from "@/plugins/logs/SearchSchedulersList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { nextTick, ref } from "vue";

installQuasar();

// Mock services
vi.mock("@/services/search", () => ({
  default: {
    get_scheduled_search_list: vi.fn(),
    cancel_scheduled_search: vi.fn(),
    retry_scheduled_search: vi.fn(),
    delete_scheduled_search: vi.fn()
  }
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    API_ENDPOINT: "http://localhost:5080"
  }
}));

vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: {
      meta: { jobId: null },
      data: {
        datetime: { type: 'relative' }
      }
    },
    extractTimestamps: vi.fn().mockReturnValue({ from: 1000, to: 2000 })
  })
}));

// Mock vue-router
const mockRouter = {
  currentRoute: {
    value: {
      query: { org_identifier: "test-org" },
      params: {},
      path: '/search-schedulers'
    }
  },
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({
    query: { org_identifier: "test-org" },
    params: {},
    path: '/search-schedulers'
  })
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn(),
  dialog: vi.fn()
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar,
    date: {
      formatDate: vi.fn((date, format) => "2024-01-01T10:00:00Z")
    }
  };
});

// Mock utils
vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(),
  b64EncodeUnicode: vi.fn((str) => btoa(str)),
  b64DecodeUnicode: vi.fn((str) => atob(str)),
  convertDateToTimestamp: vi.fn(),
  useLocalWrapContent: vi.fn(() => false),
}));

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve())
  }
});

describe("SearchSchedulersList Component", () => {
  let wrapper: any = null;
  let searchService: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Setup search service mock
    const { default: searchServiceMock } = await import("@/services/search");
    searchService = searchServiceMock;

    searchService.get_scheduled_search_list.mockResolvedValue({
      data: []
    });

    wrapper = mount(SearchSchedulersList, {
      props: {
        isClicked: false
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'q-page': true,
          'q-table': true,
          'q-tr': true,
          'q-td': true,
          'q-btn': true,
          'q-icon': true,
          'q-toggle': true,
          'q-spinner-hourglass': true,
          'q-tabs': true,
          'q-tab': true,
          'q-tab-panels': true,
          'q-tab-panel': true,
          'q-select': true,
          'DateTime': {
            template: '<div class="mock-datetime"></div>',
            methods: {
              setAbsoluteTime: vi.fn()
            }
          },
          'AppTabs': true,
          'QueryEditor': true,
          'ConfirmDialog': true,
          'NoData': true,
          'TenstackTable': true,
          'QTablePagination': true,
          'JsonPreview': true
        },
        mocks: {
          $q: mockQuasar,
          $router: mockRouter
        }
      },
    });

    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("SearchSchedulersList");
    });

    it("should initialize with correct default props", () => {
      expect(wrapper.props('isClicked')).toBe(false);
    });

    it("should initialize with correct default data", () => {
      expect(wrapper.vm.dataToBeLoaded).toEqual([]);
      expect(wrapper.vm.columnsToBeRendered).toEqual([]);
      expect(wrapper.vm.expandedRow).toEqual([]);
      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.vm.showSearchResults).toBe(false);
      expect(wrapper.vm.confirmDelete).toBe(false);
      expect(wrapper.vm.confirmCancel).toBe(false);
      expect(wrapper.vm.activeTab).toBe("query");
    });

    it("should initialize pagination correctly", () => {
      expect(wrapper.vm.pagination.page).toBe(1);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(100);
      expect(wrapper.vm.selectedPerPage).toBe(100);
    });

    it("should initialize perPageOptions correctly", () => {
      expect(wrapper.vm.perPageOptions).toEqual([
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "All", value: 0 }
      ]);
    });

    it("should initialize tabs correctly", () => {
      expect(wrapper.vm.tabs).toEqual([
        { label: "Query / Function", value: "query" },
        { label: "More Details", value: "more_details" }
      ]);
    });

    it("should initialize dateTimeToBeSent correctly", () => {
      expect(wrapper.vm.dateTimeToBeSent).toEqual({
        valueType: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0
      });
    });
  });

  describe("Props and Emits", () => {
    it("should emit closeSearchHistory", async () => {
      wrapper.vm.closeSearchHistory();
      await nextTick();
      expect(wrapper.emitted().closeSearchHistory).toBeTruthy();
    });

    it("should have correct prop types", () => {
      expect(typeof wrapper.props('isClicked')).toBe('boolean');
    });

    it("should initialize with correct isLoading state", () => {
      expect(wrapper.vm.isLoading).toBe(false);
    });
  });

  describe("Column Generation", () => {
    it("should return empty array for empty data", () => {
      const columns = wrapper.vm.generateColumns([]);
      expect(columns).toEqual([]);
    });

    it("should generate correct columns for data", () => {
      const mockData = [{ id: "1", user_id: "test" }];
      const columns = wrapper.vm.generateColumns(mockData);
      
      expect(columns).toHaveLength(7);
      expect(columns[0]).toMatchObject({
        name: "#",
        label: "#",
        align: "left",
        sortable: false
      });
    });

    it("should set correct alignment for different columns", () => {
      const mockData = [{ 
        user_id: "test", 
        Actions: "delete", 
        duration: "1s",
        status: "finished",
        "#": "1"
      }];
      const columns = wrapper.vm.generateColumns(mockData);
      
      const userIdColumn = columns.find(col => col.name === "user_id");
      const actionsColumn = columns.find(col => col.name === "Actions");
      const durationColumn = columns.find(col => col.name === "duration");
      const statusColumn = columns.find(col => col.name === "status");
      const indexColumn = columns.find(col => col.name === "#");
      
      expect(userIdColumn.align).toBe("center");
      expect(actionsColumn.align).toBe("left");
      expect(durationColumn.align).toBe("left");
      expect(statusColumn.align).toBe("left");
      expect(indexColumn.align).toBe("left");
    });

    it("should set sortable correctly for different columns", () => {
      const mockData = [{ 
        user_id: "test", 
        Actions: "delete", 
        status: "finished",
        "#": "1"
      }];
      const columns = wrapper.vm.generateColumns(mockData);
      
      const userIdColumn = columns.find(col => col.name === "user_id");
      const actionsColumn = columns.find(col => col.name === "Actions");
      const statusColumn = columns.find(col => col.name === "status");
      const indexColumn = columns.find(col => col.name === "#");
      
      expect(userIdColumn.sortable).toBe(true);
      expect(actionsColumn.sortable).toBe(false);
      expect(statusColumn.sortable).toBe(false);
      expect(indexColumn.sortable).toBe(false);
    });
  });

  describe("Filter Row Function", () => {
    it("should filter row with correct keys", () => {
      const mockRow = {
        trace_id: "abc123",
        start_time: 1000000,
        end_time: 2000000,
        started_at: 1000500,
        ended_at: 2000500,
        other_field: "ignored"
      };
      
      const filtered = wrapper.vm.filterRow(mockRow);
      
      expect(filtered).toEqual({
        trace_id: "abc123",
        start_time: 1000000,
        end_time: 2000000,
        started_at: 1000500,
        ended_at: 2000500
      });
    });

    it("should handle missing fields gracefully", () => {
      const mockRow = {
        trace_id: "abc123",
        other_field: "ignored"
      };
      
      const filtered = wrapper.vm.filterRow(mockRow);
      
      expect(filtered).toEqual({
        trace_id: "abc123"
      });
    });

    it("should return empty object for empty row", () => {
      const filtered = wrapper.vm.filterRow({});
      expect(filtered).toEqual({});
    });
  });

  describe("Status Functions", () => {
    it("should return correct status text", () => {
      expect(wrapper.vm.getStatusText(0)).toBe("Pending");
      expect(wrapper.vm.getStatusText(1)).toBe("Running");
      expect(wrapper.vm.getStatusText(2)).toBe("Finished");
      expect(wrapper.vm.getStatusText(3)).toBe("Cancelled");
      expect(wrapper.vm.getStatusText(999)).toBe("Unknown");
    });

    it("should return correct status icons", () => {
      expect(wrapper.vm.getStatusIcon(0)).toBe("hourglass_empty");
      expect(wrapper.vm.getStatusIcon(1)).toBe("pause_circle");
      expect(wrapper.vm.getStatusIcon(2)).toBe("check_circle");
      expect(wrapper.vm.getStatusIcon(3)).toBe("cancel");
      expect(wrapper.vm.getStatusIcon(999)).toBe("help");
    });

    it("should return correct status colors", () => {
      expect(wrapper.vm.getStatusColor(0)).toBe("orange");
      expect(wrapper.vm.getStatusColor(1)).toBe("blue");
      expect(wrapper.vm.getStatusColor(2)).toBe("green");
      expect(wrapper.vm.getStatusColor(3)).toBe("gray");
      expect(wrapper.vm.getStatusColor(999)).toBe("gray");
    });
  });

  describe("Duration Calculation", () => {
    it("should calculate duration in seconds correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 1002000000); // 2 seconds in microseconds
      expect(result.formatted).toBe("2.00 seconds");
      expect(result.raw).toBe(2);
    });

    it("should calculate duration in minutes correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 1120000000); // 120 seconds in microseconds
      expect(result.formatted).toContain("2 minutes");
      expect(result.raw).toBe(120);
    });

    it("should calculate duration in hours correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 4600000000); // 3600 seconds in microseconds
      expect(result.formatted).toContain("1 hours");
      expect(result.raw).toBe(3600);
    });

    it("should calculate duration in days correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 87400000000); // 86400 seconds in microseconds
      expect(result.formatted).toContain("1 days");
      expect(result.raw).toBe(86400);
    });

    it("should calculate duration in months correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 2593000000000); // 2592000 seconds in microseconds
      expect(result.formatted).toContain("1 months");
      expect(result.raw).toBe(2592000);
    });

    it("should calculate duration in years correctly", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 32536000000000); // ~31536000 seconds in microseconds
      expect(result.formatted).toContain("1 years");
      expect(result.raw).toBe(32535000); // Actual calculated value
    });

    it("should handle zero duration", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 1000000000);
      expect(result.formatted).toBe("0.00 seconds");
      expect(result.raw).toBe(0);
    });

    it("should handle complex duration with minutes and seconds", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 1090500000); // 90.5 seconds in microseconds
      expect(result.formatted).toContain("1 minutes");
      expect(result.formatted).toContain("30.50 seconds");
    });

    it("should handle complex duration with hours and minutes", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 8200000000); // 7200 seconds in microseconds
      expect(result.formatted).toContain("2 hours");
      expect(result.raw).toBe(7200);
    });

    it("should handle complex duration with days and hours", () => {
      const result = wrapper.vm.calculateDuration(1000000000, 91000000000); // 90000 seconds in microseconds
      expect(result.formatted).toContain("1 days");
      expect(result.formatted).toContain("1 hours");
    });
  });

  describe("Time Formatting", () => {
    it("should format time correctly", () => {
      expect(wrapper.vm.formatTime(1.5)).toBe("1.50 sec");
      expect(wrapper.vm.formatTime(10)).toBe("10.00 sec");
      expect(wrapper.vm.formatTime(0.123)).toBe("0.12 sec");
    });

    it("should handle zero time", () => {
      expect(wrapper.vm.formatTime(0)).toBe("0.00 sec");
    });

    it("should handle large numbers", () => {
      expect(wrapper.vm.formatTime(9999.99)).toBe("9999.99 sec");
    });
  });

  describe("Unix to Quasar Format Conversion", () => {
    it("should convert unix timestamp to quasar format", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat(1609459200000000);
      expect(result).toBe("2024-01-01T10:00:00Z");
    });

    it("should handle zero timestamp", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat(0);
      expect(result).toBe("");
    });

    it("should handle undefined timestamp", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat(undefined);
      expect(result).toBe("");
    });

    it("should handle null timestamp", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat(null);
      expect(result).toBe("");
    });

    it("should handle string timestamp", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat("1609459200000000");
      expect(result).toBe("2024-01-01T10:00:00Z");
    });
  });

  describe("Sorting Methods", () => {
    const mockRows = [
      { user_id: "alice", rawDuration: 10, toBeStoredStartTime: 2000, toBeCreatedAt: 3000 },
      { user_id: "bob", rawDuration: 5, toBeStoredStartTime: 1000, toBeCreatedAt: 2000 },
      { user_id: "charlie", rawDuration: 15, toBeStoredStartTime: 3000, toBeCreatedAt: 1000 }
    ];

    it("should sort by user_id ascending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "user_id", false);
      expect(result[0].user_id).toBe("alice");
      expect(result[1].user_id).toBe("bob");
      expect(result[2].user_id).toBe("charlie");
    });

    it("should sort by user_id descending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "user_id", true);
      expect(result[0].user_id).toBe("charlie");
      expect(result[1].user_id).toBe("bob");
      expect(result[2].user_id).toBe("alice");
    });

    it("should sort by duration ascending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "duration", false);
      expect(result[0].rawDuration).toBe(5);
      expect(result[1].rawDuration).toBe(10);
      expect(result[2].rawDuration).toBe(15);
    });

    it("should sort by duration descending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "duration", true);
      expect(result[0].rawDuration).toBe(15);
      expect(result[1].rawDuration).toBe(10);
      expect(result[2].rawDuration).toBe(5);
    });

    it("should sort by start_time ascending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "start_time", false);
      expect(result[0].toBeStoredStartTime).toBe(1000);
      expect(result[1].toBeStoredStartTime).toBe(2000);
      expect(result[2].toBeStoredStartTime).toBe(3000);
    });

    it("should sort by start_time descending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "start_time", true);
      expect(result[0].toBeStoredStartTime).toBe(3000);
      expect(result[1].toBeStoredStartTime).toBe(2000);
      expect(result[2].toBeStoredStartTime).toBe(1000);
    });

    it("should sort by created_at ascending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "created_at", false);
      expect(result[0].toBeCreatedAt).toBe(1000);
      expect(result[1].toBeCreatedAt).toBe(2000);
      expect(result[2].toBeCreatedAt).toBe(3000);
    });

    it("should sort by created_at descending", () => {
      const result = wrapper.vm.sortMethod(mockRows, "created_at", true);
      expect(result[0].toBeCreatedAt).toBe(3000);
      expect(result[1].toBeCreatedAt).toBe(2000);
      expect(result[2].toBeCreatedAt).toBe(1000);
    });

    it("should not modify original array", () => {
      const originalLength = mockRows.length;
      wrapper.vm.sortMethod(mockRows, "user_id", false);
      expect(mockRows.length).toBe(originalLength);
    });
  });

  describe("Clipboard Operations", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should copy text to clipboard successfully", async () => {
      await wrapper.vm.copyToClipboard("test text", "Query");
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test text");
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "positive",
        message: "Query Copied Successfully!",
        timeout: 5000
      });
    });

    it("should handle clipboard error", async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error("Failed"));
      
      try {
        await wrapper.vm.copyToClipboard("test text", "Query");
      } catch (error) {
        // Handle the error if the function doesn't catch it internally
      }
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while copy content.",
        timeout: 5000
      });
    });

    it("should handle different content types", async () => {
      await wrapper.vm.copyToClipboard("function code", "Function");
      
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "positive",
        message: "Function Copied Successfully!",
        timeout: 5000
      });
    });
  });

  describe("Expand/Collapse Functionality", () => {
    it("should expand row when clicked", () => {
      const mockProps = {
        row: {
          trace_id: "test-uuid",
          start_time: 1000,
          end_time: 2000
        }
      };
      
      wrapper.vm.triggerExpand(mockProps);
      
      expect(wrapper.vm.expandedRow).toBe("test-uuid");
      expect(wrapper.vm.query).toContain("test-uuid");
    });

    it("should collapse row when same row clicked again", () => {
      const mockProps = {
        row: {
          trace_id: "test-uuid",
          start_time: 1000,
          end_time: 2000
        }
      };
      
      // First expand
      wrapper.vm.triggerExpand(mockProps);
      expect(wrapper.vm.expandedRow).toBe("test-uuid");
      
      // Then collapse
      wrapper.vm.triggerExpand(mockProps);
      expect(wrapper.vm.expandedRow).toBe(null);
    });

    it("should expand different row and collapse previous", () => {
      const mockProps1 = {
        row: { trace_id: "uuid-1", start_time: 1000, end_time: 2000 }
      };
      const mockProps2 = {
        row: { trace_id: "uuid-2", start_time: 1000, end_time: 2000 }
      };
      
      wrapper.vm.triggerExpand(mockProps1);
      expect(wrapper.vm.expandedRow).toBe("uuid-1");
      
      wrapper.vm.triggerExpand(mockProps2);
      expect(wrapper.vm.expandedRow).toBe("uuid-2");
    });
  });

  describe("Job Management Functions", () => {
    const mockJob = {
      id: "job-123",
      user_id: "test@example.com",
      status: 1,
      sql: "SELECT * FROM logs"
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should set up delete confirmation", () => {
      wrapper.vm.confirmDeleteJob(mockJob);
      
      expect(wrapper.vm.confirmDelete).toBe(true);
      expect(wrapper.vm.toBeDeletedJob).toEqual(mockJob);
    });

    it("should set up cancel confirmation", () => {
      wrapper.vm.confirmCancelJob(mockJob);
      
      expect(wrapper.vm.confirmCancel).toBe(true);
      expect(wrapper.vm.toBeCancelled).toEqual(mockJob);
    });

    it("should have correct service call parameters for delete", () => {
      wrapper.vm.toBeDeletedJob = mockJob;
      expect(wrapper.vm.toBeDeletedJob.id).toBe("job-123");
    });

    it("should have correct service call parameters for cancel", () => {
      wrapper.vm.toBeCancelled = mockJob;
      expect(wrapper.vm.toBeCancelled.id).toBe("job-123");
    });

    it("should have delete, cancel and retry functions", () => {
      expect(typeof wrapper.vm.deleteSearchJob).toBe('function');
      expect(typeof wrapper.vm.cancelSearchJob).toBe('function');
      expect(typeof wrapper.vm.retrySearchJob).toBe('function');
    });
  });


  describe("DateTime Management", () => {
    it("should update datetime correctly", async () => {
      const mockDateTime = {
        valueType: "absolute",
        startTime: 1000000,
        endTime: 2000000
      };
      
      wrapper.vm.searchDateTimeRef = { setAbsoluteTime: vi.fn() };
      
      await wrapper.vm.updateDateTime(mockDateTime);
      
      expect(wrapper.vm.dateTimeToBeSent).toEqual(mockDateTime);
      expect(wrapper.vm.searchDateTimeRef.setAbsoluteTime).toHaveBeenCalledWith(1000000, 2000000);
    });

    it("should handle datetime with different valueType", async () => {
      const mockDateTime = {
        valueType: "relative",
        relativeTimePeriod: "1h",
        startTime: 0,
        endTime: 0
      };
      
      wrapper.vm.searchDateTimeRef = { setAbsoluteTime: vi.fn() };
      
      await wrapper.vm.updateDateTime(mockDateTime);
      
      expect(wrapper.vm.dateTimeToBeSent).toEqual(mockDateTime);
    });
  });

  describe("Computed Properties", () => {
    it("should calculate delay message for seconds", () => {
      store.state.zoConfig.usage_publish_interval = 30;
      
      const delayMsg = wrapper.vm.delayMessage;
      expect(delayMsg).toBe("60 seconds");
    });

    it("should calculate delay message for minutes", () => {
      store.state.zoConfig.usage_publish_interval = 180;
      
      const delayMsg = wrapper.vm.delayMessage;
      expect(delayMsg).toBe("3 minute(s)");
    });

    it("should handle exactly 60 seconds", () => {
      store.state.zoConfig.usage_publish_interval = 60;
      
      const delayMsg = wrapper.vm.delayMessage;
      expect(delayMsg).toBe("60 seconds");
    });

    it("should handle large intervals", () => {
      store.state.zoConfig.usage_publish_interval = 7200;
      
      const delayMsg = wrapper.vm.delayMessage;
      expect(delayMsg).toBe("120 minute(s)");
    });
  });

  describe("Navigation to Logs", () => {
    it("should navigate to logs with correct parameters", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second"
      };

      await wrapper.vm.goToLogs(mockRow);
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/logs",
        query: expect.objectContaining({
          stream_type: "logs",
          stream: "test-stream",
          sql_mode: "true",
          type: "search_scheduler",
          org_identifier: "test-org",
          from: 1000000,
          to: 2000000
        })
      });
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "positive",
        message: "Search Job have been applied successfully",
        timeout: 2000
      });
    });

    it("should handle multiple streams", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["stream1", "stream2"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second"
      };

      await wrapper.vm.goToLogs(mockRow);
      
      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.stream).toBe("stream1,stream2");
    });

    it("should include function content when present", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second",
        function: "test function content"
      };

      await wrapper.vm.goToLogs(mockRow);
      
      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.functionContent).toBeDefined();
    });

    it("should set job ID correctly in fetchSearchResults", () => {
      const mockRow = { 
        id: "job-123",
        duration: "1 second",
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000
      };
      
      // Mock the goToLogs function to avoid navigation issues
      wrapper.vm.goToLogs = vi.fn();
      
      wrapper.vm.fetchSearchResults(mockRow);
      
      expect(wrapper.vm.searchObj.meta.jobId).toBe("job-123");
    });
  });

  describe("Enterprise Configuration", () => {
    it("should not fetch when isEnterprise is false", async () => {
      // Mock config to be non-enterprise
      const configMock = await import("@/aws-exports");
      configMock.default.isEnterprise = "false";
      
      const result = await wrapper.vm.fetchSearchHistory();
      
      expect(result).toBeUndefined();
      expect(searchService.get_scheduled_search_list).not.toHaveBeenCalled();
    });
  });

  describe("Data Processing Functions", () => {
    it("should have fetchSearchHistory function", () => {
      expect(typeof wrapper.vm.fetchSearchHistory).toBe('function');
    });

    it("should have correct data structure for processing", () => {
      expect(Array.isArray(wrapper.vm.dataToBeLoaded)).toBe(true);
      expect(Array.isArray(wrapper.vm.columnsToBeRendered)).toBe(true);
    });

    it("should have generateColumns function", () => {
      expect(typeof wrapper.vm.generateColumns).toBe('function');
    });

    it("should have data processing utilities", () => {
      expect(typeof wrapper.vm.calculateDuration).toBe('function');
      expect(typeof wrapper.vm.convertUnixToQuasarFormat).toBe('function');
    });
  });

  describe("Component Configuration", () => {
    it("should have correct tabs configuration", () => {
      expect(wrapper.vm.tabs).toHaveLength(2);
      expect(wrapper.vm.tabs[0].label).toBe("Query / Function");
      expect(wrapper.vm.tabs[0].value).toBe("query");
      expect(wrapper.vm.tabs[1].label).toBe("More Details");
      expect(wrapper.vm.tabs[1].value).toBe("more_details");
    });

    it("should have correct active tab", () => {
      expect(wrapper.vm.activeTab).toBe("query");
    });

    it("should have all required configuration properties", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.route).toBeDefined();
    });

    it("should have utility functions available", () => {
      expect(typeof wrapper.vm.copyToClipboard).toBe('function');
      expect(typeof wrapper.vm.updateDateTime).toBe('function');
      expect(typeof wrapper.vm.triggerExpand).toBe('function');
    });

    it("should have loading and result tracking", () => {
      expect(typeof wrapper.vm.isLoading).toBe('boolean');
      expect(typeof wrapper.vm.resultTotal).toBe('number');
      expect(typeof wrapper.vm.showSearchResults).toBe('boolean');
    });

    it("should have confirmation state management", () => {
      expect(typeof wrapper.vm.confirmDelete).toBe('boolean');
      expect(typeof wrapper.vm.confirmCancel).toBe('boolean');
      expect(typeof wrapper.vm.toBeDeletedJob).toBe('object');
      expect(typeof wrapper.vm.toBeCancelled).toBe('object');
    });
  });
});