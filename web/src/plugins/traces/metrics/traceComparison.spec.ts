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

import { describe, it, expect, beforeAll } from "vitest";
import store from "@/stores";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";
import {
  SAMPLE_LIMIT,
  buildCountSql,
  buildSampleSql,
  comparisonColumns,
  compareFields,
  filterTermFor,
  populations,
  sampleThreshold,
  type ComparisonSelection,
  type FieldComparison,
  type SampleRow,
} from "./traceComparison";

let parser: any;
async function getParser() {
  if (parser) return parser;
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  parser = new mod.default.Parser();
  return parser;
}

const MIN = 60 * 1_000_000;
const HOUR = 60 * MIN;
const W0 = Date.UTC(2026, 9, 6, 12, 0, 0) * 1000;

const selection = (overrides: Partial<ComparisonSelection> = {}): ComparisonSelection => ({
  kind: "duration",
  windowStartUs: W0,
  windowEndUs: W0 + 10 * MIN,
  rangeStartUs: W0 - 30 * MIN,
  rangeEndUs: W0 + 40 * MIN,
  durationLoUs: 100_000,
  durationHiUs: 500_000,
  filter: "service_name = 'a'",
  ...overrides,
});

const win = (a: number, b: number) => `_timestamp >= ${a} AND _timestamp < ${b}`;
const BAND = "duration >= 100000 AND duration < 500000";

