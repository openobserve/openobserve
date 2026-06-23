import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

export const ALL_AGENTS_VALUE = "__all__";

export type AgentFilterSelection = GenAiAgentListItem;

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeSqlIdentifier(value: string): string {
  return value.replace(/"/g, '""');
}

function sourceTableReference(agent: AgentFilterSelection): string {
  const stream = `"${escapeSqlIdentifier(agent.source_stream)}"`;
  if (!agent.source_stream_type) return stream;
  return `"${escapeSqlIdentifier(agent.source_stream_type)}".${stream}`;
}

export function agentFilterKey(agent: AgentFilterSelection): string {
  const identity = agent.id ? `id:${agent.id}` : `name:${agent.name}`;
  return `${agent.source_stream_type}/${agent.source_stream}/${identity}`;
}

export function agentFilterLabel(agent: AgentFilterSelection): string {
  // Display the agent identity only — the source stream is part of the filter
  // KEY (see agentFilterKey) for uniqueness, but it's noise in the dropdown.
  return agent.id ? `${agent.name} (${agent.id})` : agent.name;
}

function sourceTraceIdSubquery(agent: AgentFilterSelection): string {
  const field = agent.id ? "gen_ai_agent_id" : "gen_ai_agent_name";
  const value = agent.id ?? agent.name;
  return [
    "SELECT trace_id",
    `FROM ${sourceTableReference(agent)}`,
    `WHERE ${field} = '${escapeSqlString(value)}'`,
    "GROUP BY trace_id",
  ].join("\n");
}

export function buildScoresAgentFilterWhere(
  agent: AgentFilterSelection | null | undefined,
): string | null {
  if (!agent) return null;
  return [
    `source_stream = '${escapeSqlString(agent.source_stream)}'`,
    `source_stream_type = '${escapeSqlString(agent.source_stream_type)}'`,
    `trace_id IN (${sourceTraceIdSubquery(agent)})`,
  ].join(" AND ");
}

export function buildEvaluatorAgentFilterWhere(
  agent: AgentFilterSelection | null | undefined,
): string | null {
  if (!agent) return null;
  return [
    `attributes_target_stream = '${escapeSqlString(agent.source_stream)}'`,
    `attributes_target_stream_type = '${escapeSqlString(agent.source_stream_type)}'`,
    `attributes_target_trace_id IN (${sourceTraceIdSubquery(agent)})`,
  ].join(" AND ");
}

export function combineWhere(
  ...clauses: Array<string | null | undefined>
): string | null {
  const filtered = clauses.filter((clause): clause is string =>
    Boolean(clause),
  );
  if (filtered.length === 0) return null;
  return filtered.map((clause) => `(${clause})`).join(" AND ");
}
