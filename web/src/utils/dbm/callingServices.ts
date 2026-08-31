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
 * D5 — the CALLING SERVICES attached to a server-vantage row.
 *
 * The server row says a statement cost 5,581,260 executions. It cannot say WHO
 * ran them: `pg_stat_statements` records no caller, and sqlcommenter tags do
 * not survive into it (Postgres computes `queryid` from the parsed tree, and
 * comments are not in the tree). Traces can say it. So this module answers
 * exactly one question — "which of my services were seen calling this
 * statement" — and attaches the answer to a row whose NUMBERS stay the server's.
 *
 * **This is a context join, never arithmetic.** Nothing here sums the two
 * vantages, averages their latencies, or lets a trace figure occupy a tile a
 * server figure already holds. The trace side contributes service names, and
 * a client-observed latency that is labelled as such and never compared to the
 * server's.
 *
 * ## The honesty problem this module exists to solve
 *
 * The traced population is a strict SUBSET of the server population, and the
 * gap is not small — measured live at ~3.7×. Traces see only instrumented
 * callers, only finished calls, and only spans that pass the CLIENT/PRODUCER
 * and has-DB-attribute gates. Trace `calls` additionally has no head-sampling
 * compensation anywhere in the path.
 *
 * So a bare list of services under a 5.5M-execution row is a lie by omission:
 * it reads as "these three services made those 5.5 million calls". Every
 * consumer of this module therefore gets {@link DbmCallingServices.coverage} in
 * the same breath as the names, so the gap is stated rather than assumed. The
 * residual is not a defect to hide — a large one is itself the finding: most of
 * this load comes from something you are not tracing.
 *
 * ## The join
 *
 * The key is `(fingerprint, engine, database)` — `database` dropped for
 * mysql/mariadb, whose `top_query` records carry none. `overlapJoinKey` in
 * `overlapJoin.ts` is the one implementation of that key and this module reuses
 * it rather than restating it.
 *
 * A fingerprint hashes statement TEXT ONLY, so nine of them run under two
 * engines at once on the live fleet. Joining on the fingerprint alone fuses
 * them: fp `69219a9c7fc5039d` is 125,195 postgres spans AND 219,713 mysql
 * spans, and the fused caller list would attribute MySQL's services to a
 * Postgres row's counters. When the key cannot be formed, this module REFUSES
 * to attribute rather than guessing — the same instinct the backend's pooler
 * refusal already encodes (`matched:false` + `unmatched_reason`).
 */

import { overlapJoinKey } from "./overlapJoin";

/** One `(service, endpoint)` caller pair, as the endpoints aggregation emits it. */
export interface DbmCallerRow {
  service_name?: string | null;
  endpoint?: string | null;
  calls?: number | null;
  errors?: number | null;
  total_time_ns?: number | null;
  /** CLIENT-observed — includes network and connection-pool wait. */
  p95_ns?: number | null;
}

/** The identity of the server row the callers are being attached TO. */
export interface DbmCallingServicesScope {
  fingerprint?: string | null;
  /** The engine, under either vantage's spelling (`db_system` / `o2_db_system`). */
  engine?: string | null;
  database?: string | null;
}

/** One service, folded from every `(service, endpoint)` pair it appears in. */
export interface DbmCallingService {
  name: string;
  /** Traced calls attributed to this service. A FLOOR, never a population. */
  calls: number;
  errors: number;
  /**
   * The slowest typical call THIS CALLER saw, nanoseconds — round-trip,
   * including network and pool wait, so it is not the server's figure and must
   * never be rendered without the client-observed qualifier.
   *
   * `null` when no constituent pair reported one. Merging the pairs' p95s would
   * be a fabrication (there is no stored sketch), so the MAX is taken: the
   * worst p95 any of this service's endpoints saw is a real measurement of a
   * real endpoint, where a weighted mean of percentiles is a measurement of
   * nothing.
   */
  p95Ns: number | null;
}

/**
 * Why no services are attached. Each names a different sentence, because each
 * has a different fix — and none of them is "nothing calls this".
 */
export type DbmCallingServicesState =
  /** Services were seen. The only state that renders a list. */
  | "attributed"
  /**
   * The join key could not be formed (no engine, or a per-database engine with
   * no database named). Attribution is REFUSED, not empty.
   */
  | "unjoinable"
  /**
   * The trace vantage has nothing for this fingerprint at all. The section
   * HIDES on this: an empty caller list reads as "nothing calls this
   * statement", which is false — it means nothing INSTRUMENTED calls it.
   */
  | "noTraceVantage";

