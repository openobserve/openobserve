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
 * The JOIN that lets a LIST row quote its database's own counters.
 *
 * `overlapMetrics.ts` decides which vantage wins once the two figures are in
 * hand; this decides WHICH server row is the same statement as a client row.
 * Getting that wrong is worse than showing no server figure at all, because a
 * mismatched join prints one statement's counters under another's text.
 *
 * **The key is composite: (fingerprint, engine, database).** A fingerprint
 * hashes statement TEXT ONLY, so `SELECT 1` under Postgres and under MySQL
 * share one fingerprint — nine of them do on the live fleet. Joining on
 * fingerprint alone fuses the two engines and reports MySQL wait time under a
 * Postgres row.
 *
 * **`database` is dropped for mysql/mariadb.** Their `top_query` records carry
 * no database at all, while the trace vantage does report one — so a strict
 * three-part key matches NOTHING on a MySQL fleet, which is the majority of
 * the live rows. This is the same asymmetry the backend already encodes by
 * demanding `database` only for the engines that scope their counters by it.
 *
 * Postgres keeps the database, and a Postgres row that does not name one is
 * refused rather than guessed: those counters are per-database, so picking any
 * one of them would quote a fraction as the whole.
 */

/** Engines whose server-side counters are INSTANCE-wide, so they carry no database. */
const INSTANCE_SCOPED_ENGINES = new Set(["mysql", "mariadb"]);

/** The fields the join reads off either vantage's row. */
export interface DbmOverlapJoinable {
  fingerprint?: string | null;
  db_system?: string | null;
  /** The database/schema, under the rollup endpoints' spelling. */
  db_namespace?: string | null;
}

/** A server-vantage row, as `/server_queries` and the fallback section emit it. */
export interface DbmServerCounters extends DbmOverlapJoinable {
  calls?: number | null;
  exec_time_s?: number | null;
  exec_time_kind?: "execution" | "wait" | null;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * The composite key, or `null` when this row cannot be joined at all.
 *
 * `null` is returned rather than a partial key so a caller can never
 * accidentally match two unjoinable rows to each other by their shared
 * emptiness — see the Postgres-without-database case above.
 */
export const overlapJoinKey = (
  fingerprint: string | null | undefined,
  engine: string | null | undefined,
  database: string | null | undefined,
): string | null => {
  const fp = norm(fingerprint);
  const eng = norm(engine);
  // Without an engine the key would fuse whichever engines share this
  // statement's text — the exact fusion this key exists to prevent.
  if (!fp || !eng) return null;

  if (INSTANCE_SCOPED_ENGINES.has(eng)) return `${fp}\0${eng}`;

  const db = norm(database);
  // Per-database counters with no database named: unjoinable, not "the empty
  // database". Quoting one database's total for a statement that runs in
  // several is a wrong number, and a wrong number beats no number to nobody.
  if (!db) return null;
  return `${fp}\0${eng}\0${db}`;
};

const keyOf = (row: DbmOverlapJoinable): string | null =>
  overlapJoinKey(row.fingerprint, row.db_system, row.db_namespace);

/**
 * Index the server rows once per load, so the per-row lookup below is O(1)
 * rather than a scan of 200 rows for each of 50 client rows.
 *
 * Duplicate keys keep the FIRST row. The server list is already grouped by the
 * join key upstream, so a duplicate means the grouping changed shape; silently
 * summing them here would invent a total the database never reported.
 */
export const indexServerRows = (
  rows: readonly DbmServerCounters[] | null | undefined,
): Map<string, DbmServerCounters> => {
  const index = new Map<string, DbmServerCounters>();
  for (const row of rows ?? []) {
    const key = keyOf(row);
    if (key !== null && !index.has(key)) index.set(key, row);
  }
  return index;
};

/** This client row's counterpart in the database's own counters, or `null`. */
export const serverCounterpart = (
  index: Map<string, DbmServerCounters>,
  row: DbmOverlapJoinable,
): DbmServerCounters | null => {
  const key = keyOf(row);
  return key === null ? null : (index.get(key) ?? null);
};
