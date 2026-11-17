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

// Periods are rolling windows the alert evaluates, not calendar boundaries; unpriced spans are never counted as $0.

import { SEVERITY_TO_PRIORITY } from "@/constants/alertLibrary";
import { traceUsageSum } from "@/plugins/traces/llmAttribution";
import { agentParentsJoin, llmCallUsageSum } from "@/plugins/traces/config/llmInsightsPanels";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

export const BUDGET_PACK = "ai-budgets";

// "user" is the per-user cap (each user apart); "oneUser" budgets one named user.
export type BudgetScope = "agent" | "feature" | "oneUser" | "user" | "model" | "session";
export type BudgetPeriod = "day" | "month" | "hour";

export interface BudgetDef {
  name: string;
  scope: BudgetScope;
  /** The agent, feature, user or model; empty for per-user and per-session budgets. */
  value: string;
  limitUsd: number;
  period: BudgetPeriod;
  stream: string;
}

/** Column each scope groups or filters on (the cost attribution keys). */
export const BUDGET_COLUMNS: Record<BudgetScope, string> = {
  agent: "gen_ai_agent_name",
  feature: "feature_name",
  oneUser: "user_id",
  user: "user_id",
  model: "gen_ai_response_model",
  session: "gen_ai_conversation_id",
};

/** Per-user and session budgets apply to each key separately. */
export const isEach = (scope: BudgetScope) => scope === "user" || scope === "session";

export const PERIOD_MINUTES: Record<BudgetPeriod, number> = {
  hour: 60,
  day: 1440,
  month: 43200,
};

/** Ratio of the limit at which a budget turns warning; critical is the limit itself. */
export const WARN_RATIO = 0.8;

/** GROUP BY columns stay unaliased: a SQL multi-alert requires each projected under its own name. */
export function budgetSql(b: BudgetDef, hasParentSpan: boolean): string {
  const col = BUDGET_COLUMNS[b.scope];
  const tail = `GROUP BY ${col} ORDER BY spent DESC`;
  const cost = `${traceUsageSum("gen_ai_usage_cost")} AS cost`;
  const spans = `"${b.stream}"${agentParentsJoin(b.stream, hasParentSpan)}`;
  if (isEach(b.scope)) {
    return (
      `SELECT ${col}, SUM(cost) AS spent FROM (` +
      `SELECT trace_id, MAX(${col}) AS ${col}, ${cost} FROM ${spans} GROUP BY trace_id) ` +
      `WHERE ${col} IS NOT NULL AND ${col} != '' ${tail}`
    );
  }
  const match = `${col} = ${sqlLiteral(b.value)}`;
  if (b.scope === "model") {
    // Only LLM calls: an agent span carrying the model repeats its children's cost.
    return `SELECT ${col}, ${llmCallUsageSum("gen_ai_usage_cost")} AS spent FROM "${b.stream}" WHERE ${match} ${tail}`;
  }
  // Whole traces count, so a sub-agent's budget sees traces whose root names another agent.
  return (
    `SELECT ${col}, SUM(cost) AS spent FROM (` +
    `SELECT trace_id, MAX(CASE WHEN ${match} THEN ${col} END) AS ${col}, ${cost} ` +
    `FROM ${spans} WHERE trace_id IN (SELECT trace_id FROM "${b.stream}" WHERE ${match}) ` +
    `GROUP BY trace_id) WHERE ${match} ${tail}`
  );
}

/** The alert name a budget is stored under. */
export const budgetAlertName = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]+/g, "_");

/** Compared as stored alert names, so "a b" and "a_b" collide. */
export function budgetNameTaken(
  name: string,
  budgets: readonly { name: string }[],
  editing?: string,
): boolean {
  const want = budgetAlertName(name);
  if (!want || (editing != null && budgetAlertName(editing) === want)) return false;
  return budgets.some((b) => budgetAlertName(b.name) === want);
}

/** A column the stream never received cannot be budgeted: the alert's query would fail. */
export function budgetMissingField(
  scope: BudgetScope,
  fields: readonly { name: string }[],
): string | null {
  const col = BUDGET_COLUMNS[scope];
  return fields.some((f) => f.name === col) ? null : col;
}

