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
import type { QueryPlan, QueryPlansResponse } from "@/utils/dbm/plans";
import { flattenPlanTree, planDriftLevel, planIndentClass, planRows } from "@/utils/dbm/plans";

const t = (key: string) => i18n.global.t(key);

/** The real captured Postgres plan shape, as the API delivers it (parsed). */
const pgPlan = () => [
  {
    Plan: {
      "Node Type": "ModifyTable",
      "Relation Name": "inventory",
      "Total Cost": 8.3,
      Plans: [
        {
          "Node Type": "Index Scan",
          "Index Name": "inventory_pkey",
          "Relation Name": "inventory",
          "Total Cost": 8.3,
        },
      ],
    },
  },
];

const response = (over: Partial<QueryPlansResponse> = {}): QueryPlansResponse => ({
  hits: [],
  plan_source: "generic_null_bound",
  drift_detected: false,
  total: 0,
  ...over,
});

const plan = (over: Partial<QueryPlan> = {}): QueryPlan => ({
  plan_hash: "abc123def4567890",
  plan: pgPlan(),
  plan_hash_version: 1,
  first_seen: 1_786_415_000_000_000,
  last_seen: 1_786_415_600_000_000,
  calls: 100,
  call_share: 1,
  ...over,
});

describe("flattenPlanTree", () => {
  it("indents each node by its depth so the tree reads as a tree", () => {
    const rows = flattenPlanTree(pgPlan());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ depth: 0, nodeType: "ModifyTable", relation: "inventory" });
    expect(rows[1]).toMatchObject({
      depth: 1,
      nodeType: "Index Scan",
      relation: "inventory",
      index: "inventory_pkey",
    });
  });

  it("keeps siblings at one depth and does not flatten them into a chain", () => {
    const rows = flattenPlanTree([
      {
        Plan: {
          "Node Type": "Hash Join",
          Plans: [
            { "Node Type": "Seq Scan", "Relation Name": "orders" },
            { "Node Type": "Hash", Plans: [{ "Node Type": "Seq Scan", "Relation Name": "lines" }] },
          ],
        },
      },
    ]);
    expect(rows.map((r) => [r.depth, r.nodeType])).toEqual([
      [0, "Hash Join"],
      [1, "Seq Scan"],
      [1, "Hash"],
      [2, "Seq Scan"],
    ]);
  });

  it("carries the cost through for display without using it to order anything", () => {
    const rows = flattenPlanTree(pgPlan());
    expect(rows[0].totalCost).toBe(8.3);
  });

  it("returns nothing for a malformed or absent plan rather than throwing", () => {
    // A plan is supplementary detail beside a query; a bad one must never take
    // the page down with it.
    for (const bad of [null, undefined, "not a plan", 42, {}, [], [{}]]) {
      expect(() => flattenPlanTree(bad as never)).not.toThrow();
      expect(flattenPlanTree(bad as never)).toEqual([]);
    }
  });

  it("stops descending rather than hanging on a self-referential plan", () => {
    // The API parses server-supplied JSON, so a cycle cannot arrive over the
    // wire — but a caller can hand one in, and an unbounded walk would freeze
    // the browser tab rather than fail visibly.
    const cyclic: Record<string, unknown> = { "Node Type": "Loop" };
    cyclic.Plans = [cyclic];
    expect(() => flattenPlanTree([{ Plan: cyclic }] as never)).not.toThrow();
  });

  it("renders every node of a deep plan, not only the first levels", () => {
    let node: Record<string, unknown> = { "Node Type": "Seq Scan", "Relation Name": "deep" };
    for (let i = 0; i < 18; i += 1) {
      node = { "Node Type": `Level${i}`, Plans: [node] };
    }
    const rows = flattenPlanTree([{ Plan: node }] as never);
    expect(rows).toHaveLength(19);
    expect(rows[rows.length - 1]).toMatchObject({ depth: 18, relation: "deep" });
  });
});

