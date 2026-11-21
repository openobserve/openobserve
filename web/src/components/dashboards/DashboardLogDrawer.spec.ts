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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";

const findRelatedTelemetry = vi.fn().mockResolvedValue(null);
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    findRelatedTelemetry,
    semanticGroups: ref([]),
    noMatch: ref(false),
    error: ref(null),
  }),
}));
// Each call answers like _search_stream: metadata, then hits, then the end of the stream.
const stream = vi.hoisted(() => ({
  reply: (_req: any, h: any) => {
    h.data(_req, { type: "search_response_metadata", content: { results: { total: 0 } } });
    h.complete(_req, { type: "end" });
  },
  // A track_total_hits request is rewritten to count(*) AS zo_sql_num, one row per partition.
  count: (_req: any, h: any) => {
    h.data(_req, {
      type: "search_response_hits",
      content: { results: { hits: [{ zo_sql_num: 0 }] } },
    });
    h.complete(_req, { type: "end" });
  },
}));
const isCount = (req: any) => req?.queryReq?.query?.track_total_hits === true;
const fetchQueryDataWithHttpStream = vi.fn((req: any, handlers: any) =>
  isCount(req) ? stream.count(req, handlers) : stream.reply(req, handlers),
);
const searchCalls = () =>
  fetchQueryDataWithHttpStream.mock.calls.map(([req]) => req).filter((req) => !isCount(req));