/** The budget's alert, tagged so the Budgets page finds it. */
export function budgetAlertPayload(
  b: BudgetDef,
  opts: {
    folderId: string;
    destination: string;
    owner: string;
    timezone: string;
    /** The stream stores span parents (`budgetSql`). */
    hasParentSpan: boolean;
  },
) {
  return {
    name: budgetAlertName(b.name),
    stream_type: "traces",
    stream_name: b.stream,
    is_real_time: false,
    enabled: true,
    destinations: opts.destination ? [opts.destination] : [],
    query_condition: {
      type: "sql",
      sql: budgetSql(b, opts.hasParentSpan),
      conditions: null,
      // SQL multi-alert: the backend derives group_by from the SQL; function is fixed.
      aggregation: {
        group_by: [],
        function: "count",
        having: { column: "spent", operator: ">=", value: b.limitUsd, ignore_case: false },
        warning_value: warningValue(b.limitUsd),
        multi_alert: true,
      },
      promql: null,
      promql_condition: null,
      vrl_function: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: PERIOD_MINUTES[b.period],
      // A multi-alert's count gate is "any group".
      operator: ">=",
      threshold: 1,
      frequency: b.period === "hour" ? 5 : 15,
      silence: b.period === "hour" ? 60 : 240,
      timezone: opts.timezone,
      tolerance_in_secs: null,
    },
    folder_id: opts.folderId,
    owner: opts.owner,
    last_edited_by: opts.owner,
    tags: [`pack:${BUDGET_PACK}`],
    context_attributes: {
      budget_name: b.name,
      budget_scope: b.scope,
      budget_value: b.value,
      budget_limit_usd: String(b.limitUsd),
      budget_period: b.period,
    },
    priority: SEVERITY_TO_PRIORITY.critical,
  };
}

/** The limit lives in the SQL, `having.value`, the warning value and `context_attributes`; all must move together. */
export function budgetAlertUpdate(
  stored: Record<string, any>,
  b: BudgetDef,
  opts: { destination: string; editor: string; hasParentSpan: boolean },
) {
  const next = budgetAlertPayload(b, {
    folderId: stored.folder_id,
    destination: opts.destination,
    owner: stored.owner,
    timezone: stored.trigger_condition?.timezone ?? "UTC",
    hasParentSpan: opts.hasParentSpan,
  });
  const trigger = stored.trigger_condition ?? {};
  return {
    ...stored,
    name: next.name,
    stream_name: next.stream_name,
    destinations: [
      ...new Set([...next.destinations, ...((stored.destinations as string[]) ?? []).slice(1)]),
    ],
    query_condition: {
      ...stored.query_condition,
      sql: next.query_condition.sql,
      aggregation: {
        ...stored.query_condition?.aggregation,
        having: {
          ...stored.query_condition?.aggregation?.having,
          ...next.query_condition.aggregation.having,
        },
        warning_value: next.query_condition.aggregation.warning_value,
      },
    },
    trigger_condition:
      trigger.period === next.trigger_condition.period
        ? trigger
        : {
            ...trigger,
            period: next.trigger_condition.period,
            frequency: next.trigger_condition.frequency,
            silence: next.trigger_condition.silence,
          },
    context_attributes: { ...stored.context_attributes, ...next.context_attributes },
    last_edited_by: opts.editor,
  };
}

/** The fields of a stored alert a budget is read back from. */
export interface BudgetAlert {
  stream_name?: string;
  context_attributes?: Record<string, string> | null;
  query_condition?: { aggregation?: unknown } | null;
}

/** Legacy budgets have no aggregation to move the limit in, so an edit deletes and re-creates them. */
export const isLegacyBudgetAlert = (alert: BudgetAlert | null | undefined): boolean =>
  !!alert && !alert.query_condition?.aggregation;

const LEGACY_SUFFIX = /_(warn|over)$/;

export function mergeLegacyBudgets<
  T extends BudgetDef & { legacy: boolean; alertIds: string[]; alertName: string },
>(defs: readonly T[]): T[] {
  const out: T[] = [];
  const pairOf = (a: T, b: T) => {
    const ma = LEGACY_SUFFIX.exec(a.alertName);
    const mb = LEGACY_SUFFIX.exec(b.alertName);
    return (
      !!ma &&
      !!mb &&
      ma[1] !== mb[1] &&
      a.alertName.slice(0, ma.index) === b.alertName.slice(0, mb.index) &&
      a.name === b.name &&
      a.stream === b.stream &&
      a.scope === b.scope &&
      a.value === b.value &&
      a.limitUsd === b.limitUsd &&
      a.period === b.period
    );
  };
  for (const d of defs) {
    const twin = d.legacy
      ? out.find((o) => o.legacy && o.alertIds.length === 1 && pairOf(o, d))
      : undefined;
    if (twin) twin.alertIds = [...twin.alertIds, ...d.alertIds];
    else out.push({ ...d });
  }
  return out;
}

