import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { formatAgentOption } from "@/plugins/traces/agentOptionFormat";

export const ALL_AGENTS_VALUE = "__all__";

export type AgentFilterSelection = GenAiAgentListItem;

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

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

// `_llm_scores` and `_evaluator` carry the agent identity denormalized onto
// every row at ingest, so a selected agent is filtered inline on those columns
// — no trace_id subquery against the source stream. Agent id is preferred over
// name (names are display labels); we fall back to name only when id is absent.
export function buildScoresAgentFilterWhere(
  agent: AgentFilterSelection | null | undefined,
): string | null {
  if (!agent) return null;
  const field = agent.id ? "agent_id" : "agent_name";
  const value = agent.id ?? agent.name;
  if (!value) return null;
  // env/version are denormalized onto every _llm_scores row (agent_env /
  // agent_version), so a selected (agent, env, version) variant filters by exact
  // match — same as agent_id. Rows written before this change have NULL columns
  // and won't match a version filter until the target is re-evaluated.
  const clauses = [`${field} = '${escapeSqlString(String(value))}'`];
  if (agent.version) {
    clauses.push(`agent_version = '${escapeSqlString(String(agent.version))}'`);
  }
  if (agent.env) {
    clauses.push(`agent_env = '${escapeSqlString(String(agent.env))}'`);
  }
  return clauses.join(" AND ");
}

export function buildEvaluatorAgentFilterWhere(
  agent: AgentFilterSelection | null | undefined,
): string | null {
  if (!agent) return null;
  const field = agent.id ? "attributes_target_agent_id" : "attributes_target_agent_name";
  const value = agent.id ?? agent.name;
  if (!value) return null;
  return `${field} = '${escapeSqlString(String(value))}'`;
}

export function combineWhere(...clauses: Array<string | null | undefined>): string | null {
  const filtered = clauses.filter((clause): clause is string => Boolean(clause));
  if (filtered.length === 0) return null;
  return filtered.map((clause) => `(${clause})`).join(" AND ");
}
