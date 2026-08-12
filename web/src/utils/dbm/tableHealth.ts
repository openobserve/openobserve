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
 * The Table health page's logic, kept out of the SFC so it can be tested.
 *
 * What this data IS, because every label on the page depends on getting it
 * right. The collector runs one query a minute against `pg_class` joined to
 * `pg_stat_user_tables`, so each row is a SNAPSHOT of one relation. Three
 * consequences the rendering must respect, and which the API states explicitly
 * on its response envelope so this module never has to assume them:
 *
 *   • The scan and vacuum counters (`seq_scan_count`, `idx_scan_count`,
 *     `autovacuum_count`, `seq_tup_read`) are CUMULATIVE SINCE THE LAST
 *     `pg_stat_reset()` — a point in time the feed never observes. They are
 *     therefore NOT counts for the page's selected time range, and labelling
 *     them with it would be a strictly stronger claim than the data supports.
 *     `scanCountDisclosure` is how the page says so.
 *
 *   • The tuple counts and the bloat percentage derived from them are PLANNER
 *     ESTIMATES, maintained incrementally and reconciled at ANALYZE — not a
 *     `COUNT(*)`. They can be arbitrarily stale on a table that has not been
 *     analyzed, which `mod_since_analyze` on the same row quantifies. Sizes
 *     are exact by contrast, which is why the disclosure is about TUPLES
 *     rather than the whole row.
 *
 *   • The feed is POSTGRES-ONLY. MySQL, MariaDB and SQL Server expose schema
 *     statistics through catalogs no shipped recipe reads, so a user on those
 *     engines has no data — and an unexplained empty table reads as "no
 *     problems found" about a check that never ran. `tableHealthEmptyCause`
 *     exists to keep those two states apart.
 *
 * Nothing here ranks, scores or recommends. Deciding that a table NEEDS a
 * vacuum, or that an index is unused, is W11 and depends on this module rather
 * than living in it.
 */

import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { useI18nTyped, I18nText } from "@/types/i18n";
import { formatCount } from "@/utils/dbm/format";

type Translate = ReturnType<typeof useI18nTyped>["t"];

/** One relation's health, as the API returns it. */
export interface TableHealthRow {
  relation: string | null;
  /** The SCHEMA, not a database — this feed never names one. */
  schema: string | null;
  instance: string | null;
  engine: string | null;
  /** `pg_total_relation_size` — heap + indexes + TOAST. Exact. */
  total_bytes: number | null;
  /** `pg_relation_size` — the heap alone. Exact. */
  heap_bytes: number | null;
  /** ESTIMATE. See the module header. */
  live_tuples: number | null;
  /** ESTIMATE. */
  dead_tuples: number | null;
  /** ESTIMATE, derived from the two above. */
  dead_tup_pct: number | null;
  mod_since_analyze: number | null;
  /** LIFETIME total since the last statistics reset. */
  seq_scan_count: number | null;
  /** LIFETIME total. */
  seq_tup_read: number | null;
  /** LIFETIME total. Zero on a live table is the unused-index signal (W11). */
  idx_scan_count: number | null;
  /** LIFETIME total. */
  autovacuum_count: number | null;
  frozen_xid_age: number | null;
  /** `null` means NEVER, not unknown. */
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
  last_seen: number | null;
}

/** Whether this signal is collected for the engine the user filtered to. */
export type TableHealthCoverage = "supported" | "unsupported" | "unknown";

export interface TableHealthResponse {
  hits: TableHealthRow[];
  stream: string;
  total: number;
  /** The API's own statement that the counters are lifetime totals. */
  counters_are_cumulative: boolean;
  /** The API's own statement that the tuple counts are estimates. */
  tuples_are_estimated: boolean;
  engine_coverage: TableHealthCoverage;
}

/** A row prepared for the table, with the derived fields the template needs. */
export interface TableHealthDisplayRow extends TableHealthRow {
  /** `schema.relation` — a bare table name is ambiguous across schemas. */
  qualifiedName: string;
  /**
   * Stable identity for the table's `row-key`. Includes the INSTANCE because
   * the same `public.users` on two servers is two different tables, and a key
   * that collided would silently drop one of them from the rendered list.
   */
  rowKey: string;
  /**
   * `total - heap`: the space indexes and TOAST occupy. Computed here rather
   * than in the template so the arithmetic is testable, and `null` when either
   * input is missing — subtracting from a missing size would report an
   * overhead figure that was never measured.
   */
  overheadBytes: number | null;
}

