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
import { barTrackMax, mergeBarTrackMax } from "./barTrack";

describe("barTrackMax", () => {
  it("uses a numeric y_axis_max as is", () => {
    expect(barTrackMax(50, 70)).toBe(50);
    expect(barTrackMax("50", 70)).toBe(50);
    expect(barTrackMax("", 70)).toBe(70);
  });

  it("falls back to the largest bar when y_axis_max is unset or cleared", () => {
    expect(barTrackMax(undefined, 70)).toBe(70);
    expect(barTrackMax(null, 70)).toBe(70);
  });

  it("leaves the axis automatic when there is no positive data", () => {
    expect(barTrackMax(undefined, -Infinity)).toBeUndefined();
    expect(barTrackMax(null, 0)).toBeUndefined();
  });
});

describe("mergeBarTrackMax", () => {
  it("sets the largest per-query max on every value axis of the target", () => {
    const target = { xAxis: [{ max: 10 }, { max: 10 }] };
    mergeBarTrackMax(target, [
      { options: { xAxis: { max: 10 } } },
      { options: { xAxis: { max: 30 } } },
      null,
    ]);
    expect(target.xAxis).toEqual([{ max: 30 }, { max: 30 }]);
  });

  it("leaves the target alone when no query has a numeric max", () => {
    const target = { xAxis: { max: undefined } };
    mergeBarTrackMax(target, [{ options: { xAxis: { max: "dataMax" } } }]);
    expect(target.xAxis.max).toBeUndefined();
  });
});
