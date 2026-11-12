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

// A trace takes any span's attribution value; columns missing from the schema make the query fail, so pass only existing ones.

import { TRACE_ERRORED_SQL } from "./llmTraceOutcome";
import {
  agentFallbackUsage,
  agentParentsJoin,
  llmCallUsageSum,
  MODEL_SERIES_SQL,
  topLevelAgentUsage,
} from "./config/llmInsightsPanels";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

export const ATTRIBUTION_COLUMNS = {
  tenant: "tenant_id",
  feature: "feature_name",
  user: "user_id",
} as const;

export type AttributionDim = keyof typeof ATTRIBUTION_COLUMNS;

/** The attribute a span sets for each dimension (for the setup snippet). */
export const ATTRIBUTION_ATTRIBUTES: Record<AttributionDim, string> = {
  tenant: "tenant.id",
  feature: "feature.name",
  user: "user.id",
};

const where = (scope: string) => (scope ? ` WHERE ${scope}` : "");

/** LLM-call usage, else top-level agent usage, so agent-only SDKs count and nested usage counts once; needs `agentParentsJoin`. */
export const traceUsageSum = (column: string) =>
  `COALESCE(NULLIF(${llmCallUsageSum(column)}, 0), ${topLevelAgentUsage(column)}, 0)`;

const traceUsage =
  `${traceUsageSum("gen_ai_usage_cost")} AS cost, ` +
  `${traceUsageSum("gen_ai_usage_total_tokens")} AS tokens`;

/** The stream's optional columns the usage queries depend on. */
export interface UsageColumns {
  /** Spans record their parent, so the usage rule can find top-level agents (`agentParentsJoin`). */
  hasParentSpan: boolean;
  /** Ingest marks unpriced calls (`unpricedTokensSum`). */
  hasCostStatus?: boolean;
}

/** Unpriced-token total so a cost reads as a lower bound, not a free $0. */
export const unpricedTokensSum = (hasCostStatus: boolean) =>
  hasCostStatus
    ? `COALESCE(${llmCallUsageSum(
        "CASE WHEN gen_ai_usage_cost_status = 'unpriced' THEN gen_ai_usage_total_tokens ELSE 0 END",
      )}, 0)`
    : "0";

/** How many attributed values the rows query fetches (the panel shows the top few). */
const TOP_VALUES = 50;

/** `totals` covers the whole window so shares and the "more" row are not limited to fetched rows. */
export interface AttributionSql {
  rows: string;
  totals: string;
}

function attributionSql(grouped: string): AttributionSql {
  return {
    // The search layer ignores ORDER BY on an expression, so the sort key is projected and sorted by alias.
    rows:
      `SELECT v, cost, tokens, traces, unpriced, CASE WHEN v = '' THEN 0 ELSE 1 END AS unattributed_last ` +
      `FROM (${grouped}) ORDER BY unattributed_last, cost DESC LIMIT ${TOP_VALUES + 1}`,
    totals:
      `SELECT COUNT(*) FILTER (WHERE v != '') AS n_values, SUM(cost) AS cost, ` +
      `SUM(tokens) AS tokens, SUM(traces) AS traces, SUM(unpriced) AS unpriced FROM (${grouped})`,
  };
}

/** Cost, tokens and traces per value; spans with no value land in the '' row. */
export function costByDimensionSql(
  stream: string,
  column: string,
  scope: string,
  cols: UsageColumns,
): AttributionSql {
  return attributionSql(
    `SELECT v, SUM(cost) AS cost, SUM(tokens) AS tokens, COUNT(*) AS traces, ` +
      `SUM(unpriced) AS unpriced FROM (` +
      `SELECT trace_id, COALESCE(MAX(${column}), '') AS v, ${traceUsage}, ` +
      `${unpricedTokensSum(!!cols.hasCostStatus)} AS unpriced ` +
      `FROM "${stream}"${agentParentsJoin(stream, cols.hasParentSpan)}${where(scope)} ` +
      `GROUP BY trace_id) GROUP BY v`,
  );
}

/** Grouped per (trace, model) since one trace can call several models; agent-only usage lands in the '' row. */
export function costByModelSql(stream: string, scope: string, cols: UsageColumns): AttributionSql {
  const scoped = scope ? ` AND (${scope})` : "";
  const cost = "gen_ai_usage_cost";
  const tokens = "gen_ai_usage_total_tokens";
  return attributionSql(
    `SELECT v, SUM(cost) AS cost, SUM(tokens) AS tokens, COUNT(DISTINCT trace_id) AS traces, ` +
      `SUM(unpriced) AS unpriced FROM (` +
      `SELECT trace_id, ${MODEL_SERIES_SQL} AS v, ` +
      `COALESCE(${llmCallUsageSum(cost)}, 0) AS cost, ` +
      `COALESCE(${llmCallUsageSum(tokens)}, 0) AS tokens, ` +
      `${unpricedTokensSum(!!cols.hasCostStatus)} AS unpriced ` +
      `FROM "${stream}" WHERE ${MODEL_SERIES_SQL} IS NOT NULL${scoped} ` +
      `GROUP BY trace_id, ${MODEL_SERIES_SQL} ` +
      `UNION ALL ` +
      `SELECT trace_id, '' AS v, ${agentFallbackUsage(cost)} AS cost, ` +
      `${agentFallbackUsage(tokens)} AS tokens, 0 AS unpriced ` +
      `FROM "${stream}"${agentParentsJoin(stream, cols.hasParentSpan)}${where(scope)} ` +
      `GROUP BY trace_id ` +
      `HAVING ${agentFallbackUsage(cost)} > 0 OR ${agentFallbackUsage(tokens)} > 0) ` +
      `GROUP BY v`,
  );
}

