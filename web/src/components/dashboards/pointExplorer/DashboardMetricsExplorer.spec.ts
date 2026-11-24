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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const MIN = 60_000_000;

// _search_stream answers: the sample rows for a search, a count for track_total_hits.
const stream = vi.hoisted(() => ({
  rows: [] as any[],
  count: null as number | null,
  hold: false,
}));
const isCount = (req: any) => req?.queryReq?.query?.track_total_hits === true;
const sqlOf = (req: any) => String(req?.queryReq?.query?.sql ?? "");
const fetchQueryDataWithHttpStream = vi.fn((req: any, h: any) => {
  if (stream.hold && !isCount(req)) return;
  const hits = isCount(req) ? [{ zo_sql_num: stream.count ?? stream.rows.length }] : stream.rows;
  h.data(req, { type: "search_response_hits", content: { results: { hits } } });
  h.complete(req, { type: "end" });
});
const cancelStreamQueryBasedOnRequestId = vi.fn();
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({ fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId }),
}));
const schemas = vi.hoisted(() => ({
  cpu: {
    schema: [{ name: "pod" }, { name: "service_name" }, { name: "value" }],
    metrics_meta: { metric_type: "gauge" },
  },
  requests_total: {
    schema: [{ name: "pod" }, { name: "value" }],
    metrics_meta: { metric_type: "counter" },
  },
}));
const getStreams = vi
  .fn()
  .mockResolvedValue({ list: [{ name: "cpu" }, { name: "requests_total" }] });
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn((name: string) => Promise.resolve((schemas as any)[name] ?? null)),
    getStreams,
  }),
}));
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    findRelatedTelemetry: vi.fn().mockResolvedValue(null),
    semanticGroups: ref([]),
    noMatch: ref(false),
    error: ref(null),
  }),
}));
const resolve = vi.fn((to: any) => ({ href: `/web/${to.name}` }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ resolve, push: vi.fn(), replace: vi.fn(), currentRoute: { value: {} } }),
  useRoute: () => ({ query: {} }),
}));

import { b64DecodeUnicodeSafe } from "@/utils/zincutils";
// The real detail is the Logs page's DetailTable; a light stand-in keeps its lazy load cheap here.
vi.mock("@/plugins/logs/DetailTable.vue", () => ({
  default: { name: "DetailTable", template: "<div />" },
}));

import DashboardMetricsExplorer from "./DashboardMetricsExplorer.vue";
import ExplorerResultRow from "./ExplorerResultRow.vue";
import ExplorerDetailSkeleton from "./ExplorerDetailSkeleton.vue";
import ExplorerResultsPager from "./ExplorerResultsPager.vue";

const sample = (ts: number, pod = "a", value = 1) => ({
  _timestamp: ts,
  __name__: "cpu",
  pod,
  service_name: "cart",
  value,
});

const DetailTableStub = {
  name: "DetailTable",
  props: [
    "modelValue",
    "streamType",
    "leadingTabs",
    "initialTab",
    "correlationProps",
    "hiddenTabs",
  ],
  template: "<div data-test='detail-table-stub' />",
};

