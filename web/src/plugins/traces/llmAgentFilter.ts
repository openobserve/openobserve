// Copyright 2026 OpenObserve Inc.
//
// LLM Observability Phase 2 — Agent Filtering (Stream Contract v1.0, §6.4/§6.6).
//
// When an agent is selected on the LLM Insights dashboard, every query against
// the active trace stream must be scoped to that agent. We filter by *trace
// membership* rather than a flat `gen_ai_agent_id = '...'` predicate, because
// error spans and tool/child spans don't carry the canonical agent fields —
// only the LLM call span does. Resolving the matching trace ids first keeps the
// whole trace (and its child spans) in scope for cost/token/error aggregates.

import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

/** Sentinel option value for the "All Agents" selection (no filter). */
export const ALL_AGENTS_VALUE = "__all__";

/**
 * Stable identity key for an agent option. The same agent name/id can appear in
 * multiple streams, so the key is scoped by stream + identity (spec §8). Agent
 * id is preferred over name (§6.3) because names are display labels.
 */
export function agentOptionKey(agent: GenAiAgentListItem): string {
  return `${agent.source_stream_type}/${agent.source_stream}/${
    agent.id ?? agent.name
  }`;
}

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build the source-stream trace-id agent predicate for LLM Insights queries.
 * Returns the bare predicate (no leading `AND`/`WHERE`) so call sites can splice
 * it where appropriate, or an empty string when no agent is selected.
 *
 *   trace_id IN (
 *     SELECT trace_id FROM "<stream>"
 *     WHERE gen_ai_agent_id = '<id>'   -- or gen_ai_agent_name = '<name>'
 *     GROUP BY trace_id
 *   )
 */
export function buildAgentTraceFilter(
  agent: GenAiAgentListItem | null | undefined,
  streamName: string,
): string {
  if (!agent || !streamName) return "";
  const field = agent.id ? "gen_ai_agent_id" : "gen_ai_agent_name";
  const value = agent.id ?? agent.name;
  if (!value) return "";
  return `trace_id IN (SELECT trace_id FROM "${streamName}" WHERE ${field} = '${sqlQuote(
    String(value),
  )}' GROUP BY trace_id)`;
}

/**
 * Build a session-level predicate for the LLM Sessions list. This differs from
 * `buildAgentTraceFilter`: first find sessions that contain at least one trace
 * for the selected agent, then let the outer sessions query collect every trace
 * in those sessions. That preserves full-conversation totals and first-message
 * derivation while still filtering the visible session list by agent.
 */
export function buildAgentSessionFilter(
  agent: GenAiAgentListItem | null | undefined,
  streamName: string,
  sessionField = "gen_ai_conversation_id",
): string {
  const traceFilter = buildAgentTraceFilter(agent, streamName);
  if (!traceFilter || !sessionField) return "";
  return `${sessionField} IN (SELECT ${sessionField} FROM "${streamName}" WHERE ${sessionField} IS NOT NULL AND ${sessionField} != '' AND ${traceFilter} GROUP BY ${sessionField})`;
}
