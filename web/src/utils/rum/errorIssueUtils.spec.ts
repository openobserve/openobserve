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

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  escapeSqlString,
  issueKey,
  parseTopFrame,
  routeFromUrl,
  computeIssueStatus,
  computeTrendAnnotation,
  pickLatestDeploy,
  computeDeploySpikeFactor,
  intervalToMicros,
  histogramKeyToMicros,
  formatRelativeTime,
} from "./errorIssueUtils";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// escapeSqlString
// ---------------------------------------------------------------------------

describe("escapeSqlString", () => {
  it("doubles a single quote", () => {
    expect(escapeSqlString("it's")).toBe("it''s");
  });

  it("doubles multiple single quotes", () => {
    expect(escapeSqlString("O'Brien's")).toBe("O''Brien''s");
  });

  it("leaves double quotes alone", () => {
    expect(escapeSqlString('say "hi"')).toBe('say "hi"');
  });

  it("leaves backslashes alone", () => {
    expect(escapeSqlString("C:\\path\\to\\file")).toBe("C:\\path\\to\\file");
  });

  it("returns an empty string unchanged", () => {
    expect(escapeSqlString("")).toBe("");
  });

  it("leaves strings with no single quotes unchanged", () => {
    const input = "no quotes here";
    expect(escapeSqlString(input)).toBe(input);
  });

  it("handles a string that is only a single quote", () => {
    expect(escapeSqlString("'")).toBe("''");
  });
});

// ---------------------------------------------------------------------------
// issueKey
// ---------------------------------------------------------------------------

describe("issueKey", () => {
  // The NUL character (charCode 0) is the field separator used in issueKey.
  const NUL = String.fromCharCode(0);

  it("joins type, message, and handling with NUL separators", () => {
    const key = issueKey({
      error_type: "TypeError",
      error_message: "x is not a function",
      error_handling: "unhandled",
    });

    expect(key).toBe(`TypeError${NUL}x is not a function${NUL}unhandled`);
  });

  it("uses empty string for null type", () => {
    const key = issueKey({
      error_type: null,
      error_message: "boom",
      error_handling: "handled",
    });

    expect(key).toBe(`${NUL}boom${NUL}handled`);
  });

  it("uses empty string for undefined message", () => {
    const key = issueKey({
      error_type: "ReferenceError",
      error_message: undefined,
      error_handling: "unhandled",
    });

    expect(key).toBe(`ReferenceError${NUL}${NUL}unhandled`);
  });

  it("uses empty string for null handling", () => {
    const key = issueKey({
      error_type: "Error",
      error_message: "fail",
      error_handling: null,
    });

    expect(key).toBe(`Error${NUL}fail${NUL}`);
  });

  it("produces different keys for rows differing only in error_handling", () => {
    const row = { error_type: "Error", error_message: "oops" };
    const keyHandled = issueKey({ ...row, error_handling: "handled" });
    const keyUnhandled = issueKey({ ...row, error_handling: "unhandled" });

    expect(keyHandled).not.toBe(keyUnhandled);
  });

  it("handles all-null fields by producing two NUL separators with three empty segments", () => {
    const key = issueKey({
      error_type: null,
      error_message: null,
      error_handling: null,
    });

    expect(key).toBe(`${NUL}${NUL}`);
  });

  it("handles all-omitted fields same as all-null", () => {
    const key = issueKey({});

    expect(key).toBe(`${NUL}${NUL}`);
  });
});

// ---------------------------------------------------------------------------
// parseTopFrame
// ---------------------------------------------------------------------------

