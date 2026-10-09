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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  REASON_DEBOUNCE_MS,
  REASON_KIND,
  buildLogsSignature,
  createAutoRun,
  effectiveSortOrder,
  isAutoRunActive,
  isGuardActive,
  isScopeCovered,
  operationFor,
  panelConfigSignature,
  reasonEligibility,
  sameSignature,
  scopeOf,
  signatureKey,
  type AutoRunConfig,
  type AutoRunEngine,
  type AutoRunStore,
  type LogsSignature,
  type RunContext,
  type RunReason,
  type SearchMode,
  type TimeSelection,
} from "./useAutoRun";
import type { ScanEstimate } from "@/utils/logs/estimateScanMb";

interface LiveInputs {
  query: string;
  streams: string[];
  time: TimeSelection;
  streamType: string;
  regions: string[];
  sortOrder: "asc" | "desc";
  refreshInterval: number;
  showTransformEditor: boolean;
  transformContent: string | null;
}

interface SentRequest {
  type: "hits" | "pageCount" | "histogram" | "patterns" | "visualize";
  traceId: string;
  generation: number;
  req?: Record<string, unknown>;
  ctx: RunContext;
}

interface HarnessOptions {
  aqe?: boolean;
  threshold?: number | undefined;
  liveMode?: boolean;
  estimateMb?: number;
  mode?: SearchMode;
  serverCancel?: boolean;
}

const MINUTE_US = 60 * 1_000_000;

