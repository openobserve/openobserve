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

import type { EvalBudgetAction, EvalJob, EvalTargetScope } from "@/services/online-evals.service";
import { countExpression, quoteIdent } from "../composables/useJobMatchedTargets";
import StreamService from "@/services/stream";
import { spendError, type SpendError } from "@/utils/alerts/aiBudgets";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

/** Every new job starts with this budget, per UTC day. */
export const DEFAULT_DAILY_BUDGET_USD = 5;
export const DEFAULT_BUDGET_ACTION: EvalBudgetAction = "pause";
/** The estimate reads this many days of matched traffic and judge calls. */
export const ESTIMATE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 UTC of the day `atMs` falls in. */
export const utcDayStartMs = (atMs: number): number => atMs - (((atMs % DAY_MS) + DAY_MS) % DAY_MS);

/** Days count from `windowStartUs`, not 00:00 UTC, since partial UTC days would undercount the average. */
export function matchedPerDaySql(
  stream: string,
  where: string,
  scope: EvalTargetScope,
  fields: readonly string[],
  windowStartUs: number,
): string | null {
  const count = countExpression(scope, fields);
  if (!count) return null;
  const start = Math.floor(windowStartUs);
  return [
    `SELECT (_timestamp - ${start}) / ${DAY_MS * 1000} AS day, ${count} AS cnt`,
    `FROM ${quoteIdent(stream)}`,
    where.trim() ? `WHERE ${where.trim()}` : "",
    "GROUP BY day ORDER BY day",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Successful calls per judge, and what the priced ones cost. */
export function judgeHistorySql(scorerIds: string[]): string {
  return [
    "SELECT attributes_scorer_id AS scorer_id, COUNT(*) AS calls,",
    "  COUNT(gen_ai_usage_cost) AS priced, SUM(gen_ai_usage_cost) AS cost,",
    "  AVG(TRY_CAST(attributes_total_tokens AS DOUBLE)) AS tokens, MAX(attributes_model) AS model",
    'FROM "_evaluator"',
    `WHERE attributes_scorer_id IN (${scorerIds.map(sqlLiteral).join(", ")})`,
    "  AND attributes_status = 'success'",
    "GROUP BY attributes_scorer_id",
  ].join("\n");
}

/** Each column appears only once a span sets it, and naming a missing column fails the query. */
export interface SpendColumns {
  jobId: boolean;
  cost: boolean;
  costStatus: boolean;
}

export function spendColumns(fields: readonly { name?: string }[]): SpendColumns {
  const has = (name: string) => fields.some((f) => f.name === name);
  return {
    jobId: has("attributes_job_id"),
    cost: has("gen_ai_usage_cost"),
    costStatus: has("gen_ai_usage_cost_status"),
  };
}

export function spendTodaySql(jobIds: string[], cols: SpendColumns): string {
  if (!cols.jobId)
    return `SELECT '' AS job_id, 0 AS spend, 0 AS unpriced FROM "_evaluator" LIMIT 1`;
  const unpriced = cols.costStatus
    ? "SUM(CASE WHEN gen_ai_usage_cost_status = 'unpriced' THEN 1 ELSE 0 END)"
    : "0";
  return [
    "SELECT attributes_job_id AS job_id,",
    `  ${cols.cost ? "SUM(gen_ai_usage_cost)" : "0"} AS spend, ${unpriced} AS unpriced`,
    'FROM "_evaluator"',
    `WHERE attributes_job_id IN (${jobIds.map(sqlLiteral).join(", ")})`,
    "GROUP BY attributes_job_id",
  ].join("\n");
}

/** `usd` counts priced calls only; any unpriced call makes the true spend unknown. */
export interface JobSpend {
  usd: number;
  unpricedCalls: number;
}

/** Read fresh each time: the cached schema can predate the first judge call. */
export async function evaluatorFields(org: string): Promise<readonly { name?: string }[]> {
  const res = await StreamService.schema(org, "_evaluator", "traces");
  return res.data?.schema ?? [];
}

/** The `_evaluator` stream does not exist: a 404 schema read, or search's "stream not found" (code 20002). */
function evaluatorMissing(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { code?: number } } } | null;
  return err?.response?.status === 404 || err?.response?.data?.code === 20002;
}

