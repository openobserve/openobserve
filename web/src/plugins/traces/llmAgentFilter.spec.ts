// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import {
  ALL_AGENTS_VALUE,
  agentOptionKey,
  buildAgentSessionFilter,
  buildAgentTraceFilter,
} from "./llmAgentFilter";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

const agentWithId: GenAiAgentListItem = {
  name: "support-agent",
  id: "agent-123",
  source_stream: "prod_traces",
  source_stream_type: "traces",
};

describe("llmAgentFilter", () => {
  it("keys agent options by stream + id (not display name)", () => {
    expect(agentOptionKey(agentWithId)).toBe("traces/prod_traces/agent-123//");
    expect(agentOptionKey({ ...agentWithId, id: null })).toBe("traces/prod_traces/support-agent//");
  });

  it("returns an empty predicate for no agent / All Agents", () => {
    expect(buildAgentTraceFilter(null, "default")).toBe("");
    expect(buildAgentTraceFilter(undefined, "default")).toBe("");
  });

  it("returns an empty predicate when no stream is given", () => {
    expect(buildAgentTraceFilter(agentWithId, "")).toBe("");
  });

  it("filters directly by gen_ai_agent_id when present", () => {
    expect(buildAgentTraceFilter(agentWithId, "default")).toBe(`gen_ai_agent_id = 'agent-123'`);
  });

  it("falls back to gen_ai_agent_name when the agent has no id (§6.3)", () => {
    expect(buildAgentTraceFilter({ ...agentWithId, id: null }, "default")).toBe(
      `gen_ai_agent_name = 'support-agent'`,
    );
  });

  it("escapes single quotes in the agent value", () => {
    expect(
      buildAgentTraceFilter({ ...agentWithId, id: null, name: "o'brien" }, "default"),
    ).toContain(`gen_ai_agent_name = 'o''brien'`);
  });

  it("adds a version predicate when the agent has a version", () => {
    const where = buildAgentTraceFilter({ ...agentWithId, version: "1.3.0" }, "default");
    expect(where).toContain("gen_ai_agent_id = 'agent-123'");
    expect(where).toContain("gen_ai_agent_version = '1.3.0'");
  });

  it("adds an env predicate when the agent has an env", () => {
    const where = buildAgentTraceFilter({ ...agentWithId, env: "production" }, "default");
    expect(where).toContain("gen_ai_agent_env = 'production'");
  });

  it("builds a direct agent predicate for session selection", () => {
    expect(buildAgentSessionFilter(agentWithId, "default")).toBe(`gen_ai_agent_id = 'agent-123'`);
  });

  it("keeps the same predicate when the backend uses a custom session field", () => {
    expect(buildAgentSessionFilter(agentWithId, "default", "llm_session_id")).toBe(
      `gen_ai_agent_id = 'agent-123'`,
    );
  });

  it("returns an empty session predicate when no agent / stream / session field is given", () => {
    expect(buildAgentSessionFilter(null, "default")).toBe("");
    expect(buildAgentSessionFilter(agentWithId, "")).toBe("");
    expect(buildAgentSessionFilter(agentWithId, "default", "")).toBe("");
  });

  it("exposes the All Agents sentinel", () => {
    expect(ALL_AGENTS_VALUE).toBe("__all__");
  });
});
