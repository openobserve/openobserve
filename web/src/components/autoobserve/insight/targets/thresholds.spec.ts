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
import { firedTimes, suggestErrors, suggestLatency, twoSignificant } from "./thresholds";

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

  it("rounds to two significant figures", () => {
    expect(suggestErrors(1234)).toBe(3700);
    expect(suggestErrors(0.123)).toBe(0.37);
  });
});

describe("suggestLatency", () => {
  it("is twice the usual p95", () => {
    expect(suggestLatency(420)).toBe(840);
    expect(suggestLatency(null)).toBeNull();
  });

  it("rounds to two significant figures", () => {
    expect(suggestLatency(1263)).toBe(2500);
    expect(twoSignificant(0.0456)).toBe(0.046);
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
