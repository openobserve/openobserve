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

import { describe, it, expect } from "vitest";
import {
  costByDimensionSql,
  costByModelSql,
  coverageSql,
  toAttributionRows,
  traceUsageSum,
  usersSql,
} from "./llmAttribution";
import { agentParentsJoin, llmCallUsageSum } from "./config/llmInsightsPanels";

const withParents = { hasParentSpan: true };

type Span = {
  span_id: string;
  parent?: string;
  op: string | null;
  usage: number;
};

/** One trace's usage as the generated SQL computes it over in-memory spans; an unparseable fallback fails the test. */
function traceUsageOver(from: string, rule: string, column: string, spans: Span[]): number {
  const join =
    /AS agent_parents ON trace_id = agent_parent_trace AND (\w+) = agent_parent_span$/.exec(from);
  const joinAgentOp = /WHERE gen_ai_operation_name = '(\w+)'\) AS agent_parents/.exec(from)?.[1];
  if (join) expect(join[1]).toBe("reference_parent_span_id");
  else expect(from).toMatch(/WHERE false\) AS agent_parents ON trace_id = agent_parent_trace$/);
  const agentParent = (s: Span) => {
    const parent = spans.find((p) => p.span_id === s.parent);
    return join && parent && parent.op === joinAgentOp ? parent.span_id : null;
  };
  const llmOps = [
    ...(rule.match(/gen_ai_operation_name IN \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g),
  ].map((m) => m[1]);
  const llm = spans
    .filter((s) => (s.op == null ? rule.includes("IS NULL OR") : llmOps.includes(s.op)))
    .reduce((acc, s) => acc + s.usage, 0);
  const fallback = new RegExp(
    `SUM\\(CASE WHEN gen_ai_operation_name = '(\\w+)'( AND agent_parent_span IS NULL)? THEN ${column} END\\)`,
  ).exec(rule);
  expect(fallback, rule).not.toBeNull();
  const [, agentOp, topLevelOnly] = fallback!;
  const agents = spans
    .filter((s) => s.op === agentOp && (!topLevelOnly || agentParent(s) === null))
    .reduce((acc, s) => acc + s.usage, 0);
  return llm || agents;
}

