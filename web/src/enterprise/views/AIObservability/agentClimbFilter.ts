import { escapeSingleQuotes } from "@/utils/queryUtils";

/**
 * Pure builder for the agent-scoping predicate used by the Behavior
 * drill-down drawer (AgentSignalDetailPanel.vue). Scopes by the CLIMBED
 * agent (via `callerExpr`, e.g. COALESCE(...)) and, when present, further
 * narrows to the selected env/version variant using the raw canonical span
 * columns `c.gen_ai_agent_env` / `c.gen_ai_agent_version`.
 *
 * Backward compatible: when both env and version are absent, the output is
 * byte-identical to the pre-existing agent-only predicate.
 */
export const buildAgentClimbFilter = (
  callerExpr: string,
  agent: string | undefined,
  variant: { env?: string | null; version?: string | null } = {},
): string => {
  const clauses = [agent ? `${callerExpr} = '${escapeSingleQuotes(agent)}'` : "1=1"];
  if (variant.version)
    clauses.push(`c.gen_ai_agent_version = '${escapeSingleQuotes(variant.version)}'`);
  if (variant.env) clauses.push(`c.gen_ai_agent_env = '${escapeSingleQuotes(variant.env)}'`);
  return clauses.join(" AND ");
};
