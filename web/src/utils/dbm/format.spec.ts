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

import { describe, expect, it } from "vitest";

import {
  computeQps,
  errorRate,
  countClaim,
  failedCellKind,
  formatCallsPerTrace,
  formatNs,
  formatPercent,
  formatRate,
  formatSignedPercent,
  oneLine,
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

describe("formatCallsPerTrace", () => {
  it("always carries the ≈ that the trace upper bound forces", () => {
    // traces is an upper bound, so this ratio is a LOWER bound — never exact.
    expect(formatCallsPerTrace(47.2)).toBe("≈ ×47");
    expect(formatCallsPerTrace(2.5)).toBe("≈ ×2.5");
  });

  it("returns an em dash when there is no ratio", () => {
    expect(formatCallsPerTrace(null)).toBe("—");
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