const isScope = (v: unknown): v is BudgetScope =>
  typeof v === "string" && Object.hasOwn(BUDGET_COLUMNS, v);
const isPeriod = (v: unknown): v is BudgetPeriod =>
  typeof v === "string" && Object.hasOwn(PERIOD_MINUTES, v);

/** A budget read back from its alert; null for any other alert in the folder. */
export function budgetFromAlert(alert: BudgetAlert | null | undefined): BudgetDef | null {
  const c = alert?.context_attributes ?? {};
  if (!c.budget_name || !isScope(c.budget_scope) || !isPeriod(c.budget_period)) return null;
  return {
    name: c.budget_name,
    scope: c.budget_scope,
    value: c.budget_value ?? "",
    limitUsd: Number(c.budget_limit_usd) || 0,
    period: c.budget_period,
    stream: alert?.stream_name ?? "",
  };
}

export type BudgetState = "under" | "warning" | "over";

export function budgetState(spent: number, limit: number): BudgetState {
  if (limit <= 0) return "under";
  if (spent >= limit) return "over";
  return spent >= WARN_RATIO * limit ? "warning" : "under";
}

/** Never rounded to fixed decimals: that lifts a sub-cent limit's warning onto the limit, which the backend refuses. */
export function warningValue(limitUsd: number): number {
  return +(limitUsd * WARN_RATIO).toPrecision(12);
}

/** Sub-cent amounts use two significant digits so they never read $0.00. */
export function formatBudgetUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${+value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}

export function budgetSummarySql(b: BudgetDef, hasParentSpan: boolean): string {
  return (
    `SELECT COUNT(*) AS key_count, ` +
    `SUM(CASE WHEN spent >= ${b.limitUsd} THEN 1 ELSE 0 END) AS over_count, ` +
    `SUM(spent) AS spent, MAX(spent) AS largest FROM (${budgetSql(b, hasParentSpan)})`
  );
}

/** One row of {@link budgetSql}, or for a per-key budget the row of {@link budgetSummarySql}. */
export interface BudgetRow {
  spent?: unknown;
  key_count?: unknown;
  over_count?: unknown;
  largest?: unknown;
}

/** Spend of a budget from its rows: the total, or the largest key and how many keys are over. */
export function budgetSpend(
  b: BudgetDef,
  rows: readonly BudgetRow[],
): { spent: number; over: number; largest: number; keys: number } {
  if (!isEach(b.scope)) {
    const spent = Number(rows[0]?.spent) || 0;
    return { spent, over: spent >= b.limitUsd ? 1 : 0, largest: spent, keys: 1 };
  }
  const r = rows[0];
  return {
    spent: Number(r?.spent) || 0,
    over: Number(r?.over_count) || 0,
    largest: Number(r?.largest) || 0,
    keys: Number(r?.key_count) || 0,
  };
}

/** Why a budget's spend is unknown: no read access to its stream, or any other failed query. */
export type SpendError = "forbidden" | "failed";

/** The spend query's error, as streamed (`status`, `code`) or from axios (`response.status`). */
export function spendError(e: unknown): SpendError {
  const err = e as { status?: number; code?: number; response?: { status?: number } } | null;
  return err?.status === 403 || err?.code === 403 || err?.response?.status === 403
    ? "forbidden"
    : "failed";
}

export interface BudgetReading {
  /** Set when the spend could not be read; the numbers are then not a reading. */
  error: SpendError | null;
  spent: number;
  over: number;
  largest: number;
  keys: number;
  /** What the bar shows: the total, or the largest key of a per-key budget. */
  shown: number;
  /** Null with `error`: an unread spend has no state, least of all "under". */
  state: BudgetState | null;
}

/** A budget's live reading from its rows, or from the error its spend query failed with. */
export function budgetReading(
  b: BudgetDef,
  result: readonly BudgetRow[] | SpendError,
): BudgetReading {
  if (typeof result === "string") {
    return { error: result, spent: 0, over: 0, largest: 0, keys: 0, shown: 0, state: null };
  }
  const s = budgetSpend(b, result);
  const each = isEach(b.scope);
  return {
    error: null,
    ...s,
    shown: each ? s.largest : s.spent,
    state: each
      ? s.over > 0
        ? "over"
        : budgetState(s.largest, b.limitUsd)
      : budgetState(s.spent, b.limitUsd),
  };
}
