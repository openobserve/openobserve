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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { reactive } from "vue";
import config from "@/aws-exports";
import {
  estimateSignature,
  isSuperCluster,
  readLogsSignature,
  resetLogsAutoRunForTests,
  scopeStreams,
  setAutoRunTransport,
  useLogsAutoRun,
} from "./logsAutoRun";
import useSearchConnection from "./useSearchConnection";
import { buildLogsSignature } from "./useAutoRun";
import {
  activePermalink,
  isInitOrigin,
  mintInitOrigin,
  resetPermalinkForTests,
} from "./useLogPermalink";

const { fakeStore, fakeSearchObj, sentPayloads, cancelled } = vi.hoisted(() => ({
  fakeStore: { state: { zoConfig: {} as Record<string, unknown> } },
  fakeSearchObj: { value: null as any },
  sentPayloads: [] as any[],
  cancelled: [] as string[],
}));

vi.mock("vuex", () => ({ useStore: () => fakeStore }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: { value: { name: "logs", query: {} } }, push: vi.fn() }),
}));
vi.mock("./searchState", () => ({
  searchState: () => ({
    searchObj: fakeSearchObj.value,
    notificationMsg: { value: "" },
    searchPartitionMap: {},
  }),
}));
vi.mock("./logsUtils", () => ({
  logsUtils: () => ({
    addTraceId: (id: string) => {
      const ids = fakeSearchObj.value?.data.searchRequestTraceIds;
      if (ids && !ids.includes(id)) ids.push(id);
    },
    removeTraceId: (id: string) => {
      const data = fakeSearchObj.value?.data;
      if (data)
        data.searchRequestTraceIds = data.searchRequestTraceIds.filter((x: string) => x !== id);
    },
    fnParsedSQL: vi.fn(() => ({})),
    isLimitQuery: vi.fn(() => false),
    isDistinctQuery: vi.fn(() => false),
    isWithQuery: vi.fn(() => false),
  }),
}));
vi.mock("./useHistogram", () => ({ useHistogram: () => ({}) }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));
vi.mock("@/composables/useSearchWebSocket", () => ({
  default: () => ({
    sendSearchMessageBasedOnRequestId: vi.fn(),
    closeSocketBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any) => {
      sentPayloads.push(JSON.parse(JSON.stringify(payload.queryReq)));
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: ({ trace_id }: { trace_id: string }) => {
      cancelled.push(trace_id);
    },
  }),
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/services/search", () => ({
  default: { delete_running_queries: vi.fn(() => Promise.resolve({ data: [] })) },
}));

const MINUTE_US = 60 * 1_000_000;

function makeSearchObj(overrides: Record<string, any> = {}) {
  return reactive({
    organizationIdentifier: "org1",
    loading: false,
    loadingHistogram: false,
    loadingProgressPercentage: 0,
    loadingHistogramProgressPercentage: 0,
    meta: {
      sqlMode: false,
      quickMode: false,
      liveMode: true,
      refreshInterval: 0,
      showTransformEditor: false,
      useUserDefinedSchemas: "user_defined_schema",
      logsVisualizeToggle: "logs",
      regions: [],
      clusters: [],
      ...(overrides.meta ?? {}),
    },
    data: {
      query: "",
      tempFunctionContent: "",
      datetime: { type: "relative", relativeTimePeriod: "15m" },
      stream: {
        selectedStream: ["app"],
        streamLists: [{ label: "app", value: "app" }],
        streamType: "logs",
        interestingFieldList: [],
      },
      resultGrid: { currentPage: 1, hitsSettled: true },
      searchRequestTraceIds: [],
      queryResults: { hits: [] },
      histogram: { xData: [], yData: [] },
      streamResults: { list: [] as any[] },
      ...(overrides.data ?? {}),
    },
  });
}

const statsFor = (name: string, mbPerMinute: number) => {
  const now = Date.now() * 1000;
  const span = 600 * MINUTE_US;
  return {
    name,
    stats: { doc_time_min: now - span, doc_time_max: now, storage_size: mbPerMinute * 600 },
  };
};

const run = () => useLogsAutoRun();

beforeEach(() => {
  sentPayloads.length = 0;
  cancelled.length = 0;
  fakeStore.state.zoConfig = { auto_query_enabled: true, query_on_stream_selection: true };
  fakeSearchObj.value = makeSearchObj();
  resetLogsAutoRunForTests(fakeStore as any);
});

