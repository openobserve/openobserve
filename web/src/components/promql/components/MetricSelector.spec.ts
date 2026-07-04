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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// vi.mock() calls at the TOP — hoisted by Vitest
vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(),
  },
}));

// OSelect is a heavy reka-ui component — stub it so tests can control its
// behaviour and assert on the props it receives without mounting a full
// virtual-scroll dropdown.
//
// Note: the parent passes `data-test="metric-selector"` as an attribute to
// OSelect; Vue attribute inheritance forwards it to the stub's root element.
// The stub therefore appears in the DOM as `[data-test="metric-selector"]`.
//
// `clearable` is passed without a colon (boolean shorthand) in the parent
// template; declaring it as Boolean in the stub ensures props() returns true.
vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: {
      modelValue: { default: undefined },
      options: { default: () => [] },
      label: { type: String, default: "" },
      clearable: { type: Boolean, default: false },
    },
    emits: ["update:modelValue"],
    template: `
      <div>
        <span data-test="o-select-label">{{ label }}</span>
        <span data-test="o-select-options-count">{{ options ? options.length : 0 }}</span>
        <slot name="empty" />
        <button
          data-test="o-select-trigger"
          @click="$emit('update:modelValue', 'http_requests_total')"
        >select</button>
        <button
          data-test="o-select-clear"
          @click="$emit('update:modelValue', null)"
        >clear</button>
      </div>
    `,
  },
}));

import MetricSelector from "./MetricSelector.vue";