/** Human-readable byte sizes, in the binary units Postgres itself reports. */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Prepare API rows for rendering.
 *
 * Order is preserved: the API already sorts by size descending, and re-sorting
 * here would silently disagree with the `LIMIT` the server applied — the top N
 * by one ordering is not the top N by another.
 */
export const tableHealthRows = (hits: TableHealthRow[]): TableHealthDisplayRow[] =>
  hits.map((hit) => {
    const schema = hit.schema ?? "";
    const relation = hit.relation ?? "";
    const qualifiedName = schema ? `${schema}.${relation}` : relation;
    return {
      ...hit,
      qualifiedName,
      rowKey: `${hit.instance ?? ""}/${qualifiedName}`,
      overheadBytes:
        hit.total_bytes != null && hit.heap_bytes != null ? hit.total_bytes - hit.heap_bytes : null,
    };
  });

/**
 * Render a byte count.
 *
 * `0` and `null` render differently on purpose: an empty table is a real,
 * reportable state, while a missing measurement is not something to state a
 * size for.
 */
export const tableSizeLabel = (bytes: number | null | undefined): string => {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
};

/**
 * Render a vacuum/analyze timestamp.
 *
 * `null` is NEVER, and says so. The recipe COALESCEs a null vacuum time to the
 * empty string and canonicalization drops it, so absence here is a measured
 * fact about the table — a table nobody has ever vacuumed. A blank cell would
 * read as "we do not know", which is the opposite claim and hides the finding.
 */
export const vacuumLabel = (value: string | null | undefined, t: Translate): string =>
  value ?? (t("dbm.tableHealth.never") as unknown as string);

/**
 * The lifetime-counter disclosure, or `null` when the API did not make the
 * claim.
 *
 * Gated on the API's own flag rather than hardcoded: a build whose response
 * omits it has not told us the counters are cumulative, and asserting it
 * anyway would be inventing a disclosure — as dishonest in the other direction
 * as omitting a true one.
 */
export const scanCountDisclosure = (
  response: Pick<TableHealthResponse, "counters_are_cumulative">,
  t: Translate,
): I18nText | null =>
  response.counters_are_cumulative ? t("dbm.tableHealth.countersCumulative") : null;

/** The estimate disclosure, on the same terms as `scanCountDisclosure`. */
export const tupleCountDisclosure = (
  response: Pick<TableHealthResponse, "tuples_are_estimated">,
  t: Translate,
): I18nText | null => (response.tuples_are_estimated ? t("dbm.tableHealth.tuplesEstimated") : null);

/**
 * Why the table is empty — the two causes a reader must be able to tell apart.
 *
 * `engine-unsupported` wins when both apply. For a MySQL user both statements
 * are true, but telling them to switch on a Postgres-only recipe sends them to
 * fix a non-problem; telling them the signal does not exist for their engine
 * is the actionable half.
 */
export type TableHealthEmptyCause = "engine-unsupported" | "not-collecting";

export const tableHealthEmptyCause = (
  response: Pick<TableHealthResponse, "engine_coverage" | "hits">,
): TableHealthEmptyCause | null => {
  if (response.hits.length > 0) return null;
  if (response.engine_coverage === "unsupported") return "engine-unsupported";
  // `unknown` (no engine filter) falls here deliberately: the request spanned
  // every engine, so "your engine has no recipe" is not a statement we can
  // make, while "nothing has reported" is exactly what happened.
  return "not-collecting";
};

/**
 * Which columns carry a magnitude bar, and against what.
 *
 * A bar is a CLAIM THAT THE NUMBER IS A PROPORTION of something. That claim is
 * true for only two kinds of column here, and applying it to the rest would
 * turn a neutral counter into an implied severity:
 *
 *  • `"max"` — the size columns. A table's bytes against the largest table's
 *    bytes is a real share of a real total, and "which table is eating the
 *    disk" is the question that opens this page. Both ends of the comparison
 *    are exact measurements (`pg_total_relation_size`), not estimates.
 *
 *  • `"percent"` — `dead_tup_pct`, which is ALREADY a 0-100 proportion, so its
 *    100% reference is the literal number 100. Scaling it to the worst row
 *    instead would paint a 3%-bloated table as a full bar merely for being the
 *    worst in a healthy list — the most misleading thing this column could do.
 *
 * Everything else is deliberately bare:
 *
 *  • The scan and vacuum counters (`seq_scan_count`, `seq_tup_read`,
 *    `idx_scan_count`, `autovacuum_count`) are LIFETIME totals since an
 *    unobserved `pg_stat_reset()`. They have no ceiling, so a full bar would
 *    mean "the most of any table since a point in time we never saw" — a
 *    severity reading the number does not support. An old table that was never
 *    reset would dominate the column and make every other row look idle.
 *  • `live_tuples`/`dead_tuples`/`mod_since_analyze` are planner ESTIMATES, and
 *    `frozen_xid_age` is a transaction-id distance, not a quantity of anything.
 *    Barring an estimate against another estimate compounds both.
 *
 * The bar never replaces the number: `meta.format` stays on every column, and
 * the cell renders the formatted value with the bar beneath it.
 */
