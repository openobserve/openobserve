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

import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import SloBurndownChart from "./SloBurndownChart.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

// ECharts is not the subject; the OPTIONS handed to it are. `__esModule` is
// load-bearing — the component reaches this through `defineAsyncComponent`, and
// Vue only unwraps `.default` from a loader result that says it is a module.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

const search = vi.mocked(searchService.search);

/** One bucketed row as the search API returns it. */
const bucket = (n: number, good: number, total: number) => ({
  bucket: 1_754_300_000 + n * 60,
  good,
  total,
});

/** `n` fully-good buckets — nothing spent, so the budget line stays flat. */
const clean = (n: number) => Array.from({ length: n }, (_, i) => bucket(i, 100, 100));

const respond = (hits: any[]) => search.mockResolvedValue({ data: { hits } } as any);

/** More than one flush: the search result is what mounts the async
 *  ChartRenderer, so its resolution is a second hop in the same chain. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

const createWrapper = async (props: Record<string, any> = {}) => {
  const wrapper = mount(SloBurndownChart, {
    props: {
      sloId: "slo-1",
      generation: 1,
      target: 99,
      windowSecs: 3600,
      sliceIntervalSecs: 60,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
  await settle();
  return wrapper;
};

/** Chart options for the budget panel (first) and the burn panel (second). */
const options = (wrapper: VueWrapper<any>, panel: "budget" | "burn") =>
  wrapper.findAllComponents({ name: "ChartRenderer" })[panel === "budget" ? 0 : 1].props("data")
    .options;

