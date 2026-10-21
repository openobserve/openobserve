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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HINT_STALE_MS,
  POLL_FAST_FOR_MS,
  POLL_FAST_MS,
  POLL_SLOW_MS,
  POLL_STOP_MS,
  createElsewhere,
  type ElsewhereDeps,
} from "./historyElsewhere";

// Web Locks with `ifAvailable`, shared by every tab of one browser.
function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    request: (async (
      name: string,
      _options: unknown,
      callback: (lock: unknown) => Promise<unknown>,
    ) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    }) as unknown as LockManager["request"],
  };
}

function tab(over: Partial<ElsewhereDeps> = {}) {
  let hidden = false;
  const listeners = new Set<() => void>();
  const poll = vi.fn(async () => ({ running: true, approval: false, turnId: "t1" }));
  const ended = vi.fn();
  const elsewhere = createElsewhere({
    now: () => Date.now(),
    hidden: () => hidden,
    onVisibility: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    locks: null,
    poll,
    ended,
    ...over,
  });
  const setHidden = (value: boolean) => {
    hidden = value;
    for (const cb of listeners) cb();
  };
  return { elsewhere, poll, ended, setHidden };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createElsewhere", () => {
  it("polls every 4 s for a minute, then every 15 s, and stops loudly at ten minutes", async () => {
    const { elsewhere, poll } = tab();
    elsewhere.start("s1", { approval: false, turnId: "t1" });
    expect(elsewhere.views.s1.mode).toBe("polling");
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3);
    expect(poll).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_FAST_FOR_MS - POLL_FAST_MS * 3);
    const atMinute = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS * 2);
    expect(poll.mock.calls.length - atMinute).toBeLessThanOrEqual(3);
    expect(poll.mock.calls.length - atMinute).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(POLL_STOP_MS);
    expect(elsewhere.views.s1.mode).toBe("stalled");
    const stopped = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS * 4);
    expect(poll).toHaveBeenCalledTimes(stopped);
    elsewhere.refresh("s1");
    await vi.advanceTimersByTimeAsync(0);
    expect(elsewhere.views.s1.mode).toBe("polling");
    expect(poll).toHaveBeenCalledTimes(stopped + 1);
    elsewhere.dispose();
  });

  it("never polls while hidden and reads at once when shown again", async () => {
    const { elsewhere, poll, setHidden } = tab();
    elsewhere.start("s1", { approval: false, turnId: null });
    setHidden(true);
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS * 5);
    expect(poll).toHaveBeenCalledTimes(0);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    elsewhere.dispose();
  });

  it("ends the watch when the turn no longer runs", async () => {
    const poll = vi.fn(async () => ({ running: false, approval: false, turnId: null }));
    const { elsewhere, ended } = tab({ poll });
    elsewhere.start("s1", { approval: false, turnId: "t1" });
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(ended).toHaveBeenCalledWith("s1");
    expect(elsewhere.views.s1).toBeUndefined();
  });

  it("lets one tab per browser hold the tail and hands it over when that tab hides", async () => {
    const locks = fakeLocks();
    const tail = vi.fn(() => new Promise<void>(() => undefined));
    const a = tab({ locks, tail });
    const b = tab({ locks, tail });
    a.elsewhere.start("s1", { approval: false, turnId: "t1" });
    await vi.advanceTimersByTimeAsync(0);
    b.elsewhere.start("s1", { approval: false, turnId: "t1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.elsewhere.holdsTail("s1")).toBe(true);
    expect(b.elsewhere.holdsTail("s1")).toBe(false);
    expect(a.elsewhere.views.s1.mode).toBe("tail");
    a.setHidden(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.elsewhere.holdsTail("s1")).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(b.elsewhere.holdsTail("s1")).toBe(true);
    expect(locks.held.size).toBe(1);
    a.elsewhere.dispose();
    b.elsewhere.dispose();
  });

  it("stops at once and reports the chat gone when a read answers 404", async () => {
    const gone = vi.fn();
    const { elsewhere, poll, ended } = tab({ gone, poll: vi.fn(async () => "gone" as const) });
    elsewhere.start("s1", { approval: false, turnId: "t1" });
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(gone).toHaveBeenCalledWith("s1");
    expect(ended).not.toHaveBeenCalled();
    expect(elsewhere.views.s1).toBeUndefined();
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS * 4);
    expect(poll).not.toHaveBeenCalled();
  });

  it("reads on return only when the back-off is due, and never after the ten-minute stop", async () => {
    const { elsewhere, poll, setHidden } = tab();
    elsewhere.start("s1", { approval: false, turnId: "t1" });
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    setHidden(true);
    setHidden(false);
    setHidden(true);
    setHidden(false);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_STOP_MS);
    expect(elsewhere.views.s1.mode).toBe("stalled");
    const stopped = poll.mock.calls.length;
    for (let i = 0; i < 5; i += 1) {
      setHidden(true);
      setHidden(false);
    }
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS);
    expect(poll).toHaveBeenCalledTimes(stopped);
  });

  it("lets a hint-only chat go after a quiet spell when the browser has no Web Locks", async () => {
    const { elsewhere, ended } = tab();
    elsewhere.start("s1", { approval: false, turnId: "t1" }, { polls: false });
    await vi.advanceTimersByTimeAsync(HINT_STALE_MS - 1_000);
    elsewhere.start("s1", { approval: false, turnId: "t1" }, { polls: false });
    await vi.advanceTimersByTimeAsync(HINT_STALE_MS - 1_000);
    expect(ended).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ended).toHaveBeenCalledWith("s1");
    expect(elsewhere.views.s1).toBeUndefined();
  });
});
