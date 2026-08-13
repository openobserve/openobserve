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
 * The anchor must survive a remount.
 *
 * "Once loaded, data should stay the same unless I change the time range or
 * filters." The DBM views are separate ROUTES, and every remount used to
 * construct a fresh `useDbmScope`, which
 * pinned `anchor` to `Date.now()` in its initialiser. So a relative window's
 * resolved microsecond bounds were DIFFERENT on every landing, and two things
 * followed:
 *
 *  1. Nothing keyed on those bounds could ever cache-hit.
 *  2. The badge fan-out (keyed on the stable `DbmRange`) and the page's own
 *     data read (built from the freshly re-pinned bounds) resolved DIFFERENT
 *     windows within a single click — measured live at 22ms apart, seven
 *     requests on one `start_time` and an eighth on another.
 *
 * The anchor is therefore pinned PER RANGE at module scope and reused by any
 * later mount asking about that same range. Re-pinning becomes something the
 * reader does — a refresh, a range change — rather than something a remount
 * does behind their back.
 *
 * Tested by CALLING the composable. It is a plain function over refs; it needs
 * no page and no mount.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearDbmAnchors, useDbmScope } from "@/composables/dbm/useDbmScope";

/** A fresh module-level anchor table per test, so one test cannot seed another. */
beforeEach(() => {
  clearDbmAnchors();
  vi.useRealTimers();
});

/**
 * Time genuinely has to pass between the two mounts, or the test would pass on
 * a broken implementation simply because `Date.now()` had not ticked. 25ms is
 * comfortably more than the 22ms drift measured live.
 */
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a remount reuses the anchor rather than re-pinning it", () => {
  /**
   * THE REQUIREMENT. Two consecutive landings on the same relative range must
   * describe the same window, or nothing downstream can be cached and the page
   * refetches on every tab switch by construction.
   */
  it("resolves identical bounds across two mounts on the same relative range", async () => {
    const first = useDbmScope({ period: "15m" });
    const before = { ...first.current.value };

    await tick();

    const second = useDbmScope({ period: "15m" });

    expect(second.current.value).toEqual(before);
  });

  /** Six tab switches, one window — the shape of the actual complaint. */
  it("holds one window across six successive landings", async () => {
    const windows: string[] = [];
    for (let visit = 0; visit < 6; visit += 1) {
      const scope = useDbmScope({ period: "1h" });
      windows.push(`${scope.current.value.startTime}-${scope.current.value.endTime}`);
      await tick(5);
    }

    expect(new Set(windows).size, `six landings produced ${new Set(windows).size} windows`).toBe(1);
  });

  /**
   * The baseline window is derived from `current`, so a drifting anchor moved
   * the Δ comparison too. Pinned here explicitly: a stable current window with
   * a drifting baseline would still repaint the delta column on every landing.
   */
  it("holds the previous window steady across a remount too", async () => {
    const first = useDbmScope({ period: "30m" });
    const before = { ...first.previous.value };

    await tick();

    expect(useDbmScope({ period: "30m" }).previous.value).toEqual(before);
  });

  /**
   * Different ranges are different questions and must not share a pin — a
   * single shared anchor would make this pass while collapsing every range
   * onto one window.
   */
  it("pins each relative range independently", async () => {
    const quarter = useDbmScope({ period: "15m" });
    const hour = useDbmScope({ period: "1h" });

    expect(hour.current.value.endTime - hour.current.value.startTime).toBe(60 * 60_000_000);
    expect(quarter.current.value.endTime - quarter.current.value.startTime).toBe(15 * 60_000_000);
  });

  /**
   * An absolute range carries its own bounds and never consulted the anchor.
   * Asserted anyway: the reuse must not accidentally start overriding them.
   */
  it("leaves an absolute range's bounds exactly as given", async () => {
    const start = 1_700_000_000_000_000;
    const end = start + 30 * 60_000_000;

    const first = useDbmScope({ from: String(start), to: String(end) });
    await tick();
    const second = useDbmScope({ from: String(start), to: String(end) });

    expect(first.current.value).toEqual({ startTime: start, endTime: end });
    expect(second.current.value).toEqual({ startTime: start, endTime: end });
  });
});

