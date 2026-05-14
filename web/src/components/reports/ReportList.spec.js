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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick, ref } from 'vue';
import ReportList from "./ReportList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
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
      replace: vi.fn(),
      currentRoute: { value: { query: {} } },
    }))
  };
});

// Mock reports service
vi.mock("@/services/reports", () => ({
  default: {
    listByFolderId: vi.fn(),
    toggleReportStateById: vi.fn(),
    deleteReportById: vi.fn(),
    bulkDeleteById: vi.fn(),
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

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn(() => Promise.resolve()),
}));

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
    vi.mocked(reports.listByFolderId).mockReset();
    vi.mocked(reports.toggleReportStateById).mockReset();
    vi.mocked(reports.deleteReportById).mockReset();

    // Setup default successful response for list
    vi.mocked(reports.listByFolderId).mockResolvedValue({
      data: [
        {
          report_id: "report-1",
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
          report_id: "report-2",
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
    store.state.organizationData.allReportsListByFolderId = {};

    // Setup router mock
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { query: {} } },
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
      expect(reports.listByFolderId).toHaveBeenCalled();
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
      // Keep listByFolderId pending so isLoadingReports stays true while we check it
      let resolveList;
      vi.mocked(reports.listByFolderId).mockReturnValueOnce(
        new Promise((resolve) => { resolveList = resolve; })
      );

      // Clear cache so this mount actually calls the API (not served from beforeEach cache)
      store.state.organizationData.allReportsListByFolderId = {};

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

      // Advance past the getFoldersListByType microtask so loadReports is called
      await nextTick();

      expect(newWrapper.vm.isLoadingReports).toBe(true);
      resolveList({ data: [] });
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
      vi.mocked(reports.listByFolderId).mockRejectedValue(error);

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
      it("maps all staticReportsList rows when tab is cached (server-side filtering)", async () => {
        wrapper.vm.staticReportsList = [...wrapper.vm.reportsTableRows];
        wrapper.vm.activeTab = "cached";
        await wrapper.vm.filterReports();
        // filterReports just re-numbers; tab filtering is server-side via listByFolderId
        expect(wrapper.vm.reportsTableRows.length).toBe(wrapper.vm.staticReportsList.length);
      });

      it("maps all staticReportsList rows when tab is shared (server-side filtering)", async () => {
        wrapper.vm.staticReportsList = [...wrapper.vm.reportsTableRows];
        wrapper.vm.activeTab = "shared";
        await wrapper.vm.filterReports();
        expect(wrapper.vm.reportsTableRows.length).toBe(wrapper.vm.staticReportsList.length);
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
        report_id: "report-1",
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      vi.mocked(reports.toggleReportStateById).mockResolvedValue({});

      await wrapper.vm.toggleReportState(report);
      await flushPromises();

      // Verify API call
      expect(reports.toggleReportStateById).toHaveBeenCalledWith(
        "test-org",
        "report-1",
        false
      );

      // Verify loading state
      expect(wrapper.vm.reportsStateLoadingMap[report.report_id]).toBe(false);

      // Verify state updated in staticReportsList
      expect(wrapper.vm.staticReportsList.find(r => r.report_id === report.report_id).enabled).toBe(false);
    });


    it("handles error when toggling report state (non-403)", async () => {
      const report = {
        report_id: "report-1",
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

      vi.mocked(reports.toggleReportStateById).mockRejectedValue(error);

      await wrapper.vm.toggleReportState(report);
      await flushPromises();


      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.report_id]).toBe(false);
    });

    it("handles 403 error silently when toggling report state", async () => {
      const report = {
        report_id: "report-1",
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      const error = {
        response: {
          status: 403
        }
      };

      vi.mocked(reports.toggleReportStateById).mockRejectedValue(error);

      await wrapper.vm.toggleReportState(report);
      await flushPromises();

      // Verify no error notification for 403
      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative"
        })
      );

      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.report_id]).toBe(false);
    });

    it("maintains loading state during toggle operation", async () => {
      const report = {
        report_id: "report-1",
        name: "Test Report 1",
        enabled: true,
        owner: "test-user"
      };

      let resolvePromise;
      const togglePromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      vi.mocked(reports.toggleReportStateById).mockReturnValue(togglePromise);

      const toggleOperation = wrapper.vm.toggleReportState(report);

      // Verify loading state is set
      expect(wrapper.vm.reportsStateLoadingMap[report.report_id]).toBe(true);

      resolvePromise({});
      await toggleOperation;
      await flushPromises();

      // Verify loading state is cleared
      expect(wrapper.vm.reportsStateLoadingMap[report.report_id]).toBe(false);
    });
  });

  describe("Edit Report", () => {
    it("navigates to edit page with correct query parameters", async () => {
      const report = {
        report_id: "report-1",
        name: "Test Report 1",
        enabled: true,
        owner: "test-user",
        description: "Test Description"
      };

      await wrapper.vm.editReport(report);

      // Verify router navigation
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: {
          report_id: report.report_id,
          name: report.name,
          org_identifier: "test-org",
          folder: "default",
        }
      });
    });

    it("handles edit button click in the table", async () => {
      // Find and click the edit button for the first report
      const editButton = wrapper.find('[data-test="report-list-Test Report 1-edit-report"]');
      expect(editButton.exists()).toBe(true);

      await editButton.trigger('click');

      // Verify router navigation
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "createReport" })
      );
    });
  });

  describe("Delete Report", () => {
    it("confirms and deletes report successfully", async () => {
      const report = { report_id: "report-1", name: "Test Report 1" };

      // Setup successful delete response
      vi.mocked(reports.deleteReportById).mockResolvedValue({});

      // Store initial count
      const initialStaticListCount = wrapper.vm.staticReportsList.length;

      // Trigger delete confirmation
      await wrapper.vm.confirmDeleteReport(report);

      // Verify dialog is shown with correct message
      expect(wrapper.vm.deleteDialog.show).toBe(true);
      expect(wrapper.vm.deleteDialog.message).toBe(`Are you sure you want to delete report "${report.name}"`);
      expect(wrapper.vm.deleteDialog.data).toEqual({ report_id: report.report_id, name: report.name });

      // Trigger delete action
      await wrapper.vm.deleteReport();
      await flushPromises();

      // Verify API call
      expect(reports.deleteReportById).toHaveBeenCalledWith("test-org", report.report_id);

      // Verify report is removed
      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount - 1);
      expect(wrapper.vm.staticReportsList.find(r => r.report_id === report.report_id)).toBeUndefined();
    });

    it("handles error when deleting report (non-403)", async () => {
      const report = { report_id: "report-1", name: "Test Report 1" };
      const error = { response: { status: 500, data: { message: "Internal server error" } } };

      vi.mocked(reports.deleteReportById).mockRejectedValue(error);

      const initialStaticListCount = wrapper.vm.staticReportsList.length;

      await wrapper.vm.confirmDeleteReport(report);
      await wrapper.vm.deleteReport();

      expect(reports.deleteReportById).toHaveBeenCalledWith("test-org", report.report_id);

      // Verify lists remain unchanged
      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount);
      expect(wrapper.vm.staticReportsList.find(r => r.report_id === report.report_id)).toBeTruthy();
    });

    it("handles 403 error silently when deleting report", async () => {
      const report = { report_id: "report-1", name: "Test Report 1" };
      const error = { response: { status: 403 } };

      vi.mocked(reports.deleteReportById).mockRejectedValue(error);

      const initialStaticListCount = wrapper.vm.staticReportsList.length;

      await wrapper.vm.confirmDeleteReport(report);
      await wrapper.vm.deleteReport();

      expect(reports.deleteReportById).toHaveBeenCalledWith("test-org", report.report_id);

      expect(wrapper.vm.staticReportsList.length).toBe(initialStaticListCount);
      expect(wrapper.vm.staticReportsList.find(r => r.report_id === report.report_id)).toBeTruthy();
    });

    it("handles delete button click in the table", async () => {
      const deleteButton = wrapper.find('[data-test="report-list-Test Report 1-delete-report"]');
      expect(deleteButton.exists()).toBe(true);

      await deleteButton.trigger('click');

      // Verify confirmation dialog is shown
      expect(wrapper.vm.deleteDialog.show).toBe(true);
      expect(wrapper.vm.deleteDialog.message).toBe('Are you sure you want to delete report "Test Report 1"');
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
          org_identifier: store.state.selectedOrganization.identifier,
          folder: "default",
        }
      });
    });
  });

});
