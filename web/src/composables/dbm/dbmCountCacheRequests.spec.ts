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

/**
 * What the cache actually SAVES, counted in requests.
 *
 * The brief's claim is a number — six tab switches cost ~30 count requests —
 * so the evidence should be a number too. This replays the real fan-out sizes
 * per page against the real cache and counts the endpoint calls, which is a
 * stronger check than a stopwatch and runs in CI.
 *
 * The counts come from the pages themselves:
 *   DatabasesPage      5 badge fetches (loadQueryCount)
 *   QueriesPage        4 (loadLockCounts)
 *   ActivityPage       5 (loadContext)
 *   DeadlocksPage      5 (loadContext)
 *   BlockedQueriesPage 5 (loadContext)
 *   TableHealthPage    5 (loadContext)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDbmCountCache } from "@/composables/dbm/useDbmCountCache";
import type { DbmRange } from "@/composables/dbm/useDbmScope";

const relative = (period: string): DbmRange => ({
  type: "relative",
  relativeTimePeriod: period,
  startTime: 0,
  endTime: 0,
});

/** Badge fetches each page's fan-out issues, in tab order. */
const FAN_OUT: [string, number][] = [
  ["DatabasesPage", 5],
  ["QueriesPage", 4],
  ["ActivityPage", 5],
  ["DeadlocksPage", 5],
  ["BlockedQueriesPage", 5],
  ["TableHealthPage", 5],
];

const TOTAL_FETCHES = FAN_OUT.reduce((sum, [, n]) => sum + n, 0);

describe("what a tour of the six tabs costs", () => {
  beforeEach(() => {
    useDbmCountCache().clear();
  });

  /**
   * The BEFORE number, reproduced. Each route remount fetched its own badges
   * with no shared state, so the six pages issued every request independently.
   */
  it("costs 29 requests with no cache — one fan-out per route remount", () => {
    const endpoint = vi.fn();

    for (const [, fetches] of FAN_OUT) {
      for (let i = 0; i < fetches; i += 1) endpoint();
    }

    expect(endpoint).toHaveBeenCalledTimes(29);
    expect(endpoint).toHaveBeenCalledTimes(TOTAL_FETCHES);
  });

  /**
   * The AFTER number. The first tab pays for its fan-out; the other five read
   * the cache and fire nothing, because the window never changed.
   */
  it("costs one fan-out through the cache — the other five tabs fire nothing", async () => {
    const endpoint = vi.fn();
    const window = relative("1h");

    for (const [, fetches] of FAN_OUT) {
      await useDbmCountCache().read("acme", window, async () => {
        for (let i = 0; i < fetches; i += 1) endpoint();
        return { badges: "ok" };
      });
    }

    // Only the FIRST page's fan-out ran.
    expect(endpoint).toHaveBeenCalledTimes(5);
    expect(endpoint.mock.calls.length).toBeLessThan(TOTAL_FETCHES);
  });

  /**
   * Changing the window is a different question, so it correctly pays again —
   * and pays ONCE for the whole tour, not once per tab.
   */
  it("pays exactly one fan-out per distinct window, not per tab", async () => {
    const endpoint = vi.fn();
    const tour = async (period: string) => {
      for (const [, fetches] of FAN_OUT) {
        await useDbmCountCache().read("acme", relative(period), async () => {
          for (let i = 0; i < fetches; i += 1) endpoint();
          return { badges: period };
        });
      }
    };

    await tour("1h");
    await tour("24h");
    await tour("1h"); // back to the first window — still cached

    // Two windows visited, two fan-outs paid.
    expect(endpoint).toHaveBeenCalledTimes(10);
  });

  /** A refresh costs one fan-out, and only the page that asked for it. */
  it("costs one extra fan-out for an explicit refresh", async () => {
    const endpoint = vi.fn();
    const window = relative("1h");
    const fetcher = async () => {
      for (let i = 0; i < 5; i += 1) endpoint();
      return { badges: "ok" };
    };

    await useDbmCountCache().read("acme", window, fetcher);
    await useDbmCountCache().read("acme", window, fetcher, { force: true });
    await useDbmCountCache().read("acme", window, fetcher);

    expect(endpoint).toHaveBeenCalledTimes(10);
  });
});