export type TableHealthBarScale = "max" | "percent";

export const tableHealthColumns = (t: Translate): OTableColumnDef<TableHealthDisplayRow>[] => [
  {
    id: "qualifiedName",
    header: t("dbm.tableHealth.columns.relation"),
    accessorKey: "qualifiedName",
    sortable: true,
    resizable: true,
    size: 260,
    minSize: 180,
    meta: { align: "left", flex: true },
  },
  {
    id: "instance",
    header: t("dbm.tableHealth.columns.instance"),
    accessorKey: "instance",
    sortable: true,
    resizable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "total_bytes",
    header: t("dbm.tableHealth.columns.totalBytes"),
    accessorKey: "total_bytes",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right", bar: "max", format: (value: number | null) => tableSizeLabel(value) },
  },
  {
    id: "heap_bytes",
    header: t("dbm.tableHealth.columns.heapBytes"),
    accessorKey: "heap_bytes",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right", bar: "max", format: (value: number | null) => tableSizeLabel(value) },
  },
  {
    id: "overheadBytes",
    header: t("dbm.tableHealth.columns.overheadBytes"),
    accessorKey: "overheadBytes",
    sortable: true,
    resizable: true,
    size: 120,
    meta: { align: "right", bar: "max", format: (value: number | null) => tableSizeLabel(value) },
  },
  {
    id: "live_tuples",
    header: t("dbm.tableHealth.columns.liveTuples"),
    accessorKey: "live_tuples",
    sortable: true,
    resizable: true,
    size: 110,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "dead_tuples",
    header: t("dbm.tableHealth.columns.deadTuples"),
    accessorKey: "dead_tuples",
    sortable: true,
    resizable: true,
    size: 110,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "dead_tup_pct",
    header: t("dbm.tableHealth.columns.deadTupPct"),
    accessorKey: "dead_tup_pct",
    sortable: true,
    resizable: true,
    size: 120,
    meta: {
      align: "right",
      bar: "percent",
      format: (value: number | null) => (value == null ? "—" : `${value.toFixed(2)}%`),
    },
  },
  {
    id: "mod_since_analyze",
    header: t("dbm.tableHealth.columns.modSinceAnalyze"),
    accessorKey: "mod_since_analyze",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "seq_scan_count",
    header: t("dbm.tableHealth.columns.seqScanCount"),
    accessorKey: "seq_scan_count",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "seq_tup_read",
    header: t("dbm.tableHealth.columns.seqTupRead"),
    accessorKey: "seq_tup_read",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "idx_scan_count",
    header: t("dbm.tableHealth.columns.idxScanCount"),
    accessorKey: "idx_scan_count",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "autovacuum_count",
    header: t("dbm.tableHealth.columns.autovacuumCount"),
    accessorKey: "autovacuum_count",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "frozen_xid_age",
    header: t("dbm.tableHealth.columns.frozenXidAge"),
    accessorKey: "frozen_xid_age",
    sortable: true,
    resizable: true,
    size: 130,
    meta: { align: "right", format: (value: number | null) => formatCount(value) },
  },
  {
    id: "last_autovacuum",
    header: t("dbm.tableHealth.columns.lastAutovacuum"),
    accessorKey: "last_autovacuum",
    sortable: true,
    resizable: true,
    size: 170,
    meta: { align: "left", format: (value: string | null) => vacuumLabel(value, t) },
  },
  {
    id: "last_vacuum",
    header: t("dbm.tableHealth.columns.lastVacuum"),
    accessorKey: "last_vacuum",
    sortable: true,
    resizable: true,
    size: 170,
    meta: { align: "left", format: (value: string | null) => vacuumLabel(value, t) },
  },
  {
    id: "last_analyze",
    header: t("dbm.tableHealth.columns.lastAnalyze"),
    accessorKey: "last_analyze",
    sortable: true,
    resizable: true,
    size: 170,
    meta: { align: "left", format: (value: string | null) => vacuumLabel(value, t) },
  },
];
