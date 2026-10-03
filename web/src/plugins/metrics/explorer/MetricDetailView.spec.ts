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

const OTableStub = {
  name: "OTable",
  props: ["data", "columns"],
  emits: ["row-click"],
  template: `
    <div>
      <div
        v-for="row in data"
        :key="row.name"
        :data-test="'related-row-' + row.name"
        @click="$emit('row-click', row, $event)"
      >
        <div v-for="col in columns" :key="col.id">
          <slot name="cell" :row="{ original: row }" :column="{ id: col.id }" :value="row[col.id]" />
        </div>
      </div>
    </div>
  `,
};

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
const cancelQueries = vi.fn();

const mountView = (props: Record<string, any> = {}) =>
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
      cancelQueries,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        OPageHeader: OPageHeaderStub,
        OTable: OTableStub,
        MetricBreakdown: {
          name: "MetricBreakdown",
          template: "<div data-test='breakdown-stub' />",
        },
        MetricCardChart: {
          name: "MetricCardChart",
          props: ["results", "queries"],
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
      expect(runQuery).toHaveBeenCalledWith("sum by (le) (rate(x[4m]))");
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.props("results")).toEqual([SERIES]);
    });

    it("cancels the overview query when the view closes", async () => {
      wrapper = mountView();
      await flushPromises();
      wrapper.unmount();
      expect(cancelQueries).toHaveBeenCalledWith(["sum by (le) (rate(x[4m]))"]);
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
    it("lists twelve metrics of the prefix group, never the selected metric's family", () => {
      wrapper = mountView({ tab: "related" });
      const names = wrapper
        .findAll('[data-test^="related-row-"]')
        .map((row) => row.attributes("data-test")!.replace("related-row-", ""));

      expect(names).toHaveLength(12);
      expect(names).toContain("http_server_active_requests");
      expect(names).not.toContain("http_server_request_duration_seconds_sum");
      expect(names).not.toContain("http_server_request_duration_seconds_count");
      expect(names).not.toContain("node_load1");
      // Ranked lists, no charts: nothing was queried for them.
      expect(runQuery).toHaveBeenCalledTimes(1);
    });

    it("ranks only metrics the active filters apply to", () => {
      wrapper = mountView({
        tab: "related",
        isLabelEligible: (c: any) => c.name !== "http_server_active_requests",
      });
      const names = wrapper
        .findAll('[data-test^="related-row-"]')
        .map((row) => row.attributes("data-test")!.replace("related-row-", ""));
      expect(names).toHaveLength(12);
      expect(names).not.toContain("http_server_active_requests");
    });

    it("opens a related metric's detail view on click", async () => {
      wrapper = mountView({ tab: "related" });
      await wrapper.find('[data-test="related-row-http_server_active_requests"]').trigger("click");
      expect(wrapper.emitted("open-related")).toEqual([["http_server_active_requests"]]);
    });
  });

  describe("header actions", () => {
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
