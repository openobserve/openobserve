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
 * Turns one database's breakdown into CHILD ROWS of the Databases table.
 *
 * The split used to be drawn as its own mini-table inside an expansion panel,
 * with its own headers at its own widths. Two tables on one screen means the
 * same figure — this database's time — appears at two different x-positions, so
 * the split could not be compared by eye against the total it came out of. Here
 * the children are real rows in the parent's columns, so alignment is a
 * property of the table rather than something kept in sync by hand.
 *
 * Two things the shape has to say honestly:
 *
 *  • A column a child has no value for is `null`, never `0` — a zero in a
 *    latency column reads as "instant", which is a lie. The cells render the
 *    muted em-dash the app already uses. That applies only where a value
 *    genuinely does not exist (the placeholder row, and `Used by` on a service
 *    row, which IS the caller): p50/p95/p99 all come through — see
 *    breakdown.ts, every `query_stats` row carries all three.
 *
 *  • The schema tier disappears when no row named a schema. That is
 *    `buildDatabaseBreakdown`'s `collapsed`, honoured as-is: a lone "—" schema
 *    row would be a nesting level whose only content is a missing fact.
 */

import type { DbmBreakdown, DbmBreakdownNode } from "@/utils/dbm/breakdown";
import { errorRate } from "@/utils/dbm/format";

/**
 * Which tier of the split a child row came from.
 *
 * `status` is the odd one out: a single placeholder child standing in for the
 * split while it is being fetched, or in place of it when the fetch failed or
 * attributed nothing. It exists because the table can only draw an expand
 * chevron on a row that ALREADY has children, so a database with none would
 * never offer the affordance that triggers the fetch. Giving every database one
 * placeholder breaks that deadlock and puts the load state where the reader is
 * already looking — inside the row they just opened.
 */
export type DbmChildKind = "schema" | "service" | "status";

/** What a `status` child is standing in for. */
export type DbmChildStatus = "loading" | "error" | "empty";

/**
 * A child row, in the parent table's column vocabulary.
 *
 * Field names mirror `DatabaseRow` where the column reads the row directly
 * (`calls`, `errorRate`), so one column definition serves both tiers.
 */
export interface DbmBreakdownRow {
  /** Table identity — unique across the whole tree, so expansion state is stable. */
  rowKey: string;
  kind: DbmChildKind;
  /** Schema or service name; `null` when the rows named none. */
  name: string | null;
  /** The schema this row sits under — its own for a schema row, its parent's for
   *  a service row, `null` when the tier collapsed. Carried so a click can scope
   *  Top queries to both dimensions at once. */
  namespace: string | null;
  /** The service, on a service row only — `null` on a schema row. */
  service: string | null;
  calls: number;
  errors: number;
  /** `null` when the node made no calls: a rate over zero traffic is undefined. */
  errorRate: number | null;
  total_time_ns: number;
  /** Share of the parent level's time, `0`–`1`. */
  share: number;
  /**
   * The WORST p50/p95/p99 among this node's rows — never a pooled percentile,
   * and `null` only when no row reported one (see breakdown.ts: every
   * `query_stats` row carries all three).
   */
  p50_ns: number | null;
  p95_ns: number | null;
  p99_ns: number | null;
  /** How many fingerprint rows rolled up here. */
  queryCount: number;
  /** Set on a `status` row only — which state it is standing in for. */
  status: DbmChildStatus | null;
  children: DbmBreakdownRow[];
}

const serviceRow = (
  node: DbmBreakdownNode,
  namespace: string | null,
  parentKey: string,
): DbmBreakdownRow => ({
  rowKey: `${parentKey}/${node.key}`,
  kind: "service",
  name: node.name,
  namespace,
  service: node.name,
  calls: node.calls,
  errors: node.errors,
  errorRate: errorRate(node.errors, node.calls),
  total_time_ns: node.totalTimeNs,
  share: node.share,
  p50_ns: node.p50Ns,
  p95_ns: node.p95Ns,
  p99_ns: node.p99Ns,
  queryCount: node.queryCount,
  status: null,
  children: [],
});

