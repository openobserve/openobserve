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

const { searchObj, connection } = vi.hoisted(() => ({
  searchObj: {
    loading: true,
    loadingProgressPercentage: 50,
    loadingHistogram: false,
    loadingHistogramProgressPercentage: 0,
    meta: { refreshInterval: 0, clearCache: false },
    data: {},
  },
  connection: { getDataThroughStream: vi.fn(), cleanupConnection: vi.fn() },
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
  default: () => ({ getQueryReq: () => ({ query: {} }) }),
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
