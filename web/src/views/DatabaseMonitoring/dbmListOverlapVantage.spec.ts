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

/**
 * The LIST pages' two overlap measures — calls and database time — and the
 * rule that they read the same as the detail page they open.
 *
 * The defect this pins shut: "Database time" and "Calls" are the same
 * user-facing strings on the list and on QueryDetailPage, but the list took
 * them from TRACES while the detail page had already been converted to the
 * database's own counters. On a MySQL fleet that meant clicking a row swapped
 * a client round-trip figure for a WAIT-time figure under an identical
 * heading — two different numbers for one question, ~27% apart on the live
 * `default` org (fingerprint c7c87dc1b19851d4: 1,380,509,460,494 ns traced vs
 * 1,086,104,880,289 ns of MySQL wait).
 *
 * Three properties, and each is one a future edit could plausibly undo:
 *   • the overlap measures resolve SERVER-FIRST on the list, through the same
 *     resolver the detail page uses;
 *   • no overlap value reaches the screen without its qualifier, because on
 *     MySQL an unqualified duration reads as execution time; and
 *   • trace-only figures HIDE when the trace vantage is empty, rather than
 *     rendering a dash — or a "none" that reads as an all-clear.
 *
 * Source-read, for the reason dbmRequestGuard.spec.ts gives: these views need
 * a router, a store and a dozen O2 children to mount, and a harness that heavy
 * fails for unrelated reasons and gets deleted. The BEHAVIOUR of the resolver
 * and the cell is unit-tested for real in overlapMetrics.spec.ts,
 * overlapJoin.spec.ts and DbmOverlapValue.spec.ts; what is checked here is
 * that the pages are wired to them.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * The body of a `#cell-<id>` template slot, to the slot that follows it.
 *
 * `occurrence` picks WHICH one: QueriesPage carries two tables (the client
 * ranking, and the database-reported list that replaces it), and both define a
 * `#cell-calls`. Defaulting to the first and calling it "the calls cell" is
 * how the fallback table's columns went unchecked in the first place.
 */
const cellSlot = (source: string, id: string, occurrence = 0): string => {
  let start = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    start = source.indexOf(`#cell-${id}=`, start + 1);
    if (start === -1) return "";
  }
  const next = source.indexOf("<template #cell-", start + 10);
  return source.slice(start, next === -1 ? start + 1200 : next);
};

