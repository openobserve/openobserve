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
 * The Plans section's logic, kept out of the SFC so it can be tested.
 *
 * What this data IS, because every label on the page depends on getting it
 * right — and since W-E3 it is PER ROW, keyed on `plan_source`:
 *
 * `generic_null_bound`: the collector EXPLAINs the statement under
 * `force_generic_plan` with every bind parameter bound to literal NULL — a
 * GENERIC, NULL-BOUND, ESTIMATED plan for a query nobody executed.
 *
 *   • It is not "the plan that ran". Postgres defaults to
 *     `plan_cache_mode = auto`, so production may well have executed a custom
 *     plan the receiver deliberately overrode.
 *   • A hash CHANGE is a real signal — a dropped index or a repartition moves it.
 *   • A STABLE hash is NOT an all-clear. Generic plans are a pure function of
 *     (statement, schema, stats) and stable by construction, so the classic
 *     "planner flipped to a seq scan at 03:04" happens in the custom plan and
 *     may never move this hash. The signal is false-negative-prone and is
 *     presented as such.
 *
 * `auto_explain`: the plan Postgres ACTUALLY EXECUTED, captured by the
 * optional auto_explain step — real binds, and (under log_analyze) real row
 * counts and a real per-execution duration. For THESE rows a duration is
 * honest: each execution measured its own wall clock under this exact plan.
 * Two limits stand: the capture is threshold-filtered and possibly sampled,
 * so any aggregate is "across N captured executions", never "average
 * latency"; and a generic row still never shows a latency — the duration
 * fields exist only on hits that carry one (absent, not null, on the wire).
 */

/** One node of an EXPLAIN tree, flattened for indented rendering. */
export interface PlanNodeRow {
  /** Nesting level; the renderer indents by this and nothing else. */
  depth: number;
  nodeType: string;
  relation: string | null;
  index: string | null;
  /** Shown as context only — never used to order or colour anything. */
  totalCost: number | null;
  /** The planner's row ESTIMATE for this node (`Plan Rows`). */
  planRows: number | null;
  /**
   * Rows this node ACTUALLY returned (`Actual Rows`) — present only on
   * executed plans captured with `log_analyze = on`. Estimate-vs-actual skew
   * is the single highest-value signal an executed plan adds: it is the root
   * cause of most plan-choice pathologies and the generic plan cannot express
   * it at all. Null means "not measured", never 0.
   */
  actualRows: number | null;
}

/** The two plan producers. Anything else (or absent) reads as generic. */
export type PlanSource = "generic_null_bound" | "auto_explain";

/** One distinct plan, as the API returns it. */
export interface QueryPlan {
  plan_hash: string;
  /** The parsed EXPLAIN document, or null when the stored text was malformed. */
  plan: unknown;
  plan_hash_version: number | null;
  first_seen: number;
  last_seen: number;
  /**
   * `SUM(o2_dbm_calls)` over the window. A DELTA feed whose FIRST emission per
   * statement carries the entire `pg_stat_statements` backlog, so this is not
   * a window call count and no SHARE may be derived from it — see `PlanRow`.
   */
  calls: number;
  /**
   * Per-hit provenance (E-C). Absent on responses from servers predating
   * W-E3 — those can only ever have served generic plans, so absent reads as
   * `generic_null_bound`, the WEAKER claim.
   */
  plan_source?: PlanSource;
  /**
   * Executed-only aggregates, present IF AND ONLY IF this hit is an
   * auto_explain plan whose executions measured a duration. The API sends
   * these ABSENT (never null) on generic hits, so a latency can never be
   * rendered beside a plan that never ran.
   */
  avg_duration_ms?: number;
  max_duration_ms?: number;
  executions?: number;
}

