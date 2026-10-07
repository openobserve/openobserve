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

import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MetricChartTile from "./MetricChartTile.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { PreviewCancelledError } from "@/composables/metrics/useMetricsPreviewQueue";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

const MetricCardChartStub = {
  name: "MetricCardChart",
  props: [
    "results",
    "queries",
    "chartType",
    "unit",
    "color",
    "timeRange",
    "legend",
    "allowAlertCreation",
    "shifted",
    "stepSeconds",
    "forecast",
  ],
  template: `<div data-test="tile-chart-stub" />`,
};

const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };
const EMPTY = { resultType: "matrix", result: [] };
const QUERIES = [{ expr: "sum(rate(x[4m]))" }];

const runQuery = vi.fn();
/** The exprs whose request the tile has abandoned through its signal. */
const cancelled = () =>
  runQuery.mock.calls.filter(([, signal]) => signal?.aborted).map(([expr]) => expr);

const mountTile = (props: Record<string, any> = {}) =>
  mount(MetricChartTile, {
    props: {
      queries: QUERIES,
      color: "#000",
      timeRange: { start_time: 1, end_time: 2 },
      runQuery,
      dataTest: "tile",
      ...props,
    },
    slots: { header: "<span data-test='tile-header'>head</span>" },
    global: { plugins: [i18n, store], stubs: { MetricCardChart: MetricCardChartStub } },
  });

