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

import { getCurrentInstance, ref } from "vue";
import { useStore, type Store } from "vuex";
import config from "@/aws-exports";
import { gt, type I18nKey, type I18nText } from "@/types/i18n";
import { searchState, type SearchObject } from "@/composables/useLogs/searchState";
import {
  REASON_KIND,
  buildLogsSignature,
  createAutoRun,
  panelConfigSignature,
  sameSignature,
  type AutoRunConfig,
  type AutoRunEngine,
  type AutoRunStore,
  type LogsSignature,
  type PersistAction,
  type PersistSurface,
  type RequestRunOptions,
  type RequestRunResult,
  type RunContext,
  type RunExecutors,
  type RunReason,
  type SearchMode,
} from "@/composables/useLogs/useAutoRun";
import {
  chooseNarrowPreset,
  estimateScanMb,
  relativeWindow,
  type EstimateContext,
  type ScanEstimate,
  type WindowUs,
} from "@/utils/logs/estimateScanMb";
import { sqlSources } from "@/utils/logs/sqlSources";
import { freeTextGateFlags } from "@/utils/logs/freeTextScan";
import { notePageCancelled } from "@/composables/useLogs/logsRowNav";
import { noteUserScopeChange } from "@/composables/useLogs/useLogPermalink";

export interface TransportPayload {
  traceId: string;
  type: string;
  isPagination?: boolean;
  queryReq?: unknown;
  generationId?: number;
}

export interface PanelConfigReader {
  (surface: "visualize" | "build"): unknown;
}

/** Browser abort and ENT server cancel, registered by the transport (useSearchConnection). */
export interface AutoRunTransport {
  abortTrace: (traceId: string, orgId: string) => void;
  serverCancel?: (orgId: string, traceIds: string[]) => Promise<unknown>;
}

const MODES: Record<string, SearchMode> = {
  logs: "logs",
  drilldown: "drilldown",
  patterns: "patterns",
  visualize: "visualize",
  build: "build",
};

// User refinements end a shared line even when Auto Run is off; time is noted by the picker, which knows a user pick from a restore.
const SCOPE_CHANGE_REASONS = new Set<RunReason>([
  "stream",
  "filter",
  "function",
  "zoom",
  "compare",
]);

const ROLE_BY_TYPE: Record<string, "hits" | "histogram" | "pageCount" | "other"> = {
  search: "hits",
  histogram: "histogram",
  pageCount: "pageCount",
};

let instance: ReturnType<typeof createLogsAutoRun> | null = null;
// Captured from the first component setup; the module never imports the store itself.
let appStore: Store<any> | null = null;
let transport: AutoRunTransport | null = null;
let logsSearchObj: SearchObject | null = null;

function noopExecutor(): void {
  return undefined;
}

function storeProxy(searchObj: () => SearchObject): AutoRunStore {
  // searchObj.meta and .data are replaced wholesale on keep-alive restore, so every access re-reads them.
  const meta = new Proxy({} as AutoRunStore["meta"], {
    get: (_t, key) => (searchObj().meta as Record<PropertyKey, unknown>)[key],
    set: (_t, key, value) => {
      (searchObj().meta as Record<PropertyKey, unknown>)[key] = value;
      return true;
    },
  });
  const grid = () =>
    searchObj().data?.resultGrid as unknown as Record<PropertyKey, unknown> | undefined;
  const resultGrid = new Proxy({} as AutoRunStore["data"]["resultGrid"], {
    get: (_t, key) => grid()?.[key],
    set: (_t, key, value) => {
      const target = grid();
      if (target) target[key] = value;
      return true;
    },
  });
  return { meta, data: { resultGrid } };
}

export function zoConfig(): AutoRunConfig & Record<string, unknown> {
  return (appStore?.state as { zoConfig?: Record<string, unknown> } | undefined)?.zoConfig ?? {};
}

export function setAutoRunTransport(next: AutoRunTransport): void {
  transport = next;
}

export function searchModeOf(toggle: string | undefined): SearchMode {
  return MODES[toggle ?? "logs"] ?? "logs";
}

// A saved view round-trips arrays as {0: "a"} objects, and a view may lack them entirely.
function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") return Object.values(value).map(String);
  return [];
}

