// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
vi.mock("@/services/search", () => ({ default: { search: (...a: unknown[]) => search(...a) } }));

import { withRecentActivity } from "./streamActivity";

const NOW = 1_800_000_000_000_000;
const HOUR = 3_600_000_000;

describe("withRecentActivity", () => {
  beforeEach(() => search.mockReset());

  it("leaves live streams alone and never queries for them", async () => {
    const list = [{ name: "ct", stats: { doc_num: 10, doc_time_max: NOW - HOUR } }];
    expect(await withRecentActivity("o", list, ["ct"], NOW)).toBe(list);
    expect(search).not.toHaveBeenCalled();
  });

  it("patches a stream whose stats have not caught up with its data", async () => {
    search.mockResolvedValue({ data: { hits: [{ zo_n: 42, zo_last: NOW - 60_000_000 }] } });
    const list = [
      { name: "fresh", stats: { doc_num: 0, doc_time_max: 0 } },
      { name: "other", stats: { doc_num: 0, doc_time_max: 0 } },
    ];
    const out = await withRecentActivity("o", list, ["fresh"], NOW);
    expect(search).toHaveBeenCalledTimes(1);
    expect(out[0].stats).toMatchObject({ doc_num: 42, doc_time_max: NOW - 60_000_000 });
    // Not a security stream, so not checked or changed.
    expect(out[1]).toBe(list[1]);
  });

  it("keeps the stats when the stream really is silent or unreadable", async () => {
    search.mockResolvedValueOnce({ data: { hits: [{ zo_n: 0, zo_last: null }] } });
    search.mockRejectedValueOnce(new Error("boom"));
    const list = [
      { name: "a", stats: { doc_num: 5, doc_time_max: NOW - 48 * HOUR } },
      { name: "b", stats: {} },
    ];
    expect(await withRecentActivity("o", list, ["a", "b"], NOW)).toBe(list);
  });
});
