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

import { describe, expect, it, beforeEach, vi } from "vitest";
import queryHistory, { type QueryHistoryEntry } from "@/services/query_history";
import { queryClient } from "@/composables/query/queryClient";
import http from "@/services/http";
import { recordQueryHistoryMutation } from "@/services/query_history.queries";
import { queryHistoryKeys } from "@/services/query_history.querykeys";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

describe("query_history service", () => {
  let api: any;

  beforeEach(() => {
    api = {
      get: vi.fn().mockResolvedValue({ data: [] }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(api);
  });

  it("records a run with its source, key, streams and status", async () => {
    const body = {
      source: "logs" as const,
      query: "level = 'error'",
      query_key: '[["k8s"],"logs","filter","level = \'error\'",""]',
      streams: ["k8s"],
      status: "ok" as const,
      context: { time: { type: "relative" as const, period: "15m", start_time: 1, end_time: 2 } },
    };
    await queryHistory.record("o1", body);
    expect(api.post).toHaveBeenCalledWith("/api/o1/query_history", body);
  });

  it("lists with only the filters that are set", async () => {
    await queryHistory.list("o1", { starred: true, q: "rate" });
    expect(api.get).toHaveBeenCalledWith("/api/o1/query_history", {
      params: { starred: true, q: "rate" },
    });
    await queryHistory.list("o1", {
      source: "logs,traces",
      status: "error",
      stream: "k8s",
      ran_from: 1,
      ran_to: 2,
    });
    expect(api.get).toHaveBeenLastCalledWith("/api/o1/query_history", {
      params: { source: "logs,traces", status: "error", stream: "k8s", ran_from: 1, ran_to: 2 },
    });
  });

  it("marks recent searches stale after a record instead of refetching them", () => {
    const meta = recordQueryHistoryMutation("o1").meta;
    expect(meta?.stales).toEqual([queryHistoryKeys.all("o1")]);
    expect(meta?.invalidates).toBeUndefined();
  });

  it("puts a recorded run first in its page's loaded recent list, without a refetch", async () => {
    const key = queryHistoryKeys.recent("o1", "logs");
    const old = (id: string) => ({ id, source: "logs" }) as QueryHistoryEntry;
    queryClient.setQueryData(key, [old("a"), old("b")]);
    const options = recordQueryHistoryMutation("o1");
    const stored = { ...old("b"), run_count: 2 };
    await options.onSuccess?.({ data: stored } as never, {} as never, undefined, {} as never);
    expect(queryClient.getQueryData<QueryHistoryEntry[]>(key)?.map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    await options.onSuccess?.({ data: "" } as never, {} as never, undefined, {} as never);
    expect(queryClient.getQueryData<QueryHistoryEntry[]>(key)).toHaveLength(2);
    const traces = queryHistoryKeys.recent("o1", "traces");
    await options.onSuccess?.(
      { data: { id: "t", source: "traces" } } as never,
      {} as never,
      undefined,
      {} as never,
    );
    expect(queryClient.getQueryData(traces)).toBeUndefined();
    queryClient.removeQueries({ queryKey: queryHistoryKeys.all("o1") });
  });

  it("keeps a recorded run's list to the 8 rows and the pinned run the quick list shows", async () => {
    const key = queryHistoryKeys.recent("o1", "logs");
    const old = (id: string) => ({ id, source: "logs" }) as QueryHistoryEntry;
    queryClient.setQueryData(
      key,
      Array.from({ length: 9 }, (_, i) => old(`e${i}`)),
    );
    const options = recordQueryHistoryMutation("o1");
    await options.onSuccess?.({ data: old("new") } as never, {} as never, undefined, {} as never);
    const ids = queryClient.getQueryData<QueryHistoryEntry[]>(key)?.map((r) => r.id);
    expect(ids).toEqual(["new", "e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    queryClient.removeQueries({ queryKey: queryHistoryKeys.all("o1") });
  });

  it("asks the server for a count with the list filters", async () => {
    await queryHistory.count("o1", { source: "logs", starred: false });
    expect(api.get).toHaveBeenCalledWith("/api/o1/query_history", {
      params: { source: "logs", starred: false, count_only: true },
    });
  });

  it("clears the caller's history for a scope", async () => {
    await queryHistory.clear("o1", { source: "logs", include_starred: false });
    expect(api.delete).toHaveBeenCalledWith("/api/o1/query_history", {
      params: { source: "logs", include_starred: false },
    });
  });

  it("stars and deletes by id", async () => {
    await queryHistory.star("o1", "id 1", true);
    expect(api.patch).toHaveBeenCalledWith("/api/o1/query_history/id%201", { starred: true });
    await queryHistory.remove("o1", "id 1");
    expect(api.delete).toHaveBeenCalledWith("/api/o1/query_history/id%201");
  });
});