describe("populations", () => {
  it("builds the duration box populations of both baselines", () => {
    const sel = selection();
    const outside = populations(sel, "outside");
    if ("error" in outside) throw new Error("unexpected");
    const W = win(sel.windowStartUs, sel.windowEndUs);
    expect(outside.selection).toEqual({
      where: `(service_name = 'a') AND ${W} AND ${BAND}`,
      startUs: sel.windowStartUs,
      endUs: sel.windowEndUs,
    });
    expect(outside.baseline).toEqual({
      where: `(service_name = 'a') AND ${win(sel.rangeStartUs, sel.rangeEndUs)} AND NOT (${W} AND ${BAND})`,
      startUs: sel.rangeStartUs,
      endUs: sel.rangeEndUs,
    });
    expect(outside.capped).toBe(false);

    const before = populations(sel, "before");
    if ("error" in before) throw new Error("unexpected");
    const a = sel.windowStartUs - 10 * MIN;
    expect(before.baseline).toEqual({
      where: `(service_name = 'a') AND ${win(a, sel.windowStartUs)} AND ${BAND}`,
      startUs: a,
      endUs: sel.windowStartUs,
    });
  });

  it("builds the errors brush populations, keeping null statuses in the baseline", () => {
    const sel = selection({ kind: "errors", durationLoUs: null, durationHiUs: null });
    const W = win(sel.windowStartUs, sel.windowEndUs);
    const outside = populations(sel, "outside");
    if ("error" in outside) throw new Error("unexpected");
    expect(outside.selection.where).toBe(`(service_name = 'a') AND ${W} AND span_status = 'ERROR'`);
    expect(outside.baseline).toEqual({
      where: `(service_name = 'a') AND ${W} AND COALESCE(span_status, '') != 'ERROR'`,
      startUs: sel.windowStartUs,
      endUs: sel.windowEndUs,
    });
    const before = populations(sel, "before");
    if ("error" in before) throw new Error("unexpected");
    const a = sel.windowStartUs - 10 * MIN;
    expect(before.baseline!.where).toBe(
      `(service_name = 'a') AND ${win(a, sel.windowStartUs)} AND span_status = 'ERROR'`,
    );
  });

  it("builds the rate brush populations from time alone", () => {
    const sel = selection({ kind: "rate", durationLoUs: null, durationHiUs: null });
    const W = win(sel.windowStartUs, sel.windowEndUs);
    const outside = populations(sel, "outside");
    if ("error" in outside) throw new Error("unexpected");
    expect(outside.selection.where).toBe(`(service_name = 'a') AND ${W}`);
    expect(outside.baseline!.where).toBe(
      `(service_name = 'a') AND ${win(sel.rangeStartUs, sel.rangeEndUs)} AND NOT (${W})`,
    );
    const before = populations(sel, "before");
    if ("error" in before) throw new Error("unexpected");
    expect(before.baseline!.where).toBe(
      `(service_name = 'a') AND ${win(sel.windowStartUs - 10 * MIN, sel.windowStartUs)}`,
    );
  });

  it("keeps an OR filter grouped and omits an empty one", () => {
    const grouped = populations(selection({ filter: "a = '1' or b = '2'" }), "outside");
    if ("error" in grouped) throw new Error("unexpected");
    expect(grouped.selection.where.startsWith("(a = '1' or b = '2') AND ")).toBe(true);
    const empty = populations(selection({ filter: "  " }), "outside");
    if ("error" in empty) throw new Error("unexpected");
    expect(empty.selection.where.startsWith("_timestamp >= ")).toBe(true);
  });

  it("omits a missing side of the band", () => {
    const open = populations(selection({ durationLoUs: null, durationHiUs: 500_000 }), "outside");
    if ("error" in open) throw new Error("unexpected");
    expect(open.selection.where.endsWith(" AND duration < 500000")).toBe(true);
    const full = populations(selection({ durationLoUs: null, durationHiUs: null }), "outside");
    if ("error" in full) throw new Error("unexpected");
    expect(full.selection.where).toBe(`(service_name = 'a') AND ${win(W0, W0 + 10 * MIN)}`);
  });

  it("caps the outside baseline at 3 h either side of a selection in a 24 h range", () => {
    const sel = selection({
      rangeStartUs: W0 - 12 * HOUR,
      rangeEndUs: W0 + 12 * HOUR,
    });
    const p = populations(sel, "outside");
    if ("error" in p) throw new Error("unexpected");
    expect([p.baseline!.startUs, p.baseline!.endUs]).toEqual([
      W0 - 3 * HOUR,
      W0 + 10 * MIN + 3 * HOUR,
    ]);
    expect(p.baseline!.where).toContain(win(W0 - 3 * HOUR, W0 + 10 * MIN + 3 * HOUR));
    expect(p.capped).toBe(true);
    expect(p.limited).toBe(false);
  });

  it("caps an off-centre selection without re-centring it", () => {
    const rangeStart = W0 - HOUR;
    const sel = selection({ rangeStartUs: rangeStart, rangeEndUs: rangeStart + 5 * HOUR });
    const p = populations(sel, "outside");
    if ("error" in p) throw new Error("unexpected");
    expect([p.baseline!.startUs, p.baseline!.endUs]).toEqual([
      rangeStart,
      W0 + 10 * MIN + 3 * HOUR,
    ]);
    expect(p.capped).toBe(true);
  });

  it("uses the whole range when it lies inside the cap", () => {
    const p = populations(selection(), "outside");
    if ("error" in p) throw new Error("unexpected");
    expect([p.baseline!.startUs, p.baseline!.endUs]).toEqual([W0 - 30 * MIN, W0 + 40 * MIN]);
    expect(p.capped).toBe(false);
  });

  it("narrows the outside baseline to a 1 h query-range limit", () => {
    const sel = selection({ rangeStartUs: W0 - 12 * HOUR, rangeEndUs: W0 + 12 * HOUR });
    const p = populations(sel, "outside", HOUR);
    if ("error" in p) throw new Error("unexpected");
    expect([p.baseline!.startUs, p.baseline!.endUs]).toEqual([W0 - 25 * MIN, W0 + 35 * MIN]);
    expect(p.limited).toBe(true);
    expect(p.capped).toBe(false);
    const clipped = populations(selection(), "outside", HOUR);
    if ("error" in clipped) throw new Error("unexpected");
    expect([clipped.baseline!.startUs, clipped.baseline!.endUs]).toEqual([
      W0 - 25 * MIN,
      W0 + 35 * MIN,
    ]);
  });

  it("leaves a rate brush no baseline when the window fills the limit", () => {
    const sel = selection({ kind: "rate", durationLoUs: null, durationHiUs: null });
    const p = populations(sel, "outside", 10 * MIN);
    if ("error" in p) throw new Error("unexpected");
    expect(p.baseline).toBeNull();
    expect(p.limited).toBe(true);
  });

  it("refuses a window longer than the limit", () => {
    expect(populations(selection(), "outside", 5 * MIN)).toEqual({ error: "rangeTooLong" });
    expect(populations(selection(), "before", 5 * MIN)).toEqual({ error: "rangeTooLong" });
  });
});

