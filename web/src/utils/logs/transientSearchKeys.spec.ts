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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mergeDeep } from "@/utils/queryUtils";
import {
  ITEM2_TRANSIENT_KEYS,
  TRANSIENT_SEARCH_KEYS,
  applySearchSnapshot,
  deletePath,
  getPath,
  hasPath,
  normaliseOnSave,
  prepareSearchForSave,
  registerTransientSearchKeys,
  resetTransient,
  setPath,
  stripTransient,
  unregisterTransientSearchKey,
  type PlainObject,
} from "./transientSearchKeys";
import {
  buildLogsSignature,
  createAutoRun,
  type AutoRunStore,
  type LogsSignature,
} from "@/composables/useLogs/useAutoRun";
import type { ScanEstimate } from "./estimateScanMb";

const executedRecord = {
  generation: 7,
  signature: { query: "old" },
  req: { query: { sql: "select 1" } },
  complete: true,
};

function liveSearchObj(liveMode: boolean): PlainObject {
  return {
    organizationIdentifier: "org1",
    meta: {
      liveMode,
      sqlMode: false,
      executed: { ...executedRecord },
      pendingExecution: null,
      executedPatterns: { generation: 3, signature: {}, complete: true },
      executedPanel: { surface: "visualize", configSignature: "x", generation: 4, complete: true },
      autoRunBlocked: { reason: "url" },
      consentedScope: { streams: ["a"] },
      runPending: true,
      runOutcome: { logs: "complete" },
      editorDirty: true,
      nlDetected: true,
      resultGrid: { sortOrder: "asc" },
    },
    data: {
      query: "level='error'",
      customDownloadQueryObj: { query: { sql: "select *", from: 0, size: 50 } },
      resultGrid: { currentPage: 1 },
    },
  };
}

// Mirrors the two apply sites in SearchBar.vue: hooks wrapped around the existing mergeDeep.
function applyView(target: PlainObject, view: PlainObject): PlainObject {
  return applySearchSnapshot(target, view, mergeDeep);
}

const REPLACE_KEY = {
  path: "meta.freeTextScan",
  mode: "replace" as const,
  owner: "item1",
  defaultValue: () => ({}),
};

afterEach(() => {
  unregisterTransientSearchKey("meta.freeTextScan");
  unregisterTransientSearchKey("meta.compare");
});

describe("registry", () => {
  it("registers item 2's keys with their modes", () => {
    const modes = Object.fromEntries(TRANSIENT_SEARCH_KEYS.map((k) => [k.path, k.mode]));
    expect(modes["meta.liveMode"]).toBe("strip-only");
    expect(modes["data.customDownloadQueryObj"]).toBe("reset");
    for (const path of [
      "meta.executed",
      "meta.pendingExecution",
      "meta.lastRunAttempt",
      "meta.executedPatterns",
      "meta.executedPanel",
      "meta.autoRunBlocked",
      "meta.consentedScope",
      "meta.editorDirty",
      "meta.nlDetected",
    ]) {
      expect(modes[path]).toBe("reset");
    }
    expect(ITEM2_TRANSIENT_KEYS.every((k) => k.owner === "item2")).toBe(true);
  });

  it("registers item 4a's drawer and crossing keys as reset keys", () => {
    const entries = TRANSIENT_SEARCH_KEYS.filter((k) => k.owner === "item4a");
    expect(Object.fromEntries(entries.map((k) => [k.path, k.mode]))).toEqual({
      "meta.showDetailTab": "reset",
      "meta.resultGrid.navigation.currentRowIndex": "reset",
      "meta.resultGrid.navigation.selectionActive": "reset",
      "meta.resultGrid.navigation.pendingPageSelection": "reset",
      "data.resultGrid.pageRequest": "reset",
      "data.resultGrid.pageLoad": "reset",
      "data.resultGrid.hitsSettled": "reset",
    });
  });

  it("a view saved with the drawer open neither stores nor reopens it", () => {
    const live = {
      meta: {
        showDetailTab: true,
        resultGrid: {
          rowsPerPage: 50,
          navigation: { currentRowIndex: 7, selectionActive: true, pendingPageSelection: null },
        },
      },
      data: { resultGrid: { currentPage: 2, pageRequest: { requestId: "t" }, hitsSettled: false } },
    };
    const saved = prepareSearchForSave(JSON.parse(JSON.stringify(live)), live);
    expect(saved.meta.showDetailTab).toBeUndefined();
    expect(saved.meta.resultGrid).toEqual({ rowsPerPage: 50, navigation: {} });
    expect(saved.data.resultGrid).toEqual({ currentPage: 2 });

    const target = JSON.parse(JSON.stringify(live));
    resetTransient(target);
    expect(target.meta.showDetailTab).toBe(false);
    expect(target.meta.resultGrid.navigation).toEqual({
      currentRowIndex: null,
      selectionActive: false,
      pendingPageSelection: null,
    });
    expect(target.data.resultGrid.hitsSettled).toBe(true);
  });

  it("replaces an entry registered twice under the same path and unregisters it", () => {
    const before = TRANSIENT_SEARCH_KEYS.length;
    const undo = registerTransientSearchKeys([REPLACE_KEY]);
    registerTransientSearchKeys([{ ...REPLACE_KEY, owner: "item1-again" }]);
    expect(TRANSIENT_SEARCH_KEYS.length).toBe(before + 1);
    expect(TRANSIENT_SEARCH_KEYS.find((k) => k.path === "meta.freeTextScan")?.owner).toBe(
      "item1-again",
    );
    undo();
    expect(TRANSIENT_SEARCH_KEYS.length).toBe(before);
  });

  it("path helpers create, read and delete nested keys", () => {
    const obj: PlainObject = {};
    setPath(obj, "a.b.c", 1);
    expect(getPath(obj, "a.b.c")).toBe(1);
    expect(hasPath(obj, "a.b.c")).toBe(true);
    deletePath(obj, "a.b.c");
    expect(hasPath(obj, "a.b.c")).toBe(false);
    expect(getPath(obj, "x.y")).toBeUndefined();
    deletePath(obj, "x.y");
  });
});

