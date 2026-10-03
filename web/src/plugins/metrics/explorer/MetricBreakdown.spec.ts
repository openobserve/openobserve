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
import { b64DecodeUnicode } from "@/utils/zincutils";
import { CARD_KIND } from "@/utils/metrics/metricDefaults";

const { fieldValues } = vi.hoisted(() => ({ fieldValues: vi.fn() }));
vi.mock("@/services/stream", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, default: { ...actual.default, fieldValues } };
});

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

// OTable is heavy (TanStack + virtualisation); this stub renders its rows through
// the same `cell` slot contract — `{ row: { original }, column: { id }, value }`.
const OTableStub = {
  name: "OTable",
  props: ["data", "columns", "loading", "error", "rowClass"],
  emits: ["row-click"],
  template: `
    <div data-test="breakdown-table-stub">
      <div
        v-for="row in data"
        :key="row.label"
        :data-test="'breakdown-row-' + row.label"
        @click="$emit('row-click', row, $event)"
      >
        <div v-for="col in columns" :key="col.id">
          <slot name="cell" :row="{ original: row }" :column="{ id: col.id }" :value="row[col.id]">{{ row[col.id] }}</slot>
        </div>
      </div>
    </div>
  `,
};

const MetricCardChartStub = {
  name: "MetricCardChart",
  props: ["results", "queries", "chartType", "unit", "unitCustom", "color"],
  template: `<div data-test="breakdown-chart-stub" />`,
};

const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };

const runQuery = vi.fn();
const cancelQueries = vi.fn();

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
      cancelQueries,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: { OTable: OTableStub, MetricCardChart: MetricCardChartStub },
    },
  });

const lastRequest = () => fieldValues.mock.calls.at(-1)![0];
const lastSql = () => b64DecodeUnicode(lastRequest().query_context);

describe("MetricBreakdown", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    fieldValues.mockResolvedValue({ data: { hits: HITS } });
    runQuery.mockResolvedValue(SERIES);
  });

  afterEach(() => wrapper?.unmount());

  describe("label table", () => {
    it("asks the values endpoint for the eligible labels of the stream the query reads", async () => {
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

    it("shows the top five values with sample counts, and 20+ when the cap was hit", async () => {
      wrapper = mountBreakdown();
      await flushPromises();

      const instance = wrapper.find('[data-test="breakdown-row-instance"]');
      expect(instance.findAll('[data-test^="metrics-breakdown-value-instance-"]')).toHaveLength(5);
      expect(instance.text()).toContain("samples");
      expect(instance.find('[data-test="metrics-breakdown-distinct-instance"]').text()).toBe("20+");
      expect(wrapper.find('[data-test="metrics-breakdown-distinct-method"]').text()).toBe("3");
    });

    it("adds a value to the filters, or excludes it", async () => {
      wrapper = mountBreakdown();
      await flushPromises();

      await wrapper.find('[data-test="metrics-breakdown-add-status-500"]').trigger("click");
      await wrapper.find('[data-test="metrics-breakdown-exclude-status-500"]').trigger("click");

      expect(wrapper.emitted("add-filter")).toEqual([
        [{ label: "status", operator: "=", value: "500" }],
        [{ label: "status", operator: "!=", value: "500" }],
      ]);
      // Adding a filter is not selecting the row.
      expect(wrapper.emitted("update:selectedLabel")).toBeFalsy();
    });

    it("selects a label from its row", async () => {
      wrapper = mountBreakdown();
      await flushPromises();
      await wrapper.find('[data-test="breakdown-row-route"]').trigger("click");
      expect(wrapper.emitted("update:selectedLabel")).toEqual([["route"]]);
    });
  });

  describe("chart for the selected label", () => {
    it("charts a label with few values without topk", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();

      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(runQuery).toHaveBeenCalledWith(
        'sum by (method) (rate({__name__="http_requests_total"}[4m]))',
      );
      expect(wrapper.find('[data-test="metrics-breakdown-topk"]').exists()).toBe(false);
    });

    it("guards a 20+ label with topk(10) and says so", async () => {
      wrapper = mountBreakdown({ selectedLabel: "instance" });
      await flushPromises();

      expect(runQuery).toHaveBeenCalledWith(
        'topk(10, sum by (instance) (rate({__name__="http_requests_total"}[4m])))',
      );
      expect(wrapper.find('[data-test="metrics-breakdown-topk"]').text()).toContain("top 10");
    });

    it("renders exactly one chart", async () => {
      wrapper = mountBreakdown({ selectedLabel: "route" });
      await flushPromises();
      expect(wrapper.findAll('[data-test="breakdown-chart-stub"]')).toHaveLength(1);
    });

    it("cancels the previous chart query when another label is selected", async () => {
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();
      const first = runQuery.mock.calls[0][0];

      await wrapper.setProps({ selectedLabel: "route" });
      await flushPromises();

      expect(cancelQueries).toHaveBeenCalledWith([first]);
      expect(runQuery).toHaveBeenLastCalledWith(
        'sum by (route) (rate({__name__="http_requests_total"}[4m]))',
      );
    });

    it("cancels the chart query when the view closes", async () => {
      wrapper = mountBreakdown({ selectedLabel: "route" });
      await flushPromises();
      const expr = runQuery.mock.calls[0][0];

      wrapper.unmount();
      expect(cancelQueries).toHaveBeenCalledWith([expr]);
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
  });
});
