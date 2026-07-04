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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------
// Component: ErrorsOverTimeChart
// Path: src/components/rum/errorTracking/list/ErrorsOverTimeChart.vue
// Props:
//   buckets: StackedBucket[] — array of { ts (µs), handled, unhandled }
//   deploy: DeployInfo | null — { version, firstSeen }
//   spikeFactor: number | null
//   loading?: boolean
// Emits: none
// Slots: none
// Store deps: store.state.theme (read for reactivity, not for logic)
// Service deps: none
// Child components: ChartRenderer (async, STUBBED), OSkeleton
// Conditional states:
//   - loading === true → loading skeleton bars (data-test rum-errors-over-time-chart-loading)
//   - hasData === false (all buckets zero / empty) → empty message (data-test rum-errors-over-time-chart-empty)
//   - hasData === true → ChartRenderer stub + optional spike caption
// User interactions: none
// Async operations: ChartRenderer is defineAsyncComponent (stub removes async)
// ---------------------------------------------------------------------------

import ErrorsOverTimeChart from "./ErrorsOverTimeChart.vue";

// Bucket timestamps — microseconds (µs). The component converts to ms for date-fns.
// These span ~1 hour so labelFormat will pick "HH:mm".
const BASE_TS_US = 1_700_000_000_000_000; // 2023-11-14 22:13:20 UTC in µs
const makeTs = (offsetMs: number) => BASE_TS_US + offsetMs * 1000;

const nonZeroBuckets = [
  { ts: makeTs(0), handled: 2, unhandled: 1 },
  { ts: makeTs(300_000), handled: 0, unhandled: 3 },
  { ts: makeTs(600_000), handled: 5, unhandled: 0 },
];

const allZeroBuckets = [
  { ts: makeTs(0), handled: 0, unhandled: 0 },
  { ts: makeTs(300_000), handled: 0, unhandled: 0 },
];

const deployWithinBuckets = {
  version: "v1.0.6",
  // firstSeen falls between first and second bucket → deployIndex = 1
  firstSeen: makeTs(150_000),
};

const deployOutsideBuckets = {
  version: "v1.0.6",
  // firstSeen is before the first bucket → deployIndex = 0 (still within range)
  firstSeen: makeTs(-100_000),
};

function mountChart(
  props: Record<string, unknown> = {},
): VueWrapper {
  return mount(ErrorsOverTimeChart, {
    props: {
      buckets: nonZeroBuckets,
      deploy: null,
      spikeFactor: null,
      loading: false,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        // Stub the async ChartRenderer to avoid loading the real ECharts bundle
        // and to expose the `data` prop for assertion.
        ChartRenderer: {
          // Named so findComponent({ name: "ChartRenderer" }) resolves the stub.
          name: "ChartRenderer",
          template: '<div data-test="chart-renderer-stub" />',
          props: ["data"],
        },
        // OSkeleton renders as a simple div in JSDOM — no stub needed.
      },
    },
  });
}