describe("readLogsSignature (AC5.2)", () => {
  it("counts the transform only when the function editor is shown", () => {
    const obj = fakeSearchObj.value;
    obj.data.tempFunctionContent = ".x = 1";
    expect(readLogsSignature(obj).transform).toBeNull();
    obj.meta.showTransformEditor = true;
    expect(readLogsSignature(obj).transform).toBe(".x = 1");
  });

  it("counts the quick-mode field list only where it shapes the generated SQL", () => {
    const obj = fakeSearchObj.value;
    obj.meta.quickMode = true;
    obj.data.stream.interestingFieldList = ["b", "a"];
    expect(readLogsSignature(obj).quickModeFields).toEqual(["a", "b"]);
    obj.meta.sqlMode = true;
    expect(readLogsSignature(obj).quickModeFields).toEqual([]);
    expect(readLogsSignature(obj).quickMode).toBe(true);
  });

  it("records an absolute selection by its bounds and a relative one by its period", () => {
    const obj = fakeSearchObj.value;
    expect(readLogsSignature(obj).time).toEqual({ type: "relative", period: "15m" });
    obj.data.datetime = { type: "absolute", startTime: 10, endTime: 20 };
    expect(readLogsSignature(obj).time).toEqual({ type: "absolute", startUs: 10, endUs: 20 });
  });
});

describe("SQL scope rule (P1)", () => {
  it("estimates the SQL's own sources, not the selected stream", () => {
    const signature = buildLogsSignature({
      query: 'SELECT * FROM "big" JOIN "small" ON big.id = small.id',
      sqlMode: true,
      streams: ["small"],
      streamType: "logs",
      time: { type: "relative", period: "15m" },
      transformContent: null,
      showTransformEditor: false,
      quickMode: false,
      refreshInterval: 0,
      sortOrder: "desc",
      definedSchemas: "",
    });
    expect(scopeStreams(signature)).toEqual({ names: ["big", "small"], resolved: true });
    const estimate = estimateSignature(
      signature,
      [statsFor("big", 100), statsFor("small", 1)],
      Date.now() * 1000,
    );
    expect(estimate.streams.map((s) => s.name)).toEqual(["big", "small"]);
    expect(estimate.knownMb).toBeGreaterThan(1400);
  });

  it("blocks an automatic run whose SQL names an unreadable stream and sends nothing", async () => {
    fakeStore.state.zoConfig.auto_query_max_scan_mb = 1000;
    const obj = fakeSearchObj.value;
    obj.meta.sqlMode = true;
    obj.data.query = 'SELECT * FROM "secret"';
    obj.data.stream.selectedStream = ["app"];
    obj.data.streamResults.list = [statsFor("app", 1)];
    const logs = vi.fn();
    run().setExecutors({ logs });

    expect(run().request("url")).toBe("scheduled");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logs).not.toHaveBeenCalled();
    expect(obj.meta.autoRunBlocked.decision.reason).toBe("unresolved");
    expect(obj.meta.autoRunBlocked.estimate.unresolvedSources).toEqual(["secret"]);
  });
});

