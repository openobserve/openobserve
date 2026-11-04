import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import SearchSchedulersList from "@/plugins/logs/SearchSchedulersList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { nextTick } from "vue";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";

// Mock services
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_scheduled_search_list: vi.fn(),
      cancel_scheduled_search: vi.fn(),
      retry_scheduled_search: vi.fn(),
      delete_scheduled_search: vi.fn(),
    },
  });
});

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    API_ENDPOINT: "http://localhost:5080",
  },
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: {
      meta: { jobId: null },
      data: {
        datetime: { type: "relative" },
      },
    },
  }),
}));

// Mock vue-router
const mockRouter = {
  currentRoute: {
    value: {
      query: { org_identifier: "test-org" },
      params: {},
      path: "/search-schedulers",
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({
    query: { org_identifier: "test-org" },
    params: {},
    path: "/search-schedulers",
  }),
}));

// Mock Toast — vi.hoisted runs before hoisted vi.mock factories, avoiding TDZ errors
const { mockToast } = vi.hoisted(() => {
  const mockToast = vi.fn();
  return { mockToast };
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Mock date utils
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn(() => "2024-01-01T10:00:00Z"),
  // The component imports this now instead of re-declaring it; the shared
  // implementation is tested in date.spec.ts, so here we only assert the wiring.
  convertUnixToDateFormat: vi.fn((us: any) => (us ? "2024-01-01T10:00:00Z" : "")),
}));

// Mock utils
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  timestampToTimezoneDate: vi.fn(),
  b64EncodeUnicode: vi.fn((str) => btoa(str)),
  b64DecodeUnicode: vi.fn((str) => atob(str)),
  convertDateToTimestamp: vi.fn(),
  useLocalWrapContent: vi.fn(() => false),
}));

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

