import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { UNSET } from "@/enterprise/composables/useAgentScope";

/** Without env and version the output is byte-identical to the old agent-only predicate; UNSET pins "not set". */
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

/** Mirrors the rollup's default `error_detail_fields` (o2-enterprise agent_signals_taxonomy.json). */
export const ERROR_DETAIL_FIELDS = [
  "status_message",
  "error_message",
  "error_type",
  "exception_message",
  "exception_type",
];

/** Only columns the stream has are coalesced, since naming a missing column fails the query. */
export const errorDetailExpr = (columns: ReadonlySet<string>): string | null => {
  const parts = ERROR_DETAIL_FIELDS.filter((f) => columns.has(f)).map((f) => `NULLIF(c.${f}, '')`);
  return parts.length ? `COALESCE(${parts.join(", ")})` : null;
};

/** Counts distinct spans, because the ancestor LEFT JOINs repeat a child row per duplicate parent. */
export const failureErrorsSql = (
  stream: string,
  joins: string,
  agentFilter: string,
  detail: string,
): string =>
  `SELECT ${detail} AS message, COUNT(DISTINCT c.span_id) AS occurrences, approx_distinct(c.trace_id) AS traces FROM "${stream}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${agentFilter} AND ${detail} IS NOT NULL GROUP BY ${detail} ORDER BY occurrences DESC LIMIT 20`;

export const failureTracesSql = (stream: string, joins: string, agentFilter: string): string =>
  `SELECT c.trace_id AS trace_id, COUNT(DISTINCT c.span_id) AS spans FROM "${stream}" AS c ${joins} WHERE c.span_status = 'ERROR' AND ${agentFilter} GROUP BY c.trace_id ORDER BY spans DESC LIMIT 50`;

/** Distinct span ids, so duplicated traces or ancestors do not multiply the repeats. */
export const loopTracesSql = (
  stream: string,
  joins: string,
  agentFilter: string,
  tool: string,
): string =>
  `SELECT c.trace_id AS trace_id, COUNT(DISTINCT c.span_id) AS repeats FROM "${stream}" AS c ${joins} WHERE c.gen_ai_tool_name = ${sqlLiteral(tool)} AND c.gen_ai_operation_name = 'execute_tool' AND ${agentFilter} GROUP BY c.trace_id ORDER BY repeats DESC LIMIT 50`;
