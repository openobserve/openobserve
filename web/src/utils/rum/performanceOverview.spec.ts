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

import { describe, expect, it } from "vitest";
import { PAGE_KEY_PASSES } from "@/utils/rum/productAnalyticsQueries";
import {
  andFilters,
  bandCounts,
  bandOf,
  bandPercents,
  biggestDifference,
  bucketInterval,
  chartSql,
  deltaSentenceKey,
  formatInZone,
  mapSegments,
  formatCount,
  formatPercent,
  intervalFromKey,
  overviewStateOnly,
  queryFromState,
  stateFromQuery,
  withoutOverviewState,
  deltaOf,
  drillQuery,
  fillBuckets,
  intervalMicros,
  filterOptionsSql,
  formatVital,
  analyticsQuery,
  impactScores,
  dropOpenBucket,
  releaseTone,
  kpiSql,
  isLowData,
  kpiDelta,
  pageFilter,
  overThresholdPct,
  pagesSql,
  previousUsable,
  releaseNewErrorsSql,
  previousWindow,
  rankPages,
  releaseRowsFromKpi,
  releaseSessionsSql,
  releaseVitalsSql,
  scopeWhere,
  segmentDims,
  segmentsSql,
  seriesSql,
  splitSegments,
  versionPredatesRange,
  windowRow,
  verdictOf,
  vitalDelta,
  vitalsSql,
  type QueryCtx,
  type SegmentRow,
} from "./performanceOverview";

const FULL = [
  "service",
  "env",
  "version",
  "session_id",
  "view_id",
  "view_url",
  "view_name",
  "view_error_count",
  "view_largest_contentful_paint",
  "view_interaction_to_next_paint",
  "view_cumulative_layout_shift",
  "user_agent_user_agent_family",
  "user_agent_user_agent_major",
  "user_agent_device_family",
  "geo_info_country",
  "action_frustration_type",
  "error_id",
  "error_handling",
];
const SPLIT = 1_700_000_000_000_000;
const ctx = (
  fields: string[] = FULL,
  filters = { service: [], env: [], version: [] } as QueryCtx["filters"],
): QueryCtx => ({
  schema: new Set(fields),
  filters,
});

describe("bandOf", () => {
  it.each([
    ["lcp", 2.5e9, "good"],
    ["lcp", 2.5e9 + 1, "needs"],
    ["lcp", 4e9, "needs"],
    ["lcp", 4e9 + 1, "poor"],
    ["inp", 2e8, "good"],
    ["inp", 5e8, "needs"],
    ["inp", 5.1e8, "poor"],
    ["cls", 0.1, "good"],
    ["cls", 0.25, "needs"],
    ["cls", 0.26, "poor"],
  ] as const)("%s %s is %s", (vital, value, band) => {
    expect(bandOf(vital, value)).toBe(band);
  });

  it("returns null without a value", () => {
    expect(bandOf("lcp", null)).toBeNull();
    expect(bandOf("lcp", undefined)).toBeNull();
  });
});

describe("band distribution", () => {
  it("derives needs-work as the remainder", () => {
    expect(bandCounts(100, 70, 10)).toEqual({ good: 70, needs: 20, poor: 10 });
  });

  it("never goes negative on inconsistent counts", () => {
    expect(bandCounts(10, 20, 20)).toEqual({ good: 10, needs: 0, poor: 0 });
  });

  it("rounds percentages to exactly 100", () => {
    const p = bandPercents({ good: 1, needs: 1, poor: 1 });
    expect(p.good + p.needs + p.poor).toBe(100);
  });

  it("returns zeros for an empty distribution", () => {
    expect(bandPercents({ good: 0, needs: 0, poor: 0 })).toEqual({ good: 0, needs: 0, poor: 0 });
  });
});

describe("verdictOf", () => {
  it("passes when every assessed vital is good", () => {
    expect(verdictOf({ lcp: 2e9, inp: 1e8, cls: 0.05 })).toEqual({
      pass: true,
      failing: [],
      assessed: 3,
    });
  });

  it("lists failing vitals and counts them", () => {
    const v = verdictOf({ lcp: 2e9, inp: 3e8, cls: 0.3 });
    expect(v.pass).toBe(false);
    expect(v.failing).toEqual(["inp", "cls"]);
  });

  it("does not assess a vital with no data", () => {
    expect(verdictOf({ lcp: 2e9, inp: null, cls: null })).toEqual({
      pass: true,
      failing: [],
      assessed: 1,
    });
  });
});