describe("DashboardMetricsExplorer", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    stream.rows = [sample(103 * MIN), sample(90 * MIN, "b")];
    stream.count = null;
    stream.hold = false;
    fetchQueryDataWithHttpStream.mockClear();
    cancelStreamQueryBasedOnRequestId.mockClear();
    getStreams.mockClear();
  });
  afterEach(() => wrapper?.unmount());

  const mountExplorer = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DashboardMetricsExplorer, {
      props: {
        stream: "cpu",
        filters: [
          { field: "service_name", value: "cart" },
          { field: "k8s_namespace", value: "shop" },
        ],
        startTime: 100 * MIN,
        endTime: 105 * MIN,
        ...props,
      },
      attachTo: document.body,
      global: {
        plugins: [i18n, store],
        stubs: {
          DateTime: true,
          QueryEditor: true,
          JsonPreview: true,
          DetailTable: DetailTableStub,
        },
      },
    });
    return wrapper;
  };
  const searches = () =>
    fetchQueryDataWithHttpStream.mock.calls.map(([r]) => r).filter((r) => !isCount(r));

  it("lists the samples of exactly the clicked bucket, as the logs and traces modes do", async () => {
    mountExplorer();
    await flushPromises();
    const query = searches()[0].queryReq.query;
    expect(query.start_time).toBe(100 * MIN);
    expect(query.end_time).toBe(105 * MIN);
    expect(searches()[0].pageType).toBe("metrics");
    const count = fetchQueryDataWithHttpStream.mock.calls.map(([r]) => r).find(isCount);
    expect(count.queryReq.query).toMatchObject({ start_time: 100 * MIN, end_time: 105 * MIN });
    // No Applied row: the time picker and the SQL editor show what runs.
    expect(wrapper.find("[data-test='metrics-explorer-applied']").exists()).toBe(false);
  });

  it("a PromQL point lists the readings behind it", async () => {
    mountExplorer({ startTime: 95 * MIN, endTime: 100 * MIN });
    await flushPromises();
    expect(searches()[0].queryReq.query).toMatchObject({
      start_time: 95 * MIN,
      end_time: 100 * MIN,
    });
  });

  it("drops a clicked label the metric lacks from the query", async () => {
    mountExplorer();
    await flushPromises();
    expect(sqlOf(searches()[0])).toBe(
      `SELECT * FROM "cpu" WHERE service_name = 'cart' ORDER BY _timestamp DESC`,
    );
  });

  it("lists raw samples with a pager total, every row untinted like the Logs rows", async () => {
    mountExplorer();
    await flushPromises();
    const rows = wrapper.findAll("[data-test='metrics-explorer-row']");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.classes()).not.toContain("bg-accent/5"));
    expect(wrapper.vm.total).toBe(2);
  });

  it("uses the Logs Explorer's pager: records per page and 'x-y of N', no nav on one page", async () => {
    mountExplorer();
    await flushPromises();
    const pager = wrapper.findComponent(ExplorerResultsPager);
    expect(pager.props()).toMatchObject({ page: 0, pageSize: 100, total: 2 });
    expect(pager.find("[data-test='dashboard-table-rows-per-page-label']").text()).toBe(
      "Records per page",
    );
    expect(pager.find("[data-test='dashboard-table-row-count']").text()).toBe("1-2 of 2");
    expect(pager.find("[data-test='dashboard-table-pagination-next-page']").exists()).toBe(false);
  });

  it("the pager pages through the count, and a page turn cancels the search in flight", async () => {
    stream.count = 288;
    mountExplorer();
    await flushPromises();
    const pager = () => wrapper.findComponent(ExplorerResultsPager);
    expect(pager().find("[data-test='dashboard-table-row-count']").text()).toBe("1-100 of 288");

    stream.hold = true;
    await pager().find("[data-test='dashboard-table-pagination-next-page']").trigger("click");
    await flushPromises();
    expect(searches().at(-1).queryReq.query).toMatchObject({ from: 100, size: 100 });
    expect(pager().find("[data-test='dashboard-table-row-count']").text()).toBe("101-200 of 288");

    await pager().find("[data-test='dashboard-table-pagination-last-page']").trigger("click");
    await flushPromises();
    expect(cancelStreamQueryBasedOnRequestId).toHaveBeenCalledTimes(1);
    expect(cancelStreamQueryBasedOnRequestId.mock.calls[0][0].trace_id).toBe(
      searches().at(-2).traceId,
    );
    expect(searches().at(-1).queryReq.query).toMatchObject({ from: 200, size: 100 });
    expect(pager().find("[data-test='dashboard-table-row-count']").text()).toBe("201-288 of 288");
  });

  const runSqlEdit = async (sql: string) => {
    await wrapper.find("[data-test='metrics-explorer-query-toggle']").trigger("click");
    const editor = wrapper.findComponent({ name: "QueryEditor" });
    editor.vm.$emit("update:query", sql);
    editor.vm.$emit("run-query");
    await flushPromises();
  };

  it("Open in Metrics carries an edited SQL to the Metrics page; unedited it opens the metric", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mountExplorer();
    await flushPromises();
    const toolbar = () => wrapper.findComponent({ name: "ExplorerToolbar" });
    toolbar().vm.$emit("open");
    expect(String(open.mock.calls.at(-1)?.[0])).toContain("/web/metrics");

    const sql = `SELECT * FROM "cpu" WHERE value > 5 ORDER BY _timestamp DESC`;
    await runSqlEdit(sql);
    toolbar().vm.$emit("open");
    const url = new URL(String(open.mock.calls.at(-1)?.[0]));
    expect(url.pathname).toBe("/metrics");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      query_type: "sql",
      chart_type: "table",
      stream_name: "cpu",
      from: String(100 * MIN),
      to: String(105 * MIN),
    });
    expect(b64DecodeUnicodeSafe(q.query)).toBe(sql);
    open.mockRestore();
  });

  it("a new time range reruns the list over it", async () => {
    mountExplorer();
    await flushPromises();
    const toolbar = wrapper.findComponent({ name: "ExplorerToolbar" });
    toolbar.vm.$emit("dateChange", { startTime: 90 * MIN, endTime: 110 * MIN });
    await flushPromises();
    expect(searches().at(-1).queryReq.query).toMatchObject({
      start_time: 90 * MIN,
      end_time: 110 * MIN,
    });
  });

  it("a row click opens the sample; the left chevron only shows its JSON inline", async () => {
    mountExplorer();
    await flushPromises();
    const row = () => wrapper.findAllComponents(ExplorerResultRow)[0];
    await row().find(".dld-expand-btn").trigger("click");
    expect(wrapper.find("[data-test='metrics-explorer-detail']").exists()).toBe(false);
    expect(wrapper.vm.expanded.has(0)).toBe(true);
    await row().trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-test='metrics-explorer-detail']").exists()).toBe(true);
  });

  it("rows are the Logs Explorer's rows: same component, classes and controls", async () => {
    mountExplorer();
    await flushPromises();
    const rows = wrapper.findAllComponents(ExplorerResultRow);
    expect(rows).toHaveLength(2);
    expect(rows[0].classes()).toEqual(
      expect.arrayContaining(["dld-result-row", "py-1", "px-2", "gap-2", "border-b"]),
    );
    expect(rows[0].find(".dld-expand-btn").exists()).toBe(true);
    expect(rows[0].find("[data-test='metrics-explorer-row-open']").exists()).toBe(true);
  });

  it("a sample opened before the detail has loaded paints its header and a tab skeleton", async () => {
    wrapper = mount(DashboardMetricsExplorer, {
      props: {
        stream: "cpu",
        filters: [],
        startTime: 100 * MIN,
        endTime: 105 * MIN,
      },
      attachTo: document.body,
      global: {
        plugins: [i18n, store],
        stubs: { DateTime: true, QueryEditor: true, JsonPreview: true },
      },
    });
    wrapper.vm.openSample(sample(103 * MIN));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='metrics-explorer-detail']").exists()).toBe(true);
    expect(wrapper.findComponent(ExplorerDetailSkeleton).exists()).toBe(true);
  });

  it("the header has no metric switch, dropdown or name, and no PromQL line", async () => {
    mountExplorer();
    await flushPromises();
    expect(wrapper.find("[data-test='metrics-explorer-metric']").exists()).toBe(false);
    expect(wrapper.find("[data-test='metrics-explorer-metric-picker']").exists()).toBe(false);
    expect(wrapper.find("[data-test='metrics-explorer-picker-tab']").exists()).toBe(false);
    expect(wrapper.find("[data-test='metrics-explorer-promql']").exists()).toBe(false);
    expect(wrapper.find("[data-test='metrics-explorer-promql-copy']").exists()).toBe(false);
    // Nothing to pick from, so the metric list is never fetched.
    expect(getStreams).not.toHaveBeenCalled();
  });

  it("a correlated open reads its first related metric, with its labels applied", async () => {
    // The drilldown hands over the first related metric as the stream (see usePanelDrilldown).
    mountExplorer({ stream: "requests_total", filters: [{ field: "pod", value: "a" }] });
    await flushPromises();
    expect(sqlOf(searches()[0])).toBe(
      `SELECT * FROM "requests_total" WHERE pod = 'a' ORDER BY _timestamp DESC`,
    );
  });

  it("a sample opens on JSON, with JSON · Table · Logs · Traces and no Chart or Metrics tab", async () => {
    mountExplorer();
    await flushPromises();
    const before = searches().length;
    await wrapper.findAll("[data-test='metrics-explorer-row-open']")[0].trigger("click");
    await flushPromises();
    const detail = wrapper.findComponent({ name: "DetailTable" });
    expect(detail.props("initialTab")).toBe("json");
    expect(detail.props("leadingTabs") ?? []).toEqual([]);
    expect(detail.props("hiddenTabs")).toEqual(["correlated-metrics"]);
    expect(detail.props("streamType")).toBe("metrics");
    // Opening a sample fetches nothing more: there is no series chart.
    expect(searches()).toHaveLength(before);
    expect(wrapper.find("[data-test='metrics-explorer-detail-position']").text()).toBe("1 / 2");
  });

  it("Escape returns from a sample to the list", async () => {
    mountExplorer();
    await flushPromises();
    await wrapper.findAll("[data-test='metrics-explorer-row-open']")[0].trigger("click");
    await flushPromises();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(wrapper.find("[data-test='metrics-explorer-detail']").exists()).toBe(false);
  });
});
