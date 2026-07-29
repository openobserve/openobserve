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

/**
 * Why a run is `warning`. Written by both probes alongside `status: "warning"`
 * and by nothing else.
 *
 * `warning` is produced by two unrelated layers — the retry loop (a run that
 * failed and then passed) and a checker reporting a reachable-but-degrading
 * target. Without this discriminator a flaky rate of `warning / total` reports
 * a TLS check with a soon-expiring certificate as ~100% flaky forever, and "do
 * not alert on warning" silences certificate-expiry alerts.
 */
export const STATUS_REASON = {
  flaky: "flaky",
  certExpiring: "cert_expiring",
  sftpDegraded: "sftp_degraded",
} as const;

/**
 * Why an `error` record exists. `dispatch` — the probe was never invoked, and
 * the control plane wrote the record. `probe` — the probe ran and crashed.
 * Two structurally different records used to arrive under one status,
 * distinguishable only by sniffing which fields happened to be present.
 */
export const ERROR_SOURCE = {
  dispatch: "dispatch",
  probe: "probe",
} as const;

// ── Device display helpers ─────────────────────────────────────────────────

/**
 * Canonical set of known device IDs and their display properties.
 * When the backend adds new devices, add them here only.
 */
export const KNOWN_DEVICES: Record<string, { label: string; icon: string }> = {
  desktop: { label: "Desktop", icon: "computer" },
  tablet: { label: "Tablet", icon: "tablet" },
  mobile: { label: "Mobile", icon: "smartphone" },
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
  passedRuns: number;
  warningRuns: number;
  /** Count of runs with status = 'failed' (actual failures, not warnings or errors). */
  failedRuns: number;
  errorRuns: number;
  totalRuns: number;
  /** Count of runs that had at least one retry (attempts > 1). */
  retriedRuns: number;
  /**
   * Executions that failed and then passed on a retry (`status_reason = 'flaky'`).
   *
   * D4 — the denominator is EXECUTIONS, the same grain the runs list and uptime
   * use. One record is one execution (one location × browser × device), so
   * `flakyExecutions / totalRuns` compares like with like. Labelling it "runs"
   * would invite dividing by the number of scheduled runs, which is smaller by
   * the fan-out factor and inflates the rate several-fold.
   */
  flakyExecutions: number;
  /**
   * Executions that are `warning` for a reason other than flakiness — a
   * certificate inside its warning window, an SFTP probe that failed on an
   * otherwise healthy host. Degradation is a property of the target, not of
   * the test, so it must not read as flakiness.
   */
  degradedExecutions: number;
  lastRunStatus: RunStatus | null;
  lastRunAt: number | null;
}

// ── Run list / detail types (used by useSyntheticResults + dedicated pages) ─

export interface SyntheticRun {
  timestamp: number;
  scheduledTs: number;
  status: RunStatus;
  durationMs: number;
  /** Probe start-up, INSIDE `durationMs` — subtract, never add (C4). */
  initMs: number;
  /** When the probe actually began, in ms. 0 on records written before C5. */
  startedTs: number;
  /**
   * scheduled -> started. `null` when `startedTs` is absent, so "no delay" and
   * "the record predates the field" stay distinguishable — rendering an unknown
   * as 0 ms would claim the scheduler was perfect on every historical row.
   */
  queueDelayMs: number | null;
  /** Set only on `warning`; see STATUS_REASON. */
  statusReason: string;
  /** Set only on `error`; see ERROR_SOURCE. */
  errorSource: string;
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
  /** Spec P5.4 — present exactly when the final attempt failed. */
  failureDetail: FailureDetail | null;
  /** Browser-side evidence summary, per step that had something to report. */
  evidenceByStep: StepEvidence[];
  /** The bundle's object-storage key, when one was uploaded. */
  evidenceKey: string | null;
  /** True when the capture cap bound — X-8.2, reduced fidelity is reported. */
  evidenceTruncated: boolean;
  network: NetworkStats | null;
  webVitals: WebVitals | null;
  traceKey: string | null;
}

/** One timing phase of a protocol run (dns/connect/tls/ttfb), for waterfall display. */
export interface ProtocolTiming {
  phase: "dns" | "connect" | "tls" | "ttfb";
  ms: number;
}

/** One assertion's outcome as echoed back by the probe. */
export interface ProtocolAssertionResult {
  field: string;
  operator: string;
  value: string;
  passed: boolean;
  /** Comparison the probe made, e.g. "status 503 eq 200". Failures only. */
  detail: string;
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
  /**
   * Per-assertion verdicts as reported by the probe, in declaration order.
   * Empty for records written before the probe echoed them — callers fall back
   * to inferring a single failing row from `error` in that case.
   */
  assertions: ProtocolAssertionResult[];
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
  /** Why THIS attempt failed. Null on an attempt that passed. */
  failureDetail: FailureDetail | null;
  /** This attempt's own artifacts, uploaded under an attempt-scoped key. */
  screenshotKeys: Map<string, string>;
  traceKey: string | null;
  evidenceKey: string | null;
}

/**
 * One row of the attempts strip: the superseded attempts and the deciding one
 * in a single uniform list.
 *
 * The record stores them in two shapes — `retry_history[]` carries a compact
 * per-attempt timeline, `last_attempt_steps` carries the deciding attempt's
 * full detail. A view that has to branch on which shape it is holding ends up
 * rendering two different panels for the same concept.
 */
export interface AttemptView extends RetryAttempt {
  /**
   * The attempt whose outcome became the run's verdict — always the last one.
   * Note this is about the ATTEMPT, not the run: on a flaky run the deciding
   * attempt passed while the run is reported `warning`.
   */
  decided: boolean;
  /** True when only the compact timeline exists, so the panel shows the
   *  reduced-detail state with an explanation instead of a blank. */
  compact: boolean;
}

/**
 * The seven items of spec P5.4 — everything needed to understand a failed run
 * without reproducing it.
 *
 * Written by the probe on every failed run since Phase 5 and read by nothing.
 * Numbered here the way the spec numbers them, so a missing one is visible
 * rather than merely absent.
 */
export interface FailureDetail {
  /** 1 — which step. */
  stepId: string;
  stepName: string;
  stepIndex: number;
  /** 2 — the exact wait or assertion that timed out. */
  error: string;
  /** 3 — candidates tried, in order, with outcomes. */
  candidatesTried: LocatorAttempt[];
  /** 4 — which settle signals fired and which went stale. */
  settleSignals: SettleSignal[];
  /** 5 — observed today vs. observed while recording. */
  settleMs: number | null;
  observedDurationMs: number | null;
  /** 6 and 7 — object-storage keys, filled after upload. */
  screenshotKey: string | null;
  traceKey: string | null;
}

/** One locator candidate the probe tried, and what happened to it. */
export interface LocatorAttempt {
  kind: string;
  value: string;
  outcome: "matched" | "not_found" | "used_as_primary" | "not_tried";
}