describe("isLowData", () => {
  it("is low under 100 views", () => {
    expect(isLowData(99)).toBe(true);
    expect(isLowData(100)).toBe(false);
  });
});

describe("deltaOf", () => {
  it("computes absolute and percent change", () => {
    expect(deltaOf(120, 100)).toEqual({ abs: 20, pct: 20, direction: "up" });
    expect(deltaOf(80, 100)?.direction).toBe("down");
  });

  it("reports flat inside half a percent", () => {
    expect(deltaOf(100.2, 100)?.direction).toBe("flat");
  });

  it("has no percent against a zero baseline", () => {
    expect(deltaOf(5, 0)?.pct).toBeNull();
  });

  it("is null when either side is missing", () => {
    expect(deltaOf(null, 1)).toBeNull();
    expect(deltaOf(1, null)).toBeNull();
  });
});

describe("kpiDelta and vitalDelta", () => {
  it("marks growth in errors as bad and in sessions as good", () => {
    expect(kpiDelta(137, 100, { higherIsBetter: false })).toEqual({
      kind: "change",
      text: "+37%",
      tone: "bad",
    });
    expect(kpiDelta(112, 100, { higherIsBetter: true })).toEqual({
      kind: "change",
      text: "+12%",
      tone: "good",
    });
  });

  it("reports points for percentages", () => {
    expect(kpiDelta(96.2, 97.6, { higherIsBetter: true, points: true })).toEqual({
      kind: "change",
      text: "-1.4",
      tone: "bad",
    });
  });

  it("reads a lower vital as faster", () => {
    expect(vitalDelta("lcp", 2.1e9, 2.3e9)).toEqual({ kind: "faster", text: "0.20 s" });
    expect(vitalDelta("inp", 240e6, 202e6)).toEqual({ kind: "slower", text: "38 ms" });
    expect(vitalDelta("cls", 0.07, 0.07)).toEqual({ kind: "none", text: "" });
    expect(vitalDelta("cls", null, 0.07)).toBeNull();
  });
});

describe("previousWindow", () => {
  it("is the equal-length window ending where the current one starts", () => {
    expect(previousWindow(1000, 1600)).toEqual({ startUs: 400, endUs: 1000 });
  });
});

describe("impact ranking", () => {
  it("scales the worst page to 100", () => {
    expect(impactScores([{ bad: 50 }, { bad: 25 }, { bad: 0 }])).toEqual([100, 50, 0]);
  });

  it("scores zero when nothing is bad", () => {
    expect(impactScores([{ bad: 0 }])).toEqual([0]);
  });

  it("hides pages under 100 views and sorts by impact", () => {
    const row = (path: string, views: number, bad: number) => ({
      path,
      views,
      lcp: null,
      inp: null,
      cls: null,
      errors: 0,
      bad,
    });
    const ranked = rankPages([row("/a", 150, 10), row("/b", 99, 99), row("/c", 400, 40)]);
    expect(ranked.map((r) => r.path)).toEqual(["/c", "/a"]);
    expect(ranked.map((r) => r.impact)).toEqual([100, 25]);
  });
});

describe("biggestDifference", () => {
  const seg = (label: string, views: number, inp: number): SegmentRow => ({
    label,
    views,
    inp,
    lcp: null,
    share: 0,
    filter: `f='${label}'`,
  });

  it("picks the segment furthest above the others", () => {
    const d = biggestDifference({
      browser: [seg("A", 100, 600e6), seg("B", 100, 150e6), seg("C", 100, 150e6)],
    });
    expect(d?.label).toBe("A");
    expect(d?.ratio).toBeCloseTo(4);
  });

  it("returns null when nothing stands out", () => {
    expect(biggestDifference({ browser: [seg("A", 100, 150e6), seg("B", 100, 140e6)] })).toBeNull();
  });

  it("ignores segments with too few views", () => {
    expect(biggestDifference({ browser: [seg("A", 5, 900e6), seg("B", 100, 100e6)] })).toBeNull();
  });
});

describe("formatVital", () => {
  it("formats per vital", () => {
    expect(formatVital("lcp", 2.1e9)).toBe("2.10 s");
    expect(formatVital("inp", 240e6)).toBe("240 ms");
    expect(formatVital("cls", 0.07)).toBe("0.07");
    expect(formatVital("lcp", null)).toBe("\u2014");
  });
});

