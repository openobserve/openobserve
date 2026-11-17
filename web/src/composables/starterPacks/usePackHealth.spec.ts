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

import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

const lists = vi.hoisted(() => ({ byType: {} as Record<string, unknown[] | Error> }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: vi.fn(async (query: { queryKey: unknown[] }) => {
    const type = String(query.queryKey.find((part) => part === "metrics" || part === "logs"));
    const reply = lists.byType[type];
    if (reply instanceof Error) throw reply;
    return reply ?? [];
  }),
}));

import {
  STALE_AFTER_US,
  staleSinceText,
  staleSinceUs,
  streamHealthOf,
  usePackHealth,
  withoutUnusedSignals,
} from "./usePackHealth";

const NOW = 10 * STALE_AFTER_US;

describe("staleSinceUs", () => {
  it("stays quiet under 30 minutes", () => {
    const rows = [{ name: "a", stats: { doc_time_max: NOW - STALE_AFTER_US + 1 } }];
    expect(staleSinceUs(rows, new Set(["a"]), NOW)).toBeNull();
  });

  it("answers the newest event once every stream is quiet", () => {
    const rows = [
      { name: "a", stats: { doc_time_max: 100 } },
      { name: "b", stats: { doc_time_max: 200 } },
      { name: "other", stats: { doc_time_max: NOW } },
    ];
    expect(staleSinceUs(rows, new Set(["a", "b"]), NOW)).toBe(200);
  });

  it("says nothing without stats", () => {
    expect(staleSinceUs([{ name: "a" }], new Set(["a"]), NOW)).toBeNull();
  });
});

describe("staleSinceText", () => {
  it("shows day, short month and time, without the year or seconds", () => {
    const at = new Date(2026, 10, 12, 10, 27, 55).getTime() * 1000;
    const text = staleSinceText(at);
    expect(text).toContain("12");
    expect(text).toContain("Nov");
    expect(text).toContain("10:27");
    expect(text).not.toContain("2026");
    expect(text).not.toContain(":55");
  });

  it("is empty when the data is fresh", () => {
    expect(staleSinceText(null)).toBe("");
  });
});

describe("streamHealthOf", () => {
  const lists = (rows: Record<string, unknown[] | null>) =>
    new Map(Object.entries(rows)) as Map<string, any[] | null>;

  it("reads Receiving under 30 minutes and Stopped after", () => {
    const fresh = { name: "a", stats: { doc_time_max: NOW - 1 } };
    const old = { name: "b", stats: { doc_time_max: NOW - STALE_AFTER_US } };
    const read = lists({ metrics: [fresh, old] });
    expect(streamHealthOf({ name: "a", type: "metrics" }, read, NOW).state).toBe("receiving");
    const stopped = streamHealthOf({ name: "b", type: "metrics" }, read, NOW);
    expect(stopped).toMatchObject({ state: "stopped", lastUs: NOW - STALE_AFTER_US });
  });

  it("counts a missing stream or one without events as Never received", () => {
    const read = lists({ metrics: [{ name: "empty", stats: {} }] });
    expect(streamHealthOf({ name: "empty", type: "metrics" }, read, NOW).state).toBe("never");
    expect(streamHealthOf({ name: "gone", type: "metrics" }, read, NOW).state).toBe("never");
  });

  it("says Couldn't check when the stats read failed, never healthy", () => {
    const read = lists({ metrics: null });
    expect(streamHealthOf({ name: "a", type: "metrics" }, read, NOW).state).toBe("unknown");
  });

  it("finds an untyped stream that only a traces list holds", () => {
    const read = lists({
      metrics: [],
      logs: [],
      traces: [{ name: "default", stats: { doc_time_max: NOW } }],
    });
    const health = streamHealthOf({ name: "default", type: "" }, read, NOW);
    expect(health.state).toBe("receiving");
    expect(health.type).toBe("traces");
  });

  it("looks an untyped stream up in both lists and takes the type it is found under", () => {
    const read = lists({ metrics: [], logs: [{ name: "a", stats: { doc_time_max: NOW } }] });
    const health = streamHealthOf({ name: "a", type: "" }, read, NOW);
    expect(health.state).toBe("receiving");
    expect(health.type).toBe("logs");
  });
});

describe("withoutUnusedSignals", () => {
  it("drops the spellings a source never sends once another spelling of that signal reports", () => {
    const rows = [
      { name: "a", type: "metrics", signal: "a", state: "receiving" as const, lastUs: 1 },
      { name: "b", type: "metrics", signal: "a", state: "never" as const, lastUs: null },
      { name: "c", type: "logs", state: "never" as const, lastUs: null },
    ];
    expect(withoutUnusedSignals(rows).map(({ name }) => name)).toEqual(["a", "c"]);
  });

  it("keeps a signal no spelling of which reports, even when another signal does", () => {
    const rows = [
      { name: "cpu", type: "metrics", signal: "cpu", state: "receiving" as const, lastUs: 1 },
      { name: "fs", type: "metrics", signal: "fs", state: "never" as const, lastUs: null },
      { name: "node_fs", type: "metrics", signal: "fs", state: "never" as const, lastUs: null },
    ];
    expect(withoutUnusedSignals(rows).map(({ name }) => name)).toEqual(["cpu", "fs", "node_fs"]);
  });

  it("keeps every signal when none reports, so the pack reads Never received", () => {
    const rows = [
      { name: "a", type: "metrics", signal: "a", state: "never" as const, lastUs: null },
    ];
    expect(withoutUnusedSignals(rows)).toEqual(rows);
  });
});

describe("usePackHealth", () => {
  it("reads one list per stream type and fills the per-stream states", async () => {
    const now = Date.now() * 1000;
    lists.byType = {
      metrics: [{ name: "m", stats: { doc_time_max: now } }],
      logs: new Error("boom"),
    };
    const health = usePackHealth("org");
    await health.checkStreams([
      { name: "m", type: "metrics" },
      { name: "l", type: "logs" },
    ]);
    await flushPromises();
    expect(health.streams.value.map(({ name, state }) => [name, state])).toEqual([
      ["m", "receiving"],
      ["l", "unknown"],
    ]);
  });

  it("leaves staleSince alone, so Home keeps its meaning", async () => {
    lists.byType = { metrics: [] };
    const health = usePackHealth("org");
    await health.checkStreams([{ name: "never", type: "metrics" }]);
    expect(health.staleSince.value).toBeNull();
    expect(health.streams.value[0].state).toBe("never");
  });
});
