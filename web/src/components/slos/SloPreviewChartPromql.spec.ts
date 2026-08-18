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

//! The count preview over a PromQL source.
//!
//! GOOD and TOTAL, not good and bad. A SQL count SLI derives both sides from
//! one scan, so bad is the complement and the pair mirrors. A PromQL count
//! source is two independent expressions where `total` is the DENOMINATOR —
//! subtracting one from the other would draw a series the SLO never computes,
//! and would go negative the moment the two counters disagree.

import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import SloPreviewChart from "./SloPreviewChart.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query_range: vi.fn() },
}));

// The SQL branch's renderer pulls in the whole dashboard panel stack; it is not
// the subject here, but it still has to mount for the SQL guard tests.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "width", "height", "variablesData", "searchType"],
    template: '<div class="panel-schema-renderer-stub" />',
  },
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
const rangeQuery = vi.mocked(searchService.metrics_query_range);

const NOW_SECS = 1_754_300_000;
const NOW = NOW_SECS * 1000;

const GOOD = 'increase(http_requests_total{code!~"5.."}[5m])';
const TOTAL = "increase(http_requests_total[5m])";

/** One matrix series as `/api/v1/query_range` returns it: the sample value is
 *  ALWAYS a string (`Sample::serialize` writes `value.to_string()`). */
const series = (values: [number, string][], metric: Record<string, string> = {}) => ({
  metric,
  values,
});

const promRespond = (result: unknown[]) =>
  rangeQuery.mockResolvedValue({ data: { data: { resultType: "matrix", result } } } as never);

/** Epoch SECONDS for a UTC wall clock, which is what the matrix carries. */
const at = (iso: string) => Math.floor(new Date(`${iso}Z`).getTime() / 1000);

/**
 * Flush until the component has stopped chaining promises: the range results
 * land first, and the points they produce are what mount the async
 * ChartRenderer, whose own resolution is another hop.
 */
const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

