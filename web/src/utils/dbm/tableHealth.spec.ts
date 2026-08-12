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

import i18n from "@/locales";

import {
  tableHealthColumns,
  tableHealthEmptyCause,
  tableHealthRows,
  tableSizeLabel,
  vacuumLabel,
  scanCountDisclosure,
  tupleCountDisclosure,
  type TableHealthResponse,
  type TableHealthRow,
} from "./tableHealth";

const t = (key: string) => i18n.global.t(key);

const row = (over: Partial<TableHealthRow> = {}): TableHealthRow => ({
  relation: "audit_log",
  schema: "public",
  instance: "pg-primary",
  engine: "postgresql",
  total_bytes: 13_639_680,
  heap_bytes: 10_510_336,
  live_tuples: 137_268,
  dead_tuples: 0,
  dead_tup_pct: 0,
  mod_since_analyze: 5547,
  seq_scan_count: 0,
  seq_tup_read: 0,
  idx_scan_count: 0,
  autovacuum_count: 8,
  frozen_xid_age: 335_437,
  last_vacuum: null,
  last_autovacuum: "2026-08-11 23:39:57.939725+00",
  last_analyze: null,
  last_seen: 1_786_500_000_000_000,
  ...over,
});

const response = (over: Partial<TableHealthResponse> = {}): TableHealthResponse => ({
  hits: [],
  stream: "dbm_server",
  total: 0,
  counters_are_cumulative: true,
  tuples_are_estimated: true,
  engine_coverage: "supported",
  ...over,
});