export interface DbmCallingServices {
  state: DbmCallingServicesState;
  /** Heaviest first. Empty unless `state` is `attributed`. */
  services: DbmCallingService[];
  /**
   * Calls the trace vantage attributed to a NAMED service. Excludes the
   * unattributed bucket below — a call whose trace root fell outside the window
   * has been counted, but it names no service, so it cannot support the claim
   * "service X called this".
   */
  tracedCalls: number;
  /**
   * Traced calls whose caller is genuinely unknown: the DB span's trace root is
   * missing or outside the window. A REAL result, kept separate from the named
   * services rather than dropped — dropping it would shrink the traced total
   * and overstate how well the named services cover the row.
   */
  unattributedCalls: number;
  /**
   * The server's own execution count — the denominator, and the only defensible
   * one. `null` when the server vantage did not match this row, in which case
   * {@link coverage} is `null` too and the caller renders "—", never a
   * percentage.
   */
  serverCalls: number | null;
  /**
   * Traced calls over server calls, `0`–`1`, or `null` when it cannot be
   * computed. NEVER `0` for "unknown" and never clamped to `1`.
   *
   * Deliberately NOT normalised to 100%. Normalising the attributed traffic
   * would tell a reader that a service responsible for 27% of calls is
   * responsible for all of it.
   */
  coverage: number | null;
}

/**
 * A state with nothing attributed. `serverCalls` is carried through even here:
 * the row's own execution count is a fact about the row, not about the join, so
 * a refusal to attribute must not also erase what the database reported.
 */
const nothing = (
  state: DbmCallingServicesState,
  serverCalls: number | null,
): DbmCallingServices => ({
  state,
  services: [],
  tracedCalls: 0,
  unattributedCalls: 0,
  serverCalls,
  coverage: null,
});

const finite = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Fold the endpoints aggregation into per-service rows, with the coverage the
 * list must always be read alongside.
 *
 * `rows` is `null`/`undefined` when the trace read did not answer — no stream
 * resolved, or a failed read. That is NOT the zero-trace observation: it is the
 * absence of an answer, and it produces `noTraceVantage` so the surface hides
 * rather than claiming an absence it never measured. The caller keeps its own
 * error state for a read that broke.
 */
export const foldCallingServices = (
  rows: readonly DbmCallerRow[] | null | undefined,
  scope: DbmCallingServicesScope,
  serverCalls: number | null | undefined,
): DbmCallingServices => {
  const server = finite(serverCalls);

  // The join key first, before any folding. A row we cannot key is a row whose
  // callers belong to an unknown engine, and attaching them to THIS row's
  // counters is the fusion the composite key exists to prevent.
  if (overlapJoinKey(scope.fingerprint, scope.engine, scope.database) === null) {
    return nothing("unjoinable", server);
  }

  if (!rows || rows.length === 0) {
    return nothing("noTraceVantage", server);
  }

  const byName = new Map<string, DbmCallingService>();
  let unattributedCalls = 0;

  for (const row of rows) {
    const calls = finite(row.calls) ?? 0;
    const errors = finite(row.errors) ?? 0;
    const name = (row.service_name ?? "").trim();
    if (!name) {
      // A null caller is a measured outcome, not a parse failure — see
      // `unattributedCalls`.
      unattributedCalls += calls;
      continue;
    }
    const existing = byName.get(name);
    const p95 = finite(row.p95_ns);
    if (existing) {
      existing.calls += calls;
      existing.errors += errors;
      existing.p95Ns = p95 === null ? existing.p95Ns : Math.max(existing.p95Ns ?? p95, p95);
    } else {
      byName.set(name, { name, calls, errors, p95Ns: p95 });
    }
  }

  const services = [...byName.values()].sort(
    (a, b) => b.calls - a.calls || a.name.localeCompare(b.name),
  );

  // Rows arrived, but every one of them was unattributed: the trace vantage IS
  // present (calls were traced) and it genuinely names no service. That is a
  // fact worth stating, and it is not `noTraceVantage` — hiding here would
  // suppress the honest answer "we traced 341,169 of these and could not tell
  // you who made a single one".
  if (!services.length && unattributedCalls === 0) {
    return nothing("noTraceVantage", server);
  }

  const tracedCalls = services.reduce((acc, s) => acc + s.calls, 0);

  return {
    state: "attributed",
    services,
    tracedCalls,
    unattributedCalls,
    serverCalls: server,
    // The server count is the ONLY defensible denominator: it counts every
    // client. A traced total over a traced total would always be 100% and would
    // say nothing. `null` when the server did not match — a coverage figure
    // needs both vantages, and inventing one from the traced side alone is the
    // normalisation this module refuses.
    coverage: server !== null && server > 0 ? (tracedCalls + unattributedCalls) / server : null,
  };
};

/**
 * Whether the calling-services section should render at all (D3).
 *
 * `noTraceVantage` HIDES: an empty caller list under a 5.5M-execution row reads
 * as "nothing calls this statement". `unjoinable` still renders — a refusal is
 * a statement worth making, and silently omitting the section would look
 * identical to having no data.
 */
export const showsCallingServices = (result: DbmCallingServices): boolean =>
  result.state !== "noTraceVantage";