describe("save hook (getSearchObj)", () => {
  it("the validation-blocked Run baseline is stripped on save and reset on restore", () => {
    const live = liveSearchObj(true);
    const attempt = { generation: 8, signature: { query: "nosuch=1" } };
    setPath(live, "meta.lastRunAttempt", attempt);
    const saved = prepareSearchForSave(JSON.parse(JSON.stringify(live)), live);
    expect(hasPath(saved, "meta.lastRunAttempt")).toBe(false);
    applyView(live, { meta: { lastRunAttempt: attempt } });
    expect(getPath(live, "meta.lastRunAttempt")).toBeNull();
    setPath(live, "meta.lastRunAttempt", attempt);
    resetTransient(live);
    expect(getPath(live, "meta.lastRunAttempt")).toBeNull();
  });

  it("cancellation is stripped on save and cleared on view apply and snapshot restore", () => {
    const live = liveSearchObj(true);
    setPath(live, "meta.runCancelled", { logs: true });
    const saved = prepareSearchForSave(JSON.parse(JSON.stringify(live)), live);
    expect(hasPath(saved, "meta.runCancelled")).toBe(false);
    applyView(live, { meta: { runCancelled: { logs: true } } });
    expect(getPath(live, "meta.runCancelled")).toEqual({});
    setPath(live, "meta.runCancelled", { logs: true });
    resetTransient(live);
    expect(getPath(live, "meta.runCancelled")).toEqual({});
  });

  it("strips every reset and strip-only key and keeps replace keys and other state", () => {
    registerTransientSearchKeys([REPLACE_KEY]);
    const live = liveSearchObj(true);
    setPath(live, "meta.freeTextScan", { app: "consented" });
    const clone = prepareSearchForSave(JSON.parse(JSON.stringify(live)), live);
    for (const entry of ITEM2_TRANSIENT_KEYS) expect(hasPath(clone, entry.path)).toBe(false);
    expect(getPath(clone, "meta.freeTextScan")).toEqual({ app: "consented" });
    expect(getPath(clone, "data.query")).toBe("level='error'");
    expect(getPath(clone, "meta.resultGrid.sortOrder")).toBe("asc");
  });

  it("runs normaliseOnSave after the strip, so a view saved during a comparison reopens in Search mode", () => {
    registerTransientSearchKeys([
      {
        path: "meta.compare",
        mode: "reset",
        owner: "item4b",
        defaultValue: () => null,
        normaliseOnSave: (clone, liveObj) => {
          if (getPath(liveObj, "meta.compare")) setPath(clone, "meta.logsVisualizeToggle", "logs");
        },
      },
    ]);
    const live = liveSearchObj(true);
    setPath(live, "meta.compare", { baseline: "rest" });
    setPath(live, "meta.logsVisualizeToggle", "drilldown");
    const saved = prepareSearchForSave(JSON.parse(JSON.stringify(live)), live);
    expect(hasPath(saved, "meta.compare")).toBe(false);
    expect(getPath(saved, "meta.logsVisualizeToggle")).toBe("logs");

    const target = liveSearchObj(true);
    setPath(target, "meta.compare", { baseline: "other" });
    applyView(target, saved);
    expect(getPath(target, "meta.logsVisualizeToggle")).toBe("logs");
    expect(getPath(target, "meta.compare")).toBeNull();
  });

  it("normaliseOnSave alone leaves the clone untouched when no entry has a normaliser", () => {
    const clone = { meta: { a: 1 } };
    expect(normaliseOnSave(clone, {})).toEqual({ meta: { a: 1 } });
  });
});