describe("sampleThreshold", () => {
  it("takes a small population whole", () => {
    expect(sampleThreshold(0)).toBeNull();
    expect(sampleThreshold(2000)).toBeNull();
  });

  it("is eight lowercase hex digits of ceil(2000 / n * 2^32), never zero", () => {
    expect(sampleThreshold(21077)).toBe("184ab8ca");
    expect(sampleThreshold(1e9)).toBe("0000218e");
    expect(sampleThreshold(1e13)).toBe("00000001");
    for (const n of [2001, 54321, 1_280_000, 7e10]) {
      expect(sampleThreshold(n)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("buildCountSql", () => {
  it("counts one population over its own window", () => {
    const sel = selection({ windowStartUs: W0, windowEndUs: W0 + HOUR });
    const p = populations(sel, "before");
    if ("error" in p) throw new Error("unexpected");
    const sel1 = buildCountSql("default", p.selection);
    const base = buildCountSql("default", p.baseline!);
    expect(sel1.sql).toBe(`SELECT count(*) AS n FROM "default" WHERE ${p.selection.where}`);
    expect(base.sql).toBe(`SELECT count(*) AS n FROM "default" WHERE ${p.baseline!.where}`);
    expect(base.sql).toContain("(service_name = 'a') AND ");
    for (const q of [sel1, base]) expect(q.endTime - q.startTime).toBeLessThanOrEqual(HOUR);
    expect([base.startTime, base.endTime]).toEqual([W0 - HOUR, W0]);
  });
});

describe("buildSampleSql", () => {
  const pop = { where: "x = 1", startUs: 1, endUs: 2 };

  it("selects quoted columns with the hash predicate and the row limit", () => {
    const q = buildSampleSql("my-stream", pop, ["service_name", 'we"ird'], "184ab8ca");
    expect(q.sql).toBe(
      `SELECT "service_name", "we""ird" FROM "my-stream" WHERE x = 1 AND lower(right(span_id, 8)) < '184ab8ca' LIMIT ${SAMPLE_LIMIT}`,
    );
    expect([q.startTime, q.endTime]).toEqual([1, 2]);
  });

  it("takes everything without a threshold", () => {
    const q = buildSampleSql("s", pop, ["a"], null);
    expect(q.sql).toBe(`SELECT "a" FROM "s" WHERE x = 1 LIMIT 4000`);
  });
});

describe("comparisonColumns", () => {
  const schema = [
    "_timestamp",
    "_o2_ingest_ts",
    "start_time",
    "end_time",
    "events",
    "links",
    "duration",
    "span_status",
    "service_name",
    "trace_id",
    "span_id",
  ].map((name) => ({ name, type: "Utf8" }));

  it("keeps schema members only, without time, blobs or the selection's own axis", () => {
    expect(comparisonColumns(schema, "duration").map((c) => c.name)).toEqual([
      "span_status",
      "service_name",
      "trace_id",
      "span_id",
    ]);
    expect(comparisonColumns(schema, "errors").map((c) => c.name)).toEqual([
      "duration",
      "service_name",
      "trace_id",
      "span_id",
    ]);
    expect(comparisonColumns(schema, "rate").map((c) => c.name)).toContain("duration");
  });

  it("drops the status code copy for an Errors brush but keeps the status message, which tells errors apart", () => {
    const withStatus = [
      ...schema,
      { name: "status_code", type: "Int64" },
      { name: "status_message", type: "Utf8" },
    ];
    const names = comparisonColumns(withStatus, "errors").map((c) => c.name);
    expect(names).not.toContain("status_code");
    expect(names).toContain("status_message");
    expect(comparisonColumns(withStatus, "duration").map((c) => c.name)).toContain("status_code");
  });

  it("never names a reference_* column a root-only stream lacks", () => {
    // The field sidebar adds these whether or not the schema has them (Index.vue builds it so).
    const sidebarFields = [
      ...schema,
      { name: "reference_parent_span_id" },
      { name: "reference_parent_trace_id" },
    ];
    expect(sidebarFields.map((f) => f.name)).toContain("reference_parent_span_id");
    const p = populations(selection(), "outside");
    if ("error" in p) throw new Error("unexpected");
    const sql = buildSampleSql(
      "default",
      p.selection,
      comparisonColumns(schema, "duration").map((c) => c.name),
      null,
    ).sql;
    expect(sql).not.toContain("reference_parent_span_id");
    expect(sql).not.toContain("reference_parent_trace_id");
  });
});

const rows = (n: number, make: (i: number) => SampleRow): SampleRow[] =>
  Array.from({ length: n }, (_, i) => make(i));
const field = (name: string, type = "Utf8") => ({ name, type });
const ranked = (r: ReturnType<typeof compareFields>, name: string) =>
  r.ranked.find((f) => f.name === name) ?? r.mostlyEmpty.find((f) => f.name === name);

describe("compareFields", () => {
  it("ranks the field with the largest single-value difference first and leaves IDs unranked", () => {
    const sel = rows(100, (i) => ({
      service_name: i < 70 ? "a" : "b",
      trace_id: `s${i}`,
      http_method: i % 2 ? "GET" : "POST",
    }));
    const base = rows(100, (i) => ({
      service_name: i < 30 ? "a" : "b",
      trace_id: `b${i}`,
      http_method: i % 2 ? "GET" : "POST",
    }));
    const r = compareFields(
      sel,
      base,
      [field("service_name"), field("trace_id"), field("http_method")],
      "duration",
    );
    expect(r.ranked[0].name).toBe("service_name");
    expect(r.ranked[0].score).toBeCloseTo(40, 6);
    expect(r.ranked.map((f) => f.name)).not.toContain("trace_id");
    expect(r.highCardinality.map((f) => f.name)).toContain("trace_id");
  });

  it("sends every ID field to high cardinality", () => {
    const ids = ["trace_id", "span_id", "reference_parent_span_id", "reference_parent_trace_id"];
    const sample = rows(5, (i) => Object.fromEntries(ids.map((id) => [id, "x"])));
    const r = compareFields(
      sample,
      sample,
      ids.map((id) => field(id)),
      "duration",
    );
    expect(r.highCardinality.map((f) => f.name).sort()).toEqual([...ids].sort());
  });

  it("bins a Utf8 field whose values all parse as numbers into 10 bins", () => {
    const sel = rows(40, (i) => ({ tcp_rtt_ms: String(i) }));
    const r = compareFields(sel, sel, [field("tcp_rtt_ms")], "duration");
    const f = ranked(r, "tcp_rtt_ms")!;
    expect(f.kind).toBe("numeric");
    expect(f.bins).toHaveLength(10);
    expect(f.numericCast).toBe(true);
  });

  it("treats text TRY_CAST cannot read as a number as categorical", () => {
    // Number() reads hex, binary and blank text, which TRY_CAST(... AS DOUBLE) turns into null.
    for (const odd of ["0x1f", "0b11", " "]) {
      const sel = rows(40, (i) => ({ v: i === 0 ? odd : String(i) }));
      const f = ranked(compareFields(sel, sel, [field("v")], "duration"), "v")!;
      expect(f.kind, odd).toBe("categorical");
    }
  });

  it("reads signed, decimal and exponent text as numbers", () => {
    const values = ["-5", "0.5", ".25", "1e3", "2E-2", " 7 ", "10.", "12", "13", "14", "15"];
    const sel = rows(values.length, (i) => ({ v: values[i] }));
    expect(ranked(compareFields(sel, sel, [field("v")], "duration"), "v")!.kind).toBe("numeric");
  });

  it("keeps an empty string in its own (empty) bucket next to the bins", () => {
    const sel = rows(40, (i) => ({ size: i < 10 ? "" : String(i) }));
    const r = compareFields(sel, sel, [field("size")], "duration");
    const f = ranked(r, "size")!;
    expect(f.kind).toBe("numeric");
    const empty = f.rows.find((row) => row.bucket.kind === "empty")!;
    expect(empty.sel).toBeCloseTo(0.25, 6);
    expect(f.bins!.reduce((sum, b) => sum + b.sel, 0)).toBeCloseTo(0.75, 6);
  });

  it("log-spaces a heavy-tailed positive field with 2-significant-digit edges", () => {
    const values = [1, 2, 3, 5, 8, 13, 21, 50, 100, 400, 1000, 4000, 10000];
    const sel = rows(values.length, (i) => ({ bytes: values[i] }));
    const f = ranked(compareFields(sel, sel, [field("bytes", "Int64")], "duration"), "bytes")!;
    const edges = [f.bins![0].lo, ...f.bins!.map((b) => b.hi)];
    expect(edges).toEqual([1, 2.5, 6.3, 16, 40, 100, 250, 630, 1600, 4000, 10000]);
  });

  it("uses equal-width bins for a field that crosses zero", () => {
    const sel = rows(101, (i) => ({ delta: i - 50 }));
    const f = ranked(compareFields(sel, sel, [field("delta", "Int64")], "duration"), "delta")!;
    const edges = [f.bins![0].lo, ...f.bins!.map((b) => b.hi)];
    expect(edges).toEqual([-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]);
  });

  it("adds significant digits until a narrow range keeps 11 increasing edges", () => {
    const values = Array.from({ length: 11 }, (_, i) => 1000 + i);
    const sel = rows(11, (i) => ({ port: String(values[i]) }));
    const f = ranked(compareFields(sel, sel, [field("port")], "duration"), "port")!;
    const edges = [f.bins![0].lo, ...f.bins!.map((b) => b.hi)];
    expect(edges).toEqual(values);
    const selected = new Set<string>();
    f.bins!.forEach((b, k) => {
      for (const action of ["gte", "lt"] as const) {
        const term = filterTermFor(f, { kind: "bin", index: k }, action);
        if (!term) continue;
        const bound = Number(term.split(action === "gte" ? ">=" : "<")[1]);
        const hits = values.filter((v) => (action === "gte" ? v >= bound : v < bound));
        expect(hits.length).toBeGreaterThan(0);
        selected.add(`${action}:${hits.join(",")}`);
      }
    });
    // Nine interior bounds each way: the first bin has no ">=" and the last no "<".
    expect(selected.size).toBe(18);
  });

  it("scores a numeric field over its bins and missing buckets, not raw values", () => {
    // Every raw value differs between the samples, but both fill the same bins.
    const sel = rows(100, (i) => ({ v: String(i * 10) }));
    const base = rows(100, (i) => ({ v: String(i * 10 + 1) }));
    const f = ranked(compareFields(sel, base, [field("v")], "duration"), "v")!;
    expect(f.kind).toBe("numeric");
    expect(f.score).toBeLessThan(5);
  });

  it("treats a numeric field with 10 or fewer distinct values as categorical", () => {
    const sel = rows(50, (i) => ({ status_code: [200, 404, 500][i % 3] }));
    const f = ranked(
      compareFields(sel, sel, [field("status_code", "Int64")], "duration"),
      "status_code",
    )!;
    expect(f.kind).toBe("categorical");
  });

  it("bins duration on the heatmap's 1-2-5 buckets for brush kinds, only those holding data", () => {
    const sel = rows(30, (i) => ({ duration: 1500 + i * 1000 }));
    const f = ranked(compareFields(sel, sel, [field("duration", "Int64")], "rate"), "duration")!;
    expect(f.kind).toBe("numeric");
    expect(f.bins!.map((b) => [b.lo, b.hi])).toEqual([
      [1000, 2000],
      [2000, 5000],
      [5000, 10000],
      [10000, 20000],
      [20000, 50000],
    ]);
  });

  it("sends a near-unique field with at least 50 values to high cardinality", () => {
    const sel = rows(30, (i) => ({ url: `/u/${i}` }));
    const base = rows(30, (i) => ({ url: `/v/${i}` }));
    const r = compareFields(sel, base, [field("url")], "duration");
    expect(r.highCardinality).toEqual([{ name: "url", distinct: 60 }]);
  });

  it("counts a field with one bucket everywhere as constant", () => {
    const sel = rows(20, () => ({ service_name: "x" }));
    const r = compareFields(sel, sel, [field("service_name"), field("never_set")], "duration");
    expect(r.constant).toEqual(["never_set", "service_name"]);
    expect(r.ranked).toHaveLength(0);
  });

  it("groups a field under 10% present in both populations as mostly empty", () => {
    const sel = rows(100, (i) => (i < 5 ? { rare: "a" } : { rare: i < 8 ? "b" : null }));
    const base = rows(100, (i) => (i < 9 ? { rare: "a" } : {}));
    const r = compareFields(sel, base, [field("rare")], "duration");
    expect(r.mostlyEmpty.map((f) => f.name)).toEqual(["rare"]);
    expect(r.ranked).toHaveLength(0);
  });

  it("ranks a field present in 2% of the selection and 60% of the baseline by its absence", () => {
    const sel = rows(100, (i) => (i < 2 ? { db_system: "postgres" } : {}));
    const base = rows(100, (i) => (i < 60 ? { db_system: "postgres" } : {}));
    const r = compareFields(sel, base, [field("db_system")], "duration");
    const f = r.ranked.find((x) => x.name === "db_system")!;
    expect(f).toBeDefined();
    expect(f.score).toBeCloseTo(58, 6);
    expect(f.presenceSel).toBeCloseTo(0.02, 6);
    expect(f.presenceBase).toBeCloseTo(0.6, 6);
    expect(r.mostlyEmpty).toHaveLength(0);
  });

  it("keeps null and empty string apart", () => {
    const sel = rows(10, (i) => ({ k: i < 3 ? null : i < 6 ? "" : "v" }));
    const base = rows(10, () => ({ k: "v" }));
    const f = ranked(compareFields(sel, base, [field("k")], "duration"), "k")!;
    const kinds = f.rows.map((row) => row.bucket.kind);
    expect(kinds).toContain("noValue");
    expect(kinds).toContain("empty");
  });

  it("shows the top 6 values and folds the rest into Other", () => {
    const sel = rows(90, (i) => ({ op: `op${i % 9}` }));
    const base = rows(90, (i) => ({ op: `op${i % 9}` }));
    const f = ranked(compareFields(sel, base, [field("op")], "duration"), "op")!;
    expect(f.rows).toHaveLength(7);
    const other = f.rows[6];
    expect(other.bucket).toEqual({ kind: "other", count: 3 });
    expect(other.sel).toBeCloseTo(3 / 9, 6);
  });

  it("shows span_kind through its label", () => {
    const sel = rows(20, (i) => ({ span_kind: i < 15 ? "2" : "3" }));
    const base = rows(20, (i) => ({ span_kind: i < 10 ? "2" : "3" }));
    const f = ranked(compareFields(sel, base, [field("span_kind")], "duration"), "span_kind")!;
    expect(f.rows.map((row) => row.label)).toEqual(["Server", "Client"]);
  });

  it("sets the noise floor at 3.16 points for two samples of 2,000", () => {
    const sample = rows(2000, () => ({}));
    expect(compareFields(sample, sample, [], "duration").noiseFloorPts).toBeCloseTo(3.16, 2);
  });
});

describe("filterTermFor", () => {
  beforeAll(() => {
    // The quoting helper reads the reserved words from the server config.
    store.state.zoConfig = { ...store.state.zoConfig, sql_reserved_keywords: ["SELECT", "FROM"] };
  });

  const categorical = (name: string, type = "Utf8"): FieldComparison =>
    ({ name, kind: "categorical", dataType: type }) as FieldComparison;
  const value = (v: string) => ({ kind: "value" as const, value: v });

  it("filters to and excludes a value, keeping nulls on exclude and escaping quotes", () => {
    const f = categorical("service_name");
    expect(filterTermFor(f, value("o'brien"), "include")).toBe("service_name = 'o''brien'");
    expect(filterTermFor(f, value("a"), "exclude")).toBe(
      "(service_name != 'a' or service_name is null)",
    );
  });

  it("treats the string 'null' as a value; only the no-value bucket is null", () => {
    const f = categorical("f");
    expect(filterTermFor(f, value("null"), "include")).toBe("f = 'null'");
    expect(filterTermFor(f, value("null"), "exclude")).toBe("(f != 'null' or f is null)");
    expect(filterTermFor(f, { kind: "noValue" }, "include")).toBe("f is null");
    expect(filterTermFor(f, { kind: "noValue" }, "exclude")).toBe("f is not null");
  });

  it("quotes a keyword or non-simple field name in every term", () => {
    expect(filterTermFor(categorical("select"), value("a"), "include")).toBe(`"select" = 'a'`);
    expect(filterTermFor(categorical("my-field"), value("a"), "exclude")).toBe(
      `("my-field" != 'a' or "my-field" is null)`,
    );
    expect(filterTermFor(categorical("my-field"), { kind: "noValue" }, "include")).toBe(
      `"my-field" is null`,
    );
  });

  it("writes the empty string as its own literal", () => {
    const f = categorical("f");
    expect(filterTermFor(f, { kind: "empty" }, "include")).toBe("f = ''");
    expect(filterTermFor(f, { kind: "empty" }, "exclude")).toBe("(f != '' or f is null)");
  });

  it("writes span_kind with its label", () => {
    expect(filterTermFor(categorical("span_kind"), value("2"), "include")).toBe(
      "span_kind = 'Server'",
    );
  });

  it("offers no term for the Other row", () => {
    expect(filterTermFor(categorical("f"), { kind: "other", count: 3 }, "include")).toBeNull();
  });

  const numeric = (name: string, type: string): FieldComparison => {
    const sample = rows(50, (i) => ({ [name]: type === "Utf8" ? String(i * 100) : i * 100 }));
    return compareFields(sample, sample, [{ name, type }], "rate").ranked.concat(
      compareFields(sample, sample, [{ name, type }], "rate").mostlyEmpty,
    )[0];
  };

  it("bounds a numeric bin with >= lo and < hi, and offers neither past the ends", () => {
    const f = numeric("bytes", "Int64");
    const b = f.bins!;
    expect(filterTermFor(f, { kind: "bin", index: 3 }, "gte")).toBe(`bytes >= ${b[3].lo}`);
    expect(filterTermFor(f, { kind: "bin", index: 3 }, "lt")).toBe(`bytes < ${b[3].hi}`);
    expect(filterTermFor(f, { kind: "bin", index: 0 }, "gte")).toBeNull();
    expect(filterTermFor(f, { kind: "bin", index: 9 }, "lt")).toBeNull();
  });

  it("casts a Utf8 numeric field with TRY_CAST, never CAST", () => {
    const term = filterTermFor(numeric("tcp_rtt_ms", "Utf8"), { kind: "bin", index: 2 }, "gte")!;
    expect(term.startsWith("TRY_CAST(tcp_rtt_ms AS DOUBLE) >= ")).toBe(true);
    expect(term).not.toMatch(/(^|[^_])CAST\(/);
  });

  it("writes duration bounds as the heatmap's human literals", () => {
    const sample = rows(30, (i) => ({ duration: 1500 + i * 1000 }));
    const f = compareFields(sample, sample, [field("duration", "Int64")], "rate").ranked.concat(
      compareFields(sample, sample, [field("duration", "Int64")], "rate").mostlyEmpty,
    )[0];
    expect(filterTermFor(f, { kind: "bin", index: 1 }, "gte")).toBe("duration >= '2ms'");
    expect(filterTermFor(f, { kind: "bin", index: 1 }, "lt")).toBe("duration < '5ms'");
  });

  it("produces terms the editor's parser accepts and decodeFilter keeps", async () => {
    const p = await getParser();
    const terms = [
      filterTermFor(categorical("service_name"), value("o'brien"), "include")!,
      filterTermFor(categorical("select"), value("null"), "exclude")!,
      filterTermFor(categorical("my-field"), { kind: "noValue" }, "exclude")!,
      filterTermFor(categorical("f"), { kind: "empty" }, "exclude")!,
      filterTermFor(categorical("span_kind"), value("3"), "include")!,
      filterTermFor(numeric("tcp_rtt_ms", "Utf8"), { kind: "bin", index: 2 }, "gte")!,
      filterTermFor(numeric("bytes", "Int64"), { kind: "bin", index: 2 }, "lt")!,
      "duration >= '2ms'",
    ];
    const normalise = (where: string) => {
      const sql: string = p.sqlify(p.astify(`SELECT * FROM "default" WHERE ${where}`));
      return sql.replace(/^[\s\S]*?\bWHERE\b\s+/i, "");
    };
    for (const term of terms) {
      expect(() => p.astify(`SELECT * FROM "default" WHERE ${term}`), term).not.toThrow();
      const decoded = parseSpanKindWhereClause(
        parseDurationWhereClause(term, p, "default") as string,
        p,
        "default",
      );
      expect(() => p.astify(`SELECT * FROM "default" WHERE ${decoded}`)).not.toThrow();
      if (!/duration|span_kind/.test(term)) expect(decoded).toBe(normalise(term));
    }
  });
});