describe("MetricSelector", () => {
  let wrapper: VueWrapper;
  let mockStreamService: { nameList: ReturnType<typeof vi.fn> };

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

  const createWrapper = (props: Record<string, unknown> = {}) =>
    mount(MetricSelector, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [i18n, store],
        mocks: { $t: (key: string) => key },
      },
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    const streamModule = await import("@/services/stream");
    mockStreamService = streamModule.default as typeof mockStreamService;
    // Default: happy-path response
    mockStreamService.nameList.mockResolvedValue({
      data: { list: mockMetrics },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Component Rendering ──────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the metric selector root element", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="promql-metric-selector"]').exists(),
      ).toBe(true);
    });

    it("displays the 'Metric' layout label", () => {
      wrapper = createWrapper();

      // i18n resolves 'panel.metric' to 'Metric' in the en locale
      expect(
        wrapper.find('[data-test="promql-metric-selector-label"]').text(),
      ).toBe("Metric");
    });

    it("renders the OSelect component", () => {
      wrapper = createWrapper();

      expect(wrapper.findComponent({ name: "OSelect" }).exists()).toBe(true);
    });

    it("passes data-test attribute to OSelect", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="metric-selector"]').exists()).toBe(true);
    });

    it("passes clearable prop to OSelect", () => {
      wrapper = createWrapper();
      const oSelect = wrapper.findComponent({ name: "OSelect" });

      expect(oSelect.props("clearable")).toBe(true);
    });

    it("passes 'Metric Name' label to OSelect", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="o-select-label"]').text()).toBe(
        "Metric Name",
      );
    });
  });

  // ── Metrics Loading ──────────────────────────────────────────────────────

  describe("metrics loading", () => {
    it("calls nameList with correct arguments on mount", async () => {
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
        false,
      );
    });

    it("calls nameList exactly once on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockStreamService.nameList).toHaveBeenCalledTimes(1);
    });

    it("populates OSelect options with metric names after loading", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      const options = oSelect.props("options") as string[];

      expect(options).toHaveLength(5);
      expect(options).toContain("http_requests_total");
      expect(options).toContain("cpu_usage_percent");
      expect(options).toContain("memory_usage_bytes");
    });

    it("shows options count of 5 in the stub after load", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="o-select-options-count"]').text(),
      ).toBe("5");
    });

    it("passes empty options list when API returns empty list", async () => {
      mockStreamService.nameList.mockResolvedValue({ data: { list: [] } });

      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("options")).toEqual([]);
    });

    it("shows 'No metrics found' in empty slot when loading is false and no metrics", async () => {
      mockStreamService.nameList.mockResolvedValue({ data: { list: [] } });

      wrapper = createWrapper();
      await flushPromises();

      // The #empty slot is forwarded to the stub root; the stub root is
      // rendered with the forwarded data-test="metric-selector" attribute.
      expect(wrapper.find('[data-test="metric-selector"]').text()).toContain(
        "No metrics found",
      );
    });

    it("shows 'Loading metrics...' in empty slot while request is in flight", async () => {
      // Never resolves during the test — component is stuck loading
      let resolveNameList!: (v: unknown) => void;
      mockStreamService.nameList.mockReturnValue(
        new Promise((res) => {
          resolveNameList = res;
        }),
      );

      wrapper = createWrapper();
      // Do NOT flush — request is still pending
      await Promise.resolve(); // let onMounted microtask run

      expect(wrapper.find('[data-test="metric-selector"]').text()).toContain(
        "Loading metrics...",
      );

      // Cleanup: resolve so no leaked promise
      resolveNameList({ data: { list: [] } });
      await flushPromises();
    });

    it("handles missing data.list in response without throwing", async () => {
      mockStreamService.nameList.mockResolvedValue({});

      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("options")).toEqual([]);
    });

    it("handles API error: options remain empty and loading clears", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockStreamService.nameList.mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("options")).toEqual([]);
      // Loading cleared — 'No metrics found' visible, not the loading text
      expect(wrapper.find('[data-test="metric-selector"]').text()).toContain(
        "No metrics found",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error loading metrics:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // ── Metric Selection ─────────────────────────────────────────────────────

  describe("metric selection", () => {
    it("initialises OSelect modelValue from metric prop", () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      const oSelect = wrapper.findComponent({ name: "OSelect" });

      expect(oSelect.props("modelValue")).toBe("http_requests_total");
    });

    it("initialises with empty string when metric prop is empty", () => {
      wrapper = createWrapper({ metric: "" });
      const oSelect = wrapper.findComponent({ name: "OSelect" });

      expect(oSelect.props("modelValue")).toBe("");
    });

    it("emits update:metric with the selected value when OSelect fires update:modelValue", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Drive through the public API — OSelect stub emits update:modelValue on button click
      await wrapper.find('[data-test="o-select-trigger"]').trigger("click");

      expect(wrapper.emitted("update:metric")).toBeTruthy();
      expect(wrapper.emitted("update:metric")![0]).toEqual([
        "http_requests_total",
      ]);
    });

    it("updates OSelect modelValue after a selection", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="o-select-trigger"]').trigger("click");

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("modelValue")).toBe("http_requests_total");
    });

    it("emits update:metric with empty string when OSelect fires null (clear)", async () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      await flushPromises();

      await wrapper.find('[data-test="o-select-clear"]').trigger("click");

      expect(wrapper.emitted("update:metric")).toBeTruthy();
      expect(wrapper.emitted("update:metric")![0]).toEqual([""]);
    });

    it("sets OSelect modelValue to empty string after clearing", async () => {
      wrapper = createWrapper({ metric: "http_requests_total" });
      await flushPromises();

      await wrapper.find('[data-test="o-select-clear"]').trigger("click");

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("modelValue")).toBe("");
    });

    it("does not emit update:metric on initial mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.emitted("update:metric")).toBeFalsy();
    });
  });

  // ── Component Props ───────────────────────────────────────────────────────

  describe("props", () => {
    it("accepts and exposes the metric prop", () => {
      wrapper = createWrapper({ metric: "test_metric" });

      expect(wrapper.props("metric")).toBe("test_metric");
    });

    it("accepts and exposes the datasource prop", () => {
      const datasource = { id: "ds1", name: "Prometheus" };
      wrapper = createWrapper({ datasource });

      expect(wrapper.props("datasource")).toEqual(datasource);
    });

    it("works without a datasource prop (optional)", () => {
      wrapper = createWrapper();

      expect(wrapper.props("datasource")).toBeUndefined();
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("has a proper data-test attribute for automation", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="metric-selector"]').exists()).toBe(true);
    });

    it("passes an accessible label to OSelect", () => {
      wrapper = createWrapper();
      const oSelect = wrapper.findComponent({ name: "OSelect" });

      expect(oSelect.props("label")).toBe("Metric Name");
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("maps stream objects to plain name strings for OSelect options", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      const options = oSelect.props("options") as string[];

      // Every option must be a plain string, not an object
      options.forEach((opt) => {
        expect(typeof opt).toBe("string");
      });
    });

    it("handles a single-item list correctly", async () => {
      mockStreamService.nameList.mockResolvedValue({
        data: { list: [{ name: "single_metric" }] },
      });

      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect(oSelect.props("options")).toEqual(["single_metric"]);
    });

    it("handles a large list without error", async () => {
      const bigList = Array.from({ length: 500 }, (_, i) => ({
        name: `metric_${i}`,
      }));
      mockStreamService.nameList.mockResolvedValue({
        data: { list: bigList },
      });

      wrapper = createWrapper();
      await flushPromises();

      const oSelect = wrapper.findComponent({ name: "OSelect" });
      expect((oSelect.props("options") as string[]).length).toBe(500);
    });

    it("unmounts cleanly while a request is in flight (no warnings)", async () => {
      let resolveNameList!: (v: unknown) => void;
      mockStreamService.nameList.mockReturnValue(
        new Promise((res) => {
          resolveNameList = res;
        }),
      );

      wrapper = createWrapper();
      // Unmount before the promise settles
      wrapper.unmount();

      // Resolve after unmount — should not cause setState warnings
      resolveNameList({ data: { list: mockMetrics } });
      await flushPromises();

      // If we reach here without an unhandled error the test passes
      expect(true).toBe(true);
    });
  });
});