describe("unknown windows and the super-cluster check (H1, M5)", () => {
  const signatureFor = (time: any) =>
    buildLogsSignature({
      query: "",
      sqlMode: false,
      streams: ["app"],
      streamType: "logs",
      time,
      transformContent: null,
      showTransformEditor: false,
      quickMode: false,
      refreshInterval: 0,
      sortOrder: "desc",
      definedSchemas: "",
    });

  it("estimates a garbage absolute window or an unparseable period as unresolved", () => {
    const now = Date.now() * 1000;
    const list = [statsFor("app", 100)];
    const garbage = signatureFor({ type: "absolute", startUs: Number("abc"), endUs: now });
    expect(estimateSignature(garbage, list, now).status).toBe("unresolved");
    const bogus = signatureFor({ type: "relative", period: "bogus" });
    expect(estimateSignature(bogus, list, now).status).toBe("unresolved");
  });

  it("sizes period=24hours like the search does, not as an empty window", () => {
    const now = Date.now() * 1000;
    const estimate = estimateSignature(
      signatureFor({ type: "relative", period: "24hours" }),
      [statsFor("app", 1)],
      now,
    );
    expect(estimate.status).toBe("known");
    expect(estimate.knownMb).toBeGreaterThan(500);
  });

  it("blocks an automatic run from a garbage URL window and sends nothing", async () => {
    fakeStore.state.zoConfig.auto_query_max_scan_mb = 1000;
    const obj = fakeSearchObj.value;
    obj.data.datetime = { type: "absolute", startTime: "garbage", endTime: "garbage" };
    obj.data.streamResults.list = [statsFor("app", 1)];
    const logs = vi.fn();
    run().setExecutors({ logs });

    expect(run().request("url")).toBe("scheduled");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logs).not.toHaveBeenCalled();
    expect(obj.meta.autoRunBlocked.decision).toMatchObject({ reason: "unresolved", estimateMb: 0 });
  });

  it("treats super_cluster_enabled as a super cluster only on an enterprise build", () => {
    const enterprise = (config as any).isEnterprise;
    fakeStore.state.zoConfig.super_cluster_enabled = true;
    const signature = signatureFor({ type: "relative", period: "15m" });
    const list = [statsFor("app", 1)];
    try {
      expect(isSuperCluster()).toBe(true);
      expect(estimateSignature(signature, list, Date.now() * 1000).superCluster).toBe(true);
      (config as any).isEnterprise = "false";
      expect(isSuperCluster()).toBe(false);
      const estimate = estimateSignature(signature, list, Date.now() * 1000);
      expect(estimate.superCluster).toBe(false);
      expect(estimate.status).toBe("known");
    } finally {
      (config as any).isEnterprise = enterprise;
    }
  });
});

