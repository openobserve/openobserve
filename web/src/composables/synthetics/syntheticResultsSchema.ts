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

export const SYNTHETIC_FIELDS = {
  monitorId: "synthetics_id",
  status: "status",
  timestamp: "_timestamp",
  duration: "response_time_ms",
  location: "location",
  device: "device",
  engine: "engine",
  error: "error",
  executionId: "execution_id",
} as const;

export const STATUS_VALUES = {
  passed: "passed",
  warning: "warning",
  failed: "failed",
  error: "error",
} as const;

// ── Device display helpers ─────────────────────────────────────────────────

/**
 * Canonical set of known device IDs and their display properties.
 * When the backend adds new devices, add them here only.
 */
export const KNOWN_DEVICES: Record<
  string,
  { label: string; icon: string }
> = {
  laptop_large: { label: "Desktop", icon: "computer" },
  tablet: { label: "Tablet", icon: "tablet" },
  mobile_small: { label: "Mobile", icon: "smartphone" },
};

/**
 * Resolve a device ID to its OIcon name.
 * Falls back to "devices" for unknown IDs.
 */
export function deviceIconName(deviceId: string): string {
  return KNOWN_DEVICES[deviceId]?.icon ?? "devices";
}

/**
 * Resolve a device ID to its human-readable label.
 * Preserves casing of the stored label; falls back to the raw ID.
 */
export function deviceLabel(deviceId: string): string {
  return KNOWN_DEVICES[deviceId]?.label ?? deviceId;
}

// ── Typed UI models (stable regardless of stream schema) ─────────────────

export type RunStatus = "passed" | "warning" | "failed" | "error";

export interface SyntheticKpi {
  uptimePct: number;
  p95Ms: number;
  failedRuns: number;
  totalRuns: number;
  /** Count of runs that had at least one retry (attempts > 1). */
  retriedRuns: number;
  lastRunStatus: RunStatus | null;
  lastRunAt: number | null;
}

// ── Run list / detail types (used by useSyntheticResults + dedicated pages) ─

export interface SyntheticRun {
  timestamp: number;
  scheduledTs: number;
  status: RunStatus;
  durationMs: number;
  location: string;
  device: string;
  browserEngine: string;
  triggerType: string;
  error: string;
  jobId: string;
  runId: string;
  executionId: string;
}

