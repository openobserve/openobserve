//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  evaluateScanPolicy,
  periodToMicros,
  type NarrowCandidate,
  type ScanEstimate,
  type ScanPolicyDecision,
} from "@/utils/logs/estimateScanMb";

export type RunKind = "refinement" | "entry" | "explicit";

export type RunReason =
  | "landing"
  | "stream"
  | "filter"
  | "time"
  | "time-typed"
  | "function"
  | "url"
  | "activation"
  | "visualize-restore"
  | "tab"
  | "histogram"
  | "patterns"
  | "refresh"
  | "run"
  | "saved-view"
  | "run-anyway"
  | "narrow"
  | "pagination"
  | "page-size"
  | "sort"
  | "zoom"
  | "compare"
  | "explicit";

export type RunOperation = "full" | "histogram" | "page" | "patterns" | "visualize";

export type SearchMode = "logs" | "drilldown" | "patterns" | "visualize" | "build";

export type PersistSurface = "logs" | "patterns" | "visualize" | "build";

export type PersistAction =
  | "create-alert"
  | "add-to-dashboard"
  | "search-job"
  | "visualize"
  | "scheduled-report"
  | "save-view"
  | "share-link"
  | "copy-line-link";

export type RunOutcome =
  "running" | "complete" | "partial" | "failed" | "cancelled" | "blocked" | "invalidated";

export type Eligibility = "guarded" | "unguarded" | "skip";

export type RequestRunResult =
  | "scheduled"
  | "dispatched"
  | "blocked"
  | "deferred"
  | "dropped"
  | "pending-dirty"
  | "skipped-ineligible"
  | "skipped-editor-origin"
  | "withdrawn"
  | "failed";

export type TimeSelection =
  { type: "relative"; period: string } | { type: "absolute"; startUs: number; endUs: number };

export interface LogsSignature {
  query: string;
  sqlMode: boolean;
  streams: string[];
  streamType: string;
  time: TimeSelection;
  transform: string | null;
  quickMode: boolean;
  quickModeFields: string[];
  regions: string[];
  clusters: string[];
  effectiveSortOrder: "asc" | "desc";
  definedSchemas: string;
  freeTextScan?: Record<string, unknown>;
}

export interface SignatureInput {
  query: string;
  sqlMode: boolean;
  streams: string[];
  streamType: string;
  time: TimeSelection;
  transformContent: string | null;
  showTransformEditor: boolean;
  quickMode: boolean;
  quickModeFields?: string[];
  regions?: string[];
  clusters?: string[];
  refreshInterval: number;
  sortOrder: "asc" | "desc";
  definedSchemas: string;
  freeTextScan?: Record<string, unknown>;
}

export interface ConsentScope {
  streams: string[];
  streamType: string;
  time: TimeSelection;
  regions: string[];
  clusters: string[];
}

export interface ExecutedRecord {
  generation: number;
  signature: LogsSignature;
  req: unknown;
  sortPreference?: "asc" | "desc";
  complete: boolean;
}

export interface PatternsRecord {
  generation: number;
  signature: LogsSignature;
  complete: boolean;
}

export interface PanelRecord {
  surface: "visualize" | "build";
  configSignature: string;
  generation: number;
  complete: boolean;
}

export interface AutoRunBlocked {
  reason: RunReason;
  reasons: RunReason[];
  op: RunOperation;
  scope: LogsSignature;
  estimate: ScanEstimate;
  decision: ScanPolicyDecision;
  estimateMb: number;
  status: ScanEstimate["status"];
  streams: string[];
  window: TimeSelection;
  narrowTo: NarrowCandidate | null;
}

export interface AutoRunMeta {
  liveMode: boolean;
  nlpMode?: boolean;
  nlDetected?: boolean;
  editorDirty?: boolean;
  executed?: ExecutedRecord | null;
  pendingExecution?: ExecutedRecord | null;
  executedPatterns?: PatternsRecord | null;
  executedPanel?: PanelRecord | null;
  autoRunBlocked?: AutoRunBlocked | null;
  consentedScope?: ConsentScope | null;
  runPending?: boolean;
  runOutcome?: Partial<Record<PersistSurface, RunOutcome>>;
  runCancelled?: Partial<Record<PersistSurface, boolean>>;
}

export interface AutoRunStore {
  meta: AutoRunMeta;
  data: { resultGrid: { hitsSettled?: boolean } };
}

export interface AutoRunConfig {
  auto_query_enabled?: boolean;
  auto_query_max_scan_mb?: number | string;
}

export type TraceRole =
  "hits" | "histogram" | "pageCount" | "patterns" | "visualize" | "compare" | "other";

export interface Generation {
  id: number;
  orgId: string;
  lane: "grid" | "patterns";
  kind: RunKind;
  reason: RunReason;
  op: RunOperation;
  surface: PersistSurface;
  signature: LogsSignature;
  traces: { traceId: string; role: TraceRole }[];
  aborts: (() => void)[];
  cancelled: boolean;
  settled: boolean;
}

export interface RunContext {
  generation: Generation;
  reason: RunReason;
  reasons: RunReason[];
  kind: RunKind;
  op: RunOperation;
  origin?: string;
  signature: LogsSignature;
  target: "live" | "executed" | "blocked";
}

export type RunExecutor = (ctx: RunContext) => Promise<unknown> | void;

export interface RunExecutors {
  logs: RunExecutor;
  patterns: RunExecutor;
  histogram: RunExecutor;
  visualize: RunExecutor;
}

