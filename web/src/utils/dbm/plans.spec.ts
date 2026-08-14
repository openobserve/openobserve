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
import {
  flattenPlanTree,
  planDriftLevel,
  planEmptyReason,
  planIndentClass,
  planRows,
} from "@/utils/dbm/plans";

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

/**
 * MySQL/MariaDB `EXPLAIN FORMAT=JSON` — a `query_block` OBJECT, structurally
 * unrelated to Postgres's array of `{Plan}`.
 *
 * This was a SHIPPED bug caught on a live MySQL fleet: the plan was captured
 * and stored perfectly, and the section rendered "The plan could not be read"
 * over it, because the walker required an array and returned `[]` for
 * anything else. The reader was denied the single most actionable fact on the
 * page — `ALL` over 345k rows is a full table scan and a missing index — and
 * the copy blamed a read that never failed.
 */
describe("flattenPlanTree on a MySQL query_block", () => {
  /** The exact document the live instance returned for `demo_sessions`. */
  const mysqlPlan = () => ({
    query_block: {
      select_id: 1,
      cost_info: { query_cost: "34811.85" },
      table: {
        table_name: "demo_sessions",
        access_type: "ALL",
        rows_examined_per_scan: 345311,
        rows_produced_per_join: 34531,
        filtered: "10.00",
        cost_info: {
          read_cost: "31358.74",
          eval_cost: "3453.11",
          prefix_cost: "34811.85",
          data_read_per_join: "9M",
        },
        used_columns: ["id", "token", "user_id"],
        attached_condition: "( dbmlab . demo_sessions . token = ? )",
      },
    },
  });

  it("reads the plan instead of reporting it unreadable", () => {
    expect(flattenPlanTree(mysqlPlan())).not.toEqual([]);
  });

  it("surfaces the full table scan and the table it scans", () => {
    const [row] = flattenPlanTree(mysqlPlan());
    // `access_type` IS the operation in MySQL's grammar — and `ALL` is the
    // finding the reader came for.
    expect(row.nodeType).toBe("ALL scan");
    expect(row.relation).toBe("demo_sessions");
    expect(row.planRows).toBe(345311);
  });

  it("parses MySQL's string-quoted cost as a number", () => {
    // MySQL quotes cost ("34811.85"); Postgres sends a number. Both must reach
    // the same numeric column or the cost renders blank on one engine.
    expect(flattenPlanTree(mysqlPlan())[0].totalCost).toBe(34811.85);
  });

  it("never claims an executed row count MySQL's EXPLAIN did not measure", () => {
    // This document is an ESTIMATE. A number here would be a measurement
    // nobody made.
    expect(flattenPlanTree(mysqlPlan())[0].actualRows).toBeNull();
  });

  it("shows the index actually chosen, never a candidate it rejected", () => {
    const plan = {
      query_block: {
        table: {
          table_name: "demo_sessions",
          access_type: "ref",
          key: "idx_token",
          possible_keys: ["idx_token", "idx_user"],
          rows_examined_per_scan: 1,
        },
      },
    };
    const [row] = flattenPlanTree(plan);
    // `possible_keys` are candidates the optimizer did NOT choose; presenting
    // one as the index used would send a reader tuning the wrong index.
    expect(row.index).toBe("idx_token");
  });

  it("walks nested_loop joins as siblings under the block", () => {
    const plan = {
      query_block: {
        nested_loop: [
          { table: { table_name: "orders", access_type: "ALL" } },
          { table: { table_name: "order_lines", access_type: "ref", key: "fk_order" } },
        ],
      },
    };
    const rows = flattenPlanTree(plan);
    expect(rows.map((r) => r.relation)).toEqual(["orders", "order_lines"]);
    // Joined tables are siblings, not one nested inside the other.
    expect(rows[0].depth).toBe(rows[1].depth);
  });

  it("still returns nothing for an object that is not an EXPLAIN document", () => {
    for (const bad of [{ not_a_plan: 1 }, { query_block: null }, { query_block: 42 }]) {
      expect(() => flattenPlanTree(bad as never)).not.toThrow();
      expect(flattenPlanTree(bad as never)).toEqual([]);
    }
  });
});

