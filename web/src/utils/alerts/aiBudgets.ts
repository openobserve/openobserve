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

/**
 * Cost budgets (AIO-38), on the alert engine: a budget is one SQL multi-alert
 * on the trace stream's cost columns, one group per budget key. Each group's
 * `spent` is classified warning at 80% and critical at 100% of the limit. Both
 * levels go to the alert's destinations; a gateway webhook tells them apart by
 * the payload's alert level and stops the calls on critical. OpenObserve stays
 * out of the request path (D1).
 *
 * Periods are rolling windows the alert evaluates (the last day, the last 30
 * days, or the last hour for a session's burn rate), not calendar boundaries.
 * Unpriced spans carry no cost, so a budget never counts them as $0 spend —
 * the page names them instead.
 */

import { SEVERITY_TO_PRIORITY } from "@/constants/alertLibrary";
import { traceUsageSum } from "@/plugins/traces/llmAttribution";

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

/** Column each scope groups or filters on (attribution keys from AIO-27). */
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

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Ratio of the limit at which a budget turns warning; critical is the limit itself. */
export const WARN_RATIO = 0.8;

/**
 * Spend in the period, one row per key (`spent`, grouped on the scope's column). The column stays
 * unaliased: a SQL multi-alert requires every GROUP BY field projected under its own name. Worst
 * first, so the alert's bounded page holds the most-over keys.
 *
 * Agent, feature, user and session keys are attributed per trace, so cost on unlabelled LLM-call
 * children still counts: a trace counts its whole usage (`traceUsageSum`). A one-value budget
 * counts every trace with a span carrying the value; an "each" budget gives a trace to the value
 * its spans carry (`MAX`), as Users does. A model is set on each LLM call, so model budgets stay
 * per span.
 */
export function budgetSql(b: BudgetDef, limit?: number): string {
  const col = BUDGET_COLUMNS[b.scope];
  const tail = `GROUP BY ${col} ORDER BY spent DESC${limit ? ` LIMIT ${limit}` : ""}`;
  const cost = `${traceUsageSum("gen_ai_usage_cost")} AS cost`;
  if (isEach(b.scope)) {
    return (
      `SELECT ${col}, SUM(cost) AS spent FROM (` +
      `SELECT trace_id, MAX(${col}) AS ${col}, ${cost} FROM "${b.stream}" GROUP BY trace_id) ` +
      `WHERE ${col} IS NOT NULL AND ${col} != '' ${tail}`
    );
  }
  const match = `${col} = ${quote(b.value)}`;
  if (b.scope === "model") {
    return `SELECT ${col}, SUM(gen_ai_usage_cost) AS spent FROM "${b.stream}" WHERE ${match} ${tail}`;
  }
  // Every trace with a span carrying the value counts whole, as the agent pack's scope does: a
  // sub-agent's budget sees the traces it ran in even when another agent's name is on the root.
  return (
    `SELECT ${col}, SUM(cost) AS spent FROM (` +
    `SELECT trace_id, MAX(CASE WHEN ${match} THEN ${col} END) AS ${col}, ${cost} ` +
    `FROM "${b.stream}" WHERE trace_id IN (SELECT trace_id FROM "${b.stream}" WHERE ${match}) ` +
    `GROUP BY trace_id) WHERE ${match} ${tail}`
  );
}

/** The alert name a budget is stored under. */
export const budgetAlertName = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]+/g, "_");

/**
 * Whether `name` is already one of `budgets`. Compared as stored alert names,
 * so "a b" and "a_b" count as the same budget. While a budget is edited, its
 * own name (`editing`) stays free.
 */
export function budgetNameTaken(
  name: string,
  budgets: readonly { name: string }[],
  editing?: string,
): boolean {
  const want = budgetAlertName(name);
  if (!want || (editing != null && budgetAlertName(editing) === want)) return false;
  return budgets.some((b) => budgetAlertName(b.name) === want);
}

/** The budget's alert, tagged so the Budgets page finds it. */
export function budgetAlertPayload(
  b: BudgetDef,
  opts: {
    folderId: string;
    destination: string;
    owner: string;
    timezone: string;
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
      sql: budgetSql(b),
      conditions: null,
      // SQL multi-alert: the backend derives group_by from the SQL; function is fixed.
      aggregation: {
        group_by: [],
        function: "count",
        having: { column: "spent", operator: ">=", value: b.limitUsd, ignore_case: false },
        warning_value: +(b.limitUsd * WARN_RATIO).toFixed(4),
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

/**
 * A stored budget alert changed to `b`. Every place the budget lives moves
 * together: the SQL, the critical threshold (`having.value`), the warning value
 * and `context_attributes`, which the page reads the limit back from. Anything
 * else set on the alert since (owner, extra destinations, its schedule while the
 * period is unchanged) is kept; `destination` replaces only the first one.
 */
export function budgetAlertUpdate(
  stored: Record<string, any>,
  b: BudgetDef,
  opts: { destination: string; editor: string },
) {
  const next = budgetAlertPayload(b, {
    folderId: stored.folder_id,
    destination: opts.destination,
    owner: stored.owner,
    timezone: stored.trigger_condition?.timezone ?? "UTC",
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

/**
 * A budget from before the one-alert design: a `<name>_warn` / `<name>_over`
 * pair of plain alerts, the threshold in the SQL's HAVING and no aggregation.
 * An edit has no aggregation to move the limit in, so it is deleted and re-created.
 */
export const isLegacyBudgetAlert = (alert: BudgetAlert | null | undefined): boolean =>
  !!alert && !alert.query_condition?.aggregation;

const LEGACY_SUFFIX = /_(warn|over)$/;

/**
 * One budget per legacy pair: a `<x>_warn` and an `<x>_over` alert of the same budget (name,
 * stream, scope, value, limit and period) merge into one row, deleted together. Any other legacy
 * alert, such as a second budget that reused the name, stays its own row.
 */
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

/** One row of {@link budgetSql}. */
export interface BudgetRow {
  spent?: unknown;
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
  const spends = rows.map((r) => Number(r.spent) || 0);
  return {
    spent: spends.reduce((s, v) => s + v, 0),
    over: spends.filter((v) => v >= b.limitUsd).length,
    largest: Math.max(0, ...spends),
    keys: spends.length,
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
