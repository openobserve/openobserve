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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/settings", () => ({
  default: { getSetting: vi.fn(), setUserSetting: vi.fn() },
}));

import settings from "@/services/settings";
import { useFrecency, frecencyScore } from "./useFrecency";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("frecencyScore", () => {
  it("halves every seven days", () => {
    expect(frecencyScore({ item_id: "a", count: 4, last: NOW }, NOW)).toBe(4);
    expect(frecencyScore({ item_id: "a", count: 4, last: NOW - 7 * DAY }, NOW)).toBeCloseTo(2);
    expect(frecencyScore({ item_id: "a", count: 4, last: NOW - 14 * DAY }, NOW)).toBeCloseTo(1);
  });

  it("never rewards a future timestamp", () => {
    expect(frecencyScore({ item_id: "a", count: 1, last: NOW + DAY }, NOW)).toBe(1);
  });
});

describe("useFrecency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useFrecency().reset();
    (settings.getSetting as any).mockRejectedValue({ response: { status: 404 } });
    (settings.setUserSetting as any).mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records nothing before an org is loaded", () => {
    const f = useFrecency();
    f.record("palette_item", "page:logs", NOW);
    expect(f.scores("palette_item", NOW).size).toBe(0);
  });

  it("counts repeated selections and ranks by decayed score", async () => {
    const f = useFrecency();
    await f.load("org1", "me@example.com");
    f.record("palette_item", "page:logs", NOW - 10 * DAY);
    f.record("palette_item", "page:logs", NOW - 10 * DAY);
    f.record("palette_item", "page:logs", NOW - 10 * DAY);
    f.record("palette_item", "dashboard:default/abc", NOW);
    expect(f.topItems("palette_item", 5, NOW)).toEqual(["page:logs", "dashboard:default/abc"]);
    expect(f.scores("palette_item", NOW).get("page:logs")).toBeCloseTo(3 * Math.pow(0.5, 10 / 7));
  });

  it("keeps buckets and orgs separate", async () => {
    const f = useFrecency();
    await f.load("org1", "me@example.com");
    f.record("palette_item", "page:logs", NOW);
    f.record("palette_scope", "dashboard", NOW);
    expect([...f.scores("palette_scope", NOW).keys()]).toEqual(["dashboard"]);
    await f.load("org2", "me@example.com");
    expect(f.scores("palette_item", NOW).size).toBe(0);
  });

  it("caps a bucket at 100 records, evicting the lowest score", async () => {
    const f = useFrecency();
    await f.load("org1", "me@example.com");
    f.record("palette_item", "old", NOW - 60 * DAY);
    for (let i = 0; i < 100; i++) f.record("palette_item", `fresh-${i}`, NOW);
    const ids = f.scores("palette_item", NOW);
    expect(ids.size).toBe(100);
    expect(ids.has("old")).toBe(false);
  });

  it("mirrors to localStorage immediately and to the server after the debounce", async () => {
    const f = useFrecency();
    await f.load("org1", "me@example.com");
    f.record("palette_item", "page:logs", NOW);
    const local = JSON.parse(window.localStorage.getItem("o2.commandPalette") ?? "{}");
    expect(local.buckets.org1.palette_item[0].item_id).toBe("page:logs");
    expect(settings.setUserSetting).not.toHaveBeenCalled();
    f.record("palette_item", "page:metrics", NOW);
    vi.advanceTimersByTime(2000);
    expect(settings.setUserSetting).toHaveBeenCalledTimes(1);
    expect(settings.setUserSetting).toHaveBeenCalledWith(
      "org1",
      "me@example.com",
      "command_palette",
      expect.objectContaining({ v: 1 }),
      "ui",
    );
  });

  it("loads localStorage first, then lets the server copy win", async () => {
    window.localStorage.setItem(
      "o2.commandPalette",
      JSON.stringify({
        v: 1,
        buckets: { org1: { palette_item: [{ item_id: "local", count: 1, last: NOW }] } },
      }),
    );
    (settings.getSetting as any).mockResolvedValue({
      data: {
        setting_value: {
          v: 1,
          buckets: { org1: { palette_item: [{ item_id: "server", count: 2, last: NOW }] } },
        },
      },
    });
    const f = useFrecency();
    const pending = f.load("org1", "me@example.com");
    expect(f.scores("palette_item", NOW).has("local")).toBe(true);
    await pending;
    expect([...f.scores("palette_item", NOW).keys()]).toEqual(["server"]);
  });

  it("drops malformed records from either source", async () => {
    (settings.getSetting as any).mockResolvedValue({
      data: {
        setting_value: {
          v: 1,
          buckets: {
            org1: { palette_item: [{ item_id: "ok", count: 1, last: NOW }, { nope: 1 }, null] },
          },
        },
      },
    });
    const f = useFrecency();
    await f.load("org1", "me@example.com");
    expect([...f.scores("palette_item", NOW).keys()]).toEqual(["ok"]);
  });
});
