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

// Acceptance gate 13 at unit level: the viewer's two cadences of design 4.7.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  LIFECYCLE_MS,
  MAX_TIMER_MS,
  REFRESH_POLL_MIN_MS,
  clockOffsetMs,
  createPoller,
  retryAfterMs,
  setLongTimeout,
  toLocalMs,
  type PollOutcome,
} from "./publicDashboardPolling";

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 9, 15, 12, 0, 0);

const quiet: PollOutcome = { kind: "body", refreshing: false, hintMs: null, dueAtMs: null };
const refreshing = (hintMs: number | null): PollOutcome => ({
  kind: "body",
  refreshing: true,
  hintMs,
  dueAtMs: null,
});

/** A poller fed from a script of outcomes; the last one repeats. */
const setup = (outcomes: PollOutcome[], random = () => 0) => {
  let hidden = false;
  const check = vi.fn(async () => (outcomes.length > 1 ? outcomes.shift()! : outcomes[0]));
  const poller = createPoller({ check, isHidden: () => hidden, random });
  return {
    check,
    poller,
    setHidden: (value: boolean) => (hidden = value),
  };
};

describe("viewer polling (design 4.7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  describe("lifecycle check", () => {
    it("re-reads a quiet body every 60 s while visible", async () => {
      const { check, poller } = setup([quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(LIFECYCLE_MS - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(LIFECYCLE_MS);
      expect(check).toHaveBeenCalledTimes(3);
      poller.stop();
    });

    it.each([
      [0, 60_000],
      [0.5, 57_000],
      [0.999_999, 54_000],
    ])("jitters by at most 10%%, never past a minute (random %s)", async (r, expected) => {
      const { check, poller } = setup([quiet], () => r);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(Math.floor(expected) - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });

    it("reads just after a server due time that comes before the lifecycle check", async () => {
      const { check, poller } = setup([{ ...quiet, dueAtMs: T0 + 20_000 }, quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(20_999);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });

    it("keeps a 30-day refresh interval on the 60 s lifecycle check", async () => {
      const { check, poller } = setup([{ ...quiet, dueAtMs: T0 + 30 * DAY_MS }]);
      poller.start();
      await vi.advanceTimersByTimeAsync(10 * LIFECYCLE_MS);
      expect(check).toHaveBeenCalledTimes(11);
      poller.stop();
    });
  });

  describe("visibility", () => {
    it("reads nothing while hidden and checks at once on becoming visible", async () => {
      const { check, poller, setHidden } = setup([quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      setHidden(true);
      poller.hidden();
      await vi.advanceTimersByTimeAsync(30 * LIFECYCLE_MS);
      expect(check).toHaveBeenCalledTimes(1);

      setHidden(false);
      poller.visible();
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(LIFECYCLE_MS);
      expect(check).toHaveBeenCalledTimes(3);
      poller.stop();
    });

    it("does not read when a timer comes due while the page is hidden", async () => {
      const { check, poller, setHidden } = setup([quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      setHidden(true);
      await vi.advanceTimersByTimeAsync(5 * LIFECYCLE_MS);
      expect(check).toHaveBeenCalledTimes(1);
      poller.stop();
    });
  });

  describe("Retry-After on 202, 503 and 429", () => {
    it.each([
      ["202 building", { kind: "wait", retryAfterMs: 7_000 }],
      ["503 cooldown", { kind: "wait", retryAfterMs: 120_000 }],
      ["429 too many requests", { kind: "wait", retryAfterMs: 60_000, client: true }],
    ] as const)("waits exactly Retry-After after a %s", async (_name, wait) => {
      const { check, poller } = setup([wait as PollOutcome, quiet], Math.random);
      poller.start();
      await vi.advanceTimersByTimeAsync(wait.retryAfterMs - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });

    it("does not read early when the page becomes visible during a Retry-After wait", async () => {
      const { check, poller } = setup([
        { kind: "wait", retryAfterMs: 60_000, client: true },
        quiet,
      ]);
      poller.start();
      await vi.advanceTimersByTimeAsync(10_000);
      poller.hidden();
      poller.visible();
      await vi.advanceTimersByTimeAsync(49_999);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });

    it("keeps a 429 hold across a range switch, but not a range's own 202 or 503 wait", async () => {
      const limited = setup([{ kind: "wait", retryAfterMs: 60_000, client: true }, quiet]);
      limited.poller.start();
      await vi.advanceTimersByTimeAsync(1_000);
      limited.poller.start();
      await vi.advanceTimersByTimeAsync(58_999);
      expect(limited.check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(limited.check).toHaveBeenCalledTimes(2);
      limited.poller.stop();

      const building = setup([{ kind: "wait", retryAfterMs: 60_000 }, quiet]);
      building.poller.start();
      await vi.advanceTimersByTimeAsync(1_000);
      building.poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(building.check).toHaveBeenCalledTimes(2);
      building.poller.stop();
    });

    it("backs off when a failure names no Retry-After, and stops on a final answer", async () => {
      const { check, poller } = setup([{ kind: "error" }, { kind: "error" }, { kind: "final" }]);
      poller.start();
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]);
      expect(check).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(DAY_MS);
      expect(check).toHaveBeenCalledTimes(3);
    });
  });

  describe("refresh polling", () => {
    it("polls at the server's hint with up to 20% added, until refreshing is false", async () => {
      const { check, poller } = setup(
        [refreshing(5_000), refreshing(5_000), refreshing(5_000), quiet],
        () => 0.5,
      );
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      // 5 s plus 10% (half of the 20% jitter) between polls.
      await vi.advanceTimersByTimeAsync(5_499);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_500);
      expect(check).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(5_500);
      expect(check).toHaveBeenCalledTimes(4);
      // Refreshing is over: back on the lifecycle check.
      await vi.advanceTimersByTimeAsync(LIFECYCLE_MS * 0.95 - 1);
      expect(check).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(5);
      poller.stop();
    });

    it("never polls a refresh faster than every 3 s", async () => {
      const { check, poller } = setup([refreshing(null), refreshing(500), quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(REFRESH_POLL_MIN_MS - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(REFRESH_POLL_MIN_MS);
      expect(check).toHaveBeenCalledTimes(3);
      poller.stop();
    });

    it("keeps polling while refreshing even when each answer is a new body", async () => {
      // Each answer below stands for a new rev; only refreshing decides the cadence.
      const { check, poller } = setup([refreshing(3_000), refreshing(3_000), quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(check).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(check).toHaveBeenCalledTimes(3);
      poller.stop();
    });

    it("drops an answer that arrives after a range switch", async () => {
      let resolveSlow: (o: PollOutcome) => void = () => {};
      const check = vi
        .fn<() => Promise<PollOutcome>>()
        .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)))
        .mockResolvedValue(quiet);
      const poller = createPoller({ check, isHidden: () => false, random: () => 0 });
      poller.start();
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      resolveSlow(refreshing(3_000));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });
  });

  describe("long timers", () => {
    it("chunks a 30-day wait past the setTimeout limit and fires once, on time", async () => {
      const spy = vi.spyOn(globalThis, "setTimeout");
      const fired = vi.fn();
      setLongTimeout(fired, 30 * DAY_MS);
      expect(Math.max(...spy.mock.calls.map(([, ms]) => Number(ms)))).toBeLessThanOrEqual(
        MAX_TIMER_MS,
      );
      await vi.advanceTimersByTimeAsync(MAX_TIMER_MS);
      expect(fired).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30 * DAY_MS - MAX_TIMER_MS - 1);
      expect(fired).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fired).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("cancels a chunked timer between chunks", async () => {
      const fired = vi.fn();
      const cancel = setLongTimeout(fired, 30 * DAY_MS);
      await vi.advanceTimersByTimeAsync(MAX_TIMER_MS + 1);
      cancel();
      await vi.advanceTimersByTimeAsync(30 * DAY_MS);
      expect(fired).not.toHaveBeenCalled();
    });

    it("honours a 30-day Retry-After instead of firing at once", async () => {
      const { check, poller } = setup([{ kind: "wait", retryAfterMs: 30 * DAY_MS }, quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(30 * DAY_MS - 1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });
  });

  describe("server clock", () => {
    const serverAhead = 3_600_000;
    const headers = { date: new Date(T0 + serverAhead).toUTCString() };

    it("reads the skew from the Date header, and none without one", () => {
      expect(clockOffsetMs(headers, T0)).toBe(serverAhead);
      expect(clockOffsetMs({}, T0)).toBe(0);
      expect(clockOffsetMs({ date: "garbage" }, T0)).toBe(0);
    });

    it("converts server micros to local time across the skew", () => {
      expect(toLocalMs((T0 + serverAhead + 30_000) * 1000, serverAhead)).toBe(T0 + 30_000);
      expect(toLocalMs(null, serverAhead)).toBeNull();
    });

    it("reads Retry-After as seconds, or as an HTTP date on the server's clock", () => {
      expect(retryAfterMs({ "retry-after": "12" }, serverAhead, T0)).toBe(12_000);
      const at = new Date(T0 + serverAhead + 90_000).toUTCString();
      expect(retryAfterMs({ "retry-after": at }, serverAhead, T0)).toBe(90_000);
      expect(retryAfterMs({}, serverAhead, T0)).toBeNull();
    });

    it("aims at a server due time an hour ahead of the local clock without reading early or late", async () => {
      const offset = clockOffsetMs(headers, T0);
      const dueAtMs = toLocalMs((T0 + serverAhead + 20_000) * 1000, offset);
      const { check, poller } = setup([{ ...quiet, dueAtMs }, quiet]);
      poller.start();
      await vi.advanceTimersByTimeAsync(20_999);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(2);
      poller.stop();
    });
  });
});