/** One recorded settle signal, and whether it arrived this run. */
export interface SettleSignal {
  kind: "navigation" | "response";
  signal: string;
  status: "fired" | "stale";
  required: boolean;
  waitedMs: number;
}

/**
 * Per-step counts from the evidence bundle, inlined on the record.
 *
 * The bundle itself lives in object storage; this fixed shape is what makes
 * "every failure of step 9 last week that coincided with a 5xx" an ordinary
 * query — no join, no new stream, nothing unbounded in the record.
 */
export interface StepEvidence {
  stepId: string;
  consoleErrors: number;
  pageErrors: number;
  requestsFailed: number;
  responsesNon2xx: number;
  worstResponses: Array<{ method: string; url: string; status: number; count: number }>;
  firstConsoleErrors: string[];
}

// ── Evidence bundle (evidence.ndjson) ──────────────────────────────────────
//
// The bundle is the full browser-side log for one ATTEMPT: console messages,
// page errors, and network requests/responses, each attributed to the step whose
// window it fell in. `evidence_by_step` on the record is only an anomaly INDEX —
// `summarise()` emits a row solely for a step that had a console error, a page
// error, a failed request or a non-2xx response. A run whose network was healthy
// therefore carries an empty index while the bundle holds every event, which is
// why the panel reads the bundle rather than the index.

export type EvidenceKind =
  | "console"
  | "pageerror"
  | "response"
  | "requestfailed"
  | "dialog"
  | "crash"
  | "truncation";

export interface EvidenceEvent {
  /** When the event was OBSERVED. */
  ts: number;
  /** Which step's window it fell in. Absent if bucketing could not attribute it. */
  stepId: string | null;
  kind: EvidenceKind;
  // console
  level: string | null;
  text: string | null;
  // pageerror / crash / dialog
  message: string | null;
  stack: string | null;
  // network
  method: string | null;
  url: string | null;
  status: number | null;
  resourceType: string | null;
  /**
   * When the request STARTED, which is what the event is bucketed on.
   *
   * Kept alongside `ts` because work begun in step 9 routinely completes during
   * step 10; collapsing them would hide the ambiguity rather than show it.
   */
  initiatedTs: number | null;
  durationMs: number | null;
  firstParty: boolean;
  /** Resolved step name, filled by `foldEvidenceBundle`. Null when unattributed. */
  stepName?: string | null;
}

function evidenceNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse one NDJSON bundle.
 *
 * NDJSON, not JSON — one object per line. `JSON.parse` on the whole payload
 * fails, which is why the download button must not be labelled "JSON" either.
 *
 * Parsed per line and guarded per line: a single malformed line drops that line
 * rather than the panel. A truncated upload ends mid-line by construction, so
 * this is the expected case at the cap, not a corruption.
 */
export function parseEvidenceNdjson(text: string): EvidenceEvent[] {
  const out: EvidenceEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e: any;
    try {
      e = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    out.push({
      ts: evidenceNum(e.ts) ?? 0,
      stepId: e.step_id ? str(e.step_id) : null,
      kind: (e.kind ?? "response") as EvidenceKind,
      level: e.level ? str(e.level) : null,
      text: e.text ? str(e.text) : null,
      message: e.message ? str(e.message) : null,
      stack: e.stack ? str(e.stack) : null,
      method: e.method ? str(e.method) : null,
      url: e.url ? str(e.url) : null,
      status: evidenceNum(e.status),
      resourceType: e.resource_type ? str(e.resource_type) : null,
      initiatedTs: evidenceNum(e.initiated_ts),
      durationMs: evidenceNum(e.duration_ms),
      firstParty: e.first_party !== false,
    });
  }
  return out;
}

/** Is this event something an engineer would call a problem? */
export function isEvidenceAnomaly(e: EvidenceEvent): boolean {
  if (e.kind === "console") return e.level === "error";
  if (e.kind === "pageerror" || e.kind === "crash" || e.kind === "requestfailed") return true;
  return e.kind === "response" && (e.status ?? 0) >= 400;
}

/**
 * One kind of event, in the order the events were initiated.
 *
 * Grouped by KIND, not by step. Step grouping reads well in a wireframe and
 * degenerates on real data: a live 158-event bundle held only two distinct
 * `step_id`s, so it produced one group of 136 and one of 22 — the grouping told
 * the reader nothing the flat list didn't. Kind also matches what devtools
 * trains people to expect (Console / Network).
 *
 * Attribution is not lost, it moves: every row carries its resolved step name.
 */
export interface EvidenceGroup {
  kind: "pageErrors" | "requestsFailed" | "console" | "network";
  events: EvidenceEvent[];
  /** True when any event in the group is an anomaly — drives the header accent. */
  hasAnomaly: boolean;
}

export interface EvidenceBundle {
  events: EvidenceEvent[];
  groups: EvidenceGroup[];
  counts: {
    all: number;
    consoleErrors: number;
    pageErrors: number;
    requestsFailed: number;
    nonNon2xx: number;
  };
  /** A `truncation` event in the stream, or `evidence_truncated` on the record. */
  truncated: boolean;
}

/** Severity order: what to read first, not what there is most of. */
const EVIDENCE_GROUP_ORDER: EvidenceGroup["kind"][] = [
  "pageErrors",
  "requestsFailed",
  "console",
  "network",
];

function groupKindOf(e: EvidenceEvent): EvidenceGroup["kind"] {
  if (e.kind === "pageerror" || e.kind === "crash") return "pageErrors";
  if (e.kind === "requestfailed") return "requestsFailed";
  if (e.kind === "console" || e.kind === "dialog") return "console";
  return "network";
}

/**
 * Fold a bundle into the panel's view model.
 *
 * `stepDefs` resolves each event's `step_id` to a name for display on the row.
 * An unresolved id renders as the id — never blank, and never guessed from the
 * check's current config, which would relabel history after an edit.
 */