function signatureOf(live: LiveInputs): LogsSignature {
  return buildLogsSignature({
    query: live.query,
    sqlMode: false,
    streams: live.streams,
    streamType: live.streamType,
    time: live.time,
    transformContent: live.transformContent,
    showTransformEditor: live.showTransformEditor,
    quickMode: false,
    regions: live.regions,
    refreshInterval: live.refreshInterval,
    sortOrder: live.sortOrder,
    definedSchemas: "user_defined_schema",
  });
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function makeHarness(options: HarnessOptions = {}) {
  const live: LiveInputs = {
    query: "level='error'",
    streams: ["app"],
    time: { type: "relative", period: "15m" },
    streamType: "logs",
    regions: [],
    sortOrder: "desc",
    refreshInterval: 0,
    showTransformEditor: false,
    transformContent: null,
  };
  const cfg: AutoRunConfig = {
    auto_query_enabled: options.aqe ?? true,
    auto_query_max_scan_mb: "threshold" in options ? options.threshold : 100,
  };
  const store: AutoRunStore = {
    meta: {
      liveMode: options.liveMode ?? true,
      nlpMode: false,
      nlDetected: false,
      editorDirty: false,
      executed: null,
      pendingExecution: null,
    },
    data: { resultGrid: { hitsSettled: true } },
  };
  const state = {
    mode: options.mode ?? ("logs" as SearchMode),
    orgId: "org1",
    estimateMb: options.estimateMb ?? 10,
    estimateStatus: "known" as ScanEstimate["status"],
    panelConfig: "panel-v1",
  };
  const requests: SentRequest[] = [];
  let seq = 0;
  let engine: AutoRunEngine;

  const estimate = vi.fn((): ScanEstimate => ({
    status: state.estimateStatus,
    knownMb: state.estimateMb,
    streams: [],
    unknownStreams: [],
    unresolvedSources: state.estimateStatus === "unresolved" ? ["ghost"] : [],
    superCluster: false,
    window: { startUs: 0, endUs: 1 },
  }));

  const logs = vi.fn((ctx: RunContext) => {
    seq += 1;
    const traceId = `hits-${seq}`;
    const req = {
      query: {
        sql: ctx.signature.query,
        start_time: 1,
        end_time: 2,
        from: ctx.op === "page" ? 50 : 0,
        size: 50,
        sort: ctx.signature.effectiveSortOrder,
      },
    };
    engine.recordDispatch(ctx.generation.id, {
      req,
      traceId,
      pagination: ctx.op === "page",
      sortPreference: live.sortOrder,
    });
    requests.push({
      type: "hits",
      traceId,
      generation: ctx.generation.id,
      req: JSON.parse(JSON.stringify(req)),
      ctx,
    });
    engine.registerTrace(ctx.generation.id, `pc-${seq}`, "pageCount");
    requests.push({ type: "pageCount", traceId: `pc-${seq}`, generation: ctx.generation.id, ctx });
  });
  const histogram = vi.fn((ctx: RunContext) => {
    seq += 1;
    const traceId = `hist-${seq}`;
    engine.registerTrace(ctx.generation.id, traceId, "histogram");
    requests.push({ type: "histogram", traceId, generation: ctx.generation.id, ctx });
  });
  const patterns = vi.fn((ctx: RunContext) => {
    seq += 1;
    engine.registerTrace(ctx.generation.id, `pat-${seq}`, "patterns");
    requests.push({ type: "patterns", traceId: `pat-${seq}`, generation: ctx.generation.id, ctx });
  });
  const visualize = vi.fn((ctx: RunContext) => {
    seq += 1;
    requests.push({ type: "visualize", traceId: `vis-${seq}`, generation: ctx.generation.id, ctx });
  });

  const abortTrace = vi.fn();
  const serverCancel = vi.fn(async (_orgId: string, _ids: string[]) => undefined);
  const resetLoading = vi.fn();
  const rearmRefresh = vi.fn();
  const clearResults = vi.fn();
  const log = vi.fn();
  const freeText = { blockedReason: null as string | null, scanReason: null as string | null };

  engine = createAutoRun({
    getConfig: () => cfg,
    store,
    readSignature: () => signatureOf(live),
    getMode: () => state.mode,
    getOrgId: () => state.orgId,
    getRefreshInterval: () => live.refreshInterval,
    estimate,
    pickNarrowPreset: () => null,
    executors: { logs, histogram, patterns, visualize },
    abortTrace,
    serverCancel: options.serverCancel === false ? undefined : serverCancel,
    resetLoading,
    rearmRefresh,
    clearResults,
    readPanelConfigSignature: () => panelConfigSignature(state.panelConfig, signatureOf(live)),
    getFreeTextFlags: () => freeText,
    t: (key) => `t:${key}`,
    log,
  });

  const hits = () => requests.filter((r) => r.type === "hits");
  const lastGen = () => engine.currentGeneration()?.id as number;
  const completeLast = () => {
    const id = lastGen();
    engine.recordChunk(id);
    engine.recordComplete(id);
    engine.settleGeneration(id);
    return id;
  };

  return {
    engine,
    store,
    live,
    cfg,
    state,
    requests,
    hits,
    estimate,
    executors: { logs, histogram, patterns, visualize },
    abortTrace,
    serverCancel,
    resetLoading,
    rearmRefresh,
    clearResults,
    log,
    freeText,
    lastGen,
    completeLast,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("predicates", () => {
  it.each([
    // aqe, liveMode, nlDetected, nlpMode, expected
    [false, false, false, false, false],
    [false, true, false, false, false], // D1: stale oo_toggle_auto_run=true with AQE off
    [true, false, false, false, false],
    [true, true, false, false, true],
    [true, true, true, false, false],
    [true, true, true, true, true],
    [true, true, false, true, true],
  ])(
    "isAutoRunActive(aqe=%s, liveMode=%s, nl=%s, nlpMode=%s) = %s",
    (aqe, liveMode, nl, nlp, expected) => {
      expect(
        isAutoRunActive({ auto_query_enabled: aqe }, { liveMode, nlDetected: nl, nlpMode: nlp }),
      ).toBe(expected);
    },
  );

  it("D1: a stale liveMode never makes a time change run while AQE is off", () => {
    const h = makeHarness({ aqe: false, liveMode: true });
    expect(h.engine.requestRun("time")).toBe("skipped-ineligible");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
  });

  it.each([
    [{ auto_query_enabled: true }, false],
    [{ auto_query_enabled: true, auto_query_max_scan_mb: 0 }, false],
    [{ auto_query_enabled: true, auto_query_max_scan_mb: "0" }, false],
    [{ auto_query_enabled: true, auto_query_max_scan_mb: 500 }, true],
    [{ auto_query_enabled: false, auto_query_max_scan_mb: 500 }, false],
  ])("isGuardActive(%o) = %s", (config, expected) => {
    expect(isGuardActive(config as AutoRunConfig)).toBe(expected);
  });
});

describe("AC4.6 kind table", () => {
  const refinements: RunReason[] = [
    "landing",
    "stream",
    "filter",
    "time",
    "time-typed",
    "function",
  ];
  const entries: RunReason[] = [
    "url",
    "activation",
    "visualize-restore",
    "tab",
    "histogram",
    "patterns",
    "refresh",
  ];
  const explicit: RunReason[] = [
    "run",
    "saved-view",
    "run-anyway",
    "narrow",
    "pagination",
    "page-size",
    "sort",
    "zoom",
    "compare",
    "explicit",
  ];

  it("classifies every reason", () => {
    refinements.forEach((r) => expect(REASON_KIND[r]).toBe("refinement"));
    entries.forEach((r) => expect(REASON_KIND[r]).toBe("entry"));
    explicit.forEach((r) => expect(REASON_KIND[r]).toBe("explicit"));
    expect(Object.keys(REASON_KIND).sort()).toEqual(
      [...refinements, ...entries, ...explicit].sort(),
    );
  });

  it.each([
    ["refinement", "on", "guarded"],
    ["refinement", "off", "skip"],
    ["refinement", "aqe-false", "skip"],
    ["entry", "on", "guarded"],
    ["entry", "off", "guarded"],
    ["entry", "aqe-false", "unguarded"],
    ["explicit", "on", "unguarded"],
    ["explicit", "off", "unguarded"],
    ["explicit", "aqe-false", "unguarded"],
  ])("%s with Auto Run %s is %s", (kind, setting, expected) => {
    const config = { auto_query_enabled: setting !== "aqe-false" };
    const meta = { liveMode: setting === "on" };
    const reasons = kind === "refinement" ? refinements : kind === "entry" ? entries : explicit;
    reasons
      .filter((r) => r !== "narrow")
      .forEach((r) => expect(reasonEligibility(r, config, meta, "logs")).toBe(expected));
  });

  it("Narrow to runs whatever the Auto Run setting but re-checks the guard", () => {
    expect(
      reasonEligibility("narrow", { auto_query_enabled: true }, { liveMode: false }, "logs"),
    ).toBe("guarded");
  });

  it("refinements never auto-run on Visualize or Build", () => {
    expect(
      reasonEligibility("time", { auto_query_enabled: true }, { liveMode: true }, "visualize"),
    ).toBe("skip");
    expect(
      reasonEligibility("filter", { auto_query_enabled: true }, { liveMode: true }, "build"),
    ).toBe("skip");
  });

  it.each([
    ["refinement off", { liveMode: false }, "filter", 0, 0],
    ["refinement on", { liveMode: true }, "filter", 1, 1],
    ["entry off", { liveMode: false }, "url", 1, 1],
    ["explicit off", { liveMode: false }, "run", 1, 0],
  ])("dispatch matrix: %s", (_label, meta, reason, expectedHits, expectedEstimates) => {
    const h = makeHarness({ liveMode: meta.liveMode });
    h.engine.requestRun(reason as RunReason);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(expectedHits);
    expect(h.estimate).toHaveBeenCalledTimes(expectedEstimates);
  });

  it("entry points with AQE=false run unguarded, today's behaviour", () => {
    const h = makeHarness({ aqe: false, liveMode: false, estimateMb: 1e9 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.estimate).not.toHaveBeenCalled();
  });

  it("maps reasons to operations by mode", () => {
    expect(operationFor("time", "patterns")).toBe("patterns");
    expect(operationFor("histogram", "logs")).toBe("histogram");
    expect(operationFor("visualize-restore", "logs")).toBe("visualize");
    expect(operationFor("run", "build")).toBe("visualize");
    expect(operationFor("sort", "logs")).toBe("page");
    expect(operationFor("refresh", "patterns")).toBe("full");
    expect(operationFor("filter", "drilldown")).toBe("full");
  });
});

describe("J4 debounce and coalescing", () => {
  it("holds the J4 debounce table", () => {
    expect(REASON_DEBOUNCE_MS).toMatchObject({
      stream: 0,
      filter: 300,
      time: 0,
      "time-typed": 2500,
      zoom: 0,
      sort: 0,
      function: 300,
      tab: 0,
      histogram: 0,
      patterns: 0,
    });
  });

  it("coalesces three facet clicks inside 300 ms into one hits search", () => {
    const h = makeHarness();
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(100);
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(100);
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(299);
    expect(h.hits()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.hits()).toHaveLength(1);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.hits()[0].ctx.reasons).toEqual(["filter", "filter", "filter"]);
  });

  it("a Run click during a debounce drops the pending request", () => {
    const h = makeHarness();
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(100);
    h.engine.requestRun("run");
    expect(h.hits()).toHaveLength(1);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.hits()[0].ctx.reason).toBe("run");
  });

  it("mixed reasons use the longest pending debounce, in either order", () => {
    const h = makeHarness();
    h.engine.requestRun("time-typed");
    vi.advanceTimersByTime(100);
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(2399);
    expect(h.hits()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.hits()).toHaveLength(1);

    const g = makeHarness();
    g.engine.requestRun("filter");
    vi.advanceTimersByTime(100);
    g.engine.requestRun("time-typed");
    vi.advanceTimersByTime(2499);
    expect(g.hits()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(g.hits()).toHaveLength(1);
  });

  it("each trigger produces one generation within debounce + 100 ms", () => {
    const h = makeHarness();
    h.engine.requestRun("stream");
    vi.advanceTimersByTime(100);
    expect(h.hits()).toHaveLength(1);
  });

  it("forwards origin to the executor", () => {
    const h = makeHarness();
    h.engine.requestRun("url", { origin: "permalink-init" });
    vi.runAllTimers();
    expect(h.hits()[0].ctx.origin).toBe("permalink-init");
    h.engine.requestRun("explicit", { origin: "scan-stop" });
    expect(h.hits()[1].ctx.origin).toBe("scan-stop");
  });
});

describe("dirty editor (AC4.4)", () => {
  it("a Run stopped by validation records the baseline without claiming new results", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    const previous = h.store.meta.executed;
    h.executors.logs.mockImplementationOnce(() => undefined);
    h.live.query = "nosuch=1";
    h.engine.markEditorDirty();
    h.engine.requestRun("run");
    expect(h.engine.isRunDirty()).toBe(false);
    expect(h.store.meta.editorDirty).toBe(false);
    expect(h.store.meta.runPending).toBe(false);
    expect(h.store.meta.executed).toBe(previous);
    expect(h.engine.isResultsStale()).toBe(true);
    h.live.query = "nosuch=2";
    h.engine.markEditorDirty();
    expect(h.engine.isRunDirty()).toBe(true);
    h.live.query = "nosuch=1";
    expect(h.engine.reconcileEditorDirty()).toBe(true);
    expect(h.engine.isRunDirty()).toBe(false);
  });

  it("a trigger while dirty does not run and shows the pending dot", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    expect(h.engine.requestRun("filter")).toBe("pending-dirty");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.runPending).toBe(true);
  });

  it("a keystroke after a trigger cancels it", () => {
    const h = makeHarness();
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(100);
    h.engine.markEditorDirty();
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.runPending).toBe(true);
  });

  it("Run executes everything while dirty and clears dirty", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    h.engine.requestRun("filter");
    h.engine.requestRun("run");
    expect(h.hits()).toHaveLength(1);
    expect(h.store.meta.editorDirty).toBe(false);
    expect(h.store.meta.runPending).toBe(false);
  });

  it("entry points are aborted by dirty too; Narrow to and saved views are not", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    h.engine.requestRun("tab");
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(0);
    h.engine.requestRun("narrow");
    expect(h.hits()).toHaveLength(1);
    h.engine.requestRun("saved-view");
    expect(h.hits()).toHaveLength(2);
  });

  it("refinements preserve an existing dirty state", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    h.engine.requestRun("time");
    h.engine.requestRun("stream");
    vi.runAllTimers();
    expect(h.store.meta.editorDirty).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it("a deliberate scope replace clears dirty; org switch and job results do not", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    h.engine.resetScope("job");
    expect(h.store.meta.editorDirty).toBe(true);
    h.engine.resetScope("url");
    expect(h.store.meta.editorDirty).toBe(false);
    h.engine.markEditorDirty();
    h.engine.clearEditorDirty();
    expect(h.store.meta.editorDirty).toBe(false);
  });
});

