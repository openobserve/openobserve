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

const { tokenColors, labelOverride, viewport } = vi.hoisted(() => ({
  tokenColors: { "--color-latency-p95": "#0a4ce8" } as Record<string, string>,
  labelOverride: { value: null as string | null },
  viewport: { mdUp: true },
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !viewport.mdUp),
      isTablet: computed(() => false),
      isDesktop: computed(() => viewport.mdUp),
      mdUp: computed(() => viewport.mdUp),
      lgUp: computed(() => viewport.mdUp),
    }),
  };
});

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
  { x_axis: "2026-10-06T10:00:10", duration_bucket: 16, span_count: 40, error_count: 4 },
  { x_axis: "2026-10-06T10:00:20", duration_bucket: 18, span_count: 3, error_count: 0 },
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

const mountHeatmap = async (
  props: Record<string, unknown> = { request: request() },
  stubs: Record<string, unknown> = {},
) => {
  const wrapper = mount(TracesLatencyHeatmap, {
    props,
    global: { plugins: [i18n, store], stubs },
  });
  await settle();
  return wrapper;
};

const options = (wrapper: any) =>
  wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;

// The series cell itself, so the tooltip is fed what ECharts would pass, colour rank included.
const cellWithCount = (wrapper: any, count: number) =>
  options(wrapper).series[0].data.find((c: number[]) => c[3] === count);

let wrapper: any = null;

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
});