const cancelStreamQueryBasedOnRequestId = vi.fn();
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({ fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId }),
}));
vi.mock("@/services/patterns", () => ({ default: {} }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import DashboardLogDrawer from "@/components/dashboards/DashboardLogDrawer.vue";

const mountDrawer = (features: Record<string, string>, streamType?: string) =>
  shallowMount(DashboardLogDrawer, {
    props: { stream: "app", field: "level", value: "error", startTime: 1, endTime: 2, streamType },
    global: {
      renderStubDefaultSlot: true,
      stubs: { OButton: false },
      plugins: [
        i18n,
        createStore({
          state: { selectedOrganization: { identifier: "org" }, zoConfig: { features } },
        }),
      ],
    },
  });

const openInLogsDisabled = (wrapper: ReturnType<typeof mountDrawer>) =>
  wrapper.find('[data-test="log-explorer-open-in-logs"]').attributes("aria-disabled") === "true";

describe("DashboardLogDrawer related telemetry", () => {
  beforeEach(() => findRelatedTelemetry.mockClear());

  it("makes no correlation call while correlation is license-locked", async () => {
    const wrapper = mountDrawer({ correlation: "locked" });
    await flushPromises();
    await (wrapper.vm as any).$.setupState.openCorrelationFromLog({ _timestamp: 1 });
    expect(findRelatedTelemetry).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "logs"],
    ["metrics", "metrics"],
    ["traces", "traces"],
  ])("stream type %s with %s locked: Open in Logs is disabled with a lock", (streamType, key) => {
    const wrapper = mountDrawer({ [key]: "locked" }, streamType);
    expect(openInLogsDisabled(wrapper)).toBe(true);
    expect(wrapper.find('[data-test="log-explorer-open-in-logs-lock"]').exists()).toBe(true);
  });

  it("Open in Logs stays live while another signal is locked", () => {
    const wrapper = mountDrawer({ traces: "locked" });
    expect(openInLogsDisabled(wrapper)).toBe(false);
    expect(wrapper.find('[data-test="log-explorer-open-in-logs-lock"]').exists()).toBe(false);
  });

  it("looks up related telemetry while correlation is enabled", async () => {
    const wrapper = mountDrawer({ correlation: "enabled" });
    await flushPromises();
    await (wrapper.vm as any).$.setupState.openCorrelationFromLog({ _timestamp: 1 });
    expect(findRelatedTelemetry).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardLogDrawer filters", () => {
  const mountWith = (props: Record<string, unknown>) =>
    shallowMount(DashboardLogDrawer, {
      props: { stream: "app", field: "", value: "", startTime: 1, endTime: 2, ...props },
      global: {
        renderStubDefaultSlot: true,
        plugins: [
          i18n,
          createStore({
            state: {
              selectedOrganization: { identifier: "org" },
              timezone: "UTC",
              zoConfig: { features: {} },
            },
          }),
        ],
      },
    });
  const firstSql = () => searchCalls()[0].queryReq.query.sql;

  beforeEach(() => {
    fetchQueryDataWithHttpStream.mockClear();
  });

  it("ANDs the panel WHERE with every chart filter, escaping values and typing numbers", async () => {
    mountWith({
      baseWhere: "level = 'error' OR code = 5",
      filters: [
        { field: "ns", value: "o'brien" },
        { field: "code", value: 500 },
        { field: "svc", value: null },
      ],
      timeSlice: "bucket",
    });
    await flushPromises();
    expect(firstSql()).toBe(
      `SELECT * FROM "app" WHERE (level = 'error' OR code = 5) AND ns = 'o''brien' AND code = 500 AND svc IS NULL ORDER BY _timestamp DESC`,
    );
  });

  it("chart filters with no panel WHERE and no group-by values search the whole stream", async () => {
    mountWith({ filters: [], timeSlice: "panelRange" });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" ORDER BY _timestamp DESC`);
  });

  it("refuses a chart filter whose field is not a plain identifier", async () => {
    mountWith({ filters: [{ field: "a; DROP", value: 1 }] });
    await flushPromises();
    expect(fetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("shows the Applied row with the slice, the panel filter and each group-by value", () => {
    const t0 = Date.UTC(2026, 10, 5, 10, 5) * 1000;
    const wrapper = mountWith({
      startTime: t0,
      endTime: t0 + 300_000_000,
      baseWhere: "level = 'error'",
      filters: [{ field: "service", value: "cart" }],
      timeSlice: "bucket",
    });
    const applied = wrapper.find('[data-test="log-explorer-applied"]');
    expect(applied.exists()).toBe(true);
    const chips = applied.findAllComponents({ name: "ODimensionChip" });
    expect(chips.map((c) => c.props("value"))).toEqual([
      "10:05–10:10 (clicked bucket)",
      "level = 'error'",
      "cart",
    ]);
  });

  it("table cell path: one field/value predicate and no Applied row, as before", async () => {
    const wrapper = mountWith({ field: "level", value: "error", baseWhere: "a = 1" });
    await flushPromises();
    expect(firstSql()).toBe(
      `SELECT * FROM "app" WHERE (a = 1) AND level = 'error' ORDER BY _timestamp DESC`,
    );
    expect(wrapper.find('[data-test="log-explorer-applied"]').exists()).toBe(false);
  });

  it("table cell path: an empty cell is IS NULL and a number stays bare", async () => {
    mountWith({ field: "level", value: "" });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" WHERE level IS NULL ORDER BY _timestamp DESC`);
    fetchQueryDataWithHttpStream.mockClear();
    mountWith({ field: "code", value: 404 });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" WHERE code = 404 ORDER BY _timestamp DESC`);
  });
});

describe("DashboardLogDrawer streaming search", () => {
  const defaultReply = stream.reply;
  const defaultCount = stream.count;
  const mountIt = (props: Record<string, unknown> = {}) =>
    shallowMount(DashboardLogDrawer, {
      props: { stream: "app", field: "level", value: "error", startTime: 1, endTime: 2, ...props },
      global: {
        renderStubDefaultSlot: true,
        plugins: [
          i18n,
          createStore({
            state: { selectedOrganization: { identifier: "org" }, zoConfig: { features: {} } },
          }),
        ],
      },
    });
  const state = (wrapper: ReturnType<typeof mountIt>) => (wrapper.vm as any).$.setupState;
  const hits = (rows: any[]) => ({
    type: "search_response_hits",
    content: { results: { hits: rows } },
  });
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
  const countOf = (perPartition: number[]) => (req: any, h: any) => {
    perPartition.forEach((n) => h.data(req, hits([{ zo_sql_num: n }])));
    h.complete(req, {});
  };
  const countCalls = () =>
    fetchQueryDataWithHttpStream.mock.calls.map(([req]) => req).filter((req) => isCount(req));

  beforeEach(() => {
    fetchQueryDataWithHttpStream.mockClear();
    cancelStreamQueryBasedOnRequestId.mockClear();
    stream.reply = defaultReply;
    stream.count = defaultCount;
  });

  it("searches _search_stream with the page's offset, a trace id, and collects every chunk", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits([{ a: 1 }]));
      h.data(req, hits([{ a: 2 }]));
      h.complete(req, { type: "end" });
    };
    const wrapper = mountIt();
    await flushPromises();

    const [req] = searchCalls();
    expect(req).toMatchObject({
      type: "search",
      pageType: "logs",
      searchType: "ui",
      org_id: "org",
      queryReq: { query: { start_time: 1, end_time: 2, from: 0, size: 100 } },
    });
    expect(req.queryReq.query.track_total_hits).toBeUndefined();
    expect(req.traceId).toEqual(expect.any(String));
    expect(state(wrapper).events).toEqual([{ a: 1 }, { a: 2 }]);
    expect(state(wrapper).loading).toBe(false);

    await state(wrapper).goToPage(2);
    expect(searchCalls().at(-1).queryReq.query.from).toBe(200);
  });

  it.each([
    ["a chart point", { field: "", value: "", filters: [{ field: "svc", value: "cart" }] }],
    ["a table cell", {}],
  ])(
    "%s: the total is the full match count, so a page smaller than it gets a pager",
    async (_name, props) => {
      stream.reply = (req, h) => {
        const { from, size } = req.queryReq.query;
        h.data(req, hits(rowsOf(Math.min(size, 214 - from))));
        h.complete(req, {});
      };
      stream.count = countOf([150, 64]);
      const wrapper = mountIt(props);
      await flushPromises();

      const [countReq] = countCalls();
      expect(countReq.queryReq.query).toMatchObject({ size: 0, from: 0, track_total_hits: true });
      expect(countReq.queryReq.query.sql).toBe(searchCalls()[0].queryReq.query.sql);
      expect(state(wrapper).total).toBe(214);
      expect(state(wrapper).resultTotalPages).toBe(3);
      expect(wrapper.findComponent({ name: "TablePaginationControls" }).props("totalRows")).toBe(
        214,
      );

      state(wrapper).pageSize = 20;
      await flushPromises();
      expect(state(wrapper).total).toBe(214);
      expect(state(wrapper).resultTotalPages).toBe(11);
      await state(wrapper).goToPage(10);
      expect(searchCalls().at(-1).queryReq.query.from).toBe(200);
      expect(state(wrapper).total).toBe(214);
    },
  );

  it("a failed count leaves the total at the rows seen, never hiding them", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(40)));
      h.complete(req, {});
    };
    stream.count = (req, h) => h.error(req, { type: "error", content: { error: "count failed" } });
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).total).toBe(40);
    expect(state(wrapper).errorMsg).toBe("");
  });

  it("a page turn keeps the count and asks for no new one", async () => {
    stream.count = countOf([500]);
    const wrapper = mountIt();
    await flushPromises();
    expect(countCalls()).toHaveLength(1);
    await state(wrapper).goToPage(3);
    expect(countCalls()).toHaveLength(1);
    expect(state(wrapper).total).toBe(500);
  });

  it("a streaming aggregate replaces its rows with each chunk instead of appending", async () => {
    stream.reply = (req, h) => {
      h.data(req, {
        type: "search_response_metadata",
        content: { results: { streaming_aggs: true, total: 1 } },
      });
      h.data(req, hits([{ zo_cnt: 1 }]));
      h.data(req, hits([{ zo_cnt: 5 }]));
      h.complete(req, { type: "end" });
    };
    const wrapper = mountIt();
    await flushPromises();
    const res = await state(wrapper).streamSearch("histogram", {
      sql: "SELECT 1",
      start_time: 1,
      end_time: 2,
      from: 0,
      size: 500,
    });
    expect(res).toEqual({ hits: [{ zo_cnt: 5 }] });
  });

  it("shows a stream error with the SQL, as the one-shot search did", async () => {
    stream.reply = (req, h) => h.error(req, { type: "error", content: { error: "bad field" } });
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).errorMsg).toContain("bad field");
    expect(state(wrapper).errorMsg).toContain('SELECT * FROM "app"');
    expect(state(wrapper).events).toEqual([]);
    expect(state(wrapper).loading).toBe(false);
  });

  it("a new query cancels the running one and its count, whose late answers are dropped", async () => {
    const pending: any[] = [];
    stream.reply = (req, h) => pending.push([req, h]);
    const pendingCounts: any[] = [];
    stream.count = (req, h) => pendingCounts.push([req, h]);
    const wrapper = mountIt();
    await flushPromises();
    state(wrapper).runQuery();
    await flushPromises();

    for (const [req] of [pending[0], pendingCounts[0]]) {
      expect(cancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith({
        trace_id: req.traceId,
        org_id: "org",
      });
    }
    const answer = ([req, h]: any[], rows: any[]) => {
      h.data(req, hits(rows));
      h.complete(req, {});
    };
    answer(pending[0], [{ old: 1 }]);
    answer(pendingCounts[0], [{ zo_sql_num: 999 }]);
    answer(pending[1], [{ fresh: 1 }]);
    answer(pendingCounts[1], [{ zo_sql_num: 7 }]);
    await flushPromises();
    expect(state(wrapper).events).toEqual([{ fresh: 1 }]);
    expect(state(wrapper).total).toBe(7);
    expect(state(wrapper).loading).toBe(false);
  });

  it("a cancelled or failed page request emits nothing, so it cannot close the drawer", async () => {
    const pending: any[] = [];
    stream.reply = (req, h) => pending.push([req, h]);
    const wrapper = mountIt();
    await flushPromises();
    state(wrapper).goToPage(1);
    state(wrapper).goToPage(0);
    await flushPromises();
    const [req, h] = pending.at(-1);
    h.error(req, { type: "error", content: { error: "boom" } });
    await flushPromises();
    expect(state(wrapper).errorMsg).toContain("boom");
    expect(state(wrapper).loading).toBe(false);
    expect(wrapper.emitted()).toEqual({});
  });

  it("a count that lands before its own rows is never floored by the previous query's rows", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(50)));
      h.complete(req, {});
    };
    stream.count = countOf([50]);
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).total).toBe(50);

    const pending: any[] = [];
    stream.reply = (req, h) => pending.push([req, h]);
    stream.count = countOf([3]);
    state(wrapper).runQuery();
    await flushPromises();
    expect(state(wrapper).total).toBe(3);
    const [req, h] = pending[0];
    h.data(req, hits(rowsOf(3)));
    h.complete(req, {});
    await flushPromises();
    expect(state(wrapper).total).toBe(3);
    expect(state(wrapper).resultTotalPages).toBe(1);
  });

  it("a count that lands after its search failed leaves the error with no pager", async () => {
    stream.reply = (req, h) => h.error(req, { type: "error", content: { error: "bad" } });
    const pendingCounts: any[] = [];
    stream.count = (req, h) => pendingCounts.push([req, h]);
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).errorMsg).toContain("bad");
    const [req, h] = pendingCounts[0];
    h.data(req, hits([{ zo_sql_num: 80 }]));
    h.complete(req, {});
    await flushPromises();
    expect(state(wrapper).total).toBe(0);
  });

  it("surrounding events are put back in ascending time order after streaming", async () => {
    stream.reply = (req, h) => {
      if (req.queryReq.query.sql.includes("ORDER BY _timestamp ASC")) {
        h.data(req, hits([{ _timestamp: 30 }, { _timestamp: 40 }]));
        h.data(req, hits([{ _timestamp: 10 }, { _timestamp: 20 }]));
      }
      h.complete(req, {});
    };
    const wrapper = mountIt();
    await flushPromises();
    await state(wrapper).loadSurrounding({ _timestamp: 20 });
    expect(state(wrapper).surroundEvents.map((e: any) => e._timestamp)).toEqual([10, 20, 30, 40]);
  });

  it("closing the drawer cancels the search still running", async () => {
    const pending: any[] = [];
    stream.reply = (req) => pending.push(req);
    const wrapper = mountIt();
    await flushPromises();
    wrapper.unmount();
    expect(cancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith({
      trace_id: pending[0].traceId,
      org_id: "org",
    });
  });
});