describe("apply hook (both mergeDeep sites)", () => {
  it("strips strip-only keys from the incoming view before the merge", () => {
    const incoming = { meta: { liveMode: true, sqlMode: true } };
    const stripped = stripTransient(JSON.parse(JSON.stringify(incoming)), "strip-only");
    expect(stripped).toEqual({ meta: { sqlMode: true } });
  });

  it("resets reset keys after the merge, whatever the view carried", () => {
    const target = liveSearchObj(true);
    const view = {
      meta: {
        executed: { generation: 99, signature: { query: "other" }, req: {}, complete: true },
        autoRunBlocked: { reason: "url" },
        editorDirty: true,
        nlDetected: true,
      },
      data: { query: "status=500" },
    };
    applyView(target, view);
    expect(getPath(target, "meta.executed")).toBeNull();
    expect(getPath(target, "meta.autoRunBlocked")).toBeNull();
    expect(getPath(target, "meta.consentedScope")).toBeNull();
    expect(getPath(target, "meta.editorDirty")).toBe(false);
    expect(getPath(target, "meta.nlDetected")).toBe(false);
    expect(getPath(target, "meta.runPending")).toBe(false);
    expect(getPath(target, "meta.runOutcome")).toEqual({});
    expect(getPath(target, "data.query")).toBe("status=500");
  });

  it("replaces a replace key with the incoming value instead of merging into it", () => {
    registerTransientSearchKeys([REPLACE_KEY]);
    const target = liveSearchObj(true);
    setPath(target, "meta.freeTextScan", { a: { consent: true } });
    applyView(target, { meta: { freeTextScan: { b: { consent: true } } } });
    expect(getPath(target, "meta.freeTextScan")).toEqual({ b: { consent: true } });
  });

  it("sets a replace key to its default when an older view lacks it", () => {
    registerTransientSearchKeys([REPLACE_KEY]);
    const target = liveSearchObj(true);
    setPath(target, "meta.freeTextScan", { a: { consent: true } });
    applyView(target, { meta: { sqlMode: false } });
    expect(getPath(target, "meta.freeTextScan")).toEqual({});
  });

  it("does not mutate the incoming view", () => {
    const view = { meta: { liveMode: true } };
    applyView(liveSearchObj(false), view);
    expect(view).toEqual({ meta: { liveMode: true } });
  });

  it("neutralises the leaked customDownloadQueryObj of a view saved before this change", () => {
    const target = liveSearchObj(true);
    deletePath(target, "data.customDownloadQueryObj");
    applyView(target, {
      data: { customDownloadQueryObj: { query: { sql: "select * from old" } } },
    });
    expect(hasPath(target, "data.customDownloadQueryObj")).toBe(false);
  });
});

