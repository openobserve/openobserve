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
import { liveTimeSelection, staleQueriedRange } from "./logsStaleRange";

describe("results queried for another range", () => {
  const fixed = { type: "absolute" as const, startUs: 1_000, endUs: 2_000 };

  it("reads the picker as its run signature records it", () => {
    expect(
      liveTimeSelection({ type: "relative", relativeTimePeriod: "15m", startTime: 1 }),
    ).toEqual({ type: "relative", period: "15m" });
    expect(
      liveTimeSelection({
        type: "absolute",
        relativeTimePeriod: "15m",
        startTime: "1000",
        endTime: 2000,
      }),
    ).toEqual(fixed);
  });

  it("names the queried range only once the picker has moved off it", () => {
    const live15 = { type: "relative" as const, period: "15m" };
    expect(staleQueriedRange(live15, live15)).toBeNull();
    expect(staleQueriedRange(fixed, { ...fixed })).toBeNull();
    expect(staleQueriedRange(live15, { type: "relative", period: "7d" })).toEqual(live15);
    expect(staleQueriedRange(fixed, live15)).toEqual(fixed);
    expect(staleQueriedRange(fixed, { ...fixed, endUs: 3_000 })).toEqual(fixed);
  });

  it("says nothing before any run", () => {
    expect(staleQueriedRange(null, fixed)).toBeNull();
  });
});