describe("transport binding (AC4.1, P2 records)", () => {
  const callbacks = {
    onData: vi.fn(),
    onError: vi.fn(),
    onComplete: vi.fn(),
  };

  const openGrid = () =>
    run().engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: run().readSignature(),
    });

  it("captures pendingExecution.req at the transport boundary, after the page-count extra row", () => {
    const connection = useSearchConnection((key: string) => key as any);
    const generation = openGrid();
    const queryReq: any = { query: { sql: 'select * from "app"', from: 0, size: 50 } };
    connection.getDataThroughStream(queryReq, false, callbacks, generation.id);

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].query.size).toBe(51);
    expect(fakeSearchObj.value.meta.pendingExecution.req).toEqual(sentPayloads[0]);
    expect(fakeSearchObj.value.data.resultGrid.hitsSettled).toBe(false);
  });

  it("deep-equals the dispatched payload for page N and for a SQL LIMIT … OFFSET request", () => {
    const connection = useSearchConnection((key: string) => key as any);
    const pageN = openGrid();
    connection.getDataThroughStream(
      { query: { sql: 'select * from "app"', from: 100, size: 50 } } as any,
      true,
      callbacks,
      pageN.id,
    );
    expect(fakeSearchObj.value.meta.pendingExecution.req).toEqual(sentPayloads[0]);
    expect(sentPayloads[0].query.from).toBe(100);

    const limited = openGrid();
    connection.getDataThroughStream(
      { query: { sql: 'select * from "app" LIMIT 10 OFFSET 5', from: 5, size: 10 } } as any,
      false,
      callbacks,
      limited.id,
    );
    expect(fakeSearchObj.value.meta.pendingExecution.req).toEqual(sentPayloads[1]);
    expect(sentPayloads[1].query.sql).toContain("LIMIT 10 OFFSET 5");
  });

  it("cancelling a bound pagination generation resolves its crossing as `cancelled` (4a §3.2.2)", () => {
    const obj = fakeSearchObj.value;
    obj.meta.resultGrid = {
      navigation: {
        currentRowIndex: 49,
        selectionActive: true,
        pendingPageSelection: { page: 2, position: "first", requestId: null },
      },
    };
    obj.data.resultGrid.pageRequest = null;
    obj.data.resultGrid.pageLoad = null;
    const connection = useSearchConnection((key: string) => key as any);
    const page = openGrid();
    connection.getDataThroughStream(
      { query: { sql: 'select * from "app"', from: 50, size: 50 } } as any,
      true,
      callbacks,
      page.id,
    );
    const bound = obj.meta.resultGrid.navigation.pendingPageSelection.requestId;
    expect(bound).toBe(obj.data.resultGrid.pageRequest.requestId);

    run().engine.cancelGeneration(null, { cause: "user" });

    expect(obj.data.resultGrid.pageLoad).toEqual({
      requestId: bound,
      ok: false,
      reason: "cancelled",
    });
  });

  it("sends nothing for a follow-up of a replaced generation", () => {
    const connection = useSearchConnection((key: string) => key as any);
    const old = openGrid();
    openGrid();
    fakeSearchObj.value.loadingHistogram = true;
    const payload: any = connection.buildWebSocketPayload(
      { query: { sql: "x" } } as any,
      false,
      "histogram",
    );
    payload.generationId = old.id;
    expect(connection.initializeSearchConnection(payload)).toBeNull();
    expect(sentPayloads).toHaveLength(0);
    expect(fakeSearchObj.value.loadingHistogram).toBe(false);
  });

  it("a rejected bind leaves no trace ID and restores the last search trace (M6)", () => {
    const connection = useSearchConnection((key: string) => key as any);
    const obj = fakeSearchObj.value;
    obj.data.lastSearchTraceId = "previous";
    obj.data.searchRequestTraceIds = ["previous"];
    const stale = openGrid();
    openGrid();
    connection.getDataThroughStream(
      { query: { sql: 'select * from "app"', from: 0, size: 50 } } as any,
      false,
      callbacks,
      stale.id,
    );
    expect(sentPayloads).toHaveLength(0);
    expect(obj.data.searchRequestTraceIds).toEqual(["previous"]);
    expect(obj.data.lastSearchTraceId).toBe("previous");

    const histogram: any = connection.buildWebSocketPayload(
      { query: {} } as any,
      false,
      "histogram",
    );
    histogram.generationId = stale.id;
    expect(connection.initializeSearchConnection(histogram)).toBeNull();
    expect(obj.data.searchRequestTraceIds).toEqual(["previous"]);
  });

  it.each([
    ["an unbound crossing", null],
    ["a crossing bound to an earlier request", "earlier"],
  ])("a rejected pagination bind restores the page request note, %s (M6)", (_label, bound) => {
    const connection = useSearchConnection((key: string) => key as any);
    const obj = fakeSearchObj.value;
    const pending = { page: 2, position: "first", requestId: bound };
    obj.meta.resultGrid = {
      navigation: { currentRowIndex: 49, selectionActive: true, pendingPageSelection: pending },
    };
    obj.data.resultGrid.pageRequest = { requestId: "in-flight" };
    obj.data.lastSearchTraceId = "in-flight";
    obj.data.searchRequestTraceIds = ["in-flight"];
    const stale = openGrid();
    openGrid();
    connection.getDataThroughStream(
      { query: { sql: 'select * from "app"', from: 50, size: 50 } } as any,
      true,
      callbacks,
      stale.id,
    );
    expect(sentPayloads).toHaveLength(0);
    expect(obj.data.resultGrid.pageRequest).toEqual({ requestId: "in-flight" });
    expect(obj.meta.resultGrid.navigation.pendingPageSelection).toEqual({
      page: 2,
      position: "first",
      requestId: bound,
    });
    expect(obj.data.lastSearchTraceId).toBe("in-flight");
    expect(obj.data.searchRequestTraceIds).toEqual(["in-flight"]);
  });

  it("a rejected bind keeps a page request noted after it (M6)", () => {
    const connection = useSearchConnection((key: string) => key as any);
    const obj = fakeSearchObj.value;
    obj.meta.resultGrid = {
      navigation: { currentRowIndex: 49, selectionActive: true, pendingPageSelection: null },
    };
    obj.data.resultGrid.pageRequest = null;
    const stale = openGrid();
    openGrid();
    const rejected: any = connection.buildWebSocketPayload({ query: {} } as any, true, "search");
    rejected.generationId = stale.id;
    obj.data.resultGrid.pageRequest = { requestId: "later" };
    expect(connection.initializeSearchConnection(rejected)).toBeNull();
    expect(obj.data.resultGrid.pageRequest).toEqual({ requestId: "later" });
  });

  it("drops responses of a replaced generation and keeps the new one's", () => {
    useSearchConnection((key: string) => key as any);
    const old = openGrid();
    const payloadOld = { traceId: "t-old", type: "search", generationId: old.id, queryReq: {} };
    expect(run().bindPayload(payloadOld)).toBe(true);
    const fresh = openGrid();
    const payloadNew = { traceId: "t-new", type: "search", generationId: fresh.id, queryReq: {} };
    run().bindPayload(payloadNew);

    expect(run().isPayloadCurrent(payloadOld)).toBe(false);
    expect(run().isPayloadCurrent(payloadNew)).toBe(true);
    expect(cancelled).toContain("t-old");
  });

  it("keeps a handed-over histogram current under the page generation that took it", () => {
    const full = openGrid();
    const hist = { traceId: "t-hist", type: "histogram", generationId: full.id };
    run().bindPayload(hist);
    const page = run().engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "pagination",
      op: "page",
      signature: run().readSignature(),
    });
    run().adoptHandOver({ generation: page } as any);

    expect(run().isPayloadCurrent(hist)).toBe(true);
    expect(cancelled).not.toContain("t-hist");
  });

  it("settles a generation only after its hits and a launched histogram both finish", async () => {
    const generation = openGrid();
    const hits = { traceId: "t-hits", type: "search", generationId: generation.id, queryReq: {} };
    run().bindPayload(hits);
    run().onPayloadComplete(hits);
    let launched!: () => void;
    run().trackLaunch(generation.id, new Promise<void>((resolve) => (launched = resolve)));
    run().finishPayload(hits);
    expect(generation.settled).toBe(false);

    const hist = { traceId: "t-h", type: "histogram", generationId: generation.id };
    run().bindPayload(hist);
    vi.useFakeTimers();
    try {
      launched();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    expect(generation.settled).toBe(false);

    run().finishPayload(hist);
    expect(generation.settled).toBe(true);
    expect(fakeSearchObj.value.meta.executed).toMatchObject({ complete: true });
  });

  it("routes server cancel through the registered ENT transport with the generation's org", async () => {
    const serverCancel = vi.fn(() => Promise.resolve());
    setAutoRunTransport({ abortTrace: vi.fn(), serverCancel });
    const generation = openGrid();
    run().bindPayload({ traceId: "t1", type: "search", generationId: generation.id, queryReq: {} });
    fakeSearchObj.value.organizationIdentifier = "org2";
    run().engine.cancelGeneration(null, { cause: "user" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(serverCancel).toHaveBeenCalledWith("org1", ["t1"]);
  });
});

describe("4c line link: user refinements end the permalink, init requests carry its origin", () => {
  beforeEach(() => resetPermalinkForTests());

  it.each(["stream", "filter", "function", "zoom", "compare"] as const)(
    "a %s refinement ends an open permalink even when it runs nothing",
    (reason) => {
      const token = mintInitOrigin().token;
      activePermalink.value = {
        org: "default",
        link: { stream: "app", ts: 1 },
        generation: 1,
        multiStream: false,
        regions: [],
        clusters: [],
        outcome: null,
      };
      fakeSearchObj.value.data.stream.selectedStream = [];
      run().request(reason);
      expect(activePermalink.value).toBeNull();
      expect(isInitOrigin(token)).toBe(false);
    },
  );

  it("an initial-load request keeps the token and hands it to the executor", async () => {
    const token = mintInitOrigin().token;
    const logs = vi.fn();
    run().setExecutors({ logs });
    expect(run().request("url", { origin: token })).toBe("scheduled");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0][0].origin).toBe(token);
    expect(isInitOrigin(token)).toBe(true);
  });
});