export interface ExecutedRecordedEvent {
  surface: PersistSurface;
  generation: number | null;
  signature: LogsSignature;
  sortPreference?: "asc" | "desc";
  req?: unknown;
  configSignature?: string;
}

export interface FreeTextGateFlags {
  blockedReason: string | null;
  scanReason: string | null;
}

export type PersistDecision = { ok: true } | { ok: false; reason: string };

export interface AutoRunTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AutoRunDeps {
  getConfig: () => AutoRunConfig;
  store: AutoRunStore;
  readSignature: () => LogsSignature;
  getMode: () => SearchMode;
  getOrgId: () => string;
  estimate: (signature: LogsSignature) => ScanEstimate;
  executors: RunExecutors;
  abortTrace: (traceId: string) => void;
  /** ENT only: fire-and-forget `delete_running_queries`; omit in OSS. */
  serverCancel?: (orgId: string, traceIds: string[]) => Promise<unknown>;
  pickNarrowPreset?: (signature: LogsSignature, estimate: ScanEstimate) => NarrowCandidate | null;
  getRefreshInterval?: () => number;
  resetLoading?: () => void;
  clearResults?: () => void;
  rearmRefresh?: () => void;
  readPanelConfigSignature?: (surface: "visualize" | "build") => string | null;
  getFreeTextFlags?: () => FreeTextGateFlags;
  t?: (key: string) => string;
  log?: (message: string, error?: unknown) => void;
  now?: () => number;
  timers?: AutoRunTimers;
}

export interface RequestRunOptions {
  origin?: string;
  /** Overrides the mode-derived operation, e.g. a saved view that always reloads the grid. */
  op?: RunOperation;
}

interface PendingEntry {
  lane: "grid" | "patterns";
  op: RunOperation;
  kind: RunKind;
  reasons: RunReason[];
  guarded: boolean;
  dueAt: number;
  handle: unknown;
  origin?: string;
}

interface ExecuteInput {
  lane: "grid" | "patterns";
  op: RunOperation;
  kind: RunKind;
  reason: RunReason;
  reasons: RunReason[];
  origin?: string;
  signature: LogsSignature;
  target: RunContext["target"];
  guarded: boolean;
  useConsent: boolean;
}

export const AUTO_RUN_I18N = {
  persistNeedsRun: "search.autoRunPersistNeedsRun",
  searchAroundActive: "search.autoRunSearchAroundActive",
  staleTooltip: "search.autoRunStaleTooltip",
} as const;

export const REASON_KIND: Record<RunReason, RunKind> = {
  landing: "refinement",
  stream: "refinement",
  filter: "refinement",
  time: "refinement",
  "time-typed": "refinement",
  function: "refinement",
  url: "entry",
  activation: "entry",
  "visualize-restore": "entry",
  tab: "entry",
  histogram: "entry",
  patterns: "entry",
  refresh: "entry",
  run: "explicit",
  "saved-view": "explicit",
  "run-anyway": "explicit",
  narrow: "explicit",
  pagination: "explicit",
  "page-size": "explicit",
  sort: "explicit",
  zoom: "explicit",
  compare: "explicit",
  explicit: "explicit",
};

export const REASON_DEBOUNCE_MS: Record<RunReason, number> = {
  landing: 0,
  stream: 0,
  filter: 300,
  time: 0,
  "time-typed": 2500,
  function: 300,
  url: 0,
  activation: 0,
  "visualize-restore": 0,
  tab: 0,
  histogram: 0,
  patterns: 0,
  refresh: 0,
  run: 0,
  "saved-view": 0,
  "run-anyway": 0,
  narrow: 0,
  pagination: 0,
  "page-size": 0,
  sort: 0,
  zoom: 0,
  compare: 0,
  explicit: 0,
};

const OP_RANK: Record<RunOperation, number> = {
  histogram: 1,
  full: 2,
  visualize: 2,
  page: 2,
  patterns: 2,
};

// Scope-replacing entry points never ride on an earlier consent (U-1 (a)).
const CONSENT_IGNORING_REASONS = new Set<RunReason>(["url", "activation", "visualize-restore"]);

const DIRTY_CLEARING_REASONS = new Set<RunReason>(["run", "saved-view", "explicit"]);

