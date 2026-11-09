import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { UNSET } from "@/enterprise/composables/useAgentScope";

/**
 * Pure builder for the agent-scoping predicate used by the Behavior
 * drill-down drawer (AgentSignalDetailPanel.vue). Scopes by the CLIMBED
 * agent (via `callerExpr`, e.g. COALESCE(...)) and, when present, further
 * narrows to the selected env/version variant using the raw canonical span
 * columns `c.gen_ai_agent_env` / `c.gen_ai_agent_version`.
 *
 * Backward compatible: when both env and version are absent, the output is
 * byte-identical to the pre-existing agent-only predicate. UNSET pins a
 * dimension to "not set", for a variant that has no env or version.
 */
export const buildAgentClimbFilter = (
  callerExpr: string,
  agent: string | undefined,
  variant: { env?: string | null; version?: string | null } = {},
): string => {
  const clauses = [agent ? `${callerExpr} = ${sqlLiteral(agent)}` : "1=1"];
  const pin = (column: string, value?: string | null) => {
    if (value === UNSET) clauses.push(`(${column} IS NULL OR ${column} = '')`);
    else if (value) clauses.push(`${column} = ${sqlLiteral(value)}`);
  };
  pin("c.gen_ai_agent_version", variant.version);
  pin("c.gen_ai_agent_env", variant.env);
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

/**
 * The loop drill-down: each trace's calls of `tool` by the agent, worst first.
 * Distinct span ids, so a trace exported twice (or a duplicated ancestor in the
 * LEFT JOINs) does not multiply the repeats.
 */
export const loopTracesSql = (
  stream: string,
  joins: string,
  agentFilter: string,
  tool: string,
): string =>
  `SELECT c.trace_id AS trace_id, COUNT(DISTINCT c.span_id) AS repeats FROM "${stream}" AS c ${joins} WHERE c.gen_ai_tool_name = ${sqlLiteral(tool)} AND c.gen_ai_operation_name = 'execute_tool' AND ${agentFilter} GROUP BY c.trace_id ORDER BY repeats DESC LIMIT 50`;