export interface SyntheticRunDetail extends SyntheticRun {
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
  step_id: string;
  status: "ok" | "fail" | "skipped";
  duration_ms: number;
  error: string | null;
  start_time: number;
  end_time: number;
  screenshot_key: string | null;
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

// ── RunRowExpansion types (per engine×device execution rows in a run) ──────

/** One step result as reported by the probe in last_attempt_steps. */
export interface StepResult {
  stepId: string;
  status: "ok" | "fail";
  durationMs: number;
  error: string;
  screenshotKey: string | null;
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
  recordedSteps: RecordedStep[];
  retryHistory: RetryAttempt[];
}

export interface SyntheticBucket {
  tsMs: number;
  avgMs: number;
  p95Ms: number;
  uptimePct: number;
  failedRuns: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function num(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function toRunStatus(raw: unknown): RunStatus {
  const s = str(raw);
  if (s === "passed") return "passed";
  if (s === "warning") return "warning";
  if (s === "error") return "error";
  return "failed";
}

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

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
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

const F = SYNTHETIC_FIELDS;
const TABLE = `"${SYNTHETIC_RESULTS_STREAM}"`;

export function buildKpiSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.passed}') as passed_runs,
  COUNT(*) FILTER (WHERE ${F.status} != '${STATUS_VALUES.passed}') as failed_runs,
  COUNT(*) FILTER (WHERE attempt > 1) as retried_runs,
  COALESCE(approx_percentile_cont(${F.duration}, 0.95), 0) as p95_duration
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'`;
}

export function buildLastRunSql(monitorId: string): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT ${F.status} as status, ${F.timestamp} as ts
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT 1`;
}

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

/** Most-recent runs for the Runs table. */
export function buildRunsSql(monitorId: string, limit: number): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT ${F.timestamp} as ts, scheduled_ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.engine} as engine, trigger_type, ${F.error} as error, job_id, run_id, execution_id
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
}

/** Per-execution results for a single run — one row per engine×device combo. */
export function buildRunDetailSql(
  monitorId: string,
  runId: string,
  executionId: string,
): string {
  const id = escapeSqlLiteral(monitorId);
  const rid = escapeSqlLiteral(runId);
  const eid = escapeSqlLiteral(executionId);
  return `SELECT ${F.timestamp} as ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.engine} as engine, ${F.error} as error, job_id, execution_id, trace_key, last_attempt_steps, recorded_steps
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}' AND run_id = '${rid}' AND execution_id = '${eid}'
ORDER BY ${F.location} ASC`;
}

// ── Adapters (raw hits → typed models) ────────────────────────────────────

export function mapKpi(
  rawKpiRow: Record<string, unknown> | null | undefined,
  rawLastRun: Record<string, unknown> | null | undefined,
): SyntheticKpi {
  const totalRuns = num(rawKpiRow?.total_runs);
  const passedRuns = num(rawKpiRow?.passed_runs);
  const failedRuns = num(rawKpiRow?.failed_runs);
  const retriedRuns = num(rawKpiRow?.retried_runs);
  const lastRunTsRaw = rawLastRun ? num(rawLastRun.ts) : 0;
  return {
    uptimePct: totalRuns > 0 ? (passedRuns / totalRuns) * 100 : 0,
    p95Ms: num(rawKpiRow?.p95_duration),
    failedRuns,
    totalRuns,
    retriedRuns,
    lastRunStatus: rawLastRun ? toRunStatus(rawLastRun.status) : null,
    lastRunAt: lastRunTsRaw > 0 ? lastRunTsRaw / 1000 : null,
  };
}

export function mapRun(rawHit: Record<string, unknown>): SyntheticRun {
  return {
    timestamp: num(rawHit.ts) / 1000,
    scheduledTs: num(rawHit.scheduled_ts) / 1000,
    status: toRunStatus(rawHit.status),
    durationMs: num(rawHit.duration),
    location: str(rawHit.location),
    device: str(rawHit.device),
    browserEngine: str(rawHit.engine),
    triggerType: str(rawHit.trigger_type) || "schedule",
    error: str(rawHit.error),
    jobId: str(rawHit.job_id),
    runId: str(rawHit.run_id),
    executionId: str(rawHit.execution_id),
  };
}

export function mapRunDetail(
  rawHit: Record<string, unknown>,
): SyntheticRunDetail | null {
  if (!rawHit) return null;
  const base = mapRun({
    ts: rawHit.ts ?? rawHit._timestamp,
    status: rawHit.status,
    duration: rawHit.duration ?? rawHit.response_time_ms,
    location: rawHit.location,
    device: rawHit.device,
    engine: rawHit.engine,
    error: rawHit.error,
    job_id: rawHit.job_id,
    run_id: rawHit.run_id,
    execution_id: rawHit.execution_id,
  });

  const rawRecordedSteps = parseJson(rawHit.recorded_steps);
  const rawSteps = parseJson(rawHit.last_attempt_steps);
  const rawStepsArr = Array.isArray(rawSteps) ? (rawSteps as any[]) : [];

  return {
    ...base,
    executionId: str(rawHit.execution_id),
    triggerType: str(rawHit.trigger_type),
    monitorName: str(rawHit.synthetics_name),
    attempts: num(rawHit.attempt),
    failedStep: rawHit.failed_step
      ? str(rawHit.failed_step)
      : (rawStepsArr.find((s: any) => s.status === "fail" || s.status === "failed")?.step_id ?? null),
    recordedSteps: Array.isArray(rawRecordedSteps)
      ? (rawRecordedSteps as RecordedStep[])
      : [],
    lastAttemptSteps: rawStepsArr.map((s: any) => ({
        ...s,
        status: s.status === "ok" || s.status === "passed" ? "ok" : "fail" as const,
      })),
    retryHistory: [],
    network: null,
    webVitals: null,
    traceKey: rawHit.trace_key ? str(rawHit.trace_key) : null,
  };
}

export function mapRunLocationResult(
  rawHit: Record<string, unknown>,
): RunLocationResult {
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
    recordedSteps: parseJsonArray(rawHit.recorded_steps).map((s: any) => ({
      id: str(s.id),
      name: str(s.name),
      action: str(s.action),
      selector: null,
      url: null,
      timeout_ms: 0,
      value: null,
      key: null,
      text: null,
    })),
    retryHistory: [],
  };
}

export function mapHistogram(
  rawHits: Record<string, unknown>[],
  startMicros: number,
  endMicros: number,
): SyntheticBucket[] {
  const interval = bucketInterval(endMicros - startMicros);
  const stepMs = intervalSeconds(interval) * 1000;
  const startMs = Math.floor(startMicros / 1000 / stepMs) * stepMs;
  const endMs = Math.ceil(endMicros / 1000 / stepMs) * stepMs;

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
