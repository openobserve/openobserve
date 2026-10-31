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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";

const mockSearch = vi.fn();

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org" }, zoConfig: {} } }),
}));
vi.mock("@/services/search", () => ({
  default: { search: (...a: unknown[]) => mockSearch(...a) },
}));

import useRumOverviewData from "./useRumOverviewData";

type Hits = Record<string, unknown>[];
type Responder = (sql: string) => Hits | Error | { status: number };

const SCHEMA = new Set([
  "service",
  "env",
  "version",
  "session_id",
  "view_id",
  "view_url",
  "view_error_count",
  "view_largest_contentful_paint",
  "view_interaction_to_next_paint",
  "view_cumulative_layout_shift",
  "user_agent_user_agent_family",
  "user_agent_user_agent_major",
  "geo_info_country",
  "action_frustration_type",
  "error_message",
]);

const HOUR_MS = 3_600_000;
const START = new Date(1_700_000_000_000);
const END = new Date(1_700_000_000_000 + 24 * HOUR_MS);

const vitalsRow = (views: number) => ({
  views,
  lcp_p50: 1e9,
  lcp_p75: 2e9,
  lcp_p95: 3e9,
  lcp_n: views,
  lcp_good: views,
  lcp_poor: 0,
  inp_p50: 1e8,
  inp_p75: 3e8,
  inp_p95: 4e8,
  inp_n: views,
  inp_good: 0,
  inp_poor: 0,
  cls_p50: 0.01,
  cls_p75: 0.02,
  cls_p95: 0.03,
  cls_n: views,
  cls_good: views,
  cls_poor: 0,
});

let responder: Responder;

const setup = async (opts: { pagesVisible?: boolean; filters?: Record<string, string[]> } = {}) => {
  mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
    const out = responder(args.query.query.sql);
    if (out instanceof Error) throw out;
    if (!Array.isArray(out)) throw { response: { status: out.status, data: { message: "no" } } };
    return { data: { hits: out } };
  });
  const data = useRumOverviewData(ref({ start_time: START, end_time: END }), ref(SCHEMA));
  if (opts.filters) data.filters.value = { service: [], env: [], version: [], ...opts.filters };
  if (opts.pagesVisible !== false) data.markPagesVisible();
  await data.loadAll();
  await flushPromises();
  return data;
};

const sqls = () => mockSearch.mock.calls.map((c) => c[0].query.query.sql as string);
const windowOf = (needle: string) =>
  mockSearch.mock.calls
    .filter((c) => c[0].query.query.sql.includes(needle))
    .map((c) => [c[0].query.query.start_time, c[0].query.query.end_time]);

const START_US = START.getTime() * 1000;
const END_US = END.getTime() * 1000;
const PREV_US = START_US - (END_US - START_US);

const isVitals = (sql: string) => sql.includes("approx_percentile_cont(lcp, 0.5)");
const isKpi = (sql: string) => sql.startsWith("WITH e AS (SELECT CASE WHEN _timestamp");
const isSeries = (sql: string) => sql.includes("histogram");

const kpiRows = (): Hits => [
  { w: 1, gv: 1, sessions: 200, err_sessions: 20, errors: 40, unhandled: 10, rage: 7, dead: 3 },
  { w: 0, gv: 1, sessions: 150, err_sessions: 10, errors: 30, unhandled: 5, rage: 2, dead: 1 },
  {
    w: 1,
    gv: 0,
    version: "2.0",
    first_seen: 1_700_000_000_000_000 + 12 * HOUR_MS * 1000,
    sessions: 100,
    err_sessions: 10,
  },
  {
    w: 1,
    gv: 0,
    version: "1.0",
    first_seen: 1_700_000_000_000_000 + 1000,
    sessions: 100,
    err_sessions: 5,
  },
  { w: 1, gv: 0, version: "0.9", first_seen: 1_700_000_000_000_000, sessions: 3, err_sessions: 0 },
  { w: 0, gv: 0, version: "3.0", first_seen: 1_699_990_000_000_000, sessions: 9, err_sessions: 0 },
];

const healthy: Responder = (sql) => {
  if (isVitals(sql))
    return [
      { w: 1, ...vitalsRow(500) },
      { w: 0, ...vitalsRow(400) },
    ];
  if (isKpi(sql)) return kpiRows();
  if (isSeries(sql)) {
    return [
      { bucket: "2023-11-14 22:00:00", sessions: 10, err_sessions: 1, errors: 2, unhandled: 1 },
      { bucket: "2023-11-15 00:00:00", sessions: 20, err_sessions: 2, errors: 4, unhandled: 2 },
    ];
  }
  if (sql.includes("GROUP BY pg"))
    return [{ pg: "/checkout", views: 300, lcp: 3e9, inp: 3e8, cls: 0.05, errors: 12, bad: 120 }];
  return [];
};

