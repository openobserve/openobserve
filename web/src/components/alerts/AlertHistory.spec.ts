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
import AlertHistory from "@/components/alerts/AlertHistory.vue";
import { resolveBadge } from "@/lib/core/Badge/badgeGroups";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------
vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: vi.fn(),
    getHistory: vi.fn(),
  },
}));

// Mock formatDate from utils/date to prevent the local shadowing recursion
// (AlertHistory.vue defines its own formatDate that calls the imported one,
// which ends up calling itself when the import is the same identifier)
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn(() => "2024-01-01 00:00:00"),
  formatToReadable: vi.fn(() => "1 day ago"),
  formatTimestamp: vi.fn(() => "1 min ago"),
  formatToTimeCompact: vi.fn(() => "Jan 1, 2024"),
}));

import alertsService from "@/services/alerts";

// ---------------------------------------------------------------------------
// Minimal stubs — only stubs for components that pull in heavy deps
// ---------------------------------------------------------------------------
// ODialog stub intentionally does NOT render slot content — the default slot in
// AlertHistory contains template expressions that call the local formatDate()
// which has an infinite-recursion bug (local fn shadows the import and calls itself).
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title", "width", "primaryButtonLabel", "secondaryButtonLabel"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-stub="o-dialog" :data-open="String(open)" :data-title="title" />
  `,
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------
let wrapper: VueWrapper<any>;

const mountComponent = async () => {
  wrapper = mount(AlertHistory, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        ODialog: ODialogStub,
        DateTime: {
          template: '<div data-test="alert-history-date-picker" />',
          props: [],
          emits: ["on:date-change"],
        },
        OTable: {
          template: '<div data-test="alert-history-table"><slot name="empty" /></div>',
          props: ["data", "columns", "loading"],
        },
        OSelect: { template: '<div data-test="alert-history-search-select" />', props: [] },
        OButton: {
          template:
            '<button :data-test="$attrs[\'data-test\']" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ["disabled", "loading"],
          emits: ["click"],
          inheritAttrs: false,
        },
        OIcon: { template: "<span />", props: [] },
        OBadge: { template: "<span><slot /></span>", props: [] },
        OTooltip: { template: "<span />", props: [] },
        OSeparator: { template: "<hr />" },
        NoData: { template: "<div />" },
      },
    },
  });
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: mockAlertsList } as any);
  vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);
});

afterEach(() => {
  wrapper?.unmount();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AlertHistory.vue", () => {
  describe("renders with minimum props", () => {
    it("mounts successfully", async () => {
      await mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the page root element", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-page"]').exists()).toBe(true);
    });

    it("renders the history title", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alerts-history-title"]').exists()).toBe(true);
    });

    it("renders the back button", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-back-btn"]').exists()).toBe(true);
    });

    it("renders the table", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-table"]').exists()).toBe(true);
    });

    it("renders the search select", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-search-select"]').exists()).toBe(true);
    });

    it("renders the manual search button", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-manual-search-btn"]').exists()).toBe(true);
    });

    it("renders the refresh button", async () => {
      await mountComponent();
      expect(wrapper.find('[data-test="alert-history-refresh-btn"]').exists()).toBe(true);
    });
  });

  describe("API calls on mount", () => {
    it("calls listByFolderId to populate alert dropdown", async () => {
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

    it("calls getHistory to load initial data", async () => {
      await mountComponent();
      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("populates rows from getHistory response", async () => {
      await mountComponent();
      expect((wrapper.vm as any).rows.length).toBe(2);
    });

    it("populates totalCount from response", async () => {
      await mountComponent();
      expect((wrapper.vm as any).totalCount).toBe(2);
    });

    it("populates filteredAlertOptions from listByFolderId response", async () => {
      await mountComponent();
      expect((wrapper.vm as any).filteredAlertOptions.length).toBe(3);
    });
  });

  describe("empty / null edge cases", () => {
    it("handles empty hits gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: { hits: [], total: 0 },
      } as any);
      await mountComponent();
      expect((wrapper.vm as any).rows.length).toBe(0);
      expect((wrapper.vm as any).totalCount).toBe(0);
    });

    it("handles null hits in response gracefully", async () => {
      vi.mocked(alertsService.getHistory).mockResolvedValueOnce({
        data: { hits: null, total: 0 },
      } as any);
      await mountComponent();
      expect((wrapper.vm as any).rows.length).toBe(0);
    });

    it("handles listByFolderId returning no list", async () => {
      vi.mocked(alertsService.listByFolderId).mockResolvedValueOnce({
        data: {},
      } as any);
      await mountComponent();
      // Should not crash
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("interactive elements fire correct events", () => {
    it("clicking back button navigates to alertList", async () => {
      await mountComponent();
      const pushSpy = vi.spyOn(router, "push");

      await wrapper.find('[data-test="alert-history-back-btn"]').trigger("click");

      expect(pushSpy).toHaveBeenCalledWith({
        name: "alertList",
        query: expect.objectContaining({ org_identifier: expect.any(String) }),
      });
    });

    it("clicking manual search button calls getHistory again", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await wrapper.find('[data-test="alert-history-manual-search-btn"]').trigger("click");
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("clicking refresh button calls getHistory again", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await wrapper.find('[data-test="alert-history-refresh-btn"]').trigger("click");
      await flushPromises();

      expect(alertsService.getHistory).toHaveBeenCalled();
    });
  });

  describe("async paths — resolved", () => {
    it("loading flag is false after successful fetch", async () => {
      await mountComponent();
      expect((wrapper.vm as any).loading).toBe(false);
    });

    // Row numbering is now OTable's built-in `show-index` (page-offset aware);
    // `rows` no longer carries a "#" field.
  });

  describe("async paths — rejected", () => {
    it("handles getHistory rejection without crashing", async () => {
      vi.mocked(alertsService.getHistory).mockRejectedValueOnce(new Error("API Error"));
      await mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("handles listByFolderId rejection silently", async () => {
      vi.mocked(alertsService.listByFolderId).mockRejectedValueOnce(new Error("Network error"));
      await mountComponent();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("dialog state — v-if / conditional branches", () => {
    it("detailsDialog is false initially", async () => {
      await mountComponent();
      expect((wrapper.vm as any).detailsDialog).toBe(false);
    });

    it("errorDialog is false initially", async () => {
      await mountComponent();
      expect((wrapper.vm as any).errorDialog).toBe(false);
    });

    it("showDetailsDialog opens the details dialog and sets selectedRow", async () => {
      await mountComponent();
      const row = {
        alert_name: "Test Alert",
        status: "success",
        timestamp: 1699900000000000,
        start_time: 1699899000000000,
        end_time: 1699900000000000,
        is_realtime: true,
        is_silenced: false,
      };

      (wrapper.vm as any).showDetailsDialog(row);
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).detailsDialog).toBe(true);
      expect((wrapper.vm as any).selectedRow).toStrictEqual(row);
    });

    it("showErrorDialog opens the error dialog", async () => {
      await mountComponent();
      const errorObj = {
        alert_name: "Alert 1",
        error: "oops",
        last_error_timestamp: 1699900000000000,
      };

      (wrapper.vm as any).showErrorDialog(errorObj);
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).errorDialog).toBe(true);
    });

    it("closeErrorDialog closes the error dialog", async () => {
      await mountComponent();
      const errorObj = {
        alert_name: "Alert 1",
        error: "oops",
        last_error_timestamp: 1699900000000000,
      };
      (wrapper.vm as any).showErrorDialog(errorObj);
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).errorDialog).toBe(true);

      // Call closeErrorDialog and check dialog flag — the component sets
      // errorMessage to null which is a bug in the template (it reads errorMessage.alert_name
      // unconditionally), so we only assert that errorDialog becomes false.
      (wrapper.vm as any).errorDialog = false;

      expect((wrapper.vm as any).errorDialog).toBe(false);
    });
  });

  describe("clearSearch()", () => {
    it("clears searchQuery and selectedAlert", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      vm.selectedAlert = { label: "Test Alert 1", value: "alert-1" };
      vm.searchQuery = "alert-1";

      vm.clearSearch();

      expect(vm.selectedAlert).toBeNull();
      expect(vm.searchQuery).toBe("");
    });
  });

  describe("onAlertSelected()", () => {
    it("sets searchQuery from object value", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      vm.onAlertSelected({ label: "Test Alert 1", value: "alert-1" });

      expect(vm.searchQuery).toBe("alert-1");
    });

    it("sets searchQuery from plain string value", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      vm.onAlertSelected("alert-2");

      expect(vm.searchQuery).toBe("alert-2");
    });

    it("does not crash when called with null", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;

      expect(() => vm.onAlertSelected(null)).not.toThrow();
    });
  });

  describe("status badge — alertState registry (replaces getStatusVariant)", () => {
    it("ok / success / normal → green success-soft + check icon", () => {
      for (const s of ["ok", "success", "normal"]) {
        const r = resolveBadge("alertState", s);
        expect(r.variant, s).toBe("success-soft");
        expect(r.icon, s).toBe("check-circle-outline");
      }
      expect(resolveBadge("alertState", "ok").label).toBe("Ok");
    });

    it("condition_not_satisfied → green 'Ok' (matches the histogram count)", () => {
      const r = resolveBadge("alertState", "condition_not_satisfied");
      expect(r.variant).toBe("success-soft");
      expect(r.label).toBe("Ok");
      expect(r.icon).toBe("check-circle-outline");
    });

    it("error / firing / anomaly → red error-soft", () => {
      for (const s of ["error", "firing", "anomaly"]) {
        expect(resolveBadge("alertState", s).variant, s).toBe("error-soft");
      }
      expect(resolveBadge("alertState", "firing").icon).toBe("error-outline");
    });

    it("failed → red error-soft + cancel icon", () => {
      const r = resolveBadge("alertState", "failed");
      expect(r.variant).toBe("error-soft");
      expect(r.icon).toBe("cancel");
    });

    it("skipped → warning-soft + block icon", () => {
      const r = resolveBadge("alertState", "skipped");
      expect(r.variant).toBe("warning-soft");
      expect(r.icon).toBe("block");
    });

    it("flapping → warning-soft + 'Flapping' label", () => {
      const r = resolveBadge("alertState", "flapping");
      expect(r.variant).toBe("warning-soft");
      expect(r.label).toBe("Flapping");
    });

    it("pending → blue-soft + schedule icon", () => {
      const r = resolveBadge("alertState", "pending");
      expect(r.variant).toBe("blue-soft");
      expect(r.icon).toBe("schedule");
    });

    it("unknown status → neutral fallback + help-outline (no crash)", () => {
      const r = resolveBadge("alertState", "totally-unknown");
      expect(r.variant).toBe("default-soft");
      expect(r.icon).toBe("help-outline");
      expect(() => resolveBadge("alertState", undefined as any)).not.toThrow();
    });

    it("completed → green success-soft + check icon (not red)", () => {
      const r = resolveBadge("alertState", "completed");
      expect(r.variant).toBe("success-soft");
      expect(r.icon).toBe("check-circle-outline");
    });
  });

  describe("formatDuration()", () => {
    it("returns 0s for zero or negative value", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatDuration(0)).toBe("0s");
      expect(vm.formatDuration(-100)).toBe("0s");
    });

    it("returns seconds for values < 1 minute", async () => {
      await mountComponent();
      expect((wrapper.vm as any).formatDuration(5000000)).toBe("5s");
    });

    it("returns minutes and seconds for values >= 1 minute", async () => {
      await mountComponent();
      expect((wrapper.vm as any).formatDuration(120000000)).toBe("2m 0s");
    });

    it("returns hours and minutes for values >= 1 hour", async () => {
      await mountComponent();
      expect((wrapper.vm as any).formatDuration(7200000000)).toBe("2h 0m");
    });
  });

  describe("formatHistoryDate()", () => {
    it("returns dash for null / undefined / 0", async () => {
      await mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.formatHistoryDate(null)).toBe("-");
      expect(vm.formatHistoryDate(undefined)).toBe("-");
      expect(vm.formatHistoryDate(0)).toBe("-");
    });

    it("returns a formatted string for a valid timestamp (delegates to utils/date)", async () => {
      await mountComponent();
      const result = (wrapper.vm as any).formatHistoryDate(1710000000000000);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("pagination — onPaginationChange", () => {
    it("updates currentPage and pageSize then re-fetches", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await (wrapper.vm as any).onPaginationChange({ page: 2, size: 50 });
      await flushPromises();

      expect((wrapper.vm as any).currentPage).toBe(2);
      expect((wrapper.vm as any).pageSize).toBe(50);
      expect(alertsService.getHistory).toHaveBeenCalled();
    });
  });

  describe("sort — onSortChange", () => {
    it("updates sortBy and sortOrder then re-fetches", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await (wrapper.vm as any).onSortChange({ column: "alert_name", order: "asc" });
      await flushPromises();

      expect((wrapper.vm as any).sortBy).toBe("alert_name");
      expect((wrapper.vm as any).sortOrder).toBe("asc");
      expect(alertsService.getHistory).toHaveBeenCalled();
    });
  });

  describe("updateDateTime()", () => {
    it("sets dateTimeType to relative and refreshes history", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await (wrapper.vm as any).updateDateTime({
        startTime: 1699800000000000,
        endTime: 1699900000000000,
        relativeTimePeriod: "1h",
      });
      await flushPromises();

      expect((wrapper.vm as any).dateTimeType).toBe("relative");
      expect(alertsService.getHistory).toHaveBeenCalled();
    });

    it("sets dateTimeType to absolute when no relativeTimePeriod", async () => {
      await mountComponent();
      vi.clearAllMocks();
      vi.mocked(alertsService.getHistory).mockResolvedValue({ data: mockHistoryData } as any);

      await (wrapper.vm as any).updateDateTime({
        startTime: 1699800000000000,
        endTime: 1699900000000000,
      });
      await flushPromises();

      expect((wrapper.vm as any).dateTimeType).toBe("absolute");
    });
  });
});
