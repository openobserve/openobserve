// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.fn();
const cancel = vi.fn();
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...a: unknown[]) => stream(...a),
    cancelStreamQueryBasedOnRequestId: (...a: unknown[]) => cancel(...a),
  }),
}));
vi.mock("@/stores", () => ({ default: { state: { zoConfig: {} } } }));

import streamService from "@/services/stream";
import { createLimiter, listStreamStats, runSql } from "./useSecurityStreamPlans";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("never runs more tasks at once than its slots, across separate callers", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = () =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      });
    const first = [task(), task(), task()];
    await tick();
    expect(active).toBe(2);
    releases.shift()!();
    // A new caller arriving as a slot frees must still queue behind the waiter.
    const late = task();
    await tick();
    expect(active).toBe(2);
    while (releases.length) {
      releases.shift()!();
      await tick();
    }
    await Promise.all([...first, late]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(limit(async () => 7)).resolves.toBe(7);
  });
});

describe("runSql", () => {
  const meta = (results: Record<string, unknown>) => ({
    type: "search_response_metadata",
    content: { results },
  });
  const hits = (rows: unknown[]) => ({
    type: "search_response_hits",
    content: { results: { hits: rows } },
  });
  const replay =
    (events: unknown[], end: "complete" | { error: unknown } = "complete") =>
    (_req: unknown, handlers: any) => {
      for (const event of events) handlers.data({}, event);
      if (end === "complete") handlers.complete({}, {});
      else handlers.error({}, end.error);
    };

  beforeEach(() => {
    stream.mockReset();
    cancel.mockReset();
  });

  it("posts to the search stream and appends the hits of every chunk", async () => {
    stream.mockImplementation(
      replay([meta({ total: 2 }), hits([{ a: 1 }]), meta({ total: 1 }), hits([{ a: 2 }])]),
    );
    const res = await runSql("org", "SELECT 1", 1, 2, 10);
    expect(stream.mock.calls[0][0]).toMatchObject({ type: "search", org_id: "org" });
    expect(stream.mock.calls[0][0].queryReq.query).toMatchObject({ sql: "SELECT 1", size: 10 });
    expect(res).toEqual({
      hits: [{ a: 1 }, { a: 2 }],
      total: 3,
      partial: false,
      functionError: "",
    });
  });

  it("replaces the rows of a streaming aggregate and reports a partial answer", async () => {
    stream.mockImplementation(
      replay([
        meta({ streaming_aggs: true, is_partial: true, function_error: "f" }),
        hits([{ n: 1 }]),
        hits([{ n: 5 }]),
      ]),
    );
    const res = await runSql("org", "SELECT COUNT(*)", 1, 2);
    expect(res.hits).toEqual([{ n: 5 }]);
    expect(res.partial).toBe(true);
    expect(res.functionError).toBe("f");
  });

  it("falls back to hits carried on metadata alone", async () => {
    stream.mockImplementation(replay([meta({ hits: [{ cached: true }] })]));
    expect((await runSql("org", "SELECT 1", 1, 2)).hits).toEqual([{ cached: true }]);
  });

  it("rejects with the server message and body", async () => {
    stream.mockImplementation(
      replay([], { error: { content: { message: "bad sql", code: 20001 } } }),
    );
    await expect(runSql("org", "SELECT", 1, 2)).rejects.toMatchObject({
      message: "bad sql",
      code: 20001,
      response: { data: { message: "bad sql", code: 20001 } },
    });
  });

  it("adds the engine's reason to a rejected query's message", async () => {
    stream.mockImplementation(
      replay([], {
        error: {
          content: { message: "Search SQL not valid", error_detail: "unknown column x" },
        },
      }),
    );
    await expect(runSql("org", "SELECT x", 1, 2)).rejects.toMatchObject({
      message: "Search SQL not valid: unknown column x",
    });
  });

  it("settles with no rows when the stream ends without any hits", async () => {
    stream.mockImplementation(replay([meta({ total: 0 })]));
    await expect(runSql("org", "SELECT a FROM s", 1, 2)).resolves.toMatchObject({
      hits: [],
      total: 0,
    });
  });

  it("rejects a denied search with its status on the response, as an axios error carries it", async () => {
    stream.mockImplementation(
      replay([], { error: { content: { status: 403, message: "denied" } } }),
    );
    await expect(runSql("org", "SELECT", 1, 2)).rejects.toMatchObject({
      status: 403,
      response: { status: 403 },
    });
  });

  it("bypasses the result cache without asking to clear it, which needs stream edit rights", async () => {
    stream.mockImplementation(replay([]));
    await runSql("org", "SELECT 1", 1, 2, -1, { useCache: false });
    const req = stream.mock.calls[0][0];
    expect(req.use_cache).toBe(false);
    expect(req.clear_cache).toBeUndefined();
  });

  it("cancels the stream on the server when aborted", async () => {
    stream.mockImplementation(() => {});
    const controller = new AbortController();
    const pending = runSql("org", "SELECT 1", 1, 2, -1, {
      signal: controller.signal,
      traceId: "t1",
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledWith({ trace_id: "t1", org_id: "org" });
  });
});

describe("listStreamStats", () => {
  it("does not ask again after a refusal, so a source-only analyst logs one 403", async () => {
    const nameList = vi
      .spyOn(streamService, "nameList")
      .mockRejectedValue({ response: { status: 403, data: {} } });
    expect(await listStreamStats("org403")).toBeNull();
    expect(await listStreamStats("org403")).toBeNull();
    expect(nameList).toHaveBeenCalledTimes(1);
    nameList.mockRestore();
  });

  it("keeps asking after a failure that is not a refusal", async () => {
    const nameList = vi.spyOn(streamService, "nameList").mockRejectedValue(new Error("network"));
    await listStreamStats("org500");
    await listStreamStats("org500");
    expect(nameList).toHaveBeenCalledTimes(2);
    nameList.mockRestore();
  });
});
