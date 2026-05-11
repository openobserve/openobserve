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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick } from "vue";
import * as vueRouter from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import reports from "@/services/reports";
import ReportList from "./ReportList.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof vueRouter>("vue-router");
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { query: {} } },
    })),
  };
});

vi.mock("@/services/reports", () => ({
  default: {
    listByFolderId: vi.fn(),
    toggleReportStateById: vi.fn(),
    deleteReportById: vi.fn(),
    bulkDeleteById: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getImageURL: vi.fn(() => ""),
    verifyOrganizationStatus: vi.fn(() => Promise.resolve(true)),
    logsErrorMessage: vi.fn((code: string) => `Error: ${code}`),
    mergeRoutes: vi.fn((r1: any[], r2: any[]) => [
      ...(r1 || []),
      ...(r2 || []),
    ]),
    getPath: vi.fn(() => "/"),
    useLocalTimezone: vi.fn(() => "UTC"),
  };
});

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn(() => Promise.resolve()),
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const platform = { is: { desktop: true, mobile: false }, has: { touch: false } };

installQuasar({ plugins: [Dialog, Notify], config: { platform } });

const REPORT_SCHEDULED = {
  report_id: "uuid-scheduled",
  name: "Scheduled Report",
  enabled: true,
  owner: "user@test.com",
  description: "A scheduled report",
  last_triggered_at: 1234567890000000,
  destinations: [{ email: "dest@test.com" }],
  uuid: "uuid-scheduled",
  sql: "SELECT * FROM logs",
};

const REPORT_CACHED = {
  report_id: "uuid-cached",
  name: "Cached Report",
  enabled: false,
  owner: "user@test.com",
  description: "A cached report",
  last_triggered_at: null,
  destinations: [],
  uuid: "uuid-cached",
  sql: "SELECT count(*) FROM logs",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// ODrawer stub: mirrors the props/events of the real component so tests can
// drive open/close via v-model:open and the @close emit.
// Note: we expose props via `data-*` attrs prefixed with `_stub-` to avoid
// collision with the parent template's own `data-test` attribute, which
// fallthroughs to the stub's root element.
const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "size", "showClose", "title", "subTitle", "width", "persistent"],
  emits: ["update:open", "close"],
  inheritAttrs: false,
  template: `
    <div
      v-if="open"
      class="o-drawer-stub"
      :data-stub-size="size"
      :data-stub-show-close="String(showClose)"
      v-bind="$attrs"
    >
      <slot />
    </div>
  `,
};

// MoveAcrossFolders stub: emits @updated / @close to drive ReportList handlers.
const MoveAcrossFoldersStub = {
  name: "MoveAcrossFolders",
  props: ["activeFolderId", "moduleId", "type"],
  emits: ["updated", "close"],
  template: `<div data-test="move-across-folders-stub" />`,
};

