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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  badgeCount,
  computeQps,
  errorRate,
  countClaim,
  overlapClaim,
  overlapTile,
  formatCount,
  dbmHttpError,
  formatAge,
  formatLagBytes,
  formatLagSeconds,
  formatWhenWithAge,
  failedCellKind,
  formatNs,
  formatPercent,
  formatRate,
  formatSignedPercent,
  oneLine,
  shareWidth,
  showsPerRequest,
} from "./format";

describe("formatNs", () => {
  it("picks a unit that keeps sub-millisecond queries legible", () => {
    // The failure mode this prevents: every fast query rendering as "0ms".
    expect(formatNs(850)).toBe("850.00ns");
    expect(formatNs(12_400)).toBe("12.40us");
    expect(formatNs(1_500_000)).toBe("1.50ms");
    expect(formatNs(2_500_000_000)).toBe("2.50s");
  });

  it("matches the traces formatter's glyph and precision", () => {
    // ASCII "us" (the Greek mu does not parse back through UNIT_ALIASES) and
    // two decimals with trailing zeros, exactly like formatTimeWithSuffix.
    expect(formatNs(250_000)).toBe("250.00us");
    expect(formatNs(4_630_000)).toBe("4.63ms");
    expect(formatNs(163_000_000)).toBe("163.00ms");
  });

  it("scales past a minute rather than printing five-digit seconds", () => {
    expect(formatNs(90 * 1_000_000_000)).toBe("1.50m");
    expect(formatNs(7200 * 1_000_000_000)).toBe("2.00h");
  });

  it("distinguishes a measured zero from a metric that was never emitted", () => {
    expect(formatNs(0)).toBe("0us");
    expect(formatNs(undefined)).toBe("—");
    expect(formatNs(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("never rounds a real contribution down to nothing", () => {
    expect(formatPercent(0.0002)).toBe("<0.1%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formats an ordinary share to one decimal", () => {
    expect(formatPercent(0.452)).toBe("45.2%");
  });
});

describe("formatSignedPercent", () => {
  it("always carries a sign so direction is unmissable", () => {
    expect(formatSignedPercent(0.5)).toBe("+50%");
    expect(formatSignedPercent(-0.18)).toBe("-18%");
  });

  it("keeps a decimal for small changes only", () => {
    expect(formatSignedPercent(0.052)).toBe("+5.2%");
  });

  it("returns an em dash for an absent ratio", () => {
    expect(formatSignedPercent(undefined)).toBe("—");
  });
});

describe("errorRate", () => {
  it("returns null — not zero — when there were no calls", () => {
    // "No errors out of nothing" is not a 0% error rate.
    expect(errorRate(0, 0)).toBeNull();
    expect(errorRate(undefined, undefined)).toBeNull();
  });

  it("computes a share of calls", () => {
    expect(errorRate(5, 100)).toBe(0.05);
  });
});

describe("computeQps", () => {
  it("divides calls by the window length in seconds", () => {
    const oneMinute = 60_000_000;
    expect(computeQps(120, 0, oneMinute)).toBe(2);
  });

  it("returns null for a zero-length window rather than Infinity", () => {
    expect(computeQps(120, 100, 100)).toBeNull();
  });
});

describe("formatRate", () => {
  it("does not round a slow-but-real query to zero", () => {
    expect(formatRate(0.005)).toBe("<0.01");
    expect(formatRate(0)).toBe("0");
  });
});

describe("oneLine", () => {
  it("collapses newlines so a 4 KB statement fits one table row", () => {
    expect(oneLine("SELECT *\n  FROM orders\n WHERE id = ?")).toBe(
      "SELECT * FROM orders WHERE id = ?",
    );
  });

  it("returns an empty string for absent text", () => {
    expect(oneLine(undefined)).toBe("");
  });
});

describe("showsPerRequest — the Per request suppression", () => {
  it("stays quiet at 1x, the value most rows carry", () => {
    expect(showsPerRequest(1)).toBe(false);
  });

  it("shows a notable fan-out well below the N+1 insight threshold", () => {
    // 3x earns no chip, but is still worth seeing while reading the row.
    expect(showsPerRequest(2)).toBe(true);
    expect(showsPerRequest(3)).toBe(true);
  });

  it("shows the loud N+1 case", () => {
    expect(showsPerRequest(15)).toBe(true);
  });

  it("stays quiet below 1x, where the ratio is a sampling artifact", () => {
    expect(showsPerRequest(0.5)).toBe(false);
    expect(showsPerRequest(0)).toBe(false);
  });

  it("treats an uncomputable ratio the same as 1x — nothing to report", () => {
    expect(showsPerRequest(null)).toBe(false);
    expect(showsPerRequest(undefined)).toBe(false);
    expect(showsPerRequest(Number.NaN)).toBe(false);
    expect(showsPerRequest(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("failedCellKind — the Failed column", () => {
  it("says 'none' for a clean row rather than printing a zero", () => {
    expect(failedCellKind(0)).toBe("none");
  });

  it("prints the count for a partial failure", () => {
    expect(failedCellKind(12)).toBe("count");
  });

  it("prints the count for a total failure instead of the word 'all'", () => {
    // 769 of 769 failed: the column carries the number, the chip the reason.
    expect(failedCellKind(769)).toBe("count");
  });

  it("treats an absent or unusable error count as an all-clear", () => {
    expect(failedCellKind(undefined)).toBe("none");
    expect(failedCellKind(null)).toBe("none");
    expect(failedCellKind(Number.NaN)).toBe("none");
    expect(failedCellKind(-1)).toBe("none");
  });
});

/**
 * The server caps event reads and says so with `truncated`. Every sentence
 * counting those events has to know whether it holds a total or a floor —
 * "every deadlock is here — 100" is the exact claim the cap makes false.
 */
describe("countClaim — total or floor", () => {
  it("reports a complete count when the server did not cap the read", () => {
    expect(countClaim(43, false)).toEqual({ count: 43, complete: true });
  });

  it("reports a floor when the server capped the read", () => {
    expect(countClaim(100, true)).toEqual({ count: 100, complete: false });
  });

  it("treats an absent flag as a complete count", () => {
    expect(countClaim(7, undefined)).toEqual({ count: 7, complete: true });
  });
});

/**
 * An overlap count is the one kind that may not print its own zero.
 *
 * D2 makes the vantage qualifier mandatory on an overlap value, and D6 forbids
 * rendering absent as `0`. A measured zero satisfies the first into a
 * violation of the second — `0 client-observed` asserts an idle fleet on the
 * strength of ONE of the two feeds, which on a zero-trace org is the feed that
 * is empty by construction. Withholding is the honest answer; the other
 * vantage's number replaces it when there is one.
 */
describe("overlapClaim — a vantage that saw nothing claims nothing", () => {
  it("withholds a zero rather than qualifying it", () => {
    expect(overlapClaim(0, false, "client")).toBeNull();
  });

  it("withholds a zero from the server vantage too", () => {
    expect(overlapClaim(0, true, "server")).toBeNull();
  });

  it("carries a real count with its vantage", () => {
    expect(overlapClaim(42, false, "client")).toEqual({
      count: 42,
      complete: true,
      vantage: "client",
    });
  });

  it("still discloses the cap on a real count", () => {
    expect(overlapClaim(50, true, "server")).toEqual({
      count: 50,
      complete: false,
      vantage: "server",
    });
  });
});

/**
 * The summary-tile form of the badge rule, and the third surface to need it.
 *
 * Fixtures are the LIVE shapes: org `dbm_notraces` at 1h answers
 * `{"hits":[],"other":[],"total":0}` on `/queries` and `{"hits":[],"total":0}`
 * on `/server_queries` — every vantage absent — while the same org at 2d
 * answers 50 server rows summing 1,117,188+ calls. Org `default` at 2d answers
 * 53 trace rows whose first carries `calls: 167430`,
 * `total_time_ns: 28119997249111`.
 */
describe("overlapTile — a summary tile withholds what its vantage never measured", () => {
  it("withholds the figure when the vantage produced no rows at all", () => {
    // dbm_notraces @ 1h: `[].reduce((a, r) => a + r.calls, 0)` is 0, but there
    // was nothing to add. This is the fabricated `0us client-observed`.
    expect(overlapTile(0, false, formatNs)).toEqual({ value: null, qualified: false });
    expect(overlapTile(0, false, formatCount)).toEqual({ value: null, qualified: false });
  });

  it("prints a GENUINE measured zero, qualifier and all", () => {
    // Rows present, all reporting zero: that zero IS the population, and
    // hiding it would be its own lie.
    expect(overlapTile(0, true, formatNs)).toEqual({ value: "0us", qualified: true });
    expect(overlapTile(0, true, formatCount)).toEqual({ value: "0", qualified: true });
  });

  it("renders a real total and lets it carry its qualifier", () => {
    // org `default` @ 2d, first trace row.
    expect(overlapTile(28_119_997_249_111, true, formatNs)).toEqual({
      value: "7.81h",
      qualified: true,
    });
    expect(overlapTile(167_430, true, formatCount)).toEqual({
      value: "167,430",
      qualified: true,
    });
  });

  it("withholds when the measure itself is absent, even with rows on screen", () => {
    // `server_calls: null` on org `default`'s rows — the row exists, that
    // measure does not.
    expect(overlapTile(null, true, formatCount)).toEqual({ value: null, qualified: false });
    expect(overlapTile(undefined, true, formatNs)).toEqual({ value: null, qualified: false });
  });

  it("never lets a qualifier render without a value beside it", () => {
    // The inverse defect: a bare "client-observed" under an empty tile.
    for (const tile of [
      overlapTile(0, false, formatNs),
      overlapTile(null, true, formatNs),
      overlapTile(undefined, false, formatCount),
    ]) {
      expect(tile.qualified).toBe(false);
      expect(tile.value).toBeNull();
    }
  });

  it("does not hide a real count on a truncated server read", () => {
    // dbm_notraces @ 2d: 50 rows, `truncated: true`. The prior fix nearly
    // suppressed exactly this — a genuine server count of 50.
    expect(overlapTile(50, true, formatCount)).toEqual({ value: "50", qualified: true });
    expect(overlapTile(1_117_188, true, formatCount)).toEqual({
      value: "1,117,188",
      qualified: true,
    });
  });
});

/**
 * The tab badge is a count taken off the SAME capped reads, and it was the one
 * place that ignored the cap.
 *
 * Measured on a live backend: `/blocking` at its default `limit` of 100 returns
 * `total: 100, truncated: true`, while the same window at `limit=1000` returns
 * `total: 545, truncated: false`. So the Blocked tab rendered a flat **100** —
 * a CAP displayed as a POPULATION — and a reader comparing "100 blocked" today
 * against "100 blocked" yesterday is comparing two ceilings, not two numbers.
 *
 * `countClaim` already carries `complete` for exactly this; the badge just
 * never asked. "100+" is the smallest honest rendering: it keeps the badge
 * glanceable while saying the true number is at or above it.
 */
describe("badgeCount — a tab badge may not show a cap as a total", () => {
  it("prints a complete count as the plain number", () => {
    expect(badgeCount({ count: 43, complete: true })).toBe("43");
  });

  it("marks a capped count as a floor rather than a total", () => {
    // The shipped defect: this rendered "100".
    expect(badgeCount({ count: 100, complete: false })).toBe("100+");
  });

  it("marks a floor at any cap, not just the default 100", () => {
    // Pins the RULE, not the one fixture the bug was found at — a hard-coded
    // `count === 100` check would pass the case above and fail here.
    expect(badgeCount({ count: 1000, complete: false })).toBe("1000+");
    expect(badgeCount({ count: 7, complete: false })).toBe("7+");
  });

  it("renders nothing for an unknown count, so a failed read cannot read as zero", () => {
    // `null` is the "we could not count" state every page's catch block sets.
    // A `0` badge would claim the deployment is quiet.
    expect(badgeCount(null)).toBeNull();
    expect(badgeCount(undefined)).toBeNull();
  });

  it("still prints a genuine zero", () => {
    // Zero MEASURED is a real answer and must not be suppressed with unknown.
    expect(badgeCount({ count: 0, complete: true })).toBe("0");
  });

  it("accepts a bare number as a complete count", () => {
    // The badge props are plain numbers on the pages that have no cap to
    // report; those must keep rendering exactly as before.
    expect(badgeCount(12)).toBe("12");
    expect(badgeCount(0)).toBe("0");
  });
});

/**
 * Replication lag arrives in two different units under one role — Postgres
 * reports BYTES of WAL, MySQL reports SECONDS behind the source — so each has
 * to print in its own unit or a 4096-second replica reads as 4 KB behind.
 */
describe("formatLagBytes", () => {
  it("prints bytes below a kilobyte", () => {
    expect(formatLagBytes(512)).toBe("512 B");
  });

  it("scales to kilobytes", () => {
    expect(formatLagBytes(4096)).toBe("4 KB");
  });

  it("scales to megabytes", () => {
    expect(formatLagBytes(5_242_880)).toBe("5 MB");
  });

  it("scales to gigabytes, where a replica is genuinely in trouble", () => {
    expect(formatLagBytes(2 * 1024 ** 3)).toBe("2 GB");
  });

  it("keeps one decimal where the leading digit alone would hide the size", () => {
    expect(formatLagBytes(1536)).toBe("1.5 KB");
  });

  it("prints a caught-up replica as zero rather than as nothing", () => {
    expect(formatLagBytes(0)).toBe("0 B");
  });

  it("returns an em dash for an absent reading", () => {
    expect(formatLagBytes(null)).toBe("—");
    expect(formatLagBytes(undefined)).toBe("—");
  });
});

describe("formatLagSeconds", () => {
  it("prints seconds below a minute", () => {
    expect(formatLagSeconds(45)).toBe("45s");
  });

  it("prints minutes and seconds", () => {
    expect(formatLagSeconds(125)).toBe("2m 5s");
  });

  it("prints hours and minutes, because 4096s is not a readable number", () => {
    expect(formatLagSeconds(4096)).toBe("1h 8m");
  });

  it("prints a caught-up replica as zero", () => {
    expect(formatLagSeconds(0)).toBe("0s");
  });

  it("returns an em dash for an absent reading", () => {
    expect(formatLagSeconds(null)).toBe("—");
  });
});

describe("lag formatters and the sign", () => {
  // A negative WAL delay means the reading is unusable (clock skew, or a
  // replica reported ahead of its primary). Printing it as a positive distance
  // behind is the one rendering that states the opposite of the truth.
  it("does not print a negative byte lag as a positive distance behind", () => {
    expect(formatLagBytes(-4096)).toBe("—");
  });

  it("does not print a negative second lag as a caught-up replica", () => {
    expect(formatLagSeconds(-30)).toBe("—");
  });
});

describe("formatAge", () => {
  const NOW = new Date("2026-08-13T12:00:00Z").getTime();
  const agoMicros = (seconds: number) => (NOW - seconds * 1000) * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads in the unit the reader would reach for", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatAge(agoMicros(20))).toBe("20s ago");
    expect(formatAge(agoMicros(20 * 60))).toBe("20m ago");
  });

  /**
   * The unification pin: two pages used to cap this at minutes, so a
   * three-hour-old sample printed "180m ago" — arithmetic handed back to the
   * reader. Every page now climbs to hours and days.
   */
  it("says 3h ago, never 180m ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatAge(agoMicros(3 * 60 * 60))).toBe("3h ago");
    expect(formatAge(agoMicros(3 * 24 * 60 * 60))).toBe("3d ago");
  });

  it("clamps a slightly-future timestamp to now rather than negative time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatAge(agoMicros(-5))).toBe("0s ago");
  });
});

describe("formatWhenWithAge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a same-day timestamp a clock and an age, no date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00").getTime());
    const label = formatWhenWithAge(new Date("2026-08-13T09:00:00").getTime() * 1000);
    expect(label).toMatch(/^\d{1,2}:\d{2}:\d{2} \(3h ago\)$/);
  });

  /**
   * A bare clock time on a three-day-old event reads as "today at 20:43" —
   * the one thing a "last time this wasn't empty" line must not say.
   */
  it("names the date once the timestamp is from another day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00").getTime());
    const label = formatWhenWithAge(new Date("2026-08-10T20:43:00").getTime() * 1000);
    expect(label).toContain("Aug 10");
    expect(label).toContain("(3d ago)");
  });
});

