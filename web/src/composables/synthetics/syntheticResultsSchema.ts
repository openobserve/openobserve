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
  monitorName: "synthetics_name",
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

/** One timing phase of a protocol run (dns/connect/tls/ttfb), for waterfall display. */
export interface ProtocolTiming {
  phase: "dns" | "connect" | "tls" | "ttfb";
  ms: number;
}

/**
 * Detail row for a protocol (http/tcp/tls/ssh) run — flat fields from the
 * probe's result record; no steps/screenshots/replay.
 */
export interface ProtocolRunDetail {
  timestamp: number; // ms
  scheduledTs: number; // ms
  startedTs: number; // ms
  completedTs: number; // ms
  status: string; // up | down | degraded
  error: string;
  errorClass: string;
  assertionsPassed: boolean | null;
  statusCode: number | null;
  responseTimeMs: number;
  responseBytes: number | null;
  timings: ProtocolTiming[];
  totalMs: number;
  tlsCertExpiry: number | null; // µs epoch
  initMs: number | null;
  location: string;
  probeId: string;
  runtime: string;
  triggerType: string;
  target: string;
  type: string;
  monitorName: string;
  jobId: string;
  runId: string;
  executionId: string;
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

// ── Step analysis types (used by aggregateStepStats) ──────────────────────

export interface StepFailure {
  stepName: string;
  selector: string | null;
  failCount: number;
  totalExecutions: number;
  failRate: number;
}

export interface StepDuration {
  stepName: string;
  selector: string | null;
  avgDurationMs: number;
  maxDurationMs: number;
  totalExecutions: number;
}

export interface StepGroup {
  key: string;
  name: string;
  sub: string | null;
  failRate: number;
  flakyRate: number;
  flakyCount: number;
  failCount: number;
  totalExecutions: number;
  avgDurationMs: number;
  maxDurationMs: number;
  p95DurationMs: number;
  recentRates: number[];
  browserStats: StepDimensionStat[];
  locationStats: StepDimensionStat[];
}

export interface StepDimensionStat {
  name: string;
  total: number;
  failures: number;
  flaky: number;
}

export interface FlakyStep {
  stepName: string;
  flakyCount: number;
  flakyRate: number;
  failRate: number;
  recentFlakyRates: number[];
}

export interface TrendBucket {
  tsMs: number;
  stepName: string;
  avgDurationMs: number;
}

export interface StepFailureInstance {
  timestamp: number;
  stepName: string;
  isFlaky: boolean;
  browser: string;
  location: string;
  error: string;
  runId: string;
  executionId: string;
}

export interface StepStatsResult {
  stepFailures: StepFailure[];
  stepDurations: StepDuration[];
  stepGroups: StepGroup[];
  flakySteps: FlakyStep[];
  trendBuckets: TrendBucket[];
  failureInstances: StepFailureInstance[];
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

export function buildKpiSql(
  monitorId: string,
  /** Whether the stream schema includes the `attempts` field. When false
   * (e.g. on instances where the probe doesn't write this field), the
   * retried_runs clause is omitted to avoid a schema-mismatch error. */
  hasAttemptsField = false,
): string {
  const id = escapeSqlLiteral(monitorId);
  const retriedClause = hasAttemptsField
    ? `\n  COUNT(*) FILTER (WHERE attempts > 1) as retried_runs,`
    : "";
  return `SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.passed}') as passed_runs,
  COUNT(*) FILTER (WHERE ${F.status} != '${STATUS_VALUES.passed}') as failed_runs,${retriedClause}
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
/** Columns the runs query selects, with a typed literal fallback for when the
 * field is absent from the stream schema. The schema only contains fields some
 * ingested row has carried: browser-only fields (`device`/`engine`) are missing
 * on protocol-only deployments, `error` is missing until a run has failed, etc.
 * The search API rejects any query naming an absent field, so each column is
 * selected as a literal instead when missing — the row shape stays constant. */
const RUNS_COLUMNS: { field: string; alias: string; fallback: string }[] = [
  { field: F.timestamp, alias: "ts", fallback: "0" },
  { field: "scheduled_ts", alias: "scheduled_ts", fallback: "0" },
  { field: F.status, alias: "status", fallback: "''" },
  { field: F.duration, alias: "duration", fallback: "0" },
  { field: F.location, alias: "location", fallback: "''" },
  { field: F.device, alias: "device", fallback: "''" },
  { field: F.engine, alias: "engine", fallback: "''" },
  { field: "trigger_type", alias: "trigger_type", fallback: "''" },
  { field: F.error, alias: "error", fallback: "''" },
  { field: "job_id", alias: "job_id", fallback: "''" },
  { field: "run_id", alias: "run_id", fallback: "''" },
  { field: F.executionId, alias: "execution_id", fallback: "''" },
];

export function buildRunsSql(
  monitorId: string,
  limit: number,
  /** Field names present in the stream schema. Columns not in the set are
   * selected as typed literals. Pass null to select all fields by name
   * (only safe when the schema is known to be complete). */
  schemaFields: Set<string> | null = new Set(),
): string {
  const id = escapeSqlLiteral(monitorId);
  const select = RUNS_COLUMNS.map(({ field, alias, fallback }) => {
    const expr = schemaFields === null || schemaFields.has(field) ? field : fallback;
    return `${expr} as ${alias}`;
  }).join(", ");
  return `SELECT ${select}
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
}

/** Runs query that includes the JSON step fields needed for client-side aggregation.
 *
 * @param hasRetryHistoryField — when `false`, the `retry_history` column is
 *   omitted from the SELECT list to avoid a schema-mismatch error on
 *   instances where the probe hasn't written this field yet. */
export function buildRunsWithStepsSql(
  monitorId: string,
  limit: number,
  hasRetryHistoryField = true,
): string {
  const id = escapeSqlLiteral(monitorId);
  const retryHistoryCol = hasRetryHistoryField ? ", retry_history" : "";
  return `SELECT ${F.timestamp} as ts, scheduled_ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.engine} as engine, trigger_type, ${F.error} as error, job_id, run_id, execution_id, attempts, last_attempt_steps, recorded_steps${retryHistoryCol}
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
}

/** Columns for the browser run-detail query — same literal-fallback scheme as
 * RUNS_COLUMNS (trace_key/step blobs are absent until a browser probe result
 * has been ingested; a browser check whose only rows are dispatcher errors
 * must still open). */
const RUN_DETAIL_COLUMNS: { field: string; alias: string; fallback: string }[] = [
  { field: F.timestamp, alias: "ts", fallback: "0" },
  { field: F.status, alias: "status", fallback: "''" },
  { field: F.duration, alias: "duration", fallback: "0" },
  { field: F.location, alias: "location", fallback: "''" },
  { field: F.device, alias: "device", fallback: "''" },
  { field: F.engine, alias: "engine", fallback: "''" },
  { field: F.error, alias: "error", fallback: "''" },
  { field: F.monitorName, alias: "synthetics_name", fallback: "''" },
  { field: "job_id", alias: "job_id", fallback: "''" },
  { field: F.executionId, alias: "execution_id", fallback: "''" },
  { field: "trace_key", alias: "trace_key", fallback: "''" },
  { field: "last_attempt_steps", alias: "last_attempt_steps", fallback: "''" },
  { field: "recorded_steps", alias: "recorded_steps", fallback: "''" },
];

/** run/execution WHERE clauses restricted to fields that exist in the schema.
 * Older dispatcher/reaper error rows carry job_id but no execution_id (and the
 * oldest reaper rows no run_id); for protocol checks and reaped jobs
 * execution_id == job_id, so the execution match accepts either field. */
function runExecutionWhere(
  runId: string,
  executionId: string,
  schemaFields: Set<string> | null,
): string {
  const rid = escapeSqlLiteral(runId);
  const eid = escapeSqlLiteral(executionId);
  const has = (f: string) => schemaFields === null || schemaFields.has(f);
  const clauses: string[] = [];
  if (has("run_id")) clauses.push(`run_id = '${rid}'`);
  const execMatch: string[] = [];
  if (has(F.executionId)) execMatch.push(`${F.executionId} = '${eid}'`);
  if (has("job_id")) execMatch.push(`job_id = '${eid}'`);
  if (execMatch.length > 0) clauses.push(`(${execMatch.join(" OR ")})`);
  return clauses.map((c) => ` AND ${c}`).join("");
}

/** Per-execution results for a single run — one row per engine×device combo. */
export function buildRunDetailSql(
  monitorId: string,
  runId: string,
  executionId: string,
  schemaFields: Set<string> | null = null,
): string {
  const id = escapeSqlLiteral(monitorId);
  const has = (f: string) => schemaFields === null || schemaFields.has(f);
  const select = RUN_DETAIL_COLUMNS.map(({ field, alias, fallback }) =>
    `${has(field) ? field : fallback} as ${alias}`,
  ).join(", ");
  const orderBy = has(F.location) ? `\nORDER BY ${F.location} ASC` : "";
  return `SELECT ${select}
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'${runExecutionWhere(runId, executionId, schemaFields)}${orderBy}`;
}

/**
 * Full row for a protocol (http/tcp/tls/ssh) run. `SELECT *` on purpose —
 * protocol columns (timings_ms_*, status_code, tls_cert_expiry, …) only exist
 * in the stream schema once a protocol record has been ingested, so naming
 * them explicitly would fail on browser-only deployments.
 */
export function buildProtocolRunDetailSql(
  monitorId: string,
  runId: string,
  executionId: string,
  schemaFields: Set<string> | null = null,
): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT * FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'${runExecutionWhere(runId, executionId, schemaFields)}
LIMIT 1`;
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

export function mapProtocolRunDetail(
  rawHit: Record<string, unknown>,
): ProtocolRunDetail | null {
  if (!rawHit) return null;

  const timings: ProtocolTiming[] = [];
  for (const phase of ["dns", "connect", "tls", "ttfb"] as const) {
    const v = rawHit[`timings_ms_${phase}`];
    if (v != null) timings.push({ phase, ms: num(v) });
  }

  return {
    timestamp: num(rawHit._timestamp) / 1000,
    scheduledTs: num(rawHit.scheduled_ts) / 1000,
    startedTs: num(rawHit.started_ts) / 1000,
    completedTs: num(rawHit.completed_ts) / 1000,
    status: str(rawHit.status),
    error: str(rawHit.error),
    errorClass: str(rawHit.error_class),
    assertionsPassed:
      rawHit.assertions_passed == null ? null : Boolean(rawHit.assertions_passed),
    statusCode: rawHit.status_code == null ? null : num(rawHit.status_code),
    responseTimeMs: num(rawHit.response_time_ms),
    responseBytes: rawHit.response_bytes == null ? null : num(rawHit.response_bytes),
    timings,
    totalMs: num(rawHit.timings_ms_total ?? rawHit.response_time_ms),
    tlsCertExpiry: rawHit.tls_cert_expiry == null ? null : num(rawHit.tls_cert_expiry),
    initMs: rawHit.init_ms == null ? null : num(rawHit.init_ms),
    location: str(rawHit.location),
    probeId: str(rawHit.probe_id),
    runtime: str(rawHit.runtime),
    triggerType: str(rawHit.trigger_type) || "schedule",
    target: str(rawHit.target),
    type: str(rawHit.type),
    monitorName: str(rawHit.synthetics_name),
    jobId: str(rawHit.job_id),
    runId: str(rawHit.run_id),
    executionId: str(rawHit.execution_id),
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

// ── Step aggregation (client-side) ───────────────────────────────────────

const MAX_SPARKLINE_POINTS = 24;
const MAX_FAILURE_INSTANCES = 50;
const TOP_TREND_STEPS = 8;

interface InternalStepAccumulator {
  name: string;
  selector: string | null;
  totalExecutions: number;
  failures: number;
  flakyCount: number;
  durationSum: number;
  durationMax: number;
  durationValues: number[];
  recentRunStatuses: ("pass" | "fail" | "flaky")[];
  browserMap: Map<string, { total: number; failures: number; flaky: number }>;
  locationMap: Map<string, { total: number; failures: number; flaky: number }>;
}

interface InternalTrendAccumulator {
  stepName: string;
  bucketMap: Map<number, { sum: number; count: number }>;
}

function timeBucketKey(tsMs: number, bucketMs: number): number {
  return Math.floor(tsMs / bucketMs) * bucketMs;
}

export function aggregateStepStats(
  rawHits: Record<string, unknown>[],
  startMicros: number,
  endMicros: number,
): StepStatsResult {
  const stepAcc = new Map<string, InternalStepAccumulator>();
  const failureInstances: StepFailureInstance[] = [];
  const trendAcc = new Map<string, InternalTrendAccumulator>();

  const interval = bucketInterval(endMicros - startMicros);
  const bucketMs = intervalSeconds(interval) * 1000;

  // Process runs oldest-first so sparklines reflect chronological order
  const sorted = [...rawHits].sort(
    (a, b) => num(a.ts) - num(b.ts),
  );

  for (const hit of sorted) {
    const runTimestamp = num(hit.ts);
    const engine = str(hit.engine);
    const location = str(hit.location);
    const error = str(hit.error);
    const runId = str(hit.run_id);
    const executionId = str(hit.execution_id);
    const attempts = num(hit.attempts) || 1;
    const runTsMs = runTimestamp / 1000;
    const bucketKey = timeBucketKey(runTsMs, bucketMs);

    const recordedSteps = parseJsonArray(hit.recorded_steps) as any[];
    const lastAttemptSteps = parseJsonArray(hit.last_attempt_steps) as any[];
    const retryHistory = parseJsonArray(hit.retry_history) as any[];

    // Build a lookup: step_id → { name, selector } from recorded_steps
    const stepDefs = new Map<string, { name: string; selector: string | null }>();
    for (const rs of recordedSteps) {
      stepDefs.set(str(rs.id), {
        name: str(rs.name) || str(rs.id),
        selector: rs.selector ? str(rs.selector) : null,
      });
    }

    // Build prior-attempt step statuses for flaky detection
    const priorStatuses = new Map<string, string>();
    if (attempts > 1 && retryHistory.length > 0) {
      for (const retry of retryHistory) {
        const retrySteps = Array.isArray(retry.steps) ? retry.steps : [];
        for (const rs of retrySteps as any[]) {
          const sid = str(rs.step_id ?? rs.id);
          const s = str(rs.status);
          // Only record the first failure for this step across retries
          if (!priorStatuses.has(sid) && (s === "fail" || s === "failed")) {
            priorStatuses.set(sid, "fail");
          }
        }
      }
    }

    const processedSteps = new Set<string>();

    for (const step of lastAttemptSteps as any[]) {
      const stepId = str(step.step_id ?? step.id);
      processedSteps.add(stepId);

      const def = stepDefs.get(stepId);
      const stepName = def?.name ?? stepId;
      const selector = def?.selector ?? null;
      const stepStatus = str(step.status);
      const isOk = stepStatus === "ok" || stepStatus === "passed";
      const stepDuration = num(step.duration_ms);
      const stepError = str(step.error);

      // Determine flaky
      const priorFailed = priorStatuses.get(stepId) === "fail";
      const isFlaky = attempts > 1 && priorFailed && isOk;

      // ── Accumulate step stats ────────────────────────────────────
      let acc = stepAcc.get(stepName);
      if (!acc) {
        acc = {
          name: stepName,
          selector,
          totalExecutions: 0,
          failures: 0,
          flakyCount: 0,
          durationSum: 0,
          durationMax: 0,
          durationValues: [],
          recentRunStatuses: [],
          browserMap: new Map(),
          locationMap: new Map(),
        };
        stepAcc.set(stepName, acc);
      }

      acc.totalExecutions++;
      if (!isOk) acc.failures++;
      if (isFlaky) acc.flakyCount++;
      acc.durationSum += stepDuration;
      if (stepDuration > acc.durationMax) acc.durationMax = stepDuration;
      acc.durationValues.push(stepDuration);

      // Browser dimension
      let bStats = acc.browserMap.get(engine);
      if (!bStats) { bStats = { total: 0, failures: 0, flaky: 0 }; acc.browserMap.set(engine, bStats); }
      bStats.total++;
      if (!isOk) bStats.failures++;
      if (isFlaky) bStats.flaky++;

      // Location dimension
      let lStats = acc.locationMap.get(location);
      if (!lStats) { lStats = { total: 0, failures: 0, flaky: 0 }; acc.locationMap.set(location, lStats); }
      lStats.total++;
      if (!isOk) lStats.failures++;
      if (isFlaky) lStats.flaky++;

      // ── Accumulate trend data ─────────────────────────────────────
      let tAcc = trendAcc.get(stepName);
      if (!tAcc) {
        tAcc = { stepName, bucketMap: new Map() };
        trendAcc.set(stepName, tAcc);
      }
      let bEntry = tAcc.bucketMap.get(bucketKey);
      if (!bEntry) { bEntry = { sum: 0, count: 0 }; tAcc.bucketMap.set(bucketKey, bEntry); }
      bEntry.sum += stepDuration;
      bEntry.count++;

      // ── Record failure instances ──────────────────────────────────
      if (!isOk || isFlaky) {
        if (failureInstances.length < MAX_FAILURE_INSTANCES) {
          failureInstances.push({
            timestamp: runTsMs,
            stepName,
            isFlaky,
            browser: engine,
            location,
            error: stepError || error,
            runId,
            executionId,
          });
        }
      }
    }

    // Also check recorded steps not in last_attempt_steps for flaky detection
    for (const [stepId, def] of stepDefs) {
      if (processedSteps.has(stepId)) continue;

      const priorFailed = priorStatuses.get(stepId) === "fail";
      if (!priorFailed) continue;

      // Step was in recorded_steps and failed in a prior attempt but isn't in
      // last_attempt_steps — could be a flaky step that resolved on retry.
      const stepName = def.name || stepId;
      let acc = stepAcc.get(stepName);
      if (!acc) {
        acc = {
          name: stepName,
          selector: def.selector,
          totalExecutions: 0,
          failures: 0,
          flakyCount: 0,
          durationSum: 0,
          durationMax: 0,
          durationValues: [],
          recentRunStatuses: [],
          browserMap: new Map(),
          locationMap: new Map(),
        };
        stepAcc.set(stepName, acc);
      }
      acc.flakyCount++;
    }

    // ── Update recent-run statuses for sparklines ───────────────────
    for (const acc of stepAcc.values()) {
      // Determine this run's status for this step
      const processedInRun = lastAttemptSteps.some(
        (s: any) => {
          const sid = str(s.step_id ?? s.id);
          const def = stepDefs.get(sid);
          return (def?.name ?? sid) === acc.name;
        },
      );

      if (processedInRun) {
        if (acc.recentRunStatuses.length >= MAX_SPARKLINE_POINTS) {
          acc.recentRunStatuses.shift();
        }
        const stepFromRun = (lastAttemptSteps as any[]).find(
          (s: any) => {
            const sid = str(s.step_id ?? s.id);
            const def = stepDefs.get(sid);
            return (def?.name ?? sid) === acc.name;
          },
        );
        if (stepFromRun) {
          const runStepStatus = str(stepFromRun.status);
          const isRunOk = runStepStatus === "ok" || runStepStatus === "passed";
          const priorFailedForStep = priorStatuses.get(
            str(stepFromRun.step_id ?? stepFromRun.id),
          ) === "fail";
          if (!isRunOk) {
            acc.recentRunStatuses.push("fail");
          } else if (priorFailedForStep && attempts > 1) {
            acc.recentRunStatuses.push("flaky");
          } else {
            acc.recentRunStatuses.push("pass");
          }
        }
      }
    }
  }

  // ── Build output arrays ─────────────────────────────────────────────────

  const stepGroups: StepGroup[] = [];
  const stepFailures: StepFailure[] = [];
  const stepDurations: StepDuration[] = [];
  const flakySteps: FlakyStep[] = [];

  for (const [name, acc] of stepAcc) {
    const failRate = acc.totalExecutions > 0
      ? Math.round((acc.failures / acc.totalExecutions) * 1000) / 10
      : 0;
    const flakyRate = acc.totalExecutions > 0
      ? Math.round((acc.flakyCount / acc.totalExecutions) * 1000) / 10
      : 0;
    const avgDurationMs = acc.totalExecutions > 0
      ? Math.round(acc.durationSum / acc.totalExecutions)
      : 0;
    const failRateFull = acc.totalExecutions > 0
      ? acc.failures / acc.totalExecutions
      : 0;

    // p95: sort all collected durations and take the 95th-percentile value
    const p95DurationMs = acc.durationValues.length > 0
      ? acc.durationValues.slice().sort((a, b) => a - b)[
          Math.ceil(acc.durationValues.length * 0.95) - 1
        ] ?? 0
      : 0;

    const recentRates = acc.recentRunStatuses.map((s) =>
      s === "fail" || s === "flaky" ? 1 : 0,
    );

    stepGroups.push({
      key: `step-${name}`,
      name,
      sub: acc.selector,
      failRate: failRateFull,
      flakyRate,
      flakyCount: acc.flakyCount,
      failCount: acc.failures,
      totalExecutions: acc.totalExecutions,
      avgDurationMs,
      maxDurationMs: acc.durationMax,
      p95DurationMs,
      recentRates,
      browserStats: Array.from(acc.browserMap.entries()).map(([n, s]) => ({
        name: n,
        total: s.total,
        failures: s.failures,
        flaky: s.flaky,
      })),
      locationStats: Array.from(acc.locationMap.entries()).map(([n, s]) => ({
        name: n,
        total: s.total,
        failures: s.failures,
        flaky: s.flaky,
      })),
    });

    stepFailures.push({
      stepName: name,
      selector: acc.selector,
      failCount: acc.failures,
      totalExecutions: acc.totalExecutions,
      failRate,
    });

    stepDurations.push({
      stepName: name,
      selector: acc.selector,
      avgDurationMs,
      maxDurationMs: acc.durationMax,
      totalExecutions: acc.totalExecutions,
    });

    if (acc.flakyCount > 0) {
      flakySteps.push({
        stepName: name,
        flakyCount: acc.flakyCount,
        flakyRate,
        failRate,
        recentFlakyRates: recentRates,
      });
    }
  }

  // Sort outputs
  stepGroups.sort((a, b) => b.failRate - a.failRate || b.avgDurationMs - a.avgDurationMs);
  stepFailures.sort((a, b) => b.failCount - a.failCount);
  stepDurations.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  flakySteps.sort((a, b) => b.flakyCount - a.flakyCount);
  failureInstances.sort((a, b) => b.timestamp - a.timestamp);

  // Build trend buckets (top N steps, aggregated per time bucket)
  const topSteps = stepDurations.slice(0, TOP_TREND_STEPS).map((s) => s.stepName);
  const otherStepNames = new Set(
    stepDurations.slice(TOP_TREND_STEPS).map((s) => s.stepName),
  );

  // Merge "others" into a single series
  let othersAcc: InternalTrendAccumulator | null = null;
  const trendBuckets: TrendBucket[] = [];

  for (const [stepName, tAcc] of trendAcc) {
    if (topSteps.includes(stepName)) {
      for (const [bk, entry] of tAcc.bucketMap) {
        trendBuckets.push({
          tsMs: bk,
          stepName,
          avgDurationMs: entry.count > 0 ? Math.round(entry.sum / entry.count) : 0,
        });
      }
    } else if (otherStepNames.has(stepName)) {
      if (!othersAcc) {
        othersAcc = { stepName: "Others", bucketMap: new Map() };
      }
      for (const [bk, entry] of tAcc.bucketMap) {
        const existing = othersAcc.bucketMap.get(bk);
        if (existing) {
          existing.sum += entry.sum;
          existing.count += entry.count;
        } else {
          othersAcc.bucketMap.set(bk, { sum: entry.sum, count: entry.count });
        }
      }
    }
  }

  if (othersAcc) {
    for (const [bk, entry] of othersAcc.bucketMap) {
      trendBuckets.push({
        tsMs: bk,
        stepName: "Others",
        avgDurationMs: entry.count > 0 ? Math.round(entry.sum / entry.count) : 0,
      });
    }
  }

  trendBuckets.sort((a, b) => a.tsMs - b.tsMs || a.stepName.localeCompare(b.stepName));

  return {
    stepFailures,
    stepDurations,
    stepGroups,
    flakySteps,
    trendBuckets,
    failureInstances,
  };
}
