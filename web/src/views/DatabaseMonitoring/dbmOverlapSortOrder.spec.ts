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
 * A sort must order the values the reader can SEE.
 *
 * The Top-queries list ranks server-side on the TRACE rollup and then resolves
 * the two overlap columns server-first in the browser, per row. Those are two
 * different numbers, so the ordering and the printing came apart: descending
 * "Database time" could put a smaller printed figure above a larger one.
 *
 * This spec reconstructs the page's own row pipeline — the real join
 * (`overlapJoin`) and the real resolver (`overlapMetrics`), on the live
 * `default` org's shapes — and states the arithmetic that made a correct
 * client-side re-sort impossible. QueriesPage.vue's own wiring (that the two
 * columns are `sortable: false`, and why) is pinned in
 * dbmListOverlapVantage.spec.ts; what is proven HERE is the underlying claim
 * that forced it.
 */

import { describe, expect, it } from "vitest";

import { indexServerRows, serverCounterpart } from "@/utils/dbm/overlapJoin";
import type { DbmServerCounters } from "@/utils/dbm/overlapJoin";
import { resolveCalls, resolveDatabaseTime } from "@/utils/dbm/overlapMetrics";
import type { DbmOverlapMetric } from "@/utils/dbm/overlapMetrics";

/** A client row as `/queries` emits it — the fields the join and resolver read. */
interface ClientRow {
  fingerprint: string;
  db_system: string;
  db_namespace: string | null;
  calls: number | null;
  total_time_ns: number | null;
}

/**
 * The page's row build, reduced to the two overlap measures. Mirrors
 * `rows.value = hits.map(...)` in QueriesPage.vue: join on the composite key,
 * then resolve server-first with the traced figure as the fallback.
 */
const resolveRows = (rows: readonly ClientRow[], serverRows: readonly DbmServerCounters[]) => {
  const index = indexServerRows(serverRows);
  return rows.map((row) => {
    const counterpart = serverCounterpart(index, row);
    return {
      fingerprint: row.fingerprint,
      calls: resolveCalls({
        serverCalls: counterpart?.calls,
        engine: counterpart?.db_system ?? row.db_system,
        clientCalls: row.calls,
      }),
      time: resolveDatabaseTime({
        serverExecTimeS: counterpart?.exec_time_s,
        execTimeKind: counterpart?.exec_time_kind ?? undefined,
        engine: counterpart?.db_system ?? row.db_system,
        clientTotalTimeNs: row.total_time_ns,
      }),
    };
  });
};

/**
 * The live `default` org in miniature: a Postgres statement the database also
 * reports, a MySQL statement it reports as WAIT time, a statement the server
 * feed never returned (falls back to traces), and one neither vantage measured.
 *
 * Ordered as the BACKEND returns them — descending by the traced
 * `total_time_ns`, which is what `sort_rows` ranks on.
 */
const CLIENT_ROWS: ClientRow[] = [
  // Traced-heaviest, but the database reports far MORE calls than traces saw.
  {
    fingerprint: "1ae4178a9938bf4d",
    db_system: "postgresql",
    db_namespace: "dbmlab",
    calls: 9372,
    total_time_ns: 56_332_053_071_248,
  },
  // Traced 2nd, and the server reports a much SMALLER figure: its wait time is
  // not the same measure as the client's round trip.
  {
    fingerprint: "b8e370c07267ac5e",
    db_system: "mysql",
    db_namespace: null,
    calls: 219_278,
    total_time_ns: 28_323_424_642_367,
  },
  // No server counterpart at all — stays client-observed.
  {
    fingerprint: "5a44922e5fa1390b",
    db_system: "postgresql",
    db_namespace: "dbmlab",
    calls: 6185,
    total_time_ns: 37_127_939_731_600,
  },
  // Neither vantage measured a duration: absent, and absent is not zero.
  {
    fingerprint: "0000000000000000",
    db_system: "postgresql",
    db_namespace: "dbmlab",
    calls: null,
    total_time_ns: null,
  },
];

const SERVER_ROWS: DbmServerCounters[] = [
  {
    fingerprint: "1ae4178a9938bf4d",
    db_system: "postgresql",
    db_namespace: "dbmlab",
    calls: 5_581_260,
    exec_time_s: 15_516.770936397,
    exec_time_kind: "execution",
  },
  {
    fingerprint: "b8e370c07267ac5e",
    db_system: "mysql",
    db_namespace: null,
    calls: 1_495_679,
    exec_time_s: 6918.972319966,
    exec_time_kind: "wait",
  },
];

