// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import {
  FIELD_TOKEN_REGEX,
  buildSloPreviewQuery,
  buildSloPromqlPreviewRange,
  buildSloTimeSlicePreviewQuery,
  classifyPreviewSlices,
  intervalLiteral,
  promqlCountSeriesPoints,
  promqlSliceStart,
  replaceTrailingFieldToken,
} from "./previewQuery";

describe("intervalLiteral", () => {
  it("matches the two widths the backend accepts", () => {
    expect(intervalLiteral(60)).toBe("1 minute");
    expect(intervalLiteral(300)).toBe("5 minute");
  });

  it("falls back to seconds for anything else", () => {
    expect(intervalLiteral(45)).toBe("45 second");
  });
});

describe("buildSloTimeSlicePreviewQuery", () => {
  const base = { stream: "logs_default", aggregate: "AVG(duration_ms)", sliceIntervalSecs: 300 };

  it("buckets at the slice width and projects the ingest aliases", () => {
    const sql = buildSloTimeSlicePreviewQuery(base)!;
    expect(sql).toContain("histogram(_timestamp, '5 minute') AS slice_start");
    expect(sql).toContain("AVG(duration_ms) AS zo_slo_value");
    expect(sql).toContain('FROM "logs_default"');
    expect(sql).toContain("GROUP BY slice_start");
  });

  it("never puts the threshold in SQL — the ingest pass does not either", () => {
    const sql = buildSloTimeSlicePreviewQuery(base)!;
    expect(sql).not.toContain("CASE");
    expect(sql).not.toContain("<");
    expect(sql).not.toContain(">");
  });

  it("parenthesises the scope so an OR cannot re-associate", () => {
    const sql = buildSloTimeSlicePreviewQuery({ ...base, scope: "a = 1 OR b = 2" })!;
    expect(sql).toContain("WHERE (a = 1 OR b = 2)");
  });

  it("returns null until there is something drawable", () => {
    expect(buildSloTimeSlicePreviewQuery({ ...base, stream: "" })).toBeNull();
    expect(buildSloTimeSlicePreviewQuery({ ...base, aggregate: "  " })).toBeNull();
  });
});

describe("buildSloPromqlPreviewRange", () => {
  const START = 1_700_000_000;
  const base = {
    expr: "histogram_quantile(0.95, sum by (le) (rate(http_latency_bucket[5m])))",
    startSecs: START,
    endSecs: START + 3600,
    sliceIntervalSecs: 300,
  };

  it("passes the expression through untouched — the ingest plan does not wrap it either", () => {
    // The SQL arms inject GROUP BY columns; PromQL must not, in either SLI
    // shape: grouping comes from the labels the returned series already carry.
    const range = buildSloPromqlPreviewRange(base)!;
    expect(range.query).toBe(base.expr);
  });

  it("evaluates at slice ENDS: the first instant is start + one interval", () => {
    // `prom_query` in query.rs. A sample at T with a slice-wide range selector
    // covers (T-interval, T], so starting at the range start would attribute
    // every value to the slice before it.
    const range = buildSloPromqlPreviewRange(base)!;
    expect(range.start_time).toBe((START + 300) * 1_000_000);
    expect(range.end_time).toBe((START + 3600) * 1_000_000);
  });

  it("steps by the slice width, in the SECONDS the range API parses", () => {
    // `start`/`end` are timestamps and go as micros; `step` is a duration and
    // a bare number there means seconds.
    const range = buildSloPromqlPreviewRange(base)!;
    expect(range.step).toBe("300");
    expect(buildSloPromqlPreviewRange({ ...base, sliceIntervalSecs: 60 })!.step).toBe("60");
  });

  it("trims the expression rather than sending the user's whitespace", () => {
    const range = buildSloPromqlPreviewRange({ ...base, expr: "  up  " })!;
    expect(range.query).toBe("up");
  });

  it("returns null until there is an expression to run", () => {
    expect(buildSloPromqlPreviewRange({ ...base, expr: "" })).toBeNull();
    expect(buildSloPromqlPreviewRange({ ...base, expr: "   " })).toBeNull();
    expect(buildSloPromqlPreviewRange({ ...base, expr: undefined })).toBeNull();
  });
});

describe("promqlSliceStart", () => {
  it("attributes a sample to the slice it ENDS, not the one it starts", () => {
    expect(promqlSliceStart(1_700_000_300, 300)).toBe(1_700_000_000);
    expect(promqlSliceStart(1_700_000_060, 60)).toBe(1_700_000_000);
  });

  // Prometheus timestamps are float seconds, and the backend subtracts rather
  // than snapping (`promql_value_rows`). Rounding to a slice grid here would
  // move a sample onto a neighbouring slice.
  it("subtracts rather than snapping an off-grid instant to a boundary", () => {
    expect(promqlSliceStart(1_700_000_317.5, 300)).toBe(1_700_000_017.5);
  });

  // The builder's offset and this inversion are one rule. Two copies of it
  // could drift, and a drift is a whole-slice time shift that is invisible in
  // the values and wrong in every one of them.
  it("inverts the builder's first instant back onto the range start", () => {
    const startSecs = 1_700_000_000;
    for (const interval of [60, 300]) {
      const range = buildSloPromqlPreviewRange({
        expr: "up",
        startSecs,
        endSecs: startSecs + 3600,
        sliceIntervalSecs: interval,
      })!;
      expect(promqlSliceStart(range.start_time / 1_000_000, interval)).toBe(startSecs);
    }
  });
});

