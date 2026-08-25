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
  clearDbmAnchors,
  DBM_DEFAULT_PERIOD,
  periodToMinutes,
  rangeFromQuery,
  rangeToQuery,
  useDbmScope,
} from "./useDbmScope";

describe("periodToMinutes", () => {
  it("converts every unit the picker can emit", () => {
    expect(periodToMinutes("15m")).toBe(15);
    expect(periodToMinutes("6h")).toBe(360);
    expect(periodToMinutes("1d")).toBe(1440);
    expect(periodToMinutes("1w")).toBe(10080);
  });

  it("falls back to an hour for anything unusable", () => {
    // A malformed URL param used to become NaN and poison every timestamp.
    expect(periodToMinutes(undefined)).toBe(60);
    expect(periodToMinutes("banana")).toBe(60);
    expect(periodToMinutes("0m")).toBe(60);
  });
});

describe("rangeFromQuery", () => {
  it("reads an absolute range from from/to", () => {
    const range = rangeFromQuery({ from: "1000", to: "2000" });
    expect(range).toEqual({
      type: "absolute",
      relativeTimePeriod: null,
      startTime: 1000,
      endTime: 2000,
    });
  });

  it("reads a relative range from period", () => {
    expect(rangeFromQuery({ period: "6h" }).relativeTimePeriod).toBe("6h");
  });

  it("defaults when the query says nothing", () => {
    const range = rangeFromQuery({});
    expect(range.type).toBe("relative");
    expect(range.relativeTimePeriod).toBe(DBM_DEFAULT_PERIOD);
  });

  it("ignores an inverted absolute pair rather than producing a negative window", () => {
    expect(rangeFromQuery({ from: "2000", to: "1000" }).type).toBe("relative");
  });
});

describe("rangeToQuery", () => {
  it("writes period only for a relative range", () => {
    expect(
      rangeToQuery({ type: "relative", relativeTimePeriod: "30m", startTime: 0, endTime: 0 }),
    ).toEqual({ period: "30m", from: undefined, to: undefined });
  });

  it("writes from/to only for an absolute range", () => {
    expect(
      rangeToQuery({ type: "absolute", relativeTimePeriod: null, startTime: 5, endTime: 9 }),
    ).toEqual({ period: undefined, from: "5", to: "9" });
  });
});

