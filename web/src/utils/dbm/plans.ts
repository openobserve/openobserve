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
 * right: the collector EXPLAINs each statement under `force_generic_plan` with
 * every bind parameter bound to literal NULL, so this is a GENERIC, NULL-BOUND,
 * ESTIMATED plan for a query nobody executed. Three consequences the rendering
 * must respect:
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
 * Nothing here attributes latency to a plan. Per-plan latency would come from
 * pg_stat_statements real executions while this plan was never executed, so
 * pairing them fabricates causality.
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
}

/** One distinct plan, as the API returns it. */
export interface QueryPlan {
  plan_hash: string;
  /** The parsed EXPLAIN document, or null when the stored text was malformed. */
  plan: unknown;
  plan_hash_version: number | null;
  first_seen: number;
  last_seen: number;
  calls: number;
  call_share: number;
}

export interface QueryPlansResponse {
  hits: QueryPlan[];
  /** Always `generic_null_bound` — the API states what the plan is. */
  plan_source: string;
  drift_detected: boolean;
  total: number;
  /**
   * Whether plan capture has ever run against this stream.
   *
   * `off` = the stream carries no plan hash column, so nothing ever looked.
   * `on` = capture ran and this statement has no plan, which is normal.
   * Optional because a server predating the field sends nothing at all.
   */
  plan_capture?: "on" | "off";
}

/** One row of the Plans section. Deliberately carries NO latency field. */
export interface PlanRow {
  rowKey: string;
  planHash: string;
  planHashVersion: number | null;
  firstSeen: number;
  lastSeen: number;
  calls: number;
  sharePercent: number;
  nodes: PlanNodeRow[];
}

/** `none` = nothing captured; `stable` = one shape; `drifted` = more than one. */
export type PlanDriftLevel = "none" | "stable" | "drifted";

function readString(node: Record<string, unknown>, key: string): string | null {
  const v = node[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Flatten an EXPLAIN document into indented rows, depth-first.
 *
 * Depth-first with children emitted immediately after their parent is what
 * makes an indented list readable as a tree: a sibling and a child are one
 * indent step apart and in the order the planner nests them.
 *
 * Returns `[]` for anything unparseable rather than throwing — a plan is
 * supplementary detail beside a query, and a bad one must never take down a
 * page that would otherwise work.
 */
export function flattenPlanTree(plan: unknown): PlanNodeRow[] {
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
      out.push({
        depth,
        nodeType,
        relation: readString(record, "Relation Name"),
        index: readString(record, "Index Name"),
        totalCost: typeof cost === "number" ? cost : null,
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

/**
 * The plans to render, most recently seen first.
 *
 * Recency-first because the question the section answers is "what is it doing
 * now, and did that change" — the current shape belongs at the top.
 */
export function planRows(res: QueryPlansResponse): PlanRow[] {
  return [...(res.hits ?? [])]
    .sort((a, b) => b.last_seen - a.last_seen)
    .map((hit) => ({
      rowKey: hit.plan_hash,
      planHash: hit.plan_hash,
      planHashVersion: hit.plan_hash_version,
      firstSeen: hit.first_seen,
      lastSeen: hit.last_seen,
      calls: hit.calls,
      sharePercent: hit.call_share * 100,
      nodes: flattenPlanTree(hit.plan),
    }));
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
 * and the two whys need opposite sentences. `captureOff` is a config problem
 * the reader can fix. `noPlanForQuery` is not a problem at all — Postgres
 * cannot EXPLAIN a `COMMIT`, `ROLLBACK` or `SHOW`, so those fingerprints
 * legitimately have no plan while capture runs perfectly. Showing the config
 * hint over one of those tells a DBA to switch on a flag that is already on.
 *
 * A response with no `plan_capture` at all falls back to `captureOff`: that is
 * the copy that shipped before the field existed, so an older server degrades
 * to the previous behaviour rather than asserting a state it never reported.
 */
export function planEmptyReason(res: QueryPlansResponse): "captureOff" | "noPlanForQuery" | null {
  if ((res.hits?.length ?? 0) > 0) return null;
  return res.plan_capture === "on" ? "noPlanForQuery" : "captureOff";
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