export interface AttributionRow {
  value: string;
  cost: number;
  tokens: number;
  traces: number;
  /** Tokens on unpriced LLM calls: the cost is a lower bound (or unknown) when above 0. */
  unpriced: number;
  share: number;
}

/** The `totals` query's single row: every value in the window, not just the fetched ones. */
export interface AttributionTotals {
  n_values: unknown;
  cost: unknown;
  tokens: unknown;
  traces: unknown;
  unpriced?: unknown;
}

export function toAttributionRows(
  hits: Array<{ v: unknown; cost: unknown; tokens: unknown; traces: unknown; unpriced?: unknown }>,
  totals: AttributionTotals | null | undefined,
  limit = 5,
): {
  rows: AttributionRow[];
  more: AttributionRow | null;
  unattributed: AttributionRow | null;
  total: number;
  attributedShare: number;
} {
  const all = hits.map((h) => ({
    value: String(h.v ?? ""),
    cost: Number(h.cost) || 0,
    tokens: Number(h.tokens) || 0,
    traces: Number(h.traces) || 0,
    unpriced: Number(h.unpriced) || 0,
    share: 0,
  }));
  const total = Number(totals?.cost) || 0;
  const withShare = (r: AttributionRow) => ({ ...r, share: total > 0 ? r.cost / total : 0 });
  const attributed = all.filter((r) => r.value);
  const rows = attributed.slice(0, limit).map(withShare);
  const unattributedRow = all.find((r) => !r.value);
  const sum = (key: "cost" | "tokens" | "traces" | "unpriced") =>
    rows.reduce((s, r) => s + r[key], 0) + (unattributedRow?.[key] ?? 0);
  const moreCount = (Number(totals?.n_values) || 0) - rows.length;
  const more =
    moreCount > 0
      ? withShare({
          value: String(moreCount),
          cost: Math.max(0, total - sum("cost")),
          tokens: Math.max(0, (Number(totals?.tokens) || 0) - sum("tokens")),
          traces: Math.max(0, (Number(totals?.traces) || 0) - sum("traces")),
          unpriced: Math.max(0, (Number(totals?.unpriced) || 0) - sum("unpriced")),
          share: 0,
        })
      : null;
  return {
    rows,
    more,
    unattributed: unattributedRow ? withShare(unattributedRow) : null,
    total,
    attributedShare: total > 0 ? Math.max(0, total - (unattributedRow?.cost ?? 0)) / total : 0,
  };
}

export function usersSql(
  stream: string,
  opts: {
    scope: string;
    tenantColumn: string | null;
    tenant?: string;
    search?: string;
  } & UsageColumns,
): string {
  const tenantExpr = opts.tenantColumn ? `MAX(${opts.tenantColumn})` : "''";
  const filters = ["user_id IS NOT NULL", "user_id != ''"];
  if (opts.tenant) filters.push(`tenant = ${sqlLiteral(opts.tenant)}`);
  if (opts.search) {
    // Escape `\`, `%` and `_` so the term matches literally.
    const term = opts.search.toLowerCase().replace(/[\\%_]/g, "\\$&");
    filters.push(`LOWER(user_id) LIKE ${sqlLiteral(`%${term}%`)}`);
  }
  return (
    `SELECT user_id, MAX(tenant) AS tenant, COUNT(DISTINCT session) AS sessions, ` +
    `SUM(tokens) AS tokens, SUM(cost) AS cost, SUM(unpriced) AS unpriced, ` +
    `100.0 * SUM(failed) / COUNT(*) AS failure_rate, ` +
    `MAX(last_ts) AS last_seen FROM (` +
    `SELECT trace_id, MAX(user_id) AS user_id, ${tenantExpr} AS tenant, ` +
    `MAX(gen_ai_conversation_id) AS session, ${traceUsage}, ` +
    `${unpricedTokensSum(!!opts.hasCostStatus)} AS unpriced, ` +
    `${TRACE_ERRORED_SQL} AS failed, MAX(_timestamp) AS last_ts ` +
    `FROM "${stream}"${agentParentsJoin(stream, opts.hasParentSpan)}${where(opts.scope)} ` +
    `GROUP BY trace_id) ` +
    `WHERE ${filters.join(" AND ")} GROUP BY user_id ORDER BY cost DESC LIMIT ${USERS_LIMIT}`
  );
}

/** The most users the Users page lists (by cost); a full page means there may be more. */
export const USERS_LIMIT = 200;

/** Share of traces carrying each column (the coverage that says a breakdown can be trusted). */
export function coverageSql(stream: string, columns: string[], scope: string): string {
  const per = columns.map((c) => `SUM(${c}_set) AS ${c}`);
  const inner = columns.map(
    (c) => `MAX(CASE WHEN ${c} IS NOT NULL AND ${c} != '' THEN 1 ELSE 0 END) AS ${c}_set`,
  );
  return (
    `SELECT ${["COUNT(*) AS traces", ...per].join(", ")} FROM (` +
    `SELECT ${["trace_id", ...inner].join(", ")} FROM "${stream}"${where(scope)} GROUP BY trace_id)`
  );
}
