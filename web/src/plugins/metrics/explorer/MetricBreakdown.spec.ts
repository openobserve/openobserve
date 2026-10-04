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

import MetricBreakdown from "./MetricBreakdown.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { CARD_KIND } from "@/utils/metrics/metricDefaults";

const { fieldValues } = vi.hoisted(() => ({ fieldValues: vi.fn() }));
vi.mock("@/services/stream", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, default: { ...actual.default, fieldValues } };
});

// The focused chart's echarts instance: the table reads series colours from it and highlights on it.
const { fakeChart, getInstanceByDom } = vi.hoisted(() => {
  const fakeChart = {
    dispatchAction: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isDisposed: vi.fn(() => false),
    getOption: vi.fn((): any => ({ series: [] })),
    getVisual: vi.fn((): any => undefined),
  };
  return { fakeChart, getInstanceByDom: vi.fn((): any => fakeChart) };
});
vi.mock("echarts/core", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getInstanceByDom,
}));

/** `n` values for one label, counts descending. */
const values = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ zo_sql_key: `${prefix}${i}`, zo_sql_num: 1000 - i }));

const HITS = [
  { field: "instance", values: values("pod-", 21) },
  { field: "method", values: values("m", 3) },
  { field: "route", values: values("/r", 6) },
  { field: "status", values: [{ zo_sql_key: "500", zo_sql_num: 40 }] },
];

const CARD: any = {
  name: "http_requests_total",
  cardKind: CARD_KIND.COUNTER_RATE,
  unit: "count-per-sec",
  labels: ["instance", "method", "route", "status", "le", "__name__"],
};

// 20 labels: `service_name` and `tenant_id` sort past the first 15, whose values are counted.
const WIDE_LABELS = [
  ...Array.from({ length: 18 }, (_, i) => `a${String(i).padStart(2, "0")}`),
  "service_name",
  "tenant_id",
];
const WIDE: any = { ...CARD, labels: WIDE_LABELS };

// Only the chart renderer is stubbed; every O2 component is real.
const MetricCardChartStub = {
  name: "MetricCardChart",
  props: {
    results: Array,
    queries: Array,
    chartType: String,
    unit: String,
    unitCustom: String,
    color: String,
    timeRange: Object,
    legend: Boolean,
  },
  template: `<div data-test="breakdown-chart-stub"><div data-test="chart-renderer" /></div>`,
};

const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };

/** A `sum by (method)` range response: one series per [value, points]. */
const byMethod = (...series: [string, [number, string | null][]][]) => ({
  resultType: "matrix",
  result: series.map(([method, values]) => ({ metric: { method }, values })),
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

const runQuery = vi.fn();
/** The exprs whose request a chart has abandoned through its signal. */
const cancelled = () =>
  runQuery.mock.calls.filter(([, signal]) => signal?.aborted).map(([expr]) => expr);

const mountBreakdown = (props: Record<string, any> = {}) =>
  mount(MetricBreakdown, {
    props: {
      card: CARD,
      labelsByStream: {},
      filters: [],
      timeRange: { start_time: 1_000, end_time: 2_000 },
      selectedLabel: null,
      rateWindow: "4m",
      nanGuard: false,
      color: "#000",
      runQuery,
      ...props,
    },
    global: { plugins: [i18n, store], stubs: { MetricCardChart: MetricCardChartStub } },
  });

const lastRequest = () => fieldValues.mock.calls.at(-1)![0];
const lastSql = () => b64DecodeUnicode(lastRequest().query_context);
const exprs = () => runQuery.mock.calls.map(([expr]) => expr);
const cardLabels = (wrapper: VueWrapper<any>) =>
  wrapper
    .findAll('[data-test="metrics-breakdown-grid"] > [data-test]')
    .map((c) => c.attributes("data-test")!.replace("metrics-breakdown-card-", ""));

const echoFields = ({ fields }: any) =>
  Promise.resolve({
    data: { hits: fields.map((field: string) => ({ field, values: values(`${field}-`, 3) })) },
  });

describe("MetricBreakdown", () => {
  let wrapper: VueWrapper<any>;
  let io: ReturnType<typeof installFakeIntersectionObserver>;

  beforeEach(() => {
    vi.clearAllMocks();
    fieldValues.mockResolvedValue({ data: { hits: HITS } });
    runQuery.mockResolvedValue(SERIES);
    fakeChart.getOption.mockReturnValue({ series: [] });
    fakeChart.getVisual.mockReturnValue(undefined);
    io = installFakeIntersectionObserver({ autoVisible: true });
  });

  afterEach(() => {
    wrapper?.unmount();
    io.restore();
  });

  describe("value counts", () => {
    it("asks the values endpoint once, for the eligible labels of the stream the query reads", async () => {
      wrapper = mountBreakdown();
      await flushPromises();

      expect(fieldValues).toHaveBeenCalledTimes(1);
      const req = lastRequest();
      expect(req.stream_name).toBe("http_requests_total");
      // le and internal labels excluded, alphabetical.
      expect(req.fields).toEqual(["instance", "method", "route", "status"]);
      expect(req.type).toBe("metrics");
      expect(req.size).toBe(21);
      expect(req.no_count).toBeFalsy();
      expect(req.start_time).toBe(1_000);
      expect(req.end_time).toBe(2_000);
    });

    it("reads a histogram's _bucket stream and an exponential fallback's _count stream", async () => {
      wrapper = mountBreakdown({
        card: { ...CARD, name: "lat_bucket", cardKind: CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS },
      });
      await flushPromises();
      expect(lastRequest().stream_name).toBe("lat_bucket");
      wrapper.unmount();

      wrapper = mountBreakdown({
        card: { ...CARD, name: "size_bucket", cardKind: CARD_KIND.EXP_HISTOGRAM_FALLBACK },
      });
      await flushPromises();
      expect(lastRequest().stream_name).toBe("size_count");
    });

    it("offers an exponential fallback the labels of the _count stream it measures", async () => {
      wrapper = mountBreakdown({
        card: {
          ...CARD,
          name: "size_bucket",
          cardKind: CARD_KIND.EXP_HISTOGRAM_FALLBACK,
          labels: ["a", "b", "le"],
        },
        labelsByStream: { size_bucket: ["a", "b", "le"], size_count: ["b", "c"] },
      });
      await flushPromises();
      expect(lastRequest().stream_name).toBe("size_count");
      expect(lastRequest().fields).toEqual(["b", "c"]);
    });

    it("offers a mean pair only the labels both operands carry", async () => {
      wrapper = mountBreakdown({
        card: { ...CARD, name: "lat_sum", cardKind: CARD_KIND.MEAN_PAIR, labels: ["a", "b"] },
        labelsByStream: { lat_count: ["b", "c"] },
      });
      await flushPromises();
      expect(lastRequest().stream_name).toBe("lat_sum");
      expect(lastRequest().fields).toEqual(["b"]);
    });

    it("scopes the counts to the active filters with a full SQL statement", async () => {
      wrapper = mountBreakdown({ filters: [{ label: "status", operator: "=", value: "500" }] });
      await flushPromises();
      expect(lastSql()).toBe(`SELECT * FROM "http_requests_total" WHERE "status" = '500'`);
    });

    it("re-queries when the filters change, so the counts follow the chips", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      expect(lastSql()).toBe(`SELECT * FROM "http_requests_total"`);

      await wrapper.setProps({ filters: [{ label: "status", operator: "=", value: "500" }] });
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(2);
      expect(lastSql()).toContain(`"status" = '500'`);
    });

    it("counts only the first 15 labels, in one request, even with every label on screen", async () => {
      fieldValues.mockImplementation(echoFields);
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      expect(fieldValues.mock.calls.map(([req]) => req.fields)).toEqual([WIDE_LABELS.slice(0, 15)]);
    });

    it("says when the counts failed, and retries them", async () => {
      fieldValues.mockRejectedValueOnce(new Error("values unavailable"));
      wrapper = mountBreakdown();
      await flushPromises();
      const notice = wrapper.find('[data-test="metrics-breakdown-counts-error"]');
      expect(notice.text()).toContain("values unavailable");

      await notice.find('[data-test="metrics-breakdown-counts-retry"]').trigger("click");
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="metrics-breakdown-counts-error"]').exists()).toBe(false);
    });
  });

  describe("grid of label charts", () => {
    it("renders one card per label, every label rather than the first 15", async () => {
      fieldValues.mockImplementation(echoFields);
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      expect(cardLabels(wrapper)).toEqual(WIDE_LABELS);
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').exists()).toBe(false);
    });

    it("lays the cards out three across, two on a tablet, one on a phone", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      const grid = wrapper.find('[data-test="metrics-breakdown-grid"]');
      expect(grid.classes()).toEqual(
        expect.arrayContaining(["grid", "grid-cols-3", "max-lg:grid-cols-2", "max-md:grid-cols-1"]),
      );
    });

    it("heads each card with its label and distinct-value count, 20+ at the cap", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-card-instance"]').text()).toContain(
        "instance",
      );
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-instance"]').text()).toBe(
        "20+ values",
      );
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-method"]').text()).toBe(
        "3 values",
      );
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-status"]').text()).toBe(
        "1 value",
      );
    });

    it("leaves a label past the count cap without a count", async () => {
      fieldValues.mockImplementation(echoFields);
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-a00"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-tenant_id"]').exists()).toBe(
        false,
      );
    });

    it("charts the metric by each label, topk(10) for a 20+ label", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      expect(exprs()).toEqual([
        'topk(10, sum by (instance) (rate({__name__="http_requests_total"}[4m])))',
        'sum by (method) (rate({__name__="http_requests_total"}[4m]))',
        'sum by (route) (rate({__name__="http_requests_total"}[4m]))',
        'sum by (status) (rate({__name__="http_requests_total"}[4m]))',
      ]);
      expect(wrapper.find('[data-test="metrics-breakdown-topk-instance"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-breakdown-topk-method"]').exists()).toBe(false);
    });

    it("waits for the counts before charting a counted label: only they know whether to cap", async () => {
      fieldValues.mockImplementation(() => new Promise(() => {}));
      wrapper = mountBreakdown();
      await flushPromises();
      expect(runQuery).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="metrics-breakdown-card-method-loading"]').exists()).toBe(
        true,
      );
    });

    it("caps a label of unknown cardinality: past the count cap, or when counts failed", async () => {
      fieldValues.mockImplementation(echoFields);
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      expect(exprs()).toContain(
        'topk(10, sum by (tenant_id) (rate({__name__="http_requests_total"}[4m])))',
      );
      expect(exprs()).toContain('sum by (a00) (rate({__name__="http_requests_total"}[4m]))');
      wrapper.unmount();

      runQuery.mockClear();
      fieldValues.mockRejectedValue(new Error("values unavailable"));
      wrapper = mountBreakdown();
      await flushPromises();
      expect(exprs()).toContain(
        'topk(10, sum by (method) (rate({__name__="http_requests_total"}[4m])))',
      );
    });

    it("offers no filter actions on the grid: those live on a selected label", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      expect(wrapper.find('[data-test^="metrics-breakdown-add-"]').exists()).toBe(false);
    });

    it("says so when the metric has no labels to break down by", async () => {
      wrapper = mountBreakdown({ card: { ...CARD, labels: ["le", "__name__"] } });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-no-labels"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-breakdown-grid"]').exists()).toBe(false);
    });

    it("selects a label from its Select action or its header, never from its chart", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      await wrapper.find('[data-test="metrics-breakdown-select-route"]').trigger("click");
      await wrapper.find('[data-test="metrics-breakdown-distinct-method"]').trigger("click");
      // The mouseup ending a drag-to-zoom on the chart arrives as a click.
      await wrapper
        .find('[data-test="metrics-breakdown-card-status"] [data-test="breakdown-chart-stub"]')
        .trigger("click");
      expect(wrapper.emitted("update:selectedLabel")).toEqual([["route"], ["method"]]);
    });

    it("keeps the counts and charts up while a refresh re-counts the new window", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      let answer!: (value: any) => void;
      fieldValues.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

      await wrapper.setProps({ timeRange: { start_time: 1_000, end_time: 3_000 } });
      await flushPromises();
      expect(wrapper.findAll('[data-test="breakdown-chart-stub"]')).toHaveLength(4);
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-method"]').exists()).toBe(true);
      expect(runQuery).toHaveBeenCalledTimes(8);

      answer({ data: { hits: HITS } });
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(2);
      expect(runQuery).toHaveBeenCalledTimes(8);
      expect(wrapper.findAll('[data-test="breakdown-chart-stub"]')).toHaveLength(4);
    });
  });

  describe("lazy charts", () => {
    let lazy: ReturnType<typeof installFakeIntersectionObserver>;

    beforeEach(() => {
      lazy = installFakeIntersectionObserver();
    });

    afterEach(() => lazy.restore());

    it("charts a label only once its card scrolls into view", async () => {
      fieldValues.mockImplementation(echoFields);
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      expect(runQuery).not.toHaveBeenCalled();

      const card = wrapper.find('[data-test="metrics-breakdown-card-a03"]');
      lazy.setVisible(card.element, true);
      await flushPromises();
      expect(exprs()).toEqual(['sum by (a03) (rate({__name__="http_requests_total"}[4m]))']);
    });

    it("cancels the grid's unfinished charts when a label is selected", async () => {
      fieldValues.mockImplementation(echoFields);
      runQuery.mockImplementation(() => new Promise(() => {}));
      wrapper = mountBreakdown({ card: WIDE });
      await flushPromises();
      for (const label of ["a00", "a01"])
        lazy.setVisible(
          wrapper.find(`[data-test="metrics-breakdown-card-${label}"]`).element,
          true,
        );
      await flushPromises();

      await wrapper.setProps({ selectedLabel: "a05" });
      await flushPromises();
      expect(cancelled()).toEqual(
        expect.arrayContaining([
          'sum by (a00) (rate({__name__="http_requests_total"}[4m]))',
          'sum by (a01) (rate({__name__="http_requests_total"}[4m]))',
        ]),
      );
    });

    it("cancels the grid's unfinished charts when the view closes", async () => {
      runQuery.mockImplementation(() => new Promise(() => {}));
      wrapper = mountBreakdown();
      await flushPromises();
      lazy.setVisible(wrapper.find('[data-test="metrics-breakdown-card-method"]').element, true);
      await flushPromises();

      wrapper.unmount();
      expect(cancelled()).toEqual(['sum by (method) (rate({__name__="http_requests_total"}[4m]))']);
    });
  });

  describe("a selected label", () => {
    it("replaces the grid with its large chart, its values and a way back", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-grid"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-breakdown-values"]').exists()).toBe(true);

      await wrapper.find('[data-test="metrics-breakdown-back"]').trigger("click");
      expect(wrapper.emitted("update:selectedLabel")).toEqual([[null]]);
    });

    it("returns to the grid once the label is cleared", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      await wrapper.setProps({ selectedLabel: null });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-grid"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').exists()).toBe(false);
    });

    it("lists the label's values in a table, up to 20, without sample counts", async () => {
      wrapper = mountBreakdown({ selectedLabel: "instance" });
      await flushPromises();
      const list = wrapper.find('[data-test="metrics-breakdown-values"]');
      expect(list.find('[data-test="metrics-breakdown-table"]').exists()).toBe(true);
      expect(list.findAll('[data-test^="metrics-breakdown-value-instance-"]')).toHaveLength(20);
      expect(list.text()).not.toContain("samples");
      expect(list.find('[data-test="metrics-breakdown-distinct-instance"]').text()).toBe(
        "20+ values",
      );
    });

    it("adds a value to the filters, or excludes it", async () => {
      wrapper = mountBreakdown({ selectedLabel: "status" });
      await flushPromises();

      await wrapper.find('[data-test="metrics-breakdown-add-status-500"]').trigger("click");
      await wrapper.find('[data-test="metrics-breakdown-exclude-status-500"]').trigger("click");

      expect(wrapper.emitted("add-filter")).toEqual([
        [{ label: "status", operator: "=", value: "500" }],
        [{ label: "status", operator: "!=", value: "500" }],
      ]);
      expect(wrapper.emitted("update:selectedLabel")).toBeFalsy();
    });

    it("charts a label with few values without topk", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();

      expect(exprs()).toEqual(['sum by (method) (rate({__name__="http_requests_total"}[4m]))']);
      expect(wrapper.find('[data-test="metrics-breakdown-topk"]').exists()).toBe(false);
    });

    it("guards a 20+ label with topk(10) and says so", async () => {
      wrapper = mountBreakdown({ selectedLabel: "instance" });
      await flushPromises();

      expect(runQuery).toHaveBeenCalledWith(
        'topk(10, sum by (instance) (rate({__name__="http_requests_total"}[4m])))',
        expect.any(AbortSignal),
      );
      expect(wrapper.find('[data-test="metrics-breakdown-topk"]').text()).toContain("top 10");
    });

    it("caps a deep-linked label with topk(10) when its value counts failed to load", async () => {
      fieldValues.mockRejectedValue(new Error("values unavailable"));
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();

      expect(runQuery).toHaveBeenCalledWith(
        'topk(10, sum by (method) (rate({__name__="http_requests_total"}[4m])))',
        expect.any(AbortSignal),
      );
    });

    it("ignores a deep-linked label the breakdown does not offer, showing the grid", async () => {
      // `le` is never a breakdown label.
      wrapper = mountBreakdown({ selectedLabel: "le" });
      await flushPromises();

      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metrics-breakdown-grid"]').exists()).toBe(true);
      expect(exprs().some((e) => e.includes("by (le)"))).toBe(false);
    });

    it("renders exactly one chart", async () => {
      wrapper = mountBreakdown({ selectedLabel: "route" });
      await flushPromises();
      expect(wrapper.findAll('[data-test="breakdown-chart-stub"]')).toHaveLength(1);
    });

    it("cancels the previous chart query when another label is selected", async () => {
      runQuery.mockImplementationOnce(() => new Promise(() => {}));
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      const first = runQuery.mock.calls[0][0];

      await wrapper.setProps({ selectedLabel: "route" });
      await flushPromises();

      expect(cancelled()).toEqual([first]);
      expect(runQuery).toHaveBeenLastCalledWith(
        'sum by (route) (rate({__name__="http_requests_total"}[4m]))',
        expect.any(AbortSignal),
      );
    });

    it("cancels the chart query when the view closes", async () => {
      runQuery.mockImplementation(() => new Promise(() => {}));
      wrapper = mountBreakdown({ selectedLabel: "route" });
      await flushPromises();
      const expr = runQuery.mock.calls[0][0];

      wrapper.unmount();
      expect(cancelled()).toEqual([expr]);
    });

    it("never lands a superseded label's result", async () => {
      let resolveFirst!: (v: any) => void;
      runQuery.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();

      await wrapper.setProps({ selectedLabel: "route" });
      await flushPromises();
      resolveFirst({ result: [{ metric: { method: "GET" }, values: [[1, "1"]] }] });
      await flushPromises();

      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("queries")[0].expr).toContain("by (route)");
      expect(chart.props("results")).toEqual([SERIES]);
    });

    it("titles the chart with the measure it plots: p90 for a histogram, rate for a counter", async () => {
      wrapper = mountBreakdown({
        card: { ...CARD, name: "lat_bucket", cardKind: CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS },
        selectedLabel: "method",
      });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').text()).toContain(
        "p90 by method",
      );
      wrapper.unmount();

      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').text()).toContain(
        "Rate by method",
      );
    });

    it("charts the selected window with a legend, like the overview above it", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("timeRange")).toEqual({ start_time: 1_000, end_time: 2_000 });
      expect(chart.props("legend")).toBe(true);
    });

    it("queries once per window, not again when the card is rebuilt unchanged", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(1);
      expect(runQuery).toHaveBeenCalledTimes(1);

      // A refresh reloads the stream list first, rebuilding every card before the window moves.
      await wrapper.setProps({ card: { ...CARD }, labelsByStream: {}, filters: [] });
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(1);
      expect(runQuery).toHaveBeenCalledTimes(1);

      await wrapper.setProps({ timeRange: { start_time: 3_000, end_time: 4_000 } });
      await flushPromises();
      expect(fieldValues).toHaveBeenCalledTimes(2);
      expect(lastRequest().start_time).toBe(3_000);
      expect(runQuery).toHaveBeenCalledTimes(2);
    });

    describe("ranked values table", () => {
      const cell = (kind: string, value: string) =>
        wrapper.find(`[data-test="metrics-breakdown-${kind}-method-${value}"]`);
      const rankedValues = () =>
        wrapper
          .findAll('[data-test^="metrics-breakdown-value-method-"]')
          .map((c) => c.attributes("data-test")!.replace("metrics-breakdown-value-method-", ""));

      it("ranks the values by average, highest first, with chartless values last", async () => {
        runQuery.mockResolvedValue(
          byMethod(
            [
              "m0",
              [
                [1, "1"],
                [2, "1"],
              ],
            ],
            [
              "m1",
              [
                [1, "5"],
                [2, "5"],
              ],
            ],
          ),
        );
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();

        // m2 is counted by `_values` but has no series in the chart.
        expect(rankedValues()).toEqual(["m1", "m0", "m2"]);
        expect(cell("avg", "m2").text()).toBe("—");
        expect(cell("latest", "m2").text()).toBe("—");
        expect(cell("trend", "m2").find("polyline").exists()).toBe(false);
        expect(cell("trend", "m1").find("polyline").exists()).toBe(true);
      });

      it("averages and takes the latest over real points only, skipping null and NaN", async () => {
        runQuery.mockResolvedValue(
          byMethod([
            "m0",
            [
              [1, "2"],
              [2, "NaN"],
              [3, "4"],
              [4, null],
            ],
          ]),
        );
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();

        // Formatted like the chart's y-axis: the card's unit, the chart's decimals.
        expect(cell("avg", "m0").text()).toBe("3.00c/s");
        expect(cell("latest", "m0").text()).toBe("4.00c/s");
      });

      it("shows each value's share of the total for a counter", async () => {
        runQuery.mockResolvedValue(byMethod(["m0", [[1, "1"]]], ["m1", [[1, "3"]]]));
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();

        expect(wrapper.find('[data-test="metrics-breakdown-table"]').text()).toContain("Share");
        expect(cell("share", "m1").text()).toBe("75.0%");
        expect(cell("share", "m0").text()).toBe("25.0%");
        expect(cell("share", "m2").text()).toBe("—");
      });

      it("has no share column when the values do not add up: a gauge or a p90", async () => {
        runQuery.mockResolvedValue(byMethod(["m0", [[1, "1"]]], ["m1", [[1, "3"]]]));
        for (const cardKind of [CARD_KIND.GAUGE, CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS]) {
          wrapper = mountBreakdown({ card: { ...CARD, cardKind }, selectedLabel: "method" });
          await flushPromises();
          expect(cell("avg", "m1").exists()).toBe(true);
          expect(wrapper.find('[data-test^="metrics-breakdown-share-"]').exists()).toBe(false);
          expect(wrapper.find('[data-test="metrics-breakdown-table"]').text()).not.toContain(
            "Share",
          );
          wrapper.unmount();
        }
      });

      it("keeps add and exclude on a value without a series", async () => {
        runQuery.mockResolvedValue(byMethod(["m0", [[1, "1"]]]));
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();

        await wrapper.find('[data-test="metrics-breakdown-add-method-m2"]').trigger("click");
        await wrapper.find('[data-test="metrics-breakdown-exclude-method-m2"]').trigger("click");
        expect(wrapper.emitted("add-filter")).toEqual([
          [{ label: "method", operator: "=", value: "m2" }],
          [{ label: "method", operator: "!=", value: "m2" }],
        ]);
      });

      it("shows the rows with a loading state, never zeros, while the chart loads", async () => {
        runQuery.mockImplementation(() => new Promise(() => {}));
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();

        expect(rankedValues()).toEqual(["m0", "m1", "m2"]);
        expect(
          wrapper.findAll('[data-test="metrics-breakdown-stat-loading"]').length,
        ).toBeGreaterThan(0);
        expect(cell("avg", "m0").text()).not.toMatch(/\d/);
      });

      it("draws each trend in its series' chart colour and highlights the series on hover", async () => {
        runQuery.mockResolvedValue(byMethod(["m0", [[1, "1"]]], ["m1", [[1, "3"]]]));
        fakeChart.getOption.mockReturnValue({ series: [{ name: "m1" }, { name: "m0" }] });
        fakeChart.getVisual.mockImplementation(({ seriesName }: any) =>
          seriesName === "m1" ? "#111111" : "#222222",
        );
        wrapper = mountBreakdown({ selectedLabel: "method" });
        await flushPromises();
        await nextFrame();
        await flushPromises();

        expect(cell("trend", "m1").find("polyline").attributes("stroke")).toBe("#111111");
        expect(cell("trend", "m0").find("polyline").attributes("stroke")).toBe("#222222");

        const row = cell("value", "m1").element.closest("tr")!;
        row.dispatchEvent(new MouseEvent("mouseenter"));
        row.dispatchEvent(new MouseEvent("mouseleave"));
        expect(fakeChart.dispatchAction.mock.calls).toEqual([
          [{ type: "highlight", seriesName: "m1" }],
          [{ type: "downplay", seriesName: "m1" }],
        ]);
      });
    });

    describe("past the value-count cap", () => {
      it("asks for its values alone, never re-scanning the first 15", async () => {
        fieldValues.mockImplementation(echoFields);
        wrapper = mountBreakdown({ card: WIDE });
        await flushPromises();
        expect(fieldValues).toHaveBeenCalledTimes(1);
        runQuery.mockClear();

        await wrapper.setProps({ selectedLabel: "tenant_id" });
        await flushPromises();
        expect(fieldValues).toHaveBeenCalledTimes(2);
        expect(lastRequest().fields).toEqual(["tenant_id"]);
        expect(exprs()).toEqual([
          'sum by (tenant_id) (rate({__name__="http_requests_total"}[4m]))',
        ]);
        expect(
          wrapper.find('[data-test="metrics-breakdown-value-tenant_id-tenant_id-0"]').exists(),
        ).toBe(true);

        await wrapper.setProps({ selectedLabel: "a03" });
        await flushPromises();
        expect(fieldValues).toHaveBeenCalledTimes(2);
        expect(runQuery).toHaveBeenLastCalledWith(
          'sum by (a03) (rate({__name__="http_requests_total"}[4m]))',
          expect.any(AbortSignal),
        );
      });

      it("caps a 20+ label from its own counts, without waiting for the first 15", async () => {
        fieldValues.mockImplementation(({ fields }: any) =>
          fields.length === 1
            ? Promise.resolve({ data: { hits: [{ field: "tenant_id", values: values("t", 21) }] } })
            : new Promise(() => {}),
        );
        wrapper = mountBreakdown({ card: WIDE, selectedLabel: "tenant_id" });
        await flushPromises();

        expect(exprs()).toEqual([
          'topk(10, sum by (tenant_id) (rate({__name__="http_requests_total"}[4m])))',
        ]);
      });

      it("shows its failed count and retries it alone", async () => {
        fieldValues.mockImplementation((req: any) =>
          req.fields.length === 1
            ? Promise.reject(new Error("tenant values unavailable"))
            : echoFields(req),
        );
        wrapper = mountBreakdown({ card: WIDE, selectedLabel: "tenant_id" });
        await flushPromises();

        const error = wrapper.find('[data-test="metrics-breakdown-values-error"]');
        expect(error.text()).toContain("tenant values unavailable");

        fieldValues.mockImplementation(echoFields);
        await error.find('[data-test="metrics-breakdown-values-retry"]').trigger("click");
        await flushPromises();

        expect(fieldValues.mock.calls.map(([req]) => req.fields).slice(1)).toEqual([
          ["tenant_id"],
          ["tenant_id"],
        ]);
        expect(
          wrapper.find('[data-test="metrics-breakdown-value-tenant_id-tenant_id-0"]').exists(),
        ).toBe(true);
        expect(wrapper.find('[data-test="metrics-breakdown-values-error"]').exists()).toBe(false);
      });
    });
  });
});
