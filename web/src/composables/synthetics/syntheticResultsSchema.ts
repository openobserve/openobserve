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
 * Single isolation point between the `synthetics_results` log stream and the
 * synthetic monitoring UI. Nothing else in the app references stream or field
 * names directly — components consume only the typed models below.
 *
 * If the real stream schema lands with different field names or status values,
 * change them here. The composable and every component stay untouched.
 *
 * Pure module — no Vue, no HTTP — so the query builders and mappers are
 * trivially unit-testable.
 */

// ── Stream + field config (the single source of truth) ────────────────────

export const SYNTHETIC_RESULTS_STREAM = "synthetics_results";

export const STATUS_PASSED = "passed";
export const STATUS_FAILED = "failed";

// ── Typed UI models (stable regardless of stream schema) ─────────────────

export type RunStatus = "passed" | "failed";

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
  /** Timestamp of the most recent run (_timestamp value, ms epoch), or null. */
  lastRunAt: number | null;
}

export interface SyntheticRun {
  /** Run timestamp, milliseconds epoch. */
  timestamp: number;
  status: RunStatus;
  durationMs: number;
  location: string;
  device: string;
  /** Engine/browser name (e.g. "chromium", "webkit"). */
  browserEngine: string;
  /** Failure reason for failed runs (empty for passing runs). */
  error: string;
  /** Job identifier — used to fetch artifacts. */
  jobId: string;
  /** Run identifier — used for navigation to run detail. */
  runId: string;
}

/** Full run document including steps, used for RunDetail view. */
export interface SyntheticRunDetail extends SyntheticRun {
  runId: string;
  executionId: string;
  triggerType: string;
  monitorName: string;
  attempts: number;
  failedStep: string | null;
  recordedSteps: RecordedStep[];
  lastAttemptSteps: StepExecution[];
  retryHistory: RetryAttempt[];
  network: NetworkStats | null;
  webVitals: WebVitals | null;
  traceKey: string | null;
}

export interface RecordedStep {
  id: string;
  action: string;
  name: string;
  selector: string | null;
  url: string | null;
  timeout_ms: number;
  value: string | null;
  key: string | null;
  text: string | null;
}

export interface StepExecution {
  stepId: string;
  status: "ok" | "fail" | "skipped";
  durationMs: number;
  error: string | null;
  startTime: number;
  endTime: number;
  screenshotKey: string | null;
}

export interface RetryAttempt {
  attempt: number;
  status: string;
  durationMs: number;
  failedStep: string | null;
  steps: StepExecution[];
}

export interface NetworkStats {
  requests: number;
  failed: number;
  bytesKb: number;
}

export interface WebVitals {
  lcpMs: number;
  fcpMs: number;
  cls: number;
  ttfbMs: number;
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

// ── Internal helpers ───────────────────────────────────────────────────────

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

/** Map a raw status field value onto the typed RunStatus. */
function toRunStatus(raw: unknown): RunStatus {
  return str(raw) === STATUS_PASSED ? "passed" : "failed";
}

/** Safely parse a JSON string or return the value as-is. */
function parseJson(raw: unknown): unknown {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Pick a histogram bucket width yielding ~30 buckets across the window.
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

// ── Query builders ────────────────────────────────────────────────────────

const TABLE = `"${SYNTHETIC_RESULTS_STREAM}"`;

/** Summary aggregates for the KPI cards (single row). */
export function buildKpiSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = '${STATUS_PASSED}') as passed_runs,
  COUNT(*) FILTER (WHERE status != '${STATUS_PASSED}') as failed_runs,
  COALESCE(approx_percentile_cont(duration_ms, 0.95), 0) as p95_duration
FROM ${TABLE}
WHERE synthetics_id = '${id}'`;
}

/** Most-recent run, for the "Last Run" KPI card. */
export function buildLastRunSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT status, _timestamp as ts
FROM ${TABLE}
WHERE synthetics_id = '${id}'
ORDER BY _timestamp DESC
LIMIT 1`;
}