export interface QueryPlansResponse {
  hits: QueryPlan[];
  /**
   * DERIVED summary of the hits — `generic_null_bound` when every hit is the
   * receiver's never-executed estimate, `auto_explain` when every hit is a
   * real executed plan, `mixed` when the window holds both. (It was a
   * hardcoded `generic_null_bound` before W-E3; the per-hit `plan_source` is
   * authoritative now.)
   */
  plan_source: string;
  drift_detected: boolean;
  total: number;
  /**
   * Whether plan capture has ever run against this stream.
   *
   * `off` = the stream carries no plan hash column, so nothing ever looked.
   * `on` = capture ran and this statement has no plan, which is normal.
   * Optional because a server predating the field sends nothing at all.
   *
   * READ IT AS PAST TENSE. The backend derives it from the stream SCHEMA —
   * whether `o2_dbm_plan_hash` is present — so it says capture ran at some
   * point in this stream's history, NOT that it is running now. (With DBM
   * enabled the server always accepts plan records — the per-signal ingest
   * knobs are gone — so "on but silent now" can only mean the COLLECTOR
   * stopped shipping the feed, which `noPlanForQuery`'s copy allows for.)
   */
  plan_capture?: "on" | "off";
}

/**
 * One row of the Plans section.
 *
 * The latency rule is CONDITIONAL now, not absent (W-E3): `avgDurationMs` /
 * `maxDurationMs` / `executions` exist exactly when the hit is an executed
 * auto_explain plan that measured them — each captured execution timed its
 * own wall clock under this exact plan, so the aggregate is honest, labelled
 * "across N captured executions" (threshold-filtered and possibly sampled,
 * so never "average latency"). Generic rows still carry NO latency field at
 * all: the plan never ran, and rendering "—" in a latency column would imply
 * the column applies.
 *
 * And no call SHARE (W2). The share was `calls / SUM(calls)` over a DELTA feed
 * in which the receiver's first emission per statement carries the whole
 * `pg_stat_statements` backlog — 19,687 calls against ~2 for every emission
 * after it. One such row in the window inflates the denominator by an entire
 * backlog, so the percentage described a total that never described the window.
 * No arithmetic recovers a true count from this feed, so the field is gone
 * rather than approximated.
 */
export interface PlanRow {
  rowKey: string;
  planHash: string;
  planHashVersion: number | null;
  /** Normalized provenance: absent on the wire reads as generic. */
  planSource: PlanSource;
  firstSeen: number;
  lastSeen: number;
  calls: number;
  nodes: PlanNodeRow[];
  avgDurationMs?: number;
  maxDurationMs?: number;
  executions?: number;
}

/** `none` = nothing captured; `stable` = one shape; `drifted` = more than one. */
export type PlanDriftLevel = "none" | "stable" | "drifted";

