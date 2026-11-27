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

import { afterEach, describe, expect, it, vi } from "vitest";

import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64DecodeUnicode } from "@/utils/zincutils";

import { makeEnv } from "./__tests__/actionEnv";
import { pruneQueryRuns, queryRunOf, runQueryApplier } from "./appliers/query";
import type { SearchRequest } from "./registry";
import { streamSearch, type SearchStream } from "./streamSearch";

const runQuery = {
  language: "sql" as const,
  text: 'SELECT * FROM "default"',
  stream: "default",
  streamType: "logs",
  from: 1_760_000_000_000,
  to: 1_760_000_900_000,
  org: "org1",
};

type Handlers = Parameters<SearchStream["fetchQueryDataWithHttpStream"]>[1];

// The real mappers turn the server's events into the frames a handler sees.
const { wsMapper } = useHttpStreaming();

function fakeStream() {
  let handlers: Handlers | null = null;
  const stream = {
    fetchQueryDataWithHttpStream: vi.fn(async (_data: unknown, next: Handlers) => {
      handlers = next;
    }),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  };
  const emit = (type: keyof typeof wsMapper, payload: unknown) =>
    handlers!.data(null, wsMapper[type]("t1", payload as never, type as never));
  return {
    stream: stream as unknown as SearchStream & typeof stream,
    emit,
    end: () => handlers!.complete(null, "t1"),
    fail: (payload: Record<string, unknown>) =>
      handlers!.error(null, wsMapper.error("t1", payload as never, "error" as never)),
  };
}

const request = (signal = new AbortController().signal): SearchRequest => ({
  org: "org1",
  sql: 'SELECT * FROM "default"',
  startTime: 1_000,
  endTime: 2_000,
  streamType: "logs",
  size: 3,
  signal,
});

describe("streamSearch (WT-02)", () => {
  afterEach(() => pruneQueryRuns(new Set()));

  it("runs over the streaming search endpoint and folds partitions into one result", async () => {
    const { stream, emit, end } = fakeStream();
    const pending = streamSearch(stream, request(), "t1");
    const [data] = stream.fetchQueryDataWithHttpStream.mock.calls[0] as [Record<string, any>];
    expect(data).toMatchObject({ type: "search", org_id: "org1", pageType: "logs", traceId: "t1" });
    expect(b64DecodeUnicode(data.queryReq.query.sql)).toBe('SELECT * FROM "default"');
    expect(data.queryReq).toMatchObject({ encoding: "base64", query: { size: 3, from: 0 } });
    emit("search_response_metadata", { results: { total: 2, took: 10, scan_size: 1, hits: [] } });
    emit("search_response_hits", { results: { hits: [{ a: 1 }, { a: 2 }] } });
    emit("search_response_metadata", { results: { total: 2, took: 5, scan_size: 2, hits: [] } });
    emit("search_response_hits", { results: { hits: [{ a: 3 }, { a: 4 }] } });
    end();
    await expect(pending).resolves.toEqual({
      hits: [{ a: 1 }, { a: 2 }, { a: 3 }],
      total: 4,
      took: 15,
      scan_size: 3,
    });
  });

  it("rejects an HTTP 403 so the Run says no access", async () => {
    const { stream, fail } = fakeStream();
    const { env, sid } = makeEnv();
    env.search.mockImplementationOnce((req: SearchRequest) => {
      const pending = streamSearch(stream, req, "t1");
      fail({ status: 403, code: 403, message: "Unauthorized Access" });
      return pending;
    });
    await runQueryApplier(sid, { kind: "run_query", query: runQuery, blockId: "b1" }, env);
    expect(queryRunOf(sid, "b1")?.status).toBe("forbidden");
  });

  it("keeps the server's message from an error event", async () => {
    const { stream, fail } = fakeStream();
    const pending = streamSearch(stream, request(), "t1");
    fail({ code: 500, message: "Search field not found: x", error_detail: "" });
    await expect(pending).rejects.toMatchObject({
      response: { status: 500, data: { message: "Search field not found: x" } },
    });
  });

  it("cancels the stream by its trace id when the Run is stopped", async () => {
    const { stream } = fakeStream();
    const controller = new AbortController();
    const pending = streamSearch(stream, request(controller.signal), "t1");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.cancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith({
      trace_id: "t1",
      org_id: "org1",
    });
  });
});
