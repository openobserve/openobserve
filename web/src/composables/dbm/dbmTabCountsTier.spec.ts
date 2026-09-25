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
 * How long a tab count may be reused before the strip asks again.
 *
 * The key names the window the reader CHOSE, so "last hour" reads the same at
 * 10:00 and at 10:45 — only the clock can expire it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/db_monitoring", () => ({
  default: { getBadges: vi.fn() },
}));

const { default: dbMonitoringService } = await import("@/services/db_monitoring");
const service = dbMonitoringService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const { useDbmTabCounts } = await import("@/composables/dbm/useDbmTabCounts");
const { queryClient } = await import("@/composables/query/queryClient");

const answered = () => ({
  data: {
    databases: { hits: [{ calls: 3 }] },
    queries: { total: 4, hits: [] },
    activity: { by_state: [{ state: "active", sessions: 2 }], hits: [] },
    deadlocks: { total: 1, truncated: false },
    blocking: { total: 0, truncated: false },
    table_health: { total: 8 },
  },
});

/** Every slice failed server-side: nothing was learned, nothing may be remembered. */
const unanswered = () => ({
  data: {
    databases: null,
    queries: null,
    activity: null,
    deadlocks: null,
    blocking: null,
    table_health: null,
  },
});

const RELATIVE = { type: "relative", relativeTimePeriod: "1h", startTime: 0, endTime: 0 } as const;
const ABSOLUTE = {
  type: "absolute",
  relativeTimePeriod: null,
  startTime: 1_700_000_005_000_000,
  endTime: 1_700_003_605_000_000,
} as const;
const WINDOW = { startTime: 1_000, endTime: 2_000 };
const T0 = new Date("2026-09-22T10:00:00Z");

const minutes = (n: number) => vi.setSystemTime(new Date(T0.getTime() + n * 60_000));

describe("the tab counts' freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    // Only `Date`: faking the task queues would stall the awaits below.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    service.getBadges.mockResolvedValue(answered());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /// "Last hour" at 10:45 is not the question it was at 10:00.
  it("re-asks for a relative range once a minute has passed", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RELATIVE, WINDOW);
    minutes(0.5);
    await load("acme", RELATIVE, WINDOW);
    expect(service.getBadges).toHaveBeenCalledTimes(1);

    minutes(1.5);
    await load("acme", RELATIVE, WINDOW);
    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });

  /// A closed window cannot change, so the count is held far longer.
  it("holds an absolute range for an hour", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", ABSOLUTE, WINDOW);
    minutes(30);
    await load("acme", ABSOLUTE, WINDOW);
    expect(service.getBadges).toHaveBeenCalledTimes(1);

    minutes(61);
    await load("acme", ABSOLUTE, WINDOW);
    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });

  /// Serving it to the next tab would paint seven blanks as though measured.
  it("does not remember an envelope in which every count failed", async () => {
    service.getBadges.mockResolvedValue(unanswered());
    const { load } = useDbmTabCounts();
    await load("acme", RELATIVE, WINDOW);
    await load("acme", RELATIVE, WINDOW);

    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });

  /// A later envelope in which every count failed must not push the last good
  /// answer out of the cache: a fresh shell, with no snapshot of its own, would
  /// otherwise paint seven blanks.
  it("keeps the last good counts for a fresh shell when the fan-out answers nothing", async () => {
    await useDbmTabCounts().load("acme", RELATIVE, WINDOW);
    minutes(2);
    service.getBadges.mockResolvedValue(unanswered());
    const fresh = useDbmTabCounts();

    await fresh.load("acme", RELATIVE, WINDOW);

    expect(service.getBadges).toHaveBeenCalledTimes(2);
    expect(fresh.counts.value.databaseCount).toBe(1);
  });

  /// An absolute range never moves, so its exact bounds are the key: two zooms
  /// that start and end in the same minute are two different questions.
  it("keys two absolute windows in the same minute apart", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", ABSOLUTE, WINDOW);
    await load("acme", { ...ABSOLUTE, startTime: ABSOLUTE.startTime + 10_000_000 }, WINDOW);

    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });

  /// The refresh button: one real read, then the cache again.
  it("reaches the server once on a forced load, and serves the cache after", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RELATIVE, WINDOW);
    await load("acme", RELATIVE, WINDOW, {}, { force: true });
    await load("acme", RELATIVE, WINDOW);

    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });

  /// Seven tabs mounting at once are one question.
  it("shares one request between loads that overlap", async () => {
    const { load } = useDbmTabCounts();
    await Promise.all([
      load("acme", RELATIVE, WINDOW),
      load("acme", RELATIVE, WINDOW),
      load("acme", RELATIVE, WINDOW),
    ]);

    expect(service.getBadges).toHaveBeenCalledTimes(1);
  });

  it("keeps one org's counts apart from another's", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RELATIVE, WINDOW);
    await load("other", RELATIVE, WINDOW);

    expect(service.getBadges).toHaveBeenCalledTimes(2);
  });
});
