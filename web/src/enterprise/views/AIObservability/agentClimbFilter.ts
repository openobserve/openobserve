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

/**
 * Columns that can hold a failed span's error text, first match wins. Mirrors
 * the default `error_detail_fields` of the rollup's failure taxonomy
 * (o2-enterprise agent_signals_taxonomy.json).
 */
export const ERROR_DETAIL_FIELDS = [
  "status_message",
  "error_message",
  "error_type",
  "exception_message",
  "exception_type",
];

/**
 * The error text of span `c`: a COALESCE over the detail columns the stream
 * has (a query naming a missing column fails), or null when it has none.
 */
export const errorDetailExpr = (columns: ReadonlySet<string>): string | null => {
  const parts = ERROR_DETAIL_FIELDS.filter((f) => columns.has(f)).map((f) => `NULLIF(c.${f}, '')`);
  return parts.length ? `COALESCE(${parts.join(", ")})` : null;
};

/**
 * The failure drill-down queries. They cover every ERROR span of the agent,
 * not one failure class: the rollup's class taxonomy is resolved server-side
 * per org and is not exposed to the web app. Counts are of distinct spans,
 * because the ancestor LEFT JOINs repeat a child row for each duplicate parent.
 */
export const failureErrorsSql = (
  stream: string,
  joins: string,
  agentFilter: string,
  detail: string,
): string =>
  `SELECT ${detail} AS message, COUNT(DISTINCT c.span_id) AS occurrences, approx_distinct(c.trace_id) AS traces FROM "${stream}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${agentFilter} AND ${detail} IS NOT NULL GROUP BY ${detail} ORDER BY occurrences DESC LIMIT 20`;

export const failureTracesSql = (stream: string, joins: string, agentFilter: string): string =>
  `SELECT c.trace_id AS trace_id, COUNT(DISTINCT c.span_id) AS spans FROM "${stream}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${agentFilter} GROUP BY c.trace_id ORDER BY spans DESC LIMIT 50`;