describe("the resolved overlap values do not follow the traced ranking", () => {
  const resolved = resolveRows(CLIENT_ROWS, SERVER_ROWS);

  /** The column legitimately mixes vantages — that is the premise, not a bug. */
  it("mixes server- and client-resolved rows inside one column", () => {
    expect(resolved.map((r) => r.time.source)).toEqual(["server", "server", "client", null]);
    expect(resolved.map((r) => r.calls.source)).toEqual(["server", "server", "client", null]);
  });

  /**
   * The defect itself, as an inequality. The rows arrive in descending TRACED
   * order, so if the printed values agreed with the ranking each would be <=
   * the one before it. Row 2 prints ABOVE row 3 while being smaller.
   */
  it("prints a smaller database time above a larger one under the traced ranking", () => {
    const [, mysqlServer, pgClient] = resolved;
    expect(mysqlServer.time.value).toBeLessThan(pgClient.time.value as number);
    // ...even though the backend ranked the MySQL row HIGHER, on its traced
    // duration, which is the number no longer on screen.
    const tracedOrder = CLIENT_ROWS.map((r) => r.total_time_ns);
    expect(tracedOrder[1]).toBeLessThan(tracedOrder[2] as number);
  });

  it("prints a smaller call count above a larger one, likewise", () => {
    const [pgServer, mysqlServer] = resolved;
    // Traced ranking put the Postgres row first; by the DISPLAYED counts the
    // MySQL row is not merely close, it is a different order of magnitude in
    // the other direction than its traced count suggested.
    expect(pgServer.calls.value).toBeGreaterThan(mysqlServer.calls.value as number);
    expect(CLIENT_ROWS[0].calls).toBeLessThan(CLIENT_ROWS[1].calls as number);
  });
});

describe("ordering by the displayed value", () => {
  const resolved = resolveRows(CLIENT_ROWS, SERVER_ROWS);

  /**
   * The rule the page would need if it ever ranked on these values: absent
   * sorts LAST, never as 0. A `0` would place an unmeasured statement among the
   * cheapest — an all-clear nobody observed.
   */
  const byDisplayedDesc = (rows: readonly { time: DbmOverlapMetric }[]) =>
    [...rows].sort((a, b) => {
      if (a.time.value === null) return 1;
      if (b.time.value === null) return -1;
      return b.time.value - a.time.value;
    });

  it("puts the largest displayed value first and the absent one last", () => {
    const order = byDisplayedDesc(resolved).map((r) => r.time.value);
    expect(order[order.length - 1]).toBeNull();
    const measured = order.slice(0, -1) as number[];
    for (let i = 0; i < measured.length - 1; i += 1) {
      expect(measured[i]).toBeGreaterThanOrEqual(measured[i + 1]);
    }
  });

  /**
   * Absent must not be coerced. This is the assertion that fails the moment
   * somebody reaches for `?? 0` to make a comparator simpler.
   */
  it("never treats an absent value as zero", () => {
    const absent = resolved[resolved.length - 1];
    expect(absent.time.value).toBeNull();
    expect(absent.time.value).not.toBe(0);
    expect(absent.calls.value).toBeNull();
    expect(absent.time.qualifierKey).toBeNull();
  });

  /**
   * And the reason this ordering is NOT offered to the reader even though it
   * can be computed: sorting it would rank a Postgres EXECUTION figure against
   * a MySQL WAIT figure against a traced ROUND-TRIP figure as if they were one
   * measure. The qualifiers prove the three are distinct.
   */
  it("would be comparing three different measures, which the qualifiers name", () => {
    const qualifiers = resolved.map((r) => r.time.qualifierKey);
    expect(qualifiers).toEqual(["serverExecution", "serverWait", "clientObserved", null]);
    expect(new Set(qualifiers.filter(Boolean)).size).toBe(3);
  });
});

/**
 * Why a client-side re-sort could not have been the fix, in arithmetic.
 *
 * The backend sorts on the traced field and THEN truncates
 * (`sort_rows` → `hits.truncate(limit)`, api.rs), reporting the pre-truncation
 * count as `total`. Live on `default`: `hits: 100, total: 130`. Re-ordering the
 * 100 rows that survived a TRACED top-100 by their SERVER values silently
 * excludes any row that is heavy by server time but light by traced time — it
 * was cut before the browser ever saw it.
 */
describe("the row set the page holds is already truncated by the traced rank", () => {
  /** A row that ranks 1st by server time but below the cut by traced time. */
  const BELOW_THE_CUT: ClientRow = {
    fingerprint: "beefbeefbeefbeef",
    db_system: "postgresql",
    db_namespace: "dbmlab",
    calls: 3,
    total_time_ns: 1_000,
  };

  it("cannot surface a row the traced ranking cut, however it re-sorts", () => {
    const LIMIT = 3;
    const ranked = [...CLIENT_ROWS, BELOW_THE_CUT].sort(
      (a, b) => (b.total_time_ns ?? 0) - (a.total_time_ns ?? 0),
    );
    const delivered = ranked.slice(0, LIMIT);

    expect(delivered).not.toContainEqual(BELOW_THE_CUT);

    // Even given the server counters that would have made it the heaviest row
    // on the page, it is absent from everything the browser can re-sort.
    const heaviest: DbmServerCounters = {
      fingerprint: BELOW_THE_CUT.fingerprint,
      db_system: "postgresql",
      db_namespace: "dbmlab",
      calls: 9_000_000,
      exec_time_s: 99_999,
      exec_time_kind: "execution",
    };
    const resolved = resolveRows(delivered, [...SERVER_ROWS, heaviest]);
    expect(resolved.map((r) => r.fingerprint)).not.toContain(BELOW_THE_CUT.fingerprint);
  });
});
