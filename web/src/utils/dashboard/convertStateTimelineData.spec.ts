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

import { describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { toZonedTime } from "date-fns-tz";
import {
  STATE_TIMELINE_ROW_ZOOM_IDS,
  STATE_TIMELINE_TOOLTIP_MAX_ROWS,
  allRowsTooltip,
  readRowWindow,
  rowWindowFromEvent,
  stateAt,
  styleKeyOf,
  withRowWindow,
  STATE_TIMELINE_MAX_ROWS,
  STATE_TIMELINE_MAX_STATES,
  buildStateSegments,
  convertStateTimelineData,
  resolveStateTimelineStep,
  sortStateRows,
  stateTimelineDrilldownSeries,
  STATE_TIMELINE_MAX_SERIES,
  promqlSeriesCap,
  stateTimelineSourceRecord,
} from "./convertStateTimelineData";
import { createPromQLChunkProcessor } from "@/composables/dashboard/promqlChunkProcessor";

// jsdom has no token stylesheet, so each token resolves to its own name and stays distinguishable.
vi.mock("@/utils/chartTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/chartTheme")>()),
  chartColor: (token: string) => token,
}));

const S = 1000;
const store = {
  state: { timezone: "UTC", theme: "light", selectedOrganization: { identifier: "default" } },
};

const sqlPanel = (config: any = {}, breakdown = true) => ({
  id: "p1",
  type: "state-timeline",
  queryType: "sql",
  config,
  queries: [
    {
      fields: {
        x: [{ alias: "x_axis_1" }],
        y: [{ alias: "y_axis_1", label: "link_state" }],
        breakdown: breakdown
          ? [{ alias: "breakdown_1", args: [{ type: "field", value: { field: "port" } }] }]
          : [],
      },
    },
  ],
});

const row = (seconds: number, port: string, state: unknown) => ({
  x_axis_1: new Date(seconds * S).toISOString().slice(0, -1),
  breakdown_1: port,
  y_axis_1: state,
});

const sqlMeta = [[{ histogram_interval: 10 }]];

const segmentsOf = (result: any) => result.options.series[0].data;
const legendNames = (result: any) => result.options.legend.data;

describe("buildStateSegments", () => {
  it("merges consecutive samples with the same state into one segment", () => {
    const segments = buildStateSegments(
      [
        { t: 0, state: "up" },
        { t: 10 * S, state: "up" },
        { t: 20 * S, state: "down" },
        { t: 30 * S, state: "down" },
      ],
      10 * S,
      15 * S,
    );
    expect(segments).toEqual([
      { start: 0, end: 20 * S, state: "up" },
      { start: 20 * S, end: 40 * S, state: "down" },
    ]);
  });

  it("measures the merge window on the empty stretch, so one missed sample merges at step 60", () => {
    const segments = buildStateSegments(
      [
        { t: 0, state: "up" },
        { t: 120 * S, state: "up" },
      ],
      60 * S,
      60 * S,
    );
    expect(segments).toEqual([{ start: 0, end: 180 * S, state: "up" }]);
  });

  it("shows a gap beyond the merge window as no data, never as the last state", () => {
    const segments = buildStateSegments(
      [
        { t: 0, state: "up" },
        { t: 60 * S, state: "up" },
      ],
      10 * S,
      15 * S,
    );
    expect(segments).toEqual([
      { start: 0, end: 10 * S, state: "up" },
      { start: 10 * S, end: 60 * S, state: null },
      { start: 60 * S, end: 70 * S, state: "up" },
    ]);
  });

  it("turns a null sample into a no-data segment", () => {
    const segments = buildStateSegments(
      [
        { t: 0, state: "up" },
        { t: 10 * S, state: null },
        { t: 20 * S, state: "up" },
      ],
      10 * S,
      15 * S,
    );
    expect(segments.map((s) => s.state)).toEqual(["up", null, "up"]);
  });

  it("marks the stretch after an entity stops reporting as no data up to the range end", () => {
    const segments = buildStateSegments([{ t: 0, state: "up" }], 10 * S, 15 * S, {
      start: 0,
      end: 100 * S,
    });
    expect(segments).toEqual([
      { start: 0, end: 10 * S, state: "up" },
      { start: 10 * S, end: 100 * S, state: null },
    ]);
  });
});

describe("resolveStateTimelineStep", () => {
  it("reads the PromQL step (µs) from the response metadata", () => {
    expect(resolveStateTimelineStep([], [{ step: 30_000_000 }], true)).toBe(30 * S);
  });

  it("reads the SQL histogram interval (s)", () => {
    expect(resolveStateTimelineStep([], [{ histogram_interval: 60 }], false)).toBe(60 * S);
  });

  it("falls back to the smallest positive gap between samples", () => {
    const samples = [
      [
        { t: 0, state: "a" },
        { t: 20 * S, state: "a" },
        { t: 25 * S, state: "b" },
      ],
    ];
    expect(resolveStateTimelineStep(samples, null, false)).toBe(5 * S);
  });
});