describe("tableHealthRows", () => {
  it("qualifies a relation with its schema, because a bare name is ambiguous", () => {
    // Two schemas can each hold a `users` table, and the recipe reports both.
    const rows = tableHealthRows([
      row({ relation: "users", schema: "public" }),
      row({ relation: "users", schema: "app" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].qualifiedName).toBe("public.users");
    expect(rows[1].qualifiedName).toBe("app.users");
    expect(rows[0].rowKey).not.toBe(rows[1].rowKey);
  });

  it("keys a row by instance too, so one table on two servers stays two rows", () => {
    const rows = tableHealthRows([
      row({ relation: "users", schema: "public", instance: "pg-a" }),
      row({ relation: "users", schema: "public", instance: "pg-b" }),
    ]);

    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
  });

  it("carries index+TOAST overhead as its own figure", () => {
    // total - heap is the "my indexes are bigger than my table" reading, and
    // computing it in the template would put arithmetic in markup.
    const [r] = tableHealthRows([row({ total_bytes: 13_639_680, heap_bytes: 10_510_336 })]);
    expect(r.overheadBytes).toBe(3_129_344);
  });

  it("reports overhead as null rather than a wrong number when a size is missing", () => {
    const [r] = tableHealthRows([row({ total_bytes: 100, heap_bytes: null })]);
    expect(r.overheadBytes).toBeNull();
  });
});

describe("tableSizeLabel", () => {
  it("renders bytes in human units", () => {
    expect(tableSizeLabel(13_639_680)).toBe("13.0 MB");
    expect(tableSizeLabel(884_736)).toBe("864.0 KB");
  });

  it("distinguishes a genuinely empty table from an unmeasured one", () => {
    // A 0-byte table is a real, reportable state; a missing measurement is not.
    expect(tableSizeLabel(0)).toBe("0 B");
    expect(tableSizeLabel(null)).toBe("—");
  });
});

describe("vacuumLabel", () => {
  it("says NEVER rather than rendering a blank cell", () => {
    // The recipe COALESCEs a null vacuum time to '' and the backend drops it,
    // so null here means "never vacuumed" — a finding, not missing data. A
    // blank cell reads as "we do not know", which is the opposite claim.
    expect(vacuumLabel(null, t)).toBe(t("dbm.tableHealth.never"));
  });

  it("passes a real timestamp through for the renderer to format", () => {
    expect(vacuumLabel("2026-08-11 23:39:57.939725+00", t)).toBe("2026-08-11 23:39:57.939725+00");
  });
});

describe("scanCountDisclosure", () => {
  it("states that the counters are LIFETIME totals, never per-window", () => {
    // The single most important sentence on this page. seq_scan/idx_scan/
    // autovacuum_count count from the last pg_stat_reset(), so labelling them
    // with the page's time filter is a strictly stronger claim than the data
    // supports.
    const claim = scanCountDisclosure(response({ counters_are_cumulative: true }), t);

    expect(claim).toBe(t("dbm.tableHealth.countersCumulative"));
    expect(claim.toLowerCase()).not.toContain("in this window");
  });

  it("says nothing when the API did not make the claim", () => {
    // Inventing the disclosure would be as dishonest as omitting it: a build
    // whose API never set the flag has not told us the counters are cumulative.
    expect(scanCountDisclosure(response({ counters_are_cumulative: false }), t)).toBeNull();
  });
});

describe("tupleCountDisclosure", () => {
  it("states that the row counts are planner ESTIMATES", () => {
    const claim = tupleCountDisclosure(response({ tuples_are_estimated: true }), t);
    expect(claim).toBe(t("dbm.tableHealth.tuplesEstimated"));
  });

  it("says nothing when the API did not make the claim", () => {
    expect(tupleCountDisclosure(response({ tuples_are_estimated: false }), t)).toBeNull();
  });
});

describe("tableHealthEmptyCause", () => {
  it("names the ENGINE when the signal is not collected for it", () => {
    // The dangerous empty state: a MySQL user sees no rows and reads it as
    // "no problems found" about a check that never ran.
    expect(tableHealthEmptyCause(response({ engine_coverage: "unsupported", hits: [] }))).toBe(
      "engine-unsupported",
    );
  });

  it("reports NOT-COLLECTING when the engine supports it but nothing arrived", () => {
    expect(tableHealthEmptyCause(response({ engine_coverage: "supported", hits: [] }))).toBe(
      "not-collecting",
    );
  });

  it("reports not-collecting for an unfiltered request with no rows", () => {
    // `unknown` spans engines; with zero rows the actionable advice is still
    // "switch the recipe on", not "your engine is unsupported".
    expect(tableHealthEmptyCause(response({ engine_coverage: "unknown", hits: [] }))).toBe(
      "not-collecting",
    );
  });

  it("reports nothing to explain when there are rows", () => {
    expect(
      tableHealthEmptyCause(response({ engine_coverage: "supported", hits: [row()] })),
    ).toBeNull();
  });

  it("prefers the engine explanation over not-collecting", () => {
    // Both are true for a MySQL user. Telling them to switch on a Postgres-only
    // recipe sends them to fix a non-problem.
    expect(tableHealthEmptyCause(response({ engine_coverage: "unsupported", hits: [] }))).toBe(
      "engine-unsupported",
    );
  });
});

// ─── Column definitions ──────────────────────────────────────────────────────

// Reuses the `t` declared at the top of this file.
const tCols = t as unknown as Parameters<typeof tableHealthColumns>[0];

const columnsById = () => new Map(tableHealthColumns(tCols).map((c) => [c.id, c]));

describe("tableHealthColumns · sorting", () => {
  /**
   * The page passes `sorting="client"` to OTable, which turns the table-level
   * mode on — but a column only gets a sort trigger when it opts in with
   * `sortable: true`. Not one column set it, so the mode was on and nothing was
   * sortable. "Which table is eating the disk" is a SORT question, so this is
   * the whole point of the surface.
   */
  it("marks every column sortable", () => {
    const cols = tableHealthColumns(tCols);
    expect(cols.length).toBeGreaterThan(0);

    const notSortable = cols.filter((c) => c.sortable !== true).map((c) => c.id);
    expect(
      notSortable,
      `these columns cannot be sorted, so OTable renders no sort trigger for them`,
    ).toEqual([]);
  });

  /**
   * The numeric columns are the ones a reader sorts BY. Named explicitly so a
   * future column added without `sortable` fails here even if the sweep above
   * were ever narrowed.
   */
  it("makes the size and counter columns sortable by name", () => {
    const by = columnsById();
    for (const id of [
      "total_bytes",
      "heap_bytes",
      "overheadBytes",
      "live_tuples",
      "dead_tuples",
      "dead_tup_pct",
      "seq_scan_count",
      "idx_scan_count",
      "autovacuum_count",
    ]) {
      expect(by.get(id)?.sortable, `column "${id}" is not sortable`).toBe(true);
    }
  });
});

describe("tableHealthColumns · magnitude bars", () => {
  /**
   * A bar is a claim that the number is a PROPORTION of something. It is
   * honest on the size columns (a table's bytes against the largest table's
   * bytes is a real share of the disk) and on the bloat percentage (already
   * 0-100). It is NOT honest on a lifetime counter: `seq_scan_count` is
   * cumulative since the last `pg_stat_reset()`, so a full bar would mean
   * "most scans of any table since an unobserved point in time", which reads as
   * a severity it is not. Those columns keep their number and no bar.
   */
  it("bars the size columns and the bloat percentage", () => {
    const by = columnsById();
    for (const id of ["total_bytes", "heap_bytes", "overheadBytes", "dead_tup_pct"]) {
      expect(by.get(id)?.meta?.bar, `column "${id}" should render a magnitude bar`).toBeTruthy();
    }
  });

  it("puts no bar on the lifetime counters or the tuple estimates", () => {
    const by = columnsById();
    for (const id of [
      "seq_scan_count",
      "seq_tup_read",
      "idx_scan_count",
      "autovacuum_count",
      "frozen_xid_age",
      "mod_since_analyze",
      "live_tuples",
      "dead_tuples",
    ]) {
      expect(
        by.get(id)?.meta?.bar,
        `column "${id}" is an unbounded counter — a proportional bar would imply a ceiling it does not have`,
      ).toBeFalsy();
    }
  });

  /**
   * `dead_tup_pct` is already a percentage, so its bar's 100% reference is the
   * literal number 100 — NOT the column max. Scaling it to the worst row would
   * paint a 3%-bloated table as a full bar whenever it happened to be the worst
   * in the list, which is the single most misleading thing this column could do.
   */
  it("scales the bloat bar against 100, not against the worst row", () => {
    const by = columnsById();
    expect(by.get("dead_tup_pct")?.meta?.bar).toBe("percent");
  });

  /** The size bars are relative to the biggest table in the list. */
  it("scales the size bars against the column max", () => {
    const by = columnsById();
    for (const id of ["total_bytes", "heap_bytes", "overheadBytes"]) {
      expect(by.get(id)?.meta?.bar).toBe("max");
    }
  });

  /**
   * A bar ACCOMPANIES the number, it does not replace it. The formatters are
   * the honest display values — `tableSizeLabel` on bytes, a two-decimal
   * percentage on bloat — and a change that swapped a formatter for a bar would
   * lose the reader's actual measurement.
   */
  it("keeps the value formatter on every barred column", () => {
    const by = columnsById();
    for (const id of ["total_bytes", "heap_bytes", "overheadBytes", "dead_tup_pct"]) {
      expect(typeof by.get(id)?.meta?.format, `column "${id}" lost its formatter`).toBe("function");
    }
    expect((by.get("total_bytes")?.meta?.format as (v: unknown) => string)(13_639_680)).toBe(
      "13.0 MB",
    );
    expect((by.get("dead_tup_pct")?.meta?.format as (v: unknown) => string)(2.98)).toBe("2.98%");
  });
});
