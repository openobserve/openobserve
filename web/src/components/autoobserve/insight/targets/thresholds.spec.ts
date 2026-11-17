// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import {
  draftThreshold,
  firedTimes,
  measuredThreshold,
  suggestErrors,
  suggestLatency,
  typedThreshold,
} from "./thresholds";

describe("suggestErrors", () => {
  it("is three times the usual hourly count", () => {
    expect(suggestErrors(17)).toBe(51);
  });

  it("has no number without a baseline", () => {
    expect(suggestErrors(0)).toBeNull();
    expect(suggestErrors(null)).toBeNull();
    expect(suggestErrors(Number.NaN)).toBeNull();
    expect(suggestErrors(-4)).toBeNull();
  });

  it("is a whole count, rounded up, so a quiet service still fires above its usual", () => {
    expect(suggestErrors(1234)).toBe(3702);
    expect(suggestErrors(1.4)).toBe(5);
    expect(suggestErrors(0.123)).toBe(1);
  });

  it("does not round a whole product up past itself on float noise", () => {
    expect(suggestErrors(56 / 168)).toBe(1);
    expect(suggestErrors(0.1)).toBe(1);
    expect(suggestErrors(2)).toBe(6);
  });
});

describe("suggestLatency", () => {
  it("is twice the usual p95", () => {
    expect(suggestLatency(420)).toBe(840);
    expect(suggestLatency(null)).toBeNull();
  });

  it("keeps two significant figures, which fits a duration in milliseconds or in seconds", () => {
    expect(suggestLatency(1263)).toBe(2500);
    expect(suggestLatency(24.3)).toBe(49);
    expect(suggestLatency(0.42)).toBe(0.84);
  });
});

describe("measuredThreshold: the one rounding the review list and the Add alert dialog share", () => {
  it("answers each kind as its suggestion does", () => {
    for (const usual of [0.123, 1.4, 17, 1234]) {
      expect(measuredThreshold("errors", usual)).toBe(suggestErrors(usual));
      expect(measuredThreshold("latency", usual)).toBe(suggestLatency(usual));
    }
    expect(measuredThreshold("errors", null)).toBeNull();
    expect(measuredThreshold("latency", 0)).toBeNull();
  });
});

describe("firedTimes", () => {
  it("counts a run above the threshold once", () => {
    expect(firedTimes([10, 60, 70, 80, 10], 50)).toBe(1);
  });

  it("counts two separate crossings twice", () => {
    expect(firedTimes([10, 60, 10, 70, 10], 50)).toBe(2);
  });

  it("counts a series that starts above the threshold, and never a value equal to it", () => {
    expect(firedTimes([60, 60, 10], 50)).toBe(1);
    expect(firedTimes([50, 50, 50], 50)).toBe(0);
  });

  it("treats a missing point as not firing", () => {
    expect(firedTimes([60, null, 60], 50)).toBe(2);
    expect(firedTimes([], 50)).toBe(0);
  });
});

describe("draftThreshold — one rule for the review list and the Add alert dialog", () => {
  it("drafts on the usual level, over anything typed", () => {
    expect(draftThreshold("errors", 10)).toBe(30);
    expect(draftThreshold("latency", 1263)).toBe(2500);
  });

  it("with no usual error count, fires on any error until the user sets a threshold", () => {
    expect(draftThreshold("errors", null)).toBe(0);
    expect(draftThreshold("errors", null, null)).toBe(0);
    expect(draftThreshold("errors", null, 5)).toBe(5);
    expect(draftThreshold("errors", null, 0)).toBe(0);
  });

  it("a cleared or unusable error count asks for a threshold", () => {
    expect(draftThreshold("errors", null, Number.NaN)).toBeNull();
    expect(draftThreshold("errors", null, -1)).toBeNull();
  });

  it("with no usual latency, asks for a threshold above 0", () => {
    expect(draftThreshold("latency", null)).toBeNull();
    expect(draftThreshold("latency", null, 0)).toBeNull();
    expect(draftThreshold("latency", null, 300)).toBe(300);
  });
});

describe("typedThreshold", () => {
  it("reads an empty field as cleared, not as 0", () => {
    expect(typedThreshold("")).toBeNaN();
    expect(typedThreshold("  ")).toBeNaN();
    expect(typedThreshold("abc")).toBeNaN();
    expect(typedThreshold("0")).toBe(0);
    expect(typedThreshold(12)).toBe(12);
  });
});