describe("bucketInterval", () => {
  it("scales the bucket with the window", () => {
    const h = 3.6e9;
    expect(bucketInterval(0, h)).toBe("5 minute");
    expect(bucketInterval(0, 24 * h)).toBe("1 hour");
    expect(bucketInterval(0, 24 * 60 * h)).toBe("1 day");
  });
});

describe("query builders", () => {
  it("dedupes view events to the latest row per view_id before percentiles", () => {
    const sql = vitalsSql(ctx(), SPLIT);
    expect(sql).toContain("GROUP BY view_id");
    expect(sql).toContain("approx_percentile_cont(lcp, 0.75)");
    expect(sql).toContain("MAX(view_largest_contentful_paint)");
    expect(sql.split('FROM "_rumdata"')).toHaveLength(2);
  });

  it("compares against the published thresholds", () => {
    const sql = vitalsSql(ctx(), SPLIT);
    expect(sql).toContain("lcp <= 2500000000");
    expect(sql).toContain("inp > 500000000");
    expect(sql).toContain("cls <= 0.1");
  });

  it("reads an absent column as NULL instead of naming it", () => {
    const sql = vitalsSql(ctx(["service", "view_id"]), SPLIT);
    expect(sql).toContain("CAST(NULL AS BIGINT)");
    expect(sql).not.toContain("MAX(view_largest_contentful_paint)");
  });

  it("splits each view by window flag so one scan serves both windows", () => {
    const sql = vitalsSql(ctx(), SPLIT);
    const flag = `CASE WHEN _timestamp >= ${SPLIT} THEN 1 ELSE 0 END`;
    expect(sql).toContain(`${flag} AS w`);
    expect(sql).toContain(`GROUP BY view_id, ${flag}`);
    expect(sql).toContain("SELECT w, COUNT(*) AS views");
    expect(sql).toContain("GROUP BY w");
  });

  it("applies service, env and version filters", () => {
    const sql = kpiSql(ctx(FULL, { service: ["web"], env: ["prod"], version: [] }), SPLIT, true);
    expect(sql).toContain("service IN ('web')");
    expect(sql).toContain("env IN ('prod')");
    expect(sql).not.toContain("version IN");
  });

  it("keeps only browser rows when the stream has a source column", () => {
    const withSource = ctx([...FULL, "source", "error_message"]);
    const pred = "(source IS NULL OR source IN ('', 'browser'))";
    expect(scopeWhere(withSource)).toBe(pred);
    for (const sql of [
      vitalsSql(withSource, SPLIT),
      kpiSql(withSource, SPLIT, true),
      segmentsSql(withSource)!,
      pagesSql(withSource),
      seriesSql(withSource, "1 hour"),
      chartSql(withSource, "1 hour"),
      releaseSessionsSql(withSource)!,
      releaseVitalsSql(withSource, ["v1"])!,
      releaseNewErrorsSql(withSource, "v2", "v1")!,
      filterOptionsSql(new Set(["service", "source"]))!,
    ]) {
      expect(sql).toContain(pred);
    }
    expect(scopeWhere(ctx())).not.toContain("source");
    expect(filterOptionsSql(new Set(["service"]))).not.toContain("WHERE");
  });

  it("excludes synthetic sessions only when the column exists", () => {
    expect(scopeWhere(ctx([...FULL, "session_type"]))).toContain("synthetics");
    expect(scopeWhere(ctx())).toBe("1 = 1");
  });

  it("ranks pages with a poor-or-error predicate and a view floor", () => {
    const sql = pagesSql(ctx());
    expect(sql).toContain("HAVING COUNT(*) >= 100");
    expect(sql).toContain("ec > 0");
    expect(sql).toContain("lcp > 2500000000");
  });

  it("drops the error predicate without view_error_count", () => {
    expect(pagesSql(ctx(FULL.filter((f) => f !== "view_error_count")))).not.toContain("ec > 0");
  });

  it("groups every present segment dimension in one query", () => {
    const sql = segmentsSql(ctx([...FULL, "user_agent_os_family"]))!;
    expect(sql.split('FROM "_rumdata"')).toHaveLength(2);
    expect(sql).toContain("MIN(user_agent_user_agent_major) AS s0_1");
    expect(sql).toContain("MIN(user_agent_os_family) AS s2_0");
    expect(sql).toContain("GROUPING SETS ((s0_0, s0_1), (s1_0), (s2_0), (s3_0))");
    expect(sql).toContain("GROUPING(s3_0) AS g3");
    expect(sql).not.toContain("connectivity_effective_type");
  });

  it("offers OS and connection only when their columns exist", () => {
    expect(segmentDims(ctx())).toEqual(["browser", "device", "country"]);
    expect(
      segmentDims(ctx([...FULL, "user_agent_os_family", "connectivity_effective_type"])),
    ).toEqual(["browser", "device", "os", "country", "connection"]);
    expect(segmentsSql(ctx(["view_id"]))).toBeNull();
  });

  it("splits grouped segment rows per dimension, dropping blanks and keeping the top 8", () => {
    const c = ctx(["view_id", "user_agent_device_family", "geo_info_country"]);
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ s1_0: `C${i}`, g0: 1, g1: 0, views: 10 + i })),
      { s0_0: "Mobile", g0: 0, g1: 1, views: 5 },
      { s0_0: "", g0: 0, g1: 1, views: 50 },
      { g0: 1, g1: 0, views: 99 },
      { s1_0: "AA", g0: 1, g1: 0, views: 12 },
    ];
    const out = splitSegments(c, rows);
    expect(out.device).toEqual([{ d0: "Mobile", views: 5, inp: undefined, lcp: undefined }]);
    expect(out.country?.map((r) => r.d0)).toEqual(["C9", "C8", "C7", "C6", "C5", "C4", "C3", "AA"]);
  });

  it("folds totals, frustration and release sessions for both windows into one KPI query", () => {
    const sql = kpiSql(ctx(), SPLIT, true);
    expect(sql.split('FROM "_rumdata"')).toHaveLength(2);
    expect(sql).toContain("GROUP BY GROUPING SETS ((w), (w, version))");
    expect(sql).toContain(
      "COUNT(DISTINCT CASE WHEN type = 'error' AND session_id IS NOT NULL THEN error_id END) AS errors",
    );
    expect(sql).toContain("strpos(action_frustration_type, 'rage_click') > 0");
    expect(sql).toContain(
      "MIN(CASE WHEN session_id IS NOT NULL THEN _timestamp END) AS first_seen",
    );
    expect(sql).not.toContain("session_id IS NOT NULL AND 1 = 1");
  });

  it("leaves release out of the KPI query when asked or without a version column", () => {
    expect(kpiSql(ctx(), SPLIT, false)).not.toContain("version");
    const bare = kpiSql(ctx(["session_id"]), SPLIT, true);
    expect(bare).not.toContain("GROUPING");
    expect(bare).not.toContain("rage");
    expect(bare).toContain("0 AS unhandled");
    expect(bare).toContain("CAST(NULL AS VARCHAR)");
  });

  it("reads the whole-window row and the two latest current versions from KPI rows", () => {
    const rows = [
      { w: 1, gv: 1, sessions: 9 },
      { w: 0, gv: 1, sessions: 4 },
      { w: 1, gv: 0, version: "1.0", first_seen: 10, sessions: 5 },
      { w: 1, gv: 0, version: "1.2", first_seen: 30, sessions: 2 },
      { w: 1, gv: 0, version: "1.1", first_seen: 20, sessions: 2 },
      { w: 1, gv: 0, first_seen: 99, sessions: 1 },
      { w: 1, gv: 0, version: "x", sessions: 0 },
      { w: 0, gv: 0, version: "2.0", first_seen: 50, sessions: 1 },
    ];
    expect(windowRow(rows, 1)?.sessions).toBe(9);
    expect(windowRow(rows, 0)?.sessions).toBe(4);
    expect(windowRow([{ w: 1, sessions: 3 }], 1)?.sessions).toBe(3);
    expect(windowRow([{ w: 1, sessions: 3 }], 0)).toBeUndefined();
    expect(releaseRowsFromKpi(rows).map((r) => r.version)).toEqual(["1.2", "1.1"]);
  });

  it("buckets the series with histogram", () => {
    expect(seriesSql(ctx(), "1 hour")).toContain("histogram(_timestamp, '1 hour')");
  });

  it("hides release queries when the version column is absent", () => {
    const bare = ctx(["service"]);
    expect(releaseSessionsSql(bare)).toBeNull();
    expect(releaseVitalsSql(bare, ["v1"])).toBeNull();
  });

  it("limits release vitals to the compared versions", () => {
    expect(releaseVitalsSql(ctx(), ["v2", "v1"])).toContain("version IN ('v2','v1')");
  });

  it("lists filter options from the columns present", () => {
    expect(filterOptionsSql(new Set(["service", "env"]))).toContain("SELECT service, env FROM");
  });
});

