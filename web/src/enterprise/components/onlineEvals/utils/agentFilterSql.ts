import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { formatAgentOption } from "@/plugins/traces/agentOptionFormat";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

export const ALL_AGENTS_VALUE = "__all__";

export type AgentFilterSelection = GenAiAgentListItem;

export function agentFilterKey(agent: AgentFilterSelection): string {
  const identity = agent.id ? `id:${agent.id}` : `name:${agent.name}`;
  return `${agent.source_stream_type}/${agent.source_stream}/${identity}`;
}

export function agentFilterLabel(agent: AgentFilterSelection): string {
  // Display the agent identity plus env/version — the source stream is part of
  // the filter KEY (see agentFilterKey) for uniqueness, but it's noise in the
  // dropdown. Delegates to the shared formatter so all agent dropdowns match.
  return formatAgentOption(agent);
}

// `_evaluator` carries the target agent on every run, so a selected agent filters inline, id before name.
export function buildEvaluatorAgentFilterWhere(
  agent: Pick<AgentFilterSelection, "id" | "name"> | null | undefined,
): string | null {
  if (!agent) return null;
  const field = agent.id ? "attributes_target_agent_id" : "attributes_target_agent_name";
  const value = agent.id ?? agent.name;
  if (!value) return null;
  return `${field} = ${sqlLiteral(value)}`;
}

export function combineWhere(...clauses: Array<string | null | undefined>): string | null {
  const filtered = clauses.filter((clause): clause is string => Boolean(clause));
  if (filtered.length === 0) return null;
  return filtered.map((clause) => `(${clause})`).join(" AND ");
}