describe("promqlCountSeriesPoints", () => {
  const T = 1_700_000_300;
  /** One matrix series as `/api/v1/query_range` returns it: the sample value is
   *  ALWAYS a string (`Sample::serialize` writes `value.to_string()`). */
  const series = (values: [number, string][]) => ({ metric: {}, values });

  it("attributes a sample to the slice it CLOSES, in chart milliseconds", () => {
    // `promql_rows`: slice_start = T - interval. The chart wants ms, the matrix
    // carries seconds.
    const points = promqlCountSeriesPoints([series([[T, "7"]])], 300);
    expect(points).toEqual([{ ts: (T - 300) * 1000, value: 7 }]);
  });

  it("SUMS series that land on the same slice, as promql_rows does", () => {
    // The count path's rule, and the one place it differs from the time-slice
    // reader — two pods' `increase()` genuinely add up, where two p95s do not.
    const points = promqlCountSeriesPoints(
      [series([[T, "4"]]), series([[T, "6"]]), series([[T, "0.5"]])],
      300,
    );
    expect(points).toEqual([{ ts: (T - 300) * 1000, value: 10.5 }]);
  });

  it("keeps distinct instants apart while summing", () => {
    const points = promqlCountSeriesPoints(
      [
        series([
          [T, "1"],
          [T + 300, "2"],
        ]),
        series([[T + 300, "3"]]),
      ],
      300,
    );
    expect(points).toEqual([
      { ts: (T - 300) * 1000, value: 1 },
      { ts: T * 1000, value: 5 },
    ]);
  });

  it("orders by time, whatever order the samples arrived in", () => {
    const points = promqlCountSeriesPoints(
      [
        series([
          [T + 600, "3"],
          [T, "1"],
        ]),
      ],
      300,
    );
    expect(points.map((p) => p.ts)).toEqual([(T - 300) * 1000, (T + 300) * 1000]);
  });

  // A slice nobody could read is a gap, not a zero: for a count SLI "no
  // traffic" and "nothing was good" mean opposite things.
  it("reports an unreadable slice as null rather than as zero", () => {
    const points = promqlCountSeriesPoints([series([[T, "NaN"]])], 300);
    expect(points).toEqual([{ ts: (T - 300) * 1000, value: null }]);
    // `Number(null)` and `Number("")` are both 0, so an absent value must be
    // caught before it is coerced into a confident count of nothing.
    expect(promqlCountSeriesPoints([{ values: [[T, null]] }], 300)).toEqual([
      { ts: (T - 300) * 1000, value: null },
    ]);
  });

  // `promql_rows` accumulates with a bare `e.0 += value`, so one NaN sample
  // makes the whole slice NaN and the row is rejected at the ingest boundary.
  // Drawing the readable remainder as a confident number is precisely the
  // laundering `job.rs` refuses to do with `f64::min`.
  it("poisons the whole slice when one series could not answer", () => {
    const points = promqlCountSeriesPoints([series([[T, "NaN"]]), series([[T, "4"]])], 300);
    expect(points).toEqual([{ ts: (T - 300) * 1000, value: null }]);
  });

  it("drops a sample whose instant cannot be read", () => {
    // `Number(null)` is 0, which would plot the sample at 1970 instead.
    const points = promqlCountSeriesPoints(
      [
        {
          values: [
            [null, "5"],
            [T, "1"],
          ],
        },
      ],
      300,
    );
    expect(points).toEqual([{ ts: (T - 300) * 1000, value: 1 }]);
  });

  it("has nothing to draw from an empty matrix", () => {
    expect(promqlCountSeriesPoints([], 300)).toEqual([]);
    expect(promqlCountSeriesPoints([{ metric: {} }], 300)).toEqual([]);
  });
});

describe("classifyPreviewSlices", () => {
  it("scores each comparator at its boundary, like classify_time_slice", () => {
    expect(classifyPreviewSlices([232], "<", 232).good).toBe(0);
    expect(classifyPreviewSlices([232], "<=", 232).good).toBe(1);
    expect(classifyPreviewSlices([232], ">", 232).good).toBe(0);
    expect(classifyPreviewSlices([232], ">=", 232).good).toBe(1);
  });

  it("withholds an unmeasurable slice instead of calling it bad", () => {
    // The ordering that matters: null/NaN compares false against every
    // operator, so a fall-through would record downtime nobody observed.
    const t = classifyPreviewSlices([100, null, Number.NaN, undefined], "<", 232);
    expect(t.good).toBe(1);
    expect(t.bad).toBe(0);
    expect(t.unmeasured).toBe(3);
    expect(t.measured).toBe(1);
  });

  it("treats an unreadable comparator as unmeasurable, not as downtime", () => {
    const t = classifyPreviewSlices([1, 2], "≈", 232);
    expect(t.bad).toBe(0);
    expect(t.unmeasured).toBe(2);
    expect(t.sli).toBeNull();
  });

  it("computes the SLI over measured slices only", () => {
    const t = classifyPreviewSlices([1, 2, 500, null], "<", 232);
    expect(t.good).toBe(2);
    expect(t.bad).toBe(1);
    expect(t.sli).toBeCloseTo(66.667, 3);
  });

  it("has no SLI when nothing was measured", () => {
    expect(classifyPreviewSlices([], "<", 232).sli).toBeNull();
    expect(classifyPreviewSlices([1], "<", Number.NaN).sli).toBeNull();
  });
});

