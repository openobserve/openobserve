// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { convertToUtcTimestamp } from "@/utils/timezone";
import {
  DURATION_BOUNDS_US,
  bucketBounds,
  formatDurationBound,
  buildLatencyHeatmapSql,
  buildHeatmapGrid,
  selectionFromBox,
  instantToPickerMs,
  durationBand,
  composeFilter,
  isRangeSelectionCurrent,
  type LatencyHeatmapHit,
} from "./latencyHeatmap";

let parser: any;

async function getParser() {
  if (parser) return parser;
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  parser = new mod.default.Parser();
  return parser;
}

const S = 1_000_000;
const T0 = Date.UTC(2026, 9, 6, 10, 0, 0) * 1000;

const hit = (secondsAfterT0: number, bucket: number, count: number): LatencyHeatmapHit => ({
  x_axis: new Date((T0 + secondsAfterT0 * S) / 1000).toISOString().slice(0, 19),
  duration_bucket: bucket,
  span_count: count,
});

describe("bucketBounds", () => {
  it("maps the bottom, second, top-bounded and open top buckets", () => {
    expect(bucketBounds(0)).toEqual({ lo: 0, hi: 1 });
    expect(bucketBounds(1)).toEqual({ lo: 1, hi: 2 });
    expect(bucketBounds(27)).toEqual({ lo: 5e8, hi: 1e9 });
    expect(bucketBounds(28)).toEqual({ lo: 1e9, hi: null });
  });
});

describe("buildLatencyHeatmapSql", () => {
  const bucketOf = (us: number) => DURATION_BOUNDS_US.filter((b) => b <= us).length;

  it("orders the CASE so the first matching WHEN is the reference bucket", () => {
    const sql = buildLatencyHeatmapSql("default", []);
    const whens = [...sql.matchAll(/WHEN duration < (\d+) THEN (\d+)/g)].map((m) => ({
      bound: Number(m[1]),
      bucket: Number(m[2]),
    }));
    const elseBucket = Number(sql.match(/ELSE (\d+) END/)![1]);
    const sqlBucketOf = (us: number) => whens.find((w) => us < w.bound)?.bucket ?? elseBucket;
    for (const us of [0, 1, 2, 4, 5, 999, 1000, 999_999, 1_000_000, 2e9]) {
      expect(sqlBucketOf(us)).toBe(bucketOf(us));
    }
    expect(sql).toContain("WHEN duration < 1000 THEN 9");
    expect(sql).toContain("ELSE 28 END");
  });

  it("groups by time and duration bucket with an explicit row limit", () => {
    const sql = buildLatencyHeatmapSql("default", []);
    expect(sql).toContain("histogram(_timestamp) AS x_axis");
    expect(sql).toContain("count(*) AS span_count");
    expect(sql).toContain("GROUP BY x_axis, duration_bucket");
    expect(sql).toContain("LIMIT 20000");
  });

  it("quotes the stream and joins filters into one WHERE", () => {
    expect(buildLatencyHeatmapSql("my-stream", [])).toContain('FROM "my-stream"');
    expect(buildLatencyHeatmapSql("s", [])).not.toMatch(/\bWHERE\b/);
    expect(buildLatencyHeatmapSql("s", ["a", "b"])).toContain('FROM "s" WHERE a AND b GROUP BY');
  });
});

describe("formatDurationBound", () => {
  it("uses the largest unit that divides the value", () => {
    expect(formatDurationBound(1)).toBe("1us");
    expect(formatDurationBound(2)).toBe("2us");
    expect(formatDurationBound(5000)).toBe("5ms");
    expect(formatDurationBound(100_000_000)).toBe("100s");
  });

  it("round-trips every bound through the editor's duration parser", async () => {
    const p = await getParser();
    for (const us of DURATION_BOUNDS_US) {
      const decoded = parseDurationWhereClause(
        `duration >= '${formatDurationBound(us)}'`,
        p,
        "default",
      );
      expect(decoded).toMatch(new RegExp(`duration >= ${us}$`));
    }
  });
});