describe("planRows", () => {
  it("orders the most recently seen plan first", () => {
    const older = plan({ plan_hash: "old", last_seen: 1_000, call_share: 0.25 });
    const newer = plan({ plan_hash: "new", last_seen: 2_000, call_share: 0.75 });
    expect(planRows(response({ hits: [older, newer] })).map((r) => r.planHash)).toEqual([
      "new",
      "old",
    ]);
  });

  it("exposes the share as a percentage for display", () => {
    const rows = planRows(response({ hits: [plan({ call_share: 0.25 })] }));
    expect(rows[0].sharePercent).toBe(25);
  });

  it("gives every row a stable key so the table does not re-order on refresh", () => {
    const rows = planRows(response({ hits: [plan({ plan_hash: "a" }), plan({ plan_hash: "b" })] }));
    expect(rows.map((r) => r.rowKey)).toEqual(["a", "b"]);
  });

  it("survives a plan whose tree failed to parse server-side", () => {
    // `plan_of` returns null on malformed stored JSON, so the hash arrives
    // without a tree. The row must still list — the hash and its window are
    // the drift signal, and the tree is only the explanation.
    const rows = planRows(response({ hits: [plan({ plan: null })] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].nodes).toEqual([]);
    expect(rows[0].planHash).toBe("abc123def4567890");
  });
});

describe("planDriftLevel", () => {
  it("reports drift when more than one plan appeared in the window", () => {
    expect(planDriftLevel(response({ drift_detected: true, hits: [plan(), plan()] }))).toBe(
      "drifted",
    );
  });

  it("reports a single plan as stable, never as an all-clear", () => {
    expect(planDriftLevel(response({ hits: [plan()] }))).toBe("stable");
  });

  it("reports no plans as none, which is distinct from stable", () => {
    // "No plans captured" and "one stable plan" are different states: the first
    // means nothing looked, the second means something looked and saw one
    // shape. Collapsing them tells a user their plan is stable when in fact the
    // feature is switched off.
    expect(planDriftLevel(response({ hits: [] }))).toBe("none");
  });

  it("trusts the row count over a drift flag that disagrees with it", () => {
    expect(planDriftLevel(response({ drift_detected: true, hits: [plan()] }))).toBe("stable");
  });
});

describe("the D-H honesty contract", () => {
  it("never exposes a latency field on a plan row", () => {
    // The plan was EXPLAINed with every bind parameter bound to NULL and was
    // never executed, while any latency figure comes from pg_stat_statements
    // real executions. Putting them on one row invites exactly the causal claim
    // the spec deleted ("the plan that appeared at 03:04 is 8x slower").
    const row = planRows(response({ hits: [plan()] }))[0] as Record<string, unknown>;
    for (const banned of ["latency", "execTime", "exec_time_s", "p95", "duration"]) {
      expect(row[banned]).toBeUndefined();
    }
  });

  it("labels the plan as a generic NULL-bound estimate, never as the plan that ran", () => {
    const label = t("dbm.detail.plans.sourceLabel");
    expect(label.toLowerCase()).toContain("generic");
    expect(label).not.toMatch(/\bthe plan that ran\b/i);
  });

  it("warns in the tooltip that Postgres may have run a different plan", () => {
    const tip = t("dbm.detail.plans.sourceTooltip").toLowerCase();
    expect(tip).toContain("may have");
    expect(tip).toContain("different");
  });

  it("states that a stable hash is not an all-clear", () => {
    // A stable generic hash is false-negative-prone: generic plans are a pure
    // function of (statement, schema, stats), so the classic "planner flipped
    // to a seq scan at 03:04" happens in the CUSTOM plan and may never move it.
    // Copy that reads "no plan change" would be a false reassurance.
    const stable = t("dbm.detail.plans.stableCaveat").toLowerCase();
    expect(stable).toMatch(/not|cannot|may/);
    expect(stable).not.toMatch(/no plan (change|regression)\b(?!.*not)/);
  });

  it("describes drift as a structural change, not as a cause of slowness", () => {
    const drift = t("dbm.detail.plans.driftCallout").toLowerCase();
    expect(drift).toMatch(/structur|shape|changed/);
    expect(drift).not.toMatch(/slower|faster|caused|because of/);
  });
});

describe("planIndentClass", () => {
  it("indents one step per level so nesting is visible", () => {
    expect(planIndentClass(0)).not.toEqual(planIndentClass(1));
    expect(planIndentClass(1)).not.toEqual(planIndentClass(2));
  });

  it("emits a rem-based Tailwind step, never a px arbitrary value", () => {
    // House rule: px is banned in class arbitrary values. A `pl-[24px]` here
    // would fail the CI lint and scale wrongly against text.
    for (let depth = 0; depth < 25; depth += 1) {
      expect(planIndentClass(depth)).not.toMatch(/px/);
      expect(planIndentClass(depth)).toMatch(/^pl-\d+(\.\d+)?$/);
    }
  });

  it("caps the indent so a deep plan never scrolls itself off the panel", () => {
    // Real captured plans reach 19 levels. Uncapped, the deepest nodes — the
    // scans that matter most — would be pushed out of the visible column.
    expect(planIndentClass(30)).toEqual(planIndentClass(60));
  });

  it("treats a negative or absent depth as the root level", () => {
    expect(planIndentClass(-1)).toEqual(planIndentClass(0));
  });
});