describe("editor-origin stream changes (D3)", () => {
  it("never schedule a run", () => {
    const h = makeHarness();
    expect(h.engine.requestRun("stream", { origin: "editor" })).toBe("skipped-editor-origin");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
  });
});

describe("generations and cancellation", () => {
  it("a new generation aborts every trace of the previous one, page count included (D7)", async () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.lastGen();
    h.executors.histogram({ ...h.hits()[0].ctx });
    h.engine.requestRun("run");
    await flushMicrotasks();
    const aborted = h.abortTrace.mock.calls.map((c) => c[0]);
    expect(aborted.sort()).toEqual(["hist-2", "hits-1", "pc-1"]);
    expect(h.serverCancel).toHaveBeenCalledWith("org1", ["hits-1", "pc-1", "hist-2"]);
    expect(h.engine.isCurrent(first)).toBe(false);
    expect(h.resetLoading).not.toHaveBeenCalled();
  });

  it("pagination hands the in-flight same-scope histogram over to the new generation and accepts it", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.lastGen();
    h.engine.recordChunk(first);
    h.executors.histogram({ ...h.hits()[0].ctx });
    h.engine.requestRun("pagination");
    const aborted = h.abortTrace.mock.calls.map((c) => c[0]);
    expect(aborted.sort()).toEqual(["hits-1", "pc-1"]);
    expect(h.engine.isTraceCurrent("hist-2")).toBe(true);
    expect(h.engine.isTraceCurrent("hits-1")).toBe(false);
    expect(h.engine.currentGeneration()?.traces.map((t) => t.traceId)).toContain("hist-2");
    expect(h.hits()).toHaveLength(2);
    expect(h.hits()[1].req?.query).toMatchObject({ from: 50 });
  });

  it("the sort toggle hands the histogram over too, although the order changes", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.engine.recordChunk(h.lastGen());
    h.executors.histogram({ ...h.hits()[0].ctx });
    h.live.sortOrder = "asc";
    h.engine.requestRun("sort");
    expect(h.abortTrace.mock.calls.map((c) => c[0])).not.toContain("hist-2");
    expect(h.engine.isTraceCurrent("hist-2")).toBe(true);
  });

  it("a full run never hands the histogram over", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.executors.histogram({ ...h.hits()[0].ctx });
    h.live.query = "level='warn'";
    h.engine.requestRun("run");
    expect(h.abortTrace.mock.calls.map((c) => c[0])).toContain("hist-2");
  });

  it("stale-generation responses are ignored", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.lastGen();
    h.engine.requestRun("run");
    const second = h.lastGen();
    expect(h.engine.recordChunk(first)).toBe(false);
    expect(h.engine.recordComplete(first)).toBe(false);
    expect(h.engine.recordFailure(first)).toBe(false);
    expect(h.store.meta.executed).toBeNull();
    expect(h.engine.recordChunk(second)).toBe(true);
    expect(h.store.meta.executed?.generation).toBe(second);
  });

  it("a failed server cancel is logged and leaves the new generation's flags untouched", async () => {
    const h = makeHarness();
    h.serverCancel.mockRejectedValueOnce(new Error("503"));
    h.engine.requestRun("run");
    h.engine.requestRun("run");
    const second = h.engine.currentGeneration();
    await flushMicrotasks();
    expect(h.log).toHaveBeenCalledWith("autoRun: server cancel failed", expect.any(Error));
    expect(second?.cancelled).toBe(false);
    expect(h.engine.isCurrent(second?.id as number)).toBe(true);
    expect(h.resetLoading).not.toHaveBeenCalled();
    expect(h.store.meta.runOutcome?.logs).toBe("running");
    expect(h.store.data.resultGrid.hitsSettled).toBe(false);
  });

  it("an org switch cancels with the old generation's orgId", async () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.state.orgId = "org2";
    h.engine.resetScope("org");
    await flushMicrotasks();
    expect(h.serverCancel).toHaveBeenCalledWith("org1", ["hits-1", "pc-1"]);
    expect(h.resetLoading).toHaveBeenCalledTimes(1);
  });

  it("OSS has no server cancel; the browser abort still runs", async () => {
    const h = makeHarness({ serverCancel: false });
    h.engine.requestRun("run");
    h.engine.cancelGeneration();
    await flushMicrotasks();
    expect(h.abortTrace).toHaveBeenCalledTimes(2);
    expect(h.serverCancel).not.toHaveBeenCalled();
  });

  it("an explicit Run during an in-flight automatic generation cancels it and starts a new one", () => {
    const h = makeHarness();
    h.engine.requestRun("stream");
    vi.runAllTimers();
    const auto = h.lastGen();
    h.engine.requestRun("run");
    expect(h.hits()).toHaveLength(2);
    expect(h.engine.isCurrent(auto)).toBe(false);
    expect(h.abortTrace).toHaveBeenCalledWith("hits-1");
  });

  it("explicit Cancel resets loading, settles hits, drops pending runs and marks the outcome", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.engine.requestRun("filter");
    h.engine.cancelGeneration();
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.resetLoading).toHaveBeenCalledTimes(1);
    expect(h.store.data.resultGrid.hitsSettled).toBe(true);
    expect(h.store.meta.pendingExecution).toBeNull();
    expect(h.store.meta.runOutcome?.logs).toBe("cancelled");
  });

  it("cancel after some chunks keeps the partial record, which G1 rejects", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.engine.recordChunk(h.lastGen());
    h.engine.cancelGeneration();
    expect(h.store.meta.executed?.complete).toBe(false);
    expect(h.store.meta.runOutcome?.logs).toBe("partial");
    expect(h.engine.canPersistOrShare("logs").ok).toBe(false);
  });

  it("registered abort hooks (compare passes, patterns cancel) run on cancel", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const controller = new AbortController();
    const hook = vi.fn();
    expect(h.engine.registerAbort(h.lastGen(), controller)).toBe(true);
    h.engine.registerAbort(h.lastGen(), hook);
    h.engine.cancelGeneration();
    expect(controller.signal.aborted).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(h.engine.registerAbort(h.lastGen(), hook)).toBe(false);
    expect(h.engine.registerTrace(h.lastGen(), "late")).toBe(false);
  });

  it("a settled generation is not aborted again", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("run");
    expect(h.abortTrace).not.toHaveBeenCalled();
  });

  it("an executor that throws marks the run failed instead of leaving it running", () => {
    const h = makeHarness();
    h.executors.logs.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(h.engine.requestRun("run")).toBe("failed");
    expect(h.store.meta.runOutcome?.logs).toBe("failed");
  });

  it("an executor that rejects marks the run failed and settles it", async () => {
    const h = makeHarness();
    h.executors.logs.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    h.engine.requestRun("run");
    await flushMicrotasks();
    expect(h.store.meta.runOutcome?.logs).toBe("failed");
    expect(h.engine.currentGeneration()?.settled).toBe(true);
  });
});