describe("refinement de-duplication and search-around", () => {
  it("does not re-run a refinement whose scope equals the executed record", () => {
    const signature = run().readSignature();
    fakeSearchObj.value.meta.executed = { generation: 1, signature, req: {}, complete: true };
    expect(run().request("time")).toBe("unchanged");
    fakeSearchObj.value.data.datetime = { type: "relative", relativeTimePeriod: "1h" };
    expect(run().request("time")).toBe("scheduled");
  });

  it("locks the grid for search-around until the next grid dispatch", () => {
    run().invalidateExecuted("search-around");
    expect(run().searchAroundActive()).toBe(true);
    expect(run().persistReason("logs")).toBeTruthy();
    const generation = run().engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: run().readSignature(),
    });
    run().bindPayload({ traceId: "t", type: "search", generationId: generation.id, queryReq: {} });
    expect(run().searchAroundActive()).toBe(false);
  });

  it("keeps the shown rows when search-around invalidates the record", () => {
    fakeSearchObj.value.data.queryResults = { hits: [{ a: 1 }] };
    run().invalidateExecuted("search-around");
    expect(fakeSearchObj.value.data.queryResults.hits).toHaveLength(1);
    run().invalidateExecuted("stream");
    expect(fakeSearchObj.value.data.queryResults.hits).toHaveLength(0);
  });

  it("patches the executed record when the server moves the window", () => {
    const generation = run().engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: run().readSignature(),
    });
    run().bindPayload({
      traceId: "t",
      type: "search",
      generationId: generation.id,
      queryReq: { query: { start_time: 1, end_time: 2 } },
    });
    run().recordWindowMove(generation.id, { startUs: 100, endUs: 200 });
    expect(fakeSearchObj.value.meta.pendingExecution.signature.time).toEqual({
      type: "absolute",
      startUs: 100,
      endUs: 200,
    });
    expect(fakeSearchObj.value.meta.pendingExecution.req.query).toMatchObject({
      start_time: 100,
      end_time: 200,
    });
  });
});

