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

import MetricDetailView from "./MetricDetailView.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { CARD_KIND, baseNameOf } from "@/utils/metrics/metricDefaults";
import { MISC_GROUP_ID } from "@/utils/metrics/prefixGrouping";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";
import { PreviewCancelledError } from "@/composables/metrics/useMetricsPreviewQueue";
import config from "@/aws-exports";

const drilldownApi = vi.hoisted(() => ({
  getIdentityConfig: vi.fn(),
  getSemanticGroups: vi.fn(),
  correlate: vi.fn(),
}));
vi.mock("@/services/service_streams", () => ({ default: drilldownApi }));

const { getMetricUsage } = vi.hoisted(() => ({ getMetricUsage: vi.fn() }));
vi.mock("@/services/metrics", () => ({ default: { getMetricUsage } }));

const USAGE = {
  dashboards: [{ id: "d1", title: "Board", folder_id: "f1" }],
  alerts: [{ id: "a1", name: "Alert", folder_id: "f2" }],
  slos: [],
  pipelines: [{ id: "p1", name: "Pipe", match: "text" }],
  unparsed: 1,
};
const { openAlertCreation } = vi.hoisted(() => ({ openAlertCreation: vi.fn(() => true) }));
vi.mock("@/composables/alerts/useAlertCreation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/alerts/useAlertCreation")>()),
  useAlertCreation: () => ({ openAlertCreation }),
}));

const card = (name: string, over: Record<string, any> = {}): any => ({
  name,
  familyName: baseNameOf(name),
  cardKind: CARD_KIND.COUNTER_RATE,
  typeFilterBucket: "counter",
  unit: "count-per-sec",
  help: "",
  labels: ["job", "route"],
  ...over,
});

const SELECTED = card("http_server_request_duration_seconds_bucket", {
  cardKind: CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS,
  typeFilterBucket: "histogram",
  unit: "seconds",
});
const ALL = [
  SELECTED,
  card("http_server_request_duration_seconds_sum"),
  card("http_server_request_duration_seconds_count"),
  card("http_server_active_requests", { cardKind: CARD_KIND.GAUGE, typeFilterBucket: "gauge" }),
  ...Array.from({ length: 14 }, (_, i) => card(`http_server_extra_${i}_total`)),
  card("node_load1", { cardKind: CARD_KIND.GAUGE }),
];

const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };

const OPageHeaderStub = {
  name: "OPageHeader",
  props: ["title", "subtitle", "back"],
  template: `
    <header>
      <button data-test="detail-back" @click="back.onClick()" />
      <h1>{{ title }}</h1>
      <slot name="title-trail" />
      <slot name="actions" />
    </header>
  `,
};

const runQuery = vi.fn();
/** The exprs whose request the view has abandoned through its signal. */
const cancelled = () =>
  runQuery.mock.calls.filter(([, signal]) => signal?.aborted).map(([expr]) => expr);

/** The grid's default query for a metric, as the explorer resolves it. */
const chartOf = (c: any) => ({
  queries: [{ expr: `rate(${c.name}[4m])` }],
  chartType: "line",
  unit: c.unit,
  bucketUnit: null,
});

const mountView = (
  props: Record<string, any> = {},
  { realHeader = false, stubs = {} as Record<string, any> } = {},
) =>
  mount(MetricDetailView, {
    props: {
      card: SELECTED,
      metricName: SELECTED.name,
      loading: false,
      tab: null,
      breakdownLabel: null,
      overview: {
        queries: [{ expr: "sum by (le) (rate(x[4m]))", legendTemplate: "{le}" }],
        chartType: "heatmap",
        unit: "count-per-sec",
        bucketUnit: "seconds",
      },
      isFavorite: false,
      allCards: ALL,
      labelsByStream: {},
      prefixOf: (name: string) => (name.startsWith("http_server") ? "http_server" : MISC_GROUP_ID),
      familyOf: (name: string) => baseNameOf(name),
      filters: [],
      timeRange: { start_time: 1, end_time: 2 },
      rateWindow: "4m",
      panelRateWindow: "$__rate_interval",
      nanGuard: false,
      color: "#000",
      runQuery,
      chartOf,
      colorOf: () => "#000",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ...(realHeader ? {} : { OPageHeader: OPageHeaderStub }),
        ...stubs,
        MetricBreakdown: {
          name: "MetricBreakdown",
          props: ["variant", "panelQueries", "runQuery", "compare", "stepSeconds", "forecast"],
          template: "<div data-test='breakdown-stub' />",
        },
        MetricCardChart: {
          name: "MetricCardChart",
          props: [
            "results",
            "queries",
            "color",
            "chartType",
            "unit",
            "timeRange",
            "injectedExemplars",
            "allowAlertCreation",
            "shifted",
            "stepSeconds",
            "forecast",
          ],
          template: "<div />",
        },
      },
    },
  });

const tabNames = (wrapper: VueWrapper<any>) =>
  wrapper.findAllComponents({ name: "OTab" }).map((tab) => tab.props("name"));

