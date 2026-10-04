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

const mountView = (props: Record<string, any> = {}, { realHeader = false } = {}) =>
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
        MetricBreakdown: {
          name: "MetricBreakdown",
          template: "<div data-test='breakdown-stub' />",
        },
        MetricCardChart: {
          name: "MetricCardChart",
          props: ["results", "queries", "color", "chartType", "unit", "timeRange"],
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
    it("offers Breakdown and Related, Breakdown first", () => {
      wrapper = mountView();
      expect(tabNames(wrapper)).toEqual(["breakdown", "related"]);
      expect(wrapper.find('[data-test="breakdown-stub"]').exists()).toBe(true);
    });

    it("hides Breakdown for timestamp and other cards", () => {
      for (const cardKind of [CARD_KIND.TIMESTAMP, CARD_KIND.OTHER]) {
        wrapper = mountView({ card: { ...SELECTED, cardKind }, tab: "breakdown" });
        expect(tabNames(wrapper)).toEqual(["related"]);
        expect(wrapper.find('[data-test="breakdown-stub"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="metrics-detail-related"]').exists()).toBe(true);
        wrapper.unmount();
      }
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
});
