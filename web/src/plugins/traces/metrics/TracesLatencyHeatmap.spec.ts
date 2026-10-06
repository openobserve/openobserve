// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import searchService from "@/services/search";

const { tokenColors, labelOverride } = vi.hoisted(() => ({
  tokenColors: { "--color-latency-p95": "#0a4ce8" } as Record<string, string>,
  labelOverride: { value: null as string | null },
}));

// Lets a test feed markup through the column label, the one tooltip line derived from formatting.
vi.mock("@/utils/timezone", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    timestampToTimezoneDate: (...args: any[]) =>
      labelOverride.value ?? actual.timestampToTimezoneDate(...args),
  };
});

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

vi.mock("@/utils/chartTheme", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    chartColor: vi.fn((token: string) => tokenColors[token] ?? "#000000"),
  };
});

// `__esModule` is load-bearing: the component reaches this through defineAsyncComponent.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    emits: ["updated:dataZoom"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

import { chartColor } from "@/utils/chartTheme";
import TracesLatencyHeatmap from "./TracesLatencyHeatmap.vue";

const search = vi.mocked(searchService.search);

const S = 1_000_000;
const START = Date.UTC(2026, 9, 6, 10, 0, 0) * 1000;
const END = START + 60 * S;

const HITS = [
  { x_axis: "2026-10-06T10:00:10", duration_bucket: 16, span_count: 40 },
  { x_axis: "2026-10-06T10:00:20", duration_bucket: 18, span_count: 3 },
];

const respond = (data: Record<string, unknown>) => search.mockResolvedValue({ data } as any);

const makeStore = () =>
  createStore({
    state: {
      theme: "light",
      timezone: "UTC",
      selectedOrganization: { identifier: "test-org" },
    },
  });

let store = makeStore();

const request = (sql = "SELECT 1") => ({ sql, startTime: START, endTime: END });

const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

const mountHeatmap = async (props: Record<string, unknown> = { request: request() }) => {
  const wrapper = mount(TracesLatencyHeatmap, {
    props,
    global: { plugins: [i18n, store] },
  });
  await settle();
  return wrapper;
};

const options = (wrapper: any) =>
  wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;

let wrapper: any = null;

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
});

