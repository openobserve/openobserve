import { describe, it, expect } from "vitest";
import { buildAgentClimbFilter } from "./agentClimbFilter";

const CALLER_EXPR = "COALESCE(c.gen_ai_agent_name, c.service_name)";

describe("buildAgentClimbFilter", () => {
  it("adds env and version clauses when both are provided", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, "my-agent", {
      env: "prod",
      version: "2.1",
    });
    expect(sql).toContain("c.gen_ai_agent_env = 'prod'");
    expect(sql).toContain("c.gen_ai_agent_version = '2.1'");
  });

  it("is byte-identical to the agent-only predicate when env/version are absent (agent set)", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, "my-agent", {});
    expect(sql).toBe(`${CALLER_EXPR} = 'my-agent'`);
  });

  it("is byte-identical to the agent-only predicate when agent, env, version are all absent", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, undefined, {});
    expect(sql).toBe("1=1");
  });

  it("escapes single quotes in env/version", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, undefined, {
      env: "o'reilly",
      version: "1'0",
    });
    expect(sql).toContain("c.gen_ai_agent_env = 'o''reilly'");
    expect(sql).toContain("c.gen_ai_agent_version = '1''0'");
  });
});
