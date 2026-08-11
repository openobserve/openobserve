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
import SloTimeSlicePreview from "./SloTimeSlicePreview.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import { SLICE_ALIAS, VALUE_ALIAS } from "@/utils/slos/previewQuery";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query_range: vi.fn() },
}));

// ECharts is not the subject; the OPTIONS handed to it are.
//
// `__esModule` is load-bearing: the component reaches this through
// `defineAsyncComponent(() => import(...))`, and Vue only unwraps `.default`
// from a loader result that identifies itself as a module. Without it Vue
// treats the whole namespace as the component and probes it for `__isTeleport`,
// which vitest's mock proxy rejects.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

const search = vi.mocked(searchService.search);
const rangeQuery = vi.mocked(searchService.metrics_query_range);

/** One returned slice bucket, in the shape `time_slice_sql` projects. */
const slice = (isoBucket: string, value: number | null) => ({
  [SLICE_ALIAS]: isoBucket,
  [VALUE_ALIAS]: value,
});

/** `n` slices, the first `goodCount` of them under the threshold of 100. */
const slices = (n: number, goodCount: number) =>
  Array.from({ length: n }, (_, i) =>
    slice(`2026-08-02T${String(i).padStart(2, "0")}:00:00`, i < goodCount ? 50 : 500),
  );

const respond = (hits: any[]) => search.mockResolvedValue({ data: { hits } } as any);

/** One matrix series, in the shape `/api/v1/query_range` returns: label set
 *  plus `[secondsTimestamp, "stringValue"]` samples — the value is ALWAYS a
 *  string (`Sample::serialize` writes `value.to_string()`). */
const series = (
  values: [number, string][],
  metric: Record<string, string> = {},
): { metric: Record<string, string>; values: [number, string][] } => ({ metric, values });

/** `resultType` rides alongside `result`, as `QueryResult` serializes it. */
const promRespond = (result: unknown[]) =>
  rangeQuery.mockResolvedValue({ data: { data: { resultType: "matrix", result } } } as any);

/** Epoch SECONDS for a UTC wall clock, which is what the matrix carries. */
const at = (iso: string) => Math.floor(new Date(`${iso}Z`).getTime() / 1000);

/** `n` PromQL samples one slice apart, the first `goodCount` under the
 *  threshold of 100 — the matrix twin of `slices`. */
const promSlices = (n: number, goodCount: number) =>
  series(
    Array.from(
      { length: n },
      (_, i) =>
        [at("2026-08-02T12:05:00") + i * 300, i < goodCount ? "50" : "500"] as [number, string],
    ),
  );

/**
 * Flush until the component has stopped chaining promises.
 *
 * More than one, because the work is a chain: the first flush lands the search
 * result, and the points it produces are what mount the async ChartRenderer,
 * whose own resolution is another hop. Looping rather than counting hops keeps
 * this from being re-tuned every time the chain changes length.
 */
const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