const createWrapper = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(SloPreviewChart, {
    props: {
      streamType: "metrics",
      stream: "",
      queryLanguage: "prom_ql",
      good: GOOD,
      total: TOTAL,
      sliceIntervalSecs: 300,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
  await settle();
  return wrapper;
};

/** Only the slice of the ECharts option tree these tests read. */
interface PreviewChartOptions {
  xAxis: { data: string[] };
  series: Array<{
    type: string;
    data: Array<number | null>;
    itemStyle: { color: string };
  }>;
}

/** The options handed to each chart, in panel order (good, total).
 *
 *  Throws rather than returning a short list: indexing into one produces
 *  "cannot read properties of undefined" ten lines later, which names neither
 *  the panel that is missing nor the assertion that wanted it. */
const chartOptions = (wrapper: VueWrapper): PreviewChartOptions[] => {
  const charts = wrapper.findAllComponents({ name: "ChartRenderer" });
  if (charts.length !== 2) throw new Error(`expected 2 charts, drew ${charts.length}`);
  return charts.map((c) => (c.props("data") as { options: PreviewChartOptions }).options);
};

type RangeRequest = {
  org_identifier: string;
  query: string;
  start_time: number;
  end_time: number;
  step: string;
  signal: AbortSignal;
};
const requests = (): RangeRequest[] => rangeQuery.mock.calls.map((c) => c[0] as RangeRequest);

describe("SloPreviewChart — PromQL count source", () => {
  let wrapper: VueWrapper | null = null;

  // The chart is reached through `defineAsyncComponent`, so the first `import()`
  // is genuinely async and lands after the flushes below. Resolved once here, or
  // the first chart assertion in the file sees a placeholder and every later one
  // passes — which reads as flake rather than as ordering.
  beforeAll(async () => {
    await import("@/components/dashboards/panels/ChartRenderer.vue");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    search.mockReset();
    rangeQuery.mockReset();
    promRespond([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  describe("what it asks for", () => {
    it("runs ONE range evaluation per expression", async () => {
      wrapper = await createWrapper();

      // Which of the two goes first is incidental; that both go, exactly once
      // each, is not.
      expect(rangeQuery).toHaveBeenCalledTimes(2);
      expect(requests().map((r) => r.query)).toEqual(expect.arrayContaining([GOOD, TOTAL]));
    });

    // Forgetting it sends the preview to `/api/undefined/prometheus/…`, which
    // has shipped once already.
    it("addresses the selected organization", async () => {
      wrapper = await createWrapper();

      expect(requests()).toHaveLength(2);
      for (const request of requests()) {
        expect(request.org_identifier).toBe(store.state.selectedOrganization.identifier);
      }
    });

    // `prom_query` in query.rs: a sample at T with a slice-wide range selector
    // covers (T-interval, T], so the instants are slice ENDS and the first one
    // is start + one interval.
    it("evaluates at slice ends and steps by the slice width", async () => {
      wrapper = await createWrapper();

      expect(requests()).toHaveLength(2);
      for (const request of requests()) {
        expect(request.start_time).toBe((NOW_SECS - 3600 + 300) * 1_000_000);
        expect(request.end_time).toBe(NOW_SECS * 1_000_000);
        expect(request.step).toBe("300");
      }
    });

    it("follows the slice interval into the step", async () => {
      wrapper = await createWrapper({ sliceIntervalSecs: 60 });

      expect(requests()[0].step).toBe("60");
      expect(requests()[0].start_time).toBe((NOW_SECS - 3600 + 60) * 1_000_000);
    });

    // With every SQL input filled in too, so the absence of the panels is the
    // LANGUAGE deciding and not `buildSloPreviewQuery` returning null for want
    // of a stream.
    it("never falls back to the SQL panels, even with the SQL inputs filled in", async () => {
      wrapper = await createWrapper({
        streamType: "metrics",
        stream: "http_requests",
        goodExpr: "code < 500",
      });

      expect(rangeQuery).toHaveBeenCalledTimes(2);
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(0);
    });

    it("widens both evaluations together when a longer range is picked", async () => {
      wrapper = await createWrapper();
      rangeQuery.mockClear();

      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "6h");
      await settle();

      expect(rangeQuery).toHaveBeenCalledTimes(2);
      for (const request of requests()) {
        expect(request.start_time).toBe((NOW_SECS - 6 * 3600 + 300) * 1_000_000);
      }
    });
  });

  describe("what it draws", () => {
    it("draws GOOD and TOTAL — total is the denominator, not the complement", async () => {
      wrapper = await createWrapper();

      expect(wrapper.text()).toContain("Good events");
      expect(wrapper.text()).toContain("Total events");
      expect(wrapper.text()).not.toContain("Bad events");
    });

    it("plots the value of each slice the evaluation answered", async () => {
      promRespond([
        series([
          [NOW_SECS - 600, "4"],
          [NOW_SECS - 300, "6"],
        ]),
      ]);
      wrapper = await createWrapper();

      expect(chartOptions(wrapper)[0].series[0].data).toEqual([4, 6]);
    });

    // Two pods' `increase()` genuinely add up — the summing rule `promql_rows`
    // applies, and the one place the count reader differs from the time-slice
    // one, which refuses an ambiguous matrix outright.
    it("sums series that land on the same slice rather than refusing them", async () => {
      promRespond([
        series([[NOW_SECS - 300, "4"]], { pod: "a" }),
        series([[NOW_SECS - 300, "6"]], { pod: "b" }),
      ]);
      wrapper = await createWrapper();

      expect(chartOptions(wrapper)[0].series[0].data).toEqual([10]);
    });

    // The whole normalization rule, asserted where it is actually WIRED rather
    // than only on the helper: a sample at 12:05 measures the slice that
    // started at 12:00. Plotting it at 12:05 shifts every bar by one slice —
    // invisible in the values and wrong in every one of them.
    it("labels each bar with the slice it CLOSES, not the instant sampled", async () => {
      promRespond([series([[at("2026-08-02T12:05:00"), "4"]])]);
      wrapper = await createWrapper();

      expect(chartOptions(wrapper)[0].xAxis.data).toEqual(["12:00"]);
    });

    // `promql_rows` sums with a bare `+=`, so one NaN makes the slice NaN and
    // the row is rejected. A gap is what the SLO will record.
    it("draws an unreadable slice as a gap, not as a zero", async () => {
      promRespond([series([[at("2026-08-02T12:05:00"), "NaN"]])]);
      wrapper = await createWrapper();

      expect(chartOptions(wrapper)[0].series[0].data).toEqual([null]);
    });

    it("draws BARS: these are counts per slice, and a line implies interpolation", async () => {
      promRespond([series([[NOW_SECS - 300, "4"]])]);
      wrapper = await createWrapper();

      expect(chartOptions(wrapper)[0].series[0].type).toBe("bar");
    });

    it("gives good and total different colours", async () => {
      promRespond([series([[NOW_SECS - 300, "4"]])]);
      wrapper = await createWrapper();

      const [good, total] = chartOptions(wrapper);
      expect(good.series[0].itemStyle.color).not.toBe(total.series[0].itemStyle.color);
    });

    // The panels are stacked, so bar N of one is read against bar N of the
    // other. Two separate evaluations need not answer for the same slices — a
    // label-filtered numerator whose series churns is the ordinary case — and
    // per-panel axes would then put different slices in the same column.
    it("draws both panels on ONE axis, so column N is the same slice in each", async () => {
      rangeQuery.mockImplementation(
        (options) =>
          Promise.resolve({
            data: {
              data: {
                resultType: "matrix",
                result: [
                  (options as { query: string }).query === GOOD
                    ? series([[at("2026-08-02T12:10:00"), "2"]])
                    : series([
                        [at("2026-08-02T12:05:00"), "5"],
                        [at("2026-08-02T12:10:00"), "7"],
                      ]),
                ],
              },
            },
          }) as never,
      );
      wrapper = await createWrapper();

      const [good, total] = chartOptions(wrapper);
      expect(good.xAxis.data).toEqual(["12:00", "12:05"]);
      expect(total.xAxis.data).toEqual(["12:00", "12:05"]);
      // A slice the DENOMINATOR answered and the numerator did not is a ZERO:
      // `promql_rows` iterates totals and defaults good to 0.0, so the SLO
      // records that slice at 0%. A gap there would be the "nothing was good" /
      // "no traffic" confusion this preview exists to prevent.
      expect(good.series[0].data).toEqual([0, 2]);
      expect(total.series[0].data).toEqual([5, 7]);
    });

    // The reverse carries no such rule: `promql_rows` emits no row at all for a
    // slice only the numerator answered, so the denominator is honestly absent.
    it("leaves the denominator a gap where only the numerator answered", async () => {
      rangeQuery.mockImplementation(
        (options) =>
          Promise.resolve({
            data: {
              data: {
                resultType: "matrix",
                result: [
                  (options as { query: string }).query === GOOD
                    ? series([
                        [at("2026-08-02T12:05:00"), "1"],
                        [at("2026-08-02T12:10:00"), "2"],
                      ])
                    : series([[at("2026-08-02T12:10:00"), "7"]]),
                ],
              },
            },
          }) as never,
      );
      wrapper = await createWrapper();

      const [good, total] = chartOptions(wrapper);
      expect(good.series[0].data).toEqual([1, 2]);
      expect(total.series[0].data).toEqual([null, 7]);
    });

    it("draws each side from its OWN evaluation", async () => {
      rangeQuery.mockImplementation(
        (options) =>
          Promise.resolve({
            data: {
              data: {
                resultType: "matrix",
                result: [
                  series([
                    [NOW_SECS - 300, (options as { query: string }).query === GOOD ? "3" : "9"],
                  ]),
                ],
              },
            },
          }) as never,
      );
      wrapper = await createWrapper();

      const [good, total] = chartOptions(wrapper);
      expect(good.series[0].data).toEqual([3]);
      expect(total.series[0].data).toEqual([9]);
    });
  });

  describe("before there is anything to draw", () => {
    it("asks for both expressions before running anything", async () => {
      wrapper = await createWrapper({ total: "" });

      expect(rangeQuery).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="slos-slopreviewchart-good-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Define both PromQL expressions");
    });

    it("says the range held no samples rather than drawing an empty chart", async () => {
      promRespond([]);
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-total-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("No slices in this range yet");
    });

    it("shows the failure instead of a blank panel", async () => {
      rangeQuery.mockRejectedValue({ response: { data: { message: "parse error at [5m" } } });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good-error"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("parse error at [5m");
    });

    it("still says something when the failure carries no message", async () => {
      rangeQuery.mockRejectedValue(new Error("Network Error"));
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good-error"]').text()).toBe(
        "Could not run the preview query",
      );
    });

    // The component aborts its own superseded evaluations; surfacing that as an
    // error would flash a failure the user never caused, on every keystroke.
    it("treats an abort as tidying up, NOT as a failure to report", async () => {
      rangeQuery.mockRejectedValue({ name: "CanceledError" });
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good-error"]').exists()).toBe(false);
    });

    // Two queries are in flight for a second or more. Showing "no slices" while
    // they run flashes an empty verdict on every keystroke.
    it("says it is working rather than reporting no data early", async () => {
      let land: (value: unknown) => void = () => {};
      rangeQuery.mockReturnValue(
        new Promise((resolve) => {
          land = resolve;
        }) as never,
      );
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slos-slopreviewchart-good-empty"]').exists()).toBe(false);

      land({ data: { data: { resultType: "matrix", result: [] } } });
      await settle();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good-loading"]').exists()).toBe(false);
    });
  });

  describe("the SQL branch", () => {
    // `good` and `total` are left populated deliberately: they survive in the
    // shared form model after a flip back to SQL, and the language — not their
    // emptiness — is what has to keep the range queries away.
    it("still previews good and bad from panel schemas", async () => {
      wrapper = await createWrapper({
        queryLanguage: "sql",
        streamType: "logs",
        stream: "default",
        goodExpr: "code < 500",
      });

      expect(rangeQuery).not.toHaveBeenCalled();
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(2);
      expect(wrapper.text()).toContain("Bad events");
    });

    it("defaults to SQL when no language is given", async () => {
      wrapper = await createWrapper({
        queryLanguage: undefined,
        streamType: "logs",
        stream: "default",
        goodExpr: "code < 500",
      });

      expect(rangeQuery).not.toHaveBeenCalled();
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(2);
    });
  });

  describe("keeping up with typing", () => {
    it("waits for a pause before re-evaluating — every rebuild is two queries", async () => {
      wrapper = await createWrapper();
      rangeQuery.mockClear();

      await wrapper.setProps({ good: "increase(x[5m])" });
      await flushPromises();
      expect(rangeQuery).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      await settle();
      expect(requests()).toHaveLength(2);
      expect(requests().map((r) => r.query)).toEqual(
        expect.arrayContaining(["increase(x[5m])", TOTAL]),
      );
    });

    // The denominator is half the definition. Watching only `good` leaves the
    // total chart showing the previous expression's answer indefinitely.
    it("re-evaluates when the TOTAL expression changes", async () => {
      wrapper = await createWrapper();
      rangeQuery.mockClear();

      await wrapper.setProps({ total: "increase(y[5m])" });
      vi.advanceTimersByTime(500);
      await settle();

      expect(requests()).toHaveLength(2);
      expect(requests().map((r) => r.query)).toEqual(
        expect.arrayContaining([GOOD, "increase(y[5m])"]),
      );
    });

    // The slice width sets the step AND the slice a sample is attributed to, so
    // a stale one shifts every bar by a whole slice as well as sampling wrong.
    it("re-evaluates when the slice interval changes", async () => {
      wrapper = await createWrapper();
      rangeQuery.mockClear();

      await wrapper.setProps({ sliceIntervalSecs: 60 });
      vi.advanceTimersByTime(500);
      await settle();

      expect(requests()).toHaveLength(2);
      expect(requests()[0].step).toBe("60");
    });

    it("stops evaluating when the language goes back to SQL", async () => {
      wrapper = await createWrapper({ stream: "default", goodExpr: "code < 500" });
      rangeQuery.mockClear();

      await wrapper.setProps({ queryLanguage: "sql", streamType: "logs" });
      vi.advanceTimersByTime(500);
      await settle();

      expect(rangeQuery).not.toHaveBeenCalled();
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(2);
    });

    it("abandons the evaluations it supersedes", async () => {
      // An abandoned query holds a slot in the server's work-group queue until
      // it completes, so a superseded preview has to abort rather than just
      // drop the result.
      wrapper = await createWrapper();
      const abandoned = rangeQuery.mock.calls.map((c) => (c[0] as { signal: AbortSignal }).signal);

      await wrapper.setProps({ good: "increase(x[5m])" });
      vi.advanceTimersByTime(500);
      await settle();

      expect(abandoned.map((s) => s.aborted)).toEqual([true, true]);
    });

    it("drops a pending rebuild on unmount", async () => {
      wrapper = await createWrapper();
      await wrapper.setProps({ good: "increase(x[5m])" });
      expect(vi.getTimerCount()).toBeGreaterThan(0); // the debounce is armed

      wrapper.unmount();
      wrapper = null;

      // Cleared, not merely harmless: a surviving timer re-evaluates against a
      // torn-down component, and Vue does not throw on that.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("abandons the evaluations still in flight on unmount", async () => {
      let land: (value: unknown) => void = () => {};
      rangeQuery.mockReturnValue(
        new Promise((resolve) => {
          land = resolve;
        }) as never,
      );
      wrapper = await createWrapper();
      const inFlight = requests().map((r) => r.signal);

      wrapper.unmount();
      wrapper = null;
      land({ data: { data: { resultType: "matrix", result: [] } } });
      await settle();

      expect(inFlight.map((s) => s.aborted)).toEqual([true, true]);
    });
  });
});
