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
  it("filters _llm_scores inline on agent_id", () => {
    const sql = buildScoresAgentFilterWhere(agentWithId);

    expect(sql).toBe("agent_id = 'agent-123'");
  });

  it("falls back to agent_name when id is missing", () => {
    const sql = buildScoresAgentFilterWhere({ ...agentWithId, id: null });

    expect(sql).toBe("agent_name = 'support-agent'");
  });

  it("filters _evaluator inline on attributes_target_agent_id", () => {
    const sql = buildEvaluatorAgentFilterWhere(agentWithId);

    expect(sql).toBe("attributes_target_agent_id = 'agent-123'");
  });

  it("falls back to attributes_target_agent_name when id is missing", () => {
    const sql = buildEvaluatorAgentFilterWhere({ ...agentWithId, id: null });

    expect(sql).toBe("attributes_target_agent_name = 'support-agent'");
  });

  it("escapes agent values", () => {
    const sql = buildScoresAgentFilterWhere({
      name: "agent'one",
      id: null,
      source_stream: 'prod"traces',
      source_stream_type: 'traces"prod',
    });

    expect(sql).toBe("agent_name = 'agent''one'");
  });

  it("keys identity by source stream and id-or-name", () => {
    expect(agentFilterKey(agentWithId)).toBe("traces/prod_traces/id:agent-123");
    expect(agentFilterKey({ ...agentWithId, id: null })).toBe(
      "traces/prod_traces/name:support-agent",
    );
  });

  it("labels the agent by identity only (no source stream)", () => {
    expect(agentFilterLabel(agentWithId)).toBe("support-agent (agent-123)");
    expect(agentFilterLabel({ ...agentWithId, id: null })).toBe("support-agent");
  });

  it("combines filters without emitting an empty WHERE clause", () => {
    expect(combineWhere()).toBeNull();
    expect(combineWhere("a = 1", null, "b = 2")).toBe("(a = 1) AND (b = 2)");
  });
});