const createWrapper = async (props: Record<string, any> = {}) => {
  const wrapper = mount(SloTimeSlicePreview, {
    props: {
      streamType: "logs",
      stream: "default",
      scope: "",
      aggregate: "avg(took)",
      comparator: "<",
      threshold: 100,
      sliceIntervalSecs: 300,
      target: 95,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
  await settle();
  return wrapper;
};

const tallyEl = (wrapper: VueWrapper<any>) =>
  wrapper.find('[data-test="slos-slotimeslicepreview-tally"]');

/** The series values the chart was actually handed. */
const seriesData = (wrapper: VueWrapper<any>) =>
  wrapper.findComponent({ name: "ChartRenderer" }).props("data").options.series[0].data;

describe("SloTimeSlicePreview", () => {
  let wrapper: VueWrapper<any>;

  // The component reaches ChartRenderer through `defineAsyncComponent`, and the
  // FIRST `import()` of a module is genuinely async — more than the microtask
  // hops `settle` flushes. Loading it up front makes every later resolution come
  // from the module cache, so a chart is on screen by the time `settle` returns.
  // Without this the first chart test in the file sees an unresolved placeholder
  // and every one after it passes, which reads as flake rather than ordering.
  beforeAll(async () => {
    await import("@/components/dashboards/panels/ChartRenderer.vue");
  });

  beforeEach(() => {
    search.mockReset();
    rangeQuery.mockReset();
    respond([]);
    promRespond([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  describe("states", () => {
    it("titles the panel with the shared PanelBar, so it carries the header tint", async () => {
      // Regression guard: this bar was a hand-copied class string and silently
      // missed the header tint when it was introduced.
      wrapper = await createWrapper();

      const bar = wrapper.findComponent({ name: "PanelBar" });
      expect(bar.exists()).toBe(true);
      expect(bar.classes()).toContain("bg-panel-bar-bg");
    });

    it("shows the empty state when the range holds no slices", async () => {
      wrapper = await createWrapper();
      expect(wrapper.find('[data-test="slos-slotimeslicepreview-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("No slices in this range yet");
    });

    it("draws the chart once slices arrive", async () => {
      respond(slices(3, 3));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-empty"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(true);
      expect(seriesData(wrapper)).toEqual([50, 50, 50]);
    });

    it("holds the spinner until the search settles", async () => {
      let release: (v: any) => void = () => {};
      search.mockReturnValue(new Promise((r) => (release = r)) as any);

      wrapper = await createWrapper();
      expect(wrapper.find('[data-test="slos-slotimeslicepreview-loading"]').exists()).toBe(true);

      release({ data: { hits: slices(2, 2) } });
      await settle();
      expect(wrapper.find('[data-test="slos-slotimeslicepreview-loading"]').exists()).toBe(false);
    });

    it("surfaces the server's message when the search fails", async () => {
      search.mockRejectedValue({ response: { data: { message: "stream not found" } } });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-error"]').text()).toBe(
        "stream not found",
      );
    });

    it("falls back to its own message when the failure carries none", async () => {
      search.mockRejectedValue(new Error("socket hang up"));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-error"]').text()).toBe(
        "Could not run the preview query",
      );
    });

    it("treats an abort as tidying up, NOT as a failure to report", async () => {
      // The component aborts its own superseded searches; surfacing that as an
      // error would flash a failure the user never caused.
      search.mockRejectedValue({ name: "CanceledError" });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-error"]').exists()).toBe(false);
    });

    it("does not search at all when there is no aggregate to query", async () => {
      wrapper = await createWrapper({ aggregate: "" });
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe("the tally", () => {
    it("reports good-over-measured and the SLI it produces", async () => {
      respond(slices(10, 9));
      wrapper = await createWrapper();

      expect(tallyEl(wrapper).text()).toBe("90.0% good (9/10 slices)");
    });

    it("scores against the comparator, so `>` inverts which slices are good", async () => {
      respond(slices(10, 9)); // 9 slices at 50, 1 at 500; threshold 100
      wrapper = await createWrapper({ comparator: ">" });

      expect(tallyEl(wrapper).text()).toBe("10.0% good (1/10 slices)");
    });

    it("withholds the verdict below 10 measured slices rather than colouring noise", async () => {
      // At three slices one slot moves the reading by 33 points; a red "66.7%"
      // there invites retuning a production threshold on nothing.
      respond(slices(3, 2));
      wrapper = await createWrapper();

      expect(tallyEl(wrapper).text()).toContain("66.7% good");
      expect(tallyEl(wrapper).classes()).toContain("text-text-secondary");
      expect(tallyEl(wrapper).classes()).not.toContain("text-negative");
    });

    it("calls a pass once there are enough slices to say so", async () => {
      respond(slices(10, 10)); // 100% against a 95% target
      wrapper = await createWrapper();

      expect(tallyEl(wrapper).classes()).toContain("text-positive");
    });

    it("calls a failure when the SLI lands under the target", async () => {
      respond(slices(10, 9)); // 90% against a 95% target
      wrapper = await createWrapper();

      expect(tallyEl(wrapper).classes()).toContain("text-negative");
    });

    it("stays neutral when the target itself cannot be read", async () => {
      // Green was the old default here, which is a pass claimed from ignorance.
      respond(slices(10, 10));
      wrapper = await createWrapper({ target: Number.NaN });

      expect(tallyEl(wrapper).classes()).toContain("text-text-secondary");
    });

    it("does not count an unreadable slice as bad", async () => {
      // A null aggregate compares false against every operator; scoring it as
      // downtime would invent an outage nobody measured.
      respond([...slices(4, 4), slice("2026-08-02T09:00:00", null)]);
      wrapper = await createWrapper();

      expect(tallyEl(wrapper).text()).toBe("100.0% good (4/4 slices)");
    });
  });

  describe("coverage disclosure", () => {
    it("says how many slots produced nothing, so the tally's denominator is visible", async () => {
      // 1h at a 5-minute interval = 12 slots; 4 measured leaves 8 unmeasured.
      respond(slices(4, 4));
      wrapper = await createWrapper({ sliceIntervalSecs: 300 });

      const gaps = wrapper.find('[data-test="slos-slotimeslicepreview-gaps"]');
      expect(gaps.exists()).toBe(true);
      expect(gaps.text()).toContain("8/12");
    });

    it("stays quiet when the range is fully covered", async () => {
      respond(slices(12, 12));
      wrapper = await createWrapper({ sliceIntervalSecs: 300 });

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-gaps"]').exists()).toBe(false);
    });
  });

  describe("reading the buckets", () => {
    it("parses the UTC bucket as UTC — a local read shifts the whole series", async () => {
      // `histogram()` returns "2026-08-02T12:00:00" with no zone marker, which a
      // browser parses as LOCAL time. The store's timezone is UTC here, so a
      // correctly-parsed bucket labels as its own hour.
      respond([slice("2026-08-02T12:00:00", 42)]);
      wrapper = await createWrapper();

      const labels = wrapper.findComponent({ name: "ChartRenderer" }).props("data").options
        .xAxis.data;
      expect(labels).toEqual(["12:00"]);
    });

    it("drops a null bucket instead of plotting it at 1970", async () => {
      // `Number(null)` is 0, so a null bucket would fall through the numeric
      // branch and anchor the x-axis at the epoch.
      respond([slice("2026-08-02T12:00:00", 42), { [SLICE_ALIAS]: null, [VALUE_ALIAS]: 7 }]);
      wrapper = await createWrapper();

      expect(seriesData(wrapper)).toEqual([42]);
    });

    it("keeps an unmeasured slice as a GAP, never as a zero", async () => {
      respond([slice("2026-08-02T12:00:00", 42), slice("2026-08-02T13:00:00", null)]);
      wrapper = await createWrapper();

      expect(seriesData(wrapper)).toEqual([42, null]);
      expect(
        wrapper.findComponent({ name: "ChartRenderer" }).props("data").options.series[0]
          .connectNulls,
      ).toBe(false);
    });

    it("sorts buckets by time regardless of the order they came back in", async () => {
      respond([slice("2026-08-02T13:00:00", 20), slice("2026-08-02T12:00:00", 10)]);
      wrapper = await createWrapper();

      expect(seriesData(wrapper)).toEqual([10, 20]);
    });
  });

  describe("when it re-queries", () => {
    it("re-scores on a threshold change WITHOUT a new search", async () => {
      // The threshold never reaches SQL, so moving it reclassifies the slices
      // already in hand — dragging it must not fire a query per pixel.
      respond(slices(10, 9));
      wrapper = await createWrapper();
      expect(search).toHaveBeenCalledTimes(1);
      expect(tallyEl(wrapper).text()).toBe("90.0% good (9/10 slices)");

      await wrapper.setProps({ threshold: 1000 }); // now every slice is good
      await flushPromises();

      expect(search).toHaveBeenCalledTimes(1);
      expect(tallyEl(wrapper).text()).toBe("100.0% good (10/10 slices)");
    });

    it("debounces an aggregate change — every rebuild is a search", async () => {
      wrapper = await createWrapper();
      expect(search).toHaveBeenCalledTimes(1); // the mount load

      vi.useFakeTimers();
      await wrapper.setProps({ aggregate: "max(took)" });
      await flushPromises();
      expect(search).toHaveBeenCalledTimes(1); // still waiting

      vi.advanceTimersByTime(500);
      await flushPromises();
      expect(search).toHaveBeenCalledTimes(2);
    });

    it("re-queries on a range change", async () => {
      wrapper = await createWrapper();
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
      await flushPromises();

      expect(search).toHaveBeenCalledTimes(2);
      const [first, second] = search.mock.calls.map(
        (c: any) => c[0].query.query.end_time - c[0].query.query.start_time,
      );
      expect(second).toBe(24 * first); // 1h → 24h
    });

    it("re-queries when the language changes, abandoning the SQL search", async () => {
      let sqlSignal: AbortSignal | undefined;
      search.mockImplementation((req: any) => {
        sqlSignal = req.signal;
        return new Promise(() => {}) as any; // never settles
      });

      wrapper = await createWrapper();
      expect(search).toHaveBeenCalledTimes(1);
      expect(rangeQuery).not.toHaveBeenCalled();

      vi.useFakeTimers();
      await wrapper.setProps({ queryLanguage: "prom_ql" });
      await flushPromises();
      vi.advanceTimersByTime(500);
      await flushPromises();

      expect(rangeQuery).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1); // no second SQL search
      // One controller across both branches, or the abandoned SQL search keeps
      // its slot in the server's work-group queue.
      expect(sqlSignal?.aborted).toBe(true);
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

  // A metrics time slice is PromQL, which is not a scan of rows but a range
  // evaluation at instants — a different endpoint, a different result shape,
  // and a slice attribution that has to be inverted rather than read off.
  describe("the PromQL branch", () => {
    const promqlWrapper = (props: Record<string, any> = {}) =>
      createWrapper({
        streamType: "metrics",
        stream: "http_latency",
        queryLanguage: "prom_ql",
        aggregate: "histogram_quantile(0.95, sum by (le) (rate(http_latency_bucket[5m])))",
        ...props,
      });

    it("runs a range query instead of a SQL search", async () => {
      wrapper = await promqlWrapper();

      expect(rangeQuery).toHaveBeenCalledTimes(1);
      expect(search).not.toHaveBeenCalled();
      expect(rangeQuery.mock.calls[0][0].query).toBe(
        "histogram_quantile(0.95, sum by (le) (rate(http_latency_bucket[5m])))",
      );
      // Without it the request goes to /api/undefined/prometheus/…
      expect(rangeQuery.mock.calls[0][0].org_identifier).toBe(
        store.state.selectedOrganization.identifier,
      );
    });

    // PromQL evaluates AT instants, and a sample at T with a slice-wide range
    // selector covers (T-interval, T]. Asking from the range start would ask
    // for one slice that has not happened yet and skew every attribution.
    it("asks for slice ENDS, stepping by the slice width", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T13:00:00Z"));
      wrapper = await promqlWrapper({ sliceIntervalSecs: 300 });

      const req = rangeQuery.mock.calls[0][0];
      expect(req.end_time).toBe(at("2026-08-02T13:00:00") * 1_000_000);
      expect(req.start_time).toBe(at("2026-08-02T12:05:00") * 1_000_000);
      expect(req.step).toBe("300");
    });

    // The other legal slice width. Hardcoding 300 satisfies every other test
    // here and shifts a 1-minute SLO's whole series by four minutes.
    it("follows the slice width to a one-minute slice", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T13:00:00Z"));
      promRespond([series([[at("2026-08-02T12:01:00"), "42"]])]);
      wrapper = await promqlWrapper({ sliceIntervalSecs: 60 });

      const req = rangeQuery.mock.calls[0][0];
      expect(req.start_time).toBe(at("2026-08-02T12:01:00") * 1_000_000);
      expect(req.step).toBe("60");
      expect(
        wrapper.findComponent({ name: "ChartRenderer" }).props("data").options.xAxis.data,
      ).toEqual(["12:00"]);
    });

    it("plots a sample against the slice it CLOSES, not the instant it was taken", async () => {
      // 12:05 closes the slice that started at 12:00.
      promRespond([series([[at("2026-08-02T12:05:00"), "42"]])]);
      wrapper = await promqlWrapper();

      const labels = wrapper.findComponent({ name: "ChartRenderer" }).props("data").options
        .xAxis.data;
      expect(labels).toEqual(["12:00"]);
      expect(seriesData(wrapper)).toEqual([42]);
    });

    it("reads the string values the matrix carries as numbers", async () => {
      // Every sample value is a string on the wire, chart data is numeric.
      promRespond([
        series([
          [at("2026-08-02T12:05:00"), "1.5"],
          [at("2026-08-02T12:10:00"), "2"],
        ]),
      ]);
      wrapper = await promqlWrapper();

      expect(seriesData(wrapper)).toEqual([1.5, 2]);
    });

    it("keeps an unreadable sample as a GAP, never as a zero", async () => {
      // Prometheus spells a missing float "NaN"; `Number("NaN")` is NaN and a
      // zero there would read as a perfect slice.
      promRespond([
        series([
          [at("2026-08-02T12:05:00"), "42"],
          [at("2026-08-02T12:10:00"), "NaN"],
        ]),
      ]);
      wrapper = await promqlWrapper();

      expect(seriesData(wrapper)).toEqual([42, null]);
    });

    it("sorts samples by time regardless of the order they came back in", async () => {
      promRespond([
        series([
          [at("2026-08-02T12:10:00"), "20"],
          [at("2026-08-02T12:05:00"), "10"],
        ]),
      ]);
      wrapper = await promqlWrapper();

      expect(seriesData(wrapper)).toEqual([10, 20]);
    });

    it("tallies a PromQL series exactly as it tallies a SQL one", async () => {
      promRespond([promSlices(10, 9)]);
      wrapper = await promqlWrapper();

      expect(tallyEl(wrapper).text()).toBe("90.0% good (9/10 slices)");
    });

    it("discloses the slots the range never produced, as the SQL branch does", async () => {
      // 1h at a 5-minute interval = 12 slots; 4 measured leaves 8 unmeasured.
      promRespond([promSlices(4, 4)]);
      wrapper = await promqlWrapper({ sliceIntervalSecs: 300 });

      const gaps = wrapper.find('[data-test="slos-slotimeslicepreview-gaps"]');
      expect(gaps.exists()).toBe(true);
      expect(gaps.text()).toContain("8/12");
    });

    it("shows the empty state when the expression matched nothing", async () => {
      promRespond([]);
      wrapper = await promqlWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-empty"]').exists()).toBe(true);
    });

    it("surfaces the range query's failure", async () => {
      rangeQuery.mockRejectedValue({ response: { data: { message: "parse error" } } });
      wrapper = await promqlWrapper();

      expect(wrapper.find('[data-test="slos-slotimeslicepreview-error"]').text()).toBe(
        "parse error",
      );
    });

    it("aborts the in-flight range query on unmount", async () => {
      let signal: AbortSignal | undefined;
      rangeQuery.mockImplementation((req: any) => {
        signal = req.signal;
        return new Promise(() => {}) as any;
      });

      wrapper = await promqlWrapper();
      expect(signal?.aborted).toBe(false);

      wrapper.unmount();
      expect(signal?.aborted).toBe(true);
    });

    it("does not query at all without an expression", async () => {
      wrapper = await promqlWrapper({ aggregate: "" });
      expect(rangeQuery).not.toHaveBeenCalled();
      // Nor may it fall through to the SQL endpoint, which is the branch bug
      // this whole split exists to avoid.
      expect(search).not.toHaveBeenCalled();
    });

    // The backend refuses a slice two series both report: you cannot sum two
    // p95s, so the slice is dropped with a reason. Discovering that days later
    // as missing data is the failure this panel exists to prevent.
    describe("more than one series", () => {
      const twoSeries = [
        series([[at("2026-08-02T12:05:00"), "10"]], { pod: "a" }),
        series([[at("2026-08-02T12:05:00"), "20"]], { pod: "b" }),
      ];

      it("says so, and says how many", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper();

        const notice = wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]');
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toContain("2");
      });

      // The count has to be interpolated, not spelled into the copy.
      it("counts three as three", async () => {
        promRespond([...twoSeries, series([[at("2026-08-02T12:05:00"), "30"]], { pod: "c" })]);
        wrapper = await promqlWrapper();

        expect(wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]').text()).toContain(
          "3",
        );
      });

      // Drawing one of them would be exactly the confident wrong number the
      // backend refuses to record.
      it("draws nothing rather than picking one", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper();

        expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(false);
        expect(tallyEl(wrapper).exists()).toBe(false);
      });

      it("does not mistake the empty range for it", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper();

        expect(wrapper.find('[data-test="slos-slotimeslicepreview-empty"]').exists()).toBe(false);
      });

      // The coverage line counts slots that produced nothing. Here the data
      // arrived and was unusable, so blaming the range for a gap points at the
      // wrong problem.
      it("does not also report the whole range as unmeasured", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper();

        expect(wrapper.find('[data-test="slos-slotimeslicepreview-gaps"]').exists()).toBe(false);
      });

      it("clears the notice once the expression narrows to one series", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper();
        expect(wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]').exists()).toBe(
          true,
        );

        promRespond([series([[at("2026-08-02T12:05:00"), "10"]], { pod: "a" })]);
        vi.useFakeTimers();
        await wrapper.setProps({ aggregate: 'up{pod="a"}' });
        await flushPromises();
        vi.advanceTimersByTime(500);
        await settle();

        expect(wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]').exists()).toBe(
          false,
        );
      });

      it("stays quiet for a single series", async () => {
        promRespond([promSlices(3, 3)]);
        wrapper = await promqlWrapper();

        expect(wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]').exists()).toBe(
          false,
        );
      });

      // A grouped SLO is SUPPOSED to return one series per group — the ingest
      // pass keys on (slice, group) and scores each on its own. Telling that
      // user to aggregate the expression would break the SLO.
      it("does not call a grouped SLO's series a collision", async () => {
        promRespond(twoSeries);
        wrapper = await promqlWrapper({ grouped: true });

        const notice = wrapper.find('[data-test="slos-slotimeslicepreview-multiseries"]');
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toContain("one per group");
        expect(notice.text()).not.toContain("Aggregate the expression");
      });
    });
  });
});
