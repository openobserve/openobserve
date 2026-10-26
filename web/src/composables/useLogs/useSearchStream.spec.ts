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

import { describe, it, expect, vi, beforeEach } from "vitest";
import analytics from "@/services/product_analytics";
import { createSuggestTracker } from "@/utils/query/editorSuggestStats";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";

const { searchObj, connection, query } = vi.hoisted(() => ({
  searchObj: {
    loading: true,
    loadingProgressPercentage: 50,
    loadingHistogram: false,
    loadingHistogramProgressPercentage: 0,
    meta: { refreshInterval: 0, clearCache: false } as any,
    data: {} as any,
  },
  connection: {
    getDataThroughStream: vi.fn(),
    cleanupConnection: vi.fn(),
    buildWebSocketPayload: vi.fn(),
    initializeSearchConnection: vi.fn(),
  },
  query: { req: { query: {} } as unknown },
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj, resetQueryData: vi.fn() }),
}));
vi.mock("@/composables/useLogs/logsUtils", () => ({ logsUtils: () => ({ addTraceId: vi.fn() }) }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));
vi.mock("@/composables/useLogs/useSearchQuery", () => ({
  default: () => ({ getQueryReq: () => query.req }),
}));
vi.mock("@/composables/useLogs/useSearchConnection", () => ({ default: () => connection }));
vi.mock("@/composables/useLogs/useSearchResponseHandler", () => ({ default: () => ({}) }));
vi.mock("@/composables/useLogs/useSearchHistogramManager", () => ({
  default: () => ({ processHistogramRequest: vi.fn() }),
}));
vi.mock("@/composables/useLogs/useSearchPagination", () => ({ default: () => ({}) }));

const completeSearch = (payload: object) => {
  useSearchStream((key: string) => key).getDataThroughStream(false);
  const { onComplete } = connection.getDataThroughStream.mock.calls.at(-1)![2];
  onComplete({ traceId: "t1", queryReq: {}, ...payload });
};

describe("useSearchStream — logs_search_completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchObj.meta.refreshInterval = 0;
    searchObj.data.queryResults = { hits: [{ a: 1 }, { a: 2 }, { a: 3 }], total: 500 };
  });

  it("tracks a completed search with the rows it returned", () => {
    completeSearch({ type: "search", isPagination: false });
    expect(analytics.track).toHaveBeenCalledWith("logs_search_completed", {
      hits: 3,
      empty: false,
    });
  });

  it("marks a search that returned no rows as empty", () => {
    searchObj.data.queryResults = { hits: [] };
    completeSearch({ type: "search", isPagination: false });
    expect(analytics.track).toHaveBeenCalledWith("logs_search_completed", {
      hits: 0,
      empty: true,
    });
  });

  it("treats missing hits as an empty search", () => {
    searchObj.data.queryResults = {};
    completeSearch({ type: "search", isPagination: false });
    expect(analytics.track).toHaveBeenCalledWith("logs_search_completed", {
      hits: 0,
      empty: true,
    });
  });

  it("does not track live-mode auto-refresh ticks", () => {
    searchObj.meta.refreshInterval = 10;
    completeSearch({ type: "search", isPagination: false });
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("does not track pagination or histogram completions", () => {
    completeSearch({ type: "search", isPagination: true });
    completeSearch({ type: "histogram", isPagination: false });
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("sends the editor suggest summary right after it, once per run", () => {
    const tracker = createSuggestTracker(
      "logs",
      () => "sql",
      () => "automatic",
    );
    tracker.offered({ triggerKind: 1, chained: true, lanes: ["operator"], rows: 3 });
    completeSearch({ type: "search", isPagination: false });
    const events = vi.mocked(analytics.track).mock.calls.map((c) => c[0]);
    expect(events).toEqual(["logs_search_completed", "editor_suggest_summary"]);
    expect(vi.mocked(analytics.track).mock.calls[1][1]).toMatchObject({
      surface: "logs",
      mode: "automatic",
      chain_shown: 1,
    });
    completeSearch({ type: "search", isPagination: false });
    expect(vi.mocked(analytics.track).mock.calls.map((c) => c[0])).toEqual([
      "logs_search_completed",
      "editor_suggest_summary",
      "logs_search_completed",
    ]);
  });
});

describe("useSearchStream — page crossing signals (4a §3.2.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.req = { query: {} };
    searchObj.meta.showDetailTab = true;
    searchObj.meta.resultGrid = {
      navigation: { currentRowIndex: 3, selectionActive: true, pendingPageSelection: null },
    };
    searchObj.data.resultGrid = { pageRequest: null, pageLoad: null };
  });

  it("writes `done` for the pagination search's own completion, with its traceId", () => {
    completeSearch({ type: "search", isPagination: true, traceId: "page-2" });
    expect(searchObj.data.resultGrid.pageLoad).toEqual({
      requestId: "page-2",
      ok: true,
      reason: "done",
    });
  });

  it("histogram, pageCount and non-pagination completions write nothing", () => {
    completeSearch({ type: "histogram", isPagination: true, traceId: "h" });
    completeSearch({ type: "pageCount", isPagination: true, traceId: "c" });
    completeSearch({ type: "search", isPagination: false, traceId: "s" });
    expect(searchObj.data.resultGrid.pageLoad).toBeNull();
  });

  it("a pagination query that builds to null fails the pending crossing at once (AC2.12)", () => {
    searchObj.meta.resultGrid.navigation.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    query.req = null;
    useSearchStream((key: string) => key).getDataThroughStream(true);
    expect(connection.getDataThroughStream).not.toHaveBeenCalled();
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();
    expect(searchObj.meta.showDetailTab).toBe(false);
  });

  it("registers no reset callback, since no transport dispatches one", () => {
    useSearchStream((key: string) => key).getDataThroughStream(false);
    const callbacks = connection.getDataThroughStream.mock.calls.at(-1)![2];
    expect(Object.keys(callbacks).sort()).toEqual(["onComplete", "onData", "onError"]);
  });

  it("a throw while dispatching a page fails the crossing quietly, since a toast is already shown", () => {
    searchObj.meta.resultGrid.navigation.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    connection.getDataThroughStream.mockImplementationOnce(() => {
      throw new Error("init");
    });
    useSearchStream((key: string) => key).getDataThroughStream(true);
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();
  });
});