describe("QueriesPage sources its overlap measures from the database", () => {
  const source = read("QueriesPage.vue");

  it("resolves both overlap measures through the shared resolver", () => {
    expect(source).toContain("resolveCalls(");
    expect(source).toContain("resolveDatabaseTime(");
    // Through the SHARED module, so the list and the detail page can never
    // drift on precedence or on which qualifier a figure earns.
    expect(source).toContain('from "@/utils/dbm/overlapMetrics"');
  });

  /**
   * The join is composite. Matching on fingerprint alone fuses engines — a
   * fingerprint hashes statement TEXT ONLY, and nine of them live under two
   * engines at once on the live fleet, so a fingerprint-only join would print
   * MySQL wait time on a Postgres row.
   */
  it("joins the server counters on the composite key, not the fingerprint alone", () => {
    expect(source).toContain("serverCounterpart(");
    expect(source).toContain('from "@/utils/dbm/overlapJoin"');
  });

  it("feeds the server's own call count into the calls resolver", () => {
    const rowBuild = source.slice(source.indexOf("rows.value = hits.map("));
    expect(rowBuild).toContain("serverCalls: counterpart?.calls");
    // ...and keeps the traced count only as the explicit fallback.
    expect(rowBuild).toContain("clientCalls: row.calls");
  });

  /**
   * `exec_time_kind` is what decides wait vs execution, and it comes from the
   * BACKEND per row. Deriving it from the engine name in the UI would silently
   * mislabel any engine that later starts reporting execution time.
   */
  it("takes the wait/execution distinction from the backend's exec_time_kind", () => {
    const rowBuild = source.slice(source.indexOf("rows.value = hits.map("));
    expect(rowBuild).toContain("execTimeKind: counterpart?.exec_time_kind");
  });

  it("renders the calls column through the qualifier-bearing cell", () => {
    const cell = cellSlot(source, "calls");
    expect(cell).toContain("DbmOverlapValue");
    expect(cell).toContain("row.overlapCalls.qualifierKey");
    // The raw traced count is GONE from the column — not demoted to a second
    // line, which would restore the two-numbers-for-one-question problem.
    expect(cell).not.toContain("formatCount(row.calls)");
  });

  it("renders the database-time column from the resolved value, with its qualifier", () => {
    const cell = cellSlot(source, "total_time_ns");
    expect(cell).toContain("row.overlapTime.value");
    expect(cell).toContain("row.overlapTime.qualifierKey");
    // The raw traced duration no longer feeds the cell.
    expect(cell).not.toMatch(/:total-time-ns="row\.total_time_ns"/);
  });

  /**
   * The share is CLIENT-scope arithmetic — this row's traced time over the
   * traced scope total. Under a server-sourced duration it divides the
   * engine's own total by a traced subtotal: two different populations, a
   * ratio that routinely exceeds 100%.
   */
  it("tells the load cell which vantage the duration came from, so the share can be withheld", () => {
    expect(cellSlot(source, "total_time_ns")).toContain(':source="row.overlapTime.source"');
  });

  /** The Δ compares traced window to traced window; it cannot qualify a server figure. */
  it("keeps the calls delta only under a client-observed count", () => {
    expect(cellSlot(source, "calls")).toContain("row.overlapCalls.source === 'client'");
  });

  it("labels the columns with their provenance in the header", () => {
    expect(source).toContain("dbm.queries.columnSubLabels.calls");
    expect(source).toContain("dbm.queries.columnSubLabels.load");
  });

  describe("the summary tiles", () => {
    /**
     * The tiles sit directly above the table and answer the same question, so
     * they must not describe a different vantage than the rows beneath them.
     */
    it("never mixes vantages in a total", () => {
      const totals = source.slice(
        source.indexOf("const overlapTotals ="),
        source.indexOf("const uniformTimeQualifier ="),
      );
      expect(totals.length).toBeGreaterThan(200);
      // A server total is summed ONLY when every row on screen resolved to the
      // server; anything else stays with the traced total it can add honestly.
      expect(totals).toContain("every(");
    });

    /**
     * In fallback mode the table below IS the database's list. The tiles used
     * to keep summing a trace vantage that returned nothing — four figures
     * describing rows that are not on screen.
     */
    it("follows the table into fallback mode", () => {
      const totals = source.slice(source.indexOf("const overlapTotals ="));
      expect(totals.slice(0, 900)).toContain("serverListShown.value");
    });

    it("carries a qualifier on both overlap tiles", () => {
      const stats = source.slice(
        source.indexOf("const summaryStats ="),
        source.indexOf("const visibleSummaryStats ="),
      );
      expect(stats).toContain("sub: qualifier(totals.calls.qualifierKey)");
      expect(stats).toContain("sub: qualifier(totals.time.qualifierKey)");
    });

    /**
     * A sum across engines folds execution time into wait time, so it may not
     * be named as either — the generic is the only honest label for it.
     */
    it("refuses to name a mixed-engine time sum as wait or execution", () => {
      const fn = source.slice(
        source.indexOf("const uniformTimeQualifier ="),
        source.indexOf("const fallbackTimeQualifier ="),
      );
      expect(fn).toContain("serverReported");
      expect(fn).toContain("distinct.size === 1");
    });

    /** RULE A: the failure count is trace-only, so it is dropped, not dashed. */
    it("hides the trace-only failure tile when there is no trace vantage", () => {
      const visible = source.slice(source.indexOf("const visibleSummaryStats ="));
      expect(visible.slice(0, 400)).toContain("hasDbmTraceVantage(");
      expect(visible.slice(0, 400)).toContain('stat.key !== "failed"');
    });
  });

  describe("the server-vantage fallback table", () => {
    /**
     * EVERY row here is a server figure, so on a MySQL fleet every row is wait
     * time under a heading that reads "Total time". This is where an
     * unqualified column is most dangerous, and it had none.
     */
    it("qualifies its time columns per row", () => {
      expect(cellSlot(source, "totalTime")).toContain("serverTimeQualifier(row)");
      expect(cellSlot(source, "meanTime")).toContain("serverTimeQualifier(row)");
    });

    it("qualifies its call counts as the engine's own", () => {
      // The SECOND `#cell-calls` on the page — the fallback table's.
      expect(cellSlot(source, "calls", 1)).toContain("serverCounted");
    });

    /** Read off the row's own `exec_time_kind`, never guessed from the engine name. */
    it("takes wait-vs-execution from the row, not from the engine name", () => {
      const fn = source.slice(source.indexOf("const serverTimeQualifier ="));
      expect(fn.slice(0, 200)).toContain("exec_time_kind");
      expect(fn.slice(0, 200)).not.toContain('"mysql"');
    });
  });
});

/**
 * The MySQL case, stated as an invariant over the source rather than an
 * example: there is no path on these pages that puts a duration on screen
 * with the engine's name attached and no word for WHICH time it is.
 */
describe("a MySQL row can never show its time without a wait qualifier", () => {
  it("has no code path producing serverWait without the wait kind", () => {
    const metrics = readFileSync(join(here, "../../utils/dbm/overlapMetrics.ts"), "utf8");
    // The ONLY producer of the two server time qualifiers, and it switches on
    // the measurement the backend reported.
    expect(metrics).toContain(
      'qualifierKey: inputs.execTimeKind === "wait" ? "serverWait" : "serverExecution"',
    );
  });

  it("withholds the value entirely when no qualifier can be attached", () => {
    const cell = readFileSync(join(here, "../../components/dbm/DbmOverlapValue.vue"), "utf8");
    // Both conditions together — a value AND something true to say about it.
    expect(cell).toContain("props.value !== null && props.qualifierKey !== null");
  });
});
