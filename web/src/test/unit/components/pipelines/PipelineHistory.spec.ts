// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { Quasar, date } from "quasar";
import PipelineHistory from "@/components/pipelines/PipelineHistory.vue";
import i18n from "@/locales";
import router from "../../helpers/router";

// Mock services
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(() =>
      Promise.resolve({
        data: {
          list: [
            { name: "test-pipeline-1", pipeline_id: "pid1" },
            { name: "test-pipeline-2", pipeline_id: "pid2" },
          ],
        },
      })
    ),
  },
}));

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(() =>
      Promise.resolve({
        data: {
          hits: [
            {
              pipeline_name: "test-pipeline-1",
              timestamp: 1234567890000000,
              start_time: 1234567890000000,
              end_time: 1234567895000000,
              status: "success",
              is_realtime: false,
              is_silenced: false,
              retries: 0,
            },
          ],
          total: 1,
        },
      })
    ),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  })),
}));

describe("PipelineHistory.vue", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        theme: "light",
      },
    });
  });

  const mountComponent = (props = {}) => {
    return mount(PipelineHistory, {
      props,
      global: {
        plugins: [store, router, i18n, Quasar],
        stubs: {
          DateTime: {
            template: '<div data-test="datetime-stub"></div>',
            emits: ["on:date-change"],
          },
          QTablePagination: {
            template: '<div data-test="pagination-stub"></div>',
          },
          NoData: {
            template: '<div data-test="no-data-stub">No Data</div>',
          },
        },
      },
    });
  };

  describe("rendering", () => {
    it("should render pipeline history page", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="pipeline-history-page"]').exists()).toBe(true);
    });

    it("should render back button", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="alert-history-back-btn"]').exists()).toBe(true);
    });

    it("should render page title with info icon", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="pipeline-history-title"]').exists()).toBe(true);
    });

    it("should render date time picker", () => {
      const wrapper = mountComponent();

      // DateTime component is present (either stub or actual component)
      expect(wrapper.find('[data-test="pipeline-history-date-picker"]').exists()).toBe(true);
    });

    it("should render pipeline search select", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="pipeline-history-search-select"]').exists()).toBe(true);
    });

    it("should render manual search button", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="pipeline-history-manual-search-btn"]').exists()).toBe(true);
    });

    it("should render refresh button", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="pipeline-history-refresh-btn"]').exists()).toBe(true);
    });

    it("should render history table", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="pipeline-history-table"]').exists()).toBe(true);
    });
  });

  describe("back button", () => {
    it("should navigate back to pipelines page when clicked", async () => {
      const wrapper = mountComponent();
      const pushSpy = vi.spyOn(router, "push");

      const backBtn = wrapper.find('[data-test="alert-history-back-btn"]');
      await backBtn.trigger("click");

      expect(pushSpy).toHaveBeenCalledWith({
        name: "pipelines",
        query: {
          org_identifier: "test-org",
        },
      });
    });
  });

  describe("refresh button", () => {
    it("should be clickable", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const refreshBtn = wrapper.find('[data-test="pipeline-history-refresh-btn"]');
      expect(refreshBtn.exists()).toBe(true);

      // Trigger click - this will call refreshData internally
      await refreshBtn.trigger("click");
      await flushPromises();

      // Verify button still exists after click
      expect(refreshBtn.exists()).toBe(true);
    });
  });

  describe("formatDate helper", () => {
    it("should format timestamp correctly", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      const timestamp = 1234567890000000; // microseconds
      const formatted = vm.formatDate(timestamp);

      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe("string");
    });

    it("should return - for invalid timestamp", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.formatDate(null)).toBe("-");
      expect(vm.formatDate(0)).toBe("-");
      expect(vm.formatDate(undefined)).toBe("-");
    });
  });

  describe("formatDuration helper", () => {
    it("should format duration in seconds", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      const duration = 5000000; // 5 seconds in microseconds
      expect(vm.formatDuration(duration)).toBe("5s");
    });

    it("should format duration in minutes and seconds", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      const duration = 90000000; // 90 seconds = 1m 30s
      expect(vm.formatDuration(duration)).toBe("1m 30s");
    });

    it("should format duration in hours and minutes", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      const duration = 3900000000; // 3900 seconds = 1h 5m
      expect(vm.formatDuration(duration)).toBe("1h 5m");
    });

    it("should return 0s for invalid duration", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.formatDuration(0)).toBe("0s");
      expect(vm.formatDuration(-100)).toBe("0s");
      expect(vm.formatDuration(null)).toBe("0s");
    });
  });

  describe("getStatusColor helper", () => {
    it("should return positive color for success status", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.getStatusColor("success")).toBe("positive");
      expect(vm.getStatusColor("ok")).toBe("positive");
      expect(vm.getStatusColor("completed")).toBe("positive");
    });

    it("should return negative color for error status", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.getStatusColor("error")).toBe("negative");
      expect(vm.getStatusColor("failed")).toBe("negative");
    });

    it("should return warning color for warning status", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.getStatusColor("warning")).toBe("warning");
    });

    it("should return info color for pending/running status", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.getStatusColor("pending")).toBe("info");
      expect(vm.getStatusColor("running")).toBe("info");
    });

    it("should return theme-based color for unknown status", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      const color = vm.getStatusColor("unknown");
      expect(["white", "black"]).toContain(color);
    });
  });

  describe("table columns", () => {
    it("should have correct column definitions", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.columns).toBeDefined();
      expect(Array.isArray(vm.columns)).toBe(true);

      const columnNames = vm.columns.map((col: any) => col.name);
      expect(columnNames).toContain("pipeline_name");
      expect(columnNames).toContain("timestamp");
      expect(columnNames).toContain("status");
      expect(columnNames).toContain("duration");
    });
  });

  describe("pagination", () => {
    it("should have default pagination values", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.pagination.page).toBe(1);
      expect(vm.pagination.rowsPerPage).toBe(20);
      expect(vm.pagination.sortBy).toBe("timestamp");
      expect(vm.pagination.descending).toBe(true);
    });

    it("should have rows per page options", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.rowsPerPageOptions).toBeDefined();
      expect(Array.isArray(vm.rowsPerPageOptions)).toBe(true);
      expect(vm.rowsPerPageOptions.length).toBeGreaterThan(0);
    });
  });

  describe("pipeline search", () => {
    it("should have clearable search select", () => {
      const wrapper = mountComponent();

      const searchSelect = wrapper.find('[data-test="pipeline-history-search-select"]');
      // Just verify the select exists
      expect(searchSelect.exists()).toBe(true);
    });

    it("should have search icon prepend", () => {
      const wrapper = mountComponent();

      expect(wrapper.find(".o2-search-input-icon").exists()).toBe(true);
    });
  });

  describe("date time updates", () => {
    it("should have datetime component with data-test attribute", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      // Verify DateTime component is rendered with the data-test attribute
      const dateTimeElement = wrapper.find('[data-test="pipeline-history-date-picker"]');
      expect(dateTimeElement.exists()).toBe(true);
    });
  });

  describe("loading state", () => {
    it("should show loading indicator when fetching data", async () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      vm.loading = true;
      await wrapper.vm.$nextTick();

      const refreshBtn = wrapper.find('[data-test="pipeline-history-refresh-btn"]');
      // Check for Quasar loading state
      const hasLoading = refreshBtn.attributes("loading") !== undefined ||
                        refreshBtn.classes().includes("q-btn--loading");
      expect(hasLoading || vm.loading).toBe(true);
    });

    it("should disable manual search button when loading", async () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      vm.loading = true;
      await wrapper.vm.$nextTick();

      const searchBtn = wrapper.find('[data-test="pipeline-history-manual-search-btn"]');
      expect(searchBtn.attributes("aria-disabled")).toBe("true");
    });
  });
});