export function foldEvidenceBundle(
  events: EvidenceEvent[],
  stepDefs: Map<string, { name: string }> | Map<string, { name: string; selector: string | null }>,
  recordTruncated = false,
): EvidenceBundle {
  const named = events.map((e) => ({
    ...e,
    stepName: e.stepId ? (stepDefs.get(e.stepId)?.name || e.stepId) : null,
  }));

  const byKind = new Map<EvidenceGroup["kind"], EvidenceEvent[]>();
  for (const e of named) {
    const k = groupKindOf(e);
    const list = byKind.get(k);
    if (list) list.push(e);
    else byKind.set(k, [e]);
  }

  const groups: EvidenceGroup[] = EVIDENCE_GROUP_ORDER.filter((k) => byKind.has(k)).map((kind) => {
    const list = [...byKind.get(kind)!].sort(
      (x, y) => (x.initiatedTs ?? x.ts) - (y.initiatedTs ?? y.ts),
    );
    return { kind, events: list, hasAnomaly: list.some(isEvidenceAnomaly) };
  });

  return {
    events: named,
    groups,
    counts: {
      all: named.length,
      consoleErrors: named.filter((e) => e.kind === "console" && e.level === "error").length,
      pageErrors: named.filter((e) => e.kind === "pageerror" || e.kind === "crash").length,
      requestsFailed: named.filter((e) => e.kind === "requestfailed").length,
      nonNon2xx: named.filter((e) => e.kind === "response" && (e.status ?? 0) >= 400).length,
    },
    truncated: recordTruncated || named.some((e) => e.kind === "truncation"),
  };
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
  warningRuns: number;
  /** Count of runs with status = 'failed' (actual failures, not warnings or errors). */
  failedRuns: number;
  errorRuns: number;
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

/**
 * What the step tally actually covered (P2a).
 *
 * The query takes the newest N rows, so on a busy check the panel describes a
 * window far shorter than the one the time picker shows — a 1-minute check
 * across 2 locations × 4 browser/device combos produces 11 520 executions a
 * day, so a 5000-row cap is about ten hours of a "last 7 days" selection. The
 * numbers were right; the label was wrong, and silently so.
 */
export interface StepStatsCoverage {
  /** Executions actually tallied. */
  executions: number;
  /** Oldest and newest execution in the tally, in ms. 0 when empty. */
  fromMs: number;
  toMs: number;
  /** The row cap bound, so the window is narrower than the one requested. */
  truncated: boolean;
}

export interface StepStatsResult {
  stepFailures: StepFailure[];
  stepDurations: StepDuration[];
  stepGroups: StepGroup[];
  flakySteps: FlakyStep[];
  trendBuckets: TrendBucket[];
  failureInstances: StepFailureInstance[];
  coverage: StepStatsCoverage;
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

/**
 * The probe writes `assertions` as an array; OpenObserve stores it as a JSON
 * string (same as last_attempt_steps), so accept either. `value` is normalised
 * to a string because the probe sends numerics as numbers.
 */
function parseAssertions(raw: unknown): ProtocolAssertionResult[] {
  return parseJsonArray(raw).map((a: any) => ({
    field: str(a?.field),
    operator: str(a?.operator),
    value: a?.value == null ? "" : String(a.value),
    passed: Boolean(a?.passed),
    detail: str(a?.detail),
  }));
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
  /** Whether the stream schema includes `status_reason`. Same gate: the search
   * API rejects a query naming a field the schema doesn't have. */
  hasStatusReasonField = false,
): string {
  const id = escapeSqlLiteral(monitorId);
  const retriedClause = hasAttemptsField
    ? `\n  COUNT(*) FILTER (WHERE attempts > 1) as retried_runs,`
    : "";
  // `warning` is produced by two unrelated layers: the retry loop (flaky) and a
  // checker reporting a reachable-but-degrading target (cert_expiring,
  // sftp_degraded). Counting them together reported a TLS check with a
  // soon-expiring certificate as ~100% flaky forever. `status_reason` splits
  // them, and these are two more FILTER clauses over the scan the query
  // already does — no extra pass, no extra bytes.
  const reasonClauses = hasStatusReasonField
    ? `\n  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.warning}' AND status_reason = '${STATUS_REASON.flaky}') as flaky_runs,` +
      `\n  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.warning}' AND status_reason != '' AND status_reason != '${STATUS_REASON.flaky}') as degraded_runs,`
    : "";
  return `SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.passed}') as passed_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.warning}') as warning_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.failed}') as failed_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.error}') as error_runs,${retriedClause}${reasonClauses}
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
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.warning}') as warning_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.failed}') as failed_runs,
  COUNT(*) FILTER (WHERE ${F.status} = '${STATUS_VALUES.error}') as error_runs
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
/**
 * PROJECTION RULE — do not break this.
 *
 * The list and KPI queries name their columns explicitly and MUST NOT select
 * `retry_history`, `recorded_steps`, `last_attempt_steps`, `assertions` or
 * `evidence_by_step`. Those are JSON blob columns; on a 5000-row aggregation
 * one of them was ~20 MB of duplicated payload.
 *
 * Blob columns belong to the single-row detail query only
 * (`buildRunDetailSql` / `buildProtocolRunDetailSql` use `SELECT *`
 * deliberately — one row).
 *
 * `buildRunsWithStepsSql` is the one intentional exception: it needs
 * `last_attempt_steps` and `retry_history` to tally per-step stats. It still
 * must not select `recorded_steps` — see `buildStepDefsSql`.
 */
const RUNS_COLUMNS: { field: string; alias: string; fallback: string }[] = [
  { field: F.timestamp, alias: "ts", fallback: "0" },
  { field: "scheduled_ts", alias: "scheduled_ts", fallback: "0" },
  { field: F.status, alias: "status", fallback: "''" },
  { field: F.duration, alias: "duration", fallback: "0" },
  // C4 — probe start-up, already inside `duration`. Observed at 113 131 ms on a
  // cold Lambda against a 243 ms check: unsubtracted, Lambda locations look
  // permanently slower than private agents at every percentile.
  { field: "init_ms", alias: "init_ms", fallback: "0" },
  // C5 — with only scheduled_ts and _timestamp, queue delay and run duration
  // are one number. started_ts splits them: scheduled -> started is the delay
  // the scheduler owns, started -> completed is the check itself.
  { field: "started_ts", alias: "started_ts", fallback: "0" },
  // Warning-only and error-only discriminators; '' means "not set / older row".
  { field: "status_reason", alias: "status_reason", fallback: "''" },
  { field: "error_source", alias: "error_source", fallback: "''" },
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
  // `recorded_steps` is deliberately NOT selected here. It is ~4 KB per row and
  // near-identical across rows of one config version, so selecting it on a
  // 5000-row aggregation dragged ~20 MB of duplicate step definitions across
  // the wire — roughly 60% of the panel's payload. The step_id → {name,
  // selector} lookup comes from `buildStepDefsSql` over a bounded row subset
  // instead.
  return `SELECT ${F.timestamp} as ts, scheduled_ts, ${F.status} as status, ${F.duration} as duration, ${F.location} as location, ${F.device} as device, ${F.engine} as engine, trigger_type, ${F.error} as error, job_id, run_id, execution_id, attempts, last_attempt_steps${retryHistoryCol}
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}'
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
}

/**
 * Step definitions for the name/selector lookup, from a bounded row subset.
 *
 * Deliberately NOT sourced from the check's current `config.steps`: a user can
 * edit steps at any time, and each result stores the definitions **as they were
 * at run time**. Reading the live config would silently relabel history.
 *
 * Step ids are stable across edits, so unioning the newest N rows resolves every
 * definition version present in practice. A `step_id` that appears in the tally
 * but not in this lookup renders as its id.
 */
/**
 * Which steps this check retries on, and whether it always retries the same way.
 *
 * This replaces reading `retry_history` on every row of the step tally. That
 * column is ~1 KB per attempt and was fetched across 5000 rows purely to
 * recover the step ids inside it — tens of megabytes to answer a question that
 * is three scalars per row.
 *
 * The probe now denormalises those scalars into columns (`retry_step_ids`,
 * `retry_error_classes`, `retry_consistent`), because OpenObserve stores arrays
 * as opaque JSON strings — no `unnest`, no `arr_index` — so the array cannot be
 * aggregated in SQL at all. Only rows that actually retried are scanned.
 */
export function buildRetryAttributionSql(
  monitorId: string,
  limit = 5000,
  /** Whether `status_reason` is in the stream schema.
   *
   * It is written ONLY on `warning`, so on a deployment where nothing has ever
   * recovered-on-retry or reported a degraded target, the field does not exist
   * — and the search API rejects any query naming a field the schema lacks.
   * Naming it unconditionally took the whole Steps tab down with
   * "unknown field 'status_reason'". */
  hasStatusReason = true,
): string {
  const id = escapeSqlLiteral(monitorId);
  // Absent `status_reason` is itself informative: no warning record with a
  // reason has ever been written, so nothing in this window recovered.
  const reasonCol = hasStatusReason ? "status_reason" : "'' as status_reason";
  return `SELECT ${F.executionId} as execution_id, ${F.status} as status, ${reasonCol}, attempts, retry_step_ids, retry_error_classes, retry_consistent
FROM ${TABLE}
WHERE ${F.monitorId} = '${id}' AND attempts > 1
ORDER BY ${F.timestamp} DESC
LIMIT ${limit}`;
}

/** One step's retry profile, from `buildRetryAttributionSql`. */
export interface StepRetryProfile {
  /** Executions that retried and involved this step. */
  retriedExecutions: number;
  /** Of those, the ones that recovered — failed, retried, passed. */
  flakyExecutions: number;
}

export interface RetryAttributionSummary {
  /**
   * execution_id → the steps that failed in some attempt of that execution.
   *
   * The per-execution join the step tally needs. Without it the tally has to
   * re-parse `retry_history` on every row, which is the fetch C7 exists to
   * delete.
   */
  byExecution: Map<string, Set<string>>;
  byStep: Map<string, StepRetryProfile>;
  byErrorClass: Map<string, number>;
  /** Executions that retried and failed the same way every time. */
  consistentFailures: number;
  /** Executions that retried at all — the denominator for the two above. */
  retriedExecutions: number;
}

/**
 * Split a delimited attribution column back into its members.
 *
 * The probe wraps the set in leading and trailing commas so that `LIKE '%,s2,%'`
 * is an exact membership test rather than a substring match that also finds
 * `s20`. Splitting therefore has to drop the empty leading and trailing
 * segments that wrapping produces.
 */
export function splitDelimited(raw: unknown): string[] {
  const v = str(raw);
  if (!v) return [];
  return v.split(",").filter(Boolean);
}

export function foldRetryAttribution(
  hits: Record<string, unknown>[],
): RetryAttributionSummary {
  const byExecution = new Map<string, Set<string>>();
  const byStep = new Map<string, StepRetryProfile>();
  const byErrorClass = new Map<string, number>();
  let consistentFailures = 0;
  let retriedExecutions = 0;

  for (const hit of hits) {
    retriedExecutions++;
    const executionId = str(hit.execution_id);
    const stepIds = splitDelimited(hit.retry_step_ids);
    if (executionId) byExecution.set(executionId, new Set(stepIds));
    // D2 — attribution is written on ANY retried execution, not only flaky
    // ones, so "recovered" has to be read from the verdict rather than assumed
    // from the row's presence.
    const recovered =
      str(hit.status) === STATUS_VALUES.warning && str(hit.status_reason) === STATUS_REASON.flaky;

    for (const stepId of stepIds) {
      const acc = byStep.get(stepId) ?? { retriedExecutions: 0, flakyExecutions: 0 };
      acc.retriedExecutions++;
      if (recovered) acc.flakyExecutions++;
      byStep.set(stepId, acc);
    }
    for (const cls of splitDelimited(hit.retry_error_classes)) {
      byErrorClass.set(cls, (byErrorClass.get(cls) ?? 0) + 1);
    }
    // Only an explicit `true` counts. `retry_consistent` is deliberately absent
    // when fewer than two attempts failed (D1) — treating absent as `false`
    // would report every recovered run as non-deterministic.
    if (hit.retry_consistent === true) consistentFailures++;
  }

  return { byExecution, byStep, byErrorClass, consistentFailures, retriedExecutions };
}

/** One (location, device, engine) slice of a check, and how settled it is. */
export interface PartitionStability {
  key: string;
  location: string;
  device: string;
  engine: string;
  executions: number;
  /** Pass ↔ not-pass changes across the window, in time order. */
  transitions: number;
  /** Two or more transitions: the outcome is oscillating, not merely down. */
  unstable: boolean;
}

/**
 * Which slices of a check are oscillating.
 *
 * Partitioned by (location, device, engine) because those are the axes a run
 * fans out along. Aggregated across them, a check that is solidly broken in one
 * region and solidly healthy in five reads as an 83% pass rate — indistinguish-
 * able from one that is intermittently broken everywhere, which is a completely
 * different problem with a completely different fix.
 *
 * "Unstable" means the outcome CHANGED repeatedly, not that it is bad. A slice
 * that failed once and stayed failed is down — one transition — and belongs on
 * the failure tile, not here. Two or more transitions is the smallest signal
 * that cannot be explained by a single state change.
 *
 * Computed client-side over rows `buildRunsSql` already returns: no extra query.
 */
export function computePartitionStability(runs: SyntheticRun[]): PartitionStability[] {
  const groups = new Map<string, SyntheticRun[]>();
  for (const run of runs) {
    const key = `${run.location}|${run.device}|${run.browserEngine}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(run);
    else groups.set(key, [run]);
  }

  const out: PartitionStability[] = [];
  for (const [key, group] of groups) {
    // Oldest-first: a transition is only meaningful in time order.
    const ordered = [...group].sort((a, b) => a.timestamp - b.timestamp);
    let transitions = 0;
    let previous: boolean | null = null;
    for (const run of ordered) {
      // `error` means we could not look, so it is neither a pass nor a failure
      // and must not register as a transition in either direction.
      if (run.status === STATUS_VALUES.error) continue;
      const healthy = run.status === STATUS_VALUES.passed || run.status === STATUS_VALUES.warning;
      if (previous !== null && healthy !== previous) transitions++;
      previous = healthy;
    }
    const [location = "", device = "", engine = ""] = key.split("|");
    out.push({
      key,
      location,
      device,
      engine,
      executions: group.length,
      transitions,
      unstable: transitions >= 2,
    });
  }
  return out.sort((a, b) => b.transitions - a.transitions);
}

/** Fold `recorded_steps` blobs into one step_id → definition lookup.
 *  Rows arrive newest-first, so the first definition seen for an id wins and a
 *  rename shows its current name while older rows still resolve. */
export function foldStepDefs(
  hits: Record<string, unknown>[],
): Map<string, { name: string; selector: string | null }> {
  const defs = new Map<string, { name: string; selector: string | null }>();
  for (const hit of hits) {
    for (const rs of parseJsonArray(hit.recorded_steps) as any[]) {
      const id = str(rs.id);
      if (!id || defs.has(id)) continue;
      defs.set(id, { name: str(rs.name) || id, selector: effectiveSelector(rs) });
    }
  }
  return defs;
}

export function buildStepDefsSql(monitorId: string, limit = 100): string {
  const id = escapeSqlLiteral(monitorId);
  return `SELECT recorded_steps
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
  { field: "scheduled_ts", alias: "scheduled_ts", fallback: "0" },
  // C4 — probe start-up, already inside `duration`. Observed at 113 131 ms on a
  // cold Lambda against a 243 ms check: unsubtracted, Lambda locations look
  // permanently slower than private agents at every percentile.
  { field: "init_ms", alias: "init_ms", fallback: "0" },
  // C5 — with only scheduled_ts and _timestamp, queue delay and run duration
  // are one number. started_ts splits them: scheduled -> started is the delay
  // the scheduler owns, started -> completed is the check itself.
  { field: "started_ts", alias: "started_ts", fallback: "0" },
  // Warning-only and error-only discriminators; '' means "not set / older row".
  { field: "status_reason", alias: "status_reason", fallback: "''" },
  { field: "error_source", alias: "error_source", fallback: "''" },
  { field: "job_id", alias: "job_id", fallback: "''" },
  { field: F.executionId, alias: "execution_id", fallback: "''" },
  { field: "trace_key", alias: "trace_key", fallback: "''" },
  { field: "run_id", alias: "run_id", fallback: "''" },
  // C2 — the attempts strip and the retry chip read these. Selecting them here
  // is correct and is NOT a violation of the projection rule: that rule bans
  // blob columns from the LIST and KPI queries, which scan thousands of rows.
  // This query fetches ONE row, which is exactly why the attempts view costs no
  // extra request. Without them `retry_history` was always empty, so the strip
  // never rendered and `attempts` was always 0.
  { field: "attempts", alias: "attempts", fallback: "0" },
  { field: "retry_history", alias: "retry_history", fallback: "''" },
  { field: "total_attempt_ms", alias: "total_attempt_ms", fallback: "0" },
  // NOT `failure_detail` — OpenObserve flattens nested objects into columns, so
  // the record carries `failure_detail_step_id`, `failure_detail_error`, … and
  // no `failure_detail` at all. Naming the object would be rejected exactly as
  // `status_reason` was in the step-stats query. Reassembled by
  // `flattenedFailureDetail` below.
  { field: "failure_detail_step_id", alias: "failure_detail_step_id", fallback: "''" },
  { field: "failure_detail_step_name", alias: "failure_detail_step_name", fallback: "''" },
  { field: "failure_detail_step_index", alias: "failure_detail_step_index", fallback: "0" },
  { field: "failure_detail_error", alias: "failure_detail_error", fallback: "''" },
  {
    field: "failure_detail_candidates_tried",
    alias: "failure_detail_candidates_tried",
    fallback: "''",
  },
  {
    field: "failure_detail_settle_signals",
    alias: "failure_detail_settle_signals",
    fallback: "''",
  },
  { field: "failure_detail_settle_ms", alias: "failure_detail_settle_ms", fallback: "0" },
  {
    field: "failure_detail_observed_duration_ms",
    alias: "failure_detail_observed_duration_ms",
    fallback: "0",
  },
  {
    field: "failure_detail_screenshot_key",
    alias: "failure_detail_screenshot_key",
    fallback: "''",
  },
  // Evidence: the key opens the bundle, the summary is the inline anomaly index,
  // and `evidence_truncated` is what stops a capped capture reading as a quiet run.
  { field: "evidence_key", alias: "evidence_key", fallback: "''" },
  { field: "evidence_by_step", alias: "evidence_by_step", fallback: "''" },
  { field: "evidence_truncated", alias: "evidence_truncated", fallback: "false" },
  // Drives the determinism line. NULL below two failing attempts (D1), so the
  // UI must distinguish absent from false.
  { field: "retry_consistent", alias: "retry_consistent", fallback: "NULL" },
  { field: "retry_step_ids", alias: "retry_step_ids", fallback: "''" },
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
  const select = RUN_DETAIL_COLUMNS.map(
    ({ field, alias, fallback }) => `${has(field) ? field : fallback} as ${alias}`,
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
  const warningRuns = num(rawKpiRow?.warning_runs);
  const failedRuns = num(rawKpiRow?.failed_runs);
  const errorRuns = num(rawKpiRow?.error_runs);
  const retriedRuns = num(rawKpiRow?.retried_runs);
  const flakyExecutions = num(rawKpiRow?.flaky_runs);
  const degradedExecutions = num(rawKpiRow?.degraded_runs);
  const lastRunTsRaw = rawLastRun ? num(rawLastRun.ts) : 0;
  return {
    // P6a — `error` is excluded from BOTH sides. It means "we could not look",
    // not "the service was down"; leaving it in the denominator understates
    // uptime by exactly our own dispatch-failure rate. `errorRuns` is reported
    // separately so the omission is visible rather than silent.
    uptimePct:
      totalRuns - errorRuns > 0
        ? ((passedRuns + warningRuns) / (totalRuns - errorRuns)) * 100
        : 0,
    p95Ms: num(rawKpiRow?.p95_duration),
    passedRuns,
    warningRuns,
    failedRuns,
    errorRuns,
    totalRuns,
    retriedRuns,
    flakyExecutions,
    degradedExecutions,
    lastRunStatus: rawLastRun ? toRunStatus(rawLastRun.status) : null,
    lastRunAt: lastRunTsRaw > 0 ? lastRunTsRaw / 1000 : null,
  };
}

export function mapRun(rawHit: Record<string, unknown>): SyntheticRun {
  const scheduledTs = num(rawHit.scheduled_ts) / 1000;
  const startedTs = num(rawHit.started_ts) / 1000;
  return {
    timestamp: num(rawHit.ts) / 1000,
    scheduledTs,
    status: toRunStatus(rawHit.status),
    durationMs: num(rawHit.duration),
    initMs: num(rawHit.init_ms),
    startedTs,
    // Both stamps must be present for the difference to mean anything, and a
    // negative delay is a clock artefact, not a scheduler that ran early.
    queueDelayMs:
      startedTs > 0 && scheduledTs > 0 ? Math.max(0, Math.round(startedTs - scheduledTs)) : null,
    statusReason: str(rawHit.status_reason),
    errorSource: str(rawHit.error_source),
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

/**
 * `status` is READ, not derived.
 *
 * It used to be hard-coded to `"failed"` on the reasoning that an entry existed
 * only because that attempt failed. The probe now records every attempt, the
 * deciding one included, so hard-coding would report a passing final attempt as
 * a failure — and on a flaky run that is the only attempt that passed.
 *
 * `durationMs` prefers the probe's own `response_time_ms`. Summing step
 * durations misses everything between steps (browser launch, settle waits, the
 * navigation a step triggers), which on a real journey is most of the time.
 */
function mapRetryHistory(raw: unknown): RetryAttempt[] {
  // `parseJsonArray`, not `Array.isArray`: the search API hands blob columns
  // back as JSON STRINGS. Guarding on Array.isArray meant this returned [] for
  // every real row, so the attempts strip could never render no matter what the
  // query selected — `aggregateStepStats` already parsed the same column
  // correctly, which is what hid the asymmetry.
  return parseJsonArray(raw).map((a: any, i: number) => {
    // Normalised to the same vocabulary `lastAttemptSteps` uses. The probe
    // writes `passed`/`failed`/`skipped` on the compact timeline while
    // `StepExecution` declares `ok`/`fail`/`skipped`, and every consumer tests
    // for `fail` — so passing these through raw rendered a superseded attempt's
    // FAILING step as a pass: a green tick on the step that actually broke.
    //
    // `skipped` survives: an `optional` step exists precisely because it may not
    // be there, and collapsing it to `fail` reports a correctly-skipped step as
    // a broken one.
    const steps: StepExecution[] = parseJsonArray(a?.steps).map((st: any) => ({
      ...st,
      status:
        st?.status === "ok" || st?.status === "passed"
          ? ("ok" as const)
          : st?.status === "skipped"
            ? ("skipped" as const)
            : ("fail" as const),
    }));
    const summed = steps.reduce((sum, st) => sum + (st.duration_ms ?? 0), 0);
    const refs: Array<{ step_id?: unknown; key?: unknown }> = Array.isArray(
      a?.artifacts?.screenshot_refs,
    )
      ? a.artifacts.screenshot_refs
      : [];
    return {
      attempt: typeof a?.attempt === "number" ? a.attempt : i,
      status: a?.status === STATUS_VALUES.passed ? STATUS_VALUES.passed : STATUS_VALUES.failed,
      durationMs: typeof a?.response_time_ms === "number" ? a.response_time_ms : summed,
      failedStep:
        a?.failure_detail?.step_id ??
        steps.find((st: any) => st.status === "failed" || st.status === "fail")?.step_id ??
        null,
      steps,
      failureDetail: mapFailureDetail(a?.failure_detail),
      screenshotKeys: new Map(refs.map((r) => [str(r.step_id), str(r.key)])),
      traceKey: a?.artifacts?.trace_ref ? str(a.artifacts.trace_ref) : null,
      evidenceKey: a?.artifacts?.evidence_ref ? str(a.artifacts.evidence_ref) : null,
    };
  });
}

/**
 * Fold a run detail into the uniform attempts strip.
 *
 * Costs NO query: `retry_history` is already on the run-detail row, so
 * switching between attempts is local state, not a fetch.
 *
 * The last entry is the deciding attempt, and it is the one the record's
 * top-level fields describe — so its compact timeline is replaced with
 * `lastAttemptSteps` and its artifacts with the record's own. Earlier attempts
 * keep the compact form and are marked as such, which is what lets the panel
 * explain the reduced detail rather than render an empty forensics section.
 */
export function buildAttemptViews(detail: SyntheticRunDetail): AttemptView[] {
  const history = detail.retryHistory;
  // A run with no history at all is still one attempt — the one that ran.
  if (history.length === 0) {
    return [
      {
        attempt: 0,
        status: detail.status === STATUS_VALUES.passed ? STATUS_VALUES.passed : STATUS_VALUES.failed,
        durationMs: detail.durationMs,
        failedStep: detail.failedStep,
        steps: detail.lastAttemptSteps,
        failureDetail: detail.failureDetail,
        screenshotKeys: new Map(),
        traceKey: detail.traceKey,
        evidenceKey: detail.evidenceKey,
        decided: true,
        compact: false,
      },
    ];
  }

  return history.map((a, i) => {
    const decided = i === history.length - 1;
    if (!decided) return { ...a, decided, compact: true };
    return {
      ...a,
      steps: detail.lastAttemptSteps.length ? detail.lastAttemptSteps : a.steps,
      failureDetail: detail.failureDetail ?? a.failureDetail,
      traceKey: detail.traceKey ?? a.traceKey,
      evidenceKey: detail.evidenceKey ?? a.evidenceKey,
      decided,
      compact: false,
    };
  });
}

function mapEvidence(raw: unknown): StepEvidence[] {
  // Same string-vs-array trap as mapRetryHistory.
  return parseJsonArray(raw).map((e: any) => ({
    stepId: str(e?.step_id),
    consoleErrors: e?.console_errors ?? 0,
    pageErrors: e?.page_errors ?? 0,
    requestsFailed: e?.requests_failed ?? 0,
    responsesNon2xx: e?.responses_non_2xx ?? 0,
    worstResponses: Array.isArray(e?.worst_responses) ? e.worst_responses : [],
    firstConsoleErrors: Array.isArray(e?.first_console_errors) ? e.first_console_errors : [],
  }));
}

/**
 * `traceKey` is passed in rather than read off the failure detail: the trace
 * covers the whole execution, not the failing step, so it lives on the record.
 * The probe used to duplicate it inside `failure_detail` as well — records
 * written then still carry it, so that value is preferred when present and the
 * record-level key is the fallback.
 */
function mapFailureDetail(raw: unknown, recordTraceKey?: unknown): FailureDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as any;
  return {
    stepId: str(d.step_id),
    stepName: str(d.step_name),
    stepIndex: typeof d.step_index === "number" ? d.step_index : 0,
    error: str(d.error),
    candidatesTried: Array.isArray(d.candidates_tried) ? d.candidates_tried : [],
    settleSignals: Array.isArray(d.settle_signals)
      ? d.settle_signals.map((sig: any) => ({
          kind: sig?.kind,
          signal: str(sig?.signal),
          status: sig?.status,
          required: !!sig?.required,
          waitedMs: typeof sig?.waited_ms === "number" ? sig.waited_ms : 0,
        }))
      : [],
    settleMs: typeof d.settle_ms === "number" ? d.settle_ms : null,
    observedDurationMs:
      typeof d.observed_duration_ms === "number" ? d.observed_duration_ms : null,
    screenshotKey: d.screenshot_key ? str(d.screenshot_key) : null,
    traceKey: d.trace_key ? str(d.trace_key) : recordTraceKey ? str(recordTraceKey) : null,
  };
}

/**
 * Rebuild the nested `failure_detail` object from its flattened columns.
 *
 * The probe writes a nested object; the stream stores it as
 * `failure_detail_<field>` columns. `SELECT *` (the protocol path) returns the
 * flattened form, and so does the browser detail query now that it names them.
 * Either way the mapper wants one object.
 *
 * Returns null when there is no failing step, so a passing run does not get an
 * empty forensics panel.
 */
function flattenedFailureDetail(rawHit: Record<string, unknown>): unknown {
  if (rawHit.failure_detail) return rawHit.failure_detail; // already nested
  const stepId = str(rawHit.failure_detail_step_id);
  if (!stepId) return null;
  return {
    step_id: stepId,
    step_name: str(rawHit.failure_detail_step_name),
    step_index: num(rawHit.failure_detail_step_index),
    error: str(rawHit.failure_detail_error),
    candidates_tried: parseJsonArray(rawHit.failure_detail_candidates_tried),
    settle_signals: parseJsonArray(rawHit.failure_detail_settle_signals),
    settle_ms: rawHit.failure_detail_settle_ms == null
      ? undefined
      : num(rawHit.failure_detail_settle_ms),
    observed_duration_ms: rawHit.failure_detail_observed_duration_ms == null
      ? undefined
      : num(rawHit.failure_detail_observed_duration_ms),
    screenshot_key: rawHit.failure_detail_screenshot_key
      ? str(rawHit.failure_detail_screenshot_key)
      : undefined,
  };
}

export function mapRunDetail(rawHit: Record<string, unknown>): SyntheticRunDetail | null {
  if (!rawHit) return null;
  const base = mapRun({
    ts: rawHit.ts ?? rawHit._timestamp,
    status: rawHit.status,
    duration: rawHit.duration ?? rawHit.response_time_ms,
    // Forwarded so the drawer can show init cost and queue delay from the same
    // mapper the list uses, rather than re-deriving them (C4, C5).
    scheduled_ts: rawHit.scheduled_ts,
    started_ts: rawHit.started_ts,
    init_ms: rawHit.init_ms,
    status_reason: rawHit.status_reason,
    error_source: rawHit.error_source,
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
    // The field is `attempts`; reading `attempt` returned undefined on every
    // record, so the count rendered as 0 and the retry chip never appeared.
    // `retry_history` is the fallback — with every attempt recorded, its length
    // is the same number.
    // `parseJsonArray` on the fallback too — `retry_history` arrives as a JSON
    // string, so `Array.isArray` made this branch dead for every real record.
    attempts: num(rawHit.attempts) || parseJsonArray(rawHit.retry_history).length,
    failedStep: rawHit.failed_step
      ? str(rawHit.failed_step)
      : (rawStepsArr.find((s: any) => s.status === "fail" || s.status === "failed")?.step_id ??
        null),
    recordedSteps: Array.isArray(rawRecordedSteps) ? (rawRecordedSteps as RecordedStep[]) : [],
    // `skipped` is a real outcome, not a failure. An `optional` step exists
    // precisely because it may not be there — a cookie banner, a one-time
    // popup — and collapsing it to `fail` reported a correctly-skipped step as
    // a broken one, which is the opposite of what the flow-control feature is
    // for. The type has always allowed all three; only this mapper did not.
    lastAttemptSteps: rawStepsArr.map((s: any) => ({
      ...s,
      status:
        s.status === "ok" || s.status === "passed"
          ? ("ok" as const)
          : s.status === "skipped"
            ? ("skipped" as const)
            : ("fail" as const),
    })),
    // The probe writes retry_history on every failed run; the mapper discarded
    // it before any component could read it. A step that failed once and passed
    // on the next attempt is transient by definition, and this is the only place
    // that fact survives.
    retryHistory: mapRetryHistory(rawHit.retry_history),
    failureDetail: mapFailureDetail(flattenedFailureDetail(rawHit), rawHit.trace_key),
    evidenceByStep: mapEvidence(rawHit.evidence_by_step),
    evidenceKey: rawHit.evidence_key ? str(rawHit.evidence_key) : null,
    evidenceTruncated: !!rawHit.evidence_truncated,
    network: null,
    webVitals: null,
    traceKey: rawHit.trace_key ? str(rawHit.trace_key) : null,
  };
}

export function mapProtocolRunDetail(rawHit: Record<string, unknown>): ProtocolRunDetail | null {
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
    assertionsPassed: rawHit.assertions_passed == null ? null : Boolean(rawHit.assertions_passed),
    assertions: parseAssertions(rawHit.assertions),
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
      warningRuns: 0,
      failedRuns: 0,
      errorRuns: 0,
    });
  }

  for (const hit of rawHits) {
    const key = str(hit.ts);
    const tsMs = new Date(`${key}Z`).getTime();
    const total = num(hit.total_runs);
    const passed = num(hit.passed_runs);
    const warning = num(hit.warning_runs);
    buckets.set(key, {
      tsMs: Number.isFinite(tsMs) ? tsMs : 0,
      avgMs: num(hit.avg_duration),
      p95Ms: num(hit.p95_duration),
      uptimePct: total > 0 ? ((passed + warning) / total) * 100 : 100,
      warningRuns: num(hit.warning_runs),
      failedRuns: num(hit.failed_runs),
      errorRuns: num(hit.error_runs),
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

/**
 * The selector to show for a recorded step, whichever schema version it uses.
 *
 * A v1 step has one `selector`. A v2 step has a locator bundle instead, so
 * reading `selector` alone leaves every v2 run showing empty selectors in
 * results — a regression that would look like missing data rather than a schema
 * mismatch (spec P2.5.6).
 *
 * A pinned `user_override` wins, because that is the locator the run actually
 * used; otherwise it is the primary candidate, which is what the run would have
 * started from.
 */
export function effectiveSelector(step: Record<string, any>): string | null {
  const pinned = step?.locator?.user_override;
  if (pinned?.value) return str(pinned.value);
  const primary = step?.locator?.candidates?.[0];
  if (primary?.value) return str(primary.value);
  return step?.selector ? str(step.selector) : null;
}

export function aggregateStepStats(
  rawHits: Record<string, unknown>[],
  startMicros: number,
  endMicros: number,
  /** step_id → definition, from `buildStepDefsSql` + `foldStepDefs`. Built once
   *  for the whole window rather than re-parsed on every row (P1a). */
  stepDefsFromQuery?: Map<string, { name: string; selector: string | null }>,
  /** Per-execution retry attribution from `buildRetryAttributionSql` (C7).
   *  When supplied, `retry_history` is neither selected nor parsed: the steps
   *  that failed in an earlier attempt come from the `retry_step_ids` column,
   *  which is three scalars instead of ~1 KB per attempt per row. */
  retryAttribution?: RetryAttributionSummary,
  /** The `LIMIT` the tally query ran with, so the result can say whether the
   *  cap bound rather than the time range (P2a). */
  rowLimit?: number,
): StepStatsResult {
  const stepAcc = new Map<string, InternalStepAccumulator>();
  const failureInstances: StepFailureInstance[] = [];
  const trendAcc = new Map<string, InternalTrendAccumulator>();

  const interval = bucketInterval(endMicros - startMicros);
  const bucketMs = intervalSeconds(interval) * 1000;

  // Process runs oldest-first so sparklines reflect chronological order
  const sorted = [...rawHits].sort((a, b) => num(a.ts) - num(b.ts));

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

    const recordedSteps = stepDefsFromQuery
      ? []
      : (parseJsonArray(hit.recorded_steps) as any[]);
    const lastAttemptSteps = parseJsonArray(hit.last_attempt_steps) as any[];
    const retryHistory = parseJsonArray(hit.retry_history) as any[];

    // step_id → { name, selector }. Supplied by the caller from a bounded
    // query (P1a); only parsed per row when a caller did not supply one.
    let stepDefs = stepDefsFromQuery;
    if (!stepDefs) {
      stepDefs = new Map<string, { name: string; selector: string | null }>();
      for (const rs of recordedSteps) {
        stepDefs.set(str(rs.id), {
          name: str(rs.name) || str(rs.id),
          selector: effectiveSelector(rs),
        });
      }
    }

    // Build prior-attempt step statuses for flaky detection.
    const priorStatuses = new Map<string, string>();
    const attributed = retryAttribution?.byExecution.get(executionId);
    if (attributed) {
      // `retry_step_ids` already IS "steps that failed in some attempt", which
      // is exactly what this map holds — no blob to parse.
      for (const sid of attributed) priorStatuses.set(sid, "fail");
    } else if (attempts > 1 && retryHistory.length > 0) {
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
    // id → the final attempt's step, so the sparkline pass below is a lookup
    // rather than a scan per accumulator (X2).
    const stepsById = new Map<string, any>();

    for (const step of lastAttemptSteps as any[]) {
      const stepId = str(step.step_id ?? step.id);
      processedSteps.add(stepId);
      stepsById.set(stepId, step);

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
      // Keyed by step_id, never by name (X1): `recorded_steps` is historical,
      // so a renamed step would split into two rows and two steps sharing a
      // name would merge into one.
      let acc = stepAcc.get(stepId);
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
        stepAcc.set(stepId, acc);
      } else {
        // Rows arrive newest-first, so the first definition seen is the newest.
        // Keep it; later (older) rows must not relabel the row backwards.
        if (!acc.name) acc.name = stepName;
      }

      acc.totalExecutions++;
      if (!isOk) acc.failures++;
      if (isFlaky) acc.flakyCount++;
      acc.durationSum += stepDuration;
      if (stepDuration > acc.durationMax) acc.durationMax = stepDuration;
      acc.durationValues.push(stepDuration);

      // Browser dimension
      let bStats = acc.browserMap.get(engine);
      if (!bStats) {
        bStats = { total: 0, failures: 0, flaky: 0 };
        acc.browserMap.set(engine, bStats);
      }
      bStats.total++;
      if (!isOk) bStats.failures++;
      if (isFlaky) bStats.flaky++;

      // Location dimension
      let lStats = acc.locationMap.get(location);
      if (!lStats) {
        lStats = { total: 0, failures: 0, flaky: 0 };
        acc.locationMap.set(location, lStats);
      }
      lStats.total++;
      if (!isOk) lStats.failures++;
      if (isFlaky) lStats.flaky++;

      // ── Accumulate trend data ─────────────────────────────────────
      let tAcc = trendAcc.get(stepId);
      if (!tAcc) {
        tAcc = { stepName, bucketMap: new Map() };
        trendAcc.set(stepId, tAcc);
      }
      let bEntry = tAcc.bucketMap.get(bucketKey);
      if (!bEntry) {
        bEntry = { sum: 0, count: 0 };
        tAcc.bucketMap.set(bucketKey, bEntry);
      }
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
      let acc = stepAcc.get(stepId);
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
        stepAcc.set(stepId, acc);
      }
      // X3 — this step ran in THIS execution (it failed on an earlier attempt);
      // it simply did not reach the final attempt's step list. Counting the
      // flake without counting the execution let Flaky Rate exceed 100%.
      acc.totalExecutions++;
      acc.flakyCount++;
    }

    // ── Update recent-run statuses for sparklines ───────────────────
    // X2 — this used to call `lastAttemptSteps.some(...)` for every accumulator
    // on every row: O(steps²) per row, ~2M iterations on a 20-step journey over
    // 5000 rows and ~50M on a 100-step one, on the main thread. `processedSteps`
    // is already the set of ids seen in this row, so the membership test is a
    // Set lookup.
    for (const [stepIdKey, acc] of stepAcc) {
      const processedInRun = processedSteps.has(stepIdKey);

      if (processedInRun) {
        if (acc.recentRunStatuses.length >= MAX_SPARKLINE_POINTS) {
          acc.recentRunStatuses.shift();
        }
        const stepFromRun = stepsById.get(stepIdKey);
        if (stepFromRun) {
          const runStepStatus = str(stepFromRun.status);
          const isRunOk = runStepStatus === "ok" || runStepStatus === "passed";
          const priorFailedForStep = priorStatuses.get(stepIdKey) === "fail";
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

  // Keyed by step_id since X1; the display name lives on the accumulator and is
  // the newest definition seen for that id.
  for (const [stepId, acc] of stepAcc) {
    const name = acc.name || stepId;
    const failRate =
      acc.totalExecutions > 0 ? Math.round((acc.failures / acc.totalExecutions) * 1000) / 10 : 0;
    const flakyRate =
      acc.totalExecutions > 0 ? Math.round((acc.flakyCount / acc.totalExecutions) * 1000) / 10 : 0;
    const avgDurationMs =
      acc.totalExecutions > 0 ? Math.round(acc.durationSum / acc.totalExecutions) : 0;
    const failRateFull = acc.totalExecutions > 0 ? acc.failures / acc.totalExecutions : 0;

    // p95: sort all collected durations and take the 95th-percentile value
    const p95DurationMs =
      acc.durationValues.length > 0
        ? (acc.durationValues.slice().sort((a, b) => a - b)[
            Math.ceil(acc.durationValues.length * 0.95) - 1
          ] ?? 0)
        : 0;

    const recentRates = acc.recentRunStatuses.map((s) => (s === "fail" || s === "flaky" ? 1 : 0));

    stepGroups.push({
      key: `step-${stepId}`,
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
  const otherStepNames = new Set(stepDurations.slice(TOP_TREND_STEPS).map((s) => s.stepName));

  // Merge "others" into a single series
  let othersAcc: InternalTrendAccumulator | null = null;
  const trendBuckets: TrendBucket[] = [];

  for (const [, tAcc] of trendAcc) {
    const stepName = tAcc.stepName;
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
    // P2a — `sorted` is oldest-first, so its ends ARE the covered window.
    coverage: {
      executions: sorted.length,
      fromMs: sorted.length ? num(sorted[0].ts) / 1000 : 0,
      toMs: sorted.length ? num(sorted[sorted.length - 1].ts) / 1000 : 0,
      // Equality, not `>=`: the query asked for exactly this many and got them,
      // so there is no way to know how many more the range held.
      truncated: rowLimit !== undefined && sorted.length >= rowLimit,
    },
  };
}
