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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import AlertHistoryDrawer from "@/components/alerts/AlertHistoryDrawer.vue";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock services
vi.mock("@/services/alerts", () => ({
  default: {
    getHistory: vi.fn(),
  },
}));

vi.mock("@/services/anomaly_detection", () => ({
  default: {
    getConfig: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("@/utils/alerts/anomalySqlBuilder", () => ({
  buildAnomalyPreviewSql: vi.fn(() => "SELECT * FROM anomalies"),
}));

import alertsService from "@/services/alerts";

installQuasar({ plugins: [Notify] });

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Lightweight stubs for the in-house O* components. Each renders the slots
// the component relies on so children remain queryable in tests, and re-emits
// the events the test suite drives state through.
const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "width", "showClose", "persistent", "size", "title", "subTitle"],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test-stub="o-drawer" :data-open="open">
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-header-left"><slot name="header-left" /></div>
      <div data-test-stub="o-drawer-header-right"><slot name="header-right" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading"],
  emits: ["click"],
  template: `<button data-test-stub="o-button" :data-test="$attrs['data-test']" @click="$emit('click', $event)"><slot /></button>`,
  inheritAttrs: false,
};

const OToggleGroupStub = {
  name: "OToggleGroup",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `<div data-test-stub="o-toggle-group"><slot /></div>`,
};

const OToggleGroupItemStub = {
  name: "OToggleGroupItem",
  props: ["value", "size"],
  emits: ["click"],
  template: `<button data-test-stub="o-toggle-group-item" :data-test="$attrs['data-test']" :data-value="value" @click="$parent.$emit('update:modelValue', value)"><slot name="icon-left" /><slot /></button>`,
  inheritAttrs: false,
};

const OTabPanelsStub = {
  name: "OTabPanels",
  props: ["modelValue", "animated"],
  emits: ["update:modelValue"],
  template: `<div data-test-stub="o-tab-panels" :data-active="modelValue"><slot /></div>`,
};

const OTabPanelStub = {
  name: "OTabPanel",
  props: ["name"],
  // Render only the active panel's slot — mirrors real behaviour and avoids
  // mounting both tabs simultaneously (the SQL/PromQL labels otherwise duplicate).
  template: `<div data-test-stub="o-tab-panel" :data-name="name" v-show="$parent.modelValue === name"><slot v-if="$parent.modelValue === name" /></div>`,
};

function buildStubs() {
  return {
    ODrawer: ODrawerStub,
    OButton: OButtonStub,
    OToggleGroup: OToggleGroupStub,
    OToggleGroupItem: OToggleGroupItemStub,
    OTabPanels: OTabPanelsStub,
    OTabPanel: OTabPanelStub,
  };
}

describe("AlertHistoryDrawer.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockAlertDetails = {
    name: "CPU Alert",
    is_real_time: false,
    type: "sql",
    conditions: "SELECT count(*) FROM logs WHERE level='error'",
    description: "Fires when CPU usage exceeds 80%",
  };

  const mockHistoryData = {
    hits: [
      {
        alert_name: "CPU Alert",
        timestamp: Date.now() * 1000, // recent, microseconds
        start_time: (Date.now() - 60000) * 1000,
        end_time: Date.now() * 1000,
        status: "firing",
        is_realtime: false,
        is_silenced: false,
        retries: 0,
        error: null,
        evaluation_took_in_secs: 1.234,
        query_took: 350,
      },
      {
        alert_name: "CPU Alert",
        timestamp: (Date.now() - 3600000) * 1000,
        start_time: (Date.now() - 3660000) * 1000,
        end_time: (Date.now() - 3600000) * 1000,
        status: "ok",
        is_realtime: false,
        is_silenced: false,
        retries: 0,
        error: null,
        evaluation_took_in_secs: 0.512,
        query_took: 120,
      },
      {
        alert_name: "CPU Alert",
        timestamp: (Date.now() - 7200000) * 1000,
        start_time: (Date.now() - 7260000) * 1000,
        end_time: (Date.now() - 7200000) * 1000,
        status: "error",
        is_realtime: false,
        is_silenced: false,
        retries: 3,
        error: "Connection timeout",
        evaluation_took_in_secs: 5.5,
        query_took: 500,
      },
    ],
    total: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: mockHistoryData,
    } as any);
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // Quasar teleported components can throw during unmount in jsdom
    }
  });

  const mountComponent = async (
    propsData: { alertDetails?: any; alertId?: string; open?: boolean } = {},
  ) => {
    wrapper = mount(AlertHistoryDrawer, {
      attachTo: node,
      props: {
        alertDetails: "alertDetails" in propsData ? propsData.alertDetails : mockAlertDetails,
        alertId: propsData.alertId ?? "alert-123",
        open: propsData.open ?? true,
      },
      global: {
        plugins: [i18n, store, router],
        stubs: buildStubs(),
      },
    });
    await flushPromises();
  };

  describe("Component Mounting", () => {
    it("should mount successfully", async () => {
      await mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the ODrawer wrapper", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test-stub="o-drawer"]').exists()).toBe(true);
    });

    it("should have correct data-test attributes", async () => {
      await mountComponent();
      expect(
        wrapper.find('[data-test="alert-details-title"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="alert-history-drawer-date-picker"]')
          .exists(),
      ).toBe(true);
    });

    it("should fetch alert history on mount", async () => {
      await mountComponent();
      expect(alertsService.getHistory).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          alert_id: "alert-123",
          size: 50,
          from: 0,
        }),
      );
    });
  });

  describe("Close Button", () => {
    it("should propagate ODrawer's update:open emit to the parent", async () => {
      await mountComponent();
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      drawer.vm.$emit("update:open", false);
      await flushPromises();
      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });
  });

  describe("Header Display", () => {
    it("should display the alert name", async () => {
      await mountComponent();
      expect(wrapper.text()).toContain("CPU Alert");
    });

    it("should display scheduled chip for non-realtime alerts", async () => {
      await mountComponent();
      expect(wrapper.text()).toContain("Scheduled");
    });

    it("should display real-time chip for realtime alerts", async () => {
      await mountComponent({
        alertDetails: { ...mockAlertDetails, is_real_time: true },
        alertId: "alert-123",
      });
      expect(wrapper.text()).toContain("Real-time");
    });
  });

  describe("Query/Conditions Block", () => {
    const switchToConditionTab = async () => {
      const conditionBtn = wrapper.find(
        '[data-test="alert-history-tab-condition"]',
      );
      await conditionBtn.trigger("click");
      await flushPromises();
    };

    it("should display SQL label for sql type alerts", async () => {
      await mountComponent();
      await switchToConditionTab();
      expect(wrapper.text()).toContain("SQL");
    });

    it("should display PromQL label for promql type alerts", async () => {
      await mountComponent({
        alertDetails: {
          ...mockAlertDetails,
          type: "promql",
          conditions: "rate(http_errors[5m])",
        },
        alertId: "alert-123",
      });
      await switchToConditionTab();
      expect(wrapper.text()).toContain("PromQL");
    });

    it("should display the query text", async () => {
      await mountComponent();
      await switchToConditionTab();
      expect(wrapper.text()).toContain(
        "SELECT count(*) FROM logs WHERE level='error'",
      );
    });

    it("should have a copy button for conditions", async () => {
      await mountComponent();
      await switchToConditionTab();
      expect(
        wrapper
          .find('[data-test="alert-details-copy-conditions-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should display the description when provided", async () => {
      await mountComponent();
      await switchToConditionTab();
      expect(wrapper.text()).toContain("Fires when CPU usage exceeds 80%");
    });

    it("should hide the description section when not provided", async () => {
      await mountComponent({
        alertDetails: { ...mockAlertDetails, description: "" },
        alertId: "alert-123",
      });
      await flushPromises();
      // Description text should not be present when description is empty
      expect(wrapper.text()).not.toContain("Fires when CPU usage exceeds 80%");
    });
  });

  describe("History Table", () => {
    it("should display history table with data", async () => {
      await mountComponent();
      expect(
        wrapper.find('[data-test="alert-details-history-table"]').exists(),
      ).toBe(true);
    });

    it("should display correct number of rows", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.alertHistory.length).toBe(3);
    });

    it("should display result total in component state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.resultTotal).toBe(3);
    });
  });

  describe("Empty & Loading States", () => {
    it("should show loading spinner while fetching", async () => {
      // Delay the resolution to test loading state
      vi.mocked(alertsService.getHistory).mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      wrapper = mount(AlertHistoryDrawer, {
        attachTo: node,
        props: {
          alertDetails: mockAlertDetails,
          alertId: "alert-123",
          open: true,
        },
        global: {
          plugins: [i18n, store, router],
          stubs: buildStubs(),
        },
      });

      // The component should be in loading state
      const vm = wrapper.vm as any;
      expect(vm.isLoadingHistory).toBe(true);
    });

    it("should show empty state when no history", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: { hits: [], total: 0 },
      } as any);

      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.alertHistory.length).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockRejectedValueOnce(
        new Error("API Error"),
      );

      await mountComponent();
      expect(wrapper.exists()).toBe(true);
      const vm = wrapper.vm as any;
      expect(vm.alertHistory.length).toBe(0);
      expect(vm.resultTotal).toBe(0);
    });

    it("should handle API errors with response data", async () => {
      const error = {
        message: "Network error",
        response: {
          data: {
            message: "Network error from API",
          },
        },
      };
      vi.mocked(alertsService.getHistory).mockRejectedValueOnce(error);

      await mountComponent();
      expect(wrapper.exists()).toBe(true);
      const vm = wrapper.vm as any;
      expect(vm.alertHistory.length).toBe(0);
    });
  });

  describe("Date Time Picker", () => {
    it("should have date time picker component", async () => {
      await mountComponent();
      expect(
        wrapper
          .find('[data-test="alert-history-drawer-date-picker"]')
          .exists(),
      ).toBe(true);
    });

    it("should refresh history when date changes with relative time", async () => {
      await mountComponent();
      vi.clearAllMocks();

      vi.mocked(alertsService.getHistory).mockResolvedValue({
        data: mockHistoryData,
      } as any);

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("on:date-change", {
        startTime: 1699800000000000,
        endTime: 1699900000000000,
        relativeTimePeriod: "1h",
      });
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("should refresh history when date changes with absolute time", async () => {
      await mountComponent();
      vi.clearAllMocks();

      vi.mocked(alertsService.getHistory).mockResolvedValue({
        data: mockHistoryData,
      } as any);

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("on:date-change", {
        startTime: 1699800000000000,
        endTime: 1699900000000000,
      });
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("should reset pagination to page 1 on date change", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      vm.pagination.page = 3;
      vm.currentPage = 3;

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("on:date-change", {
        startTime: 1699800000000000,
        endTime: 1699900000000000,
        relativeTimePeriod: "1h",
      });
      await flushPromises();

      expect(vm.currentPage).toBe(1);
      expect(vm.pagination.page).toBe(1);
    });
  });

  describe("Pagination", () => {
    it("should have pagination data initialized", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.pagination).toBeDefined();
      expect(vm.pagination.rowsPerPage).toBe(50);
      expect(vm.pagination.page).toBe(1);
    });

    it("should call getHistory when table requests data", async () => {
      await mountComponent();
      vi.clearAllMocks();

      vi.mocked(alertsService.getHistory).mockResolvedValue({
        data: mockHistoryData,
      } as any);

      const qTable = wrapper.findComponent({ name: "QTable" });
      await qTable.vm.$emit("request", {
        pagination: {
          page: 2,
          rowsPerPage: 50,
        },
      });
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          from: 50, // (page 2 - 1) * 50
          size: 50,
        }),
      );
    });

    it("should update rows number from response total", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.pagination.rowsNumber).toBe(3);
    });
  });

  describe("Actions", () => {
    it("should not crash when alertDetails is null", async () => {
      await mountComponent({
        alertDetails: null,
        alertId: "alert-123",
      });

      // Component should still mount without errors
      expect(wrapper.exists()).toBe(true);

      // The content section (with v-if="alertDetails") should not render
      expect(
        wrapper.find('[data-test="alert-details-history-table"]').exists(),
      ).toBe(false);
    });
  });

  describe("Alert ID Watcher", () => {
    it("should refetch history when alertId prop changes", async () => {
      await mountComponent();
      vi.clearAllMocks();

      vi.mocked(alertsService.getHistory).mockResolvedValue({
        data: { hits: [], total: 0 },
      } as any);

      await wrapper.setProps({ alertId: "alert-456" });
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          alert_id: "alert-456",
        }),
      );
    });

    it("should reset pagination when alertId changes", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      vm.pagination.page = 5;
      vm.currentPage = 5;

      await wrapper.setProps({ alertId: "alert-789" });
      await flushPromises();

      expect(vm.pagination.page).toBe(1);
      expect(vm.currentPage).toBe(1);
    });

    it("should not fetch if alertId is empty", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValue({
        data: { hits: [], total: 0 },
      } as any);

      await mountComponent({ alertDetails: mockAlertDetails, alertId: "" });
      vi.clearAllMocks();

      await wrapper.setProps({ alertId: "" });
      await flushPromises();

      expect(alertsService.getHistory).not.toHaveBeenCalled();
    });
  });

  describe("Helper Functions", () => {
    it("formatStatus should capitalize first letter", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatStatus("firing")).toBe("Firing");
      expect(vm.formatStatus("ok")).toBe("Ok");
      expect(vm.formatStatus("error")).toBe("Error");
    });

    it("formatStatus should return Unknown for empty/null input", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatStatus("")).toBe("Unknown");
      expect(vm.formatStatus(null)).toBe("Unknown");
    });

    it("getStatusChipColor should return correct colors", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusChipColor("firing")).toBe("red-1");
      expect(vm.getStatusChipColor("error")).toBe("red-1");
      expect(vm.getStatusChipColor("ok")).toBe("green-1");
      expect(vm.getStatusChipColor("success")).toBe("green-1");
      expect(vm.getStatusChipColor("skipped")).toBe("amber-1");
      expect(vm.getStatusChipColor("pending")).toBe("blue-1");
      expect(vm.getStatusChipColor("unknown")).toBe("grey-3");
    });

    it("getStatusChipTextColor should return correct text colors", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusChipTextColor("firing")).toBe("red-9");
      expect(vm.getStatusChipTextColor("error")).toBe("red-9");
      expect(vm.getStatusChipTextColor("ok")).toBe("green-9");
      expect(vm.getStatusChipTextColor("success")).toBe("green-9");
      expect(vm.getStatusChipTextColor("skipped")).toBe("amber-9");
      expect(vm.getStatusChipTextColor("pending")).toBe("blue-9");
    });

    it("getRowClass should return error class for error/firing status", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      // Store theme is "dark" by default in test helper
      expect(vm.getRowClass("firing")).toBe("row-error-dark");
      expect(vm.getRowClass("error")).toBe("row-error-dark");
      expect(vm.getRowClass("ok")).toBe("");
      expect(vm.getRowClass("success")).toBe("");
    });

    it("formatTimestamp should return N/A for falsy timestamps", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatTimestamp(0)).toBe("N/A");
      expect(vm.formatTimestamp(null)).toBe("N/A");
    });

    it("formatTimestamp should format recent timestamps as relative minutes", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      // 5 minutes ago in microseconds
      const fiveMinAgo = (Date.now() - 5 * 60 * 1000) * 1000;
      expect(vm.formatTimestamp(fiveMinAgo)).toBe("5 min ago");
    });

    it("formatTimestamp should format hours-old timestamps as relative hours", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      // 3 hours ago in microseconds
      const threeHoursAgo = (Date.now() - 3 * 3600 * 1000) * 1000;
      expect(vm.formatTimestamp(threeHoursAgo)).toBe("3h ago");
    });

    it("formatTimestamp should format days-old timestamps as relative days", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      // 3 days ago in microseconds
      const threeDaysAgo = (Date.now() - 3 * 86400 * 1000) * 1000;
      expect(vm.formatTimestamp(threeDaysAgo)).toBe("3d ago");
    });
  });

  describe("Per Page Options", () => {
    it("should have correct per page options", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.perPageOptions).toEqual([
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
      ]);
    });

    it("should default to 50 rows per page", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.selectedPerPage).toBe(50);
      expect(vm.pagination.rowsPerPage).toBe(50);
    });
  });

  describe("Table Columns", () => {
    it("should have the correct columns defined", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      const columnNames = vm.historyTableColumns.map((col: any) => col.name);
      expect(columnNames).toEqual([
        "#",
        "timestamp",
        "status",
        "evaluation_time",
        "query_time",
        "error",
      ]);
    });
  });
});
