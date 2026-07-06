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
 * Single isolation point between the `synthetic_monitor_results` log stream
 * and the Monitor Results UI. Nothing else in the app references stream or
 * field names directly — components consume only the typed models below.
 *
 * If the real stream schema lands with different field names, change
 * `SYNTHETIC_RESULTS_STREAM` / `SYNTHETIC_FIELDS` / `STATUS_VALUES` (and, at
 * most, the mapper bodies) here. The composable and every component stay
 * untouched.
 *
 * Pure module — no Vue, no HTTP — so the query builders and mappers are
 * trivially unit-testable.
 */

// ── Stream + field config (the single source of truth) ───────────────────

export const SYNTHETIC_RESULTS_STREAM = "synthetics_results";

export const SYNTHETIC_FIELDS = {
  monitorId: "synthetics_id",
  status: "status", // raw values mapped via STATUS_VALUES below
  timestamp: "_timestamp", // microseconds (OpenObserve convention)
  duration: "response_time_ms", // milliseconds
  location: "location",
  device: "device",
  engine: "engine",
  error: "error",
} as const;

/**
 * Maps the semantic notions onto the raw `status` stream values.
 * The stream stores `"passed"` / `"warning"` / `"failed"` / `"error"`.
 */
export const STATUS_VALUES = { passed: "passed", warning: "warning", failed: "failed", error: "error" } as const;

// ── Typed UI models (stable regardless of stream schema) ─────────────────

export type RunStatus = "passed" | "warning" | "failed" | "error";

export interface SyntheticKpi {
  /** Percentage of runs that passed in the window (0–100). */
  uptimePct: number;
  /** 95th-percentile run duration, milliseconds. */
  p95Ms: number;
  /** Count of failed runs in the window. */
  failedRuns: number;
  /** Total runs in the window. */
  totalRuns: number;
  /** Status of the most recent run, or null when there is no data. */
  lastRunStatus: RunStatus | null;
  /** Timestamp of the most recent run, milliseconds epoch, or null. */
  lastRunAt: number | null;
}

export interface ScreenshotRef {
  step_id: string;
  key: string;
}

/** One step execution result from last_attempt_steps or retry_history. */
export interface StepResult {
  stepId: string;
  status: "ok" | "fail";
  durationMs: number;
  error: string;
  screenshotKey: string | null;
}

/** One failed retry attempt stored in retry_history. */
export interface RetryAttempt {
  attempt: number;
  durationMs: number;
  steps: StepResult[];
}

/** One execution row from the stream — one per engine×device combo per run. */
export interface RunLocationResult {
  timestampMs: number;
  status: RunStatus;
  durationMs: number;
  location: string;
  device: string;
  browserEngine: string;
  error: string;
  jobId: string;
  executionId: string;
  traceKey: string | null;
  steps: StepResult[];
  retryHistory: RetryAttempt[];
}

export interface SyntheticBucket {
  /** Bucket start, milliseconds epoch. */
  tsMs: number;
  /** Average run duration in the bucket, milliseconds. */
  avgMs: number;
  /** p95 run duration in the bucket, milliseconds. */
  p95Ms: number;
  /** Uptime percentage in the bucket (0–100); 100 for empty buckets. */
  uptimePct: number;
  /** Failed run count in the bucket. */
  failedRuns: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────

/** Escape a string literal for safe inlining into SQL (single-quote doubling). */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Coerce a loosely-typed raw field value to a finite number (0 otherwise). */
function num(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a loosely-typed raw field value to a string ("" otherwise). */
function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Map a raw status field value onto the typed (semantic) RunStatus. */
function toRunStatus(raw: unknown): RunStatus {
  const s = str(raw);
  if (s === "passed") return "passed";
  if (s === "warning") return "warning";
  if (s === "error") return "error";
  return "failed";
}

/**
 * Pick a histogram bucket width yielding ~30 buckets across the window —
 * mirrors the convention in `useLLMInsights.bucketInterval`.
 */
export function bucketInterval(durationMicros: number): string {
  const seconds = durationMicros / 1_000_000;
  const target = seconds / 30;
  if (target < 30) return "10 seconds";
  if (target < 120) return "1 minute";
  if (target < 600) return "5 minutes";
  if (target < 1800) return "15 minutes";
  if (target < 3600) return "30 minutes";
  if (target < 21_600) return "1 hour";
  if (target < 86_400) return "6 hours";
  return "1 day";
}

function intervalSeconds(interval: string): number {
  switch (interval) {
    case "10 seconds":
      return 10;
    case "1 minute":
      return 60;
    case "5 minutes":
      return 300;
    case "15 minutes":
      return 900;
    case "30 minutes":
      return 1800;
    case "1 hour":
      return 3600;
    case "6 hours":
      return 21_600;
    case "1 day":
      return 86_400;
    default:
      return 60;
  }
}

// ── Query builders (every field reference comes from the config) ──────────

const F = SYNTHETIC_FIELDS;
const TABLE = `"${SYNTHETIC_RESULTS_STREAM}"`;

/** Summary aggregates for the KPI cards (single row). */
export function buildKpiSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.passed}') as passed_runs,
  COUNT(*) FILTER (WHERE ${F.status} != '${STATUS_VALUES.passed}') as failed_runs,
  COALESCE(approx_percentile_cont(${F.duration}, 0.95), 0) as p95_duration
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'`;
}

