import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamTraceRows } from "./correlationStream";

const stream = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream,
    cancelStreamQueryBasedOnRequestId: cancel,
  }),
}));

type Handlers = {
  data: (a: unknown, r: unknown) => void;
  error: (a: unknown, e: unknown) => void;
  complete: (a: unknown, r: unknown) => void;
};
const request = { org: "default", sql: "SELECT 1", startTime: 1, endTime: 2, size: 10 };
const hits = (rows: object[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});
const meta = (results: object, streaming_aggs = false) => ({
  type: "search_response_metadata",
  content: { results, streaming_aggs },
});
const rowsOf = (count: number, tag: number) =>
  Array.from({ length: count }, (_, i) => ({ id: i, snapshot: tag }));
function answer(events: object[], end: "complete" | "error" | "none" = "complete") {
  stream.mockImplementation(async (payload: unknown, handlers: Handlers) => {
    for (const event of events) handlers.data(payload, event);
    if (end === "complete") handlers.complete(payload, null);
    if (end === "error") handlers.error(payload, new Error("boom"));
  });
}

beforeEach(() => vi.clearAllMocks());

describe("streamTraceRows", () => {
  it("sends the SQL over the streaming search as a traces search", async () => {
    answer([hits([{ a: 1 }])]);
    await expect(streamTraceRows(request)).resolves.toEqual([{ a: 1 }]);
    expect(stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        type: "search",
        pageType: "traces",
        org_id: "default",
        queryReq: { query: { sql: "SELECT 1", start_time: 1, end_time: 2, from: 0, size: 10 } },
      }),
    );
  });

  it("appends the rows of every partition and chunk of a paged read", async () => {
    answer([hits([{ a: 1 }]), hits([{ a: 2 }])]);
    await expect(streamTraceRows(request)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
    answer([
      meta({ total: 2 }),
      hits([{ a: 1 }]),
      hits([{ a: 2 }]),
      meta({ total: 1 }),
      hits([{ a: 3 }]),
    ]);
    await expect(streamTraceRows(request)).resolves.toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("keeps only the last of 12 cumulative streaming-aggregation snapshots of 1,000 rows", async () => {
    const events = Array.from({ length: 12 }, (_, tag) => {
      const rows = rowsOf(1000, tag);
      return [meta({ total: 1000 }, true), hits(rows.slice(0, 600)), hits(rows.slice(600))];
    }).flat();
    answer(events);
    const rows = await streamTraceRows<{ id: number; snapshot: number }>(request);
    expect(rows).toHaveLength(1000);
    expect(rows).toEqual(rowsOf(1000, 11));
  });

  it("keeps the last streaming-aggregation snapshot when a later one carries no rows", async () => {
    answer([meta({}, true), hits([{ a: 1 }, { a: 2 }]), meta({}, true), hits([])]);
    await expect(streamTraceRows(request)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("rejects a partial answer, a function error and a stream error", async () => {
    answer([meta({ is_partial: true }), hits([{ a: 1 }])]);
    await expect(streamTraceRows(request)).rejects.toThrow("Incomplete");
    answer([meta({ function_error: ["bad vrl"] }), hits([{ a: 1 }])]);
    await expect(streamTraceRows(request)).rejects.toThrow("Incomplete");
    answer([meta({ error: "Search stopped" }), hits([{ a: 1 }])]);
    await expect(streamTraceRows(request)).rejects.toThrow("Incomplete");
    answer([], "error");
    await expect(streamTraceRows(request)).rejects.toThrow("boom");
  });

  it("cancels the stream when the query is aborted", async () => {
    answer([], "none");
    const controller = new AbortController();
    const rows = streamTraceRows({ ...request, signal: controller.signal });
    controller.abort();
    await expect(rows).rejects.toThrow("Aborted");
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ org_id: "default" }));
  });
});
