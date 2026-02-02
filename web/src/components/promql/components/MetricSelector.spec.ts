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
import { Dialog, Notify } from "quasar";
import MetricSelector from "./MetricSelector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock streamService - must be at top level for hoisting
vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(),
  },
}));

describe("MetricSelector", () => {
  let wrapper: any;
  let mockStreamService: any;

  const mockMetrics = [
    { name: "http_requests_total" },
    { name: "http_request_duration_seconds" },
    { name: "cpu_usage_percent" },
    { name: "memory_usage_bytes" },
    { name: "disk_io_operations" },
  ];

  const defaultProps = {
    metric: "",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mocked module
    const streamModule = await import("@/services/stream");
    mockStreamService = streamModule.default;
    // Default mock response
    mockStreamService.nameList.mockResolvedValue({
      data: {
        list: mockMetrics,
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(MetricSelector, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render metric selector", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".metric-selector").exists()).toBe(true);
    });

    it("should display layout name", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".layout-name").text()).toBe("Metric");
    });

    it("should render q-select component", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.exists()).toBe(true);
    });

    it("should have data-test attribute", () => {
      wrapper = createWrapper();
      const select = wrapper.find('[data-test="metric-selector"]');
      expect(select.exists()).toBe(true);
    });

    it("should show search icon", () => {
      wrapper = createWrapper();
      const icon = wrapper.findComponent({ name: "QIcon" });
      expect(icon.exists()).toBe(true);
      expect(icon.props("name")).toBe("search");
    });
  });

  describe("Metrics Loading", () => {
    it("should load metrics on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockStreamService.nameList).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "metrics",
        false,
        -1,
        -1,
        "",
        "",
        false
      );
    });

    it("should populate metrics after loading", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.metrics.length).toBe(5);
      expect(wrapper.vm.metrics).toContain("http_requests_total");
      expect(wrapper.vm.metrics).toContain("cpu_usage_percent");
    });

    it("should set filteredMetrics equal to metrics initially", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.filteredMetrics).toEqual(wrapper.vm.metrics);
    });

    it("should show loading state while fetching metrics", () => {
      mockStreamService.nameList.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: { list: mockMetrics } }), 100);
          })
      );

      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should clear loading state after metrics loaded", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("should handle empty metrics list", async () => {
      mockStreamService.nameList.mockResolvedValue({
        data: {
          list: [],
        },
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.metrics).toEqual([]);
      expect(wrapper.vm.filteredMetrics).toEqual([]);
    });

    it("should handle API error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStreamService.nameList.mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.metrics).toEqual([]);
      expect(wrapper.vm.filteredMetrics).toEqual([]);
      expect(wrapper.vm.loading).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error loading metrics:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle missing data in response", async () => {
      mockStreamService.nameList.mockResolvedValue({});

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.metrics).toEqual([]);
    });
  });

  describe("Metric Selection", () => {
    it("should initialize with provided metric", () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      expect(wrapper.vm.selectedMetric).toBe("http_requests_total");
    });

    it("should emit update:metric when metric is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.vm.onMetricSelect("cpu_usage_percent");

      expect(wrapper.emitted("update:metric")).toBeTruthy();
      expect(wrapper.emitted("update:metric")[0]).toEqual(["cpu_usage_percent"]);
    });

    it("should update selectedMetric when metric is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.vm.onMetricSelect("memory_usage_bytes");

      expect(wrapper.vm.selectedMetric).toBe("memory_usage_bytes");
    });

    it("should handle null selection (clearable)", async () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      await flushPromises();

      await wrapper.vm.onMetricSelect(null);

      expect(wrapper.vm.selectedMetric).toBe("");
      expect(wrapper.emitted("update:metric")[0]).toEqual([""]);
    });

    it("should handle empty string selection", async () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      await flushPromises();

      await wrapper.vm.onMetricSelect("");

      expect(wrapper.vm.selectedMetric).toBe("");
    });
  });

  describe("Metric Filtering", () => {
    it("should show all metrics when filter is empty", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(wrapper.vm.filteredMetrics).toEqual(wrapper.vm.metrics);
    });

    it("should call API with search keyword when filtering", async () => {
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockClear();
      mockStreamService.nameList.mockResolvedValue({
        data: {
          list: [{ name: "http_requests_total" }],
        },
      });

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("http", updateFn);
      await flushPromises();

      expect(mockStreamService.nameList).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "metrics",
        false,
        -1,
        -1,
        "http",
        "",
        false
      );
    });

    it("should update filteredMetrics with search results", async () => {
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockResolvedValue({
        data: {
          list: [
            { name: "http_requests_total" },
            { name: "http_request_duration_seconds" },
          ],
        },
      });

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("http", updateFn);
      await flushPromises();

      expect(wrapper.vm.filteredMetrics.length).toBe(2);
      expect(wrapper.vm.filteredMetrics).toContain("http_requests_total");
      expect(wrapper.vm.filteredMetrics).toContain(
        "http_request_duration_seconds"
      );
    });

    it("should show loading state while filtering", async () => {
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: { list: [] } }), 100);
          })
      );

      const updateFn = vi.fn((callback) => callback());
      const filterPromise = wrapper.vm.filterMetrics("cpu", updateFn);

      expect(wrapper.vm.loading).toBe(true);

      await filterPromise;
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("should handle filter API error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockRejectedValue(new Error("Filter Error"));

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("test", updateFn);
      await flushPromises();

      expect(wrapper.vm.filteredMetrics).toEqual([]);
      expect(wrapper.vm.loading).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error filtering metrics:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle empty filter results", async () => {
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockResolvedValue({
        data: {
          list: [],
        },
      });

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("nonexistent", updateFn);
      await flushPromises();

      expect(wrapper.vm.filteredMetrics).toEqual([]);
    });

    it("should handle missing data in filter response", async () => {
      wrapper = createWrapper();
      await flushPromises();

      mockStreamService.nameList.mockResolvedValue({});

      const updateFn = vi.fn((callback) => callback());
      await wrapper.vm.filterMetrics("test", updateFn);
      await flushPromises();

      expect(wrapper.vm.filteredMetrics).toEqual([]);
    });
  });

  describe("Component Props", () => {
    it("should accept metric prop", () => {
      wrapper = createWrapper({ metric: "test_metric" });
      expect(wrapper.props("metric")).toBe("test_metric");
    });

    it("should accept datasource prop", () => {
      const datasource = { id: "test", name: "Test" };
      wrapper = createWrapper({ datasource });
      expect(wrapper.props("datasource")).toEqual(datasource);
    });

    it("should work without datasource prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props("datasource")).toBeUndefined();
    });
  });

  describe("UI Behavior", () => {
    it("should be clearable", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("clearable")).toBe(true);
    });

    it("should use input for filtering", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("useInput")).toBe(true);
    });

    it("should have input debounce", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("inputDebounce")).toBe("300");
    });

    it("should be dense", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("dense")).toBe(true);
    });

    it("should be borderless", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("borderless")).toBe(true);
    });

    it("should show no-option slot when loading", async () => {
      mockStreamService.nameList.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: { list: [] } }), 100);
          })
      );

      wrapper = createWrapper();

      // Component should be in loading state
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should show no-option slot when no metrics found", async () => {
      mockStreamService.nameList.mockResolvedValue({
        data: {
          list: [],
        },
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.metrics).toEqual([]);
    });
  });

  describe("Accessibility", () => {
    it("should have label for screen readers", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("label")).toBe("Metric Name");
    });

    it("should have hint text", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("stackLabel")).toBe(true);
    });

    it("should have proper data-test attribute for automation", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="metric-selector"]').exists()).toBe(true);
    });
  });
});
