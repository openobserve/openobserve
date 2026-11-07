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
import useAutoRefreshGate, {
  fixedRangeOf,
  rangeHasEnded,
  suggestRelativePeriod,
} from "./useAutoRefreshGate";

const NOW = Date.parse("2026-11-06T08:32:00Z");
const HOUR_US = 3_600_000_000;

describe("useAutoRefreshGate", () => {
  it("treats an absolute range, from either page shape, as fixed", () => {
    expect(fixedRangeOf({ type: "absolute", startTime: 1, endTime: 2 })).toEqual({
      startUs: 1,
      endUs: 2,
    });
    expect(fixedRangeOf({ valueType: "absolute", startTime: 1, endTime: 2 })).toEqual({
      startUs: 1,
      endUs: 2,
    });
  });

  it("lets a rolling period and a current calendar period follow now", () => {
    expect(fixedRangeOf({ type: "relative", relativeTimePeriod: "15m" }, NOW)).toBeNull();
    expect(
      fixedRangeOf({ type: "relative", relativeTimePeriod: "calendar:day:0" }, NOW),
    ).toBeNull();
  });

  it("fixes a finished calendar period at its own end", () => {
    const range = fixedRangeOf({ type: "relative", relativeTimePeriod: "calendar:day:-1" }, NOW);
    expect(range).not.toBeNull();
    expect(rangeHasEnded(range, NOW)).toBe(true);
  });

  it("pauses only once the end has passed", () => {
    const nowUs = NOW * 1000;
    expect(rangeHasEnded({ startUs: nowUs - HOUR_US, endUs: nowUs + HOUR_US }, NOW)).toBe(false);
    expect(rangeHasEnded({ startUs: nowUs - HOUR_US, endUs: nowUs }, NOW)).toBe(true);
    expect(rangeHasEnded(null, NOW)).toBe(false);
  });

  it("rounds a switch target to the largest unit within 5%", () => {
    expect(suggestRelativePeriod((2 * 24 * 60 + 15) * 60_000_000)).toBe("2d");
    expect(suggestRelativePeriod((8 * 60 + 30) * 60_000_000)).toBe("510m");
    expect(suggestRelativePeriod(7 * 24 * HOUR_US)).toBe("1w");
    expect(suggestRelativePeriod(HOUR_US)).toBe("1h");
  });

  it("keeps a switch target inside the page's query-range limit and the picker's caps", () => {
    expect(suggestRelativePeriod(3 * 24 * HOUR_US, 24 * HOUR_US)).toBe("1d");
    expect(suggestRelativePeriod(30 * HOUR_US, 26 * HOUR_US)).toBe("26h");
    expect(suggestRelativePeriod(20 * 365 * 24 * HOUR_US)).toBe("120M");
    expect(suggestRelativePeriod(90 * 60_000_000, 1 * HOUR_US)).toBe("1h");
  });

  it("skips a tick for a range that has ended", () => {
    const { shouldSkipTick } = useAutoRefreshGate();
    expect(shouldSkipTick({ type: "absolute", startTime: 1, endTime: 2 })).toBe(true);
    expect(shouldSkipTick({ type: "relative", relativeTimePeriod: "15m" })).toBe(false);
  });
});