describe("buildSloPreviewQuery", () => {
  it("counts matching rows for the good series", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "good")!;
    expect(sql).toContain("SUM(CASE WHEN (status_code < 500) THEN 1 ELSE 0 END) AS zo_sql_num");
  });

  // The complement, not a separate predicate: bad is "everything in scope that
  // is not good", so the two always sum to the denominator.
  it("counts the complement for the bad series", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "bad")!;
    expect(sql).toContain("SUM(CASE WHEN (status_code < 500) THEN 0 ELSE 1 END) AS zo_sql_num");
  });

  // Both charts share one panel shape; only label and colour differ.
  it("projects the same aliases for both series", () => {
    for (const series of ["good", "bad"] as const) {
      const sql = buildSloPreviewQuery("requests", undefined, "ok", series)!;
      expect(sql).toContain("histogram(_timestamp) AS zo_sql_key");
      expect(sql).toContain("AS zo_sql_num");
      expect(sql).toContain("GROUP BY zo_sql_key");
    }
  });

  it("applies the scope as the denominator filter, to both series", () => {
    for (const series of ["good", "bad"] as const) {
      const sql = buildSloPreviewQuery("requests", "service = 'checkout'", "ok", series)!;
      expect(sql).toContain("WHERE (service = 'checkout')");
    }
  });

  // A filtered COUNT would drop empty buckets, making "all bad" look like
  // "no traffic" — the good predicate must never become a WHERE filter.
  it("never turns the good predicate into a filter", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "good")!;
    expect(sql).not.toContain("WHERE (status_code < 500)");
  });

  // `a = 1 OR b = 2` unparenthesised next to anything appended re-associates.
  it("parenthesises the user fragments", () => {
    const sql = buildSloPreviewQuery("requests", "a = 1 OR b = 2", "c = 3 OR d = 4", "good")!;
    expect(sql).toContain("WHERE (a = 1 OR b = 2)");
    expect(sql).toContain("(c = 3 OR d = 4) THEN 1");
  });

  it("quotes the stream and doubles embedded quotes", () => {
    const sql = buildSloPreviewQuery('we"ird', undefined, "ok", "good")!;
    expect(sql).toContain('FROM "we""ird"');
  });

  it("returns null with nothing drawable, not a broken query", () => {
    expect(buildSloPreviewQuery("", undefined, "ok", "good")).toBeNull();
    expect(buildSloPreviewQuery("requests", undefined, "", "good")).toBeNull();
    expect(buildSloPreviewQuery("requests", undefined, "   ", "bad")).toBeNull();
    expect(buildSloPreviewQuery(undefined, undefined, undefined, "good")).toBeNull();
  });

  it("ignores a blank scope rather than emitting an empty WHERE", () => {
    for (const scope of ["", "   ", undefined]) {
      expect(buildSloPreviewQuery("requests", scope, "ok", "good")).not.toContain("WHERE");
    }
  });
});

describe("replaceTrailingFieldToken", () => {
  it("replaces the identifier being typed", () => {
    expect(replaceTrailingFieldToken("status_c", "status_code")).toBe("status_code");
  });

  it("keeps everything before the token", () => {
    expect(replaceTrailingFieldToken("service = 'x' AND stat", "status_code")).toBe(
      "service = 'x' AND status_code",
    );
  });

  it("appends when the text ends mid-expression rather than mid-token", () => {
    expect(replaceTrailingFieldToken("status_code < ", "duration_ms")).toBe(
      "status_code < duration_ms",
    );
    expect(replaceTrailingFieldToken("", "duration_ms")).toBe("duration_ms");
    expect(replaceTrailingFieldToken(undefined, "duration_ms")).toBe("duration_ms");
  });

  it("treats dotted names as one token", () => {
    expect(replaceTrailingFieldToken("k8s.po", "k8s.pod.name")).toBe("k8s.pod.name");
  });

  // The regex and the replacer must agree on what a token is, or the
  // suggestion filters on one word and the splice replaces another.
  it("the needle regex and the replacer agree on token shape", () => {
    const needle = new RegExp(FIELD_TOKEN_REGEX);
    for (const text of ["abc", "a.b.c", "x = 1 AND foo_b"]) {
      const m = text.match(needle);
      expect(m, text).not.toBeNull();
      const replaced = replaceTrailingFieldToken(text, "FIELD");
      expect(replaced.endsWith("FIELD"), replaced).toBe(true);
      expect(replaced).toBe(text.slice(0, text.length - m![1].length) + "FIELD");
    }
  });
});