export function readLogsSignature(searchObj: SearchObject): LogsSignature {
  const meta = searchObj.meta ?? {};
  const data = searchObj.data;
  const datetime = data.datetime ?? {};
  const scan = meta.freeTextScan ?? {};
  const superCluster = config.isEnterprise === "true" && !!zoConfig().super_cluster_enabled;
  return buildLogsSignature({
    query: String(data.query ?? "").trim(),
    sqlMode: !!meta.sqlMode,
    streams: toList(data.stream?.selectedStream),
    streamType: data.stream?.streamType || "logs",
    time:
      datetime.type === "absolute"
        ? {
            type: "absolute",
            startUs: Number(datetime.startTime),
            endUs: Number(datetime.endTime),
          }
        : { type: "relative", period: String(datetime.relativeTimePeriod ?? "") },
    transformContent: data.tempFunctionContent ?? "",
    showTransformEditor: !!meta.showTransformEditor,
    quickMode: !!meta.quickMode,
    // The field list only shapes the generated SQL; typed SQL carries its own select list.
    quickModeFields: meta.sqlMode ? [] : toList(data.stream?.interestingFieldList),
    regions: superCluster ? toList(meta.regions) : [],
    clusters: superCluster ? toList(meta.clusters) : [],
    refreshInterval: Number(meta.refreshInterval ?? 0),
    sortOrder: "desc",
    definedSchemas: String(meta.useUserDefinedSchemas ?? ""),
    // Absent while empty, so signatures recorded before any scan consent keep their key.
    freeTextScan: Object.keys(scan).length ? scan : undefined,
  });
}

/** Streams a signature reads: the SQL's physical sources in SQL mode, else the selection. */
export function scopeStreams(signature: LogsSignature): { names: string[]; resolved: boolean } {
  if (!signature.sqlMode) return { names: signature.streams, resolved: true };
  const parsed = sqlSources(signature.query);
  return { names: parsed.sources, resolved: parsed.resolved };
}

export function signatureWindow(signature: LogsSignature, nowUs: number): WindowUs {
  if (signature.time.type === "absolute") {
    return { startUs: signature.time.startUs, endUs: signature.time.endUs };
  }
  return relativeWindow(signature.time.period, nowUs) ?? { startUs: nowUs, endUs: nowUs };
}

function estimateContext(nowUs: number): EstimateContext {
  return {
    nowUs,
    defaultRetentionDays: Number(zoConfig().data_retention_days ?? 0),
    superCluster: !!zoConfig().super_cluster_enabled,
  };
}

export function estimateSignature(
  signature: LogsSignature,
  list: { name: string }[],
  nowUs: number,
): ScanEstimate {
  const { names } = scopeStreams(signature);
  return estimateScanMb(names, list, signatureWindow(signature, nowUs), estimateContext(nowUs));
}