describe("failure and child lifecycle (round 2)", () => {
  it.each([
    ["rejects", true],
    ["throws", false],
  ])(
    "an executor that %s after recordDispatch settles hits, drops the pending record and aborts its work",
    async (_label, rejects) => {
      const h = makeHarness();
      h.executors.logs.mockImplementationOnce((ctx: RunContext) => {
        h.engine.recordDispatch(ctx.generation.id, { req: { query: {} }, traceId: "hits-x" });
        h.engine.registerTrace(ctx.generation.id, "pc-x", "pageCount");
        if (rejects) return Promise.reject(new Error("boom"));
        throw new Error("boom");
      });
      h.engine.requestRun("run");
      await flushMicrotasks();
      expect(h.store.data.resultGrid.hitsSettled).toBe(true);
      expect(h.store.meta.pendingExecution).toBeNull();
      expect(h.store.meta.runOutcome?.logs).toBe("failed");
      expect(h.abortTrace.mock.calls.map((c) => c[0]).sort()).toEqual(["hits-x", "pc-x"]);
      expect(h.resetLoading).toHaveBeenCalledTimes(1);
      expect(h.engine.isCurrent(h.lastGen())).toBe(false);
      h.engine.cancelGeneration();
      expect(h.store.data.resultGrid.hitsSettled).toBe(true);
    },
  );

  it("an executor rejection after the first chunk keeps the partial record", async () => {
    const h = makeHarness();
    h.executors.logs.mockImplementationOnce((ctx: RunContext) => {
      h.engine.recordDispatch(ctx.generation.id, { req: { query: {} }, traceId: "hits-x" });
      h.engine.recordChunk(ctx.generation.id);
      return Promise.reject(new Error("boom"));
    });
    h.engine.requestRun("run");
    await flushMicrotasks();
    expect(h.store.meta.executed?.complete).toBe(false);
    expect(h.store.meta.runOutcome?.logs).toBe("partial");
    expect(h.engine.canPersistOrShare("logs").ok).toBe(false);
  });

  it("a rejection from a replaced generation leaves the new one untouched", async () => {
    const h = makeHarness();
    let rejectOld: (error: Error) => void = () => undefined;
    h.executors.logs.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectOld = reject)),
    );
    h.engine.requestRun("run");
    h.engine.requestRun("run");
    const second = h.lastGen();
    rejectOld(new Error("late"));
    await flushMicrotasks();
    expect(h.engine.isCurrent(second)).toBe(true);
    expect(h.store.meta.runOutcome?.logs).toBe("running");
    expect(h.resetLoading).not.toHaveBeenCalled();
  });

  it.each([
    ["Cancel", (h: ReturnType<typeof makeHarness>) => h.engine.cancelGeneration()],
    ["replacement", (h: ReturnType<typeof makeHarness>) => h.engine.requestRun("run")],
  ])("a child registered after the grid settled is aborted by %s", (_label, act) => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const gen = h.completeLast();
    const controller = new AbortController();
    expect(h.engine.registerAbort(gen, controller)).toBe(true);
    expect(h.engine.registerTrace(gen, "compare-1", "compare")).toBe(true);
    act(h);
    expect(controller.signal.aborted).toBe(true);
    expect(h.abortTrace.mock.calls.map((c) => c[0])).toEqual(["compare-1"]);
  });

  it("an attached histogram that rejects is reported without failing or settling the page", async () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("pagination");
    const page = h.lastGen();
    h.executors.histogram.mockImplementationOnce(() => Promise.reject(new Error("hist")));
    h.engine.requestRun("histogram");
    vi.runAllTimers();
    await flushMicrotasks();
    expect(h.log).toHaveBeenCalledWith("autoRun: attached histogram failed", expect.any(Error));
    expect(h.engine.isCurrent(page)).toBe(true);
    expect(h.engine.currentGeneration()?.settled).toBe(false);
    expect(h.store.meta.runOutcome?.logs).toBe("running");
  });

  it("an attached histogram that throws is reported as failed", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("pagination");
    h.executors.histogram.mockImplementationOnce(() => {
      throw new Error("hist");
    });
    h.engine.requestRun("histogram");
    vi.runAllTimers();
    expect(h.log).toHaveBeenCalledWith("autoRun: attached histogram failed", expect.any(Error));
    expect(h.engine.isCurrent(h.lastGen())).toBe(true);
  });

  it("a histogram-only run that fails never marks the displayed logs failed", async () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.executors.histogram.mockImplementationOnce(() => Promise.reject(new Error("hist")));
    h.engine.requestRun("histogram");
    vi.runAllTimers();
    await flushMicrotasks();
    expect(h.store.meta.runOutcome?.logs).toBe("complete");
    expect(h.store.meta.executed).not.toBeNull();
  });
});

describe("scope resets invalidate earlier work (round 2)", () => {
  it.each(["saved-view", "url", "reapply", "job", "org"] as const)(
    "%s: a late Patterns completion is dropped",
    (cause) => {
      const h = makeHarness({ mode: "patterns" });
      h.engine.requestRun("run");
      const old = h.engine.currentGeneration("patterns")?.id as number;
      h.engine.resetScope(cause);
      expect(h.engine.isCurrent(old)).toBe(false);
      expect(h.engine.recordPatternsComplete(old)).toBe(false);
      expect(h.store.meta.executedPatterns).toBeNull();
      expect(h.abortTrace).toHaveBeenCalledWith("pat-1");
    },
  );

  it.each(["saved-view", "url", "reapply", "job"] as const)(
    "%s: pending timers and a deferred refresh do not survive",
    (cause) => {
      const h = makeHarness();
      h.live.refreshInterval = 10;
      h.engine.requestRun("run");
      h.engine.tick();
      h.engine.requestRun("filter");
      h.engine.resetScope(cause);
      vi.runAllTimers();
      expect(h.hits()).toHaveLength(1);
      expect(h.engine.hasPendingRequest()).toBe(false);
      expect(h.engine.hasDeferredRefresh()).toBe(false);
      expect(h.engine.recordChunk(h.lastGen())).toBe(false);
      expect(h.store.meta.executed).toBeNull();
    },
  );
});

describe("explicit zoom", () => {
  it("dispatches without calling estimate()", () => {
    const h = makeHarness({ estimateMb: 1e9 });
    h.engine.requestRun("zoom");
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.hits()).toHaveLength(1);
  });

  it("stays pending when the editor is dirty", () => {
    const h = makeHarness();
    h.engine.markEditorDirty();
    expect(h.engine.requestRun("zoom")).toBe("pending-dirty");
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.runPending).toBe(true);
    expect(h.store.meta.editorDirty).toBe(true);
  });
});

describe("modes and child requests", () => {
  it("Patterns mode dispatches only the extraction request", () => {
    const h = makeHarness({ mode: "patterns" });
    h.engine.requestRun("time");
    vi.runAllTimers();
    expect(h.executors.patterns).toHaveBeenCalledTimes(1);
    expect(h.executors.logs).not.toHaveBeenCalled();
    expect(h.requests.map((r) => r.type)).toEqual(["patterns"]);
  });

  it("Patterns activation runs with Auto Run off and is guarded", () => {
    const h = makeHarness({ liveMode: false, estimateMb: 1e9 });
    h.engine.requestRun("patterns");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.autoRunBlocked?.op).toBe("patterns");
    h.state.estimateMb = 1;
    h.engine.requestRun("patterns");
    vi.runAllTimers();
    expect(h.requests.map((r) => r.type)).toEqual(["patterns"]);
  });

  it("a patterns request is superseded only by another patterns request", () => {
    const h = makeHarness();
    h.engine.requestRun("patterns");
    h.engine.requestRun("filter");
    vi.runAllTimers();
    expect(h.requests.filter((r) => r.type === "patterns")).toHaveLength(1);
    expect(h.hits()).toHaveLength(1);
  });

  it("histogram reveal sends one histogram request and zero hits requests", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.estimate.mockClear();
    h.engine.requestRun("histogram");
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.requests.filter((r) => r.type === "histogram")).toHaveLength(1);
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.requests.at(-1)?.ctx.target).toBe("executed");
    expect(h.store.meta.executed).not.toBeNull();
  });

  it("a histogram request is dropped while a full generation is pending or streaming", () => {
    const h = makeHarness();
    h.engine.requestRun("filter");
    expect(h.engine.requestRun("histogram")).toBe("dropped");
    vi.runAllTimers();
    expect(h.engine.requestRun("histogram")).toBe("dropped");
    expect(h.requests.filter((r) => r.type === "histogram")).toHaveLength(0);
  });

  it("a full trigger replaces a pending histogram-only run", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("histogram");
    h.engine.requestRun("filter");
    vi.runAllTimers();
    expect(h.requests.filter((r) => r.type === "histogram")).toHaveLength(0);
    expect(h.hits()).toHaveLength(2);
  });

  it("histogram reveal during an in-flight page attaches to that generation", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("pagination");
    const page = h.lastGen();
    h.engine.requestRun("histogram");
    vi.runAllTimers();
    const hist = h.requests.filter((r) => r.type === "histogram");
    expect(hist).toHaveLength(1);
    expect(hist[0].generation).toBe(page);
    expect(h.engine.isCurrent(page)).toBe(true);
  });

  it("guards a Visualize restore: allowed and blocked", () => {
    const allowed = makeHarness();
    allowed.engine.requestRun("visualize-restore");
    vi.runAllTimers();
    expect(allowed.requests.map((r) => r.type)).toEqual(["visualize"]);

    const blocked = makeHarness({ estimateMb: 1e9 });
    blocked.engine.requestRun("visualize-restore");
    vi.runAllTimers();
    expect(blocked.requests).toHaveLength(0);
    expect(blocked.store.meta.autoRunBlocked?.op).toBe("visualize");
  });
});

