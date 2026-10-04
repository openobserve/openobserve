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

// Light OTable stub with the same `#cell-<id>` slot contract: `{ row: original, column, value }`.
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
          <slot :name="'cell-' + col.id" :row="row" :column="col" :value="row[col.id]">{{ row[col.id] }}</slot>
        </div>
      </div>
    </div>
  `,
};

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

    it("caps a deep-linked label with topk(10) when its value counts failed to load", async () => {
      fieldValues.mockRejectedValue(new Error("values unavailable"));
      wrapper = mountBreakdown({ selectedLabel: "method" });
      await flushPromises();

      expect(runQuery).toHaveBeenCalledWith(
        'topk(10, sum by (method) (rate({__name__="http_requests_total"}[4m])))',
      );
    });

    it("ignores a deep-linked label the table does not offer", async () => {
      // `le` is never a breakdown label, so it has no row and no topk guard.
      wrapper = mountBreakdown({ selectedLabel: "le" });
      await flushPromises();

      expect(runQuery).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="metrics-breakdown-chart"]').exists()).toBe(false);
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

// The real OTable renders only `#cell-<id>` slots, so a wrong slot name leaves cells empty here.
describe("MetricBreakdown with the real OTable", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    fieldValues.mockResolvedValue({ data: { hits: HITS } });
    runQuery.mockResolvedValue(SERIES);
  });

  afterEach(() => wrapper?.unmount());

  const mountReal = (props: Record<string, any> = {}) =>
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
      global: { plugins: [i18n, store], stubs: { MetricCardChart: MetricCardChartStub } },
    });

  it("renders each label's top values with their Add to filter and Exclude actions", async () => {
    wrapper = mountReal();
    await flushPromises();

    // Wait out OTable's loading skeleton; the cells are what is under test.
    await vi.waitFor(() => expect(wrapper.findAll('[data-test^="o2-table-row-"]')).toHaveLength(4));
    expect(wrapper.find('[data-test="metrics-breakdown-value-method-m0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="metrics-breakdown-distinct-instance"]').text()).toBe("20+");

    await wrapper.find('[data-test="metrics-breakdown-add-status-500"]').trigger("click");
    await wrapper.find('[data-test="metrics-breakdown-exclude-status-500"]').trigger("click");
    expect(wrapper.emitted("add-filter")).toEqual([
      [{ label: "status", operator: "=", value: "500" }],
      [{ label: "status", operator: "!=", value: "500" }],
    ]);
  });

  // 20 labels: `tenant_id` sorts past the first 15, whose values are counted.
  const WIDE_LABELS = [
    ...Array.from({ length: 18 }, (_, i) => `a${String(i).padStart(2, "0")}`),
    "service_name",
    "tenant_id",
  ];
  const WIDE: any = { ...CARD, labels: WIDE_LABELS };

  it("offers every label, and honours a deep-linked label past the value-count cap", async () => {
    fieldValues.mockResolvedValue({
      data: { hits: [{ field: "tenant_id", values: values("t", 3) }] },
    });
    wrapper = mountReal({ card: WIDE, selectedLabel: "tenant_id" });
    await flushPromises();

    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-test^="o2-table-row-"]')).toHaveLength(20),
    );
    expect(fieldValues.mock.calls.map(([req]) => req.fields)).toEqual([
      WIDE_LABELS.slice(0, 15),
      ["tenant_id"],
    ]);
    expect(runQuery).toHaveBeenCalledWith(
      'sum by (tenant_id) (rate({__name__="http_requests_total"}[4m]))',
    );
    expect(wrapper.find('[data-test="metrics-breakdown-value-tenant_id-t0"]').exists()).toBe(true);
    // An uncounted label is still a row to pick, not a silent absence.
    expect(wrapper.find('[data-test="metrics-breakdown-distinct-service_name"]').text()).toBe("–");
  });

  /** Answers each request with three values for every field it asked for. */
  const echoFields = ({ fields }: any) =>
    Promise.resolve({
      data: { hits: fields.map((field: string) => ({ field, values: values(`${field}-`, 3) })) },
    });

  it("shows a label added past the cap once the labels change", async () => {
    fieldValues.mockImplementation(echoFields);
    wrapper = mountReal({ card: WIDE });
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-test^="o2-table-row-"]')).toHaveLength(20),
    );

    await wrapper.setProps({ card: { ...WIDE, labels: [...WIDE_LABELS, "zone"] } });
    await flushPromises();

    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-test^="o2-table-row-"]')).toHaveLength(21),
    );
    expect(wrapper.find('[data-test="metrics-breakdown-distinct-zone"]').text()).toBe("–");
  });

  it("asks for a selected label past the cap alone, never re-scanning the first 15", async () => {
    fieldValues.mockImplementation(echoFields);
    wrapper = mountReal({ card: WIDE });
    await flushPromises();
    expect(fieldValues).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ selectedLabel: "tenant_id" });
    await flushPromises();
    expect(fieldValues).toHaveBeenCalledTimes(2);
    expect(lastRequest().fields).toEqual(["tenant_id"]);
    expect(runQuery).toHaveBeenLastCalledWith(
      'sum by (tenant_id) (rate({__name__="http_requests_total"}[4m]))',
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-test="metrics-breakdown-value-tenant_id-tenant_id-0"]').exists(),
      ).toBe(true),
    );

    await wrapper.setProps({ selectedLabel: "a03" });
    await flushPromises();
    expect(fieldValues).toHaveBeenCalledTimes(2);
    expect(runQuery).toHaveBeenLastCalledWith(
      'sum by (a03) (rate({__name__="http_requests_total"}[4m]))',
    );
  });

  it("caps a 20+ label past the cap from its own counts, without waiting for the first 15", async () => {
    fieldValues.mockImplementation(({ fields }: any) =>
      fields.length === 1
        ? Promise.resolve({ data: { hits: [{ field: "tenant_id", values: values("t", 21) }] } })
        : new Promise(() => {}),
    );
    wrapper = mountReal({ card: WIDE, selectedLabel: "tenant_id" });
    await flushPromises();

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      'topk(10, sum by (tenant_id) (rate({__name__="http_requests_total"}[4m])))',
    );
  });

  it("titles the chart with the measure it plots: p90 for a histogram, rate for a counter", async () => {
    wrapper = mountReal({
      card: { ...CARD, name: "lat_bucket", cardKind: CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS },
      selectedLabel: "method",
    });
    await flushPromises();
    expect(wrapper.find('[data-test="metrics-breakdown-chart"]').text()).toContain("p90 by method");
    wrapper.unmount();

    wrapper = mountReal({ selectedLabel: "method" });
    await flushPromises();
    expect(wrapper.find('[data-test="metrics-breakdown-chart"]').text()).toContain(
      "Rate by method",
    );
  });

  it("charts the selected window with a legend, like the overview above it", async () => {
    wrapper = mountReal({ selectedLabel: "method" });
    await flushPromises();
    const chart = wrapper.findComponent({ name: "MetricCardChart" });
    expect(chart.props("timeRange")).toEqual({ start_time: 1_000, end_time: 2_000 });
    expect(chart.props("legend")).toBe(true);
  });

  it("queries once per window, not again when the card is rebuilt unchanged", async () => {
    wrapper = mountReal({ selectedLabel: "method" });
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
});
