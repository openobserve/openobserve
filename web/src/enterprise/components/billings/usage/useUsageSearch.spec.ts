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

import { beforeEach, describe, expect, it, vi } from "vitest";

type Handlers = {
  data: (payload: unknown, response: unknown) => void;
  error: (payload: unknown, response: unknown) => void;
  complete: (payload: unknown, response: unknown) => void;
};

const calls: { request: any; handlers: Handlers }[] = [];
const cancelled: string[] = [];

vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig: {} },
  }),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (request: any, handlers: Handlers) => {
      calls.push({ request, handlers });
    },
    cancelStreamQueryBasedOnRequestId: ({ trace_id }: { trace_id: string }) => {
      cancelled.push(trace_id);
    },
  }),
}));

let traceSeq = 0;
vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: () => ({ traceId: `trace-${++traceSeq}` }),
  b64EncodeUnicode: (value: string) => `b64:${value}`,
}));

const { useUsageSearch } = await import("./useUsageSearch");

const metadata = (streaming_aggs: boolean, hits?: unknown[]) => ({
  type: "search_response_metadata",
  content: { results: { streaming_aggs, ...(hits ? { hits } : {}) } },
});
const hitsEvent = (hits: unknown[]) => ({
  type: "search_response_hits",
  content: { results: { hits } },
});

describe("useUsageSearch", () => {
  beforeEach(() => {
    calls.length = 0;
    cancelled.length = 0;
  });

  const options = { start: 1, end: 2, size: 10 };

  it("posts the SQL to the stream with the window, size and logs page type", async () => {
    const { search } = useUsageSearch();
    const pending = search("select 1", options);
    const { request, handlers } = calls[0];
    expect(request.type).toBe("search");
    expect(request.pageType).toBe("logs");
    expect(request.clear_cache).toBeUndefined();
    expect(request.queryReq.query).toEqual({
      sql: "select 1",
      start_time: 1,
      end_time: 2,
      from: 0,
      size: 10,
    });
    handlers.complete({}, {});
    await expect(pending).resolves.toEqual([]);
  });

  it("appends time partitions when the backend does not stream aggregates", async () => {
    const { search } = useUsageSearch();
    const pending = search("histogram sql", options);
    const { handlers } = calls[0];
    handlers.data({}, metadata(false));
    handlers.data({}, hitsEvent([{ day: 1 }]));
    handlers.data({}, metadata(false));
    handlers.data({}, hitsEvent([{ day: 2 }]));
    handlers.complete({}, {});
    await expect(pending).resolves.toEqual([{ day: 1 }, { day: 2 }]);
  });

  it("replaces rows for a streaming aggregate, which resends the whole result each time", async () => {
    const { search } = useUsageSearch();
    const pending = search("aggregate sql", options);
    const { handlers } = calls[0];
    handlers.data({}, metadata(true));
    handlers.data({}, hitsEvent([{ total: 5 }]));
    handlers.data({}, metadata(true));
    handlers.data({}, hitsEvent([{ total: 9 }]));
    handlers.complete({}, {});
    await expect(pending).resolves.toEqual([{ total: 9 }]);
  });

  it("falls back to metadata hits when no hits event arrives, as a cached response can", async () => {
    const { search } = useUsageSearch();
    const pending = search("cached sql", options);
    calls[0].handlers.data({}, metadata(false, [{ total: 3 }]));
    calls[0].handlers.complete({}, {});
    await expect(pending).resolves.toEqual([{ total: 3 }]);
  });

  it("cancels the previous same-key query on the server and leaves it unsettled", async () => {
    const { search } = useUsageSearch();
    let firstSettled = false;
    search("first", { ...options, key: "rows" }).finally(() => {
      firstSettled = true;
    });
    const second = search("second", { ...options, key: "rows" });
    expect(cancelled).toEqual([calls[0].request.traceId]);
    calls[0].handlers.complete({}, {});
    calls[1].handlers.data({}, hitsEvent([{ n: 2 }]));
    calls[1].handlers.complete({}, {});
    await expect(second).resolves.toEqual([{ n: 2 }]);
    expect(firstSettled).toBe(false);
  });

  it("reports the running rows after each chunk, and none from a superseded query", async () => {
    const { search } = useUsageSearch();
    const seen: unknown[][] = [];
    const stale: unknown[][] = [];
    search("old", { ...options, key: "orgs", onRows: (rows) => stale.push(rows) });
    const pending = search("new", { ...options, key: "orgs", onRows: (rows) => seen.push(rows) });
    calls[0].handlers.data({}, hitsEvent([{ v: 0 }]));
    const { handlers } = calls[1];
    handlers.data({}, metadata(true));
    handlers.data({}, hitsEvent([{ v: 1 }]));
    handlers.data({}, hitsEvent([{ v: 2 }]));
    handlers.complete({}, {});
    await expect(pending).resolves.toEqual([{ v: 2 }]);
    expect(seen).toEqual([[{ v: 1 }], [{ v: 2 }]]);
    expect(stale).toEqual([]);
  });

  it("keeps different keys independent", () => {
    const { search } = useUsageSearch();
    search("a", { ...options, key: "rows" });
    search("b", { ...options, key: "total" });
    expect(cancelled).toEqual([]);
  });

  it("rejects with the server message where existing callers read it", async () => {
    const { search } = useUsageSearch();
    const pending = search("bad", options);
    calls[0].handlers.error(
      {},
      { type: "error", content: { message: "Stream not found: usage", status: 404 } },
    );
    await expect(pending).rejects.toMatchObject({
      message: "Stream not found: usage",
      status: 404,
      response: { data: { message: "Stream not found: usage" } },
    });
  });
});
