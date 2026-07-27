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
    expect(agentOptionKey(agentWithId)).toBe("traces/prod_traces/agent-123");
    expect(agentOptionKey({ ...agentWithId, id: null })).toBe("traces/prod_traces/support-agent");
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

  it("builds a session-membership filter that keeps full matching sessions", () => {
    expect(buildAgentSessionFilter(agentWithId, "default")).toBe(
      `gen_ai_conversation_id IN (SELECT gen_ai_conversation_id FROM "default" WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != '' AND gen_ai_agent_id = 'agent-123' GROUP BY gen_ai_conversation_id)`,
    );
  });

  it("supports a custom session field for session-membership filters", () => {
    expect(buildAgentSessionFilter(agentWithId, "default", "llm_session_id")).toBe(
      `llm_session_id IN (SELECT llm_session_id FROM "default" WHERE llm_session_id IS NOT NULL AND llm_session_id != '' AND gen_ai_agent_id = 'agent-123' GROUP BY llm_session_id)`,
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
