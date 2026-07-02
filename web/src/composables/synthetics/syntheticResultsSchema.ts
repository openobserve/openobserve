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
  error: "error",
} as const;

/**
 * Maps the semantic pass/fail notion onto the raw `status` stream values.
 * The stream stores `"up"` (run passed) / `"down"` (run failed); the typed
 * UI model exposes `"passed"` / `"failed"`. Change the right-hand values here
 * if the stream encoding ever changes.
 */
export const STATUS_VALUES = { passed: "up", failed: "down" } as const;

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
  /** Timestamp of the most recent run, milliseconds epoch, or null. */
  lastRunAt: number | null;
}

export interface SyntheticRun {
  /** Run timestamp, milliseconds epoch. */
  timestamp: number;
  status: RunStatus;
  durationMs: number;
  location: string;
  device: string;
  /** Failure reason for `down` runs (empty for passing runs). */
  error: string;
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
  // Only "up" counts as passed; "down", "error", "warning", or any unknown value is failed.
  return str(raw) === STATUS_VALUES.passed ? "passed" : "failed";
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

/** Most-recent runs for the Runs table. */
export function buildRunsSql(monitorId: string, limit: number): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT ${F.timestamp} as ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.error} as error
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
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

/** Map one runs-table hit to the typed model. */
export function mapRun(rawHit: Record<string, unknown>): SyntheticRun {
  return {
    timestamp: num(rawHit.ts) / 1000,
    status: toRunStatus(rawHit.status),
    durationMs: num(rawHit.duration),
    location: str(rawHit.location),
    device: str(rawHit.device),
    error: str(rawHit.error),
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