describe("useDbmScope", () => {
  it("produces finite timestamps even from a bogus query", () => {
    const { current, previous } = useDbmScope({ period: "not-a-range" });
    for (const value of [
      current.value.startTime,
      current.value.endTime,
      previous.value.startTime,
      previous.value.endTime,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("makes the previous window immediately precede the current one, same length", () => {
    // The Δ column's correctness depends entirely on this adjacency.
    const { current, previous } = useDbmScope({ period: "30m" });
    expect(previous.value.endTime).toBe(current.value.startTime);
    expect(current.value.endTime - current.value.startTime).toBe(
      previous.value.endTime - previous.value.startTime,
    );
  });

  it("spans the requested number of minutes in microseconds", () => {
    const { current } = useDbmScope({ period: "15m" });
    expect(current.value.endTime - current.value.startTime).toBe(15 * 60_000_000);
  });

  it("keeps both windows pinned to ONE anchor so they cannot drift apart", () => {
    // Recomputing Date.now() per access would let the two windows describe
    // different instants by the duration of the fetch.
    const { current, previous } = useDbmScope({ period: "1h" });
    const firstRead = current.value.endTime;
    expect(current.value.endTime).toBe(firstRead);
    expect(previous.value.endTime).toBe(firstRead - 60 * 60_000_000);
  });

  it("uses an absolute range verbatim, and derives its previous window from its span", () => {
    const start = 1_700_000_000_000_000;
    const end = start + 30 * 60_000_000;
    const { current, previous, rangeMinutes } = useDbmScope({
      from: String(start),
      to: String(end),
    });
    expect(current.value).toEqual({ startTime: start, endTime: end });
    expect(previous.value).toEqual({ startTime: start - 30 * 60_000_000, endTime: start });
    expect(rangeMinutes.value).toBe(30);
  });

  it("adopts a picker payload of either kind", () => {
    const { range, setRange, rangeMinutes } = useDbmScope({ period: "15m" });
    setRange({ startTime: 1, endTime: 2, relativeTimePeriod: "6h" });
    expect(range.value.type).toBe("relative");
    expect(rangeMinutes.value).toBe(360);

    setRange({ startTime: 10, endTime: 10 + 60_000_000, relativeTimePeriod: null });
    expect(range.value.type).toBe("absolute");
    expect(rangeMinutes.value).toBe(1);
  });

  it("ignores a picker payload with no usable bounds rather than producing NaN", () => {
    const { range, setRange } = useDbmScope({ period: "15m" });
    setRange({ startTime: NaN, endTime: NaN, relativeTimePeriod: null });
    expect(range.value.relativeTimePeriod).toBe("15m");
  });

  it("mirrors the range into query params, never writing both forms", () => {
    const { queryParams, setRange } = useDbmScope({ period: "15m" });
    expect(queryParams.value).toEqual({ period: "15m", from: undefined, to: undefined });
    setRange({ startTime: 5, endTime: 9, relativeTimePeriod: null });
    expect(queryParams.value).toEqual({ period: undefined, from: "5", to: "9" });
  });
});

/**
 * The comparison baseline is selectable. Welded to the previous ADJACENT
 * window, "did this get slower since the deploy?" would be unanswerable —
 * setting the picker to 7 days would silently compare against the 7 days
 * before that. `previous` remains the default, so nothing changes unless the
 * reader asks for a different baseline.
 */
describe("useDbmScope baseline selection", () => {
  const HOUR_US = 60 * 60_000_000;
  const DAY_US = 24 * HOUR_US;

  it("defaults to the previous adjacent window, which is the shipped behaviour", () => {
    const { baseline, previous, baselineWindow } = useDbmScope({ period: "1h" });
    expect(baseline.value).toBe("previous");
    expect(baselineWindow.value).toEqual(previous.value);
  });

  /**
   * The whole point of the package: the SAME clock hours, one day back. A
   * deploy-vs-yesterday comparison needs the window offset, not re-lengthened —
   * so the span must be preserved exactly and only the offset changes.
   */
  it("offsets by exactly one day for the yesterday baseline, keeping the span", () => {
    const { current, baselineWindow, setBaseline } = useDbmScope({ period: "1h" });
    setBaseline("yesterday");
    expect(baselineWindow.value).toEqual({
      startTime: current.value.startTime - DAY_US,
      endTime: current.value.endTime - DAY_US,
    });
    expect(baselineWindow.value.endTime - baselineWindow.value.startTime).toBe(
      current.value.endTime - current.value.startTime,
    );
  });

  /**
   * A yesterday baseline on a long window would otherwise OVERLAP the window it
   * is compared against — a 48h range against "one day earlier" shares 24h with
   * itself, and a window cannot be its own baseline. Distinct from `previous`,
   * which is adjacent by construction and can never overlap.
   */
  it("keeps an absolute range's span and offset intact", () => {
    const start = 1_700_000_000_000_000;
    const end = start + 30 * 60_000_000;
    const { baselineWindow, setBaseline } = useDbmScope({
      from: String(start),
      to: String(end),
    });
    setBaseline("yesterday");
    expect(baselineWindow.value).toEqual({ startTime: start - DAY_US, endTime: end - DAY_US });
  });

  it("returns to the adjacent window when the reader switches back", () => {
    const { previous, baselineWindow, setBaseline } = useDbmScope({ period: "1h" });
    setBaseline("yesterday");
    setBaseline("previous");
    expect(baselineWindow.value).toEqual(previous.value);
  });

  /** An unknown baseline falls back rather than poisoning every timestamp. */
  it("falls back to the default on a baseline it does not know", () => {
    const { previous, baselineWindow, setBaseline } = useDbmScope({ period: "1h" });
    setBaseline("last-decade" as never);
    expect(baselineWindow.value).toEqual(previous.value);
  });
});

/**
 * The anchor must survive a remount.
 *
 * "Once loaded, data should stay the same unless I change the time range or
 * filters." The DBM views are separate ROUTES, and every remount used to
 * construct a fresh `useDbmScope`, which pinned `anchor` to `Date.now()` in
 * its initialiser. So a relative window's resolved microsecond bounds were
 * DIFFERENT on every landing, and two things followed:
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

/** A fresh module-level anchor table per test, so one test cannot seed another. */
const withAnchorClock = () => {
  beforeEach(() => {
    clearDbmAnchors();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
};

/**
 * Time genuinely has to pass between the two mounts, or the test would pass on
 * a broken implementation simply because `Date.now()` had not ticked. The
 * clock is stubbed, so the 25ms — comfortably more than the 22ms drift
 * measured live — costs no wall-clock time and cannot flake on a slow runner.
 */
const tick = (ms = 25) => vi.advanceTimersByTime(ms);

describe("a remount reuses the anchor rather than re-pinning it", () => {
  withAnchorClock();

  /**
   * THE REQUIREMENT. Two consecutive landings on the same relative range must
   * describe the same window, or nothing downstream can be cached and the page
   * refetches on every tab switch by construction.
   */
  it("resolves identical bounds across two mounts on the same relative range", () => {
    const first = useDbmScope({ period: "15m" });
    const before = { ...first.current.value };

    tick();

    const second = useDbmScope({ period: "15m" });

    expect(second.current.value).toEqual(before);
  });

  /** Six tab switches, one window — the shape of the actual complaint. */
  it("holds one window across six successive landings", () => {
    const windows: string[] = [];
    for (let visit = 0; visit < 6; visit += 1) {
      const scope = useDbmScope({ period: "1h" });
      windows.push(`${scope.current.value.startTime}-${scope.current.value.endTime}`);
      tick(5);
    }

    expect(new Set(windows).size, `six landings produced ${new Set(windows).size} windows`).toBe(1);
  });

  /**
   * The baseline window is derived from `current`, so a drifting anchor moved
   * the Δ comparison too. Pinned here explicitly: a stable current window with
   * a drifting baseline would still repaint the delta column on every landing.
   */
  it("holds the previous window steady across a remount too", () => {
    const first = useDbmScope({ period: "30m" });
    const before = { ...first.previous.value };

    tick();

    expect(useDbmScope({ period: "30m" }).previous.value).toEqual(before);
  });

  /**
   * Different ranges are different questions and must not share a pin — a
   * single shared anchor would make this pass while collapsing every range
   * onto one window.
   */
  it("pins each relative range independently", () => {
    const quarter = useDbmScope({ period: "15m" });
    const hour = useDbmScope({ period: "1h" });

    expect(hour.current.value.endTime - hour.current.value.startTime).toBe(60 * 60_000_000);
    expect(quarter.current.value.endTime - quarter.current.value.startTime).toBe(15 * 60_000_000);
  });

  /**
   * An absolute range carries its own bounds and never consulted the anchor.
   * Asserted anyway: the reuse must not accidentally start overriding them.
   */
  it("leaves an absolute range's bounds exactly as given", () => {
    const start = 1_700_000_000_000_000;
    const end = start + 30 * 60_000_000;

    const first = useDbmScope({ from: String(start), to: String(end) });
    tick();
    const second = useDbmScope({ from: String(start), to: String(end) });

    expect(first.current.value).toEqual({ startTime: start, endTime: end });
    expect(second.current.value).toEqual({ startTime: start, endTime: end });
  });
});

describe("the reader can still ask for a fresher window", () => {
  withAnchorClock();

  /**
   * REQUIREMENT: an explicit refresh must move the window. This is the one case
   * where "same range means same data" is not a fact — the reader is saying the
   * numbers may have moved, and a refresh that returned the pinned instant
   * would make the button a no-op.
   */
  it("re-pins on an explicit refresh", () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    tick();
    scope.refresh();

    expect(scope.current.value.endTime).toBeGreaterThan(before);
  });

  /**
   * …and the re-pin has to reach the SHARED anchor, not just this instance.
   * Otherwise the next tab switch would silently revert to the pre-refresh
   * window and undo the refresh the reader just asked for.
   */
  it("publishes a refresh to the next mount of the same range", () => {
    const scope = useDbmScope({ period: "15m" });
    tick();
    scope.refresh();
    const refreshed = scope.current.value.endTime;

    expect(useDbmScope({ period: "15m" }).current.value.endTime).toBe(refreshed);
  });

  /** Changing the range is a new question, so it pins a new instant. */
  it("re-pins when the reader moves to a different period", () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    tick();
    scope.setPeriod("1h");

    expect(scope.current.value.endTime).toBeGreaterThan(before);
    expect(scope.current.value.endTime - scope.current.value.startTime).toBe(60 * 60_000_000);
  });

  /** The picker's own payload is a range change, by either route. */
  it("re-pins when the picker emits a new relative period", () => {
    const scope = useDbmScope({ period: "15m" });
    const before = scope.current.value.endTime;

    tick();
    scope.setRange({ startTime: 0, endTime: 0, relativeTimePeriod: "6h" });

    expect(scope.current.value.endTime).toBeGreaterThan(before);
  });

  /**
   * Returning to a period the reader already visited must NOT serve the instant
   * pinned on that earlier visit — that would paint a demonstrably stale window
   * after an explicit range change. Going back to `15m` is the reader asking
   * the question again, not asking for the old answer.
   */
  it("re-pins on a return to a previously visited period", () => {
    const scope = useDbmScope({ period: "15m" });
    const original = scope.current.value.endTime;

    tick();
    scope.setPeriod("1h");
    tick();
    scope.setPeriod("15m");

    expect(scope.current.value.endTime).toBeGreaterThan(original);
  });

  /**
   * And that re-pin is what a later mount inherits. Without this, a remount
   * after a range round-trip would resurrect the first visit's window.
   */
  it("hands the re-pinned window to the next mount, not the original one", () => {
    const scope = useDbmScope({ period: "15m" });
    const original = scope.current.value.endTime;

    tick();
    scope.setPeriod("1h");
    tick();
    scope.setPeriod("15m");

    const remounted = useDbmScope({ period: "15m" }).current.value.endTime;
    expect(remounted).toBeGreaterThan(original);
    expect(remounted).toBe(scope.current.value.endTime);
  });
});