describe("planRows", () => {
  it("orders the most recently seen plan first", () => {
    const older = plan({ plan_hash: "old", last_seen: 1_000 });
    const newer = plan({ plan_hash: "new", last_seen: 2_000 });
    expect(planRows(response({ hits: [older, newer] })).map((r) => r.planHash)).toEqual([
      "new",
      "old",
    ]);
  });

  /**
   * W2. The response carries no `call_share`, because this feed cannot
   * support an honest one: `calls` is a SUM over a DELTA feed whose first
   * emission per statement carries the whole `pg_stat_statements` backlog, so
   * a window containing one has a denominator inflated by that backlog.
   *
   * Pinned through `planRows` — the function the page actually calls — rather
   * than by reading the interface, and paired with the fields that DO survive
   * so an implementation returning bare rows could not satisfy it.
   */
  it("carries no call share, which this feed cannot support", () => {
    const rows = planRows(response({ hits: [plan()] }));
    expect(rows[0]).not.toHaveProperty("sharePercent");
    expect(rows[0]).toMatchObject({
      planHash: "abc123def4567890",
      firstSeen: 1_786_415_000_000_000,
      lastSeen: 1_786_415_600_000_000,
    });
  });

  it("gives every row a stable key that keeps the two producers apart", () => {
    // The key carries the source because the two producers can — by design —
    // yield the SAME structural hash, and a hash-only key would collapse an
    // executed row into its generic twin.
    const rows = planRows(
      response({
        hits: [plan({ plan_hash: "a" }), plan({ plan_hash: "a", plan_source: "auto_explain" })],
      }),
    );
    expect(rows.map((r) => r.rowKey)).toEqual(["a-auto_explain", "a-generic_null_bound"]);
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

describe("planEmptyReason", () => {
  /**
   * Zero plans has two causes and only one of them is the user's to fix.
   * `plan_capture: "off"` means the stream never carried a plan hash column,
   * so nothing ever looked. `"on"` means capture ran and this statement simply
   * has no plan — `COMMIT`, `ROLLBACK` and `SHOW` cannot be EXPLAINed at all.
   * Telling the second group to switch on a flag that is already on sends them
   * to fix a non-problem.
   */
  it("reports capture-off when the backend says capture never ran", () => {
    expect(planEmptyReason(response({ hits: [], plan_capture: "off" }))).toBe("captureOff");
  });

  it("reports this-query-unplannable when capture ran but found nothing", () => {
    expect(planEmptyReason(response({ hits: [], plan_capture: "on" }))).toBe("noPlanForQuery");
  });

  it("reports nothing at all once a plan exists, whatever the capture state says", () => {
    // The empty state is not rendered when there are rows, so a reason here
    // would be a sentence with nowhere to go — and `null` is what the caller
    // branches on.
    expect(planEmptyReason(response({ hits: [plan()], plan_capture: "on" }))).toBeNull();
    expect(planEmptyReason(response({ hits: [plan()], plan_capture: "off" }))).toBeNull();
  });

  /**
   * An older backend, or one mid-rollout, sends no `plan_capture` at all.
   * Falling back to the config hint is the safe half: it is the copy that
   * shipped before this field existed, so an old server degrades to exactly
   * today's behaviour rather than asserting a capture state it never reported.
   */
  it("falls back to the config hint when the backend sent no capture state", () => {
    const legacy = response({ hits: [] });
    delete (legacy as Partial<QueryPlansResponse>).plan_capture;
    expect(planEmptyReason(legacy)).toBe("captureOff");
  });
});

describe("the plans empty-state copy", () => {
  /**
   * The capture-ON sentence must not blame configuration. That is the whole
   * defect: on a deployment where capture is already running, the config hint
   * is a false instruction.
   */
  it("does not send a user with capture already on to change a setting", () => {
    const keys = ["dbm.detail.plans.noPlanForQuery", "dbm.detail.plans.noPlanForQueryHint"];
    // A missing key resolves to the key itself, which trivially satisfies every
    // "must not contain" below. Pin that the copy EXISTS before asserting what
    // it avoids, or this test passes hardest when the strings are absent.
    for (const key of keys) expect(t(key), `${key} must be defined in en-US`).not.toBe(key);

    const copy = keys.map(t).join(" ");
    expect(copy).not.toContain("ZO_DB_MONITORING_TOP_QUERY_ENABLED");
    expect(copy.toLowerCase()).not.toMatch(/turn on|switch on|enable|collector config|setting/);
  });

  it("gives the real reason a statement has no plan", () => {
    // COMMIT / ROLLBACK / SHOW cannot be EXPLAINed by Postgres at all. Naming
    // them is what turns "no plan" from an apparent fault into an expected
    // state the reader can recognise their own query in.
    const hint = t("dbm.detail.plans.noPlanForQueryHint");
    expect(hint).toMatch(/COMMIT/);
    expect(hint).toMatch(/ROLLBACK|SHOW/);
    expect(hint.toLowerCase()).toMatch(/can't|cannot/);
  });

  it("keeps the config hint on the capture-off sentence, where it is true", () => {
    expect(t("dbm.detail.plans.noPlansHint")).toContain("ZO_DB_MONITORING_TOP_QUERY_ENABLED");
  });

  it("attaches no timing to either empty state", () => {
    // D-H: nothing in this section may carry a duration.
    for (const key of ["noPlanForQuery", "noPlanForQueryHint"]) {
      const full = `dbm.detail.plans.${key}`;
      // As above: an absent key would pass this by saying nothing at all.
      expect(t(full), `${full} must be defined in en-US`).not.toBe(full);
      expect(t(full).toLowerCase()).not.toMatch(/\bms\b|latency|slower/);
    }
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

// ─── W-E3 · executed plans (auto_explain) ────────────────────────────────────
//
// The real captured executed-plan document shape (postgres:16.14 rig,
// log_analyze=on, log_timing=off): the API stores it rewrapped in the
// receiver's [{Plan}] array form, with per-node Actual Rows preserved.
const executedPlanDoc = () => [
  {
    Plan: {
      "Node Type": "Seq Scan",
      "Relation Name": "accounts",
      "Total Cost": 1.62,
      "Plan Rows": 1,
      "Actual Rows": 1,
    },
  },
];

describe("per-row plan provenance (W-E3)", () => {
  it("sorts executed plans first, then by recency within each producer", () => {
    const rows = planRows(
      response({
        hits: [
          plan({ plan_hash: "gen-new", last_seen: 400 }),
          plan({ plan_hash: "exec-old", last_seen: 100, plan_source: "auto_explain" }),
          plan({ plan_hash: "gen-old", last_seen: 300 }),
          plan({ plan_hash: "exec-new", last_seen: 200, plan_source: "auto_explain" }),
        ],
      }),
    );
    expect(rows.map((r) => r.planHash)).toEqual(["exec-new", "exec-old", "gen-new", "gen-old"]);
  });

  it("reads an absent or unknown plan_source as generic — the weaker claim", () => {
    const rows = planRows(
      response({
        hits: [
          plan({ plan_hash: "legacy" }),
          plan({ plan_hash: "weird", plan_source: "someday_a_third_producer" as never }),
        ],
      }),
    );
    for (const row of rows) expect(row.planSource).toBe("generic_null_bound");
  });

  it("carries durations on an executed row, phrased as captured executions", () => {
    const rows = planRows(
      response({
        hits: [
          plan({
            plan_hash: "exec",
            plan_source: "auto_explain",
            avg_duration_ms: 1.25,
            max_duration_ms: 30,
            executions: 4,
          }),
        ],
      }),
    );
    expect(rows[0].avgDurationMs).toBe(1.25);
    expect(rows[0].maxDurationMs).toBe(30);
    expect(rows[0].executions).toBe(4);
  });

  it("keeps a generic row latency-free even against a response that lies", () => {
    // The API sends duration keys ABSENT on generic hits; this pins the UI's
    // own belt-and-braces gate so a backend regression cannot render a latency
    // beside a plan that never ran (D-H).
    const rows = planRows(
      response({
        hits: [
          plan({
            plan_hash: "gen",
            avg_duration_ms: 9,
            max_duration_ms: 9,
            executions: 9,
          } as never),
        ],
      }),
    );
    expect(rows[0].planSource).toBe("generic_null_bound");
    expect(rows[0].avgDurationMs).toBeUndefined();
    expect(rows[0].maxDurationMs).toBeUndefined();
    expect(rows[0].executions).toBeUndefined();
  });

  it("keeps an executed row without measurements latency-free too", () => {
    // log_analyze = off is a recommended configuration: the plan is real, the
    // timings simply were not measured — absent, never zero.
    const rows = planRows(
      response({ hits: [plan({ plan_hash: "exec", plan_source: "auto_explain" })] }),
    );
    expect(rows[0].planSource).toBe("auto_explain");
    expect(rows[0].avgDurationMs).toBeUndefined();
  });
});

describe("estimate vs actual on plan nodes (W-E3)", () => {
  it("carries est and act through the flattener where the plan measured them", () => {
    const rows = flattenPlanTree(executedPlanDoc());
    expect(rows).toHaveLength(1);
    expect(rows[0].planRows).toBe(1);
    expect(rows[0].actualRows).toBe(1);
  });

  it("reports actuals as null — not zero — on a generic plan", () => {
    const rows = flattenPlanTree(pgPlan());
    for (const row of rows) {
      expect(row.actualRows).toBeNull();
    }
  });
});

describe("the third empty reason (W-E3)", () => {
  it("reports good news when explain ingest is on and nothing was slow enough", () => {
    expect(planEmptyReason(response({ plan_capture: "on", explain_enabled: true }))).toBe(
      "noExecutionCaptured",
    );
  });

  it("keeps the unplannable copy when explain ingest is off", () => {
    expect(planEmptyReason(response({ plan_capture: "on", explain_enabled: false }))).toBe(
      "noPlanForQuery",
    );
    expect(planEmptyReason(response({ plan_capture: "on" }))).toBe("noPlanForQuery");
  });

  it("keeps capture-off first: an explain flag cannot outrank a stream that never captured", () => {
    expect(planEmptyReason(response({ plan_capture: "off", explain_enabled: true }))).toBe(
      "captureOff",
    );
  });

  it("phrases the third state as working capture, never as a config error", () => {
    const text = t("dbm.detail.plans.noExecutionCapturedHint");
    expect(text).toMatch(/on and working|working/);
    expect(text).toMatch(/good news/);
    expect(text, "must not send the user to a settings page").not.toMatch(/ZO_DB_MONITORING/);
  });
});

describe("the executed-plan copy (W-E3)", () => {
  it("labels durations as captured executions, never as average latency", () => {
    const copy = t("dbm.detail.plans.capturedDurations");
    expect(copy).toMatch(/captured executions/);
    expect(copy.toLowerCase()).not.toContain("average latency");
  });

  it("tells the reader the executed capture only sees the slow tail", () => {
    expect(t("dbm.detail.plans.executedTooltip")).toMatch(/slow/);
  });

  it("keeps the stable-hash caveat, updated for executed capture's blind spot", () => {
    // A plan flip that made the query FASTER than log_min_duration disappears
    // from capture entirely, so "no change seen" still is not an all-clear.
    expect(t("dbm.detail.plans.stableCaveat")).toMatch(/faster|slow enough/);
  });
});