describe("drill-down filters", () => {
  it("prefilters by substring and then requires the exact normalised page key", () => {
    const f = pageFilter("/product/:id", new Set(FULL));
    expect(f).toContain("strpos(view_url, '/product/') > 0");
    expect(f.endsWith("= '/product/:id'")).toBe(true);
    expect(f).toContain("regexp_replace(view_url");
  });

  it("escapes quotes", () => {
    expect(pageFilter("/it's", new Set(FULL))).toContain("= '/it''s'");
  });

  it("joins filters and skips empty ones", () => {
    expect(andFilters("a=1", null, "b=2")).toBe("a=1 AND b=2");
  });
});

describe("missing-column SQL", () => {
  const withoutCols = (...cols: string[]) =>
    vitalsSql(ctx(FULL.filter((f) => !cols.includes(f))), SPLIT);

  it("emits a bare typed NULL per missing vital so output names stay unique", () => {
    const sql = withoutCols("view_interaction_to_next_paint", "view_cumulative_layout_shift");
    expect(sql).toContain("CAST(NULL AS BIGINT) AS inp");
    expect(sql).toContain("CAST(NULL AS DOUBLE) AS cls");
    expect(sql).toContain("MAX(view_largest_contentful_paint) AS lcp");
    expect(sql).not.toMatch(/MAX\(CAST\(NULL/);
  });

  it("handles all three vitals missing", () => {
    const sql = withoutCols(
      "view_largest_contentful_paint",
      "view_interaction_to_next_paint",
      "view_cumulative_layout_shift",
    );
    expect(sql).not.toMatch(/MAX\(/);
    expect(sql.match(/CAST\(NULL AS/g)).toHaveLength(3);
  });

  it("uses bare NULLs for the page query extras", () => {
    const sql = pagesSql(ctx(["view_id"]));
    expect(sql).toContain("CAST(NULL AS VARCHAR) AS url");
    expect(sql).toContain("CAST(NULL AS BIGINT) AS ec");
  });
});

describe("kpiDelta zero baseline", () => {
  it("is neutral when growing from zero", () => {
    expect(kpiDelta(5, 0, { higherIsBetter: false })).toEqual({
      kind: "new",
      text: "",
      tone: "flat",
    });
  });
});

describe("versionPredatesRange", () => {
  const start = 0;
  const end = 100;
  it("flags a version first seen at the start of the range", () => {
    expect(versionPredatesRange(1, start, end, 0, 2)).toBe(true);
  });
  it("flags a version first seen in the first bucket", () => {
    expect(versionPredatesRange(8, start, end, 0, 10)).toBe(true);
  });
  it("accepts a version first seen mid-range", () => {
    expect(versionPredatesRange(50, start, end, 0, 10)).toBe(false);
  });
});

describe("previousUsable", () => {
  it("needs at least the view floor in the previous window", () => {
    expect(previousUsable({ views: 99, sessions: 5000 }, { views: 100 })).toBe(false);
    expect(previousUsable({ views: 100, sessions: 0 }, { views: 100 })).toBe(true);
  });

  it("needs a tenth of the current traffic, so a sliver of a window is not compared", () => {
    expect(previousUsable({ views: 224 }, { views: 43034 })).toBe(false);
    expect(previousUsable({ views: 4304 }, { views: 43034 })).toBe(true);
    expect(previousUsable({ sessions: 150 }, { sessions: 2000 })).toBe(false);
  });
  it("falls back to sessions when there are no vitals", () => {
    expect(previousUsable({ views: null, sessions: 150 }, { sessions: 300 })).toBe(true);
    expect(previousUsable({}, {})).toBe(false);
  });
});

describe("overThresholdPct", () => {
  it("sums needs-work and poor shares", () => {
    expect(overThresholdPct({ good: 71, needs: 15, poor: 14 })).toBe(29);
  });
});

describe("releaseNewErrorsSql", () => {
  it("compares the latest version's error messages with the previous one", () => {
    const sql = releaseNewErrorsSql(ctx([...FULL, "error_message"]), "v2", "v1") ?? "";
    expect(sql).toContain("in_cur = 1 AND in_prev = 0");
    expect(sql).toContain("version IN ('v2','v1')");
    expect(sql.split('FROM "_rumdata"')).toHaveLength(2);
  });
  it("is null without version or error_message", () => {
    expect(releaseNewErrorsSql(ctx(), "v2", "v1")).toBeNull();
    expect(releaseNewErrorsSql(ctx(["error_message"]), "v2", "v1")).toBeNull();
  });
});

describe("verdictOf assessed counts", () => {
  it("has no verdict when nothing is assessed", () => {
    expect(verdictOf({ lcp: null, inp: null, cls: null })).toEqual({
      pass: false,
      failing: [],
      assessed: 0,
    });
  });
  it("passes with one good vital assessed", () => {
    expect(verdictOf({ lcp: 2e9, inp: null, cls: null })).toEqual({
      pass: true,
      failing: [],
      assessed: 1,
    });
  });
  it("fails when any of the three is past its threshold", () => {
    expect(verdictOf({ lcp: 2e9, inp: 1e8, cls: 0.5 })).toEqual({
      pass: false,
      failing: ["cls"],
      assessed: 3,
    });
  });
});

describe("pageFilter keys", () => {
  // JS port of the SQL page-key passes, as productAnalyticsQueries.spec does it.
  const jsKey = (url: string | null, viewName: string | null): string | null => {
    if (url === null || url === "") return viewName || null;
    const k = PAGE_KEY_PASSES.reduce(
      (x, p) =>
        x.replace(
          new RegExp(p.pattern, p.global ? "g" : ""),
          p.replacement.replace(/\\(\d)/g, "$$$1"),
        ),
      url,
    );
    return k || "/";
  };
  const prefilterHolds = (key: string, url: string | null) => {
    if (!key.startsWith("/")) return url === null || url === "";
    return key
      .split(/:id|#!?/)
      .filter((p) => p && p !== "/")
      .every((p) => (url ?? "").includes(p));
  };
  const matches = (key: string, url: string | null, viewName: string | null = null) =>
    prefilterHolds(key, url) && jsKey(url, viewName) === key;

  it("excludes sibling and nested paths that only share a prefix", () => {
    const f = pageFilter("/cart", new Set(FULL));
    expect(f).toContain("= '/cart'");
    expect(matches("/cart", "https://shop.example.com/cart")).toBe(true);
    expect(matches("/cart", "https://shop.example.com/cart?step=2")).toBe(true);
    expect(matches("/cart", "https://shop.example.com/cartography")).toBe(false);
    expect(matches("/cart", "https://shop.example.com/cart/checkout/123")).toBe(false);
  });

  it("keeps the root page to the root key", () => {
    const f = pageFilter("/", new Set(FULL));
    expect(f).toContain("regexp_like(view_url");
    expect(f).toContain("= '/'");
    expect(matches("/", "https://shop.example.com/")).toBe(true);
  });

  it("matches a view_name key only where the URL is empty, as the page key falls back", () => {
    const f = pageFilter("Checkout screen", new Set(FULL));
    expect(f.startsWith("(view_url IS NULL OR view_url = '')")).toBe(true);
    expect(f).toContain("NULLIF(view_name, '')");
    expect(f).toContain("= 'Checkout screen'");
    expect(matches("Checkout screen", "", "Checkout screen")).toBe(true);
    expect(matches("Checkout screen", "https://x/checkout", "Checkout screen")).toBe(false);
  });
});

describe("filterOptionsSql without columns", () => {
  it("returns no query when none of service, env, version exist", () => {
    expect(filterOptionsSql(new Set(["session_id"]))).toBeNull();
  });
});

describe("kpiDelta kinds and sentence keys", () => {
  it("picks a whole-sentence key per kind so word order is per language", () => {
    const flat = kpiDelta(100, 100, { higherIsBetter: true })!;
    const fresh = kpiDelta(5, 0, { higherIsBetter: false })!;
    const change = kpiDelta(112, 100, { higherIsBetter: true })!;
    expect(deltaSentenceKey(flat, false)).toBe("rum.overviewPage.deltaFlat");
    expect(deltaSentenceKey(fresh, false)).toBe("rum.overviewPage.deltaNewMsg");
    expect(deltaSentenceKey(change, false)).toBe("rum.overviewPage.deltaChange");
    expect(deltaSentenceKey(change, true)).toBe("rum.overviewPage.deltaChangePts");
  });
  it("keeps points flat as a flat kind", () => {
    expect(kpiDelta(96, 96, { higherIsBetter: true, points: true })?.kind).toBe("flat");
  });
});

describe("fillBuckets", () => {
  const zero = (ts: number) => ({ ts, v: 0 });
  it("inserts zero buckets in gaps", () => {
    const out = fillBuckets(
      [
        { ts: 0, v: 5 },
        { ts: 30, v: 7 },
      ],
      10,
      zero,
    );
    expect(out).toEqual([
      { ts: 0, v: 5 },
      { ts: 10, v: 0 },
      { ts: 20, v: 0 },
      { ts: 30, v: 7 },
    ]);
  });
  it("leaves misaligned data untouched", () => {
    const pts = [
      { ts: 0, v: 1 },
      { ts: 15, v: 2 },
    ];
    expect(fillBuckets(pts, 10, zero)).toBe(pts);
  });
  it("parses interval strings to microseconds", () => {
    expect(intervalMicros("5 minute")).toBe(300_000_000);
    expect(intervalMicros("1 hour")).toBe(3_600_000_000);
    expect(intervalMicros("1 day")).toBe(86_400_000_000);
  });
});

describe("drillQuery", () => {
  const encode = (s: string) => `b64(${s})`;
  const range = { startUs: 100, endUs: 200 };
  it("passes the relative period for a relative picker", () => {
    const q = drillQuery({
      org: "o",
      filter: "a=1",
      scope: "service IN ('w')",
      range,
      picker: { valueType: "relative", relativeTimePeriod: "1d" },
      encode,
    });
    expect(q).toEqual({
      org_identifier: "o",
      query: "b64(a=1 AND service IN ('w'))",
      period: "1d",
    });
  });
  it("passes absolute from and to otherwise", () => {
    const q = drillQuery({
      org: "o",
      filter: "a=1",
      scope: "1 = 1",
      range,
      picker: { valueType: "absolute" },
      encode,
    });
    expect(q).toEqual({ org_identifier: "o", query: "b64(a=1)", from: "100", to: "200" });
  });
  it("omits the time range when there is none", () => {
    expect(drillQuery({ org: "o", filter: "a=1", scope: "1 = 1", range: null, encode })).toEqual({
      org_identifier: "o",
      query: "b64(a=1)",
    });
  });
});

describe("vitalDelta wording", () => {
  it("says lower or higher for CLS, never faster or slower", () => {
    expect(vitalDelta("cls", 0.05, 0.1)).toEqual({ kind: "lower", text: "0.05" });
    expect(vitalDelta("cls", 0.2, 0.1)).toEqual({ kind: "higher", text: "0.10" });
  });
});

describe("unknown values", () => {
  it("use an em dash everywhere", () => {
    expect(formatCount(null)).toBe("\u2014");
    expect(formatPercent(undefined)).toBe("\u2014");
    expect(formatVital("inp", null)).toBe("\u2014");
  });
  it("formats counts in the user's locale", () => {
    expect(formatCount(4812)).toBe((4812).toLocaleString());
  });
});

describe("chartSql", () => {
  it("buckets sessions and errors under the dashboard engine's axis aliases", () => {
    const sql = chartSql(ctx(), "1 hour");
    expect(sql).toContain("histogram(_timestamp, '1 hour') AS x_axis_1");
    expect(sql).toContain("AS y_axis_1");
    expect(sql).toContain("AS y_axis_2");
    expect(sql.split('FROM "_rumdata"')).toHaveLength(2);
  });
  it("reads the bucket step back from a panel key", () => {
    expect(intervalFromKey(`ov-series:${seriesSql(ctx(), "30 minute")}`)).toBe("30 minute");
    expect(intervalFromKey(null)).toBeNull();
  });
});

describe("route state", () => {
  const filters = { service: ["web"], env: [], version: ["1.0", "2.0"] };
  it("round-trips filters and percentile through the query", () => {
    const q = queryFromState(filters, "p95");
    expect(q).toEqual({ ov_service: ["web"], ov_version: ["1.0", "2.0"], ov_pct: "p95" });
    expect(stateFromQuery(q)).toEqual({ filters, percentile: "p95" });
  });
  it("keeps a plain URL plain and defaults to p75", () => {
    expect(queryFromState({ service: [], env: [], version: [] }, "p75")).toEqual({});
    expect(stateFromQuery({}).percentile).toBe("p75");
    expect(stateFromQuery({ ov_pct: "p99" }).percentile).toBe("p75");
  });
  it("splits the overview keys from the page's own", () => {
    const q = { period: "1d", ov_service: "web", ov_pct: "p50" };
    expect(withoutOverviewState(q)).toEqual({ period: "1d" });
    expect(overviewStateOnly(q)).toEqual({ ov_service: "web", ov_pct: "p50" });
  });
});

describe("analyticsQuery", () => {
  it("keeps a relative period and otherwise carries the absolute range", () => {
    expect(
      analyticsQuery({
        org: "o",
        range: { startUs: 1, endUs: 2 },
        picker: { valueType: "relative", relativeTimePeriod: "7d" },
      }),
    ).toEqual({ org_identifier: "o", period: "7d" });
    expect(analyticsQuery({ org: "o", range: { startUs: 1, endUs: 2 } })).toEqual({
      org_identifier: "o",
      from: "1",
      to: "2",
    });
  });
});

describe("drillQuery extra params", () => {
  it("adds health=clean and drops the query for an unfiltered drill", () => {
    const q = drillQuery({
      org: "o",
      filter: "",
      scope: "1 = 1",
      range: null,
      extra: { health: "clean" },
      encode: (s) => s,
    });
    expect(q).toEqual({ org_identifier: "o", health: "clean" });
  });
});

describe("formatInZone", () => {
  it("formats in the given zone, not the browser's", () => {
    const ms = Date.UTC(2026, 0, 15, 12, 0);
    expect(formatInZone(ms, "UTC", "en-US")).toContain("12:00");
    expect(formatInZone(ms, "Asia/Tokyo", "en-US")).toContain("9:00");
    expect(formatInZone(ms, "America/New_York", "en-US")).toContain("7:00");
  });
  it("falls back to the browser zone for an invalid zone", () => {
    expect(() => formatInZone(Date.UTC(2026, 0, 15), "Not/AZone", "en-US")).not.toThrow();
  });
});

describe("mapSegments share", () => {
  const rows = [
    { d0: "Chrome", views: 300, inp: 1, lcp: 1 },
    { d0: "Safari", views: 100, inp: 1, lcp: 1 },
  ];
  it("is a share of the window's views, not of the returned rows", () => {
    const out = mapSegments("device", ["c"], rows, 1000);
    expect(out.map((r) => r.share)).toEqual([30, 10]);
  });
  it("falls back to the returned rows without a window total", () => {
    expect(mapSegments("device", ["c"], rows).map((r) => r.share)).toEqual([75, 25]);
  });
  it("never exceeds 100", () => {
    expect(mapSegments("device", ["c"], rows, 50).map((r) => r.share)).toEqual([100, 100]);
  });
});

describe("releaseTone", () => {
  it("calls a change inside half a percent, or equal once formatted, unchanged", () => {
    expect(releaseTone(232_000_000, 231_000_000, false)).toBe("same");
    expect(releaseTone(232_400_000, 231_600_000, false, { cur: "232 ms", prev: "232 ms" })).toBe(
      "same",
    );
    expect(releaseTone(null, 1, false)).toBe("same");
  });

  it("calls a lower vital better and a lower error-free share worse", () => {
    expect(releaseTone(2.9e9, 2.55e9, false)).toBe("worse");
    expect(releaseTone(2.2e9, 2.55e9, false)).toBe("better");
    expect(releaseTone(86.5, 90.7, true)).toBe("worse");
  });
});

describe("dropOpenBucket", () => {
  const pts = [{ ts: 0 }, { ts: 10 }, { ts: 20 }];
  it("drops the bucket that still contains now", () => {
    expect(dropOpenBucket(pts, 10, 25)).toEqual([{ ts: 0 }, { ts: 10 }]);
  });
  it("keeps every bucket of a range that ended", () => {
    expect(dropOpenBucket(pts, 10, 30)).toEqual(pts);
    expect(dropOpenBucket(pts, 0, 25)).toEqual(pts);
  });
});

describe("kpiDelta above the percent cap", () => {
  it("shows a multiple instead of a five-digit percentage", () => {
    expect(kpiDelta(43034, 224, { higherIsBetter: true })?.text).toBe("192x");
    expect(kpiDelta(1100, 100, { higherIsBetter: true })?.text).toBe("+1000%");
    expect(kpiDelta(1200, 100, { higherIsBetter: true })?.text).toBe("12x");
  });
});