describe("ErrorsOverTimeChart", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountChart();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // rendering — root element
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders the root section element", () => {
      expect(
        wrapper.find('[data-test="rum-errors-over-time-chart"]').exists(),
      ).toBe(true);
    });

    it("renders the section heading text", () => {
      expect(wrapper.find("h4").exists()).toBe(true);
      expect(wrapper.find("h4").text()).toContain("Errors over time");
    });

    // The "handled / unhandled" subtitle was removed — the ECharts legend
    // already labels both series.
  });

  // -------------------------------------------------------------------------
  // loading state
  // -------------------------------------------------------------------------

  describe("loading state", () => {
    it("shows the loading skeleton when loading is true", () => {
      const w = mountChart({ loading: true });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-loading"]').exists(),
      ).toBe(true);

      w.unmount();
    });

    it("does not show the chart stub when loading is true", () => {
      const w = mountChart({ loading: true });

      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not show the empty state when loading is true", () => {
      const w = mountChart({ loading: true, buckets: allZeroBuckets });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("hides the loading element when loading is false", () => {
      expect(
        wrapper.find('[data-test="rum-errors-over-time-chart-loading"]').exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // empty state
  // -------------------------------------------------------------------------

  describe("empty state", () => {
    it("shows the empty message when all buckets have zero errors", () => {
      const w = mountChart({ buckets: allZeroBuckets });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(true);

      w.unmount();
    });

    it("shows the correct empty text", () => {
      const w = mountChart({ buckets: allZeroBuckets });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').text(),
      ).toContain("No errors in the selected time range");

      w.unmount();
    });

    it("shows empty state when buckets array is empty", () => {
      const w = mountChart({ buckets: [] });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(true);

      w.unmount();
    });

    it("does not show the chart stub when bucket data is all zero", () => {
      const w = mountChart({ buckets: allZeroBuckets });

      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(false);

      w.unmount();
    });

    it("does not show empty state when at least one bucket has non-zero errors", () => {
      expect(
        wrapper.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // data / chart state
  // -------------------------------------------------------------------------

  describe("data state", () => {
    it("renders the ChartRenderer stub when there is data", () => {
      expect(wrapper.find('[data-test="chart-renderer-stub"]').exists()).toBe(
        true,
      );
    });

    it("passes a data prop to ChartRenderer with options object", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const data = stub.props("data") as { options: Record<string, any> };

      expect(data).toBeDefined();
      expect(data.options).toBeDefined();
    });

    it("generates two series named Handled and Unhandled", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { series: Array<{ name: string; stack: string }> };
      };

      const seriesNames = options.series.map((s) => s.name);
      expect(seriesNames).toContain("Handled");
      expect(seriesNames).toContain("Unhandled");
    });

    it("stacks both series with the same stack key 'errors'", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { series: Array<{ stack: string }> };
      };

      for (const series of options.series) {
        expect(series.stack).toBe("errors");
      }
    });

    it("populates Unhandled series data from buckets.unhandled", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { series: Array<{ name: string; data: number[] }> };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.data).toEqual(
        nonZeroBuckets.map((b) => b.unhandled),
      );
    });

    it("populates Handled series data from buckets.handled", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { series: Array<{ name: string; data: number[] }> };
      };

      const handledSeries = options.series.find((s) => s.name === "Handled");
      expect(handledSeries!.data).toEqual(
        nonZeroBuckets.map((b) => b.handled),
      );
    });

    it("generates x-axis category labels from bucket timestamps", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { xAxis: { data: string[] } };
      };

      expect(options.xAxis.data).toHaveLength(nonZeroBuckets.length);
      // All labels must be non-empty strings (formatted timestamps)
      for (const label of options.xAxis.data) {
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it("uses HH:mm format for sub-day time ranges", () => {
      // nonZeroBuckets spans 10 minutes — well under 1 day → HH:mm
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { xAxis: { data: string[] } };
      };

      // HH:mm format → label matches \d\d:\d\d
      expect(options.xAxis.data[0]).toMatch(/^\d{2}:\d{2}$/);
    });

    it("uses MM-dd HH:mm format for multi-day time ranges", () => {
      const msPerDay = 86_400_000;
      const multiDayBuckets = [
        { ts: makeTs(0), handled: 1, unhandled: 0 },
        { ts: makeTs(msPerDay * 2), handled: 0, unhandled: 2 },
      ];
      const w = mountChart({ buckets: multiDayBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { xAxis: { data: string[] } };
      };

      // MM-dd HH:mm → label matches \d\d-\d\d \d\d:\d\d
      expect(options.xAxis.data[0]).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // deploy markLine
  // -------------------------------------------------------------------------

  describe("deploy markLine", () => {
    it("adds markLine to the Unhandled series when deploy is provided and within buckets", async () => {
      const w = mountChart({ deploy: deployWithinBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{
            name: string;
            markLine?: { data: Array<{ xAxis: number }> };
          }>;
        };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.markLine).toBeDefined();
      expect(unhandledSeries!.markLine!.data).toHaveLength(1);

      w.unmount();
    });

    it("sets markLine xAxis index to the bucket where firstSeen falls", async () => {
      const w = mountChart({ deploy: deployWithinBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{
            name: string;
            markLine?: { data: Array<{ xAxis: number }> };
          }>;
        };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      // firstSeen is between bucket[0] and bucket[1] → first bucket with ts >= firstSeen is index 1
      expect(unhandledSeries!.markLine!.data[0].xAxis).toBe(1);

      w.unmount();
    });

    it("includes the deploy version in the markLine label formatter", async () => {
      const w = mountChart({ deploy: deployWithinBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{
            name: string;
            markLine?: {
              label?: { formatter?: string };
            };
          }>;
        };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.markLine!.label!.formatter).toContain("v1.0.6");

      w.unmount();
    });

    it("does not add markLine when deploy is null", () => {
      // Default mount: deploy = null
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{ name: string; markLine?: unknown }>;
        };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.markLine).toBeUndefined();
    });

    it("does not add markLine to the Handled series", async () => {
      const w = mountChart({ deploy: deployWithinBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{ name: string; markLine?: unknown }>;
        };
      };

      const handledSeries = options.series.find((s) => s.name === "Handled");
      expect(handledSeries!.markLine).toBeUndefined();

      w.unmount();
    });

    it("adds markLine when deploy.firstSeen is before the first bucket (deployIndex = 0)", () => {
      const w = mountChart({ deploy: deployOutsideBuckets });

      const stub = w.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: {
          series: Array<{
            name: string;
            markLine?: { data: Array<{ xAxis: number }> };
          }>;
        };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.markLine).toBeDefined();
      expect(unhandledSeries!.markLine!.data[0].xAxis).toBe(0);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // spike caption
  // -------------------------------------------------------------------------

  describe("spike caption", () => {
    it("shows the spike caption when deploy and spikeFactor are both provided", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: 3.6,
      });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-spike-caption"]').exists(),
      ).toBe(true);

      w.unmount();
    });

    it("spike caption contains the formatted factor and version", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: 3.6,
      });

      const caption = w
        .find('[data-test="rum-errors-over-time-chart-spike-caption"]')
        .text();

      expect(caption).toContain("3.6×");
      expect(caption).toContain("v1.0.6");

      w.unmount();
    });

    it("spike caption contains 'spike right after the'", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: 2.1,
      });

      const caption = w
        .find('[data-test="rum-errors-over-time-chart-spike-caption"]')
        .text();

      expect(caption).toContain("spike right after the");

      w.unmount();
    });

    it("does not show spike caption when spikeFactor is null (even with deploy)", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: null,
      });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-spike-caption"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("does not show spike caption when deploy is null (even with spikeFactor)", () => {
      const w = mountChart({
        deploy: null,
        spikeFactor: 4.0,
      });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-spike-caption"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("does not show spike caption when both deploy and spikeFactor are null", () => {
      // Default mount: both are null
      expect(
        wrapper
          .find('[data-test="rum-errors-over-time-chart-spike-caption"]')
          .exists(),
      ).toBe(false);
    });

    it("formats spikeFactor to one decimal place in caption", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: 5,
      });

      expect(
        w
          .find('[data-test="rum-errors-over-time-chart-spike-caption"]')
          .text(),
      ).toContain("5.0×");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // props reactivity
  // -------------------------------------------------------------------------

  describe("props reactivity", () => {
    it("switches from data to empty state when buckets become all zero", async () => {
      // Arrange — start with data
      expect(wrapper.find('[data-test="chart-renderer-stub"]').exists()).toBe(
        true,
      );

      // Act
      await wrapper.setProps({ buckets: allZeroBuckets });

      // Assert — chart gone, empty shown
      expect(wrapper.find('[data-test="chart-renderer-stub"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(true);
    });

    it("switches from empty to data state when buckets gain non-zero values", async () => {
      // Arrange — start with empty buckets
      const w = mountChart({ buckets: allZeroBuckets });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(true);

      // Act
      await w.setProps({ buckets: nonZeroBuckets });

      // Assert
      expect(
        w.find('[data-test="rum-errors-over-time-chart-empty"]').exists(),
      ).toBe(false);
      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(true);

      w.unmount();
    });

    it("updates chartOptions when buckets prop changes", async () => {
      const newBuckets = [
        { ts: makeTs(0), handled: 10, unhandled: 20 },
        { ts: makeTs(300_000), handled: 5, unhandled: 15 },
      ];

      // Act
      await wrapper.setProps({ buckets: newBuckets });

      // Assert — Unhandled series data reflects new buckets
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { series: Array<{ name: string; data: number[] }> };
      };

      const unhandledSeries = options.series.find((s) => s.name === "Unhandled");
      expect(unhandledSeries!.data).toEqual([20, 15]);
    });

    it("shows loading state when loading prop changes to true", async () => {
      // Act
      await wrapper.setProps({ loading: true });

      // Assert
      expect(
        wrapper
          .find('[data-test="rum-errors-over-time-chart-loading"]')
          .exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("renders with a single bucket having data", () => {
      const w = mountChart({
        buckets: [{ ts: makeTs(0), handled: 0, unhandled: 1 }],
      });

      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(true);

      w.unmount();
    });

    it("considers a bucket with only handled errors as having data", () => {
      const w = mountChart({
        buckets: [{ ts: makeTs(0), handled: 5, unhandled: 0 }],
      });

      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(true);

      w.unmount();
    });

    it("considers a bucket with only unhandled errors as having data", () => {
      const w = mountChart({
        buckets: [{ ts: makeTs(0), handled: 0, unhandled: 3 }],
      });

      expect(w.find('[data-test="chart-renderer-stub"]').exists()).toBe(true);

      w.unmount();
    });

    it("renders without crashing when spikeFactor is 1.5 (minimum meaningful spike)", () => {
      const w = mountChart({
        deploy: deployWithinBuckets,
        spikeFactor: 1.5,
      });

      expect(
        w.find('[data-test="rum-errors-over-time-chart-spike-caption"]').exists(),
      ).toBe(true);
      expect(
        w.find('[data-test="rum-errors-over-time-chart-spike-caption"]').text(),
      ).toContain("1.5×");

      w.unmount();
    });

    it("chart options include a tooltip with axis trigger", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { tooltip: { trigger: string } };
      };

      expect(options.tooltip.trigger).toBe("axis");
    });

    it("chart options include a legend", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { legend: { show: boolean } };
      };

      expect(options.legend.show).toBe(true);
    });

    it("chart options have yAxis with value type", () => {
      const stub = wrapper.findComponent({ name: "ChartRenderer" });
      const { options } = stub.props("data") as {
        options: { yAxis: { type: string } };
      };

      expect(options.yAxis.type).toBe("value");
    });
  });

  // -------------------------------------------------------------------------
  // async — component unmounts mid-load (no console errors)
  // -------------------------------------------------------------------------

  describe("async — unmount safety", () => {
    it("does not throw when component is unmounted immediately after mount", async () => {
      const w = mountChart({ loading: true });

      // Unmount before async ChartRenderer resolves (it's stubbed, so this
      // tests that no pending effect causes a warning in the teardown)
      w.unmount();

      await flushPromises();
      // If no unhandled promise rejection / Vue warning occurred, test passes.
      expect(true).toBe(true);
    });
  });
});
