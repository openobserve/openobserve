// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export type TracesSqlTemplateView = "traces" | "spans";

export type TracesSqlTemplateId =
  | "slowTraces"
  | "bigTraces"
  | "errorsInTwoServices"
  | "nPlusOne"
  | "missingSpan"
  | "manyServices"
  | "p95ByVersion"
  | "p95ByOperation"
  | "spansPerMinute"
  | "nullAudit"
  | "tokensByModel";

export interface TracesSqlTemplate {
  id: TracesSqlTemplateId;
  sql: string;
  /** Service names filled in from the stream, in the order the SQL uses them. */
  services: string[];
}

// Used only when the stream returns fewer than two service names.
const PLACEHOLDER_SERVICES = ["service-a", "service-b"];

const TOKENS_BY_MODEL_FIELDS = ["gen_ai_request_model", "gen_ai_usage_input_tokens"];

/** The SQL templates offered for a view; trace templates select trace_id, Spans templates aggregate. */
export function tracesSqlTemplates(
  view: TracesSqlTemplateView,
  stream: string,
  schema: { services: string[]; fields: string[] },
): TracesSqlTemplate[] {
  const from = `FROM "${stream.replaceAll('"', '""')}"`;
  if (view === "spans") return spansTemplates(from, schema.fields);
  const pair = [0, 1].map((k) => schema.services[k] ?? PLACEHOLDER_SERVICES[k]);
  const [a, b] = pair.map((name) => `'${name.replaceAll("'", "''")}'`);
  const head = `SELECT trace_id ${from}\nGROUP BY trace_id\nHAVING`;
  return [
    { id: "slowTraces", sql: `${head} max(end_time) - min(start_time) > 2000000000`, services: [] },
    { id: "bigTraces", sql: `${head} count(*) > 200`, services: [] },
    {
      id: "errorsInTwoServices",
      sql:
        `${head} sum(CASE WHEN service_name = ${a}\n  AND span_status = 'ERROR' THEN 1 ELSE 0 END) > 0\n` +
        `  AND sum(CASE WHEN service_name = ${b}\n  THEN 1 ELSE 0 END) > 0`,
      services: pair,
    },
    {
      id: "nPlusOne",
      sql: `SELECT trace_id ${from}\nWHERE span_kind = '3'\nGROUP BY trace_id, reference_parent_span_id\nHAVING count(*) > 50`,
      services: [],
    },
    {
      id: "missingSpan",
      sql:
        `${head} sum(CASE WHEN service_name = ${a}\n  THEN 1 ELSE 0 END) > 0\n` +
        `  AND sum(CASE WHEN service_name = ${b}\n  THEN 1 ELSE 0 END) = 0`,
      services: pair,
    },
    { id: "manyServices", sql: `${head} count(DISTINCT service_name) >= 5`, services: [] },
  ];
}

function spansTemplates(from: string, fields: string[]): TracesSqlTemplate[] {
  const list: TracesSqlTemplate[] = [
    {
      id: "p95ByVersion",
      sql: `SELECT service_service_version,\n  approx_percentile_cont(duration, 0.95) AS p95\n${from} GROUP BY service_service_version`,
      services: [],
    },
    {
      id: "p95ByOperation",
      sql: `SELECT operation_name,\n  approx_percentile_cont(duration, 0.95) AS p95\n${from} GROUP BY operation_name\nORDER BY p95 DESC LIMIT 10`,
      services: [],
    },
    {
      id: "spansPerMinute",
      sql: `SELECT histogram(_timestamp, '1 minute') AS t,\n  service_name, count(*) AS spans\n${from} GROUP BY t, service_name`,
      services: [],
    },
    {
      id: "nullAudit",
      sql:
        `SELECT service_name, count(*) AS spans,\n  count(DISTINCT operation_name) AS operations,\n` +
        `  sum(CASE WHEN http_status_code IS NULL\n  THEN 1 ELSE 0 END) AS no_status\n${from} GROUP BY service_name`,
      services: [],
    },
  ];
  if (TOKENS_BY_MODEL_FIELDS.every((name) => fields.includes(name))) {
    list.push({
      id: "tokensByModel",
      sql: `SELECT gen_ai_request_model,\n  sum(gen_ai_usage_input_tokens) AS input_tokens\n${from} GROUP BY gen_ai_request_model`,
      services: [],
    });
  }
  return list;
}
