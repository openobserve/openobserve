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
 * Eval spend guard (AIO-24): the job form's cost estimate, the daily budget and
 * its backfill. A judge's cost per call comes from its own `_evaluator` spans,
 * which the LLM processor priced at ingest — the same table real calls use. A
 * judge with no priced call has no estimate: it is never counted as $0.
 */

import type {
  EvalBudgetAction,
  EvalJob,
  EvalTargetScope,
  ManualEvalJobPayload,
} from "@/services/online-evals.service";
import {
  countExpression,
  quoteIdent,
  targetIdExpression,
} from "../composables/useJobMatchedTargets";
import StreamService from "@/services/stream";
import { spendError, type SpendError } from "@/utils/alerts/aiBudgets";

/** Every new job starts with this budget, per UTC day. */
export const DEFAULT_DAILY_BUDGET_USD = 5;
export const DEFAULT_BUDGET_ACTION: EvalBudgetAction = "pause";
/** The estimate reads this many days of matched traffic and judge calls. */
export const ESTIMATE_DAYS = 7;
export const BACKFILL_DAY_OPTIONS = [0, 1, 3, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** 00:00 UTC of the day `atMs` falls in. */
export const utcDayStartMs = (atMs: number): number => atMs - (((atMs % DAY_MS) + DAY_MS) % DAY_MS);

/**
 * Matched targets per day over the estimate window, at the job's own scope;
 * null when the stream (with schema `fields`) cannot be counted at it.
 */
export function matchedPerDaySql(
  stream: string,
  where: string,
  scope: EvalTargetScope,
  fields: readonly string[],
): string | null {
  const count = countExpression(scope, fields);
  if (!count) return null;
  return [
    `SELECT histogram(_timestamp, '1 day') AS day, ${count} AS cnt`,
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
    `WHERE attributes_scorer_id IN (${scorerIds.map(quote).join(", ")})`,
    "  AND attributes_status = 'success'",
    "GROUP BY attributes_scorer_id",
  ].join("\n");
}

/**
 * The `_evaluator` columns the spend query reads. Each appears with the first
 * span that sets it (the cost with the first priced judge call, the status with
 * the first unpriced one), and a query naming a missing column fails.
 */
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

/**
 * Judge spend per job since the start of the query window (00:00 UTC), and its
 * unpriced calls. A missing cost column reads as 0; without the job column no
 * job has a span, and the query only proves `_evaluator` can be read.
 */
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
    `WHERE attributes_job_id IN (${jobIds.map(quote).join(", ")})`,
    "GROUP BY attributes_job_id",
  ].join("\n");
}

/**
 * A job's judge spend today. `usd` counts the priced calls only: with any
 * unpriced call the true spend is unknown, and the budget cannot see it.
 */
export interface JobSpend {
  usd: number;
  unpricedCalls: number;
}

/**
 * `_evaluator`'s schema fields, read from the server each time. The cached
 * stream list and schema can predate the first judge call, and the list leaves
 * out streams the user may not list.
 */
export async function evaluatorFields(org: string): Promise<readonly { name?: string }[]> {
  const res = await StreamService.schema(org, "_evaluator", "traces");
  return res.data?.schema ?? [];
}

/** The `_evaluator` stream does not exist: a 404 schema read, or search's "stream not found" (code 20002). */
function evaluatorMissing(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { code?: number } } } | null;
  return err?.response?.status === 404 || err?.response?.data?.code === 20002;
}

/**
 * Today's judge spend of each job in `jobIds`; a job without a row spent
 * nothing, and so does every job while `_evaluator` does not exist (no judge
 * call yet). The query always runs, so a user who cannot read `_evaluator`
 * gets "forbidden", never $0 (a schema read can pass where search is denied).
 * Any other failure is "failed".
 */
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
}

