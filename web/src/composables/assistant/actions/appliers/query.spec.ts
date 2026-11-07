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

import { afterEach, describe, expect, it } from "vitest";

import { makeEnv } from "../__tests__/actionEnv";
import { pruneQueryRuns, queryRunOf, runQueryApplier, stopQueryApplier } from "./query";

const query = {
  language: "sql" as const,
  text: 'SELECT * FROM "default"',
  stream: "default",
  streamType: "logs",
  from: 1_760_000_000_000,
  to: 1_760_000_900_000,
  org: "org1",
};

const run = { kind: "run_query" as const, query, blockId: "b1" };

describe("query applier", () => {
  afterEach(() => pruneQueryRuns(new Set()));

  it("runs through the search API with the user's own permissions and microsecond range", async () => {
    const { env, sid, store } = makeEnv();
    env.search.mockResolvedValueOnce({
      hits: [{ a: 1 }, { a: 2 }],
      total: 4,
      took: 380,
      scan_size: 12,
    });
    const result = await runQueryApplier(sid, run, env);
    expect(result.ok).toBe(true);
    expect(env.search).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "org1",
        sql: query.text,
        startTime: query.from * 1000,
        endTime: query.to * 1000,
        size: 50,
      }),
    );
    expect(queryRunOf(sid, "b1")).toMatchObject({
      status: "done",
      total: 4,
      tookMs: 380,
      rows: [{ a: "1" }, { a: "2" }],
    });
    expect(store.state.sessions[sid].annotations.b1.run).toMatchObject({ status: "done", rows: 4 });
    expect(env.feedback).not.toHaveBeenCalled();
  });

  it("says empty for zero rows, never an empty table", async () => {
    const { env, sid } = makeEnv();
    env.search.mockResolvedValueOnce({ hits: [], total: 0 });
    await runQueryApplier(sid, run, env);
    expect(queryRunOf(sid, "b1")?.status).toBe("empty");
  });

  it("names a 403 as no access and keeps the server's reason for other failures", async () => {
    const { env, sid } = makeEnv();
    env.search.mockRejectedValueOnce({ response: { status: 403 } });
    await runQueryApplier(sid, run, env);
    expect(queryRunOf(sid, "b1")?.status).toBe("forbidden");
    env.search.mockRejectedValueOnce({
      response: { status: 500, data: { message: "Search field not found: x" } },
    });
    await runQueryApplier(sid, run, env);
    expect(queryRunOf(sid, "b1")).toMatchObject({
      status: "failed",
      reason: "Search field not found: x",
    });
  });

  it("stops a run in flight", async () => {
    const { env, sid } = makeEnv();
    env.search.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const pending = runQueryApplier(sid, run, env);
    expect(queryRunOf(sid, "b1")?.status).toBe("running");
    expect(stopQueryApplier(sid, { kind: "stop_query", blockId: "b1" }, env)).toEqual({ ok: true });
    await pending;
    expect(queryRunOf(sid, "b1")?.status).toBe("stopped");
  });

  it("runs an unknown range on the last 15 minutes and cuts a wide one to 7 days, and says so", async () => {
    const { env, sid } = makeEnv();
    env.search.mockResolvedValue({ hits: [], total: 0 });
    await runQueryApplier(
      sid,
      { ...run, query: { ...query, from: undefined, to: undefined } },
      env,
    );
    expect(env.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ startTime: (2_000_000 - 900_000) * 1000, endTime: 2_000_000_000 }),
    );
    expect(queryRunOf(sid, "b1")?.window).toEqual({
      from: 2_000_000 - 900_000,
      to: 2_000_000,
      fallback: true,
      capped: false,
    });
    await runQueryApplier(sid, { ...run, query: { ...query, from: 1 } }, env);
    expect(queryRunOf(sid, "b1")?.window).toEqual({
      from: query.to - 7 * 24 * 3_600_000,
      to: query.to,
      fallback: false,
      capped: true,
    });
  });

  it("only ever sends one of the three stream types as the search type", async () => {
    const { env, sid } = makeEnv();
    env.search.mockResolvedValue({ hits: [], total: 0 });
    await runQueryApplier(
      sid,
      { ...run, query: { ...query, streamType: "logs&use_cache=false" } },
      env,
    );
    expect(env.search).toHaveBeenLastCalledWith(expect.objectContaining({ streamType: "logs" }));
  });

  it("aborts and forgets the runs of a session the store no longer has", async () => {
    const { env, sid } = makeEnv();
    let aborted = false;
    env.search.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }),
        ),
    );
    const pending = runQueryApplier(sid, run, env);
    pruneQueryRuns(new Set());
    await pending;
    expect(aborted).toBe(true);
    expect(queryRunOf(sid, "b1")).toBeNull();
  });
});
