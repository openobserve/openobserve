// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import {
  ALL_AGENTS_VALUE,
  agentOptionKey,
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
    expect(agentOptionKey({ ...agentWithId, id: null })).toBe(
      "traces/prod_traces/support-agent",
    );
  });

  it("returns an empty predicate for no agent / All Agents", () => {
    expect(buildAgentTraceFilter(null, "default")).toBe("");
    expect(buildAgentTraceFilter(undefined, "default")).toBe("");
  });

  it("returns an empty predicate when no stream is given", () => {
    expect(buildAgentTraceFilter(agentWithId, "")).toBe("");
  });

  it("filters by trace membership using gen_ai_agent_id when present (§6.6)", () => {
    expect(buildAgentTraceFilter(agentWithId, "default")).toBe(
      `trace_id IN (SELECT trace_id FROM "default" WHERE gen_ai_agent_id = 'agent-123' GROUP BY trace_id)`,
    );
  });

  it("falls back to gen_ai_agent_name when the agent has no id (§6.3)", () => {
    expect(buildAgentTraceFilter({ ...agentWithId, id: null }, "default")).toBe(
      `trace_id IN (SELECT trace_id FROM "default" WHERE gen_ai_agent_name = 'support-agent' GROUP BY trace_id)`,
    );
  });

  it("escapes single quotes in the agent value", () => {
    expect(
      buildAgentTraceFilter(
        { ...agentWithId, id: null, name: "o'brien" },
        "default",
      ),
    ).toContain(`gen_ai_agent_name = 'o''brien'`);
  });

  it("exposes the All Agents sentinel", () => {
    expect(ALL_AGENTS_VALUE).toBe("__all__");
  });
});
