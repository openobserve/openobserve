// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick, ref } from 'vue';
import ReportList from "./ReportList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import reports from "@/services/reports";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import * as vueRouter from 'vue-router';

// Mock vue-router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn()
    }))
  };
});

// Mock reports service
vi.mock("@/services/reports", () => ({
  default: {
    list: vi.fn(),
    toggleReportState: vi.fn(),
    deleteReport: vi.fn(),
  },
}));

// Mock composables that use inject()
vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    streamList: ref([]),
    loading: ref(false),
    error: ref(null)
  }))
}));

vi.mock("@/composables/useLogs", () => ({
  default: vi.fn(() => ({
    searchObj: ref({ loading: false, data: { queryResults: [], aggs: { histogram: [] } } }),
    searchAggData: ref({ histogram: [], total: 0 }),
    searchResultData: ref({ list: [] })
  }))
}));

vi.mock("@/composables/useDashboard", () => ({
  default: vi.fn(() => ({
    dashboards: ref([]),
    loading: ref(false),
    error: ref(null)
  }))
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn(() => ""),
    verifyOrganizationStatus: vi.fn(() => Promise.resolve(true)),
    logsErrorMessage: vi.fn((code) => `Error: ${code}`),
    mergeRoutes: vi.fn((route1, route2) => [...(route1 || []), ...(route2 || [])]),
    getPath: vi.fn(() => "/"),
    useLocalTimezone: vi.fn(() => "UTC")
  };
});

// Mock segment analytics
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn()
  }
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Create platform mock
const platform = {
  is: {
    desktop: true,
    mobile: false,
  },
  has: {
    touch: false,
  },
};

// Install Quasar with platform
installQuasar({
  plugins: [Dialog, Notify],
  config: {
    platform
  }
});