describe("SloBurndownChart", () => {
  let wrapper: VueWrapper<any>;

  // The first `import()` of a module is genuinely async — more than the
  // microtask hops `settle` flushes. Loading it up front makes every later
  // resolution come from the module cache, so the first chart test in the file
  // does not see an unresolved placeholder while every later one passes.
  beforeAll(async () => {
    await import("@/components/dashboards/panels/ChartRenderer.vue");
  });

  beforeEach(() => {
    search.mockReset();
    respond([]);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("the pair of panels", () => {
    it("draws budget and burn as TWO panels — their scales are unrelated", async () => {
      // 0–100 against 0–600+ in a bad incident: one axis means either a dual
      // axis whose crossing point is an artifact, or one series crushed flat.
      respond(clean(5));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-budget"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slos-sloburndownchart-burn"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Error budget burndown");
      expect(wrapper.text()).toContain("Burn rate");
    });

    it("titles them with the shared PanelBar, so they carry the header tint", async () => {
      // Regression guard: these bars were hand-copied class strings and silently
      // missed the header tint when it was introduced.
      respond(clean(5));
      wrapper = await createWrapper();

      const bars = wrapper.findAllComponents({ name: "PanelBar" });
      expect(bars).toHaveLength(2);
      expect(bars[0].classes()).toContain("bg-panel-bar-bg");
    });
  });

  describe("states", () => {
    it("shows the empty state when the window measured nothing", async () => {
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("No slices measured in this window yet.");
    });

    it("holds the spinner until the search settles", async () => {
      let release: (v: any) => void = () => {};
      search.mockReturnValue(new Promise((r) => (release = r)) as any);

      wrapper = await createWrapper();
      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-loading"]').exists()).toBe(
        true,
      );

      release({ data: { hits: clean(5) } });
      await settle();
      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-loading"]').exists()).toBe(
        false,
      );
    });

    it("surfaces the server's message when the search fails", async () => {
      search.mockRejectedValue({ response: { data: { message: "stream not found" } } });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-error"]').text()).toBe(
        "stream not found",
      );
    });

    it("falls back to its own message when the failure carries none", async () => {
      search.mockRejectedValue(new Error("socket hang up"));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-error"]').text()).toBe(
        "Could not load measurement history",
      );
    });

    it("treats an abort as tidying up, NOT as a failure to report", async () => {
      search.mockRejectedValue({ code: "ERR_CANCELED" });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-budget-error"]').exists()).toBe(false);
    });
  });

  describe("coverage disclosure", () => {
    it("warns when most of the window measured nothing", async () => {
      // Two measured buckets in twenty renders as two near-bare panels, which a
      // reader cannot tell apart from a broken chart.
      respond([...clean(2), ...Array.from({ length: 18 }, (_, i) => bucket(i + 2, 0, 0))]);
      wrapper = await createWrapper();

      const banner = wrapper.find('[data-test="slos-sloburndownchart-sparse"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain("Only 2 of 20 buckets");
    });

    it("stays quiet when the window is well covered", async () => {
      respond(clean(20));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-sparse"]').exists()).toBe(false);
    });

    it("does not warn about sparseness while still loading", async () => {
      search.mockReturnValue(new Promise(() => {}) as any);
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-sloburndownchart-sparse"]').exists()).toBe(false);
    });
  });

  describe("gaps", () => {
    it("keeps an unmeasured bucket as a GAP, never as a zero", async () => {
      // A zero would draw a total outage over time nobody observed.
      respond([bucket(0, 100, 100), bucket(1, 0, 0), bucket(2, 100, 100)]);
      wrapper = await createWrapper();

      const burn = options(wrapper, "burn").series[0];
      expect(burn.data.map((d: any) => d.value)).toEqual([0, null, 0]);
      expect(burn.connectNulls).toBe(false);
    });

    it("marks an ISOLATED measurement so it does not render as nothing", async () => {
      // A line is drawn BETWEEN points, so a measured bucket with gaps on both
      // sides has no segment to belong to — the panel comes up as bare axes even
      // though `hasData` is true.
      respond([bucket(0, 0, 0), bucket(1, 100, 100), bucket(2, 0, 0)]);
      wrapper = await createWrapper();

      expect(options(wrapper, "burn").series[0].data.map((d: any) => d.symbolSize)).toEqual([
        0, 5, 0,
      ]);
    });

    it("leaves points with a neighbour unmarked, so a dense series stays clean", async () => {
      respond(clean(3));
      wrapper = await createWrapper();

      expect(options(wrapper, "burn").series[0].data.map((d: any) => d.symbolSize)).toEqual([
        0, 0, 0,
      ]);
    });
  });

  describe("the second axis", () => {
    it("counts EVENTS for a count SLI", async () => {
      // 1000 events at a 99% target leaves a budget of 10 bad ones.
      respond(clean(10));
      wrapper = await createWrapper({ target: 99, sliType: "count" });

      const right = options(wrapper, "budget").yAxis[1];
      expect(right.max).toBe(10);
      expect(right.show).toBe(true);
    });

    it("converts SECONDS back into slices for an SLI that scores whole slices", async () => {
      // The same 10 units are SECONDS here, so at a 5-second interval the honest
      // answer is 2 slices. Labelling them "10 slices" is off by the whole
      // interval, in the direction that sounds reassuring.
      respond(clean(10));
      wrapper = await createWrapper({ target: 99, sliType: "time_slice", sliceIntervalSecs: 5 });

      expect(options(wrapper, "budget").yAxis[1].max).toBe(2);
    });

    it("borrows the left axis's gridlines instead of drawing chrome of its own", async () => {
      // A right-hand axis here is a SCALE, not a second series — its own
      // splitlines would invite hunting for the line that belongs to it.
      respond(clean(10));
      wrapper = await createWrapper();

      const right = options(wrapper, "budget").yAxis[1];
      expect(right.position).toBe("right");
      expect(right.splitLine.show).toBe(false);
      expect(right.axisLine.show).toBe(false);
    });
  });

  describe("the thresholds each panel names", () => {
    it("marks budget exhaustion at 0%", async () => {
      respond(clean(5));
      wrapper = await createWrapper();

      const markLine = options(wrapper, "budget").series[0].markLine;
      expect(markLine.data).toEqual([{ yAxis: 0 }]);
      // Carries its value, because echarts parks the label at the RIGHT end —
      // inches from the latest point, where a bare name reads as a verdict on it.
      expect(markLine.label.formatter).toBe("Budget exhausted (0%)");
    });

    it("marks budget-neutral burn at ×1, the only threshold that means anything", async () => {
      respond(clean(5));
      wrapper = await createWrapper();

      const markLine = options(wrapper, "burn").series[0].markLine;
      expect(markLine.data).toEqual([{ yAxis: 1 }]);
      expect(markLine.label.formatter).toBe("Budget-neutral (×1)");
    });
  });

  describe("when it queries", () => {
    it("loads on mount without waiting for a prop to change", async () => {
      wrapper = await createWrapper();
      expect(search).toHaveBeenCalledTimes(1);
    });

    it("scans a window earlier than the one it charts, so backfill is not filtered out", async () => {
      // The search API filters on `_timestamp` (WRITE time) while the SQL
      // filters on `slice_start` (measurement time). Backfill writes old
      // measurements with a current `_timestamp`.
      wrapper = await createWrapper({ windowSecs: 3600 });

      const { start_time, end_time } = search.mock.calls[0][0].query.query as any;
      expect(end_time - start_time).toBe(2 * 3600 * 1_000_000);
    });

    it("re-queries when the generation bumps — mixing generations is corruption", async () => {
      wrapper = await createWrapper();
      await wrapper.setProps({ generation: 2 });
      await settle();

      expect(search).toHaveBeenCalledTimes(2);
    });

    it("does not query without an SLO to query for", async () => {
      wrapper = await createWrapper({ sloId: "" });
      expect(search).not.toHaveBeenCalled();
    });

    it("does not query for a zero-width window", async () => {
      wrapper = await createWrapper({ windowSecs: 0 });
      expect(search).not.toHaveBeenCalled();
    });

    it("aborts the in-flight search on unmount rather than holding a queue slot", async () => {
      let signal: AbortSignal | undefined;
      search.mockImplementation((req: any) => {
        signal = req.signal;
        return new Promise(() => {}) as any; // never settles
      });

      wrapper = await createWrapper();
      expect(signal?.aborted).toBe(false);

      wrapper.unmount();
      expect(signal?.aborted).toBe(true);
    });
  });
});