function readString(node: Record<string, unknown>, key: string): string | null {
  const v = node[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * MySQL/MariaDB `EXPLAIN FORMAT=JSON` — a `query_block` OBJECT, not Postgres's
 * array of `{Plan}`.
 *
 * The two engines share nothing structurally: MySQL nests under `table`,
 * `nested_loop`, `ordering_operation` and friends, names the operation
 * `access_type` (`ALL` = full scan) rather than `Node Type`, and quotes its
 * costs as STRINGS. Parsed here rather than in the tree walker so neither
 * engine's vocabulary leaks into the other's.
 *
 * Without this a MySQL fleet saw "the plan could not be read" over a plan that
 * had been captured and stored perfectly — the reader is denied the single
 * most actionable fact on the page (`ALL` over 345k rows is the missing index),
 * and the section blames a read that never failed.
 */
function flattenMysqlPlan(queryBlock: unknown): PlanNodeRow[] {
  const out: PlanNodeRow[] = [];
  const seen = new WeakSet<object>();

  // MySQL quotes cost as a string ("34811.85"); Postgres sends a number. Both
  // reach the same numeric column, and anything else stays absent.
  const numeric = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      // `nested_loop` and the union/materialisation lists are arrays of
      // sibling operations — same depth, in planner order.
      for (const child of node) walk(child, depth);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    const record = node as Record<string, unknown>;
    // A `table` object IS the operation in MySQL's grammar. Everything else
    // (`query_block`, `nested_loop`, `ordering_operation`, …) is structure to
    // descend through, so it adds no row but still costs an indent step.
    const table = record.table;
    let nextDepth = depth;
    if (table && typeof table === "object" && !Array.isArray(table)) {
      const t = table as Record<string, unknown>;
      const accessType = readString(t, "access_type");
      out.push({
        depth,
        // `access_type` is the operation — `ALL` is a full table scan, `ref`
        // an index lookup. Prefixed so it cannot be misread as a Postgres
        // node type, which is a different vocabulary entirely.
        nodeType: accessType ? `${accessType} scan` : "table",
        relation: readString(t, "table_name"),
        // MySQL names the chosen index `key`; `possible_keys` are candidates
        // it did NOT choose and must never be shown as the one it used.
        index: readString(t, "key"),
        totalCost: numeric((t.cost_info as Record<string, unknown> | undefined)?.prefix_cost),
        planRows: numeric(t.rows_examined_per_scan),
        // MySQL's EXPLAIN is an estimate: no executed-row count exists, and a
        // number here would claim a measurement nobody made. (`EXPLAIN
        // ANALYZE` is a different document this branch never sees.)
        actualRows: null,
      });
      nextDepth = depth + 1;
      // Descend INTO the table for materialised subqueries hanging off it.
      for (const [key, value] of Object.entries(t)) {
        if (key !== "cost_info" && value && typeof value === "object") walk(value, nextDepth);
      }
    }

    for (const [key, value] of Object.entries(record)) {
      // `cost_info` and `table` are handled above; the rest is structure.
      if (key === "cost_info" || key === "table") continue;
      if (value && typeof value === "object") walk(value, nextDepth);
    }
  };

  walk(queryBlock, 0);
  return out;
}

/**
 * Flatten an EXPLAIN document into indented rows, depth-first.
 *
 * Depth-first with children emitted immediately after their parent is what
 * makes an indented list readable as a tree: a sibling and a child are one
 * indent step apart and in the order the planner nests them.
 *
 * Handles BOTH engines' documents — Postgres's array of `{Plan}` and MySQL's
 * `{query_block}` object — because one section renders whichever the fleet
 * runs, and an unrecognised shape is indistinguishable to the reader from a
 * failed read.
 *
 * Returns `[]` for anything unparseable rather than throwing — a plan is
 * supplementary detail beside a query, and a bad one must never take down a
 * page that would otherwise work.
 */
export function flattenPlanTree(plan: unknown): PlanNodeRow[] {
  // MySQL/MariaDB: a single `query_block` object.
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    const block = (plan as Record<string, unknown>).query_block;
    return block ? flattenMysqlPlan(block) : [];
  }
  if (!Array.isArray(plan)) return [];
  const out: PlanNodeRow[] = [];
  // A cycle cannot arrive over the wire (the API parses server JSON), but a
  // caller can construct one, and an unbounded walk freezes the tab rather than
  // failing visibly.
  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    const record = node as Record<string, unknown>;
    const nodeType = readString(record, "Node Type");
    // A node with no type is not a plan node — a wrapper object, or a document
    // that is not an EXPLAIN at all. Skip it but still descend, since the real
    // nodes may sit underneath.
    if (nodeType) {
      const cost = record["Total Cost"];
      const est = record["Plan Rows"];
      // Executed plans (log_analyze) carry per-node actuals; the hash ignores
      // them, the renderer shows est → act. Absent means "not measured".
      const act = record["Actual Rows"];
      out.push({
        depth,
        nodeType,
        relation: readString(record, "Relation Name"),
        index: readString(record, "Index Name"),
        totalCost: typeof cost === "number" ? cost : null,
        planRows: typeof est === "number" ? est : null,
        actualRows: typeof act === "number" ? act : null,
      });
    }

    const children = record.Plans;
    if (Array.isArray(children)) {
      for (const child of children) walk(child, nodeType ? depth + 1 : depth);
    }
  };

  for (const entry of plan) {
    if (entry && typeof entry === "object") {
      walk((entry as Record<string, unknown>).Plan, 0);
    }
  }
  return out;
}

/** Normalize a hit's provenance: absent or unknown reads as generic (E-C). */
function planSourceOf(hit: QueryPlan): PlanSource {
  return hit.plan_source === "auto_explain" ? "auto_explain" : "generic_null_bound";
}

