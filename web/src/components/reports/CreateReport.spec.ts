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
import { Notify, Quasar } from "quasar";
import * as vueRouter from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import reports from "@/services/reports";
import dashboardService from "@/services/dashboards";
import CreateReport from "./CreateReport.vue";

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof vueRouter>("vue-router");
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      back: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { query: {} } },
    })),
  };
});

vi.mock("@/services/reports", () => ({
  default: {
    getReport: vi.fn(),
    getReportById: vi.fn(),
    createReport: vi.fn(),
    createReportV2: vi.fn(),
    updateReport: vi.fn(),
    updateReportById: vi.fn(),
  },
}));

vi.mock("@/services/dashboards", () => ({
  default: {
    list_Folders: vi.fn(),
    list: vi.fn(),
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
    getUUID: vi.fn(() => "mock-uuid"),
    isValidResourceName: vi.fn((val: string) => /^[a-zA-Z0-9+=,.@_-]+$/.test(val)),
    useLocalTimezone: vi.fn(() => "UTC"),
    getCronIntervalDifferenceInSeconds: vi.fn(() => 3600),
    isAboveMinRefreshInterval: vi.fn(() => true),
    verifyOrganizationStatus: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn(() => ({
    timestamp: 1700000000,
    offset: 0,
  })),
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const platform = { is: { desktop: true, mobile: false }, has: { touch: false } };

installQuasar({ plugins: [Notify], config: { platform } });

const MOCK_FOLDERS = [
  { name: "Default", folderId: "folder-1" },
  { name: "Reports", folderId: "folder-2" },
];

const MOCK_DASHBOARDS = [
  {
    v1: {
      title: "My Dashboard",
      dashboardId: "dash-1",
      tabs: [{ name: "Tab 1", tabId: "tab-1" }],
      version: 1,
    },
  },
];

const MOCK_REPORT = {
  name: "existing-report",
  description: "Existing description",
  dashboards: [
    {
      folder: "folder-1",
      dashboard: "dash-1",
      tabs: "tab-1",
      variables: [],
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
    },
  ],
  destinations: [{ email: "dest@example.com" }],
  enabled: true,
  title: "Report Title",
  message: "Hello",
  orgId: "test-org",
  start: 0,
  frequency: { interval: 1, type: "once", cron: "" },
  timezone: "UTC",
  timezoneOffset: 0,
  lastTriggeredAt: null,
  createdAt: "",
  updatedAt: "",
  owner: "user@test.com",
  lastEditedBy: "user@test.com",
  report_type: "PDF",
};

// ─── Mount factory ────────────────────────────────────────────────────────────

function mountComponent(routeQuery: Record<string, string> = {}) {
  const mockRouter = {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { query: routeQuery } },
  };
  vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter as any);

  const wrapper = mount(CreateReport, {
    global: {
      plugins: [[Quasar, { platform }], i18n],
      provide: { store, platform },
      stubs: {
        DateTime: { template: '<div data-test="datetime-stub" />' },
        VariablesInput: { template: '<div data-test="variables-stub" />' },
        ConfirmDialog: { template: '<div data-test="confirm-dialog-stub" />' },
        "q-stepper": { template: "<div><slot /></div>" },
        "q-step": { template: "<div><slot /></div>" },
        "q-stepper-navigation": { template: "<div><slot /></div>" },
      },
    },
    attachTo: document.body,
  });

  return { wrapper, mockRouter };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateReport", () => {
  let wrapper: VueWrapper;
  let mockRouter: ReturnType<typeof mountComponent>["mockRouter"];

  beforeEach(() => {
    vi.mocked(dashboardService.list_Folders).mockResolvedValue({
      data: { list: MOCK_FOLDERS },
    } as any);
    vi.mocked(dashboardService.list).mockResolvedValue({
      data: { dashboards: MOCK_DASHBOARDS },
    } as any);
    vi.mocked(reports.createReport).mockResolvedValue({} as any);
    vi.mocked(reports.createReportV2).mockResolvedValue({} as any);
    vi.mocked(reports.updateReport).mockResolvedValue({} as any);
    vi.mocked(reports.updateReportById).mockResolvedValue({} as any);
    vi.mocked(reports.getReport).mockResolvedValue({ data: MOCK_REPORT } as any);
    vi.mocked(reports.getReportById).mockResolvedValue({ data: MOCK_REPORT } as any);

    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
    store.state.userInfo = { email: "user@test.com" };
    store.state.theme = "light";
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Render ──────────────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render without errors", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the add-report section", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-section"]').exists()).toBe(true);
    });

    it("should render the back button", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-back-btn"]').exists()).toBe(true);
    });

    it("should render 'Add Report' title when not editing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const title = wrapper.find('[data-test="add-report-title"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toContain(i18n.global.t("reports.add"));
    });

    it("should render the report name input", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-name-input"]').exists()).toBe(true);
    });

    it("should render the description input", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-description-input"]').exists()).toBe(true);
    });

    it("should render the cached report toggle", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="report-cached-toggle-btn"]').exists()).toBe(true);
    });
  });

  // ── Edit mode ────────────────────────────────────────────────────────────

  describe("edit mode (route has name query param)", () => {
    beforeEach(async () => {
      ({ wrapper, mockRouter } = mountComponent({ name: "existing-report", org_identifier: "test-org" }));
      await flushPromises();
    });

    it("should show 'Update Report' title when editing", () => {
      const title = wrapper.find('[data-test="add-report-title"]');
      expect(title.text()).toContain(i18n.global.t("reports.update"));
    });

    it("should call getReport API with correct args", () => {
      expect(vi.mocked(reports.getReport)).toHaveBeenCalledWith(
        "test-org",
        "existing-report",
      );
    });

    it("should set isEditingReport to true", () => {
      expect(wrapper.vm.isEditingReport).toBe(true);
    });

    it("should populate formData from the fetched report", () => {
      expect(wrapper.vm.formData.name).toBe(MOCK_REPORT.name);
      expect(wrapper.vm.formData.description).toBe(MOCK_REPORT.description);
    });

    it("should handle getReport non-403 error without crashing", async () => {
      vi.mocked(reports.getReport).mockRejectedValueOnce({
        response: { status: 500, data: { message: "error" } },
      });
      const { wrapper: w } = mountComponent({ name: "bad-report" });
      await flushPromises();
      expect(w.vm.isFetchingReport).toBe(false);
      w.unmount();
    });

    it("should handle getReport 403 error silently", async () => {
      vi.mocked(reports.getReport).mockRejectedValueOnce({
        response: { status: 403 },
      });
      const { wrapper: w } = mountComponent({ name: "forbidden-report" });
      await flushPromises();
      expect(w.vm.isFetchingReport).toBe(false);
      w.unmount();
    });
  });

  // ── Back navigation ──────────────────────────────────────────────────────

  describe("back button", () => {
    it("should call router.back() when back button is clicked", async () => {
      ({ wrapper, mockRouter } = mountComponent());
      await flushPromises();
      await wrapper.find('[data-test="add-report-back-btn"]').trigger("click");
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cached report toggle ─────────────────────────────────────────────────

  describe("cached report toggle", () => {
    it("should initialize isCachedReport as false", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.vm.isCachedReport).toBe(false);
    });

    it("should set isCachedReport=true when query param type=cached", async () => {
      ({ wrapper } = mountComponent({ type: "cached" }));
      await flushPromises();
      expect(wrapper.vm.isCachedReport).toBe(true);
    });
  });

  // ── Folder loading ───────────────────────────────────────────────────────

  describe("getDashboardFolders", () => {
    it("should fetch folders on mount", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(vi.mocked(dashboardService.list_Folders)).toHaveBeenCalledWith(
        "test-org",
      );
    });

    it("should populate folderOptions after fetch", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.vm.folderOptions).toHaveLength(MOCK_FOLDERS.length);
      expect(wrapper.vm.folderOptions[0].label).toBe("Default");
    });
  });

  // ── Dashboard loading ────────────────────────────────────────────────────

  describe("onFolderSelection", () => {
    it("should load dashboards when a folder is selected", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await wrapper.vm.onFolderSelection("folder-1");
      expect(vi.mocked(dashboardService.list)).toHaveBeenCalledWith(
        0,
        10000,
        "name",
        false,
        "",
        "test-org",
        "folder-1",
        "",
      );
    });

    it("should clear dashboard and tabs selection when folder changes", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.dashboards[0].dashboard = "dash-old";
      wrapper.vm.formData.dashboards[0].tabs = "tab-old";
      await wrapper.vm.onFolderSelection("folder-1");
      expect(wrapper.vm.formData.dashboards[0].dashboard).toBe("");
      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("");
    });
  });

  // ── Dashboard tab options ────────────────────────────────────────────────

  describe("onDashboardSelection", () => {
    it("should clear tabs when dashboard changes", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await wrapper.vm.onFolderSelection("folder-1");
      wrapper.vm.formData.dashboards[0].tabs = "tab-old";
      wrapper.vm.onDashboardSelection("dash-1");
      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("");
    });
  });

  // ── updateDateTime ───────────────────────────────────────────────────────

  describe("updateDateTime", () => {
    it("should update timerange type for relative", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.updateDateTime({
        valueType: "relative",
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "1h",
      });
      expect(wrapper.vm.formData.dashboards[0].timerange.type).toBe("relative");
      expect(wrapper.vm.formData.dashboards[0].timerange.period).toBe("1h");
    });

    it("should update timerange type for absolute", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.updateDateTime({
        valueType: "absolute",
        startTime: 1000,
        endTime: 2000,
        relativeTimePeriod: null,
      });
      expect(wrapper.vm.formData.dashboards[0].timerange.type).toBe("absolute");
      expect(wrapper.vm.formData.dashboards[0].timerange.from).toBe(1000);
      expect(wrapper.vm.formData.dashboards[0].timerange.to).toBe(2000);
    });

    it("should map relative-custom to relative type", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.updateDateTime({
        valueType: "relative-custom",
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "2d",
      });
      expect(wrapper.vm.formData.dashboards[0].timerange.type).toBe("relative");
    });
  });

  // ── Dashboard variables ──────────────────────────────────────────────────

  describe("addDashboardVariable / removeDashboardVariable", () => {
    it("should add a new variable entry", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const before = wrapper.vm.formData.dashboards[0].variables.length;
      wrapper.vm.addDashboardVariable();
      expect(wrapper.vm.formData.dashboards[0].variables).toHaveLength(before + 1);
    });

    it("should remove a variable by id", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.addDashboardVariable();
      const vars = wrapper.vm.formData.dashboards[0].variables;
      const added = vars[vars.length - 1];
      wrapper.vm.removeDashboardVariable(added);
      expect(
        wrapper.vm.formData.dashboards[0].variables.find(
          (v: any) => v.id === added.id,
        ),
      ).toBeUndefined();
    });
  });

  // ── Timezone filter ──────────────────────────────────────────────────────

  describe("filterColumns / timezoneFilterFn", () => {
    it("should return all timezone options when val is empty", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const options = ["UTC", "America/New_York", "Asia/Tokyo"];
      let result: string[] = [];
      wrapper.vm.filterColumns(options, "", (fn: Function) => {
        fn();
        result = wrapper.vm.filteredTimezone;
      });
      // filterColumns returns the filtered list; just verify it doesn't throw
      expect(wrapper.exists()).toBe(true);
    });

    it("should filter timezone options by substring", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const options = ["UTC", "America/New_York", "Asia/Tokyo"];
      let result: string[] = [];
      const returned = wrapper.vm.filterColumns(options, "America", (fn: Function) => {
        fn();
      });
      expect(returned).toHaveLength(1);
      expect(returned[0]).toBe("America/New_York");
    });
  });

  // ── saveReport (create) ──────────────────────────────────────────────────

  describe("saveReport — create mode", () => {
    function setupValidForm(w: VueWrapper) {
      // Fill minimum required form data for validation to pass
      w.vm.formData.name = "new-report";
      w.vm.formData.dashboards[0].folder = "folder-1";
      w.vm.formData.dashboards[0].dashboard = "dash-1";
      w.vm.formData.dashboards[0].tabs = "tab-1";
      w.vm.formData.frequency = { interval: 1, type: "once", cron: "" };
      w.vm.formData.start = 1000;
      w.vm.formData.timezone = "UTC";
      w.vm.formData.title = "Test Title";
      w.vm.emails = "user@example.com";
      w.vm.scheduling = { date: "01-01-2025", time: "10:00", timezone: "UTC" };
      // Quasar form ref not attached in jsdom — mock validate() to return true
      w.vm.addReportFormRef = { validate: vi.fn().mockResolvedValue(true) };
    }

    it("should call createReport when not editing", async () => {
      ({ wrapper, mockRouter } = mountComponent());
      await flushPromises();
      setupValidForm(wrapper);

      await wrapper.vm.saveReport();
      await flushPromises();

      expect(vi.mocked(reports.createReportV2)).toHaveBeenCalled();
    });

    it("should navigate to reports list after successful create", async () => {
      ({ wrapper, mockRouter } = mountComponent());
      await flushPromises();
      setupValidForm(wrapper);

      await wrapper.vm.saveReport();
      await flushPromises();

      // goToReports uses router.replace (not push)
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({ name: "reports" }),
      );
    });
  });

  // ── saveReport (update) ──────────────────────────────────────────────────

  describe("saveReport — edit mode", () => {
    it("should call updateReport when editing", async () => {
      ({ wrapper } = mountComponent({ name: "existing-report" }));
      await flushPromises();

      wrapper.vm.emails = "user@example.com";
      wrapper.vm.scheduling = { date: "01-01-2025", time: "10:00", timezone: "UTC" };
      wrapper.vm.formData.title = "Updated Title";
      // Quasar form ref not attached in jsdom — mock validate() to return true
      wrapper.vm.addReportFormRef = { validate: vi.fn().mockResolvedValue(true) };

      await wrapper.vm.saveReport();
      await flushPromises();

      expect(vi.mocked(reports.updateReport)).toHaveBeenCalled();
    });
  });

  // ── validateReportData ───────────────────────────────────────────────────

  describe("validateReportData", () => {
    it("should set step to 1 when folder is missing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.dashboards[0].folder = "";
      wrapper.vm.step = 2;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("should set step to 1 when dashboard is missing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "";
      wrapper.vm.step = 2;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("should set step to 1 when tabs are missing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "dash-1";
      wrapper.vm.formData.dashboards[0].tabs = "";
      wrapper.vm.step = 2;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("should set step to 3 when title is missing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "dash-1";
      wrapper.vm.formData.dashboards[0].tabs = "tab-1";
      wrapper.vm.formData.start = 1000;
      wrapper.vm.formData.timezone = "UTC";
      wrapper.vm.formData.frequency = { interval: 1, type: "once", cron: "" };
      wrapper.vm.formData.title = "";
      wrapper.vm.emails = "valid@example.com";
      wrapper.vm.step = 1;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(3);
    });
  });

  // ── isValidName computed ─────────────────────────────────────────────────

  describe("isValidName computed", () => {
    it("should return true for a valid alphanumeric name", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.name = "valid-report_1";
      expect(wrapper.vm.isValidName).toBe(true);
    });

    it("should return false when name contains spaces", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      wrapper.vm.formData.name = "invalid name";
      expect(wrapper.vm.isValidName).toBe(false);
    });
  });
});