/**
 * Matched targets a day × sample rate × judge cost per target. Days without
 * traffic are not averaged in, so a stream that started yesterday is not
 * diluted over the whole week. Scorers that are not LLM judges cost nothing.
 * Unknown traffic (`dailyCounts` null) leaves any judge's spend unknown.
 */
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
  };
}

/** The backfill reads at most this many matched rows and queues at most this many targets. */
export const BACKFILL_MAX_ROWS = 10_000;
export const BACKFILL_MAX_TARGETS = 1000;

/** The backfill's query window (µs): the last `days` days up to now. */
export function backfillWindowUs(days: number, nowMs: number): { startUs: number; endUs: number } {
  return { startUs: (nowMs - days * DAY_MS) * 1000, endUs: nowMs * 1000 };
}

/**
 * A one-time backfill of the `matched` targets in its window, at the job's
 * sample rate and within the row and target limits it queues by. It counts
 * toward today's budget, so it never queues more targets than the budget pays
 * for; past that the budget would pause the job with the rest of the backfill
 * still queued.
 */
export function backfillEstimate(opts: {
  matched: number;
  rate: number;
  perTargetUsd: number | null;
  budgetUsd: number;
}): { targets: number; usd: number | null; cap: number | null } {
  const targets = Math.min(
    Math.round(Math.min(opts.matched, BACKFILL_MAX_ROWS) * opts.rate),
    BACKFILL_MAX_TARGETS,
  );
  const perTarget = opts.perTargetUsd;
  const cap = perTarget ? Math.floor(opts.budgetUsd / perTarget) : null;
  return {
    targets,
    usd: perTarget == null ? null : perTarget * targets,
    cap: cap != null && cap < targets ? cap : null,
  };
}

/**
 * Up to `limit` matched targets with the time range their spans cover
 * (nanoseconds); null when the stream (with schema `fields`) has no id at `scope`.
 */
export function backfillTargetsSql(
  stream: string,
  where: string,
  scope: EvalTargetScope,
  fields: readonly string[],
  limit: number,
): string | null {
  const id = targetIdExpression(scope, fields);
  if (!id) return null;
  return [
    `SELECT ${id} AS target_id, MAX(trace_id) AS trace_id,`,
    "  MIN(start_time) AS start_ns, MAX(end_time) AS end_ns",
    `FROM ${quoteIdent(stream)}`,
    `WHERE ${id} IS NOT NULL${where.trim() ? ` AND (${where.trim()})` : ""}`,
    `GROUP BY ${id}`,
    `LIMIT ${limit}`,
  ].join("\n");
}

/**
 * Manual evaluation requests for a sample of the backfill rows. The window is
 * padded by `padUs` on each side: the rows only cover the spans that matched
 * the filter, and a trace or session judge reads the whole target.
 */
export function backfillRequests(
  rows: any[],
  scope: EvalTargetScope,
  opts: { rate: number; cap: number; padUs: number; random?: () => number },
): ManualEvalJobPayload[] {
  const random = opts.random ?? Math.random;
  const out: ManualEvalJobPayload[] = [];
  for (const row of rows) {
    if (out.length >= opts.cap) break;
    const targetId = String(row.target_id ?? "");
    if (!targetId || random() >= opts.rate) continue;
    out.push({
      targetId,
      startTime: Math.max(0, Math.floor(Number(row.start_ns) / 1000) - 1 - opts.padUs),
      endTime: Math.ceil(Number(row.end_ns) / 1000) + 1 + opts.padUs,
      spanId: scope === "span" ? targetId : null,
      traceId: scope === "session" ? (row.trace_id ?? null) : scope === "trace" ? targetId : null,
      sessionId: scope === "session" ? targetId : null,
      reason: "backfill",
    });
  }
  return out;
}

/** Paused by its budget, as opposed to by a user. */
export const isBudgetPaused = (job: EvalJob): boolean =>
  job.status === "paused" && !!job.budget?.pausedAt;

/** "$0.38" for day amounts; sub-cent values keep two significant digits. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}