/**
 * The plans to render: EXECUTED first, then most recently seen.
 *
 * Executed-first because an auto_explain row is strictly more informative —
 * it is the plan that really ran, with real binds — and within each producer
 * recency-first still answers "what is it doing now, and did that change".
 */
export function planRows(res: QueryPlansResponse): PlanRow[] {
  return [...(res.hits ?? [])]
    .sort((a, b) => {
      const aExec = planSourceOf(a) === "auto_explain" ? 1 : 0;
      const bExec = planSourceOf(b) === "auto_explain" ? 1 : 0;
      if (aExec !== bExec) return bExec - aExec;
      return b.last_seen - a.last_seen;
    })
    .map((hit) => {
      const planSource = planSourceOf(hit);
      const row: PlanRow = {
        // Two producers can — by design — yield the SAME structural hash; the
        // key must keep them two rows.
        rowKey: `${hit.plan_hash}-${planSource}`,
        planHash: hit.plan_hash,
        planHashVersion: hit.plan_hash_version,
        planSource,
        firstSeen: hit.first_seen,
        lastSeen: hit.last_seen,
        calls: hit.calls,
        nodes: flattenPlanTree(hit.plan),
      };
      // The conditional-latency invariant, enforced here as well as at the
      // API: a duration reaches a row only on an executed hit that carries
      // one. Whatever a (buggy or hostile) response says about a generic hit,
      // the row stays latency-free.
      if (planSource === "auto_explain" && typeof hit.avg_duration_ms === "number") {
        row.avgDurationMs = hit.avg_duration_ms;
        if (typeof hit.max_duration_ms === "number") row.maxDurationMs = hit.max_duration_ms;
        if (typeof hit.executions === "number") row.executions = hit.executions;
      }
      return row;
    });
}

/**
 * How many distinct plan shapes the window holds.
 *
 * Derived from the row count rather than the response's `drift_detected` flag:
 * the rows are what the user sees, and a callout that disagrees with the list
 * beneath it is worse than no callout.
 *
 * `none` is deliberately distinct from `stable`. "No plans captured" means
 * nothing looked — the feature defaults off — while "one plan" means something
 * looked and saw one shape. Collapsing them would tell a user their plan is
 * stable when the capture is simply switched off.
 */
export function planDriftLevel(res: QueryPlansResponse): PlanDriftLevel {
  const count = res.hits?.length ?? 0;
  if (count === 0) return "none";
  return count > 1 ? "drifted" : "stable";
}

/**
 * Why the Plans section is empty, or `null` when it is not.
 *
 * `none` tells the renderer there is nothing to draw; it cannot tell it WHY,
 * and the whys need different sentences. `captureOff` is a setup gap the
 * reader can close: the stream has never carried a plan, so no collector ever
 * shipped the feed. `noPlanForQuery` is not a problem at all — plans exist on
 * the stream, this statement just has none. Postgres cannot EXPLAIN a
 * `COMMIT`, `ROLLBACK` or `SHOW`, so those fingerprints legitimately have no
 * plan while capture runs perfectly.
 *
 * Two further states existed while plan ingest sat behind per-signal server
 * knobs (`noExecutionCaptured`, `captureKnobOff` — both branched on flags the
 * server no longer has). With DBM enabled the server always accepts both
 * producers' records, so the schema-presence heuristic above is the whole
 * distinction that remains.
 */
export function planEmptyReason(res: QueryPlansResponse): "captureOff" | "noPlanForQuery" | null {
  if ((res.hits?.length ?? 0) > 0) return null;
  if (res.plan_capture !== "on") return "captureOff";
  return "noPlanForQuery";
}

/**
 * The left-padding utility for a plan node at `depth`.
 *
 * A Tailwind step (rem-based) rather than an arbitrary value: `pl-[24px]` is
 * banned by the house rule and would not scale with the text it indents.
 *
 * Capped because real captured plans reach 19 levels — uncapped, the deepest
 * nodes are exactly the scans a reader came for, and they would be indented off
 * the right edge of the panel.
 */
export function planIndentClass(depth: number): string {
  const MAX_INDENT_STEPS = 10;
  const step = Math.min(Math.max(depth, 0), MAX_INDENT_STEPS);
  return `pl-${step * 2}`;
}