describe("MetricChartTile", () => {
  let wrapper: VueWrapper<any>;
  let shown: ReturnType<typeof installFakeIntersectionObserver>;

  beforeEach(() => {
    vi.clearAllMocks();
    runQuery.mockResolvedValue(SERIES);
    shown = installFakeIntersectionObserver({ autoVisible: true });
  });

  afterEach(() => {
    wrapper?.unmount();
    shown.restore();
  });

  it("renders its header and charts the result", async () => {
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-header"]').exists()).toBe(true);
    expect(runQuery).toHaveBeenCalledWith("sum(rate(x[4m]))", expect.any(AbortSignal));
    expect(wrapper.findComponent({ name: "MetricCardChart" }).props("results")).toEqual([SERIES]);
  });

  it("charts a comparison: each query again over the shifted window, as dashed twins", async () => {
    const DAY_MS = 86_400_000;
    wrapper = mountTile({
      timeRange: { start_time: 5_000_000_000, end_time: 6_000_000_000 },
      compare: { gapMs: DAY_MS, periodAsStr: "1 day ago" },
      stepSeconds: 15,
    });
    await flushPromises();

    expect(runQuery.mock.calls.map(([expr, , opts]) => [expr, opts?.window])).toEqual([
      ["sum(rate(x[4m]))", undefined],
      [
        "sum(rate(x[4m]))",
        { start: 5_000_000_000 - DAY_MS * 1000, end: 6_000_000_000 - DAY_MS * 1000 },
      ],
    ]);
    const chart = wrapper.findComponent({ name: "MetricCardChart" });
    expect(chart.props("results")).toEqual([SERIES]);
    expect(chart.props("stepSeconds")).toBe(15);
    expect(chart.props("shifted")).toEqual([
      { result: SERIES, gapMs: DAY_MS, periodAsStr: "1 day ago", parentIndex: 0 },
    ]);
  });

  it("keeps the drawn chart's own step through a refresh, until the new results land", async () => {
    wrapper = mountTile({ stepSeconds: 15 });
    await flushPromises();
    let answer!: (value: any) => void;
    runQuery.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    await wrapper.setProps({ timeRange: { start_time: 0, end_time: 2 }, stepSeconds: 60 });
    await flushPromises();
    const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
    expect(chart().props("stepSeconds")).toBe(15);

    answer(SERIES);
    await flushPromises();
    expect(chart().props("stepSeconds")).toBe(60);
  });

  it("charts the earlier period when only it has samples", async () => {
    runQuery.mockImplementation((_expr: string, _signal: AbortSignal, opts: any) =>
      Promise.resolve(opts?.window ? SERIES : EMPTY),
    );
    wrapper = mountTile({ compare: { gapMs: 3_600_000, periodAsStr: "1 hour ago" } });
    await flushPromises();
    expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(true);
  });

  it("reloads when the comparison changes", async () => {
    wrapper = mountTile();
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ compare: { gapMs: 3_600_000, periodAsStr: "1 hour ago" } });
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  it("offers the chart's right-click alert only when asked to", async () => {
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.findComponent({ name: "MetricCardChart" }).props("allowAlertCreation")).toBe(
      false,
    );
    wrapper.unmount();

    wrapper = mountTile({ allowAlertCreation: true });
    await flushPromises();
    expect(wrapper.findComponent({ name: "MetricCardChart" }).props("allowAlertCreation")).toBe(
      true,
    );
  });

  it("shows a skeleton while the query is not yet known, and runs nothing", async () => {
    wrapper = mountTile({ queries: null });
    await flushPromises();
    expect(runQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="tile-loading"]').exists()).toBe(true);
  });

  it("says no data when the query returns no samples", async () => {
    runQuery.mockResolvedValue(EMPTY);
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-nodata"]').exists()).toBe(true);
  });

  it("says so when the metric has no chartable query", async () => {
    wrapper = mountTile({ queries: [] });
    await flushPromises();
    expect(runQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="tile-nopreview"]').exists()).toBe(true);
  });

  it("shows a failed query with a retry that re-runs it", async () => {
    runQuery.mockRejectedValueOnce(new Error("boom"));
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-error"]').exists()).toBe(true);

    await wrapper.find('[data-test="tile-retry"]').trigger("click");
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="tile-chart-stub"]').exists()).toBe(true);
  });

  it("treats a cancelled query as no error, and asks again while on screen", async () => {
    runQuery.mockRejectedValueOnce(new PreviewCancelledError("k"));
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-error"]').exists()).toBe(false);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="tile-chart-stub"]').exists()).toBe(true);
  });

  it("selects from its header, never from a click on the chart", async () => {
    wrapper = mountTile();
    await flushPromises();
    // The mouseup ending a drag-to-zoom on the chart arrives as a click.
    await wrapper.find('[data-test="tile-chart-stub"]').trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();

    await wrapper.find('[data-test="tile-header"]').trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("keeps its chart through a refresh and swaps in the new result", async () => {
    const NEXT = { resultType: "matrix", result: [{ metric: {}, values: [[2, "2"]] }] };
    wrapper = mountTile();
    await flushPromises();
    let answer!: (value: any) => void;
    runQuery.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    await wrapper.setProps({ timeRange: { start_time: 1, end_time: 3 } });
    await flushPromises();
    const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
    expect(chart().props("results")).toEqual([SERIES]);
    expect(wrapper.find('[data-test="tile-refreshing"]').exists()).toBe(true);

    // The kept samples stay on the axis they were queried for.
    expect(chart().props("timeRange")).toEqual({ start_time: 1, end_time: 2 });

    answer(NEXT);
    await flushPromises();
    expect(chart().props("results")).toEqual([NEXT]);
    expect(chart().props("timeRange")).toEqual({ start_time: 1, end_time: 3 });
    expect(wrapper.find('[data-test="tile-refreshing"]').exists()).toBe(false);
  });

  it("never lands a superseded refresh", async () => {
    const OLD = { resultType: "matrix", result: [{ metric: { v: "old" }, values: [[2, "2"]] }] };
    const NEW = { resultType: "matrix", result: [{ metric: { v: "new" }, values: [[3, "3"]] }] };
    wrapper = mountTile();
    await flushPromises();
    const answers: ((value: any) => void)[] = [];
    runQuery.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    await wrapper.setProps({ timeRange: { start_time: 1, end_time: 3 } });
    await flushPromises();
    await wrapper.setProps({ timeRange: { start_time: 1, end_time: 4 } });
    await flushPromises();
    answers[1](NEW);
    await flushPromises();
    answers[0](OLD);
    await flushPromises();
    expect(wrapper.findComponent({ name: "MetricCardChart" }).props("results")).toEqual([NEW]);
  });

  it("cancels the old query and runs the new one when the query changes", async () => {
    runQuery.mockImplementation(() => new Promise(() => {}));
    wrapper = mountTile();
    await flushPromises();
    await wrapper.setProps({ queries: [{ expr: "y" }] });
    await flushPromises();
    expect(cancelled()).toEqual(["sum(rate(x[4m]))"]);
    expect(runQuery).toHaveBeenLastCalledWith("y", expect.any(AbortSignal));
  });

  it("re-queries when the window moves", async () => {
    wrapper = mountTile();
    await flushPromises();
    await wrapper.setProps({ timeRange: { start_time: 3, end_time: 4 } });
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("cancels its query when it unmounts", async () => {
    runQuery.mockImplementation(() => new Promise(() => {}));
    wrapper = mountTile();
    await flushPromises();
    wrapper.unmount();
    expect(cancelled()).toEqual(["sum(rate(x[4m]))"]);
  });

  describe("forecast", () => {
    const WINDOW = { start_time: 1_000_000_000, end_time: 4_600_000_000 };
    const T_S = WINDOW.end_time / 1e6;
    const LINEAR = { method: "linear", horizon: 900, label: "forecast" };
    const fit = (expr: string) => ({
      resultType: "vector",
      result: [{ metric: {}, value: [T_S, expr.endsWith(", 0)") ? "1" : "2"] }],
    });
    const isFit = (opts: any) => opts?.instantAt !== undefined;
    const fitCalls = () => runQuery.mock.calls.filter(([, , opts]) => isFit(opts));
    const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
    const mountForecast = (props: Record<string, any> = {}) =>
      mountTile({ timeRange: WINDOW, stepSeconds: 60, forecast: LINEAR, ...props });

    beforeEach(() => {
      runQuery.mockImplementation((expr: string, _signal: AbortSignal, opts: any) =>
        Promise.resolve(isFit(opts) ? fit(expr) : SERIES),
      );
    });

    it("fits each query at the range end, after its primaries, and draws the line between", async () => {
      wrapper = mountForecast();
      await flushPromises();

      expect(runQuery.mock.calls.map(([expr, , opts]) => [expr, opts?.instantAt])).toEqual([
        ["sum(rate(x[4m]))", undefined],
        ["predict_linear((sum(rate(x[4m])))[3600s:60s], 0)", WINDOW.end_time],
        ["predict_linear((sum(rate(x[4m])))[3600s:60s], 900)", WINDOW.end_time],
      ]);
      const forecast = chart().props("forecast");
      expect(forecast.until).toBe(WINDOW.end_time + 900e6);
      expect(forecast.label).toBe("forecast");
      expect(forecast.entries.map((entry: any) => entry.parentIndex)).toEqual([0]);
      const values = forecast.entries[0].result.result[0].values;
      expect(values[0]).toEqual([T_S, "1"]);
      expect(values.at(-1)).toEqual([T_S + 900, "2"]);
    });

    it("runs no fits without a forecast", async () => {
      wrapper = mountTile({ timeRange: WINDOW, stepSeconds: 60 });
      await flushPromises();
      expect(fitCalls()).toEqual([]);
      expect(chart().props("forecast")).toBeNull();
    });

    it("draws the chart without a forecast when a fit fails", async () => {
      runQuery.mockImplementation((_expr: string, _signal: AbortSignal, opts: any) =>
        isFit(opts) ? Promise.reject(new Error("timeout")) : Promise.resolve(SERIES),
      );
      wrapper = mountForecast();
      await flushPromises();
      expect(chart().props("results")).toEqual([SERIES]);
      expect(chart().props("forecast")).toBeNull();
      expect(wrapper.find('[data-test="tile-error"]').exists()).toBe(false);
    });

    it("draws the chart without waiting for the fits, and adds the forecast when they land", async () => {
      const fits: Array<() => void> = [];
      runQuery.mockImplementation((expr: string, _signal: AbortSignal, opts: any) =>
        isFit(opts)
          ? new Promise((resolve) => fits.push(() => resolve(fit(expr))))
          : Promise.resolve(SERIES),
      );
      wrapper = mountForecast();
      await flushPromises();
      expect(chart().props("results")).toEqual([SERIES]);
      expect(chart().props("forecast")).toBeNull();

      fits.forEach((answer) => answer());
      await flushPromises();
      expect(chart().props("forecast").entries).toHaveLength(1);
    });

    it("never pairs the previous forecast with a new window", async () => {
      wrapper = mountForecast();
      await flushPromises();
      expect(chart().props("forecast")).not.toBeNull();
      runQuery.mockImplementation((_expr: string, _signal: AbortSignal, opts: any) =>
        isFit(opts) ? new Promise(() => {}) : Promise.resolve(SERIES),
      );

      await wrapper.setProps({
        timeRange: { start_time: WINDOW.start_time, end_time: WINDOW.end_time + 60e6 },
      });
      await flushPromises();
      expect(chart().props("timeRange").end_time).toBe(WINDOW.end_time + 60e6);
      expect(chart().props("forecast")).toBeNull();
    });

    it("keeps the drawn chart and fits again when the method changes", async () => {
      wrapper = mountForecast();
      await flushPromises();
      runQuery.mockClear();
      runQuery.mockImplementation(() => new Promise(() => {}));

      await wrapper.setProps({ forecast: { ...LINEAR, method: "smoothed" } });
      await flushPromises();
      expect(chart().exists()).toBe(true);
      expect(fitCalls().map(([expr]) => expr)[1]).toBe(
        "predict_linear(holt_winters((sum(rate(x[4m])))[600s:60s], 0.3, 0.1)[3600s:60s], 900)",
      );
    });

    it("on a switch to another label, drops the first label's fits and never draws them", async () => {
      const A = "avg by (method) (x)";
      const B = "avg by (route) (x)";
      const fits: Array<{ expr: string; signal: AbortSignal; answer: () => void }> = [];
      runQuery.mockImplementation((expr: string, signal: AbortSignal, opts: any) =>
        isFit(opts)
          ? new Promise((resolve) => fits.push({ expr, signal, answer: () => resolve(fit(expr)) }))
          : Promise.resolve(SERIES),
      );
      wrapper = mountForecast({ queries: [{ expr: A }] });
      await flushPromises();
      const fitsOf = (expr: string) => fits.filter((call) => call.expr.includes(expr));
      expect(fitsOf(A)).toHaveLength(2);

      await wrapper.setProps({ queries: [{ expr: B }] });
      await flushPromises();
      expect(fitsOf(A).map((call) => call.signal.aborted)).toEqual([true, true]);
      expect(fitsOf(B)).toHaveLength(2);

      fitsOf(A).forEach((call) => call.answer());
      await flushPromises();
      expect(chart().props("queries")).toEqual([{ expr: B }]);
      expect(chart().props("forecast")).toBeNull();

      fitsOf(B).forEach((call) => call.answer());
      await flushPromises();
      expect(chart().props("forecast").entries).toHaveLength(1);
    });

    it("drops the drawn forecast at once when the forecast is switched off", async () => {
      wrapper = mountForecast();
      await flushPromises();
      expect(chart().props("forecast")).not.toBeNull();
      runQuery.mockImplementation(() => new Promise(() => {}));

      await wrapper.setProps({ forecast: null });
      await flushPromises();
      expect(chart().props("results")).toEqual([SERIES]);
      expect(chart().props("forecast")).toBeNull();
    });

    it("cancels its fits when it unmounts", async () => {
      runQuery.mockImplementation((_expr: string, _signal: AbortSignal, opts: any) =>
        isFit(opts) ? new Promise(() => {}) : Promise.resolve(SERIES),
      );
      wrapper = mountForecast();
      await flushPromises();
      wrapper.unmount();
      expect(fitCalls().map(([, signal]) => signal.aborted)).toEqual([true, true]);
    });
  });

  describe("lazy loading", () => {
    let io: ReturnType<typeof installFakeIntersectionObserver>;

    beforeEach(() => {
      io = installFakeIntersectionObserver();
    });

    afterEach(() => io.restore());

    it("runs nothing until the tile scrolls into view", async () => {
      wrapper = mountTile();
      await flushPromises();
      expect(runQuery).not.toHaveBeenCalled();

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);
    });

    it("cancels an unfinished query when the tile scrolls away, and resumes on return", async () => {
      runQuery.mockImplementationOnce(() => new Promise(() => {}));
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();

      io.setVisible(wrapper.element, false);
      await flushPromises();
      expect(cancelled()).toEqual(["sum(rate(x[4m]))"]);

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="tile-chart-stub"]').exists()).toBe(true);
    });

    it("keeps a drawn chart when the tile scrolls away", async () => {
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();
      io.setVisible(wrapper.element, false);
      await flushPromises();
      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(cancelled()).toEqual([]);
    });

    it("defers a window change on an off-screen tile until it is seen", async () => {
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();
      io.setVisible(wrapper.element, false);
      await wrapper.setProps({ timeRange: { start_time: 3, end_time: 4 } });
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("results emit", () => {
    it("reports idle, then loading, then done with the fetched results", async () => {
      let answer!: (value: any) => void;
      runQuery.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      wrapper = mountTile();
      await flushPromises();
      answer(SERIES);
      await flushPromises();

      expect(wrapper.emitted("results")).toEqual([
        [{ status: "idle", results: [], periodEmpty: false }],
        [{ status: "loading", results: [], periodEmpty: false }],
        [{ status: "done", results: [SERIES], periodEmpty: false }],
      ]);
    });

    it("reports an empty compared period once its result lands", async () => {
      runQuery.mockImplementation((_e: string, _s: AbortSignal, opts: any) =>
        Promise.resolve(opts?.window ? EMPTY : SERIES),
      );
      wrapper = mountTile({ compare: { gapMs: 3_600_000, periodAsStr: "1 hour ago" } });
      await flushPromises();
      expect(wrapper.emitted("results")!.at(-1)).toEqual([
        { status: "done", results: [SERIES], periodEmpty: true },
      ]);
    });

    it("reports an error with no results when the query fails", async () => {
      runQuery.mockRejectedValueOnce(new Error("boom"));
      wrapper = mountTile();
      await flushPromises();

      expect(wrapper.emitted("results")).toEqual([
        [{ status: "idle", results: [], periodEmpty: false }],
        [{ status: "loading", results: [], periodEmpty: false }],
        [{ status: "error", results: [], periodEmpty: false }],
      ]);
    });
  });
});
