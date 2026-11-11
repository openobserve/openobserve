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

type Handlers = {
  data: (payload: unknown, response: unknown) => void;
  error: (payload: unknown, response: unknown) => void;
  complete: (payload: unknown, response: unknown) => void;
};

const stream = vi.hoisted(() => ({
  fetch: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream.fetch,
    cancelStreamQueryBasedOnRequestId: stream.cancel,
  }),
}));
vi.mock("@/utils/zincutils", () => ({ generateTraceContext: () => ({ traceId: "t1" }) }));

import searchStream from "@/services/searchStream";

const query = { query: { sql: "SELECT 1", start_time: 1, end_time: 2, from: 0, size: 10 } };

const lastHandlers = (): Handlers => stream.fetch.mock.calls.at(-1)![1] as Handlers;
const meta = (results: Record<string, unknown>, streaming_aggs = false) => ({
  type: "search_response_metadata",
  content: { results, streaming_aggs },
});
const hits = (rows: unknown[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});
const inBandError = (content: Record<string, unknown>) => ({ type: "error", content });

describe("searchStream.search", () => {
  beforeEach(() => {
    stream.fetch.mockReset();
    stream.cancel.mockReset();
  });

  it("posts the request to the search stream with its page and search type", () => {
    void searchStream.search({ org_identifier: "org1", query }, "RUM");
    expect(stream.fetch.mock.calls[0][0]).toEqual({
      queryReq: query,
      type: "search",
      pageType: "logs",
      searchType: "RUM",
      traceId: "t1",
      org_id: "org1",
    });
  });

  it("joins the hit chunks of a plain search", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    const h = lastHandlers();
    h.data(null, meta({}));
    h.data(null, hits([{ a: 1 }]));
    h.data(null, hits([{ a: 2 }]));
    h.complete(null, null);
    expect((await res).data.hits).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("keeps only the last result of a streaming aggregate, which resends the whole merge", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    const h = lastHandlers();
    h.data(null, meta({}, true));
    h.data(null, hits([{ n: 1 }]));
    h.data(null, hits([{ n: 3 }]));
    h.complete(null, null);
    expect((await res).data.hits).toEqual([{ n: 3 }]);
  });

  it("hands each partial result to onRows before the stream ends", async () => {
    const seen: unknown[][] = [];
    const res = searchStream.search({ org_identifier: "org1", query }, "RUM", (rows) =>
      seen.push(rows),
    );
    const h = lastHandlers();
    h.data(null, meta({}, true));
    h.data(null, hits([{ n: 1 }]));
    h.data(null, hits([{ n: 3 }]));
    expect(seen).toEqual([[{ n: 1 }], [{ n: 3 }]]);
    h.complete(null, null);
    expect((await res).data.hits).toEqual([{ n: 3 }]);
  });

  it("hands a plain search's rows so far to onRows, chunk by chunk", () => {
    const seen: unknown[][] = [];
    void searchStream.search({ org_identifier: "org1", query }, "RUM", (rows) => seen.push(rows));
    const h = lastHandlers();
    h.data(null, meta({}));
    h.data(null, hits([{ a: 1 }]));
    h.data(null, hits([{ a: 2 }]));
    expect(seen).toEqual([[{ a: 1 }], [{ a: 1 }, { a: 2 }]]);
  });

  it("hands a cached response's metadata rows to onRows", () => {
    const seen: unknown[][] = [];
    void searchStream.search({ org_identifier: "org1", query }, "RUM", (rows) => seen.push(rows));
    lastHandlers().data(null, meta({ hits: [{ c: 1 }] }));
    expect(seen).toEqual([[{ c: 1 }]]);
  });

  it("falls back to the metadata hits of a cached response and carries its partial flags", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    const h = lastHandlers();
    h.data(null, meta({ hits: [{ c: 1 }], is_partial: true, function_error: "fn failed" }));
    h.complete(null, null);
    expect((await res).data).toEqual({
      hits: [{ c: 1 }],
      is_partial: true,
      function_error: "fn failed",
    });
  });

  it("rejects a refused request with its HTTP status and search error code", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    lastHandlers().error(null, inBandError({ status: 403, code: 403, message: "Unauthorized" }));
    await expect(res).rejects.toMatchObject({
      message: "Unauthorized",
      response: { status: 403, data: { code: 403, message: "Unauthorized" } },
    });
  });

  it("reads a missing stream's search error code back from an in-band error", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    lastHandlers().error(
      null,
      inBandError({ code: 400, message: "Search stream not found: _rumdata", error_detail: "" }),
    );
    await expect(res).rejects.toMatchObject({
      response: {
        status: 400,
        data: { code: 20002, message: "Search stream not found: _rumdata" },
      },
    });
  });

  it("gives any other in-band error its HTTP status and no search error code", async () => {
    const res = searchStream.search({ org_identifier: "org1", query });
    lastHandlers().error(null, inBandError({ code: 500, message: "boom" }));
    const err = await res.catch((e) => e);
    expect(err.response.status).toBe(500);
    expect(err.response.data.code).toBeUndefined();
  });

  it("cancels the stream and rejects as an abort when the signal fires", async () => {
    const controller = new AbortController();
    const res = searchStream.search({ org_identifier: "org1", query, signal: controller.signal });
    controller.abort();
    await expect(res).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.cancel).toHaveBeenCalledWith({ trace_id: "t1", org_id: "org1" });
  });

  it("never opens a stream for a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = searchStream.search({ org_identifier: "org1", query, signal: controller.signal });
    await expect(res).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.fetch).not.toHaveBeenCalled();
  });
});