beforeEach(() => {
  store = makeStore();
  search.mockReset();
  respond({ hits: HITS, histogram_interval: 10 });
  tokenColors["--color-latency-p95"] = "#0a4ce8";
  labelOverride.value = null;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("TracesLatencyHeatmap", () => {
  describe("states", () => {
    it("shows the spinner while the search is in flight", async () => {
      search.mockReturnValue(new Promise(() => {}) as any);
      wrapper = await mountHeatmap();
      expect(wrapper.find('[data-test="traces-latency-heatmap-loading"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(false);
    });

    it("renders the empty state component for no hits", async () => {
      respond({ hits: [], histogram_interval: 10 });
      wrapper = await mountHeatmap();
      const empty = wrapper.find('[data-test="traces-latency-heatmap-no-data"]');
      expect(empty.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OEmptyState" }).exists()).toBe(true);
      expect(empty.text()).toContain(i18n.global.t("traces.latencyHeatmap.noData"));
    });

    it("renders the error state when the search rejects", async () => {
      search.mockRejectedValue(new Error("boom"));
      wrapper = await mountHeatmap();
      const error = wrapper.find('[data-test="traces-latency-heatmap-error"]');
      expect(error.exists()).toBe(true);
      expect(error.text()).toBe(i18n.global.t("traces.latencyHeatmap.loadFailed"));
    });

    it("does not treat an aborted search as an error", async () => {
      search.mockRejectedValue(Object.assign(new Error("canceled"), { name: "CanceledError" }));
      wrapper = await mountHeatmap();
      expect(wrapper.find('[data-test="traces-latency-heatmap-error"]').exists()).toBe(false);
    });

    it("renders the unavailable state and no chart without a histogram interval", async () => {
      respond({ hits: HITS });
      wrapper = await mountHeatmap();
      const unavailable = wrapper.find('[data-test="traces-latency-heatmap-unavailable"]');
      expect(unavailable.exists()).toBe(true);
      expect(unavailable.text()).toBe(i18n.global.t("traces.latencyHeatmap.unavailable"));
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(false);
    });

    it("renders the chart when data arrives, under the Duration title", async () => {
      wrapper = await mountHeatmap();
      expect(wrapper.find('[data-test="traces-latency-heatmap"]').text()).toContain(
        i18n.global.t("traces.latencyHeatmap.title"),
      );
      expect(wrapper.find('[data-test="traces-latency-heatmap-chart"]').exists()).toBe(true);
    });
  });

  describe("fetching", () => {
    it("sends the request's SQL and range as a one-shot traces search", async () => {
      wrapper = await mountHeatmap();
      const call = search.mock.calls[0][0] as any;
      expect(call.org_identifier).toBe("test-org");
      expect(call.page_type).toBe("traces");
      expect(call.query.query).toEqual({
        sql: "SELECT 1",
        start_time: START,
        end_time: END,
        from: 0,
        size: -1,
      });
      expect(call.signal).toBeInstanceOf(AbortSignal);
    });

    it("aborts the previous call and refetches for a new request object with identical fields", async () => {
      search.mockReturnValue(new Promise(() => {}) as any);
      wrapper = await mountHeatmap();
      const first = (search.mock.calls[0][0] as any).signal as AbortSignal;
      await wrapper.setProps({ request: request() });
      await settle();
      expect(search).toHaveBeenCalledTimes(2);
      expect(first.aborted).toBe(true);
    });

    it("keeps the newer request's grid when the superseded one resolves last", async () => {
      let resolveFirst!: (v: any) => void;
      let resolveSecond!: (v: any) => void;
      search
        .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)) as any)
        .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)) as any);
      wrapper = await mountHeatmap();
      await wrapper.setProps({ request: request("SELECT 2") });
      await settle();

      resolveSecond({
        data: {
          hits: [{ x_axis: "2026-10-06T10:00:10", duration_bucket: 20, span_count: 5 }],
          histogram_interval: 10,
        },
      });
      await settle();
      resolveFirst({ data: { hits: HITS, histogram_interval: 10 } });
      await settle();

      expect(options(wrapper).yAxis.data).toEqual(["2s"]);
    });
  });

  describe("chart option", () => {
    it("uses two category axes, a hidden x/y box zoom and a hidden visual map", async () => {
      wrapper = await mountHeatmap();
      const o = options(wrapper);
      expect(o.xAxis.type).toBe("category");
      expect(o.yAxis.type).toBe("category");
      expect(o.xAxis.data).toHaveLength(6);
      expect(o.yAxis.data).toEqual(["100ms", "200ms", "500ms"]);
      expect(o.toolbox.feature.dataZoom.xAxisIndex).toBe(0);
      expect(o.toolbox.feature.dataZoom.yAxisIndex).toBe(0);
      expect(o.visualMap.show).toBe(false);
      expect(o.visualMap.dimension).toBe(2);
      expect(o.visualMap.max).toBe(Math.log1p(40));
      expect(o.series[0].type).toBe("heatmap");
    });

    it("draws cells without borders, so a dense grid is not striped", async () => {
      wrapper = await mountHeatmap();
      expect(options(wrapper).series[0].itemStyle.borderWidth).toBe(0);
    });

    it("labels columns to the second for sub-minute buckets", async () => {
      wrapper = await mountHeatmap();
      expect(options(wrapper).xAxis.data[0]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("labels columns to the minute for minute buckets, like the Rate chart", async () => {
      respond({ hits: HITS, histogram_interval: 60 });
      wrapper = await mountHeatmap();
      expect(options(wrapper).xAxis.data[0]).toMatch(/^\d{2}:\d{2}$/);
    });

    it("colours cells from the latency token", async () => {
      wrapper = await mountHeatmap();
      expect(chartColor).toHaveBeenCalledWith("--color-latency-p95");
      expect(options(wrapper).visualMap.inRange.color).toEqual(["#0a4ce8"]);
      expect(options(wrapper).visualMap.inRange.colorAlpha).toEqual([0.2, 1]);
    });

    it("rebuilds the option when the theme flips", async () => {
      wrapper = await mountHeatmap();
      tokenColors["--color-latency-p95"] = "#5586f7";
      store.state.theme = "dark";
      await settle();
      expect(options(wrapper).visualMap.inRange.color).toEqual(["#5586f7"]);
    });

    it("escapes the tooltip text", async () => {
      labelOverride.value = "<b>10:00</b>";
      wrapper = await mountHeatmap();
      const html: string = options(wrapper).tooltip.formatter({ data: [1, 0, Math.log1p(40), 40] });
      expect(html).toContain("&lt;b&gt;10:00&lt;/b&gt;");
      expect(html).not.toContain("<b>");
    });

    it("formats the tooltip with the time, range and span count", async () => {
      wrapper = await mountHeatmap();
      const html: string = options(wrapper).tooltip.formatter({ data: [1, 0, Math.log1p(40), 40] });
      expect(html).toContain("10:00:10");
      expect(html).toContain("100ms – 200ms");
      expect(html).toContain(
        i18n.global.t("traces.latencyHeatmap.tooltipSpans", { count: 40 }, 40),
      );
    });

    it("shows an open range for the top bucket", async () => {
      respond({
        hits: [{ x_axis: "2026-10-06T10:00:10", duration_bucket: 28, span_count: 1 }],
        histogram_interval: 10,
      });
      wrapper = await mountHeatmap();
      const html: string = options(wrapper).tooltip.formatter({ data: [1, 0, Math.log1p(1), 1] });
      expect(html).toContain("≥ 1000s");
    });
  });

  describe("selection", () => {
    it("emits the box as a half-open selection", async () => {
      wrapper = await mountHeatmap();
      wrapper
        .findComponent({ name: "ChartRenderer" })
        .vm.$emit("updated:dataZoom", { start: 1, end: 2, start1: 0, end1: 1 });
      expect(wrapper.emitted("select")).toEqual([
        [
          {
            timeStartUs: START + 10 * S,
            timeEndUs: START + 30 * S,
            durationLoUs: 100_000,
            durationHiUs: 500_000,
          },
        ],
      ]);
    });
  });
});