function createLogsAutoRun() {
  const searchObj = () => logsSearchObj as SearchObject;
  const executors: RunExecutors = {
    logs: noopExecutor,
    patterns: noopExecutor,
    histogram: noopExecutor,
    visualize: noopExecutor,
  };
  let rearm: (() => void) | null = null;
  let panelConfigReader: PanelConfigReader | null = null;
  let skipClearResults = false;
  // Reactive so the grid's paging lock follows it; cleared by the next grid dispatch.
  const searchAroundShown = ref(false);

  const traceGeneration = new Map<string, number>();
  // Stop on a text-field scan bumps this; responses dispatched before it never render.
  let freeTextScanEpoch = 0;
  const generationEpoch = new Map<number, number>();
  const pendingLaunches = new Map<number, number>();
  const hitsDone = new Set<number>();

  const nowUs = () => Date.now() * 1000;
  const streamList = () => (searchObj().data.streamResults?.list ?? []) as { name: string }[];

  const engine: AutoRunEngine = createAutoRun({
    getConfig: () => zoConfig(),
    store: storeProxy(searchObj),
    readSignature: () => readLogsSignature(searchObj()),
    getMode: () => searchModeOf(searchObj().meta.logsVisualizeToggle),
    getOrgId: () => searchObj().organizationIdentifier || "",
    estimate: (signature) => estimateSignature(signature, streamList(), nowUs()),
    executors: {
      logs: (ctx) => executors.logs(ctx),
      patterns: (ctx) => executors.patterns(ctx),
      histogram: (ctx) => executors.histogram(ctx),
      visualize: (ctx) => executors.visualize(ctx),
    },
    abortTrace: (traceId) => {
      transport?.abortTrace(traceId, searchObj().organizationIdentifier);
      // A browser abort fires no error callback, so the crossing bound to this request resolves here.
      notePageCancelled(searchObj(), traceId);
      const data = searchObj().data;
      data.searchRequestTraceIds = (data.searchRequestTraceIds ?? []).filter(
        (id: string) => id !== traceId,
      );
      traceGeneration.delete(traceId);
    },
    serverCancel:
      config.isEnterprise === "true"
        ? (orgId, traceIds) =>
            transport?.serverCancel?.(orgId, traceIds) ?? Promise.resolve(undefined)
        : undefined,
    pickNarrowPreset: (signature) => {
      const now = nowUs();
      const window = signatureWindow(signature, now);
      return chooseNarrowPreset(
        scopeStreams(signature).names,
        streamList(),
        estimateContext(now),
        Number(zoConfig().auto_query_max_scan_mb ?? 0),
        window.endUs - window.startUs,
      );
    },
    getRefreshInterval: () => Number(searchObj().meta.refreshInterval ?? 0),
    resetLoading: () => {
      const obj = searchObj();
      obj.loading = false;
      obj.loadingHistogram = false;
      obj.loadingProgressPercentage = 0;
      obj.loadingHistogramProgressPercentage = 0;
    },
    clearResults: () => {
      if (skipClearResults) return;
      const data = searchObj().data;
      data.queryResults = { hits: [] };
      data.histogram = {
        ...data.histogram,
        xData: [],
        yData: [],
        breakdownSeries: null,
      };
    },
    rearmRefresh: () => rearm?.(),
    getFreeTextFlags: () => freeTextGateFlags(searchObj(), (key) => gt(key as I18nKey)),
    readPanelConfigSignature: (surface) => {
      if (!panelConfigReader) return null;
      return panelConfigSignature(panelConfigReader(surface), readLogsSignature(searchObj()));
    },
    t: (key) => gt(key as I18nKey),
    log: (message, error) => console.warn(message, error),
  });

  function generationOf(payload: TransportPayload): number | null {
    return traceGeneration.get(payload.traceId) ?? payload.generationId ?? null;
  }

  function hasOpenTrace(generationId: number): boolean {
    for (const id of traceGeneration.values()) if (id === generationId) return true;
    return false;
  }

  function maybeSettle(generationId: number): void {
    if (!hitsDone.has(generationId)) return;
    if (hasOpenTrace(generationId) || (pendingLaunches.get(generationId) ?? 0) > 0) return;
    hitsDone.delete(generationId);
    pendingLaunches.delete(generationId);
    generationEpoch.delete(generationId);
    engine.settleGeneration(generationId);
  }

  /** Registers a transport payload on its generation; false means the generation is gone and nothing may be sent. */
  function bindPayload(payload: TransportPayload): boolean {
    const generationId = payload.generationId;
    if (generationId == null) return true;
    const role = ROLE_BY_TYPE[payload.type] ?? "other";
    if (!engine.registerTrace(generationId, payload.traceId, role)) return false;
    traceGeneration.set(payload.traceId, generationId);
    if (!generationEpoch.has(generationId)) generationEpoch.set(generationId, freeTextScanEpoch);
    if (payload.type === "search") {
      searchAroundShown.value = false;
      engine.recordDispatch(generationId, {
        req: payload.queryReq,
        traceId: payload.traceId,
        pagination: !!payload.isPagination,
      });
    }
    return true;
  }

  function isPayloadCurrent(payload: TransportPayload): boolean {
    const generationId = generationOf(payload);
    if (generationId == null) return true;
    const epoch = generationEpoch.get(generationId) ?? freeTextScanEpoch;
    return epoch === freeTextScanEpoch && engine.isCurrent(generationId);
  }

  /** Stop on one stream's text-field scan: drops its consent and every row the scan produced (AC3.6). */
  function stopFreeTextScan(stream: string): void {
    freeTextScanEpoch += 1;
    engine.cancelGeneration(null, { cause: "user" });
    const obj = searchObj();
    const scan = { ...(obj.meta.freeTextScan ?? {}) };
    delete scan[stream];
    obj.meta.freeTextScan = scan;
    invalidateExecuted("scan-stop");
    if ((obj.data.stream?.selectedStream?.length ?? 0) > 1) {
      engine.requestRun("explicit", { origin: "scan-stop" });
    }
  }

  function onPayloadData(payload: TransportPayload, responseType: string | undefined): void {
    const generationId = generationOf(payload);
    if (generationId == null || payload.type !== "search") return;
    if (responseType === "search_response_hits" || responseType === "search_response_metadata") {
      engine.recordChunk(generationId);
    }
  }

  function onPayloadComplete(payload: TransportPayload): void {
    const generationId = generationOf(payload);
    if (generationId == null) return;
    if (payload.type === "search") engine.recordComplete(generationId, payload.traceId);
  }

  function onPayloadError(payload: TransportPayload): void {
    const generationId = generationOf(payload);
    if (generationId == null) return;
    if (payload.type === "search") engine.recordFailure(generationId, payload.traceId);
    finishPayload(payload);
  }

  /** Closes a payload after its terminal handler ran (and launched any follow-up). */
  function finishPayload(payload: TransportPayload): void {
    const generationId = generationOf(payload);
    traceGeneration.delete(payload.traceId);
    if (generationId == null) return;
    if (payload.type === "search") hitsDone.add(generationId);
    maybeSettle(generationId);
  }

  /** Keeps a generation open until a follow-up launch (histogram, page count) has been sent or skipped. */
  function trackLaunch(generationId: number | null | undefined, launch: unknown): void {
    if (generationId == null) return;
    pendingLaunches.set(generationId, (pendingLaunches.get(generationId) ?? 0) + 1);
    // The trailing macrotask covers page-count launches, which are queued with setTimeout(0).
    Promise.resolve(launch)
      .catch(() => undefined)
      .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
      .then(() => {
        pendingLaunches.set(
          generationId,
          Math.max(0, (pendingLaunches.get(generationId) ?? 1) - 1),
        );
        maybeSettle(generationId);
      });
  }

  /** Called by an executor once its synchronous dispatch is done; settles a generation that sent nothing. */
  function finishDispatch(generationId: number, opts: { hitsDone?: boolean } = {}): void {
    if (opts.hitsDone || !hasOpenTrace(generationId)) hitsDone.add(generationId);
    maybeSettle(generationId);
  }

  function adoptHandOver(ctx: RunContext): void {
    ctx.generation.traces.forEach((trace) => {
      if (traceGeneration.has(trace.traceId)) traceGeneration.set(trace.traceId, ctx.generation.id);
    });
  }

  function invalidateExecuted(reason: string): void {
    skipClearResults = reason === "search-around";
    searchAroundShown.value = reason === "search-around";
    try {
      engine.invalidateExecuted(reason);
    } finally {
      skipClearResults = false;
    }
  }

  function recordWindowMove(
    generationId: number | null | undefined,
    bounds: { startUs: number; endUs: number },
  ): void {
    const id = generationId ?? engine.currentGeneration("grid")?.id;
    if (id == null) return;
    engine.recordWindowMove(id, bounds);
  }

  function isUnchangedRefinement(reason: RunReason): boolean {
    if (REASON_KIND[reason] !== "refinement") return false;
    const obj = searchObj();
    if (obj.meta.autoRunBlocked) return false;
    const target = obj.meta.pendingExecution ?? obj.meta.executed;
    return !!target && sameSignature(readLogsSignature(obj), target.signature);
  }

  function request(
    reason: RunReason,
    options: RequestRunOptions = {},
  ): RequestRunResult | "unchanged" {
    if (SCOPE_CHANGE_REASONS.has(reason)) noteUserScopeChange();
    // Without a readable list or a selection there is nothing to estimate or run, e.g. the picker's mount emit.
    const stream = searchObj().data.stream;
    if (
      REASON_KIND[reason] !== "explicit" &&
      (!stream?.streamLists?.length || !stream?.selectedStream?.length)
    ) {
      return "skipped-ineligible";
    }
    if (isUnchangedRefinement(reason) && !engine.hasPendingRequest()) return "unchanged";
    return engine.requestRun(reason, options);
  }

  // Reasons come from the engine's `t`, which is gt(), so they are already translated text.
  function persistReason(surface: PersistSurface, action?: PersistAction): I18nText | null {
    const decision = engine.canPersistOrShare(surface, action);
    return decision.ok ? null : (decision.reason as I18nText);
  }

  let panelRun: {
    generationId: number;
    started: boolean;
    failed: boolean;
    dispatched: string | null;
  } | null = null;

  function currentPanelSignature(): string | null {
    if (!panelConfigReader) return null;
    const surface =
      searchModeOf(searchObj().meta.logsVisualizeToggle) === "build" ? "build" : "visualize";
    return panelConfigSignature(panelConfigReader(surface), readLogsSignature(searchObj()));
  }

  /** Starts the panel record lifecycle for a Visualize or Build run (J7 "Surface records"). */
  function beginPanelRun(generationId: number, abort?: () => void): void {
    engine.recordPanelDispatch(generationId);
    if (abort) engine.registerAbort(generationId, abort);
    panelRun = { generationId, started: false, failed: false, dispatched: null };
  }

  /** Freezes the inputs the panel was handed, so edits made while it loads are never certified. */
  function markPanelDispatched(generationId: number): void {
    if (panelRun?.generationId !== generationId || panelRun.dispatched !== null) return;
    panelRun.dispatched = currentPanelSignature();
  }

  /** Opens a panel generation for a run that did not come through requestRun (Build's own runs). */
  function openPanelRun(abort?: () => void): number {
    const generation = engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "visualize",
      signature: readLogsSignature(searchObj()),
    });
    beginPanelRun(generation.id, abort);
    return generation.id;
  }

  function markPanelFailed(): void {
    if (panelRun) panelRun.failed = true;
  }

  function endPanelRun(ok: boolean): void {
    const run = panelRun;
    panelRun = null;
    if (!run) return;
    const signature = run.dispatched;
    if (ok && signature) engine.recordPanelComplete(run.generationId, signature);
    else engine.recordPanelFailure(run.generationId);
    engine.settleGeneration(run.generationId);
  }

  /** Fed by the panels' shared loading state; a run counts once it has started and stopped. */
  function panelLoadingChanged(loading: boolean, hasErrors: boolean): void {
    if (!panelRun) return;
    if (loading) {
      panelRun.started = true;
      // Runs without an explicit dispatch mark are frozen when their load starts.
      markPanelDispatched(panelRun.generationId);
      return;
    }
    if (!panelRun.started) return;
    endPanelRun(!panelRun.failed && !hasErrors);
  }

  function hasPanelRun(generationId: number): boolean {
    return panelRun?.generationId === generationId;
  }

  function searchAroundActive(): boolean {
    return searchAroundShown.value;
  }

  return {
    engine,
    executors,
    setExecutors: (next: Partial<RunExecutors>) => Object.assign(executors, next),
    setRearmRefresh: (fn: (() => void) | null) => {
      rearm = fn;
    },
    setPanelConfigReader: (fn: PanelConfigReader | null) => {
      panelConfigReader = fn;
    },
    readSignature: () => readLogsSignature(searchObj()),
    request,
    bindPayload,
    isPayloadCurrent,
    onPayloadData,
    onPayloadComplete,
    onPayloadError,
    finishPayload,
    trackLaunch,
    finishDispatch,
    adoptHandOver,
    invalidateExecuted,
    stopFreeTextScan,
    recordWindowMove,
    persistReason,
    searchAroundActive,
    beginPanelRun,
    markPanelDispatched,
    openPanelRun,
    markPanelFailed,
    endPanelRun,
    panelLoadingChanged,
    hasPanelRun,
    panelSignature: (surface: "visualize" | "build") =>
      panelConfigReader
        ? panelConfigSignature(panelConfigReader(surface), readLogsSignature(searchObj()))
        : null,
  };
}

export type LogsAutoRun = ReturnType<typeof createLogsAutoRun>;

/** The one auto-run engine for the Logs page, bound to the logs search singleton. */
export function useLogsAutoRun(): LogsAutoRun {
  if (getCurrentInstance()) {
    appStore = appStore ?? useStore() ?? null;
    // The logs singleton's root never changes in the app; re-read in setup so specs can swap it.
    logsSearchObj = searchState().searchObj as SearchObject;
  }
  logsSearchObj = logsSearchObj ?? (searchState().searchObj as SearchObject);
  instance = instance ?? createLogsAutoRun();
  return instance;
}

/** Test hook: drops the singleton (and its captured store) so each spec starts fresh. */
export function resetLogsAutoRunForTests(store: Store<any> | null = null): void {
  instance = null;
  appStore = store;
  transport = null;
  logsSearchObj = null;
}