beforeEach(() => {
  store = makeStore();
  search.mockReset();
  respond({ hits: HITS, histogram_interval: 10 });
  tokenColors["--color-latency-p95"] = "#0a4ce8";
  tokenColors["--color-status-error-text"] = "#cc3645";
  tokenColors["--color-chart-band"] = "#737373";
  labelOverride.value = null;
  viewport.mdUp = true;
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

    it("stays ready on the newer grid when the superseded search later rejects as canceled", async () => {
      let rejectFirst!: (e: unknown) => void;
      let resolveSecond!: (v: any) => void;
      search
        .mockReturnValueOnce(new Promise((_, reject) => (rejectFirst = reject)) as any)
        .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)) as any);
      wrapper = await mountHeatmap();
      await wrapper.setProps({ request: request("SELECT 2") });
      await settle();

      resolveSecond({ data: { hits: HITS, histogram_interval: 10 } });
      await settle();
      rejectFirst(Object.assign(new Error("canceled"), { name: "CanceledError" }));
      await settle();

      expect(wrapper.find('[data-test="traces-latency-heatmap-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-latency-heatmap-chart"]').exists()).toBe(true);
      expect(options(wrapper).yAxis.data).toEqual(["100ms", "200ms", "500ms"]);
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
      expect(o.visualMap.min).toBe(0);
      expect(o.visualMap.max).toBe(1);
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
      const html: string = options(wrapper).tooltip.formatter({ data: cellWithCount(wrapper, 40) });
      expect(html).toContain("&lt;b&gt;10:00&lt;/b&gt;");
      expect(html).not.toContain("<b>");
    });

    it("formats the tooltip with the time, range and span count", async () => {
      wrapper = await mountHeatmap();
      const html: string = options(wrapper).tooltip.formatter({ data: cellWithCount(wrapper, 40) });
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
      const html: string = options(wrapper).tooltip.formatter({ data: cellWithCount(wrapper, 1) });
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
  describe("color by", () => {
    const toggle = '[data-test="traces-latency-heatmap-color-toggle"]';
    const toErrors = async (w: any) => {
      await w.find('[data-test="traces-latency-heatmap-color-toggle-errors"]').trigger("click");
      await settle();
    };

    it("defaults to Spans, which is the density option", async () => {
      wrapper = await mountHeatmap();
      const o = options(wrapper);
      expect(o.series).toHaveLength(1);
      expect(o.visualMap.dimension).toBe(2);
      expect(o.visualMap.seriesIndex).toBeUndefined();
      expect(o.visualMap.inRange).toEqual({ color: ["#0a4ce8"], colorAlpha: [0.2, 1] });
      expect(o.series[0].data).toHaveLength(2);
    });

    it("colours cells by error share in Errors mode, with zero-error cells in a neutral series", async () => {
      wrapper = await mountHeatmap();
      await toErrors(wrapper);
      const o = options(wrapper);
      expect(o.series).toHaveLength(2);
      expect(o.series[0].data.map((c: number[]) => c[3])).toEqual([40]);
      expect(o.series[1].data.map((c: number[]) => c[3])).toEqual([3]);
      // ECharts refuses a heatmap series without a visual map, so each series gets its own.
      const [errorsMap, bandMap] = o.visualMap;
      expect(errorsMap.show).toBe(false);
      expect(errorsMap.seriesIndex).toBe(0);
      expect(errorsMap.dimension).toBe(4);
      expect(errorsMap.min).toBe(0);
      expect(errorsMap.max).toBe(1);
      expect(errorsMap.inRange).toEqual({ color: ["#cc3645"], colorAlpha: [0.2, 1] });
      expect(chartColor).toHaveBeenCalledWith("--color-status-error-text");
      expect(bandMap.show).toBe(false);
      expect(bandMap.seriesIndex).toBe(1);
      expect(bandMap.inRange).toEqual({ color: ["#737373"] });
      expect(chartColor).toHaveBeenCalledWith("--color-chart-band");
    });

    it("labels the toggle Color by and collapses it to a dropdown on phones", async () => {
      wrapper = await mountHeatmap();
      const group = wrapper.findComponent({ name: "OToggleGroup" });
      expect(wrapper.find(toggle).exists()).toBe(true);
      expect(group.props("label")).toBe(i18n.global.t("traces.latencyHeatmap.colorBy.label"));
      expect(group.props("labelPosition")).toBe("left");
      expect(group.props("mobileDropdown")).toBe(true);
    });

    it("switches to Errors from the phone dropdown exactly as from the strip", async () => {
      viewport.mdUp = false;
      wrapper = await mountHeatmap(undefined, {
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        ODropdownItem: {
          emits: ["select"],
          template: "<div v-bind='$attrs' @click=\"$emit('select')\"><slot /></div>",
        },
      });
      expect(
        wrapper.find('[data-test="traces-latency-heatmap-color-toggle-dropdown-btn"]').exists(),
      ).toBe(true);
      await wrapper
        .find('[data-test="traces-latency-heatmap-color-toggle-errors-item"]')
        .trigger("click");
      await settle();
      expect(options(wrapper).visualMap[0].dimension).toBe(4);
      expect(options(wrapper).series).toHaveLength(2);
    });

    for (const mode of ["spans", "errors"] as const) {
      describe(`in ${mode} mode`, () => {
        const mountIn = async () => {
          const w = await mountHeatmap();
          if (mode === "errors") await toErrors(w);
          return w;
        };

        it("adds the escaped error count and share to the tooltip", async () => {
          labelOverride.value = "<b>10:00</b>";
          wrapper = await mountIn();
          const html: string = options(wrapper).tooltip.formatter({
            data: cellWithCount(wrapper, 40),
          });
          expect(html).toContain(
            i18n.global.t("traces.latencyHeatmap.tooltipErrors", { count: 4, share: "10%" }, 4),
          );
          expect(html).not.toContain("<b>");
        });

        it("emits the same selection for a box", async () => {
          wrapper = await mountIn();
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

        it("rebuilds the option when the theme flips", async () => {
          wrapper = await mountIn();
          tokenColors["--color-latency-p95"] = "#5586f7";
          tokenColors["--color-status-error-text"] = "#eb938d";
          store.state.theme = "dark";
          await settle();
          const o = options(wrapper);
          const colourMap = mode === "spans" ? o.visualMap : o.visualMap[0];
          expect(colourMap.inRange.color).toEqual([mode === "spans" ? "#5586f7" : "#eb938d"]);
        });
      });
    }
  });

  describe("drawn selection", () => {
    const BOX = { start: 1, end: 2, start1: 0, end1: 1 };
    const SELECTED = {
      timeStartUs: START + 10 * S,
      timeEndUs: START + 30 * S,
      durationLoUs: 100_000,
      durationHiUs: 500_000,
    };
    // The real menu portals into <body>, so the heatmap is attached and queried there.
    const mountAttached = async (props: Record<string, unknown> = {}) => {
      const w = mount(TracesLatencyHeatmap, {
        props: { request: request(), selection: null, ...props },
        attachTo: document.body,
        global: { plugins: [i18n, store] },
      });
      await settle();
      return w;
    };
    const el = (name: string) =>
      document.body.querySelector<HTMLElement>(
        `[data-test="traces-latency-heatmap-selection-${name}"]`,
      );
    const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]');
    const drawn = () => wrapper.find('[data-test="traces-latency-heatmap-selection"]');
    // The parent stores what the heatmap emits and hands it back, as TracesMetricsDashboard does.
    const drawBox = async () => {
      wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("updated:dataZoom", BOX);
      await wrapper.setProps({ selection: wrapper.emitted("select")!.at(-1)![0] });
      await settle();
    };
    const press = async (key: string, target: Element | null = document.activeElement) => {
      target!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await settle();
    };
    const choose = async (name: string) => {
      el(name)!.click();
      await settle();
    };

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = "";
    });

    it("keeps the box drawn after the chart resets its zoom brush", async () => {
      wrapper = await mountAttached();
      expect(drawn().exists()).toBe(false);
      await drawBox();
      expect(wrapper.emitted("select")).toEqual([[SELECTED]]);
      expect(drawn().exists()).toBe(true);
      expect(drawn().classes()).toContain("border-accent");
      // The chart's own option never carries the box, so the reset after a zoom cannot erase it.
      expect(JSON.stringify(options(wrapper))).not.toContain("markArea");
    });

    it("opens as a menu headed by the span count, duration band and time window", async () => {
      wrapper = await mountAttached();
      await drawBox();
      expect(menu()).not.toBeNull();
      expect(el("count")!.textContent!.trim()).toBe("40 spans selected");
      expect(el("range")!.textContent!.trim()).toBe("100ms–500ms · 10:00:10–10:00:30");
      expect(menu()!.querySelector('[role="separator"]')).not.toBeNull();
    });

    it("lists each action as a menu item with its icon and key hint", async () => {
      wrapper = await mountAttached();
      await drawBox();
      const items = [...menu()!.querySelectorAll('[role="menuitem"]')];
      expect(items.map((i) => i.getAttribute("data-test"))).toEqual([
        "traces-latency-heatmap-selection-filter",
        "traces-latency-heatmap-selection-drill-down",
        "traces-latency-heatmap-selection-clear",
      ]);
      const hint = (i: Element) => i.querySelector("kbd")!.textContent!.trim();
      const label = (i: Element) => {
        const copy = i.cloneNode(true) as Element;
        copy.querySelector("kbd")!.remove();
        return copy.textContent!.trim();
      };
      expect(items.map(label)).toEqual(["Filter to selection", "Drill down", "Clear selection"]);
      expect(items.map(hint)).toEqual(["F", "D", "Esc"]);
      for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
    });

    it("moves focus into the menu when it opens", async () => {
      wrapper = await mountAttached();
      await drawBox();
      expect(menu()!.contains(document.activeElement)).toBe(true);
    });

    it("moves between items with the arrow keys, like the other menus", async () => {
      wrapper = await mountAttached();
      await drawBox();
      el("filter")!.focus();
      await press("ArrowDown");
      expect(document.activeElement).toBe(el("drill-down"));
      await press("ArrowDown");
      expect(document.activeElement).toBe(el("clear"));
    });

    it("runs F as soon as the menu opens, while the menu itself holds focus", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await press("f");
      expect(wrapper.emitted("filter")).toHaveLength(1);
      expect(menu()).toBeNull();
    });

    it("keeps the box but closes the menu after Filter to selection", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("filter");
      expect(wrapper.emitted("filter")).toHaveLength(1);
      expect(menu()).toBeNull();
      expect(drawn().exists()).toBe(true);
      expect(el("reopen")).not.toBeNull();
    });

    it("closes the menu and erases the box after Drill down, the parent still holding the selection", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("drill-down");
      expect(wrapper.emitted("drill-down")).toHaveLength(1);
      expect(menu()).toBeNull();
      expect(drawn().exists()).toBe(false);
      expect(wrapper.emitted("clear")).toBeUndefined();
    });

    it("closes the menu and erases the box after Clear selection", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("clear");
      expect(wrapper.emitted("clear")).toHaveLength(1);
      expect(menu()).toBeNull();
      expect(drawn().exists()).toBe(false);
    });

    it("clears the selection on Escape", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await press("Escape");
      expect(wrapper.emitted("clear")).toHaveLength(1);
      expect(menu()).toBeNull();
      expect(drawn().exists()).toBe(false);
    });

    it.each([
      ["f", "filter", true],
      ["d", "drill-down", false],
    ])("runs the action whose hint is %s", async (key, event, boxStays) => {
      wrapper = await mountAttached();
      await drawBox();
      await press(key);
      expect(wrapper.emitted(event)).toHaveLength(1);
      expect(menu()).toBeNull();
      expect(drawn().exists()).toBe(boxStays);
    });

    it("leaves the box and the parent selection alone when the menu is dismissed outside", async () => {
      wrapper = await mountAttached();
      await drawBox();
      wrapper.findComponent({ name: "ODropdown" }).vm.$emit("update:open", false);
      await settle();
      expect(drawn().exists()).toBe(true);
      expect(wrapper.emitted("clear")).toBeUndefined();
    });

    it("reopens the menu from the box's corner control, a labelled button, after it was dismissed", async () => {
      wrapper = await mountAttached();
      await drawBox();
      wrapper.findComponent({ name: "ODropdown" }).vm.$emit("update:open", false);
      await settle();
      expect(menu()).toBeNull();
      const reopen = el("reopen")!;
      expect(reopen.tagName).toBe("BUTTON");
      expect(reopen.getAttribute("aria-label")).toBe("Show selection actions");
      expect(reopen.classList).toContain("pointer-events-auto");
      expect(drawn().element.contains(reopen)).toBe(true);
      reopen.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
      expect(el("count")).not.toBeNull();
    });

    it("lets a drag that starts inside the box reach the chart, so a smaller box can be drawn", async () => {
      wrapper = await mountAttached();
      await drawBox();
      expect(drawn().element.tagName).not.toBe("BUTTON");
      expect(drawn().classes()).toContain("pointer-events-none");
    });

    it("groups the span count's digits, as the Drill down panel does", async () => {
      respond({
        hits: [{ ...HITS[0], span_count: 460_122 }, HITS[1]],
        histogram_interval: 10,
      });
      wrapper = await mountAttached();
      await drawBox();
      expect(el("count")!.textContent!.trim()).toBe(`${(460_122).toLocaleString()} spans selected`);
    });

    it("erases the box once the parent drops the selection", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await wrapper.setProps({ selection: null });
      expect(drawn().exists()).toBe(false);
    });

    it("forgets the box when a new search reloads the grid", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await wrapper.setProps({ request: request("SELECT 2") });
      await settle();
      expect(drawn().exists()).toBe(false);
    });

    const reopenMenu = async () => {
      el("reopen")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    };

    it.each([
      ["drill-down", false],
      ["ask-ai", true],
    ])(
      "keeps the box of a filtered selection after %s, so Clear can still undo the filter",
      async (action, aiEnabled) => {
        wrapper = await mountAttached({ aiEnabled });
        await drawBox();
        await choose("filter");
        await reopenMenu();
        await choose(action);
        expect(wrapper.emitted(action)).toHaveLength(1);
        expect(menu()).toBeNull();
        expect(drawn().exists()).toBe(true);
        expect(wrapper.emitted("clear")).toBeUndefined();
        await reopenMenu();
        await choose("clear");
        expect(wrapper.emitted("clear")).toHaveLength(1);
        expect(drawn().exists()).toBe(false);
      },
    );

    it("erases a new box on Drill down again after a filtered box was cleared", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("filter");
      await reopenMenu();
      await choose("clear");
      await wrapper.setProps({ selection: null });
      await drawBox();
      await choose("drill-down");
      expect(drawn().exists()).toBe(false);
    });

    it("erases a new box on Drill down after a reload dropped the filtered one", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("filter");
      await wrapper.setProps({ request: request("SELECT 2") });
      await settle();
      await drawBox();
      await choose("drill-down");
      expect(drawn().exists()).toBe(false);
    });

    it("closes the menu when a new search reloads the grid while it is open", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await wrapper.setProps({ request: request("SELECT 2") });
      await settle();
      // The menu is gone with the box, so its open flag is the only trace left of the old box.
      expect((wrapper.vm as any).popoverOpen).toBe(false);
    });

    it("draws a new box after an erased one, with the menu open again", async () => {
      wrapper = await mountAttached();
      await drawBox();
      await choose("drill-down");
      await drawBox();
      expect(drawn().exists()).toBe(true);
      expect(menu()).not.toBeNull();
    });

    describe("Ask AI", () => {
      it("is hidden when AI is off", async () => {
        wrapper = await mountAttached({ aiEnabled: false });
        await drawBox();
        expect(el("ask-ai")).toBeNull();
      });

      it("hands the selection to AI, then closes the menu and erases the box", async () => {
        wrapper = await mountAttached({ aiEnabled: true });
        await drawBox();
        expect(el("ask-ai")!.textContent!.trim()).toBe("Ask AI");
        expect(el("ask-ai")!.querySelector("img")).not.toBeNull();
        await choose("ask-ai");
        expect(wrapper.emitted("ask-ai")).toEqual([
          [{ selection: SELECTED, count: 40, band: "100ms–500ms", window: "10:00:10–10:00:30" }],
        ]);
        expect(menu()).toBeNull();
        expect(drawn().exists()).toBe(false);
        expect(wrapper.emitted("clear")).toBeUndefined();
      });
    });
  });
});