describe("useRumOverviewData", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    responder = healthy;
  });

  it("derives ok statuses and maps both windows from one vitals and one KPI query", async () => {
    const d = await setup();
    expect(d.status.value.verdict).toBe("ok");
    expect(d.vitals.value?.views).toBe(500);
    expect(d.vitalsPrev.value?.views).toBe(400);
    expect(d.vitals.value?.lcp.p75).toBe(2e9);
    expect(d.status.value.kpis).toBe("ok");
    expect(d.totals.value.cur).toEqual({ sessions: 200, errorFree: 90, errors: 40, unhandled: 10 });
    expect(d.totals.value.prev?.sessions).toBe(150);
    expect(d.frustration.value).toEqual({ cur: { rage: 7, dead: 3 }, prev: { rage: 2, dead: 1 } });
    expect(d.pageState.value).toBe("ok");
  });

  it("issues eight requests per load, each scanning once", async () => {
    await setup();
    const all = sqls();
    expect(all).toHaveLength(8);
    expect(all.filter(isVitals)).toHaveLength(1);
    expect(all.filter(isKpi)).toHaveLength(1);
    expect(all.filter(isSeries)).toHaveLength(1);
    expect(all.filter((q) => q.includes("GROUPING SETS ((s0_0, s0_1)"))).toHaveLength(1);
    expect(all.filter((q) => q.includes("MIN(_timestamp) AS first_seen"))).toHaveLength(0);
  });

  it("spans the previous and current window in the vitals and KPI queries", async () => {
    await setup();
    expect(windowOf("approx_percentile_cont(lcp, 0.5)")).toEqual([[PREV_US, END_US]]);
    expect(windowOf("WITH e AS (SELECT CASE WHEN _timestamp")).toEqual([[PREV_US, END_US]]);
    expect(windowOf("histogram")).toEqual([[START_US, END_US]]);
    expect(sqls().find(isKpi)).toContain(`CASE WHEN _timestamp >= ${START_US} THEN 1 ELSE 0 END`);
  });

  it("starts segments, pages and options only after the verdict and KPI queries return", async () => {
    const gates: (() => void)[] = [];
    mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
      const sql = args.query.query.sql;
      if (isVitals(sql) || isKpi(sql) || isSeries(sql)) {
        await new Promise<void>((r) => gates.push(r));
      }
      return { data: { hits: healthy(sql) as Hits } };
    });
    const d = useRumOverviewData(ref({ start_time: START, end_time: END }), ref(SCHEMA));
    d.markPagesVisible();
    const done = d.loadAll();
    await flushPromises();
    expect(sqls()).toHaveLength(3);
    gates.forEach((open) => open());
    await done;
    await flushPromises();
    const later = sqls().slice(3);
    expect(later.some((q) => q.includes("GROUP BY pg"))).toBe(true);
    expect(later.some((q) => q.includes("GROUPING SETS ((s0_0"))).toBe(true);
    expect(later.some((q) => q.includes("GROUP BY service, env, version"))).toBe(true);
  });

  it("waits for the pages panel to be seen before querying pages", async () => {
    const d = await setup({ pagesVisible: false });
    expect(sqls().some((q) => q.includes("GROUP BY pg"))).toBe(false);
    expect(d.status.value.pages).toBe("loading");
    d.markPagesVisible();
    await flushPromises();
    expect(sqls().filter((q) => q.includes("GROUP BY pg"))).toHaveLength(1);
    expect(d.status.value.pages).toBe("ok");
  });

  it("reports low data under 100 views", async () => {
    responder = (sql) => (isVitals(sql) ? [{ w: 1, ...vitalsRow(38) }] : healthy(sql));
    const d = await setup();
    expect(d.status.value.verdict).toBe("low");
  });

  it("reads a window with no rows as zeros, so an empty previous window is not usable", async () => {
    responder = (sql) =>
      isVitals(sql)
        ? [{ w: 1, ...vitalsRow(500) }]
        : isKpi(sql)
          ? kpiRows().filter((r) => r.w === 1)
          : healthy(sql);
    const d = await setup();
    expect(d.vitalsPrev.value?.views).toBe(0);
    expect(d.totals.value.prev?.sessions).toBe(0);
    expect(d.frustration.value.prev).toEqual({ rage: 0, dead: 0 });
  });

  it("shows one page-level empty state when there are no views or sessions", async () => {
    responder = () => [];
    const d = await setup();
    expect(d.status.value.verdict).toBe("empty");
    expect(d.status.value.kpis).toBe("empty");
    expect(d.pageState.value).toBe("empty");
  });

  it("shows one page-level error only when every shown panel fails", async () => {
    responder = () => new Error("boom");
    const d = await setup();
    expect(d.status.value.verdict).toBe("error");
    expect(d.pageState.value).toBe("error");
  });

  it("reports forbidden separately from error, at panel and page level", async () => {
    responder = () => ({ status: 403 });
    const d = await setup();
    expect(d.status.value.verdict).toBe("forbidden");
    expect(d.pageState.value).toBe("forbidden");
  });

  it("keeps per-panel errors when only some panels fail", async () => {
    responder = (sql) => (sql.includes("GROUP BY pg") ? new Error("boom") : healthy(sql));
    const d = await setup();
    expect(d.status.value.pages).toBe("error");
    expect(d.status.value.verdict).toBe("ok");
    expect(d.pageState.value).toBe("ok");
  });

  it("fills empty buckets with zero so the series has no gaps", async () => {
    const d = await setup();
    expect(d.series.value.map((p) => p.sessions)).toEqual([10, 0, 20]);
  });

  it("hands the chart the zero-filled series the table and sparklines use", async () => {
    const d = await setup();
    expect(d.chartHits.value).toEqual([
      { x_axis_1: "2023-11-14T22:00:00", y_axis_1: 10, y_axis_2: 2 },
      { x_axis_1: "2023-11-14T23:00:00", y_axis_1: 0, y_axis_2: 0 },
      { x_axis_1: "2023-11-15T00:00:00", y_axis_1: 20, y_axis_2: 4 },
    ]);
    expect(d.status.value.chart).toBe("ok");
  });

  it("lets the chart render once the series is back, without waiting for the KPI scan", async () => {
    let open: () => void = () => {};
    mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
      const sql = args.query.query.sql;
      if (isKpi(sql)) await new Promise<void>((r) => (open = r));
      return { data: { hits: healthy(sql) as Hits } };
    });
    const d = useRumOverviewData(ref({ start_time: START, end_time: END }), ref(SCHEMA));
    const done = d.loadAll();
    await flushPromises();
    expect(d.status.value.chart).toBe("ok");
    expect(d.status.value.kpis).toBe("loading");
    open();
    await done;
  });

  it("splits one segment query per dimension and shares against the window's views", async () => {
    responder = (sql) =>
      sql.includes("GROUPING SETS")
        ? [
            { s0_0: "Chrome", s0_1: "120", g0: 0, g1: 1, g2: 1, views: 100, inp: 1e8, lcp: 1e9 },
            { s0_0: "Safari", s0_1: "17", g0: 0, g1: 1, g2: 1, views: 50, inp: 1e8, lcp: 1e9 },
            { s1_0: "US", g0: 1, g1: 0, g2: 1, views: 125, inp: 1e8, lcp: 1e9 },
            { g0: 1, g1: 0, g2: 1, views: 25, inp: 1e8, lcp: 1e9 },
          ]
        : healthy(sql);
    const d = await setup();
    expect(d.segments.value.browser?.map((r) => [r.label, r.share])).toEqual([
      ["Chrome 120", 20],
      ["Safari 17", 10],
    ]);
    expect(d.segments.value.country?.map((r) => [r.label, r.views])).toEqual([["US", 125]]);
    expect(d.status.value.segments).toBe("ok");
  });

  it("resolves the release panel to empty with a single version", async () => {
    responder = (sql) =>
      isKpi(sql)
        ? kpiRows().filter((r) => r.version !== "1.0" && r.version !== "0.9")
        : healthy(sql);
    const d = await setup();
    expect(d.status.value.release).toBe("empty");
  });

  it("compares the two latest current-window versions from the KPI query", async () => {
    responder = (sql) => (sql.includes("in_cur = 1") ? [{ new_errors: 3 }] : healthy(sql));
    const d = await setup();
    expect(d.status.value.release).toBe("ok");
    expect(d.release.value?.cur.version).toBe("2.0");
    expect(d.release.value?.prev.version).toBe("1.0");
    expect(d.release.value?.newErrors).toBe(3);
    expect(d.releaseMarker.value?.version).toBe("2.0");
    expect(sqls().find((q) => q.includes("in_cur = 1"))).toContain("version IN ('2.0','1.0')");
  });

  it("queries release sessions separately when a version filter narrows the KPIs", async () => {
    responder = (sql) =>
      sql.includes("MIN(_timestamp) AS first_seen")
        ? [
            {
              version: "2.0",
              first_seen: 1_700_000_000_000_000 + 12 * HOUR_MS * 1000,
              sessions: 100,
              err_sessions: 10,
            },
            {
              version: "1.0",
              first_seen: 1_700_000_000_000_000 + 1000,
              sessions: 100,
              err_sessions: 5,
            },
          ]
        : isKpi(sql)
          ? kpiRows().filter((r) => r.gv === 1)
          : healthy(sql);
    const d = await setup({ filters: { version: ["2.0"] } });
    const kpi = sqls().find(isKpi)!;
    expect(kpi).toContain("version IN ('2.0')");
    expect(kpi).not.toContain("GROUPING SETS");
    const rel = sqls().find((q) => q.includes("MIN(_timestamp) AS first_seen"))!;
    expect(rel).not.toContain("version IN ('2.0')");
    expect(d.release.value?.cur.version).toBe("2.0");
    expect(d.status.value.release).toBe("ok");
  });

  it("keeps every answered panel on screen, marked busy, while a reload runs", async () => {
    const d = await setup();
    let open: () => void = () => {};
    mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
      await new Promise<void>((r) => (open = r));
      return { data: { hits: healthy(args.query.query.sql) as Hits } };
    });
    const done = d.loadAll();
    await flushPromises();
    expect(d.status.value.verdict).toBe("ok");
    expect(d.status.value.kpis).toBe("ok");
    expect(d.status.value.pages).toBe("ok");
    expect(d.vitals.value?.views).toBe(500);
    expect(d.pages.value).toHaveLength(1);
    expect(d.busy.value.verdict).toBe(true);
    expect(d.busy.value.pages).toBe(true);
    open();
    void done;
  });

  it("shows a skeleton on a first load with nothing answered yet", async () => {
    mockSearch.mockImplementation(() => new Promise(() => {}));
    const d = useRumOverviewData(ref({ start_time: START, end_time: END }), ref(SCHEMA));
    void d.loadAll();
    await flushPromises();
    expect(d.status.value.verdict).toBe("loading");
    expect(d.status.value.chart).toBe("loading");
  });

  it("leaves out the bucket that still contains now from the series and the chart", async () => {
    const hour = 3_600_000;
    const nowHour = Math.floor(Date.now() / hour) * hour;
    const label = (ms: number) => new Date(ms).toISOString().slice(0, 19);
    const end = new Date(nowHour + hour);
    const start = new Date(end.getTime() - 24 * hour);
    responder = (sql) =>
      isSeries(sql)
        ? [
            { bucket: label(nowHour - hour), sessions: 1500 },
            { bucket: label(nowHour), sessions: 400 },
          ]
        : healthy(sql);
    mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => ({
      data: { hits: responder(args.query.query.sql) as Hits },
    }));
    const d = useRumOverviewData(ref({ start_time: start, end_time: end }), ref(SCHEMA));
    await d.loadAll();
    await flushPromises();
    expect(d.series.value.map((p) => p.sessions)).toEqual([1500]);
    expect(d.chartHits.value).toEqual([
      { x_axis_1: label(nowHour - hour), y_axis_1: 1500, y_axis_2: 0 },
    ]);
  });

  it("reads the series without the server's result cache", async () => {
    await setup();
    const series = mockSearch.mock.calls.filter((c) => isSeries(c[0].query.query.sql));
    expect(series).toHaveLength(1);
    expect(series[0][3]).toBe(false);
    expect(
      mockSearch.mock.calls
        .filter((c) => !isSeries(c[0].query.query.sql))
        .every((c) => c[3] === undefined),
    ).toBe(true);
  });

  it("starts no second wave after an abort", async () => {
    let open: () => void = () => {};
    mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
      const sql = args.query.query.sql;
      if (isVitals(sql)) await new Promise<void>((r) => (open = r));
      return { data: { hits: healthy(sql) as Hits } };
    });
    const d = useRumOverviewData(ref({ start_time: START, end_time: END }), ref(SCHEMA));
    d.markPagesVisible();
    const done = d.loadAll();
    await flushPromises();
    d.abortAll();
    open();
    await done;
    await flushPromises();
    expect(
      sqls().some((q) => q.includes("GROUP BY pg") || q.includes("GROUPING SETS ((s0_0")),
    ).toBe(false);
  });
});