describe("MetricDetailView", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    runQuery.mockResolvedValue(SERIES);
    getMetricUsage.mockResolvedValue({ data: USAGE });
  });

  afterEach(() => wrapper?.unmount());

  it("shows a loading state until the schemas are in", () => {
    wrapper = mountView({ loading: true });
    expect(wrapper.find('[data-test="metrics-detail-loading"]').exists()).toBe(true);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("says so when the metric in the URL does not exist", () => {
    wrapper = mountView({ card: null, metricName: "gone_total" });
    expect(wrapper.find('[data-test="metrics-detail-not-found"]').exists()).toBe(true);
  });

  describe("overview", () => {
    it("charts the card's current query, ⚙ override included, at full width", async () => {
      wrapper = mountView();
      await flushPromises();
      expect(runQuery).toHaveBeenCalledWith("sum by (le) (rate(x[4m]))", expect.any(AbortSignal));
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("results")).toEqual([SERIES]);
    });

    it("queries once per window, not again when the card is rebuilt unchanged", async () => {
      wrapper = mountView();
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);

      // A refresh reloads the stream list first, rebuilding every card before the window moves.
      await wrapper.setProps({
        card: { ...SELECTED },
        allCards: [...ALL],
        overview: {
          ...wrapper.props("overview"),
          queries: [{ expr: "sum by (le) (rate(x[4m]))" }],
        },
      });
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);

      // Refreshing an absolute window hands over an equal but new range: it still re-queries.
      await wrapper.setProps({ timeRange: { start_time: 1, end_time: 2 } });
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
    });

    it("asks again when something else cancels the overview query, and charts the answer", async () => {
      runQuery.mockRejectedValueOnce(new PreviewCancelledError("k"));
      wrapper = mountView();
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(wrapper.findComponent({ name: "MetricCardChart" }).props("results")).toEqual([SERIES]);
    });

    it("cancels the overview query when the view closes", async () => {
      runQuery.mockImplementation(() => new Promise(() => {}));
      wrapper = mountView();
      await flushPromises();
      wrapper.unmount();
      expect(cancelled()).toEqual(["sum by (le) (rate(x[4m]))"]);
    });

    it("keeps the overview chart through a refresh, on the range its samples were queried for", async () => {
      const NEXT = { resultType: "matrix", result: [{ metric: {}, values: [[2, "2"]] }] };
      wrapper = mountView();
      await flushPromises();
      let answer!: (value: any) => void;
      runQuery.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

      await wrapper.setProps({ timeRange: { start_time: 1, end_time: 3 } });
      await flushPromises();
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart().props("results")).toEqual([SERIES]);
      expect(chart().props("timeRange")).toEqual({ start_time: 1, end_time: 2 });

      answer(NEXT);
      await flushPromises();
      expect(chart().props("results")).toEqual([NEXT]);
      expect(chart().props("timeRange")).toEqual({ start_time: 1, end_time: 3 });
    });
  });

  describe("compare to", () => {
    const HOUR_US = 3_600_000_000;
    const DAY_US = 24 * HOUR_US;
    const WINDOW = { start_time: 10 * DAY_US, end_time: 10 * DAY_US + HOUR_US };
    const LINE = {
      queries: [{ expr: "sum(rate(x[4m]))" }, { expr: "max(rate(x[4m]))" }],
      chartType: "line",
      unit: "count-per-sec",
      bucketUnit: null,
    };
    const selectStub = {
      OSelect: {
        name: "OSelect",
        props: ["modelValue", "options"],
        emits: ["update:modelValue"],
        template: "<div v-bind='$attrs' />",
      },
    };
    const compareSelect = (wrapper: VueWrapper<any>) =>
      wrapper
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === "metrics-detail-compare");

    it("runs each expression once more over the shifted window and hands the twins to the chart", async () => {
      wrapper = mountView({ overview: LINE, timeRange: WINDOW, compare: "1d", stepSeconds: 30 });
      await flushPromises();

      const shiftedWindow = { start: WINDOW.start_time - DAY_US, end: WINDOW.end_time - DAY_US };
      expect(runQuery.mock.calls.map(([expr, , , opts]) => [expr, opts?.window])).toEqual([
        ["sum(rate(x[4m]))", undefined],
        ["max(rate(x[4m]))", undefined],
        ["sum(rate(x[4m]))", shiftedWindow],
        ["max(rate(x[4m]))", shiftedWindow],
      ]);
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("results")).toEqual([SERIES, SERIES]);
      expect(chart.props("stepSeconds")).toBe(30);
      expect(chart.props("shifted")).toEqual([
        { result: SERIES, gapMs: DAY_US / 1000, periodAsStr: "1 day ago", parentIndex: 0 },
        { result: SERIES, gapMs: DAY_US / 1000, periodAsStr: "1 day ago", parentIndex: 1 },
      ]);
      expect(wrapper.findComponent({ name: "MetricBreakdown" }).props("compare")).toEqual({
        gapMs: DAY_US / 1000,
        periodAsStr: "1 day ago",
      });
    });

    it("keeps the drawn chart's own step through a refresh, until the new results land", async () => {
      wrapper = mountView({ overview: LINE, timeRange: WINDOW, compare: "1d", stepSeconds: 30 });
      await flushPromises();
      const answers: Array<(value: any) => void> = [];
      runQuery.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

      const wider = { start_time: WINDOW.start_time - HOUR_US, end_time: WINDOW.end_time };
      await wrapper.setProps({ timeRange: wider, stepSeconds: 60 });
      await flushPromises();
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart().props("stepSeconds")).toBe(30);

      answers.forEach((answer) => answer(SERIES));
      await flushPromises();
      expect(chart().props("stepSeconds")).toBe(60);
    });

    it("charts the earlier period when only it has samples", async () => {
      const EMPTY = { resultType: "matrix", result: [] };
      runQuery.mockImplementation((_expr: string, _signal: AbortSignal, _card: any, opts: any) =>
        Promise.resolve(opts?.window ? SERIES : EMPTY),
      );
      wrapper = mountView({ overview: LINE, timeRange: WINDOW, compare: "1d" });
      await flushPromises();
      expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(true);
    });

    it("runs each expression once without a comparison", async () => {
      wrapper = mountView({ overview: LINE, timeRange: WINDOW });
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(wrapper.findComponent({ name: "MetricCardChart" }).props("shifted")).toEqual([]);
      expect(wrapper.findComponent({ name: "MetricBreakdown" }).props("compare")).toBeNull();
    });

    it("offers Off and three offsets, and asks for the chosen one", async () => {
      wrapper = mountView({ overview: LINE, timeRange: WINDOW }, { stubs: selectStub });
      const select = compareSelect(wrapper)!;
      expect(select.props("options").map((o: any) => o.value)).toEqual(["off", "1h", "1d", "1w"]);
      expect(select.props("modelValue")).toBe("off");
      await select.vm.$emit("update:modelValue", "1w");
      await select.vm.$emit("update:modelValue", "off");
      expect(wrapper.emitted("update:compare")).toEqual([["1w"], [null]]);
    });

    it("hides the control on a heatmap and charts no comparison there", async () => {
      wrapper = mountView({ compare: "1d", timeRange: WINDOW }, { stubs: selectStub });
      await flushPromises();
      expect(compareSelect(wrapper)).toBeUndefined();
      expect(runQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("forecast", () => {
    const HOUR_US = 3_600_000_000;
    const WINDOW = { start_time: 100 * HOUR_US, end_time: 101 * HOUR_US };
    const T_S = WINDOW.end_time / 1e6;
    const LINE = {
      queries: [{ expr: "sum(rate(x[4m]))" }, { expr: "max(rate(x[4m]))" }],
      chartType: "line",
      unit: "count-per-sec",
      bucketUnit: null,
    };
    const fit = (expr: string) => ({
      resultType: "vector",
      result: [{ metric: { pod: "a" }, value: [T_S, expr.endsWith(", 0)") ? "1" : "2"] }],
    });
    const selectStub = {
      OSelect: {
        name: "OSelect",
        props: ["modelValue", "options"],
        emits: ["update:modelValue"],
        template: "<div v-bind='$attrs' />",
      },
    };
    const selectNamed = (wrapper: VueWrapper<any>, dataTest: string) =>
      wrapper
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === dataTest);

    beforeEach(() => {
      runQuery.mockImplementation((expr: string, _s: any, _c: any, opts: any) =>
        Promise.resolve(opts?.instantAt ? fit(expr) : SERIES),
      );
    });

    it("asks two instant fits at the range end per expression and draws the line between them", async () => {
      wrapper = mountView({
        overview: LINE,
        timeRange: WINDOW,
        forecast: "linear",
        stepSeconds: 30,
      });
      await flushPromises();

      const instant = runQuery.mock.calls
        .filter(([, , , opts]) => opts?.instantAt)
        .map(([expr, , , opts]) => [expr, opts.instantAt]);
      expect(instant).toEqual([
        ["predict_linear((sum(rate(x[4m])))[3600s:30s], 0)", WINDOW.end_time],
        ["predict_linear((sum(rate(x[4m])))[3600s:30s], 900)", WINDOW.end_time],
        ["predict_linear((max(rate(x[4m])))[3600s:30s], 0)", WINDOW.end_time],
        ["predict_linear((max(rate(x[4m])))[3600s:30s], 900)", WINDOW.end_time],
      ]);
      const forecast = wrapper.findComponent({ name: "MetricCardChart" }).props("forecast");
      expect(forecast.until).toBe(WINDOW.end_time + 900e6);
      expect(forecast.label).toBe("forecast");
      expect(forecast.entries.map((e: any) => e.parentIndex)).toEqual([0, 1]);
      const values = forecast.entries[0].result.result[0].values;
      expect(values[0]).toEqual([T_S, "1"]);
      expect(values.at(-1)).toEqual([T_S + 900, "2"]);
    });

    it("hands Breakdown the same method and horizon, and none while it is off", async () => {
      wrapper = mountView({
        overview: LINE,
        timeRange: WINDOW,
        forecast: "smoothed",
        forecastHorizon: "1h",
        stepSeconds: 30,
      });
      await flushPromises();
      const breakdown = () => wrapper.findComponent({ name: "MetricBreakdown" });
      expect(breakdown().props("forecast")).toEqual({
        method: "smoothed",
        horizon: 3600,
        label: "forecast",
      });

      await wrapper.setProps({ forecast: null });
      expect(breakdown().props("forecast")).toBeNull();
    });

    it("uses the chosen horizon preset", async () => {
      wrapper = mountView({
        overview: LINE,
        timeRange: WINDOW,
        forecast: "smoothed",
        forecastHorizon: "1h",
        stepSeconds: 30,
      });
      await flushPromises();
      const exprs = runQuery.mock.calls
        .filter(([, , , opts]) => opts?.instantAt)
        .map(([expr]) => expr);
      expect(exprs[1]).toBe(
        "predict_linear(holt_winters((sum(rate(x[4m])))[300s:30s], 0.3, 0.1)[3600s:30s], 3600)",
      );
    });

    it("keeps the overview when a forecast query fails, and draws no forecast", async () => {
      runQuery.mockImplementation((expr: string, _s: any, _c: any, opts: any) =>
        opts?.instantAt ? Promise.reject(new Error("timeout")) : Promise.resolve(SERIES),
      );
      wrapper = mountView({
        overview: LINE,
        timeRange: WINDOW,
        forecast: "smoothed",
        stepSeconds: 30,
      });
      await flushPromises();
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.exists()).toBe(true);
      expect(chart.props("results")).toEqual([SERIES, SERIES]);
      expect(chart.props("forecast")).toBeNull();
    });

    it("draws the chart without waiting for the forecast, and adds it when it lands", async () => {
      const fits: Array<() => void> = [];
      runQuery.mockImplementation((expr: string, _s: any, _c: any, opts: any) =>
        opts?.instantAt
          ? new Promise((resolve) => fits.push(() => resolve(fit(expr))))
          : Promise.resolve(SERIES),
      );
      wrapper = mountView({ overview: LINE, timeRange: WINDOW, stepSeconds: 30 });
      await flushPromises();
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart().props("forecast")).toBeNull();

      await wrapper.setProps({ forecast: "smoothed" });
      await flushPromises();
      expect(chart().exists()).toBe(true);
      expect(chart().props("results")).toEqual([SERIES, SERIES]);
      expect(chart().props("forecast")).toBeNull();

      fits.forEach((land) => land());
      await flushPromises();
      expect(chart().props("forecast").entries).toHaveLength(2);
    });

    it("queues its fits after the chart's own queries, and still cancels the rest after one fails", async () => {
      const order: string[] = [];
      const fits: Array<{ signal: AbortSignal; fail: () => void }> = [];
      runQuery.mockImplementation((_expr: string, signal: AbortSignal, _c: any, opts: any) => {
        order.push(opts?.instantAt ? "fit" : "primary");
        if (!opts?.instantAt) return Promise.resolve(SERIES);
        return new Promise((_resolve, reject) =>
          fits.push({ signal, fail: () => reject(new Error("timeout")) }),
        );
      });
      wrapper = mountView({
        overview: LINE,
        timeRange: WINDOW,
        forecast: "linear",
        stepSeconds: 30,
      });
      await flushPromises();
      expect(order.slice(0, 2)).toEqual(["primary", "primary"]);

      fits[0].fail();
      await flushPromises();
      wrapper.unmount();
      expect(fits.slice(1).every((f) => f.signal.aborted)).toBe(true);
    });

    it("queries no forecast while it is off", async () => {
      wrapper = mountView({ overview: LINE, timeRange: WINDOW, stepSeconds: 30 });
      await flushPromises();
      expect(runQuery.mock.calls.some(([, , , opts]) => opts?.instantAt)).toBe(false);
      expect(wrapper.findComponent({ name: "MetricCardChart" }).props("forecast")).toBeNull();
    });

    it("offers the method and the presets the range can train, and asks for the choice", async () => {
      wrapper = mountView(
        { overview: LINE, timeRange: WINDOW, forecast: "linear", stepSeconds: 30 },
        { stubs: selectStub },
      );
      const method = selectNamed(wrapper, "metrics-detail-forecast")!;
      expect(method.props("options").map((o: any) => o.value)).toEqual([
        "off",
        "linear",
        "smoothed",
      ]);
      const horizon = selectNamed(wrapper, "metrics-detail-forecast-horizon")!;
      expect(horizon.props("options").map((o: any) => o.value)).toEqual(["auto", "1h"]);

      await method.vm.$emit("update:modelValue", "smoothed");
      await method.vm.$emit("update:modelValue", "off");
      await horizon.vm.$emit("update:modelValue", "1h");
      await horizon.vm.$emit("update:modelValue", "auto");
      expect(wrapper.emitted("update:forecast")).toEqual([["smoothed"], [null]]);
      expect(wrapper.emitted("update:forecastHorizon")).toEqual([["1h"], [null]]);
    });

    it("says Smoothed trend is a linear projection of a smoothed series", () => {
      wrapper = mountView(
        { overview: LINE, timeRange: WINDOW, forecast: "smoothed", stepSeconds: 30 },
        { realHeader: false },
      );
      expect(
        wrapper.find('[data-test="metrics-detail-forecast-help"]').attributes("aria-label"),
      ).toContain("linear projection of a smoothed series");
    });

    it("offers no forecast on a heatmap or on an info metric", async () => {
      wrapper = mountView(
        { forecast: "linear", timeRange: WINDOW, stepSeconds: 30 },
        { stubs: selectStub },
      );
      await flushPromises();
      expect(selectNamed(wrapper, "metrics-detail-forecast")).toBeUndefined();
      expect(runQuery.mock.calls.some(([, , , opts]) => opts?.instantAt)).toBe(false);
      expect(wrapper.findComponent({ name: "MetricBreakdown" }).props("forecast")).toBeNull();
      wrapper.unmount();

      wrapper = mountView(
        {
          card: { ...SELECTED, cardKind: CARD_KIND.INFO },
          overview: LINE,
          forecast: "linear",
          timeRange: WINDOW,
          stepSeconds: 30,
        },
        { stubs: selectStub },
      );
      await flushPromises();
      expect(selectNamed(wrapper, "metrics-detail-forecast")).toBeUndefined();
      expect(runQuery.mock.calls.some(([, , , opts]) => opts?.instantAt)).toBe(false);
    });
  });

  describe("logs & traces drilldown", () => {
    const button = () => wrapper.find('[data-test="metrics-detail-drilldown"]');
    // A menu trigger marks itself, or an ancestor it wraps, with aria-haspopup.
    const isMenuTrigger = () => {
      for (let el: Element | null = button().element; el; el = el.parentElement) {
        if (el.hasAttribute("aria-haspopup")) return true;
      }
      return false;
    };
    const tooltipText = async () => {
      vi.useFakeTimers();
      await button().element.parentElement!.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      await flushPromises();
      return document.body.textContent ?? "";
    };

    beforeEach(() => {
      (config as any).isCloud = "false";
      drilldownApi.getIdentityConfig.mockResolvedValue({
        data: { sets: [], tracked_alias_ids: [] },
      });
      drilldownApi.getSemanticGroups.mockResolvedValue({ data: [] });
      store.state.zoConfig = { ...store.state.zoConfig, service_streams_enabled: true };
    });

    afterEach(() => {
      (config as any).isEnterprise = "false";
    });

    describe("on an OSS build", () => {
      beforeEach(() => {
        (config as any).isEnterprise = "false";
      });

      it("is visible, disabled and locked, inside a span the tooltip hovers on, with no menu around it", () => {
        wrapper = mountView();
        expect(button().exists()).toBe(true);
        expect(button().attributes("disabled")).toBeDefined();
        expect(button().find('[data-test="metrics-detail-drilldown-lock"]').exists()).toBe(true);
        expect(button().element.parentElement!.tagName).toBe("SPAN");
        expect(
          wrapper
            .findAllComponents({ name: "ODropdown" })
            .some((d) => d.find('[data-test="metrics-detail-drilldown"]').exists()),
        ).toBe(false);
      });

      it("shows the Enterprise tooltip on hover over the span", async () => {
        wrapper = mountView({}, { realHeader: false });
        expect(await tooltipText()).toContain(
          "Logs and traces drilldown is an Enterprise feature.",
        );
      });

      it("cannot be activated: natively disabled, no menu trigger, and asks the server nothing", async () => {
        wrapper = mountView();
        await flushPromises();
        expect((button().element as HTMLButtonElement).disabled).toBe(true);
        expect(isMenuTrigger()).toBe(false);
        for (const target of [button().element, button().element.parentElement!]) {
          target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        await flushPromises();
        expect(document.querySelector('[data-test="metrics-detail-drilldown-menu"]')).toBeNull();
        expect(drilldownApi.getIdentityConfig).not.toHaveBeenCalled();
        expect(drilldownApi.correlate).not.toHaveBeenCalled();
      });
    });

    describe("on an Enterprise build", () => {
      beforeEach(() => {
        (config as any).isEnterprise = "true";
      });

      it("is an enabled dropdown trigger when service discovery is on", async () => {
        wrapper = mountView();
        await flushPromises();
        expect(button().attributes("disabled")).toBeUndefined();
        expect(isMenuTrigger()).toBe(true);
        expect(button().find('[data-test="metrics-detail-drilldown-lock"]').exists()).toBe(false);
        expect(
          wrapper
            .findAllComponents({ name: "ODropdown" })
            .some((d) => d.find('[data-test="metrics-detail-drilldown"]').exists()),
        ).toBe(true);
      });

      it("stays disabled, saying it is checking access, until both reads answer", async () => {
        let answer!: (value: any) => void;
        drilldownApi.getSemanticGroups.mockReturnValueOnce(new Promise((r) => (answer = r)));
        wrapper = mountView({}, { realHeader: false });
        await flushPromises();
        expect((button().element as HTMLButtonElement).disabled).toBe(true);
        expect(isMenuTrigger()).toBe(false);
        expect(button().find('[data-test="metrics-detail-drilldown-lock"]').exists()).toBe(false);
        expect(await tooltipText()).toContain("Checking access...");

        answer({ data: [] });
        await flushPromises();
        expect(button().attributes("disabled")).toBeUndefined();
        expect(isMenuTrigger()).toBe(true);
      });

      it("is disabled, with the discovery tooltip, when service discovery is off", async () => {
        store.state.zoConfig = { ...store.state.zoConfig, service_streams_enabled: false };
        wrapper = mountView();
        await flushPromises();
        expect(button().attributes("disabled")).toBeDefined();
        expect(await tooltipText()).toContain(
          "Service discovery is turned off for this organization.",
        );
      });
    });
  });

  describe("create alert", () => {
    const HOUR_US = 3_600_000_000;
    const dropdownStubs = {
      ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
      ODropdownItem: {
        name: "ODropdownItem",
        emits: ["select"],
        template: "<div v-bind='$attrs' @click=\"$emit('select')\"><slot /></div>",
      },
    };

    it("offers the overview chart's right-click alert, on the metric's own stream", async () => {
      wrapper = mountView();
      await flushPromises();
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("allowAlertCreation")).toBe(true);
      expect(chart.props("queries")[0].stream).toBe(SELECTED.name);
    });

    it("says why Create alert is disabled when the metric has no query", async () => {
      wrapper = mountView(
        { overview: { queries: [], chartType: "line", unit: "", bucketUnit: null } },
        { stubs: dropdownStubs },
      );
      await flushPromises();
      expect(wrapper.findComponent({ name: "CreateAlertAction" }).props("disabledReason")).toBe(
        "This metric has no query to alert on",
      );
    });

    it("opens the alert form on the overview query from the header's overflow menu", async () => {
      wrapper = mountView(
        { timeRange: { start_time: 10 * HOUR_US, end_time: 11 * HOUR_US } },
        { stubs: dropdownStubs },
      );
      await flushPromises();
      await wrapper.find('[data-test="metrics-detail-create-alert"]').trigger("click");

      expect(openAlertCreation).toHaveBeenCalledTimes(1);
      const prefill = (openAlertCreation.mock.calls[0] as any[])[0];
      expect(prefill).toMatchObject({
        source: "panel",
        queryType: "promql",
        streamName: SELECTED.name,
        streamType: "metrics",
        promql: "sum by (le) (rate(x[4m]))",
        periodMinutes: 60,
      });
      expect(prefill.promqlCondition).toBeUndefined();
    });
  });

  describe("filters this metric cannot apply", () => {
    const JOB = { label: "job", operator: "=", value: "api" };
    const ROUTE = { label: "route", operator: "!=", value: "/health" };
    const NOTICE = '[data-test="metrics-detail-filters-not-applied"]';

    it("names each filter that does not apply, since the chart shows every series", () => {
      wrapper = mountView({ filters: [JOB, ROUTE], inapplicableFilters: [JOB] });
      const notice = wrapper.find(NOTICE);
      expect(notice.exists()).toBe(true);
      expect(notice.text()).toContain('job="api"');
      expect(notice.text()).not.toContain("route");
    });

    it("says nothing when every filter applies", () => {
      wrapper = mountView({ filters: [JOB], inapplicableFilters: [] });
      expect(wrapper.find(NOTICE).exists()).toBe(false);
    });
  });

  describe("tabs", () => {
    it("offers Breakdown, Related and Used in, Breakdown first", () => {
      wrapper = mountView();
      expect(tabNames(wrapper)).toEqual(["breakdown", "related", "used_in"]);
      expect(wrapper.find('[data-test="breakdown-stub"]').exists()).toBe(true);
    });

    it("hands Breakdown the window its dashboard panel rates over", () => {
      wrapper = mountView({ panelRateWindow: "30m" });
      expect(
        wrapper.findComponent({ name: "MetricBreakdown" }).attributes("panel-rate-window"),
      ).toBe("30m");
    });

    it("hides Breakdown for timestamp and other cards", () => {
      for (const cardKind of [CARD_KIND.TIMESTAMP, CARD_KIND.OTHER]) {
        wrapper = mountView({ card: { ...SELECTED, cardKind }, tab: "breakdown" });
        expect(tabNames(wrapper)).toEqual(["related", "used_in"]);
        expect(wrapper.find('[data-test="breakdown-stub"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="metrics-detail-related"]').exists()).toBe(true);
        wrapper.unmount();
      }
    });
  });

  describe("used in", () => {
    const usedInLabel = (w: VueWrapper<any>) =>
      w
        .findAllComponents({ name: "OTab" })
        .find((tab) => tab.props("name") === "used_in")!
        .props("label");

    it("asks where this metric is used, and counts the objects in the tab label", async () => {
      wrapper = mountView();
      expect(getMetricUsage).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "default", metric: SELECTED.name }),
      );
      expect(usedInLabel(wrapper)).toBe("Used in");
      await flushPromises();
      expect(usedInLabel(wrapper)).toBe("Used in (3)");
    });

    it("hands the result to the list on its tab, even for a card without Breakdown", async () => {
      wrapper = mountView({ card: { ...SELECTED, cardKind: CARD_KIND.OTHER }, tab: "used_in" });
      await flushPromises();
      const list = wrapper.findComponent({ name: "MetricUsageList" });
      expect(list.props("usage")).toEqual(USAGE);
      expect(list.props("status")).toBe("done");
      expect(wrapper.find('[data-test="metrics-detail-related"]').exists()).toBe(false);
    });

    it("reports a failed lookup to the list and keeps the tab label uncounted", async () => {
      getMetricUsage.mockRejectedValue(new Error("boom"));
      wrapper = mountView({ tab: "used_in" });
      await flushPromises();
      expect(wrapper.findComponent({ name: "MetricUsageList" }).props("status")).toBe("error");
      expect(usedInLabel(wrapper)).toBe("Used in");
    });

    it("asks again in another organization", async () => {
      wrapper = mountView();
      await flushPromises();
      const org = store.state.selectedOrganization;
      store.state.selectedOrganization = { ...org, identifier: "other-org" };
      await flushPromises();
      expect(getMetricUsage).toHaveBeenLastCalledWith(
        expect.objectContaining({ org_identifier: "other-org", metric: SELECTED.name }),
      );
      store.state.selectedOrganization = org;
    });

    it("asks again for a different metric", async () => {
      wrapper = mountView();
      await flushPromises();
      await wrapper.setProps({ card: card("node_load1"), metricName: "node_load1" });
      expect(getMetricUsage).toHaveBeenLastCalledWith(
        expect.objectContaining({ metric: "node_load1" }),
      );
    });
  });

  describe("related", () => {
    const RELATED_CARD = '[data-test="metrics-detail-related-grid"] > [data-test]';
    const relatedNames = (w: VueWrapper<any>) =>
      w
        .findAll(RELATED_CARD)
        .map((c) => c.attributes("data-test")!.replace("metrics-detail-related-card-", ""));
    const relatedExprs = () =>
      runQuery.mock.calls.map(([expr]) => expr).filter((e) => e !== "sum by (le) (rate(x[4m]))");

    let io: ReturnType<typeof installFakeIntersectionObserver>;
    beforeEach(() => {
      io = installFakeIntersectionObserver({ autoVisible: true });
    });
    afterEach(() => io.restore());

    it("shows a card for each of twelve metrics of the prefix group, never the selected metric's family", async () => {
      wrapper = mountView({ tab: "related" });
      await flushPromises();
      const names = relatedNames(wrapper);

      expect(names).toHaveLength(12);
      expect(names).toContain("http_server_active_requests");
      expect(names).not.toContain("http_server_request_duration_seconds_sum");
      expect(names).not.toContain("http_server_request_duration_seconds_count");
      expect(names).not.toContain("node_load1");
    });

    it("lays the cards out three across, two on a tablet, one on a phone", () => {
      wrapper = mountView({ tab: "related" });
      const grid = wrapper.find('[data-test="metrics-detail-related-grid"]');
      expect(grid.classes()).toEqual(
        expect.arrayContaining(["grid", "grid-cols-3", "max-lg:grid-cols-2", "max-md:grid-cols-1"]),
      );
    });

    it("ranks only metrics the active filters apply to", () => {
      wrapper = mountView({
        tab: "related",
        isLabelEligible: (c: any) => c.name !== "http_server_active_requests",
      });
      const names = relatedNames(wrapper);
      expect(names).toHaveLength(12);
      expect(names).not.toContain("http_server_active_requests");
    });

    it("heads each card with the metric's name, type and the labels it shares", () => {
      wrapper = mountView({
        tab: "related",
        labelsByStream: {
          [SELECTED.name]: ["job", "route"],
          http_server_active_requests: ["job", "route"],
        },
      });
      const cardEl = wrapper.find(
        '[data-test="metrics-detail-related-card-http_server_active_requests"]',
      );
      expect(cardEl.text()).toContain("http_server_active_requests");
      expect(cardEl.findComponent({ name: "OTag" }).props("value")).toBe("gauge");
      const shared = cardEl.find(
        '[data-test="metrics-detail-related-shared-http_server_active_requests"]',
      );
      expect(shared.classes()).toContain("truncate");
      expect(shared.attributes("title")).toBe("job, route");
      expect(shared.text()).toContain("job, route");
    });

    it("charts each related metric with the grid's default query, on its own card's scheduler slot", async () => {
      wrapper = mountView({ tab: "related" });
      await flushPromises();
      expect(relatedExprs()).toContain("rate(http_server_active_requests[4m])");
      const call = runQuery.mock.calls.find(
        ([expr]) => expr === "rate(http_server_active_requests[4m])",
      )!;
      expect(call[2].name).toBe("http_server_active_requests");
    });

    it("says so on a card whose metric has no chartable query", async () => {
      wrapper = mountView({
        tab: "related",
        chartOf: (c: any) => ({ ...chartOf(c), queries: [] }),
      });
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="metrics-detail-related-card-http_server_active_requests-nopreview"]')
          .exists(),
      ).toBe(true);
      expect(relatedExprs()).toEqual([]);
    });

    it("charts a related metric only once its card scrolls into view", async () => {
      const lazy = installFakeIntersectionObserver();
      try {
        wrapper = mountView({ tab: "related" });
        await flushPromises();
        expect(relatedExprs()).toEqual([]);

        const cardEl = wrapper.find(
          '[data-test="metrics-detail-related-card-http_server_active_requests"]',
        );
        lazy.setVisible(cardEl.element, true);
        await flushPromises();
        expect(relatedExprs()).toEqual(["rate(http_server_active_requests[4m])"]);
      } finally {
        lazy.restore();
      }
    });

    it("cancels the related charts still running when the view closes", async () => {
      runQuery.mockImplementation(() => new Promise(() => {}));
      wrapper = mountView({ tab: "related" });
      await flushPromises();
      wrapper.unmount();
      expect(cancelled()).toContain("rate(http_server_active_requests[4m])");
    });

    it("says so when nothing is related", () => {
      wrapper = mountView({ tab: "related", allCards: [SELECTED] });
      expect(wrapper.find('[data-test="metrics-detail-related-empty"]').exists()).toBe(true);
    });

    it("opens a related metric's detail view from its header or its title, never its chart", async () => {
      wrapper = mountView({ tab: "related" });
      await flushPromises();
      const cardEl = wrapper.find(
        '[data-test="metrics-detail-related-card-http_server_active_requests"]',
      );
      // The mouseup ending a drag-to-zoom on the chart arrives as a click.
      await cardEl.findComponent({ name: "MetricCardChart" }).trigger("click");
      expect(wrapper.emitted("open-related")).toBeUndefined();

      await cardEl
        .find('[data-test="metrics-detail-related-shared-http_server_active_requests"]')
        .trigger("click");
      await wrapper
        .find('[data-test="metrics-detail-related-open-http_server_active_requests"]')
        .trigger("click");
      expect(wrapper.emitted("open-related")).toEqual([
        ["http_server_active_requests"],
        ["http_server_active_requests"],
      ]);
    });

    it("colours each related card as the metric's own grid card", () => {
      wrapper = mountView({
        tab: "related",
        colorOf: (name: string) => (name === "http_server_active_requests" ? "#123456" : "#000"),
      });
      const tile = wrapper
        .findAllComponents({ name: "MetricChartTile" })
        .find(
          (c) =>
            c.attributes("data-test") === "metrics-detail-related-card-http_server_active_requests",
        )!;
      expect(tile.props("color")).toBe("#123456");
    });
  });

  describe("header actions", () => {
    it("labels the back button once with Back to, through the real header", async () => {
      wrapper = mountView({}, { realHeader: true });
      const back = wrapper.find('[data-test="metrics-detail-close"]');
      expect(back.attributes("aria-label")).toBe("Back to metrics");
    });

    it("keeps Open in Visualize named when its label is hidden on a phone", () => {
      wrapper = mountView();
      const open = wrapper.find('[data-test="metrics-detail-open-visualize"]');
      expect(open.attributes("aria-label")).toBe("Open in Visualize");
      expect(open.find("span.max-md\\:hidden").text()).toBe("Open in Visualize");
    });

    it("closes, opens Visualize and toggles the favorite", async () => {
      wrapper = mountView();
      await wrapper.find('[data-test="detail-back"]').trigger("click");
      await wrapper.find('[data-test="metrics-detail-open-visualize"]').trigger("click");
      await wrapper.find('[data-test="metrics-detail-favorite"]').trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
      expect(wrapper.emitted("open-visualize")).toHaveLength(1);
      expect(wrapper.emitted("toggle-favorite")).toHaveLength(1);
    });
  });

  describe("the function in effect", () => {
    const OVERVIEW = {
      queries: [{ expr: "avg(rate(x[4m]))" }],
      chartType: "line",
      unit: "count-per-sec",
      bucketUnit: null,
      footerLabel: "avg(rate)",
    };

    it("names it in the header, as the card does, and follows a change", async () => {
      wrapper = mountView({ overview: OVERVIEW });
      const fn = () => wrapper.find('[data-test="metrics-detail-function"]');
      expect(fn().text()).toBe("avg(rate)");
      await wrapper.setProps({ overview: { ...OVERVIEW, footerLabel: "sum(increase)" } });
      expect(fn().text()).toBe("sum(increase)");
    });

    it("hands Breakdown the overview's function and its panel queries", () => {
      const panelQueries = [{ expr: "avg(rate(x[$__rate_interval]))" }];
      wrapper = mountView({ overview: OVERVIEW, panelQueries });
      const breakdown = wrapper.findComponent({ name: "MetricBreakdown" });
      expect(breakdown.props("variant")).toEqual(OVERVIEW);
      expect(breakdown.props("panelQueries")).toEqual(panelQueries);
    });

    it("runs Breakdown's queries for this metric, passing a lifted series cap through", async () => {
      wrapper = mountView({ overview: OVERVIEW });
      const { signal } = new AbortController();
      runQuery.mockClear();
      await wrapper.findComponent({ name: "MetricBreakdown" }).props("runQuery")(
        "sum(le)",
        signal,
        { maxSeries: Infinity },
      );
      expect(runQuery).toHaveBeenCalledWith("sum(le)", signal, undefined, { maxSeries: Infinity });
    });
  });

  describe("actions moved from the grid card", () => {
    const NAME = SELECTED.name;
    const sel = (action: string) => `[data-test="metrics-explorer-card-${action}-${NAME}"]`;
    const HELP = "Time spent serving one request, by bucket.";

    it("shows the metric's full help text from an info button, announced in full", () => {
      wrapper = mountView({ card: { ...SELECTED, help: HELP } });
      const help = wrapper.find(sel("help"));
      expect(help.element.tagName).toBe("BUTTON");
      expect(help.attributes("aria-label")).toContain(HELP);
    });

    it("has no info button for a metric without help text", () => {
      wrapper = mountView();
      expect(wrapper.find(sel("help")).exists()).toBe(false);
    });

    it("offers a labelled Configure function button on a configurable metric", async () => {
      wrapper = mountView({ card: { ...SELECTED, configurable: true } });
      const configure = wrapper.find(sel("fn"));
      expect(configure.text()).toBe("Configure function");
      expect(configure.attributes("aria-label")).toBe(`Configure function for ${NAME}`);
      await configure.trigger("click");
      expect(wrapper.emitted("configure")).toHaveLength(1);
    });

    it("has no Configure function button on a metric that cannot be configured", () => {
      wrapper = mountView({ card: { ...SELECTED, configurable: false } });
      expect(wrapper.find(sel("fn")).exists()).toBe(false);
    });

    it("offers a labelled Exemplars toggle on an eligible metric", async () => {
      wrapper = mountView({ exemplarsEligible: true, exemplarsOn: false });
      const toggle = wrapper.find(sel("exemplars"));
      expect(toggle.text()).toBe("Exemplars");
      expect(toggle.attributes("aria-pressed")).toBe("false");
      await toggle.trigger("click");
      expect(wrapper.emitted("toggle-exemplars")).toHaveLength(1);
    });

    it("has no Exemplars toggle on an ineligible metric", () => {
      wrapper = mountView({ exemplarsEligible: false });
      expect(wrapper.find(sel("exemplars")).exists()).toBe(false);
    });

    it("says a heatmap metric's toggle swaps it to percentiles", () => {
      wrapper = mountView({ exemplarsEligible: true, exemplarsSwapsVariant: true });
      expect(wrapper.find(sel("exemplars")).attributes("data-swaps-variant")).toBe("percentiles");
    });

    it("shows the exemplar status while on: loading, empty, and a failure with Retry", async () => {
      wrapper = mountView({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplars: { status: "loading", markers: [], errorMessage: "" },
      });
      expect(wrapper.find(sel("exemplars")).attributes("aria-pressed")).toBe("true");
      expect(wrapper.find(sel("exemplars-loading")).exists()).toBe(true);

      await wrapper.setProps({ exemplars: { status: "empty", markers: [], errorMessage: "" } });
      expect(wrapper.find(sel("exemplars-empty")).exists()).toBe(true);

      await wrapper.setProps({ exemplars: { status: "error", markers: [], errorMessage: "boom" } });
      expect(wrapper.find(sel("exemplars-error")).exists()).toBe(true);
    });

    it("retries a failed exemplar fetch from the failure's tooltip", async () => {
      // The tooltip mounts its content only while open, so render it inline.
      wrapper = mountView(
        {
          exemplarsEligible: true,
          exemplarsOn: true,
          exemplars: { status: "error", markers: [], errorMessage: "boom" },
        },
        { stubs: { OTooltip: { template: "<div><slot name='content' /></div>" } } },
      );
      expect(wrapper.find(sel("exemplars-error")).text()).toContain("boom");
      await wrapper.find('[data-test="dashboard-panel-exemplars-retry"]').trigger("click");
      expect(wrapper.emitted("retry-exemplars")).toHaveLength(1);
    });

    it("draws the exemplars on the overview chart only while on", async () => {
      const exemplars = { status: "ready", markers: [], errorMessage: "" };
      wrapper = mountView({ exemplarsEligible: true, exemplarsOn: true, exemplars });
      await flushPromises();
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart().props("injectedExemplars")).toEqual(exemplars);

      await wrapper.setProps({ exemplarsOn: false });
      expect(chart().props("injectedExemplars")).toBeUndefined();
    });
  });
});