function mountComponent() {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { query: {} } },
  };
  vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter as any);

  const wrapper = mount(ReportList, {
    global: {
      plugins: [[Quasar, { platform }], i18n],
      provide: { store, platform, router: mockRouter },
      mocks: { $router: mockRouter },
      stubs: {
        ODrawer: ODrawerStub,
        MoveAcrossFolders: MoveAcrossFoldersStub,
      },
    },
    attachTo: document.body,
  });

  return { wrapper, mockRouter };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ReportList", () => {
  let wrapper: VueWrapper;
  let mockRouter: { push: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.mocked(reports.listByFolderId).mockResolvedValue({
      data: [REPORT_SCHEDULED, REPORT_CACHED],
    } as any);
    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
    store.state.theme = "light";
    store.state.organizationData.allReportsListByFolderId = {};

    const mounted = mountComponent();
    wrapper = mounted.wrapper;
    mockRouter = mounted.mockRouter;

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Render ──────────────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the page container", () => {
      expect(
        wrapper.find('[data-test="report-list-page"]').exists(),
      ).toBe(true);
    });

    it("should render the title", () => {
      expect(
        wrapper.find('[data-test="report-list-title"]').exists(),
      ).toBe(true);
    });

    it("should render the search input", () => {
      expect(
        wrapper.find('[data-test="report-list-search-input"]').exists(),
      ).toBe(true);
    });

    it("should render the add-report button", () => {
      expect(
        wrapper.find('[data-test="report-list-add-report-btn"]').exists(),
      ).toBe(true);
    });

    it("should render the reports table", () => {
      expect(
        wrapper.find('[data-test="report-list-table"]').exists(),
      ).toBe(true);
    });
  });

  // ── Initialization ───────────────────────────────────────────────────────

  describe("component initialization", () => {
    it("should fetch reports from the API on mount", () => {
      expect(vi.mocked(reports.listByFolderId)).toHaveBeenCalled();
    });

    it("should initialize with activeTab set to 'shared'", () => {
      expect(wrapper.vm.activeTab).toBe("shared");
    });

    it("should initialize filterQuery as empty string", () => {
      expect(wrapper.vm.filterQuery).toBe("");
    });

    it("should initialize pagination rowsPerPage to 20", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should set isLoadingReports to false after fetching", () => {
      expect(wrapper.vm.isLoadingReports).toBe(false);
    });

    it("should populate reportsTableRows after a successful fetch", () => {
      // Scheduled tab is active by default — only REPORT_SCHEDULED shows
      expect(wrapper.vm.reportsTableRows.length).toBeGreaterThan(0);
    });

    it("should handle non-403 fetch error without crashing", async () => {
      vi.mocked(reports.listByFolderId).mockRejectedValueOnce({
        response: { status: 500, data: { message: "Server error" } },
      });
      const { wrapper: w } = mountComponent();
      await flushPromises();
      expect(w.vm.isLoadingReports).toBe(false);
      w.unmount();
    });

    it("should handle 403 fetch error silently", async () => {
      vi.mocked(reports.listByFolderId).mockRejectedValueOnce({
        response: { status: 403 },
      });
      const { wrapper: w } = mountComponent();
      await flushPromises();
      expect(w.vm.isLoadingReports).toBe(false);
      w.unmount();
    });
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  describe("pagination", () => {
    it("should update rowsPerPage when pagination changes", async () => {
      const paginationComp = wrapper.findComponent(QTablePagination);
      expect(paginationComp.exists()).toBe(true);
      await paginationComp.vm.$emit("update:changeRecordPerPage", {
        label: "50",
        value: 50,
      });
      await nextTick();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.selectedPerPage).toBe(50);
    });
  });

  // ── Tab filtering ────────────────────────────────────────────────────────

  describe("tab filtering", () => {
    it("should map all staticReportsList rows to reportsTableRows on 'shared' tab", async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
      wrapper.vm.activeTab = "shared";
      await wrapper.vm.filterReports();
      // filterReports re-numbers all rows; tab filtering is done server-side via listByFolderId
      expect(wrapper.vm.reportsTableRows).toHaveLength(2);
      expect(wrapper.vm.reportsTableRows[0]["#"]).toBe(1);
      expect(wrapper.vm.reportsTableRows[1]["#"]).toBe(2);
    });

    it("should map all staticReportsList rows to reportsTableRows on 'cached' tab", async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
      wrapper.vm.activeTab = "cached";
      await wrapper.vm.filterReports();
      expect(wrapper.vm.reportsTableRows).toHaveLength(2);
    });

    it("should update resultTotal after filterReports", async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
      wrapper.vm.activeTab = "shared";
      await wrapper.vm.filterReports();
      expect(wrapper.vm.resultTotal).toBe(wrapper.vm.reportsTableRows.length);
    });

    it("should re-number rows with '#' after filtering", async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 99 },
        { ...REPORT_CACHED, "#": 99 },
      ];
      wrapper.vm.activeTab = "shared";
      await wrapper.vm.filterReports();
      expect(wrapper.vm.reportsTableRows[0]["#"]).toBe(1);
    });
  });

  // ── Search filter ────────────────────────────────────────────────────────

  describe("search filter (filterData)", () => {
    it("should return matching rows by name (case-insensitive)", () => {
      const rows = [
        { name: "Alpha Report", destinations: [] },
        { name: "Beta Report", destinations: [] },
      ];
      const result = wrapper.vm.filterData(rows, "alpha");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Alpha Report");
    });

    it("should return empty array when no name matches", () => {
      const rows = [{ name: "Alpha Report", destinations: [] }];
      const result = wrapper.vm.filterData(rows, "gamma");
      expect(result).toHaveLength(0);
    });

    it("should handle special characters in search term", () => {
      const rows = [
        { name: "Report (Special)", destinations: [] },
        { name: "Normal Report", destinations: [] },
      ];
      const result = wrapper.vm.filterData(rows, "(Special)");
      expect(result).toHaveLength(1);
    });
  });

  // ── visibleRows computed & resultTotal watch ─────────────────────────────

  describe("visibleRows computed property", () => {
    beforeEach(async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { name: "Another Scheduled", enabled: true, destinations: [{}], last_triggered_at: null, uuid: "u3", "#": 2 },
      ];
      wrapper.vm.activeTab = "shared";
      await wrapper.vm.filterReports();
    });

    it("should return all rows when filterQuery is empty", () => {
      wrapper.vm.filterQuery = "";
      expect(wrapper.vm.visibleRows).toHaveLength(
        wrapper.vm.reportsTableRows.length,
      );
    });

    it("should filter rows by filterQuery", async () => {
      wrapper.vm.filterQuery = "Another";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(1);
      expect(wrapper.vm.visibleRows[0].name).toBe("Another Scheduled");
    });

    it("should update resultTotal when visibleRows change (watch)", async () => {
      wrapper.vm.filterQuery = "Scheduled Report";
      await nextTick();
      // Give the watcher a tick to run
      await nextTick();
      expect(wrapper.vm.resultTotal).toBe(wrapper.vm.visibleRows.length);
    });
  });

  // ── Date formatting ──────────────────────────────────────────────────────

  describe("convertUnixToQuasarFormat", () => {
    it("should format a valid unix microsecond timestamp", () => {
      const formatted = wrapper.vm.convertUnixToQuasarFormat(1234567890000000);
      expect(formatted).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
      );
    });

    it("should return empty string for null", () => {
      expect(wrapper.vm.convertUnixToQuasarFormat(null)).toBe("");
    });

    it("should return empty string for undefined", () => {
      expect(wrapper.vm.convertUnixToQuasarFormat(undefined)).toBe("");
    });
  });

  // ── Toggle report state ──────────────────────────────────────────────────

  describe("toggleReportState", () => {
    it("should call the toggleReportStateById API with correct args", async () => {
      vi.mocked(reports.toggleReportStateById).mockResolvedValueOnce({} as any);
      await wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      await flushPromises();
      expect(vi.mocked(reports.toggleReportStateById)).toHaveBeenCalledWith(
        "test-org",
        REPORT_SCHEDULED.report_id,
        false, // toggling enabled→disabled
      );
    });

    it("should update enabled flag in staticReportsList on success", async () => {
      wrapper.vm.staticReportsList = [{ ...REPORT_SCHEDULED, "#": 1 }];
      wrapper.vm.reportsTableRows = [{ ...REPORT_SCHEDULED, "#": 1 }];
      vi.mocked(reports.toggleReportStateById).mockResolvedValueOnce({} as any);
      await wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      await flushPromises();
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ).enabled,
      ).toBe(false);
    });

    it("should clear loading state after successful toggle", async () => {
      vi.mocked(reports.toggleReportStateById).mockResolvedValueOnce({} as any);
      await wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      await flushPromises();
      expect(
        wrapper.vm.reportsStateLoadingMap[REPORT_SCHEDULED.report_id],
      ).toBe(false);
    });

    it("should set loading state to true during toggle operation", async () => {
      let resolve: (v: any) => void;
      vi.mocked(reports.toggleReportStateById).mockReturnValueOnce(
        new Promise((r) => { resolve = r; }) as any,
      );
      const op = wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      expect(wrapper.vm.reportsStateLoadingMap[REPORT_SCHEDULED.report_id]).toBe(true);
      resolve!({});
      await op;
      await flushPromises();
    });

    it("should clear loading state after non-403 error", async () => {
      vi.mocked(reports.toggleReportStateById).mockRejectedValueOnce({
        response: { status: 500, data: { message: "error" } },
      });
      await wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      await flushPromises();
      expect(
        wrapper.vm.reportsStateLoadingMap[REPORT_SCHEDULED.report_id],
      ).toBe(false);
    });

    it("should clear loading state silently for 403 error", async () => {
      vi.mocked(reports.toggleReportStateById).mockRejectedValueOnce({
        response: { status: 403 },
      });
      await wrapper.vm.toggleReportState(REPORT_SCHEDULED);
      await flushPromises();
      expect(
        wrapper.vm.reportsStateLoadingMap[REPORT_SCHEDULED.report_id],
      ).toBe(false);
    });
  });

  // ── Edit report ──────────────────────────────────────────────────────────

  describe("editReport", () => {
    it("should navigate to createReport route with correct query params", async () => {
      await wrapper.vm.editReport(REPORT_SCHEDULED);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: {
          report_id: REPORT_SCHEDULED.report_id,
          name: REPORT_SCHEDULED.name,
          org_identifier: "test-org",
          folder: "default",
        },
      });
    });

    it("should trigger navigation from edit button click in table", async () => {
      const btn = wrapper.find(
        `[data-test="report-list-${REPORT_SCHEDULED.name}-edit-report"]`,
      );
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "createReport" }),
      );
    });
  });

  // ── Delete single report ─────────────────────────────────────────────────

  describe("deleteReport", () => {
    it("should open delete dialog with correct message", async () => {
      await wrapper.vm.confirmDeleteReport(REPORT_SCHEDULED);
      expect(wrapper.vm.deleteDialog.show).toBe(true);
      expect(wrapper.vm.deleteDialog.message).toBe(
        `Are you sure you want to delete report "${REPORT_SCHEDULED.name}"`,
      );
      expect(wrapper.vm.deleteDialog.data).toEqual({
        report_id: REPORT_SCHEDULED.report_id,
        name: REPORT_SCHEDULED.name,
      });
    });

    it("should remove the report from lists after successful delete", async () => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
      wrapper.vm.reportsTableRows = [{ ...REPORT_SCHEDULED, "#": 1 }];
      vi.mocked(reports.deleteReportById).mockResolvedValueOnce({} as any);
      await wrapper.vm.confirmDeleteReport(REPORT_SCHEDULED);
      await wrapper.vm.deleteReport();
      await flushPromises();
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ),
      ).toBeUndefined();
    });

    it("should keep lists intact after non-403 delete error", async () => {
      wrapper.vm.staticReportsList = [{ ...REPORT_SCHEDULED, "#": 1 }];
      vi.mocked(reports.deleteReportById).mockRejectedValueOnce({
        response: { status: 500, data: { message: "error" } },
      });
      await wrapper.vm.confirmDeleteReport(REPORT_SCHEDULED);
      await wrapper.vm.deleteReport();
      await flushPromises();
      expect(wrapper.vm.staticReportsList).toHaveLength(1);
    });

    it("should silently handle 403 delete error", async () => {
      wrapper.vm.staticReportsList = [{ ...REPORT_SCHEDULED, "#": 1 }];
      vi.mocked(reports.deleteReportById).mockRejectedValueOnce({
        response: { status: 403 },
      });
      await wrapper.vm.confirmDeleteReport(REPORT_SCHEDULED);
      await wrapper.vm.deleteReport();
      await flushPromises();
      expect(wrapper.vm.staticReportsList).toHaveLength(1);
    });

    it("should show delete dialog when delete button is clicked in table", async () => {
      const btn = wrapper.find(
        `[data-test="report-list-${REPORT_SCHEDULED.name}-delete-report"]`,
      );
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.vm.deleteDialog.show).toBe(true);
    });
  });

  // ── Create new report ────────────────────────────────────────────────────

  describe("createNewReport", () => {
    it("should navigate to createReport when add button is clicked", async () => {
      const btn = wrapper.find('[data-test="report-list-add-report-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createReport",
        query: { org_identifier: "test-org", folder: "default" },
      });
    });
  });

  // ── Bulk delete ──────────────────────────────────────────────────────────

  describe("openBulkDeleteDialog", () => {
    it("should set confirmBulkDelete to true", () => {
      wrapper.vm.openBulkDeleteDialog();
      expect(wrapper.vm.confirmBulkDelete).toBe(true);
    });
  });

  describe("bulkDeleteReports", () => {
    beforeEach(() => {
      wrapper.vm.staticReportsList = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
      wrapper.vm.reportsTableRows = [
        { ...REPORT_SCHEDULED, "#": 1 },
        { ...REPORT_CACHED, "#": 2 },
      ];
    });

    it("should call bulkDeleteById API with selected report IDs", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: { successful: [REPORT_SCHEDULED.report_id], unsuccessful: [] },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(vi.mocked(reports.bulkDeleteById)).toHaveBeenCalledWith("test-org", {
        ids: [REPORT_SCHEDULED.report_id],
      });
    });

    it("should remove successfully deleted reports from staticReportsList", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: { successful: [REPORT_SCHEDULED.report_id], unsuccessful: [] },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ),
      ).toBeUndefined();
    });

    it("should clear selectedReports after bulk delete", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: { successful: [REPORT_SCHEDULED.report_id], unsuccessful: [] },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(wrapper.vm.selectedReports).toHaveLength(0);
    });

    it("should close confirmBulkDelete dialog after bulk delete", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      wrapper.vm.confirmBulkDelete = true;
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: { successful: [REPORT_SCHEDULED.report_id], unsuccessful: [] },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("should handle partial success (some failed) without crashing", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED, REPORT_CACHED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: {
          successful: [REPORT_SCHEDULED.report_id],
          unsuccessful: [REPORT_CACHED.report_id],
        },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      // Only the successful one should be removed
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ),
      ).toBeUndefined();
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_CACHED.report_id,
        ),
      ).toBeDefined();
    });

    it("should handle all-failed response without crashing", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({
        data: { successful: [], unsuccessful: [REPORT_SCHEDULED.report_id] },
      } as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      // None removed when successful list is empty
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ),
      ).toBeDefined();
    });

    it("should handle response with no data field without crashing", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockResolvedValueOnce({} as any);
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      // successful defaults to [] so nothing is removed
      expect(
        wrapper.vm.staticReportsList.find(
          (r: any) => r.report_id === REPORT_SCHEDULED.report_id,
        ),
      ).toBeDefined();
    });

    it("should notify and return early when no reports are selected", async () => {
      wrapper.vm.selectedReports = [];
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(vi.mocked(reports.bulkDeleteById)).not.toHaveBeenCalled();
    });

    it("should handle API error without crashing and close dialog", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED];
      vi.mocked(reports.bulkDeleteById).mockRejectedValueOnce({
        response: { status: 500, data: { message: "Server error" } },
        message: "Server error",
      });
      await wrapper.vm.bulkDeleteReports();
      await flushPromises();
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });
  });

  // ── Move to folder (ODrawer migration) ───────────────────────────────────
  // q-dialog → ODrawer: v-model:open, size="lg", show-close="false",
  // @close=showMoveDialog=false. Drawer hosts <MoveAcrossFolders /> which
  // emits @updated (-> onMoveUpdated) and @close (-> closes drawer).

  describe("move-to-folder ODrawer", () => {
    it("should keep showMoveDialog false on initial render", () => {
      expect(wrapper.vm.showMoveDialog).toBe(false);
    });

    it("should not render the drawer when showMoveDialog is false", () => {
      expect(
        wrapper.find(
          '[data-test="report-move-to-another-folder-dialog"]',
        ).exists(),
      ).toBe(false);
    });

    it("should open the drawer when openMoveDialog is called for a single row", async () => {
      const row = { ...REPORT_SCHEDULED, folder_id: "folder-A" };
      wrapper.vm.openMoveDialog(row);
      await nextTick();
      expect(wrapper.vm.showMoveDialog).toBe(true);
      expect(wrapper.vm.activeFolderToMove).toBe("folder-A");
      expect(wrapper.vm.reportIdsToMove).toEqual([REPORT_SCHEDULED.report_id]);
    });

    it("should fall back to activeFolderId when row has no folder_id", async () => {
      const row = { ...REPORT_SCHEDULED, folder_id: undefined };
      wrapper.vm.openMoveDialog(row);
      await nextTick();
      expect(wrapper.vm.activeFolderToMove).toBe(
        wrapper.vm.activeFolderId,
      );
    });

    it("should render the ODrawer once showMoveDialog flips to true", async () => {
      wrapper.vm.openMoveDialog({ ...REPORT_SCHEDULED, folder_id: "f1" });
      await nextTick();
      const drawer = wrapper.find(
        '[data-test="report-move-to-another-folder-dialog"]',
      );
      expect(drawer.exists()).toBe(true);
      // Confirm props from the migration: size="lg", show-close=false
      expect(drawer.attributes("data-stub-size")).toBe("lg");
      expect(drawer.attributes("data-stub-show-close")).toBe("false");
    });

    it("should render MoveAcrossFolders inside the drawer when open", async () => {
      wrapper.vm.openMoveDialog({ ...REPORT_SCHEDULED, folder_id: "f1" });
      await nextTick();
      expect(
        wrapper.find('[data-test="move-across-folders-stub"]').exists(),
      ).toBe(true);
    });

    it("should open drawer for bulk move via moveMultipleReports", async () => {
      wrapper.vm.selectedReports = [REPORT_SCHEDULED, REPORT_CACHED];
      wrapper.vm.moveMultipleReports();
      await nextTick();
      expect(wrapper.vm.showMoveDialog).toBe(true);
      expect(wrapper.vm.reportIdsToMove).toEqual([
        REPORT_SCHEDULED.report_id,
        REPORT_CACHED.report_id,
      ]);
      expect(wrapper.vm.activeFolderToMove).toBe(
        wrapper.vm.activeFolderId,
      );
    });

    it("should close drawer when ODrawer emits @close", async () => {
      wrapper.vm.openMoveDialog({ ...REPORT_SCHEDULED, folder_id: "f1" });
      await nextTick();
      // Multiple ODrawer stubs may exist (some descendants render their own).
      // Pick the one carrying our own data-test attribute (fallthrough from
      // the template's `data-test="report-move-to-another-folder-dialog"`).
      const drawer = wrapper
        .findAllComponents(ODrawerStub)
        .find((c) =>
          c.attributes("data-test") === "report-move-to-another-folder-dialog",
        );
      expect(drawer).toBeTruthy();
      await drawer!.vm.$emit("close");
      await nextTick();
      expect(wrapper.vm.showMoveDialog).toBe(false);
    });

    it("should close drawer when MoveAcrossFolders emits @close", async () => {
      wrapper.vm.openMoveDialog({ ...REPORT_SCHEDULED, folder_id: "f1" });
      await nextTick();
      const child = wrapper.findComponent(MoveAcrossFoldersStub);
      expect(child.exists()).toBe(true);
      await child.vm.$emit("close");
      await nextTick();
      expect(wrapper.vm.showMoveDialog).toBe(false);
    });

    it("should run onMoveUpdated when MoveAcrossFolders emits @updated", async () => {
      wrapper.vm.openMoveDialog({ ...REPORT_SCHEDULED, folder_id: "from-f" });
      await nextTick();
      const child = wrapper.findComponent(MoveAcrossFoldersStub);
      expect(child.exists()).toBe(true);
      // Reset the API spy to assert reload happens
      vi.mocked(reports.listByFolderId).mockClear();
      vi.mocked(reports.listByFolderId).mockResolvedValue({
        data: [REPORT_SCHEDULED],
      } as any);
      // Pass the active folder ("default") as the source folder so its cache
      // is invalidated and loadReports() goes back to the API instead of cache.
      await child.vm.$emit("updated", "default", "to-f");
      await flushPromises();
      // Drawer closes, selection clears, ids reset, and reports reload
      expect(wrapper.vm.showMoveDialog).toBe(false);
      expect(wrapper.vm.selectedReports).toEqual([]);
      expect(wrapper.vm.reportIdsToMove).toEqual([]);
      expect(vi.mocked(reports.listByFolderId)).toHaveBeenCalled();
    });

    it("should open drawer when single-row move button is clicked", async () => {
      const btn = wrapper.find(
        `[data-test="report-list-${REPORT_SCHEDULED.name}-move-report"]`,
      );
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      await nextTick();
      expect(wrapper.vm.showMoveDialog).toBe(true);
      expect(wrapper.vm.reportIdsToMove).toEqual([REPORT_SCHEDULED.report_id]);
    });
  });
});