describe("the reader can still ask for a fresher window", () => {
  /**
   * REQUIREMENT: an explicit refresh must move the window. This is the one case
   * where "same range means same data" is not a fact — the reader is saying the
   * numbers may have moved, and a refresh that returned the pinned instant
   * would make the button a no-op.
   */
  it("re-pins on an explicit refresh", async () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    await tick();
    scope.refresh();

    expect(scope.current.value.endTime).toBeGreaterThan(before);
  });

  /**
   * …and the re-pin has to reach the SHARED anchor, not just this instance.
   * Otherwise the next tab switch would silently revert to the pre-refresh
   * window and undo the refresh the reader just asked for.
   */
  it("publishes a refresh to the next mount of the same range", async () => {
    const scope = useDbmScope({ period: "15m" });
    await tick();
    scope.refresh();
    const refreshed = scope.current.value.endTime;

    expect(useDbmScope({ period: "15m" }).current.value.endTime).toBe(refreshed);
  });

  /** Changing the range is a new question, so it pins a new instant. */
  it("re-pins when the reader moves to a different period", async () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    await tick();
    scope.setPeriod("1h");

    expect(scope.current.value.endTime).toBeGreaterThan(before);
    expect(scope.current.value.endTime - scope.current.value.startTime).toBe(60 * 60_000_000);
  });

  /** The picker's own payload is a range change, by either route. */
  it("re-pins when the picker emits a new relative period", async () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    await tick();
    scope.setRange({ startTime: 0, endTime: 0, relativeTimePeriod: "6h" });

    expect(scope.current.value.endTime).toBeGreaterThan(before);
  });

  /**
   * Returning to a period the reader already visited must NOT serve the instant
   * pinned on that earlier visit — that would paint a demonstrably stale window
   * after an explicit range change. Going back to `15m` is the reader asking
   * the question again, not asking for the old answer.
   */
  it("re-pins on a return to a previously visited period", async () => {
    const scope = useDbmScope({ period: "15m" });
    const original = scope.current.value.endTime;

    await tick();
    scope.setPeriod("1h");
    await tick();
    scope.setPeriod("15m");

    expect(scope.current.value.endTime).toBeGreaterThan(original);
  });

  /**
   * And that re-pin is what a later mount inherits. Without this, a remount
   * after a range round-trip would resurrect the first visit's window.
   */
  it("hands the re-pinned window to the next mount, not the original one", async () => {
    const scope = useDbmScope({ period: "15m" });
    const original = scope.current.value.endTime;

    await tick();
    scope.setPeriod("1h");
    await tick();
    scope.setPeriod("15m");

    const remounted = useDbmScope({ period: "15m" }).current.value.endTime;
    expect(remounted).toBeGreaterThan(original);
    expect(remounted).toBe(scope.current.value.endTime);
  });
});

describe("the properties the anchor already guaranteed", () => {
  /**
   * Regression guard. Both windows must describe ONE instant: recomputing the
   * clock per access would let them drift apart by the duration of the fetch
   * and silently corrupt the delta.
   */
  it("keeps current and previous adjacent and equal in length", () => {
    const { current, previous } = useDbmScope({ period: "30m" });

    expect(previous.value.endTime).toBe(current.value.startTime);
    expect(current.value.endTime - current.value.startTime).toBe(
      previous.value.endTime - previous.value.startTime,
    );
  });

  it("still produces finite bounds from an unusable query", () => {
    const { current } = useDbmScope({ period: "not-a-range" });

    expect(Number.isFinite(current.value.startTime)).toBe(true);
    expect(Number.isFinite(current.value.endTime)).toBe(true);
  });
});