describe("cost attribution", () => {
  it("attributes a trace's whole cost to the value set on any of its spans", () => {
    const sql = costByDimensionSql("s", "tenant_id", "gen_ai_agent_name = 'a'", withParents).rows;
    expect(sql).toContain("COALESCE(MAX(tenant_id), '') AS v");
    expect(sql).toContain(
      `FROM "s"${agentParentsJoin("s", true)} WHERE gen_ai_agent_name = 'a' GROUP BY trace_id`,
    );
  });

  // Usage is LLM-call usage, else top-level agents'; nested agents repeat their parent's usage.
  describe("a trace's usage (traceUsageSum)", () => {
    const usage = (spans: Span[], hasParentSpan = true) =>
      traceUsageOver(
        agentParentsJoin("s", hasParentSpan),
        traceUsageSum("gen_ai_usage_cost"),
        "gen_ai_usage_cost",
        spans,
      );
    const workflow: Span = { span_id: "w", op: "invoke_workflow", usage: 0 };
    const siblings: Span[] = [
      workflow,
      { span_id: "a1", parent: "w", op: "invoke_agent", usage: 0.1 },
      { span_id: "n", parent: "a1", op: "invoke_agent", usage: 0.04 },
      { span_id: "a2", parent: "w", op: "invoke_agent", usage: 0.2 },
    ];

    it("sums sibling agents and skips the agent nested under one of them", () => {
      expect(usage(siblings)).toBeCloseTo(0.3);
    });

    it("counts a root agent and its own repeating child agent once", () => {
      expect(
        usage([
          { span_id: "a", op: "invoke_agent", usage: 0.3 },
          { span_id: "b", parent: "a", op: "invoke_agent", usage: 0.3 },
        ]),
      ).toBeCloseTo(0.3);
    });

    it("keeps LLM-call usage over any agent span", () => {
      expect(
        usage([
          { span_id: "a", op: "invoke_agent", usage: 0.15 },
          { span_id: "c", parent: "a", op: "chat", usage: 0.01 },
          { span_id: "x", op: "invoke_agent", usage: 0.5 },
        ]),
      ).toBeCloseTo(0.01);
    });

    it("sums every agent span of a stream that stores no parents (all roots)", () => {
      const roots = siblings.map((s) => ({ ...s, parent: undefined }));
      expect(usage(roots, false)).toBeCloseTo(0.34);
    });

    it("reads LLM calls first and agent spans only, never every span", () => {
      const rule = traceUsageSum("gen_ai_usage_cost");
      expect(rule).toContain(`NULLIF(${llmCallUsageSum("gen_ai_usage_cost")}, 0)`);
      expect(rule).not.toContain("SUM(gen_ai_usage_cost)");
    });
  });

  it("sums each trace's usage with the shared rule in Cost by dims and Users", () => {
    for (const sql of [
      costByDimensionSql("s", "tenant_id", "gen_ai_agent_name = 'a'", withParents).rows,
      usersSql("s", {
        scope: "gen_ai_agent_name = 'a'",
        tenantColumn: "tenant_id",
        ...withParents,
      }),
    ]) {
      for (const [column, alias] of [
        ["gen_ai_usage_cost", "cost"],
        ["gen_ai_usage_total_tokens", "tokens"],
      ]) {
        expect(sql).toContain(`${traceUsageSum(column)} AS ${alias}`);
      }
      expect(sql).toContain(`FROM "s"${agentParentsJoin("s", true)} WHERE`);
      expect(sql).toContain("GROUP BY trace_id");
    }
    // A stream without the parent column joins no parents and names no missing column.
    const flat = usersSql("s", { scope: "", tenantColumn: null, hasParentSpan: false });
    expect(flat).toContain(`FROM "s"${agentParentsJoin("s", false)} GROUP BY trace_id`);
    expect(flat).not.toContain("reference_parent_span_id");
  });

  // Agent-only usage has no model, so it lands in the unattributed '' row instead of vanishing.
  it("attributes cost per model and trace, agent-only usage unattributed", () => {
    const sql = costByModelSql("s", "gen_ai_agent_name = 'a'", withParents).rows;
    const [models, agentOnly] = sql.split(" UNION ALL ");
    expect(agentOnly).toBeDefined();
    expect(models).toContain("SELECT trace_id, gen_ai_response_model AS v");
    expect(models).toContain(`COALESCE(${llmCallUsageSum("gen_ai_usage_cost")}, 0) AS cost`);
    expect(models).toContain(
      "WHERE gen_ai_response_model IS NOT NULL AND (gen_ai_agent_name = 'a') " +
        "GROUP BY trace_id, gen_ai_response_model",
    );
    expect(agentOnly).toContain("SELECT trace_id, '' AS v");
    expect(agentOnly).toContain(`COALESCE(${llmCallUsageSum("gen_ai_usage_cost")}, 0) = 0`);
    expect(agentOnly).toContain(
      "gen_ai_operation_name = 'invoke_agent' AND agent_parent_span IS NULL",
    );
    expect(agentOnly).toContain(
      `FROM "s"${agentParentsJoin("s", true)} WHERE gen_ai_agent_name = 'a' GROUP BY trace_id HAVING`,
    );
    // The per-model LLM-call arm reads no agent span, so it needs no join.
    expect(models).not.toContain("agent_parents");
    expect(sql).toContain("COUNT(DISTINCT trace_id) AS traces");
  });

  // The search layer ignores ORDER BY on an expression, so the '' row sorts first via a projected alias.
  it("fetches the top values plus unattributed, and totals over every value", () => {
    for (const sql of [
      costByDimensionSql("s", "user_id", "", withParents),
      costByModelSql("s", "", withParents),
    ]) {
      expect(sql.rows).toMatch(
        /^SELECT v, cost, tokens, traces, unpriced, CASE WHEN v = '' THEN 0 ELSE 1 END AS unattributed_last FROM \(/,
      );
      expect(sql.rows).toMatch(/\) ORDER BY unattributed_last, cost DESC LIMIT 51$/);
      expect(sql.totals).toMatch(/^SELECT COUNT\(\*\) FILTER \(WHERE v != ''\) AS n_values/);
      expect(sql.totals).not.toContain("LIMIT");
      const grouped = sql.rows.slice(
        sql.rows.indexOf("FROM (") + "FROM (".length,
        sql.rows.lastIndexOf(") ORDER BY"),
      );
      expect(sql.totals).toContain(`FROM (${grouped})`);
    }
  });

  it("keeps unattributed spend visible so the shares add up", () => {
    const out = toAttributionRows(
      [
        { v: "acme", cost: 6, tokens: 10, traces: 3 },
        { v: "", cost: 2, tokens: 4, traces: 1 },
        { v: "globex", cost: 1, tokens: 2, traces: 1 },
        { v: "initech", cost: 1, tokens: 2, traces: 1 },
      ],
      { n_values: 3, cost: 10, tokens: 18, traces: 6 },
      2,
    );
    expect(out.total).toBe(10);
    expect(out.rows.map((r) => r.value)).toEqual(["acme", "globex"]);
    expect(out.more).toMatchObject({ value: "1", cost: 1 });
    expect(out.unattributed).toMatchObject({ cost: 2, share: 0.2 });
    expect(out.attributedShare).toBe(0.8);
  });

  // 60 values but only the top 2 fetched: total, shares and "N more" cover all of them.
  it("computes the total, shares and the more row from the whole-window totals", () => {
    const out = toAttributionRows(
      [
        { v: "acme", cost: 5, tokens: 50, traces: 5 },
        { v: "globex", cost: 3, tokens: 30, traces: 3 },
        { v: "", cost: 2, tokens: 20, traces: 2 },
      ],
      { n_values: 60, cost: 20, tokens: 200, traces: 30 },
      1,
    );
    expect(out.total).toBe(20);
    expect(out.rows[0]).toMatchObject({ value: "acme", share: 0.25 });
    expect(out.more).toMatchObject({ value: "59", cost: 13, tokens: 130, traces: 23 });
    expect(out.unattributed).toMatchObject({ cost: 2, share: 0.1 });
    expect(out.attributedShare).toBe(0.9);
  });

  it("lists users without a tenant column and escapes the search, ignoring case", () => {
    const sql = usersSql("s", { scope: "", tenantColumn: null, search: "U_1%", ...withParents });
    expect(sql).toContain("'' AS tenant");
    expect(sql).toContain("LOWER(user_id) LIKE '%u\\_1\\%%'");
  });

  it("matches a backslash in the search literally instead of escaping the next character", () => {
    const sql = usersSql("s", { scope: "", tenantColumn: null, search: "a\\", ...withParents });
    // `a\` must become the LIKE pattern `%a\\%`, not `%a\%` (which matches a literal `%`).
    expect(sql).toContain("LOWER(user_id) LIKE '%a\\\\%'");
  });

  it("counts unpriced LLM-call tokens per row only when the stream has the status column", () => {
    const withStatus = usersSql("s", {
      scope: "",
      tenantColumn: null,
      hasCostStatus: true,
      ...withParents,
    });
    expect(withStatus).toContain("gen_ai_usage_cost_status = 'unpriced'");
    expect(withStatus).toContain("SUM(unpriced) AS unpriced");
    expect(usersSql("s", { scope: "", tenantColumn: null, ...withParents })).not.toContain(
      "cost_status",
    );
    const cols = { hasCostStatus: true, ...withParents };
    for (const sql of [
      costByDimensionSql("s", "user_id", "", cols),
      costByModelSql("s", "", cols),
    ]) {
      expect(sql.rows).toContain("gen_ai_usage_cost_status = 'unpriced'");
      expect(sql.totals).toContain("SUM(unpriced) AS unpriced");
    }
  });

  it("carries unpriced tokens into the more row from the whole-window totals", () => {
    const out = toAttributionRows(
      [
        { v: "a", cost: 1, tokens: 10, traces: 1, unpriced: 4 },
        { v: "b", cost: 1, tokens: 10, traces: 1, unpriced: 0 },
      ],
      { n_values: 2, cost: 2, tokens: 20, traces: 2, unpriced: 6 },
      1,
    );
    expect(out.rows[0].unpriced).toBe(4);
    expect(out.more?.unpriced).toBe(2);
  });

  it("counts the traces carrying each column, and still counts traces when the stream has none", () => {
    const sql = coverageSql("s", ["tenant_id"], "");
    expect(sql).toContain("SUM(tenant_id_set) AS tenant_id");
    expect(sql).toContain("GROUP BY trace_id");
    expect(coverageSql("s", [], "")).toBe(
      'SELECT COUNT(*) AS traces FROM (SELECT trace_id FROM "s" GROUP BY trace_id)',
    );
  });
});