describe("meta.liveMode survives a view apply", () => {
  it("keeps the default-on value of unset storage when the view says false", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const unsetDefault = localStorage.getItem("oo_toggle_auto_run") === null;
    const target = liveSearchObj(unsetDefault);
    applyView(target, { meta: { liveMode: false } });
    expect(getPath(target, "meta.liveMode")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("keeps a toggle changed during the session when the view says otherwise", () => {
    const target = liveSearchObj(true);
    setPath(target, "meta.liveMode", false);
    applyView(target, { meta: { liveMode: true } });
    expect(getPath(target, "meta.liveMode")).toBe(false);
  });

  it("is never reset by the store-snapshot restore", () => {
    registerTransientSearchKeys([REPLACE_KEY]);
    const target = liveSearchObj(false);
    setPath(target, "meta.freeTextScan", { a: 1 });
    resetTransient(target);
    expect(getPath(target, "meta.liveMode")).toBe(false);
    expect(getPath(target, "meta.executed")).toBeNull();
    expect(getPath(target, "meta.freeTextScan")).toEqual({ a: 1 });
  });
});

describe("an old view leaves stale state and Auto Run unchanged", () => {
  const signatureFor = (query: string): LogsSignature =>
    buildLogsSignature({
      query,
      sqlMode: false,
      streams: ["app"],
      streamType: "logs",
      time: { type: "relative", period: "15m" },
      transformContent: null,
      showTransformEditor: false,
      quickMode: false,
      refreshInterval: 0,
      sortOrder: "desc",
      definedSchemas: "user_defined_schema",
    });

  function engineOver(searchObj: PlainObject) {
    const store = searchObj as unknown as AutoRunStore;
    const known: ScanEstimate = {
      status: "known",
      knownMb: 1,
      streams: [],
      unknownStreams: [],
      unresolvedSources: [],
      superCluster: false,
      window: { startUs: 0, endUs: 1 },
    };
    return createAutoRun({
      getConfig: () => ({ auto_query_enabled: true, auto_query_max_scan_mb: 100 }),
      store,
      readSignature: () => signatureFor(String(getPath(searchObj, "data.query"))),
      getMode: () => "logs",
      getOrgId: () => "org1",
      estimate: () => known,
      executors: { logs: vi.fn(), patterns: vi.fn(), histogram: vi.fn(), visualize: vi.fn() },
      abortTrace: vi.fn(),
    });
  }

  it.each([
    ["an old view carrying liveMode, executed and customDownloadQueryObj", true],
    ["a new view saved through the save hook", false],
  ])("%s", (_label, legacy) => {
    const live = liveSearchObj(false);
    setPath(live, "meta.executed", null);
    setPath(live, "meta.editorDirty", false);
    setPath(live, "meta.nlDetected", false);
    const engine = engineOver(live);
    engine.requestRun("run");
    const gen = engine.currentGeneration();
    engine.recordDispatch(gen?.id as number, { req: { query: { sql: "x" } } });
    engine.recordComplete(gen?.id as number);
    const before = { stale: engine.isResultsStale(), active: engine.isAutoRunActive() };
    expect(before).toEqual({ stale: false, active: false });

    const savedFrom = liveSearchObj(true);
    setPath(savedFrom, "meta.executed", {
      generation: 1,
      signature: signatureFor("other"),
      req: {},
      complete: true,
    });
    const view = legacy
      ? JSON.parse(JSON.stringify(savedFrom))
      : prepareSearchForSave(JSON.parse(JSON.stringify(savedFrom)), savedFrom);
    setPath(view, "data.query", "level='error'");
    applyView(live, view);

    expect(engine.isAutoRunActive()).toBe(before.active);
    expect(getPath(live, "meta.liveMode")).toBe(false);
    expect(engine.isResultsStale()).toBe(false);
    expect(hasPath(live, "data.customDownloadQueryObj")).toBe(false);
  });

  it("control: a bare mergeDeep of the old view would flip both", () => {
    const live = liveSearchObj(false);
    setPath(live, "meta.executed", null);
    setPath(live, "meta.editorDirty", false);
    setPath(live, "meta.nlDetected", false);
    const engine = engineOver(live);
    const savedFrom = liveSearchObj(true);
    setPath(savedFrom, "meta.executed", {
      generation: 1,
      signature: signatureFor("other"),
      req: {},
      complete: true,
    });
    setPath(savedFrom, "meta.editorDirty", false);
    setPath(savedFrom, "meta.nlDetected", false);
    mergeDeep(live, JSON.parse(JSON.stringify(savedFrom)));
    expect(engine.isAutoRunActive()).toBe(true);
    expect(engine.isResultsStale()).toBe(true);
  });
});