describe("buildHeatmapGrid", () => {
  it("returns null for no hits", () => {
    expect(buildHeatmapGrid([], 10, T0, T0 + 60 * S)).toBeNull();
  });

  it("fills empty time columns across the range, anchored on the returned bucket", () => {
    const grid = buildHeatmapGrid([hit(20, 5, 3)], 10, T0 + 5 * S, T0 + 60 * S)!;
    expect(grid.intervalUs).toBe(10 * S);
    expect(grid.colStartUs).toEqual([0, 10, 20, 30, 40, 50].map((s) => T0 + s * S));
    expect(grid.cells).toEqual([[2, 0, Math.log1p(3), 3]]);
  });

  it("keeps empty duration rows between two modes", () => {
    const grid = buildHeatmapGrid([hit(0, 3, 1), hit(0, 9, 1)], 10, T0, T0 + 10 * S)!;
    expect(grid.rows).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps bucket 0", () => {
    const grid = buildHeatmapGrid([hit(0, 0, 2), hit(0, 2, 1)], 10, T0, T0 + 10 * S)!;
    expect(grid.rows).toEqual([0, 1, 2]);
    expect(grid.cells).toContainEqual([0, 0, Math.log1p(2), 2]);
  });

  it("builds rows only from hits that land inside the columns", () => {
    const grid = buildHeatmapGrid(
      [hit(10, 5, 1), hit(-600, 0, 9), hit(900, 28, 9)],
      10,
      T0,
      T0 + 30 * S,
    )!;
    expect(grid.rows).toEqual([5]);
    expect(grid.cells).toEqual([[1, 0, Math.log1p(1), 1]]);
    expect(grid.maxValue).toBe(Math.log1p(1));
  });

  it("returns null when no hit lands inside the columns", () => {
    expect(buildHeatmapGrid([hit(-600, 4, 3), hit(900, 6, 3)], 10, T0, T0 + 30 * S)).toBeNull();
  });

  it("puts log1p(count) at index 2 and the raw count at index 3", () => {
    const grid = buildHeatmapGrid([hit(10, 4, 99)], 10, T0, T0 + 30 * S)!;
    expect(grid.cells[0]).toEqual([1, 0, Math.log1p(99), 99]);
    expect(grid.maxValue).toBe(Math.log1p(99));
  });
});

describe("selectionFromBox", () => {
  // Range 10:00:05–10:01:00 → columns 10:00:00 … 10:00:50; rows are buckets 3..9.
  const grid = buildHeatmapGrid([hit(0, 3, 1), hit(50, 9, 1)], 10, T0 + 5 * S, T0 + 60 * S)!;

  it("accepts index 0 and clamps the start to the search range", () => {
    expect(selectionFromBox(grid, { start: 0, end: 0, start1: 0, end1: 0 })).toEqual({
      timeStartUs: T0 + 5 * S,
      timeEndUs: T0 + 10 * S,
      durationLoUs: 5,
      durationHiUs: 10,
    });
  });

  it("normalises reversed and fractional indices", () => {
    const sel = selectionFromBox(grid, { start: 3.4, end: 1.6, start1: 2.2, end1: 0.6 });
    expect(sel.timeStartUs).toBe(T0 + 20 * S);
    expect(sel.timeEndUs).toBe(T0 + 40 * S);
    expect(sel.durationLoUs).toBe(10);
    expect(sel.durationHiUs).toBe(50);
  });

  it("clamps out-of-range indices and the end time to the search range", () => {
    const sel = selectionFromBox(grid, { start: -4, end: 99, start1: -1, end1: 99 });
    expect(sel.timeStartUs).toBe(T0 + 5 * S);
    expect(sel.timeEndUs).toBe(T0 + 60 * S);
    expect(sel.durationLoUs).toBe(5);
    expect(sel.durationHiUs).toBe(1000);
  });

  it("ends at the column start plus the interval", () => {
    const sel = selectionFromBox(grid, { start: 2, end: 2, start1: 0, end1: 0 });
    expect(sel.timeEndUs).toBe(T0 + 30 * S);
  });

  it("gives lo 0 for bucket 0 and hi null for bucket 28", () => {
    const edges = buildHeatmapGrid([hit(0, 0, 1), hit(0, 28, 1)], 10, T0, T0 + 10 * S)!;
    const sel = selectionFromBox(edges, { start: 0, end: 0, start1: 0, end1: 28 });
    expect(sel.durationLoUs).toBe(0);
    expect(sel.durationHiUs).toBeNull();
  });

  it("matches the spec's worked example", () => {
    const at = (h: number, m: number, s: number) => Date.UTC(2026, 9, 6, h, m, s) * 1000;
    const hits: LatencyHeatmapHit[] = [
      { x_axis: "2026-10-06T10:00:00", duration_bucket: 16, span_count: 4 },
      { x_axis: "2026-10-06T10:04:50", duration_bucket: 17, span_count: 2 },
    ];
    const g = buildHeatmapGrid(hits, 10, at(10, 0, 0), at(10, 5, 0))!;
    const col = (h: number, m: number, s: number) => g.colStartUs.indexOf(at(h, m, s));
    const sel = selectionFromBox(g, {
      start: col(10, 2, 0),
      end: col(10, 2, 30),
      start1: g.rows.indexOf(16),
      end1: g.rows.indexOf(17),
    });
    expect(sel).toEqual({
      timeStartUs: at(10, 2, 0),
      timeEndUs: at(10, 2, 40),
      durationLoUs: 100_000,
      durationHiUs: 500_000,
    });
    expect(durationBand(sel.durationLoUs, sel.durationHiUs)).toBe(
      "duration >= '100ms' and duration < '500ms'",
    );
    expect(
      composeFilter(
        "service_name = 'a' or span_status = 'ERROR'",
        durationBand(sel.durationLoUs, sel.durationHiUs),
      ),
    ).toBe(
      "(service_name = 'a' or span_status = 'ERROR') and duration >= '100ms' and duration < '500ms'",
    );
  });
});

