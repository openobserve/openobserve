import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import SearchSchedulersList from "./SearchSchedulersList.vue";
import searchService from "@/services/search";
import useLogs from "@/composables/useLogs";
import { useRouter, useRoute } from "vue-router";
import config from "@/aws-exports";
import { nextTick, ref } from "vue";

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true"
  }
}));

// Mock the search service with proper error handling
vi.mock("@/services/search", () => ({
  default: {
    get_scheduled_search_list: vi.fn(),
    cancel_scheduled_search: vi.fn(),
    retry_scheduled_search: vi.fn(),
    delete_scheduled_search: vi.fn()
  }
}));

// Mock useLogs composable
vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: {
      meta: {},
      data: {
        datetime: {
          type: 'relative'
        }
      }
    },
    extractTimestamps: vi.fn().mockReturnValue({ from: 1000, to: 2000 })
  })
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
    query: {},
    params: {},
    path: '/search-schedulers'
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

installQuasar({
  plugins: [Dialog, Notify],
});

describe("SearchSchedulersList Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;
  let routerPushMock;
  let dialogMock;

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
        timezone: "UTC",
        theme: 'light'
      }
    };

    // Setup notify mock
    notifyMock = vi.fn();
    dialogMock = {
      create: vi.fn().mockReturnValue({
        onOk: vi.fn(callback => {
          callback();
          return { onCancel: vi.fn() };
        }),
        onCancel: vi.fn()
      })
    };
    const $q = {
      notify: notifyMock,
      dialog: dialogMock
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

    // Clear all mocks before each test
    vi.clearAllMocks();

    // Mount component with default props and data
    wrapper = mount(SearchSchedulersList, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          QPage: true,
          QTable: true,
          QTr: true,
          QTd: true,
          QBtn: true,
          QIcon: true,
          QToggle: true,
          DateTime: {
            template: '<div class="mock-datetime"></div>',
            methods: {
              setAbsoluteTime: vi.fn()
            }
          },
          AppTabs: true,
          QueryEditor: true,
          QSpinnerHourglass: true,
          ConfirmDialog: true,
          NoData: true
        },
        mocks: {
          $q,
          $router: { push: routerPushMock }
        }
      },
      props: {
        isClicked: false
      }
    });

    // Mock component methods
    wrapper.vm.formatTime = vi.fn(took => `${took.toFixed(2)} sec`);
    wrapper.vm.calculateDuration = vi.fn((startTime, endTime) => ({
      formatted: "1 second",
      raw: 1.0
    }));
    wrapper.vm.convertUnixToQuasarFormat = vi.fn(timestamp => {
      const date = new Date(timestamp);
      return date.toISOString().slice(0, 19) + "+00:00";
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("initializes with correct default state", () => {
      expect(wrapper.vm.columnsToBeRendered).toEqual([]);
      expect(wrapper.vm.dataToBeLoaded).toEqual([]);
      expect(wrapper.vm.expandedRow).toEqual([]);
      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.vm.showSearchResults).toBe(false);
    });
  });

  describe("Data Fetching", () => {
    it("fetches search schedulers when isClicked becomes true", async () => {
      const mockResponse = {
        data: [
          {
            id: "123",
            user_id: "test@example.com",
            created_at: 1000000000,
            start_time: 1000000000,
            end_time: 1000060000,
            status: 1,
            payload: JSON.stringify({
              query: {
                sql: "SELECT * FROM logs",
                stream_names: JSON.stringify(["test-stream"])
              }
            }),
            stream_type: "logs",
            duration: "1 second"
          }
        ]
      };

      searchService.get_scheduled_search_list.mockImplementation(() => Promise.resolve(mockResponse));
      
      // First ensure isLoading is false
      wrapper.vm.isLoading = false;
      await nextTick();
      
      // Then trigger the watcher
      await wrapper.setProps({ isClicked: true });
      await nextTick();
      await flushPromises();

      expect(searchService.get_scheduled_search_list).toHaveBeenCalledWith({
        org_identifier: "test-org"
      });
      expect(wrapper.vm.dataToBeLoaded).toHaveLength(1);
    });

    it("sets loading state correctly during fetch", async () => {
      const mockResponse = { data: [] };
      let resolvePromise;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      
      searchService.get_scheduled_search_list.mockImplementation(() => promise);
      
      // First ensure isLoading is false
      wrapper.vm.isLoading = false;
      await nextTick();
      
      // Then trigger the watcher
      await wrapper.setProps({ isClicked: true });
      await nextTick();
      
      // Check loading state is true during fetch
      expect(wrapper.vm.isLoading).toBe(true);
      
      // Resolve the API call
      resolvePromise(mockResponse);
      await flushPromises();
      await nextTick();
      
      // Check loading state is false after fetch
      expect(wrapper.vm.isLoading).toBe(false);
    });
  });

  describe("Job Actions", () => {
    const mockJob = {
      id: "123",
      status: 1,
      stream_names: JSON.stringify(["test-stream"]),
      sql: "SELECT * FROM logs",
      duration: "1 second"
    };

    it("deletes job successfully", async () => {
      searchService.delete_scheduled_search.mockImplementation(() => Promise.resolve({}));
      
      await wrapper.vm.confirmDeleteJob(mockJob);
      await nextTick();
      expect(wrapper.vm.confirmDelete).toBe(true);
      expect(wrapper.vm.toBeDeletedJob).toEqual(mockJob);

      await wrapper.vm.deleteSearchJob();
      await flushPromises();
      await nextTick();

      expect(searchService.delete_scheduled_search).toHaveBeenCalledWith({
        org_identifier: "test-org",
        jobId: "123"
      });
    });
  });

  describe("UI Elements", () => {
    it("shows expanded row details correctly", async () => {
      const testRow = {
        trace_id: "test-uuid",
        sql: "SELECT * FROM logs"
      };
      
      await wrapper.vm.triggerExpand({ row: testRow });
      expect(wrapper.vm.expandedRow).toBe(testRow.trace_id);
    });

    it("shows correct status text and icons", () => {
      expect(wrapper.vm.getStatusText(0)).toBe("search_scheduler_job.status_pending");
      expect(wrapper.vm.getStatusText(1)).toBe("search_scheduler_job.status_running");
      expect(wrapper.vm.getStatusText(2)).toBe("search_scheduler_job.status_finished");
      expect(wrapper.vm.getStatusText(3)).toBe("search_scheduler_job.status_cancelled");

      expect(wrapper.vm.getStatusIcon(0)).toBe("hourglass_empty");
      expect(wrapper.vm.getStatusIcon(1)).toBe("pause_circle");
      expect(wrapper.vm.getStatusIcon(2)).toBe("check_circle");
      expect(wrapper.vm.getStatusIcon(3)).toBe("cancel");

      expect(wrapper.vm.getStatusColor(0)).toBe("orange");
      expect(wrapper.vm.getStatusColor(1)).toBe("blue");
      expect(wrapper.vm.getStatusColor(2)).toBe("green");
      expect(wrapper.vm.getStatusColor(3)).toBe("gray");
    });
  });

  describe("Navigation", () => {
    it("navigates to logs page with correct query params", async () => {
      const mockRow = {
        sql: "SELECT * FROM logs",
        stream_names: JSON.stringify(["test-stream"]),
        stream_type: "logs",
        org_id: "test-org",
        toBeStoredStartTime: 1000,
        toBeStoredEndTime: 2000,
        id: "123",
        duration: "1 second"
      };

      await wrapper.vm.fetchSearchResults(mockRow);
      await flushPromises();
      await nextTick();
      
      expect(routerPushMock).toHaveBeenCalledWith({
        path: "/logs",
        query: expect.objectContaining({
          stream_type: "logs",
          stream: "test-stream",
          sql_mode: "true",
          type: "search_scheduler"
        })
      });
    });

    it("emits closeSearchHistory event", async () => {
      await wrapper.vm.closeSearchHistory();
      expect(wrapper.emitted().closeSearchHistory).toBeTruthy();
    });
  });

  describe("Data Formatting", () => {
    it("formats time correctly", () => {
      expect(wrapper.vm.formatTime(1500)).toBe("1500.00 sec");
    });

    it("calculates duration correctly", () => {
      const { formatted, raw } = wrapper.vm.calculateDuration(1000000000, 1000060000);
      expect(formatted).toContain("second");
      expect(raw).toBeGreaterThan(0);
    });

    it("converts unix timestamp to quasar format", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat(1000000000000);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });
  });
});
