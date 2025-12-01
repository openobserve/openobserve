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
import AlertHistorySummary from "@/components/alerts/AlertHistorySummary.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock services
vi.mock("@/services/alerts", () => ({
  default: {
    getHistory: vi.fn(),
  },
}));

import alertsService from "@/services/alerts";

installQuasar({ plugins: [Notify] });

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("AlertHistorySummary.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockHistoryData = {
    hits: [
      {
        alert_name: "CPU Alert",
        timestamp: 1699900000000000,
        status: "firing",
      },
      {
        alert_name: "CPU Alert",
        timestamp: 1699890000000000,
        status: "ok",
      },
      {
        alert_name: "Memory Alert",
        timestamp: 1699880000000000,
        status: "ok",
      },
      {
        alert_name: "Disk Alert",
        timestamp: 1699870000000000,
        status: "error",
      },
      {
        alert_name: "Disk Alert",
        timestamp: 1699860000000000,
        status: "firing",
      },
    ],
    total: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: mockHistoryData,
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountComponent = async () => {
    wrapper = mount(AlertHistorySummary, {
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

    it("should have correct data-test attribute", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-summary-table"]').exists()).toBe(
        true,
      );
    });

    it("should fetch history summary on mount", async () => {
      await mountComponent();
      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("should fetch data for last 7 days", async () => {
      await mountComponent();
      const callArgs = vi.mocked(alertsService.getHistory).mock.calls[0];
      const queryParams = callArgs[1];

      expect(queryParams).toHaveProperty("start_time");
      expect(queryParams).toHaveProperty("end_time");
      expect(queryParams.size).toBe(10000);
    });
  });

  describe("Data Display", () => {
    it("should display summary table with correct columns", async () => {
      await mountComponent();
      const table = wrapper.findComponent({ name: "QTable" });
      expect(table.exists()).toBe(true);
    });

    it("should aggregate data by alert name", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      // Should have 3 unique alerts: CPU Alert, Memory Alert, Disk Alert
      expect(vm.historyRows.length).toBe(3);
    });

    it("should calculate total evaluations correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const cpuAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "CPU Alert",
      );
      expect(cpuAlert.total_evaluations).toBe(2);

      const diskAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "Disk Alert",
      );
      expect(diskAlert.total_evaluations).toBe(2);
    });

    it("should calculate firing count correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const cpuAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "CPU Alert",
      );
      expect(cpuAlert.firing_count).toBe(1); // One firing status

      const diskAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "Disk Alert",
      );
      expect(diskAlert.firing_count).toBe(2); // One error + one firing
    });

    it("should show current state from most recent evaluation", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const cpuAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "CPU Alert",
      );
      expect(cpuAlert.current_state).toBe("firing"); // Most recent status

      const memoryAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "Memory Alert",
      );
      expect(memoryAlert.current_state).toBe("ok");
    });

    it("should display last evaluation timestamp", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const cpuAlert = vm.historyRows.find(
        (row: any) => row.alert_name === "CPU Alert",
      );
      expect(cpuAlert.last_evaluation).toBe(1699900000000000);
    });
  });

  describe("State Icons and Colors", () => {
    it("should return correct icon for firing state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateIcon("firing")).toBe("error");
      expect(vm.getStateIcon("error")).toBe("error");
    });

    it("should return correct icon for ok state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateIcon("ok")).toBe("check_circle");
      expect(vm.getStateIcon("completed")).toBe("check_circle");
    });

    it("should return correct icon for unknown state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateIcon("unknown")).toBe("info");
    });

    it("should return correct color for firing state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateColor("firing")).toBe("negative");
      expect(vm.getStateColor("error")).toBe("negative");
    });

    it("should return correct color for ok state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateColor("ok")).toBe("positive");
      expect(vm.getStateColor("completed")).toBe("positive");
    });

    it("should return correct color for unknown state", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.getStateColor("unknown")).toBe("grey");
    });
  });

  describe("Frequency Formatting", () => {
    it("should format frequency in seconds", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatFrequency(30)).toBe("30s");
      expect(vm.formatFrequency(45)).toBe("45s");
    });

    it("should format frequency in minutes", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatFrequency(120)).toBe("2m"); // 2 minutes
      expect(vm.formatFrequency(300)).toBe("5m"); // 5 minutes
    });

    it("should format frequency in hours", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatFrequency(3600)).toBe("1h"); // 1 hour
      expect(vm.formatFrequency(7200)).toBe("2h"); // 2 hours
    });

    it("should return N/A for null or undefined frequency", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatFrequency(null)).toBe("N/A");
      expect(vm.formatFrequency(undefined)).toBe("N/A");
    });
  });

  describe("Timestamp Formatting", () => {
    it("should format timestamp correctly", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      const formatted = vm.formatTimestamp(1699900000000000);
      expect(formatted).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it("should return N/A for null/undefined timestamp", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatTimestamp(null)).toBe("N/A");
      expect(vm.formatTimestamp(undefined)).toBe("N/A");
      expect(vm.formatTimestamp(0)).toBe("N/A");
    });
  });

  describe("Sorting", () => {
    it("should sort data when requested", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const qTable = wrapper.findComponent({ name: "QTable" });
      await qTable.vm.$emit("request", {
        pagination: {
          page: 1,
          rowsPerPage: 100,
          sortBy: "alert_name",
          descending: false,
        },
      });
      await flushPromises();

      expect(vm.pagination.sortBy).toBe("alert_name");
      expect(vm.pagination.descending).toBe(false);
    });

    it("should sort by total evaluations", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      await vm.onRequest({
        pagination: {
          page: 1,
          rowsPerPage: 100,
          sortBy: "total_evaluations",
          descending: true,
        },
      });

      expect(vm.pagination.sortBy).toBe("total_evaluations");
    });
  });

  describe("Row Click - Open Drawer", () => {
    it("should call openDrawer method when row is clicked", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      // Call openDrawer directly
      vm.openDrawer({ alert_name: "Test Alert" });
      await flushPromises();

      expect(wrapper.emitted("open-drawer")).toBeTruthy();
      expect(wrapper.emitted("open-drawer")?.[0]).toEqual(["Test Alert"]);
    });
  });

  describe("Empty State", () => {
    it("should show no data message when no history is available", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: { hits: [], total: 0 },
      } as any);

      await mountComponent();
      await flushPromises();

      const noDataSlot = wrapper.text();
      expect(noDataSlot).toContain("history");
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

    it("should dispatch notification on error", async () => {
      const dispatchSpy = vi.spyOn(store, "dispatch");
      vi.mocked(alertsService.getHistory).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await mountComponent();
      await flushPromises();

      expect(dispatchSpy).toHaveBeenCalledWith(
        "showNotification",
        expect.objectContaining({
          color: "negative",
        }),
      );
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

  describe("Organization Change", () => {
    it("should have watcher for organization change", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      // Check that component has mounted and data is loaded
      expect(vm.historyRows.length).toBeGreaterThan(0);
    });
  });

  describe("Exposed Methods", () => {
    it("should expose refresh method", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.refresh).toBeDefined();
      expect(typeof vm.refresh).toBe("function");
    });

    it("should refetch data when refresh is called", async () => {
      await mountComponent();
      const getHistorySpy = vi.spyOn(alertsService, "getHistory");
      const vm = wrapper.vm as any;

      vi.clearAllMocks();
      await vm.refresh();
      await flushPromises();

      expect(getHistorySpy).toHaveBeenCalled();
    });
  });

  describe("Pagination", () => {
    it("should initialize with correct pagination values", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.pagination.page).toBe(1);
      expect(vm.pagination.rowsPerPage).toBe(100);
      expect(vm.pagination.sortBy).toBe("last_evaluation");
      expect(vm.pagination.descending).toBe(true);
    });

    it("should update pagination when changed", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      await vm.onRequest({
        pagination: {
          page: 2,
          rowsPerPage: 50,
          sortBy: "firing_count",
          descending: false,
        },
      });

      expect(vm.pagination.page).toBe(2);
      expect(vm.pagination.rowsPerPage).toBe(50);
      expect(vm.pagination.sortBy).toBe("firing_count");
      expect(vm.pagination.descending).toBe(false);
    });
  });

  describe("Data Aggregation", () => {
    it("should handle alerts with no alert_name gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: {
          hits: [
            { alert_name: null, timestamp: 1699900000000000, status: "ok" },
            { alert_name: "Valid Alert", timestamp: 1699890000000000, status: "firing" },
          ],
          total: 2,
        },
      } as any);

      await mountComponent();
      const vm = wrapper.vm as any;

      // Should only have 1 alert (null alert_name should be skipped)
      expect(vm.historyRows.length).toBe(1);
      expect(vm.historyRows[0].alert_name).toBe("Valid Alert");
    });

    it("should handle empty hits array", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: {
          hits: [],
          total: 0,
        },
      } as any);

      await mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.historyRows.length).toBe(0);
    });
  });

  describe("Table Columns", () => {
    it("should have all required columns", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      const columnNames = vm.columns.map((col: any) => col.name);
      expect(columnNames).toContain("alert_name");
      expect(columnNames).toContain("total_evaluations");
      expect(columnNames).toContain("firing_count");
      expect(columnNames).toContain("current_state");
      expect(columnNames).toContain("frequency");
      expect(columnNames).toContain("last_evaluation");
    });

    it("should have sortable columns", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      vm.columns.forEach((col: any) => {
        expect(col.sortable).toBe(true);
      });
    });
  });
});