describe("durationBand / composeFilter", () => {
  const band = "duration >= '100ms' and duration < '500ms'";

  it("omits a null or zero lower side and a null upper side", () => {
    expect(durationBand(100_000, 500_000)).toBe(band);
    expect(durationBand(0, 1000)).toBe("duration < '1ms'");
    expect(durationBand(null, 1000)).toBe("duration < '1ms'");
    expect(durationBand(1e9, null)).toBe("duration >= '1000s'");
    expect(durationBand(0, null)).toBe("");
  });

  it("returns the band alone for an empty baseline", () => {
    expect(composeFilter("", band)).toBe(band);
    expect(composeFilter("  ", band)).toBe(band);
  });

  it("returns the baseline unchanged for an empty band", () => {
    expect(composeFilter("service_name = 'a'", "")).toBe("service_name = 'a'");
  });

  it("groups an OR baseline", () => {
    expect(composeFilter("a = '1' or b = '2'", band)).toBe(`(a = '1' or b = '2') and ${band}`);
  });

  it("keeps and intersects a baseline duration condition", () => {
    expect(composeFilter("duration >= '1ms'", band)).toBe(`(duration >= '1ms') and ${band}`);
  });

  it("restores the baseline exactly for a full-height box", () => {
    const baseline = "service_name = 'a'  or x = 1";
    expect(composeFilter(baseline, durationBand(0, null))).toBe(baseline);
  });

  it("composes a refinement from the carried-forward baseline, not the first band", () => {
    const baseline = "service_name = 'a'";
    const second = durationBand(200_000, 500_000);
    const text = composeFilter(baseline, second);
    expect(text).toBe(`(service_name = 'a') and ${second}`);
    expect(text).not.toContain("'100ms'");
  });
});

describe("instantToPickerMs", () => {
  const instantMs = Date.UTC(2026, 9, 6, 10, 2, 0);

  it("shifts by the app-zone offset so browser-local getters read the app-zone wall clock", () => {
    const ms = instantToPickerMs(instantMs, "Asia/Kolkata");
    expect(ms).toBe(instantMs + 5.5 * 3600 * 1000);
    const local = new Date(ms);
    expect(local.getHours()).toBe(15);
    expect(local.getMinutes()).toBe(32);
  });

  it("round-trips through the picker's local format and app-zone parse", () => {
    const d = new Date(instantToPickerMs(instantMs, "Asia/Kolkata"));
    const pad = (n: number) => String(n).padStart(2, "0");
    const text = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    expect(convertToUtcTimestamp(text, "Asia/Kolkata") / 1000).toBe(instantMs);
  });

  it("is the identity when the app zone equals the browser zone", () => {
    expect(instantToPickerMs(instantMs, "UTC")).toBe(instantMs);
  });
});

describe("isRangeSelectionCurrent", () => {
  const entry = {
    panelTitle: "Duration",
    start: 100_000,
    end: 500_000,
    timeStart: 10,
    timeEnd: 20,
    appliedStart: 1_000_000,
    appliedEnd: 2_000_000,
    baselineFilter: "service_name = 'a'",
    stream: "default",
    searchMode: "traces" as const,
  };
  const composed = "(service_name = 'a') and duration >= '100ms' and duration < '500ms'";
  const current = (overrides: Record<string, unknown> = {}) => ({
    startTime: 1_000_000,
    endTime: 2_000_000,
    stream: "default",
    searchMode: "traces" as const,
    editorText: composed,
    ...overrides,
  });

  it("keeps a selection whose applied range, composed text, stream and mode all match", () => {
    expect(isRangeSelectionCurrent(entry, current())).toBe(true);
  });

  it("keeps it when the composed text differs only in whitespace", () => {
    const spaced = "(service_name  =  'a')\n and duration >= '100ms'   and duration < '500ms' ";
    expect(isRangeSelectionCurrent(entry, current({ editorText: spaced }))).toBe(true);
  });

  it("drops it for a different applied range", () => {
    expect(isRangeSelectionCurrent(entry, current({ endTime: 2_000_001 }))).toBe(false);
    expect(isRangeSelectionCurrent(entry, current({ startTime: 999_999 }))).toBe(false);
  });

  it("drops it when the band is removed from the editor", () => {
    expect(isRangeSelectionCurrent(entry, current({ editorText: "service_name = 'a'" }))).toBe(
      false,
    );
  });

  it("drops it for an unrelated filter edit in the baseline part", () => {
    const edited = composed.replace("'a'", "'b'");
    expect(isRangeSelectionCurrent(entry, current({ editorText: edited }))).toBe(false);
  });

  it("drops it when Error Only appends a span_status term", () => {
    const toggled = `${composed} and span_status = 'ERROR'`;
    expect(isRangeSelectionCurrent(entry, current({ editorText: toggled }))).toBe(false);
  });

  it("keeps a both-null entry whose editor equals its baseline text", () => {
    const full = { ...entry, start: null, end: null };
    expect(isRangeSelectionCurrent(full, current({ editorText: "service_name = 'a'" }))).toBe(true);
  });

  it("drops it for a different stream", () => {
    expect(isRangeSelectionCurrent(entry, current({ stream: "other" }))).toBe(false);
  });

  it("drops it for a different search mode", () => {
    expect(isRangeSelectionCurrent(entry, current({ searchMode: "spans" }))).toBe(false);
  });
});
