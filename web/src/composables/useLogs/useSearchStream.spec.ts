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
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { notePageRequest } from "@/composables/useLogs/logsRowNav";

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
  });

  it("tracks a completed search", () => {
    completeSearch({ type: "search", isPagination: false });
    expect(analytics.track).toHaveBeenCalledWith("logs_search_completed");
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

  it("a retried pagination request rebinds the crossing instead of superseding it", () => {
    searchObj.meta.resultGrid.navigation.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: "old",
    };
    connection.buildWebSocketPayload.mockImplementationOnce(() => {
      notePageRequest(searchObj as any, "new");
      return { traceId: "new" };
    });
    useSearchStream((key: string) => key).getDataThroughStream(true);
    const { onReset } = connection.getDataThroughStream.mock.calls.at(-1)![2];
    onReset({ type: "search", isPagination: true, traceId: "old", queryReq: {} });
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection?.requestId).toBe("new");
  });
});