/** Bucketed time-series powering the sparkline + Response Time chart. */
export function buildHistogramSql(monitorId: string, interval: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT
  histogram(_timestamp, '${interval}') as ts,
  COALESCE(AVG(duration_ms), 0) as avg_duration,
  COALESCE(approx_percentile_cont(duration_ms, 0.95), 0) as p95_duration,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = '${STATUS_PASSED}') as passed_runs,
  COUNT(*) FILTER (WHERE status != '${STATUS_PASSED}') as failed_runs
FROM ${TABLE}
WHERE synthetics_id = '${id}'
GROUP BY ts
ORDER BY ts`;
}

/** Most-recent runs for the Runs table. */
export function buildRunsSql(monitorId: string, limit: number): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT _timestamp as ts, status, duration_ms as duration, location, device, engine, error, job_id, run_id
FROM "${SYNTHETIC_RESULTS_STREAM}"
WHERE synthetics_id = '${id}'
ORDER BY _timestamp DESC
LIMIT ${limit}`;
}

/** Single run document for RunDetail view — returns all fields including steps. */
export function buildRunDetailSql(monitorId: string, runId: string): string {
  const mid = escapeSqlLiteral(monitorId);
  const rid = escapeSqlLiteral(runId);
  return `SELECT *
FROM ${TABLE}
WHERE synthetics_id = '${mid}' AND run_id = '${rid}'
LIMIT 1`;
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
  const lastRunTsRaw = rawLastRun ? num(rawLastRun.ts) : 0;
  return {
    uptimePct: totalRuns > 0 ? (passedRuns / totalRuns) * 100 : 0,
    p95Ms: num(rawKpiRow?.p95_duration),
    failedRuns,
    totalRuns,
    lastRunStatus: rawLastRun ? toRunStatus(rawLastRun.status) : null,
    lastRunAt: lastRunTsRaw > 0 ? lastRunTsRaw : null,
  };
}

/** Map one runs-table hit to the typed model. */
export function mapRun(rawHit: Record<string, unknown>): SyntheticRun {
  return {
    timestamp: num(rawHit.ts) / 1000,
    status: toRunStatus(rawHit.status),
    durationMs: num(rawHit.duration),
    location: str(rawHit.location),
    device: str(rawHit.device),
    browserEngine: str(rawHit.engine),
    error: str(rawHit.error),
    jobId: str(rawHit.job_id),
    runId: str(rawHit.run_id),
  };
}

/** Map one raw document to a SyntheticRunDetail (all fields including steps). */
export function mapRunDetail(
  rawHit: Record<string, unknown>,
): SyntheticRunDetail | null {
  if (!rawHit) return null;
  const base = mapRun({
    ts: rawHit._timestamp,
    status: rawHit.status,
    duration: rawHit.duration_ms,
    location: rawHit.location,
    device: rawHit.device,
    engine: rawHit.engine,
    error: rawHit.error,
    job_id: rawHit.job_id,
  });

  // Parse nested JSON fields
  const rawSteps = parseJson(rawHit.last_attempt_steps);
  const rawRecordedSteps = parseJson(rawHit.recorded_steps);

  return {
    ...base,
    runId: str(rawHit.run_id),
    executionId: str(rawHit.execution_id),
    triggerType: str(rawHit.trigger_type),
    monitorName: str(rawHit.synthetics_name),
    attempts: num(rawHit.attempts),
    failedStep: rawHit.failed_step ? str(rawHit.failed_step) : null,
    recordedSteps: Array.isArray(rawRecordedSteps)
      ? (rawRecordedSteps as RecordedStep[])
      : [],
    lastAttemptSteps: Array.isArray(rawSteps)
      ? (rawSteps as StepExecution[])
      : [],
    retryHistory: [],
    network: null,
    webVitals: null,
    traceKey: null,
  };
}

/**
 * Map the histogram hits to a dense, time-ordered bucket series. Zero-fills
 * empty buckets so the sparkline is always properly shaped.
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
    const key = new Date(t).toISOString().slice(0, 19);
    buckets.set(key, {
      tsMs: t,
      avgMs: 0,
      p95Ms: 0,
      uptimePct: 100,
      failedRuns: 0,
    });
  }

  for (const hit of rawHits) {
    const key = str(hit.ts);
    const tsMs = new Date(`${key}Z`).getTime();
    const total = num(hit.total_runs);
    const passed = num(hit.passed_runs);
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
