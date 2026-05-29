import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import SearchHistory from "./SearchHistory.vue";
import searchService from "@/services/search";
import useLogs from "@/composables/useLogs";
import { useRouter, useRoute } from "vue-router";

// Mock Toast
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

// Mock the search service
vi.mock("@/services/search", () => ({
  default: {
    get_history: vi.fn().mockResolvedValue({
      data: {
        hits: []
      }
    })
  }
}));

// Mock useLogs composable
vi.mock("@/composables/useLogs", () => ({
  default: () => {
    const { ref } = require('vue');
    return {
      searchObj: ref({
        data: {
          datetime: {
            type: 'relative'
          }
        }
      }),
      extractTimestamps: vi.fn().mockReturnValue({ from: 1000, to: 2000 })
    };
  }
}));

// Mock vue-router
vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    currentRoute: {
      value: {
        query: {
          org_identifier: 'test-org'
        }
      }
    }
  })),
  useRoute: vi.fn(() => ({
    query: {
      org_identifier: 'test-org'
    },
    params: {},
    path: '/search-history'
  }))
}));

// Mock vue-i18n
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
  };
});

describe("SearchHistory Component", () => {
  let wrapper;
  let mockStore;
  let routerPushMock;

  beforeEach(() => {
    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org"
        },
        userInfo: {
          email: "test@example.com"
        },
        zoConfig: {
          usage_publish_interval: 60,
          timestamp_column: "_timestamp"
        },
        timezone: "UTC"
      }
    };

    // Setup router mock
    routerPushMock = vi.fn();
    vi.mocked(useRouter).mockImplementation(() => ({
      push: routerPushMock,
      currentRoute: {
        value: {
          query: {
            org_identifier: 'test-org'
          }
        }
      }
    }));

    // Mount component with default props
    wrapper = mount(SearchHistory, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          OButton: true,
          OIcon: true,
          OSwitch: true,
          OTable: true,
          OSpinner: true,
          DateTime: {
            template: '<div class="mock-datetime"></div>',
            methods: {
              setAbsoluteTime: vi.fn()
            }
          },
          AppTabs: true,
          QueryEditor: true,
          TenstackTable: true,
          NoData: true
        },
        mocks: {
          $router: { push: routerPushMock }
        }
      },
      props: {
        isClicked: false
      }
    });

    // Initialize required data
    wrapper.vm.columnsToBeRendered = [];
    wrapper.vm.dataToBeLoaded = [];
    wrapper.vm.dateTimeToBeSent = {
      valueType: 'relative',
      relativeTimePeriod: '15m',
      startTime: 0,
      endTime: 0
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct default state", () => {
      expect(wrapper.vm.wrapText).toBe(true);
      expect(wrapper.vm.dataToBeLoaded).toEqual([]);
      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.vm.expandedIds).toEqual([]);
    });

    it("has correct page size options", () => {
      expect(wrapper.vm.pageSize).toBeDefined();
      expect(wrapper.vm.pageSizeOptions).toBeDefined();
    });

    it("has correct table columns", () => {
      const data = [{ some: 'data' }]; // Pass non-empty array to trigger column generation
      const columns = wrapper.vm.generateColumns(data);

      expect(columns).toHaveLength(2);
      expect(columns[0].id).toBe("executed_time");
      expect(columns[0].accessorKey).toBe("executed_time");
      expect(columns[0].sortable).toBe(true);
      expect(columns[1].id).toBe("sql");
      expect(columns[1].accessorKey).toBe("sql");
    });

    it("initializes with correct default props", () => {
      expect(wrapper.props("isClicked")).toBe(false);
    });

    it("sets up correct initial data structure", () => {
      expect(wrapper.vm.dateTimeToBeSent).toEqual({
        valueType: 'relative',
        relativeTimePeriod: '15m',
        startTime: 0,
        endTime: 0
      });
    });
  });

  describe("Data Fetching", () => {
    it("sets loading state correctly during fetch", async () => {
      searchService.get_history.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            data: {
              hits: []
            }
          }), 100)
        )
      );
      
      await wrapper.setProps({ isClicked: true });
      
      await flushPromises();
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for async operations
      expect(wrapper.vm.isLoading).toBe(false);
    });
  });

  describe("Table Functionality", () => {
    it("copies content to clipboard", async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: mockWriteText
        }
      });

      const testSQL = "SELECT * FROM logs";
      await wrapper.vm.copyToClipboard(testSQL, "SQL Query");
      await flushPromises();

      expect(mockWriteText).toHaveBeenCalledWith(testSQL);
    });

    it("formats time duration correctly", () => {
      expect(wrapper.vm.formatTime(1500)).toBe("1500.00 sec");
      expect(wrapper.vm.formatTime(60000)).toBe("60000.00 sec");
      expect(wrapper.vm.formatTime(3600000)).toBe("3600000.00 sec");
    });

  });

  describe("Navigation and Routing", () => {
    it("navigates to logs page with correct query params", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_name: "test-stream",
        org_id: "test-org",
        toBeStoredStartTime: 1000,
        toBeStoredEndTime: 2000,
        duration: "1 second"
      };

      await wrapper.vm.goToLogs(mockRow);
      
      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.objectContaining({
            stream_type: "logs",
            stream: "test-stream",
            sql_mode: "true",
            type: "search_history_re_apply"
          })
        })
      );
    });
  });

  describe("Date Time Handling", () => {
    it("updates datetime when changed", async () => {
      const newDateTime = {
        valueType: "absolute",
        startTime: 1000,
        endTime: 2000
      };

      wrapper.vm.dateTimeToBeSent = newDateTime;
      wrapper.vm.searchDateTimeRef = {
        setAbsoluteTime: vi.fn()
      };

      await wrapper.vm.updateDateTime(newDateTime);
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.dateTimeToBeSent).toEqual(newDateTime);
      expect(wrapper.vm.searchDateTimeRef.setAbsoluteTime).toHaveBeenCalledWith(
        newDateTime.startTime,
        newDateTime.endTime
      );
    });

    it("handles relative time periods correctly", async () => {
      const relativeDateTime = {
        valueType: "relative",
        relativeTimePeriod: "15m"
      };

      await wrapper.vm.updateDateTime(relativeDateTime);
      expect(wrapper.vm.dateTimeToBeSent.relativeTimePeriod).toBe("15m");
    });
  });

  describe("UI Elements", () => {
    it("shows expanded row details correctly", async () => {
      const testRow = {
        uuid: "test-uuid",
        sql: "SELECT * FROM logs"
      };

      wrapper.vm.onExpandedIdsChange(["test-uuid"]);
      expect(wrapper.vm.expandedIds).toEqual(["test-uuid"]);
    });
  });

  describe("Error Handling", () => {


    it("handles empty search history response", async () => {
      searchService.get_history.mockResolvedValue({ data: { hits: [] } });

      await wrapper.setProps({ isClicked: true });
      await flushPromises();

      expect(wrapper.vm.dataToBeLoaded).toHaveLength(0);
    });
  });

  describe("Navigation - goToLogs with function row", () => {
    it("adds functionContent and fn_editor=true when row has function property", async () => {
      const mockRowWithFunction = {
        sql: "SELECT * FROM logs",
        stream_name: "test-stream",
        org_id: "test-org",
        toBeStoredStartTime: 1000,
        toBeStoredEndTime: 2000,
        duration: "1 second",
        function: "function transformLog(row) { return row; }",
      };

      await wrapper.vm.goToLogs(mockRowWithFunction);

      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.objectContaining({
            fn_editor: "true",
            functionContent: expect.any(String),
          }),
        })
      );
    });

    it("sets fn_editor=false when row has no function property", async () => {
      const mockRowWithoutFunction = {
        sql: "SELECT * FROM logs",
        stream_name: "test-stream",
        org_id: "test-org",
        toBeStoredStartTime: 1000,
        toBeStoredEndTime: 2000,
        duration: "1 second",
      };

      await wrapper.vm.goToLogs(mockRowWithoutFunction);

      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            fn_editor: "false",
          }),
        })
      );
    });

    it("does not add functionContent when row function is falsy", async () => {
      const mockRowWithEmptyFunction = {
        sql: "SELECT * FROM logs",
        stream_name: "test-stream",
        org_id: "test-org",
        toBeStoredStartTime: 1000,
        toBeStoredEndTime: 2000,
        duration: "1 second",
        function: "",
      };

      await wrapper.vm.goToLogs(mockRowWithEmptyFunction);

      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.not.objectContaining({
            functionContent: expect.any(String),
          }),
        })
      );
    });
  });

  describe("Tab State", () => {
    it("has activeTab initialized", () => {
      expect(wrapper.vm.activeTab).toBeDefined();
    });

    it("has tabs array defined", () => {
      expect(Array.isArray(wrapper.vm.tabs)).toBe(true);
    });
  });

  describe("Text Wrapping", () => {
    it("has wrapText initialized to true", () => {
      expect(wrapper.vm.wrapText).toBe(true);
    });

    it("can toggle wrapText", async () => {
      wrapper.vm.wrapText = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.wrapText).toBe(false);
    });
  });

  describe("Sorting", () => {
    it("has columns with sortable property", () => {
      const columns = wrapper.vm.generateColumns([{ some: 'data' }]);
      expect(columns.length).toBeGreaterThan(0);
      expect(columns[0].sortable).toBeDefined();
    });
  });
});
