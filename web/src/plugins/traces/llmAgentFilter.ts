// Copyright 2026 OpenObserve Inc.
//
// Agent filtering for the LLM Insights dashboard.
//
// When an agent is selected on the LLM Insights dashboard, every query against
// the agent's source trace stream can be scoped directly to that agent. Ingest
// writes the canonical gen_ai_agent_id / gen_ai_agent_name fields onto spans, so
// the dashboard does not need to resolve matching trace ids with a subquery.

import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

/** Sentinel option value for the "All Agents" selection (no filter). */
export const ALL_AGENTS_VALUE = "__all__";

/**
 * Stable identity key for an agent option. The same agent name/id can appear in
 * multiple streams, so the key is scoped by stream + identity. Agent id is
 * preferred over name because names are display labels.
 */
export function agentOptionKey(agent: GenAiAgentListItem): string {
  return `${agent.source_stream_type}/${agent.source_stream}/${agent.id ?? agent.name}`;
}

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build the source-stream agent predicate for LLM Insights queries.
 * Returns the bare predicate (no leading `AND`/`WHERE`) so call sites can splice
 * it where appropriate, or an empty string when no agent is selected.
 *
 *   gen_ai_agent_id = '<id>'   -- or gen_ai_agent_name = '<name>'
 */
export function buildAgentTraceFilter(
  agent: GenAiAgentListItem | null | undefined,
  streamName: string,
): string {
  if (!agent || !streamName) return "";
  const field = agent.id ? "gen_ai_agent_id" : "gen_ai_agent_name";
  const value = agent.id ?? agent.name;
  if (!value) return "";
  return `${field} = '${sqlQuote(String(value))}'`;
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