describe("guard, consent and Run anyway", () => {
  it("blocks an over-threshold automatic run, sends nothing and resets loading", () => {
    const h = makeHarness({ estimateMb: 500 });
    expect(h.engine.requestRun("stream")).toBe("scheduled");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.autoRunBlocked).toMatchObject({
      reason: "stream",
      estimateMb: 500,
      status: "known",
      streams: ["app"],
    });
    expect(h.store.meta.runPending).toBe(true);
    expect(h.store.meta.runOutcome?.logs).toBe("blocked");
    expect(h.resetLoading).toHaveBeenCalledTimes(1);
  });

  it("a blocked run cancels the previous in-flight generation", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.lastGen();
    h.state.estimateMb = 500;
    h.live.streams = ["app", "big"];
    h.engine.requestRun("stream");
    vi.runAllTimers();
    expect(h.engine.isCurrent(first)).toBe(false);
    expect(h.abortTrace).toHaveBeenCalledWith("hits-1");
  });

  it("an unresolved source is blocked with no Narrow to, never sent", () => {
    const h = makeHarness();
    h.state.estimateStatus = "unresolved";
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.autoRunBlocked).toMatchObject({ status: "unresolved", narrowTo: null });
    expect(h.store.meta.autoRunBlocked?.decision.reason).toBe("unresolved");
  });

  it("the guard is skipped when the threshold field is absent", () => {
    const h = makeHarness({ threshold: undefined, estimateMb: 1e12 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.estimate).not.toHaveBeenCalled();
  });

  it("consent: narrowing refinements and ticks skip estimate(); widening or adding a stream re-estimates", () => {
    const h = makeHarness();
    h.live.time = { type: "relative", period: "7d" };
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.store.meta.consentedScope).toMatchObject({ streams: ["app"], time: { period: "7d" } });

    h.live.query = "level='warn'";
    h.engine.requestRun("filter");
    vi.runAllTimers();
    h.completeLast();
    h.live.time = { type: "relative", period: "1h" };
    h.engine.requestRun("time");
    vi.runAllTimers();
    h.completeLast();
    const nowUs = Date.now() * 1000;
    h.live.time = {
      type: "absolute",
      startUs: nowUs - 3 * 60 * MINUTE_US,
      endUs: nowUs - 60 * MINUTE_US,
    };
    h.engine.requestRun("zoom");
    h.completeLast();
    h.live.refreshInterval = 10;
    h.engine.tick();
    vi.runAllTimers();
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.hits()).toHaveLength(5);

    h.live.time = { type: "relative", period: "30d" };
    h.engine.requestRun("time");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(1);
    h.completeLast();

    h.live.streams = ["app", "db"];
    h.engine.requestRun("stream");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(2);
  });

  it("consent: an entry-point load always re-estimates", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(1);
  });

  it("consent is cleared by every scope-replacing load", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.resetScope("saved-view");
    expect(h.store.meta.consentedScope).toBeNull();
    h.engine.requestRun("filter");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(1);
  });

  it("Run anyway executes the blocked scope once, unguarded, and consents to it", () => {
    const h = makeHarness({ estimateMb: 500 });
    h.live.time = { type: "relative", period: "7d" };
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(1);
    expect(h.engine.runAnyway()).toBe("dispatched");
    expect(h.estimate).toHaveBeenCalledTimes(1);
    expect(h.hits()).toHaveLength(1);
    expect(h.hits()[0].ctx.target).toBe("blocked");
    expect(h.hits()[0].ctx.signature.time).toEqual({ type: "relative", period: "7d" });
    expect(h.store.meta.autoRunBlocked).toBeNull();
    expect(h.store.meta.consentedScope?.time).toEqual({ type: "relative", period: "7d" });
    h.completeLast();
    h.engine.requestRun("filter");
    vi.runAllTimers();
    expect(h.estimate).toHaveBeenCalledTimes(1);
  });

  it("Run anyway is withdrawn when the editor turns dirty", () => {
    const h = makeHarness({ estimateMb: 500 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    h.engine.markEditorDirty();
    expect(h.store.meta.autoRunBlocked).toBeNull();
    expect(h.store.meta.runPending).toBe(true);
    expect(h.engine.runAnyway()).toBe("skipped-ineligible");
    expect(h.requests).toHaveLength(0);
  });

  it("Run anyway is withdrawn when the scope changed after the block", () => {
    const h = makeHarness({ estimateMb: 500 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    h.live.query = "something else";
    expect(h.engine.runAnyway()).toBe("withdrawn");
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.runPending).toBe(true);
  });

  it("syncBlockedScope withdraws a stale block and keeps a current one", () => {
    const h = makeHarness({ estimateMb: 500 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(h.engine.syncBlockedScope()).toBe(false);
    h.live.time = { type: "relative", period: "1h" };
    expect(h.engine.syncBlockedScope()).toBe(true);
    expect(h.store.meta.autoRunBlocked).toBeNull();
  });

  it("Narrow to runs with Auto Run off after re-checking the guard", () => {
    const h = makeHarness({ liveMode: false, estimateMb: 500 });
    h.engine.requestRun("url");
    vi.runAllTimers();
    h.live.time = { type: "relative", period: "1h" };
    h.state.estimateMb = 50;
    expect(h.engine.requestRun("narrow")).toBe("dispatched");
    expect(h.estimate).toHaveBeenCalledTimes(2);
    expect(h.hits()).toHaveLength(1);

    h.state.estimateMb = 500;
    h.live.time = { type: "relative", period: "2d" };
    expect(h.engine.requestRun("narrow")).toBe("blocked");
  });

  it("explicit kinds bypass the guard", () => {
    const h = makeHarness({ estimateMb: 1e9 });
    ["run", "saved-view", "pagination", "page-size", "compare", "explicit"].forEach((r) =>
      h.engine.requestRun(r as RunReason),
    );
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.hits()).toHaveLength(6);
  });
});

describe("executed record and staleness", () => {
  it("is not stale before the first execution", () => {
    const h = makeHarness();
    expect(h.engine.isResultsStale()).toBe(false);
    expect(h.engine.staleReason()).toBeNull();
  });

  it("is stale after an edit or a dirty editor, with the tooltip copy", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.engine.isResultsStale()).toBe(false);
    h.live.query = "x";
    expect(h.engine.isResultsStale()).toBe(true);
    expect(h.engine.staleReason()).toBe("t:search.autoRunStaleTooltip");
    h.live.query = "level='error'";
    h.engine.markEditorDirty();
    expect(h.engine.isResultsStale()).toBe(true);
  });

  it("a non-pagination dispatch clears the displayed record; pagination keeps it until its first chunk", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.completeLast();
    h.engine.requestRun("pagination");
    expect(h.store.meta.executed?.generation).toBe(first);
    const page = h.lastGen();
    expect(h.store.meta.pendingExecution?.generation).toBe(page);
    h.engine.recordChunk(page);
    expect(h.store.meta.executed?.generation).toBe(page);
    h.engine.requestRun("run");
    expect(h.store.meta.executed).toBeNull();
  });

  it("an error before the first chunk discards pendingExecution and keeps page 1 described", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const first = h.completeLast();
    h.engine.requestRun("pagination");
    h.engine.recordFailure(h.lastGen());
    expect(h.store.meta.pendingExecution).toBeNull();
    expect(h.store.meta.executed?.generation).toBe(first);
    expect(h.store.meta.runOutcome?.logs).toBe("failed");
  });

  it("captures the final request by value", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const sent = h.hits()[0].req;
    expect(h.store.meta.pendingExecution?.req).toEqual(sent);
    expect(h.store.meta.pendingExecution?.req).not.toBe(sent);
  });

  it("job results do not stay stale-disabled after an earlier run", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.live.query = "edited";
    expect(h.engine.isResultsStale()).toBe(true);
    h.engine.resetScope("job");
    expect(h.engine.isResultsStale()).toBe(false);
  });

  it("invalidateExecuted clears both records and the results, and G1 disables at once", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.engine.canPersistOrShare("logs").ok).toBe(true);
    h.engine.invalidateExecuted("search-around");
    expect(h.store.meta.executed).toBeNull();
    expect(h.store.meta.pendingExecution).toBeNull();
    expect(h.clearResults).toHaveBeenCalledTimes(1);
    expect(h.store.meta.runOutcome?.logs).toBe("invalidated");
    expect(h.engine.canPersistOrShare("logs")).toEqual({
      ok: false,
      reason: "t:search.autoRunSearchAroundActive",
    });
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.engine.canPersistOrShare("logs").ok).toBe(true);
  });

  it("scan Stop: invalidate then an explicit re-run with a different signature", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.engine.cancelGeneration();
    h.engine.invalidateExecuted("scan-stop");
    expect(h.engine.canPersistOrShare("logs")).toEqual({
      ok: false,
      reason: "t:search.autoRunPersistNeedsRun",
    });
    h.live.streams = ["app2"];
    h.engine.requestRun("explicit", { origin: "scan-stop" });
    h.completeLast();
    expect(h.store.meta.executed?.signature.streams).toEqual(["app2"]);
  });
});