const SCAN_GATED_ACTIONS = new Set<PersistAction>([
  "create-alert",
  "add-to-dashboard",
  "search-job",
  "visualize",
  "scheduled-report",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

function timeBounds(time: TimeSelection, nowUs: number): { startUs: number; endUs: number } | null {
  if (time.type === "absolute") return { startUs: time.startUs, endUs: time.endUs };
  const duration = periodToMicros(time.period);
  return duration === null ? null : { startUs: nowUs - duration, endUs: nowUs };
}

function patchRequestBounds(req: unknown, startUs: number, endUs: number): void {
  if (!isRecord(req)) return;
  const targets = [req, req.query, isRecord(req.queryReq) ? req.queryReq.query : undefined];
  for (const target of targets) {
    if (isRecord(target) && ("start_time" in target || "end_time" in target)) {
      target.start_time = startUs;
      target.end_time = endUs;
    }
  }
}

export function isAutoRunActive(config: AutoRunConfig, meta: AutoRunMeta): boolean {
  return !!config.auto_query_enabled && !!meta.liveMode && !(meta.nlDetected && !meta.nlpMode);
}

export function isGuardActive(config: AutoRunConfig): boolean {
  return !!config.auto_query_enabled && Number(config.auto_query_max_scan_mb ?? 0) > 0;
}

export function guardThresholdMb(config: AutoRunConfig): number {
  return Number(config.auto_query_max_scan_mb ?? 0);
}

export function reasonEligibility(
  reason: RunReason,
  config: AutoRunConfig,
  meta: AutoRunMeta,
  mode: SearchMode,
): Eligibility {
  const kind = REASON_KIND[reason];
  if (kind === "explicit") return reason === "narrow" ? "guarded" : "unguarded";
  if (kind === "entry") return config.auto_query_enabled ? "guarded" : "unguarded";
  if (mode === "visualize" || mode === "build") return "skip";
  return isAutoRunActive(config, meta) ? "guarded" : "skip";
}

export function operationFor(reason: RunReason, mode: SearchMode): RunOperation {
  if (reason === "histogram") return "histogram";
  if (reason === "visualize-restore") return "visualize";
  if (reason === "patterns") return "patterns";
  if (reason === "refresh") return "full";
  if (reason === "pagination" || reason === "page-size" || reason === "sort") return "page";
  if (mode === "patterns") return "patterns";
  if (mode === "visualize" || mode === "build") return "visualize";
  return "full";
}

export function effectiveSortOrder(
  refreshInterval: number,
  sortOrder: "asc" | "desc",
): "asc" | "desc" {
  return refreshInterval > 0 ? "desc" : sortOrder;
}

export function buildLogsSignature(input: SignatureInput): LogsSignature {
  const transform =
    input.showTransformEditor && (input.transformContent ?? "").trim() !== ""
      ? (input.transformContent as string)
      : null;
  const signature: LogsSignature = {
    query: input.query ?? "",
    sqlMode: !!input.sqlMode,
    streams: [...(input.streams ?? [])].sort(),
    streamType: input.streamType,
    time: cloneJson(input.time),
    transform,
    quickMode: !!input.quickMode,
    quickModeFields: input.quickMode ? [...(input.quickModeFields ?? [])].sort() : [],
    regions: [...(input.regions ?? [])].sort(),
    clusters: [...(input.clusters ?? [])].sort(),
    effectiveSortOrder: effectiveSortOrder(input.refreshInterval, input.sortOrder),
    definedSchemas: input.definedSchemas,
  };
  if (input.freeTextScan !== undefined) signature.freeTextScan = cloneJson(input.freeTextScan);
  return signature;
}

export function signatureKey(signature: LogsSignature): string {
  return stableStringify(signature);
}

export function sameSignature(
  a: LogsSignature | null | undefined,
  b: LogsSignature | null | undefined,
): boolean {
  if (!a || !b) return false;
  return signatureKey(a) === signatureKey(b);
}

export function sameSignatureIgnoringSort(a: LogsSignature, b: LogsSignature): boolean {
  return sameSignature({ ...a, effectiveSortOrder: "desc" }, { ...b, effectiveSortOrder: "desc" });
}

export function panelConfigSignature(panelConfig: unknown, logs: LogsSignature): string {
  return stableStringify({ panel: panelConfig, logs: signatureKey(logs) });
}

export function scopeOf(signature: LogsSignature): ConsentScope {
  return {
    streams: [...signature.streams],
    streamType: signature.streamType,
    time: cloneJson(signature.time),
    regions: [...signature.regions],
    clusters: [...signature.clusters],
  };
}

export function isScopeCovered(
  scope: ConsentScope,
  consented: ConsentScope | null | undefined,
  nowUs: number,
): boolean {
  if (!consented) return false;
  if (scope.streamType !== consented.streamType) return false;
  if (!scope.streams.every((s) => consented.streams.includes(s))) return false;
  if (!sameSet(scope.regions, consented.regions) || !sameSet(scope.clusters, consented.clusters))
    return false;
  if (scope.time.type === "relative" && consented.time.type === "relative") {
    const own = periodToMicros(scope.time.period);
    const allowed = periodToMicros(consented.time.period);
    return own !== null && allowed !== null && own <= allowed;
  }
  const own = timeBounds(scope.time, nowUs);
  const allowed = timeBounds(consented.time, nowUs);
  if (!own || !allowed) return false;
  return own.startUs >= allowed.startUs && own.endUs <= allowed.endUs;
}

export function createAutoRun(deps: AutoRunDeps) {
  const { store } = deps;
  const meta = store.meta;
  const now = deps.now ?? (() => Date.now());
  const timers: AutoRunTimers = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const translate = (key: string) => (deps.t ? deps.t(key) : key);
  const log = (message: string, error?: unknown) => deps.log?.(message, error);

  let nextGenerationId = 1;
  const generations = new Map<number, Generation>();
  const current: Record<"grid" | "patterns", Generation | null> = { grid: null, patterns: null };
  const pending: Record<"grid" | "patterns", PendingEntry | null> = { grid: null, patterns: null };
  let deferredRefresh = false;
  let missedTick = false;
  let invalidation: string | null = null;
  let hitsTraceId: string | null = null;
  const pausePredicates = new Set<() => boolean>();
  const refreshTickListeners = new Set<(paused: boolean) => void>();
  const executedListeners = new Set<(event: ExecutedRecordedEvent) => void>();

  const config = () => deps.getConfig() ?? {};
  const nowUs = () => now() * 1000;

  function setOutcome(surface: PersistSurface, outcome: RunOutcome | undefined): void {
    meta.runOutcome = { ...(meta.runOutcome ?? {}), [surface]: outcome };
    meta.runCancelled = { ...(meta.runCancelled ?? {}), [surface]: false };
  }

  function emitExecuted(event: ExecutedRecordedEvent): void {
    executedListeners.forEach((fn) => {
      try {
        fn(cloneJson(event));
      } catch (error) {
        log("autoRun: onExecutedRecorded listener failed", error);
      }
    });
  }

  function isInFlight(gen: Generation | null): boolean {
    return !!gen && !gen.settled && !gen.cancelled;
  }

  function isBusy(): boolean {
    return (
      !!pending.grid ||
      !!pending.patterns ||
      isInFlight(current.grid) ||
      isInFlight(current.patterns)
    );
  }

  function isCurrent(generationId: number): boolean {
    const gen = generations.get(generationId);
    return !!gen && current[gen.lane] === gen && !gen.cancelled;
  }

  function isTraceCurrent(traceId: string): boolean {
    return [current.grid, current.patterns].some(
      (gen) => !!gen && !gen.cancelled && gen.traces.some((t) => t.traceId === traceId),
    );
  }

  function clearPending(lane: "grid" | "patterns"): boolean {
    const entry = pending[lane];
    if (!entry) return false;
    timers.clearTimeout(entry.handle);
    pending[lane] = null;
    return true;
  }

  function clearAllPending(): boolean {
    const grid = clearPending("grid");
    const patterns = clearPending("patterns");
    return grid || patterns;
  }

  function teardown(gen: Generation, keep: Set<string>): string[] {
    const traceIds = gen.traces.map((t) => t.traceId).filter((id) => !keep.has(id));
    const aborts = gen.aborts;
    gen.traces = gen.traces.filter((t) => keep.has(t.traceId));
    gen.aborts = [];
    traceIds.forEach((traceId) => {
      try {
        deps.abortTrace(traceId);
      } catch (error) {
        log("autoRun: browser abort failed", error);
      }
    });
    aborts.forEach((abort) => {
      try {
        abort();
      } catch (error) {
        log("autoRun: abort hook failed", error);
      }
    });
    if (hitsTraceId && traceIds.includes(hitsTraceId)) {
      store.data.resultGrid.hitsSettled = true;
      hitsTraceId = null;
    }
    if (meta.pendingExecution?.generation === gen.id) meta.pendingExecution = null;
    if (deps.serverCancel && traceIds.length > 0) {
      const orgId = gen.orgId;
      Promise.resolve()
        .then(() => deps.serverCancel?.(orgId, traceIds))
        .catch((error) => log("autoRun: server cancel failed", error));
    }
    return traceIds;
  }

  function cancelOne(gen: Generation, keep: Set<string>): void {
    if (gen.cancelled) return;
    gen.cancelled = true;
    gen.settled = true;
    teardown(gen, keep);
    if (meta.runOutcome?.[gen.surface] === "running") {
      setOutcome(gen.surface, meta.executed?.generation === gen.id ? "partial" : "cancelled");
      meta.runCancelled = { ...(meta.runCancelled ?? {}), [gen.surface]: true };
    }
  }

  function failGeneration(gen: Generation, error: unknown): void {
    log("autoRun: executor failed", error);
    if (gen.cancelled) return;
    const wasCurrent = isCurrent(gen.id);
    gen.cancelled = true;
    teardown(gen, new Set());
    if (wasCurrent && gen.op !== "histogram") {
      setOutcome(gen.surface, meta.executed?.generation === gen.id ? "partial" : "failed");
    }
    if (wasCurrent) deps.resetLoading?.();
    settleGeneration(gen.id);
  }

  function cancelGeneration(
    gen?: Generation | null,
    options: {
      cause?: "user" | "unmount" | "route" | "org" | "reset" | "replace" | "block";
      keep?: string[];
    } = {},
  ): void {
    const cause = options.cause ?? "user";
    const keep = new Set(options.keep ?? []);
    const targets = gen ? [gen] : [current.grid, current.patterns];
    targets.forEach((target) => target && cancelOne(target, keep));
    if (cause === "replace") return;
    if (cause !== "block") {
      clearAllPending();
      deferredRefresh = false;
    }
    if (cause === "user") missedTick = false;
    deps.resetLoading?.();
  }

  function newGeneration(input: {
    lane: "grid" | "patterns";
    kind: RunKind;
    reason: RunReason;
    op: RunOperation;
    signature: LogsSignature;
  }): Generation {
    const mode = deps.getMode();
    let surface: PersistSurface = "logs";
    if (input.lane === "patterns") surface = "patterns";
    else if (input.op === "visualize") surface = mode === "build" ? "build" : "visualize";
    const gen: Generation = {
      id: nextGenerationId++,
      orgId: deps.getOrgId(),
      ...input,
      surface,
      traces: [],
      aborts: [],
      cancelled: false,
      settled: false,
    };
    const previous = current[input.lane];
    if (previous && !previous.cancelled) {
      const handOver =
        input.op === "page" &&
        !previous.settled &&
        sameSignatureIgnoringSort(previous.signature, input.signature)
          ? previous.traces.filter((t) => t.role === "histogram")
          : [];
      gen.traces.push(...handOver);
      cancelGeneration(previous, { cause: "replace", keep: handOver.map((t) => t.traceId) });
    }
    if (previous && previous.settled) generations.delete(previous.id);
    current[input.lane] = gen;
    generations.set(gen.id, gen);
    return gen;
  }

  function registerTrace(
    generationId: number,
    traceId: string,
    role: TraceRole = "other",
  ): boolean {
    const gen = generations.get(generationId);
    if (!gen || gen.cancelled) return false;
    if (!gen.traces.some((t) => t.traceId === traceId)) gen.traces.push({ traceId, role });
    return true;
  }

  function registerAbort(generationId: number, abort: AbortController | (() => void)): boolean {
    const gen = generations.get(generationId);
    if (!gen || gen.cancelled) return false;
    gen.aborts.push(typeof abort === "function" ? abort : () => abort.abort());
    return true;
  }

  function settleGeneration(generationId: number): void {
    const gen = generations.get(generationId);
    if (!gen || gen.settled) return;
    gen.settled = true;
    // Work registered up to now has finished; later children stay cancellable.
    gen.traces = [];
    gen.aborts = [];
    if (current[gen.lane] !== gen) generations.delete(gen.id);
    if (deferredRefresh && !isBusy()) {
      deferredRefresh = false;
      tick();
    }
  }

  function recordConsent(signature: LogsSignature): void {
    const scope = scopeOf(signature);
    if (!isScopeCovered(scope, meta.consentedScope, nowUs())) meta.consentedScope = scope;
  }

  function executorFor(op: RunOperation): RunExecutor {
    if (op === "patterns") return deps.executors.patterns;
    if (op === "histogram") return deps.executors.histogram;
    if (op === "visualize") return deps.executors.visualize;
    return deps.executors.logs;
  }

  function dispatch(gen: Generation, input: ExecuteInput): RequestRunResult {
    if (input.op !== "histogram") {
      recordConsent(input.signature);
      meta.autoRunBlocked = null;
      meta.runPending = false;
    }
    if (input.op === "patterns") meta.executedPatterns = null;
    if (input.op === "visualize") meta.executedPanel = null;
    if (input.op !== "histogram") setOutcome(gen.surface, "running");
    const ctx: RunContext = {
      generation: gen,
      reason: input.reason,
      reasons: input.reasons,
      kind: input.kind,
      op: input.op,
      origin: input.origin,
      signature: input.signature,
      target: input.target,
    };
    let result: Promise<unknown> | void;
    try {
      result = executorFor(input.op)(ctx);
    } catch (error) {
      failGeneration(gen, error);
      return "failed";
    }
    // Resolution is not settlement: executors return before their streams finish.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).catch((error) => failGeneration(gen, error));
    }
    return "dispatched";
  }

  function block(
    gen: Generation,
    input: ExecuteInput,
    estimate: ScanEstimate,
    decision: ScanPolicyDecision,
  ): void {
    gen.cancelled = true;
    gen.settled = true;
    meta.autoRunBlocked = {
      reason: input.reason,
      reasons: input.reasons,
      op: input.op,
      scope: cloneJson(input.signature),
      estimate,
      decision,
      estimateMb: estimate.knownMb,
      status: estimate.status,
      streams: [...input.signature.streams],
      window: cloneJson(input.signature.time),
      narrowTo:
        decision.reason === "unresolved"
          ? null
          : (deps.pickNarrowPreset?.(input.signature, estimate) ?? null),
    };
    meta.runPending = true;
    setOutcome(gen.surface, "blocked");
    if (input.reasons.includes("refresh")) missedTick = true;
    deps.resetLoading?.();
  }

  function attachToInFlightPage(input: ExecuteInput): RequestRunResult | null {
    const live = current.grid;
    if (input.op !== "histogram" || !isInFlight(live) || !live) return null;
    if (live.op !== "page") return "dropped";
    const ctx: RunContext = { ...input, generation: live };
    const report = (error: unknown) => log("autoRun: attached histogram failed", error);
    try {
      const result = deps.executors.histogram(ctx);
      // A child failure never fails or settles the page that owns it.
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(report);
      }
    } catch (error) {
      report(error);
      return "failed";
    }
    return "dispatched";
  }

  function execute(input: ExecuteInput): RequestRunResult {
    const attached = attachToInFlightPage(input);
    if (attached) return attached;
    const gen = newGeneration({
      lane: input.lane,
      kind: input.kind,
      reason: input.reason,
      op: input.op,
      signature: input.signature,
    });
    const covered =
      input.useConsent && isScopeCovered(scopeOf(input.signature), meta.consentedScope, nowUs());
    if (input.guarded && isGuardActive(config()) && !covered) {
      const estimate = deps.estimate(input.signature);
      const decision = evaluateScanPolicy(estimate, guardThresholdMb(config()));
      if (!decision.allowed) {
        block(gen, input, estimate, decision);
        return "blocked";
      }
    }
    return dispatch(gen, input);
  }

  function fire(lane: "grid" | "patterns"): void {
    const entry = pending[lane];
    if (!entry) return;
    pending[lane] = null;
    if (meta.editorDirty) {
      meta.runPending = true;
      if (entry.reasons.includes("refresh")) missedTick = true;
      return;
    }
    const refreshOnly = entry.reasons.every((r) => r === "refresh");
    const executed = meta.executed;
    const useExecuted = (refreshOnly || entry.op === "histogram") && !!executed;
    const reason = [...entry.reasons].reverse().find((r) => r !== "refresh") ?? "refresh";
    execute({
      lane,
      op: entry.op,
      kind: entry.kind,
      reason,
      reasons: [...entry.reasons],
      origin: entry.origin,
      signature: useExecuted && executed ? cloneJson(executed.signature) : deps.readSignature(),
      target: useExecuted ? "executed" : "live",
      guarded: entry.guarded,
      useConsent: !entry.reasons.some((r) => CONSENT_IGNORING_REASONS.has(r)),
    });
  }

  function schedule(
    lane: "grid" | "patterns",
    op: RunOperation,
    reason: RunReason,
    guarded: boolean,
    origin?: string,
  ): RequestRunResult {
    const at = now();
    const due = at + REASON_DEBOUNCE_MS[reason];
    let existing = pending[lane];
    if (existing && existing.reasons.every((r) => r === "refresh")) {
      deferredRefresh = true;
      clearPending(lane);
      existing = null;
    }
    const kind = REASON_KIND[reason];
    let entry: PendingEntry;
    if (existing) {
      timers.clearTimeout(existing.handle);
      entry = {
        ...existing,
        op: OP_RANK[op] >= OP_RANK[existing.op] ? op : existing.op,
        kind: existing.kind === "entry" || kind === "entry" ? "entry" : "refinement",
        reasons: [...existing.reasons, reason],
        guarded: existing.guarded || guarded,
        dueAt: Math.max(existing.dueAt, due),
        origin: origin ?? existing.origin,
      };
    } else {
      entry = { lane, op, kind, reasons: [reason], guarded, dueAt: due, handle: null, origin };
    }
    entry.handle = timers.setTimeout(() => fire(lane), Math.max(0, entry.dueAt - at));
    pending[lane] = entry;
    return "scheduled";
  }

  function requestRefresh(options: RequestRunOptions): RequestRunResult {
    if ((deps.getRefreshInterval?.() ?? 0) <= 0) return "skipped-ineligible";
    if (meta.editorDirty) {
      missedTick = true;
      return "pending-dirty";
    }
    if (isBusy()) {
      deferredRefresh = true;
      return "deferred";
    }
    const eligibility = reasonEligibility("refresh", config(), meta, deps.getMode());
    return schedule("grid", "full", "refresh", eligibility === "guarded", options.origin);
  }

  function dropPendingForExplicit(reason: RunReason): void {
    const pageOnly = reason === "pagination" || reason === "page-size" || reason === "sort";
    const refreshWaiting = !!pending.grid?.reasons.every((r) => r === "refresh");
    clearAllPending();
    if (!pageOnly) deferredRefresh = false;
    else if (refreshWaiting) deferredRefresh = true;
  }

  function runAnyway(options: RequestRunOptions = {}): RequestRunResult {
    const blocked = meta.autoRunBlocked;
    if (!blocked) return "skipped-ineligible";
    const liveMatches =
      blocked.op === "histogram" || blocked.reasons.every((r) => r === "refresh")
        ? true
        : sameSignature(deps.readSignature(), blocked.scope);
    if (meta.editorDirty || !liveMatches) {
      withdrawBlock();
      return "withdrawn";
    }
    dropPendingForExplicit("run-anyway");
    meta.autoRunBlocked = null;
    return execute({
      lane: blocked.op === "patterns" ? "patterns" : "grid",
      op: blocked.op,
      kind: "explicit",
      reason: "run-anyway",
      reasons: ["run-anyway"],
      origin: options.origin,
      signature: cloneJson(blocked.scope),
      target: "blocked",
      guarded: false,
      useConsent: false,
    });
  }

  function requestExplicit(
    reason: RunReason,
    op: RunOperation,
    options: RequestRunOptions,
  ): RequestRunResult {
    if (reason === "run-anyway") return runAnyway(options);
    if (reason === "zoom" && meta.editorDirty) {
      meta.runPending = true;
      return "pending-dirty";
    }
    dropPendingForExplicit(reason);
    if (DIRTY_CLEARING_REASONS.has(reason)) meta.editorDirty = false;
    return execute({
      lane: op === "patterns" ? "patterns" : "grid",
      op,
      kind: "explicit",
      reason,
      reasons: [reason],
      origin: options.origin,
      signature: deps.readSignature(),
      target: "live",
      guarded: reason === "narrow",
      useConsent: reason !== "narrow",
    });
  }

  function requestRun(reason: RunReason, options: RequestRunOptions = {}): RequestRunResult {
    const kind = REASON_KIND[reason];
    if (options.origin === "editor" && kind !== "explicit") return "skipped-editor-origin";
    if (reason === "refresh") return requestRefresh(options);
    const mode = deps.getMode();
    const eligibility = reasonEligibility(reason, config(), meta, mode);
    if (eligibility === "skip") return "skipped-ineligible";
    const op = options.op ?? operationFor(reason, mode);
    if (kind === "explicit") return requestExplicit(reason, op, options);
    if (meta.editorDirty) {
      meta.runPending = true;
      return "pending-dirty";
    }
    const lane = op === "patterns" ? "patterns" : "grid";
    if (op === "histogram") {
      const gridPending = pending.grid;
      if (
        gridPending &&
        gridPending.op !== "histogram" &&
        !gridPending.reasons.every((r) => r === "refresh")
      ) {
        return "dropped";
      }
      if (
        isInFlight(current.grid) &&
        current.grid?.op !== "page" &&
        current.grid?.op !== "histogram"
      )
        return "dropped";
    }
    return schedule(lane, op, reason, eligibility === "guarded", options.origin);
  }

  function withdrawBlock(): void {
    if (!meta.autoRunBlocked) return;
    meta.autoRunBlocked = null;
    meta.runPending = true;
  }

  function syncBlockedScope(): boolean {
    const blocked = meta.autoRunBlocked;
    if (!blocked) return false;
    if (meta.editorDirty || !sameSignature(deps.readSignature(), blocked.scope)) {
      withdrawBlock();
      return true;
    }
    return false;
  }

  function markEditorDirty(): void {
    meta.editorDirty = true;
    if (clearAllPending()) meta.runPending = true;
    withdrawBlock();
  }

  function clearEditorDirty(): void {
    meta.editorDirty = false;
  }

  function isResultsStale(): boolean {
    const executed = meta.executed;
    if (!executed) return false;
    return !!meta.editorDirty || !sameSignature(deps.readSignature(), executed.signature);
  }

  function staleReason(): string | null {
    return isResultsStale() ? translate(AUTO_RUN_I18N.staleTooltip) : null;
  }

  function gridPersistOk(): boolean {
    const executed = meta.executed;
    if (!executed || !executed.complete || isResultsStale()) return false;
    const pendingRecord = meta.pendingExecution;
    return !pendingRecord || sameSignature(pendingRecord.signature, executed.signature);
  }

  function surfacePersistOk(surface: PersistSurface): boolean {
    if (surface === "logs") return gridPersistOk();
    if (meta.editorDirty) return false;
    if (surface === "patterns") {
      const record = meta.executedPatterns;
      return !!record?.complete && sameSignature(record.signature, deps.readSignature());
    }
    const panel = meta.executedPanel;
    if (!panel || panel.surface !== surface || !panel.complete) return false;
    const live = deps.readPanelConfigSignature?.(surface) ?? null;
    return live !== null && live === panel.configSignature;
  }

  function canPersistOrShare(surface: PersistSurface, action?: PersistAction): PersistDecision {
    if (surface === "logs" && invalidation === "search-around") {
      return { ok: false, reason: translate(AUTO_RUN_I18N.searchAroundActive) };
    }
    // Blocked text has no SQL at all, so its reason outranks "run the query first".
    const flags = deps.getFreeTextFlags?.();
    if (flags?.blockedReason) return { ok: false, reason: flags.blockedReason };
    if (!surfacePersistOk(surface))
      return { ok: false, reason: translate(AUTO_RUN_I18N.persistNeedsRun) };
    if (flags?.scanReason && action && SCAN_GATED_ACTIONS.has(action)) {
      return { ok: false, reason: flags.scanReason };
    }
    return { ok: true };
  }

  function beginHits(traceId: string): void {
    hitsTraceId = traceId;
    store.data.resultGrid.hitsSettled = false;
  }

  function settleHits(traceId: string | null | undefined): void {
    if (traceId && traceId === hitsTraceId) {
      store.data.resultGrid.hitsSettled = true;
      hitsTraceId = null;
    }
  }

  function recordDispatch(
    generationId: number,
    input: {
      req: unknown;
      traceId?: string;
      pagination?: boolean;
      sortPreference?: "asc" | "desc";
    },
  ): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    if (!input.pagination) meta.executed = null;
    meta.pendingExecution = {
      generation: gen.id,
      signature: cloneJson(gen.signature),
      req: cloneJson(input.req),
      sortPreference: input.sortPreference,
      complete: false,
    };
    if (input.traceId) {
      registerTrace(gen.id, input.traceId, "hits");
      beginHits(input.traceId);
    }
    setOutcome("logs", "running");
    return true;
  }

  function promote(gen: Generation): void {
    const pendingRecord = meta.pendingExecution;
    if (!pendingRecord || pendingRecord.generation !== gen.id) return;
    meta.executed = pendingRecord;
    meta.pendingExecution = null;
    invalidation = null;
    emitExecuted({
      surface: "logs",
      generation: gen.id,
      signature: pendingRecord.signature,
      sortPreference: pendingRecord.sortPreference,
      req: pendingRecord.req,
    });
  }

  function recordChunk(generationId: number): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    promote(gen);
    return true;
  }

  function satisfyMissedTick(): void {
    const executed = meta.executed;
    if (!missedTick || !executed) return;
    if (!isScopeCovered(scopeOf(executed.signature), meta.consentedScope, nowUs())) return;
    missedTick = false;
    deps.rearmRefresh?.();
  }

  function recordComplete(generationId: number, traceId?: string): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    promote(gen);
    if (meta.executed?.generation === gen.id) meta.executed.complete = true;
    settleHits(traceId ?? hitsTraceId);
    setOutcome("logs", "complete");
    satisfyMissedTick();
    return true;
  }

  function recordFailure(generationId: number, traceId?: string): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    if (meta.pendingExecution?.generation === gen.id) meta.pendingExecution = null;
    settleHits(traceId ?? hitsTraceId);
    setOutcome("logs", meta.executed?.generation === gen.id ? "partial" : "failed");
    settleGeneration(gen.id);
    return true;
  }

  function recordWindowMove(
    generationId: number,
    bounds: { startUs: number; endUs: number },
  ): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    const time: TimeSelection = { type: "absolute", startUs: bounds.startUs, endUs: bounds.endUs };
    gen.signature = { ...gen.signature, time };
    let republish = false;
    for (const record of [meta.pendingExecution, meta.executed]) {
      if (!record || record.generation !== gen.id) continue;
      record.signature = { ...record.signature, time: cloneJson(time) };
      patchRequestBounds(record.req, bounds.startUs, bounds.endUs);
      if (record === meta.executed) republish = true;
    }
    if (meta.consentedScope)
      meta.consentedScope = { ...meta.consentedScope, time: cloneJson(time) };
    const executed = meta.executed;
    if (republish && executed) {
      emitExecuted({
        surface: "logs",
        generation: gen.id,
        signature: executed.signature,
        sortPreference: executed.sortPreference,
        req: executed.req,
      });
    }
    return true;
  }

  function recordPatternsComplete(generationId: number): boolean {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return false;
    meta.executedPatterns = {
      generation: gen.id,
      signature: cloneJson(gen.signature),
      complete: true,
    };
    setOutcome("patterns", "complete");
    emitExecuted({ surface: "patterns", generation: gen.id, signature: gen.signature });
    return true;
  }

  function recordPatternsFailure(generationId: number): boolean {
    if (!isCurrent(generationId)) return false;
    meta.executedPatterns = null;
    setOutcome("patterns", "failed");
    return true;
  }

  function panelGeneration(
    generationId: number,
  ): (Generation & { surface: "visualize" | "build" }) | null {
    const gen = generations.get(generationId);
    if (!gen || !isCurrent(generationId)) return null;
    if (gen.surface !== "visualize" && gen.surface !== "build") return null;
    return gen as Generation & { surface: "visualize" | "build" };
  }

  function recordPanelDispatch(generationId: number): boolean {
    const gen = panelGeneration(generationId);
    if (!gen) return false;
    meta.executedPanel = null;
    setOutcome(gen.surface, "running");
    return true;
  }

  function recordPanelComplete(generationId: number, configSignature: string): boolean {
    const gen = panelGeneration(generationId);
    if (!gen) return false;
    meta.executedPanel = {
      surface: gen.surface,
      configSignature,
      generation: gen.id,
      complete: true,
    };
    setOutcome(gen.surface, "complete");
    emitExecuted({
      surface: gen.surface,
      generation: gen.id,
      signature: gen.signature,
      configSignature,
    });
    return true;
  }

  function recordPanelFailure(generationId: number, cancelled = false): boolean {
    const gen = panelGeneration(generationId);
    if (!gen) return false;
    meta.executedPanel = null;
    setOutcome(gen.surface, cancelled ? "cancelled" : "failed");
    return true;
  }

  function invalidateExecuted(reason: string): void {
    meta.executed = null;
    meta.pendingExecution = null;
    invalidation = reason;
    deps.clearResults?.();
    setOutcome("logs", "invalidated");
  }

  function resetScope(cause: "saved-view" | "url" | "reapply" | "job" | "org"): void {
    cancelGeneration(null, { cause: cause === "org" ? "org" : "reset" });
    meta.executed = null;
    meta.pendingExecution = null;
    meta.executedPatterns = null;
    meta.executedPanel = null;
    meta.autoRunBlocked = null;
    meta.consentedScope = null;
    meta.runPending = false;
    meta.runOutcome = {};
    meta.runCancelled = {};
    missedTick = false;
    invalidation = null;
    if (cause === "saved-view" || cause === "url" || cause === "reapply") meta.editorDirty = false;
  }

  function registerRefreshPause(predicate: () => boolean): () => void {
    pausePredicates.add(predicate);
    return () => pausePredicates.delete(predicate);
  }

  function onRefreshTick(listener: (paused: boolean) => void): () => void {
    refreshTickListeners.add(listener);
    return () => refreshTickListeners.delete(listener);
  }

  function onExecutedRecorded(listener: (event: ExecutedRecordedEvent) => void): () => void {
    executedListeners.add(listener);
    return () => executedListeners.delete(listener);
  }

  function isRefreshPaused(): boolean {
    return [...pausePredicates].some((predicate) => {
      try {
        return predicate();
      } catch (error) {
        log("autoRun: refresh pause predicate failed", error);
        return false;
      }
    });
  }

  function tick(): RequestRunResult | "paused" {
    const paused = isRefreshPaused();
    refreshTickListeners.forEach((listener) => listener(paused));
    if (paused) {
      missedTick = true;
      return "paused";
    }
    return requestRun("refresh");
  }

  function checkRefreshResume(): boolean {
    if (!missedTick || isRefreshPaused() || isBusy()) return false;
    missedTick = false;
    requestRun("refresh");
    deps.rearmRefresh?.();
    return true;
  }

  function onRefreshIntervalChanged(seconds: number): void {
    if (seconds > 0) return;
    missedTick = false;
    deferredRefresh = false;
    if (pending.grid?.reasons.every((r) => r === "refresh")) clearPending("grid");
  }

  registerRefreshPause(() => isResultsStale());
  registerRefreshPause(() => !!meta.autoRunBlocked);

  return {
    isAutoRunActive: () => isAutoRunActive(config(), meta),
    isGuardActive: () => isGuardActive(config()),
    requestRun,
    runAnyway,
    newGeneration,
    cancelGeneration,
    registerTrace,
    registerAbort,
    settleGeneration,
    isCurrent,
    isTraceCurrent,
    currentGeneration: (lane: "grid" | "patterns" = "grid") => current[lane],
    markEditorDirty,
    clearEditorDirty,
    syncBlockedScope,
    isResultsStale,
    staleReason,
    canPersistOrShare,
    beginHits,
    settleHits,
    recordDispatch,
    recordChunk,
    recordComplete,
    recordFailure,
    recordWindowMove,
    recordPatternsComplete,
    recordPatternsFailure,
    recordPanelDispatch,
    recordPanelComplete,
    recordPanelFailure,
    invalidateExecuted,
    resetScope,
    registerRefreshPause,
    onRefreshTick,
    onExecutedRecorded,
    isRefreshPaused,
    tick,
    checkRefreshResume,
    onRefreshIntervalChanged,
    hasMissedTick: () => missedTick,
    hasDeferredRefresh: () => deferredRefresh,
    hasPendingRequest: () => !!pending.grid || !!pending.patterns,
  };
}

export type AutoRunEngine = ReturnType<typeof createAutoRun>;