describe("sortStateRows", () => {
  const seg = (state: string, length: number) => ({ start: 0, end: length, state });

  it("sorts by name with natural number order", () => {
    const rows = ["gpu10", "gpu2", "gpu1"].map((name) => ({ name, segments: [] }));
    expect(sortStateRows(rows, "name").map((r) => r.name)).toEqual(["gpu1", "gpu2", "gpu10"]);
  });

  it("puts the rows with the most time outside the dominant state first", () => {
    const rows = [
      { name: "a", segments: [seg("ok", 100)] },
      { name: "b", segments: [seg("ok", 60), seg("thermal", 40)] },
      { name: "c", segments: [seg("ok", 90), seg("power", 10)] },
    ];
    expect(sortStateRows(rows, "non_ok_time").map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("counts no data as not OK, but never picks it as the dominant state", () => {
    const gap = (length: number) => ({ start: 0, end: length, state: null });
    const rows = [
      { name: "a", segments: [seg("ok", 30), gap(70)] },
      { name: "b", segments: [seg("ok", 60), seg("power", 10)] },
      { name: "c", segments: [seg("ok", 100)] },
    ];
    expect(sortStateRows(rows, "non_ok_time").map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
});

describe("convertStateTimelineData", () => {
  it("builds one row per breakdown value with string states merged", () => {
    const data = [
      [
        row(0, "p1", "up"),
        row(10, "p1", "up"),
        row(20, "p1", "down"),
        row(0, "p2", "polling"),
        row(10, "p2", "polling"),
      ],
    ];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    expect(result.options.yAxis[0].data).toEqual(["p1", "p2"]);
    const items = segmentsOf(result).map((d: any) => [d.name, d.state, d.start, d.end]);
    expect(items).toEqual([
      ["p1", "up", 0, 20 * S],
      ["p1", "down", 20 * S, 30 * S],
      ["p2", "polling", 0, 20 * S],
    ]);
    expect(result.extras).toMatchObject({ isTimeSeries: true, crosshairSeriesIndex: 1 });
    expect(segmentsOf(result)[0].labels).toEqual({ port: "p1" });
  });

  it("by default shows a missed sample as no data but tolerates timing jitter", () => {
    const data = [
      [row(0, "p1", "up"), row(20, "p1", "up"), row(0, "p2", "up"), row(12, "p2", "up")],
    ];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    expect(segmentsOf(result).map((d: any) => [d.name, d.state, d.start, d.end])).toEqual([
      ["p1", "up", 0, 10 * S],
      ["p1", null, 10 * S, 20 * S],
      ["p1", "up", 20 * S, 30 * S],
      ["p2", "up", 0, 22 * S],
    ]);
  });

  it("reads each SQL query's rows with that query's own fields", () => {
    // The renderer drops a hidden query from both queries and data, so index i pairs them.
    const panel = sqlPanel();
    panel.queries.push({
      fields: {
        x: [{ alias: "ts" }],
        y: [{ alias: "unit_state", label: "unit_state" }],
        breakdown: [{ alias: "unit" }],
      },
    } as any);
    const data = [
      [row(0, "p1", "up")],
      [{ ts: new Date(0).toISOString().slice(0, -1), unit: "cdu3", unit_state: "alarm" }],
    ];
    const result = convertStateTimelineData(panel, data, store, null, sqlMeta, null);
    expect(segmentsOf(result).map((d: any) => [d.name, d.state])).toEqual([
      ["cdu3", "alarm"],
      ["p1", "up"],
    ]);
    // A custom SQL breakdown has no column, so its label falls back to the alias.
    expect(segmentsOf(result)[0].labels).toEqual({ unit: "cdu3" });

    const [, visibleOnly] = panel.queries;
    const hiddenFirst = convertStateTimelineData(
      { ...panel, queries: [visibleOnly] },
      [data[1]],
      store,
      null,
      sqlMeta,
      null,
    );
    expect(segmentsOf(hiddenFirst).map((d: any) => [d.name, d.state])).toEqual([["cdu3", "alarm"]]);
  });

  it("keeps the same entity from two queries in separate, named rows", () => {
    const panel = sqlPanel();
    panel.queries.push({
      tabName: "Rack B",
      fields: {
        x: [{ alias: "x_axis_1" }],
        y: [{ alias: "y_axis_1", label: "link_state" }],
        breakdown: [{ alias: "breakdown_1" }],
      },
    } as any);
    const data = [
      [row(0, "host-1", "up"), row(10, "host-1", "up"), row(0, "host-2", "up")],
      [row(0, "host-1", "down"), row(10, "host-1", "down")],
    ];
    const result = convertStateTimelineData(panel, data, store, null, sqlMeta, null);
    expect(result.options.yAxis[0].data).toEqual(["host-1 (Query 1)", "host-1 (Rack B)", "host-2"]);
    const segments = segmentsOf(result).map((d: any) => [
      d.name,
      stateTimelineDrilldownSeries({ data: d }).__name,
      d.state,
    ]);
    expect(segments).toEqual([
      ["host-1 (Query 1)", "host-1", "up"],
      ["host-1 (Rack B)", "host-1", "down"],
      ["host-2", "host-2", "up"],
    ]);
  });

  it("draws a segment that crosses a DST fall-back, where its wall-clock end precedes its start", () => {
    const at = (iso: string) => Date.parse(iso) / 1000;
    const panel = {
      id: "dst",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: {} }],
    };
    const data = [
      {
        resultType: "matrix",
        result: [
          {
            metric: { gpu: "0" },
            values: [
              [at("2026-11-01T08:50:00Z"), "1"],
              [at("2026-11-01T09:10:00Z"), "2"],
            ],
          },
        ],
      },
    ];
    const laStore = { state: { ...store.state, timezone: "America/Los_Angeles" } };
    const result = convertStateTimelineData(
      panel,
      data,
      laStore,
      null,
      [[{ step: 1_200_000_000 }]],
      null,
    );
    const [segment] = segmentsOf(result);
    expect(segment.value[1]).toBeLessThan(segment.value[0]);
    const api = {
      value: (i: number) => segment.value[i],
      coord: ([x, rowIndex]: number[]) => [x / 1000, rowIndex * 20 + 10],
      size: () => [0, 20],
    };
    const box = { x: 0, y: 0, width: 1e12, height: 100 };
    const drawn = result.options.series[0].renderItem({ coordSys: box }, api);
    const rect = drawn.type === "group" ? drawn.children[0] : drawn;
    expect(rect.shape.width).toBe(Math.abs(segment.value[1] - segment.value[0]) / 1000);
  });

  it("publishes a segment hover through the crosshair series, whose items carry the time", () => {
    const panel = {
      id: "hover",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: {} }],
    };
    const values = [0, 30, 60, 90].map((s) => [1_700_000_000 + s, s < 60 ? "1" : "2"]);
    const data = [{ resultType: "matrix", result: [{ metric: { gpu: "0" }, values }] }];
    const result = convertStateTimelineData(
      panel,
      data,
      store,
      null,
      [[{ step: 30_000_000 }]],
      null,
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const chart = echarts.init(el, null, { renderer: "svg", width: 800, height: 400 });
    chart.setOption(result.options);
    const batches: any[] = [];
    chart.on("highlight", (params: any) => batches.push(...(params.batch ?? [params])));
    const first = segmentsOf(result)[0];
    const [x, y] = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
      first.value[0] + 20_000,
      0,
    ]);
    (chart.getZr() as any).handler.dispatch("mousemove", {
      zrX: x,
      zrY: y,
      offsetX: x,
      offsetY: y,
    });

    expect(batches.length).toBeGreaterThan(0);
    for (const item of batches) {
      expect(item.seriesIndex).toBe(1);
      const published = (chart.getOption() as any).series[1].data[item.dataIndex][0];
      expect(published).toBeInstanceOf(Date);
    }
    chart.dispose();
    el.remove();
  });

  it("reads only each query's primary slot when a stored time shift adds slots", () => {
    const data = [[row(0, "p1", "up")], [row(0, "shifted", "down")]];
    const metadata = {
      queries: [
        { panelQueryIndex: 0, timeRangeGap: { seconds: 0 } },
        { panelQueryIndex: 0, timeRangeGap: { seconds: 3600 } },
      ],
    };
    const meta = [[{ histogram_interval: 10 }], [{ histogram_interval: 10 }]];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, meta, metadata);
    expect(segmentsOf(result).map((d: any) => [d.name, d.state])).toEqual([["p1", "up"]]);
  });

  it("keeps a shown query's own step when an earlier query is hidden", () => {
    const panel = sqlPanel();
    (panel.queries[0] as any).query = "q2";
    const metadata = { queries: [{ originalQuery: "q1" }, { originalQuery: "q2" }] };
    const meta = [[{ histogram_interval: 60 }], [{ histogram_interval: 10 }]];
    const result = convertStateTimelineData(
      panel,
      [[row(0, "p1", "up")]],
      store,
      null,
      meta,
      metadata,
    );
    expect(segmentsOf(result).map((d: any) => [d.start, d.end])).toEqual([[0, 10 * S]]);
  });

  it("builds each query's rows with that query's own step", () => {
    const panel = sqlPanel();
    panel.queries.push(JSON.parse(JSON.stringify(panel.queries[0])));
    const data = [
      [row(0, "fast", "up"), row(10, "fast", "up")],
      [row(0, "slow", "up"), row(60, "slow", "up")],
    ];
    const meta = [[{ histogram_interval: 10 }], [{ histogram_interval: 60 }]];
    const result = convertStateTimelineData(panel, data, store, null, meta, null);
    expect(segmentsOf(result).map((d: any) => [d.name, d.state, d.start, d.end])).toEqual([
      ["fast", "up", 0, 20 * S],
      ["slow", "up", 0, 120 * S],
    ]);
  });

  it("returns an empty series list, which the renderer shows as No Data, when nothing is usable", () => {
    const data = [[{ x_axis_1: "not a time", breakdown_1: "p1", y_axis_1: "up" }]];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    expect(result.options.series).toEqual([]);
    const empty = convertStateTimelineData(sqlPanel(), [[]], store, null, sqlMeta, null);
    expect(empty.options.series).toEqual([]);
  });

  describe("PromQL rows by legend name", () => {
    const panelWith = (queries: any[]) => ({
      id: "dup",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries,
    });
    const series = (labels: Record<string, string>, values: any[]) => ({ metric: labels, values });
    const convert = (panel: any, data: any[]) =>
      convertStateTimelineData(panel, data, store, null, [[{ step: 30_000_000 }]], null);

    it("joins series of one query that share a legend into one continuous row", () => {
      const panel = panelWith([{ config: { promql_legend: "{gpu}" } }]);
      const data = [
        {
          resultType: "matrix",
          result: [
            series({ gpu: "0", start_time: "old" }, [
              [0, "1"],
              [30, "1"],
            ]),
            series({ gpu: "0", start_time: "new" }, [
              [60, "2"],
              [90, "2"],
            ]),
          ],
        },
      ];
      const result = convert(panel, data);
      expect(result.options.yAxis[0].data).toEqual(["0"]);
      expect(segmentsOf(result).map((d: any) => [d.state, d.start, d.end])).toEqual([
        ["1", 0, 60 * S],
        ["2", 60 * S, 120 * S],
      ]);
      expect(segmentsOf(result)[0].labels).toEqual({ gpu: "0", start_time: "new" });
    });

    it("lets the most recent series win a shared timestamp", () => {
      const panel = panelWith([{ config: { promql_legend: "{gpu}" } }]);
      const data = [
        {
          resultType: "matrix",
          result: [
            series({ gpu: "0", start_time: "new" }, [
              [30, "2"],
              [60, "2"],
            ]),
            series({ gpu: "0", start_time: "old" }, [
              [0, "1"],
              [30, "1"],
            ]),
          ],
        },
      ];
      expect(segmentsOf(convert(panel, data)).map((d: any) => [d.state, d.start, d.end])).toEqual([
        ["1", 0, 30 * S],
        ["2", 30 * S, 90 * S],
      ]);
    });

    it("shows a restarted entity's old and new series on one row, with no data between", () => {
      // Mirrors a live GPU metric: two series per GPU differing only in start_time, 15s step.
      const base = 1_700_000_000;
      const points = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => [from + i * 15, "0"]);
      const result = [];
      for (let gpu = 0; gpu < 80; gpu++) {
        const labels = { hostname: `h${gpu >> 3}`, gpu: String(gpu % 8) };
        result.push(series({ ...labels, start_time: "old" }, points(base, 65)));
        result.push(series({ ...labels, start_time: "new" }, points(base + 2220, 100)));
      }
      const load = (maxSeries: number) => {
        const processor = createPromQLChunkProcessor({ maxSeries, enableLogging: false });
        return processor.processChunk(null, { resultType: "matrix", result });
      };
      const panel = {
        ...panelWith([{ config: { promql_legend: "{hostname} gpu{gpu}" } }]),
        config: { merge_gaps: 45 },
      };
      const rowsOf = (loaded: any) => {
        const converted = convertStateTimelineData(
          panel,
          [loaded],
          store,
          null,
          [[{ step: 15_000_000 }]],
          null,
        );
        const byRow = new Map<string, any[]>();
        for (const d of segmentsOf(converted)) byRow.set(d.name, [...(byRow.get(d.name) ?? []), d]);
        return byRow;
      };

      const rows = rowsOf(load(promqlSeriesCap("state-timeline", { max_dashboard_series: 100 })));
      expect(rows.size).toBe(80);
      for (const segments of rows.values()) {
        expect(segments.map((d: any) => [d.state, d.start / S - base, d.end / S - base])).toEqual([
          ["0", 0, 975],
          [null, 975, 2220],
          ["0", 2220, 3720],
        ]);
      }
      // The default series cap of 100 keeps the 80 longer new series and only 20 old ones.
      const capped = [...rowsOf(load(100)).values()];
      expect(capped.filter((segments) => segments[0].start / S - base === 0)).toHaveLength(20);
    });

    it("suffixes a legend shared across queries, keeping the plain entity", () => {
      const panel = panelWith([
        { config: { promql_legend: "{gpu}" } },
        { config: { promql_legend: "{gpu}" } },
      ]);
      const data = [
        { resultType: "matrix", result: [series({ gpu: "0", host: "a" }, [[0, "1"]])] },
        { resultType: "matrix", result: [series({ gpu: "0", host: "c" }, [[0, "1"]])] },
      ];
      const result = convert(panel, data);
      expect(result.options.yAxis[0].data).toEqual(["0 (Query 1)", "0 (Query 2)"]);
      expect(
        segmentsOf(result).map((d: any) => stateTimelineDrilldownSeries({ data: d }).__name),
      ).toEqual(["0", "0"]);
    });

    it("keeps names unique when two queries share a tab name", () => {
      const panel = panelWith([
        { tabName: "Rack", config: { promql_legend: "{gpu}" } },
        { tabName: "Rack", config: { promql_legend: "{gpu}" } },
      ]);
      const data = [
        { resultType: "matrix", result: [series({ gpu: "0" }, [[0, "1"]])] },
        { resultType: "matrix", result: [series({ gpu: "0" }, [[0, "1"]])] },
      ];
      const result = convert(panel, data);
      expect(result.options.yAxis[0].data).toEqual(["0 (Rack)", "0 (Rack) (2)"]);
      expect(
        segmentsOf(result).map((d: any) => stateTimelineDrilldownSeries({ data: d }).__name),
      ).toEqual(["0", "0"]);
    });
  });

  it("gives 20 unmapped states 20 distinct colours", () => {
    const states = Array.from({ length: STATE_TIMELINE_MAX_STATES }, (_, i) => `state-${i}`);
    const data = [states.map((state, i) => row(i * 10, "u1", state))];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    const colours = new Set(segmentsOf(result).map((d: any) => d.itemStyle.color));
    expect(colours.size).toBe(STATE_TIMELINE_MAX_STATES);
  });

  it("keeps states apart when only their mapped text colour differs", () => {
    const config = {
      mappings: [
        { type: "value", value: "a", text: "X", color: "#111111", textColor: "#ffffff" },
        { type: "value", value: "b", text: "X", color: "#111111", textColor: "#000000" },
      ],
    };
    const data = [[row(0, "u1", "a"), row(10, "u1", "b")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    expect(legendNames(result).map((name: string) => name.replace(/\u200b/g, ""))).toEqual([
      "X",
      "X",
    ]);
  });

  it("keeps each configured colour for states mapped to the same text", () => {
    const config = {
      mappings: [
        { type: "value", value: "down", text: "Down", color: "#ff0000" },
        { type: "value", value: "dead", text: "Down", color: "#0000ff" },
      ],
    };
    const data = [[row(0, "p1", "down"), row(10, "p1", "up"), row(20, "p1", "dead")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const [down, , dead] = segmentsOf(result);
    expect(down.itemStyle.color).toBe("#ff0000");
    expect(dead.itemStyle.color).toBe("#0000ff");
    const downEntries = result.options.series.filter(
      (series: any) => series.name?.replace(/\u200b/g, "") === "Down",
    );
    expect(downEntries.map((series: any) => series.itemStyle.color).sort()).toEqual([
      "#0000ff",
      "#ff0000",
    ]);
  });

  it("names the single row after the state field when there is no breakdown", () => {
    const data = [[row(0, "", 1), row(10, "", 1)]];
    const result = convertStateTimelineData(sqlPanel({}, false), data, store, null, sqlMeta, null);
    expect(result.options.yAxis[0].data).toEqual(["link_state"]);
  });

  it("treats numeric states as their string form", () => {
    const data = [[row(0, "p1", 3), row(10, "p1", 3), row(20, "p1", 0)]];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    expect(segmentsOf(result).map((d: any) => d.state)).toEqual(["3", "0"]);
  });

  it("styles null states as no data, apart from every state colour", () => {
    const data = [[row(0, "p1", "up"), row(10, "p1", null), row(20, "p1", "up")]];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    const [up, noData] = segmentsOf(result);
    expect(noData.state).toBeNull();
    expect(noData.itemStyle.color).toBe("--color-surface-subtle");
    expect(noData.itemStyle.color).not.toBe(up.itemStyle.color);
    expect(legendNames(result)).toContain("No data");
  });

  it("takes colour and display text from value mappings", () => {
    const config = {
      mappings: [{ type: "value", value: "thermal", text: "Thermal throttle", color: "#ff0000" }],
    };
    const data = [[row(0, "g1", "thermal"), row(10, "g1", "none")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const thermal = segmentsOf(result).find((d: any) => d.state === "thermal");
    expect(thermal.itemStyle.color).toBe("#ff0000");
    expect(legendNames(result)).toContain("Thermal throttle");
  });

  it("colours unmapped numeric states from thresholds", () => {
    const config = {
      thresholds: { mode: "absolute", steps: [{ value: 2, color: "#00ff00" }] },
    };
    const data = [[row(0, "u1", 1), row(10, "u1", 5)]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const five = segmentsOf(result).find((d: any) => d.state === "5");
    expect(five.itemStyle.color).toBe("#00ff00");
  });

  it("gives a state the same colour across rows and across conversions", () => {
    const first = convertStateTimelineData(
      sqlPanel(),
      [[row(0, "a", "alarm"), row(0, "b", "normal"), row(10, "b", "alarm")]],
      store,
      null,
      sqlMeta,
      null,
    );
    const colours = segmentsOf(first)
      .filter((d: any) => d.state === "alarm")
      .map((d: any) => d.itemStyle.color);
    expect(new Set(colours).size).toBe(1);

    const second = convertStateTimelineData(
      sqlPanel(),
      [[row(0, "z", "offline"), row(10, "z", "alarm")]],
      store,
      null,
      sqlMeta,
      null,
    );
    const again = segmentsOf(second).find((d: any) => d.state === "alarm");
    expect(again.itemStyle.color).toBe(colours[0]);
    const colourOf = (result: any, state: string) =>
      segmentsOf(result).find((d: any) => d.state === state).itemStyle.color;
    expect(colourOf(first, "normal")).not.toBe(colours[0]);
    expect(colourOf(second, "offline")).not.toBe(colours[0]);
  });

  it("gives common states that share a hash slot distinct colours", () => {
    const states = ["normal", "alarm", "ok", "error", "warning", "offline"];
    const data = [states.map((state, i) => row(i * 10, "u1", state))];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    const colours = states.map(
      (state) => segmentsOf(result).find((d: any) => d.state === state).itemStyle.color,
    );
    expect(new Set(colours).size).toBe(states.length);
  });

  it("keeps a mapped colour and legend entry past the cap, counting only unmapped states", () => {
    const count = STATE_TIMELINE_MAX_STATES + 1;
    const config = {
      mappings: [{ type: "value", value: "maint", text: "Maintenance", color: "#123456" }],
    };
    const data = [
      [
        ...Array.from({ length: count }, (_, i) =>
          Array.from({ length: count - i + 1 }, (_, k) => row(k * 10, `r${i}`, `s${i}`)),
        ).flat(),
        row(0, "rm", "maint"),
      ],
    ];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const maint = segmentsOf(result).find((d: any) => d.state === "maint");
    expect(maint.itemStyle.color).toBe("#123456");
    expect(legendNames(result)).toContain("Maintenance");
    expect(result.extras.seriesLimit.displayCapMessage).toContain(
      `${STATE_TIMELINE_MAX_STATES} of ${count} states`,
    );
  });

  it("shows states mapped to the same text as one legend entry with one colour", () => {
    const config = {
      mappings: [
        { type: "value", value: "down", text: "Down" },
        { type: "value", value: "dead", text: "Down" },
      ],
    };
    const data = [[row(0, "p1", "down"), row(10, "p1", "up"), row(20, "p1", "dead")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    expect(legendNames(result).filter((name: string) => name === "Down")).toHaveLength(1);
    const [down, , dead] = segmentsOf(result);
    expect(dead.itemStyle.color).toBe(down.itemStyle.color);
  });

  it("formats the tooltip with entity, state, start, end and duration, and no data for a gap", () => {
    const data = [[row(0, "p1", "up"), row(10, "p1", "up"), row(40, "p1", "up")]];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    const format = result.options.tooltip.formatter;
    const [up, gap] = segmentsOf(result);
    const text = format({ seriesIndex: 0, marker: "", data: up });
    expect(text).toContain("<strong>p1</strong>");
    expect(text).toContain("up");
    expect(text).toContain("Start: 1970-01-01 00:00:00");
    expect(text).toContain("End: 1970-01-01 00:00:20");
    expect(text).toContain("Duration: 20s");
    expect(format({ seriesIndex: 0, marker: "", data: gap })).toContain("No data");
  });

  it("caps rows and reports how many are shown", () => {
    const data = [
      Array.from({ length: STATE_TIMELINE_MAX_ROWS + 1 }, (_, i) => row(0, `r${i}`, "up")),
    ];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    expect(result.options.yAxis[0].data).toHaveLength(STATE_TIMELINE_MAX_ROWS);
    expect(result.extras.seriesLimit.displayCapMessage).toContain(
      `Showing ${STATE_TIMELINE_MAX_ROWS} of ${STATE_TIMELINE_MAX_ROWS + 1} rows`,
    );
  });

  it("caps distinct state colours and gives the rest the shared other colour", () => {
    const count = STATE_TIMELINE_MAX_STATES + 1;
    // Longer runs rank first, so s20 is the least-seen state and falls past the cap.
    const data = [
      Array.from({ length: count }, (_, i) =>
        Array.from({ length: count - i }, (_, k) => row(k * 10, `r${i}`, `s${i}`)),
      ).flat(),
    ];
    const result = convertStateTimelineData(sqlPanel(), data, store, null, sqlMeta, null);
    const last = segmentsOf(result).find((d: any) => d.state === `s${count - 1}`);
    expect(last.itemStyle.color).toBe("--color-text-secondary");
    expect(legendNames(result)).toContain("Other");
    expect(result.extras.seriesLimit.displayCapMessage).toContain(
      `${STATE_TIMELINE_MAX_STATES} of ${count} states`,
    );
  });

  it("sorts rows by time spent outside the dominant state", () => {
    const data = [
      [
        row(0, "a", "ok"),
        row(10, "a", "ok"),
        row(0, "b", "ok"),
        row(10, "b", "alarm"),
        row(0, "c", "ok"),
        row(10, "c", "ok"),
      ],
    ];
    const result = convertStateTimelineData(
      sqlPanel({ row_sort: "non_ok_time" }),
      data,
      store,
      null,
      sqlMeta,
      null,
    );
    expect(result.options.yAxis[0].data[0]).toBe("b");
  });

  it("labels PromQL rows with the legend template and uses the response step", () => {
    const panel = {
      id: "p2",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: { promql_legend: "{gpu}" } }],
    };
    const data = [
      {
        resultType: "matrix",
        result: [
          {
            metric: { gpu: "0", __name__: "throttle" },
            values: [
              [0, "1"],
              [30, "1"],
              [60, "2"],
            ],
          },
        ],
      },
    ];
    const result = convertStateTimelineData(
      panel,
      data,
      store,
      null,
      [[{ step: 30_000_000 }]],
      null,
    );
    expect(result.options.yAxis[0].data).toEqual(["0"]);
    expect(segmentsOf(result).map((d: any) => [d.state, d.start, d.end])).toEqual([
      ["1", 0, 60 * S],
      ["2", 60 * S, 90 * S],
    ]);
    expect(segmentsOf(result)[0].labels).toEqual({ gpu: "0", __name__: "throttle" });
  });

  it("treats PromQL NaN and infinities as no data", () => {
    const panel = {
      id: "p3",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: {} }],
    };
    const values = [
      [0, "1"],
      [30, "NaN"],
      [60, "+Inf"],
      [90, "1"],
    ];
    const data = [{ resultType: "matrix", result: [{ metric: { gpu: "0" }, values }] }];
    const result = convertStateTimelineData(
      panel,
      data,
      store,
      null,
      [[{ step: 30_000_000 }]],
      null,
    );
    expect(segmentsOf(result).map((d: any) => d.state)).toEqual(["1", null, "1"]);
  });
});

describe("crosshair series", () => {
  it("holds one point per distinct sample time across a day of rows", () => {
    const steps = 24 * 240;
    const base = 1_700_000_000;
    // Half the rows report 5s later, so the distinct times are twice one row's.
    const result = Array.from({ length: 200 }, (_, i) => ({
      metric: { gpu: String(i) },
      values: Array.from({ length: steps }, (_, k) => [base + (i % 2) * 5 + k * 15, "0"]),
    }));
    const panel = {
      id: "big",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: {} }],
    };
    const converted = convertStateTimelineData(
      panel,
      [{ resultType: "matrix", result }],
      store,
      null,
      [[{ step: 15_000_000 }]],
      null,
    );
    const crosshair = converted.options.series[1].data;
    expect(crosshair).toHaveLength(2 * steps);
    expect(crosshair[1][0].getTime() - crosshair[0][0].getTime()).toBe(5 * S);
  });
});

describe("promqlSeriesCap", () => {
  it("reads a state timeline's own server cap and leaves other panels on theirs", () => {
    const config = { max_dashboard_series: 100, max_dashboard_state_timeline_series: 300 };
    expect(promqlSeriesCap("state-timeline", config)).toBe(300);
    expect(promqlSeriesCap("state-timeline", { max_dashboard_series: 100 })).toBe(
      STATE_TIMELINE_MAX_SERIES,
    );
    expect(promqlSeriesCap("line", config)).toBe(100);
    expect(promqlSeriesCap("line", undefined)).toBe(100);
  });

  it("reports series the loader still dropped", () => {
    const panel = {
      id: "lim",
      type: "state-timeline",
      queryType: "promql",
      config: {},
      queries: [{ config: {} }],
    };
    const data = [{ resultType: "matrix", result: [{ metric: { gpu: "0" }, values: [[0, "1"]] }] }];
    const metadata = { seriesLimiting: { uniqueSeriesSeen: 2500, metricsStored: 2000 } };
    const result = convertStateTimelineData(
      panel,
      data,
      store,
      null,
      [[{ step: 30_000_000 }]],
      metadata,
    );
    expect(result.extras.seriesLimit.displayCapMessage).toContain("2,500");
  });
});

describe("stateTimelineSourceRecord", () => {
  it("returns the entity's SQL row at or just before the segment start", () => {
    const data = [[row(0, "p1", "a"), row(10, "p1", "b"), row(20, "p1", "c"), row(10, "p2", "z")]];
    const at = (entity: string, start: number) =>
      stateTimelineSourceRecord(sqlPanel(), data, { data: { entity, start, labels: {} } }).y_axis_1;
    expect(at("p1", 15 * S)).toBe("b");
    expect(at("p2", 15 * S)).toBe("z");
    expect(at("p2", 0)).toBe("z");
  });

  it("returns the labels of a PromQL segment", () => {
    const panel = { queryType: "promql", queries: [{}] };
    expect(
      stateTimelineSourceRecord(panel, [], { data: { start: 0, labels: { gpu: "0" } } }),
    ).toEqual({ gpu: "0" });
  });
});

describe("stateTimelineDrilldownSeries", () => {
  it("exposes the entity, state, labels and segment bounds", () => {
    const params = {
      data: { name: "gpu0", state: "thermal", start: 1000, end: 5000, labels: { gpu: "0" } },
    };
    expect(stateTimelineDrilldownSeries(params)).toEqual({
      __name: "gpu0",
      __value: "thermal",
      __axisValue: 1000,
      __start: 1000,
      __end: 5000,
      labels: { gpu: "0" },
    });
  });
});

describe("stateAt", () => {
  const segments = [
    { start: 0, end: 10, state: "up" },
    { start: 10, end: 20, state: null },
    { start: 30, end: 40, state: "down" },
  ];

  it("finds the state in effect, no data for a null run, a gap or outside the rows", () => {
    expect(stateAt(segments, 0)).toBe("up");
    expect(stateAt(segments, 9)).toBe("up");
    expect(stateAt(segments, 15)).toBeNull();
    expect(stateAt(segments, 25)).toBeNull();
    expect(stateAt(segments, 35)).toBe("down");
    expect(stateAt(segments, 40)).toBeNull();
    expect(stateAt([], 5)).toBeNull();
  });
});

describe("allRowsTooltip", () => {
  const style = (text: string) => ({ text, color: "#123456", textColor: "#000000" });
  const styles = new Map([
    [styleKeyOf("", "up"), style("Up")],
    [styleKeyOf("", "evil"), style("<img src=x>")],
  ]);
  const rowOf = (name: string, state: string | null) => ({
    name,
    segments: [{ start: 0, end: 60 * S, state }],
  });

  it("lists every row in view with its state, no data, and escapes names and text", () => {
    const rows = [rowOf("a", "up"), rowOf("<b>x</b>", "evil"), rowOf("c", null), rowOf("d", "up")];
    const html = allRowsTooltip(rows, styles, 30 * S, "UTC", { start: 0, end: 2 });
    expect(html).toContain("<strong>1970-01-01 00:00:30</strong>");
    expect(html).toContain("a: Up");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;: &lt;img src=x&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("c: No data");
    expect(html).not.toContain("d: ");
  });

  it("shows the time in the dashboard timezone", () => {
    const html = allRowsTooltip([rowOf("a", "up")], styles, 0, "America/Los_Angeles", {
      start: 0,
      end: 0,
    });
    expect(html).toContain("<strong>1969-12-31 16:00:00</strong>");
  });

  it("shows the first rows in view and a +N more line", () => {
    const rows = Array.from({ length: STATE_TIMELINE_TOOLTIP_MAX_ROWS + 5 }, (_, i) =>
      rowOf(`r${i}`, "up"),
    );
    const html = allRowsTooltip(rows, styles, 0, "UTC", { start: 0, end: rows.length - 1 });
    expect(html.split("<br/>")).toHaveLength(STATE_TIMELINE_TOOLTIP_MAX_ROWS + 2);
    expect(html).toContain("+5 more");
  });
});

describe("all rows tooltip mode", () => {
  const convert = (hovered?: any) =>
    convertStateTimelineData(
      sqlPanel({ tooltip_mode: "all_rows" }),
      [[row(0, "p1", "up"), row(10, "p1", "down"), row(0, "p2", "up"), row(10, "p2", "up")]],
      store,
      null,
      sqlMeta,
      null,
      hovered,
    );

  it("lists the rows in view at the hovered sample time, and follows the reported window", () => {
    const result = convert();
    expect(result.options.tooltip.trigger).toBe("axis");
    expect(result.options.series[0].tooltip.trigger).toBe("none");
    const format = result.options.tooltip.formatter;
    const at10s = [{ seriesIndex: 1, dataIndex: 1 }];
    expect(format(at10s)).toContain("p1: down");
    expect(format(at10s)).toContain("p2: up");
    result.extras.setRowWindow(1, 1);
    expect(format(at10s)).not.toContain("p1:");
  });

  it("lists the states at the pointer time, not the nearest sample", () => {
    const result = convertStateTimelineData(
      sqlPanel({ tooltip_mode: "all_rows" }),
      [[row(0, "p1", "up"), row(100, "p1", "up")]],
      store,
      null,
      sqlMeta,
      null,
    );
    const format = result.options.tooltip.formatter;
    const nearestSample = [{ seriesIndex: 1, dataIndex: 0 }];
    expect(format(nearestSample)).toContain("p1: up");
    result.extras.setPointerTime(toZonedTime(50 * S, "UTC").getTime());
    expect(format(nearestSample)).toContain("p1: No data");
    expect(format(nearestSample)).toContain("<strong>1970-01-01 00:00:50</strong>");
  });

  it("stays empty when the crosshair comes from another panel", () => {
    const result = convert({ value: { panelId: "elsewhere" } });
    expect(result.options.tooltip.formatter([{ seriesIndex: 1, dataIndex: 0 }])).toBe("");
  });

  it("lists rows when this panel is hovered or no panel is", () => {
    for (const panelId of ["p1", -1]) {
      const result = convert({ value: { panelId } });
      expect(result.options.tooltip.formatter([{ seriesIndex: 1, dataIndex: 0 }])).toContain(
        "p1: up",
      );
    }
  });
});

describe("row scroll", () => {
  const scrollingPanel = { value: { offsetHeight: 120, offsetWidth: 800 } };
  const convert = (names: string[], panel = scrollingPanel) =>
    convertStateTimelineData(
      sqlPanel({ show_legends: false }),
      [names.map((name) => row(0, name, "up"))],
      store,
      panel,
      sqlMeta,
      null,
    );
  const names = Array.from({ length: 10 }, (_, i) => `r${i}`);

  it("adds a wheel that moves rows without zooming only when rows scroll", () => {
    const zooms = convert(names).options.dataZoom;
    const wheel = zooms.find((zoom: any) => zoom.type === "inside");
    expect(wheel).toMatchObject({
      id: STATE_TIMELINE_ROW_ZOOM_IDS[1],
      yAxisIndex: 0,
      zoomOnMouseWheel: false,
      moveOnMouseWheel: true,
      moveOnMouseMove: false,
    });
    const visibleRows = zooms[0].endValue + 1;
    expect(wheel.minValueSpan).toBe(visibleRows - 1);
    expect(wheel.maxValueSpan).toBe(visibleRows - 1);
    expect(convert(["only"]).options.dataZoom).toEqual([]);
  });

  it("keeps the scrollbar but adds no wheel when only one row fits, since a zero span cannot move", () => {
    const result = convert(names, { value: { offsetHeight: 70, offsetWidth: 800 } });
    expect(result.options.dataZoom.map((zoom: any) => [zoom.type, zoom.endValue])).toEqual([
      ["slider", 0],
    ]);
    expect(result.extras.rowScroll).toBe(true);
  });

  it("maps a scroll event's percentage range onto whole rows", () => {
    const options = convert(names).options;
    expect(rowWindowFromEvent(options, { start: 41, end: 70 })).toEqual({
      anchor: "r4",
      start: 4,
      end: 6,
    });
    expect(rowWindowFromEvent(options, { start: 100, end: 100 })?.end).toBe(9);
    expect(rowWindowFromEvent(options, { startValue: 2, endValue: 4 })?.start).toBe(2);
  });

  it.each([3.73, 5.56, 16.67, 61.2])(
    "reports the rows ECharts shows for a window starting at %s%",
    (startPercent) => {
      const options = convert(names).options;
      const span = ((options.dataZoom[0].endValue - options.dataZoom[0].startValue) / 9) * 100;
      const event = {
        dataZoomId: STATE_TIMELINE_ROW_ZOOM_IDS[1],
        start: startPercent,
        end: startPercent + span,
      };
      const el = document.createElement("div");
      document.body.appendChild(el);
      const chart = echarts.init(el, null, { renderer: "svg", width: 800, height: 120 });
      chart.setOption(options);
      chart.dispatchAction({ type: "dataZoom", batch: [event] });
      expect(rowWindowFromEvent(options, event)).toEqual(readRowWindow(chart.getOption()));
      chart.dispose();
      el.remove();
    },
  );

  it("reads the window ECharts records after a wheel scroll", () => {
    const options = convert(names).options;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const chart = echarts.init(el, null, { renderer: "svg", width: 800, height: 120 });
    chart.setOption(options);
    const size = options.dataZoom[0].endValue + 1;
    chart.dispatchAction({
      type: "dataZoom",
      // A wheel scroll reports percentages of the row axis, as the inside zoom does.
      batch: [
        {
          dataZoomId: STATE_TIMELINE_ROW_ZOOM_IDS[1],
          start: (4 / 9) * 100,
          end: ((4 + size - 1) / 9) * 100,
        },
      ],
    });
    expect(readRowWindow(chart.getOption())).toEqual({ anchor: "r4", start: 4, end: 4 + size - 1 });
    chart.dispose();
    el.remove();
  });

  it("keeps the first visible row when it survives, else the index, clamped to a full window", () => {
    const next = convert(["new", ...names]).options;
    const size = next.dataZoom[0].endValue + 1;
    const anchored = withRowWindow(next, { anchor: "r4", start: 4, end: 4 + size - 1 });
    expect(anchored.dataZoom.map((zoom: any) => zoom.startValue)).toEqual([5, 5]);

    const gone = withRowWindow(next, { anchor: "removed", start: 4, end: 4 + size - 1 });
    expect(gone.dataZoom[0].startValue).toBe(4);

    const past = withRowWindow(next, { anchor: "removed", start: 99, end: 99 + size - 1 });
    expect(past.dataZoom[0].startValue).toBe(11 - size);
    expect(past.dataZoom[0].endValue).toBe(10);
  });
});

describe("per-row overrides", () => {
  const override = (matchBy: string, value: string, config: any[]) => ({
    field: { matchBy, value },
    config,
  });
  const mappings = (value: any[]) => ({ type: "value_mappings", value });

  it("applies a row's own mapping to that row only, ahead of the panel's", () => {
    const config = {
      mappings: [{ type: "value", value: "down", text: "Down", color: "#0000ff" }],
      override_config: [
        override("series", "p1", [
          mappings([{ type: "value", value: "down", text: "Broken", color: "#ff0000" }]),
        ]),
      ],
    };
    const data = [[row(0, "p1", "down"), row(0, "p2", "down")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const [p1, p2] = segmentsOf(result);
    expect(p1.itemStyle.color).toBe("#ff0000");
    expect(p2.itemStyle.color).toBe("#0000ff");
    const format = result.options.tooltip.formatter;
    expect(format({ seriesIndex: 0, marker: "", data: p1 })).toContain("Broken");
    expect(format({ seriesIndex: 0, marker: "", data: p2 })).toContain("Down");
    expect(legendNames(result)).toEqual(expect.arrayContaining(["Broken", "Down"]));
  });

  it("matches rows by pattern against the raw entity", () => {
    const config = {
      override_config: [
        override("series_regex", "^gpu[12]$", [
          mappings([{ type: "value", value: "up", color: "#00ff00" }]),
        ]),
      ],
    };
    const data = [[row(0, "gpu1", "up"), row(0, "gpu2", "up"), row(0, "nic1", "up")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    expect(segmentsOf(result).map((d: any) => [d.name, d.itemStyle.color === "#00ff00"])).toEqual([
      ["gpu1", true],
      ["gpu2", true],
      ["nic1", false],
    ]);
  });

  it("colours a row's numeric states from its own thresholds", () => {
    const config = {
      thresholds: { mode: "absolute", steps: [{ value: 0, color: "#111111" }] },
      override_config: [
        override("series", "u2", [
          {
            type: "thresholds",
            value: { mode: "absolute", steps: [{ value: 0, color: "#222222" }] },
          },
        ]),
      ],
    };
    const data = [[row(0, "u1", 5), row(0, "u2", 5)]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    expect(segmentsOf(result).map((d: any) => d.itemStyle.color)).toEqual(["#111111", "#222222"]);
  });

  it("relabels a row with its display name, keeping the sort and the drilldown entity", () => {
    const config = {
      override_config: [override("series", "p1", [{ type: "display_name", value: "zzz primary" }])],
    };
    const data = [[row(0, "p1", "up"), row(0, "p2", "up")]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    const axis = result.options.yAxis[0];
    expect(axis.data).toEqual(["p1", "p2"]);
    expect(axis.data.map(axis.axisLabel.formatter)).toEqual(["zzz primary", "p2"]);
    const [p1] = segmentsOf(result);
    expect(stateTimelineDrilldownSeries({ data: p1 }).__name).toBe("p1");
    expect(result.options.tooltip.formatter({ seriesIndex: 0, marker: "", data: p1 })).toContain(
      "zzz primary",
    );
  });
});

describe("annotations", () => {
  it("draws annotations on a series after the crosshair series", () => {
    const annotations = {
      value: [
        { start_time: 5_000_000, title: "deploy" },
        { start_time: 10_000_000, end_time: 20_000_000, title: "maintenance" },
      ],
    };
    const result = convertStateTimelineData(
      sqlPanel(),
      [[row(0, "p1", "up"), row(10, "p1", "up")]],
      store,
      null,
      sqlMeta,
      null,
      undefined,
      annotations,
    );
    expect(result.extras.crosshairSeriesIndex).toBe(1);
    expect(result.options.series[1].tooltip.trigger).toBe("axis");
    const marks = result.options.series[2];
    expect(marks.markLine.data).toHaveLength(1);
    expect(marks.markArea.data).toHaveLength(1);
    expect(marks.tooltip.show).toBe(false);
  });

  it("draws annotations above the segments and makes room for their labels", () => {
    const annotations = { value: [{ start_time: 10_000_000, end_time: 20_000_000, title: "x" }] };
    const convert = (withAnnotations?: any) =>
      convertStateTimelineData(
        sqlPanel(),
        [[row(0, "p1", "up"), row(10, "p1", "up")]],
        store,
        null,
        sqlMeta,
        null,
        undefined,
        withAnnotations,
      );
    const result = convert(annotations);
    const segmentZ = result.options.series[0].z ?? 2;
    const marks = result.options.series[2];
    expect(marks.z).toBeGreaterThan(segmentZ);
    expect(marks.markArea.z).toBeGreaterThan(segmentZ);
    expect(marks.markLine.z).toBeGreaterThan(segmentZ);
    expect(result.options.grid.top).toBeGreaterThan(convert().options.grid.top);
  });

  it("places annotations at zoned times, keeps them out of the legend and beside scrolling rows", () => {
    const annotations = {
      value: [
        { start_time: 5_000_000, title: "deploy" },
        { start_time: 10_000_000, end_time: 20_000_000, title: "maintenance" },
      ],
    };
    const tz = "America/Los_Angeles";
    const laStore = { state: { ...store.state, timezone: tz } };
    const names = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const result = convertStateTimelineData(
      sqlPanel({ show_legends: false }),
      [names.map((name) => row(0, name, "up"))],
      laStore,
      { value: { offsetHeight: 160, offsetWidth: 800 } },
      sqlMeta,
      null,
      undefined,
      annotations,
    );
    expect(result.extras.rowScroll).toBe(true);
    expect(result.options.dataZoom.length).toBeGreaterThan(0);
    expect(result.extras.crosshairSeriesIndex).toBe(1);
    const marks = result.options.series[2];
    expect(marks.markLine.data[0].xAxis.getTime()).toBe(toZonedTime(5 * S, tz).getTime());
    expect(marks.markArea.data[0][0].xAxis.getTime()).toBe(toZonedTime(10 * S, tz).getTime());
    expect(marks.markArea.data[0][1].xAxis.getTime()).toBe(toZonedTime(20 * S, tz).getTime());
    expect(marks.name).toBeUndefined();
    expect(legendNames(result)).toEqual(["up"]);
  });

  it("hands a clicked annotation range its details, as it does a line", () => {
    const annotations = {
      value: [{ id: "r", start_time: 10_000_000, end_time: 20_000_000, title: "x" }],
    };
    const result = convertStateTimelineData(
      sqlPanel(),
      [[row(0, "p1", "up"), row(30, "p1", "up")]],
      store,
      null,
      sqlMeta,
      null,
      undefined,
      annotations,
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const chart = echarts.init(el, null, { renderer: "svg", width: 800, height: 400 });
    chart.setOption(result.options);
    const clicks: any[] = [];
    chart.on("click", (params: any) => clicks.push(params));
    const x = chart.convertToPixel({ xAxisIndex: 0 }, 15 * S) as number;
    const y = (result.options.grid.top as number) + 30;
    const handler = (chart.getZr() as any).handler;
    for (const type of ["mousedown", "mouseup", "click"]) {
      handler.dispatch(type, { zrX: x, zrY: y, offsetX: x, offsetY: y });
    }
    expect(clicks.map((c) => [c.componentType, c.data?.annotationDetails?.id])).toContainEqual([
      "markArea",
      "r",
    ]);
    chart.dispose();
    el.remove();
  });

  it("adds no annotation series without annotations", () => {
    const result = convertStateTimelineData(
      sqlPanel(),
      [[row(0, "p1", "up")]],
      store,
      null,
      sqlMeta,
      null,
    );
    expect(result.options.series.some((series: any) => series.markLine)).toBe(false);
  });
});

describe("style review cases", () => {
  it("keeps percentage thresholds on the whole panel range when another row gets its own mappings", () => {
    const thresholds = { mode: "percentage", steps: [{ value: 50, color: "#ff0000" }] };
    const data = [[row(0, "a", 0), row(0, "b", 60), row(0, "c", 100)]];
    const colourOfB = (config: any) =>
      segmentsOf(convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null)).find(
        (d: any) => d.name === "b",
      ).itemStyle.color;
    expect(colourOfB({ thresholds })).toBe("#ff0000");
    const override = {
      field: { matchBy: "series", value: "a" },
      config: [{ type: "value_mappings", value: [{ type: "value", value: "999", text: "x" }] }],
    };
    expect(colourOfB({ thresholds, override_config: [override] })).toBe("#ff0000");
  });

  it("re-anchors on a unique row when many rows share one display name", () => {
    const names = Array.from({ length: 30 }, (_, i) => `r${i}`);
    const config = {
      show_legends: false,
      override_config: [
        {
          field: { matchBy: "series_regex", value: "^r" },
          config: [{ type: "display_name", value: "GPU" }],
        },
      ],
    };
    const options = convertStateTimelineData(
      sqlPanel(config),
      [names.map((name) => row(0, name, "up"))],
      store,
      { value: { offsetHeight: 120, offsetWidth: 800 } },
      sqlMeta,
      null,
    ).options;
    expect(new Set(options.yAxis[0].data).size).toBe(30);
    expect(options.yAxis[0].axisLabel.formatter("r10")).toBe("GPU");
    const kept = withRowWindow(options, { anchor: "r10", start: 10, end: 12 });
    expect(kept.dataZoom[0].startValue).toBe(10);
  });

  it("splits a mapped text into two legend entries when thresholds colour its states differently", () => {
    const config = {
      mappings: [
        { type: "value", value: "1", text: "Busy" },
        { type: "value", value: "5", text: "Busy" },
      ],
      thresholds: { mode: "absolute", steps: [{ value: 3, color: "#ff0000" }] },
    };
    const data = [[row(0, "u1", 1), row(10, "u1", 5)]];
    const result = convertStateTimelineData(sqlPanel(config), data, store, null, sqlMeta, null);
    expect(legendNames(result).map((name: string) => name.replace(/\u200b/g, ""))).toEqual([
      "Busy",
      "Busy",
    ]);
  });

  it("caps on raw states, so a state split by a row's thresholds is counted once", () => {
    const states = Array.from({ length: STATE_TIMELINE_MAX_STATES }, (_, i) => String(i + 1));
    const override = {
      field: { matchBy: "series", value: "own" },
      config: [
        {
          type: "thresholds",
          value: { mode: "absolute", steps: [{ value: 0, color: "#123456" }] },
        },
      ],
    };
    const data = [
      [...states.map((state, i) => row(i * 10, "panel", Number(state))), row(0, "own", 1)],
    ];
    const result = convertStateTimelineData(
      sqlPanel({ override_config: [override] }),
      data,
      store,
      null,
      sqlMeta,
      null,
    );
    expect(result.extras.seriesLimit).toBeUndefined();
    expect(legendNames(result)).not.toContain("Other");
  });
});