describe("hitsSettled", () => {
  it("is false at a hits dispatch and true at its own terminal event only", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    expect(h.store.data.resultGrid.hitsSettled).toBe(false);
    h.engine.settleHits("someone-else");
    expect(h.store.data.resultGrid.hitsSettled).toBe(false);
    h.engine.recordComplete(h.lastGen(), "hits-1");
    expect(h.store.data.resultGrid.hitsSettled).toBe(true);
  });

  it("covers the job branch and search-around through beginHits / settleHits", () => {
    const h = makeHarness();
    h.engine.beginHits("job-1");
    expect(h.store.data.resultGrid.hitsSettled).toBe(false);
    h.engine.settleHits("job-1");
    expect(h.store.data.resultGrid.hitsSettled).toBe(true);
  });

  it("is set true by cancelGeneration for the cancelled hits request", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.engine.requestRun("run");
    expect(h.store.data.resultGrid.hitsSettled).toBe(false);
    h.engine.cancelGeneration();
    expect(h.store.data.resultGrid.hitsSettled).toBe(true);
  });
});

describe("server window moves", () => {
  const moved = { startUs: 1_000, endUs: 2_000 };

  it.each([
    ["with the first hits chunk", true],
    ["before the first chunk", false],
  ])("patches the record, request and consent %s", (_label, afterChunk) => {
    const h = makeHarness();
    const events: unknown[] = [];
    h.engine.onExecutedRecorded((e) => events.push(e));
    h.engine.requestRun("run");
    const gen = h.lastGen();
    if (afterChunk) h.engine.recordChunk(gen);
    h.engine.recordWindowMove(gen, moved);
    h.live.time = { type: "absolute", ...moved };
    if (!afterChunk) h.engine.recordChunk(gen);
    h.engine.recordComplete(gen);
    const record = h.store.meta.executed;
    expect(record?.signature.time).toEqual({ type: "absolute", ...moved });
    expect(record?.req).toMatchObject({ query: { start_time: 1_000, end_time: 2_000 } });
    expect(h.store.meta.consentedScope?.time).toEqual({ type: "absolute", ...moved });
    expect(h.engine.isResultsStale()).toBe(false);
    expect(events).toHaveLength(afterChunk ? 2 : 1);
  });

  it("ignores a move for a replaced generation", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    const old = h.lastGen();
    h.engine.requestRun("run");
    expect(h.engine.recordWindowMove(old, moved)).toBe(false);
  });
});