/** The placeholder child — every numeric column empty, because it has no figures. */
const statusRow = (status: DbmChildStatus, parentKey: string): DbmBreakdownRow => ({
  rowKey: `${parentKey}/status`,
  kind: "status",
  name: null,
  namespace: null,
  service: null,
  calls: 0,
  errors: 0,
  errorRate: null,
  total_time_ns: 0,
  share: 0,
  p95_ns: null,
  p50_ns: null,
  p99_ns: null,
  queryCount: 0,
  status,
  children: [],
});

/** What a database's split is doing, as the page knows it. */
export interface DbmBreakdownState {
  breakdown: DbmBreakdown;
  loading: boolean;
  failed: boolean;
}

/**
 * The child rows for one database.
 *
 * `parentKey` is the database row's own key, prefixed onto every descendant so
 * two databases that both talk to `cart` do not collide in expansion state.
 *
 * Never returns an empty array: a database with no children would lose its
 * expand chevron, and with it the only way to ask for the split.
 */
export const toBreakdownRows = (
  state: DbmBreakdownState | undefined,
  parentKey: string,
): DbmBreakdownRow[] => {
  if (!state || state.loading) return [statusRow("loading", parentKey)];
  if (state.failed) return [statusRow("error", parentKey)];

  const { breakdown } = state;
  if (!breakdown.levels.length) return [statusRow("empty", parentKey)];

  if (breakdown.collapsed) {
    return breakdown.levels.map((node) => serviceRow(node, null, parentKey));
  }
  return breakdown.levels.map((node) => {
    const key = `${parentKey}/${node.key}`;
    return {
      rowKey: key,
      kind: "schema" as const,
      name: node.name,
      namespace: node.name,
      service: null,
      calls: node.calls,
      errors: node.errors,
      errorRate: errorRate(node.errors, node.calls),
      total_time_ns: node.totalTimeNs,
      share: node.share,
      p50_ns: node.p50Ns,
      p95_ns: node.p95Ns,
      p99_ns: node.p99Ns,
      queryCount: node.queryCount,
      status: null,
      children: node.children.map((child) => serviceRow(child, node.name, key)),
    };
  });
};

/**
 * Whether this database's split may carry the coverage caveat.
 *
 * The caveat states the row's OWN unattributed share, and that figure is
 * measured against this database's own total — 700/1000 and 550/1000 render
 * "30%" and "45%" — so it is a disclosure that belongs beside the rows it
 * describes, not a disclaimer to hoist above the table.
 *
 * The one case where it stopped discriminating is ZERO ATTRIBUTION. With no
 * per-query rows back, every database's shortfall is exactly 1, so every open
 * row printed the same "100% less" sentence. That case is already spoken for:
 * `toBreakdownRows` gives it the `empty` placeholder, which says we have the
 * totals but no per-query rows for this range. Printing both states one fact
 * twice, and the shortfall half is the wrong half — "these add up to 100% less
 * than the total" describes rows that are not there to add up.
 *
 * Loading and failed states are silent for the same reason: their placeholder
 * child is already saying what happened.
 */
export const showsShortfall = (state: DbmBreakdownState | undefined): boolean => {
  if (!state || state.loading || state.failed) return false;
  const { breakdown } = state;
  if (breakdown.shortfall === null) return false;
  // Nothing attributed — the `empty` placeholder owns this story.
  return breakdown.levels.length > 0;
};

/**
 * A child row, distinguished from a database row by the `kind` only it carries.
 *
 * The parameter is the caller's own union so the FALSE branch narrows too — a
 * cell that has ruled out a child row can read the database row's fields
 * without a cast.
 */
export const isBreakdownRow = <T extends { kind?: DbmChildKind }>(
  row: T,
): row is T & DbmBreakdownRow =>
  row.kind === "schema" || row.kind === "service" || row.kind === "status";