/** The query always runs so a user who cannot read `_evaluator` gets "forbidden", never $0. */
export async function loadSpendToday(
  jobIds: string[],
  read: {
    fields: () => Promise<readonly { name?: string }[]>;
    query: (sql: string, startUs: number, endUs: number) => Promise<any[]>;
  },
  nowMs: number = Date.now(),
): Promise<Record<string, JobSpend> | SpendError> {
  if (!jobIds.length) return {};
  const spend: Record<string, JobSpend> = Object.fromEntries(
    jobIds.map((id) => [id, { usd: 0, unpricedCalls: 0 }]),
  );
  let cols: SpendColumns = { jobId: false, cost: false, costStatus: false };
  try {
    cols = spendColumns(await read.fields());
  } catch (e) {
    if (!evaluatorMissing(e)) return spendError(e);
  }
  let rows: any[];
  try {
    rows = await read.query(spendTodaySql(jobIds, cols), utcDayStartMs(nowMs) * 1000, nowMs * 1000);
  } catch (e) {
    return evaluatorMissing(e) ? spend : spendError(e);
  }
  for (const r of rows) {
    const id = String(r.job_id ?? "");
    if (!spend[id]) continue;
    spend[id] = { usd: Number(r.spend) || 0, unpricedCalls: Number(r.unpriced) || 0 };
  }
  return spend;
}

export interface JudgeHistory {
  scorerId: string;
  calls: number;
  priced: number;
  cost: number;
  tokens: number | null;
  model: string | null;
}

export function parseJudgeHistory(rows: any[]): JudgeHistory[] {
  return rows.map((r) => ({
    scorerId: String(r.scorer_id ?? ""),
    calls: Number(r.calls) || 0,
    priced: Number(r.priced) || 0,
    cost: Number(r.cost) || 0,
    tokens: r.tokens == null ? null : Number(r.tokens),
    model: r.model ? String(r.model) : null,
  }));
}

export interface SpendEstimate {
  /** Null when the matched traffic is unknown (its query failed or cannot run). */
  matchedPerDay: number | null;
  scoredPerDay: number | null;
  /** Judge cost per scored target; null when a judge has no priced call to go on. */
  perTargetUsd: number | null;
  perDayUsd: number | null;
  busiestDayUsd: number | null;
  tokensPerTarget: number | null;
  /** The judge model, when every judge in the job uses one. */
  model: string | null;
  judgeGap: "unpriced" | "noCalls" | null;
}

/** Days without traffic are not averaged in, so a new stream is not diluted over the week. */
export function estimateJobSpend(opts: {
  dailyCounts: number[] | null;
  rate: number;
  judgeIds: string[];
  history: JudgeHistory[];
}): SpendEstimate {
  const counts = opts.dailyCounts;
  const days = counts?.filter((c) => c > 0) ?? [];
  const matchedPerDay = counts && (days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0);
  const scoredPerDay = matchedPerDay == null ? null : matchedPerDay * opts.rate;
  const judges = opts.judgeIds.map((id) => opts.history.find((h) => h.scorerId === id));
  const priced = judges.every((h) => h && h.priced > 0);
  const perTargetUsd = priced ? judges.reduce((sum, h) => sum + h!.cost / h!.priced, 0) : null;
  // No judge costs $0 whatever the traffic; a judge on unknown traffic costs an unknown amount.
  const knowable = perTargetUsd === 0 || (perTargetUsd != null && counts != null);
  const tokens = judges.map((h) => h?.tokens);
  const models = [...new Set(judges.map((h) => h?.model).filter(Boolean))];
  return {
    matchedPerDay,
    scoredPerDay,
    perTargetUsd,
    perDayUsd: knowable ? perTargetUsd! * (scoredPerDay ?? 0) : null,
    busiestDayUsd: knowable ? perTargetUsd! * opts.rate * Math.max(0, ...(counts ?? [])) : null,
    tokensPerTarget: tokens.every((n) => n != null) ? tokens.reduce((a, b) => a! + b!, 0)! : null,
    model: models.length === 1 ? (models[0] as string) : null,
    judgeGap: judges.some((h) => h && h.calls > 0 && h.priced === 0)
      ? "unpriced"
      : judges.some((h) => !h || h.calls === 0)
        ? "noCalls"
        : null,
  };
}

/** Paused by its budget, as opposed to by a user. */
export const isBudgetPaused = (job: EvalJob): boolean =>
  job.status === "paused" && !!job.budget?.pausedAt;

/** "Resume until 00:00 UTC" lifted the budget, and the lift has not run out. */
export const isBudgetLifted = (job: EvalJob, nowMs: number): boolean =>
  job.status === "active" && (job.budget?.liftedUntil ?? 0) / 1000 > nowMs;

export function budgetPauseFacts(job: EvalJob, nowMs: number) {
  const left = utcDayStartMs(nowMs) + DAY_MS - nowMs;
  const budget = job.budget;
  return {
    amount: formatUsd(budget?.pausedSpendUsd ?? budget?.dailyUsd ?? 0),
    time: new Date((budget?.pausedAt ?? 0) / 1000).toISOString().slice(11, 16),
    hours: Math.floor(left / 3_600_000),
    minutes: Math.floor((left % 3_600_000) / 60_000),
  };
}

/** "$0.38" for day amounts; sub-cent values keep two significant digits. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}