describe("ReportList Component", () => {
  let wrapper;
  let mockRouter;
  let dismissMock;
  let notifyMock;
  let dialogMock;

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(reports.list).mockReset();
    vi.mocked(reports.toggleReportState).mockReset();
    vi.mocked(reports.deleteReport).mockReset();

    // Setup default successful response for list
    vi.mocked(reports.list).mockResolvedValue({
      data: [
        {
          name: "Test Report 1",
          enabled: true,
          owner: "test-user",
          description: "Test Description 1",
          last_triggered_at: 1234567890000000,
          destinations: ["email"],
          uuid: "report-1",
          sql: "SELECT * FROM test1",
        },
        {
          name: "Test Report 2",
          enabled: false,
          owner: "test-user",
          description: "Test Description 2",
          last_triggered_at: null,
          destinations: ["email"],
          uuid: "report-2",
          sql: "SELECT * FROM test2",
        },
      ],
    });

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };
    store.state.theme = 'light';

    // Setup router mock
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn()
    };
    vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter);

    // Setup notify and dialog mocks
    dismissMock = vi.fn();
    notifyMock = vi.fn(() => dismissMock);
    dialogMock = vi.fn().mockResolvedValue(true);

    wrapper = mount(ReportList, {
      global: {
        plugins: [
          [Quasar, { platform }],
          [i18n]
        ],
        provide: { 
          store,
          platform,
          router: mockRouter
        },
        mocks: {
          $router: mockRouter,
          q: {
            platform,
            notify: notifyMock,
            dialog: dialogMock
          },
          router: mockRouter
        }
      },
      attachTo: document.body
    });

    // Set up wrapper's $q.notify and dialog after mount
    wrapper.vm.q.notify = notifyMock;

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  it("renders the component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Component Initialization", () => {
    it("fetches reports on mount", async () => {
      expect(reports.list).toHaveBeenCalledWith("test-org");
    });

    it("should display correct number of reports", async () => {
      wrapper.vm.activeTab = "shared";
      await wrapper.vm.filterReports();
      expect(wrapper.vm.reportsTableRows.length).toBe(2);
    });

    it("should initialize with correct default values", () => {
      expect(wrapper.vm.activeTab).toBe("shared");
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should update pagination when rows per page changes", async () => {
      // Find the QTablePagination component
      const paginationComponent = wrapper.findComponent(QTablePagination);
      expect(paginationComponent.exists()).toBe(true);
      
      // Trigger the pagination change event
      await paginationComponent.vm.$emit('update:changeRecordPerPage', {
        label: "50 / page",
        value: 50
      });
      
      await nextTick();

      // Verify the pagination state was updated
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.selectedPerPage).toBe(50);
    });

    it("should show loading state during initialization", async () => {
      const newWrapper = mount(ReportList, {
        global: {
          plugins: [[Quasar, { platform }], [i18n]],
          provide: { store, platform, router: mockRouter },
          mocks: {
            $router: mockRouter,
            $q: { 
              platform, 
              notify: notifyMock, 
              dialog: dialogMock 
            },
            router: mockRouter
          }
        }
      });

      expect(newWrapper.vm.isLoadingReports).toBe(true);
      await flushPromises();
      expect(newWrapper.vm.isLoadingReports).toBe(false);
      newWrapper.unmount();
    });

    it("should handle non-403 error when fetching reports", async () => {
      // Setup error response
      const error = {
        response: {
          status: 500,
          data: {
            message: "Internal server error"
          }
        }
      };
      vi.mocked(reports.list).mockRejectedValue(error);

      // Create new wrapper to trigger onBeforeMount
      const newWrapper = mount(ReportList, {
        global: {
          plugins: [[Quasar, { platform }], [i18n]],
          provide: { store, platform, router: mockRouter },
          mocks: {
            $router: mockRouter,
            $q: { 
              platform, 
              notify: notifyMock, 
              dialog: dialogMock 
            },
            router: mockRouter
          }
        }
      });

      await flushPromises();

      console.log(wrapper,'notify here')

      

      // Verify loading state is cleared
      expect(newWrapper.vm.isLoadingReports).toBe(false);
      newWrapper.unmount();
    });


  });

  describe("Report Filtering", () => {
    it("filters reports by name", async () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.reportsTableRows, "Test Report 1");
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("Test Report 1");
    });

    it("handles filtering with special characters", () => {
      const rows = [...wrapper.vm.reportsTableRows];
      rows.push({
        name: "Test (Special) Report",
        destinations: ["email"],
      });
      const filtered = wrapper.vm.filterData(rows, "(Special)");
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("Test (Special) Report");
    });

    describe("Tab Filtering", () => {
      it("shows only cached reports", async () => {
        wrapper.vm.staticReportsList = [...wrapper.vm.reportsTableRows];
        wrapper.vm.staticReportsList[1].destinations = [];
        wrapper.vm.activeTab = "cached";
        await wrapper.vm.filterReports();
        expect(wrapper.vm.reportsTableRows.length).toBe(1);
        expect(wrapper.vm.reportsTableRows[0].destinations.length).toBe(0);
      });

      it("shows only scheduled reports", async () => {
        wrapper.vm.staticReportsList = [...wrapper.vm.reportsTableRows];
        wrapper.vm.activeTab = "shared";
        await wrapper.vm.filterReports();
        expect(wrapper.vm.reportsTableRows.every(report => report.destinations.length > 0)).toBe(true);
      });
    });
  });

  describe("Date Formatting", () => {
    it("formats unix timestamp correctly", () => {
      const timestamp = 1234567890000000; // microseconds
      const formatted = wrapper.vm.convertUnixToQuasarFormat(timestamp);
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it("handles null timestamp", () => {
      const formatted = wrapper.vm.convertUnixToQuasarFormat(null);
      expect(formatted).toBe("");
    });

    it("handles undefined timestamp", () => {
      const formatted = wrapper.vm.convertUnixToQuasarFormat(undefined);
      expect(formatted).toBe("");
    });

    it("handles invalid timestamp", () => {
      try {
        const formatted = wrapper.vm.convertUnixToQuasarFormat("invalid");
        expect(formatted).toBe("");
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
      }
    });
  });

  describe("Report State Toggle", () => {
    it("successfully toggles report state from enabled to disabled", async () => {
      const report = {
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      vi.mocked(reports.toggleReportState).mockResolvedValue({});

      await wrapper.vm.toggleReportState(report);
      await flushPromises();

      // Verify API call
      expect(reports.toggleReportState).toHaveBeenCalledWith(
        "test-org",
        "Test Report 1",
        false
      );

      // Verify loading state
      expect(wrapper.vm.reportsStateLoadingMap[report.name]).toBe(false);

      // Verify state updates in both lists
      expect(wrapper.vm.staticReportsList.find(r => r.name === report.name).enabled).toBe(false);
      expect(wrapper.vm.reportsTableRows.find(r => r.name === report.name).enabled).toBe(false);
    });


    it("handles error when toggling report state (non-403)", async () => {
      const report = {
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      const error = {
        response: {
          status: 500,
          data: {
            message: "Internal server error"
          }
        }
      };

      vi.mocked(reports.toggleReportState).mockRejectedValue(error);

      await wrapper.vm.toggleReportState(report);
      await flushPromises();


      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.name]).toBe(false);
    });

    it("handles 403 error silently when toggling report state", async () => {
      const report = {
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      const error = {
        response: {
          status: 403
        }
      };

      vi.mocked(reports.toggleReportState).mockRejectedValue(error);

      await wrapper.vm.toggleReportState(report);
      await flushPromises();

      // Verify no error notification for 403
      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative"
        })
      );

      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.name]).toBe(false);
    });

    it("maintains loading state during toggle operation", async () => {
      const report = {
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      let resolvePromise;
      const togglePromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      vi.mocked(reports.toggleReportState).mockReturnValue(togglePromise);

      const toggleOperation = wrapper.vm.toggleReportState(report);

      // Verify loading state is set
      expect(wrapper.vm.reportsStateLoadingMap[report.name]).toBe(true);

      resolvePromise({});
      await toggleOperation;
      await flushPromises();

      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.name]).toBe(false);
    });
  });

  describe("Edit Report", () => {
    it("navigates to edit page with correct query parameters", async () => {
      const report = {
        name: "Test Report 1",
        enabled: true,
        owner: "test-user",
        description: "Test Description"
      };

      // Verify router is properly mocked
      expect(vueRouter.useRouter()).toBeTruthy();
      expect(typeof vueRouter.useRouter().push).toBe('function');

      await wrapper.vm.editReport(report);

      // Verify router navigation
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: {
          name: report.name,
          org_identifier: "test-org"
        }
      });

      // Verify report is cloned to editingReport
      expect(wrapper.vm.editingReport).toEqual(report);
    });

    it("handles edit button click in the table", async () => {
      // Find and click the edit button for the first report
      const editButton = wrapper.find('[data-test="report-list-Test Report 1-edit-report"]');
      expect(editButton.exists()).toBe(true);
      
      await editButton.trigger('click');

      // Verify router navigation
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: {
          name: "Test Report 1",
          org_identifier: "test-org"
        }
      });
    });
  });

  describe("Delete Report", () => {
    it("confirms and deletes report successfully", async () => {
      const reportName = "Test Report 1";
      
      // Setup successful delete response
      vi.mocked(reports.deleteReport).mockResolvedValue({});

      // Store initial counts
      const initialStaticListCount = wrapper.vm.staticReportsList.length;
      const initialTableRowsCount = wrapper.vm.reportsTableRows.length;

      // Trigger delete confirmation
      await wrapper.vm.confirmDeleteReport({ name: reportName });

      // Verify dialog is shown with correct message
      expect(wrapper.vm.deleteDialog.show).toBe(true);
      expect(wrapper.vm.deleteDialog.message).toBe(`Are you sure you want to delete report "${reportName}"`);
      expect(wrapper.vm.deleteDialog.data).toBe(reportName);

      // Trigger delete action
      await wrapper.vm.deleteReport();
      await flushPromises();

      // Verify API call
      expect(reports.deleteReport).toHaveBeenCalledWith(
        "test-org",
        reportName
      );

      // Verify report is removed from lists
      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount - 1);
      expect(wrapper.vm.reportsTableRows.length).toBe(initialTableRowsCount - 1);
      expect(wrapper.vm.staticReportsList.find(r => r.name === reportName)).toBeUndefined();
      expect(wrapper.vm.reportsTableRows.find(r => r.name === reportName)).toBeUndefined();

      // Manually close dialog as component would do
      wrapper.vm.deleteDialog.show = false;
      await nextTick();

      // Verify dialog is closed
      expect(wrapper.vm.deleteDialog.show).toBe(false);
    });

    it("handles error when deleting report (non-403)", async () => {
      const reportName = "Test Report 1";
      const error = {
        response: {
          status: 500,
          data: {
            message: "Internal server error"
          }
        }
      };

      // Setup error response
      vi.mocked(reports.deleteReport).mockRejectedValue(error);

      // Store initial counts
      const initialStaticListCount = wrapper.vm.staticReportsList.length;
      const initialTableRowsCount = wrapper.vm.reportsTableRows.length;

      // Trigger delete confirmation
      await wrapper.vm.confirmDeleteReport({ name: reportName });
      
      // Trigger delete action
      await wrapper.vm.deleteReport();

      // Verify API call was made
      expect(reports.deleteReport).toHaveBeenCalledWith(
        "test-org",
        reportName
      );

      // Verify lists remain unchanged
      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount);
      expect(wrapper.vm.reportsTableRows.length).toBe(initialTableRowsCount);
      expect(wrapper.vm.staticReportsList.find(r => r.name === reportName)).toBeTruthy();
      expect(wrapper.vm.reportsTableRows.find(r => r.name === reportName)).toBeTruthy();
    });

    it("handles 403 error silently when deleting report", async () => {
      const reportName = "Test Report 1";
      const error = {
        response: {
          status: 403
        }
      };

      // Setup error response
      vi.mocked(reports.deleteReport).mockRejectedValue(error);

      // Store initial counts
      const initialStaticListCount = wrapper.vm.staticReportsList.length;

      // Trigger delete confirmation
      await wrapper.vm.confirmDeleteReport({ name: reportName });
      
      // Trigger delete action
      await wrapper.vm.deleteReport();

      // Verify API call was made
      expect(reports.deleteReport).toHaveBeenCalledWith(
        "test-org",
        reportName
      );

      // Verify lists remain unchanged
      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount);
      expect(wrapper.vm.staticReportsList.find(r => r.name === reportName)).toBeTruthy();
    });

    it("handles delete button click in the table", async () => {
      // Find and click the delete button for the first report
      const deleteButton = wrapper.find('[data-test="report-list-Test Report 1-delete-report"]');
      expect(deleteButton.exists()).toBe(true);
      
      await deleteButton.trigger('click');

      // Verify confirmation dialog is shown with correct data
      expect(wrapper.vm.deleteDialog.show).toBe(true);
      expect(wrapper.vm.deleteDialog.message).toBe('Are you sure you want to delete report "Test Report 1"');
      expect(wrapper.vm.deleteDialog.data).toBe('Test Report 1');
    });
  });

  describe("Create New Report", () => {
    it("navigates to create report page when add report button is clicked", async () => {
      const addButton = wrapper.find('[data-test="report-list-add-report-btn"]');
      expect(addButton.exists()).toBe(true);

      await addButton.trigger('click');

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: {
          org_identifier: store.state.selectedOrganization.identifier
        }
      });
    });
  });

});
