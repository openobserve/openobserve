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
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "level", type: "Utf8" }] }),
  }),
}));
const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { tab: "t1" } }),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

import DashboardLogDrawer from "@/components/dashboards/DashboardLogDrawer.vue";
import { b64DecodeUnicodeSafe } from "@/utils/zincutils";
import ExplorerResultRow from "@/components/dashboards/pointExplorer/ExplorerResultRow.vue";
import {
  EXPLORER_BACK_KEY,
  createExplorerBack,
} from "@/composables/dashboard/useExplorerDetailKeys";

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
        // The real filter bar: the drawer calls its cancelPendingRun before each run.
        stubs: { ExplorerFilterBar: false },
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
    });
    await flushPromises();
    expect(firstSql()).toBe(
      `SELECT * FROM "app" WHERE (level = 'error' OR code = 5) AND ns = 'o''brien' AND code = 500 AND svc IS NULL ORDER BY _timestamp DESC`,
    );
  });

  it("chart filters with no panel WHERE and no group-by values search the whole stream", async () => {
    mountWith({ filters: [] });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" ORDER BY _timestamp DESC`);
  });

  it("refuses a chart filter whose field is not a plain identifier", async () => {
    mountWith({ filters: [{ field: "a; DROP", value: 1 }] });
    await flushPromises();
    expect(fetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("a chart point shows no Applied row: the time picker and the SQL show what runs", async () => {
    const wrapper = mountWith({
      baseWhere: "level = 'error'",
      filters: [{ field: "service", value: "cart" }],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="log-explorer-applied"]').exists()).toBe(false);
    // The panel filter and the clicked values are still in the query.
    expect(firstSql()).toBe(
      `SELECT * FROM "app" WHERE (level = 'error') AND service = 'cart' ORDER BY _timestamp DESC`,
    );
  });

  describe("filter area: chips or write your own SQL", () => {
    const bar = (w: ReturnType<typeof mountWith>) => w.findComponent({ name: "ExplorerFilterBar" });
    const st = (w: ReturnType<typeof mountWith>) => (w.vm as any).$.setupState;
    const sql = (where: string) =>
      `SELECT * FROM "app"${where ? ` WHERE ${where}` : ""} ORDER BY _timestamp DESC`;
    const openArea = async (w: ReturnType<typeof mountWith>) => {
      await w.find('[data-test="log-explorer-sql-toggle"]').trigger("click");
      await flushPromises();
    };

    it("stays hidden until SQL is clicked, then opens on chips of the panel filter and clicked values", async () => {
      const w = mountWith({
        baseWhere: "level = 'error'",
        filters: [{ field: "svc", value: "cart" }],
      });
      await flushPromises();
      expect(bar(w).exists()).toBe(false);
      await openArea(w);
      expect(bar(w).props()).toMatchObject({
        chipsQuery: "(level = 'error') AND svc = 'cart'",
        ownKind: "sql",
        ownValue: sql("(level = 'error') AND svc = 'cart'"),
        fields: [{ name: "level", type: "string" }],
      });
    });

    it("main's table-cell drawer gets the same area, its cell and the panel filter as chips", async () => {
      const w = mountWith({ field: "level", value: "error", baseWhere: "a = 1" });
      await flushPromises();
      expect(bar(w).exists()).toBe(false);
      await openArea(w);
      expect(bar(w).props("chipsQuery")).toBe("(a = 1) AND level = 'error'");
    });

    it("a chip edit runs the plain query built from it", async () => {
      const w = mountWith({ filters: [{ field: "svc", value: "cart" }] });
      await flushPromises();
      await openArea(w);
      bar(w).vm.$emit("update:chipsQuery", "svc = 'pay' AND code >= 500");
      bar(w).vm.$emit("run");
      await flushPromises();
      expect(searchCalls().at(-1).queryReq.query.sql).toBe(sql("svc = 'pay' AND code >= 500"));
      expect(bar(w).props("ownValue")).toBe(sql("svc = 'pay' AND code >= 500"));
    });

    it("written SQL in the plain shape comes back as chips; any other SQL goes to the chips whole", async () => {
      const w = mountWith({ filters: [{ field: "svc", value: "cart" }] });
      await flushPromises();
      await openArea(w);
      bar(w).vm.$emit("update:ownValue", sql("svc = 'pay'"));
      await flushPromises();
      expect(bar(w).props("chipsQuery")).toBe("svc = 'pay'");
      const custom = `SELECT level, count(*) AS n FROM "app" GROUP BY level`;
      bar(w).vm.$emit("update:ownValue", custom);
      await flushPromises();
      // The builder shows its "can't draw this" banner for it; the SQL itself is kept and runs.
      expect(bar(w).props("chipsQuery")).toBe(custom);
      bar(w).vm.$emit("run");
      await flushPromises();
      expect(searchCalls().at(-1).queryReq.query.sql).toBe(custom);
    });

    it("Open in Logs carries the effective SQL from chips and from written SQL", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const w = mountWith({ filters: [{ field: "svc", value: "cart" }] });
      await flushPromises();
      const opened = () => {
        const url = new URL(String(open.mock.calls.at(-1)?.[0]));
        return b64DecodeUnicodeSafe(url.searchParams.get("query") ?? "");
      };
      await openArea(w);
      bar(w).vm.$emit("update:chipsQuery", "svc = 'pay'");
      await flushPromises();
      await w.find('[data-test="log-explorer-open-in-logs"]').trigger("click");
      expect(opened()).toBe(sql("svc = 'pay'"));
      bar(w).vm.$emit("update:ownValue", "SELECT 1");
      await flushPromises();
      await w.find('[data-test="log-explorer-open-in-logs"]').trigger("click");
      expect(opened()).toBe("SELECT 1");
      expect(st(w).activeSql()).toBe("SELECT 1");
      open.mockRestore();
    });
  });

  it("table cell path: one field/value predicate and no Applied row, as before", async () => {
    const wrapper = mountWith({ field: "level", value: "error", baseWhere: "a = 1" });
    await flushPromises();
    expect(firstSql()).toBe(
      `SELECT * FROM "app" WHERE (a = 1) AND level = 'error' ORDER BY _timestamp DESC`,
    );
    expect(wrapper.find('[data-test="log-explorer-applied"]').exists()).toBe(false);
  });

  it("table cell path: a NULL cell is IS NULL, an empty one = '', and a number stays bare", async () => {
    mountWith({ field: "level", value: null });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" WHERE level IS NULL ORDER BY _timestamp DESC`);
    fetchQueryDataWithHttpStream.mockClear();
    mountWith({ field: "level", value: "" });
    await flushPromises();
    expect(firstSql()).toBe(`SELECT * FROM "app" WHERE level = '' ORDER BY _timestamp DESC`);
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
        // The shared explorer pager renders for real, so its page count is the one shown.
        stubs: { ExplorerResultsPager: false },
        plugins: [
          i18n,
          createStore({
            state: { selectedOrganization: { identifier: "org" }, zoConfig: { features: {} } },
          }),
        ],
      },
    });
  const state = (wrapper: ReturnType<typeof mountIt>) => (wrapper.vm as any).$.setupState;
  const pagerPages = (wrapper: ReturnType<typeof mountIt>) =>
    wrapper.findComponent({ name: "TablePaginationControls" }).props("pagesNumber");
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
      expect(pagerPages(wrapper)).toBe(3);
      expect(wrapper.findComponent({ name: "TablePaginationControls" }).props("totalRows")).toBe(
        214,
      );

      state(wrapper).pageSize = 20;
      await flushPromises();
      expect(state(wrapper).total).toBe(214);
      expect(pagerPages(wrapper)).toBe(11);
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
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(req.queryReq.query.size)));
      h.complete(req, {});
    };
    stream.count = countOf([500]);
    const wrapper = mountIt();
    await flushPromises();
    expect(countCalls()).toHaveLength(1);
    await state(wrapper).goToPage(3);
    expect(countCalls()).toHaveLength(1);
    expect(state(wrapper).total).toBe(500);
  });

  it("an empty page past an exactly full last page names no range, so never 'N-(N-1)'", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(req.queryReq.query.from === 0 ? 100 : 0)));
      h.complete(req, {});
    };
    stream.count = (_req, _h) => {};
    const wrapper = mountIt();
    await flushPromises();
    await state(wrapper).goToPage(1);
    await flushPromises();
    const controls = wrapper.findComponent({ name: "TablePaginationControls" });
    expect(controls.props("countText")).toBe("Nothing on this page");
    expect(controls.props("isFirstPage")).toBe(false);
  });

  it("Next past a page's last event opens the next page's first; Previous comes back", async () => {
    stream.reply = (req, h) => {
      const { from, size } = req.queryReq.query;
      h.data(req, hits(rowsOf(size).map((_r, i) => ({ i: from + i }))));
      h.complete(req, {});
    };
    stream.count = countOf([203]);
    const wrapper = mountIt();
    await flushPromises();
    state(wrapper).openEventDetail(state(wrapper).events[99]);
    await flushPromises();
    expect(state(wrapper).detailPosition).toBe("100 / 203");
    expect(state(wrapper).hasNext).toBe(true);
    await state(wrapper).goNext();
    await flushPromises();
    expect(state(wrapper).page).toBe(1);
    expect(state(wrapper).selectedEvent).toEqual({ i: 100 });
    expect(state(wrapper).detailPosition).toBe("101 / 203");
    expect(state(wrapper).hasPrev).toBe(true);
    await state(wrapper).goPrev();
    await flushPromises();
    expect(state(wrapper).page).toBe(0);
    expect(state(wrapper).selectedEvent).toEqual({ i: 99 });
    // The true first event has no Previous.
    state(wrapper).openEventDetail(state(wrapper).events[0]);
    expect(state(wrapper).hasPrev).toBe(false);
  });

  it("Next stops at the true last event", async () => {
    stream.reply = (req, h) => {
      const { from } = req.queryReq.query;
      h.data(req, hits(rowsOf(from === 0 ? 100 : 3).map((_r, i) => ({ i: from + i }))));
      h.complete(req, {});
    };
    stream.count = countOf([103]);
    const wrapper = mountIt();
    await flushPromises();
    await state(wrapper).goToPage(1);
    state(wrapper).openEventDetail(state(wrapper).events[2]);
    expect(state(wrapper).detailPosition).toBe("103 / 103");
    expect(state(wrapper).hasNext).toBe(false);
  });

  it("no rows: the total is 0 and there is no pager", async () => {
    stream.count = countOf([100]);
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).total).toBe(0);
    expect(wrapper.find("[data-test='explorer-results-pager']").exists()).toBe(false);
  });

  it("a full page waits for its count ('x-y of …'); a failed count leaves just the range", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(100)));
      h.complete(req, {});
    };
    const pendingCounts: any[] = [];
    stream.count = (req, h) => pendingCounts.push([req, h]);
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).total).toBeNull();
    const count = () =>
      wrapper.findComponent({ name: "TablePaginationControls" }).props("countText");
    expect(count()).toBe("1-100 of …");
    const [req, h] = pendingCounts[0];
    h.error(req, { type: "error", content: { error: "count failed" } });
    await flushPromises();
    expect(state(wrapper).total).toBeNull();
    expect(count()).toBe("1-100");
  });

  it("a new query or time range never keeps the old total; the old count's late answer is dropped", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(100)));
      h.complete(req, {});
    };
    stream.count = countOf([500]);
    const wrapper = mountIt();
    await flushPromises();
    expect(state(wrapper).total).toBe(500);
    const pendingCounts: any[] = [];
    stream.count = (req, h) => pendingCounts.push([req, h]);
    state(wrapper).onDateChange({ startTime: 5, endTime: 9 });
    await flushPromises();
    expect(state(wrapper).total).toBeNull();
    // Another rerun cancels that count; its late answer changes nothing.
    state(wrapper).runQuery();
    await flushPromises();
    const [oldReq, oldH] = pendingCounts[0];
    oldH.data(oldReq, hits([{ zo_sql_num: 999 }]));
    oldH.complete(oldReq, {});
    await flushPromises();
    expect(state(wrapper).total).toBeNull();
    const [req, h] = pendingCounts[1];
    h.data(req, hits([{ zo_sql_num: 120 }]));
    h.complete(req, {});
    await flushPromises();
    expect(state(wrapper).total).toBe(120);
  });

  it("the detail counter is the event's place in the whole result, out of the total once known", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(100)));
      h.complete(req, {});
    };
    const pendingCounts: any[] = [];
    stream.count = (req, h) => pendingCounts.push([req, h]);
    const wrapper = mountIt();
    await flushPromises();
    await state(wrapper).goToPage(1);
    state(wrapper).openEventDetail(state(wrapper).events[1]);
    await flushPromises();
    expect(state(wrapper).detailPosition).toBe("102");
    const [req, h] = pendingCounts[0];
    h.data(req, hits([{ zo_sql_num: 203 }]));
    h.complete(req, {});
    await flushPromises();
    expect(state(wrapper).detailPosition).toBe("102 / 203");
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
    expect(state(wrapper).errorMsg).toBe("bad field");
    expect(state(wrapper).errorSql).toContain('SELECT * FROM "app"');
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
    answer(pending[1], rowsOf(100));
    answer(pendingCounts[1], [{ zo_sql_num: 300 }]);
    await flushPromises();
    expect(state(wrapper).events).toEqual(rowsOf(100));
    expect(state(wrapper).total).toBe(300);
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
    expect(pagerPages(wrapper)).toBe(1);
  });

  it("a row opens the event detail, and its chevron only toggles the inline JSON", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(2)));
      h.complete(req, {});
    };
    const wrapper = mountIt();
    await flushPromises();
    const row = wrapper.findAllComponents(ExplorerResultRow)[1];
    row.vm.$emit("toggle");
    await flushPromises();
    expect(state(wrapper).isResultExpanded(1)).toBe(true);
    expect(state(wrapper).selectedEvent).toBeNull();
    row.vm.$emit("open");
    await flushPromises();
    expect(state(wrapper).selectedEvent).toEqual({ i: 1 });
  });

  it("each result is the shared explorer row, the one the Metrics Explorer uses", async () => {
    stream.reply = (req, h) => {
      h.data(req, hits(rowsOf(3)));
      h.complete(req, {});
    };
    const wrapper = mountIt();
    await flushPromises();
    const rows = wrapper.findAllComponents(ExplorerResultRow);
    expect(rows).toHaveLength(3);
    expect(rows[0].props("openDataTest")).toBe("log-explorer-row-open");
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

describe("DashboardLogDrawer modes", () => {
  const mountMode = (mode?: "logs" | "traces" | "metrics") =>
    shallowMount(DashboardLogDrawer, {
      props: { stream: "app", field: "", value: "", startTime: 1, endTime: 2, filters: [], mode },
      global: {
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

  beforeEach(() => fetchQueryDataWithHttpStream.mockClear());

  it.each(["traces", "metrics"] as const)(
    "%s mode hands the body to its explorer and runs no logs search",
    async (mode) => {
      const wrapper = mountMode(mode);
      await flushPromises();
      expect(searchCalls()).toHaveLength(0);
      expect(wrapper.find('[data-test="log-explorer-sql-toggle"]').exists()).toBe(false);
    },
  );

  it("no mode is logs, as the table-cell explorer opens it", async () => {
    const wrapper = mountMode();
    await flushPromises();
    expect(searchCalls()).toHaveLength(1);
    expect(wrapper.find('[data-test="log-explorer-sql-toggle"]').exists()).toBe(true);
  });
});

describe("DashboardLogDrawer Copy link", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const EVENT_TS = 1_700_000_123_456_789;
  const mountCopy = (props: Record<string, unknown>) =>
    shallowMount(DashboardLogDrawer, {
      props: { stream: "app", startTime: 1, endTime: 2, ...props },
      global: {
        renderStubDefaultSlot: true,
        stubs: { OButton: false },
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
  const copyLinkOf = async (wrapper: ReturnType<typeof mountCopy>) => {
    await flushPromises();
    (wrapper.vm as any).$.setupState.selectedEvent = { _timestamp: EVENT_TS, level: "error" };
    await flushPromises();
    await wrapper.find('[data-test="log-explorer-detail-copy-link"]').trigger("click");
    return writeText.mock.calls.at(-1)?.[0] as string;
  };

  beforeEach(() => {
    writeText.mockClear();
    // The test setup installs navigator.clipboard as writable, not configurable.
    (navigator as any).clipboard = { writeText };
  });

  it("a chart point's log links to that log on the Logs page, over the second holding it", async () => {
    const wrapper = mountCopy({
      field: "",
      value: "",
      filters: [{ field: "svc", value: "cart" }],
      mode: "logs",
    });
    const url = new URL(await copyLinkOf(wrapper));
    expect(url.pathname).toBe("/logs");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      org_identifier: "org",
      stream: "app",
      stream_type: "logs",
      sql_mode: "true",
      from: "1700000123000000",
      to: "1700000124000000",
    });
    expect(Number(q.from)).toBeLessThanOrEqual(EVENT_TS);
    expect(Number(q.to)).toBeGreaterThan(EVENT_TS);
    expect(atob(q.query)).toBe(`SELECT * FROM "app" WHERE svc = 'cart' ORDER BY _timestamp DESC`);
  });

  it("a table cell's log keeps copying the current URL, as before", async () => {
    const wrapper = mountCopy({ field: "level", value: "error" });
    expect(await copyLinkOf(wrapper)).toBe(window.location.href);
  });
});

describe("DashboardLogDrawer event URL param", () => {
  const mountPath = (props: Record<string, unknown>) =>
    shallowMount(DashboardLogDrawer, {
      props: { stream: "app", startTime: 1, endTime: 2, ...props },
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
  const openAndClose = async (wrapper: ReturnType<typeof mountPath>) => {
    await flushPromises();
    routerReplace.mockClear();
    const state = (wrapper.vm as any).$.setupState;
    state.openEventDetail({ _timestamp: 42 });
    await flushPromises();
    const opened = routerReplace.mock.calls.map(([to]) => to);
    routerReplace.mockClear();
    state.closeEventDetail();
    await flushPromises();
    return { opened, closed: routerReplace.mock.calls.map(([to]) => to) };
  };

  it("a chart point's log never writes or deletes cell_event_ts", async () => {
    const wrapper = mountPath({ field: "", value: "", filters: [{ field: "svc", value: "cart" }] });
    expect(await openAndClose(wrapper)).toEqual({ opened: [], closed: [] });
  });

  it("a table cell's log still writes cell_event_ts on open and deletes it on close", async () => {
    const wrapper = mountPath({ field: "level", value: "error" });
    expect(await openAndClose(wrapper)).toEqual({
      opened: [{ query: { tab: "t1", cell_event_ts: "42" } }],
      closed: [{ query: { tab: "t1" } }],
    });
  });
});

describe("DashboardLogDrawer: the drawer's × and Escape from an open log (table cell)", () => {
  const mountCell = () => {
    const explorerBack = createExplorerBack();
    const wrapper = shallowMount(DashboardLogDrawer, {
      props: { stream: "app", field: "level", value: "error", startTime: 1, endTime: 2 },
      attachTo: document.body,
      global: {
        renderStubDefaultSlot: true,
        provide: { [EXPLORER_BACK_KEY as symbol]: explorerBack },
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
    return { wrapper, explorerBack, state: () => (wrapper.vm as any).$.setupState };
  };

  it("× goes back to the list (clearing the event from the URL); the next × closes", async () => {
    const { wrapper, explorerBack, state } = mountCell();
    await flushPromises();
    state().openEventDetail({ _timestamp: 42 });
    await flushPromises();
    expect(state().detailOpen).toBe(true);
    routerReplace.mockClear();
    expect(explorerBack.back()).toBe(true);
    await flushPromises();
    expect(state().detailOpen).toBe(false);
    expect(routerReplace).toHaveBeenCalledWith({ query: { tab: "t1" } });
    expect(explorerBack.back()).toBe(false);
    wrapper.unmount();
  });

  it("Escape in a field inside the open log goes back in one press", async () => {
    const { wrapper, state } = mountCell();
    await flushPromises();
    state().openEventDetail({ _timestamp: 42 });
    await flushPromises();
    const drawerEscape = vi.fn();
    window.addEventListener("keydown", drawerEscape);
    const field = document.createElement("input");
    wrapper.element.appendChild(field);
    field.focus();
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    window.removeEventListener("keydown", drawerEscape);
    expect(state().detailOpen).toBe(false);
    expect(drawerEscape).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
