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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toZonedTime } from "date-fns-tz";
import { instantFromShiftedMs } from "./timeRangeZoom";

const KOLKATA = "Asia/Kolkata";

describe("drag-zoom values from a zone-shifted chart", () => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("recovers the true instants of a range across the browser's DST gap", () => {
    // New York springs forward on 2026-03-08 at 02:00; Kolkata 01:00–04:00 that day spans it on the chart's clock.
    const start = Date.UTC(2026, 2, 7, 19, 30);
    const end = Date.UTC(2026, 2, 7, 22, 30);
    const shiftedStart = toZonedTime(start, KOLKATA).getTime();
    const shiftedEnd = toZonedTime(end, KOLKATA).getTime();
    expect(instantFromShiftedMs(shiftedStart, KOLKATA)).toBe(start * 1000);
    expect(instantFromShiftedMs(shiftedEnd, KOLKATA)).toBe(end * 1000);
  });

  it("recovers instants on either side of the browser's DST fall-back", () => {
    for (const hour of [4, 5, 6, 7]) {
      const instant = Date.UTC(2026, 10, 1, hour, 15);
      const shifted = toZonedTime(instant, KOLKATA).getTime();
      expect(instantFromShiftedMs(shifted, KOLKATA)).toBe(instant * 1000);
    }
  });

  it("recovers the instant when the browser zone is the app zone", () => {
    process.env.TZ = KOLKATA;
    const instant = Date.UTC(2026, 10, 11, 7, 12, 30);
    expect(instantFromShiftedMs(toZonedTime(instant, KOLKATA).getTime(), KOLKATA)).toBe(
      instant * 1000,
    );
  });
});