/** Most-recent run, for the "Last Run" KPI card. */
export function buildLastRunSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT ${F.status} as status, ${F.timestamp} as ts
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT 1`;
}

/** Bucketed time-series powering the card sparklines + Response Time chart. */
export function buildHistogramSql(monitorId: string, interval: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT
  histogram(${F.timestamp}, '${interval}') as ts,
  COALESCE(AVG(${F.duration}), 0) as avg_duration,
  COALESCE(approx_percentile_cont(${F.duration}, 0.95), 0) as p95_duration,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.passed}') as passed_runs,
  COUNT(*) FILTER (WHERE ${F.status} != '${STATUS_VALUES.passed}') as failed_runs
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
GROUP BY ts
ORDER BY ts`;
}

/** Per-execution results for a single run — one row per engine×device combo. */
export function buildRunDetailSql(runId: string): string {
  const id = escapeSqlLiteral(runId);
  return `SELECT ${F.timestamp} as ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.engine} as engine, ${F.error} as error, job_id, execution_id, trace_key, last_attempt_steps
FROM ${TABLE}
WHERE run_id = '${id}'
ORDER BY ${F.location} ASC`;
}

// ── Adapters (raw hits → typed models) ────────────────────────────────────

/** Map the KPI aggregate row (+ optional last-run row) to the typed model. */
export function mapKpi(
  rawKpiRow: Record<string, unknown> | null | undefined,
  rawLastRun: Record<string, unknown> | null | undefined,
): SyntheticKpi {
  const totalRuns = num(rawKpiRow?.total_runs);
  const passedRuns = num(rawKpiRow?.passed_runs);
  const failedRuns = num(rawKpiRow?.failed_runs);
  const lastRunTsMicros = rawLastRun ? num(rawLastRun.ts) : 0;
  return {
    uptimePct: totalRuns > 0 ? (passedRuns / totalRuns) * 100 : 0,
    p95Ms: num(rawKpiRow?.p95_duration),
    failedRuns,
    totalRuns,
    lastRunStatus: rawLastRun ? toRunStatus(rawLastRun.status) : null,
    lastRunAt: lastRunTsMicros > 0 ? lastRunTsMicros / 1000 : null,
  };
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function parseSteps(raw: unknown): StepResult[] {
  return parseJsonArray(raw).map((s: any) => ({
    stepId: str(s.step_id ?? s.id),
    status: s.status === "ok" || s.status === "passed" ? "ok" : "fail",
    durationMs: num(s.duration_ms),
    error: str(s.error),
    screenshotKey: s.screenshot_key ? str(s.screenshot_key) : null,
  }));
}

function parseRetryHistory(raw: unknown): RetryAttempt[] {
  return parseJsonArray(raw).map((a: any) => ({
    attempt: num(a.attempt),
    durationMs: num(a.duration_ms ?? a.response_time_ms),
    steps: parseSteps(a.steps ?? []),
  }));
}

export function mapRunLocationResult(rawHit: Record<string, unknown>): RunLocationResult {
  return {
    timestampMs: num(rawHit.ts) / 1000,
    status: toRunStatus(rawHit.status),
    durationMs: num(rawHit.duration),
    location: str(rawHit.location),
    device: str(rawHit.device),
    browserEngine: str(rawHit.engine),
    error: str(rawHit.error),
    jobId: str(rawHit.job_id),
    executionId: str(rawHit.execution_id),
    traceKey: rawHit.trace_key ? str(rawHit.trace_key) : null,
    steps: parseSteps(rawHit.last_attempt_steps),
    retryHistory: [],
  };
}

/**
 * Map the histogram hits to a dense, time-ordered bucket series. The server's
 * `histogram()` only emits buckets that have matching rows, so a sparse stream
 * would collapse the sparkline to a single point. We zero-fill the full
 * UTC-aligned grid (mirrors `useLLMInsights.buildBucketGrid`) so the series is
 * always properly shaped.
 */
export function mapHistogram(
  rawHits: Record<string, unknown>[],
  startMicros: number,
  endMicros: number,
): SyntheticBucket[] {
  const interval = bucketInterval(endMicros - startMicros);
  const stepMs = intervalSeconds(interval) * 1000;
  const startMs = Math.floor(startMicros / 1000 / stepMs) * stepMs;
  const endMs = Math.ceil(endMicros / 1000 / stepMs) * stepMs;

  // Pre-fill every bucket key with zeros so empty positions still render.
  const buckets = new Map<string, SyntheticBucket>();
  for (let t = startMs; t < endMs; t += stepMs) {
    // Server key format: "YYYY-MM-DDTHH:mm:ss" (UTC, no Z, no millis).
    const key = new Date(t).toISOString().slice(0, 19);
    buckets.set(key, {
      tsMs: t,
      avgMs: 0,
      p95Ms: 0,
      uptimePct: 100, // empty bucket = no failures observed
      failedRuns: 0,
    });
  }

  for (const hit of rawHits) {
    const key = str(hit.ts);
    const tsMs = new Date(`${key}Z`).getTime();
    const total = num(hit.total_runs);
    const passed = num(hit.passed_runs);
    // Overwrite the zero-filled slot when the key aligns; off-grid keys
    // (e.g. a TZ-rounding edge) are appended and re-sorted below.
    buckets.set(key, {
      tsMs: Number.isFinite(tsMs) ? tsMs : 0,
      avgMs: num(hit.avg_duration),
      p95Ms: num(hit.p95_duration),
      uptimePct: total > 0 ? (passed / total) * 100 : 100,
      failedRuns: num(hit.failed_runs),
    });
  }

  return Array.from(buckets.values()).sort((a, b) => a.tsMs - b.tsMs);
}