describe("panel records for Visualize and Build (J7)", () => {
  it("publishes a panel record only after the panel's load starts and ends without errors", () => {
    run().setPanelConfigReader(() => ({ type: "bar" }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "visualize";
    const id = run().openPanelRun();
    run().panelLoadingChanged(false, false);
    expect(fakeSearchObj.value.meta.executedPanel).toBeNull();
    run().panelLoadingChanged(true, false);
    run().panelLoadingChanged(false, false);
    expect(fakeSearchObj.value.meta.executedPanel).toMatchObject({
      surface: "visualize",
      generation: id,
      complete: true,
    });
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeNull();
  });

  it("never publishes a failed or cancelled panel run", () => {
    run().setPanelConfigReader(() => ({ type: "bar" }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "build";
    run().openPanelRun();
    run().panelLoadingChanged(true, false);
    run().markPanelFailed();
    run().panelLoadingChanged(false, false);
    expect(fakeSearchObj.value.meta.executedPanel).toBeNull();

    run().openPanelRun();
    run().panelLoadingChanged(true, false);
    run().engine.cancelGeneration(null, { cause: "user" });
    run().panelLoadingChanged(false, false);
    expect(fakeSearchObj.value.meta.executedPanel).toBeNull();
    expect(run().persistReason("build", "add-to-dashboard")).toBeTruthy();
  });

  it("certifies the config the panel loaded, not a query edited while it was loading (F2)", () => {
    let query = "SELECT * FROM a";
    run().setPanelConfigReader(() => ({ type: "bar", queries: [{ query }] }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "build";
    run().openPanelRun();
    run().panelLoadingChanged(true, false);
    query = "SELECT * FROM b";
    run().panelLoadingChanged(false, false);
    expect(run().persistReason("build", "add-to-dashboard")).toBeTruthy();
    query = "SELECT * FROM a";
    expect(run().persistReason("build", "add-to-dashboard")).toBeNull();
  });

  it("certifies the config frozen at dispatch, even when it changes before loading starts (F2)", () => {
    let query = "SELECT * FROM a";
    run().setPanelConfigReader(() => ({ type: "bar", queries: [{ query }] }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "visualize";
    const id = run().openPanelRun();
    run().markPanelDispatched(id);
    query = "SELECT * FROM b";
    run().panelLoadingChanged(true, false);
    run().panelLoadingChanged(false, false);
    expect(fakeSearchObj.value.meta.executedPanel).toMatchObject({ generation: id });
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeTruthy();
    query = "SELECT * FROM a";
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeNull();
  });

  it("ignores a dispatch mark for a generation that is no longer the panel run", () => {
    let query = "SELECT * FROM a";
    run().setPanelConfigReader(() => ({ type: "bar", queries: [{ query }] }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "visualize";
    const stale = run().openPanelRun();
    run().openPanelRun();
    run().markPanelDispatched(stale);
    query = "SELECT * FROM b";
    run().panelLoadingChanged(true, false);
    run().panelLoadingChanged(false, false);
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeNull();
  });

  it("disables Add to dashboard again once the panel config changes", () => {
    let type = "bar";
    run().setPanelConfigReader(() => ({ type }));
    fakeSearchObj.value.meta.logsVisualizeToggle = "visualize";
    run().openPanelRun();
    run().panelLoadingChanged(true, false);
    run().panelLoadingChanged(false, false);
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeNull();
    type = "line";
    expect(run().persistReason("visualize", "add-to-dashboard")).toBeTruthy();
  });
});

describe("item 1: scan consent in the signature, the Stop guard and G1 inputs", () => {
  it("adds freeTextScan to the signature only once consent exists", () => {
    expect("freeTextScan" in readLogsSignature(fakeSearchObj.value)).toBe(false);
    fakeSearchObj.value.meta.freeTextScan = { app: { fields: ["msg_text"] } };
    expect(readLogsSignature(fakeSearchObj.value).freeTextScan).toEqual({
      app: { fields: ["msg_text"] },
    });
  });

  it("drops every response dispatched before Stop, histogram included, and clears consent", () => {
    fakeSearchObj.value.meta.freeTextScan = { app: { fields: ["msg_text"] } };
    const generation = run().engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: run().readSignature(),
    });
    const hits = { traceId: "t-scan", type: "search", generationId: generation.id, queryReq: {} };
    const histogram = { traceId: "t-scan-h", type: "histogram", generationId: generation.id };
    run().bindPayload(hits);
    run().bindPayload(histogram);
    fakeSearchObj.value.data.queryResults = { hits: [{ a: 1 }] };

    run().stopFreeTextScan("app");

    expect(run().isPayloadCurrent(hits)).toBe(false);
    expect(run().isPayloadCurrent(histogram)).toBe(false);
    expect(fakeSearchObj.value.meta.freeTextScan).toEqual({});
    expect(fakeSearchObj.value.data.queryResults.hits).toEqual([]);
    expect(fakeSearchObj.value.meta.executed).toBeNull();
  });

  it("re-runs the remaining arms explicitly after Stop on one stream of a multi-stream search", async () => {
    fakeSearchObj.value.data.stream.selectedStream = ["app", "raw"];
    fakeSearchObj.value.meta.freeTextScan = { raw: { fields: ["msg_text"] } };
    const logs = vi.fn();
    run().setExecutors({ logs });

    run().stopFreeTextScan("raw");

    await vi.waitFor(() => expect(logs).toHaveBeenCalledTimes(1));
    expect(logs.mock.calls[0][0]).toMatchObject({ kind: "explicit", origin: "scan-stop" });
    expect(fakeSearchObj.value.meta.freeTextScan).toEqual({});
  });

  it("gives the blocked reason for every persist and share action", () => {
    fakeSearchObj.value.data.freeTextBlocked = {
      streams: ["app"],
      plan: { kind: "sql", filter: "" },
    };
    expect(String(run().persistReason("logs", "save-view"))).toContain(
      "Choose how to search text first",
    );
    expect(String(run().persistReason("logs", "create-alert"))).toContain(
      "Choose how to search text first",
    );
  });
});

describe("recent searches: settled runs", () => {
  const dispatch = (reason: "run" | "refresh") => {
    let generation: { id: number } | null = null;
    run().setExecutors({
      logs: (ctx: { generation: { id: number } }) => {
        generation = ctx.generation;
      },
    });
    run().engine.requestRun(reason);
    return generation as unknown as { id: number };
  };
  const hitsOf = (generationId: number, extra: Record<string, unknown> = {}) => ({
    traceId: "t-hits",
    type: "search",
    generationId,
    queryReq: { query: { start_time: 10, end_time: 20 } },
    ...extra,
  });

  it("reports the first page of a run with its reasons and request window", () => {
    const settled = vi.fn();
    run().onRunSettled(settled);
    const hits = hitsOf(dispatch("run").id);
    run().bindPayload(hits);
    run().onPayloadComplete(hits);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0][0]).toMatchObject({
      reasons: ["run"],
      startUs: 10,
      endUs: 20,
      partial: false,
      error: null,
    });
  });

  it("reports a failed search with its error", () => {
    const settled = vi.fn();
    run().onRunSettled(settled);
    const hits = hitsOf(dispatch("run").id);
    run().bindPayload(hits);
    run().onPayloadError(hits, { code: 20001, message: "syntax" });
    expect(settled.mock.calls[0][0].error).toEqual({ code: 20001, message: "syntax" });
  });

  it("never reports a page fetch, a histogram or a run after unsubscribing", () => {
    const settled = vi.fn();
    const stop = run().onRunSettled(settled);
    const id = dispatch("run").id;
    const page = hitsOf(id, { isPagination: true });
    run().bindPayload(page);
    run().onPayloadComplete(page);
    run().onPayloadComplete({ traceId: "t-h", type: "histogram", generationId: id });
    expect(settled).not.toHaveBeenCalled();

    stop();
    const hits = hitsOf(dispatch("run").id);
    run().bindPayload(hits);
    run().onPayloadComplete(hits);
    expect(settled).not.toHaveBeenCalled();
  });
});