describe("SearchSchedulersList Component", () => {
  let wrapper: any = null;
  let searchService: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    resetListViewState();

    // Setup search service mock
    const { default: searchServiceMock } = await import("@/services/search");
    searchService = searchServiceMock;

    searchService.get_scheduled_search_list.mockResolvedValue({
      data: [],
    });

    wrapper = mount(SearchSchedulersList, {
      props: {
        isClicked: false,
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          OIcon: true,
          DateTime: {
            template: '<div class="mock-datetime"></div>',
            methods: {
              setAbsoluteTime: vi.fn(),
            },
          },
          AppTabs: true,
          QueryEditor: true,
          ConfirmDialog: true,
          NoData: true,
          TenstackTable: true,
          Pagination: true,
          JsonPreview: true,
        },
        mocks: {
          $router: mockRouter,
        },
      },
    });

    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Navigation", () => {
    it("should navigate back to logs on closeSearchHistory", async () => {
      // Standalone route: close navigates to the Logs route (no history to pop in
      // jsdom) instead of emitting to a parent overlay.
      wrapper.vm.closeSearchHistory();
      await nextTick();
      expect(mockRouter.push).toHaveBeenCalledWith({ name: "logs" });
    });
  });

  describe("Column Generation", () => {
    it("should generate correct columns for data", () => {
      const mockData = [{ id: "1", user_id: "test" }];
      const columns = wrapper.vm.generateColumns(mockData);

      expect(columns).toHaveLength(6);
      expect(columns[0]).toMatchObject({
        id: "user_id",
        accessorKey: "user_id",
        sortable: true,
        size: 220,
      });
    });

    it("should set correct alignment for different columns", () => {
      const mockData = [
        {
          user_id: "test",
          duration: "1s",
          status: "finished",
        },
      ];
      const columns = wrapper.vm.generateColumns(mockData);

      const userIdColumn = columns.find((col) => col.id === "user_id");
      const actionsColumn = columns.find((col) => col.id === "actions");
      const durationColumn = columns.find((col) => col.id === "duration");
      const statusColumn = columns.find((col) => col.id === "status");

      expect(userIdColumn.meta.align).toBe("left");
      expect(actionsColumn.meta.align).toBe("center");
      expect(durationColumn.meta.align).toBe("left");
      expect(statusColumn.meta.align).toBe("left");
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
        other_field: "ignored",
      };

      const filtered = wrapper.vm.filterRow(mockRow);

      expect(filtered).toEqual({
        trace_id: "abc123",
        start_time: 1000000,
        end_time: 2000000,
        started_at: 1000500,
        ended_at: 2000500,
      });
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
  });

  describe("Unix to Date Format Conversion", () => {
    it("should convert unix timestamp to date format", () => {
      const result = wrapper.vm.convertUnixToDateFormat(1609459200000000);
      expect(result).toBe("2024-01-01T10:00:00Z");
    });

    it("should handle zero timestamp", () => {
      const result = wrapper.vm.convertUnixToDateFormat(0);
      expect(result).toBe("");
    });
  });

  describe("Sorting Configuration", () => {
    it("should mark user_id, created_at, and start_time columns as sortable", () => {
      const mockData = [{ id: "1", user_id: "test" }];
      const columns = wrapper.vm.generateColumns(mockData);

      const sortableColumns = columns.filter((col) => col.sortable === true);
      const sortableIds = sortableColumns.map((col) => col.id);
      expect(sortableIds).toEqual(["user_id", "created_at", "start_time"]);
    });

    it("should mark duration, status, and actions as non-sortable", () => {
      const mockData = [{ id: "1", user_id: "test" }];
      const columns = wrapper.vm.generateColumns(mockData);

      const nonSortableIds = columns.filter((col) => col.sortable !== true).map((col) => col.id);
      expect(nonSortableIds).toEqual(expect.arrayContaining(["duration", "status", "actions"]));
    });
  });

  describe("Clipboard Operations", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should copy text to clipboard successfully", async () => {
      await wrapper.vm.copyToClipboard("test text", i18n.global.t, {
        successMessage: "Query Copied Successfully!",
        timeout: 5000,
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test text");
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Query Copied Successfully!",
        timeout: 5000,
      });
    });

    it("should handle clipboard error", async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error("Failed"));

      await wrapper.vm.copyToClipboard("test text", i18n.global.t);

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "Failed to copy to clipboard",
        timeout: 2000,
      });
    });
  });

  describe("Expand/Collapse Functionality", () => {
    it("should expand row and set query when onExpandedIdsChange is called", () => {
      wrapper.vm.dataToBeLoaded = [
        {
          trace_id: "test-uuid",
          start_time: 1000,
          end_time: 2000,
          started_at: 1500,
          ended_at: 2500,
        },
      ];

      wrapper.vm.onExpandedIdsChange(["test-uuid"]);

      expect(wrapper.vm.expandedIds).toEqual(["test-uuid"]);
      expect(wrapper.vm.query).toContain("test-uuid");
    });

    it("should collapse row and clear query when onExpandedIdsChange is called with empty array", () => {
      wrapper.vm.dataToBeLoaded = [
        {
          trace_id: "test-uuid",
          start_time: 1000,
          end_time: 2000,
        },
      ];

      wrapper.vm.onExpandedIdsChange(["test-uuid"]);
      expect(wrapper.vm.expandedIds).toEqual(["test-uuid"]);

      wrapper.vm.onExpandedIdsChange([]);
      expect(wrapper.vm.expandedIds).toEqual([]);
      expect(wrapper.vm.query).toBe("");
    });
  });

  describe("Job Management Functions", () => {
    const mockJob = {
      id: "job-123",
      user_id: "test@example.com",
      status: 1,
      sql: "SELECT * FROM logs",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should set up delete confirmation", () => {
      wrapper.vm.confirmDeleteJob(mockJob);

      expect(wrapper.vm.confirmDelete).toBe(true);
      expect(wrapper.vm.toBeDeletedJob).toEqual(mockJob);
    });

    it("gives the delete confirm a destructive button and leaves cancel-job plain", () => {
      const [deleteDialog, cancelDialog] = wrapper.findAllComponents({ name: "ConfirmDialog" });
      expect(deleteDialog.props("okVariant")).toBe("destructive");
      expect(cancelDialog.props("okVariant")).not.toBe("destructive");
    });

    it("should set up cancel confirmation", () => {
      wrapper.vm.confirmCancelJob(mockJob);

      expect(wrapper.vm.confirmCancel).toBe(true);
      expect(wrapper.vm.toBeCancelled).toEqual(mockJob);
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
      expect(delayMsg).toBe("3 minutes");
    });

    it("should handle large intervals", () => {
      store.state.zoConfig.usage_publish_interval = 7200;

      const delayMsg = wrapper.vm.delayMessage;
      expect(delayMsg).toBe("120 minutes");
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
        duration: "1 second",
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
          to: 2000000,
        }),
      });
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Search Job have been applied successfully",
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
        duration: "1 second",
      };

      await wrapper.vm.goToLogs(mockRow);

      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.stream).toBe("stream1,stream2");
    });

    it("should set fn_editor=true when row has function content", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second",
        function: "function transform(row) { return row; }",
      };

      await wrapper.vm.goToLogs(mockRow);

      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.fn_editor).toBe("true");
      expect(callArgs.query.functionContent).toBeDefined();
    });

    it("should set fn_editor=false when row has no function", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second",
      };

      await wrapper.vm.goToLogs(mockRow);

      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.fn_editor).toBe("false");
      expect(callArgs.query.functionContent).toBeUndefined();
    });

    it("should set fn_editor=false when row has empty function string", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: '["test-stream"]',
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000000,
        toBeStoredEndTime: 2000000,
        duration: "1 second",
        function: "",
      };

      await wrapper.vm.goToLogs(mockRow);

      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.fn_editor).toBe("false");
    });
  });

  describe("Enterprise Configuration", () => {
    it("should not fetch when isEnterprise is false", async () => {
      // Mock config to be non-enterprise
      const configMock = await import("@/aws-exports");
      configMock.default.isEnterprise = "false";
      // The component fetches on mount (when enterprise was still true); ignore that
      // call and assert only that the direct fetch below short-circuits.
      searchService.get_scheduled_search_list.mockClear();

      try {
        const result = await wrapper.vm.fetchSearchHistory();

        expect(result).toBeUndefined();
        expect(searchService.get_scheduled_search_list).not.toHaveBeenCalled();
      } finally {
        configMock.default.isEnterprise = "true";
      }
    });
  });

  describe("View state restore", () => {
    const mountList = () =>
      mount(SearchSchedulersList, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: { OTable: true, AppTabs: true, QueryEditor: true, ConfirmDialog: true },
          mocks: { $router: mockRouter },
        },
      });

    it("restores page, size and sort", () => {
      resetListViewState();
      useListViewState("searchSchedulers", {
        pageSize: 10,
        currentPage: 3,
        sortBy: "created_at",
        sortOrder: "desc",
      });
      const restored = mountList();
      expect(restored.vm.pageSize).toBe(10);
      expect(restored.vm.currentPage).toBe(3);
      expect(restored.vm.sortBy).toBe("created_at");
      expect(restored.vm.sortOrder).toBe("desc");
      restored.unmount();
    });

    it("saves changes to the view state", async () => {
      wrapper.vm.pageSize = 50;
      wrapper.vm.sortBy = "user_id";
      await nextTick();
      const saved: any = useListViewState("searchSchedulers", {});
      expect(saved.pageSize).toBe(50);
      expect(saved.sortBy).toBe("user_id");
    });
  });
});