describe("onExecutedRecorded", () => {
  it("fires once per grid run at the first chunk", () => {
    const h = makeHarness();
    const listener = vi.fn();
    h.engine.onExecutedRecorded(listener);
    h.engine.requestRun("run");
    const gen = h.lastGen();
    h.engine.recordChunk(gen);
    h.engine.recordChunk(gen);
    h.engine.recordComplete(gen);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      surface: "logs",
      generation: gen,
      sortPreference: "desc",
    });
    expect(listener.mock.calls[0][0].req).toEqual(h.hits()[0].req);
  });

  it("fires at a zero-hit success", () => {
    const h = makeHarness();
    const listener = vi.fn();
    h.engine.onExecutedRecorded(listener);
    h.engine.requestRun("run");
    h.engine.recordComplete(h.lastGen());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.store.meta.executed?.complete).toBe(true);
  });

  it("never fires for a run cancelled or errored before its first chunk, or blocked", () => {
    const h = makeHarness();
    const listener = vi.fn();
    h.engine.onExecutedRecorded(listener);
    h.engine.requestRun("run");
    h.engine.cancelGeneration();
    h.engine.requestRun("run");
    h.engine.recordFailure(h.lastGen());
    h.state.estimateMb = 1e9;
    h.engine.requestRun("url");
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
  });

  it("fires for Patterns and panel records, and stops after unsubscribe", () => {
    const h = makeHarness({ mode: "patterns" });
    const listener = vi.fn();
    const off = h.engine.onExecutedRecorded(listener);
    h.engine.requestRun("run");
    h.engine.recordPatternsComplete(h.engine.currentGeneration("patterns")?.id as number);
    h.state.mode = "visualize";
    h.engine.requestRun("run");
    h.engine.recordPanelComplete(h.lastGen(), "cfg");
    expect(listener.mock.calls.map((c) => c[0].surface)).toEqual(["patterns", "visualize"]);
    off();
    h.state.mode = "build";
    h.engine.requestRun("run");
    expect(h.engine.recordPanelComplete(h.lastGen(), "cfg")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("a throwing listener is logged and does not break the run", () => {
    const h = makeHarness();
    h.engine.onExecutedRecorded(() => {
      throw new Error("listener");
    });
    h.engine.requestRun("run");
    expect(h.engine.recordChunk(h.lastGen())).toBe(true);
    expect(h.log).toHaveBeenCalledWith(
      "autoRun: onExecutedRecorded listener failed",
      expect.any(Error),
    );
  });
});

describe("auto-refresh", () => {
  function refreshing() {
    const h = makeHarness();
    h.live.refreshInterval = 10;
    h.engine.requestRun("run");
    h.completeLast();
    return h;
  }

  it("ticks re-run the executed signature", () => {
    const h = refreshing();
    h.engine.tick();
    vi.runAllTimers();
    const tickRun = h.hits()[1];
    expect(tickRun.ctx.target).toBe("executed");
    expect(signatureKey(tickRun.ctx.signature)).toBe(signatureKey(h.hits()[0].ctx.signature));
    expect(tickRun.ctx.signature.effectiveSortOrder).toBe("desc");
  });

  it("ticks skip while dirty or stale and record a missed tick", () => {
    const h = refreshing();
    const ticks: boolean[] = [];
    h.engine.onRefreshTick((paused) => ticks.push(paused));
    h.engine.markEditorDirty();
    expect(h.engine.tick()).toBe("paused");
    h.engine.clearEditorDirty();
    h.live.query = "edited";
    expect(h.engine.tick()).toBe("paused");
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    expect(h.engine.hasMissedTick()).toBe(true);
    expect(ticks).toEqual([true, true]);
  });

  it("is ineligible without an interval", () => {
    const h = makeHarness();
    expect(h.engine.requestRun("refresh")).toBe("skipped-ineligible");
  });

  it("bootstraps a guarded run of the live scope when nothing was executed, and records a miss when blocked", () => {
    const h = makeHarness({ estimateMb: 1e9 });
    h.live.refreshInterval = 10;
    h.engine.tick();
    vi.runAllTimers();
    expect(h.requests).toHaveLength(0);
    expect(h.store.meta.autoRunBlocked?.reasons).toEqual(["refresh"]);
    expect(h.engine.hasMissedTick()).toBe(true);
    expect(h.engine.tick()).toBe("paused");
  });

  it("missedTick: edit, miss a tick, Run → exactly one search, then re-arm from its completion", () => {
    const h = refreshing();
    h.live.query = "edited";
    h.engine.markEditorDirty();
    h.engine.tick();
    expect(h.engine.hasMissedTick()).toBe(true);
    h.engine.requestRun("run");
    expect(h.engine.checkRefreshResume()).toBe(false);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(2);
    expect(h.rearmRefresh).not.toHaveBeenCalled();
    h.completeLast();
    expect(h.rearmRefresh).toHaveBeenCalledTimes(1);
    expect(h.engine.hasMissedTick()).toBe(false);
    expect(h.engine.checkRefreshResume()).toBe(false);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(2);
    h.engine.tick();
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(3);
  });

  it("missedTick: the same counts hold with a phase-2 pause consumer registered", () => {
    const h = refreshing();
    let reading = true;
    const off = h.engine.registerRefreshPause(() => reading);
    h.engine.tick();
    h.engine.tick();
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    reading = false;
    expect(h.engine.checkRefreshResume()).toBe(true);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(2);
    expect(h.rearmRefresh).toHaveBeenCalledTimes(1);
    expect(h.engine.checkRefreshResume()).toBe(false);
    off();
  });

  it("a tick during an in-flight generation is deferred and runs once after it settles", () => {
    const h = refreshing();
    h.engine.requestRun("run");
    expect(h.engine.tick()).toBe("deferred");
    expect(h.engine.tick()).toBe("deferred");
    expect(h.hits()).toHaveLength(2);
    h.completeLast();
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(3);
    expect(h.engine.hasDeferredRefresh()).toBe(false);
  });

  it("a refresh never supersedes a pending trigger; the trigger replaces a pending refresh", () => {
    const h = refreshing();
    h.engine.tick();
    h.engine.requestRun("filter");
    vi.advanceTimersByTime(300);
    expect(h.hits()).toHaveLength(2);
    expect(h.hits()[1].ctx.reasons).toEqual(["filter"]);
    expect(h.engine.hasDeferredRefresh()).toBe(true);
    h.completeLast();
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(3);
    expect(h.hits()[2].ctx.reasons).toEqual(["refresh"]);
  });

  it("a page change defers a pending refresh instead of dropping it", () => {
    const h = refreshing();
    h.engine.tick();
    h.engine.requestRun("pagination");
    expect(h.engine.hasDeferredRefresh()).toBe(true);
    h.completeLast();
    vi.runAllTimers();
    expect(h.hits().map((r) => r.ctx.reason)).toEqual(["run", "pagination", "refresh"]);
  });

  it("explicit Cancel and turning the interval off clear the catch-up debt", () => {
    const h = refreshing();
    h.engine.markEditorDirty();
    h.engine.tick();
    h.engine.cancelGeneration();
    expect(h.engine.hasMissedTick()).toBe(false);
    h.engine.tick();
    expect(h.engine.hasMissedTick()).toBe(true);
    h.engine.onRefreshIntervalChanged(0);
    expect(h.engine.hasMissedTick()).toBe(false);
  });

  it("turning the interval off drops a pending refresh", () => {
    const h = refreshing();
    h.engine.tick();
    expect(h.engine.hasPendingRequest()).toBe(true);
    h.live.refreshInterval = 0;
    h.engine.onRefreshIntervalChanged(0);
    vi.runAllTimers();
    expect(h.hits()).toHaveLength(1);
    h.engine.onRefreshIntervalChanged(5);
  });

  it("a throwing pause predicate is logged and treated as not paused", () => {
    const h = refreshing();
    h.engine.registerRefreshPause(() => {
      throw new Error("predicate");
    });
    expect(h.engine.isRefreshPaused()).toBe(false);
    expect(h.log).toHaveBeenCalled();
  });
});

describe("canPersistOrShare (G1 matrix)", () => {
  it("never-run: every surface is disabled with the J7 reason", () => {
    const h = makeHarness();
    for (const surface of ["logs", "patterns", "visualize", "build"] as const) {
      expect(h.engine.canPersistOrShare(surface)).toEqual({
        ok: false,
        reason: "t:search.autoRunPersistNeedsRun",
      });
    }
  });

  it("clean: enabled; stale: disabled", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.engine.canPersistOrShare("logs", "share-link")).toEqual({ ok: true });
    h.live.query = "edited";
    expect(h.engine.canPersistOrShare("logs", "share-link").ok).toBe(false);
  });

  it("disabled while a grid generation is pending for a different signature", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.live.sortOrder = "asc";
    h.engine.requestRun("sort");
    h.live.sortOrder = "desc";
    expect(h.engine.isResultsStale()).toBe(false);
    expect(h.engine.canPersistOrShare("logs").ok).toBe(false);
  });

  it("scan mode: only the 1-D3 actions are blocked; save view and share stay enabled", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    h.completeLast();
    h.freeText.scanReason = "scan-reason";
    for (const action of [
      "create-alert",
      "add-to-dashboard",
      "search-job",
      "visualize",
      "scheduled-report",
    ] as const) {
      expect(h.engine.canPersistOrShare("logs", action)).toEqual({
        ok: false,
        reason: "scan-reason",
      });
    }
    for (const action of ["save-view", "share-link", "copy-line-link"] as const) {
      expect(h.engine.canPersistOrShare("logs", action)).toEqual({ ok: true });
    }
  });

  it("item 1 blocked applies to every action and outranks the G1 reason (AC6.1)", () => {
    const h = makeHarness();
    h.freeText.blockedReason = "blocked-reason";
    expect(h.engine.canPersistOrShare("logs", "save-view")).toEqual({
      ok: false,
      reason: "blocked-reason",
    });
    h.freeText.blockedReason = null;
    expect(h.engine.canPersistOrShare("logs", "save-view")).toEqual({
      ok: false,
      reason: "t:search.autoRunPersistNeedsRun",
    });
    h.freeText.blockedReason = "blocked-reason";
    h.engine.requestRun("run");
    h.completeLast();
    expect(h.engine.canPersistOrShare("logs", "save-view")).toEqual({
      ok: false,
      reason: "blocked-reason",
    });
  });

  it("Patterns: needs a complete extraction for the current logs signature", () => {
    const h = makeHarness({ mode: "patterns" });
    h.engine.requestRun("run");
    const gen = h.engine.currentGeneration("patterns")?.id as number;
    expect(h.engine.canPersistOrShare("patterns").ok).toBe(false);
    h.engine.recordPatternsComplete(gen);
    expect(h.engine.canPersistOrShare("patterns").ok).toBe(true);
    h.live.query = "edited";
    expect(h.engine.canPersistOrShare("patterns").ok).toBe(false);
  });

  it("Patterns: a failed extraction leaves it disabled", () => {
    const h = makeHarness({ mode: "patterns" });
    h.engine.requestRun("run");
    h.engine.recordPatternsFailure(h.engine.currentGeneration("patterns")?.id as number);
    expect(h.engine.canPersistOrShare("patterns").ok).toBe(false);
    expect(h.store.meta.runOutcome?.patterns).toBe("failed");
  });

  it("Visualize: a successful panel run enables, a config edit disables, a dirty editor disables", () => {
    const h = makeHarness({ mode: "visualize" });
    h.engine.requestRun("run");
    const gen = h.lastGen();
    expect(h.requests.map((r) => r.type)).toEqual(["visualize"]);
    const cfgSig = panelConfigSignature("panel-v1", signatureOf(h.live));
    h.engine.recordPanelComplete(gen, cfgSig);
    expect(h.engine.canPersistOrShare("visualize", "add-to-dashboard")).toEqual({ ok: true });
    expect(h.engine.canPersistOrShare("build").ok).toBe(false);
    h.state.panelConfig = "panel-v2";
    expect(h.engine.canPersistOrShare("visualize").ok).toBe(false);
    h.state.panelConfig = "panel-v1";
    h.engine.markEditorDirty();
    expect(h.engine.canPersistOrShare("visualize").ok).toBe(false);
  });

  it.each([
    ["cancelled", true],
    ["failed", false],
  ])("Visualize: a %s panel run leaves it disabled", (outcome, cancelled) => {
    const h = makeHarness({ mode: "visualize" });
    const cfgSig = panelConfigSignature("panel-v1", signatureOf(h.live));
    h.engine.requestRun("run");
    h.engine.recordPanelComplete(h.lastGen(), cfgSig);
    expect(h.engine.canPersistOrShare("visualize").ok).toBe(true);
    h.engine.requestRun("run");
    expect(h.engine.recordPanelDispatch(h.lastGen())).toBe(true);
    expect(h.engine.recordPanelFailure(h.lastGen(), cancelled)).toBe(true);
    expect(h.engine.canPersistOrShare("visualize").ok).toBe(false);
    expect(h.store.meta.runOutcome?.visualize).toBe(outcome);
  });

  it.each([
    ["cancellation", true],
    ["failure", false],
  ])(
    "Visualize: a late %s of a replaced panel run never erases the newer record",
    (_label, cancelled) => {
      const h = makeHarness({ mode: "visualize" });
      const cfgSig = panelConfigSignature("panel-v1", signatureOf(h.live));
      h.engine.requestRun("run");
      const runA = h.lastGen();
      h.engine.requestRun("run");
      const runB = h.lastGen();
      h.engine.recordPanelComplete(runB, cfgSig);
      expect(h.engine.recordPanelFailure(runA, cancelled)).toBe(false);
      expect(h.engine.canPersistOrShare("visualize").ok).toBe(true);
      expect(h.store.meta.runOutcome?.visualize).toBe("complete");
      expect(h.store.meta.executedPanel?.generation).toBe(runB);
    },
  );

  it("a panel record names the inputs the panel ran with, not later edits", () => {
    const h = makeHarness({ mode: "visualize" });
    const listener = vi.fn();
    h.engine.onExecutedRecorded(listener);
    h.live.query = "old";
    h.engine.requestRun("run");
    const gen = h.lastGen();
    h.live.query = "new";
    h.engine.recordPanelComplete(gen, "cfg");
    expect(listener.mock.calls[0][0].signature.query).toBe("old");
  });

  it("panel records need a panel generation", () => {
    const h = makeHarness();
    h.engine.requestRun("run");
    expect(h.engine.recordPanelDispatch(h.lastGen())).toBe(false);
    expect(h.engine.recordPanelComplete(h.lastGen(), "cfg")).toBe(false);
    expect(h.engine.recordPanelFailure(9999)).toBe(false);
  });

  it("a panel record from a replaced generation is ignored", () => {
    const h = makeHarness({ mode: "build" });
    h.engine.requestRun("run");
    const old = h.lastGen();
    h.engine.requestRun("run");
    expect(h.engine.recordPanelComplete(old, "cfg")).toBe(false);
  });
});