describe("shareWidth", () => {
  it("renders a share as a percentage of its track", () => {
    expect(shareWidth(0.42)).toEqual({ width: "42%" });
    expect(shareWidth(1)).toEqual({ width: "100%" });
  });

  it("rounds rather than printing sub-percent noise", () => {
    expect(shareWidth(0.333)).toEqual({ width: "33%" });
  });
});

describe("dbmHttpError", () => {
  /** An axios rejection, shaped as the pages actually receive one. */
  const axiosErr = (status?: number, message?: string) => ({
    response: { status, data: message !== undefined ? { message } : {} },
  });

  it("reads the status and the server's own message", () => {
    expect(dbmHttpError(axiosErr(404, "stream not found"))).toEqual({
      status: 404,
      serverMessage: "stream not found",
      message: "stream not found",
    });
  });

  /**
   * `serverMessage` stays distinct from `message`: the pages disagree on the
   * fallback (most print the error's own text, the aggregate pages substitute
   * their own copy), and a helper that baked in either would silently change
   * the other's banners.
   */
  it("falls back to the error's own text only for message", () => {
    const result = dbmHttpError(new Error("network down"));
    expect(result.status).toBeUndefined();
    expect(result.serverMessage).toBeUndefined();
    expect(result.message).toBe("Error: network down");
  });

  it("survives a rejection that is not an object at all", () => {
    expect(dbmHttpError("boom")).toEqual({ message: "boom" });
    expect(dbmHttpError(undefined)).toEqual({ message: "undefined" });
  });

  it("keeps a status that arrived without a body message", () => {
    const result = dbmHttpError(axiosErr(501));
    expect(result.status).toBe(501);
    expect(result.serverMessage).toBeUndefined();
  });
});
