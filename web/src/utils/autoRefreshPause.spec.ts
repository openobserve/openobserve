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
import { autoRefreshState, fixedRangeEnd, fixedRangeEnded, owesCatchUp } from "./autoRefreshPause";

const NOW_MS = Date.UTC(2026, 10, 11, 7, 12);

describe("auto-refresh pause predicates", () => {
  it("treats only a fixed range whose end has passed as ended", () => {
    expect(fixedRangeEnded(NOW_MS * 1000 - 1, NOW_MS)).toBe(true);
    expect(fixedRangeEnded(NOW_MS * 1000 + 60_000_000, NOW_MS)).toBe(false);
    expect(fixedRangeEnded(null, NOW_MS)).toBe(false);
  });

  it("reads the end of an absolute picker payload and none of a rolling one", () => {
    expect(fixedRangeEnd({ type: "absolute", endTime: 5 })).toBe(5);
    expect(fixedRangeEnd({ valueType: "absolute", endTime: 5 })).toBe(5);
    expect(fixedRangeEnd({ type: "relative", endTime: 5, relativeTimePeriod: "15m" })).toBeNull();
    expect(fixedRangeEnd({ type: "absolute", endTime: Number.NaN })).toBeNull();
  });

  it("names the pause, with an ended range outranking a hidden tab", () => {
    expect(autoRefreshState({ intervalSeconds: 0, hidden: true, rangeEnded: true })).toBe("off");
    expect(autoRefreshState({ intervalSeconds: 30, hidden: true, rangeEnded: true })).toBe(
      "paused-ended",
    );
    expect(autoRefreshState({ intervalSeconds: 30, hidden: true, rangeEnded: false })).toBe(
      "paused-hidden",
    );
    expect(autoRefreshState({ intervalSeconds: 30, hidden: false, rangeEnded: false })).toBe(
      "running",
    );
  });

  it("owes one catch-up on return only when a tick fell due while hidden", () => {
    const base = { intervalSeconds: 30, nowMs: NOW_MS, rangeEndUs: null };
    expect(owesCatchUp({ ...base, lastTickMs: NOW_MS - 31_000 })).toBe(true);
    expect(owesCatchUp({ ...base, lastTickMs: NOW_MS - 10_000 })).toBe(false);
    expect(owesCatchUp({ ...base, lastTickMs: null })).toBe(false);
  });

  it("owes an ended fixed range only its tail after the last query", () => {
    const base = { intervalSeconds: 30, nowMs: NOW_MS, rangeEndUs: (NOW_MS - 5_000) * 1000 };
    expect(owesCatchUp({ ...base, lastTickMs: NOW_MS - 10_000 })).toBe(true);
    expect(owesCatchUp({ ...base, lastTickMs: NOW_MS - 1_000 })).toBe(false);
  });
});