describe("pure helpers", () => {
  it("effectiveSortOrder is desc while refresh is on and the preference otherwise", () => {
    expect(effectiveSortOrder(10, "asc")).toBe("desc");
    expect(effectiveSortOrder(0, "asc")).toBe("asc");
  });

  it("setting an interval is not by itself a stale change for a desc preference", () => {
    const base: LiveInputs = {
      query: "q",
      streams: ["b", "a"],
      time: { type: "relative", period: "15m" },
      streamType: "logs",
      regions: [],
      sortOrder: "desc",
      refreshInterval: 0,
      showTransformEditor: false,
      transformContent: "fn",
    };
    expect(sameSignature(signatureOf(base), signatureOf({ ...base, refreshInterval: 10 }))).toBe(
      true,
    );
    expect(
      sameSignature(
        signatureOf({ ...base, sortOrder: "asc" }),
        signatureOf({ ...base, sortOrder: "asc", refreshInterval: 10 }),
      ),
    ).toBe(false);
    expect(signatureOf(base).streams).toEqual(["a", "b"]);
    expect(signatureOf(base).transform).toBeNull();
    expect(signatureOf({ ...base, showTransformEditor: true }).transform).toBe("fn");
    expect(sameSignature(null, signatureOf(base))).toBe(false);
  });

  it("carries freeTextScan only when given", () => {
    const sig = buildLogsSignature({
      query: "",
      sqlMode: true,
      streams: [],
      streamType: "logs",
      time: { type: "relative", period: "15m" },
      transformContent: null,
      showTransformEditor: false,
      quickMode: true,
      quickModeFields: ["b", "a"],
      refreshInterval: 0,
      sortOrder: "desc",
      definedSchemas: "all",
      freeTextScan: { app: "consented" },
    });
    expect(sig.freeTextScan).toEqual({ app: "consented" });
    expect(sig.quickModeFields).toEqual(["a", "b"]);
  });

  it("isScopeCovered handles relative and absolute windows, streams, type and regions", () => {
    const nowUs = 1_000_000 * MINUTE_US;
    const consented = scopeOf(
      buildLogsSignature({
        query: "",
        sqlMode: false,
        streams: ["a", "b"],
        streamType: "logs",
        time: { type: "relative", period: "1h" },
        transformContent: null,
        showTransformEditor: false,
        quickMode: false,
        regions: ["r1"],
        refreshInterval: 0,
        sortOrder: "desc",
        definedSchemas: "all",
      }),
    );
    const scope = (patch: Partial<typeof consented>) => ({ ...consented, ...patch });
    expect(isScopeCovered(scope({ streams: ["a"] }), consented, nowUs)).toBe(true);
    expect(isScopeCovered(scope({ streams: ["a", "c"] }), consented, nowUs)).toBe(false);
    expect(isScopeCovered(scope({ streamType: "traces" }), consented, nowUs)).toBe(false);
    expect(isScopeCovered(scope({ regions: [] }), consented, nowUs)).toBe(false);
    expect(
      isScopeCovered(scope({ time: { type: "relative", period: "30m" } }), consented, nowUs),
    ).toBe(true);
    expect(
      isScopeCovered(scope({ time: { type: "relative", period: "2h" } }), consented, nowUs),
    ).toBe(false);
    expect(
      isScopeCovered(scope({ time: { type: "relative", period: "bad" } }), consented, nowUs),
    ).toBe(false);
    expect(
      isScopeCovered(
        scope({ time: { type: "absolute", startUs: nowUs - 30 * MINUTE_US, endUs: nowUs } }),
        consented,
        nowUs,
      ),
    ).toBe(true);
    expect(
      isScopeCovered(
        scope({ time: { type: "absolute", startUs: nowUs - 90 * MINUTE_US, endUs: nowUs } }),
        consented,
        nowUs,
      ),
    ).toBe(false);
    const absolute = scope({
      time: { type: "absolute", startUs: nowUs - 60 * MINUTE_US, endUs: nowUs },
    });
    expect(
      isScopeCovered(scope({ time: { type: "relative", period: "15m" } }), absolute, nowUs),
    ).toBe(true);
    expect(
      isScopeCovered(
        scope({ time: { type: "relative", period: "15m" } }),
        absolute,
        nowUs + 60 * MINUTE_US,
      ),
    ).toBe(false);
    expect(isScopeCovered(consented, null, nowUs)).toBe(false);
  });
});