describe("parseTopFrame", () => {
  it("returns null for null input", () => {
    expect(parseTopFrame(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseTopFrame(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTopFrame("")).toBeNull();
  });

  it("returns null for a message-only string with no stack frame", () => {
    expect(parseTopFrame("TypeError: x is not a function")).toBeNull();
  });

  it("parses a Chrome-format frame with parenthesised URL", () => {
    const stack =
      "TypeError: x is not a function\n" +
      "    at doThing (https://app.example.com/assets/checkout.js:214:15)";

    const result = parseTopFrame(stack);

    expect(result).toEqual({ file: "checkout.js", line: 214 });
  });

  it("parses a Firefox-format frame (fn@url:line:col)", () => {
    const stack =
      "TypeError: x is not a function\n" +
      "doThing@https://app.example.com/js/main.js:42:7";

    const result = parseTopFrame(stack);

    expect(result).toEqual({ file: "main.js", line: 42 });
  });

  it("parses a bare 'at url:line:col' frame", () => {
    const stack = "at https://x/y/file.js:1:2";

    const result = parseTopFrame(stack);

    expect(result).toEqual({ file: "file.js", line: 1 });
  });

  it("skips <anonymous> frames and returns null when no real frame exists", () => {
    const stack =
      "Error: oops\n    at <anonymous>:1:1\n    at <anonymous>:2:2";

    expect(parseTopFrame(stack)).toBeNull();
  });

  it("strips query strings from file paths", () => {
    const stack =
      "Error: fail\n    at render (https://cdn.example.com/bundle.js?v=abc:10:2)";

    const result = parseTopFrame(stack);

    expect(result).toEqual({ file: "bundle.js", line: 10 });
  });

  it("skips the error message line (no file-looking segment) and parses the frame", () => {
    const stack =
      "TypeError: x is not a function\n" +
      "    at doThing (https://app.example.com/assets/checkout.js:214:15)";

    const result = parseTopFrame(stack);

    expect(result!.file).toBe("checkout.js");
  });

  it("returns the first parseable frame when multiple frames are present", () => {
    const stack =
      "TypeError: bad\n" +
      "    at topFn (https://cdn.example.com/top.js:10:5)\n" +
      "    at bottomFn (https://cdn.example.com/bottom.js:99:1)";

    const result = parseTopFrame(stack);

    expect(result).toEqual({ file: "top.js", line: 10 });
  });
});

// ---------------------------------------------------------------------------
// routeFromUrl
// ---------------------------------------------------------------------------

describe("routeFromUrl", () => {
  it("returns null for null", () => {
    expect(routeFromUrl(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(routeFromUrl(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(routeFromUrl("")).toBeNull();
  });

  it("extracts pathname from an absolute URL", () => {
    expect(routeFromUrl("https://app.example.com/checkout")).toBe("/checkout");
  });

  it("returns '/' for a root URL", () => {
    expect(routeFromUrl("https://app.example.com/")).toBe("/");
  });

  it("drops query string from absolute URL", () => {
    expect(routeFromUrl("https://app.example.com/checkout?ref=banner")).toBe(
      "/checkout",
    );
  });

  it("accepts an already-relative path and strips query", () => {
    expect(routeFromUrl("/checkout?x=1")).toBe("/checkout");
  });

  it("returns a relative path without query string unchanged", () => {
    expect(routeFromUrl("/dashboard/overview")).toBe("/dashboard/overview");
  });

  it("returns null for garbage strings that are not absolute and not relative", () => {
    expect(routeFromUrl("not a url")).toBeNull();
  });

  it("returns null for a plain string with no scheme and no leading slash", () => {
    expect(routeFromUrl("sometext")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeIssueStatus
// ---------------------------------------------------------------------------

describe("computeIssueStatus", () => {
  const windowStart = 1_000_000;
  const windowEnd = 2_000_000;

  describe("with a deploy timestamp", () => {
    it("returns 'new' when firstSeen >= deployTs", () => {
      const result = computeIssueStatus(
        1_500_000,
        1_400_000,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("new");
    });

    it("returns 'new' when firstSeen exactly equals deployTs", () => {
      const result = computeIssueStatus(
        1_400_000,
        1_400_000,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("new");
    });

    it("returns 'ongoing' when firstSeen < deployTs", () => {
      const result = computeIssueStatus(
        1_200_000,
        1_400_000,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("ongoing");
    });
  });

  describe("without a deploy timestamp (null)", () => {
    it("returns 'new' when firstSeen is past window start + 10% span", () => {
      // span = 1_000_000; 10% = 100_000; threshold = 1_100_000
      const result = computeIssueStatus(
        1_200_000,
        null,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("new");
    });

    it("returns 'new' when firstSeen exactly equals the 10% threshold", () => {
      // threshold = windowStart + span * 0.1 = 1_000_000 + 100_000 = 1_100_000
      const result = computeIssueStatus(
        1_100_000,
        null,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("new");
    });

    it("returns 'ongoing' when firstSeen is at the window start edge", () => {
      const result = computeIssueStatus(
        windowStart,
        null,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("ongoing");
    });

    it("returns 'ongoing' when firstSeen is below the 10% threshold", () => {
      const result = computeIssueStatus(
        1_050_000,
        null,
        windowStart,
        windowEnd,
      );

      expect(result).toBe("ongoing");
    });

    it("returns 'ongoing' when window span is zero", () => {
      const result = computeIssueStatus(1_000_000, null, 1_000_000, 1_000_000);

      expect(result).toBe("ongoing");
    });

    it("returns 'ongoing' when window end is before window start (negative span)", () => {
      const result = computeIssueStatus(1_000_000, null, 2_000_000, 1_000_000);

      expect(result).toBe("ongoing");
    });
  });

  it("returns 'ongoing' when firstSeen is 0 (falsy)", () => {
    const result = computeIssueStatus(0, null, windowStart, windowEnd);

    expect(result).toBe("ongoing");
  });
});

// ---------------------------------------------------------------------------
// computeTrendAnnotation
// ---------------------------------------------------------------------------

describe("computeTrendAnnotation", () => {
  it("returns {kind:'new', factor:null} for status 'new' regardless of spiking buckets", () => {
    const buckets = [1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4];

    expect(computeTrendAnnotation(buckets, "new")).toEqual({
      kind: "new",
      factor: null,
    });
  });

  it("returns {kind:'new', factor:null} for status 'new' with null buckets", () => {
    expect(computeTrendAnnotation(null, "new")).toEqual({
      kind: "new",
      factor: null,
    });
  });

  it("returns flat for null buckets with ongoing status", () => {
    expect(computeTrendAnnotation(null, "ongoing")).toEqual({
      kind: "flat",
      factor: null,
    });
  });

  it("returns flat when buckets length is exactly 4 (not enough history for trend)", () => {
    expect(computeTrendAnnotation([1, 2, 3, 4], "ongoing")).toEqual({
      kind: "flat",
      factor: null,
    });
  });

  it("returns flat when buckets length is less than 4", () => {
    expect(computeTrendAnnotation([1, 2], "ongoing")).toEqual({
      kind: "flat",
      factor: null,
    });
  });

  it("returns flat when buckets is empty", () => {
    expect(computeTrendAnnotation([], "ongoing")).toEqual({
      kind: "flat",
      factor: null,
    });
  });

  it("detects a spike: buckets [1,1,1,1,1,1,1,1,4,4,4,4] yields kind spike with factor 4", () => {
    // baseline = avg(first 8 buckets) = 1; recent = avg(last 4 buckets) = 4
    // factor = 4 / max(1, 0.01) = 4 >= SPIKE_FACTOR(2)
    const result = computeTrendAnnotation(
      [1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4],
      "ongoing",
    );

    expect(result.kind).toBe("spike");
    expect(result.factor).toBe(4);
  });

  it("detects a drop when recent / baseline <= 0.5", () => {
    // baseline = avg(first 8) = 4; recent = avg(last 4) = 1; factor = 0.25 <= DROP_FACTOR(0.5)
    const result = computeTrendAnnotation(
      [4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1],
      "ongoing",
    );

    expect(result.kind).toBe("drop");
    expect(result.factor).toBe(0.25);
  });

  it("returns flat when factor is between 0.5 and 2 (steady)", () => {
    // factor = 1 (all same values) — not spike, not drop
    const result = computeTrendAnnotation(
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      "ongoing",
    );

    expect(result).toEqual({ kind: "flat", factor: null });
  });

  it("uses 0.01 floor for all-zero baseline to avoid division by zero", () => {
    // baseline = 0 → 0.01 floor; recent = 4; factor = 400 >= 2 → spike
    const result = computeTrendAnnotation(
      [0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4],
      "ongoing",
    );

    expect(result.kind).toBe("spike");
    expect(result.factor).toBeCloseTo(400);
  });

  it("all-zero buckets: factor = 0 / 0.01 = 0 which is <= 0.5 → kind drop", () => {
    const result = computeTrendAnnotation(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "ongoing",
    );

    expect(result.kind).toBe("drop");
    expect(result.factor).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// pickLatestDeploy
// ---------------------------------------------------------------------------

describe("pickLatestDeploy", () => {
  const windowStart = 1_000_000;
  const windowEnd = 10_000_000;
  const bucketMicros = 500_000;
  // threshold = windowStart + bucketMicros = 1_500_000

  it("returns null for empty list", () => {
    expect(
      pickLatestDeploy([], windowStart, windowEnd, bucketMicros),
    ).toBeNull();
  });

  it("picks the newest qualifying deploy inside window", () => {
    const deploys = [
      { version: "v1.0", firstSeen: 2_000_000 },
      { version: "v1.1", firstSeen: 5_000_000 },
    ];

    const result = pickLatestDeploy(
      deploys,
      windowStart,
      windowEnd,
      bucketMicros,
    );

    expect(result).toEqual({ version: "v1.1", firstSeen: 5_000_000 });
  });

  it("excludes deploys at exactly the first bucket threshold (condition is strictly greater)", () => {
    // firstSeen must be > threshold (1_500_000), not >=
    const deploys = [{ version: "v1.0", firstSeen: 1_500_000 }];

    const result = pickLatestDeploy(
      deploys,
      windowStart,
      windowEnd,
      bucketMicros,
    );

    expect(result).toBeNull();
  });

  it("excludes deploys at or after windowEnd (condition is strictly less)", () => {
    const deploys = [{ version: "v2.0", firstSeen: windowEnd }];

    const result = pickLatestDeploy(
      deploys,
      windowStart,
      windowEnd,
      bucketMicros,
    );

    expect(result).toBeNull();
  });

  it("includes a deploy strictly inside (threshold, windowEnd)", () => {
    const deploys = [{ version: "v1.5", firstSeen: 1_500_001 }];

    const result = pickLatestDeploy(
      deploys,
      windowStart,
      windowEnd,
      bucketMicros,
    );

    expect(result).toEqual({ version: "v1.5", firstSeen: 1_500_001 });
  });

  it("picks the latest when multiple qualifying candidates exist", () => {
    const deploys = [
      { version: "v1.0", firstSeen: 2_000_000 },
      { version: "v1.2", firstSeen: 8_000_000 },
      { version: "v1.1", firstSeen: 5_000_000 },
    ];

    const result = pickLatestDeploy(
      deploys,
      windowStart,
      windowEnd,
      bucketMicros,
    );

    expect(result).toEqual({ version: "v1.2", firstSeen: 8_000_000 });
  });
});

// ---------------------------------------------------------------------------
// computeDeploySpikeFactor
// ---------------------------------------------------------------------------

describe("computeDeploySpikeFactor", () => {
  it("returns null when deployIndex is 0", () => {
    expect(computeDeploySpikeFactor([1, 2, 3, 4], 0)).toBeNull();
  });

  it("returns null when deployIndex equals array length (out of range)", () => {
    const totals = [1, 2, 3];

    expect(computeDeploySpikeFactor(totals, totals.length)).toBeNull();
  });

  it("returns null when deployIndex exceeds array length", () => {
    expect(computeDeploySpikeFactor([1, 2], 5)).toBeNull();
  });

  it("returns factor when post/pre ratio >= 1.5 with a solid baseline", () => {
    // pre = avg([1,1,1]) = 1; post = avg([3,3,3]) = 3; factor = 3 >= 1.5
    const result = computeDeploySpikeFactor([1, 1, 1, 3, 3, 3], 3);

    expect(result).toBe(3);
  });

  it("returns null when factor is below 1.5 threshold", () => {
    // pre = avg([2,2,2]) = 2; post = avg([2,2]) = 2; factor = 1 < 1.5
    expect(computeDeploySpikeFactor([2, 2, 2, 2, 2], 3)).toBeNull();
  });

  it("returns null for a near-zero pre-deploy baseline instead of an inflated ratio", () => {
    // pre = avg([0,0,0]) = 0 < 1 min baseline → caption suppressed; the old
    // 0.01 floor produced absurd "500× spike" captions on empty baselines.
    expect(computeDeploySpikeFactor([0, 0, 0, 5, 5], 3)).toBeNull();
  });

  it("returns null when the baseline average is below 1 error per bucket", () => {
    // pre = avg([1,0,0]) ≈ 0.33 < 1 → suppressed even though post is high
    expect(computeDeploySpikeFactor([1, 0, 0, 9, 9], 3)).toBeNull();
  });

  it("returns null when fewer than 3 pre-deploy buckets exist", () => {
    // Only 1-2 buckets before the marker is not a meaningful baseline.
    expect(computeDeploySpikeFactor([1, 5], 1)).toBeNull();
    expect(computeDeploySpikeFactor([2, 2, 8, 8], 2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// intervalToMicros
// ---------------------------------------------------------------------------

describe("intervalToMicros", () => {
  it("converts '10 second' to 10_000_000 microseconds", () => {
    expect(intervalToMicros("10 second")).toBe(10_000_000);
  });

  it("converts '30 minute' to 1_800_000_000 microseconds", () => {
    expect(intervalToMicros("30 minute")).toBe(30 * 60_000_000);
  });

  it("converts '1 hour' to 3_600_000_000 microseconds", () => {
    expect(intervalToMicros("1 hour")).toBe(3_600_000_000);
  });

  it("converts '1 day' to 86_400_000_000 microseconds", () => {
    expect(intervalToMicros("1 day")).toBe(86_400_000_000);
  });

  it("handles plural 'seconds' by stripping the trailing s", () => {
    expect(intervalToMicros("5 seconds")).toBe(5_000_000);
  });

  it("handles plural 'minutes'", () => {
    expect(intervalToMicros("15 minutes")).toBe(15 * 60_000_000);
  });

  it("falls back to 60_000_000 for an unknown unit", () => {
    expect(intervalToMicros("5 fortnight")).toBe(60_000_000);
  });

  it("falls back to 60_000_000 for completely garbage input", () => {
    expect(intervalToMicros("not-an-interval")).toBe(60_000_000);
  });

  it("handles leading/trailing whitespace", () => {
    expect(intervalToMicros("  5 minute  ")).toBe(5 * 60_000_000);
  });
});

// ---------------------------------------------------------------------------
// histogramKeyToMicros
// ---------------------------------------------------------------------------

describe("histogramKeyToMicros", () => {
  it("passes through a numeric key unchanged", () => {
    expect(histogramKeyToMicros(1_700_000_000_000_000)).toBe(
      1_700_000_000_000_000,
    );
  });

  it("passes through zero as a number", () => {
    expect(histogramKeyToMicros(0)).toBe(0);
  });

  it("converts an ISO string without timezone suffix (treated as UTC)", () => {
    const expectedMicros = Date.UTC(2026, 0, 1, 0, 0, 0) * 1000;

    expect(histogramKeyToMicros("2026-01-01T00:00:00")).toBe(expectedMicros);
  });

  it("converts an ISO string with Z suffix", () => {
    const expectedMicros = Date.UTC(2026, 0, 1, 10, 30, 0) * 1000;

    expect(histogramKeyToMicros("2026-01-01T10:30:00Z")).toBe(expectedMicros);
  });

  it("converts an ISO string with +00:00 timezone offset", () => {
    const expectedMicros = Date.UTC(2026, 6, 3, 12, 0, 0) * 1000;

    expect(histogramKeyToMicros("2026-07-03T12:00:00+00:00")).toBe(
      expectedMicros,
    );
  });

  it("returns 0 for an unparseable string", () => {
    expect(histogramKeyToMicros("not-a-date")).toBe(0);
  });

  it("returns 0 for an empty string", () => {
    expect(histogramKeyToMicros("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for 0 (falsy input)", () => {
    expect(formatRelativeTime(0)).toBe("");
  });

  it("returns '2 minutes ago' for a timestamp 2 minutes in the past (microseconds)", () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    const twoMinutesAgoMicros = (nowMs - 2 * 60 * 1000) * 1000;

    const result = formatRelativeTime(twoMinutesAgoMicros);

    expect(result).toBe("2 minutes ago");
  });

  it("returns '1 hour ago' for a timestamp 1 hour in the past", () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    const oneHourAgoMicros = (nowMs - 60 * 60 * 1000) * 1000;

    const result = formatRelativeTime(oneHourAgoMicros);

    expect(result).toBe("1 hour ago");
  });

  it("returns '30 seconds ago' for a timestamp 30 seconds in the past", () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    const thirtySecondsAgoMicros = (nowMs - 30 * 1000) * 1000;

    const result = formatRelativeTime(thirtySecondsAgoMicros);

    expect(result).toBe("30 seconds ago");
  });
});
