import { describe, expect, it } from "vitest";
import {
  agentFilterKey,
  agentFilterLabel,
  buildEvaluatorAgentFilterWhere,
  buildScoresAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "./agentFilterSql";

const agentWithId: AgentFilterSelection = {
  name: "support-agent",
  id: "agent-123",
  source_stream: "prod_traces",
  source_stream_type: "traces",
};

describe("agentFilterSql", () => {
  it("builds stream-scoped score filters through source trace IDs", () => {
    const sql = buildScoresAgentFilterWhere(agentWithId);

    expect(sql).toContain("source_stream = 'prod_traces'");
    expect(sql).toContain("source_stream_type = 'traces'");
    expect(sql).toContain("trace_id IN (");
    expect(sql).toContain('FROM "traces"."prod_traces"');
    expect(sql).toContain("WHERE gen_ai_agent_id = 'agent-123'");
    expect(sql).toContain("GROUP BY trace_id");
    expect(sql).not.toContain("agent_name");
  });

  it("falls back to canonical agent name when id is missing", () => {
    const sql = buildScoresAgentFilterWhere({ ...agentWithId, id: null });

    expect(sql).toContain("WHERE gen_ai_agent_name = 'support-agent'");
  });

  it("builds evaluator filters through source trace IDs", () => {
    const sql = buildEvaluatorAgentFilterWhere(agentWithId);

    expect(sql).toContain("attributes_target_stream = 'prod_traces'");
    expect(sql).toContain("attributes_target_stream_type = 'traces'");
    expect(sql).toContain("attributes_target_trace_id IN (");
    expect(sql).toContain('FROM "traces"."prod_traces"');
    expect(sql).toContain("WHERE gen_ai_agent_id = 'agent-123'");
  });

  it("escapes stream names and agent values", () => {
    const sql = buildScoresAgentFilterWhere({
      name: "agent'one",
      id: null,
      source_stream: 'prod"traces',
      source_stream_type: 'traces"prod',
    });

    expect(sql).toContain("source_stream = 'prod\"traces'");
    expect(sql).toContain('FROM "traces""prod"."prod""traces"');
    expect(sql).toContain("WHERE gen_ai_agent_name = 'agent''one'");
  });

  it("keys identity by source stream and id-or-name", () => {
    expect(agentFilterKey(agentWithId)).toBe("traces/prod_traces/id:agent-123");
    expect(agentFilterKey({ ...agentWithId, id: null })).toBe(
      "traces/prod_traces/name:support-agent",
    );
  });

  it("labels the agent by identity only (no source stream)", () => {
    expect(agentFilterLabel(agentWithId)).toBe("support-agent (agent-123)");
    expect(agentFilterLabel({ ...agentWithId, id: null })).toBe(
      "support-agent",
    );
  });

  it("combines filters without emitting an empty WHERE clause", () => {
    expect(combineWhere()).toBeNull();
    expect(combineWhere("a = 1", null, "b = 2")).toBe("(a = 1) AND (b = 2)");
  });
});
