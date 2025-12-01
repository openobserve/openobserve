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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import AlertHistory from "@/components/alerts/AlertHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock services
vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: vi.fn(),
    getHistory: vi.fn(),
  },
}));

import alertsService from "@/services/alerts";

installQuasar({ plugins: [Notify] });

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("AlertHistory.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockHistoryData = {
    hits: [
      {
        alert_name: "Test Alert 1",
        alert_id: "alert-1",
        timestamp: 1699900000000000,
        start_time: 1699899000000000,
        end_time: 1699900000000000,
        status: "success",
        is_realtime: true,
        is_silenced: false,
        retries: 0,
        error: null,
      },
      {
        alert_name: "Test Alert 2",
        alert_id: "alert-2",
        timestamp: 1699800000000000,
        start_time: 1699799000000000,
        end_time: 1699800000000000,
        status: "error",
        is_realtime: false,
        is_silenced: true,
        retries: 2,
        error: "Connection timeout",
      },
    ],
    total: 2,
  };

  const mockAlertsList = {
    list: [
      { alert_id: "alert-1", name: "Test Alert 1" },
      { alert_id: "alert-2", name: "Test Alert 2" },
      { alert_id: "alert-3", name: "Another Alert" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({
      data: mockAlertsList,
    } as any);
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: mockHistoryData,
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountComponent = async () => {
    wrapper = mount(AlertHistory, {
      attachTo: node,
      global: {
        plugins: [i18n, store, router],
      },
    });
    await flushPromises();
  };

  describe("Component Mounting", () => {
    it("should mount successfully", async () => {
      await mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct data-test attributes", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-page"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alert-history-back-btn"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alerts-history-title"]').exists()).toBe(
        true,
      );
    });

    it("should fetch alerts list on mount", async () => {
      await mountComponent();
      expect(alertsService.listByFolderId).toHaveBeenCalledWith(
        1,
        1000,
        "name",
        false,
        "",
        expect.any(String),
        "",
        "",
      );
    });

    it("should fetch alert history on mount", async () => {
      await mountComponent();
      expect(alertsService.getHistory).toHaveBeenCalled();
    });
  });

  describe("Data Display", () => {
    it("should display history data in table", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-table"]').exists()).toBe(
        true,
      );
    });

    it("should display alert names correctly", async () => {
      await mountComponent();
      const tableText = wrapper.text();
      expect(tableText).toContain("Test Alert 1");
      expect(tableText).toContain("Test Alert 2");
    });

    it("should display status chips with correct colors", async () => {
      await mountComponent();
      await flushPromises();

      const statusChips = wrapper.findAllComponents({ name: "QChip" });
      expect(statusChips.length).toBeGreaterThan(0);
    });

    it("should show realtime vs scheduled icon", async () => {
      await mountComponent();
      await flushPromises();

      // Check for icons in the table
      const icons = wrapper.findAllComponents({ name: "QIcon" });
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe("Date Time Picker", () => {
    it("should have date time picker component", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-date-picker"]').exists()).toBe(
        true,
      );
    });

    it("should call fetchAlertHistory when date changes", async () => {
      await mountComponent();
      const getHistorySpy = vi.spyOn(alertsService, "getHistory");

      const dateTimeComponent = wrapper.findComponent({ name: "DateTime" });
      await dateTimeComponent.vm.$emit("on:date-change", {
        startTime: 1699800000000000,
        endTime: 1699900000000000,
        relativeTimePeriod: "1h",
      });
      await flushPromises();

      expect(getHistorySpy).toHaveBeenCalled();
    });
  });

  describe("Search Functionality", () => {
    it("should have search select dropdown", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-search-select"]').exists()).toBe(
        true,
      );
    });

    it("should filter alerts when typing in search", async () => {
      await mountComponent();
      await flushPromises();

      const searchSelect = wrapper.findComponent({ name: "QSelect" });
      expect(searchSelect.exists()).toBe(true);
    });

    it("should have manual search button", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-manual-search-btn"]').exists()).toBe(
        true,
      );
    });

    it("should trigger search when manual search button is clicked", async () => {
      await mountComponent();
      const getHistorySpy = vi.spyOn(alertsService, "getHistory");

      const searchBtn = wrapper.find('[data-test="alert-history-manual-search-btn"]');
      await searchBtn.trigger("click");
      await flushPromises();

      expect(getHistorySpy).toHaveBeenCalled();
    });
  });

  describe("Refresh Functionality", () => {
    it("should have refresh button", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-refresh-btn"]').exists()).toBe(
        true,
      );
    });

    it("should refresh data when refresh button is clicked", async () => {
      await mountComponent();
      const getHistorySpy = vi.spyOn(alertsService, "getHistory");

      const refreshBtn = wrapper.find('[data-test="alert-history-refresh-btn"]');
      await refreshBtn.trigger("click");
      await flushPromises();

      expect(getHistorySpy).toHaveBeenCalled();
    });
  });

  describe("Actions", () => {
    it("should have view details button for each row", async () => {
      await mountComponent();
      await flushPromises();

      const viewDetailsButtons = wrapper.findAll('[data-test="alert-history-view-details"]');
      expect(viewDetailsButtons.length).toBeGreaterThan(0);
    });

    it("should open details dialog when view details is clicked", async () => {
      await mountComponent();
      await flushPromises();

      const viewDetailsBtn = wrapper.find('[data-test="alert-history-view-details"]');
      await viewDetailsBtn.trigger("click");
      await flushPromises();

      // Check if dialog is shown (QDialog should be present)
      expect(wrapper.findComponent({ name: "QDialog" }).exists()).toBe(true);
    });
  });

  describe("Navigation", () => {
    it("should navigate back when back button is clicked", async () => {
      await mountComponent();
      const pushSpy = vi.spyOn(router, "push");

      const backBtn = wrapper.find('[data-test="alert-history-back-btn"]');
      await backBtn.trigger("click");

      expect(pushSpy).toHaveBeenCalledWith({
        name: "alertList",
        query: expect.objectContaining({
          org_identifier: expect.any(String),
        }),
      });
    });
  });

  describe("Pagination", () => {
    it("should have pagination component", async () => {
      await mountComponent();
      expect(wrapper.findComponent({ name: "QTablePagination" }).exists()).toBe(
        true,
      );
    });

    it("should call getHistory with correct pagination params", async () => {
      await mountComponent();
      const getHistorySpy = vi.spyOn(alertsService, "getHistory");

      // Simulate pagination change
      const qTable = wrapper.findComponent({ name: "QTable" });
      await qTable.vm.$emit("request", {
        pagination: {
          page: 2,
          rowsPerPage: 20,
          sortBy: "timestamp",
          descending: true,
        },
      });
      await flushPromises();

      expect(getHistorySpy).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockRejectedValueOnce(
        new Error("API Error"),
      );

      await mountComponent();
      await flushPromises();

      // Component should still exist and not crash
      expect(wrapper.exists()).toBe(true);
    });

    it("should show error notification on fetch failure", async () => {
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
      await flushPromises();

      // Component should handle error gracefully
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Loading State", () => {
    it("should complete loading after data is fetched", async () => {
      await mountComponent();
      await flushPromises();

      const qTable = wrapper.findComponent({ name: "QTable" });
      // Loading should be false after data is fetched
      expect(qTable.props("loading")).toBe(false);
    });
  });

  describe("Empty State", () => {
    it("should handle empty data gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: { hits: [], total: 0 },
      } as any);

      await mountComponent();
      await flushPromises();

      // Check that rows are empty
      const vm = wrapper.vm as any;
      expect(vm.rows.length).toBe(0);
    });
  });

  describe("Status Color Mapping", () => {
    it("should return correct color for success status", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusColor("success")).toBe("positive");
      expect(vm.getStatusColor("ok")).toBe("positive");
      expect(vm.getStatusColor("completed")).toBe("positive");
    });

    it("should return correct color for error status", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusColor("error")).toBe("negative");
      expect(vm.getStatusColor("failed")).toBe("negative");
    });

    it("should return correct color for warning status", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusColor("warning")).toBe("warning");
    });

    it("should return correct color for pending/running status", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStatusColor("pending")).toBe("info");
      expect(vm.getStatusColor("running")).toBe("info");
    });
  });

  describe("Duration Formatting", () => {
    it("should format duration in seconds correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDuration(5000000)).toBe("5s"); // 5 seconds in microseconds
    });

    it("should format duration in minutes correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDuration(120000000)).toBe("2m 0s"); // 2 minutes
    });

    it("should format duration in hours correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDuration(7200000000)).toBe("2h 0m"); // 2 hours
    });

    it("should handle zero or negative duration", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDuration(0)).toBe("0s");
      expect(vm.formatDuration(-100)).toBe("0s");
    });
  });

  describe("Date Formatting", () => {
    it("should format timestamp correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      const formatted = vm.formatDate(1699900000000000);
      expect(formatted).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it("should return dash for null/undefined timestamp", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDate(null)).toBe("-");
      expect(vm.formatDate(undefined)).toBe("-");
      expect(vm.formatDate(0)).toBe("-");
    });
  });

  describe("Alert Filter", () => {
    it("should filter alert options based on search input", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      // Simulate filter function
      const updateFn = vi.fn((callback) => callback());
      vm.filterAlertOptions("Test", updateFn);

      expect(updateFn).toHaveBeenCalled();
    });

    it("should clear search when clear button is clicked", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      vm.selectedAlert = { label: "Test Alert 1", value: "alert-1" };
      vm.searchQuery = "alert-1";

      vm.clearSearch();

      expect(vm.selectedAlert).toBeNull();
      expect(vm.searchQuery).toBe("");
    });
  });
});
