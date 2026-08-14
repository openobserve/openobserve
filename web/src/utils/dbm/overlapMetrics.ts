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
 * The OVERLAP resolver: which vantage supplies a measure both of them can.
 *
 * Two figures on the query page — total database time, and the call count —
 * exist in both feeds. The page used to print the trace-derived one under a
 * vantage-qualified heading and the server one again, lower down, under a
 * second heading. A reader comparing them found two different numbers for one
 * question and had to work out which to quote.
 *
 * **The database server wins.** It counts every client, traced or not, and it
 * measures the work the engine actually did. The trace vantage sees only
 * instrumented callers, so its call count is a subset by construction — it is
 * the wrong number to headline, and it is dropped from the tile rather than
 * demoted to a second line, which would restore the same two-numbers problem in
 * smaller type.
 *
 * **The engine qualifier is not optional.** `exec_time_s` is EXECUTION time on
 * Postgres and WAIT time on MySQL/MariaDB. Under a generic "Database time"
 * heading with no qualifier, a MySQL wait figure reads as execution time — a
 * misreading that sends a DBA to optimise a query that was only ever queueing.
 * So the generic label always ships with `qualifierKey`, and there is no code
 * path that produces a value without one.
 *
 * **Fallback keeps data we have.** When the server has no counterpart (the join
 * is permanently partial — see serverMetrics.ts) but the trace vantage does,
 * the trace figure is shown rather than hidden, and the qualifier switches to
 * say it is client-observed. Hiding a number we hold would be worse than
 * labelling it honestly.
 */

/** Seconds on the wire; the page's metrics are nanoseconds. */
const NS_PER_SECOND = 1e9;

export type DbmOverlapSource = "server" | "client";

export interface DbmOverlapInputs {
  /** `ServerQueryRow.exec_time_s` / the matched counters' total, in SECONDS. */
  serverExecTimeS?: number | null;
  /** The server's own call count over the window. */
  serverCalls?: number | null;
  /** Which measurement `serverExecTimeS` IS on this engine. */
  execTimeKind?: "execution" | "wait";
  /** The engine that reported it, for the attribution line ("Reported by mysql"). */
  engine?: string | null;
  /** The trace-vantage total, NANOseconds — the fallback only. */
  clientTotalTimeNs?: number | null;
  /** The trace-vantage call count — the fallback only. */
  clientCalls?: number | null;
}

export interface DbmOverlapMetric {
  /**
   * The resolved figure in the page's unit (ns for time, a count for calls), or
   * `null` when NEITHER vantage measured it. Never a fabricated `0`.
   */
  value: number | null;
  /** Which vantage the value came from; `null` when there is no value. */
  source: DbmOverlapSource | null;
  /**
   * i18n key suffix under `dbm.detail.overlap.*` for the qualifier that must
   * render near the tile. `null` only when there is no value to qualify.
   *
   * - `serverExecution` / `serverWait` — the engine's own figure, saying WHICH
   *   measurement it is. The wait variant is what stops a MySQL reader taking a
   *   queueing figure for execution work.
   * - `clientObserved` — the server had none and this is the traced-caller
   *   number, which covers instrumented traffic only.
   */
  qualifierKey: string | null;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Total time in the database, resolved. Server seconds → ns here, once, so no
 * component downstream does unit arithmetic on a wire value.
 */
export const resolveDatabaseTime = (inputs: DbmOverlapInputs): DbmOverlapMetric => {
  const server = num(inputs.serverExecTimeS);
  if (server !== null) {
    return {
      value: server * NS_PER_SECOND,
      source: "server",
      // The qualifier is chosen by what the engine MEASURED, never by which
      // engine it is: a future engine reporting execution time gets the
      // execution qualifier because the backend says `execution`.
      qualifierKey: inputs.execTimeKind === "wait" ? "serverWait" : "serverExecution",
    };
  }

  const client = num(inputs.clientTotalTimeNs);
  if (client !== null) {
    return { value: client, source: "client", qualifierKey: "clientObserved" };
  }

  // Neither vantage measured it. Absent stays absent — a `0` here would read as
  // "this query used no database time", an all-clear nobody observed.
  return { value: null, source: null, qualifierKey: null };
};

/** The call count, resolved under the same precedence. */
export const resolveCalls = (inputs: DbmOverlapInputs): DbmOverlapMetric => {
  const server = num(inputs.serverCalls);
  if (server !== null) {
    // A count is a count on every engine, so it takes the plain engine
    // attribution rather than the execution/wait distinction.
    return { value: server, source: "server", qualifierKey: "serverCounted" };
  }

  const client = num(inputs.clientCalls);
  if (client !== null) {
    return { value: client, source: "client", qualifierKey: "clientObserved" };
  }

  return { value: null, source: null, qualifierKey: null };
};
